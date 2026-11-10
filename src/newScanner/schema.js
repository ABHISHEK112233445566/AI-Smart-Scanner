"use strict";

const SHEETS = Object.freeze({
  SCANNER: "SCANNER",
  DASHBOARD: "Dashboard",
  EQUITY: "EQUITY",
  STATUS: "SCANNER_STATUS"
});

const DASHBOARD_HEADERS = Object.freeze([
  "stock", "stockPrice", "optionType", "strike", "stockEntryPrice",
  "stockStopLossPrice", "stockTargetPrice", "riskReward", "confidence",
  "oiMood", "volume", "newsStatus", "newsHeadline"
]);

const TIMEFRAMES = Object.freeze([
  { key: "daily", interval: "ONE_DAY", required: true },
  { key: "fourHour", interval: "FOUR_HOUR", required: true },
  { key: "oneHour", interval: "ONE_HOUR", required: true },
  { key: "fifteenMinute", interval: "FIFTEEN_MINUTE", required: true },
  { key: "fiveMinute", interval: "FIVE_MINUTE", required: true }
]);

const LIMITS = Object.freeze({
  SCANNER_ROWS: 20,
  DASHBOARD_ROWS: 5,
  QUOTE_BATCH_SIZE: 100,
  MAX_QUOTE_AGE_MS: 120000,
  MIN_DAILY_CANDLES: 200,
  MIN_INTRADAY_CANDLES: 35,
  MIN_OPTION_CANDLES: 20
});

function emptyStage(name) {
  return { name, status: "NOT_STARTED", inputCount: 0, outputCount: 0, failedCount: 0, errors: [] };
}

module.exports = { SHEETS, DASHBOARD_HEADERS, TIMEFRAMES, LIMITS, emptyStage };
