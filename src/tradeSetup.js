// ============================================================
// STOCK TRADE SETUP ENGINE V7
// ============================================================
// Purpose:
// - Calculate realistic STOCK Entry / SL / T1 / T2
// - Supports CALL and PUT
// - Uses technical support/resistance when reliable
// - Uses ATR as volatility sanity check / fallback
// - Does NOT use option premium
// - Does NOT force 2R
// - Calculates REAL R:R from actual levels
// - Prevents unrealistic technical SL
// - Prevents T1/T2 being too close
// - Prevents technically valid but poor-quality targets
// - BROKER INDEPENDENT
// - EXPORT COMPATIBLE WITH BOTH:
//      const calculateTradeSetup = require("./tradeSetup")
//   AND
//      const { calculateTradeSetup } = require("./tradeSetup")
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {

    // --------------------------------------------------------
    // Stop-loss
    // --------------------------------------------------------

    atrStopMultiplier: 1.20,
    atrStopBuffer: 0.15,

    minStopATR: 0.70,
    maxStopATR: 2.00,

    // --------------------------------------------------------
    // Targets
    // --------------------------------------------------------

    target1ATR: 0.80,
    target2ATR: 1.50,

    maxTargetATR: 2.50,

    minTargetATR: 0.35,
    maxTechnicalTargetATR: 2.50,

    // --------------------------------------------------------
    // Minimum T1/T2 separation
    // --------------------------------------------------------

    minTargetSeparationATR: 0.35,

    // --------------------------------------------------------
    // Technical level quality
    // --------------------------------------------------------

    technicalStopMaxATR: 2.00,

    // --------------------------------------------------------
    // Price precision
    // --------------------------------------------------------

    decimals: 2

};


// ============================================================
// SAFE NUMBER
// ============================================================

function num(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;

}


// ============================================================
// VALID POSITIVE LEVEL
// ============================================================

function validLevel(value) {

    const n = Number(value);

    return Number.isFinite(n) && n > 0
        ? n
        : null;

}


// ============================================================
// ROUND PRICE
// ============================================================

function roundPrice(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return null;
    }

    return Number(
        n.toFixed(CONFIG.decimals)
    );

}


// ============================================================
// GET DIRECTION
// ============================================================

function getDirection(
    stockData = {},
    optionData = {}
) {

    const raw =
        optionData.optionType ||
        optionData.type ||
        stockData.optionType ||
        stockData.optionTypeName ||
        stockData.direction ||
        "";

    const value =
        String(raw)
            .trim()
            .toUpperCase();

    if (
        value === "CALL" ||
        value === "CE"
    ) {
        return "CALL";
    }

    if (
        value === "PUT" ||
        value === "PE"
    ) {
        return "PUT";
    }

    return null;

}


// ============================================================
// COLLECT LEVELS
// ============================================================

function collectLevels(
    data,
    names
) {

    const levels = [];

    if (
        !data ||
        typeof data !== "object"
    ) {
        return levels;
    }

    for (const name of names) {

        const value =
            validLevel(data[name]);

        if (value !== null) {

            levels.push({
                name,
                value
            });

        }

    }

    return levels;

}


// ============================================================
// UNIQUE LEVELS
// ============================================================

function uniqueLevels(levels) {

    const map = new Map();

    for (const level of levels) {

        if (
            !level ||
            !Number.isFinite(level.value)
        ) {
            continue;
        }

        const key =
            level.value.toFixed(4);

        if (!map.has(key)) {

            map.set(
                key,
                level
            );

        }

    }

    return [...map.values()];

}


// ============================================================
// GET TECHNICAL LEVELS
// ============================================================

