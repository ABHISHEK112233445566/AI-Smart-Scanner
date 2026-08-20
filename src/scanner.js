// ============================================================
// STOCK SCANNER V4 — SEQUENTIAL QUALIFICATION PIPELINE
// ============================================================
// FLOW
// 1. Fetch daily stock data
// 2. Cheap technical / score pre-filter
// 3. Direction filter
// 4. Momentum / breakout confirmation
// 5. MTF confirmation ONLY for survivors
// 6. Final ranking ONLY for survivors
// 7. Options engine receives qualified survivors
//
// IMPORTANT
// - Options are NOT touched during stock scanning.
// - MTF is NOT calculated for rejected stocks.
// - A stock can be bullish OR bearish; no forced CALL/PUT.
// - Weak/sideways stocks are removed early.
// ============================================================

const {
    getHistoricalData,
    getInstrument
} = require("./brokers");

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

// ============================================================
// PIPELINE CONFIG
// ============================================================

const PIPELINE_CONFIG = Object.freeze({
    PRE_SCORE_MIN: 55,
    PRE_MOMENTUM_MIN: 2,
    MAX_QUALIFIED_STOCKS: 20,
    DAILY_CANDLE_MIN: 220
});

// ============================================================
// HELPERS
// ============================================================

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
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
        instrument.instrumentKey,
        instrument.instrument_key,
        instrument.instrumentToken,
        instrument.instrument_token,
        instrument.exchangeToken,
        instrument.exchange_token,
        instrument.token,
        instrument.key,
        instrument.instrumentId,
        instrument.instrument_id,
        instrument.symbol,
        instrument.tradingsymbol,
        instrument.tradingSymbol
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
        const high = Number(c.high);
        const low = Number(c.low);
        const close = Number(c.close);
        return Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && high >= low && close > 0;
    });
}

// ============================================================
// TECHNICAL DIRECTION
// ============================================================

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

    let bull = 0;
    let bear = 0;

    if (p > ema20) bull++;
    if (p < ema20) bear++;
    if (ema20 > ema50) bull++;
    if (ema20 < ema50) bear++;
    if (ema100 > 0 && ema50 > ema100) bull++;
    if (ema100 > 0 && ema50 < ema100) bear++;
    if (ema200 > 0 && ema100 > ema200) bull++;
    if (ema200 > 0 && ema100 < ema200) bear++;
    if (rsi > 50) bull++;
    if (rsi < 50) bear++;
    if (macd > signal) bull++;
    if (macd < signal) bear++;
    if (histogram > 0) bull++;
    if (histogram < 0) bear++;
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

    const ai = normalizeDirection(signal);
    const tr = normalizeDirection(trend);

    if (ai !== "NEUTRAL" && tr !== "NEUTRAL") return ai === tr ? ai : "NEUTRAL";
    if (ai !== "NEUTRAL") return ai;
    if (tr !== "NEUTRAL") return tr;
    return "NEUTRAL";
}

// ============================================================
// PRE-FILTER
// ============================================================

function evaluatePreFilter({ scoreData, indicators, breakout, direction }) {
    const score = clampScore(scoreData.finalScore ?? scoreData.score);
    const { macd, signal, histogram } = getMACDValues(indicators);
    const rsi = toNumber(indicators.rsi);
    const adx = toNumber(safeObject(indicators.adx).adx ?? indicators.adxValue);
    const pdi = toNumber(safeObject(indicators.adx).pdi ?? safeObject(indicators.adx).PDI);
    const mdi = toNumber(safeObject(indicators.adx).mdi ?? safeObject(indicators.adx).MDI);
    const rvol = toNumber(indicators.rvol);

    if (score < PIPELINE_CONFIG.PRE_SCORE_MIN) {
        return { passed: false, reason: "LOW_SCORE", momentumScore: 0 };
    }

    if (direction === "NEUTRAL") {
        return { passed: false, reason: "NO_DIRECTION", momentumScore: 0 };
    }

    let momentum = 0;
    const bullish = direction === "BULLISH";

    if (bullish ? rsi >= 50 : rsi <= 50) momentum++;
    if (bullish ? macd >= signal && histogram >= 0 : macd <= signal && histogram <= 0) momentum++;
    if (adx >= 20 && (bullish ? pdi > mdi : mdi > pdi)) momentum++;
    if (rvol >= 1.0 || safeBoolean(breakout.volumeConfirmed)) momentum++;
    if (safeBoolean(breakout.breakout) || safeBoolean(breakout.momentumConfirmed)) momentum++;

    if (momentum < PIPELINE_CONFIG.PRE_MOMENTUM_MIN) {
        return { passed: false, reason: "WEAK_MOMENTUM", momentumScore: momentum };
    }

    return { passed: true, reason: "QUALIFIED", momentumScore: momentum };
}

