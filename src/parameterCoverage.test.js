const assert=require("node:assert/strict");
const {buildParameterCoverage}=require("./parameterCoverage");
const report=buildParameterCoverage({
 indicators:{price:100,ema20:99,ema50:98,ema100:null,ema200:null,rsi:60,macd:{MACD:1,signal:0,histogram:1},adx:{adx:30,pdi:25,mdi:10},vwap:null,supertrend:{trend:"BUY"},bollinger:{middle:95},rvol:1.4,volumeSpike:true,obv:100,mfi:null,dataQuality:{validCandles:60},intraday5:{dataQuality:{validCandles:40},ema20:101,rsi:55,macd:{MACD:1},vwap:100,volume:200,rvol:1.2},intraday15:{}},
 breakout:{chartPattern:"BULL_FLAG",patternDirection:"BULLISH",patternStatus:"CONFIRMED",patternConfidence:80},
 mtf:{validTimeframes:3,unknownTimeframes:1,details:{daily:{valid:true,direction:"BULLISH"},fourHour:{valid:true,direction:"BULLISH"},oneHour:{valid:false,reason:"BROKER_DATA_ERROR"},fifteenMin:{valid:true,direction:"BULLISH"}}},
 sr:{support1:95,resistance1:110},pivot:{pivot:100},cpr:{top:102,bottom:99},trade:{entry:100,stopLoss:95,target1:110,target2:115,riskReward:2},scoreData:{bullishScore:80,bearishScore:20,finalScore:80},stockDirection:"BULLISH"
});
assert.equal(report.parameters.ema100.status,"INSUFFICIENT_HISTORY");
assert.equal(report.parameters.vwap.status,"CALCULATION_UNAVAILABLE");
assert.equal(report.parameters["mtf.oneHour"].status,"BROKER_DATA_ERROR");
assert.equal(report.stages.chartPattern.status,"DETECTED");
assert.equal(report.stages.options.status,"NOT_CHECKED_PRE_OPTION_STAGE");
assert.equal(report.scoringFactors.find(x=>x.name==="ema50VsEma100").status,"NOT_EVALUATED_MISSING_INPUT");
assert.equal(report.scoringFactors.find(x=>x.name==="priceVsEma20").callPoints,5);
assert.equal(report.summary.scoringFactors,16);
console.log("Parameter coverage regression tests passed");
