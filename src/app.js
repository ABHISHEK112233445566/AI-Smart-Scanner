require("dotenv").config();
const {setBroker,getActiveBroker,loadInstruments}=require("./brokers");
const {loadSymbolMaster}=require("./services/symbolService");
const {scanStocks}=require("./scanner");
const {calculateOptionsDecisions}=require("./optionsDecisionEngine");
const {updateGoogleSheet,buildScannerStatus}=require("./googleSheet");
const {updateStrategySheets}=require("./strategySheets");
const {buildDashboard}=require("./dashboard");
const {createAccuracyRecord,evaluateAccuracy}=require("./accuracyTracker");
const {evaluateLiveAccuracy}=require("./liveAccuracyEvaluator");
const {getWholeNseUniverse}=require("./marketUniverse");
const {getTop500ByLiveVolume,getTop20ByLiveVolume,getTop100OptionStocks,filterOptionEligibleStocks}=require("./liveMarket");
const {getUnderlyingOIMood}=require("./underlyingOI");
const ONE_TRADE_LIMIT=1,STOCK_BATCH_SIZE=25,TOP_SCANNER_STOCKS=20,DASHBOARD_MIN_SCORE=80,DASHBOARD_FALLBACK_ROWS=5;

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const key=r=>String(r?.stock??r?.symbol??r?.name??"").trim().toUpperCase();
const decision=r=>String(r?.optionsDecision??r?.decision??"").trim().toUpperCase();
// Dashboard/quality ranking is based on the scanner's actual score. Use magnitude
// so strong bearish setups (for example -80) are treated the same as +80.
const score=r=>Math.abs(num(r?.scannerScore??r?.score));
const confidence=r=>num(r?.optionsConfidence??r?.confidence);
const hasOptionContract=r=>Boolean(r?.optionInstrumentKey||r?.optionSymbol||r?.recommendedStrike||r?.optionType);
const optionLtpValid=r=>num(r?.optionPremiumEntry)>0;
async function scanInBatches(symbols){const all=[];for(let i=0;i<symbols.length;i+=STOCK_BATCH_SIZE){const batch=symbols.slice(i,i+STOCK_BATCH_SIZE);console.log(`STOCK BATCH ${i+1}-${Math.min(i+STOCK_BATCH_SIZE,symbols.length)}`);try{const result=await scanStocks(batch);const rows=Array.isArray(result?.allResults)?result.allResults:(Array.isArray(result)?result:[]);all.push(...rows);}catch(e){console.error(`Batch failed: ${e?.message||e}`);for(const s of batch)all.push({stock:s,symbol:s,qualified:false,rejectionReason:"BATCH_ERROR"});}}const map=new Map();for(const r of all)map.set(key(r),r);const unique=[...map.values()];return{allResults:unique,qualified:unique.filter(r=>r?.qualified===true),rejected:unique.filter(r=>r?.qualified===false)};}
async function enrichUnderlyingOI(rows=[]){return Promise.all((Array.isArray(rows)?rows:[]).map(async r=>{try{const oi=await getUnderlyingOIMood({instrumentKey:r.instrumentKey,currentPrice:num(r.currentPrice??r.price),previousPrice:num(r.previousPrice??r.prevPrice??r.previousClose)});return{...r,oiCheckAttempted:true,oiMood:oi.mood||"UNKNOWN",oiSentiment:oi.sentiment||"UNKNOWN",oiDataAvailable:oi.dataAvailable===true,oiPriceChangePercent:num(oi.priceChangePercent),oiChangePercent:num(oi.oiChangePercent),oi:num(oi.oi),previousOI:num(oi.previousOI),underlyingOISource:oi.source||"",underlyingOIReason:oi.reason||""};}catch(e){return{...r,oiCheckAttempted:true,oiMood:"UNKNOWN",oiSentiment:"UNKNOWN",oiDataAvailable:false,oiPriceChangePercent:0,oiChangePercent:0,underlyingOIReason:`ENRICHMENT_FAILED:${e?.message||e}`};}}));}
function merge(stocks,decisions){const m=new Map((Array.isArray(decisions)?decisions:[]).map(r=>[key(r),r]));return stocks.map(s=>m.has(key(s))?{...s,...m.get(key(s))}:s);}
function chooseOne(decisions){return(Array.isArray(decisions)?decisions:[]).filter(r=>decision(r)==="TRADE").sort((a,b)=>(confidence(b)-confidence(a))||(score(b)-score(a))||(num(b.riskReward)-num(a.riskReward))).slice(0,ONE_TRADE_LIMIT);}
function rankOptionReady(rows){return[...(Array.isArray(rows)?rows:[])].filter(r=>r?.qualified===true&&['TRADE','WATCH'].includes(decision(r))&&hasOptionContract(r)&&optionLtpValid(r)).sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a))).slice(0,TOP_SCANNER_STOCKS);}
// Dashboard rule:
// 1) Include ALL directional stocks with |scannerScore| >= 80.
// 2) If fewer than 5 qualify, fill the dashboard with the highest-ranked
//    directional stocks until there are 5 (when available).
// 3) A bearish score such as -80/-90 is valid and must not be discarded.
// Trading eligibility remains controlled separately by the options engine.
function selectDashboardCandidates(rows){
  const directions=["BULLISH","BEARISH","LONG","SHORT","BUY","SELL","CALL","PUT","CE","PE"];
  const list=[...(Array.isArray(rows)?rows:[])].filter(r=>r?.qualified===true).filter(Boolean).map(r=>{
    const explicit=String(r?.direction??r?.finalDirection??"").trim().toUpperCase();
    let d=explicit;
    if(!directions.includes(d)){
      const call=num(r?.callScore),put=num(r?.putScore);
      if(call>put)d="BULLISH";
      else if(put>call)d="BEARISH";
    }
    return{...r,dashboardDirection:d};
  }).filter(r=>directions.includes(r.dashboardDirection));
  const ranked=list.sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a)));
  const above80=ranked.filter(r=>score(r)>=DASHBOARD_MIN_SCORE);
  if(above80.length>=DASHBOARD_FALLBACK_ROWS)return above80;
  return ranked.slice(0,DASHBOARD_FALLBACK_ROWS);
}
async function evaluateDashboardAccuracy(rows=[],broker){const evaluated=[];for(const row of Array.isArray(rows)?rows:[]){const record=createAccuracyRecord(row,new Date());try{const symbol=row?.instrumentKey||row?.symbol||row?.stock;if(!symbol)throw new Error("Missing instrument/symbol");const candles=await broker.getHistoricalData(symbol,"FIVE_MINUTE");evaluateAccuracy(record,candles,new Date());}catch(e){record.evaluationStatus=`LIVE_DATA_FAILED:${e?.message||e}`;record.targetSLReached="PENDING";record.evaluationDate=new Date().toISOString();console.error(`Accuracy live-data failed for ${key(row)}: ${e?.message||e}`);}evaluated.push({...row,...record});}return evaluated;}
async function main(){const started=new Date();console.log("\n=== AI SMART SCANNER V13 ===");const brokerName=String(process.env.BROKER||"UPSTOX").trim().toUpperCase();setBroker(brokerName);const broker=getActiveBroker();await broker.login();try{await loadInstruments()}catch(e){console.log(`Instrument load warning: ${e?.message||e}`)}try{await loadSymbolMaster()}catch(e){console.log(`Symbol master warning: ${e?.message||e}`)}const universe=await getWholeNseUniverse(broker);console.log(`Universe source: ${universe.name} | WHOLE_NSE=${universe.symbols.length} | optionEligible=${universe.optionEligibleCount}`);const top500Ranking=await getTop500ByLiveVolume(universe.symbols,broker,500),top500=Array.isArray(top500Ranking?.top)?top500Ranking.top:[];if(!top500.length)throw new Error("Live Top 500 ranking returned no stocks");

// SEPARATE EQUITY PATH:
// EQUITY is independent of option eligibility/liquidity. It uses the live NSE
// ranking directly so an equity candidate cannot disappear merely because its
// options are illiquid or unavailable.
const equityTop20Ranking=await getTop20ByLiveVolume(universe.symbols,broker,TOP_SCANNER_STOCKS);
const equityScanUniverse=(equityTop20Ranking?.top||[]).map(x=>x.symbol).filter(Boolean);
if(!equityScanUniverse.length)throw new Error("Live Equity Top-20 ranking returned no stocks");
console.log(`EQUITY PIPELINE: live Top-20=${equityScanUniverse.length}`);
const equityScan=await scanInBatches(equityScanUniverse);
const equityScannerData=equityScan.allResults;

// SEPARATE OPTION PATH:
// Options are derived dynamically from the CURRENT broker instrument master.
// 1) WHOLE_NSE is built from the complete Upstox NSE instrument master.
// 2) Top-500 is ranked by live underlying volume.
// 3) Top-100 is the intersection of those Top-500 stocks with current NSE_FO
//    equity-option underlyings, ranked by the same live underlying liquidity.
// 4) Only those 100 are preflighted for live option liquidity.
// 5) The first 20 valid option candidates become the option scanner input.
//
// IMPORTANT: No hard-coded 100-stock option list is used here.
const top100OptionRows=getTop100OptionStocks(
  top500,
  universe.optionEligibleSymbols,
  100
);
if(!top100OptionRows.length){
  throw new Error(
    `No current F&O option-eligible stocks found inside live Top 500 (top500=${top500.length}, optionEligible=${universe.optionEligibleCount})`
  );
}
console.log(
  `OPTION UNIVERSE: WHOLE_NSE=${universe.symbols.length} | Top-500=${top500.length} | current F&O eligible in Top-500=${top100OptionRows.length}`
);

const optionPreflight=await filterOptionEligibleStocks(
  top100OptionRows,
  broker,
  TOP_SCANNER_STOCKS
);
if(!optionPreflight.length){
  throw new Error(
    `No live-tradable option candidates found after option preflight (Top-500=${top500.length}, F&O Top-100=${top100OptionRows.length})`
  );
}

const top20=optionPreflight.slice(0,TOP_SCANNER_STOCKS);
const optionScanUniverse=top20.map(x=>x.symbol).filter(Boolean);
console.log(
  `OPTION PIPELINE: WHOLE_NSE=${universe.symbols.length} | Top-500=${top500.length} | F&O Top-100=${top100OptionRows.length} | preflight-valid=${optionPreflight.length} | Top-20=${optionScanUniverse.length}`
);

const optionUniverseScan=await scanInBatches(optionScanUniverse);
const optionUniverseRows=optionUniverseScan.allResults;

const optionLiveMetaBySymbol=new Map(
  top100OptionRows.map(x=>[String(x.symbol).toUpperCase(),x])
);

const optionRowsWithLiveMeta=optionUniverseRows.map(r=>{
  const pre=optionPreflight.find(x=>key(x)===key(r));
  const live=optionLiveMetaBySymbol.get(key(r))||{};
  return pre
    ? {...r,...live,...pre,optionEligible:r.qualified===true&&r.volumeConfirmed5===true}
    : r;
});

const enriched=await enrichUnderlyingOI(optionRowsWithLiveMeta);
let decisions=[];try{decisions=await calculateOptionsDecisions(enriched)}catch(e){console.error(`Options engine failed: ${e?.message||e}`)}const merged=merge(enriched,decisions).map(r=>({...r,optionEligible:r.qualified===true&&['TRADE','WATCH'].includes(decision(r))&&hasOptionContract(r)&&optionLtpValid(r)})),optionReady=rankOptionReady(merged),dashboardRows=selectDashboardCandidates(merged),finalTrade=chooseOne(optionReady);console.log(`OPTION INTERNAL SCAN: ${enriched.length} preflight-valid Top-20 rows`);console.log(`OPTION OI: attempted=${enriched.filter(r=>r?.oiCheckAttempted===true).length} available=${enriched.filter(r=>r?.oiDataAvailable===true).length} unknown=${enriched.filter(r=>r?.oiCheckAttempted===true&&r?.oiDataAvailable!==true).length}`);console.log(`DASHBOARD SELECTION: ${dashboardRows.length} rows | >=${DASHBOARD_MIN_SCORE} magnitude: ${dashboardRows.filter(r=>score(r)>=DASHBOARD_MIN_SCORE).length}`);const scannerData=merged.map(r=>{const setupEntry=num(r.stockEntry??r.entry);const finalOptionEligible=r.qualified===true&&r.volumeConfirmed5===true&&['TRADE','WATCH'].includes(decision(r))&&hasOptionContract(r)&&optionLtpValid(r);return{...r,optionEligible:finalOptionEligible,entry:setupEntry,stockEntry:setupEntry,underlyingEntry:setupEntry,marketEntry:setupEntry,triggerPrice:setupEntry,stockStopLoss:num(r.stockStopLoss??r.stopLoss),stockTarget1:num(r.stockTarget1??r.target1),stockTarget2:num(r.stockTarget2??r.target2)}});const scannerMap=new Map();
for(const r of equityScannerData)scannerMap.set(key(r),r);
for(const r of scannerData)scannerMap.set(key(r),{...scannerMap.get(key(r)),...r});
// SCANNER is a single canonical Top-20 output.
// Equity and option discovery are separate upstream pipelines, but their
// union must never expand the SCANNER sheet beyond the configured limit.
// Keep the strongest directional/qualified rows first, then fill with the
// remaining live candidates only when fewer than 20 are qualified.
const combinedCandidates=[...scannerMap.values()];
const combinedQualified=combinedCandidates
  .filter(r=>r?.qualified===true)
  .sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a)));
