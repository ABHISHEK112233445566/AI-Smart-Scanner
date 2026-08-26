const { ATR } = require("technicalindicators");

/**
 * Calculate Supertrend from OHLC candles.
 *
 * Defaults: ATR period 10, multiplier 3.
 * Returns the latest value/trend plus only the latest trend-transition signals.
 */
function calculateSupertrend(candles, period = 10, multiplier = 3) {
    if (!Array.isArray(candles) || candles.length < period + 2) {
        return {
            value: null,
            trend: "NEUTRAL",
            buySignal: false,
            sellSignal: false
        };
    }

    const clean = candles.filter(c => {
        if (!c || typeof c !== "object") return false;
        const h = Number(c.high);
        const l = Number(c.low);
        const cl = Number(c.close);
        return Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(cl) && h > 0 && l > 0 && cl > 0 && h >= l;
    });

    if (clean.length < period + 2 || !Number.isFinite(Number(multiplier)) || Number(multiplier) <= 0) {
        return {
            value: null,
            trend: "NEUTRAL",
            buySignal: false,
            sellSignal: false
        };
    }

    const high = clean.map(c => Number(c.high));
    const low = clean.map(c => Number(c.low));
    const close = clean.map(c => Number(c.close));
    const atr = ATR.calculate({ high, low, close, period });

    // ATR has `period - 1` fewer values than the candle array. The first
    // usable Supertrend candle therefore maps to candle index period.
    const start = period;
    const finalUpperBand = [];
    const finalLowerBand = [];
    const supertrend = [];
    const trends = [];

    for (let i = start; i < close.length; i++) {
        const atrValue = Number(atr[i - start]);
        if (!Number.isFinite(atrValue)) continue;

        const hl2 = (high[i] + low[i]) / 2;
        const basicUpper = hl2 + Number(multiplier) * atrValue;
        const basicLower = hl2 - Number(multiplier) * atrValue;

        if (finalUpperBand.length === 0) {
            finalUpperBand.push(basicUpper);
            finalLowerBand.push(basicLower);
            // Start with an explicit state instead of inferring it from
            // floating-point equality of Supertrend/band values.
            const initialTrend = close[i] >= hl2 ? "BULLISH" : "BEARISH";
            trends.push(initialTrend);
            supertrend.push(initialTrend === "BULLISH" ? basicLower : basicUpper);
            continue;
        }

        const prevUpper = finalUpperBand[finalUpperBand.length - 1];
        const prevLower = finalLowerBand[finalLowerBand.length - 1];
        const prevClose = close[i - 1];

        const upper = basicUpper < prevUpper || prevClose > prevUpper
            ? basicUpper
            : prevUpper;
        const lower = basicLower > prevLower || prevClose < prevLower
            ? basicLower
            : prevLower;

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

    if (!trends.length) {
        return {
            value: null,
            trend: "NEUTRAL",
            buySignal: false,
            sellSignal: false
        };
    }

    const lastTrend = trends[trends.length - 1];
    const previousTrend = trends.length > 1 ? trends[trends.length - 2] : "NEUTRAL";

    return {
        value: supertrend[supertrend.length - 1],
        trend: lastTrend,
        buySignal: lastTrend === "BULLISH" && previousTrend === "BEARISH",
        sellSignal: lastTrend === "BEARISH" && previousTrend === "BULLISH"
    };
}

module.exports = {
    calculateSupertrend
};