function getTechnicalLevels(
    stockData = {}
) {

    const supportNames = [

        "support1",
        "support2",
        "support3",

        "Support1",
        "Support2",
        "Support3",

        "s1",
        "s2",
        "s3",

        "S1",
        "S2",
        "S3",

        "pivotS1",
        "pivotS2",
        "pivotS3",

        "pivotSupport1",
        "pivotSupport2",
        "pivotSupport3",

        "previousLow",
        "previousLow1",
        "previousLow2",

        "prevLow",
        "prevLow1",
        "prevLow2",

        "priorLow",

        "swingLow",
        "swingLow1",
        "swingLow2",

        "recentLow",
        "recentLow1",
        "recentLow2",

        "dayLow",
        "dailyLow",

        "weeklyLow",
        "weekLow"

    ];


    const resistanceNames = [

        "resistance1",
        "resistance2",
        "resistance3",

        "Resistance1",
        "Resistance2",
        "Resistance3",

        "r1",
        "r2",
        "r3",

        "R1",
        "R2",
        "R3",

        "pivotR1",
        "pivotR2",
        "pivotR3",

        "pivotResistance1",
        "pivotResistance2",
        "pivotResistance3",

        "previousHigh",
        "previousHigh1",
        "previousHigh2",

        "prevHigh",
        "prevHigh1",
        "prevHigh2",

        "priorHigh",

        "swingHigh",
        "swingHigh1",
        "swingHigh2",

        "recentHigh",
        "recentHigh1",
        "recentHigh2",

        "dayHigh",
        "dailyHigh",

        "weeklyHigh",
        "weekHigh"

    ];


    let supports =
        collectLevels(
            stockData,
            supportNames
        );


    let resistances =
        collectLevels(
            stockData,
            resistanceNames
        );


    // --------------------------------------------------------
    // Nested pivot support/resistance
    // --------------------------------------------------------

    const pivot =
        stockData.pivot ||
        stockData.pivots ||
        stockData.Pivot ||
        {};


    const nestedSupports = [

        pivot.s1,
        pivot.s2,
        pivot.s3,

        pivot.S1,
        pivot.S2,
        pivot.S3,

        pivot.support1,
        pivot.support2,
        pivot.support3

    ];


    const nestedResistances = [

        pivot.r1,
        pivot.r2,
        pivot.r3,

        pivot.R1,
        pivot.R2,
        pivot.R3,

        pivot.resistance1,
        pivot.resistance2,
        pivot.resistance3

    ];


    for (const value of nestedSupports) {

        const level =
            validLevel(value);

        if (level !== null) {

            supports.push({
                name: "pivot",
                value: level
            });

        }

    }


    for (const value of nestedResistances) {

        const level =
            validLevel(value);

        if (level !== null) {

            resistances.push({
                name: "pivot",
                value: level
            });

        }

    }


    return {

        supports:
            uniqueLevels(supports),

        resistances:
            uniqueLevels(resistances)

    };

}


// ============================================================
// GET ATR
// ============================================================

function getATR(
    stockData = {}
) {

    const candidates = [

        stockData.atr,
        stockData.ATR,
        stockData.atrValue,
        stockData.averageTrueRange,

        stockData.indicators?.atr,
        stockData.indicators?.ATR,
        stockData.indicators?.atrValue,

        stockData.technical?.atr,
        stockData.technical?.ATR

    ];


    for (const value of candidates) {

        const n = Number(value);

        if (
            Number.isFinite(n) &&
            n > 0
        ) {
            return n;
        }

    }


    return 0;

}


// ============================================================
// SUPPORTS BELOW ENTRY
// ============================================================

function findSupportsBelow(
    supports,
    entry
) {

    return supports
        .filter(
            level =>
                level.value < entry
        )
        .sort(
            (a, b) =>
                b.value - a.value
        );

}


// ============================================================
// RESISTANCES ABOVE ENTRY
// ============================================================

function findResistancesAbove(
    resistances,
    entry
) {

    return resistances
        .filter(
            level =>
                level.value > entry
        )
        .sort(
            (a, b) =>
                a.value - b.value
        );

}


// ============================================================
// USABLE SUPPORTS
// ============================================================

function getUsableSupports(
    supports,
    entry,
    atr
) {

    if (atr <= 0) {
        return supports;
    }


    return supports.filter(
        level => {

            const distance =
                entry - level.value;

            const atrDistance =
                distance / atr;

            return (
                atrDistance >=
                CONFIG.minTargetATR &&

                atrDistance <=
                CONFIG.maxTechnicalTargetATR
            );

        }
    );

}


// ============================================================
// USABLE RESISTANCES
// ============================================================

function getUsableResistances(
    resistances,
    entry,
    atr
) {

    if (atr <= 0) {
        return resistances;
    }


    return resistances.filter(
        level => {

            const distance =
                level.value - entry;

            const atrDistance =
                distance / atr;

            return (
                atrDistance >=
                CONFIG.minTargetATR &&

                atrDistance <=
                CONFIG.maxTechnicalTargetATR
            );

        }
    );

}


