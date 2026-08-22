require("dotenv").config();

const symbols = require("./symbols/nifty100");
const { setBroker, getActiveBroker } = require("./brokers");
const { loadSymbolMaster } = require("./services/symbolService");
const { scanStocks } = require("./scanner");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { updateGoogleSheet } = require("./googleSheet");
const { buildDashboard } = require("./dashboard");

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeDecision(row) {
    return String(
        row?.optionsDecision ?? row?.decision ?? ""
    ).trim().toUpperCase();
}

function getStockKey(row) {
    return String(
        row?.stock ?? row?.symbol ?? row?.name ?? ""
    ).trim().toUpperCase();
}

function mergeScannerAndOptionData(stocks, decisions) {
    const optionMap = new Map();

    for (const decision of Array.isArray(decisions) ? decisions : []) {
        const key = getStockKey(decision);
        if (key) optionMap.set(key, decision);
    }

    return (Array.isArray(stocks) ? stocks : []).map(stock => {
        const option = optionMap.get(getStockKey(stock));
        if (!option) return stock;

        // Preserve every scanner field while allowing the option engine
        // to add its final decision/contract/gate information.
        return {
            ...stock,
            ...option,
            stock: option.stock || stock.stock,
            symbol: option.symbol || stock.symbol || stock.stock
        };
    });
}

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

    // Stage 1–4: stock qualification. The scanner deliberately does not
    // request option contracts/LTP for the full universe.
    const qualifiedStocks = await scanStocks(symbols);

    if (!Array.isArray(qualifiedStocks)) {
        throw new Error("Scanner returned an invalid shortlist");
    }

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

    // Stage 5: options only for qualified stocks.
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
        const rankDiff =
            (decisionRank[normalizeDecision(b)] || 0) -
            (decisionRank[normalizeDecision(a)] || 0);
        if (rankDiff !== 0) return rankDiff;

        const confidenceDiff =
            safeNumber(b?.optionsConfidence ?? b?.confidence) -
            safeNumber(a?.optionsConfidence ?? a?.confidence);
        if (confidenceDiff !== 0) return confidenceDiff;

        return (
            safeNumber(b?.finalScore ?? b?.score) -
            safeNumber(a?.finalScore ?? a?.score)
        );
    });

    optionDecisions.forEach((option, index) => {
        const entry = safeNumber(option?.entry ?? option?.optionEntry);
        const stopLoss = safeNumber(option?.stopLoss ?? option?.optionStopLoss);
        const target1 = safeNumber(option?.target1 ?? option?.optionTarget1);
        const target2 = safeNumber(option?.target2 ?? option?.optionTarget2);
        const rr = safeNumber(option?.riskReward ?? option?.optionRiskReward);
        const confidence = option?.optionsConfidence ?? option?.confidence ?? 0;

        console.log(
            `${index + 1}. ${option?.stock || "N/A"} | ` +
            `${option?.optionType || "N/A"} | ` +
            `Strike: ${option?.recommendedStrike ?? "N/A"} | ` +
            `Entry: ${entry.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | ` +
            `T1: ${target1.toFixed(2)} | T2: ${target2.toFixed(2)} | ` +
            `R:R: ${rr.toFixed(2)} | Confidence: ${confidence} | ` +
            `${normalizeDecision(option) || "N/A"}`
        );
    });

    // Merge the stock scanner fields back into option decisions. This is
    // important because SCANNER must remain the complete audit list rather
    // than only the final TOP 5 dashboard view.
    const completeScannerData = mergeScannerAndOptionData(
        qualifiedStocks,
        optionDecisions
    );

    // Final dashboard selection is intentionally separate from the complete
    // scanner dataset.
    const finalTop5 = optionDecisions.slice(0, 5);

    console.log("\n========== FINAL TOP 5 ==========");
    finalTop5.forEach((option, index) => {
        console.log(
            `${index + 1}. ${option?.stock || "N/A"} | ` +
            `${option?.optionType || "N/A"} | ` +
            `Strike: ${option?.recommendedStrike ?? "N/A"} | ` +
            `Confidence: ${option?.optionsConfidence ?? option?.confidence ?? 0} | ` +
            `${normalizeDecision(option) || "N/A"}`
        );
    });

    // Outputs:
    // - SCANNER receives the complete qualified scanner dataset.
    // - Dashboard receives the final ranked candidates and applies its own
    //   confidence/decision gate.
    // - Accuracy and parameter sheets use the same complete scanner dataset.
    try {
        if (typeof updateGoogleSheet === "function") {
            await updateGoogleSheet({
                scannerData: completeScannerData,
                dashboardData: optionDecisions,
                accuracyData: completeScannerData
            });
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

    const elapsedSeconds =
        ((Date.now() - scanStartedAt.getTime()) / 1000).toFixed(1);

    console.log("\n========================================");
    console.log("       SCAN COMPLETE");
    console.log("========================================");
    console.log(`Universe: ${symbols.length}`);
    console.log(`Qualified stocks: ${qualifiedStocks.length}`);
    console.log(`Option decisions: ${optionDecisions.length}`);
    console.log(`Complete scanner rows: ${completeScannerData.length}`);
    console.log(`Final TOP 5: ${finalTop5.length}`);
    console.log(`Elapsed: ${elapsedSeconds}s`);
    console.log("========================================\n");

    return {
        scanned: symbols.length,
        qualifiedStocks,
        completeScannerData,
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
