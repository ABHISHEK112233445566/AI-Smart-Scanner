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
const OPTION_CANDIDATE_LIMIT = 20;
const RECOVERY_MIN_SCORE = 55;

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
    return String(value || "ALL").trim().toUpperCase().replace(/[\s-]+/g, "");
}

function getConfidence(row) {
    return safeNumber(row?.optionsConfidence ?? row?.optionConfidence ?? row?.confidence, 0);
}

function getScannerScore(row) {
    return safeNumber(row?.finalScore ?? row?.aiFinalScore ?? row?.scannerScore ?? row?.score, 0);
}

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
    const candidates = (Array.isArray(allScannerResults) ? allScannerResults : [])
        .filter(row => {
            if (!row || typeof row !== "object") return false;
            if (getScannerDirection(row) === "UNKNOWN") return false;
            if (getScannerScore(row) < RECOVERY_MIN_SCORE) return false;
            if (!hasUsableStockSetup(row)) return false;
            return true;
        })
        .sort((a, b) => {
            const scoreDiff = getScannerScore(b) - getScannerScore(a);
            if (scoreDiff !== 0) return scoreDiff;
            return safeNumber(b?.riskReward) - safeNumber(a?.riskReward);
        })
        .slice(0, OPTION_CANDIDATE_LIMIT);

    return candidates;
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
        return {
            ...stock,
            ...option,
            stock: option.stock || stock.stock,
            symbol: option.symbol || stock.symbol || stock.stock
        };
    });
}

