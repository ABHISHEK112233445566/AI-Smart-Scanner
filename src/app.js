require("dotenv").config();

const symbolUniverses = require("./symbols");
const { setBroker, getActiveBroker } = require("./brokers");
const { loadSymbolMaster } = require("./services/symbolService");
const { scanStocks } = require("./scanner");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { updateGoogleSheet, buildScannerStatus } = require("./googleSheet");
const { updateStrategySheets } = require("./strategySheets");
const { buildDashboard } = require("./dashboard");
const { createAccuracyRecord } = require("./accuracyTracker");

const DASHBOARD_MIN_CONFIDENCE = 85;
const FINAL_TOP_COUNT = 5;
const SCANNER_TOP_COUNT = 50;
const OPTION_CANDIDATE_LIMIT = 20;
const RECOVERY_MIN_SCORE = 55;

function safeNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function normalizeDecision(row) { return String(row?.optionsDecision ?? row?.decision ?? "").trim().toUpperCase(); }
function getStockKey(row) { return String(row?.stock ?? row?.symbol ?? row?.name ?? "").trim().toUpperCase(); }
function normalizeUniverseName(value) { return String(value || "ALL").trim().toUpperCase().replace(/[\s-]+/g, ""); }
function getConfidence(row) { return safeNumber(row?.optionsConfidence ?? row?.optionConfidence ?? row?.confidence, 0); }
function getScannerScore(row) { return safeNumber(row?.rankingScore ?? row?.finalScore ?? row?.aiFinalScore ?? row?.scannerScore ?? row?.score, 0); }
function getScannerDirection(row) {
    const value = String(row?.stockDirection ?? row?.technicalDirection ?? row?.direction ?? "").trim().toUpperCase();
    if (value.includes("BULL") || value === "CALL" || value === "CE" || value === "BUY") return "BULLISH";
    if (value.includes("BEAR") || value === "PUT" || value === "PE" || value === "SELL") return "BEARISH";
    return "UNKNOWN";
}
function hasUsableStockSetup(row) {
    const entry = safeNumber(row?.entry ?? row?.stockEntry ?? row?.price);
    const stop = safeNumber(row?.stopLoss ?? row?.stockStopLoss);
    const target = safeNumber(row?.target1 ?? row?.stockTarget1);
    return entry > 0 && stop > 0 && target > 0;
}
function recoverOptionCandidates(allScannerResults) {
    return (Array.isArray(allScannerResults) ? allScannerResults : [])
        .filter(row => row && typeof row === "object" && getScannerDirection(row) !== "UNKNOWN" && getScannerScore(row) >= RECOVERY_MIN_SCORE && hasUsableStockSetup(row))
        .sort((a, b) => (getScannerScore(b) - getScannerScore(a)) || (safeNumber(b?.riskReward) - safeNumber(a?.riskReward)))
        .slice(0, OPTION_CANDIDATE_LIMIT);
}
function selectTopScannerRows(rows, limit = SCANNER_TOP_COUNT) {
    return (Array.isArray(rows) ? [...rows] : []).sort((a, b) => {
        const scoreDiff = getScannerScore(b) - getScannerScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        const confidenceDiff = getConfidence(b) - getConfidence(a);
        if (confidenceDiff !== 0) return confidenceDiff;
        return safeNumber(b?.riskReward) - safeNumber(a?.riskReward);
    }).slice(0, limit);
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
    return (Array.isArray(scannerData) ? scannerData : []).filter(row => getStockKey(row)).map(row => createAccuracyRecord(row, timestamp));
}
function sortOptionDecisions(decisions) {
    if (!Array.isArray(decisions)) return [];
    const rank = { TRADE: 3, WATCH: 2, REJECT: 1 };
    return [...decisions].sort((a, b) => {
        const decisionDifference = (rank[normalizeDecision(b)] || 0) - (rank[normalizeDecision(a)] || 0);
        if (decisionDifference !== 0) return decisionDifference;
        const confidenceDifference = getConfidence(b) - getConfidence(a);
        if (confidenceDifference !== 0) return confidenceDifference;
        return getScannerScore(b) - getScannerScore(a);
    });
}

// Dashboard must never promote a WATCH/REJECT merely because confidence is high.
// Only an explicit TRADE decision can enter the final TOP 5 dashboard.
function getFinalCandidates(optionDecisions) {
    return optionDecisions
        .filter(option => normalizeDecision(option) === "TRADE" && getConfidence(option) >= DASHBOARD_MIN_CONFIDENCE)
        .slice(0, FINAL_TOP_COUNT);
}

function getScannerSummary(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const reasons = {};
    for (const row of list) {
        if (row?.qualified === false) {
            const reason = String(row?.rejectionReason || "UNKNOWN").trim().toUpperCase();
            reasons[reason] = (reasons[reason] || 0) + 1;
        }
    }
    return reasons;
}

