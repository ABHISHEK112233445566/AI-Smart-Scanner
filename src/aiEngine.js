// ============================================================
// AI ENGINE V6 - AUTHORITATIVE SCANNER SCORE
// ============================================================
// Scanner score is the stock's primary directional technical score.
// +100 = strongest bullish, 0 = neutral, -100 = strongest bearish.
// Dashboard/Accuracy use ABS(scannerScore) for threshold checks.
// Ranking/options may add secondary quality information, but must NOT
// overwrite scannerScore.
// ============================================================

const { calculateTradeSetup } = require("./tradeSetup");

const QUALIFY_SCORE = 80;

function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function obj(value) {
    return value && typeof value === "object" ? value : {};
}

function normalizeTrend(value) {
    return String(value || "").trim().toUpperCase();
}

function getMACD(indicators) {
    const m = obj(indicators.macd);
    return {
        value: num(m.MACD ?? m.macd ?? indicators.macdValue),
        signal: num(m.signal ?? m.Signal ?? indicators.macdSignal),
        histogram: num(m.histogram ?? m.Histogram ?? indicators.macdHistogram)
    };
}

function getADX(indicators) {
    const a = obj(indicators.adx);
    return {
        value: num(a.adx ?? a.ADX ?? indicators.adxValue),
        pdi: num(a.pdi ?? a.PDI ?? indicators.pdi),
        mdi: num(a.mdi ?? a.MDI ?? indicators.mdi)
    };
}

function getBollinger(indicators) {
    const b = obj(indicators.bollinger);
    return num(b.middle ?? b.middleBand ?? indicators.bollingerMiddle);
}

function getSupertrend(indicators) {
    return normalizeTrend(indicators.supertrend?.trend ?? indicators.supertrend);
}

function getOBVDirection(indicators) {
    const explicit = normalizeTrend(indicators.obvTrend ?? indicators.obvDirection ?? indicators.obvSignal);
    if (explicit.includes("BULL") || explicit.includes("UP") || explicit.includes("RISING") || explicit === "BUY") return "BULLISH";
    if (explicit.includes("BEAR") || explicit.includes("DOWN") || explicit.includes("FALLING") || explicit === "SELL") return "BEARISH";
    const change = num(indicators.obvChange ?? indicators.obvDelta ?? indicators.obvSlope, NaN);
    if (Number.isFinite(change)) return change > 0 ? "BULLISH" : change < 0 ? "BEARISH" : "UNKNOWN";
    return "UNKNOWN";
}

function bullishConditions(indicators = {}, price = 0) {
    const ema20 = num(indicators.ema20), ema50 = num(indicators.ema50);
    const ema100 = num(indicators.ema100), ema200 = num(indicators.ema200);
    const vwap = num(indicators.vwap), rsi = num(indicators.rsi);
    const macd = getMACD(indicators), adx = getADX(indicators);
    const st = getSupertrend(indicators), obv = getOBVDirection(indicators);
    const bb = getBollinger(indicators), rvol = num(indicators.rvol);
    return [
        ema20 > 0 && price > ema20,
        ema50 > 0 && price > ema50,
        ema20 > 0 && ema50 > 0 && ema20 > ema50,
        ema50 > 0 && ema100 > 0 && ema50 > ema100,
        ema100 > 0 && ema200 > 0 && ema100 > ema200,
        vwap > 0 && price > vwap,
        st.includes("BUY") || st.includes("BULL") || st.includes("UP"),
        rsi >= 55 && rsi <= 70,
        macd.value > macd.signal,
        macd.histogram > 0,
        bb > 0 && price > bb,
        rvol >= 1.2,
        indicators.volumeSpike === true,
        obv === "BULLISH",
        adx.value > 25,
        adx.pdi > adx.mdi
    ];
}

