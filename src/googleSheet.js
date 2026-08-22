// ============================================================
// GOOGLE SHEET UPLOADER — V4 STRATEGY + ACCURACY
// ============================================================

const axios = require("axios");
const config = require("./config");
const { createPrediction, predictionToRow, ACCURACY_HEADERS } = require("./accuracyTracker");
const { updateAccuracyRecord } = require("./accuracyUpdater");

const DASHBOARD_MIN_SCORE = 90;
const DASHBOARD_MAX_ROWS = 10;
const GOOGLE_TIMEOUT = 30000;

function getGoogleSheetUrl() {
    return process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.GOOGLE_SCRIPT_URL || process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_SHEET_URL || process.env.GOOGLE_APPS_SCRIPT_URL || config.GOOGLE_SHEET_WEBHOOK_URL || config.GOOGLE_SCRIPT_URL || config.GOOGLE_SHEETS_WEBHOOK_URL || config.GOOGLE_SHEET_URL || config.GOOGLE_APPS_SCRIPT_URL || null;
}

const SCANNER_COLUMNS = [
    "scanId", "timestamp", "assetType", "stock", "symbol", "price", "direction", "stockDirection", "technicalDirection", "signal", "bullishScore", "bearishScore", "aiFinalScore", "entry", "stopLoss", "target1", "target2", "riskReward", "trend", "confidence", "support1", "support2", "support3", "resistance1", "resistance2", "resistance3", "breakout", "breakoutType", "breakoutStrength", "breakoutScore", "aboveResistance", "belowSupport", "nearResistance", "nearSupport", "volumeConfirmed", "trendConfirmed", "momentumConfirmed", "dailyTrend", "fourHourTrend", "oneHourTrend", "fifteenMinTrend", "mtfScore", "mtfAlignment", "mtfAlignedTimeframes", "pivot", "pivotR1", "pivotR2", "pivotR3", "pivotS1", "pivotS2", "pivotS3", "cprTop", "cprBottom", "cprWidth", "cprType", "ema5", "ema9", "ema20", "ema50", "ema100", "ema200", "rsi", "macd", "macdSignal", "histogram", "adx", "pdi", "mdi", "atr", "bollingerUpper", "bollingerMiddle", "bollingerLower", "volume", "volumeSMA20", "rvol", "volumeSpike", "obv", "mfi", "supertrend", "vwap", "marketRegime", "marketRegimeScore"
];

const STRATEGY_COLUMNS = ["predictionId", "timestamp", "assetType", "stock", "symbol", "direction", "price", "entry", "stopLoss", "target1", "target2", "riskReward", "strike", "optionType", "optionLTP", "confidence", "decision", "marketRegime", "scannerScore", "sourceBroker"];

function value(row, key, fallback = "") { return row && typeof row === "object" ? (row[key] ?? fallback) : fallback; }
function makeRow(item, columns) { return columns.map(key => value(item, key)); }

async function writeSheet(sheet, headers, rows, action = "replaceSheet") {
    const url = getGoogleSheetUrl();
    if (!url) throw new Error("Google Sheet webhook URL is not configured");
    const response = await axios.post(url, { action, sheet, headers, rows }, { timeout: GOOGLE_TIMEOUT });
    if (!response.data || response.data.success !== true) throw new Error(`Google Sheet rejected ${sheet}: ${JSON.stringify(response.data)}`);
    return response.data;
}

async function updateAccuracySheet(updates) {
    if (!Array.isArray(updates) || !updates.length) return null;
    const url = getGoogleSheetUrl();
    if (!url) throw new Error("Google Sheet webhook URL is not configured");
    const response = await axios.post(url, { action: "updateAccuracy", sheet: "ACCURACY", updates }, { timeout: GOOGLE_TIMEOUT });
    if (!response.data || response.data.success !== true) throw new Error(`Google Sheet rejected ACCURACY update: ${JSON.stringify(response.data)}`);
    return response.data;
}

function normalizeOptionType(item) { return String(item?.optionType ?? item?.type ?? "").trim().toUpperCase(); }

function buildAccuracyUpdates(optionDecisions) {
    return optionDecisions.map(item => {
        const record = createPrediction(item);
        const price = Number(item?.price ?? item?.stockPrice ?? item?.optionLTP ?? 0);
        const market = Number.isFinite(price) && price > 0 ? { high: price, low: price, last: price, time: new Date().toISOString() } : {};
        return updateAccuracyRecord(record, market);
    }).filter(record => record && record.predictionId);
}

function buildAccuracyRows(optionDecisions) {
    return optionDecisions.map(item => predictionToRow(createPrediction(item)));
}

async function updateGoogleSheet(optionDecisions = [], scannerData = []) {
    const allScannerRows = Array.isArray(scannerData) && scannerData.length ? scannerData : optionDecisions;
    const scannerRows = allScannerRows.map(item => makeRow({ ...item, scanId: value(item, "scanId", `${Date.now()}_${value(item, "stock", value(item, "symbol", "UNKNOWN"))}`), timestamp: value(item, "timestamp", new Date().toISOString()), assetType: value(item, "assetType", "STOCK") }, SCANNER_COLUMNS));

    const calls = optionDecisions.filter(item => normalizeOptionType(item) === "CALL");
    const puts = optionDecisions.filter(item => normalizeOptionType(item) === "PUT");
    const equities = optionDecisions.filter(item => !["CALL", "PUT"].includes(normalizeOptionType(item)));
    const strategyRows = items => items.map(item => makeRow({ ...item, predictionId: value(item, "predictionId", createPrediction(item).predictionId), timestamp: value(item, "timestamp", new Date().toISOString()), assetType: value(item, "assetType", "OPTION") }, STRATEGY_COLUMNS));

    const results = [];
    results.push(await writeSheet("SCANNER", SCANNER_COLUMNS, scannerRows, "replaceSheet"));
    results.push(await writeSheet("EQUITY", STRATEGY_COLUMNS, strategyRows(equities), "replaceSheet"));
    results.push(await writeSheet("CALL_OPTIONS", STRATEGY_COLUMNS, strategyRows(calls), "replaceSheet"));
    results.push(await writeSheet("PUT_OPTIONS", STRATEGY_COLUMNS, strategyRows(puts), "replaceSheet"));

    const accuracyUpdates = buildAccuracyUpdates(optionDecisions);
    if (accuracyUpdates.length) {
        const updateResult = await updateAccuracySheet(accuracyUpdates);
        results.push(updateResult);
        if (Number(updateResult?.notFound || 0) > 0) {
            const missingIds = new Set(accuracyUpdates.map(record => record.predictionId));
            const newRows = optionDecisions.filter(item => missingIds.has(createPrediction(item).predictionId)).map(item => predictionToRow(createPrediction(item)));
            if (newRows.length) results.push(await writeSheet("ACCURACY", ACCURACY_HEADERS, newRows, "appendRows"));
        }
    }

    const dashboardRows = optionDecisions.filter(item => Number(value(item, "optionsConfidence", value(item, "confidence", 0))) >= DASHBOARD_MIN_SCORE).slice(0, DASHBOARD_MAX_ROWS);
    if (dashboardRows.length) results.push(await writeSheet("Dashboard", STRATEGY_COLUMNS, dashboardRows.map(item => makeRow(item, STRATEGY_COLUMNS)), "replaceSheet"));
    return results;
}

module.exports = { updateGoogleSheet, writeSheet, updateAccuracySheet, SCANNER_COLUMNS, STRATEGY_COLUMNS, ACCURACY_HEADERS };