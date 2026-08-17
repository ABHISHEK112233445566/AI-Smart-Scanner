// ============================================================
// AI ENGINE V4
// ============================================================
// Purpose:
// - Calculate balanced technical score
// - Detect bullish / bearish / sideways conditions
// - Avoid artificially high scores
// - Correctly evaluate OBV direction
// - Require alignment for 90+ scores
// - Generate scanner recommendation
// - Generate ONE trade setup
// - Prevent trade setup from overwriting AI score fields
// - Provide quality fields for Options Decision Engine
// ============================================================

const {
    calculateTradeSetup
} = require("./tradeSetup");


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
// SAFE OBJECT
// ============================================================

function obj(value) {

    return (
        value &&
        typeof value === "object"
    )
        ? value
        : {};

}


// ============================================================
// NORMALIZE TREND
// ============================================================

function normalizeTrend(value) {

    return String(value || "")
        .trim()
        .toUpperCase();

}


// ============================================================
// GET MACD DATA
// ============================================================

function getMACD(indicators) {

    const macd =
        obj(indicators.macd);

    return {

        value:
            num(
                macd.MACD ??
                macd.macd
            ),

        signal:
            num(
                macd.signal ??
                macd.Signal
            ),

        histogram:
            num(
                macd.histogram ??
                macd.Histogram
            )

    };

}


// ============================================================
// GET ADX DATA
// ============================================================

function getADX(indicators) {

    const adx =
        obj(indicators.adx);

    return {

        value:
            num(
                adx.adx ??
                indicators.adxValue
            ),

        pdi:
            num(
                adx.pdi ??
                indicators.pdi
            ),

        mdi:
            num(
                adx.mdi ??
                indicators.mdi
            )

    };

}


// ============================================================
// GET BOLLINGER DATA
// ============================================================

function getBollinger(indicators) {

    const bollinger =
        obj(indicators.bollinger);

    return {

        middle:
            num(
                bollinger.middle ??
                bollinger.middleBand
            )

    };

}


// ============================================================
// GET SUPERTREND
// ============================================================

function getSupertrend(indicators) {

    return normalizeTrend(
        indicators.supertrend?.trend ??
        indicators.supertrend
    );

}


// ============================================================
// OBV DIRECTION
// ============================================================
// Supports multiple possible field names:
//
// obvTrend
// obvDirection
// obvSignal
// obvChange
// obvDelta
// obvSlope
//
// Important:
// A positive OBV number by itself is NOT bullish.
// OBV is cumulative, so its absolute value has no directional
// meaning without comparing it with its previous/current trend.
// ============================================================

function getOBVDirection(indicators) {

    const explicitTrend =
        normalizeTrend(
            indicators.obvTrend ??
            indicators.obvDirection ??
            indicators.obvSignal
        );


    if (
        explicitTrend.includes("BULL") ||
        explicitTrend.includes("UP") ||
        explicitTrend.includes("RISING") ||
        explicitTrend === "BUY"
    ) {

        return "BULLISH";

    }


    if (
        explicitTrend.includes("BEAR") ||
        explicitTrend.includes("DOWN") ||
        explicitTrend.includes("FALLING") ||
        explicitTrend === "SELL"
    ) {

        return "BEARISH";

    }


    const change =
        num(
            indicators.obvChange ??
            indicators.obvDelta ??
            indicators.obvSlope,
            NaN
        );


    if (
        Number.isFinite(change)
    ) {

        if (change > 0)
            return "BULLISH";

        if (change < 0)
            return "BEARISH";

    }


    return "UNKNOWN";

}


// ============================================================
// EMA ALIGNMENT
// ============================================================

