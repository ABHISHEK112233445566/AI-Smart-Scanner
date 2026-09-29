require("dotenv").config();
const {setBroker,getActiveBroker,loadInstruments}=require("./brokers");
const {loadSymbolMaster}=require("./services/symbolService");
const {scanStocks}=require("./scanner");
const {calculateOptionsDecisions}=require("./optionsDecisionEngine");
const {updateGoogleSheet,buildScannerStatus}=require("./googleSheet");
const {updateStrategySheets}=require("./strategySheets");
const {buildDashboard}=require("./dashboard");
const {evaluateLiveAccuracy}=require("./liveAccuracyEvaluator");
const {getWholeNseUniverse}=require("./marketUniverse");
const {getTop500ByLiveVolume,filterOptionEligibleStocks}=require("./liveMarket");
const {getUnderlyingOIMood}=require("./underlyingOI");
const {DIVIDEND_LONG_TERM_SYMBOLS}=require("./dividendUniverse");

const STOCK_BATCH_SIZE=Math.max(10,Number(process.env.STOCK_BATCH_SIZE||25));
const TOP_500=500;
const TOP_100=100;
const TOP_20=20;
const TOP_5=5;
const TOP_EQUITY=50;
const ONE_TRADE_LIMIT=1;

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const key=r=>String(r?.stock??r?.symbol??r?.name??"").trim().toUpperCase();
const score=r=>Math.abs(num(r?.scannerScore??r?.score));
const confidence=r=>num(r?.optionsConfidence??r?.confidence);
const decision=r=>String(r?.optionsDecision??r?.decision??"").trim().toUpperCase();

async function scanInBatches(symbols){
  const all=[];
  const source=[...new Set((symbols||[]).map(s=>String(s||"").trim().toUpperCase()).filter(Boolean))];
  for(let i=0;i<source.length;i+=STOCK_BATCH_SIZE){
    const batch=source.slice(i,i+STOCK_BATCH_SIZE);
    console.log(`STOCK BATCH ${i+1}-${Math.min(i+STOCK_BATCH_SIZE,source.length)} / ${source.length}`);
    try{
      const result=await scanStocks(batch);
      const rows=Array.isArray(result?.allResults)?result.allResults:(Array.isArray(result)?result:[]);
      all.push(...rows);
    }catch(e){
      console.error(`Batch failed: ${e?.message||e}`);
      for(const s of batch)all.push({stock:s,symbol:s,qualified:false,rejectionReason:"BATCH_ERROR"});
    }
  }
  const map=new Map();
  for(const r of all)map.set(key(r),r);
  const unique=[...map.values()];
  return{allResults:unique,qualified:unique.filter(r=>r?.qualified===true),rejected:unique.filter(r=>r?.qualified===false)};
}

async function enrichUnderlyingOI(rows=[]){
  const source=Array.isArray(rows)?rows:[];
  const concurrency=Math.max(4,Number(process.env.OI_ENRICH_CONCURRENCY||8));
  const out=[];
  for(let i=0;i<source.length;i+=concurrency){
    const batch=source.slice(i,i+concurrency);
    const checked=await Promise.all(batch.map(async r=>{
      try{
        const oi=await getUnderlyingOIMood({instrumentKey:r.instrumentKey,currentPrice:num(r.currentPrice??r.price),previousPrice:num(r.previousPrice??r.prevPrice??r.previousClose)});
        return{...r,oiCheckAttempted:true,oiMood:oi.mood||"UNKNOWN",oiSentiment:oi.sentiment||"UNKNOWN",oiDataAvailable:oi.dataAvailable===true,oiPriceChangePercent:num(oi.priceChangePercent),oiChangePercent:num(oi.oiChangePercent),oi:num(oi.oi),previousOI:num(oi.previousOI),underlyingOISource:oi.source||"",underlyingOIReason:oi.reason||""};
      }catch(e){
        return{...r,oiCheckAttempted:true,oiMood:"UNKNOWN",oiSentiment:"UNKNOWN",oiDataAvailable:false,oiPriceChangePercent:0,oiChangePercent:0,underlyingOIReason:`ENRICHMENT_FAILED:${e?.message||e}`};
      }
    }));
    out.push(...checked);
  }
  return out;
}

