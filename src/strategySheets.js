const axios = require("axios");
const config = require("./config");

// ============================================================
// V4 STRATEGY SHEETS
// ============================================================
// EQUITY       -> qualified stock setups / audit (max 20)
// CALL_OPTIONS -> CALL option candidates
// PUT_OPTIONS  -> PUT option candidates
// SCANNER and ACCURACY are handled by googleSheet.js.
// ============================================================

// Google Apps Script can take longer while writing/formatting large sheets.
// 90 seconds prevents the previous 30-second client timeout.
const TIMEOUT = 90000;
const EQUITY_MAX_ROWS = 20;

const EQUITY_COLUMNS = [
    "rank", "stock", "symbol", "price", "direction", "signal",
    "entry", "stopLoss", "target1", "target2", "riskReward",
    "trend", "confidence", "dailyTrend", "fourHourTrend",
    "oneHourTrend", "fifteenMinTrend", "mtfScore", "mtfAlignment",
    "breakout", "volumeConfirmed", "support1", "resistance1",
    "oiMood", "oiSentiment", "callOI", "putOI", "pcr", "timestamp"
];

const OPTION_COLUMNS = [
    "rank", "stock", "symbol", "optionType", "optionSymbol",
    "optionExpiry", "recommendedStrike", "optionStrike", "price",
    "entry", "stopLoss", "target1", "target2", "riskReward",
    "optionsDecision", "optionsRating", "optionsConfidence",
    "optionsReason", "tradeGates", "failedGates", "failedGateCount",
    "contractAvailable", "optionPriceAvailable", "optionSetupAvailable",
    "dailyTrend", "fourHourTrend", "oneHourTrend", "fifteenMinTrend",
    "mtfScore", "mtfAlignment", "breakout", "oiMood", "oiSentiment",
    "callOI", "putOI", "pcr", "timestamp"
];

function getWebhookUrl() {
    return (
        process.env.GOOGLE_SHEET_WEBHOOK_URL ||
        process.env.GOOGLE_SCRIPT_URL ||
        process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
        process.env.GOOGLE_SHEET_URL ||
        process.env.GOOGLE_APPS_SCRIPT_URL ||
        config.GOOGLE_SHEET_WEBHOOK_URL ||
        config.GOOGLE_SCRIPT_URL ||
        config.GOOGLE_SHEETS_WEBHOOK_URL ||
        config.GOOGLE_SHEET_URL ||
        config.GOOGLE_APPS_SCRIPT_URL ||
        null
    );
}

function clean(value) {
    if (value === undefined || value === null) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return value;
}

function value(row, key, aliases = []) {
    if (!row || typeof row !== "object") return "";
    for (const k of [key, ...aliases]) {
        if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    }
    return "";
}

function getStockKey(row) {
    return String(value(row, "stock", ["symbol", "name"]))
        .trim()
        .toUpperCase();
}

function normalizeType(row) {
    const raw = String(value(row, "optionType", ["optionsType", "type", "instrument_type"]))
        .trim().toUpperCase();
    if (raw === "CALL" || raw === "CE") return "CALL";
    if (raw === "PUT" || raw === "PE") return "PUT";
    return "";
}

function decisionRank(row) {
    const d = String(value(row, "optionsDecision", ["decision"])).trim().toUpperCase();
    return ({ TRADE: 3, WATCH: 2, REJECT: 1 }[d] || 0);
}

function confidence(row) {
    const n = Number(value(row, "optionsConfidence", ["confidence"]));
    return Number.isFinite(n) ? n : 0;
}

function scannerScore(row) {
    const n = Number(value(row, "rankingScore", ["finalScore", "aiFinalScore", "score"]));
    return Number.isFinite(n) ? n : 0;
}

function sortCandidates(rows) {
    return [...rows].sort((a, b) => {
        const d = decisionRank(b) - decisionRank(a);
        if (d) return d;
        const c = confidence(b) - confidence(a);
        if (c) return c;
        return scannerScore(b) - scannerScore(a);
    });
}

function buildRows(rows, columns) {
    return sortCandidates(rows).map((row, index) =>
        columns.map(column => clean(
            column === "rank" ? index + 1 : value(row, column)
        ))
    );
}

async function post(sheet, headers, rows) {
    const url = getWebhookUrl();
    if (!url) throw new Error("Google Sheet webhook URL is missing.");

    const response = await axios.post(url, {
        action: "replaceSheet",
        sheet,
        clearFirst: true,
        headers,
        rows,
        timestamp: new Date().toISOString()
    }, {
        timeout: TIMEOUT,
        headers: { "Content-Type": "application/json" }
    });

    if (response?.data?.success === false) {
        throw new Error(
            `Google Sheets rejected ${sheet}: ${response.data.error || "unknown error"}`
        );
    }

    return response.data;
}

async function updateStrategySheets(scannerData, optionDecisions) {
    const scannerRows = Array.isArray(scannerData) ? scannerData : [];
    const options = Array.isArray(optionDecisions) ? optionDecisions : [];

    // EQUITY uses the same qualified stock set that feeds option decisions,
    // not the complete accuracy dataset.
    const qualifiedKeys = new Set(
        options.map(getStockKey).filter(Boolean)
    );

    const qualifiedEquityRows = scannerRows
        .filter(row => qualifiedKeys.has(getStockKey(row)))
        .slice(0, EQUITY_MAX_ROWS);

    const equityRows = buildRows(qualifiedEquityRows, EQUITY_COLUMNS);
    const callRows = buildRows(options.filter(row => normalizeType(row) === "CALL"), OPTION_COLUMNS);
    const putRows = buildRows(options.filter(row => normalizeType(row) === "PUT"), OPTION_COLUMNS);

    // Apps Script uses a script lock in doPost(). Keep these requests
    // sequential so they do not contend for the same lock.
    const equity = await post("EQUITY", EQUITY_COLUMNS, equityRows);
    const callOptions = await post("CALL_OPTIONS", OPTION_COLUMNS, callRows);
    const putOptions = await post("PUT_OPTIONS", OPTION_COLUMNS, putRows);

    return {
        success: true,
        equityRows: equityRows.length,
        callRows: callRows.length,
        putRows: putRows.length,
        equity,
        callOptions,
        putOptions
    };
}

module.exports = {
    EQUITY_COLUMNS,
    OPTION_COLUMNS,
    updateStrategySheets
};
