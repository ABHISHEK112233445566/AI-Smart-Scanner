const axios = require("axios");
const config = require("./config");

// ============================================================
// V5 STRATEGY SHEETS
// ============================================================
// EQUITY       -> qualified stock setups / audit
// CALL_OPTIONS -> all CALL option candidates
// PUT_OPTIONS  -> all PUT option candidates
// Strategy sheets are sent in ONE webhook request so Apps Script
// uses one lock cycle and updates all three sheets together.
// ============================================================

const TIMEOUT = 120000;
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
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    if (typeof value === "boolean") return value;
    if (typeof value === "object") {
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
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
    const raw = String(value(row, "optionType", [
        "optionsType", "option_type", "type", "instrument_type"
    ])).trim().toUpperCase();

    if (raw === "CALL" || raw === "CE" || raw === "CALL_OPTION") return "CALL";
    if (raw === "PUT" || raw === "PE" || raw === "PUT_OPTION") return "PUT";
    return "";
}

function decisionRank(row) {
    const d = String(value(row, "optionsDecision", ["decision"]))
        .trim().toUpperCase();
    return ({ TRADE: 3, WATCH: 2, REJECT: 1 }[d] || 0);
}

function confidence(row) {
    const n = Number(value(row, "optionsConfidence", ["confidence", "optionConfidence"]));
    return Number.isFinite(n) ? n : 0;
}

function scannerScore(row) {
    const n = Number(value(row, "rankingScore", [
        "finalScore", "aiFinalScore", "scannerScore", "score"
    ]));
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

async function postStrategySheets(payload) {
    const url = getWebhookUrl();
    if (!url) throw new Error("Google Sheet webhook URL is missing.");

    const response = await axios.post(url, payload, {
        timeout: TIMEOUT,
        headers: { "Content-Type": "application/json" }
    });

    if (response?.data?.success === false) {
        throw new Error(
            `Google Sheets rejected strategy sheets: ${response.data.error || "unknown error"}`
        );
    }

    return response?.data || {};
}

async function updateStrategySheets(scannerData, optionDecisions) {
    const scannerRows = Array.isArray(scannerData) ? scannerData : [];
    const options = Array.isArray(optionDecisions) ? optionDecisions : [];

    const qualifiedKeys = new Set(
        options.map(getStockKey).filter(Boolean)
    );

    const qualifiedEquityRows = scannerRows
        .filter(row => qualifiedKeys.has(getStockKey(row)))
        .slice(0, EQUITY_MAX_ROWS);

    const equityRows = buildRows(qualifiedEquityRows, EQUITY_COLUMNS);
    const callRows = buildRows(
        options.filter(row => normalizeType(row) === "CALL"),
        OPTION_COLUMNS
    );
    const putRows = buildRows(
        options.filter(row => normalizeType(row) === "PUT"),
        OPTION_COLUMNS
    );

    const result = await postStrategySheets({
        action: "replaceStrategySheets",
        timestamp: new Date().toISOString(),
        sheets: {
            EQUITY: { headers: EQUITY_COLUMNS, rows: equityRows },
            CALL_OPTIONS: { headers: OPTION_COLUMNS, rows: callRows },
            PUT_OPTIONS: { headers: OPTION_COLUMNS, rows: putRows }
        }
    });

    return {
        success: true,
        equityRows: equityRows.length,
        callRows: callRows.length,
        putRows: putRows.length,
        ...result
    };
}

module.exports = {
    EQUITY_COLUMNS,
    OPTION_COLUMNS,
    updateStrategySheets
};
