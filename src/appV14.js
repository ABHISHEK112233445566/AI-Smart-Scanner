require("dotenv").config();
const {setBroker,getActiveBroker,loadInstruments}=require("./brokers");
const {loadSymbolMaster}=require("./services/symbolService");
const {scanStocks}=require("./scanner");
const {calculateOptionsDecisions}=require("./optionsDecisionEngine");
const {updateGoogleSheet,buildScannerStatus}=require("./googleSheet");
const {updateStrategySheets}=require("./strategySheets");
const {buildDashboard}=require("./dashboard");
const {getFastTradingUniverse,getNifty500Universe}=require("./marketUniverse");
const {getTop500ByLiveVolume,filterOptionEligibleStocks,getTopMovers}=require("./liveMarket");
const {getUnderlyingOIMood}=require("./underlyingOI");
const {DIVIDEND_LONG_TERM_SYMBOLS}=require("./dividendUniverse");

const STOCK_BATCH_SIZE=Math.max(10,Number(process.env.STOCK_BATCH_SIZE||25));
const TOP_100=100;
const TOP_20=20;
const TOP_5=5;
const TOP_EQUITY=50;
const OPTION_PREFLIGHT_POOL=Math.max(TOP_100,Number(process.env.OPTION_PREFLIGHT_POOL||120));
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

function optionContractSide(r){
  const c=r?.optionLiquidityContractData;
  const s=String(c?.instrument_type??c?.option_type??c?.optionType??"").trim().toUpperCase();
  if(["CE","CALL"].includes(s)||String(c?.trading_symbol??c?.tradingSymbol??"").toUpperCase().endsWith(" CE"))return"CE";
  if(["PE","PUT"].includes(s)||String(c?.trading_symbol??c?.tradingSymbol??"").toUpperCase().endsWith(" PE"))return"PE";
  return"";
}
function validOptionRow(r){
  const strike=num(r?.bestStrike??r?.optionStrike??r?.recommendedStrike);
  const ltp=num(r?.optionPremiumEntry??r?.optionLTP??r?.optionLtp);
  const instrument=String(r?.optionInstrumentKey??r?.optionInstrument??r?.optionKey??"").trim();
  const side=String(r?.optionType??"").trim().toUpperCase();
  const expected=side==="CALL"||side==="CE"?"CE":side==="PUT"||side==="PE"?"PE":"";
  const contractSide=optionContractSide(r);
  const decision=String(r?.optionsDecision??r?.decision??"").trim().toUpperCase();
  const gatePassed=r?.gates?.basePassed===true||r?.pipeline?.optionsTradeGatePassed===true;
  return strike>0&&ltp>0&&Boolean(instrument)&&Boolean(expected)&&(!contractSide||contractSide===expected)&&decision!=="REJECT"&&gatePassed;
}

function sanitizeOptionRow(r){
  if(!validOptionRow(r))return{...r,optionEligible:false,optionDataValid:false,optionRejectionReason:"MISSING_LIVE_OPTION_CONTRACT_OR_LTP"};
  const ltp=num(r?.optionPremiumEntry??r?.optionLTP??r?.optionLtp);
  return{...r,optionEligible:true,optionDataValid:true,optionEntry:ltp,optionPremiumEntry:ltp,entryPrice:ltp,stockEntry:num(r?.stockEntry??r?.underlyingEntry??r?.price)};
}

function rankDashboard(rows){
  const list=(Array.isArray(rows)?rows:[]).filter(validOptionRow).map(sanitizeOptionRow);
  return list.sort((a,b)=>{
    const da=decision(a)==="TRADE"?2:1,db=decision(b)==="TRADE"?2:1;
    return (db-da)||(confidence(b)-confidence(a))||(score(b)-score(a))||(num(b.riskReward)-num(a.riskReward));
  }).slice(0,TOP_5);
}

function buildEquityCandidates(liveRows){
  const rows=Array.isArray(liveRows)?liveRows:[];
  const bySymbol=new Map(rows.map(r=>[key(r),r]));
  const selected=[];
  const add=row=>{const k=key(row);if(!k||selected.some(x=>key(x)===k))return;selected.push(row);};

  // Keep the original volume-ranked Top-50 backbone.
  for(const row of rows.slice(0,TOP_EQUITY))add(row);

  // Protect strong market movers from disappearing merely because their raw
  // traded volume ranks below the Top-50. Replace the weakest volume entries
  // while keeping the equity scan capped at exactly 50 stocks.
  const movers=getTopMovers(rows,Math.max(20,Number(process.env.EQUITY_MOVER_POOL||30)));
  for(const mover of movers){
    if(selected.length<TOP_EQUITY){add(bySymbol.get(key(mover))||mover);continue;}
    if(selected.some(x=>key(x)===key(mover)))continue;
    const weakestIndex=selected.reduce((wi,row,i)=>num(row.volume)<num(selected[wi].volume)?i:wi,0);
    if(num(mover.volume)>num(selected[weakestIndex].volume))selected[weakestIndex]=bySymbol.get(key(mover))||mover;
  }
  return selected.slice(0,TOP_EQUITY);
}

