const axios = require("axios");
const config = require("./config");

// ============================================================
// AI SMART SCANNER — STRATEGY SHEETS
// ============================================================
// RULES
// 1. EQUITY is independent of option decisions.
// 2. CALL_OPTIONS receives every CALL candidate returned by the
//    options engine, including WATCH/REJECT/NO CONTRACT.
// 3. PUT_OPTIONS receives every PUT candidate returned by the
//    options engine, including WATCH/REJECT/NO CONTRACT.
// 4. Sheets must record scanner output; they must not silently
//    discard rows because an option contract is unavailable.
// 5. CALL/PUT/CE/PE and common field aliases are normalized here.
// 6. Writes are sequential because Apps Script uses a script lock.
// ============================================================

const TIMEOUT = 120000;
const EQUITY_MAX_ROWS = 50;

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
        if (row[k] !== undefined && row[k] !== null && row[k] !== "") {
            return row[k];
        }
    }

    return "";
}

function getStockKey(row) {
    return String(value(row, "stock", [
        "symbol", "tradingSymbol", "name", "stockSymbol"
    ])).trim().toUpperCase();
}

function normalizeType(row) {
    const raw = String(value(row, "optionType", [
        "optionsType",
        "option_type",
        "optiontype",
        "type",
        "instrument_type",
        "side",
        "direction"
    ])).trim().toUpperCase();

    if (raw === "CALL" || raw === "CE" || raw.includes("CALL")) return "CALL";
    if (raw === "PUT" || raw === "PE" || raw.includes("PUT")) return "PUT";

    return "";
}

function normalizeDecision(row) {
    return String(value(row, "optionsDecision", [
        "decision", "optionDecision", "tradeDecision"
    ])).trim().toUpperCase();
}

function decisionRank(row) {
    const d = normalizeDecision(row);
    return ({ TRADE: 3, WATCH: 2, REJECT: 1 }[d] || 0);
}

function confidence(row) {
    const n = Number(value(row, "optionsConfidence", [
        "confidence", "optionConfidence"
    ]));
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
    return rows.map((row, index) => columns.map(column => {
        if (column === "rank") return index + 1;
        return clean(value(row, column, aliasesFor(column)));
    }));
}

function aliasesFor(column) {
    const aliases = {
        stock: ["symbol", "tradingSymbol", "name", "stockSymbol"],
        symbol: ["stock", "tradingSymbol", "stockSymbol"],
        price: ["ltp", "lastPrice", "last_price", "close", "currentPrice", "current_price"],
        direction: ["stockDirection", "technicalDirection", "optionDirection"],
        signal: ["scannerSignal", "tradeSignal"],
        entry: ["stockEntry", "marketEntry", "underlyingEntry", "triggerPrice", "trigger_price"],
        stopLoss: ["stockStopLoss"],
        target1: ["stockTarget1"],
        target2: ["stockTarget2"],
        riskReward: ["rr"],
        confidence: ["optionsConfidence", "optionConfidence"],
        optionType: ["optionsType", "option_type", "type", "side"],
        optionSymbol: ["tradingsymbol", "tradingSymbol", "optionTradingSymbol"],
        optionExpiry: ["expiry", "expiryDate", "optionExpiryDate"],
        recommendedStrike: ["strike", "strikePrice", "recommended_strike"],
        optionStrike: ["strike", "strikePrice", "recommendedStrike"],
        optionsDecision: ["decision", "optionDecision", "tradeDecision"],
        optionsRating: ["rating", "optionRating"],
        optionsConfidence: ["confidence", "optionConfidence"],
        optionsReason: ["reason", "optionReason"],
        tradeGates: ["gates"],
        failedGates: ["failedGateList"],
        failedGateCount: ["failedGatesCount"],
        contractAvailable: ["hasContract", "optionContractAvailable"],
        optionPriceAvailable: ["hasOptionPrice", "optionLtpAvailable"],
        optionSetupAvailable: ["hasOptionSetup"],
        mtfAlignment: ["mtfAligned", "alignment"],
        volumeConfirmed: ["volumeConfirmation", "volumeConfirm"],
        support1: ["support", "s1"],
        resistance1: ["resistance", "r1"],
        timestamp: ["time", "scanTime", "lastScanTime"]
    };

    return aliases[column] || [];
}

function dedupeRows(rows) {
    const seen = new Set();
    const result = [];

    for (const row of rows) {
        const stock = getStockKey(row);
        const type = normalizeType(row);
        const optionSymbol = String(value(row, "optionSymbol", ["tradingsymbol", "tradingSymbol"]))
            .trim()
            .toUpperCase();
        const key = `${stock}|${type}|${optionSymbol}`;

        if (!stock && !optionSymbol) continue;
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(row);
    }

    return result;
}

async function postSheet(sheet, headers, rows) {
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

    return response?.data || {};
}

async function updateStrategySheets(scannerData, optionDecisions) {
    const scannerRows = Array.isArray(scannerData) ? scannerData.filter(Boolean) : [];
    const options = Array.isArray(optionDecisions) ? optionDecisions.filter(Boolean) : [];

    // ------------------------------------------------------------
    // EQUITY
    // IMPORTANT: Do NOT depend on optionDecisions.
    // The equity sheet must still populate when the option engine
    // has no contract, no premium, or no option decision.
    // ------------------------------------------------------------
    const equityRowsSource = scannerRows
        .filter(row => getStockKey(row))
        .slice(0, EQUITY_MAX_ROWS);

    // ------------------------------------------------------------
    // OPTIONS
    // Keep every option decision. REJECT / NO CONTRACT is useful
    // audit information and must not make the row disappear.
    // ------------------------------------------------------------
    const uniqueOptions = dedupeRows(options);

    const callsSource = sortCandidates(
        uniqueOptions.filter(row => normalizeType(row) === "CALL")
    );

    const putsSource = sortCandidates(
        uniqueOptions.filter(row => normalizeType(row) === "PUT")
    );

    const equityRows = buildRows(equityRowsSource, EQUITY_COLUMNS);
    const callRows = buildRows(callsSource, OPTION_COLUMNS);
    const putRows = buildRows(putsSource, OPTION_COLUMNS);

    // Sequential writes: Apps Script has one script lock.
    const equity = await postSheet("EQUITY", EQUITY_COLUMNS, equityRows);
    const calls = await postSheet("CALL_OPTIONS", OPTION_COLUMNS, callRows);
    const puts = await postSheet("PUT_OPTIONS", OPTION_COLUMNS, putRows);

    return {
        success: true,
        equityRows: equityRows.length,
        callRows: callRows.length,
        putRows: putRows.length,
        equity,
        calls,
        puts
    };
}

module.exports = {
    EQUITY_COLUMNS,
    OPTION_COLUMNS,
    updateStrategySheets
};