function getBullishEMAAlignment(
    indicators,
    price
) {

    const ema20 =
        num(indicators.ema20);

    const ema50 =
        num(indicators.ema50);

    const ema100 =
        num(indicators.ema100);

    const ema200 =
        num(indicators.ema200);


    return {

        priceAbove20:
            ema20 > 0 &&
            price > ema20,

        priceAbove50:
            ema50 > 0 &&
            price > ema50,

        ema20Above50:
            ema20 > 0 &&
            ema50 > 0 &&
            ema20 > ema50,

        ema50Above100:
            ema50 > 0 &&
            ema100 > 0 &&
            ema50 > ema100,

        ema100Above200:
            ema100 > 0 &&
            ema200 > 0 &&
            ema100 > ema200

    };

}


function getBearishEMAAlignment(
    indicators,
    price
) {

    const ema20 =
        num(indicators.ema20);

    const ema50 =
        num(indicators.ema50);

    const ema100 =
        num(indicators.ema100);

    const ema200 =
        num(indicators.ema200);


    return {

        priceBelow20:
            ema20 > 0 &&
            price < ema20,

        priceBelow50:
            ema50 > 0 &&
            price < ema50,

        ema20Below50:
            ema20 > 0 &&
            ema50 > 0 &&
            ema20 < ema50,

        ema50Below100:
            ema50 > 0 &&
            ema100 > 0 &&
            ema50 < ema100,

        ema100Below200:
            ema100 > 0 &&
            ema200 > 0 &&
            ema100 < ema200

    };

}


// ============================================================
// CALCULATE BULLISH SCORE
// ============================================================

function calculateBullishScore(
    indicators = {},
    price = 0
) {

    indicators =
        obj(indicators);

    price =
        num(price);


    let score = 0;


    // ========================================================
    // TREND — 40 POINTS
    // ========================================================

    const ema =
        getBullishEMAAlignment(
            indicators,
            price
        );

    const vwap =
        num(indicators.vwap);


    if (ema.priceAbove20)
        score += 5;

    if (ema.priceAbove50)
        score += 5;

    if (ema.ema20Above50)
        score += 5;

    if (ema.ema50Above100)
        score += 5;

    if (ema.ema100Above200)
        score += 5;


    if (
        vwap > 0 &&
        price > vwap
    ) {

        score += 5;

    }


    const supertrend =
        getSupertrend(indicators);


    if (
        supertrend.includes("BUY") ||
        supertrend.includes("BULL") ||
        supertrend.includes("UP")
    ) {

        score += 10;

    }


    // ========================================================
    // MOMENTUM — 25 POINTS
    // ========================================================

    const rsi =
        num(indicators.rsi);

    if (
        rsi >= 55 &&
        rsi <= 70
    ) {

        score += 8;

    }


    const macd =
        getMACD(indicators);


    if (
        macd.value >
        macd.signal
    ) {

        score += 8;

    }


    if (
        macd.histogram > 0
    ) {

        score += 4;

    }


    const bollinger =
        getBollinger(indicators);


    if (
        bollinger.middle > 0 &&
        price > bollinger.middle
    ) {

        score += 5;

    }


    // ========================================================
    // VOLUME — 15 POINTS
    // ========================================================

    const rvol =
        num(indicators.rvol);


    if (
        rvol >= 1.2
    ) {

        score += 5;

    }


    if (
        indicators.volumeSpike === true
    ) {

        score += 5;

    }


    // IMPORTANT:
    // Do NOT check obv > 0.
    // Absolute OBV value is not directional.

    const obvDirection =
        getOBVDirection(indicators);


    if (
        obvDirection === "BULLISH"
    ) {

        score += 5;

    }


    // ========================================================
    // STRENGTH — 20 POINTS
    // ========================================================

    const adx =
        getADX(indicators);


    if (
        adx.value > 25
    ) {

        score += 10;

    }


    if (
        adx.pdi > adx.mdi
    ) {

        score += 10;

    }


    return Math.min(
        100,
        Math.round(score)
    );

}


// ============================================================
// CALCULATE BEARISH SCORE
// ============================================================

