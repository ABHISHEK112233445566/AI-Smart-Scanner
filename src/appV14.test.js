const assert=require("assert");
const {validOptionRow,sanitizeOptionRow,rankDashboard,rankOptionCandidates,mergeBySymbol}=require("./appV14");
const {buildDashboardPayload}=require("./googleSheetCore");
const {buildDashboard}=require("./dashboard");
const {isNseMarketSessionOpen,applyIntradayVolumePace,quoteTimestampMs}=require("./scanner");

// Intraday readiness must never be confirmed outside NSE cash-market hours.
assert.strictEqual(isNseMarketSessionOpen(new Date("2026-10-31T13:14:00.000Z")),false,
  "Saturday evening in India must be treated as a closed market");
assert.strictEqual(isNseMarketSessionOpen(new Date("2026-11-02T03:00:00.000Z")),false,
  "weekday before 09:15 IST must be treated as a closed market");
assert.strictEqual(quoteTimestampMs("1793356069098"),1793356069098,
  "Upstox millisecond last-trade timestamps must remain milliseconds");
const scannerAuthority={symbol:"MERGE_TEST",marketSessionOpen:false,liveMarketConfirmed:false,liveStockQuoteAvailable:true,liveStockQuoteTimestamp:"1793356069098",liveStockQuoteAgeMs:102466235,stockQuoteStale:true,intradayTrigger:false,intradayTriggerReason:"MARKET_CLOSED"};
const enriched=mergeBySymbol([scannerAuthority],[{symbol:"MERGE_TEST",marketSessionOpen:true,liveMarketConfirmed:true,liveStockQuoteAvailable:true,liveStockQuoteAgeMs:0,stockQuoteStale:false,intradayTrigger:true,intradayTriggerReason:"TRIGGER_CONFIRMED",oiMood:"LONG BUILDUP"}])[0];
assert.strictEqual(enriched.marketSessionOpen,false,"enrichment must not overwrite scanner market-session state");
assert.strictEqual(enriched.liveMarketConfirmed,false,"enrichment must not resurrect a closed/stale quote as live-confirmed");
assert.strictEqual(enriched.stockQuoteStale,true,"enrichment must not overwrite scanner quote staleness");
assert.strictEqual(enriched.intradayTrigger,false,"enrichment must not overwrite the scanner intraday trigger");
assert.strictEqual(enriched.oiMood,"LONG BUILDUP","non-authoritative enrichment fields must still merge");
const inconsistentBase=mergeBySymbol([{symbol:"INCONSISTENT",marketSessionOpen:false,liveMarketConfirmed:true,liveStockQuoteAvailable:true,liveStockQuoteAgeMs:102466235,stockQuoteStale:true}],[{symbol:"INCONSISTENT",oiMood:"LONG BUILDUP"}])[0];
assert.strictEqual(inconsistentBase.liveMarketConfirmed,false,"live-market confirmation must be recomputed from session and quote freshness, even when the scanner base row is inconsistent");
const freshLiveBase=mergeBySymbol([{symbol:"FRESH",marketSessionOpen:true,liveMarketConfirmed:false,liveStockQuoteAvailable:true,liveStockQuoteAgeMs:15000,stockQuoteStale:false}],[{symbol:"FRESH",oiMood:"LONG BUILDUP"}])[0];
assert.strictEqual(freshLiveBase.liveMarketConfirmed,true,"fresh live quotes during market hours should remain confirmed");
const staleTimestampBase=mergeBySymbol([{symbol:"STALE_TIMESTAMP",marketSessionOpen:true,liveMarketConfirmed:true,liveStockQuoteAvailable:true,liveStockQuoteTimestamp:"2020-01-01T10:00:00.000Z",liveStockQuoteAgeMs:0,stockQuoteStale:false}],[{symbol:"STALE_TIMESTAMP",liveMarketConfirmed:true,liveStockQuoteAgeMs:0,stockQuoteStale:false}])[0];
assert.strictEqual(staleTimestampBase.stockQuoteStale,true,"an old authoritative trade timestamp must override an incorrect fresh-age/stale flag");
assert.ok(staleTimestampBase.liveStockQuoteAgeMs>120000,"quote age must be recalculated from the authoritative trade timestamp");
assert.strictEqual(staleTimestampBase.liveMarketConfirmed,false,"an old trade timestamp must never be marked live-confirmed");

