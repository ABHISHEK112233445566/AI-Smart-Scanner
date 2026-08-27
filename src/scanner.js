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
const { calculateOIMoodForStock } = require("./oiMood");
const config = require("./config");

const DASHBOARD_MIN_SCORE = Number(config.THRESHOLDS?.DASHBOARD_MIN_SCORE ?? config.DASHBOARD_MIN_SCORE ?? 85);
const PIPELINE_CONFIG = Object.freeze({
    PRE_SCORE_MIN: Number(config.THRESHOLDS?.PRE_SCORE_MIN ?? 0),
    MAX_QUALIFIED_STOCKS: Number(config.THRESHOLDS?.MAX_QUALIFIED_STOCKS ?? 20),
    DAILY_CANDLE_MIN: Number(config.THRESHOLDS?.DAILY_CANDLE_MIN ?? 50)
});

function toNumber(v, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function safeObject(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function safeBoolean(v) { if (v === true || v === false) return v; return String(v ?? "").trim().toUpperCase() === "TRUE"; }
function clampSignedScore(v) { const n = toNumber(v); return Math.max(-100, Math.min(100, Math.round(n))); }
function clampScore(v) { return clampSignedScore(v); }

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
        const o=Number(c.open), h=Number(c.high), l=Number(c.low), cl=Number(c.close);
        return [o,h,l,cl].every(Number.isFinite) && o>0 && h>0 && l>0 && cl>0 && h>=Math.max(o,cl) && l<=Math.min(o,cl) && h>=l;
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
    return { ...indicators, price, close:price, direction, finalDirection:direction, optionType:direction === "BULLISH" ? "CALL" : "PUT", support1:sr.support1, support2:sr.support2, support3:sr.support3, resistance1:sr.resistance1, resistance2:sr.resistance2, resistance3:sr.resistance3, supportLevels:sr.supportLevels, resistanceLevels:sr.resistanceLevels, pivotS1:pivot.s1, pivotS2:pivot.s2, pivotS3:pivot.s3, pivotR1:pivot.r1, pivotR2:pivot.r2, pivotR3:pivot.r3, pivot };
}

function buildOIMood(stock, price, previousPrice) {
    const source = { ...safeObject(stock), price, currentPrice:price };
    if (previousPrice !== undefined && previousPrice !== null) source.previousPrice = previousPrice;
    try { return safeObject(calculateOIMoodForStock(source)); }
    catch (_) { return { mood:"UNKNOWN", sentiment:"UNKNOWN", dataAvailable:false, priceChangePercent:0, oiChangePercent:0 }; }
}

function buildStockAnalysis(x) {
    const { stockSymbol, instrumentKey, latestPrice, indicators:i, scoreData:s, trade, sr, breakout, mtf, pivot, cpr, stockDirection, technicalDirection, momentumScore, oiMood } = x;
    const { macd, signal, histogram } = getMACDValues(i), a = safeObject(i.adx);
    return {
        stock:stockSymbol, symbol:stockSymbol, tradingSymbol:stockSymbol, instrumentKey, price:latestPrice,
        direction:stockDirection, stockDirection, technicalDirection,
        isBullish:stockDirection === "BULLISH", isBearish:stockDirection === "BEARISH",
        score:clampSignedScore(s.score), scannerScore:clampSignedScore(s.score), aiScore:clampSignedScore(s.score), aiFinalScore:clampSignedScore(s.finalScore), aiRating:s.rating || "N/A", signal:s.signal || "NO SIGNAL",
        bullishScore:s.bullishScore, bearishScore:s.bearishScore, callScore:s.bullishScore, putScore:s.bearishScore,
        entry:toNumber(trade.entry), stopLoss:toNumber(trade.stopLoss), target1:toNumber(trade.target1), target2:toNumber(trade.target2), risk:toNumber(trade.risk), reward:toNumber(trade.reward), riskReward:toNumber(trade.riskReward), trend:trade.trend || stockDirection, confidence:clampScore(trade.confidence ?? s.confidence),
        oiMood:oiMood.mood || "UNKNOWN", oiSentiment:oiMood.sentiment || "UNKNOWN", oiDataAvailable:oiMood.dataAvailable === true, oiPriceChangePercent:toNumber(oiMood.priceChangePercent), oiChangePercent:toNumber(oiMood.oiChangePercent),
        support1:toNumber(sr.support1), support2:toNumber(sr.support2), support3:toNumber(sr.support3), resistance1:toNumber(sr.resistance1), resistance2:toNumber(sr.resistance2), resistance3:toNumber(sr.resistance3), supportLevels:sr.supportLevels || [], resistanceLevels:sr.resistanceLevels || [],
        breakout:safeBoolean(breakout.breakout), breakoutType:breakout.breakoutType || "", breakoutStrength:breakout.breakoutStrength || "", breakoutScore:toNumber(breakout.breakoutScore), aboveResistance:safeBoolean(breakout.aboveResistance), belowSupport:safeBoolean(breakout.belowSupport), nearResistance:safeBoolean(breakout.nearResistance), nearSupport:safeBoolean(breakout.nearSupport), volumeConfirmed:safeBoolean(breakout.volumeConfirmed), trendConfirmed:safeBoolean(breakout.trendConfirmed), momentumConfirmed:safeBoolean(breakout.momentumConfirmed),
        dailyTrend:mtf.dailyTrend || "", fourHourTrend:mtf.fourHourTrend || "", oneHourTrend:mtf.oneHourTrend || "", fifteenMinTrend:mtf.fifteenMinTrend || "", mtfScore:toNumber(mtf.mtfScore), mtfAlignment:toNumber(mtf.mtfAlignment ?? mtf.alignedTimeframes), mtfAlignedTimeframes:toNumber(mtf.alignedTimeframes),
        pivot:toNumber(pivot.pivot), pivotR1:toNumber(pivot.r1), pivotR2:toNumber(pivot.r2), pivotR3:toNumber(pivot.r3), pivotS1:toNumber(pivot.s1), pivotS2:toNumber(pivot.s2), pivotS3:toNumber(pivot.s3), cprTop:toNumber(cpr.top), cprBottom:toNumber(cpr.bottom), cprWidth:toNumber(cpr.width), cprType:cpr.type || "",
        ema5:toNumber(i.ema5), ema9:toNumber(i.ema9), ema20:toNumber(i.ema20), ema50:toNumber(i.ema50), ema100:toNumber(i.ema100), ema200:toNumber(i.ema200), rsi:toNumber(i.rsi), macd, macdValue:macd, macdSignal:signal, histogram, adx:toNumber(a.adx ?? i.adxValue ?? i.adx), pdi:toNumber(a.pdi ?? a.PDI ?? i.pdi), mdi:toNumber(a.mdi ?? a.MDI ?? i.mdi), atr:toNumber(i.atr), bollingerUpper:toNumber(i.bollinger?.upper), bollingerMiddle:toNumber(i.bollinger?.middle), bollingerLower:toNumber(i.bollinger?.lower), volume:toNumber(i.volume), volumeSMA20:toNumber(i.volumeSMA20), rvol:toNumber(i.rvol), volumeSpike:safeBoolean(i.volumeSpike), obv:toNumber(i.obv), mfi:toNumber(i.mfi), supertrend:i.supertrend?.trend ?? i.supertrend ?? "", vwap:toNumber(i.vwap), momentumScore,
        qualified:false, pipeline:{preFilter:"", momentumScore, mtfChecked:true, optionsChecked:false}
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
        const indicators = safeObject(await calculateIndicators(daily)); indicators.price = price;
        const scoreData = safeObject(await calculateScore(indicators, daily));
        const technicalDirection = determineTechnicalDirection(indicators, price);
        const stockDirection = determineStockDirection(scoreData.signal, scoreData.trend, indicators);
        const sr = safeObject(await calculateSupportResistance(daily));
        const breakout = safeObject(await calculateBreakout(daily, indicators));
        const pivot = safeObject(await calculatePivotPoints(daily));
        const cpr = safeObject(await calculateCPR(daily));
        const previousCandle = Array.isArray(daily) && daily.length >= 2 ? daily[daily.length-2] : null;
        const oiMood = buildOIMood(stock, price, previousCandle?.close);
        if (stockDirection === "NEUTRAL") return { stock:stockSymbol, symbol:stockSymbol, tradingSymbol:stockSymbol, instrumentKey, price, direction:"NEUTRAL", stockDirection:"NEUTRAL", technicalDirection, score:clampSignedScore(scoreData.score), scannerScore:clampSignedScore(scoreData.score), aiScore:clampSignedScore(scoreData.score), aiFinalScore:clampSignedScore(scoreData.finalScore), qualified:false, rejectionReason:"NO_DIRECTION", pipeline:{preFilter:"NO_DIRECTION", momentumScore:0, mtfChecked:false, optionsChecked:false} };
        const momentumScore = calculateMomentumScore(indicators, breakout, stockDirection);
        const rawScore = clampSignedScore(scoreData.finalScore ?? scoreData.score);
        if (PIPELINE_CONFIG.PRE_SCORE_MIN > 0 && Math.abs(rawScore) < PIPELINE_CONFIG.PRE_SCORE_MIN) return { stock:stockSymbol, symbol:stockSymbol, tradingSymbol:stockSymbol, instrumentKey, price, direction:stockDirection, stockDirection, technicalDirection, score:clampSignedScore(scoreData.score), scannerScore:clampSignedScore(scoreData.score), aiScore:clampSignedScore(scoreData.score), aiFinalScore:rawScore, qualified:false, rejectionReason:"LOW_SCORE", momentumScore, pipeline:{preFilter:"LOW_SCORE", momentumScore, mtfChecked:false, optionsChecked:false} };
        const tradeInput = buildTradeInput(price, indicators, sr, pivot, stockDirection);
        const trade = safeObject(await calculateTradeSetup(tradeInput, { optionType:stockDirection === "BULLISH" ? "CALL" : "PUT" }));
        const mtf = safeObject(await getMultiTimeframeAnalysis(stockSymbol));
        const analysis = buildStockAnalysis({stockSymbol,instrumentKey,latestPrice:price,indicators,scoreData,trade,sr,breakout,mtf,pivot,cpr,stockDirection,technicalDirection,momentumScore,oiMood});
        if (toNumber(mtf.mtfAlignment ?? mtf.alignedTimeframes) <= 0) return {...analysis, qualified:false, rejectionReason:"MTF_NO_ALIGNMENT", pipeline:{...analysis.pipeline,preFilter:"MTF_NO_ALIGNMENT",mtfChecked:true}};
        if (!(analysis.entry > 0 && analysis.stopLoss > 0 && analysis.target1 > 0 && analysis.riskReward > 0)) return {...analysis, qualified:false, rejectionReason:trade.reason || "INVALID_MARKET_SETUP", pipeline:{...analysis.pipeline,preFilter:trade.reason || "INVALID_MARKET_SETUP",mtfChecked:true}};
        let ranking = {}; try { ranking = safeObject(calculateFinalRank(analysis)); } catch (_) {}
        const finalScore = clampSignedScore(ranking.finalScore ?? ranking.score ?? analysis.aiFinalScore ?? analysis.score);
        Object.assign(analysis, {finalScore, rankingScore:finalScore, rating:ranking.rating || "QUALIFIED", ranking, is85Plus:Math.abs(finalScore)>=85, is90Plus:Math.abs(finalScore)>=90, dashboardEligible:stockDirection === "BULLISH" ? finalScore>=DASHBOARD_MIN_SCORE : stockDirection === "BEARISH" ? finalScore<=-DASHBOARD_MIN_SCORE : false, qualified:true, rejectionReason:""});
        analysis.pipeline.preFilter = momentumScore >= 2 ? "QUALIFIED" : "QUALIFIED_WEAK_MOMENTUM";
        analysis.pipeline.mtfAlignment = toNumber(mtf.mtfAlignment ?? mtf.alignedTimeframes);
        return analysis;
    } catch (error) {
        console.log(`❌ ${stockSymbol || stock}: ${error?.message || error}`);
        return {stock:stockSymbol || String(stock || ""), symbol:stockSymbol || String(stock || ""), qualified:false, rejectionReason:error?.message || String(error), pipeline:{preFilter:"ERROR",momentumScore:0,mtfChecked:false,optionsChecked:false}};
    }
}

async function scanStocks(stocks) {
    if (!Array.isArray(stocks)) return [];
    const results = [];
    for (const stock of stocks) results.push(await scanStock(stock));
    const qualified = results.filter(r=>r?.qualified===true).sort((a,b)=>(Math.abs(Number(b.finalScore??b.score??0))-Math.abs(Number(a.finalScore??a.score??0)))||(Number(b.riskReward??0)-Number(a.riskReward??0))).slice(0, PIPELINE_CONFIG.MAX_QUALIFIED_STOCKS);
    Object.defineProperties(qualified,{allResults:{value:results,enumerable:false},rejected:{value:results.filter(r=>r?.qualified!==true),enumerable:false},qualifiedAll:{value:results.filter(r=>r?.qualified===true),enumerable:false}});
    return qualified;
}

module.exports = { scanStock, scanStocks, normalizeDirection, determineTechnicalDirection, determineStockDirection, DASHBOARD_MIN_SCORE, PIPELINE_CONFIG };