function calculateBearishScore(
    indicators = {},
    price = 0
) {

    indicators =
        obj(indicators);

    price =
        num(price);


    let score = 0;


    // ========================================================
    // TREND — 40 POINTS
    // ========================================================

    const ema =
        getBearishEMAAlignment(
            indicators,
            price
        );

    const vwap =
        num(indicators.vwap);


    if (ema.priceBelow20)
        score += 5;

    if (ema.priceBelow50)
        score += 5;

    if (ema.ema20Below50)
        score += 5;

    if (ema.ema50Below100)
        score += 5;

    if (ema.ema100Below200)
        score += 5;


    if (
        vwap > 0 &&
        price < vwap
    ) {

        score += 5;

    }


    const supertrend =
        getSupertrend(indicators);


    if (
        supertrend.includes("SELL") ||
        supertrend.includes("BEAR") ||
        supertrend.includes("DOWN")
    ) {

        score += 10;

    }


    // ========================================================
    // MOMENTUM — 25 POINTS
    // ========================================================

    const rsi =
        num(indicators.rsi);


    if (
        rsi >= 30 &&
        rsi <= 45
    ) {

        score += 8;

    }


    const macd =
        getMACD(indicators);


    if (
        macd.value <
        macd.signal
    ) {

        score += 8;

    }


    if (
        macd.histogram < 0
    ) {

        score += 4;

    }


    const bollinger =
        getBollinger(indicators);


    if (
        bollinger.middle > 0 &&
        price < bollinger.middle
    ) {

        score += 5;

    }


    // ========================================================
    // VOLUME — 15 POINTS
    // ========================================================

    const rvol =
        num(indicators.rvol);


    if (
        rvol >= 1.2
    ) {

        score += 5;

    }


    if (
        indicators.volumeSpike === true
    ) {

        score += 5;

    }


    // IMPORTANT:
    // Do NOT check obv > 0.
    // Absolute OBV value is not directional.

    const obvDirection =
        getOBVDirection(indicators);


    if (
        obvDirection === "BEARISH"
    ) {

        score += 5;

    }


    // ========================================================
    // STRENGTH — 20 POINTS
    // ========================================================

    const adx =
        getADX(indicators);


    if (
        adx.value > 25
    ) {

        score += 10;

    }


    if (
        adx.mdi > adx.pdi
    ) {

        score += 10;

    }


    return Math.min(
        100,
        Math.round(score)
    );

}


// ============================================================
// 90+ ALIGNMENT
// ============================================================
// A raw score of 90 is NOT sufficient.
//
// 90+ is allowed only when the important technical components
// agree with the same direction.
//
// This prevents a stock from receiving an "elite" score because
// many weak/partial conditions happen to add up to 90.
// ============================================================

