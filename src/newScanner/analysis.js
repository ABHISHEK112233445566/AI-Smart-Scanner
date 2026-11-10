"use strict";

const ti = require("technicalindicators");
const { number } = require("./normalize");

function lastValid(values) {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const n = number(values[i]);
    if (n !== null) return n;
  }
  return null;
}
function calculateTechnicalEvidence(candles) {
  const rows = Array.isArray(candles) ? candles : [];
  const valid = rows.filter(c => c && [c.open,c.high,c.low,c.close,c.volume].every(v => number(v) !== null));
  const close = valid.map(c => c.close), high = valid.map(c => c.high), low = valid.map(c => c.low), volume = valid.map(c => c.volume);
  const out = { candleCount: valid.length, dataStatus: "INSUFFICIENT_HISTORY" };
  if (close.length < 35) return { ...out, direction: "UNKNOWN", reason: "MINIMUM_35_CANDLES_REQUIRED" };
  const calc = (fn) => { try { return fn(); } catch (_) { return null; } };
  const ema = period => close.length >= period ? lastValid(calc(() => ti.EMA.calculate({ period, values: close }))) : null;
  const rsi = close.length >= 15 ? lastValid(calc(() => ti.RSI.calculate({ period: 14, values: close }))) : null;
  const macdRows = close.length >= 35 ? calc(() => ti.MACD.calculate({ values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false })) : null;
  const macd = Array.isArray(macdRows) ? macdRows.at(-1) : null;
  const adxRows = close.length >= 30 ? calc(() => ti.ADX.calculate({ high, low, close, period: 14 })) : null;
  const adx = Array.isArray(adxRows) ? adxRows.at(-1) : null;
  const atr = close.length >= 15 ? lastValid(calc(() => ti.ATR.calculate({ high, low, close, period: 14 }))) : null;
  const bbRows = close.length >= 20 ? calc(() => ti.BollingerBands.calculate({ period: 20, stdDev: 2, values: close })) : null;
  const bollinger = Array.isArray(bbRows) ? bbRows.at(-1) : null;
  const mfiRows = close.length >= 15 ? calc(() => ti.MFI.calculate({ high, low, close, volume, period: 14 })) : null;
  const mfi = Array.isArray(mfiRows) ? lastValid(mfiRows) : null;
  const obvRows = calc(() => ti.OBV.calculate({ close, volume }));
  const obv = Array.isArray(obvRows) ? obvRows : [];
  const obvTrend = obv.length >= 6 ? (obv.at(-1) > obv.at(-6) ? "UP" : obv.at(-1) < obv.at(-6) ? "DOWN" : "FLAT") : "UNKNOWN";
  const vwap = (() => { const recent = valid.slice(-20); const pv = recent.reduce((s,c) => s + ((c.high+c.low+c.close)/3)*c.volume, 0); const v = recent.reduce((s,c)=>s+c.volume,0); return v>0?pv/v:null; })();
  const avgVol = volume.slice(-21,-1).reduce((s,v)=>s+v,0) / Math.max(1, volume.slice(-21,-1).length);
  const latest = close.at(-1), previous = close.at(-2);
  const evidence = [];
  const add = (name, condition, weight) => { if (condition === true) evidence.push({ name, weight }); };
  add("PRICE_ABOVE_EMA20", ema(20)!==null&&latest>ema(20), 1);
  add("EMA20_ABOVE_EMA50", ema(20)!==null&&ema(50)!==null&&ema(20)>ema(50), 1);
  add("EMA50_ABOVE_EMA100", ema(50)!==null&&ema(100)!==null&&ema(50)>ema(100), 1);
  add("EMA100_ABOVE_EMA200", ema(100)!==null&&ema(200)!==null&&ema(100)>ema(200), 1);
  add("PRICE_ABOVE_VWAP", vwap!==null&&latest>vwap, 1);
  add("RSI_BULLISH", rsi!==null&&rsi>=55&&rsi<=75, 1);
  add("MACD_BULLISH", Boolean(macd&&number(macd.MACD)!==null&&number(macd.signal)!==null&&macd.MACD>macd.signal), 1);
  add("ADX_TREND", Boolean(adx&&number(adx.adx)!==null&&adx.adx>=20), 1);
  add("VOLUME_EXPANSION", avgVol>0&&volume.at(-1)>=avgVol*1.2, 1);
  const bearish = [];
  const addBear = (name, condition, weight) => { if (condition === true) bearish.push({ name, weight }); };
  addBear("PRICE_BELOW_EMA20", ema(20)!==null&&latest<ema(20), 1);
  addBear("EMA20_BELOW_EMA50", ema(20)!==null&&ema(50)!==null&&ema(20)<ema(50), 1);
  addBear("EMA50_BELOW_EMA100", ema(50)!==null&&ema(100)!==null&&ema(50)<ema(100), 1);
  addBear("EMA100_BELOW_EMA200", ema(100)!==null&&ema(200)!==null&&ema(100)<ema(200), 1);
  addBear("PRICE_BELOW_VWAP", vwap!==null&&latest<vwap, 1);
  addBear("RSI_BEARISH", rsi!==null&&rsi<=45&&rsi>=25, 1);
  addBear("MACD_BEARISH", Boolean(macd&&number(macd.MACD)!==null&&number(macd.signal)!==null&&macd.MACD<macd.signal), 1);
  addBear("ADX_TREND", Boolean(adx&&number(adx.adx)!==null&&adx.adx>=20), 1);
  addBear("VOLUME_EXPANSION", avgVol>0&&volume.at(-1)>=avgVol*1.2, 1);
  const bullScore = Math.round(evidence.reduce((s,x)=>s+x.weight,0)/9*100);
  const bearScore = Math.round(bearish.reduce((s,x)=>s+x.weight,0)/9*100);
  let direction = "NEUTRAL";
  if (bullScore>=60&&bullScore-bearScore>=15) direction="BULLISH";
  else if (bearScore>=60&&bearScore-bullScore>=15) direction="BEARISH";
  const recent = valid.slice(-30), swingHigh = Math.max(...recent.map(c=>c.high)), swingLow = Math.min(...recent.map(c=>c.low));
  const prior = valid.at(-2) || valid.at(-1), pivot=(prior.high+prior.low+prior.close)/3, bc=(prior.high+prior.low)/2, tc=2*pivot-bc;
  const previous20=valid.slice(-21,-1), resistance20=previous20.length?Math.max(...previous20.map(c=>c.high)):null, support20=previous20.length?Math.min(...previous20.map(c=>c.low)):null;
  const structureBreak=latest>resistance20?"BULLISH_BOS":latest<support20?"BEARISH_BOS":"NO_CONFIRMED_BOS";
  const localHighs=[],localLows=[];
  for(let i=Math.max(2,valid.length-35);i<valid.length-2;i++){
    if(valid[i].high>valid[i-1].high&&valid[i].high>=valid[i+1].high)localHighs.push({index:i,price:valid[i].high});
    if(valid[i].low<valid[i-1].low&&valid[i].low<=valid[i+1].low)localLows.push({index:i,price:valid[i].low});
  }
  let chartPattern="NONE",patternDirection="NEUTRAL",patternStatus="NOT_CONFIRMED";
  const highs=localHighs.slice(-2),lows=localLows.slice(-2);
  if(highs.length===2&&highs[1].index-highs[0].index>=4&&Math.abs(highs[1].price-highs[0].price)/Math.max(highs[0].price,highs[1].price)<=.012){chartPattern="DOUBLE_TOP";patternDirection="BEARISH";patternStatus=latest<Math.min(highs[0].price,highs[1].price)?"BUILDING":"CONFIRMED";}
  else if(lows.length===2&&lows[1].index-lows[0].index>=4&&Math.abs(lows[1].price-lows[0].price)/Math.max(lows[0].price,lows[1].price)<=.012){chartPattern="DOUBLE_BOTTOM";patternDirection="BULLISH";patternStatus=latest>Math.max(lows[0].price,lows[1].price)?"CONFIRMED":"BUILDING";}
  else if(highs.length===2&&lows.length===2){const lowerHigh=highs[1].price<highs[0].price, higherLow=lows[1].price>lows[0].price;if(lowerHigh&&higherLow){chartPattern="SYMMETRICAL_TRIANGLE";patternDirection="NEUTRAL";patternStatus="BUILDING";}}
  const structure = { support: swingLow, resistance: swingHigh, support20, resistance20, latestClose: latest, previousClose: previous, structureBreak, pivot, cpr:{bc,tc}, levels:{r1:2*pivot-prior.low,s1:2*pivot-prior.high,r2:pivot+(prior.high-prior.low),s2:pivot-(prior.high-prior.low)} };
  return {
    dataStatus: "VALID", direction, bullScore, bearScore, confidence: Math.max(bullScore,bearScore),
    indicators: { ema20:ema(20),ema50:ema(50),ema100:ema(100),ema200:ema(200),rsi,macd:macd?.MACD??null,macdSignal:macd?.signal??null,adx:adx?.adx??null,atr,bollinger,mfi,obv:obv.at(-1)??null,obvTrend,vwap,averageVolume:avgVol,latestVolume:volume.at(-1) },
    bullishEvidence:evidence.map(x=>x.name), bearishEvidence:bearish.map(x=>x.name), chartPattern,patternDirection,patternStatus,structure
  };
}
function combineTimeframes(timeframes) {
  const order=["daily","fourHour","oneHour","fifteenMinute","fiveMinute"];
  const rows=order.map(key=>({timeframe:key,...(timeframes?.[key]||{})}));
  const valid=rows.filter(x=>["BULLISH","BEARISH"].includes(x.direction));
  const bull=valid.filter(x=>x.direction==="BULLISH").length, bear=valid.length-bull;
  let direction="NEUTRAL";
  if (bull>=3&&bull>bear) direction="BULLISH";
  if (bear>=3&&bear>bull) direction="BEARISH";
  return { direction, bullishTimeframes:bull, bearishTimeframes:bear, unknownTimeframes:rows.length-valid.length, rows };
}
function deriveUnderlyingLevels(analysis,currentPrice=null) {
  const s=analysis?.structure, price=number(currentPrice)??number(s?.latestClose), support=number(s?.support20), resistance=number(s?.resistance20);
  if (!price||!support||!resistance) return { valid:false, reason:"MARKET_STRUCTURE_UNAVAILABLE" };
  if (analysis.direction==="BULLISH"&&support<price&&resistance>price) {
    const risk=price-support, reward=resistance-price;
    return { valid:risk>0&&reward>0, entry:price, stopLoss:support, target:resistance, riskReward:risk>0?reward/risk:null, source:"DAILY_30_CANDLE_SWINGS" };
  }
  if (analysis.direction==="BEARISH"&&resistance>price&&support<price) {
    const risk=resistance-price, reward=price-support;
    return { valid:risk>0&&reward>0, entry:price, stopLoss:resistance, target:support, riskReward:risk>0?reward/risk:null, source:"DAILY_30_CANDLE_SWINGS" };
  }
  return { valid:false, reason:"DIRECTIONAL_STRUCTURE_NOT_CONFIRMED" };
}
module.exports = { calculateTechnicalEvidence, combineTimeframes, deriveUnderlyingLevels };