function mergeBySymbol(base,extra){
  const map=new Map((Array.isArray(extra)?extra:[]).map(r=>[key(r),r]));
  return(Array.isArray(base)?base:[]).map(r=>map.has(key(r))?{...r,...map.get(key(r))}:r);
}

function rankTop(rows,limit){
  return[...(Array.isArray(rows)?rows:[])].sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a))||(num(b.riskReward)-num(a.riskReward))).slice(0,limit);
}

function validOptionRow(r){
  const strike=num(r?.bestStrike??r?.optionStrike??r?.recommendedStrike);
  const ltp=num(r?.optionPremiumEntry??r?.optionLTP??r?.optionLtp);
  const instrument=String(r?.optionInstrumentKey??r?.optionInstrument??r?.optionKey??"").trim();
  const side=String(r?.optionType??"").trim().toUpperCase();
  return strike>0&&ltp>0&&Boolean(instrument)&&["CALL","PUT","CE","PE"].includes(side);
}

function sanitizeOptionRow(r){
  if(!validOptionRow(r))return{...r,optionEligible:false,optionDataValid:false,optionRejectionReason:"MISSING_LIVE_OPTION_CONTRACT_OR_LTP"};
  const ltp=num(r?.optionPremiumEntry??r?.optionLTP??r?.optionLtp);
  return{...r,optionEligible:true,optionDataValid:true,optionEntry:ltp,optionPremiumEntry:ltp,entryPrice:ltp,stockEntry:num(r?.stockEntry??r?.underlyingEntry??r?.price)};
}

function rankDashboard(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(validOptionRow).map(sanitizeOptionRow);
  return list.sort((a,b)=>(confidence(b)-confidence(a))||(score(b)-score(a))||(num(b.riskReward)-num(a.riskReward))).slice(0,TOP_5);
}