function check90PlusAlignment(
    indicators = {},
    price = 0,
    direction = "SIDEWAYS",
    score = 0
) {

    indicators =
        obj(indicators);

    price =
        num(price);


    if (
        score < 90 ||
        direction === "SIDEWAYS"
    ) {

        return {

            aligned: false,

            reasons: []

        };

    }


    const adx =
        getADX(indicators);

    const macd =
        getMACD(indicators);

    const rsi =
        num(indicators.rsi);

    const vwap =
        num(indicators.vwap);

    const supertrend =
        getSupertrend(indicators);

    const obvDirection =
        getOBVDirection(indicators);


    const bullishEMA =
        getBullishEMAAlignment(
            indicators,
            price
        );

    const bearishEMA =
        getBearishEMAAlignment(
            indicators,
            price
        );


    const reasons = [];


    if (
        adx.value < 25
    ) {

        reasons.push(
            "ADX below 25"
        );

    }


    if (
        direction === "BULLISH"
    ) {

        if (
            !bullishEMA.priceAbove20 ||
            !bullishEMA.priceAbove50
        ) {

            reasons.push(
                "Price not above EMA20/EMA50"
            );

        }


        if (
            !bullishEMA.ema20Above50 ||
            !bullishEMA.ema50Above100
        ) {

            reasons.push(
                "Bullish EMA structure incomplete"
            );

        }


        if (
            adx.pdi <= adx.mdi
        ) {

            reasons.push(
                "PDI not above MDI"
            );

        }


        if (
            rsi < 55 ||
            rsi > 75
        ) {

            reasons.push(
                "Bullish RSI alignment missing"
            );

        }


        if (
            macd.value <= macd.signal ||
            macd.histogram <= 0
        ) {

            reasons.push(
                "Bullish MACD alignment missing"
            );

        }


        if (
            vwap <= 0 ||
            price <= vwap
        ) {

            reasons.push(
                "Price not above VWAP"
            );

        }


        if (
            !(
                supertrend.includes("BUY") ||
                supertrend.includes("BULL") ||
                supertrend.includes("UP")
            )
        ) {

            reasons.push(
                "Bullish Supertrend alignment missing"
            );

        }


        if (
            obvDirection !== "BULLISH"
        ) {

            reasons.push(
                "Bullish OBV confirmation missing"
            );

        }

    }


    if (
        direction === "BEARISH"
    ) {

        if (
            !bearishEMA.priceBelow20 ||
            !bearishEMA.priceBelow50
        ) {

            reasons.push(
                "Price not below EMA20/EMA50"
            );

        }


        if (
            !bearishEMA.ema20Below50 ||
            !bearishEMA.ema50Below100
        ) {

            reasons.push(
                "Bearish EMA structure incomplete"
            );

        }


        if (
            adx.mdi <= adx.pdi
        ) {

            reasons.push(
                "MDI not above PDI"
            );

        }


        if (
            rsi < 25 ||
            rsi > 45
        ) {

            reasons.push(
                "Bearish RSI alignment missing"
            );

        }


        if (
            macd.value >= macd.signal ||
            macd.histogram >= 0
        ) {

            reasons.push(
                "Bearish MACD alignment missing"
            );

        }


        if (
            vwap <= 0 ||
            price >= vwap
        ) {

            reasons.push(
                "Price not below VWAP"
            );

        }


        if (
            !(
                supertrend.includes("SELL") ||
                supertrend.includes("BEAR") ||
                supertrend.includes("DOWN")
            )
        ) {

            reasons.push(
                "Bearish Supertrend alignment missing"
            );

        }


        if (
            obvDirection !== "BEARISH"
        ) {

            reasons.push(
                "Bearish OBV confirmation missing"
            );

        }

    }


    return {

        aligned:
            reasons.length === 0,

        reasons

    };

}


// ============================================================
// MAIN AI SCORE
// ============================================================

function calculateAIScore(
    indicators = {},
    price = 0
) {

    indicators =
        obj(indicators);

    price =
        num(price);


    const bullishScore =
        calculateBullishScore(
            indicators,
            price
        );

    const bearishScore =
        calculateBearishScore(
            indicators,
            price
        );


    const difference =
        Math.abs(
            bullishScore -
            bearishScore
        );


    let direction =
        "SIDEWAYS";


    if (
        bullishScore >= 60 &&
        bullishScore > bearishScore &&
        difference >= 8
    ) {

        direction =
            "BULLISH";

    } else if (
        bearishScore >= 60 &&
        bearishScore > bullishScore &&
        difference >= 8
    ) {

        direction =
            "BEARISH";

    }


    let score =
        Math.max(
            bullishScore,
            bearishScore
        );


    if (
        direction === "SIDEWAYS"
    ) {

        score =
            Math.min(
                score,
                59
            );

    }


    // ========================================================
    // 90+ ALIGNMENT
    // ========================================================

    const alignment =
        check90PlusAlignment(
            indicators,
            price,
            direction,
            score
        );


    // A raw 90+ score is capped below 90 unless all required
    // major directional conditions agree.

    if (
        score >= 90 &&
        !alignment.aligned
    ) {

        score = 89;

    }


    return {

        score:
            Math.min(
                100,
                Math.round(score)
            ),

        bullishScore,

        bearishScore,

        direction,

        directionDifference:
            difference,

        ninetyPlusAligned:
            alignment.aligned,

        ninetyPlusAlignmentReasons:
            alignment.reasons

    };

}


