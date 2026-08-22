// ============================================================
// STOCK SCANNER V4 — SEQUENTIAL QUALIFICATION PIPELINE
// ============================================================
// The scanner keeps the public scanStocks() return value as an
// array for compatibility with the options engine, but attaches
// the complete universe audit results to that array as:
//   result.allResults
//   result.rejected
// This prevents the options engine from receiving rejected stocks
// while allowing the SCANNER sheet to retain the complete scan.
// ============================================================

const { getHistoricalData, getInstrument } = require("./brokers");
const { calculateIndicators } = require("./indicators");
const { calculateScore } = require("./aiEngine");
const { calculateTradeSetup } = require("./tradeSetup");
const { calculateSupportResistance } = require("./supportResistance");
const { calculateBreakout } = require("./breakout");
const { getMultiTimeframeAnalysis } = require("./mtfScanner");
const { calculatePivotPoints } = require("./pivotPoints");
const { calculateCPR } = require("./cpr");
const { calculateFinalRank } = require("./rankingEngine");

const DASHBOARD_MIN_SCORE = 85;

const PIPELINE_CONFIG = Object.freeze({
    PRE_SCORE_MIN: 55,
    PRE_MOMENTUM_MIN: 2,
    MAX_QUALIFIED_STOCKS: 20,
    DAILY_CANDLE_MIN: 220
});

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeBoolean(value) {
    if (value === true || value === false) return value;
    return typeof value === "string" && value.trim().toUpperCase() === "TRUE";
}

function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(toNumber(value))));
}

function normalizeDirection(value) {
    const s = String(value || "").trim().toUpperCase();
    if (["BULLISH", "BULL", "LONG", "CALL", "CE", "BUY", "BUY SIGNAL", "STRONG BUY", "UP"].includes(s)) return "BULLISH";
    if (["BEARISH", "BEAR", "SHORT", "PUT", "PE", "SELL", "SELL SIGNAL", "STRONG SELL", "DOWN"].includes(s)) return "BEARISH";
    return "NEUTRAL";
}

function getMACDValues(indicators = {}) {
    const m = safeObject(indicators.macd);
    const macd = toNumber(m.MACD ?? m.macd ?? indicators.MACD);
    const signal = toNumber(m.signal ?? m.Signal ?? indicators.macdSignal ?? indicators.MACDSignal);
    const histogram = toNumber(m.histogram ?? m.Histogram ?? indicators.histogram, macd - signal);
    return { macd, signal, histogram };
}

function resolveInstrumentKey(instrument) {
    if (typeof instrument === "string" && instrument.trim()) return instrument.trim();
    if (!instrument || typeof instrument !== "object") return null;
    const candidates = [
        instrument.instrumentKey, instrument.instrument_key,
        instrument.instrumentToken, instrument.instrument_token,
        instrument.exchangeToken, instrument.exchange_token,
        instrument.token, instrument.key, instrument.instrumentId,
        instrument.instrument_id, instrument.symbol,
        instrument.tradingsymbol, instrument.tradingSymbol
    ];
    for (const value of candidates) {
        if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    }
    return null;
}

function latestValidCandle(candles) {
    if (!Array.isArray(candles)) return null;
    for (let i = candles.length - 1; i >= 0; i--) {
        const c = candles[i];
        if (c && Number.isFinite(Number(c.close)) && Number(c.close) > 0) return c;
    }
    return null;
}

function validateCandles(candles) {
    if (!Array.isArray(candles) || candles.length < PIPELINE_CONFIG.DAILY_CANDLE_MIN) return false;
    return candles.every(c => {
        if (!c || typeof c !== "object") return false;
        const high = Number(c.high), low = Number(c.low), close = Number(c.close);
        return Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && high >= low && close > 0;
    });
}

