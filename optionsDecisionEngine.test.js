const assert = require("assert");
const { calculateOptionsDecision, isMarketSessionOpen, stockEntry, quoteTimestampMs } = require("./src/optionsDecisionEngine");

async function run() {
  assert.strictEqual(stockEntry({ stockEntry: 100 }, 100, "CALL"), 100,
    "a valid scanner-calculated stock entry at the live price must not be discarded");
  assert.strictEqual(stockEntry({ stockEntry: 110, triggerPrice: 105, resistance1: 105 }, 100, "CALL"), 105,
    "a stale supplied entry must not override a valid nearby breakout trigger");
  assert.strictEqual(quoteTimestampMs("1793356188112"), 1793356188112,
    "numeric-string broker timestamps must be parsed as epoch milliseconds");
  assert.strictEqual(quoteTimestampMs("not-a-timestamp"), null,
    "invalid quote timestamps must remain unavailable");
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
    resistance: 110,
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
