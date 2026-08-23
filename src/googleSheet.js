// ============================================================
// AI SMART SCANNER — GOOGLE SHEET UPLOADER V6
// ============================================================
// Responsibilities:
//   SCANNER   -> replace with exactly the prepared Top 50 rows
//   Dashboard -> replace with ONLY final qualified dashboard rows
//   ACCURACY  -> append every new prediction; never erase history
//   SCANNER_STATUS -> update scanner status only
//
// Strategy sheets (EQUITY / CALL_OPTIONS / PUT_OPTIONS) are handled
// by strategySheets.js.
// ============================================================

const axios = require("axios");
const config = require("./config");

const DASHBOARD_MIN_SCORE = Number(
    config.THRESHOLDS?.DASHBOARD_MIN_SCORE ??
    config.DASHBOARD_MIN_SCORE ??
    90
);

const DASHBOARD_MAX_ROWS = Number(
    config.THRESHOLDS?.DASHBOARD_MAX_ROWS ??
    config.DASHBOARD_MAX_ROWS ??
    10
);

const MIN_CONFIDENCE = Number(config.THRESHOLDS?.MIN_CONFIDENCE ?? 70);
const MIN_RR = Number(config.THRESHOLDS?.MIN_RR ?? 1.5);
const GOOGLE_TIMEOUT = 30000;

function getGoogleSheetUrl() {
    return process.env.GOOGLE_SHEET_WEBHOOK_URL ||
        process.env.GOOGLE_SCRIPT_URL ||
        process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
        process.env.GOOGLE_SHEET_URL ||
        process.env.GOOGLE_APPS_SCRIPT_URL ||
        config.GOOGLE_SHEET_WEBHOOK_URL ||
        config.GOOGLE_SCRIPT_URL ||
        config.GOOGLE_SHEETS_WEBHOOK_URL ||
        config.GOOGLE_SHEET_URL ||
        config.GOOGLE_APPS_SCRIPT_URL ||
        null;
}

function validatedRR(row = {}) {
    const rr = Number(row.riskReward ?? row.rr);
    return Number.isFinite(rr) && rr > 0 ? rr : 0;
}

function isValidTradeRow(row = {}) {
    const confidence = Number(
        row.confidence ?? row.optionsConfidence ?? 0
    );
    const rr = validatedRR(row);
    return Number.isFinite(confidence) &&
        confidence >= MIN_CONFIDENCE &&
        rr >= MIN_RR;
}

function selectDashboardRows(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .filter(row =>
            Number(
                row.aiFinalScore ??
                row.aiScore ??
                row.scannerScore ??
                0
            ) >= DASHBOARD_MIN_SCORE
        )
        .sort((a, b) =>
            Number(b.aiFinalScore ?? b.aiScore ?? b.scannerScore ?? 0) -
            Number(a.aiFinalScore ?? a.aiScore ?? a.scannerScore ?? 0)
        )
        .slice(0, DASHBOARD_MAX_ROWS);
}

// ------------------------------------------------------------
// Object -> Google Sheet rows
// ------------------------------------------------------------

function cleanCell(value) {
    if (value === undefined || value === null) return "";
    if (value instanceof Date) return value.toISOString();

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : "";
    }

    if (typeof value === "boolean") return value;

    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    return String(value);
}

function buildSheetPayload(sheet, objects = []) {
    const rows = Array.isArray(objects) ? objects.filter(Boolean) : [];

    // Always send a valid header row, even when there are zero data rows.
    // This is critical for Dashboard: an empty finalTop5 must clear the old
    // Dashboard instead of leaving stale candidates such as CUMMINSIND.
    const headerSet = new Set();
    const headers = [];

    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!headerSet.has(key)) {
                headerSet.add(key);
                headers.push(key);
            }
        }
    }

    // For an empty Dashboard/SCANNER payload, keep a simple header so the
    // Apps Script replaceSheet action still clears the sheet successfully.
    if (headers.length === 0) {
        headers.push("status");
    }

    const outputRows = rows.map(row =>
        headers.map(header => cleanCell(row[header]))
    );

    return {
        action: "replaceSheet",
        sheet,
        clearFirst: true,
        headers,
        rows: outputRows,
        timestamp: new Date().toISOString()
    };
}

