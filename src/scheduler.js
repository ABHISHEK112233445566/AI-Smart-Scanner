"use strict";

const { spawn } = require("child_process");
const path = require("path");

const SCHEDULER_ENABLED = String(process.env.SCANNER_SCHEDULER_ENABLED || "true").toLowerCase() === "true";
const SCAN_INTERVAL_MS = 30 * 60 * 1000;
const SCANNER_ENTRY = path.join(__dirname, "newScanner", "runner.js");

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

function isMarketHours(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(values.weekday) &&
    minutes >= 555 && minutes < 930;
}

function runScanner() {
  if (scannerRunning) {
    console.log(`[${formatTime()}] ⏭️ New scanner already running; overlapping run skipped.`);
    return;
  }

  scannerRunning = true;
  console.log(`[${formatTime()}] 🚀 Starting NEW AI Smart Scanner: ${SCANNER_ENTRY}`);

  scannerProcess = spawn(process.execPath, [SCANNER_ENTRY], {
    stdio: "inherit",
    env: process.env
  });

  scannerProcess.on("error", error => {
    console.error(`[${formatTime()}] ❌ New scanner process error: ${error.message}`);
    scannerRunning = false;
    scannerProcess = null;
  });

  scannerProcess.on("close", code => {
    scannerRunning = false;
    scannerProcess = null;
    console.log(`[${formatTime()}] ${code === 0 ? "✅" : "❌"} New scanner finished (exit ${code}).`);
  });
}

if (!SCHEDULER_ENABLED) {
  console.log("SCANNER_SCHEDULER_ENABLED=false; running the new scanner once.");
  runScanner();
} else {
  console.log("🚀 NEW AI SMART SCANNER: every 30 minutes during NSE market hours; overlap blocked.");
  runScanner();

  const scanTimer = setInterval(() => {
    if (isMarketHours()) runScanner();
  }, SCAN_INTERVAL_MS);

  const shutdown = () => {
    clearInterval(scanTimer);
    if (scannerProcess && !scannerProcess.killed) scannerProcess.kill();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
