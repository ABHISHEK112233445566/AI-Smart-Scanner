const assert = require("assert");
const { normalizeEvent, applyEvent, applyNoEvent, movement } = require("./earningsIntelligence");
const event = normalizeEvent({
  bm_symbol: "TEST",
  bm_date: "28-10-2026",
  bm_purpose: "Consideration of unaudited quarterly financial results"
});
assert.ok(event, "NSE financial-results board meeting should be recognized");
assert.strictEqual(event.earningsMeetingDate, "2026-10-28", "meeting date must not shift across UTC timezone");
const upcoming = applyEvent({
  symbol: "TEST", finalScore: 83, scannerScore: 83, currentPrice: 106, previousClose: 100
}, { ...event, _meetingDate: new Date(2026, 9, 28) }, new Date(2026, 9, 27));
assert.strictEqual(upcoming.earningsScoreContribution, 3);
assert.strictEqual(upcoming.earningsBaseScore, 83);
assert.strictEqual(upcoming.earningsAdjustedScore, 86);
assert.strictEqual(upcoming.finalScore, 86);
const recent = applyEvent({
  symbol: "TEST", finalScore: 80, scannerScore: 90, currentPrice: 106, previousClose: 100,
  changePct: 6, volumeRatio5: 1.5
}, { ...event, _meetingDate: new Date(2026, 9, 26) }, new Date(2026, 9, 27));
assert.strictEqual(recent.earningsDirection, "BULLISH");
assert.strictEqual(recent.earningsScoreContribution, 5);
assert.strictEqual(recent.earningsBaseScore, 90, "base score should use the strongest existing score alias");
assert.strictEqual(recent.earningsAdjustedScore, 95);
assert.strictEqual(movement({ currentPrice: 0, livePrice: 106, previousClose: 0, prevClose: 100 }).changePct, 6,
  "zero aliases must not hide valid later price aliases");
assert.strictEqual(applyNoEvent({}, false).earningsEventStatus, "EARNINGS_DATA_UNAVAILABLE",
  "API failure must not be reported as a verified absence of results meetings");
assert.strictEqual(applyNoEvent({}, true).earningsEventStatus, "NO_CONFIRMED_RESULTS_MEETING");
console.log("Earnings intelligence tests passed");