// ============================================================
// RECOMMENDATION
// ============================================================

function getRecommendation(
    score,
    direction = "SIDEWAYS"
) {

    score =
        num(score);


    direction =
        normalizeTrend(direction);


    if (
        direction === "BULLISH"
    ) {

        if (score >= 90)
            return "⭐⭐⭐⭐⭐ ELITE BUY";

        if (score >= 80)
            return "⭐⭐⭐⭐⭐ STRONG BUY";

        if (score >= 70)
            return "⭐⭐⭐⭐ BUY";

        if (score >= 60)
            return "⭐⭐⭐ WATCH";

    }


    if (
        direction === "BEARISH"
    ) {

        if (score >= 90)
            return "⭐⭐⭐⭐⭐ ELITE SELL";

        if (score >= 80)
            return "⭐⭐⭐⭐⭐ STRONG SELL";

        if (score >= 70)
            return "⭐⭐⭐⭐ SELL";

        if (score >= 60)
            return "⭐⭐⭐ WATCH";

    }


    return score >= 40
        ? "⚠ WAIT"
        : "❌ AVOID";

}


// ============================================================
// RATING
// ============================================================

function getRating(
    score,
    direction = "SIDEWAYS"
) {

    score =
        num(score);


    direction =
        normalizeTrend(direction);


    if (
        direction === "BULLISH"
    ) {

        if (score >= 80)
            return "STRONG BUY";

        if (score >= 65)
            return "BUY";

    }


    if (
        direction === "BEARISH"
    ) {

        if (score >= 80)
            return "STRONG SELL";

        if (score >= 65)
            return "SELL";

    }


    if (score >= 50)
        return "WATCH";

    if (score >= 35)
        return "WAIT";

    return "AVOID";

}


// ============================================================
// QUALITY RULES
// ============================================================

function getQualityStatus(
    scoreData,
    data
) {

    data =
        obj(data);

    scoreData =
        obj(scoreData);


    const scannerScore =
        Number(
            data.finalScore ??
            scoreData.score ??
            0
        );


    const adx =
        num(
            data.adx?.adx ??
            data.adxValue
        );


    const rvol =
        num(data.rvol);


    const volumeConfirmed =
        data.volumeConfirmed === true ||
        data.volumeSpike === true ||
        rvol >= 1.2;


    const trendConfirmed =
        scoreData.direction !==
        "SIDEWAYS";


    const momentumConfirmed =
        (
            scoreData.direction === "BULLISH" &&
            num(data.rsi) >= 50
        ) ||
        (
            scoreData.direction === "BEARISH" &&
            num(data.rsi) <= 50
        );


    const breakoutConfirmed =
        data.breakout === true ||
        String(
            data.breakout || ""
        ).trim().toUpperCase() === "TRUE";


    const strongTrend =
        adx >= 20;


    const tradeQuality =
        scannerScore >= 70 &&
        trendConfirmed &&
        momentumConfirmed;


    return {

        scannerQuality:
            scannerScore >= 70,

        trendConfirmed,

        momentumConfirmed,

        volumeConfirmed,

        breakoutConfirmed,

        strongTrend,

        tradeQuality

    };

}


// ============================================================
// PROTECT AI FIELDS FROM TRADE SETUP
// ============================================================
// calculateTradeSetup() may return additional fields.
//
// However, the AI engine owns:
// score
// finalScore
// direction
// signal
// rating
// bullishScore
// bearishScore
// quality fields
//
// Therefore those fields must never be overwritten by the
// trade setup object.
// ============================================================

