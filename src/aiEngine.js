// ============================================================
// AI ENGINE V5
// ============================================================
// Signed directional score:
//   +100 = strongest bullish
//      0 = neutral / sideways
//   -100 = strongest bearish
//
// Qualification threshold: absolute score >= 85.
// Bullish and bearish scoring use the same weighted structure.
// ============================================================

const { calculateTradeSetup } = require("./tradeSetup");

const QUALIFY_SCORE = 85;

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
        value: num(m.MACD ?? m.macd),
        signal: num(m.signal ?? m.Signal),
        histogram: num(m.histogram ?? m.Histogram)
    };
}

function getADX(indicators) {
    const a = obj(indicators.adx);
    return {
        value: num(a.adx ?? indicators.adxValue),
        pdi: num(a.pdi ?? indicators.pdi),
        mdi: num(a.mdi ?? indicators.mdi)
    };
}

function getBollinger(indicators) {
    const b = obj(indicators.bollinger);
    return num(b.middle ?? b.middleBand);
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
    const vwap = num(indicators.vwap);
    const rsi = num(indicators.rsi);
    const macd = getMACD(indicators);
    const adx = getADX(indicators);
    const st = getSupertrend(indicators);
    const obv = getOBVDirection(indicators);
    const bb = getBollinger(indicators);
    const rvol = num(indicators.rvol);

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
    const vwap = num(indicators.vwap);
    const rsi = num(indicators.rsi);
    const macd = getMACD(indicators);
    const adx = getADX(indicators);
    const st = getSupertrend(indicators);
    const obv = getOBVDirection(indicators);
    const bb = getBollinger(indicators);
    const rvol = num(indicators.rvol);

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

// 16 components, weighted to a 100-point magnitude.
// Trend 40, momentum 25, volume 15, strength 20.
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

function check85PlusAlignment(indicators = {}, price = 0, direction = "SIDEWAYS", magnitude = 0) {
    if (magnitude < QUALIFY_SCORE || direction === "SIDEWAYS") return { aligned: false, reasons: [] };
    const i = obj(indicators), p = num(price), reasons = [];
    const adx = getADX(i), macd = getMACD(i), rsi = num(i.rsi), vwap = num(i.vwap), st = getSupertrend(i), obv = getOBVDirection(i);
    const bullish = direction === "BULLISH";

    if (adx.value < 25) reasons.push("ADX below 25");
    if (bullish) {
        if (!(num(i.ema20) > 0 && p > num(i.ema20) && num(i.ema50) > 0 && p > num(i.ema50))) reasons.push("Price not above EMA20/EMA50");
        if (!(num(i.ema20) > 0 && num(i.ema50) > 0 && num(i.ema20) > num(i.ema50) && num(i.ema50) > num(i.ema100))) reasons.push("Bullish EMA structure incomplete");
        if (adx.pdi <= adx.mdi) reasons.push("PDI not above MDI");
        if (rsi < 55 || rsi > 75) reasons.push("Bullish RSI alignment missing");
        if (!(macd.value > macd.signal && macd.histogram > 0)) reasons.push("Bullish MACD alignment missing");
        if (!(vwap > 0 && p > vwap)) reasons.push("Price not above VWAP");
        if (!(st.includes("BUY") || st.includes("BULL") || st.includes("UP"))) reasons.push("Bullish Supertrend alignment missing");
        if (obv !== "BULLISH") reasons.push("Bullish OBV confirmation missing");
    } else {
        if (!(num(i.ema20) > 0 && p < num(i.ema20) && num(i.ema50) > 0 && p < num(i.ema50))) reasons.push("Price not below EMA20/EMA50");
        if (!(num(i.ema20) > 0 && num(i.ema50) > 0 && num(i.ema20) < num(i.ema50) && num(i.ema50) < num(i.ema100))) reasons.push("Bearish EMA structure incomplete");
        if (adx.mdi <= adx.pdi) reasons.push("MDI not above PDI");
        if (rsi < 25 || rsi > 45) reasons.push("Bearish RSI alignment missing");
        if (!(macd.value < macd.signal && macd.histogram < 0)) reasons.push("Bearish MACD alignment missing");
        if (!(vwap > 0 && p < vwap)) reasons.push("Price not below VWAP");
        if (!(st.includes("SELL") || st.includes("BEAR") || st.includes("DOWN"))) reasons.push("Bearish Supertrend alignment missing");
        if (obv !== "BEARISH") reasons.push("Bearish OBV confirmation missing");
    }
    return { aligned: reasons.length === 0, reasons };
}

function calculateAIScore(indicators = {}, price = 0) {
    const i = obj(indicators), p = num(price);
    const bull = calculateBullishScore(i, p);
    const bearMagnitude = calculateBearishScore(i, p);
    const difference = Math.abs(bull - bearMagnitude);
    let direction = "SIDEWAYS";
    let magnitude = 0;

    if (bull >= 60 && bull > bearMagnitude && difference >= 8) {
        direction = "BULLISH";
        magnitude = bull;
    } else if (bearMagnitude >= 60 && bearMagnitude > bull && difference >= 8) {
        direction = "BEARISH";
        magnitude = bearMagnitude;
    }

    const alignment = check85PlusAlignment(i, p, direction, magnitude);
    // Do not allow an unconfirmed 85+ signal to remain at 85 or above.
    if (magnitude >= QUALIFY_SCORE && !alignment.aligned) magnitude = QUALIFY_SCORE - 1;

    const signedScore = direction === "BULLISH" ? magnitude : direction === "BEARISH" ? -magnitude : 0;

    return {
        score: signedScore,
        finalScore: signedScore,
        bullishScore: bull,
        bearishScore: -bearMagnitude,
        bullishScoreMagnitude: bull,
        bearishScoreMagnitude: bearMagnitude,
        direction,
        directionDifference: difference,
        ninetyPlusAligned: alignment.aligned,
        ninetyPlusAlignmentReasons: alignment.reasons,
        eightyFivePlusAligned: alignment.aligned
    };
}

function getRecommendation(score, direction = "SIDEWAYS") {
    const s = num(score), magnitude = Math.abs(s), d = normalizeTrend(direction);
    if (d === "BULLISH") {
        if (magnitude >= 90) return "⭐⭐⭐⭐⭐ ELITE BUY";
        if (magnitude >= 85) return "⭐⭐⭐⭐⭐ STRONG BUY";
        if (magnitude >= 70) return "⭐⭐⭐⭐ BUY";
        if (magnitude >= 60) return "⭐⭐⭐ WATCH";
    }
    if (d === "BEARISH") {
        if (magnitude >= 90) return "⭐⭐⭐⭐⭐ ELITE SELL";
        if (magnitude >= 85) return "⭐⭐⭐⭐⭐ STRONG SELL";
        if (magnitude >= 70) return "⭐⭐⭐⭐ SELL";
        if (magnitude >= 60) return "⭐⭐⭐ WATCH";
    }
    return magnitude >= 40 ? "⚠ WAIT" : "❌ AVOID";
}

function getRating(score, direction = "SIDEWAYS") {
    const magnitude = Math.abs(num(score)), d = normalizeTrend(direction);
    if (d === "BULLISH") {
        if (magnitude >= 85) return "STRONG BUY";
        if (magnitude >= 65) return "BUY";
    }
    if (d === "BEARISH") {
        if (magnitude >= 85) return "STRONG SELL";
        if (magnitude >= 65) return "SELL";
    }
    if (magnitude >= 50) return "WATCH";
    if (magnitude >= 35) return "WAIT";
    return "AVOID";
}

function getQualityStatus(scoreData, data) {
    const d = obj(data), s = obj(scoreData), magnitude = Math.abs(num(d.finalScore ?? s.score ?? 0));
    const adx = num(d.adx?.adx ?? d.adxValue);
    const rvol = num(d.rvol);
    const volumeConfirmed = d.volumeConfirmed === true || d.volumeSpike === true || rvol >= 1.2;
    const trendConfirmed = s.direction !== "SIDEWAYS";
    const rsi = num(d.rsi);
    const momentumConfirmed = (s.direction === "BULLISH" && rsi >= 50) || (s.direction === "BEARISH" && rsi <= 50);
    const breakoutConfirmed = d.breakout === true || String(d.breakout || "").trim().toUpperCase() === "TRUE";
    const strongTrend = adx >= 20;
    const tradeQuality = magnitude >= QUALIFY_SCORE && trendConfirmed && momentumConfirmed;
    return {
        scannerQuality: magnitude >= QUALIFY_SCORE,
        trendConfirmed, momentumConfirmed, volumeConfirmed, breakoutConfirmed, strongTrend, tradeQuality
    };
}

function sanitizeTradeSetup(trade) {
    const protectedFields = new Set([
        "score","finalScore","bullishScore","bearishScore","bullishScoreMagnitude","bearishScoreMagnitude",
        "direction","directionDifference","rating","signal","scannerQuality","trendConfirmed",
        "momentumConfirmed","volumeConfirmed","breakoutConfirmed","strongTrend","tradeQuality",
        "ninetyPlusAligned","ninetyPlusAlignmentReasons","eightyFivePlusAligned"
    ]);
    const safe = {};
    for (const [key, value] of Object.entries(obj(trade))) if (!protectedFields.has(key)) safe[key] = value;
    return safe;
}

function calculateScore(data) {
    if (!data || typeof data !== "object") return {
        score: 0, finalScore: 0, bullishScore: 0, bearishScore: 0, direction: "SIDEWAYS",
        directionDifference: 0, ninetyPlusAligned: false, ninetyPlusAlignmentReasons: [], rating: "AVOID", signal: "❌ AVOID"
    };

    const price = num(data.price);
    if (price <= 0) return {
        ...data, score: 0, finalScore: 0, bullishScore: 0, bearishScore: 0, direction: "SIDEWAYS",
        directionDifference: 0, ninetyPlusAligned: false, ninetyPlusAlignmentReasons: [], rating: "AVOID", signal: "❌ AVOID"
    };

    const scoreData = calculateAIScore(data, price);
    const rating = getRating(scoreData.score, scoreData.direction);
    const signal = getRecommendation(scoreData.score, scoreData.direction);
    const quality = getQualityStatus(scoreData, data);
    let safeTrade = {};

    try {
        safeTrade = sanitizeTradeSetup(calculateTradeSetup(price, data, {
            optionType: scoreData.direction === "BULLISH" ? "CALL" : scoreData.direction === "BEARISH" ? "PUT" : null
        }));
    } catch (error) {
        safeTrade = { tradeSetupError: error?.message || "Trade setup calculation failed" };
    }

    return {
        ...data,
        score: scoreData.score,
        finalScore: scoreData.score,
        bullishScore: scoreData.bullishScore,
        bearishScore: scoreData.bearishScore,
        bullishScoreMagnitude: scoreData.bullishScoreMagnitude,
        bearishScoreMagnitude: scoreData.bearishScoreMagnitude,
        direction: scoreData.direction,
        directionDifference: scoreData.directionDifference,
        ninetyPlusAligned: scoreData.ninetyPlusAligned,
        ninetyPlusAlignmentReasons: scoreData.ninetyPlusAlignmentReasons,
        eightyFivePlusAligned: scoreData.eightyFivePlusAligned,
        rating, signal,
        scannerQuality: quality.scannerQuality,
        trendConfirmed: quality.trendConfirmed,
        momentumConfirmed: quality.momentumConfirmed,
        volumeConfirmed: quality.volumeConfirmed,
        breakoutConfirmed: quality.breakoutConfirmed,
        strongTrend: quality.strongTrend,
        tradeQuality: quality.tradeQuality,
        ...safeTrade
    };
}

module.exports = {
    calculateAIScore,
    calculateScore,
    getRecommendation,
    getRating
};
