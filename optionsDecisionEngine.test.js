const assert = require("assert");
const { calculateOptionsDecision, isMarketSessionOpen, stockEntry, quoteTimestampMs, normalizeExpiry, optionMarketData, premiumLevels } = require("./src/optionsDecisionEngine");

async function run() {
  assert.strictEqual(stockEntry({ stockEntry: 100 }, 100, "CALL"), 100,
    "a valid scanner-calculated stock entry at the live price must not be discarded");
  assert.strictEqual(stockEntry({ stockEntry: 110, triggerPrice: 105, resistance1: 105 }, 100, "CALL"), 105,
    "a stale supplied entry must not override a valid nearby breakout trigger");
  assert.strictEqual(quoteTimestampMs("1793356188112"), 1793356188112,
    "numeric-string broker timestamps must be parsed as epoch milliseconds");
  assert.strictEqual(quoteTimestampMs("not-a-timestamp"), null,
    "invalid quote timestamps must remain unavailable");
  const quoteFreshness = optionMarketData({
    ltp: 12,
    timestamp: "2026-11-01T23:30:00+05:30",
    last_trade_time: "2026-10-30T15:20:00+05:30"
  });
  assert.strictEqual(quoteFreshness.timestamp, "2026-10-30T15:20:00+05:30",
    "option freshness must use actual last-trade time, not a fresh feed-update timestamp");
  const missingTradeTime = optionMarketData({ ltp: 12, timestamp: "2026-11-01T23:30:00+05:30" });
  assert.strictEqual(missingTradeTime.timestamp, null,
    "a feed timestamp without an actual last-trade timestamp must not be treated as a fresh trade");
  assert.strictEqual(normalizeExpiry("2026-10-29"), "2026-10-29",
    "valid ISO option expiries must be preserved");
  assert.strictEqual(normalizeExpiry("2026-02-30"), "",
    "impossible calendar dates must not be accepted as option expiries");
  assert.strictEqual(normalizeExpiry("1900-01-19"), "1900-01-19",
    "valid historical dates remain parseable; the expiry eligibility gate rejects expired contracts");
  assert.strictEqual(normalizeExpiry("not-a-date"), "",
    "invalid expiry strings must not be passed through as dates");

  const premiumCandles = [
    { high: 14, low: 12, close: 13 },
    { high: 14, low: 11, close: 12 },
    { high: 13, low: 10, close: 12 },
    { high: 15, low: 12, close: 14 },
    { high: 16, low: 13, close: 15 },
    { high: 17, low: 14, close: 16 },
    { high: 18, low: 15, close: 17 },
    { high: 25, low: 16, close: 22 },
    { high: 19, low: 15, close: 17 },
    { high: 18, low: 14, close: 16 },
    { high: 17, low: 13, close: 15 }
  ];
  const premiumPlan = premiumLevels({ ltp: 15 }, premiumCandles);
  assert.strictEqual(premiumPlan.valid, true,
    "option premium plan must use actual 5-minute swing levels");
  assert.strictEqual(premiumPlan.entry, 15);
  assert.strictEqual(premiumPlan.stopLoss, 10);
  assert.strictEqual(premiumPlan.target1, 25);
  assert.strictEqual(premiumPlan.riskReward, 2);
  assert.strictEqual(premiumPlan.levelSource, "OPTION_5M_OHLC_SWINGS");
  assert.strictEqual(premiumLevels({ ltp: 15 }, []).valid, false,
    "missing option candles must never produce fabricated premium SL/targets");
  assert.strictEqual(isMarketSessionOpen(new Date("2026-10-24T10:00:00+05:30")), false,
    "weekend scans must never be marked executable");
  assert.strictEqual(isMarketSessionOpen(new Date("2026-10-26T10:00:00+05:30")), true,
    "regular weekday market hours should be recognized");
  assert.strictEqual(isMarketSessionOpen(new Date("2026-10-26T09:14:00+05:30")), false,
    "the market gate must remain closed before 09:15 IST");
  assert.strictEqual(isMarketSessionOpen(new Date("2026-10-26T15:30:00+05:30")), false,
    "the market gate must close at 15:30 IST");
  const conflict = await calculateOptionsDecision({
    stock: "CONFLICT_TEST",
    symbol: "CONFLICT_TEST",
    price: 100,
    currentPrice: 100,
    qualified: true,
    direction: "BULLISH",
    stockDirection: "BULLISH",
    pipeline: { mtfChecked: true },
    dailyTrend: "BEARISH",
    oneHourTrend: "BEARISH",
    thirtyMinTrend: "BEARISH",
    fifteenMinTrend: "BEARISH",
    ema5: 95,
    ema9: 97,
    ema20: 99,
    ema50: 102,
    rsi: 35,
    macdValue: -2,
    macdSignal: -1,
    histogram: -1,
    adxValue: 28,
    pdi: 12,
    mdi: 30,
    vwap: 105,
    supertrend: "BEARISH",
    signal: "BEARISH",
    trend: "BEARISH"
  });
  assert.strictEqual(conflict.optionsDecision, "REJECT");
  assert.strictEqual(conflict.optionType, null);
  assert.strictEqual(conflict.explicitDirectionConflict, true);
  assert.strictEqual(conflict.decisionReason, "EXPLICIT_DIRECTION_CONFLICTS_WITH_TECHNICAL_EVIDENCE");

  const waiting = await calculateOptionsDecision({
    stock: "WAIT_TRIGGER_TEST",
    symbol: "WAIT_TRIGGER_TEST",
    price: 100,
    currentPrice: 100,
    qualified: true,
    direction: "BULLISH",
    stockDirection: "BULLISH",
    pipeline: { mtfChecked: true },
    triggerPrice: 105,
    dailyTrend: "BULLISH",
    oneHourTrend: "BULLISH",
    thirtyMinTrend: "BULLISH",
    fifteenMinTrend: "BULLISH",
    ema5: 105,
    ema9: 104,
    ema20: 103,
    ema50: 102,
    rsi: 60,
    macdValue: 2,
    macdSignal: 1,
    histogram: 1,
    adxValue: 28,
    pdi: 30,
    mdi: 12,
    vwap: 95,
    supertrend: "BULLISH",
    signal: "BULLISH",
    trend: "BULLISH",
    support: 95,
    resistance: 125,
    volumeConfirmed5: true
  });
  assert.strictEqual(waiting.optionsDecision, "WATCH", "an untriggered setup should be watch-only, not rejected");
  assert.strictEqual(waiting.decision, "WATCH");
  assert.strictEqual(waiting.reason, "WAIT_FOR_STOCK_TRIGGER");
  assert.ok(waiting.confidence > 0, "watch-only rows should retain calculated setup confidence");
  assert.strictEqual(waiting.optionsConfidence, waiting.confidence, "confidence columns should agree");
  assert.strictEqual(waiting.pipeline.waitingForStockTrigger, true);
  assert.strictEqual(waiting.pipeline.optionsTradeGatePassed, false, "waiting setups must never pass the trade gate");

  console.log("Options decision engine regression tests passed");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