const paced=applyIntradayVolumePace({volumePaceRatio5:null,volumeExpectedByNow5:null},{volumePaceRatio5:1.35,volumeExpectedByNow5:120000});
assert.strictEqual(paced.volumePaceRatio5,1.35,"scanner output must use the 5m intraday pace calculation");
assert.strictEqual(paced.volumeExpectedByNow5,120000,"scanner output must use the 5m expected-volume calculation");
assert.strictEqual(paced.volumeConfirmed5,true,"intraday volume pace above 1.0 must confirm volume");
const unavailablePace=applyIntradayVolumePace({volumePaceRatio5:null,volumeExpectedByNow5:null},{});
assert.strictEqual(unavailablePace.volumePaceRatio5,null,"unavailable volume pace must stay blank, not become zero");
assert.strictEqual(unavailablePace.volumeExpectedByNow5,null,"unavailable expected volume must stay blank, not become zero");
assert.strictEqual(unavailablePace.volumeConfirmed5,false,"missing intraday volume pace must never be confirmed");
const dailyVolumeFallback=applyIntradayVolumePace({volumeConfirmed5:true,volumeQuality:"CONFIRMED"},{ });
assert.strictEqual(dailyVolumeFallback.volumeConfirmed5,true,"missing intraday pace must preserve valid daily volume confirmation");
assert.strictEqual(dailyVolumeFallback.volumeQuality,"DAILY_VOLUME_CONFIRMATION");

const trade={
  stockPrice:330.95,
  stockEntry:330.95,
  stockStopLoss:320,
  stockTarget1:350,
  stockTarget2:360,
  stockRiskReward:1.78,
  riskReward:1.78,
  stockDirection:"BULLISH",
  direction:"BULLISH",
  symbol:"TEST",
  optionType:"CE",
  bestStrike:325,
  optionPremiumEntry:15.2,
  optionLTP:15.2,
  optionPremiumStopLoss:10.64,
  optionPremiumTarget1:22.04,
  optionPremiumTarget2:26.6,
  optionPremiumRiskReward:1.5,
  optionPremiumSetup:{
    valid:true,entry:15.2,stopLoss:10.64,target1:22.04,target2:26.6,
    riskReward:1.5,levelSource:"OPTION_5M_OHLC_SWINGS",candlesUsed:150
  },
  optionPremiumLevelsSource:"OPTION_5M_OHLC_SWINGS",
  optionPremiumCandlesUsed:150,
  tradeConfidence:90,
  scannerStrength:90,
  volumeConfirmed5:true,
  intradayTrigger:true,
  oiMood:"LONG BUILDUP",
  oiSentiment:"BULLISH",
  oiDataAvailable:true,
  marketSessionOpen:true,
  liveStockQuoteAvailable:true,
  liveMarketConfirmed:true,
  liveStockQuoteAgeMs:1000,
  stockQuoteStale:false,
  optionQuoteAgeMs:1000,
  optionQuoteStale:false,
  stockDirection:"BULLISH",
  optionInstrumentKey:"TEST_OPTION_KEY",
  optionContractIdentityValid:true,
  optionLiveDataAvailable:true,
  optionLiquidityConfirmed:true,
  optionVolume:9000,
  optionOI:25000,
  optionsDecision:"TRADE",
  decision:"TRADE",
  gates:{basePassed:true,tradePassed:true},
  pipeline:{optionsTradeGatePassed:true},
  qualified:true,
  finalScore:88,
  confidence:90
};

