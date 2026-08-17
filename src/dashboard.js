// ============================================================
// AI SMART SCANNER - DASHBOARD ENGINE
// ============================================================
//
// DASHBOARD:
// Stock | CE / PE | Stock Entry | Stock SL | Stock Target | Mood | ADX
//
// RULE:
// - ONLY 85+ CONFIDENCE CANDIDATES
// - ENTRY / SL / TARGET = STOCK PRICE
// - OPTION PREMIUM IS NEVER USED FOR MAIN DASHBOARD LEVELS
// - Strike / option details remain separate
// - No artificial targets
// - T2 preferred, T1 fallback
// - Broker independent
// ============================================================


// ============================================================
// IST DATE / TIME HELPERS
// ============================================================

function getISTDateParts(date = new Date()) {

    const parts =
        new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23"
            }
        ).formatToParts(date);

    const values = {};

    for (const part of parts) {

        if (part.type !== "literal") {
            values[part.type] = part.value;
        }

    }

    return values;
}


// ============================================================
// IST ISO TIMESTAMP
// ============================================================

function getISTTimestamp(date = new Date()) {

    const parts =
        getISTDateParts(date);

    return (
        `${parts.year}-${parts.month}-${parts.day}` +
        `T${parts.hour}:${parts.minute}:${parts.second}+05:30`
    );
}


// ============================================================
// IST MINUTES
// ============================================================

function getISTMinutes(date = new Date()) {

    const parts =
        getISTDateParts(date);

    return (
        Number(parts.hour) * 60 +
        Number(parts.minute)
    );
}


// ============================================================
// IST WEEKDAY
// ============================================================

function getISTWeekday(date = new Date()) {

    const parts =
        getISTDateParts(date);

    const year =
        Number(parts.year);

    const month =
        Number(parts.month);

    const day =
        Number(parts.day);

    return new Date(
        Date.UTC(
            year,
            month - 1,
            day
        )
    ).getUTCDay();
}


// ============================================================
// SAFE NUMBER
// ============================================================

function safeNumber(value, fallback = 0) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


// ============================================================
// GET NESTED VALUE
// ============================================================

function getNestedValue(
    object,
    paths = []
) {

    if (
        !object ||
        typeof object !== "object"
    ) {
        return undefined;
    }

    for (const path of paths) {

        const parts =
            String(path).split(".");

        let current =
            object;

        let valid = true;

        for (const part of parts) {

            if (
                current === null ||
                current === undefined ||
                typeof current !== "object" ||
                !(part in current)
            ) {
                valid = false;
                break;
            }

            current =
                current[part];
        }

        if (valid) {
            return current;
        }

    }

    return undefined;
}


// ============================================================
// GET OPTION TYPE
// ============================================================

function getOptionType(option) {

    if (
        !option ||
        typeof option !== "object"
    ) {
        return "";
    }

    const directType =
        String(
            option.optionType ||
            option.option_type ||
            option.direction ||
            option.type ||
            ""
        )
        .trim()
        .toUpperCase();

    if (
        directType === "CALL" ||
        directType === "CE"
    ) {
        return "CALL";
    }

    if (
        directType === "PUT" ||
        directType === "PE"
    ) {
        return "PUT";
    }

    const optionSymbol =
        String(
            option.optionSymbol ||
            option.option_symbol ||
            option.tradingSymbol ||
            option.trading_symbol ||
            ""
        )
        .trim()
        .toUpperCase();

    if (
        optionSymbol.includes(" CE") ||
        optionSymbol.endsWith("CE")
    ) {
        return "CALL";
    }

    if (
        optionSymbol.includes(" PE") ||
        optionSymbol.endsWith("PE")
    ) {
        return "PUT";
    }

    return "";
}


// ============================================================
// GET CONFIDENCE
// ============================================================

function getConfidence(option) {

    return safeNumber(
        getNestedValue(
            option,
            [
                "optionsConfidence",
                "optionConfidence",
                "confidence",
                "score.confidence",
                "decision.confidence"
            ]
        ),
        0
    );
}


// ============================================================
// IMPORTANT:
// STOCK ENTRY ONLY
// ============================================================

function getStockEntry(option) {

    return getNestedValue(
        option,
        [
            "entry",
            "stockEntry",
            "stock_entry",
            "tradeSetup.entry",
            "tradeSetup.stockEntry"
        ]
    );
}


// ============================================================
// IMPORTANT:
// STOCK STOP LOSS ONLY
// ============================================================