function determineTechnicalDirection(indicators = {}, price = 0) {
    const p = toNumber(price || indicators.price);
    const ema20 = toNumber(indicators.ema20 ?? indicators.EMA20);
    const ema50 = toNumber(indicators.ema50 ?? indicators.EMA50);
    const ema100 = toNumber(indicators.ema100 ?? indicators.EMA100);
    const ema200 = toNumber(indicators.ema200 ?? indicators.EMA200);
    const rsi = toNumber(indicators.rsi ?? indicators.RSI);
    const { macd, signal, histogram } = getMACDValues(indicators);
    const adxData = safeObject(indicators.adx);
    const adx = toNumber(adxData.adx ?? indicators.adxValue);
    const pdi = toNumber(adxData.pdi ?? adxData.PDI);
    const mdi = toNumber(adxData.mdi ?? adxData.MDI);
    if (p <= 0 || ema20 <= 0 || ema50 <= 0) return "NEUTRAL";
    let bull = 0, bear = 0;
    if (p > ema20) bull++; if (p < ema20) bear++;
    if (ema20 > ema50) bull++; if (ema20 < ema50) bear++;
    if (ema100 > 0 && ema50 > ema100) bull++; if (ema100 > 0 && ema50 < ema100) bear++;
    if (ema200 > 0 && ema100 > ema200) bull++; if (ema200 > 0 && ema100 < ema200) bear++;
    if (rsi > 50) bull++; if (rsi < 50) bear++;
    if (macd > signal) bull++; if (macd < signal) bear++;
    if (histogram > 0) bull++; if (histogram < 0) bear++;
    if (adx >= 20 && pdi > mdi) bull += 2;
    if (adx >= 20 && mdi > pdi) bear += 2;
    if (bull >= 6 && bull >= bear + 2) return "BULLISH";
    if (bear >= 6 && bear >= bull + 2) return "BEARISH";
    const bullStructure = p > ema20 && ema20 > ema50 && rsi >= 50 && macd >= signal;
    const bearStructure = p < ema20 && ema20 < ema50 && rsi <= 50 && macd <= signal;
    if (bullStructure && !bearStructure) return "BULLISH";
    if (bearStructure && !bullStructure) return "BEARISH";
    return "NEUTRAL";
}

function determineStockDirection(signal, trend, indicators) {
    const technical = determineTechnicalDirection(indicators, indicators.price);
    if (technical !== "NEUTRAL") return technical;
    const ai = normalizeDirection(signal), tr = normalizeDirection(trend);
    if (ai !== "NEUTRAL" && tr !== "NEUTRAL") return ai === tr ? ai : "NEUTRAL";
    if (ai !== "NEUTRAL") return ai;
    if (tr !== "NEUTRAL") return tr;
    return "NEUTRAL";
}

function evaluatePreFilter({ scoreData, indicators, breakout, direction }) {
    const score = clampScore(scoreData.finalScore ?? scoreData.score);
    const { macd, signal, histogram } = getMACDValues(indicators);
    const rsi = toNumber(indicators.rsi);
    const adxData = safeObject(indicators.adx);
    const adx = toNumber(adxData.adx ?? indicators.adxValue);
    const pdi = toNumber(adxData.pdi ?? adxData.PDI);
    const mdi = toNumber(adxData.mdi ?? adxData.MDI);
    const rvol = toNumber(indicators.rvol);
    if (score < PIPELINE_CONFIG.PRE_SCORE_MIN) return { passed: false, reason: "LOW_SCORE", momentumScore: 0 };
    if (direction === "NEUTRAL") return { passed: false, reason: "NO_DIRECTION", momentumScore: 0 };
    let momentum = 0;
    const bullish = direction === "BULLISH";
    if (bullish ? rsi >= 50 : rsi <= 50) momentum++;
    if (bullish ? macd >= signal && histogram >= 0 : macd <= signal && histogram <= 0) momentum++;
    if (adx >= 20 && (bullish ? pdi > mdi : mdi > pdi)) momentum++;
    if (rvol >= 1.0 || safeBoolean(breakout.volumeConfirmed)) momentum++;
    if (safeBoolean(breakout.breakout) || safeBoolean(breakout.momentumConfirmed)) momentum++;
    if (momentum < PIPELINE_CONFIG.PRE_MOMENTUM_MIN) return { passed: false, reason: "WEAK_MOMENTUM", momentumScore: momentum };
    return { passed: true, reason: "QUALIFIED", momentumScore: momentum };
}