function bearishConditions(indicators = {}, price = 0) {
    const ema20 = num(indicators.ema20), ema50 = num(indicators.ema50);
    const ema100 = num(indicators.ema100), ema200 = num(indicators.ema200);
    const vwap = num(indicators.vwap), rsi = num(indicators.rsi);
    const macd = getMACD(indicators), adx = getADX(indicators);
    const st = getSupertrend(indicators), obv = getOBVDirection(indicators);
    const bb = getBollinger(indicators), rvol = num(indicators.rvol);
    return [
        ema20 > 0 && price < ema20,
        ema50 > 0 && price < ema50,
        ema20 > 0 && ema50 > 0 && ema20 < ema50,
        ema50 > 0 && ema100 > 0 && ema50 < ema100,
        ema100 > 0 && ema200 > 0 && ema100 < ema200,
        vwap > 0 && price < vwap,
        st.includes("SELL") || st.includes("BEAR") || st.includes("DOWN"),
        rsi >= 30 && rsi <= 45,
        macd.value < macd.signal,
        macd.histogram < 0,
        bb > 0 && price < bb,
        rvol >= 1.2,
        indicators.volumeSpike === true,
        obv === "BEARISH",
        adx.value > 25,
        adx.mdi > adx.pdi
    ];
}

// Same weights for bullish and bearish directions.
function scoreConditions(conditions) {
    const weights = [5,5,5,5,5,5,10,8,8,4,5,5,5,5,10,10];
    let score = 0;
    for (let i = 0; i < conditions.length; i++) if (conditions[i]) score += weights[i];
    return Math.min(100, Math.round(score));
}

function calculateBullishScore(indicators = {}, price = 0) {
    return scoreConditions(bullishConditions(obj(indicators), num(price)));
}

function calculateBearishScore(indicators = {}, price = 0) {
    return scoreConditions(bearishConditions(obj(indicators), num(price)));
}

function calculateAIScore(indicators = {}, price = 0) {
    const i = obj(indicators), p = num(price);
    const bull = calculateBullishScore(i, p);
    const bear = calculateBearishScore(i, p);
    const difference = Math.abs(bull - bear);
    let direction = "SIDEWAYS";
    let magnitude = 0;

    if (bull >= 60 && bull > bear && difference >= 8) {
        direction = "BULLISH";
        magnitude = bull;
    } else if (bear >= 60 && bear > bull && difference >= 8) {
        direction = "BEARISH";
        magnitude = bear;
    }

    const signedScore = direction === "BULLISH" ? magnitude : direction === "BEARISH" ? -magnitude : 0;

    return {
        score: signedScore,
        scannerScore: signedScore,
        finalScore: signedScore,
        bullishScore: bull,
        bearishScore: bear,
        bullishScoreMagnitude: bull,
        bearishScoreMagnitude: bear,
        direction,
        directionDifference: difference,
        scannerQuality: Math.abs(signedScore) >= QUALIFY_SCORE
    };
}

function getRecommendation(score, direction = "SIDEWAYS") {
    const magnitude = Math.abs(num(score)), d = normalizeTrend(direction);
    if (d === "BULLISH") {
        if (magnitude >= 90) return "⭐⭐⭐⭐⭐ ELITE BUY";
        if (magnitude >= 80) return "⭐⭐⭐⭐⭐ STRONG BUY";
        if (magnitude >= 70) return "⭐⭐⭐⭐ BUY";
        if (magnitude >= 60) return "⭐⭐⭐ WATCH";
    }
    if (d === "BEARISH") {
        if (magnitude >= 90) return "⭐⭐⭐⭐⭐ ELITE SELL";
        if (magnitude >= 80) return "⭐⭐⭐⭐⭐ STRONG SELL";
        if (magnitude >= 70) return "⭐⭐⭐⭐ SELL";
        if (magnitude >= 60) return "⭐⭐⭐ WATCH";
    }
    return magnitude >= 40 ? "⚠ WAIT" : "❌ AVOID";
}

function getRating(score, direction = "SIDEWAYS") {
    const magnitude = Math.abs(num(score)), d = normalizeTrend(direction);
    if (d === "BULLISH") {
        if (magnitude >= 80) return "STRONG BUY";
        if (magnitude >= 65) return "BUY";
    }
    if (d === "BEARISH") {
        if (magnitude >= 80) return "STRONG SELL";
        if (magnitude >= 65) return "SELL";
    }
    if (magnitude >= 50) return "WATCH";
    if (magnitude >= 35) return "WAIT";
    return "AVOID";
}