const combinedFallback=combinedCandidates
  .filter(r=>r?.qualified!==true)
  .sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a)));
const combinedScannerData=[...combinedQualified,...combinedFallback]
  .slice(0,TOP_SCANNER_STOCKS);
const accuracyInput=dashboardRows.map(r=>{const full=merged.find(s=>key(s)===key(r));return full?{...full,...r}:r;});const accuracyData=await evaluateDashboardAccuracy(accuracyInput,broker);let core=false,strategy=false;try{await updateGoogleSheet({scannerData:combinedScannerData,dashboardData:dashboardRows,accuracyData});core=true}catch(e){console.error(`Sheet update failed: ${e?.message||e}`)}try{const liveAccuracy=await evaluateLiveAccuracy(broker);console.log(`📡 LIVE ACCURACY REFRESH: found=${liveAccuracy.found} evaluated=${liveAccuracy.evaluated} updated=${liveAccuracy.updated} skipped=${liveAccuracy.skipped}`);}catch(e){console.error(`Live Accuracy refresh failed: ${e?.message||e}`)}try{await updateStrategySheets(combinedScannerData,decisions,equityScannerData);strategy=true}catch(e){console.error(`Strategy sheet update failed: ${e?.message||e}`)}try{await buildDashboard(enriched,decisions,universe.symbols.length)}catch(e){console.error(`Dashboard update failed: ${e?.message||e}`)}const counts={call:dashboardRows.filter(r=>["CALL","CE"].includes(String(r.optionType).toUpperCase())).length,put:dashboardRows.filter(r=>["PUT","PE"].includes(String(r.optionType).toUpperCase())).length,trade:decisions.filter(r=>decision(r)==="TRADE").length,watch:decisions.filter(r=>decision(r)==="WATCH").length,reject:decisions.filter(r=>decision(r)==="REJECT").length};const elapsed=((Date.now()-started.getTime())/1000).toFixed(1),status=buildScannerStatus({status:core&&strategy?"SUCCESS":"PARTIAL_FAILURE",startedAt:started,universe:universe.name,broker:brokerName,scanned:combinedScannerData.length,successfulScans:combinedScannerData.filter(r=>!String(r.rejectionReason||"").includes("ERROR")).length,failedScans:combinedScannerData.filter(r=>String(r.rejectionReason||"").includes("ERROR")).length,callCandidates:counts.call,putCandidates:counts.put,tradeCount:counts.trade,watchCount:counts.watch,rejectCount:counts.reject,elapsedSeconds:elapsed});try{await updateGoogleSheet({action:"scanner_status",scannerStatus:status})}catch(e){console.error(`Status update failed: ${e?.message||e}`)}return{universe,top500,equityTop20:equityScanUniverse,optionBuyingUniverse:top100OptionRows.map(x=>x.symbol),optionUniverseSymbols:top100OptionRows.map(x=>x.symbol),optionLiveRows:top100OptionRows,optionPreflight,top20,optionUniverseRows:optionUniverseRows,optionReadyTop20:optionReady,scannerData:combinedScannerData,completeScannerData:equityScannerData,optionScannerData:enriched,optionDecisions:decisions,finalDashboard:dashboardRows,finalTrade,scannerStatus:status};}
if(require.main===module)main().catch(e=>{console.error(`FATAL: ${e?.stack||e}`);process.exitCode=1});module.exports={main,scanInBatches,chooseOne,rankOptionReady,selectDashboardCandidates,enrichUnderlyingOI,evaluateDashboardAccuracy};