// ============================================================
// TREND
// ============================================================

function getTrend(
    stockData = {}
) {

    let trend =
        String(
            stockData.trend ||
            stockData.direction ||
            stockData.marketTrend ||
            ""
        )
            .trim()
            .toUpperCase();


    if (
        trend === "CALL" ||
        trend === "CE"
    ) {
        trend = "BULLISH";
    }


    if (
        trend === "PUT" ||
        trend === "PE"
    ) {
        trend = "BEARISH";
    }


    if (trend) {
        return trend;
    }


    const ema20 =
        num(
            stockData.ema20 ||
            stockData.EMA20 ||
            stockData.indicators?.ema20
        );


    const ema50 =
        num(
            stockData.ema50 ||
            stockData.EMA50 ||
            stockData.indicators?.ema50
        );


    const ema100 =
        num(
            stockData.ema100 ||
            stockData.EMA100 ||
            stockData.indicators?.ema100
        );


    if (
        ema20 > 0 &&
        ema50 > 0 &&
        ema100 > 0
    ) {

        if (
            ema20 > ema50 &&
            ema50 > ema100
        ) {
            return "BULLISH";
        }


        if (
            ema20 < ema50 &&
            ema50 < ema100
        ) {
            return "BEARISH";
        }

    }


    return "SIDEWAYS";

}


// ============================================================
// CONFIDENCE
// ============================================================

function getConfidence(
    stockData = {}
) {

    let confidence =
        Number(
            stockData.optionsConfidence ??
            stockData.confidence ??
            stockData.aiScore ??
            stockData.score ??
            50
        );


    if (!Number.isFinite(confidence)) {
        confidence = 50;
    }


    return Math.max(
        0,
        Math.min(
            100,
            Math.round(confidence)
        )
    );

}


// ============================================================
// BUILD CALL STOP
// ============================================================

function buildCallStop(
    entry,
    atr,
    supports
) {

    let stopLoss = null;
    let stopSource = null;


    if (supports.length > 0) {

        const support =
            supports[0].value;

        const distance =
            entry - support;


        if (
            distance <=
            atr *
            CONFIG.technicalStopMaxATR
        ) {

            const technicalStop =
                support -
                atr *
                CONFIG.atrStopBuffer;

            const technicalRisk =
                entry -
                technicalStop;


            if (
                technicalRisk > 0 &&
                technicalRisk <=
                atr *
                CONFIG.technicalStopMaxATR
            ) {

                stopLoss =
                    technicalStop;

                stopSource =
                    supports[0].name;

            }

        }

    }


    if (stopLoss === null) {

        stopLoss =
            entry -
            atr *
            CONFIG.atrStopMultiplier;

        stopSource = "ATR";

    }


    if (stopLoss >= entry) {

        return {
            stopLoss: null,
            stopSource: null
        };

    }


    let risk =
        entry - stopLoss;


    if (
        risk <
        atr *
        CONFIG.minStopATR
    ) {

        stopLoss =
            entry -
            atr *
            CONFIG.minStopATR;

        stopSource =
            "ATR_MINIMUM";

    }


    risk =
        entry - stopLoss;


    if (
        risk >
        atr *
        CONFIG.maxStopATR
    ) {

        stopLoss =
            entry -
            atr *
            CONFIG.maxStopATR;

        stopSource =
            "ATR_MAXIMUM";

    }


    return {

        stopLoss:
            roundPrice(stopLoss),

        stopSource

    };

}


// ============================================================
// BUILD PUT STOP
// ============================================================