async function postToGoogleSheet(payload) {
    const url = getGoogleSheetUrl();
    if (!url) {
        throw new Error("Google Sheet webhook URL is not configured");
    }

    return axios.post(url, payload, {
        timeout: GOOGLE_TIMEOUT,
        headers: {
            "Content-Type": "application/json"
        }
    });
}

async function postReplaceSheet(sheet, objects) {
    const payload = buildSheetPayload(sheet, objects);
    const response = await postToGoogleSheet(payload);

    if (response?.data && response.data.success === false) {
        throw new Error(
            `Google Sheets rejected ${sheet}: ${response.data.error || "unknown error"}`
        );
    }

    return response?.data || {};
}

async function postAccuracyRows(rows = []) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];

    // Nothing to append is a valid result.
    if (list.length === 0) {
        return { success: true, rowCount: 0 };
    }

    const headerSet = new Set();
    const headers = [];

    for (const row of list) {
        for (const key of Object.keys(row)) {
            if (!headerSet.has(key)) {
                headerSet.add(key);
                headers.push(key);
            }
        }
    }

    const outputRows = list.map(row =>
        headers.map(header => cleanCell(row[header]))
    );

    const response = await postToGoogleSheet({
        action: "appendRows",
        sheet: "ACCURACY",
        headers,
        rows: outputRows,
        timestamp: new Date().toISOString()
    });

    if (response?.data && response.data.success === false) {
        throw new Error(
            `Google Sheets rejected ACCURACY: ${response.data.error || "unknown error"}`
        );
    }

    return response?.data || {};
}

// ------------------------------------------------------------
// Main uploader contract used by app.js
// ------------------------------------------------------------

async function updateGoogleSheet(payload = {}) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Google Sheet payload must be an object");
    }

    // Scanner status is deliberately independent from the data uploads.
    // app.js calls this after the main sheet update and again when needed.
    if (String(payload.action || "").trim() === "scanner_status") {
        const response = await postToGoogleSheet({
            action: "scanner_status",
            scannerStatus: payload.scannerStatus || payload.status || {}
        });

        if (response?.data && response.data.success === false) {
            throw new Error(
                `Google Sheets rejected SCANNER_STATUS: ${response.data.error || "unknown error"}`
            );
        }

        return response?.data || {};
    }

    const scannerData = Array.isArray(payload.scannerData)
        ? payload.scannerData
        : [];

    const dashboardData = Array.isArray(payload.dashboardData)
        ? payload.dashboardData
        : [];

    const accuracyData = Array.isArray(payload.accuracyData)
        ? payload.accuracyData
        : [];

    // IMPORTANT:
    // 1. SCANNER always replaces old data with the exact Top 50 prepared by app.js.
    // 2. Dashboard always replaces old data, including when dashboardData is [].
    // 3. Accuracy only appends, preserving historical predictions.
    // These three operations are intentionally awaited separately so a failure
    // cannot silently leave stale Dashboard data behind.
    const scanner = await postReplaceSheet("SCANNER", scannerData);
    const dashboard = await postReplaceSheet("Dashboard", dashboardData);
    const accuracy = await postAccuracyRows(accuracyData);

    return {
        success: true,
        scanner,
        dashboard,
        accuracy,
        scannerRows: scannerData.length,
        dashboardRows: dashboardData.length,
        accuracyRows: accuracyData.length
    };
}

// ------------------------------------------------------------
// Scanner status builder
// ------------------------------------------------------------

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
    const started = startedAt instanceof Date
        ? startedAt
        : new Date(startedAt || completedAt);

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
        lastScanSource: process.env.GITHUB_ACTIONS
            ? "GitHub Actions"
            : "Local",
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
        durationMs: Math.max(
            0,
            completedAt.getTime() - started.getTime()
        )
    };
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
