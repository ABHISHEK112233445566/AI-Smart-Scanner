// ============================================================
// STOCK SCANNER V5 — CANDIDATE PIPELINE FIX
// ============================================================
// The scanner must produce a usable ranked candidate pool.
// Options engine remains responsible for strict final quality gates.
// No synthetic SL/targets are created.
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
const config = require("./config");

const DASHBOARD_MIN_SCORE = Number(config.THRESHOLDS?.DASHBOARD_MIN_SCORE ?? config.DASHBOARD_MIN_SCORE ?? 90);
const PIPELINE_CONFIG = Object.freeze({
    PRE_SCORE_MIN: Number(config.THRESHOLDS?.PRE_SCORE_MIN ?? 55),
    MAX_QUALIFIED_STOCKS: Number(config.THRESHOLDS?.MAX_QUALIFIED_STOCKS ?? 20),
    DAILY_CANDLE_MIN: Number(config.THRESHOLDS?.DAILY_CANDLE_MIN ?? 220)
});

function toNumber(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function safeObject(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function safeBoolean(v) { if (v === true || v === false) return v; return String(v ?? "").trim().toUpperCase() === "TRUE"; }
function clampScore(v) { return Math.max(0, Math.min(100, Math.round(toNumber(v)))); }

function normalizeDirection(v) {
    const s = String(v || "").trim().toUpperCase();
    if (["BULLISH","BULL","LONG","CALL","CE","BUY","BUY SIGNAL","STRONG BUY","UP"].includes(s)) return "BULLISH";
    if (["BEARISH","BEAR","SHORT","PUT","PE","SELL","SELL SIGNAL","STRONG SELL","DOWN"].includes(s)) return "BEARISH";
    return "NEUTRAL";
}

function getMACDValues(i = {}) {
    const m = safeObject(i.macd);
    const macd = toNumber(m.MACD ?? m.macd ?? m.value ?? i.MACD ?? i.macdValue ?? i.macd);
    const signal = toNumber(m.signal ?? m.Signal ?? i.macdSignal ?? i.MACDSignal);
    const histogram = toNumber(m.histogram ?? m.Histogram ?? i.histogram ?? i.macdHistogram, macd - signal);
    return { macd, signal, histogram };
}

function resolveInstrumentKey(i) {
    if (typeof i === "string" && i.trim()) return i.trim();
    if (!i || typeof i !== "object") return null;
    for (const v of [i.instrumentKey,i.instrument_key,i.instrumentToken,i.instrument_token,i.exchangeToken,i.exchange_token,i.token,i.key,i.instrumentId,i.instrument_id,i.symbol,i.tradingsymbol,i.tradingSymbol]) {
        if (v != null && String(v).trim()) return String(v).trim();
    }
    return null;
}

function latestValidCandle(cs) {
    if (!Array.isArray(cs)) return null;
    for (let i = cs.length - 1; i >= 0; i--) {
        const c = cs[i];
        if (c && Number.isFinite(Number(c.close)) && Number(c.close) > 0) return c;
    }
    return null;
}

function validateCandles(cs) {
    if (!Array.isArray(cs) || cs.length < PIPELINE_CONFIG.DAILY_CANDLE_MIN) return false;
    return cs.every(c => {
        if (!c || typeof c !== "object") return false;
        const h = Number(c.high), l = Number(c.low), cl = Number(c.close);
        return Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(cl) && h >= l && cl > 0;
    });
}

function determineTechnicalDirection(i = {}, price = 0) {
    const p = toNumber(price || i.price);
    const e20 = toNumber(i.ema20 ?? i.EMA20), e50 = toNumber(i.ema50 ?? i.EMA50), e100 = toNumber(i.ema100 ?? i.EMA100), e200 = toNumber(i.ema200 ?? i.EMA200);
    const rsi = toNumber(i.rsi ?? i.RSI);
    const { macd, signal, histogram } = getMACDValues(i);
    const a = safeObject(i.adx);
    const adx = toNumber(a.adx ?? a.ADX ?? i.adxValue ?? i.adx), pdi = toNumber(a.pdi ?? a.PDI ?? i.pdi), mdi = toNumber(a.mdi ?? a.MDI ?? i.mdi);
    if (p <= 0 || e20 <= 0 || e50 <= 0) return "NEUTRAL";
    let bull = 0, bear = 0;
    if (p > e20) bull++; else if (p < e20) bear++;
    if (e20 > e50) bull++; else if (e20 < e50) bear++;
    if (e100 > 0) { if (e50 > e100) bull++; else if (e50 < e100) bear++; }
    if (e200 > 0) { if (e100 > e200) bull++; else if (e100 < e200) bear++; }
    if (rsi > 50) bull++; else if (rsi > 0 && rsi < 50) bear++;
    if (macd > signal) bull++; else if (macd < signal) bear++;
    if (histogram > 0) bull++; else if (histogram < 0) bear++;
    if (adx >= 20 && pdi > mdi) bull += 2; else if (adx >= 20 && mdi > pdi) bear += 2;
    if (bull >= 5 && bull >= bear + 2) return "BULLISH";
    if (bear >= 5 && bear >= bull + 2) return "BEARISH";
    if (p > e20 && e20 > e50 && rsi >= 50 && macd >= signal) return "BULLISH";
    if (p < e20 && e20 < e50 && rsi <= 50 && macd <= signal) return "BEARISH";
    return "NEUTRAL";
}

function determineStockDirection(signal, trend, indicators) {
    const technical = determineTechnicalDirection(indicators, indicators.price);
    if (technical !== "NEUTRAL") return technical;
    const s = normalizeDirection(signal), t = normalizeDirection(trend);
    if (s !== "NEUTRAL" && t !== "NEUTRAL" && s === t) return s;
    return s !== "NEUTRAL" ? s : t !== "NEUTRAL" ? t : "NEUTRAL";
}

function calculateMomentumScore(indicators, breakout, direction) {
    const { macd, signal, histogram } = getMACDValues(indicators);
    const rsi = toNumber(indicators.rsi), a = safeObject(indicators.adx);
    const adx = toNumber(a.adx ?? indicators.adxValue ?? indicators.adx), pdi = toNumber(a.pdi ?? a.PDI ?? indicators.pdi), mdi = toNumber(a.mdi ?? a.MDI ?? indicators.mdi);
    const rvol = toNumber(indicators.rvol);
    const bull = direction === "BULLISH";
    let score = 0;
    if (bull ? rsi >= 50 : rsi > 0 && rsi <= 50) score++;
    if (bull ? macd >= signal && histogram >= 0 : macd <= signal && histogram <= 0) score++;
    if (adx >= 20 && (bull ? pdi > mdi : mdi > pdi)) score++;
    if (rvol >= 1 || safeBoolean(breakout.volumeConfirmed)) score++;
    if (safeBoolean(breakout.breakout) || safeBoolean(breakout.momentumConfirmed)) score++;
    return score;
}

function buildTradeInput(price, indicators, sr, pivot, direction) {
    return {
        ...indicators,
        price,
        close: price,
        direction,
        finalDirection: direction,
        optionType: direction === "BULLISH" ? "CALL" : "PUT",
        support1: sr.support1,
        support2: sr.support2,
        support3: sr.support3,
        resistance1: sr.resistance1,
        resistance2: sr.resistance2,
        resistance3: sr.resistance3,
        supportLevels: sr.supportLevels,
        resistanceLevels: sr.resistanceLevels,
        pivotS1: pivot.s1,
        pivotS2: pivot.s2,
        pivotS3: pivot.s3,
        pivotR1: pivot.r1,
        pivotR2: pivot.r2,
        pivotR3: pivot.r3,
        pivot
    };
}

function buildStockAnalysis(x) {
    const { stockSymbol, instrumentKey, latestPrice, indicators:i, scoreData:s, trade, sr, breakout, mtf, pivot, cpr, stockDirection, technicalDirection, momentumScore } = x;
    const { macd, signal, histogram } = getMACDValues(i), a = safeObject(i.adx);
    return {
        stock:stockSymbol, symbol:stockSymbol, tradingSymbol:stockSymbol, instrumentKey, price:latestPrice,
        direction:stockDirection, stockDirection, technicalDirection,
        isBullish:stockDirection === "BULLISH", isBearish:stockDirection === "BEARISH",
        score:s.score, scannerScore:s.score, aiScore:s.score, aiFinalScore:s.finalScore, aiRating:s.rating || "N/A", signal:s.signal || "NO SIGNAL",
        bullishScore:s.bullishScore, bearishScore:s.bearishScore, callScore:s.bullishScore, putScore:s.bearishScore,
        entry:toNumber(trade.entry), stopLoss:toNumber(trade.stopLoss), target1:toNumber(trade.target1), target2:toNumber(trade.target2),
        risk:toNumber(trade.risk), reward:toNumber(trade.reward), riskReward:toNumber(trade.riskReward), trend:trade.trend || stockDirection, confidence:clampScore(trade.confidence ?? s.confidence),
        support1:toNumber(sr.support1), support2:toNumber(sr.support2), support3:toNumber(sr.support3), resistance1:toNumber(sr.resistance1), resistance2:toNumber(sr.resistance2), resistance3:toNumber(sr.resistance3),
        supportLevels:sr.supportLevels || [], resistanceLevels:sr.resistanceLevels || [],
        breakout:safeBoolean(breakout.breakout), breakoutType:breakout.breakoutType || "", breakoutStrength:breakout.breakoutStrength || "", breakoutScore:toNumber(breakout.breakoutScore),
        aboveResistance:safeBoolean(breakout.aboveResistance), belowSupport:safeBoolean(breakout.belowSupport), nearResistance:safeBoolean(breakout.nearResistance), nearSupport:safeBoolean(breakout.nearSupport),
        volumeConfirmed:safeBoolean(breakout.volumeConfirmed), trendConfirmed:safeBoolean(breakout.trendConfirmed), momentumConfirmed:safeBoolean(breakout.momentumConfirmed),
        dailyTrend:mtf.dailyTrend || "", fourHourTrend:mtf.fourHourTrend || "", oneHourTrend:mtf.oneHourTrend || "", fifteenMinTrend:mtf.fifteenMinTrend || "",
        mtfScore:toNumber(mtf.mtfScore), mtfAlignment:toNumber(mtf.mtfAlignment ?? mtf.alignedTimeframes), mtfAlignedTimeframes:toNumber(mtf.alignedTimeframes),
        pivot:toNumber(pivot.pivot), pivotR1:toNumber(pivot.r1), pivotR2:toNumber(pivot.r2), pivotR3:toNumber(pivot.r3), pivotS1:toNumber(pivot.s1), pivotS2:toNumber(pivot.s2), pivotS3:toNumber(pivot.s3),
        cprTop:toNumber(cpr.top), cprBottom:toNumber(cpr.bottom), cprWidth:toNumber(cpr.width), cprType:cpr.type || "",
        ema5:toNumber(i.ema5), ema9:toNumber(i.ema9), ema20:toNumber(i.ema20), ema50:toNumber(i.ema50), ema100:toNumber(i.ema100), ema200:toNumber(i.ema200),
        rsi:toNumber(i.rsi), macd, macdValue:macd, macdSignal:signal, histogram, adx:toNumber(a.adx ?? i.adxValue ?? i.adx), pdi:toNumber(a.pdi ?? a.PDI ?? i.pdi), mdi:toNumber(a.mdi ?? a.MDI ?? i.mdi), atr:toNumber(i.atr),
        bollingerUpper:toNumber(i.bollinger?.upper), bollingerMiddle:toNumber(i.bollinger?.middle), bollingerLower:toNumber(i.bollinger?.lower), volume:toNumber(i.volume), volumeSMA20:toNumber(i.volumeSMA20), rvol:toNumber(i.rvol), volumeSpike:safeBoolean(i.volumeSpike), obv:toNumber(i.obv), mfi:toNumber(i.mfi), supertrend:i.supertrend?.trend ?? i.supertrend ?? "", vwap:toNumber(i.vwap),
        momentumScore, qualified:false, pipeline:{ preFilter:"", momentumScore, mtfChecked:true, optionsChecked:false }
    };
}

async function scanStock(stock) {
    let stockSymbol = "";
    try {
        stockSymbol = typeof stock === "object" ? String(stock.symbol || stock.tradingSymbol || stock.tradingsymbol || stock.name || "").trim() : String(stock || "").trim();
        if (!stockSymbol) throw new Error("Empty stock symbol");
        const instrument = await getInstrument(stockSymbol), instrumentKey = resolveInstrumentKey(instrument);
        if (!instrumentKey) throw new Error("Instrument key not found");
        const daily = await getHistoricalData(instrumentKey, "ONE_DAY");
        if (!validateCandles(daily)) throw new Error(`Insufficient/invalid daily candles: ${Array.isArray(daily) ? daily.length : 0}`);
        const last = latestValidCandle(daily), price = toNumber(last?.close);
        if (price <= 0) throw new Error("Invalid latest stock price");

        const indicators = safeObject(await calculateIndicators(daily));
        indicators.price = price;
        const scoreData = safeObject(await calculateScore(indicators, daily));
        const technicalDirection = determineTechnicalDirection(indicators, price);
        const stockDirection = determineStockDirection(scoreData.signal, scoreData.trend, indicators);
        const sr = safeObject(await calculateSupportResistance(daily));
        const breakout = safeObject(await calculateBreakout(daily, indicators));
        const pivot = safeObject(await calculatePivotPoints(daily));
        const cpr = safeObject(await calculateCPR(daily));

        if (stockDirection === "NEUTRAL") {
            return { stock:stockSymbol, symbol:stockSymbol, tradingSymbol:stockSymbol, instrumentKey, price, direction:"NEUTRAL", stockDirection:"NEUTRAL", technicalDirection, score:scoreData.score, scannerScore:scoreData.score, aiScore:scoreData.score, aiFinalScore:scoreData.finalScore, signal:scoreData.signal || "NO SIGNAL", qualified:false, rejectionReason:"NO_DIRECTION", support1:toNumber(sr.support1), support2:toNumber(sr.support2), resistance1:toNumber(sr.resistance1), resistance2:toNumber(sr.resistance2), pipeline:{preFilter:"NO_DIRECTION",momentumScore:0,mtfChecked:false,optionsChecked:false} };
        }

        const momentumScore = calculateMomentumScore(indicators, breakout, stockDirection);
        const rawScore = clampScore(scoreData.finalScore ?? scoreData.score);
        if (rawScore < PIPELINE_CONFIG.PRE_SCORE_MIN) {
            return { stock:stockSymbol, symbol:stockSymbol, tradingSymbol:stockSymbol, instrumentKey, price, direction:stockDirection, stockDirection, technicalDirection, score:scoreData.score, scannerScore:scoreData.score, aiScore:scoreData.score, aiFinalScore:scoreData.finalScore, signal:scoreData.signal || "NO SIGNAL", qualified:false, rejectionReason:"LOW_SCORE", momentumScore, support1:toNumber(sr.support1), support2:toNumber(sr.support2), resistance1:toNumber(sr.resistance1), resistance2:toNumber(sr.resistance2), pipeline:{preFilter:"LOW_SCORE",momentumScore,mtfChecked:false,optionsChecked:false} };
        }

        // CRITICAL FIX: tradeSetup expects one object containing price + S/R.
        // The old scanner passed the raw candle array, so tradeSetup always saw
        // NO_DIRECTION / missing structure and rejected the candidate.
        const tradeInput = buildTradeInput(price, indicators, sr, pivot, stockDirection);
        const trade = safeObject(await calculateTradeSetup(tradeInput, { optionType:stockDirection === "BULLISH" ? "CALL" : "PUT" }));
        const mtf = safeObject(await getMultiTimeframeAnalysis(stockSymbol));
        const analysis = buildStockAnalysis({stockSymbol,instrumentKey,latestPrice:price,indicators,scoreData,trade,sr,breakout,mtf,pivot,cpr,stockDirection,technicalDirection,momentumScore});

        const aligned = toNumber(mtf.mtfAlignment ?? mtf.alignedTimeframes);
        if (aligned <= 0) {
            return {...analysis, qualified:false, rejectionReason:"MTF_NO_ALIGNMENT", pipeline:{...analysis.pipeline,preFilter:"MTF_NO_ALIGNMENT"}};
        }

        if (!(analysis.entry > 0 && analysis.stopLoss > 0 && analysis.target1 > 0 && analysis.riskReward > 0)) {
            return {...analysis, qualified:false, rejectionReason:trade.reason || "INVALID_MARKET_SETUP", pipeline:{...analysis.pipeline,preFilter:trade.reason || "INVALID_MARKET_SETUP"}};
        }

        let ranking = {};
        try { ranking = safeObject(calculateFinalRank(analysis)); } catch (_) {}
        const finalScore = clampScore(ranking.finalScore ?? ranking.score ?? analysis.aiFinalScore ?? analysis.score);
        Object.assign(analysis, {
            finalScore,
            rankingScore:finalScore,
            rating:ranking.rating || "QUALIFIED",
            ranking,
            is85Plus:finalScore >= 85,
            is90Plus:finalScore >= 90,
            dashboardEligible:finalScore >= DASHBOARD_MIN_SCORE,
            qualified:true,
            rejectionReason:""
        });
        analysis.pipeline.preFilter = momentumScore >= 2 ? "QUALIFIED" : "QUALIFIED_WEAK_MOMENTUM";
        analysis.pipeline.mtfAlignment = aligned;
        return analysis;
    } catch (error) {
        console.log(`❌ ${stockSymbol || stock}: ${error?.message || error}`);
        return {stock:stockSymbol || String(stock || ""),symbol:stockSymbol || String(stock || ""),qualified:false,rejectionReason:error?.message || String(error),pipeline:{preFilter:"ERROR",momentumScore:0,mtfChecked:false,optionsChecked:false}};
    }
}

async function scanStocks(stocks) {
    if (!Array.isArray(stocks)) return [];
    const allResults = [], qualified = [], rejected = [];
    for (const stock of stocks) {
        const result = await scanStock(stock);
        if (!result) continue;
        allResults.push(result);
        result.qualified ? qualified.push(result) : rejected.push(result);
    }
    qualified.sort((a,b) => (Number(b.finalScore ?? b.score ?? 0) - Number(a.finalScore ?? a.score ?? 0)) || (Number(b.riskReward ?? 0) - Number(a.riskReward ?? 0)) || (Number(b.momentumScore ?? 0) - Number(a.momentumScore ?? 0)));
    const shortlist = qualified.slice(0, PIPELINE_CONFIG.MAX_QUALIFIED_STOCKS);
    shortlist.forEach((x,i) => { x.pipeline.rank = i + 1; x.pipeline.optionsChecked = false; });
    Object.defineProperties(shortlist, {
        allResults:{value:allResults,enumerable:false},
        rejected:{value:rejected,enumerable:false},
        qualifiedAll:{value:qualified,enumerable:false}
    });
    return shortlist;
}

module.exports = { scanStock, scanStocks, normalizeDirection, determineTechnicalDirection, determineStockDirection, DASHBOARD_MIN_SCORE, PIPELINE_CONFIG };