function buildPutStop(
    entry,
    atr,
    resistances
) {

    let stopLoss = null;
    let stopSource = null;


    if (resistances.length > 0) {

        const resistance =
            resistances[0].value;

        const distance =
            resistance - entry;


        if (
            distance <=
            atr *
            CONFIG.technicalStopMaxATR
        ) {

            const technicalStop =
                resistance +
                atr *
                CONFIG.atrStopBuffer;

            const technicalRisk =
                technicalStop -
                entry;


            if (
                technicalRisk > 0 &&
                technicalRisk <=
                atr *
                CONFIG.technicalStopMaxATR
            ) {

                stopLoss =
                    technicalStop;

                stopSource =
                    resistances[0].name;

            }

        }

    }


    if (stopLoss === null) {

        stopLoss =
            entry +
            atr *
            CONFIG.atrStopMultiplier;

        stopSource = "ATR";

    }


    if (stopLoss <= entry) {

        return {
            stopLoss: null,
            stopSource: null
        };

    }


    let risk =
        stopLoss - entry;


    if (
        risk <
        atr *
        CONFIG.minStopATR
    ) {

        stopLoss =
            entry +
            atr *
            CONFIG.minStopATR;

        stopSource =
            "ATR_MINIMUM";

    }


    risk =
        stopLoss - entry;


    if (
        risk >
        atr *
        CONFIG.maxStopATR
    ) {

        stopLoss =
            entry +
            atr *
            CONFIG.maxStopATR;

        stopSource =
            "ATR_MAXIMUM";

    }


    return {

        stopLoss:
            roundPrice(stopLoss),

        stopSource

    };

}


// ============================================================
// CALL TARGET VALIDATION
// ============================================================

function isValidCallTargetPair(
    entry,
    target1,
    target2,
    atr
) {

    if (
        !Number.isFinite(target1) ||
        !Number.isFinite(target2)
    ) {
        return false;
    }


    if (
        target1 <= entry ||
        target2 <= target1
    ) {
        return false;
    }


    const target1Distance =
        target1 - entry;

    const target2Distance =
        target2 - entry;

    const separation =
        target2 - target1;


    return (
        target1Distance >=
        atr *
        CONFIG.minTargetATR &&

        target2Distance <=
        atr *
        CONFIG.maxTargetATR &&

        separation >=
        atr *
        CONFIG.minTargetSeparationATR
    );

}


// ============================================================
// PUT TARGET VALIDATION
// ============================================================

function isValidPutTargetPair(
    entry,
    target1,
    target2,
    atr
) {

    if (
        !Number.isFinite(target1) ||
        !Number.isFinite(target2)
    ) {
        return false;
    }


    if (
        target1 >= entry ||
        target2 >= target1
    ) {
        return false;
    }


    const target1Distance =
        entry - target1;

    const target2Distance =
        entry - target2;

    const separation =
        target1 - target2;


    return (
        target1Distance >=
        atr *
        CONFIG.minTargetATR &&

        target2Distance <=
        atr *
        CONFIG.maxTargetATR &&

        separation >=
        atr *
        CONFIG.minTargetSeparationATR
    );

}


// ============================================================
// BUILD CALL TARGETS
// ============================================================

function buildCallTargets(
    entry,
    atr,
    resistances
) {

    const usable =
        getUsableResistances(
            resistances,
            entry,
            atr
        );


    let target1 = null;
    let target2 = null;

    let target1Source = null;
    let target2Source = null;


    if (usable.length >= 1) {

        target1 =
            usable[0].value;

        target1Source =
            usable[0].name;

    }


    if (
        target1 === null ||
        target1 - entry <
        atr *
        CONFIG.minTargetATR
    ) {

        target1 =
            entry +
            atr *
            CONFIG.target1ATR;

        target1Source =
            "ATR_T1";

    }


    if (usable.length >= 2) {

        const candidate =
            usable[1].value;

        const separation =
            candidate - target1;


        if (
            candidate > target1 &&
            separation >=
            atr *
            CONFIG.minTargetSeparationATR
        ) {

            target2 =
                candidate;

            target2Source =
                usable[1].name;

        }

    }


    if (target2 === null) {

        target2 =
            entry +
            atr *
            CONFIG.target2ATR;

        target2Source =
            "ATR_T2";

    }


    const minimumT2 =
        target1 +
        atr *
        CONFIG.minTargetSeparationATR;


    if (target2 < minimumT2) {

        target2 =
            minimumT2;

        target2Source =
            "ATR_T2_SEPARATION";

    }


    const maximumTarget =
        entry +
        atr *
        CONFIG.maxTargetATR;


    if (target2 > maximumTarget) {

        target2 =
            maximumTarget;

        target2Source =
            "ATR_MAX_TARGET";

    }


    if (target2 <= target1) {

        target1 =
            entry +
            atr *
            CONFIG.target1ATR;

        target1Source =
            "ATR_T1";

        target2 =
            entry +
            atr *
            CONFIG.target2ATR;

        target2Source =
            "ATR_T2";

    }


    if (
        !isValidCallTargetPair(
            entry,
            target1,
            target2,
            atr
        )
    ) {

        return {

            target1: null,
            target2: null,

            target1Source: null,
            target2Source: null

        };

    }


    return {

        target1:
            roundPrice(target1),

        target2:
            roundPrice(target2),

        target1Source,
        target2Source

    };

}


