require("dotenv").config();

const symbols = require("./symbols/nifty100");
const { setBroker, getActiveBroker } = require("./brokers");
const { loadSymbolMaster } = require("./services/symbolService");
const { scanStocks } = require("./scanner");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { updateGoogleSheet } = require("./googleSheet");
const { buildDashboard } = require("./dashboard");

async function main() {
    const scanStartedAt = new Date();

    console.log("\n===============================");
    console.log("   AI SMART SCANNER V4");
    console.log("   SEQUENTIAL PIPELINE");
    console.log("===============================\n");

    const brokerName = process.env.BROKER || "ANGELONE";
    setBroker(brokerName);

    const activeBroker = getActiveBroker();
    if (!activeBroker || typeof activeBroker.login !== "function") {
        throw new Error("Active broker does not implement login()");
    }

    console.log(`Broker Configuration: ${brokerName}`);
    console.log(`Active Broker: ${activeBroker?.name || brokerName}`);

    await activeBroker.login();
    console.log("✅ Broker Login Successful\n");

    try {
        await loadSymbolMaster();
        console.log("✅ Symbol master loaded successfully.\n");
    } catch (error) {
        console.log(`⚠️ Symbol master load skipped: ${error?.message || error}`);
    }

    if (!Array.isArray(symbols) || symbols.length === 0) {
        throw new Error("No NIFTY 100 scanner symbols configured.");
    }

    console.log("========================================");
    console.log("        NIFTY 100 SEQUENTIAL SCANNER");
    console.log("========================================");
    console.log(`Total Stocks Loaded: ${symbols.length}`);
    console.log("Pipeline: DAILY → DIRECTION → MOMENTUM → MTF → RANK → OPTIONS");
    console.log("========================================\n");

    // ========================================================
    // STAGES 1–4 — SEQUENTIAL STOCK QUALIFICATION
    // ========================================================
    // scanStocks() deliberately scans one stock at a time and
    // returns only the strongest qualified shortlist.
    // No option contract/LTP is requested here.
    // ========================================================

    const qualifiedStocks = await scanStocks(symbols);

    console.log("\n========== STOCK QUALIFICATION ==========");
    console.log(`Qualified shortlist: ${qualifiedStocks.length}`);

    qualifiedStocks.forEach((stock, index) => {
        console.log(
            `${index + 1}. ${stock.stock} | ${stock.direction} | ` +
            `Score: ${stock.finalScore ?? stock.score ?? 0} | ` +
            `MTF: ${stock.mtfAlignment ?? 0} | ` +
            `Momentum: ${stock.pipeline?.momentumScore ?? 0}`
        );
    });

    // ========================================================
    // STAGE 5 — OPTIONS ONLY FOR QUALIFIED STOCKS
    // ========================================================

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
        const rankDiff = (decisionRank[b?.optionsDecision || b?.decision] || 0) -
            (decisionRank[a?.optionsDecision || a?.decision] || 0);
        if (rankDiff !== 0) return rankDiff;

        const confidenceDiff = Number(b?.optionsConfidence ?? b?.confidence ?? 0) -
            Number(a?.optionsConfidence ?? a?.confidence ?? 0);
        if (confidenceDiff !== 0) return confidenceDiff;

        return Number(b?.finalScore ?? b?.score ?? 0) -
            Number(a?.finalScore ?? a?.score ?? 0);
    });

    optionDecisions.forEach((option, index) => {
        const entry = Number(option?.entry ?? option?.optionEntry ?? 0);
        const stopLoss = Number(option?.stopLoss ?? option?.optionStopLoss ?? 0);
        const target1 = Number(option?.target1 ?? option?.optionTarget1 ?? 0);
        const target2 = Number(option?.target2 ?? option?.optionTarget2 ?? 0);
        const rr = Number(option?.riskReward ?? option?.optionRiskReward ?? 0);
        const confidence = option?.optionsConfidence ?? option?.confidence ?? 0;

        console.log(
            `${index + 1}. ${option?.stock || "N/A"} | ` +
            `${option?.optionType || "N/A"} | ` +
            `Strike: ${option?.recommendedStrike ?? "N/A"} | ` +
            `Entry: ${entry.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | ` +
            `T1: ${target1.toFixed(2)} | T2: ${target2.toFixed(2)} | ` +
            `R:R: ${rr.toFixed(2)} | Confidence: ${confidence} | ` +
            `${option?.optionsDecision || option?.decision || "N/A"}`
        );
    });

    // ========================================================
    // FINAL TOP 5
    // ========================================================

    const finalTop5 = optionDecisions.slice(0, 5);

    console.log("\n========== FINAL TOP 5 ==========");
    finalTop5.forEach((option, index) => {
        console.log(
            `${index + 1}. ${option?.stock || "N/A"} | ` +
            `${option?.optionType || "N/A"} | ` +
            `Strike: ${option?.recommendedStrike ?? "N/A"} | ` +
            `Confidence: ${option?.optionsConfidence ?? option?.confidence ?? 0} | ` +
            `${option?.optionsDecision || option?.decision || "N/A"}`
        );
    });

    // ========================================================
    // OUTPUTS
    // ========================================================

    try {
        if (typeof updateGoogleSheet === "function") {
            await updateGoogleSheet(finalTop5);
        }
    } catch (error) {
        console.error(`⚠️ Google Sheet update failed: ${error?.message || error}`);
    }

    try {
        if (typeof buildDashboard === "function") {
            await buildDashboard(finalTop5);
        }
    } catch (error) {
        console.error(`⚠️ Dashboard update failed: ${error?.message || error}`);
    }

    const elapsedSeconds = ((Date.now() - scanStartedAt.getTime()) / 1000).toFixed(1);

    console.log("\n========================================");
    console.log("       SCAN COMPLETE");
    console.log("========================================");
    console.log(`Universe: ${symbols.length}`);
    console.log(`Qualified stocks: ${qualifiedStocks.length}`);
    console.log(`Option decisions: ${optionDecisions.length}`);
    console.log(`Final TOP 5: ${finalTop5.length}`);
    console.log(`Elapsed: ${elapsedSeconds}s`);
    console.log("========================================\n");

    return {
        scanned: symbols.length,
        qualifiedStocks,
        optionDecisions,
        finalTop5,
        elapsedSeconds: Number(elapsedSeconds)
    };
}

main().catch(error => {
    console.error("\n❌ Scanner failed:");
    console.error(error?.message || error);
    process.exitCode = 1;
});
