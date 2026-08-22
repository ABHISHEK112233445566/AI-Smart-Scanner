require("dotenv").config();

const { getStockUniverseAsync, getEnabledIndexOptions } = require("./universeEngine");
const { setBroker, getActiveBroker } = require("./brokers");
const angelOne = require("./brokers/angelone");
const upstox = require("./brokers/upstox");
const { createFailoverBroker } = require("./brokers/failoverBroker");
const { loadSymbolMaster } = require("./services/symbolService");
const { scanStocks } = require("./scanner");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { updateGoogleSheet } = require("./googleSheet");
const { buildDashboard } = require("./dashboard");

async function main() {
    const scanStartedAt = new Date();

    console.log("\n===============================");
    console.log("   AI SMART SCANNER V4");
    console.log("   CONFIGURABLE UNIVERSE");
    console.log("===============================\n");

    const brokerMode = String(process.env.BROKER || "UPSTOX").trim().toUpperCase();
    const broker = brokerMode === "UPSTOX"
        ? createFailoverBroker(upstox, angelOne)
        : brokerMode === "ANGELONE" || brokerMode === "ANGEL_ONE"
            ? angelOne
            : createFailoverBroker(upstox, angelOne);

    setBroker(broker);

    const activeBroker = getActiveBroker();
    if (!activeBroker || typeof activeBroker.login !== "function") {
        throw new Error("Active broker does not implement login()");
    }

    console.log(`Broker Mode: ${brokerMode}`);
    console.log(`Broker Strategy: ${brokerMode === "UPSTOX" ? "UPSTOX PRIMARY → ANGEL ONE FALLBACK" : "ANGEL ONE"}`);

    await activeBroker.login();
    console.log("✅ Broker Login Successful\n");

    try {
        await loadSymbolMaster();
        console.log("✅ Symbol master loaded successfully.\n");
    } catch (error) {
        console.log(`⚠️ Symbol master load skipped: ${error?.message || error}`);
    }

    const symbols = await getStockUniverseAsync();
    const enabledIndexes = getEnabledIndexOptions();

    if (!Array.isArray(symbols) || symbols.length === 0) {
        throw new Error("No stock symbols are enabled in the V4 universe configuration.");
    }

    console.log("========================================");
    console.log("        V4 CONFIGURABLE SCANNER");
    console.log("========================================");
    console.log(`Unique Stocks Loaded: ${symbols.length}`);
    console.log(`Enabled Index Options: ${enabledIndexes.join(", ") || "NONE"}`);
    console.log("Pipeline: UNIVERSE → DAILY → DIRECTION → MOMENTUM → MTF → RANK → OPTIONS");
    console.log("========================================\n");

    const qualifiedStocks = await scanStocks(symbols);

    console.log("\n========== STOCK QUALIFICATION ==========");
    console.log(`Qualified shortlist: ${qualifiedStocks.length}`);

    qualifiedStocks.forEach((stock, index) => {
        console.log(`${index + 1}. ${stock.stock} | ${stock.direction} | Score: ${stock.finalScore ?? stock.score ?? 0} | MTF: ${stock.mtfAlignment ?? 0} | Momentum: ${stock.pipeline?.momentumScore ?? 0}`);
    });

    console.log("\n========== OPTIONS DECISION ENGINE ==========");
    let optionDecisions = [];

    try {
        const decisions = await calculateOptionsDecisions(qualifiedStocks);
        optionDecisions = Array.isArray(decisions) ? decisions : [];
    } catch (error) {
        console.error(`❌ Options Decision Engine failed: ${error?.message || error}`);
    }

    optionDecisions.sort((a, b) => {
        const decisionRank = { TRADE: 3, WATCH: 2, REJECT: 1 };
        const rankDiff = (decisionRank[b?.optionsDecision || b?.decision] || 0) - (decisionRank[a?.optionsDecision || a?.decision] || 0);
        if (rankDiff !== 0) return rankDiff;
        const confidenceDiff = Number(b?.optionsConfidence ?? b?.confidence ?? 0) - Number(a?.optionsConfidence ?? a?.confidence ?? 0);
        if (confidenceDiff !== 0) return confidenceDiff;
        return Number(b?.finalScore ?? b?.score ?? 0) - Number(a?.finalScore ?? a?.score ?? 0);
    });

    optionDecisions.forEach((option, index) => {
        const entry = Number(option?.entry ?? option?.optionEntry ?? 0);
        const stopLoss = Number(option?.stopLoss ?? option?.optionStopLoss ?? 0);
        const target1 = Number(option?.target1 ?? option?.optionTarget1 ?? 0);
        const target2 = Number(option?.target2 ?? option?.optionTarget2 ?? 0);
        const rr = Number(option?.riskReward ?? option?.optionRiskReward ?? 0);
        const confidence = option?.optionsConfidence ?? option?.confidence ?? 0;
        console.log(`${index + 1}. ${option?.stock || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Entry: ${entry.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | T1: ${target1.toFixed(2)} | T2: ${target2.toFixed(2)} | R:R: ${rr.toFixed(2)} | Confidence: ${confidence} | ${option?.optionsDecision || option?.decision || "N/A"}`);
    });

    const finalTop5 = optionDecisions.slice(0, 5);

    console.log("\n========== FINAL TOP 5 ==========");
    finalTop5.forEach((option, index) => {
        console.log(`${index + 1}. ${option?.stock || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Confidence: ${option?.optionsConfidence ?? option?.confidence ?? 0} | ${option?.optionsDecision || option?.decision || "N/A"}`);
    });

    try {
        if (typeof updateGoogleSheet === "function") await updateGoogleSheet(finalTop5);
    } catch (error) {
        console.error(`⚠️ Google Sheet update failed: ${error?.message || error}`);
    }

    try {
        if (typeof buildDashboard === "function") await buildDashboard(finalTop5);
    } catch (error) {
        console.error(`⚠️ Dashboard update failed: ${error?.message || error}`);
    }

    const elapsedSeconds = ((Date.now() - scanStartedAt.getTime()) / 1000).toFixed(1);
    console.log(`\nSCAN COMPLETE | Universe: ${symbols.length} | Indexes: ${enabledIndexes.length} | Qualified: ${qualifiedStocks.length} | Options: ${optionDecisions.length} | Elapsed: ${elapsedSeconds}s\n`);

    return { scanned: symbols.length, enabledIndexes, qualifiedStocks, optionDecisions, finalTop5, elapsedSeconds: Number(elapsedSeconds) };
}

main().catch(error => {
    console.error("\n❌ Scanner failed:");
    console.error(error?.message || error);
    process.exitCode = 1;
});
