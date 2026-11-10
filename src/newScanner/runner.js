"use strict";

const {setBroker,getActiveBroker,loadInstruments}=require("../brokers");
const {fetchNifty500,buildFnoUniverse,buildUniverse,buildFnoMovers}=require("./universe");
const {mapLimit,fetchSnapshots,fetchCandles}=require("./marketData");
const {calculateTechnicalEvidence,combineTimeframes,deriveUnderlyingLevels}=require("./analysis");
const {fetchNews,fetchUnderlyingOI}=require("./context");
const {analyzeOption}=require("./options");
const {validateCandidate}=require("./risk");
const {rankCandidates,dashboardRows}=require("./ranking");
const {publishResults}=require("./reporting");
const {LIMITS}=require("./schema");

function marketIsOpen(now=new Date()) {
  const p=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now).reduce((o,x)=>(o[x.type]=x.value,o),{});
  const minute=Number(p.hour)*60+Number(p.minute);
  return ["Mon","Tue","Wed","Thu","Fri"].includes(p.weekday)&&minute>=555&&minute<930;
}
function currentIstDate(now=new Date()) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
async function runNewScanner({brokerName=process.env.BROKER||"UPSTOX",writeSheets=true}={}) {
  const started=Date.now(),errors=[];
  const status={status:"RUNNING",lastScanTime:new Date().toISOString(),errors:[]};
  await setBroker(brokerName);
  const broker=getActiveBroker();
  if(!broker)throw new Error("NEW_SCANNER_BROKER_NOT_CONFIGURED");
  const [nifty500,instruments]=await Promise.all([fetchNifty500(),loadInstruments()]);
  const fnoStocks=buildFnoUniverse(instruments);
  const universe=buildUniverse(nifty500,fnoStocks);
  const quoteResults=await fetchSnapshots(universe.combined,broker,instruments,{batchSize:LIMITS.QUOTE_BATCH_SIZE});
  const quoted=quoteResults.filter(r=>r&&!r.error);
  const successfulQuotes=quoted.filter(r=>r.quote?.valid);
  const failedQuotes=quoted.filter(r=>!r.quote?.valid);
  const fnoMovers=buildFnoMovers(successfulQuotes,Number(process.env.NEW_SCANNER_FNO_MOVERS_LIMIT||100),Number(process.env.NEW_SCANNER_MIN_MOVER_VOLUME||0));
  const analysisMap=new Map();
  for(const row of successfulQuotes.filter(r=>r.inNifty500))analysisMap.set(row.symbol,row);
  for(const row of fnoMovers)analysisMap.set(row.symbol,row);
  const snapshots=[...analysisMap.values()];
  const enriched=await mapLimit(snapshots,8,async stock=>{
    const withCandles=await fetchCandles(stock,broker);
    const analyses={};
    for(const frame of ["daily","fourHour","oneHour","fifteenMinute","fiveMinute"]) {
      const item=withCandles.candles[frame];
      analyses[frame]=item?.status==="VALID"?calculateTechnicalEvidence(item.candles):{direction:"UNKNOWN",dataStatus:item?.status||"MISSING"};
    }
    const timeframeAnalysis=combineTimeframes(analyses);
    const directionalAnalysis=analyses.daily;
    const underlyingLevels=deriveUnderlyingLevels(directionalAnalysis);
    const [news,oi]=await Promise.all([fetchNews(stock.symbol),fetchUnderlyingOI(stock,broker)]);
    const timestamp=stock.quote.timestamp?new Date(stock.quote.timestamp).getTime():NaN;
    const base={...withCandles,marketDataFresh:marketIsOpen()&&Number.isFinite(timestamp)&&Date.now()-timestamp<=LIMITS.MAX_QUOTE_AGE_MS,timeframeAnalysis,directionalAnalysis,underlyingLevels,news,oi,scanTimestamp:new Date().toISOString()};
    const option=await analyzeOption(base,broker);
    const riskValidation=validateCandidate({...option,oi,news});
    const decision=riskValidation.passed?"TRADE":(directionalAnalysis.direction==="BULLISH"||directionalAnalysis.direction==="BEARISH"?"WATCH":"REJECT");
    return{...option,riskValidation,decision,confidence:Math.max(directionalAnalysis.bullScore||0,directionalAnalysis.bearScore||0)};
  });
  const equityRows=enriched.filter(r=>r.inNifty500);
  const moverSymbols=new Set(fnoMovers.map(r=>r.symbol));\n  const optionPool=enriched.filter(r=>r.fnoEligible&&(r.inNifty500||moverSymbols.has(r.symbol)));
  const ranked=rankCandidates(optionPool);
  const dashboard=dashboardRows(ranked);
  Object.assign(status,{
    status:"SUCCESS",universeSize:universe.combined.length,nifty500Size:universe.nifty500.length,fnoUniverseSize:universe.fnoStocks.length,fnoMoversSelected:fnoMovers.length,stocksScanned:snapshots.length,
    successfulQuotes:successfulQuotes.length,failedQuotes:failedQuotes.length,
    tradeCount:ranked.filter(r=>r.decision==="TRADE").length,
    watchCount:ranked.filter(r=>r.decision==="WATCH").length,
    rejected:enriched.length-ranked.length,errors,elapsedMs:Date.now()-started,
    lastScanTime:new Date().toISOString(),marketOpen:marketIsOpen(),istDate:currentIstDate()
  });
  const result={scannerRows:ranked,dashboardRows:dashboard,equityRows,status};
  if(writeSheets)result.sheetWrites=await publishResults(result);
  console.log("NEW SCANNER RESULT "+JSON.stringify({universe:status.universeSize,quotes:status.successfulQuotes,failed:status.failedQuotes,scanner:ranked.length,dashboard:dashboard.length,trade:status.tradeCount,watch:status.watchCount,elapsedMs:status.elapsedMs}));
  return result;
}
if(require.main===module)runNewScanner().catch(error=>{console.error("NEW SCANNER FATAL:",error?.stack||error);process.exitCode=1;});
module.exports={runNewScanner,marketIsOpen,currentIstDate};