async function main() {
    const scanStartedAt = new Date();
    console.log("\n===============================\n   AI SMART SCANNER V6\n===============================\n");
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
    console.log(`        ${universe.name} SCANNER`);
    console.log("========================================");
    console.log(`Total Stocks Loaded: ${symbols.length}`);
    console.log("Pipeline: BROKER → INSTRUMENT → DAILY DATA → INDICATORS → AI → MARKET STRUCTURE → MTF → RANK → OPTIONS → SHEETS");
    console.log("========================================\n");

    const scanResult = await scanStocks(symbols);
    const scannerQualified = Array.isArray(scanResult) ? scanResult : [];
    const allScannerResults = Array.isArray(scanResult?.allResults) ? scanResult.allResults : scannerQualified;
    const rejectedResults = Array.isArray(scanResult?.rejected) ? scanResult.rejected : allScannerResults.filter(row => row?.qualified === false);
    const rejectionSummary = getScannerSummary(allScannerResults);
    console.log("\n========== STOCK QUALIFICATION ==========");
    console.log(`Complete universe scanned: ${allScannerResults.length}`);
    console.log(`Qualified shortlist: ${scannerQualified.length}`);
    const topScannerRows = selectTopScannerRows(allScannerResults, SCANNER_TOP_COUNT);
    console.log(`Top scanner rows for SCANNER sheet: ${topScannerRows.length}`);

    if (scannerQualified.length === 0) {
        console.log("⚠️ Scanner shortlist is empty. Starting candidate-recovery layer.");
        console.log(`Recovery rules: direction + validated ranking score >= ${RECOVERY_MIN_SCORE} + valid stock Entry/SL/T1, max ${OPTION_CANDIDATE_LIMIT}.`);
        console.log(`Rejection summary: ${JSON.stringify(rejectionSummary)}`);
    }

    const optionInputStocks = scannerQualified.length > 0 ? scannerQualified : recoverOptionCandidates(allScannerResults);
    console.log(`Options candidate input: ${optionInputStocks.length}`);
    console.log("\n========== OPTIONS DECISION ENGINE ==========");
    let optionDecisions = [];
    try {
        const decisions = await calculateOptionsDecisions(optionInputStocks);
        optionDecisions = Array.isArray(decisions) ? decisions : [];
    } catch (error) { console.error(`❌ Options Decision Engine failed: ${error?.message || error}`); }
    optionDecisions = sortOptionDecisions(optionDecisions);
    optionDecisions.forEach((option, index) => {
        const entry = safeNumber(option?.entry), stopLoss = safeNumber(option?.stopLoss), target1 = safeNumber(option?.target1), target2 = safeNumber(option?.target2), rr = safeNumber(option?.riskReward), confidence = getConfidence(option);
        console.log(`${index + 1}. ${option?.stock || option?.symbol || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Entry: ${entry.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | T1: ${target1.toFixed(2)} | T2: ${target2.toFixed(2)} | R:R: ${rr.toFixed(2)} | Confidence: ${confidence} | Scanner: ${getScannerScore(option)} | ${normalizeDecision(option) || "N/A"}`);
    });

    const scannerSheetData = mergeScannerAndOptionData(topScannerRows, optionDecisions);
    const completeScannerData = mergeScannerAndOptionData(allScannerResults, optionDecisions);
    const accuracyData = buildAccuracyData(completeScannerData);
    const finalTop5 = getFinalCandidates(optionDecisions);
    console.log("\n========== FINAL TOP 5 ==========");
    if (finalTop5.length === 0) console.log(`No TRADE candidates reached ${DASHBOARD_MIN_CONFIDENCE}+ confidence.`);
    finalTop5.forEach((option, index) => console.log(`${index + 1}. ${option?.stock || option?.symbol || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Confidence: ${getConfidence(option)} | ${normalizeDecision(option) || "N/A"}`));

    let coreSheetUpdated = false;
    try {
        await updateGoogleSheet({ scannerData: scannerSheetData, dashboardData: finalTop5, accuracyData });
        coreSheetUpdated = true;
        console.log(`📈 Accuracy records prepared: ${accuracyData.length}`);
        console.log(`📋 SCANNER sheet rows prepared: ${scannerSheetData.length}`);
        console.log(`📊 Dashboard rows prepared: ${finalTop5.length}`);
    } catch (error) { console.error(`⚠️ Google Sheet core update failed: ${error?.message || error}`); }

    let strategySheetUpdated = false;
    try {
        const strategyResult = await updateStrategySheets(completeScannerData, optionDecisions);
        strategySheetUpdated = true;
        console.log(`📊 Strategy sheets updated | EQUITY: ${strategyResult?.equityRows ?? 0} | CALL: ${strategyResult?.callRows ?? 0} | PUT: ${strategyResult?.putRows ?? 0}`);
    } catch (error) { console.error(`⚠️ Strategy sheet update failed: ${error?.message || error}`); }

    let dashboardData = null;
    try {
        if (typeof buildDashboard === "function") {
            dashboardData = await buildDashboard(allScannerResults, optionDecisions, symbols.length);
            console.log(`📊 Dashboard prepared: ${dashboardData?.top10Count ?? 0} candidates`);
        }
    } catch (error) { console.error(`⚠️ Dashboard update failed: ${error?.message || error}`); }

    const elapsedSeconds = ((Date.now() - scanStartedAt.getTime()) / 1000).toFixed(1);
    const callCandidates = optionDecisions.filter(x => String(x?.optionType || "").toUpperCase() === "CALL").length;
    const putCandidates = optionDecisions.filter(x => String(x?.optionType || "").toUpperCase() === "PUT").length;
    const tradeCount = optionDecisions.filter(x => normalizeDecision(x) === "TRADE").length;
    const watchCount = optionDecisions.filter(x => normalizeDecision(x) === "WATCH").length;
    const rejectCount = optionDecisions.filter(x => normalizeDecision(x) === "REJECT").length;
    const successfulScans = Math.max(0, allScannerResults.length - rejectedResults.filter(x => String(x?.rejectionReason || "").toUpperCase() === "ERROR").length);
    const failedScans = Math.max(0, allScannerResults.length - successfulScans);
    const scannerStatus = buildScannerStatus({ status: coreSheetUpdated && strategySheetUpdated ? "SUCCESS" : "PARTIAL_FAILURE", startedAt: scanStartedAt, universe: universe.name, broker: brokerName, scanned: allScannerResults.length, successfulScans, failedScans, callCandidates, putCandidates, tradeCount, watchCount, rejectCount, elapsedSeconds });
    try {
        await updateGoogleSheet({ action: "scanner_status", scannerStatus, scannerData: scannerSheetData, dashboardData: finalTop5, accuracyData });
        console.log(`🟢 Scanner Status: ${scannerStatus.status} | Last Scan: ${scannerStatus.lastScanTimeIST} IST | Source: ${scannerStatus.lastScanSource}`);
    } catch (error) { console.error(`⚠️ Scanner status update failed: ${error?.message || error}`); }

    console.log("\n========================================\n       SCAN COMPLETE\n========================================");
    console.log(`Universe: ${universe.name}`);
    console.log(`Universe size: ${symbols.length}`);
    console.log(`Complete scanner rows: ${completeScannerData.length}`);
    console.log(`SCANNER top rows: ${scannerSheetData.length}`);
    console.log(`Accuracy records: ${accuracyData.length}`);
    console.log(`Scanner qualified: ${scannerQualified.length}`);
    console.log(`Options candidate input: ${optionInputStocks.length}`);
    console.log(`Option decisions: ${optionDecisions.length}`);
    console.log(`TRADE decisions: ${tradeCount}`);
    console.log(`Confidence ${DASHBOARD_MIN_CONFIDENCE}+ TRADE: ${finalTop5.length}`);
    console.log(`Elapsed: ${elapsedSeconds}s`);
    console.log(`Scanner Status: ${scannerStatus.status}`);
    console.log("========================================\n");
    if (scannerStatus.status !== "SUCCESS") throw new Error("Scanner completed with partial Google Sheets update failure");
    return { universe: universe.name, scanned: symbols.length, allScannerResults, scannerSheetData, qualifiedStocks: scannerQualified, optionInputStocks, completeScannerData, accuracyData, optionDecisions, finalTop5, dashboardData, scannerStatus, rejectionSummary, elapsedSeconds: Number(elapsedSeconds) };
}

function getScannerSymbols() {
    const requested = normalizeUniverseName(process.env.SCANNER_UNIVERSE || "ALL");
    const aliases = { ALL: "ALL", ALLSYMBOLS: "ALL", NIFTY50: "NIFTY50", NIFTY100: "NIFTY100", BANKNIFTY: "BANKNIFTY", CUSTOM: "CUSTOM" };
    const universeName = aliases[requested] || "ALL";
    const selected = symbolUniverses[universeName];
    if (!Array.isArray(selected) || selected.length === 0) throw new Error(`Scanner universe '${universeName}' is empty or unavailable.`);
    const symbols = [...new Set(selected.map(symbol => String(symbol || "").trim().toUpperCase()).filter(Boolean))];
    return { name: universeName, symbols };
}

main().catch(error => { console.error("\n❌ Scanner failed:"); console.error(error?.message || error); process.exitCode = 1; });
