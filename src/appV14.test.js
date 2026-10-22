const assert=require("assert");
const {validOptionRow,sanitizeOptionRow,rankDashboard}=require("./appV14");
const {buildDashboardPayload}=require("./googleSheetCore");

const trade={
  stockPrice:330.95,
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

const good=sanitizeOptionRow(trade);
assert.strictEqual(good.optionEntry,15.2);
assert.strictEqual(good.entryPrice,15.2);
assert.strictEqual(rankDashboard([good]).length,1);
const watchRows=rankDashboard([{
  ...informational,
  qualified:true,
  finalScore:88,
  optionRejectionReason:"WAIT_FOR_STOCK_TRIGGER"
}]);
assert.strictEqual(watchRows.length,1);
assert.strictEqual(watchRows[0].decision,"WATCH");
assert.strictEqual(watchRows[0].optionPremiumEntry,15.2);
assert.strictEqual(watchRows[0].optionLiveDataAvailable,true);

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
assert.strictEqual(dashboardEligibleRows.length,1);
assert.strictEqual(dashboardEligibleRows[0].decision,"WATCH");


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

console.log("V14 pipeline tests passed");