assert.strictEqual(validOptionRow(trade),true);
assert.strictEqual(validOptionRow({...trade,bestStrike:0}),false);
assert.strictEqual(validOptionRow({...trade,optionContractIdentityValid:false}),false);
assert.strictEqual(validOptionRow({...trade,optionLiquidityConfirmed:false}),false);
assert.strictEqual(validOptionRow({...trade,marketSessionOpen:false}),false,"closed-market rows must never be executable trades");
assert.strictEqual(validOptionRow({...trade,stockQuoteStale:true}),false,"stale underlying quotes must never be executable trades");
assert.strictEqual(validOptionRow({...trade,liveMarketConfirmed:false}),false,"an unconfirmed underlying quote must never be executable");
assert.strictEqual(validOptionRow({...trade,optionQuoteStale:true}),false,"stale option quotes must never be executable trades");
assert.strictEqual(validOptionRow({...trade,oiConflict:true}),false,"OI direction conflicts must never be treated as clean directional candidates");
assert.strictEqual(validOptionRow({...trade,oiMood:"SHORT BUILDUP",oiSentiment:"BEARISH"}),false,"opposing underlying OI must reject a CE trade");
assert.strictEqual(validOptionRow({...trade,oiDataAvailable:false}),false,"missing underlying OI confirmation must not qualify as a strict trade");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContract:"KEY_B",optionLiquidityContractData:{instrument_key:"KEY_A",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"liquidity contract key must match selected option instrument");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContractData:{instrument_key:"KEY_B",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"embedded contract key must match selected option instrument");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContractData:{instrument_key:"KEY_B",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"mismatched embedded option instrument key must be rejected");
assert.strictEqual(validOptionRow({...trade,optionPremiumStopLoss:0,optionPremiumTarget1:0,optionPremiumTarget2:0,optionPremiumRiskReward:0,optionPremiumSetup:{valid:false,reason:"NO_REAL_OPTION_PREMIUM_RESISTANCE",levelSource:"OPTION_5M_OHLC_SWINGS",candlesUsed:150}}),false,"underlying stock RR must never substitute for missing real option-premium structure");
assert.strictEqual(validOptionRow({...trade,optionPremiumSetup:{...trade.optionPremiumSetup,levelSource:"MATH_ONLY"}}),false,"math-only option premium levels must never qualify");
assert.strictEqual(validOptionRow({...trade,optionPremiumSetup:{...trade.optionPremiumSetup,candlesUsed:3}}),false,"insufficient option 5m candles must never qualify");
assert.strictEqual(validOptionRow({...trade,optionPremiumSetup:{...trade.optionPremiumSetup,riskReward:1.2}}),false,"option premium RR below 1.5 must never qualify");

const strictTradePayload=buildDashboardPayload([trade]);
assert.strictEqual(strictTradePayload.rows.length,1,"a fully validated TRADE should enter Dashboard");
assert.strictEqual(strictTradePayload.rows[0][strictTradePayload.headers.indexOf("stock")],"TEST");
assert.strictEqual(strictTradePayload.rows[0][strictTradePayload.headers.indexOf("stockTargetPrice")],350,
  "trade Dashboard target must use underlying stock levels");
assert.strictEqual(strictTradePayload.rows[0][strictTradePayload.headers.indexOf("stockStopLossPrice")],320,
  "trade Dashboard stop must use underlying stock levels");
