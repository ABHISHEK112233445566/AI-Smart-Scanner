require("dotenv").config();
const {setBroker,getActiveBroker,loadInstruments}=require("./brokers");
const {loadSymbolMaster}=require("./services/symbolService");
const {scanStocks}=require("./scanner");
const {calculateOptionsDecisions}=require("./optionsDecisionEngine");
const {updateGoogleSheet,buildScannerStatus}=require("./googleSheet");
const {updateStrategySheets}=require("./strategySheets");
const {buildDashboard}=require("./dashboard");
const {createAccuracyRecord}=require("./accuracyTracker");
const {getNifty500AndBankNiftyUniverse}=require("./marketUniverse");
const {getTop20ByLiveVolume}=require("./liveMarket");

const DASHBOARD_MIN_SCORE=85;
const DASHBOARD_MIN_CONFIDENCE=85;
const ONE_TRADE_LIMIT=1;
const STOCK_BATCH_SIZE=10;
const TOP_LIVE_STOCKS=20;
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const key=r=>String(r?.stock??r?.symbol??r?.name??"").trim().toUpperCase();
const decision=r=>String(r?.optionsDecision??r?.decision??"").trim().toUpperCase();
const score=r=>num(r?.rankingScore??r?.finalScore??r?.aiFinalScore??r?.scannerScore??r?.score);
const confidence=r=>num(r?.optionsConfidence??r?.confidence);

async function scanInBatches(symbols){
  const all=[];
  for(let i=0;i<symbols.length;i+=STOCK_BATCH_SIZE){
    const batch=symbols.slice(i,i+STOCK_BATCH_SIZE);
    console.log(`STOCK BATCH ${i+1}-${Math.min(i+STOCK_BATCH_SIZE,symbols.length)}`);
    try{
      const result=await scanStocks(batch);
      const rows=Array.isArray(result?.allResults)?result.allResults:(Array.isArray(result)?result:[]);
      all.push(...rows);
    }catch(e){
      console.error(`Batch failed: ${e?.message||e}`);
      for(const s of batch) all.push({stock:s,symbol:s,qualified:false,rejectionReason:"BATCH_ERROR"});
    }
  }
  const map=new Map();
  for(const r of all) map.set(key(r),r);
  const unique=[...map.values()];
  return {allResults:unique,qualified:unique.filter(r=>r?.qualified===true),rejected:unique.filter(r=>r?.qualified===false)};
}

function merge(stocks,decisions){
  const m=new Map((Array.isArray(decisions)?decisions:[]).map(r=>[key(r),r]));
  return stocks.map(s=>m.has(key(s))?{...s,...m.get(key(s))}:s);
}

function chooseOne(decisions){
  return (Array.isArray(decisions)?decisions:[])
    .filter(r=>decision(r)==="TRADE"&&score(r)>=DASHBOARD_MIN_SCORE&&confidence(r)>=DASHBOARD_MIN_CONFIDENCE)
    .sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a))||(num(b.riskReward)-num(a.riskReward)))
    .slice(0,ONE_TRADE_LIMIT);
}

