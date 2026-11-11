"use strict";

const assert=require("node:assert/strict");
const {validateQuote,validCandle}=require("./normalize");
const {buildFnoUniverse,buildUniverse,parseCsvSymbols,findNiftyIndex}=require("./universe");
const {combineTimeframes,deriveUnderlyingLevels,calculateTechnicalEvidence}=require("./analysis");
const {optionPremiumLevels,selectContract}=require("./options");
const {validateCandidate,buildDailyRiskState,validateEntryPermission}=require("./risk");
const {rankCandidates,dashboardRows}=require("./ranking");
const {DASHBOARD_HEADERS,LIMITS}=require("./schema");

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
const tightCandles=Array.from({length:35},(_,i)=>({open:4.86,high:4.90,low:4.85,close:4.87,volume:1000,time:new Date(2026,0,i+1).toISOString()}));
assert.equal(optionPremiumLevels(tightCandles,4.87).reason,"OPTION_STOP_DISTANCE_TOO_TIGHT");

const risk=buildDailyRiskState({date:"2026-11-10",tradeCount:1,realizedPnl:-100});
assert.equal(validateEntryPermission(risk).allowed,false);
assert.equal(validateCandidate({dataStatus:"VALID",quote:{previousClose:10},marketDataFresh:false,directionalAnalysis:{direction:"BULLISH"},underlyingLevels:{valid:true,riskReward:2},optionStatus:"VALID",oi:{dataStatus:"VALID"},news:{status:"NO_MAJOR_NEWS"}}).passed,false);

const candidate={directionalAnalysis:{direction:"BULLISH",dataStatus:"VALID",bullScore:90,bearScore:0},timeframeAnalysis:{bullishTimeframes:4,bearishTimeframes:1},quote:{volume:100000},optionContract:{valid:true},optionPremiumSetup:{valid:true,riskReward:2},optionQuote:{ltp:10},riskValidation:{passed:false},decision:"WATCH"};
assert.equal(rankCandidates([candidate]).length,1);
assert.equal(rankCandidates([{...candidate,optionPremiumSetup:{valid:false},decision:"WATCH"}]).length,1);
assert.equal(rankCandidates([{...candidate,optionContract:{valid:false},decision:"WATCH"}]).length,1);
assert.equal(rankCandidates([{...candidate,optionQuote:undefined,decision:"WATCH"}]).length,1);
assert.equal(rankCandidates([{...candidate,optionPremiumSetup:{valid:false},decision:"TRADE"}]).length,0);
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
