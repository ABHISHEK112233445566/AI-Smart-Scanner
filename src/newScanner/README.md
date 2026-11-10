# New Options Scanner

This is an independent scanner implementation. The legacy scanner is a **requirements and data-source reference only**. New modules must not import `appV14`, `scanner`, `rankingEngine`, `optionsDecisionEngine`, `tradeSetup`, `dashboard`, or other legacy decision/orchestration modules.

## Required inputs (reference contract)
- NSE NIFTY 500 constituent list.
- NSE equity instrument master and exact NSE_FO stock-underlying links.
- Live underlying quotes: LTP, OHLC, previous close/net change, volume, OI, timestamps.
- Historical OHLCV: daily, 4h, 1h, 15m and 5m.
- Technical indicators, chart patterns, market structure and multi-timeframe evidence.
- Option contracts: expiry, strike, CE/PE, instrument key and trading symbol.
- Live option quotes and option 5m OHLCV; option volume/OI and previous OI.
- Underlying OI/price movement, relevant company/market news.
- Google Sheets webhook for SCANNER, Dashboard, EQUITY and SCANNER_STATUS.

## Independent processing design
1. Build a validated universe from official constituents and broker instrument identity.
2. Fetch live quotes in bounded concurrency; persist quote provenance and freshness.
3. Fetch candles independently per timeframe; validate OHLCV and coverage before indicators.
4. Produce stock-side evidence without using option premium as underlying price.
5. Determine CE/PE direction from explicit evidence; resolve exact contracts and live quotes.
6. Calculate option-premium risk/reward from the selected contract's own 5m candles.
7. Apply data-quality, market-session and risk gates before ranking.
8. Rank only validated candidates; write Top 20 SCANNER and Top 5 Dashboard.
9. Keep Dashboard schema fixed at the approved 13 columns.
10. Report per-stage counts, failures and rejection reasons. Missing data is UNKNOWN, never fabricated zero.

## Rules
- F&O movers are sourced only from verified NSE stock-option underlyings.
- NIFTY 500 and F&O movers are independent source universes; de-duplicate only after each source is built.
- No hidden fallback to legacy decisions or fabricated levels.
- The original backup branch and master branch must never be changed by this work.
- Do not make the new runner the production entrypoint until its end-to-end tests pass.
