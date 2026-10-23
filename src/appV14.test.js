const assert=require("assert");
const {validOptionRow,sanitizeOptionRow,rankDashboard}=require("./appV14");
const {buildDashboardPayload}=require("./googleSheetCore");
const {buildDashboard}=require("./dashboard");

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
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContract:"KEY_B",optionLiquidityContractData:{instrument_key:"KEY_A",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"liquidity contract key must match selected option instrument");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContractData:{instrument_key:"KEY_B",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"embedded contract key must match selected option instrument");
assert.strictEqual(validOptionRow({...trade,optionInstrumentKey:"KEY_A",optionLiquidityContractData:{instrument_key:"KEY_B",instrument_type:"CE",trading_symbol:"TEST CE"}}),false,"mismatched embedded option instrument key must be rejected");
assert.strictEqual(validOptionRow({...trade,optionPremiumTarget1:0}),false);

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
assert.strictEqual(watchRows.length,0,"WATCH rows must not be presented as Top-5 trades");

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
assert.strictEqual(dashboardEligibleRows.length,0,"invalid option contracts must not be ranked as Top-5 trades");


const invalidOptionDashboard=buildDashboardPayload([{
  stock:"VMM",
  symbol:"VMM",
  direction:"BEARISH",
  stockDirection:"BEARISH",
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
assert.strictEqual(invalidValues[invalidHeaders.indexOf("entryPrice")],0);
assert.strictEqual(invalidValues[invalidHeaders.indexOf("bestStrike")],0);
assert.strictEqual(invalidValues[invalidHeaders.indexOf("optionLTP")],0);
assert.strictEqual(invalidValues[invalidHeaders.indexOf("optionsDecision")],"WATCH");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("optionEligible")],false);
assert.strictEqual(invalidValues[invalidHeaders.indexOf("optionRejectionReason")],"NO_VALID_OPTION_CONTRACTS");
assert.strictEqual(invalidValues[invalidHeaders.indexOf("optionContractIdentityValid")],false);
assert.strictEqual(invalidValues[invalidHeaders.indexOf("optionLiveDataAvailable")],false);

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
assert.strictEqual(stockLevelValues[stockLevelHeaders.indexOf("target")],355,
  "Dashboard target must be the underlying stock target, not option premium target");
assert.strictEqual(stockLevelValues[stockLevelHeaders.indexOf("stopLoss")],320,
  "Dashboard stop loss must be the underlying stock stop, not option premium stop");


const fallbackRows=rankDashboard([
  {stock:"LOWER_SCORE",symbol:"LOWER_SCORE",direction:"BULLISH",finalScore:69,scannerScore:80,qualified:false,decision:"REJECT",optionsDecision:"REJECT",decisionReason:"WAIT_FOR_STOCK_TRIGGER",optionEligible:false,optionDataValid:false},
  {stock:"STRONG_SCORE",symbol:"STRONG_SCORE",direction:"BEARISH",finalScore:88,qualified:false,decision:"REJECT",optionsDecision:"REJECT",decisionReason:"NO_VALID_OPTION_CONTRACTS",optionEligible:false,optionDataValid:false}
]);
assert.strictEqual(fallbackRows.length,0,"WATCH/REJECT candidates must not be presented as Top-5 trades");
const fallbackPayload=buildDashboardPayload(fallbackRows);
assert.strictEqual(fallbackPayload.rows.length,1,"an empty Top-5 should show the explicit no-candidate status row");
assert.strictEqual(fallbackPayload.rows[0][fallbackPayload.headers.indexOf("optionsDecision")],"WATCH");

const emptyDashboardPayload=buildDashboardPayload([]);
assert.strictEqual(emptyDashboardPayload.rows.length,1,"empty dashboard must show an explicit no-candidate status row");
assert.strictEqual(emptyDashboardPayload.rows[0][emptyDashboardPayload.headers.indexOf("symbol")],"NO CURRENT DIRECTIONAL CANDIDATE");
assert.strictEqual(emptyDashboardPayload.rows[0][emptyDashboardPayload.headers.indexOf("optionsDecision")],"WATCH");

const internalDashboard=buildDashboard([{
  stock:"WATCH_FALLBACK",symbol:"WATCH_FALLBACK",direction:"BULLISH",finalScore:69,scannerScore:80,qualified:false,
  optionsDecision:"REJECT",decision:"REJECT",optionContractIdentityValid:false,optionLiveDataAvailable:false,
  optionRejectionReason:"WAIT_FOR_STOCK_TRIGGER"
}],[],1);
assert.strictEqual(internalDashboard.top10.length,0,"internal Top-5 trade list must exclude WATCH candidates");

console.log("V14 pipeline tests passed");