function buildStockAnalysis({ stockSymbol, instrumentKey, latestPrice, indicators, scoreData, trade, sr, breakout, mtf, pivot, cpr, stockDirection, technicalDirection, preFilter }) {
    const { macd, signal, histogram } = getMACDValues(indicators);
    const adx = safeObject(indicators.adx);
    return {
        stock: stockSymbol, symbol: stockSymbol, tradingSymbol: stockSymbol, instrumentKey,
        price: latestPrice, direction: stockDirection, stockDirection, technicalDirection,
        isBullish: stockDirection === "BULLISH", isBearish: stockDirection === "BEARISH",
        score: scoreData.score, scannerScore: scoreData.score, aiScore: scoreData.score,
        aiFinalScore: scoreData.finalScore, aiRating: scoreData.rating || "N/A",
        signal: scoreData.signal || "NO SIGNAL", bullishScore: scoreData.bullishScore,
        bearishScore: scoreData.bearishScore, callScore: scoreData.bullishScore, putScore: scoreData.bearishScore,
        entry: toNumber(trade.entry), stopLoss: toNumber(trade.stopLoss), target1: toNumber(trade.target1),
        target2: toNumber(trade.target2), risk: toNumber(trade.risk), reward: toNumber(trade.reward),
        riskReward: toNumber(trade.riskReward), trend: trade.trend || "", confidence: clampScore(trade.confidence),
        support1: toNumber(sr.support1), support2: toNumber(sr.support2), support3: toNumber(sr.support3),
        resistance1: toNumber(sr.resistance1), resistance2: toNumber(sr.resistance2), resistance3: toNumber(sr.resistance3),
        breakout: safeBoolean(breakout.breakout), breakoutType: breakout.breakoutType || "",
        breakoutStrength: breakout.breakoutStrength || "", breakoutScore: toNumber(breakout.breakoutScore),
        aboveResistance: safeBoolean(breakout.aboveResistance), belowSupport: safeBoolean(breakout.belowSupport),
        nearResistance: safeBoolean(breakout.nearResistance), nearSupport: safeBoolean(breakout.nearSupport),
        volumeConfirmed: safeBoolean(breakout.volumeConfirmed), trendConfirmed: safeBoolean(breakout.trendConfirmed),
        momentumConfirmed: safeBoolean(breakout.momentumConfirmed),
        dailyTrend: mtf.dailyTrend || "", fourHourTrend: mtf.fourHourTrend || "",
        oneHourTrend: mtf.oneHourTrend || "", fifteenMinTrend: mtf.fifteenMinTrend || "",
        mtfScore: toNumber(mtf.mtfScore), mtfAlignment: toNumber(mtf.mtfAlignment), mtfAlignedTimeframes: toNumber(mtf.alignedTimeframes),
        pivot: toNumber(pivot.pivot), pivotR1: toNumber(pivot.r1), pivotR2: toNumber(pivot.r2), pivotR3: toNumber(pivot.r3),
        pivotS1: toNumber(pivot.s1), pivotS2: toNumber(pivot.s2), pivotS3: toNumber(pivot.s3),
        cprTop: toNumber(cpr.top), cprBottom: toNumber(cpr.bottom), cprWidth: toNumber(cpr.width), cprType: cpr.type || "",
        ema5: toNumber(indicators.ema5), ema9: toNumber(indicators.ema9), ema20: toNumber(indicators.ema20),
        ema50: toNumber(indicators.ema50), ema100: toNumber(indicators.ema100), ema200: toNumber(indicators.ema200),
        rsi: toNumber(indicators.rsi), macd, macdValue: macd, macdSignal: signal, histogram,
        adx: toNumber(adx.adx ?? indicators.adxValue), pdi: toNumber(adx.pdi ?? adx.PDI), mdi: toNumber(adx.mdi ?? adx.MDI),
        atr: toNumber(indicators.atr), bollingerUpper: toNumber(indicators.bollinger?.upper),
        bollingerMiddle: toNumber(indicators.bollinger?.middle), bollingerLower: toNumber(indicators.bollinger?.lower),
        volume: toNumber(indicators.volume), volumeSMA20: toNumber(indicators.volumeSMA20), rvol: toNumber(indicators.rvol),
        volumeSpike: safeBoolean(indicators.volumeSpike), obv: toNumber(indicators.obv), mfi: toNumber(indicators.mfi),
        supertrend: indicators.supertrend?.trend ?? indicators.supertrend ?? "", vwap: toNumber(indicators.vwap),
        pipeline: { preFilter: preFilter.reason, momentumScore: preFilter.momentumScore, mtfChecked: true, optionsChecked: false }
    };
}