function getStockStopLoss(option) {

    return getNestedValue(
        option,
        [
            "stopLoss",
            "stockStopLoss",
            "stock_stop_loss",
            "tradeSetup.stopLoss",
            "tradeSetup.stockStopLoss"
        ]
    );
}


// ============================================================
// IMPORTANT:
// STOCK TARGET 2 ONLY
// ============================================================

function getStockTarget2(option) {

    return getNestedValue(
        option,
        [
            "target2",
            "stockTarget2",
            "stock_target_2",
            "tradeSetup.target2",
            "tradeSetup.stockTarget2"
        ]
    );
}


// ============================================================
// IMPORTANT:
// STOCK TARGET 1 ONLY
// ============================================================

function getStockTarget1(option) {

    return getNestedValue(
        option,
        [
            "target1",
            "stockTarget1",
            "stock_target_1",
            "tradeSetup.target1",
            "tradeSetup.stockTarget1"
        ]
    );
}


// ============================================================
// GET RISK REWARD
// ============================================================

function getRiskReward(option) {

    return safeNumber(
        getNestedValue(
            option,
            [
                "riskReward",
                "optionRiskReward",
                "option_risk_reward",
                "rr",
                "riskRewardRatio"
            ]
        ),
        0
    );
}


// ============================================================
// GET ADX
// ============================================================

function getADX(option) {

    const value =
        getNestedValue(
            option,
            [
                "adx",
                "ADX",
                "indicators.adx",
                "indicators.ADX",
                "indicatorData.adx",
                "indicatorData.ADX"
            ]
        );

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "";
    }

    return value;
}


// ============================================================
// GET OI MOOD
// ============================================================

function getMood(option) {

    const mood =
        getNestedValue(
            option,
            [
                "oiMood",
                "OIMood",
                "oi_mood",
                "mood",
                "optionMood"
            ]
        );

    return String(
        mood || ""
    )
        .trim()
        .toUpperCase();
}


// ============================================================
// GET STOCK NAME
// ============================================================

function getStockName(option) {

    return (
        option.stock ||
        option.symbol ||
        option.tradingSymbol ||
        option.trading_symbol ||
        option.name ||
        ""
    );
}


// ============================================================
// BUILD DASHBOARD
// ============================================================

