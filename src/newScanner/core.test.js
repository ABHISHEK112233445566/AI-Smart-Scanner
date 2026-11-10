"use strict";

const assert=require("node:assert/strict");
const {validateQuote,validCandle}=require("./normalize");
const {buildFnoUniverse,buildUniverse,parseCsvSymbols}=require("./universe");
const {combineTimeframes,deriveUnderlyingLevels}=require("./analysis");
const {optionPremiumLevels,selectContract}=require("./options");
const {validateCandidate,buildDailyRiskState,validateEntryPermission}=require("./risk");
const {rankCandidates}=require("./ranking");
const {DASHBOARD_HEADERS,LIMITS}=require("./schema");

const quote=validateQuote({ltp:2668.3,net_change:85.4});
assert.ok(Math.abs(quote.previousClose-2582.9)<1e-9);
assert.equal(quote.valid,true);
assert.equal(validateQuote({ltp:0}).valid,false);
assert.equal(validCandle({time:"2026-11-10",open:10,high:12,low:9,close:11,volume:100}),true);
assert.equal(validCandle({time:"2026-11-10",open:10,high:8,low:9,close:11,volume:100}),false);

const instruments=[
 {segment:"NSE_EQ",trading_symbol:"ABC",instrument_key:"NSE_EQ|abc"},
 {segment:"NSE_FO",instrument_type:"OPTSTK",underlying_key:"NSE_EQ|abc",underlying_symbol:"ABC",instrument_key:"NSE_FO|abcCE"}
];
const fno=buildFnoUniverse(instruments);
assert.equal(fno.length,1);
assert.equal(fno[0].symbol,"ABC");
const universe=buildUniverse({symbols:["ABC","XYZ"]},fno);
assert.equal(universe.nifty500.length,2);
assert.equal(universe.fnoStocks.length,1);
assert.equal(universe.combined.length,2);

const tf=combineTimeframes({daily:{direction:"BULLISH"},fourHour:{direction:"BULLISH"},oneHour:{direction:"BULLISH"},fifteenMinute:{direction:"UNKNOWN"},fiveMinute:{direction:"BEARISH"}});
assert.equal(tf.direction,"BULLISH");
assert.equal(tf.bullishTimeframes,3);
const levels=deriveUnderlyingLevels({direction:"BULLISH",structure:{latestClose:100,support20:95,resistance20:115}});
assert.equal(levels.valid,true);
assert.equal(levels.riskReward,3);

const contracts=[
 {instrument_type:"CE",strike_price:100,expiry:"2026-12-31",instrument_key:"CE100"},
 {instrument_type:"PE",strike_price:100,expiry:"2026-12-31",instrument_key:"PE100"}
];
assert.equal(selectContract(contracts,"BULLISH",101,new Date("2026-11-10")).side,"CE");
assert.equal(selectContract(contracts,"BEARISH",101,new Date("2026-11-10")).side,"PE");
const candles=Array.from({length:35},(_,i)=>({open:9+i*.1,high:10+i*.1,low:8+i*.1,close:9.5+i*.1,volume:1000,time:new Date(2026,0,i+1).toISOString()}));
assert.equal(optionPremiumLevels(candles).candlesUsed,35);

const risk=buildDailyRiskState({date:"2026-11-10",tradeCount:1,realizedPnl:-100});
assert.equal(validateEntryPermission(risk).allowed,false);
assert.equal(validateCandidate({dataStatus:"VALID",quote:{previousClose:10},marketDataFresh:false,directionalAnalysis:{direction:"BULLISH"},underlyingLevels:{valid:true,riskReward:2},optionStatus:"VALID",oi:{dataStatus:"VALID"},news:{status:"NO_MAJOR_NEWS"}}).passed,false);

const candidate={directionalAnalysis:{direction:"BULLISH",dataStatus:"VALID",bullScore:90,bearScore:0},timeframeAnalysis:{bullishTimeframes:4,bearishTimeframes:1},quote:{volume:100000},riskValidation:{passed:false},decision:"WATCH"};
assert.equal(rankCandidates([candidate]).length,1);
assert.equal(LIMITS.SCANNER_ROWS,20);
assert.deepEqual(DASHBOARD_HEADERS,["stock","stockPrice","optionType","strike","stockEntryPrice","stockStopLossPrice","stockTargetPrice","riskReward","confidence","oiMood","volume","newsStatus","newsHeadline"]);
console.log("NEW SCANNER CORE TESTS PASSED");