async function scanStock(stock) {
    let stockSymbol = "";
    try {
        if (stock === null || stock === undefined) throw new Error("Invalid stock symbol");
        stockSymbol = typeof stock === "object"
            ? String(stock.symbol || stock.tradingSymbol || stock.tradingsymbol || stock.name || "").trim()
            : String(stock).trim();
        if (!stockSymbol) throw new Error("Empty stock symbol");
        if (typeof getInstrument !== "function") throw new Error("Broker adapter does not expose getInstrument()");
        if (typeof getHistoricalData !== "function") throw new Error("Broker adapter does not expose getHistoricalData()");

        const instrument = await getInstrument(stockSymbol);
        const instrumentKey = resolveInstrumentKey(instrument);
        if (!instrumentKey) throw new Error("Instrument key not found");

        const dailyCandles = await getHistoricalData(instrumentKey, "ONE_DAY");
        if (!validateCandles(dailyCandles)) throw new Error(`Insufficient/invalid daily candles: ${Array.isArray(dailyCandles) ? dailyCandles.length : 0}`);

        const lastCandle = latestValidCandle(dailyCandles);
        const latestPrice = toNumber(lastCandle?.close);
        if (latestPrice <= 0) throw new Error("Invalid latest stock price");

        const indicators = safeObject(await calculateIndicators(dailyCandles));
        indicators.price = latestPrice;

        const scoreData = safeObject(await calculateScore(indicators, dailyCandles));
        const technicalDirection = determineTechnicalDirection(indicators, latestPrice);
        const stockDirection = determineStockDirection(scoreData.signal, scoreData.trend, indicators);

        const breakout = safeObject(await calculateBreakout(dailyCandles, indicators));
        const preFilter = evaluatePreFilter({ scoreData, indicators, breakout, direction: stockDirection });

        if (!preFilter.passed) {
            return {
                stock: stockSymbol, symbol: stockSymbol, tradingSymbol: stockSymbol,
                instrumentKey, price: latestPrice, direction: stockDirection,
                stockDirection, technicalDirection, signal: scoreData.signal || "NO SIGNAL",
                score: scoreData.score, scannerScore: scoreData.score, aiScore: scoreData.score,
                aiFinalScore: scoreData.finalScore, confidence: clampScore(scoreData.confidence),
                qualified: false, rejectionReason: preFilter.reason,
                pipeline: { preFilter: preFilter.reason, momentumScore: preFilter.momentumScore, mtfChecked: false, optionsChecked: false }
            };
        }

        const trade = safeObject(await calculateTradeSetup(dailyCandles, indicators, stockDirection));
        const sr = safeObject(await calculateSupportResistance(dailyCandles));
        const pivot = safeObject(await calculatePivotPoints(dailyCandles));
        const cpr = safeObject(await calculateCPR(dailyCandles));
        const mtf = safeObject(await getMultiTimeframeAnalysis(stockSymbol, stockDirection));
        const mtfAligned = toNumber(mtf.mtfAlignment ?? mtf.alignment ?? mtf.alignedTimeframes);

        if (mtfAligned <= 0) {
            return {
                stock: stockSymbol, symbol: stockSymbol, tradingSymbol: stockSymbol,
                instrumentKey, price: latestPrice, direction: stockDirection,
                stockDirection, technicalDirection, signal: scoreData.signal || "NO SIGNAL",
                score: scoreData.score, scannerScore: scoreData.score, aiScore: scoreData.score,
                aiFinalScore: scoreData.finalScore, confidence: clampScore(trade.confidence),
                ...mtf, qualified: false, rejectionReason: "MTF_NO_ALIGNMENT",
                pipeline: { preFilter: preFilter.reason, momentumScore: preFilter.momentumScore, mtfChecked: true, optionsChecked: false }
            };
        }

        const stockAnalysis = buildStockAnalysis({ stockSymbol, instrumentKey, latestPrice, indicators, scoreData, trade, sr, breakout, mtf, pivot, cpr, stockDirection, technicalDirection, preFilter });
        let ranking = {};
        try { ranking = safeObject(calculateFinalRank(stockAnalysis)); } catch (_) {}
        const finalScore = clampScore(ranking.finalScore ?? ranking.score ?? stockAnalysis.finalScore ?? stockAnalysis.score);
        stockAnalysis.finalScore = finalScore;
        stockAnalysis.rankingScore = finalScore;
        stockAnalysis.rating = ranking.rating || "QUALIFIED";
        stockAnalysis.ranking = ranking;
        stockAnalysis.is85Plus = finalScore >= DASHBOARD_MIN_SCORE;
        stockAnalysis.is90Plus = finalScore >= 90;
        stockAnalysis.qualified = true;
        stockAnalysis.pipeline.mtfAlignment = mtfAligned;
        stockAnalysis.pipeline.optionsChecked = false;
        return stockAnalysis;
    } catch (error) {
        console.log(`❌ ${stockSymbol || stock}: ${error?.message || error}`);
        return {
            stock: stockSymbol || String(stock || ""),
            symbol: stockSymbol || String(stock || ""),
            qualified: false,
            rejectionReason: error?.message || String(error),
            pipeline: { preFilter: "ERROR", momentumScore: 0, mtfChecked: false, optionsChecked: false }
        };
    }
}

