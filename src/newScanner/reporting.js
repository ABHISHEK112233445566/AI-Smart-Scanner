"use strict";

const axios=require("axios");
const {DASHBOARD_HEADERS,SHEETS,LIMITS}=require("./schema");

function clean(value) {
  if(value===null||value===undefined)return "";
  if(typeof value==="number"&&!Number.isFinite(value))return "";
  if(typeof value==="object")return JSON.stringify(value);
  return value;
}
function scannerRow(r) {
  const a=r.directionalAnalysis||{},o=r.optionContract||{},p=r.optionPremiumSetup||{},q=r.quote||{},s=r.underlyingLevels||{},oi=r.oi||{},news=r.news||{};
  return {
    stock:r.symbol,stockPrice:q.ltp,previousClose:q.previousClose,netChange:q.netChange,changePercent:q.previousClose&&q.ltp?(q.ltp-q.previousClose)/q.previousClose*100:null,
    volume:q.volume,oiMood:oi.mood,oiSentiment:oi.sentiment,oiChangePercent:oi.changePercent,oiPriceChangePercent:oi.priceChangePercent,
    direction:a.direction,confidence:r.confidence, bullScore:a.bullScore,bearScore:a.bearScore,chartPattern:a.chartPattern,patternDirection:a.patternDirection,patternStatus:a.patternStatus,marketStructureBreak:a.structure?.structureBreak,cpr:a.structure?.cpr,pivotLevels:a.structure?.levels,indicators:a.indicators,
    dailyStatus:r.candles?.daily?.status,fourHourStatus:r.candles?.fourHour?.status,oneHourStatus:r.candles?.oneHour?.status,fifteenMinuteStatus:r.candles?.fifteenMinute?.status,fiveMinuteStatus:r.candles?.fiveMinute?.status,
    stockEntryPrice:s.entry,stockStopLossPrice:s.stopLoss,stockTargetPrice:s.target,riskReward:s.riskReward,
    optionType:o.side,strike:o.strike,optionExpiry:o.expiry,optionSymbol:o.tradingSymbol,optionInstrumentKey:o.instrumentKey,optionLTP:r.optionQuote?.ltp,
    optionEntry:p.entry,optionStopLoss:p.stopLoss,optionTarget:p.target,optionRiskReward:p.riskReward,optionLevelSource:p.levelSource,optionCandlesUsed:p.candlesUsed,
    optionVolume:r.optionQuote?.volume,optionOI:r.optionQuote?.oi,optionLiquidityConfirmed:r.optionLiquidityConfirmed,
    newsStatus:news.status,newsDirection:news.direction,newsHeadline:news.headline,newsSource:news.source,newsUrl:news.url,
    decision:r.decision,rejectionReasons:(r.riskValidation?.reasons||[]).join("|"),dataStatus:r.dataStatus,dataReason:r.dataReason,
    timeframeAnalysis:r.timeframeAnalysis,indicatorEvidence:a,quoteTimestamp:q.timestamp,scanTimestamp:r.scanTimestamp
  };
}
function dashboardRow(r) {
  const q=r.quote||{},s=r.underlyingLevels||{},o=r.optionContract||{},n=r.news||{};
  const row={stock:r.symbol,stockPrice:q.ltp,optionType:o.side,strike:o.strike,stockEntryPrice:s.entry,stockStopLossPrice:s.stopLoss,stockTargetPrice:s.target,riskReward:s.riskReward,confidence:r.confidence,oiMood:r.oi?.mood,volume:q.volume,newsStatus:n.status,newsHeadline:n.headline};
  return DASHBOARD_HEADERS.map(h=>clean(row[h]));
}
async function postSheet(sheet,headers,rows,url,client=axios) {
  if(!url)throw new Error("GOOGLE_SHEET_WEBHOOK_URL_MISSING");
  const response=await client.post(url,{action:"replaceSheet",sheet,clearFirst:true,headers,rows,timestamp:new Date().toISOString()},{timeout:120000,headers:{"Content-Type":"application/json"}});
  let body=response.data;
  if(typeof body==="string")body=JSON.parse(body);
  if(response.status<200||response.status>=300||body?.success!==true)throw new Error("SHEET_WRITE_NOT_CONFIRMED:"+JSON.stringify(body).slice(0,250));
  return{sheet,rowCount:rows.length,columnCount:headers.length,success:true};
}
async function publishResults(result,{url=process.env.GOOGLE_SHEET_WEBHOOK_URL,client=axios}={}) {
  const scanRows=result.scannerRows.slice(0,LIMITS.SCANNER_ROWS).map(scannerRow);
  const equityRows=result.equityRows.map(scannerRow);
  const dashboard=result.dashboardRows.slice(0,LIMITS.DASHBOARD_ROWS);
  const scannerHeaders=[...new Set(scanRows.flatMap(Object.keys))];
  const equityHeaders=[...new Set(equityRows.flatMap(Object.keys))];
  const dashboardRows=dashboard.map(dashboardRow);
  const status=result.status;
  const statusHeaders=["status","lastScanTime","universeSize","stocksScanned","successfulQuotes","failedQuotes","scannerRows","dashboardRows","tradeCount","watchCount","rejected","errors"];
  const statusRow=[status.status,status.lastScanTime,status.universeSize,status.stocksScanned,status.successfulQuotes,status.failedQuotes,scanRows.length,dashboardRows.length,status.tradeCount,status.watchCount,status.rejected,(status.errors||[]).join(" | ")];
  const writes=[];
  if(scanRows.length)writes.push(postSheet(SHEETS.SCANNER,scannerHeaders,scanRows.map(r=>scannerHeaders.map(h=>clean(r[h]))),url,client));
  if(equityRows.length)writes.push(postSheet(SHEETS.EQUITY,equityHeaders,equityRows.map(r=>equityHeaders.map(h=>clean(r[h]))),url,client));
  writes.push(postSheet(SHEETS.DASHBOARD,DASHBOARD_HEADERS,dashboardRows,url,client));
  writes.push(postSheet(SHEETS.STATUS,statusHeaders,[statusRow],url,client));
  return Promise.all(writes);
}
module.exports={publishResults,scannerRow,dashboardRow,postSheet};
