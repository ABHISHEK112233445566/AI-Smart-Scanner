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

const trade={
  stockPrice:330.95,
  stockEntry:330.95,
  stockStopLoss:320,
  stockTarget1:350,
  stockTarget2:360,
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
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContract:"KEY_B",optionLiquidityContractData:{instrument_key:"KEY_A",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"liquidity contract key must match selected option instrument");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContractData:{instrument_key:"KEY_B",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"embedded contract key must match selected option instrument");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContractData:{instrument_key:"KEY_B",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"mismatched embedded option instrument key must be rejected");
assert.strictEqual(validOptionRow({...trade,optionPremiumStopLoss:0,optionPremiumTarget1:0,optionPremiumTarget2:0,optionPremiumRiskReward:0}),true,"verified underlying stock SL/targets must validate a trade without synthetic option premium targets");

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
assert.strictEqual(watchRows.length,1,"directional WATCH candidates should remain visible when no validated trade exists");
assert.strictEqual(watchRows[0].optionsDecision,"WATCH");
assert.strictEqual(watchRows[0].optionEligible,false);

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
assert.strictEqual(dashboardEligibleRows.length,1,"invalid option contracts may appear as WATCH, never as TRADE");
assert.strictEqual(dashboardEligibleRows[0].optionsDecision,"WATCH");
assert.strictEqual(dashboardEligibleRows[0].optionEligible,false);


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
assert.strictEqual(invalidHeaders.includes("entryPrice"),false,"option premium entry must not be added to Dashboard");
assert.strictEqual(invalidHeaders.includes("optionsDecision"),false,"internal option decision must not be added to Dashboard");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("stock")],"VMM");
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
assert.strictEqual(conflictingDirectionDashboard.rows[0][conflictingDirectionDashboard.headers.indexOf("stock")],"DIRECTION_CONFLICT",
  "a stale NEUTRAL direction must not hide a valid bullish stock direction");

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
assert.strictEqual(stockLevelValues[stockLevelHeaders.indexOf("stockTargetPrice")],355,
  "Dashboard target must be the underlying stock target, not option premium target");
assert.strictEqual(stockLevelValues[stockLevelHeaders.indexOf("stockStopLossPrice")],320,
  "Dashboard stop loss must be the underlying stock stop, not option premium stop");


const fallbackRows=rankDashboard([
  {stock:"LOWER_SCORE",symbol:"LOWER_SCORE",direction:"BULLISH",price:100,finalScore:69,scannerScore:80,qualified:false,decision:"REJECT",optionsDecision:"REJECT",decisionReason:"WAIT_FOR_STOCK_TRIGGER",optionEligible:false,optionDataValid:false},
  {stock:"STRONG_SCORE",symbol:"STRONG_SCORE",direction:"BEARISH",price:200,finalScore:69,aiScore:92,scannerScore:65,qualified:false,decision:"REJECT",optionsDecision:"REJECT",decisionReason:"NO_VALID_OPTION_CONTRACTS",optionEligible:false,optionDataValid:false}
]);
assert.strictEqual(fallbackRows.length,2,"directional candidates with valid prices should remain visible as WATCH rows");
assert.ok(fallbackRows.every(r=>r.optionsDecision==="WATCH"&&r.optionEligible===false),"fallback rows must never become executable trades");
const fallbackPayload=buildDashboardPayload(fallbackRows);
assert.strictEqual(fallbackPayload.rows.length,2,"Dashboard should show ranked directional WATCH candidates");
assert.strictEqual(fallbackPayload.rows[0][fallbackPayload.headers.indexOf("stock")],"STRONG_SCORE","highest-score candidate should rank first");
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
assert.strictEqual(internalDashboard.top10.length,0,"internal Top-5 trade list must exclude WATCH candidates");


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

console.log("V14 pipeline tests passed");
