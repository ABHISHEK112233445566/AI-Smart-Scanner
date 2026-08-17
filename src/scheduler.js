// ============================================================
// AI SMART SCANNER - AUTOMATIC MARKET HOURS SCHEDULER
// ============================================================
//
// PURPOSE
// ------------------------------------------------------------
// Automatically runs the existing app.js during NSE market
// hours without changing the scanner itself.
//
// MARKET HOURS
// ------------------------------------------------------------
// Start : 09:15 IST
// Stop  : 15:30 IST
//
// SCAN INTERVAL
// ------------------------------------------------------------
// Every 5 minutes
//
// IMPORTANT
// ------------------------------------------------------------
// This file does NOT modify:
// - scanner.js
// - optionsDecisionEngine.js
// - dashboard.js
// - googleSheet.js
// - broker adapters
//
// It simply launches the existing app.js automatically.
// ============================================================

const { spawn } = require("child_process");
const path = require("path");

// ============================================================
// CONFIGURATION
// ============================================================

const SCAN_START_HOUR = 9;
const SCAN_START_MINUTE = 15;

const SCAN_END_HOUR = 15;
const SCAN_END_MINUTE = 30;

// Scan every 5 minutes
const SCAN_INTERVAL_MINUTES = 5;

// Give the scanner some time to finish before safety timeout
const SCAN_TIMEOUT_MINUTES = 10;


// ============================================================
// STATE
// ============================================================

let scannerRunning = false;
let scannerProcess = null;
let nextScanTimer = null;


// ============================================================
// GET INDIA TIME
// ============================================================

function getIndiaTime() {

    const now = new Date();

    const indiaString =
        now.toLocaleString(
            "en-US",
            {
                timeZone:
                    "Asia/Kolkata"
            }
        );

    return new Date(
        indiaString
    );
}


// ============================================================
// FORMAT TIME
// ============================================================

function formatTime(date) {

    return date.toLocaleTimeString(
        "en-IN",
        {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }
    );

}


// ============================================================
// CHECK WEEKDAY
// ============================================================

function isTradingDay(date) {

    const day =
        date.getDay();

    // 0 = Sunday
    // 6 = Saturday

    return (
        day !== 0 &&
        day !== 6
    );

}


// ============================================================
// CONVERT TIME TO MINUTES
// ============================================================

function timeToMinutes(date) {

    return (
        date.getHours() * 60 +
        date.getMinutes()
    );

}


// ============================================================
// CHECK MARKET HOURS
// ============================================================

function isMarketHours(date) {

    if (
        !isTradingDay(date)
    ) {

        return false;

    }


    const currentMinutes =
        timeToMinutes(date);


    const startMinutes =
        SCAN_START_HOUR * 60 +
        SCAN_START_MINUTE;


    const endMinutes =
        SCAN_END_HOUR * 60 +
        SCAN_END_MINUTE;


    return (
        currentMinutes >= startMinutes &&
        currentMinutes <= endMinutes
    );

}


// ============================================================
// CHECK WHETHER MARKET HAS NOT OPENED
// ============================================================

function beforeMarketOpen(date) {

    if (
        !isTradingDay(date)
    ) {

        return false;

    }


    const currentMinutes =
        timeToMinutes(date);


    const startMinutes =
        SCAN_START_HOUR * 60 +
        SCAN_START_MINUTE;


    return (
        currentMinutes < startMinutes
    );

}


// ============================================================
// CHECK WHETHER MARKET HAS CLOSED
// ============================================================

function afterMarketClose(date) {

    if (
        !isTradingDay(date)
    ) {

        return false;

    }


    const currentMinutes =
        timeToMinutes(date);


    const endMinutes =
        SCAN_END_HOUR * 60 +
        SCAN_END_MINUTE;


    return (
        currentMinutes > endMinutes
    );

}


// ============================================================
// RUN EXISTING SCANNER
// ============================================================

