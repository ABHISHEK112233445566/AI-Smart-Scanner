"use strict";

const axios=require("axios");
const {DASHBOARD_HEADERS,SHEETS,LIMITS}=require("./schema");

const SCANNER_HEADERS=Object.freeze([
  "stock","stockPrice","previousClose","netChange","changePercent","volume",
  "oiMood","oiSentiment","oiChangePercent","oiPriceChangePercent",
  "direction","confidence","bullScore","bearScore","chartPattern","patternDirection","patternStatus",
  "marketStructureBreak","cpr","pivotLevels","indicators",
  "dailyStatus","fourHourStatus","oneHourStatus","fifteenMinuteStatus","fiveMinuteStatus",
  "stockEntryPrice","stockStopLossPrice","stockTargetPrice","riskReward",
  "optionType","strike","optionExpiry","optionSymbol","optionInstrumentKey","optionLTP",
  "optionEntry","optionStopLoss","optionTarget","optionRiskReward","optionLevelSource","optionCandlesUsed",
  "optionVolume","optionOI","optionLiquidityConfirmed",
  "newsStatus","newsDirection","newsHeadline","newsSource","newsUrl",
  "decision","rejectionReasons","dataStatus","dataReason","timeframeAnalysis","indicatorEvidence",
  "quoteTimestamp","scanTimestamp"
]);

function clean(value) {
  if(value===null||value===undefined)return "";
  if(typeof value==="number"&&!Number.isFinite(value))return "";
  if(typeof value==="object")return JSON.stringify(value);
  return value;
}
function scannerRow(r) {
  const a=r.directionalAnalysis||{},o=r.optionContract||{},p=r.optionPremiumSetup||{},q=r.quote||{},s=r.underlyingLevels||{},oi=r.oi||{},news=r.news||{};
  return {
    stock:r.symbol,stockPrice:q.ltp,previousClose:q.previousClose,netChange:q.netChange,changePercent:q.changePercent,
    volume:q.volume,oiMood:oi.mood,oiSentiment:oi.sentiment,oiChangePercent:oi.changePercent,oiPriceChangePercent:oi.priceChangePercent,
    direction:a.direction,confidence:r.confidence,bullScore:a.bullScore,bearScore:a.bearScore,chartPattern:a.chartPattern,patternDirection:a.patternDirection,patternStatus:a.patternStatus,marketStructureBreak:a.structure?.structureBreak,cpr:a.structure?.cpr,pivotLevels:a.structure?.levels,indicators:a.indicators,
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
async function parseSuccess(response,action) {
  let body=response.data;
  if(typeof body==="string") { try { body=JSON.parse(body); } catch (_) { throw new Error("SHEET_RESPONSE_NOT_JSON:"+body.slice(0,200)); } }
  if(response.status<200||response.status>=300||body?.success!==true)throw new Error("SHEET_WRITE_NOT_CONFIRMED:"+action+":"+JSON.stringify(body).slice(0,300));
  return body;
}
async function postSheet(sheet,headers,rows,url,client=axios) {
  if(!url)throw new Error("GOOGLE_SHEET_WEBHOOK_URL_MISSING");
  const response=await client.post(url,{action:"replaceSheet",sheet,clearFirst:true,headers,rows,timestamp:new Date().toISOString()},{timeout:120000,headers:{"Content-Type":"application/json"}});
  const body=await parseSuccess(response,"replaceSheet");
  return{sheet,rowCount:body.rowCount??rows.length,columnCount:body.columnCount??headers.length,success:true};
}
async function postStatus(status,url,client=axios) {
  if(!url)throw new Error("GOOGLE_SHEET_WEBHOOK_URL_MISSING");
  const ist=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"medium"}).format(new Date());
  const scannerStatus={
    status:status.status,lastScanTime:status.lastScanTime,lastScanTimeIST:ist,lastScanSource:"NEW_SCANNER",
    broker:process.env.BROKER||"UPSTOX",universe:"NIFTY_500 + FNO_MOVERS",
    stocksScanned:status.stocksScanned,successfulScans:status.successfulQuotes,failedScans:status.failedQuotes,
    callCandidates:status.callCandidates||0,putCandidates:status.putCandidates||0,
    tradeCount:status.tradeCount,watchCount:status.watchCount,rejectCount:status.rejected,
    elapsedSeconds:Math.round((status.elapsedMs||0)/1000),durationMs:status.elapsedMs
  };
  const response=await client.post(url,{action:"scanner_status",scannerStatus},{timeout:120000,headers:{"Content-Type":"application/json"}});
  const body=await parseSuccess(response,"scanner_status");
  return{sheet:SHEETS.STATUS,rowCount:body.rowCount??1,success:true};
}
async function publishResults(result,{url=process.env.GOOGLE_SHEET_WEBHOOK_URL,client=axios}={}) {
  if(!url)throw new Error("GOOGLE_SHEET_WEBHOOK_URL_MISSING");
  const scanRows=result.scannerRows.slice(0,LIMITS.SCANNER_ROWS).map(scannerRow);
  const equityRows=result.equityRows.map(scannerRow);
  const dashboardRows=result.dashboardRows.slice(0,LIMITS.DASHBOARD_ROWS).map(dashboardRow);
  // Always replace all three data tabs, including with zero rows. This prevents
  // yesterday's/old-scanner signals surviving when today's new scan is empty.
  const writes=[];
  writes.push(await postSheet(SHEETS.SCANNER,SCANNER_HEADERS,scanRows.map(r=>SCANNER_HEADERS.map(h=>clean(r[h]))),url,client));
  writes.push(await postSheet(SHEETS.EQUITY,SCANNER_HEADERS,equityRows.map(r=>SCANNER_HEADERS.map(h=>clean(r[h]))),url,client));
  writes.push(await postSheet(SHEETS.DASHBOARD,DASHBOARD_HEADERS,dashboardRows,url,client));
  writes.push(await postStatus(result.status,url,client));
  return writes;
}
module.exports={publishResults,scannerRow,dashboardRow,postSheet,postStatus,SCANNER_HEADERS};
