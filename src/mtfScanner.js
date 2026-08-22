// ============================================================
// MULTI TIMEFRAME SCANNER - V9
// ============================================================
// Broker independent. FOUR_HOUR is requested directly from the
// active broker. Upstox supplies the actual 4H candles.
// ============================================================

const { getBroker } = require("./brokers");
const { calculateIndicators } = require("./indicators");

function emptyTrend() {
    return { trend: "UNKNOWN", bullish: false, bearish: false, score: 0, bullishPoints: 0, bearishPoints: 0, valid: false };
}

function normalizeCandles(candles) {
    if (!Array.isArray(candles)) return [];
    return candles.map(c => {
        if (!c || typeof c !== "object") return null;
        return { timestamp: c.timestamp ?? c.time ?? c.datetime ?? c.date ?? c[0], open: Number(c.open ?? c.o ?? c[1]), high: Number(c.high ?? c.h ?? c[2]), low: Number(c.low ?? c.l ?? c[3]), close: Number(c.close ?? c.c ?? c[4]), volume: Number(c.volume ?? c.v ?? c[5] ?? 0) };
    }).filter(c => c && [c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function getNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function calculateTrend(symbol, interval, candles) {
    try {
        const dataCandles = normalizeCandles(candles);
        if (dataCandles.length < 50) return emptyTrend();
        const d = calculateIndicators(dataCandles);
        if (!d) return emptyTrend();
        const ema20 = getNumber(d.ema20), ema50 = getNumber(d.ema50), ema200 = getNumber(d.ema200), rsi = getNumber(d.rsi);
        const m = d.macd && typeof d.macd === "object" ? d.macd : {};
        const macd = getNumber(m.MACD ?? m.macd ?? m.value ?? d.macd), signal = getNumber(m.signal ?? m.Signal ?? d.macdSignal);
        const a = d.adx && typeof d.adx === "object" ? d.adx : {};
        const adx = getNumber(a.adx ?? a.ADX ?? d.adxValue ?? d.adx), pdi = getNumber(a.pdi ?? a.PDI ?? d.pdi ?? d.plusDI), mdi = getNumber(a.mdi ?? a.MDI ?? d.mdi ?? d.minusDI);
        let bull = 0, bear = 0;
        if (ema20 > 0 && ema50 > 0 && ema20 > ema50) bull++; if (ema20 > 0 && ema50 > 0 && ema20 < ema50) bear++;
        if (ema50 > 0 && ema200 > 0 && ema50 > ema200) bull++; if (ema50 > 0 && ema200 > 0 && ema50 < ema200) bear++;
        if (rsi > 50) bull++; if (rsi > 0 && rsi < 50) bear++;
        if (macd > signal) bull++; if (macd < signal) bear++;
        if (adx >= 20 && pdi > mdi) bull++; if (adx >= 20 && mdi > pdi) bear++;
        const bullish = bull >= 3 && bull > bear, bearish = bear >= 3 && bear > bull;
        const trend = bullish ? (bull >= 4 ? "STRONG BULLISH" : "BULLISH") : bearish ? (bear >= 4 ? "STRONG BEARISH" : "BEARISH") : "SIDEWAYS";
        return { trend, bullish, bearish, score: bullish ? bull : bearish ? -bear : 0, bullishPoints: bull, bearishPoints: bear, valid: true };
    } catch (error) { console.log(`⚠️ ${symbol} ${interval} MTF failed: ${error?.message || error}`); return emptyTrend(); }
}

async function getTrend(symbol, interval) {
    try {
        const broker = getBroker();
        if (!broker || typeof broker.getHistoricalData !== "function") throw new Error("Active broker does not implement getHistoricalData()");
        console.log(`MTF Request: ${symbol} ${interval}`);
        // IMPORTANT: never build 4H locally. The active broker owns timeframe semantics.
        const candles = await broker.getHistoricalData(symbol, interval);
        return calculateTrend(symbol, interval, candles);
    } catch (error) { console.log(`⚠️ ${symbol} ${interval} MTF failed: ${error?.message || error}`); return emptyTrend(); }
}

async function getMultiTimeframeAnalysis(symbol) {
    const [daily, fourHour, oneHour, fifteen] = await Promise.all([getTrend(symbol, "ONE_DAY"), getTrend(symbol, "FOUR_HOUR"), getTrend(symbol, "ONE_HOUR"), getTrend(symbol, "FIFTEEN_MINUTE")]);
    const timeframes = [daily, fourHour, oneHour, fifteen], weights = [30, 30, 20, 20];
    let mtfScore = 0;
    timeframes.forEach((tf, i) => { if (tf.bullish) mtfScore += weights[i]; else if (tf.bearish) mtfScore -= weights[i]; });
    const validTimeframes = timeframes.filter(tf => tf.valid), bullishTimeframes = validTimeframes.filter(tf => tf.bullish).length, bearishTimeframes = validTimeframes.filter(tf => tf.bearish).length, unknownTimeframes = timeframes.length - validTimeframes.length;
    let overallTrend = "SIDEWAYS";
    if (mtfScore >= 70) overallTrend = "STRONG BULLISH"; else if (mtfScore >= 40) overallTrend = "BULLISH"; else if (mtfScore <= -70) overallTrend = "STRONG BEARISH"; else if (mtfScore <= -40) overallTrend = "BEARISH";
    let alignment = "MIXED";
    if (validTimeframes.length === 4 && bullishTimeframes === 4) alignment = "FULL BULLISH"; else if (validTimeframes.length === 4 && bearishTimeframes === 4) alignment = "FULL BEARISH"; else if (bullishTimeframes >= 3 && bullishTimeframes > bearishTimeframes) alignment = "BULLISH ALIGNED"; else if (bearishTimeframes >= 3 && bearishTimeframes > bullishTimeframes) alignment = "BEARISH ALIGNED"; else if (!bullishTimeframes && !bearishTimeframes) alignment = "UNKNOWN";
    const directionBias = bullishTimeframes > bearishTimeframes ? "BULLISH" : bearishTimeframes > bullishTimeframes ? "BEARISH" : "NEUTRAL";
    const mtfAlignment = Math.max(bullishTimeframes, bearishTimeframes);
    console.log(`MTF Result: ${symbol} | Daily=${daily.trend} | 4H=${fourHour.trend} | 1H=${oneHour.trend} | 15M=${fifteen.trend} | Score=${mtfScore} | Bull=${bullishTimeframes} | Bear=${bearishTimeframes} | Unknown=${unknownTimeframes} | Alignment=${alignment}`);
    return { dailyTrend: daily.trend, fourHourTrend: fourHour.trend, oneHourTrend: oneHour.trend, fifteenMinTrend: fifteen.trend, mtfScore, overallTrend, bullishTimeframes, bearishTimeframes, unknownTimeframes, validTimeframes: validTimeframes.length, directionBias, alignment, mtfAlignment, alignedTimeframes: mtfAlignment, details: { daily, fourHour, oneHour, fifteen } };
}

module.exports = { getMultiTimeframeAnalysis, getTrend };
