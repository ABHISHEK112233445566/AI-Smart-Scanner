const assert=require("node:assert/strict");
const {buildDashboardPayload}=require("./googleSheetCore");
const headers=["stock","stockPrice","optionType","strike","stockEntryPrice","stockStopLossPrice","stockTargetPrice","riskReward","confidence","oiMood","volume","newsStatus","newsHeadline"];
function rowFor(payload,symbol){const index=payload.headers.indexOf("stock");return payload.rows.map(values=>Object.fromEntries(payload.headers.map((h,i)=>[h,values[i]]))).find(row=>String(row.stock).toUpperCase()===symbol);}
const watch=buildDashboardPayload([{
 stock:"HEROMOTOCO",symbol:"HEROMOTOCO",price:5513,direction:"BULLISH",stockDirection:"BULLISH",
 optionsDecision:"WATCH",dashboardContextOnly:true,scannerScore:88,technicalConfidence:82,
 stockEntry:5513,stockStopLoss:5400,stockTarget1:5740,stockRiskReward:2,
 oiMood:"UNKNOWN",volume:742377
}]);
const watchRow=rowFor(watch,"HEROMOTOCO");
assert.ok(watchRow,"WATCH stock should remain visible");
assert.equal(watchRow.stockEntryPrice,5513);
assert.equal(watchRow.stockStopLossPrice,5400);
assert.equal(watchRow.stockTargetPrice,5740);
assert.equal(watchRow.riskReward,2);
assert.equal(watchRow.confidence,82);
assert.equal(watchRow.optionType,"");
assert.equal(watchRow.strike,"");
const nifty=buildDashboardPayload([{
 stock:"NIFTY",symbol:"NIFTY",price:25030.35,direction:"BULLISH",stockDirection:"BULLISH",
 optionsDecision:"WATCH",dashboardContextOnly:true,confidence:76,
 stockEntry:25030.35,stockStopLoss:24900,stockTarget1:25300,stockRiskReward:2.07,
 oiMood:"BOTH SIDES BUILDING"
}]);
const niftyRow=rowFor(nifty,"NIFTY");
assert.ok(niftyRow,"NIFTY must remain on Dashboard");
assert.equal(niftyRow.stockEntryPrice,25030.35);
assert.equal(niftyRow.stockStopLossPrice,24900);
assert.equal(niftyRow.stockTargetPrice,25300);
assert.equal(niftyRow.optionType,"");
assert.equal(niftyRow.strike,"");
console.log("Dashboard WATCH/NIFTY stock-level regression tests passed.");