// ============================================================
// BUILD RESULT
// ============================================================

function buildStockAnalysis({ stockSymbol, instrumentKey, latestPrice, indicators, scoreData, trade, sr, breakout, mtf, pivot, cpr, stockDirection, technicalDirection, preFilter }) {
    const { macd, signal, histogram } = getMACDValues(indicators);
    const adx = safeObject(indicators.adx);

    return {
        stock: stockSymbol,
        symbol: stockSymbol,
        tradingSymbol: stockSymbol,
        instrumentKey,
        price: latestPrice,
        direction: stockDirection,
        stockDirection,
        technicalDirection,
        isBullish: stockDirection === "BULLISH",
        isBearish: stockDirection === "BEARISH",

        score: scoreData.score,
        scannerScore: scoreData.score,
        aiScore: scoreData.score,
        aiFinalScore: scoreData.finalScore,
        aiRating: scoreData.rating || "N/A",
        signal: scoreData.signal || "NO SIGNAL",
        bullishScore: scoreData.bullishScore,
        bearishScore: scoreData.bearishScore,
        callScore: scoreData.bullishScore,
        putScore: scoreData.bearishScore,

        entry: toNumber(trade.entry),
        stopLoss: toNumber(trade.stopLoss),
        target1: toNumber(trade.target1),
        target2: toNumber(trade.target2),
        risk: toNumber(trade.risk),
        reward: toNumber(trade.reward),
        riskReward: toNumber(trade.riskReward),
        trend: trade.trend || "",
        confidence: clampScore(trade.confidence),

        support1: toNumber(sr.support1),
        support2: toNumber(sr.support2),
        support3: toNumber(sr.support3),
        resistance1: toNumber(sr.resistance1),
        resistance2: toNumber(sr.resistance2),
        resistance3: toNumber(sr.resistance3),

        breakout: safeBoolean(breakout.breakout),
        breakoutType: breakout.breakoutType || "",
        breakoutStrength: breakout.breakoutStrength || "",
        breakoutScore: toNumber(breakout.breakoutScore),
        aboveResistance: safeBoolean(breakout.aboveResistance),
        belowSupport: safeBoolean(breakout.belowSupport),
        nearResistance: safeBoolean(breakout.nearResistance),
        nearSupport: safeBoolean(breakout.nearSupport),
        volumeConfirmed: safeBoolean(breakout.volumeConfirmed),
        trendConfirmed: safeBoolean(breakout.trendConfirmed),
        momentumConfirmed: safeBoolean(breakout.momentumConfirmed),

        dailyTrend: mtf.dailyTrend || "",
        fourHourTrend: mtf.fourHourTrend || "",
        oneHourTrend: mtf.oneHourTrend || "",
        fifteenMinTrend: mtf.fifteenMinTrend || "",
        mtfScore: toNumber(mtf.mtfScore),
        mtfAlignment: toNumber(mtf.mtfAlignment),
        mtfAlignedTimeframes: toNumber(mtf.alignedTimeframes),

        pivot: toNumber(pivot.pivot),
        pivotR1: toNumber(pivot.r1),
        pivotR2: toNumber(pivot.r2),
        pivotR3: toNumber(pivot.r3),
        pivotS1: toNumber(pivot.s1),
        pivotS2: toNumber(pivot.s2),
        pivotS3: toNumber(pivot.s3),

        cprTop: toNumber(cpr.top),
        cprBottom: toNumber(cpr.bottom),
        cprWidth: toNumber(cpr.width),
        cprType: cpr.type || "",

        ema5: toNumber(indicators.ema5),
        ema9: toNumber(indicators.ema9),
        ema20: toNumber(indicators.ema20),
        ema50: toNumber(indicators.ema50),
        ema100: toNumber(indicators.ema100),
        ema200: toNumber(indicators.ema200),
        rsi: toNumber(indicators.rsi),
        macd,
        macdValue: macd,
        macdSignal: signal,
        histogram,
        adx: toNumber(adx.adx ?? indicators.adxValue),
        pdi: toNumber(adx.pdi ?? adx.PDI),
        mdi: toNumber(adx.mdi ?? adx.MDI),
        atr: toNumber(indicators.atr),
        bollingerUpper: toNumber(indicators.bollinger?.upper),
        bollingerMiddle: toNumber(indicators.bollinger?.middle),
        bollingerLower: toNumber(indicators.bollinger?.lower),
        volume: toNumber(indicators.volume),
        volumeSMA20: toNumber(indicators.volumeSMA20),
        rvol: toNumber(indicators.rvol),
        volumeSpike: safeBoolean(indicators.volumeSpike),
        obv: toNumber(indicators.obv),
        mfi: toNumber(indicators.mfi),
        supertrend: indicators.supertrend?.trend ?? indicators.supertrend ?? "",
        vwap: toNumber(indicators.vwap),

        pipeline: {
            preFilter: preFilter.reason,
            momentumScore: preFilter.momentumScore,
            mtfChecked: true,
            optionsChecked: false
        }
    };
}

