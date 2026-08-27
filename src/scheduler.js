// ============================================================
// AI SMART SCANNER - SCHEDULER
// ============================================================
// Scheduler is preserved, but BYPASSED by default.
// Manual mode is the current operating mode.
//
// To temporarily enable the 30-minute scheduler:
//   set SCANNER_SCHEDULER_ENABLED=true
//
// Default:
//   npm start -> scheduler.js -> exits without scanning
//
// Manual scan:
//   node src/app.js
// ============================================================

const { spawn } = require("child_process");
const path = require("path");
const { evaluateLiveAccuracy } = require("./liveAccuracyEvaluator");

const SCHEDULER_ENABLED = String(process.env.SCANNER_SCHEDULER_ENABLED || "false").toLowerCase() === "true";
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
            return;
        }

        console.log(`[${formatTime()}] ✅ Scanner completed successfully.`);
        await runAccuracyEvaluation();
    });
}

// ============================================================
// CURRENT DEFAULT: MANUAL MODE
// ============================================================

if (!SCHEDULER_ENABLED) {
    console.log("============================================================");
    console.log("⏸️ AI SMART SCANNER — SCHEDULER BYPASSED");
    console.log("🖐️ MANUAL SCAN MODE ACTIVE");
    console.log("❌ No automatic 30-minute scans");
    console.log("❌ No background scanner process");
    console.log("❌ No automatic accuracy evaluation");
    console.log("✅ Run manually with: node src/app.js");
    console.log("============================================================");
    process.exit(0);
}

// ============================================================
// OPTIONAL SCHEDULER MODE
// ============================================================

console.log("============================================================");
console.log("🚀 AI SMART SCANNER — 30-MINUTE SCHEDULER ENABLED");
console.log(`🔁 Scan interval: EVERY ${INTERVAL_MINUTES} MINUTES`);
console.log("📊 Accuracy evaluation: AFTER SUCCESSFUL SCAN ONLY");
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