function runScanner() {

    if (
        scannerRunning
    ) {

        console.log(
            "\n⚠️ Previous scan is still running."
        );

        console.log(
            "⏭️ Skipping this cycle.\n"
        );

        return;

    }


    scannerRunning = true;


    console.log(
        "\n=========================================="
    );

    console.log(
        "🚀 AUTOMATIC SCAN STARTED"
    );

    console.log(
        `🇮🇳 India Time: ${formatTime(
            getIndiaTime()
        )}`
    );

    console.log(
        "==========================================\n"
    );


    const appPath =
        path.join(
            __dirname,
            "app.js"
        );


    scannerProcess =
        spawn(
            process.execPath,
            [appPath],
            {
                cwd: path.dirname(
                    appPath
                ),

                env: {
                    ...process.env
                },

                stdio: [
                    "inherit",
                    "inherit",
                    "inherit"
                ]
            }
        );


    // ========================================================
    // SAFETY TIMEOUT
    // ========================================================

    const timeout =
        setTimeout(
            () => {

                if (
                    scannerRunning &&
                    scannerProcess
                ) {

                    console.log(
                        "\n⚠️ Scanner exceeded safety timeout."
                    );

                    console.log(
                        "🛑 Terminating scanner process.\n"
                    );


                    scannerProcess.kill(
                        "SIGTERM"
                    );

                }

            },

            SCAN_TIMEOUT_MINUTES *
            60 *
            1000
        );


    // ========================================================
    // SCANNER FINISHED
    // ========================================================

    scannerProcess.on(
        "close",
        code => {

            clearTimeout(
                timeout
            );


            scannerRunning =
                false;

            scannerProcess =
                null;


            console.log(
                "\n=========================================="
            );

            if (
                code === 0
            ) {

                console.log(
                    "✅ AUTOMATIC SCAN COMPLETED"
                );

            }
            else {

                console.log(
                    `⚠️ Scanner exited with code: ${code}`
                );

            }


            console.log(
                `🇮🇳 India Time: ${formatTime(
                    getIndiaTime()
                )}`
            );

            console.log(
                "==========================================\n"
            );

        }
    );


    scannerProcess.on(
        "error",
        error => {

            clearTimeout(
                timeout
            );


            scannerRunning =
                false;

            scannerProcess =
                null;


            console.error(
                "\n❌ Failed to start scanner:"
            );

            console.error(
                error.message
            );

        }
    );

}


// ============================================================
// CALCULATE NEXT SCAN
// ============================================================

function calculateNextScanDelay() {

    const now =
        getIndiaTime();


    // --------------------------------------------------------
    // Weekend
    // --------------------------------------------------------

    if (
        !isTradingDay(now)
    ) {

        return getNextTradingDayDelay(
            now
        );

    }


    const currentMinutes =
        timeToMinutes(now);


    const startMinutes =
        SCAN_START_HOUR * 60 +
        SCAN_START_MINUTE;


    const endMinutes =
        SCAN_END_HOUR * 60 +
        SCAN_END_MINUTE;


    // --------------------------------------------------------
    // Before market
    // --------------------------------------------------------

    if (
        currentMinutes < startMinutes
    ) {

        const target =
            new Date(now);


        target.setHours(
            SCAN_START_HOUR,
            SCAN_START_MINUTE,
            0,
            0
        );


        return (
            target.getTime() -
            now.getTime()
        );

    }


    // --------------------------------------------------------
    // After market
    // --------------------------------------------------------

    if (
        currentMinutes > endMinutes
    ) {

        return getNextTradingDayDelay(
            now
        );

    }


    // --------------------------------------------------------
    // Market is open
    // --------------------------------------------------------

    const intervalMs =
        SCAN_INTERVAL_MINUTES *
        60 *
        1000;


    const elapsedSinceMidnight =
        (
            now.getHours() * 60 +
            now.getMinutes()
        ) *
        60 *
        1000
        +
        now.getSeconds() *
        1000
        +
        now.getMilliseconds();


    const startSinceMidnight =
        (
            SCAN_START_HOUR * 60 +
            SCAN_START_MINUTE
        ) *
        60 *
        1000;


    const elapsed =
        elapsedSinceMidnight -
        startSinceMidnight;


    const intervalsPassed =
        Math.ceil(
            elapsed /
            intervalMs
        );


    let nextTime =
        startSinceMidnight +
        intervalsPassed *
        intervalMs;


    // --------------------------------------------------------
    // Never schedule after market close
    // --------------------------------------------------------

    const endSinceMidnight =
        (
            SCAN_END_HOUR * 60 +
            SCAN_END_MINUTE
        ) *
        60 *
        1000;


    if (
        nextTime >
        endSinceMidnight
    ) {

        return getNextTradingDayDelay(
            now
        );

    }


    return (
        nextTime -
        elapsedSinceMidnight
    );

}