const fiveTradePayload=buildDashboardPayload(Array.from({length:6},(_,i)=>({...trade,stock:"TRADE_"+i,symbol:"TRADE_"+i})));
assert.strictEqual(fiveTradePayload.rows.length,5,"Dashboard must never exceed the Top-5 limit");
const niftyContextPayload=buildDashboardPayload([
  ...Array.from({length:5},(_,i)=>({...trade,stock:"TRADE_NIFTY_"+i,symbol:"TRADE_NIFTY_"+i})),
  {stock:"NIFTY",symbol:"NIFTY",price:23810,stockPrice:23810,optionType:"CE",optionsDecision:"WATCH",decision:"WATCH",oiMood:"BOTH SIDES BUILDING"}
]);
assert.strictEqual(niftyContextPayload.rows.length,5,"NIFTY must occupy one of the five Dashboard slots");
assert.strictEqual(niftyContextPayload.rows[4][niftyContextPayload.headers.indexOf("stock")],"NIFTY");
assert.strictEqual(niftyContextPayload.rows[4][niftyContextPayload.headers.indexOf("optionType")],"","unqualified NIFTY must be context only, not an option trade");

const secondaryDashboard=buildDashboard([trade],[trade],1);
assert.strictEqual(secondaryDashboard.top10.length,1,"secondary dashboard must also require and preserve a fully validated trade");
assert.strictEqual(secondaryDashboard.top10[0].decision,"TRADE");

const bad=sanitizeOptionRow({stockPrice:330.95,optionType:"CE",entryPrice:330.95});
assert.strictEqual(bad.optionEligible,false);
assert.strictEqual(bad.optionDataValid,false);
assert.strictEqual(bad.entryPrice,0);

const informational=sanitizeOptionRow({
  ...trade,
  optionsDecision:"REJECT",
  decision:"REJECT",
  optionLTP:15.2,
  optionPremiumEntry:15.2,
  optionRejectionReason:"WAIT_FOR_STOCK_TRIGGER",
  pipeline:{optionsTradeGatePassed:false}
});
assert.strictEqual(informational.optionEligible,false);
assert.strictEqual(informational.optionPremiumEntry,15.2);
assert.strictEqual(informational.entryPrice,15.2);
assert.strictEqual(informational.optionRejectionReason,"WAIT_FOR_STOCK_TRIGGER");

const reasonPriority=sanitizeOptionRow({
  ...trade,
  optionsDecision:"REJECT",
  decision:"REJECT",
  reason:"OK",
  decisionReason:"WAIT_FOR_STOCK_TRIGGER",
  pipeline:{optionsTradeGatePassed:false}
});
assert.strictEqual(reasonPriority.optionRejectionReason,"WAIT_FOR_STOCK_TRIGGER","specific gate reason must not be hidden by generic reason");

const good=sanitizeOptionRow(trade);
assert.strictEqual(good.optionEntry,15.2);
assert.strictEqual(good.entryPrice,15.2);
assert.strictEqual(rankDashboard([good]).length,1,"only fully validated trade candidates should enter Top-5");
const watchRows=rankDashboard([{
  ...informational,
  qualified:true,
  finalScore:88,
  optionRejectionReason:"WAIT_FOR_STOCK_TRIGGER"
}]);
assert.strictEqual(watchRows.length,1,"strong directional WATCH candidates should fill unused Dashboard slots as context only");
assert.strictEqual(watchRows[0].dashboardContextOnly,true,"WATCH candidates must be explicitly context-only");

const dashboardEligibleRows=rankDashboard([{
  ...trade,
  qualified:false,
  dashboardEligible:true,
  optionsDecision:"REJECT",
  decision:"REJECT",
  optionContractIdentityValid:false,
  optionLiveDataAvailable:false,
  pipeline:{optionsTradeGatePassed:false}
}]);
assert.strictEqual(dashboardEligibleRows.length,0,"invalid option contracts must be excluded from the trade Dashboard");


