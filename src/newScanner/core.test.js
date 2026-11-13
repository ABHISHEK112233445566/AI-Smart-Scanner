"use strict";

const assert=require("node:assert/strict");
const {validateQuote,validCandle}=require("./normalize");
const {buildFnoUniverse,buildUniverse,parseCsvSymbols,findNiftyIndex}=require("./universe");
const {combineTimeframes,deriveUnderlyingLevels,calculateTechnicalEvidence}=require("./analysis");
const {optionPremiumLevels,selectContract}=require("./options");
const {validateCandidate,buildDailyRiskState,validateEntryPermission}=require("./risk");
const {rankCandidates,dashboardRows}=require("./ranking");
const {DASHBOARD_HEADERS,LIMITS}=require("./schema");
const {isCompanyNewsRelevant}=require("./context");

const quote=validateQuote({ltp:2668.3,net_change:85.4});
assert.ok(Math.abs(quote.previousClose-2582.9)<1e-9);
assert.ok(Math.abs(quote.netChange-85.4)<1e-9);
assert.equal(validateQuote({ltp:197,close:197}).previousClose,null);
assert.equal(validateQuote({ltp:197,previousClose:195}).netChange,2);
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
const niftyIndex=findNiftyIndex([{segment:"NSE_INDEX",trading_symbol:"Nifty 50",instrument_key:"NSE_INDEX|Nifty 50"},{segment:"NSE_INDEX",trading_symbol:"Nifty Bank",instrument_key:"NSE_INDEX|Nifty Bank"}]);
assert.equal(niftyIndex.symbol,"NIFTY");
const universe=buildUniverse({symbols:["ABC","XYZ"]},fno,niftyIndex);
assert.equal(universe.nifty500.length,2);
assert.equal(universe.fnoStocks.length,1);
assert.equal(universe.combined.length,3);
assert.equal(universe.combined.find(x=>x.symbol==="NIFTY").isNiftyIndex,true);

const tf=combineTimeframes({daily:{direction:"BULLISH"},fourHour:{direction:"BULLISH"},oneHour:{direction:"BULLISH"},fifteenMinute:{direction:"UNKNOWN"},fiveMinute:{direction:"BEARISH"}});
assert.equal(tf.direction,"BULLISH");
assert.equal(tf.bullishTimeframes,3);
const conflict=validateCandidate({dataStatus:"VALID",quote:{previousClose:10},marketDataFresh:true,tradeWindowOpen:true,directionalAnalysis:{direction:"BULLISH",indicators:{latestVolume:100,averageVolume:100},rows:[]},underlyingLevels:{valid:true,riskReward:2},optionStatus:"VALID",timeframeAnalysis:{direction:"BULLISH",bullishTimeframes:4,bearishTimeframes:1,rows:[{patternStatus:"CONFIRMED",patternDirection:"BEARISH"},{patternStatus:"CONFIRMED",patternDirection:"BEARISH"}]},optionQuoteFresh:true,optionCandlesFresh:true,oi:{dataStatus:"VALID"},news:{status:"NO_MAJOR_NEWS"}});
assert.ok(conflict.reasons.includes("CONFIRMED_PATTERN_CONFLICT_ACROSS_TIMEFRAMES"));
const levels=deriveUnderlyingLevels({direction:"BULLISH",structure:{latestClose:100,nearestSupport:95,nearestResistance:115,support20:90,resistance20:120}});
assert.equal(levels.valid,true);
assert.equal(levels.stopLoss,95);
assert.equal(levels.target,115);
assert.equal(levels.riskReward,3);
// Poor reward-to-risk must retain real levels for WATCH diagnostics, never
// be marked valid or repaired by artificially moving target/stop.
const breakoutLevels=deriveUnderlyingLevels({direction:"BULLISH",structure:{latestClose:120,support20:95,resistance20:115,support:90,resistance:130}},120);
assert.equal(breakoutLevels.valid,false);
assert.equal(breakoutLevels.stopLoss,95);
assert.equal(breakoutLevels.target,130);
assert.equal(breakoutLevels.riskReward,0.4);
assert.equal(breakoutLevels.reason,"STRUCTURAL_REWARD_BELOW_1_5_RR");
const breakdownLevels=deriveUnderlyingLevels({direction:"BEARISH",structure:{latestClose:80,support20:85,resistance20:105,support:70,resistance:110}},80);
assert.equal(breakdownLevels.valid,false);
assert.equal(breakdownLevels.stopLoss,105);
assert.equal(breakdownLevels.target,70);
assert.equal(breakdownLevels.riskReward,0.4);
const fartherTargetLevels=deriveUnderlyingLevels({direction:"BULLISH",structure:{latestClose:100,nearestSupport:98,nearestResistance:101,support20:90,resistance20:106,support:85,resistance:110}});
assert.equal(fartherTargetLevels.valid,true,"select a farther real resistance when the nearest one cannot meet minimum RR");
assert.equal(fartherTargetLevels.stopLoss,98);
assert.equal(fartherTargetLevels.target,106);
assert.equal(fartherTargetLevels.riskReward,3);
const nearestPivotLevels=deriveUnderlyingLevels({direction:"BULLISH",structure:{latestClose:100,nearestSupport:98,nearestResistance:106,support20:90,resistance20:120}});
assert.equal(nearestPivotLevels.valid,true);
assert.equal(nearestPivotLevels.stopLoss,98);
assert.equal(nearestPivotLevels.target,106);
assert.equal(nearestPivotLevels.riskReward,3);