async function main(){
  const started=new Date();
  console.log("\n=== AI SMART SCANNER V9 ===");
  const brokerName=String(process.env.BROKER||"UPSTOX").trim().toUpperCase();
  setBroker(brokerName);
  const broker=getActiveBroker();
  await broker.login();
  try{await loadInstruments()}catch(e){console.log(`Instrument load warning: ${e?.message||e}`)}
  try{await loadSymbolMaster()}catch(e){console.log(`Symbol master warning: ${e?.message||e}`)}

  // SOURCE UNIVERSE: current NIFTY 500 + every current BANK NIFTY constituent.
  const universe=await getNifty500AndBankNiftyUniverse();
  console.log(`Universe source: ${universe.name} | NIFTY500=${universe.nifty500.length} | BANKNIFTY=${universe.bankNifty.length} | merged=${universe.symbols.length}`);

  // HARD GATE: fetch live volume first and only the top 20 proceed to the expensive scanner.
  const liveRanking=await getTop20ByLiveVolume(universe.symbols,broker,TOP_LIVE_STOCKS);
  const top20=liveRanking.top.map(x=>x.symbol);
  console.log(`LIVE TOP 20: ${top20.join(", ")}`);
  if(top20.length===0) throw new Error("No live Top-20 stocks available");

  const liveMetaBySymbol=new Map(liveRanking.top.map(x=>[String(x.symbol).toUpperCase(),x]));
  const scan=await scanInBatches(top20);
  const enriched=scan.allResults.map(r=>({...r,...(liveMetaBySymbol.get(key(r))||{})}));
  console.log(`Scanned=${enriched.length} | Qualified=${enriched.filter(r=>r?.qualified===true).length} | Rejected=${enriched.filter(r=>r?.qualified===false).length}`);

  // Scanner already performs live option volume/OI confirmation. Only qualified rows reach the option engine.
  const optionInput=enriched.filter(r=>r?.qualified===true).slice(0,TOP_LIVE_STOCKS);
  let decisions=[];
  try{decisions=await calculateOptionsDecisions(optionInput)}catch(e){console.error(`Options engine failed: ${e?.message||e}`)}

  decisions.sort((a,b)=>(decision(b)==="TRADE")-(decision(a)==="TRADE")||(confidence(b)-confidence(a))||(score(b)-score(a)));
  const finalTrade=chooseOne(decisions);
  console.log(`Option candidates=${decisions.length} | FINAL TRADE SLOT=${finalTrade.length}`);
  if(finalTrade.length) console.log(`ONE ACTIVE TRADE: ${finalTrade[0].stock} ${finalTrade[0].optionType} ${finalTrade[0].recommendedStrike} | score=${score(finalTrade[0])} confidence=${confidence(finalTrade[0])}`);
  else console.log("NO TRADE — no candidate passed every hard gate");

  const scannerData=merge(enriched,decisions);
  const accuracyData=scannerData.filter(key).map(r=>createAccuracyRecord(r,new Date()));
  let core=false,strategy=false;
  try{await updateGoogleSheet({scannerData,dashboardData:finalTrade,accuracyData});core=true}catch(e){console.error(`Sheet update failed: ${e?.message||e}`)}
  try{await updateStrategySheets(scannerData,decisions);strategy=true}catch(e){console.error(`Strategy sheet update failed: ${e?.message||e}`)}
  try{await buildDashboard(enriched,decisions,universe.symbols.length)}catch(e){console.error(`Dashboard update failed: ${e?.message||e}`)}

  const counts={
    call:decisions.filter(r=>String(r.optionType).toUpperCase()==="CALL").length,
    put:decisions.filter(r=>String(r.optionType).toUpperCase()==="PUT").length,
    trade:decisions.filter(r=>decision(r)==="TRADE").length,
    watch:decisions.filter(r=>decision(r)==="WATCH").length,
    reject:decisions.filter(r=>decision(r)==="REJECT").length
  };
  const elapsed=((Date.now()-started.getTime())/1000).toFixed(1);
  const status=buildScannerStatus({
    status:core&&strategy?"SUCCESS":"PARTIAL_FAILURE",startedAt:started,
    universe:universe.name,broker:brokerName,scanned:enriched.length,
    successfulScans:enriched.filter(r=>!String(r.rejectionReason||"").includes("ERROR")).length,
    failedScans:enriched.filter(r=>String(r.rejectionReason||"").includes("ERROR")).length,
    callCandidates:counts.call,putCandidates:counts.put,tradeCount:counts.trade,
    watchCount:counts.watch,rejectCount:counts.reject,elapsedSeconds:elapsed
  });
  try{await updateGoogleSheet({action:"scanner_status",scannerStatus:status,scannerData,dashboardData:finalTrade,accuracyData})}catch(e){console.error(`Status update failed: ${e?.message||e}`)}
  return{universe,top20,scannerData,completeScannerData:enriched,optionDecisions:decisions,finalTop5:finalTrade,scannerStatus:status};
}

if(require.main===module)main().catch(e=>{console.error(`FATAL: ${e?.stack||e}`);process.exitCode=1});
module.exports={main,scanInBatches,chooseOne};