const invalidOptionDashboard=buildDashboardPayload([{
  stock:"VMM",
  symbol:"VMM",
  direction:"BEARISH",
  stockDirection:"BEARISH",
  price:100,
  stockPrice:100,
  optionType:"PE",
  qualified:true,
  finalScore:88,
  optionContractIdentityValid:false,
  optionLiveDataAvailable:false,
  optionLiquidityConfirmed:false,
  optionEligible:false,
  optionDataValid:false,
  optionRejectionReason:"NO_VALID_OPTION_CONTRACTS",
  optionPremiumEntry:0,
  optionPremiumTarget1:0,
  optionPremiumStopLoss:0
}]);
const invalidHeaders=invalidOptionDashboard.headers;
const invalidValues=invalidOptionDashboard.rows[0];
assert.ok(invalidValues, "directional scanner candidate should remain visible as WATCH");
assert.strictEqual(invalidHeaders.length,13,"Dashboard must contain exactly the approved 13 columns");
assert.deepStrictEqual(invalidHeaders,["stock","stockPrice","optionType","strike","stockEntryPrice","stockStopLossPrice","stockTargetPrice","riskReward","confidence","oiMood","volume","newsStatus","newsHeadline"],"Dashboard headers and order must match the approved compact layout");
assert.strictEqual(invalidHeaders.includes("entryPrice"),false,"option premium entry must not be added to Dashboard");
assert.strictEqual(invalidHeaders.includes("optionsDecision"),false,"internal option decision must not be added to Dashboard");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("stock")],"NO CURRENT DIRECTIONAL CANDIDATE","invalid WATCH rows must not be displayed as trade candidates");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("strike")],"");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("stockEntryPrice")],"");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("stockStopLossPrice")],"");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("stockTargetPrice")],"");

const conflictingDirectionDashboard=buildDashboardPayload([{
  stock:"DIRECTION_CONFLICT",
  symbol:"DIRECTION_CONFLICT",
  price:145,
  currentPrice:145,
  direction:"NEUTRAL",
  stockDirection:"BULLISH",
  technicalDirection:"BULLISH",
  scannerScore:86,
  optionsDecision:"WATCH",
  optionEligible:false,
  optionDataValid:false
}]);
assert.strictEqual(conflictingDirectionDashboard.rows[0][conflictingDirectionDashboard.headers.indexOf("stock")],"NO CURRENT DIRECTIONAL CANDIDATE",
  "direction-only WATCH candidates must not be displayed as trades");

const stockLevelDashboard=buildDashboardPayload([{
  stock:"LEVEL_TEST",
  symbol:"LEVEL_TEST",
  stockPrice:330.95,
  direction:"BULLISH",
  finalScore:90,
  optionsDecision:"WATCH",
  optionEligible:false,
  optionDataValid:false,
  optionPremiumEntry:15.2,
  optionPremiumStopLoss:10.64,
  optionPremiumTarget1:22.04,
  stockEntry:331,
  stockStopLoss:320,
  stockTarget1:355,
  stockTarget2:370
}]);
const stockLevelHeaders=stockLevelDashboard.headers;
const stockLevelValues=stockLevelDashboard.rows[0];
assert.strictEqual(stockLevelValues[stockLevelHeaders.indexOf("stockTargetPrice")],"",
  "WATCH rows must not display trade targets");
assert.strictEqual(stockLevelValues[stockLevelHeaders.indexOf("stockStopLossPrice")],"",
  "WATCH rows must not display trade stop losses");


const fallbackRows=rankDashboard([
  {stock:"LOWER_SCORE",symbol:"LOWER_SCORE",direction:"BULLISH",price:100,finalScore:69,scannerScore:80,qualified:false,decision:"REJECT",optionsDecision:"REJECT",decisionReason:"WAIT_FOR_STOCK_TRIGGER",optionEligible:false,optionDataValid:false},
  {stock:"STRONG_SCORE",symbol:"STRONG_SCORE",direction:"BEARISH",price:200,finalScore:69,aiScore:92,scannerScore:65,qualified:false,decision:"REJECT",optionsDecision:"REJECT",decisionReason:"NO_VALID_OPTION_CONTRACTS",optionEligible:false,optionDataValid:false}
]);
assert.strictEqual(fallbackRows.length,2,"strong directional WATCH candidates should remain visible as context rows");
const fallbackPayload=buildDashboardPayload(fallbackRows);
assert.strictEqual(fallbackPayload.rows.length,2,"strong directional WATCH candidates should appear in Dashboard");
assert.strictEqual(fallbackPayload.rows[0][fallbackPayload.headers.indexOf("stock")],"STRONG_SCORE");
assert.strictEqual(fallbackPayload.headers.length,13,"fallback Dashboard must retain the 13-column layout");