// ============================================================
// BUILD PUT TARGETS
// ============================================================

function buildPutTargets(
    entry,
    atr,
    supports
) {

    const usable =
        getUsableSupports(
            supports,
            entry,
            atr
        );


    let target1 = null;
    let target2 = null;

    let target1Source = null;
    let target2Source = null;


    if (usable.length >= 1) {

        target1 =
            usable[0].value;

        target1Source =
            usable[0].name;

    }


    if (
        target1 === null ||
        entry - target1 <
        atr *
        CONFIG.minTargetATR
    ) {

        target1 =
            entry -
            atr *
            CONFIG.target1ATR;

        target1Source =
            "ATR_T1";

    }


    if (usable.length >= 2) {

        const candidate =
            usable[1].value;

        const separation =
            target1 - candidate;


        if (
            candidate < target1 &&
            separation >=
            atr *
            CONFIG.minTargetSeparationATR
        ) {

            target2 =
                candidate;

            target2Source =
                usable[1].name;

        }

    }


    if (target2 === null) {

        target2 =
            entry -
            atr *
            CONFIG.target2ATR;

        target2Source =
            "ATR_T2";

    }


    const maximumT2 =
        target1 -
        atr *
        CONFIG.minTargetSeparationATR;


    if (target2 > maximumT2) {

        target2 =
            maximumT2;

        target2Source =
            "ATR_T2_SEPARATION";

    }


    const minimumTarget =
        entry -
        atr *
        CONFIG.maxTargetATR;


    if (target2 < minimumTarget) {

        target2 =
            minimumTarget;

        target2Source =
            "ATR_MAX_TARGET";

    }


    if (target2 >= target1) {

        target1 =
            entry -
            atr *
            CONFIG.target1ATR;

        target1Source =
            "ATR_T1";

        target2 =
            entry -
            atr *
            CONFIG.target2ATR;

        target2Source =
            "ATR_T2";

    }


    if (
        !isValidPutTargetPair(
            entry,
            target1,
            target2,
            atr
        )
    ) {

        return {

            target1: null,
            target2: null,

            target1Source: null,
            target2Source: null

        };

    }


    return {

        target1:
            roundPrice(target1),

        target2:
            roundPrice(target2),

        target1Source,
        target2Source

    };

}


// ============================================================
// BUILD COMMON RESULT
// ============================================================

function buildBaseResult(
    direction,
    entry,
    stockData,
    optionData
) {

    return {

        optionType:
            direction,

        optionSymbol:
            optionData.tradingSymbol ||
            optionData.optionSymbol ||
            stockData.optionSymbol ||
            null,

        instrumentKey:
            optionData.instrumentKey ||
            stockData.instrumentKey ||
            null,

        expiry:
            optionData.expiry ||
            stockData.expiry ||
            null,

        strike:
            validLevel(
                optionData.strike ||
                stockData.recommendedStrike
            ),

        lotSize:
            validLevel(
                optionData.lotSize ||
                stockData.lotSize
            ),

        entry,

        stopLoss: null,
        target1: null,
        target2: null,

        risk: null,
        reward: null,

        riskReward: 0,

        atr: null,

        stopSource: null,
        target1Source: null,
        target2Source: null,

        trend:
            getTrend(stockData),

        confidence:
            getConfidence(stockData),

        valid: false,

        reason: null

    };

}


// ============================================================
// MAIN TRADE SETUP FUNCTION
// ============================================================

