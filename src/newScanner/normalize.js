"use strict";

function symbol(value) {
  return String(value ?? "").trim().toUpperCase()
    .replace(/\s+/g, "").replace(/\.NS$/i, "").replace(/-EQ$/i, "");
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
function validCandle(candle) {
  if (!candle || typeof candle !== "object") return false;
  const open = positive(candle.open), high = positive(candle.high);
  const low = positive(candle.low), close = positive(candle.close);
  const volume = number(candle.volume);
  return Boolean(candle.time ?? candle.timestamp ?? candle.datetime) &&
    open !== null && high !== null && low !== null && close !== null &&
    high >= Math.max(open, close) && low <= Math.min(open, close) &&
    high >= low && volume !== null && volume >= 0;
}
function normalizeCandle(candle) {
  if (!validCandle(candle)) return null;
  return {
    time: candle.time ?? candle.timestamp ?? candle.datetime,
    open: number(candle.open), high: number(candle.high),
    low: number(candle.low), close: number(candle.close),
    volume: number(candle.volume)
  };
}
function validateQuote(quote) {
  const ltp = positive(quote?.ltp ?? quote?.last_price ?? quote?.price);
  const timestamp = quote?.timestamp ?? quote?.lastTradeTime ?? quote?.last_trade_time ?? null;
  const netChange = number(quote?.netChange ?? quote?.net_change);
  const previousClose = positive(quote?.previousClose ?? quote?.previous_close) ??
    (ltp !== null && netChange !== null && ltp - netChange > 0 ? ltp - netChange : null);
  return {
    valid: ltp !== null,
    ltp,
    previousClose,
    netChange,
    volume: number(quote?.volume ?? quote?.volume_traded),
    oi: number(quote?.oi ?? quote?.open_interest),
    previousOI: number(quote?.previousOI ?? quote?.prev_oi ?? quote?.previous_oi),
    timestamp,
    raw: quote?.raw ?? quote ?? null,
    reason: ltp === null ? "INVALID_OR_MISSING_LTP" : previousClose === null ? "PREVIOUS_CLOSE_UNAVAILABLE" : "OK"
  };
}
module.exports = { symbol, number, positive, validCandle, normalizeCandle, validateQuote };
