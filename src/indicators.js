// Technical indicators engine — session VWAP correction.
// Existing indicator calculations remain broker/data-source independent.
const { EMA, SMA, RSI, MACD, BollingerBands, ATR, ADX, OBV, MFI } = require("technicalindicators");
const { calculateSupertrend } = require("./supertrend");

const MIN_CANDLES = 2;
const EMA_PERIODS = { ema5: 5, ema9: 9, ema20: 20, ema50: 50, ema100: 100, ema200: 200 };
const RSI_PERIOD = 14;
const MACD_FAST = 12, MACD_SLOW = 26, MACD_SIGNAL = 9;
const BOLLINGER_PERIOD = 20, BOLLINGER_STDDEV = 2;
const ATR_PERIOD = 14, ADX_PERIOD = 14, VOLUME_SMA_PERIOD = 20, MFI_PERIOD = 14;
const RVOL_SPIKE_THRESHOLD = 1.5;

function safeNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function safeLast(value, fallback = null) {
    return Array.isArray(value) && value.length ? value[value.length - 1] : fallback;
}
function safeCalculate(fn, fallback = null) {
    try { return safeLast(fn(), fallback); } catch (_) { return fallback; }
}
function isValidCandle(c) {
    if (!c || typeof c !== "object") return false;
    const h = Number(c.high), l = Number(c.low), cl = Number(c.close), v = c.volume == null || c.volume === "" ? 0 : Number(c.volume);
    return Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(cl) && Number.isFinite(v) && h > 0 && l > 0 && cl > 0 && h >= l && cl >= l && cl <= h && v >= 0;
}
function normalizeCandles(candles) {
    return candles.map(c => ({ ...c, high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Math.max(0, Number(c.volume || 0)) }));
}
function emptyIndicators() {
    return { ema5:null,ema9:null,ema20:null,ema50:null,ema100:null,ema200:null,rsi:null,macd:null,bollinger:null,atr:null,adx:null,volume:0,volumeSMA20:null,rvol:null,volumeSpike:false,obv:null,mfi:null,vwap:null,supertrend:null };
}

// Session VWAP: only candles belonging to the CURRENT trading session are used.
// If timestamps are unavailable, the supplied series is treated as one session.
// No previous-session volume is carried into the current session.
function calculateSessionVWAP(candles, sessionDate) {
    if (!Array.isArray(candles) || !candles.length) return null;
    let day = sessionDate;
    if (!day) {
        const last = candles[candles.length - 1]?.time ?? candles[candles.length - 1]?.timestamp ?? candles[candles.length - 1]?.datetime;
        if (last) {
            const d = new Date(last);
            if (!Number.isNaN(d.getTime())) day = d.toISOString().slice(0, 10);
        }
    }
    let tpv = 0, volume = 0;
    for (const c of candles) {
        if (!isValidCandle(c)) continue;
        const rawTime = c.time ?? c.timestamp ?? c.datetime ?? c.date;
        if (day && rawTime) {
            const d = new Date(rawTime);
            if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) !== day) continue;
        }
        const v = Number(c.volume || 0);
        if (v <= 0) continue;
        tpv += ((Number(c.high) + Number(c.low) + Number(c.close)) / 3) * v;
        volume += v;
    }
    if (volume <= 0) return safeNumber(candles[candles.length - 1]?.close);
    return tpv / volume;
}

function calculateEMA(close, period) {
    return Array.isArray(close) && close.length >= period ? safeCalculate(() => EMA.calculate({ period, values: close })) : null;
}

function calculateIndicators(candles) {
    if (!Array.isArray(candles) || candles.length < MIN_CANDLES || !candles.every(isValidCandle)) return emptyIndicators();
    const c = normalizeCandles(candles), close = c.map(x=>x.close), high=c.map(x=>x.high), low=c.map(x=>x.low), volume=c.map(x=>x.volume);
    const ema5=calculateEMA(close,5), ema9=calculateEMA(close,9), ema20=calculateEMA(close,20), ema50=calculateEMA(close,50), ema100=calculateEMA(close,100), ema200=calculateEMA(close,200);
    const rsi=close.length>=15?safeCalculate(()=>RSI.calculate({period:14,values:close})):null;
    const macd=close.length>=35?safeCalculate(()=>MACD.calculate({values:close,fastPeriod:12,slowPeriod:26,signalPeriod:9,SimpleMAOscillator:false,SimpleMASignal:false})):null;
    const bollinger=close.length>=20?safeCalculate(()=>BollingerBands.calculate({period:20,stdDev:2,values:close})):null;
    const atr=close.length>=15?safeCalculate(()=>ATR.calculate({high,low,close,period:14})):null;
    const adx=close.length>=15?safeCalculate(()=>ADX.calculate({high,low,close,period:14})):null;
    const latestVolume=safeNumber(volume[volume.length-1],0);
    const volumeSMA20=volume.length>=20?safeCalculate(()=>SMA.calculate({period:20,values:volume})):null;
    const rvol=Number.isFinite(latestVolume)&&Number.isFinite(volumeSMA20)&&volumeSMA20>0?Number((latestVolume/volumeSMA20).toFixed(2)):null;
    const obv=close.length>=2?safeCalculate(()=>OBV.calculate({close,volume})):null;
    const mfi=close.length>=15?safeCalculate(()=>MFI.calculate({high,low,close,volume,period:14})):null;
    let supertrend=null; try { if(c.length>=15) supertrend=calculateSupertrend(c); } catch(_) {}
    return {
        ema5:safeNumber(ema5),ema9:safeNumber(ema9),ema20:safeNumber(ema20),ema50:safeNumber(ema50),ema100:safeNumber(ema100),ema200:safeNumber(ema200),
        rsi:safeNumber(rsi),
        macd:macd&&typeof macd==='object'?{MACD:safeNumber(macd.MACD),signal:safeNumber(macd.signal),histogram:safeNumber(macd.histogram)}:null,
        bollinger,
        atr:safeNumber(atr),
        adx:adx&&typeof adx==='object'?{adx:safeNumber(adx.adx),pdi:safeNumber(adx.pdi),mdi:safeNumber(adx.mdi)}:safeNumber(adx),
        volume:latestVolume,volumeSMA20:safeNumber(volumeSMA20),rvol,volumeSpike:Number.isFinite(rvol)&&rvol>=RVOL_SPIKE_THRESHOLD,
        obv:safeNumber(obv),mfi:safeNumber(mfi),
        vwap:safeNumber(calculateSessionVWAP(c)),
        supertrend
    };
}

module.exports = calculateIndicators;
module.exports.calculateIndicators = calculateIndicators;
module.exports.calculateVWAP = calculateSessionVWAP;
module.exports.calculateSessionVWAP = calculateSessionVWAP;
module.exports.isValidCandle = isValidCandle;