function calculateTradeSetup(
    price,
    stockData = {},
    optionData = {}
) {

    // ========================================================
    // ENTRY
    // ========================================================

    const rawEntry =
        Number(price);


    if (
        !Number.isFinite(rawEntry) ||
        rawEntry <= 0
    ) {

        return {

            entry: null,

            stopLoss: null,
            target1: null,
            target2: null,

            risk: null,
            reward: null,

            riskReward: 0,

            valid: false,

            reason:
                "Invalid stock price"

        };

    }


    const entry =
        roundPrice(rawEntry);


    // ========================================================
    // DIRECTION
    // ========================================================

    const direction =
        getDirection(
            stockData,
            optionData
        );


    // ========================================================
    // NO DIRECTION
    // ========================================================

    if (!direction) {

        const result =
            buildBaseResult(
                null,
                entry,
                stockData,
                optionData
            );

        result.reason =
            "No valid CALL/PUT direction";

        return result;

    }


    // ========================================================
    // TECHNICAL LEVELS
    // ========================================================

    const levels =
        getTechnicalLevels(stockData);


    const supports =
        findSupportsBelow(
            levels.supports,
            entry
        );


    const resistances =
        findResistancesAbove(
            levels.resistances,
            entry
        );


    // ========================================================
    // ATR
    // ========================================================

    const atr =
        getATR(stockData);


    if (atr <= 0) {

        const result =
            buildBaseResult(
                direction,
                entry,
                stockData,
                optionData
            );

        result.reason =
            "ATR unavailable - cannot calculate realistic setup";

        return result;

    }


    // ========================================================
    // STOP
    // ========================================================

    let stopResult;


    if (direction === "CALL") {

        stopResult =
            buildCallStop(
                entry,
                atr,
                supports
            );

    } else {

        stopResult =
            buildPutStop(
                entry,
                atr,
                resistances
            );

    }


    const stopLoss =
        stopResult.stopLoss;

    const stopSource =
        stopResult.stopSource;


    if (stopLoss === null) {

        const result =
            buildBaseResult(
                direction,
                entry,
                stockData,
                optionData
            );

        result.atr =
            roundPrice(atr);

        result.reason =
            "Unable to create realistic stop-loss";

        return result;

    }


    // ========================================================
    // RISK
    // ========================================================

    const risk =
        roundPrice(
            Math.abs(
                entry - stopLoss
            )
        );


    if (
        !risk ||
        risk <= 0
    ) {

        const result =
            buildBaseResult(
                direction,
                entry,
                stockData,
                optionData
            );

        result.stopLoss =
            stopLoss;

        result.atr =
            roundPrice(atr);

        result.stopSource =
            stopSource;

        result.reason =
            "Invalid risk distance";

        return result;

    }


    // ========================================================
    // TARGETS
    // ========================================================

    let targetResult;


    if (direction === "CALL") {

        targetResult =
            buildCallTargets(
                entry,
                atr,
                resistances
            );

    } else {

        targetResult =
            buildPutTargets(
                entry,
                atr,
                supports
            );

    }


    const target1 =
        targetResult.target1;

    const target2 =
        targetResult.target2;

    const target1Source =
        targetResult.target1Source;

    const target2Source =
        targetResult.target2Source;


    // ========================================================
    // TARGET VALIDATION
    // ========================================================

    if (
        target1 === null ||
        target2 === null
    ) {

        const result =
            buildBaseResult(
                direction,
                entry,
                stockData,
                optionData
            );

        result.stopLoss =
            stopLoss;

        result.risk =
            risk;

        result.atr =
            roundPrice(atr);

        result.stopSource =
            stopSource;

        result.reason =
            "Unable to create realistic targets";

        return result;

    }


    // ========================================================
    // DIRECTION VALIDATION
    // ========================================================

    let directionValid = false;


    if (direction === "CALL") {

        directionValid =
            stopLoss < entry &&
            target1 > entry &&
            target2 > target1;

    }


    if (direction === "PUT") {

        directionValid =
            stopLoss > entry &&
            target1 < entry &&
            target2 < target1;

    }


    if (!directionValid) {

        const result =
            buildBaseResult(
                direction,
                entry,
                stockData,
                optionData
            );

        result.stopLoss =
            stopLoss;

        result.target1 =
            target1;

        result.target2 =
            target2;

        result.risk =
            risk;

        result.atr =
            roundPrice(atr);

        result.stopSource =
            stopSource;

        result.target1Source =
            target1Source;

        result.target2Source =
            target2Source;

        result.reason =
            "Trade levels violate CALL/PUT direction";

        return result;

    }


    // ========================================================
    // REWARD
    // ========================================================

    const reward =
        roundPrice(
            Math.abs(
                target2 - entry
            )
        );


    if (
        !reward ||
        reward <= 0
    ) {

        const result =
            buildBaseResult(
                direction,
                entry,
                stockData,
                optionData
            );

        result.stopLoss =
            stopLoss;

        result.target1 =
            target1;

        result.target2 =
            target2;

        result.risk =
            risk;

        result.atr =
            roundPrice(atr);

        result.stopSource =
            stopSource;

        result.target1Source =
            target1Source;

        result.target2Source =
            target2Source;

        result.reason =
            "Invalid reward distance";

        return result;

    }


    // ========================================================
    // REAL R:R
    // ========================================================

    const riskReward =
        risk > 0
            ? Number(
                (
                    reward /
                    risk
                ).toFixed(2)
            )
            : 0;


    // ========================================================
    // CONFIDENCE
    // ========================================================

    const confidence =
        getConfidence(stockData);


    // ========================================================
    // TREND
    // ========================================================

    const trend =
        getTrend(stockData);


    // ========================================================
    // FINAL VALID
    // ========================================================

    const valid =
        directionValid &&
        risk > 0 &&
        reward > 0 &&
        riskReward > 0;


    // ========================================================
    // REASON
    // ========================================================

    let reason =
        "Valid stock trade setup";


    if (
        valid &&
        riskReward < 1
    ) {

        reason =
            "Valid levels but unfavorable R:R";

    } else if (
        valid &&
        riskReward < 1.5
    ) {

        reason =
            "Valid setup with moderate R:R";

    } else if (
        valid &&
        riskReward < 2
    ) {

        reason =
            "Valid setup with good R:R";

    } else if (valid) {

        reason =
            "Valid setup with strong R:R";

    }


    // ========================================================
    // FINAL RESULT
    // ========================================================

    return {

        optionType:
            direction,

        optionSymbol:
            optionData.tradingSymbol ||
            optionData.optionSymbol ||
            stockData.optionSymbol ||
            null,

        instrumentKey:
            optionData.instrumentKey ||
            stockData.instrumentKey ||
            null,

        expiry:
            optionData.expiry ||
            stockData.expiry ||
            null,

        strike:
            validLevel(
                optionData.strike ||
                stockData.recommendedStrike
            ),

        lotSize:
            validLevel(
                optionData.lotSize ||
                stockData.lotSize
            ),

        // ----------------------------------------------------
        // STOCK LEVELS
        // ----------------------------------------------------

        entry,

        stopLoss,

        target1,

        target2,

        // ----------------------------------------------------
        // RISK
        // ----------------------------------------------------

        risk,

        reward,

        riskReward,

        // ----------------------------------------------------
        // ATR
        // ----------------------------------------------------

        atr:
            roundPrice(atr),

        // ----------------------------------------------------
        // SOURCES
        // ----------------------------------------------------

        stopSource,

        target1Source,

        target2Source,

        // ----------------------------------------------------
        // QUALITY
        // ----------------------------------------------------

        trend,

        confidence,

        valid,

        reason

    };

}


// ============================================================
// LEGACY FUNCTION
// ============================================================

function calculateTradeSetupLegacy(
    price,
    indicators = {}
) {

    return calculateTradeSetup(
        price,
        indicators,
        {
            optionType:
                indicators.optionType ||
                null
        }
    );

}


// ============================================================
// EXPORT
// ============================================================
//
// IMPORTANT:
// We export the main function itself AND attach the named
// functions as properties.
//
// Therefore ALL of these work:
//
// const calculateTradeSetup = require("./tradeSetup");
//
// const {
//     calculateTradeSetup
// } = require("./tradeSetup");
//
// const tradeSetup = require("./tradeSetup");
// tradeSetup.calculateTradeSetup(...);
//
// ============================================================

module.exports = calculateTradeSetup;

module.exports.calculateTradeSetup =
    calculateTradeSetup;

module.exports.calculateTradeSetupLegacy =
    calculateTradeSetupLegacy;

module.exports.getDirection =
    getDirection;

module.exports.getATR =
    getATR;

module.exports.getTechnicalLevels =
    getTechnicalLevels;

module.exports.CONFIG =
    CONFIG;