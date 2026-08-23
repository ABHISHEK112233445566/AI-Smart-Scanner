// Google Sheet uploader configuration helpers.
// Keeps the existing uploader contract while making thresholds/config single-source.
const axios = require("axios");
const config = require("./config");

const DASHBOARD_MIN_SCORE = Number(config.THRESHOLDS?.DASHBOARD_MIN_SCORE ?? config.DASHBOARD_MIN_SCORE ?? 90);
const DASHBOARD_MAX_ROWS = Number(config.THRESHOLDS?.DASHBOARD_MAX_ROWS ?? config.DASHBOARD_MAX_ROWS ?? 10);
const MIN_CONFIDENCE = Number(config.THRESHOLDS?.MIN_CONFIDENCE ?? 70);
const MIN_RR = Number(config.THRESHOLDS?.MIN_RR ?? 1.5);
const GOOGLE_TIMEOUT = 30000;

function getGoogleSheetUrl() {
    return process.env.GOOGLE_SHEET_WEBHOOK_URL ||
        process.env.GOOGLE_SCRIPT_URL ||
        process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
        process.env.GOOGLE_SHEET_URL ||
        process.env.GOOGLE_APPS_SCRIPT_URL ||
        config.GOOGLE_SHEET_URL || null;
}

function validatedRR(row = {}) {
    const rr = Number(row.riskReward ?? row.rr);
    return Number.isFinite(rr) && rr > 0 ? rr : 0;
}

function isValidTradeRow(row = {}) {
    const confidence = Number(row.confidence ?? row.optionsConfidence ?? 0);
    const rr = validatedRR(row);
    return Number.isFinite(confidence) && confidence >= MIN_CONFIDENCE && rr >= MIN_RR;
}

function selectDashboardRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .filter(row => Number(row.aiFinalScore ?? row.aiScore ?? row.scannerScore ?? 0) >= DASHBOARD_MIN_SCORE)
        .sort((a, b) => Number(b.aiFinalScore ?? b.aiScore ?? b.scannerScore ?? 0) - Number(a.aiFinalScore ?? a.aiScore ?? a.scannerScore ?? 0))
        .slice(0, DASHBOARD_MAX_ROWS);
}

function buildScannerStatus({
    status = "SUCCESS",
    startedAt,
    universe = "ALL",
    broker = process.env.BROKER || "UPSTOX",
    scanned = 0,
    successfulScans = 0,
    failedScans = 0,
    callCandidates = 0,
    putCandidates = 0,
    tradeCount = 0,
    watchCount = 0,
    rejectCount = 0,
    elapsedSeconds = 0
} = {}) {
    const completedAt = new Date();
    const started = startedAt instanceof Date ? startedAt : new Date(startedAt || completedAt);
    return {
        status: String(status).toUpperCase(),
        lastScanTime: completedAt.toISOString(),
        lastScanTimeIST: new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(completedAt).replace(",", ""),
        lastScanSource: process.env.GITHUB_ACTIONS ? "GitHub Actions" : "Local",
        broker: String(broker || "UPSTOX").toUpperCase(),
        universe: String(universe || "ALL").toUpperCase(),
        stocksScanned: Number(scanned) || 0,
        successfulScans: Number(successfulScans) || 0,
        failedScans: Number(failedScans) || 0,
        callCandidates: Number(callCandidates) || 0,
        putCandidates: Number(putCandidates) || 0,
        tradeCount: Number(tradeCount) || 0,
        watchCount: Number(watchCount) || 0,
        rejectCount: Number(rejectCount) || 0,
        elapsedSeconds: Number(elapsedSeconds) || 0,
        durationMs: Math.max(0, completedAt.getTime() - started.getTime())
    };
}

async function postToGoogleSheet(payload) {
    const url = getGoogleSheetUrl();
    if (!url) throw new Error("Google Sheet webhook URL is not configured");
    return axios.post(url, payload, { timeout: GOOGLE_TIMEOUT });
}

async function updateGoogleSheet(payload) {
    return postToGoogleSheet(payload);
}

module.exports = {
    updateGoogleSheet,
    postToGoogleSheet,
    getGoogleSheetUrl,
    selectDashboardRows,
    isValidTradeRow,
    validatedRR,
    buildScannerStatus,
    DASHBOARD_MIN_SCORE,
    DASHBOARD_MAX_ROWS,
    MIN_CONFIDENCE,
    MIN_RR
};