// ============================================================
// SCAN ONE STOCK
// ============================================================

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

        // ====================================================
        // STAGE 1 — RAW DAILY DATA
        // ====================================================
        const instrument = await getInstrument(stockSymbol);
        if (!instrument) throw new Error(`Instrument not found: ${stockSymbol}`);

        const instrumentKey = resolveInstrumentKey(instrument);
        if (!instrumentKey) throw new Error(`Instrument key missing: ${stockSymbol}`);

        const candles = await getHistoricalData(instrumentKey, "ONE_DAY");
        if (!validateCandles(candles)) {
            throw new Error(`Invalid/insufficient daily candles: ${Array.isArray(candles) ? candles.length : 0}`);
        }

        const latestCandle = latestValidCandle(candles);
        if (!latestCandle) throw new Error("Latest valid candle unavailable");

        const latestPrice = toNumber(latestCandle.close, NaN);
        if (!Number.isFinite(latestPrice) || latestPrice <= 0) throw new Error("Invalid latest price");

        // ====================================================
        // STAGE 2 — CHEAP TECHNICAL FILTER
        // ====================================================
        const indicators = safeObject(calculateIndicators(candles));
        const scoreDataRaw = safeObject(calculateScore({ price: latestPrice, ...indicators }));
        const scoreData = {
            score: clampScore(scoreDataRaw.score ?? scoreDataRaw.aiScore),
            finalScore: clampScore(scoreDataRaw.finalScore ?? scoreDataRaw.aiFinalScore ?? scoreDataRaw.score),
            bullishScore: clampScore(scoreDataRaw.bullishScore ?? scoreDataRaw.bullScore ?? scoreDataRaw.callScore),
            bearishScore: clampScore(scoreDataRaw.bearishScore ?? scoreDataRaw.bearScore ?? scoreDataRaw.putScore),
            rating: scoreDataRaw.rating || "N/A",
            signal: scoreDataRaw.signal || scoreDataRaw.direction || "NO SIGNAL"
        };

        let trade = {};
        try { trade = safeObject(calculateTradeSetup(latestPrice, indicators)); } catch (_) {}

        const sr = safeObject(calculateSupportResistance(candles));
        const breakout = safeObject(calculateBreakout(candles, indicators, sr));

        const directionIndicators = { ...indicators, price: latestPrice };
        const technicalDirection = determineTechnicalDirection(directionIndicators, latestPrice);
        const stockDirection = determineStockDirection(scoreData.signal, trade.trend, directionIndicators);

        const preFilter = evaluatePreFilter({ scoreData, indicators, breakout, direction: stockDirection });

        if (!preFilter.passed) {
            return {
                stock: stockSymbol,
                symbol: stockSymbol,
                tradingSymbol: stockSymbol,
                instrumentKey,
                price: latestPrice,
                direction: stockDirection,
                technicalDirection,
                score: scoreData.score,
                finalScore: scoreData.finalScore,
                signal: scoreData.signal,
                pipeline: {
                    preFilter: preFilter.reason,
                    momentumScore: preFilter.momentumScore,
                    mtfChecked: false,
                    optionsChecked: false
                },
                qualified: false,
                rejectionStage: preFilter.reason
            };
        }

        // ====================================================
        // STAGE 3 — MTF CONFIRMATION
        // Only qualified stocks reach this expensive stage.
        // ====================================================
        let mtf = {};
        try {
            mtf = safeObject(await getMultiTimeframeAnalysis(stockSymbol));
        } catch (error) {
            console.log(`⚠️ ${stockSymbol}: MTF unavailable | ${error?.message || error}`);
        }

        const mtfDirections = [mtf.dailyTrend, mtf.fourHourTrend, mtf.oneHourTrend, mtf.fifteenMinTrend]
            .map(normalizeDirection)
            .filter(x => x !== "NEUTRAL");
        const expected = stockDirection;
        const mtfAligned = mtfDirections.filter(x => x === expected).length;
        const mtfOpposed = mtfDirections.filter(x => x !== expected).length;

        // Reject only when MTF is available and clearly opposed.
        if (mtfDirections.length >= 3 && mtfAligned < 2 && mtfOpposed >= 2) {
            return {
                stock: stockSymbol,
                symbol: stockSymbol,
                tradingSymbol: stockSymbol,
                instrumentKey,
                price: latestPrice,
                direction: stockDirection,
                technicalDirection,
                score: scoreData.score,
                finalScore: scoreData.finalScore,
                signal: scoreData.signal,
                dailyTrend: mtf.dailyTrend || "",
                fourHourTrend: mtf.fourHourTrend || "",
                oneHourTrend: mtf.oneHourTrend || "",
                fifteenMinTrend: mtf.fifteenMinTrend || "",
                mtfAlignment: mtfAligned,
                pipeline: { preFilter: "QUALIFIED", momentumScore: preFilter.momentumScore, mtfChecked: true, optionsChecked: false },
                qualified: false,
                rejectionStage: "MTF_CONFLICT"
            };
        }

        // ====================================================
        // STAGE 4 — FULL STOCK ANALYSIS + RANKING
        // ====================================================
        const pivot = safeObject(calculatePivotPoints(candles));
        const cpr = safeObject(calculateCPR(candles));

        const stockAnalysis = buildStockAnalysis({
            stockSymbol,
            instrumentKey,
            latestPrice,
            indicators,
            scoreData,
            trade,
            sr,
            breakout,
            mtf,
            pivot,
            cpr,
            stockDirection,
            technicalDirection,
            preFilter
        });

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
        return null;
    }
}

// ============================================================
// SCAN MULTIPLE STOCKS — STRICTLY SEQUENTIAL
// ============================================================
// This function intentionally uses one stock at a time.
// It is available to app/cloud runners that want true stage-wise
// sequencing instead of Promise.all batches.
// ============================================================

async function scanStocks(stocks) {
    if (!Array.isArray(stocks)) return [];

    const qualified = [];
    const rejected = [];

    for (const stock of stocks) {
        const result = await scanStock(stock);
        if (!result) continue;

        if (result.qualified) qualified.push(result);
        else rejected.push(result);
    }

    qualified.sort((a, b) =>
        Number(b.finalScore || b.score || 0) - Number(a.finalScore || a.score || 0)
    );

    // Do not send the entire universe to the option engine.
    // Keep a wider shortlist than TOP 5 so strong late movers are not lost.
    const shortlist = qualified.slice(0, PIPELINE_CONFIG.MAX_QUALIFIED_STOCKS);

    shortlist.forEach((item, index) => {
        item.pipeline.rank = index + 1;
        item.pipeline.optionsChecked = false;
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
