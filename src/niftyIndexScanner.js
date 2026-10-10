// Independent NIFTY 50 index/options scanner. It never feeds or changes stock rankings.
const { calculateIndicators } = require("./indicators");
const { calculateScore } = require("./aiEngine");
const { calculateSupportResistance } = require("./supportResistance");
const { calculateBreakout } = require("./breakout");
const { calculatePivotPoints } = require("./pivotPoints");
const { calculateCPR } = require("./cpr");
const { getMultiTimeframeAnalysis } = require("./mtfScanner");
const { fetchNewsForIndex } = require("./newsService");
const IST = "Asia/Kolkata";
const INDEX_NAME = "NIFTY 50";
const INDEX_KEY_HINTS = ["NSE_INDEX|Nifty 50", "NSE_INDEX|Nifty50"];
const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
const round = (v, d = 2) => v == null ? "" : Number(Number(v).toFixed(d));
const first = (o, keys) => { for (const k of keys) if (o?.[k] != null && String(o[k]).trim() !== "") return o[k]; return null; };
function dayKey(v) { const d = new Date(v); if (Number.isNaN(d.getTime())) return ""; return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
function stampIST(v = new Date()) { return new Intl.DateTimeFormat("en-IN", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(v)); }
function sma(candles, period) { const values = candles.map(c => n(c.close)).filter(Number.isFinite); return values.length >= period ? values.slice(-period).reduce((a, b) => a + b, 0) / period : null; }
function indexInstrument(instruments) {
  const rows = (Array.isArray(instruments) ? instruments : []).filter(i => String(i?.segment || "").toUpperCase().includes("INDEX") || String(i?.instrument_type || "").toUpperCase() === "INDEX");
  return rows.find(i => /NIFTY\s*50/i.test(String(i?.name || "") + " " + String(i?.trading_symbol || "") + " " + String(i?.short_name || "")))
    || rows.find(i => INDEX_KEY_HINTS.includes(String(i?.instrument_key || "")))
    || null;
}
function optionType(c) {
  const t = String(c?.instrument_type || c?.option_type || c?.optionType || "").toUpperCase();
  if (["CE", "CALL"].includes(t)) return "CE";
  if (["PE", "PUT"].includes(t)) return "PE";
  const s = String(c?.trading_symbol || c?.tradingsymbol || "").toUpperCase();
  return s.endsWith("CE") ? "CE" : s.endsWith("PE") ? "PE" : "";
}
function expiryOf(c) {
  const raw = c?.expiry;
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(String(raw))) return String(raw).slice(0, 10);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function chooseExpiry(contracts) {
  const today = dayKey(new Date());
  return [...new Set(contracts.map(expiryOf).filter(e => e && e >= today))].sort()[0] || "";
}
function trendFor(price, i) {
  const e20 = n(i.ema20), e50 = n(i.ema50), e200 = n(i.ema200);
  const rsi = n(i.rsi);
  if (e20 == null || e50 == null) return "INSUFFICIENT DATA";
  let score = 0;
  if (price > e20) score++; else score--;
  if (e20 > e50) score++; else score--;
  if (e200 != null) { if (price > e200) score++; else score--; }
  if (rsi != null) { if (rsi >= 55) score++; else if (rsi <= 45) score--; }
  return score >= 2 ? "BULLISH" : score <= -2 ? "BEARISH" : "SIDEWAYS";
}
function optionMood(ce, pe) {
  const ceOi = n(ce?.oi) || 0, peOi = n(pe?.oi) || 0;
  const cePrev = n(ce?.previousOI), pePrev = n(pe?.previousOI);
  const ceDelta = cePrev != null ? ceOi - cePrev : null;
  const peDelta = pePrev != null ? peOi - pePrev : null;
  const pcr = ceOi > 0 ? peOi / ceOi : null;
  let mood = "PARTIAL OI DATA";
  if (ceDelta != null && peDelta != null) {
    if (ceDelta > 0 && peDelta < 0) mood = "BULLISH OI SHIFT";
    else if (peDelta > 0 && ceDelta < 0) mood = "BEARISH OI SHIFT";
    else if (ceDelta > 0 && peDelta > 0) mood = "BOTH SIDES BUILDING";
    else if (ceDelta < 0 && peDelta < 0) mood = "BOTH SIDES UNWINDING";
    else mood = "MIXED OI";
  }
  return { pcr, mood, ceOi, peOi, ceDelta, peDelta };
}
async function scanNiftyIndex(broker) {
  if (!broker || typeof broker.loadInstruments !== "function") throw new Error("Broker instrument master unavailable");
  const instruments = await broker.loadInstruments();
  const instrument = indexInstrument(instruments);
  const indexKey = String(instrument?.instrument_key || instrument?.instrumentKey || INDEX_KEY_HINTS[0]);
  const [dailyResult, intradayResult, contractsResult] = await Promise.allSettled([
    broker.getHistoricalData(indexKey, "ONE_DAY", { includeLiveQuote: false }),
    broker.getHistoricalData(indexKey, "FIVE_MINUTE", { includeLiveQuote: false }),
    broker.getOptionContracts(indexKey)
  ]);
  const daily = dailyResult.status === "fulfilled" && Array.isArray(dailyResult.value) ? dailyResult.value : [];
  const intraday = intradayResult.status === "fulfilled" && Array.isArray(intradayResult.value) ? intradayResult.value : [];
  const dailyValid = daily.filter(c => n(c?.close) > 0).sort((a,b) => new Date(a.time)-new Date(b.time));
  const intradayValid = intraday.filter(c => n(c?.close) > 0).sort((a,b) => new Date(a.time)-new Date(b.time));
  const latestDaily = dailyValid.at(-1), previousDaily = dailyValid.at(-2), latestIntraday = intradayValid.at(-1);
  const price = n(latestIntraday?.close) || n(latestDaily?.close);
  if (!(price > 0)) throw new Error("NIFTY 50 historical/intraday price unavailable: " + (dailyResult.status === "rejected" ? dailyResult.reason?.message : "no valid candles"));
  const intradayDay = latestIntraday?.time ? dayKey(latestIntraday.time) : ""; const dailyDay = latestDaily?.time ? dayKey(latestDaily.time) : ""; const previousClose = intradayDay && dailyDay && intradayDay === dailyDay ? (n(previousDaily?.close) || n(latestDaily?.open) || price) : (n(latestDaily?.close) || n(previousDaily?.close) || price);
  const change = price - previousClose, changePct = previousClose > 0 ? change / previousClose * 100 : 0;
  const completedDaily = dailyValid.filter(c => {
    const time = c?.time ?? c?.timestamp ?? c?.datetime ?? c?.date;
    return !time || dayKey(time) !== dayKey(new Date());
  });
  const analysisDaily = completedDaily.length >= 50 ? completedDaily : dailyValid.slice(0, -1);
  const analysisCandles = analysisDaily.length >= 2 ? analysisDaily : dailyValid;
  const ind = calculateIndicators(analysisCandles);
  ind.price = price;
  const ema20 = n(ind.ema20), ema50 = n(ind.ema50), ema200 = n(ind.ema200);
  const dma20 = sma(analysisCandles, 20), dma50 = sma(analysisCandles, 50), dma200 = sma(analysisCandles, 200);
  const trend = trendFor(price, ind);
  let ai = {}, support = {}, breakout = {}, pivots = {}, cpr = null, mtf = {}, news = {};
  try { ai = calculateScore({ ...ind, price, currentPrice: price, stock: INDEX_NAME, symbol: INDEX_NAME }) || {}; } catch (e) { console.warn("NIFTY AI scoring unavailable: " + (e?.message || e)); }
  try { support = calculateSupportResistance(analysisCandles) || {}; } catch (e) { console.warn("NIFTY support/resistance unavailable: " + (e?.message || e)); }
  try { breakout = calculateBreakout(analysisCandles, ind, support) || {}; } catch (e) { console.warn("NIFTY breakout/pattern unavailable: " + (e?.message || e)); }
  try { pivots = calculatePivotPoints(analysisCandles) || {}; } catch (e) { console.warn("NIFTY pivots unavailable: " + (e?.message || e)); }
  try { cpr = calculateCPR(analysisCandles); } catch (e) { console.warn("NIFTY CPR unavailable: " + (e?.message || e)); }
  try { mtf = await getMultiTimeframeAnalysis(indexKey); } catch (e) { console.warn("NIFTY MTF unavailable: " + (e?.message || e)); }
  try { news = await fetchNewsForIndex(); } catch (e) { news = { newsStatus: "NEWS_UNAVAILABLE", newsHeadline: "Nifty/market news unavailable", newsSource: "", newsAge: "", newsUrl: "" }; }
  let expiry = "", atm = "", ce = null, pe = null, ceQuote = null, peQuote = null, mood = { pcr: null, mood: "OPTION CHAIN UNAVAILABLE", ceOi: 0, peOi: 0, ceDelta: null, peDelta: null };
  const contracts = contractsResult.status === "fulfilled" && Array.isArray(contractsResult.value) ? contractsResult.value : [];
  if (contracts.length) {
    expiry = chooseExpiry(contracts);
    const active = contracts.filter(c => expiryOf(c) === expiry && n(c?.strike_price ?? c?.strike) > 0);
    const strikes = [...new Set(active.map(c => n(c?.strike_price ?? c?.strike)).filter(x => x > 0))].sort((a,b) => a-b);
    if (strikes.length) {
      atm = strikes.reduce((best, s) => Math.abs(s-price) < Math.abs(best-price) ? s : best, strikes[0]);
      const pick = type => active.filter(c => n(c?.strike_price ?? c?.strike) === atm && optionType(c) === type).find(Boolean) || null;
      ce = pick("CE"); pe = pick("PE");
      const quoteOne = async c => {
        if (!c) return null;
        const key = String(c.instrument_key || c.instrumentKey || "");
        if (!key || typeof broker.getOptionQuote !== "function") return null;
        try { const q = await broker.getOptionQuote(key); return { ...q, contract: c, ltp: n(q?.ltp), oi: n(q?.oi), previousOI: n(q?.previousOI), symbol: c.trading_symbol || c.tradingsymbol || "", strike: n(c.strike_price ?? c.strike), type: optionType(c) }; }
        catch (e) { return { contract: c, strike: n(c.strike_price ?? c.strike), type: optionType(c), quoteError: e?.message || String(e) }; }
      };
      [ceQuote, peQuote] = await Promise.all([quoteOne(ce), quoteOne(pe)]);
      mood = optionMood(ceQuote, peQuote);
    }
  }
  const aligned = trend === "BULLISH" && changePct > 0 ? "CE" : trend === "BEARISH" && changePct < 0 ? "PE" : "";
  const selected = aligned === "CE" ? ceQuote : aligned === "PE" ? peQuote : null;
  const optionLtp = n(selected?.ltp);
  const signal = aligned && optionLtp > 0 ? "WATCH " + aligned : "NO CLEAR BIAS";
  
  const headers = ["Metric","NIFTY 50 Index Scan","CE (ATM)","PE (ATM)","News"];
  const rows = [
    ["Index LTP", round(price), "", "", ""],
    ["Previous Close / Change", round(previousClose) + " / " + round(change) + " (" + round(changePct) + "%)", "", "", ""],
    ["DMA 20 / 50 / 200", [dma20,dma50,dma200].map(v=>round(v)).join(" / "), "", "", ""],
    ["EMA 20 / 50 / 100 / 200", [ind.ema20,ind.ema50,ind.ema100,ind.ema200].map(v=>round(n(v))).join(" / "), "", "", ""],
    ["RSI / MACD / ADX", [n(ind.rsi),n(ind.macd?.MACD),n(ind.adx?.adx)].map(v=>round(v)).join(" / "), "", "", ""],
    ["ATR / Bollinger / Supertrend", [n(ind.atr),n(ind.bollinger?.upper),n(ind.bollinger?.lower),n(ind.supertrend?.supertrend ?? ind.supertrend?.value)].map(v=>round(v)).join(" / "), "", "", ""],
    ["AI Score / Direction / Rating", [n(ai.scannerScore ?? ai.score), ai.direction || trend, ai.rating || ""].join(" / "), "", "", ""],
    ["Volume / Avg 5 / RVOL / Pace", [n(ind.volume),n(ind.avgVolume5),n(ind.rvol),n(ind.volumePaceRatio5)].map(v=>round(v,0)).join(" / "), "", "", ""],
    ["VWAP / OBV / MFI / Supertrend", [n(ind.vwap),n(ind.obv),n(ind.mfi),n(ind.supertrend?.value ?? ind.supertrend?.supertrend)].map(v=>round(v)).join(" / "), "", "", ""],
    ["Support / Resistance", [n(support.support),n(support.resistance),n(support.support1),n(support.resistance1)].map(v=>round(v)).join(" / "), "", "", ""],
    ["Breakout / Chart Pattern", [breakout.breakout ? "BREAKOUT" : breakout.breakdown ? "BREAKDOWN" : "NO CONFIRMATION", breakout.patternName || breakout.pattern || "NONE", breakout.patternStatus || ""].join(" / "), "", "", ""],
    ["Pivot / S1 / R1", [n(pivots.pivot),n(pivots.s1),n(pivots.r1)].map(v=>round(v)).join(" / "), "", "", ""],
    ["CPR Type / Top / Bottom", cpr ? [cpr.type,round(cpr.top),round(cpr.bottom)].join(" / ") : "Unavailable", "", "", ""],
    ["MTF Daily / 4H / 1H / 15m", [mtf.dailyTrend,mtf.fourHourTrend,mtf.oneHourTrend,mtf.fifteenMinTrend].join(" / "), "", "", ""],
    ["MTF Overall / Alignment", [mtf.overallTrend,mtf.alignment].filter(Boolean).join(" / "), "", "", ""],
    ["Trend / Option Mood", trend + " / " + mood.mood, "", "", ""],
    ["Expiry / ATM Strike", (expiry || "Unavailable") + " / " + (atm || "Unavailable"), "", "", ""],
    ["Option LTP", "", round(ceQuote?.ltp), round(peQuote?.ltp), ""],
    ["Option OI / Previous OI", "", [ceQuote?.oi,ceQuote?.previousOI].map(v=>v==null?"":round(v,0)).join(" / "), [peQuote?.oi,peQuote?.previousOI].map(v=>v==null?"":round(v,0)).join(" / "), ""],
    ["Near-ATM PCR (PE OI / CE OI)", mood.pcr == null ? "" : round(mood.pcr), "", "", ""],
    ["Option Signal (confirmation only)", signal, "", "", ""],
    ["News Status / Direction", "", "", "", [news.newsStatus,news.newsDirection].filter(Boolean).join(" / ")],
    ["News Headline / Source / Age", "", "", "", [news.newsHeadline,news.newsSource,news.newsAge].filter(Boolean).join(" / ")],
    ["News URL", "", "", "", news.newsUrl || ""],
    ["Option Decision", "PRELIMINARY BIAS ONLY — full index-specific option gates still require validation", "", "", ""],
    ["Updated (IST)", stampIST(), "", "", ""]
  ];
  return { headers, rows, index: { name: INDEX_NAME, indexKey, price, previousClose, change, changePct, dma20, dma50, dma200, ema20, ema50, ema200, rsi: n(ind.rsi), trend, aiScore: n(ai.scannerScore ?? ai.score), mtf, support, breakout, pivots, cpr, news, expiry, atm, optionMood: mood.mood, pcr: mood.pcr, signal, updatedAt: stampIST() } };
}
module.exports = { scanNiftyIndex };
