// ============================================================
// BREAKOUT / BREAKDOWN ENGINE V6
// ============================================================
// Uses real candle closes and supplied support/resistance.
// Bullish and bearish logic are symmetric. BreakoutScore and
// BreakdownScore remain local 0-10 component scores; the main
// AI direction/score is handled by aiEngine.js (-100..+100).
// ============================================================

function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function obj(value) {
    return value && typeof value === "object" ? value : {};
}

function getMACD(indicators) {
    const m = obj(indicators.macd);
    return {
        value: num(m.MACD ?? m.macd, NaN),
        signal: num(m.signal ?? m.Signal, NaN),
        histogram: num(m.histogram ?? m.Histogram, NaN)
    };
}

function getADX(indicators) {
    const a = obj(indicators.adx);
    return {
        value: num(a.adx ?? indicators.adxValue, NaN),
        pdi: num(a.pdi ?? indicators.pdi, NaN),
        mdi: num(a.mdi ?? indicators.mdi, NaN)
    };
}

function normalizeCandle(candle) {
    if (!candle || typeof candle !== "object") return null;
    const close = num(candle.close, NaN);
    const high = num(candle.high, NaN);
    const low = num(candle.low, NaN);
    if (![close, high, low].every(Number.isFinite)) return null;
    if (close <= 0 || high <= 0 || low <= 0 || high < low) return null;
    if (close > high || close < low) return null;
    return { ...candle, close, high, low };
}

function getValidCandles(candles) {
    if (!Array.isArray(candles)) return [];
    return candles.map(normalizeCandle).filter(Boolean);
}