const emptyDashboardPayload=buildDashboardPayload([]);
assert.strictEqual(emptyDashboardPayload.rows.length,1,"empty dashboard must show an explicit no-candidate status row");
assert.strictEqual(emptyDashboardPayload.rows[0][emptyDashboardPayload.headers.indexOf("stock")],"NO CURRENT DIRECTIONAL CANDIDATE");
assert.strictEqual(emptyDashboardPayload.headers.length,13);
const niftyBelowScore=buildDashboardPayload([{
  stock:"NIFTY",symbol:"NIFTY",price:22600,stockPrice:22600,
  direction:"BEARISH",stockDirection:"BEARISH",score:0,scannerScore:0,
  optionsDecision:"WATCH",optionEligible:false,optionDataValid:false,
  optionRejectionReason:"NIFTY_OPTION_GATE_NOT_PASSED"
}]);
assert.strictEqual(niftyBelowScore.rows[0][niftyBelowScore.headers.indexOf("stock")],"NIFTY",
  "NIFTY must remain visible on Dashboard when its score is low or its option gate fails");
assert.strictEqual(niftyBelowScore.rows[0][niftyBelowScore.headers.indexOf("stockPrice")],22600,
  "NIFTY dashboard row must preserve underlying index price");

const internalDashboard=buildDashboard([{
  stock:"WATCH_FALLBACK",symbol:"WATCH_FALLBACK",direction:"BULLISH",finalScore:69,scannerScore:80,qualified:false,
  optionsDecision:"REJECT",decision:"REJECT",optionContractIdentityValid:false,optionLiveDataAvailable:false,
  optionRejectionReason:"WAIT_FOR_STOCK_TRIGGER"
}],[],1);
assert.strictEqual(internalDashboard.top10.length,0,"secondary internal trade list must continue excluding WATCH candidates");


assert.strictEqual(validOptionRow({
  ...trade,
  gates:{basePassed:true},
  pipeline:{optionsTradeGatePassed:false}
}),false,"base gates alone must never promote a WATCH candidate to a trade");

const normalizedReject=sanitizeOptionRow({
  ...trade,
  optionsDecision:"REJECT",
  decision:"REJECT",
  decisionReason:"WAIT_FOR_STOCK_TRIGGER",
  pipeline:{optionsTradeGatePassed:false}
});
assert.strictEqual(normalizedReject.optionsDecision,"WATCH","scanner output should only expose TRADE or WATCH candidates");
assert.strictEqual(normalizedReject.decision,"WATCH");
assert.strictEqual(normalizedReject.optionRejectionReason,"WAIT_FOR_STOCK_TRIGGER");

const premiumFallback=sanitizeOptionRow({
  ...trade,
  optionsDecision:"WATCH",
  decision:"WATCH",
  optionLTP:0,
  optionPremiumEntry:15.2,
  pipeline:{optionsTradeGatePassed:false}
});
assert.strictEqual(premiumFallback.optionPremiumEntry,15.2,"a zero alias must not erase the valid option premium");
assert.strictEqual(premiumFallback.entryPrice,15.2);

const strongestScore=rankOptionCandidates([
  {stock:"LOWER_AI",symbol:"LOWER_AI",scannerScore:80,aiScore:70},
  {stock:"HIGHER_AI",symbol:"HIGHER_AI",scannerScore:55,aiScore:90}
],1);
assert.strictEqual(strongestScore[0].symbol,"HIGHER_AI","option ranking must use the strongest available AI/scanner score");


