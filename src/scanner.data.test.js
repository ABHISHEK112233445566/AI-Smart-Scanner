const assert=require("node:assert/strict");
const {buildStockAnalysis,getMACDValues,quoteTimestampMs}=require("./scanner");

const base={
  stockSymbol:"TEST",instrumentKey:"NSE_EQ|TEST",latestPrice:123,
  indicators:{vwap:121,sessionVwap:121,ema5:null,ema20:120,macd:null,adx:null,bollinger:null,dataQuality:{validCandles:180,partial:true}},
  scoreData:{score:0,finalScore:0,bullishScore:0,bearishScore:0},
  trade:{},sr:{},breakout:{},mtf:{},pivot:{},cpr:{},
  stockDirection:"NEUTRAL",technicalDirection:"NEUTRAL",momentumScore:0,previousClose:122
};
const row=buildStockAnalysis(base);
assert.equal(row.vwap,121,"VWAP must map from the calculated intraday vwap field");
assert.equal(row.intradayVWAP,121,"intraday VWAP alias must match the calculated VWAP");
assert.equal(row.ema5,null,"unavailable EMA must remain null, not become a false zero");
assert.equal(row.rsi,null,"unavailable RSI must remain null");
assert.equal(row.adx,null,"unavailable ADX must remain null");
assert.equal(row.bollingerMiddle,null,"unavailable Bollinger values must remain null");
assert.equal(row.entry,null,"unavailable stock entry must remain null");
assert.equal(row.stopLoss,null,"unavailable stop must remain null");
assert.equal(row.target1,null,"unavailable target must remain null");
assert.deepEqual(row.indicatorDataQuality,{validCandles:180,partial:true});
assert.equal(quoteTimestampMs("1794312000.5"),1794312000500,
  "decimal Unix-second timestamps must be parsed as milliseconds");
assert.equal(quoteTimestampMs("1794312000000"),1794312000000,
  "millisecond Unix timestamps must remain milliseconds");
assert.deepEqual(getMACDValues({}),{macd:null,signal:null,histogram:null},
  "missing MACD values must not be fabricated as zeros");
assert.deepEqual(getMACDValues({macd:{MACD:1.25,signal:1,histogram:0.25}}),
  {macd:1.25,signal:1,histogram:0.25});
assert.deepEqual(getMACDValues({macd:{MACD:1.25,signal:1}}),
  {macd:1.25,signal:1,histogram:0.25},
  "histogram may be derived only when both MACD and signal are present");
console.log("Scanner data mapping regression tests passed");