function buildDashboard(
    results = [],
    optionDecisions = [],
    totalStocks = 0
) {

    if (!Array.isArray(results)) {
        results = [];
    }

    if (!Array.isArray(optionDecisions)) {
        optionDecisions = [];
    }


    // ========================================================
    // TOTAL
    // ========================================================

    const total =
        Number(totalStocks) > 0
            ? Number(totalStocks)
            : results.length;


    // ========================================================
    // SUCCESS / FAILED
    // ========================================================

    const successfulScans =
        results.filter(
            row =>
                row &&
                typeof row === "object"
        ).length;

    const failedScans =
        Math.max(
            0,
            total - successfulScans
        );


    // ========================================================
    // LAST SCAN
    // ========================================================

    const lastScan =
        getISTTimestamp();


    // ========================================================
    // MARKET STATUS
    // ========================================================

    const currentMinutes =
        getISTMinutes();

    const weekday =
        getISTWeekday();

    const marketOpen =
        9 * 60 + 15;

    const marketClose =
        15 * 60 + 30;

    const isWeekday =
        weekday >= 1 &&
        weekday <= 5;

    const marketStatus =
        isWeekday &&
        currentMinutes >= marketOpen &&
        currentMinutes <= marketClose
            ? "Market Open"
            : "Market Closed";


    // ========================================================
    // OPTION COUNTS
    // ========================================================

    const callCount =
        optionDecisions.filter(
            option =>
                getOptionType(option) === "CALL"
        ).length;

    const putCount =
        optionDecisions.filter(
            option =>
                getOptionType(option) === "PUT"
        ).length;

    const noDirectionCount =
        optionDecisions.filter(
            option =>
                !getOptionType(option)
        ).length;


    // ========================================================
    // DECISION COUNTS
    // ========================================================

    const getDecision =
        option =>

            String(
                option.optionsDecision ||
                option.optionDecision ||
                option.decision ||
                ""
            )
                .trim()
                .toUpperCase();

    const tradeCount =
        optionDecisions.filter(
            option =>
                getDecision(option) === "TRADE"
        ).length;

    const watchCount =
        optionDecisions.filter(
            option =>
                getDecision(option) === "WATCH"
        ).length;

    const rejectCount =
        optionDecisions.filter(
            option =>
                getDecision(option) === "REJECT"
        ).length;


    // ========================================================
    // 85+ QUALITY CANDIDATES
    // ========================================================

    const qualityCandidates =
        optionDecisions.filter(
            option => {

                const confidence =
                    getConfidence(option);

                const type =
                    getOptionType(option);

                const entry =
                    safeNumber(
                        getStockEntry(option),
                        0
                    );

                const stopLoss =
                    safeNumber(
                        getStockStopLoss(option),
                        0
                    );

                return (
                    confidence >= 85 &&
                    (
                        type === "CALL" ||
                        type === "PUT"
                    ) &&
                    entry > 0 &&
                    stopLoss > 0
                );
            }
        );


    // ========================================================
    // SORT 85+
    // ========================================================

    const sortedOptions =
        [...qualityCandidates]
            .sort(
                (a, b) => {

                    const confidenceA =
                        getConfidence(a);

                    const confidenceB =
                        getConfidence(b);

                    if (
                        confidenceB !==
                        confidenceA
                    ) {
                        return (
                            confidenceB -
                            confidenceA
                        );
                    }

                    return (
                        getRiskReward(b) -
                        getRiskReward(a)
                    );
                }
            );


    // ========================================================
    // TOP 10
    // ========================================================

    const top10 =
        sortedOptions
            .slice(0, 10)
            .map(
                (
                    option,
                    index
                ) => {

                    const type =
                        getOptionType(option);

                    const cePe =
                        type === "CALL"
                            ? "CE"
                            : type === "PUT"
                                ? "PE"
                                : "";

                    // ----------------------------------------
                    // STOCK VALUES ONLY
                    // ----------------------------------------

                    const stockEntry =
                        getStockEntry(option);

                    const stockSL =
                        getStockStopLoss(option);

                    const stockT2 =
                        getStockTarget2(option);

                    const stockT1 =
                        getStockTarget1(option);

                    const stockTarget =
                        stockT2 !== null &&
                        stockT2 !== undefined &&
                        stockT2 !== ""
                            ? stockT2
                            : stockT1 !== null &&
                              stockT1 !== undefined &&
                              stockT1 !== ""
                                ? stockT1
                                : "";

                    return {

                        rank:
                            index + 1,

                        stock:
                            getStockName(option),

                        cePe,

                        // STOCK PRICE
                        entry:
                            stockEntry ?? "",

                        // STOCK SL
                        stopLoss:
                            stockSL ?? "",

                        // STOCK TARGET
                        target:
                            stockTarget,

                        mood:
                            getMood(option),

                        adx:
                            getADX(option)
                    };
                }
            );


    // ========================================================
    // DASHBOARD COUNTS
    // ========================================================

    const strongBuy =
        qualityCandidates.length;

    const buy = 0;

    const watch = 0;

    const avoid = 0;


    // ========================================================
    // MARKET MOOD
    // ========================================================

    let marketMood =
        "NEUTRAL";

    if (
        callCount >
        putCount
    ) {
        marketMood =
            "BULLISH";
    }
    else if (
        putCount >
        callCount
    ) {
        marketMood =
            "BEARISH";
    }


    // ========================================================
    // HEADERS
    // ========================================================

    const headers = [

        "Stock",
        "CE / PE",
        "Stock Entry",
        "Stock SL",
        "Stock Target",
        "Mood",
        "ADX"

    ];


    // ========================================================
    // SUMMARY
    // ========================================================

    const summary = {

        "Last Scan":
            lastScan,

        "Market Status":
            marketStatus,

        "Total Stocks":
            total,

        "Successful Scans":
            successfulScans,

        "Failed Scans":
            failedScans,

        "Strong Buy (85+)":
            strongBuy,

        "Market Mood":
            marketMood,

        "CALL":
            callCount,

        "PUT":
            putCount,

        "No Direction":
            noDirectionCount,

        "TRADE":
            tradeCount,

        "WATCH Decisions":
            watchCount,

        "REJECT":
            rejectCount
    };


    // ========================================================
    // FINAL
    // ========================================================

    return {

        generatedAt:
            lastScan,

        summary,

        headers,

        top10,

        lastScan,

        marketStatus,

        totalStocks:
            total,

        successfulScans,

        failedScans,

        strongBuy,

        buy,

        watch,

        avoid,

        mood:
            marketMood,

        top10Count:
            top10.length,

        callCount,

        putCount,

        noDirectionCount,

        tradeCount,

        watchCount,

        rejectCount,

        dashboardMinScore:
            85,

        dashboardFilter:
            "CONFIDENCE >= 85"
    };
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    buildDashboard

};