// Dashboard selection regression: four strong directional WATCH rows plus
// compulsory NIFTY must occupy the compact five-row Dashboard without
// exposing any WATCH entry/SL/target as a trade.
const watchCandidates=["LAURUSLABS","GRASIM","RELIANCE","POWERGRID"].map((symbol,i)=>({
  stock:symbol,symbol,price:100+i,currentPrice:100+i,stockPrice:100+i,
  direction:"BULLISH",stockDirection:"BULLISH",technicalDirection:"BULLISH",
  qualified:true,scannerScore:90-i,score:90-i,finalScore:90-i,confidence:80,
  optionType:"CE",optionsDecision:"WATCH",decision:"WATCH",
  optionContractIdentityValid:false,optionLiveDataAvailable:false,
  optionLiquidityConfirmed:false,optionEligible:false,optionDataValid:false,
  optionPremiumEntry:0,stockEntry:100+i,stockStopLoss:95+i,stockTarget1:110+i,stockTarget2:115+i,
  stockRiskReward:2,oiConflict:false
}));
const rankedWatch=rankDashboard(watchCandidates);
assert.strictEqual(rankedWatch.length,4,"four directional WATCH candidates should be available alongside NIFTY");
assert.ok(rankedWatch.every(r=>r.dashboardContextOnly===true),"all non-TRADE dashboard candidates must be context-only");
const endToEndDashboard=buildDashboardPayload([...rankedWatch,{
  stock:"NIFTY",symbol:"NIFTY",price:24000,stockPrice:24000,direction:"BULLISH",
  optionsDecision:"WATCH",decision:"WATCH",score:0,scannerScore:0
}]);
assert.strictEqual(endToEndDashboard.rows.length,5,"context-only rows from rankDashboard must survive the Sheets selector");
assert.strictEqual(endToEndDashboard.rows[4][endToEndDashboard.headers.indexOf("stock")],"NIFTY","NIFTY must remain last and compulsory");
assert.ok(endToEndDashboard.rows.slice(0,4).every(row=>
  row[endToEndDashboard.headers.indexOf("optionType")]===""&&
  row[endToEndDashboard.headers.indexOf("strike")]===""&&
  row[endToEndDashboard.headers.indexOf("stockEntryPrice")]===""&&
  row[endToEndDashboard.headers.indexOf("stockStopLossPrice")]===""&&
  row[endToEndDashboard.headers.indexOf("stockTargetPrice")]===""
),"WATCH context rows must not expose trade levels");
const mixedDashboard=buildDashboardPayload([...watchCandidates,{
  stock:"NIFTY",symbol:"NIFTY",price:24000,stockPrice:24000,direction:"BULLISH",
  optionsDecision:"WATCH",decision:"WATCH",score:0,scannerScore:0
}]);
assert.strictEqual(mixedDashboard.rows.length,5,"Dashboard should contain four strongest stocks plus NIFTY");
assert.deepStrictEqual(mixedDashboard.headers,["stock","stockPrice","optionType","strike","stockEntryPrice","stockStopLossPrice","stockTargetPrice","riskReward","confidence","oiMood","volume","newsStatus","newsHeadline"]);
for(const row of mixedDashboard.rows.slice(0,4)){
  assert.strictEqual(row[mixedDashboard.headers.indexOf("optionType")],"","WATCH option side must not be shown as a trade");
  assert.strictEqual(row[mixedDashboard.headers.indexOf("strike")],"","WATCH strike must remain blank");
  assert.strictEqual(row[mixedDashboard.headers.indexOf("stockEntryPrice")],"","WATCH entry must remain blank");
  assert.strictEqual(row[mixedDashboard.headers.indexOf("stockStopLossPrice")],"","WATCH stop must remain blank");
  assert.strictEqual(row[mixedDashboard.headers.indexOf("stockTargetPrice")],"","WATCH target must remain blank");
}
assert.strictEqual(mixedDashboard.rows[4][mixedDashboard.headers.indexOf("stock")],"NIFTY","NIFTY must remain compulsory");

console.log("V14 pipeline tests passed");
