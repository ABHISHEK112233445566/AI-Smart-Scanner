require("dotenv").config();

const symbolUniverses = require("./symbols");
const { setBroker, getActiveBroker } = require("./brokers");
const { loadSymbolMaster } = require("./services/symbolService");
const { scanStocks } = require("./scanner");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { updateGoogleSheet } = require("./googleSheet");
const { updateStrategySheets } = require("./strategySheets");
const { buildDashboard } = require("./dashboard");
const { createAccuracyRecord } = require("./accuracyTracker");

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeDecision(row) {
    return String(row?.optionsDecision ?? row?.decision ?? "").trim().toUpperCase();
}

function getStockKey(row) {
    return String(row?.stock ?? row?.symbol ?? row?.name ?? "").trim().toUpperCase();
}

function normalizeUniverseName(value) {
    return String(value || "ALL")
        .trim().toUpperCase().replace(/[\s-]+/g, "");
}

function getScannerSymbols() {
    const requested = normalizeUniverseName(process.env.SCANNER_UNIVERSE || "ALL");

    const aliases = {
        ALL: "ALL",
        ALLSYMBOLS: "ALL",
        NIFTY50: "NIFTY50",
        NIFTY100: "NIFTY100",
        BANKNIFTY: "BANKNIFTY",
        CUSTOM: "CUSTOM"
    };

    const universeName = aliases[requested] || "ALL";
    const selected = symbolUniverses[universeName];

    if (!Array.isArray(selected) || selected.length === 0) {
        throw new Error(`Scanner universe '${universeName}' is empty or unavailable.`);
    }

    const symbols = [...new Set(
        selected
            .map(symbol => String(symbol || "").trim().toUpperCase())
            .filter(Boolean)
    )];

    return { name: universeName, symbols };
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
        return { ...stock, ...option, stock: option.stock || stock.stock, symbol: option.symbol || stock.symbol || stock.stock };
    });
}

function buildAccuracyData(scannerData) {
    const timestamp = new Date();
    return (Array.isArray(scannerData) ? scannerData : [])
        .filter(row => getStockKey(row))
        .map(row => createAccuracyRecord(row, timestamp));
}

