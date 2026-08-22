# AI Smart Scanner V4 — Testing & Verification Checklist

## Development rule
A component is not complete when code is changed. It is complete only after its relevant tests pass.

## Phase 1 — Universe
- [ ] NIFTY50 enable/disable works
- [ ] NIFTY100 enable/disable works
- [ ] NIFTY200 enable/disable works
- [ ] NIFTY500 enable/disable works
- [ ] CUSTOM enable/disable works
- [ ] Empty/disabled universe contributes zero symbols
- [ ] Duplicate symbols are removed
- [ ] Same stock from multiple universes is scanned once
- [ ] NIFTY index option flag works
- [ ] BANKNIFTY index option flag works
- [ ] Deep-scan limit is configurable

## Phase 2 — Broker
- [ ] Upstox is primary
- [ ] Upstox success does not call Angel One unnecessarily
- [ ] Upstox failure triggers Angel One fallback
- [ ] Fallback does not restart the complete stock scan
- [ ] Fallback reason is logged
- [ ] Data source is recorded

## Phase 3 — Market Regime
- [ ] Bullish regime detected correctly
- [ ] Bearish regime detected correctly
- [ ] Neutral regime detected correctly
- [ ] Regime strength recorded
- [ ] Regime is available to stock/index engines

## Phase 4 — Scanner
- [ ] Fast scan covers all enabled symbols
- [ ] Deep scan is limited to survivors
- [ ] Complete scanner result retained
- [ ] No forced CALL
- [ ] No forced PUT
- [ ] NO TRADE is allowed

## Phase 5 — Outputs
- [ ] Master SCANNER contains one row per scanned symbol/index
- [ ] Complete scanner data is retained
- [ ] EQUITY sheet contains equity decisions only
- [ ] CALL_OPTIONS contains stock/index CALL opportunities
- [ ] PUT_OPTIONS contains stock/index PUT opportunities

## Phase 6 — Accuracy
- [ ] Every prediction receives a unique ID
- [ ] New predictions do not overwrite historical predictions
- [ ] Actual maximum favorable move recorded
- [ ] Actual maximum adverse move recorded
- [ ] T1/T2 achievement recorded
- [ ] SL achievement recorded
- [ ] Target achievement percentage recorded
- [ ] Direction accuracy recorded
- [ ] Confidence-band accuracy recorded
- [ ] Equity/CALL/PUT/NIFTY/BANKNIFTY accuracy separated

## Phase 7 — Final validation
- [ ] Full scanner run completed
- [ ] Google Sheet output verified
- [ ] Broker fallback tested
- [ ] Duplicate scan test passed
- [ ] NIFTY/BANKNIFTY test passed
- [ ] Accuracy update test passed
- [ ] Live-market dry run passed
- [ ] Final regression test passed