async function collectOptionEligible(liveRows,broker){
  const rows=Array.isArray(liveRows)?liveRows:[];
  const firstPool=Math.min(rows.length,OPTION_PREFLIGHT_POOL);
  let eligible=await filterOptionEligibleStocks(rows.slice(0,firstPool),broker,TOP_100);

  // Only expand the expensive contract/quote preflight if the first ranked
  // pool cannot supply the requested 100 candidates. This prevents hundreds
  // of unnecessary option-contract API calls on every run.
  if(eligible.length<TOP_100&&firstPool<rows.length){
    const remainder=await filterOptionEligibleStocks(rows.slice(firstPool),broker,TOP_100-eligible.length);
    const merged=new Map();
    for(const row of [...eligible,...remainder])merged.set(key(row),row);
    eligible=[...merged.values()].sort((a,b)=>(num(b.volume)-num(a.volume))||(num(b.optionLiquidityVolume)-num(a.optionLiquidityVolume))||(num(b.optionLiquidityOI)-num(a.optionLiquidityOI))).slice(0,TOP_100);
  }
  return eligible.map((r,index)=>({...r,optionUniverseRank:index+1}));
}

async function main(){
  const started=new Date();
  console.log("\n=== AI SMART SCANNER V14 | SEPARATE FAST EQUITY + OPTIONS PIPELINES ===");
  const brokerName=String(process.env.BROKER||"UPSTOX").trim().toUpperCase();
  setBroker(brokerName);
  const broker=getActiveBroker();
  await broker.login();
  try{await loadInstruments()}catch(e){console.log(`Instrument load warning: ${e?.message||e}`)}
  try{await loadSymbolMaster()}catch(e){console.log(`Symbol master warning: ${e?.message||e}`)}

  const fnoUniverse=await getFastTradingUniverse(broker);
  const equityUniverse=await getNifty500Universe();
  console.log(`FAST F&O UNIVERSE: ${fnoUniverse.symbols.length}`);
  console.log(`NIFTY 500 EQUITY UNIVERSE: ${equityUniverse.symbols.length}`);

  // OPTION UNIVERSE: use the Dhan Options Stocks List as the membership
  // universe, then intersect it with Upstox instruments/live F&O quotes.
  // Dhan defines which stocks are option-tradable; Upstox remains the
  // execution/data authority for live price, volume, OI and option contracts.
  const DHAN_OPTION_SYMBOLS=String(process.env.DHAN_OPTION_SYMBOLS||"")
    .split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
  const optionUniverseSymbols=DHAN_OPTION_SYMBOLS.length
    ? fnoUniverse.symbols.filter(s=>DHAN_OPTION_SYMBOLS.includes(String(s).toUpperCase()))
    : fnoUniverse.symbols;
  console.log(`DHAN OPTION UNIVERSE: configured=${DHAN_OPTION_SYMBOLS.length} matchedUpstox=${optionUniverseSymbols.length}`);

  // The current fast universe is the complete available F&O stock universe.
  // Do not call it Top-500 when fewer than 500 F&O stocks are actually listed.
  const topRanking=await getTop500ByLiveVolume(equityUniverse.symbols,broker,equityUniverse.symbols.length);
  const liveFnoRows=Array.isArray(topRanking?.top)?topRanking.top:[];
  if(!liveFnoRows.length)throw new Error("Live F&O ranking returned no stocks");
  console.log(`LIVE NIFTY 500 COVERAGE: ${liveFnoRows.length}/${equityUniverse.symbols.length} underlyings have live quotes`);

  // ---------------- EQUITY PIPELINE ----------------
  // Equity remains independent from option eligibility. The candidate pool is
  // volume-ranked Top-50 with a controlled mover-injection safeguard so a
  // genuine high-momentum F&O stock cannot disappear solely on volume rank.
  const equityCandidates=buildEquityCandidates(liveFnoRows);
  const equitySymbols=equityCandidates.map(x=>x.symbol).filter(Boolean);
  console.log(`EQUITY CANDIDATES: ${equitySymbols.length} | volumeTop=${Math.min(TOP_EQUITY,liveFnoRows.length)} | moverProtection=ON`);
  const equityScan=await scanInBatches(equitySymbols);
  const equityTop20=rankTop(equityScan.allResults,TOP_20);
  const dividendSymbols=DIVIDEND_LONG_TERM_SYMBOLS.filter(s=>!equitySymbols.includes(s));
  const dividendScan=await scanInBatches(dividendSymbols);
  const dividendRows=[...dividendScan.allResults];
  console.log(`EQUITY PIPELINE: Complete F&O live ranking → protected Top-50 scan → Top-20 output | rows=${equityTop20.length}`);

  // ---------------- INDEPENDENT OPTIONS PIPELINE ----------------
  // Start option preflight with the highest-volume 120 underlyings instead of
  // making contract+quote calls for the entire F&O universe. Expand only when
  // fewer than 100 liquid candidates are actually found.
  const optionUniverseRows=liveFnoRows.filter(r=>optionUniverseSymbols.includes(key(r)));
  const optionEligible=await collectOptionEligible(optionUniverseRows,broker);
  if(!optionEligible.length){
    console.warn(`⚠️ No liquid option candidate passed preflight. F&O=${fnoUniverse.symbols.length}, liveQuotes=${liveFnoRows.length}. Equity pipeline remains valid.`);
  }
  const top100=optionEligible.slice(0,TOP_100);
  console.log(`OPTION PIPELINE: Dhan universe=${optionUniverseSymbols.length} → live quoted=${optionUniverseRows.length} → option preflight=${Math.min(optionUniverseRows.length,OPTION_PREFLIGHT_POOL)} first → Top-100=${top100.length}`);

  const optionSymbols=top100.map(x=>x.symbol).filter(Boolean);
  const optionScan=await scanInBatches(optionSymbols);
  const optionScanned=mergeBySymbol(optionScan.allResults,top100);
  const optionTop20=rankTop(optionScanned,TOP_20);
  console.log(`OPTION PIPELINE: option candidates scanned=${optionScanned.length} → Top-20 scanner=${optionTop20.length}`);

  const oiRows=await enrichUnderlyingOI(optionTop20);
  let decisions=[];
  try{decisions=await calculateOptionsDecisions(oiRows)}catch(e){console.error(`Options engine failed: ${e?.message||e}`)}
  const decisionRows=mergeBySymbol(oiRows,decisions).map(sanitizeOptionRow);

  const dashboardRows=rankDashboard(decisionRows);
  const finalTrade=dashboardRows.filter(r=>decision(r)==="TRADE").slice(0,ONE_TRADE_LIMIT);

  console.log(`SCANNER: option Top-20=${decisionRows.length}`);
  console.log(`DASHBOARD: option Top-5=${dashboardRows.length}`);
  console.log(`FINAL TRADE: ${finalTrade.length}`);

  let core=false,strategy=false;
  try{
    await updateGoogleSheet({scannerData:decisionRows,dashboardData:dashboardRows});
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

  try{await buildDashboard(dashboardRows,decisions,equityUniverse.symbols.length)}catch(e){console.error(`Dashboard update failed: ${e?.message||e}`)}

  const elapsed=((Date.now()-started.getTime())/1000).toFixed(1);
  const counts={call:dashboardRows.filter(r=>["CALL","CE"].includes(String(r.optionType).toUpperCase())).length,put:dashboardRows.filter(r=>["PUT","PE"].includes(String(r.optionType).toUpperCase())).length,trade:decisions.filter(r=>decision(r)==="TRADE").length,watch:decisions.filter(r=>decision(r)==="WATCH").length,reject:decisions.filter(r=>decision(r)==="REJECT").length};
  const status=buildScannerStatus({status:core&&strategy?"SUCCESS":"PARTIAL_FAILURE",startedAt:started,universe:equityUniverse.name,broker:brokerName,scanned:decisionRows.length,successfulScans:decisionRows.filter(r=>!String(r.rejectionReason||"").includes("ERROR")).length,failedScans:decisionRows.filter(r=>String(r.rejectionReason||"").includes("ERROR")).length,callCandidates:counts.call,putCandidates:counts.put,tradeCount:counts.trade,watchCount:counts.watch,rejectCount:counts.reject,elapsedSeconds:elapsed});
  try{await updateGoogleSheet({action:"scanner_status",scannerStatus:status})}catch(e){console.error(`Status update failed: ${e?.message||e}`)}

  console.log(`✅ V14 COMPLETE in ${elapsed}s | FNO=${fnoUniverse.symbols.length} | LiveFNO=${liveFnoRows.length} | OptionTop100=${top100.length} | ScannerTop20=${decisionRows.length} | DashboardTop5=${dashboardRows.length}`);
  return{universe:equityUniverse,fnoUniverse,liveFnoRows,top100OptionRows:top100,optionScanned,optionTop20,optionDecisions:decisions,scannerData:decisionRows,finalDashboard:dashboardRows,finalTrade,equityTop20,dividendRows,scannerStatus:status};
}

if(require.main===module)main().catch(e=>{console.error(`FATAL: ${e?.stack||e}`);process.exitCode=1});
module.exports={main,scanInBatches,rankTop,rankDashboard,validOptionRow,sanitizeOptionRow,buildEquityCandidates,collectOptionEligible};