function getQualityStatus(scoreData, data) {
    const d = obj(data), s = obj(scoreData), magnitude = Math.abs(num(s.scannerScore ?? s.score));
    const adx = num(d.adx?.adx ?? d.adxValue);
    const rvol = num(d.rvol);
    const volumeConfirmed = d.volumeConfirmed === true || d.volumeSpike === true || rvol >= 1.2;
    const trendConfirmed = s.direction !== "SIDEWAYS";
    const rsi = num(d.rsi);
    const momentumConfirmed = (s.direction === "BULLISH" && rsi >= 50) || (s.direction === "BEARISH" && rsi <= 50);
    const breakoutConfirmed = d.breakout === true || String(d.breakout || "").trim().toUpperCase() === "TRUE";
    return {
        scannerQuality: magnitude >= QUALIFY_SCORE,
        trendConfirmed,
        momentumConfirmed,
        volumeConfirmed,
        breakoutConfirmed,
        strongTrend: adx >= 20,
        tradeQuality: magnitude >= QUALIFY_SCORE && trendConfirmed && momentumConfirmed
    };
}

function sanitizeTradeSetup(trade) {
    const protectedFields = new Set([
        "score","scannerScore","finalScore","bullishScore","bearishScore","bullishScoreMagnitude","bearishScoreMagnitude",
        "direction","directionDifference","rating","signal","scannerQuality","trendConfirmed","momentumConfirmed",
        "volumeConfirmed","breakoutConfirmed","strongTrend","tradeQuality"
    ]);
    const safe = {};
    for (const [key, value] of Object.entries(obj(trade))) if (!protectedFields.has(key)) safe[key] = value;
    return safe;
}

function calculateScore(data) {
    if (!data || typeof data !== "object") {
        return { score: 0, scannerScore: 0, finalScore: 0, bullishScore: 0, bearishScore: 0, direction: "SIDEWAYS", directionDifference: 0, rating: "AVOID", signal: "❌ AVOID", scannerQuality: false };
    }
    const price = num(data.price);
    if (price <= 0) {
        return { ...data, score: 0, scannerScore: 0, finalScore: 0, bullishScore: 0, bearishScore: 0, direction: "SIDEWAYS", directionDifference: 0, rating: "AVOID", signal: "❌ AVOID", scannerQuality: false };
    }

    const scoreData = calculateAIScore(data, price);
    const rating = getRating(scoreData.scannerScore, scoreData.direction);
    const signal = getRecommendation(scoreData.scannerScore, scoreData.direction);
    const quality = getQualityStatus(scoreData, data);
    let safeTrade = {};
    try {
        safeTrade = sanitizeTradeSetup(calculateTradeSetup(price, data, {
            optionType: scoreData.direction === "BULLISH" ? "CALL" : scoreData.direction === "BEARISH" ? "PUT" : "NONE"
        }) || {});
    } catch (_) {
        safeTrade = {};
    }

    return {
        ...data,
        ...safeTrade,
        // These are authoritative and intentionally assigned LAST.
        score: scoreData.scannerScore,
        scannerScore: scoreData.scannerScore,
        aiScore: scoreData.scannerScore,
        finalScore: scoreData.scannerScore,
        bullishScore: scoreData.bullishScore,
        bearishScore: scoreData.bearishScore,
        bullishScoreMagnitude: scoreData.bullishScoreMagnitude,
        bearishScoreMagnitude: scoreData.bearishScoreMagnitude,
        direction: scoreData.direction,
        directionDifference: scoreData.directionDifference,
        rating,
        signal,
        scannerQuality: quality.scannerQuality,
        trendConfirmed: quality.trendConfirmed,
        momentumConfirmed: quality.momentumConfirmed,
        volumeConfirmed: quality.volumeConfirmed,
        breakoutConfirmed: quality.breakoutConfirmed,
        strongTrend: quality.strongTrend,
        tradeQuality: quality.tradeQuality
    };
}

module.exports = {
    calculateScore,
    calculateAIScore,
    calculateBullishScore,
    calculateBearishScore,
    QUALIFY_SCORE
};