function buildAccuracyData(scannerData) {
    const timestamp = new Date();
    return (Array.isArray(scannerData) ? scannerData : [])
        .filter(row => getStockKey(row))
        .map(row => createAccuracyRecord(row, timestamp));
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

function getFinalCandidates(optionDecisions) {
    return optionDecisions
        .filter(option => getConfidence(option) >= DASHBOARD_MIN_CONFIDENCE)
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

    try {
        await loadSymbolMaster();
        console.log("✅ Symbol master loaded successfully.\n");
    } catch (error) {
        console.log(`⚠️ Symbol master load skipped: ${error?.message || error}`);
    }

    const universe = getScannerSymbols();
    const symbols = universe.symbols;

    console.log("========================================");
    console.log(`        ${universe.name} SCANNER`);
    console.log("========================================");
    console.log(`Total Stocks Loaded: ${symbols.length}`);
    console.log("Pipeline: DAILY → DIRECTION → MOMENTUM → MTF → RANK → OPTIONS");
    console.log("========================================\n");

    const scanResult = await scanStocks(symbols);
    const scannerQualified = Array.isArray(scanResult) ? scanResult : [];
    const allScannerResults = Array.isArray(scanResult?.allResults) ? scanResult.allResults : scannerQualified;
    const rejectedResults = Array.isArray(scanResult?.rejected) ? scanResult.rejected : allScannerResults.filter(row => row?.qualified === false);

    const rejectionSummary = getScannerSummary(allScannerResults);

    console.log("\n========== STOCK QUALIFICATION ==========");
    console.log(`Complete universe scanned: ${allScannerResults.length}`);
    console.log(`Qualified shortlist: ${scannerQualified.length}`);

    if (scannerQualified.length === 0) {
        console.log("⚠️ Scanner shortlist is empty. Starting candidate-recovery layer.");
        console.log(`Recovery rules: direction + score >= ${RECOVERY_MIN_SCORE} + valid stock Entry/SL/T1, max ${OPTION_CANDIDATE_LIMIT}.`);
        console.log(`Rejection summary: ${JSON.stringify(rejectionSummary)}`);
    }

    const optionInputStocks = scannerQualified.length > 0
        ? scannerQualified
        : recoverOptionCandidates(allScannerResults);

    console.log(`Options candidate input: ${optionInputStocks.length}`);

    console.log("\n========== OPTIONS DECISION ENGINE ==========");
    let optionDecisions = [];

    try {
        const decisions = await calculateOptionsDecisions(optionInputStocks);
        optionDecisions = Array.isArray(decisions) ? decisions : [];
    } catch (error) {
        console.error(`❌ Options Decision Engine failed: ${error?.message || error}`);
    }

    optionDecisions = sortOptionDecisions(optionDecisions);

    optionDecisions.forEach((option, index) => {
        const entry = safeNumber(option?.entry);
        const stopLoss = safeNumber(option?.stopLoss);
        const target1 = safeNumber(option?.target1);
        const target2 = safeNumber(option?.target2);
        const rr = safeNumber(option?.riskReward);
        const confidence = getConfidence(option);
        console.log(`${index + 1}. ${option?.stock || option?.symbol || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Entry: ${entry.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | T1: ${target1.toFixed(2)} | T2: ${target2.toFixed(2)} | R:R: ${rr.toFixed(2)} | Confidence: ${confidence} | ${normalizeDecision(option) || "N/A"}`);
    });

    const completeScannerData = mergeScannerAndOptionData(allScannerResults, optionDecisions);
    const accuracyData = buildAccuracyData(completeScannerData);
    const finalTop5 = getFinalCandidates(optionDecisions);

    console.log("\n========== FINAL TOP 5 ==========");
    if (finalTop5.length === 0) console.log(`No candidates reached ${DASHBOARD_MIN_CONFIDENCE}+ confidence.`);
    finalTop5.forEach((option, index) => {
        console.log(`${index + 1}. ${option?.stock || option?.symbol || "N/A"} | ${option?.optionType || "N/A"} | Strike: ${option?.recommendedStrike ?? "N/A"} | Confidence: ${getConfidence(option)} | ${normalizeDecision(option) || "N/A"}`);
    });

    // Core Google update. A successful HTTP response is required before the
    // scan is reported as SUCCESS to the dashboard/status payload.
    let coreSheetUpdated = false;
    try {
        await updateGoogleSheet({ scannerData: completeScannerData, dashboardData: optionDecisions, accuracyData });
        coreSheetUpdated = true;
        console.log(`📈 Accuracy records prepared: ${accuracyData.length}`);
    } catch (error) {
        console.error(`⚠️ Google Sheet core update failed: ${error?.message || error}`);
    }

    let strategySheetUpdated = false;
    try {
        const strategyResult = await updateStrategySheets(completeScannerData, optionDecisions);
        strategySheetUpdated = true;
        console.log(`📊 Strategy sheets updated | EQUITY: ${strategyResult?.equityRows ?? 0} | CALL: ${strategyResult?.callRows ?? 0} | PUT: ${strategyResult?.putRows ?? 0}`);
    } catch (error) {
        console.error(`⚠️ Strategy sheet update failed: ${error?.message || error}`);
    }

    let dashboardData = null;
    try {
        if (typeof buildDashboard === "function") {
            dashboardData = await buildDashboard(allScannerResults, optionDecisions, symbols.length);
            console.log(`📊 Dashboard prepared: ${dashboardData?.top10Count ?? 0} candidates`);
        }
    } catch (error) {
        console.error(`⚠️ Dashboard update failed: ${error?.message || error}`);
    }

    const elapsedSeconds = ((Date.now() - scanStartedAt.getTime()) / 1000).toFixed(1);
    const callCandidates = optionDecisions.filter(x => String(x?.optionType || "").toUpperCase() === "CALL").length;
    const putCandidates = optionDecisions.filter(x => String(x?.optionType || "").toUpperCase() === "PUT").length;
    const tradeCount = optionDecisions.filter(x => normalizeDecision(x) === "TRADE").length;
    const watchCount = optionDecisions.filter(x => normalizeDecision(x) === "WATCH").length;
    const rejectCount = optionDecisions.filter(x => normalizeDecision(x) === "REJECT").length;
    const successfulScans = Math.max(0, allScannerResults.length - rejectedResults.filter(x => String(x?.rejectionReason || "").toUpperCase() === "ERROR").length);
    const failedScans = Math.max(0, allScannerResults.length - successfulScans);

    // Status is written LAST. It is SUCCESS only when the core sheet update
    // and strategy sheet update both completed successfully.
    const scannerStatus = buildScannerStatus({
        status: coreSheetUpdated && strategySheetUpdated ? "SUCCESS" : "PARTIAL_FAILURE",
        startedAt: scanStartedAt,
        universe: universe.name,
        broker: brokerName,
        scanned: allScannerResults.length,
        successfulScans,
        failedScans,
        callCandidates,
        putCandidates,
        tradeCount,
        watchCount,
        rejectCount,
        elapsedSeconds
    });

    try {
        await updateGoogleSheet({
            action: "scanner_status",
            scannerStatus,
            scannerData: completeScannerData,
            dashboardData: optionDecisions,
            accuracyData
        });
        console.log(`🟢 Scanner Status: ${scannerStatus.status} | Last Scan: ${scannerStatus.lastScanTimeIST} IST | Source: ${scannerStatus.lastScanSource}`);
    } catch (error) {
        console.error(`⚠️ Scanner status update failed: ${error?.message || error}`);
    }

    console.log("\n========================================\n       SCAN COMPLETE\n========================================");
    console.log(`Universe: ${universe.name}`);
    console.log(`Universe size: ${symbols.length}`);
    console.log(`Complete scanner rows: ${completeScannerData.length}`);
    console.log(`Accuracy records: ${accuracyData.length}`);
    console.log(`Scanner qualified: ${scannerQualified.length}`);
    console.log(`Options candidate input: ${optionInputStocks.length}`);
    console.log(`Option decisions: ${optionDecisions.length}`);
    console.log(`Confidence ${DASHBOARD_MIN_CONFIDENCE}+: ${optionDecisions.filter(option => getConfidence(option) >= DASHBOARD_MIN_CONFIDENCE).length}`);
    console.log(`Final TOP ${FINAL_TOP_COUNT}: ${finalTop5.length}`);
    console.log(`Elapsed: ${elapsedSeconds}s`);
    console.log(`Scanner Status: ${scannerStatus.status}`);
    console.log("========================================\n");

    if (scannerStatus.status !== "SUCCESS") {
        throw new Error("Scanner completed with partial Google Sheets update failure");
    }

    return {
        universe: universe.name,
        scanned: symbols.length,
        allScannerResults,
        qualifiedStocks: scannerQualified,
        optionInputStocks,
        completeScannerData,
        accuracyData,
        optionDecisions,
        finalTop5,
        dashboardData,
        scannerStatus,
        rejectionSummary,
        elapsedSeconds: Number(elapsedSeconds)
    };
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

main().catch(error => {
    console.error("\n❌ Scanner failed:");
    console.error(error?.message || error);
    process.exitCode = 1;
});