async function main() {
    const scanStartedAt = new Date();
    console.log("\n===============================\n   AI SMART SCANNER V4\n   SEQUENTIAL PIPELINE\n===============================\n");

    const brokerName = String(process.env.BROKER || "UPSTOX").trim().toUpperCase();
    setBroker(brokerName);
    const activeBroker = getActiveBroker();
    if (!activeBroker || typeof activeBroker.login !== "function") throw new Error("Active broker does not implement login()");
    console.log(`Broker Configuration: ${brokerName}`);
    console.log(`Active Broker: ${activeBroker?.name || brokerName}`);
    await activeBroker.login();
    console.log("✅ Broker Login Successful\n");

    try { await loadSymbolMaster(); console.log("✅ Symbol master loaded successfully.\n"); }
    catch (error) { console.log(`⚠️ Symbol master load skipped: ${error?.message || error}`); }

    const universe = getScannerSymbols();
    const symbols = universe.symbols;
    console.log("========================================");
    console.log(`        ${universe.name} SEQUENTIAL SCANNER`);
    console.log("========================================");
    console.log(`Total Stocks Loaded: ${symbols.length}`);
    console.log("Pipeline: DAILY → DIRECTION → MOMENTUM → MTF → RANK → OPTIONS");
    console.log("========================================\n");

    const qualifiedStocks = await scanStocks(symbols);
    if (!Array.isArray(qualifiedStocks)) throw new Error("Scanner returned an invalid shortlist");
    const allScannerResults = Array.isArray(qualifiedStocks.allResults) ? qualifiedStocks.allResults : qualifiedStocks;

    console.log("\n========== STOCK QUALIFICATION ==========");
    console.log(`Complete universe scanned: ${allScannerResults.length}`);
    console.log(`Qualified shortlist: ${qualifiedStocks.length}`);

    qualifiedStocks.forEach((stock, index) => console.log(`${index + 1}. ${stock.stock} | ${stock.direction} | Score: ${stock.finalScore ?? stock.score ?? 0} | MTF: ${stock.mtfAlignment ?? 0} | Momentum: ${stock.pipeline?.momentumScore ?? 0}`));

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
        const rankDiff = (decisionRank[normalizeDecision(b)] || 0) - (decisionRank[normalizeDecision(a)] || 0);
        if (rankDiff !== 0) return rankDiff;
        const confidenceDiff = safeNumber(b?.optionsConfidence ?? b?.confidence) - safeNumber(a?.optionsConfidence ?? a?.confidence);
        if (confidenceDiff !== 0) return confidenceDiff;
        return safeNumber(b?.finalScore ?? b?.score) - safeNumber(a?.finalScore ?? a?.score);
    });

    optionDecisions.forEach((option, index) => {
        const entry = safeNumber(option?.entry ?? option?.optionEntry);
        const stopLoss = safeNumber(option?.stopLoss ?? option?.optionStopLoss);
        const target1 = safeNumber(option?.target1 ?? option?.optionTarget1);
        const target2 = safeNumber(option?.target2 ?? option?.optionTarget2);
        const rr = safeNumber(option?.riskReward ?? option?.optionRiskReward);
        const confidence = option?.optionsConfidence ?? option?.confidence ?? 0;
        console.log(`${index + 1}. ${option?.stock || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Entry: ${entry.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | T1: ${target1.toFixed(2)} | T2: ${target2.toFixed(2)} | R:R: ${rr.toFixed(2)} | Confidence: ${confidence} | ${normalizeDecision(option) || "N/A"}`);
    });

    const completeScannerData = mergeScannerAndOptionData(allScannerResults, optionDecisions);
    const accuracyData = buildAccuracyData(completeScannerData);
    const finalTop5 = optionDecisions.slice(0, 5);

    console.log("\n========== FINAL TOP 5 ==========");
    finalTop5.forEach((option, index) => console.log(`${index + 1}. ${option?.stock || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Confidence: ${option?.optionsConfidence ?? option?.confidence ?? 0} | ${normalizeDecision(option) || "N/A"}`));

    try {
        await updateGoogleSheet({
            scannerData: completeScannerData,
            dashboardData: optionDecisions,
            accuracyData
        });
        console.log(`📈 Accuracy records prepared: ${accuracyData.length}`);
    } catch (error) {
        console.error(`⚠️ Google Sheet core update failed: ${error?.message || error}`);
    }

    try {
        const strategyResult = await updateStrategySheets(completeScannerData, optionDecisions);
        console.log(`📊 Strategy sheets updated | EQUITY: ${strategyResult.equityRows} | CALL: ${strategyResult.callRows} | PUT: ${strategyResult.putRows}`);
    } catch (error) {
        console.error(`⚠️ Strategy sheet update failed: ${error?.message || error}`);
    }

    try { if (typeof buildDashboard === "function") await buildDashboard(finalTop5); }
    catch (error) { console.error(`⚠️ Dashboard update failed: ${error?.message || error}`); }

    const elapsedSeconds = ((Date.now() - scanStartedAt.getTime()) / 1000).toFixed(1);
    console.log("\n========================================\n       SCAN COMPLETE\n========================================");
    console.log(`Universe: ${universe.name}`);
    console.log(`Universe size: ${symbols.length}`);
    console.log(`Complete scanner rows: ${completeScannerData.length}`);
    console.log(`Accuracy records: ${accuracyData.length}`);
    console.log(`Qualified stocks: ${qualifiedStocks.length}`);
    console.log(`Option decisions: ${optionDecisions.length}`);
    console.log(`Final TOP 5: ${finalTop5.length}`);
    console.log(`Elapsed: ${elapsedSeconds}s`);
    console.log("========================================\n");

    return { universe: universe.name, scanned: symbols.length, allScannerResults, qualifiedStocks, completeScannerData, accuracyData, optionDecisions, finalTop5, elapsedSeconds: Number(elapsedSeconds) };
}

main().catch(error => {
    console.error("\n❌ Scanner failed:");
    console.error(error?.message || error);
    process.exitCode = 1;
});
