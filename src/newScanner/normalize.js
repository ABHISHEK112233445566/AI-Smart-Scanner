"use strict";

function symbol(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/\.NS$/i, "").replace(/-EQ$/i, "");
}
function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function positive(value) {
  const n = number(value);
  return n !== null && n > 0 ? n : null;
}
function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e17 ? n / 1e6 : n > 1e14 ? n / 1e3 : n > 1e11 ? n : n * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function validCandle(candle) {
  if (!candle || typeof candle !== "object") return false;
  const open=positive(candle.open),high=positive(candle.high),low=positive(candle.low),close=positive(candle.close);
  const volume=number(candle.volume);
  return Boolean(candle.time??candle.timestamp??candle.datetime) && open!==null && high!==null && low!==null && close!==null &&
    high>=Math.max(open,close) && low<=Math.min(open,close) && high>=low && volume!==null && volume>=0;
}
function normalizeCandle(candle) {
  if (!validCandle(candle)) return null;
  return {time:candle.time??candle.timestamp??candle.datetime,open:number(candle.open),high:number(candle.high),low:number(candle.low),close:number(candle.close),volume:number(candle.volume)};
}
function validateQuote(quote) {
  const ltp=positive(quote?.ltp??quote?.last_price??quote?.price);
  const timestamp=parseTimestamp(quote?.last_trade_time??quote?.lastTradeTime??quote?.timestamp);
  const netChange=number(quote?.netChange??quote?.net_change);
  // Prefer the broker's absolute net change when it is present. This avoids
  // treating a stale/current candle close as the previous session close.
  const derivedPrevious=ltp!==null&&netChange!==null&&ltp-netChange>0?ltp-netChange:null;
  const explicitPrevious=positive(quote?.previousClose??quote?.previous_close);
  const previousClose=derivedPrevious??explicitPrevious;
  return {
    valid:ltp!==null,ltp,previousClose,netChange,
    changePercent:ltp!==null&&previousClose!==null?(ltp-previousClose)/previousClose*100:null,
    volume:number(quote?.volume??quote?.volume_traded),oi:number(quote?.oi??quote?.open_interest),
    previousOI:number(quote?.previousOI??quote?.prev_oi??quote?.previous_oi),
    timestamp,raw:quote?.raw??quote??null,
    reason:ltp===null?"INVALID_OR_MISSING_LTP":previousClose===null?"PREVIOUS_CLOSE_UNAVAILABLE":"OK"
  };
}
module.exports={symbol,number,positive,parseTimestamp,validCandle,normalizeCandle,validateQuote};