function sanitizeTradeSetup(trade) {

    const setup =
        obj(trade);


    const protectedFields = new Set([

        "score",
        "finalScore",

        "bullishScore",
        "bearishScore",

        "direction",
        "directionDifference",

        "rating",
        "signal",

        "scannerQuality",
        "trendConfirmed",
        "momentumConfirmed",
        "volumeConfirmed",
        "breakoutConfirmed",
        "strongTrend",
        "tradeQuality",

        "ninetyPlusAligned",
        "ninetyPlusAlignmentReasons"

    ]);


    const safeTrade = {};


    for (
        const [key, value]
        of Object.entries(setup)
    ) {

        if (
            !protectedFields.has(key)
        ) {

            safeTrade[key] =
                value;

        }

    }


    return safeTrade;

}


// ============================================================
// MAIN SCORE FUNCTION
// ============================================================

function calculateScore(data) {

    if (
        !data ||
        typeof data !== "object"
    ) {

        return {

            score: 0,
            finalScore: 0,

            bullishScore: 0,
            bearishScore: 0,

            direction: "SIDEWAYS",

            directionDifference: 0,

            ninetyPlusAligned: false,

            ninetyPlusAlignmentReasons: [],

            rating: "AVOID",
            signal: "❌ AVOID"

        };

    }


    const price =
        num(data.price);


    if (
        price <= 0
    ) {

        return {

            ...data,

            score: 0,
            finalScore: 0,

            bullishScore: 0,
            bearishScore: 0,

            direction: "SIDEWAYS",

            directionDifference: 0,

            ninetyPlusAligned: false,

            ninetyPlusAlignmentReasons: [],

            rating: "AVOID",
            signal: "❌ AVOID"

        };

    }


    // ========================================================
    // CALCULATE DIRECTIONAL SCORE
    // ========================================================

    const scoreData =
        calculateAIScore(
            data,
            price
        );


    const score =
        scoreData.score;


    // ========================================================
    // SIGNAL
    // ========================================================

    const signal =
        getRecommendation(
            score,
            scoreData.direction
        );


    // ========================================================
    // RATING
    // ========================================================

    const rating =
        getRating(
            score,
            scoreData.direction
        );


    // ========================================================
    // QUALITY
    // ========================================================

    const quality =
        getQualityStatus(
            scoreData,
            data
        );


    // ========================================================
    // TRADE SETUP
    // ========================================================
    // Exactly ONE call.
    //
    // The returned object is sanitized before merging so it
    // cannot overwrite AI engine fields.
    // ========================================================

    let safeTrade = {};


    try {

        const trade =
            calculateTradeSetup(
                price,
                data,
                {
                    optionType:
                        scoreData.direction === "BULLISH"
                            ? "CALL"
                            : scoreData.direction === "BEARISH"
                                ? "PUT"
                                : null
                }
            );


        safeTrade =
            sanitizeTradeSetup(
                trade
            );

    } catch (error) {

        safeTrade = {

            tradeSetupError:
                error?.message ||
                "Trade setup calculation failed"

        };

    }


    // ========================================================
    // FINAL RESULT
    // ========================================================

    return {

        ...data,

        // AI score fields

        score,

        finalScore:
            score,

        bullishScore:
            scoreData.bullishScore,

        bearishScore:
            scoreData.bearishScore,

        direction:
            scoreData.direction,

        directionDifference:
            scoreData.directionDifference,

        // 90+ alignment

        ninetyPlusAligned:
            scoreData.ninetyPlusAligned,

        ninetyPlusAlignmentReasons:
            scoreData.ninetyPlusAlignmentReasons,

        // Recommendation

        rating,

        signal,

        // Quality fields

        scannerQuality:
            quality.scannerQuality,

        trendConfirmed:
            quality.trendConfirmed,

        momentumConfirmed:
            quality.momentumConfirmed,

        volumeConfirmed:
            quality.volumeConfirmed,

        breakoutConfirmed:
            quality.breakoutConfirmed,

        strongTrend:
            quality.strongTrend,

        tradeQuality:
            quality.tradeQuality,

        // Trade setup fields

        ...safeTrade

    };

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateAIScore,

    calculateScore,

    getRecommendation,

    getRating

};