async function scanStocks(stocks) {
    if (!Array.isArray(stocks)) return [];
    const allResults = [];
    const qualified = [];
    const rejected = [];

    for (const stock of stocks) {
        const result = await scanStock(stock);
        if (!result) continue;
        allResults.push(result);
        if (result.qualified) qualified.push(result);
        else rejected.push(result);
    }

    qualified.sort((a, b) => Number(b.finalScore || b.score || 0) - Number(a.finalScore || a.score || 0));
    const shortlist = qualified.slice(0, PIPELINE_CONFIG.MAX_QUALIFIED_STOCKS);

    shortlist.forEach((item, index) => {
        item.pipeline.rank = index + 1;
        item.pipeline.optionsChecked = false;
    });

    // Keep the array contract so existing options code continues to work.
    // Attach complete audit data without sending it into the options engine.
    Object.defineProperties(shortlist, {
        allResults: { value: allResults, enumerable: false },
        rejected: { value: rejected, enumerable: false },
        qualifiedAll: { value: qualified, enumerable: false }
    });

    return shortlist;
}

module.exports = {
    scanStock,
    scanStocks,
    normalizeDirection,
    determineTechnicalDirection,
    determineStockDirection,
    DASHBOARD_MIN_SCORE,
    PIPELINE_CONFIG
};
