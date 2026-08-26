const { ATR } = require("technicalindicators");

function neutralResult() {
    return { value: null, trend: "NEUTRAL", buySignal: false, sellSignal: false };
}

/**
 * Calculate Supertrend from OHLC candles.
 * Defaults: ATR period 10, multiplier 3.
 */
function calculateSupertrend(candles, period = 10, multiplier = 3) {
    period = Number(period);
    multiplier = Number(multiplier);

    if (!Array.isArray(candles) || !Number.isInteger(period) || period < 1 || !Number.isFinite(multiplier) || multiplier <= 0) {
        return neutralResult();
    }

    const clean = candles.filter(c => {
        if (!c || typeof c !== "object") return false;
        const h = Number(c.high), l = Number(c.low), cl = Number(c.close);
        return Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(cl) && h > 0 && l > 0 && cl > 0 && h >= l;
    });

    if (clean.length < period + 2) return neutralResult();

    const high = clean.map(c => Number(c.high));
    const low = clean.map(c => Number(c.low));
    const close = clean.map(c => Number(c.close));

    let atr;
    try {
        atr = ATR.calculate({ high, low, close, period });
    } catch (error) {
        return neutralResult();
    }

    if (!Array.isArray(atr) || atr.length === 0) return neutralResult();

    const finalUpperBand = [];
    const finalLowerBand = [];
    const supertrend = [];
    const trends = [];
    const start = period;

    for (let i = start; i < close.length; i++) {
        const atrValue = Number(atr[i - start]);
        if (!Number.isFinite(atrValue) || atrValue < 0) continue;

        const hl2 = (high[i] + low[i]) / 2;
        const basicUpper = hl2 + multiplier * atrValue;
        const basicLower = hl2 - multiplier * atrValue;

        if (finalUpperBand.length === 0) {
            finalUpperBand.push(basicUpper);
            finalLowerBand.push(basicLower);

            // Use the first close relative to the midpoint only to establish
            // the initial state. Thereafter state is carried explicitly.
            const initialTrend = close[i] >= hl2 ? "BULLISH" : "BEARISH";
            trends.push(initialTrend);
            supertrend.push(initialTrend === "BULLISH" ? basicLower : basicUpper);
            continue;
        }

        const prevUpper = finalUpperBand[finalUpperBand.length - 1];
        const prevLower = finalLowerBand[finalLowerBand.length - 1];
        const prevClose = close[i - 1];

        const upper = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
        const lower = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;

        finalUpperBand.push(upper);
        finalLowerBand.push(lower);

        const previousTrend = trends[trends.length - 1];
        let currentTrend;

        if (previousTrend === "BEARISH") {
            currentTrend = close[i] > upper ? "BULLISH" : "BEARISH";
        } else {
            currentTrend = close[i] < lower ? "BEARISH" : "BULLISH";
        }

        trends.push(currentTrend);
        supertrend.push(currentTrend === "BULLISH" ? lower : upper);
    }

    if (trends.length < 2 || supertrend.length === 0) return neutralResult();

    const last = trends.length - 1;
    const currentTrend = trends[last];
    const previousTrend = trends[last - 1];

    return {
        value: supertrend[last],
        trend: currentTrend,
        buySignal: previousTrend === "BEARISH" && currentTrend === "BULLISH",
        sellSignal: previousTrend === "BULLISH" && currentTrend === "BEARISH"
    };
}

module.exports = { calculateSupertrend };