function calculateBreakout(candles, indicators = {}, sr = {}) {
    indicators = obj(indicators);
    sr = obj(sr);

    const validCandles = getValidCandles(candles);
    const last = validCandles[validCandles.length - 1] || null;
    const previous = validCandles.length >= 2 ? validCandles[validCandles.length - 2] : null;

    if (!last) {
        return {
            valid: false, breakout: false, breakoutType: "NONE", breakoutStrength: "NONE", breakoutScore: 0,
            breakdown: false, breakdownType: "NONE", breakdownStrength: "NONE", breakdownScore: 0,
            freshBreakout: false, freshBreakdown: false, aboveResistance: false, nearResistance: false,
            belowSupport: false, nearSupport: false, volumeConfirmed: false, trendConfirmed: false,
            momentumConfirmed: false, bearishVolumeConfirmed: false, bearishTrendConfirmed: false,
            bearishMomentumConfirmed: false, strongTrendConfirmed: false, strongBearishTrendConfirmed: false,
            bullishTrendDeveloping: false, bearishTrendDeveloping: false, vwapBullish: false, vwapBearish: false,
            adxConfirmed: false, strongADX: false, bullishDIConfirmed: false, bearishDIConfirmed: false,
            rvol: 0, rsi: 0, adx: 0, pdi: 0, mdi: 0, resistance1: 0, support1: 0,
            close: 0, high: 0, low: 0, previousClose: 0, reason: "Invalid or missing candle data"
        };
    }

    const close = last.close;
    const high = last.high;
    const low = last.low;
    const previousClose = previous ? previous.close : 0;

    const resistance1 = num(sr.resistance1 ?? sr.resistance ?? sr.r1, 0);
    const support1 = num(sr.support1 ?? sr.support ?? sr.s1, 0);

    const rvol = num(indicators.rvol, 0);
    const rsi = num(indicators.rsi, NaN);
    const ema20 = num(indicators.ema20, NaN);
    const ema50 = num(indicators.ema50, NaN);
    const ema100 = num(indicators.ema100, NaN);
    const ema200 = num(indicators.ema200, NaN);
    const vwap = num(indicators.vwap, NaN);
    const macd = getMACD(indicators);
    const adx = getADX(indicators);

    const aboveResistance = resistance1 > 0 && close > resistance1;
    const belowSupport = support1 > 0 && close < support1;
    const proximity = 0.005;
    const nearResistance = resistance1 > 0 && close <= resistance1 && close >= resistance1 * (1 - proximity);
    const nearSupport = support1 > 0 && close >= support1 && close <= support1 * (1 + proximity);

    // A fresh event requires a previous valid close on the opposite side.
    const freshBreakout = resistance1 > 0 && previous && previousClose <= resistance1 && close > resistance1;
    const freshBreakdown = support1 > 0 && previous && previousClose >= support1 && close < support1;

    const volumeConfirmed = rvol >= 1.5;
    const volumeGood = rvol >= 1.2;
    const bearishVolumeConfirmed = volumeConfirmed;
    const bearishVolumeGood = volumeGood;

    const trendConfirmed = Number.isFinite(ema20) && Number.isFinite(ema50) && Number.isFinite(ema100) && ema20 > ema50 && ema50 > ema100;
    const bearishTrendConfirmed = Number.isFinite(ema20) && Number.isFinite(ema50) && Number.isFinite(ema100) && ema20 < ema50 && ema50 < ema100;
    const strongTrendConfirmed = trendConfirmed && (!Number.isFinite(ema200) || ema100 > ema200);
    const strongBearishTrendConfirmed = bearishTrendConfirmed && (!Number.isFinite(ema200) || ema100 < ema200);

    const bullishTrendDeveloping = Number.isFinite(ema20) && Number.isFinite(ema50) && (ema20 > ema50 || (Number.isFinite(ema100) && ema20 > ema100));
    const bearishTrendDeveloping = Number.isFinite(ema20) && Number.isFinite(ema50) && (ema20 < ema50 || (Number.isFinite(ema100) && ema20 < ema100));

    const momentumConfirmed = Number.isFinite(rsi) && rsi >= 55 && rsi <= 75 && Number.isFinite(macd.value) && Number.isFinite(macd.signal) && macd.value > macd.signal;
    const momentumGood = Number.isFinite(rsi) && rsi >= 50 && rsi <= 75 && Number.isFinite(macd.value) && Number.isFinite(macd.signal) && macd.value >= macd.signal;
    const bearishMomentumConfirmed = Number.isFinite(rsi) && rsi >= 25 && rsi <= 48 && Number.isFinite(macd.value) && Number.isFinite(macd.signal) && macd.value < macd.signal;
    const bearishMomentumGood = Number.isFinite(rsi) && rsi >= 25 && rsi <= 52 && Number.isFinite(macd.value) && Number.isFinite(macd.signal) && macd.value <= macd.signal;

    const vwapBullish = Number.isFinite(vwap) && vwap > 0 && close > vwap;
    const vwapBearish = Number.isFinite(vwap) && vwap > 0 && close < vwap;
    const adxConfirmed = Number.isFinite(adx.value) && adx.value >= 20;
    const strongADX = Number.isFinite(adx.value) && adx.value >= 25;
    const bullishDIConfirmed = Number.isFinite(adx.pdi) && Number.isFinite(adx.mdi) && adx.pdi > 0 && adx.mdi > 0 && adx.pdi > adx.mdi;
    const bearishDIConfirmed = Number.isFinite(adx.pdi) && Number.isFinite(adx.mdi) && adx.pdi > 0 && adx.mdi > 0 && adx.mdi > adx.pdi;

    // Component scores deliberately remain 0-10; aiEngine owns the signed -100..+100 score.
    let breakoutScore = 0;
    if (aboveResistance) breakoutScore += 3; else if (nearResistance) breakoutScore += 1;
    if (volumeConfirmed) breakoutScore += 2; else if (volumeGood) breakoutScore += 1;
    if (trendConfirmed) breakoutScore += 2; else if (bullishTrendDeveloping) breakoutScore += 1;
    if (momentumConfirmed) breakoutScore += 2; else if (momentumGood) breakoutScore += 1;
    if (vwapBullish) breakoutScore += 1;
    if (adxConfirmed && bullishDIConfirmed) breakoutScore += 1;
    breakoutScore = Math.min(10, breakoutScore);

    let breakdownScore = 0;
    if (belowSupport) breakdownScore += 3; else if (nearSupport) breakdownScore += 1;
    if (bearishVolumeConfirmed) breakdownScore += 2; else if (bearishVolumeGood) breakdownScore += 1;
    if (bearishTrendConfirmed) breakdownScore += 2; else if (bearishTrendDeveloping) breakdownScore += 1;
    if (bearishMomentumConfirmed) breakdownScore += 2; else if (bearishMomentumGood) breakdownScore += 1;
    if (vwapBearish) breakdownScore += 1;
    if (adxConfirmed && bearishDIConfirmed) breakdownScore += 1;
    breakdownScore = Math.min(10, breakdownScore);

    let breakout = freshBreakout && volumeConfirmed && trendConfirmed && momentumConfirmed && adxConfirmed && bullishDIConfirmed;
    let breakdown = freshBreakdown && bearishVolumeConfirmed && bearishTrendConfirmed && bearishMomentumConfirmed && adxConfirmed && bearishDIConfirmed;
    let breakoutType = breakout ? "BREAKOUT" : "NONE";
    let breakdownType = breakdown ? "BREAKDOWN" : "NONE";
    let breakoutStrength = breakout ? (rvol >= 2 && adx.value >= 30 ? "VERY STRONG" : rvol >= 1.5 && adx.value >= 25 ? "STRONG" : "NORMAL") : "NONE";
    let breakdownStrength = breakdown ? (rvol >= 2 && adx.value >= 30 ? "VERY STRONG" : rvol >= 1.5 && adx.value >= 25 ? "STRONG" : "NORMAL") : "NONE";

    if (!breakout && nearResistance && bullishTrendDeveloping && momentumGood && volumeGood && adxConfirmed && bullishDIConfirmed) {
        breakoutType = "SETUP";
        breakoutStrength = "POTENTIAL";
    }
    if (!breakdown && nearSupport && bearishTrendDeveloping && bearishMomentumGood && bearishVolumeGood && adxConfirmed && bearishDIConfirmed) {
        breakdownType = "SETUP";
        breakdownStrength = "POTENTIAL";
    }

    if (!breakout && breakoutType === "NONE" && bullishTrendDeveloping && momentumGood && volumeGood && adxConfirmed && bullishDIConfirmed && !belowSupport) {
        breakoutType = "WATCH";
        breakoutStrength = "WEAK";
    }
    if (!breakdown && breakdownType === "NONE" && bearishTrendDeveloping && bearishMomentumGood && bearishVolumeGood && adxConfirmed && bearishDIConfirmed && !aboveResistance) {
        breakdownType = "WATCH";
        breakdownStrength = "WEAK";
    }

    // Never expose contradictory bullish and bearish setup/watch states.
    if (breakoutType !== "NONE" && breakdownType !== "NONE") {
        if (breakoutScore > breakdownScore) {
            breakdownType = "NONE";
            breakdownStrength = "NONE";
        } else if (breakdownScore > breakoutScore) {
            breakoutType = "NONE";
            breakoutStrength = "NONE";
        } else {
            breakout = false;
            breakdown = false;
            breakoutType = "NONE";
            breakdownType = "NONE";
            breakoutStrength = "NONE";
            breakdownStrength = "NONE";
        }
    }

    return {
        valid: true,
        breakout, breakoutType, breakoutStrength, breakoutScore, freshBreakout, aboveResistance, nearResistance, bullishTrendDeveloping,
        breakdown, breakdownType, breakdownStrength, breakdownScore, freshBreakdown, belowSupport, nearSupport, bearishTrendDeveloping,
        volumeConfirmed, trendConfirmed, strongTrendConfirmed, momentumConfirmed,
        bearishVolumeConfirmed, bearishTrendConfirmed, strongBearishTrendConfirmed, bearishMomentumConfirmed,
        vwapBullish, vwapBearish, adxConfirmed, strongADX, bullishDIConfirmed, bearishDIConfirmed,
        rvol, rsi: Number.isFinite(rsi) ? rsi : 0, adx: Number.isFinite(adx.value) ? adx.value : 0,
        pdi: Number.isFinite(adx.pdi) ? adx.pdi : 0, mdi: Number.isFinite(adx.mdi) ? adx.mdi : 0,
        resistance1, support1, close, high, low, previousClose
    };
}

const detectBreakout = calculateBreakout;

module.exports = { calculateBreakout, detectBreakout };