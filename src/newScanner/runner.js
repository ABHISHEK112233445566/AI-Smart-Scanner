"use strict";

const {setBroker,getActiveBroker,loadInstruments}=require("../brokers");
const {fetchNifty500,buildFnoUniverse,buildUniverse,buildFnoMovers,findNiftyIndex}=require("./universe");
const {mapLimit,fetchSnapshots,fetchCandles}=require("./marketData");
const {calculateTechnicalEvidence,combineTimeframes,deriveUnderlyingLevels}=require("./analysis");
const {fetchNews,fetchUnderlyingOI}=require("./context");
const {analyzeOption}=require("./options");
const {validateCandidate}=require("./risk");
const {rankCandidates,dashboardRows,candidateScore}=require("./ranking");
const {publishResults}=require("./reporting");
const {LIMITS}=require("./schema");

function marketIsOpen(now=new Date()) {
  const p=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now).reduce((o,x)=>(o[x.type]=x.value,o),{});
  const minute=Number(p.hour)*60+Number(p.minute);
  return ["Mon","Tue","Wed","Thu","Fri"].includes(p.weekday)&&minute>=555&&minute<930;
}
function tradeWindowOpen(now=new Date()) {
  const p=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now).reduce((o,x)=>(o[x.type]=x.value,o),{});
  const minute=Number(p.hour)*60+Number(p.minute);
  return ["Mon","Tue","Wed","Thu","Fri"].includes(p.weekday)&&minute>=600&&minute<885;
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

  // Stage 1: build the two independent source universes and fetch live quotes.
  const [nifty500,instruments]=await Promise.all([fetchNifty500(),loadInstruments()]);
  const fnoStocks=buildFnoUniverse(instruments);
  const niftyIndex=findNiftyIndex(instruments);
  const universe=buildUniverse(nifty500,fnoStocks,niftyIndex);
  const quoteResults=await fetchSnapshots(universe.combined,broker,instruments,{batchSize:LIMITS.QUOTE_BATCH_SIZE});
  const successfulQuotes=quoteResults.filter(r=>r.quote?.valid);
  const failedQuotes=quoteResults.filter(r=>!r.quote?.valid);
  console.log("NEW SCANNER QUOTE STAGE "+JSON.stringify({
    universeRows:universe.combined.length,masterRows:instruments.length,
    instrumentKeysFound:quoteResults.filter(r=>r.instrumentKey).length,
    successfulQuotes:successfulQuotes.length,failedQuotes:failedQuotes.length,
    failureReasons:[...new Set(failedQuotes.map(r=>r.dataReason||r.error||"UNKNOWN"))].slice(0,20)
  }));
  const fnoMovers=buildFnoMovers(successfulQuotes,Number(process.env.NEW_SCANNER_FNO_MOVERS_LIMIT||100),Number(process.env.NEW_SCANNER_MIN_MOVER_VOLUME||0));
  const analysisMap=new Map();
  for(const row of successfulQuotes.filter(r=>r.inNifty500||r.isNiftyIndex))analysisMap.set(row.symbol,row);
  for(const row of fnoMovers)analysisMap.set(row.symbol,row);
  const snapshots=[...analysisMap.values()];

  // Stage 2: all NIFTY 500 + selected F&O movers receive daily technical analysis.
  const dailyRows=await mapLimit(snapshots,8,async stock=>{
    const data=await fetchCandles(stock,broker,[{key:"daily",interval:"ONE_DAY"}]);
    const daily=data.candles?.daily;
    const analysis=daily?.status==="VALID"?calculateTechnicalEvidence(daily.candles,{currentPrice:stock.quote?.ltp,currentVolume:stock.quote?.volume}):{direction:"UNKNOWN",dataStatus:daily?.status||"MISSING"};
    return {...data,directionalAnalysis:analysis,timeframeAnalysis:{direction:"NOT_ANALYSED",unknownTimeframes:4},scanTimestamp:new Date().toISOString()};
  });

  // Stage 3: deeper MTF, option-chain, premium-candle, OI and news checks only
  // for the highest-quality directional F&O shortlist. Other NIFTY 500 rows
  // remain visible in EQUITY with an explicit deep-analysis status.
  const moverSymbols=new Set(fnoMovers.map(r=>r.symbol));
  const fnoCandidates=dailyRows.filter(r=>r.fnoEligible&&(r.inNifty500||r.isNiftyIndex||moverSymbols.has(r.symbol))&&
    r.directionalAnalysis?.dataStatus==="VALID"&&["BULLISH","BEARISH"].includes(r.directionalAnalysis.direction));
  fnoCandidates.sort((a,b)=>Math.max(b.directionalAnalysis.bullScore||0,b.directionalAnalysis.bearScore||0)-Math.max(a.directionalAnalysis.bullScore||0,a.directionalAnalysis.bearScore||0));
  const deepLimit=Math.max(20,Math.min(100,Number(process.env.NEW_SCANNER_DEEP_ANALYSIS_LIMIT||60)));
  const deepCandidates=fnoCandidates.slice(0,deepLimit);
  const deepRows=await mapLimit(deepCandidates,6,async stock=>{
    const deep=await fetchCandles(stock,broker,[
      {key:"fourHour",interval:"FOUR_HOUR"},
      {key:"oneHour",interval:"ONE_HOUR"},
      {key:"fifteenMinute",interval:"FIFTEEN_MINUTE"},
      {key:"fiveMinute",interval:"FIVE_MINUTE"}
    ]);
    const analyses={daily:stock.directionalAnalysis};
    for(const frame of ["fourHour","oneHour","fifteenMinute","fiveMinute"]){
      const item=deep.candles?.[frame];
      analyses[frame]=item?.status==="VALID"?calculateTechnicalEvidence(item.candles,{currentPrice:stock.quote?.ltp}):{direction:"UNKNOWN",dataStatus:item?.status||"MISSING"};
    }
    const timeframeAnalysis=combineTimeframes(analyses);
    const underlyingLevels=deriveUnderlyingLevels(stock.directionalAnalysis,stock.quote?.ltp);
    const [news,oi]=await Promise.all([fetchNews(stock.symbol),fetchUnderlyingOI(stock,broker)]);
    const timestamp=stock.quote.timestamp;
    const marketDataFresh=marketIsOpen()&&Number.isFinite(timestamp)&&Date.now()-timestamp<=LIMITS.MAX_QUOTE_AGE_MS;
    const base={...stock,candles:{...stock.candles,...deep.candles},timeframeAnalysis,underlyingLevels,news,oi,marketDataFresh,tradeWindowOpen:tradeWindowOpen(),scanTimestamp:new Date().toISOString()};
    const option=await analyzeOption(base,broker);
    const riskValidation=validateCandidate({...option,oi,news});
    const optionSetupValid=option.optionContract?.valid===true&&option.optionPremiumSetup?.valid===true&&Number(option.optionQuote?.ltp)>0;
    const decision=!optionSetupValid?"REJECT":riskValidation.passed?"TRADE":"WATCH";
    return {...option,riskValidation,decision,confidence:Math.max(stock.directionalAnalysis.bullScore||0,stock.directionalAnalysis.bearScore||0)};
  });

  const deepBySymbol=new Map(deepRows.map(r=>[r.symbol,r]));
  const equityRows=dailyRows.filter(r=>r.inNifty500).map(r=>deepBySymbol.get(r.symbol)||{
    ...r,decision:"WATCH",confidence:Math.max(r.directionalAnalysis?.bullScore||0,r.directionalAnalysis?.bearScore||0),
    deepAnalysisStatus:"NOT_SELECTED_FOR_DEEP_ANALYSIS"
  });
  const ranked=rankCandidates(deepRows);
  const dashboard=dashboardRows(ranked);
  Object.assign(status,{
    status:successfulQuotes.length&&equityRows.length?"SUCCESS":"NO_DATA",universeSize:universe.combined.length,nifty500Size:universe.nifty500.length,
    fnoUniverseSize:universe.fnoStocks.length,fnoMoversSelected:fnoMovers.length,niftyIndexIncluded:Boolean(niftyIndex),
    dailyAnalysisCount:dailyRows.length,deepAnalysisCount:deepRows.length,deepAnalysisLimit:deepLimit,
    stocksScanned:snapshots.length,successfulQuotes:successfulQuotes.length,failedQuotes:failedQuotes.length,
    tradeCount:ranked.filter(r=>r.decision==="TRADE").length,
    watchCount:ranked.filter(r=>r.decision==="WATCH").length,
    rejected:deepRows.length-ranked.length,errors,elapsedMs:Date.now()-started,
    lastScanTime:new Date().toISOString(),marketOpen:marketIsOpen(),tradeWindowOpen:tradeWindowOpen(),istDate:currentIstDate(),
    errors:successfulQuotes.length&&equityRows.length?errors:[...errors,"NO_VALID_EQUITY_ROWS_FROM_UPSTREAM_QUOTES"]
  });
  const result={scannerRows:ranked,dashboardRows:dashboard,equityRows,status};
  if(writeSheets)result.sheetWrites=await publishResults(result);
  console.log("NEW SCANNER RESULT "+JSON.stringify({
    nifty500:status.nifty500Size,fnoUniverse:status.fnoUniverseSize,fnoMovers:status.fnoMoversSelected,
    dailyAnalysed:status.dailyAnalysisCount,deepAnalysed:status.deepAnalysisCount,
    quotes:status.successfulQuotes,failed:status.failedQuotes,scanner:ranked.length,
    dashboard:dashboard.length,trade:status.tradeCount,watch:status.watchCount,elapsedMs:status.elapsedMs
  }));
  return result;
}
if(require.main===module)runNewScanner().catch(error=>{console.error("NEW SCANNER FATAL:",error?.stack||error);process.exitCode=1;});
module.exports={runNewScanner,marketIsOpen,tradeWindowOpen,currentIstDate};
