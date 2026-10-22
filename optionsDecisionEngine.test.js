const assert = require("assert");
const { calculateOptionsDecision } = require("./src/optionsDecisionEngine");

async function run() {
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
  console.log("Options decision engine regression tests passed");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
