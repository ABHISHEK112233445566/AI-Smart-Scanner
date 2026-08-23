// ============================================================
// AI SMART SCANNER - MARKET HOURS SCHEDULER
// ============================================================
// Configuration is owned by config.js. This file only schedules app.js.

const { spawn } = require("child_process");
const path = require("path");
const config = require("./config");

const schedule = config.SCHEDULER || {};
const START_HOUR = Number(schedule.START_HOUR ?? 9);
const START_MINUTE = Number(schedule.START_MINUTE ?? 15);
const END_HOUR = Number(schedule.END_HOUR ?? 15);
const END_MINUTE = Number(schedule.END_MINUTE ?? 30);
const INTERVAL_MINUTES = Number(schedule.INTERVAL_MINUTES ?? 5);
const TIMEOUT_MINUTES = Number(schedule.TIMEOUT_MINUTES ?? 10);

let scannerRunning = false;
let scannerProcess = null;
let nextScanTimer = null;

function getIndiaTime() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).formatToParts(now);
    const get = type => parts.find(p => p.type === type)?.value;
    return new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`);
}

function timeToMinutes(date) { return date.getHours() * 60 + date.getMinutes(); }
function isTradingDay(date) { const day = date.getDay(); return day !== 0 && day !== 6; }
function isMarketHours(date) {
    if (!isTradingDay(date)) return false;
    const now = timeToMinutes(date);
    return now >= START_HOUR * 60 + START_MINUTE && now <= END_HOUR * 60 + END_MINUTE;
}
function formatTime(date) { return date.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }); }

function runScanner() {
    if (scannerRunning) return;
    scannerRunning = true;
    const appPath = path.join(__dirname, "app.js");
    console.log(`\n[${formatTime(getIndiaTime())}] Starting scanner...`);
    scannerProcess = spawn(process.execPath, [appPath], { stdio: "inherit", env: process.env });
    const timeout = setTimeout(() => {
        if (scannerProcess && !scannerProcess.killed) {
            console.error("⚠️ Scanner timeout reached; terminating current scan.");
            scannerProcess.kill();
        }
    }, Math.max(1, TIMEOUT_MINUTES) * 60 * 1000);
    scannerProcess.on("close", code => {
        clearTimeout(timeout);
        scannerRunning = false;
        scannerProcess = null;
        console.log(`[${formatTime(getIndiaTime())}] Scanner finished with code ${code}.`);
    });
    scannerProcess.on("error", error => {
        clearTimeout(timeout);
        scannerRunning = false;
        scannerProcess = null;
        console.error("❌ Scanner process error:", error.message);
    });
}

function scheduleNext() {
    if (nextScanTimer) clearTimeout(nextScanTimer);
    const now = getIndiaTime();
    if (!isMarketHours(now)) return;
    const intervalMs = Math.max(1, INTERVAL_MINUTES) * 60 * 1000;
    const elapsedFromHour = now.getMinutes() % Math.max(1, INTERVAL_MINUTES);
    const seconds = now.getSeconds() * 1000 + now.getMilliseconds();
    let delay = (Math.max(1, INTERVAL_MINUTES) - elapsedFromHour) * 60 * 1000 - seconds;
    if (delay <= 0) delay = intervalMs;
    nextScanTimer = setTimeout(() => {
        const current = getIndiaTime();
        if (isMarketHours(current)) runScanner();
        scheduleNext();
    }, delay);
}

function startScheduler() {
    const now = getIndiaTime();
    console.log(`🕘 Scheduler started | NSE ${String(START_HOUR).padStart(2,"0")}:${String(START_MINUTE).padStart(2,"0")}–${String(END_HOUR).padStart(2,"0")}:${String(END_MINUTE).padStart(2,"0")} IST | every ${INTERVAL_MINUTES} min`);
    if (isMarketHours(now)) runScanner();
    scheduleNext();
}

function stopScheduler() {
    if (nextScanTimer) clearTimeout(nextScanTimer);
    nextScanTimer = null;
    if (scannerProcess && !scannerProcess.killed) scannerProcess.kill();
    scannerProcess = null;
    scannerRunning = false;
}

if (require.main === module) {
    startScheduler();
    process.on("SIGINT", () => { stopScheduler(); process.exit(0); });
    process.on("SIGTERM", () => { stopScheduler(); process.exit(0); });
}

module.exports = { startScheduler, stopScheduler, runScanner, isMarketHours, getIndiaTime };