// ============================================================
// NEXT TRADING DAY
// ============================================================

function getNextTradingDayDelay(
    currentDate
) {

    const next =
        new Date(
            currentDate
        );


    next.setDate(
        next.getDate() + 1
    );


    next.setHours(
        SCAN_START_HOUR,
        SCAN_START_MINUTE,
        0,
        0
    );


    while (
        !isTradingDay(next)
    ) {

        next.setDate(
            next.getDate() + 1
        );

    }


    return (
        next.getTime() -
        currentDate.getTime()
    );

}


// ============================================================
// SCHEDULE NEXT SCAN
// ============================================================

function scheduleNextScan() {

    if (
        nextScanTimer
    ) {

        clearTimeout(
            nextScanTimer
        );

        nextScanTimer =
            null;

    }


    const now =
        getIndiaTime();


    const delay =
        calculateNextScanDelay();


    const nextScanTime =
        new Date(
            now.getTime() +
            delay
        );


    console.log(
        "=========================================="
    );

    console.log(
        "⏰ NEXT AUTOMATIC SCAN"
    );

    console.log(
        `Current India Time : ${formatTime(now)}`
    );

    console.log(
        `Next Scan          : ${formatTime(
            nextScanTime
        )}`
    );

    console.log(
        "==========================================\n"
    );


    nextScanTimer =
        setTimeout(
            () => {

                const current =
                    getIndiaTime();


                if (
                    isMarketHours(
                        current
                    )
                ) {

                    runScanner();

                }
                else {

                    console.log(
                        "\n⏸️ Market is closed."
                    );

                }


                scheduleNextScan();

            },

            Math.max(
                delay,
                1000
            )
        );

}


// ============================================================
// START SCHEDULER
// ============================================================

function startScheduler() {

    console.log(
        "\n=========================================="
    );

    console.log(
        "   AI SMART SCANNER"
    );

    console.log(
        "   AUTOMATIC MARKET SCHEDULER"
    );

    console.log(
        "=========================================="
    );

    console.log(
        "📅 Trading Days : Monday - Friday"
    );

    console.log(
        "🕘 Start         : 09:15 IST"
    );

    console.log(
        "🕞 Stop          : 15:30 IST"
    );

    console.log(
        `🔄 Interval      : Every ${
            SCAN_INTERVAL_MINUTES
        } minutes`
    );

    console.log(
        "==========================================\n"
    );


    const now =
        getIndiaTime();


    // --------------------------------------------------------
    // If market is currently open
    // --------------------------------------------------------

    if (
        isMarketHours(now)
    ) {

        console.log(
            `🟢 Market hours active: ${formatTime(now)}`
        );


        // Run immediately
        runScanner();

    }


    // --------------------------------------------------------
    // Schedule future scan
    // --------------------------------------------------------

    scheduleNextScan();

}


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

function shutdown() {

    console.log(
        "\n🛑 Scheduler shutting down..."
    );


    if (
        nextScanTimer
    ) {

        clearTimeout(
            nextScanTimer
        );

    }


    if (
        scannerProcess
    ) {

        console.log(
            "🛑 Stopping active scanner..."
        );


        scannerProcess.kill(
            "SIGTERM"
        );

    }


    process.exit(
        0
    );

}


process.on(
    "SIGINT",
    shutdown
);


process.on(
    "SIGTERM",
    shutdown
);


// ============================================================
// START
// ============================================================

startScheduler();