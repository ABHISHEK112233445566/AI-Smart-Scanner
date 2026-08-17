require("dotenv").config();

const symbols = require("./symbols/nifty100");

const {
    setBroker,
    getActiveBroker
} = require("./brokers");

const {
    loadSymbolMaster
} = require("./services/symbolService");

const {
    scanStock
} = require("./scanner");

const {
    calculateOptionsDecisions
} = require("./optionsDecisionEngine");

const {
    updateGoogleSheet
} = require("./googleSheet");

const {
    buildDashboard
} = require("./dashboard");


// ============================================================
// AI SMART SCANNER
// ============================================================

async function main() {

    const scanStartedAt =
        new Date();


    console.log("\n===============================");
    console.log("   AI SMART SCANNER STARTED");
    console.log("===============================\n");


    // ========================================================
    // ACTIVE BROKER
    // ========================================================

    const brokerName =
        process.env.BROKER ||
        "ANGELONE";


    console.log(
        `Broker Configuration: ${brokerName}`
    );


    try {

        setBroker(
            brokerName
        );

    }
    catch (error) {

        console.error(
            "❌ Unable to configure active broker."
        );

        console.error(
            error?.message ||
            error
        );

        throw error;

    }


    // ========================================================
    // GET ACTIVE BROKER
    // ========================================================

    let activeBroker;

    try {

        activeBroker =
            getActiveBroker();

    }
    catch (error) {

        console.error(
            "❌ Unable to determine active broker."
        );

        console.error(
            error?.message ||
            error
        );

        throw error;

    }


    console.log(
        "Active Broker:",
        activeBroker?.name ||
        brokerName
    );


    // ========================================================
    // BROKER LOGIN
    // ========================================================

    console.log(
        "\n🔐 Logging into broker...\n"
    );


    try {

        if (
            !activeBroker ||
            typeof activeBroker.login !== "function"
        ) {

            throw new Error(
                "Active broker does not implement login()"
            );

        }


        await activeBroker.login();


        console.log(
            "✅ Broker Login Successful\n"
        );

    }
    catch (error) {

        console.error(
            "❌ Broker Login Failed."
        );

        console.error(
            error?.message ||
            error
        );

        throw error;

    }


    // ========================================================
    // LOAD SYMBOL MASTER
    // ========================================================

    try {

        await loadSymbolMaster();

        console.log(
            "✅ Symbol master loaded successfully.\n"
        );

    }
    catch (error) {

        console.log(
            `⚠️ Symbol master load skipped: ${
                error?.message ||
                error
            }`
        );

        console.log(
            "Scanner will continue using available symbol configuration.\n"
        );

    }


    // ========================================================
    // SYMBOL VALIDATION
    // ========================================================

    if (
        !Array.isArray(symbols) ||
        symbols.length === 0
    ) {

        throw new Error(
            "No NIFTY 100 scanner symbols configured."
        );

    }


    // ========================================================
    // NIFTY 100 CONFIRMATION
    // ========================================================

    console.log(
        "\n========================================"
    );

    console.log(
        "        NIFTY 100 SCANNER"
    );

    console.log(
        "========================================"
    );

    console.log(
        `Total NIFTY 100 Stocks Loaded: ${symbols.length}`
    );

    console.log(
        "Universe: NIFTY 100"
    );

    console.log(
        "========================================\n"
    );


    // ========================================================
    // SCAN ALL STOCKS
    // ========================================================

    const results = [];

    const failedStocks = [];

    const BATCH_SIZE = 5;


    for (
        let i = 0;
        i < symbols.length;
        i += BATCH_SIZE
    ) {

        const batch =
            symbols.slice(
                i,
                i + BATCH_SIZE
            );


        const batchEnd =
            Math.min(
                i + BATCH_SIZE,
                symbols.length
            );


        console.log(
            `\n🚀 Scanning batch ${
                i + 1
            } - ${
                batchEnd
            } / ${
                symbols.length
            }`
        );


        const batchResults =
            await Promise.all(

                batch.map(
                    async (stock) => {

                        const stockName =
                            typeof stock === "string"
                                ? stock
                                : stock?.name ||
                                  stock?.symbol ||
                                  "UNKNOWN";


                        try {

                            console.log(
                                `🔍 Scanning ${stockName}...`
                            );


                            const result =
                                await scanStock(
                                    stock
                                );


                            if (result) {

                                return {

                                    success: true,

                                    stock: stockName,

                                    result

                                };

                            }


                            return {

                                success: false,

                                stock: stockName,

                                result: null,

                                error:
                                    "scanStock returned no result"

                            };

                        }
                        catch (error) {

                            const message =
                                error?.message ||
                                String(error);


                            console.log(
                                `❌ ${stockName}: ${message}`
                            );


                            return {

                                success: false,

                                stock: stockName,

                                result: null,

                                error: message

                            };

                        }

                    }
                )

            );


        // ====================================================
        // STORE BATCH RESULTS
        // ====================================================

        for (
            const item
            of batchResults
        ) {

            if (
                item.success &&
                item.result
            ) {

                results.push(
                    item.result
                );

            }
            else {

                failedStocks.push({

                    stock:
                        item.stock,

                    error:
                        item.error ||
                        "Unknown scan error"

                });

            }

        }


        console.log(
            `Batch completed: ${
                batchResults.filter(
                    item => item.success
                ).length
            } successful / ${
                batchResults.length
            } attempted`
        );

    }


    // ========================================================
    // SCAN SUMMARY
    // ========================================================

    const successfulScans =
        results.length;


    const failedScans =
        failedStocks.length;


    console.log(
        "\n========== NIFTY 100 SCAN SUMMARY ==========\n"
    );


    console.log(
        `Total NIFTY 100 Stocks: ${symbols.length}`
    );

    console.log(
        `Successful Scans: ${successfulScans}`
    );

    console.log(
        `Failed Scans: ${failedScans}`
    );


    if (
        failedStocks.length > 0
    ) {

        console.log(
            "\nFailed Stocks:"
        );


        failedStocks.forEach(
            item => {

                console.log(
                    `- ${item.stock}: ${item.error}`
                );

            }
        );

    }


    // ========================================================
    // FILTER DEBUG
    // ========================================================

    console.log(
        "\n========== FILTER DEBUG ==========\n"
    );


    results.forEach(
        stock => {

            console.log({

                stock:
                    stock?.stock,

                dailyTrend:
                    stock?.dailyTrend,

                fourHourTrend:
                    stock?.fourHourTrend,

                oneHourTrend:
                    stock?.oneHourTrend,

                fifteenMinTrend:
                    stock?.fifteenMinTrend,

                rsi:
                    stock?.rsi,

                macd:
                    stock?.macd,

                macdSignal:
                    stock?.macdSignal,

                adx:
                    stock?.adx,

                pdi:
                    stock?.pdi,

                mdi:
                    stock?.mdi,

                vwap:
                    stock?.vwap,

                supertrend:
                    stock?.supertrend,

                signal:
                    stock?.signal,

                score:
                    stock?.score,

                finalScore:
                    stock?.finalScore,

                mtfScore:
                    stock?.mtfScore,

                ninetyPlusAligned:
                    stock?.ninetyPlusAligned

            });

        }
    );


    // ========================================================
    // OPTIONS DECISION ENGINE
    // ========================================================

    console.log(
        "\n========== OPTIONS DECISION ENGINE ==========\n"
    );


    let optionDecisions = [];


    try {

        const decisions =
            await calculateOptionsDecisions(
                results
            );


        if (
            Array.isArray(decisions)
        ) {

            optionDecisions =
                decisions;

        }
        else {

            console.error(
                "❌ Options Decision Engine did not return an array."
            );

            console.error(
                "Received:",
                decisions
            );

        }

    }
    catch (error) {

        console.error(
            "❌ Options Decision Engine failed:"
        );

        console.error(
            error?.message ||
            error
        );

        optionDecisions = [];

    }


    // ========================================================
    // SAFETY CHECK
    // ========================================================

    if (
        !Array.isArray(optionDecisions)
    ) {

        optionDecisions = [];

    }


    // ========================================================
    // SORT OPTIONS
    // ========================================================

    optionDecisions.sort(

        (a, b) => {

            const confidenceA =
                Number(
                    a?.optionsConfidence ??
                    a?.confidence ??
                    0
                );


            const confidenceB =
                Number(
                    b?.optionsConfidence ??
                    b?.confidence ??
                    0
                );


            if (
                confidenceB !==
                confidenceA
            ) {

                return (
                    confidenceB -
                    confidenceA
                );

            }


            const scoreA =
                Number(
                    a?.scannerScore ??
                    a?.finalScore ??
                    a?.score ??
                    0
                );


            const scoreB =
                Number(
                    b?.scannerScore ??
                    b?.finalScore ??
                    b?.score ??
                    0
                );


            if (
                scoreB !==
                scoreA
            ) {

                return (
                    scoreB -
                    scoreA
                );

            }


            const riskRewardA =
                Number(
                    a?.riskReward ??
                    a?.optionRiskReward ??
                    0
                );


            const riskRewardB =
                Number(
                    b?.riskReward ??
                    b?.optionRiskReward ??
                    0
                );


            return (
                riskRewardB -
                riskRewardA
            );

        }

    );


    // ========================================================
    // OPTIONS DECISION SUMMARY
    // ========================================================

    if (
        optionDecisions.length === 0
    ) {

        console.log(
            "No option candidates generated."
        );

    }
    else {

        optionDecisions.forEach(
            (option, index) => {

                const entry =
                    Number(
                        option?.entry ??
                        option?.optionEntry ??
                        0
                    );


                const stopLoss =
                    Number(
                        option?.stopLoss ??
                        option?.optionStopLoss ??
                        0
                    );


                const target1 =
                    Number(
                        option?.target1 ??
                        option?.optionTarget1 ??
                        0
                    );


                const target2 =
                    Number(
                        option?.target2 ??
                        option?.optionTarget2 ??
                        0
                    );


                const riskReward =
                    Number(
                        option?.riskReward ??
                        option?.optionRiskReward ??
                        0
                    );


                console.log(

                    `${index + 1}. ` +

                    `${option?.stock || "N/A"} | ` +

                    `${option?.optionType || "N/A"} | ` +

                    `Strike: ${
                        option?.recommendedStrike ??
                        "N/A"
                    } | ` +

                    `Entry: ${
                        entry.toFixed(2)
                    } | ` +

                    `SL: ${
                        stopLoss.toFixed(2)
                    } | ` +

                    `T1: ${
                        target1.toFixed(2)
                    } | ` +

                    `T2: ${
                        target2.toFixed(2)
                    } | ` +

                    `R:R: ${
                        riskReward.toFixed(2)
                    } | ` +

                    `Confidence: ${
                        option?.optionsConfidence ??
                        option?.confidence ??
                        0
                    } | ` +

                    `${
                        option?.optionsDecision ||
                        "N/A"
                    }`

                );

            }
        );

    }


    // ========================================================
    // CALL / PUT SUMMARY
    // ========================================================

    const callCount =
        optionDecisions.filter(
            option =>
                String(
                    option?.optionType || ""
                ).toUpperCase() === "CALL"
        ).length;


    const putCount =
        optionDecisions.filter(
            option =>
                String(
                    option?.optionType || ""
                ).toUpperCase() === "PUT"
        ).length;


    const noDirectionCount =
        optionDecisions.filter(
            option =>
                !option?.optionType
        ).length;


    const tradeCount =
        optionDecisions.filter(
            option =>
                String(
                    option?.optionsDecision || ""
                ).toUpperCase() === "TRADE"
        ).length;


    const watchCount =
        optionDecisions.filter(
            option =>
                String(
                    option?.optionsDecision || ""
                ).toUpperCase() === "WATCH"
        ).length;


    const rejectCount =
        optionDecisions.filter(
            option =>
                String(
                    option?.optionsDecision || ""
                ).toUpperCase() === "REJECT"
        ).length;


    console.log(
        "\n========== OPTIONS SUMMARY ==========\n"
    );


    console.log(
        `CALL Candidates: ${callCount}`
    );

    console.log(
        `PUT Candidates: ${putCount}`
    );

    console.log(
        `No Direction: ${noDirectionCount}`
    );

    console.log(
        `TRADE: ${tradeCount}`
    );

    console.log(
        `WATCH: ${watchCount}`
    );

    console.log(
        `REJECT: ${rejectCount}`
    );


    // ========================================================
    // DASHBOARD
    // ========================================================

    console.log(
        "\n========== DASHBOARD ==========\n"
    );


    let dashboardData = {

        lastScan:
            new Date().toLocaleString(
                "en-IN",
                {
                    timeZone:
                        "Asia/Kolkata"
                }
            ),

        marketStatus:
            "UNKNOWN",

        totalStocks:
            symbols.length,

        successfulScans,

        failedScans,

        strongBuy: 0,

        buy: 0,

        watch: 0,

        avoid: 0,

        callCount,

        putCount,

        top10: []

    };


    try {

        const builtDashboard =
            buildDashboard(
                results,
                optionDecisions,
                symbols.length
            );


        if (
            builtDashboard &&
            typeof builtDashboard === "object"
        ) {

            dashboardData =
                builtDashboard;

        }
        else {

            console.error(
                "⚠️ Dashboard builder returned invalid data."
            );

        }

    }
    catch (error) {

        console.error(
            "❌ Dashboard build failed:"
        );

        console.error(
            error?.message ||
            error
        );

    }


    console.log(
        `Last Scan: ${
            dashboardData.lastScan ??
            "N/A"
        }`
    );


    console.log(
        `Market Status: ${
            dashboardData.marketStatus ??
            "N/A"
        }`
    );


    console.log(
        `Total Stocks: ${
            dashboardData.totalStocks ??
            symbols.length
        }`
    );


    console.log(
        `Successful Scans: ${
            dashboardData.successfulScans ??
            successfulScans
        }`
    );


    console.log(
        `Failed Scans: ${
            dashboardData.failedScans ??
            failedScans
        }`
    );


    console.log(
        `Strong Buy: ${
            dashboardData.strongBuy ??
            0
        }`
    );


    console.log(
        `Buy: ${
            dashboardData.buy ??
            0
        }`
    );


    console.log(
        `Watch: ${
            dashboardData.watch ??
            0
        }`
    );


    console.log(
        `Avoid: ${
            dashboardData.avoid ??
            0
        }`
    );


    console.log(
        `CALL: ${
            dashboardData.callCount ??
            callCount
        }`
    );


    console.log(
        `PUT: ${
            dashboardData.putCount ??
            putCount
        }`
    );


    const dashboardStocks =
        Array.isArray(
            dashboardData.top10
        )
            ? dashboardData.top10
            : [];


    console.log(
        `Dashboard Stocks: ${
            dashboardStocks.length
        }`
    );


    console.log(
        "✅ Dashboard data prepared successfully."
    );


    // ========================================================
    // TOP 10 DISPLAY
    // ========================================================

    console.log(
        "\n========== TOP 10 DASHBOARD STOCKS ==========\n"
    );


    if (
        dashboardStocks.length === 0
    ) {

        console.log(
            "No stocks qualified for dashboard."
        );

    }
    else {

        dashboardStocks.forEach(
            (stock, index) => {

                console.log(

                    `${index + 1}. ` +

                    `${stock?.stock || "N/A"} | ` +

                    `${stock?.cePe || "N/A"} | ` +

                    `Entry: ${
                        stock?.entry ??
                        "N/A"
                    } | ` +

                    `SL: ${
                        stock?.stopLoss ??
                        "N/A"
                    } | ` +

                    `Target: ${
                        stock?.target ??
                        "N/A"
                    } | ` +

                    `Mood: ${
                        stock?.mood ??
                        "N/A"
                    } | ` +

                    `ADX: ${
                        stock?.adx ??
                        "N/A"
                    }`

                );

            }
        );

    }


    // ========================================================
    // GOOGLE SHEET
    // ========================================================

    console.log(
        "\n📤 Updating Google Sheets...\n"
    );


    try {

        await updateGoogleSheet(
            results,
            dashboardData
        );


        console.log(
            "\n✅ Google Sheet update completed."
        );

    }
    catch (error) {

        console.error(
            "\n❌ Google Sheet update failed:"
        );

        console.error(
            error?.message ||
            error
        );

    }


    // ========================================================
    // FINAL SUMMARY
    // ========================================================

    const durationMs =
        Date.now() -
        scanStartedAt.getTime();


    console.log(
        "\n==============================="
    );


    console.log(
        "   NIFTY 100 SCAN COMPLETED"
    );


    console.log(
        `   Successful: ${successfulScans}`
    );


    console.log(
        `   Failed: ${failedScans}`
    );


    console.log(
        `   Options: ${optionDecisions.length}`
    );


    console.log(
        `   Duration: ${
            (durationMs / 1000).toFixed(2)
        } sec`
    );


    console.log(
        "===============================\n"
    );


    return {

        success: true,

        activeBroker,

        universe:
            "NIFTY100",

        totalStocks:
            symbols.length,

        successfulScans,

        failedScans,

        failedStocks,

        optionsCandidates:
            optionDecisions.length,

        callCount,

        putCount,

        noDirectionCount,

        tradeCount,

        watchCount,

        rejectCount,

        results,

        optionDecisions,

        dashboardData

    };

}


// ============================================================
// START
// ============================================================

if (
    require.main === module
) {

    main()
        .catch(
            error => {

                console.error(
                    "\n❌ Fatal Scanner Error:\n"
                );

                console.error(
                    error?.message ||
                    error
                );

                process.exitCode = 1;

            }
        );

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    main

};