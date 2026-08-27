// ============================================================
// AI SMART SCANNER - 24-HOUR SCHEDULER
// ============================================================
// Runs app.js immediately and then every 30 minutes.
// Accuracy evaluation runs ONLY after a successful scanner cycle.
// A scanner failure must never be reported as a completed scan.
// ============================================================

const { spawn } = require("child_process");
const path = require("path");
const { evaluateLiveAccuracy } = require("./liveAccuracyEvaluator");

const INTERVAL_MINUTES = 30;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;
const appPath = path.join(__dirname, "app.js");

let scannerRunning = false;
let scannerProcess = null;

function formatTime(date = new Date()) {
    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}

async function runAccuracyEvaluation() {
    try {
        console.log(`[${formatTime()}] 📊 Starting live ACCURACY evaluation...`);
        const result = await evaluateLiveAccuracy();
        console.log(`[${formatTime()}] 📈 Accuracy evaluation: found=${result.found}, evaluated=${result.evaluated}, updated=${result.updated}, skipped=${result.skipped}`);
    } catch (error) {
        console.error(`[${formatTime()}] ⚠️ Live ACCURACY evaluation failed: ${error.message}`);
    }
}

function runScanner() {
    if (scannerRunning) {
        console.log(`[${formatTime()}] ⚠️ Previous scan is still running. Skipping this cycle.`);
        return;
    }

    scannerRunning = true;
    console.log(`\n[${formatTime()}] 🚀 Starting scanner...`);

    scannerProcess = spawn(process.execPath, [appPath], {
        stdio: "inherit",
        env: process.env
    });

    scannerProcess.on("error", error => {
        console.error(`[${formatTime()}] ❌ Scanner process error: ${error.message}`);
        scannerRunning = false;
        scannerProcess = null;
    });

    scannerProcess.on("close", async code => {
        scannerRunning = false;
        scannerProcess = null;

        if (code !== 0) {
            console.error(`[${formatTime()}] ❌ Scanner failed with code ${code}. Accuracy evaluation SKIPPED.`);
            console.log(`[${formatTime()}] 🔁 Scheduler remains active. Next scan in ${INTERVAL_MINUTES} minutes.`);
            return;
        }

        console.log(`[${formatTime()}] ✅ Scanner completed successfully.`);
        await runAccuracyEvaluation();
        console.log(`[${formatTime()}] 🔁 Scheduler remains active. Next scan in ${INTERVAL_MINUTES} minutes.`);
    });
}

console.log("============================================================");
console.log("🚀 AI SMART SCANNER — PERMANENT 24-HOUR MODE");
console.log(`🔁 Scan interval: EVERY ${INTERVAL_MINUTES} MINUTES`);
console.log("📊 Live ACCURACY evaluation: AFTER SUCCESSFUL SCAN ONLY");
console.log("🕐 Market-hours restriction: DISABLED");
console.log("🛡️ Overlapping scans: BLOCKED");
console.log("============================================================");

runScanner();
const interval = setInterval(runScanner, INTERVAL_MS);

function shutdown(signal) {
    console.log(`\n[${formatTime()}] 🛑 Scheduler received ${signal}. Shutting down.`);
    clearInterval(interval);
    if (scannerProcess && !scannerProcess.killed) scannerProcess.kill();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
