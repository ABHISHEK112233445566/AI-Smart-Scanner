// ============================================================
// AI SMART SCANNER - SCHEDULER
// ============================================================
// Scheduler is preserved, but automatic scheduling is bypassed.
// npm start now runs ONE scanner cycle through app.js and exits.
// No 30-minute loop and no automatic accuracy evaluation.
//
// To restore the old 30-minute scheduler later:
//   SCANNER_SCHEDULER_ENABLED=true npm start
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

function runScanner(onComplete) {
    if (scannerRunning) {
        console.log(`[${formatTime()}] ⚠️ Scanner is already running.`);
        if (onComplete) onComplete(1);
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
        if (onComplete) onComplete(1);
    });

    scannerProcess.on("close", async code => {
        scannerRunning = false;
        scannerProcess = null;

        if (code !== 0) {
            console.error(`[${formatTime()}] ❌ Scanner failed with code ${code}.`);
            if (onComplete) onComplete(code || 1);
            return;
        }

        console.log(`[${formatTime()}] ✅ Scanner completed successfully.`);
        if (onComplete) onComplete(0);
    });
}

// ============================================================
// DEFAULT: MANUAL ONE-SCAN MODE
// ============================================================

if (!SCHEDULER_ENABLED) {
    console.log("============================================================");
    console.log("🖐️ AI SMART SCANNER — MANUAL MODE");
    console.log("▶️ npm start = ONE SCANNER CYCLE");
    console.log("❌ No automatic 30-minute scans");
    console.log("❌ No background scanner process");
    console.log("❌ No automatic accuracy evaluation");
    console.log("============================================================");

    runScanner(code => {
        process.exitCode = code;
    });
} else {
    // ========================================================
    // OPTIONAL: 30-MINUTE SCHEDULER MODE
    // ========================================================

    console.log("============================================================");
    console.log("🚀 AI SMART SCANNER — 30-MINUTE SCHEDULER ENABLED");
    console.log(`🔁 Scan interval: EVERY ${INTERVAL_MINUTES} MINUTES`);
    console.log("📊 Accuracy evaluation: AFTER SUCCESSFUL SCAN ONLY");
    console.log("🛡️ Overlapping scans: BLOCKED");
    console.log("============================================================");

    runScanner(async code => {
        if (code === 0) await runAccuracyEvaluation();
    });

    const interval = setInterval(() => {
        runScanner(async code => {
            if (code === 0) await runAccuracyEvaluation();
        });
    }, INTERVAL_MS);

    function shutdown(signal) {
        console.log(`\n[${formatTime()}] 🛑 Scheduler received ${signal}. Shutting down.`);
        clearInterval(interval);
        if (scannerProcess && !scannerProcess.killed) scannerProcess.kill();
        process.exit(0);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}