async function main(){
  const started=new Date();
  console.log("\n=== AI SMART SCANNER V14 | SEPARATE FAST OPTIONS PIPELINE ===");
  const brokerName=String(process.env.BROKER||"UPSTOX").trim().toUpperCase();
  setBroker(brokerName);
  const broker=getActiveBroker();
  await broker.login();
  try{await loadInstruments()}catch(e){console.log(`Instrument load warning: ${e?.message||e}`)}
  try{await loadSymbolMaster()}catch(e){console.log(`Symbol master warning: ${e?.message||e}`)}

  const universe=await getWholeNseUniverse(broker);
  console.log(`WHOLE NSE: ${universe.symbols.length}`);

  // ---------------- EQUITY PIPELINE ----------------
  const top500Ranking=await getTop500ByLiveVolume(universe.symbols,broker,TOP_500);
  const top500=Array.isArray(top500Ranking?.top)?top500Ranking.top:[];
  if(!top500.length)throw new Error("Live Top 500 ranking returned no stocks");

  const equitySymbols=top500.slice(0,TOP_EQUITY).map(x=>x.symbol).filter(Boolean);
  const equityScan=await scanInBatches(equitySymbols);
  const equityTop20=rankTop(equityScan.allResults,TOP_20);
  const dividendSymbols=DIVIDEND_LONG_TERM_SYMBOLS.filter(s=>!equitySymbols.includes(s));
  const dividendScan=await scanInBatches(dividendSymbols);
  const dividendRows=[...dividendScan.allResults];
  console.log(`EQUITY PIPELINE: Top-500 live → Top-50 scan → Top-20 output | rows=${equityTop20.length}`);

  // ---------------- OPTIONS PIPELINE ----------------
  // Whole NSE → live Top 500 → Top 100 option-eligible → scan Top 100 → rank Top 20 → option engine → Top 5 dashboard.
  const optionEligible=await filterOptionEligibleStocks(top500,broker,TOP_100);
  if(!optionEligible.length)throw new Error(`No live-tradable option candidates found in Top 500 (top500=${top500.length})`);
  const top100=optionEligible.slice(0,TOP_100);
  console.log(`OPTION PIPELINE: Whole NSE=${universe.symbols.length} → Top-500=${top500.length} → Top-100=${top100.length}`);

  const optionSymbols=top100.map(x=>x.symbol).filter(Boolean);
  const optionScan=await scanInBatches(optionSymbols);
  const optionScanned=mergeBySymbol(optionScan.allResults,top100);
  const optionTop20=rankTop(optionScanned,TOP_20);
  console.log(`OPTION PIPELINE: scanned=${optionScanned.length} → Top-20 scanner=${optionTop20.length}`);

  const oiRows=await enrichUnderlyingOI(optionTop20);
  let decisions=[];
  try{decisions=await calculateOptionsDecisions(oiRows)}catch(e){console.error(`Options engine failed: ${e?.message||e}`)}
  const decisionRows=mergeBySymbol(oiRows,decisions).map(sanitizeOptionRow);

  // The SCANNER sheet receives exactly the Top-20 options pipeline rows.
  // Dashboard receives exactly the best 5 rows from those 20 with real option data.
  const dashboardRows=rankDashboard(decisionRows);
  const finalTrade=dashboardRows.filter(r=>decision(r)==="TRADE").slice(0,ONE_TRADE_LIMIT);

  console.log(`SCANNER: option Top-20=${decisionRows.length}`);
  console.log(`DASHBOARD: option Top-5=${dashboardRows.length}`);
  console.log(`FINAL TRADE: ${finalTrade.length}`);

  // Keep the existing sheet contracts. Options are passed separately from equity so they cannot contaminate equity calculations.
  let core=false,strategy=false;
  try{
    await updateGoogleSheet({scannerData:decisionRows,dashboardData:dashboardRows,accuracyData:[]});
    core=true;
  }catch(e){console.error(`Sheet update failed: ${e?.message||e}`)}

  try{
    await updateStrategySheets(
      equityTop20,
      decisions,
      equityTop20,
      DIVIDEND_LONG_TERM_SYMBOLS.map(s=>dividendRows.find(r=>key(r)===String(s).toUpperCase())||{stock:s,symbol:s,rejectionReason:"NOT_SCANNED"})
    );
    strategy=true;
  }catch(e){console.error(`Strategy sheet update failed: ${e?.message||e}`)}

  try{await buildDashboard(dashboardRows,decisions,universe.symbols.length)}catch(e){console.error(`Dashboard update failed: ${e?.message||e}`)}
  try{
    const liveAccuracy=await evaluateLiveAccuracy(broker);
    console.log(`LIVE ACCURACY: found=${liveAccuracy.found} evaluated=${liveAccuracy.evaluated} updated=${liveAccuracy.updated} skipped=${liveAccuracy.skipped}`);
  }catch(e){console.error(`Live Accuracy refresh failed: ${e?.message||e}`)}

  const elapsed=((Date.now()-started.getTime())/1000).toFixed(1);
  const counts={call:dashboardRows.filter(r=>["CALL","CE"].includes(String(r.optionType).toUpperCase())).length,put:dashboardRows.filter(r=>["PUT","PE"].includes(String(r.optionType).toUpperCase())).length,trade:decisions.filter(r=>decision(r)==="TRADE").length,watch:decisions.filter(r=>decision(r)==="WATCH").length,reject:decisions.filter(r=>decision(r)==="REJECT").length};
  const status=buildScannerStatus({status:core&&strategy?"SUCCESS":"PARTIAL_FAILURE",startedAt:started,universe:universe.name,broker:brokerName,scanned:decisionRows.length,successfulScans:decisionRows.filter(r=>!String(r.rejectionReason||"").includes("ERROR")).length,failedScans:decisionRows.filter(r=>String(r.rejectionReason||"").includes("ERROR")).length,callCandidates:counts.call,putCandidates:counts.put,tradeCount:counts.trade,watchCount:counts.watch,rejectCount:counts.reject,elapsedSeconds:elapsed});
  try{await updateGoogleSheet({action:"scanner_status",scannerStatus:status})}catch(e){console.error(`Status update failed: ${e?.message||e}`)}

  console.log(`✅ V14 COMPLETE in ${elapsed}s | Whole NSE=${universe.symbols.length} | Top500=${top500.length} | Top100=${top100.length} | ScannerTop20=${decisionRows.length} | DashboardTop5=${dashboardRows.length}`);
  return{universe,top500,top100OptionRows:top100,optionScanned,optionTop20,optionDecisions:decisions,scannerData:decisionRows,finalDashboard:dashboardRows,finalTrade,equityTop20,dividendRows,scannerStatus:status};
}

if(require.main===module)main().catch(e=>{console.error(`FATAL: ${e?.stack||e}`);process.exitCode=1});
module.exports={main,scanInBatches,rankTop,rankDashboard,validOptionRow,sanitizeOptionRow};