const contracts=[
 {instrument_type:"CE",strike_price:100,expiry:"2026-12-31",instrument_key:"CE100"},
 {instrument_type:"PE",strike_price:100,expiry:"2026-12-31",instrument_key:"PE100"}
];
assert.equal(selectContract(contracts,"BULLISH",101,new Date("2026-11-10")).side,"CE");
assert.equal(selectContract(contracts,"BEARISH",101,new Date("2026-11-10")).side,"PE");
const candles=Array.from({length:35},(_,i)=>({open:9+i*.1,high:10+i*.1,low:8+i*.1,close:9.5+i*.1,volume:1000,time:new Date(2026,0,i+1).toISOString()}));
assert.equal(optionPremiumLevels(candles).candlesUsed,35);
const tightCandles=Array.from({length:35},(_,i)=>({open:4.86,high:4.90,low:4.85,close:4.87,volume:1000,time:new Date(2026,0,i+1).toISOString()}));
assert.equal(optionPremiumLevels(tightCandles,4.87).reason,"OPTION_STOP_DISTANCE_TOO_TIGHT");

const risk=buildDailyRiskState({date:"2026-11-10",tradeCount:1,realizedPnl:-100});
assert.equal(validateEntryPermission(risk).allowed,false);
assert.equal(validateCandidate({dataStatus:"VALID",quote:{previousClose:10},marketDataFresh:false,directionalAnalysis:{direction:"BULLISH"},underlyingLevels:{valid:true,riskReward:2},optionStatus:"VALID",oi:{dataStatus:"VALID"},news:{status:"NO_MAJOR_NEWS"}}).passed,false);

const candidate={underlyingLevels:{valid:true,entry:100,stopLoss:98,target:104,riskReward:2},directionalAnalysis:{direction:"BULLISH",dataStatus:"VALID",bullScore:90,bearScore:0},timeframeAnalysis:{bullishTimeframes:4,bearishTimeframes:1},quote:{volume:100000},optionContract:{valid:true},optionPremiumSetup:{valid:true,riskReward:2},optionQuote:{ltp:10},riskValidation:{passed:false},decision:"WATCH"};
assert.equal(rankCandidates([candidate]).length,1);
assert.equal(rankCandidates([{...candidate,optionPremiumSetup:{valid:false},symbol:"NO_PREMIUM"}]).length,1);
assert.equal(rankCandidates([{...candidate,optionContract:{valid:false},symbol:"NO_CONTRACT"}]).length,1);
const filler=Array.from({length:22},(_,i)=>({...candidate,symbol:"STOCK"+i,confidence:100-i,isNiftyIndex:false}));
const niftyCandidate={...candidate,symbol:"NIFTY",isNiftyIndex:true,confidence:1};
const forcedRank=rankCandidates([...filler,niftyCandidate]);
assert.equal(forcedRank.length,20);
assert.ok(forcedRank.some(x=>x.symbol==="NIFTY"));
const forcedDashboard=dashboardRows(forcedRank);
assert.equal(forcedDashboard.length,5);
assert.ok(forcedDashboard.some(x=>x.symbol==="NIFTY"));
assert.equal(LIMITS.SCANNER_ROWS,20);
assert.deepEqual(DASHBOARD_HEADERS,["stock","stockPrice","optionType","strike","stockEntryPrice","stockStopLossPrice","stockTargetPrice","riskReward","confidence","oiMood","volume","newsStatus","newsHeadline"]);
console.log("NEW SCANNER CORE TESTS PASSED");
