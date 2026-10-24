require("dotenv").config();
const {setBroker,getActiveBroker,loadInstruments}=require("./brokers");
const {loadSymbolMaster}=require("./services/symbolService");
const {scanStocks}=require("./scanner");
const {calculateOptionsDecisions}=require("./optionsDecisionEngine");
const {updateGoogleSheet,buildScannerStatus}=require("./googleSheet");
const {updateStrategySheets}=require("./strategySheets");
const {buildDashboard}=require("./dashboard");
const {scanNiftyIndex}=require("./niftyIndexScanner");
const {updateNiftyDashboard}=require("./googleSheet");
const {getFastTradingUniverse,getNifty500Universe}=require("./marketUniverse");
const {getTop500ByLiveVolume,filterOptionEligibleStocks,getTopMovers}=require("./liveMarket");
const {getUnderlyingOIMood}=require("./underlyingOI");
const {DIVIDEND_LONG_TERM_SYMBOLS}=require("./dividendUniverse");
const {enrichDashboardNews}=require("./newsService");
const config=require("./config");
const DASHBOARD_MIN_SCORE = Number(config.DASHBOARD_CANDIDATE_MIN_SCORE ?? 5);

const STOCK_BATCH_SIZE=Math.max(10,Number(process.env.STOCK_BATCH_SIZE||25));
const TOP_100=220;
const TOP_20=20;
const TOP_5=5;
// Options pipeline only: keep both bullish/CE and bearish/PE candidates in
// the scanner candidate pool. This does NOT change the equity ranking.
const OPTION_SIDE_MIN_CANDIDATES=Math.min(5,Math.floor(TOP_20/2));
const TOP_EQUITY=50;
const OPTION_PREFLIGHT_POOL=Math.max(TOP_100,Number(process.env.OPTION_PREFLIGHT_POOL||260));
const ONE_TRADE_LIMIT=1;
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const key=r=>String(r?.stock??r?.symbol??r?.name??"").trim().toUpperCase();
const score=r=>Math.abs(num(r?.scannerScore??r?.score));
const confidence=r=>num(r?.optionsConfidence??r?.confidence);
const decision=r=>String(r?.optionsDecision??r?.decision??"").trim().toUpperCase();
async function scanInBatches(symbols){const all=[];const source=[...new Set((symbols||[]).map(s=>String(s||"").trim().toUpperCase()).filter(Boolean))];for(let i=0;i<source.length;i+=STOCK_BATCH_SIZE){const batch=source.slice(i,i+STOCK_BATCH_SIZE);console.log(`STOCK BATCH ${i+1}-${Math.min(i+STOCK_BATCH_SIZE,source.length)} / ${source.length}`);try{const result=await scanStocks(batch);const rows=Array.isArray(result?.allResults)?result.allResults:(Array.isArray(result)?result:[]);all.push(...rows);}catch(e){console.error(`Batch failed: ${e?.message||e}`);for(const s of batch)all.push({stock:s,symbol:s,qualified:false,rejectionReason:"BATCH_ERROR"});}}const map=new Map();for(const r of all)map.set(key(r),r);const unique=[...map.values()];return{allResults:unique,qualified:unique.filter(r=>r?.qualified===true),rejected:unique.filter(r=>r?.qualified===false)};}
async function enrichUnderlyingOI(rows=[]){const source=Array.isArray(rows)?rows:[];const concurrency=Math.max(4,Number(process.env.OI_ENRICH_CONCURRENCY||8));const out=[];for(let i=0;i<source.length;i+=concurrency){const batch=source.slice(i,i+concurrency);const checked=await Promise.all(batch.map(async r=>{try{const oi=await getUnderlyingOIMood({instrumentKey:r.instrumentKey,currentPrice:num(r.currentPrice??r.price),previousPrice:num(r.previousPrice??r.prevPrice??r.previousClose)});return{...r,oiCheckAttempted:true,oiMood:oi.mood||"UNKNOWN",oiSentiment:oi.sentiment||"UNKNOWN",oiDataAvailable:oi.dataAvailable===true,oiPriceChangePercent:num(oi.priceChangePercent),oiChangePercent:num(oi.oiChangePercent),oi:num(oi.oi),previousOI:num(oi.previousOI),underlyingOISource:oi.source||"",underlyingOIReason:oi.reason||""};}catch(e){return{...r,oiCheckAttempted:true,oiMood:"UNKNOWN",oiSentiment:"UNKNOWN",oiDataAvailable:false,oiPriceChangePercent:0,oiChangePercent:0,underlyingOIReason:`ENRICHMENT_FAILED:${e?.message||e}`};}}));out.push(...checked);}return out;}
function mergeBySymbol(base,extra){const map=new Map((Array.isArray(extra)?extra:[]).map(r=>[key(r),r]));return(Array.isArray(base)?base:[]).map(r=>map.has(key(r))?{...r,...map.get(key(r))}:r);}
function rankTop(rows,limit){return[...(Array.isArray(rows)?rows:[])].sort((a,b)=>(score(b)-score(a))||(confidence(b)-confidence(a))||(num(b.riskReward)-num(a.riskReward))).slice(0,limit);}

function optionDirection(row){
  const d=String(row?.stockDirection??row?.direction??row?.technicalDirection??"").trim().toUpperCase();
  if(["BULLISH","BULL","CALL","CE","BUY","LONG","UP"].includes(d))return"BULLISH";
  if(["BEARISH","BEAR","PUT","PE","SELL","SHORT","DOWN"].includes(d))return"BEARISH";
  const t=String(row?.optionType??"").trim().toUpperCase();
  if(["CALL","CE"].includes(t))return"BULLISH";
  if(["PUT","PE"].includes(t))return"BEARISH";
  return"NEUTRAL";
}

// Option candidates are ranked directionally so a strong PE side cannot consume
// the entire Top-20 before the option engine gets a chance to evaluate CE setups.
// Existing score/confidence/RR ordering is preserved within each side.
// Equity ranking continues to use rankTop() unchanged.
function rankOptionCandidates(rows,limit){
  const ranked=[...(Array.isArray(rows)?rows:[])].sort((a,b)=>
    (score(b)-score(a))||
    (confidence(b)-confidence(a))||
    (num(b.riskReward)-num(a.riskReward))
  );
  if(ranked.length<=limit)return ranked.slice(0,limit);

  const bullish=ranked.filter(r=>optionDirection(r)==="BULLISH");
  const bearish=ranked.filter(r=>optionDirection(r)==="BEARISH");
  const neutral=ranked.filter(r=>optionDirection(r)==="NEUTRAL");
  const selected=[];
  const selectedKeys=new Set();

  const add=row=>{
    const k=key(row);
    if(!k||selectedKeys.has(k)||selected.length>=limit)return;
    selected.push(row);
    selectedKeys.add(k);
  };

  // Reserve equal minimum representation when both sides have candidates.
  // If one side has fewer candidates, use what actually exists.
  for(let i=0;i<OPTION_SIDE_MIN_CANDIDATES;i++)add(bullish[i]);
  for(let i=0;i<OPTION_SIDE_MIN_CANDIDATES;i++)add(bearish[i]);

  for(const row of ranked)add(row);
  for(const row of neutral)add(row);

  return selected.slice(0,limit);
}
function optionContractSide(r){const c=r?.optionLiquidityContractData;const s=String(c?.instrument_type??c?.option_type??c?.optionType??"").trim().toUpperCase();if(["CE","CALL"].includes(s)||String(c?.trading_symbol??c?.tradingSymbol??"").toUpperCase().endsWith(" CE"))return"CE";if(["PE","PUT"].includes(s)||String(c?.trading_symbol??c?.tradingSymbol??"").toUpperCase().endsWith(" PE"))return"PE";return"";}
function validOptionRow(r){const strike=num(r?.bestStrike??r?.optionStrike??r?.recommendedStrike);const ltp=num(r?.optionPremiumEntry??r?.optionLTP??r?.optionLtp);const instrument=String(r?.optionInstrumentKey??r?.optionInstrument??r?.optionKey??"").trim();const contract=r?.optionLiquidityContractData&&typeof r.optionLiquidityContractData==="object"?r.optionLiquidityContractData:null;const embeddedInstrument=String(contract?.instrument_key??contract?.instrumentKey??"").trim();const liquidityInstrument=String(r?.optionLiquidityContract??"").trim();const side=String(r?.optionType??"").trim().toUpperCase();const expected=side==="CALL"||side==="CE"?"CE":side==="PUT"||side==="PE"?"PE":"";const contractSide=optionContractSide(r);const decision=String(r?.optionsDecision??r?.decision??"").trim().toUpperCase();const gatePassed=r?.gates?.basePassed===true||r?.pipeline?.optionsTradeGatePassed===true;const identityValid=r?.optionContractIdentityValid===true;const quoteValid=r?.optionLiveDataAvailable===true;const liquidityValid=r?.optionLiquidityConfirmed===true;const instrumentIdentityValid=(!embeddedInstrument||embeddedInstrument===instrument)&&(!liquidityInstrument||liquidityInstrument===instrument);const premiumLevelsValid=num(r?.optionPremiumStopLoss)>0&&num(r?.optionPremiumTarget1)>ltp&&num(r?.optionPremiumRiskReward)>0;return strike>0&&ltp>0&&Boolean(instrument)&&Boolean(expected)&&(!contractSide||contractSide===expected)&&instrumentIdentityValid&&decision!=="REJECT"&&gatePassed&&identityValid&&quoteValid&&liquidityValid&&premiumLevelsValid;}
function sanitizeOptionRow(r){if(validOptionRow(r)){const ltp=num(r?.optionPremiumEntry??r?.optionLTP??r?.optionLtp);return{...r,optionEligible:true,optionDataValid:true,optionEntry:ltp,optionPremiumEntry:ltp,entryPrice:ltp,stockEntry:num(r?.stockEntry??r?.underlyingEntry??r?.price)};}const side=String(r?.optionType??"").trim().toUpperCase();const expected=side==="CALL"||side==="CE"?"CE":side==="PUT"||side==="PE"?"PE":"";const ltp=num(r?.optionLTP??r?.optionLtp);const informationalQuote=r?.optionContractIdentityValid===true&&r?.optionLiveDataAvailable===true&&ltp>0;return{...r,optionEligible:false,optionDataValid:false,optionRejectionReason:r?.optionRejectionReason||r?.decisionReason||r?.contractLookupReason||r?.rejectionReason||r?.reason||"MISSING_LIVE_OPTION_CONTRACT_OR_LTP",optionSymbol:informationalQuote?(r.optionSymbol||""):"",recommendedStrike:informationalQuote?(r.recommendedStrike??null):null,atmStrike:informationalQuote?(r.atmStrike??null):null,optionExpiry:informationalQuote?(r.optionExpiry??null):null,optionInstrumentKey:informationalQuote?(r.optionInstrumentKey||""):"",optionLiquidityContractData:informationalQuote?(r.optionLiquidityContractData||null):null,optionLiquiditySide:expected,optionPremiumEntry:informationalQuote?ltp:0,optionPremiumStopLoss:informationalQuote?(num(r.optionPremiumStopLoss)||0):0,optionPremiumTarget1:informationalQuote?(num(r.optionPremiumTarget1)||0):0,optionPremiumTarget2:informationalQuote?(num(r.optionPremiumTarget2)||0):0,optionPremiumRisk:informationalQuote?(num(r.optionPremiumRisk)||0):0,optionPremiumReward:informationalQuote?(num(r.optionPremiumReward)||0):0,optionPremiumRiskReward:informationalQuote?(num(r.optionPremiumRiskReward)||0):0,optionVolume:informationalQuote?(num(r.optionVolume)||0):0,optionOI:informationalQuote?(num(r.optionOI)||0):0,optionPreviousOI:informationalQuote?(num(r.optionPreviousOI)||0):0,optionOIChange:informationalQuote?(num(r.optionOIChange)||0):0,optionOIChangePercent:informationalQuote?(num(r.optionOIChangePercent)||0):0,optionLiveDataAvailable:informationalQuote,optionLiquidityConfirmed:informationalQuote&&r.optionLiquidityConfirmed===true,optionLiquidityVolume:informationalQuote?(num(r.optionLiquidityVolume)||0):0,optionLiquidityOI:informationalQuote?(num(r.optionLiquidityOI)||0):0,optionContractIdentityValid:informationalQuote,optionEntry:informationalQuote?ltp:0,entryPrice:informationalQuote?ltp:0};}
function rankDashboard(rows){
  // Prefer fully validated trades. If fewer than five exist, keep the strongest
  // directional scanner candidates visible as WATCH rather than producing an
  // empty Dashboard. WATCH rows are never promoted to executable trades.
  const source=Array.isArray(rows)?rows:[];
  const isDirectionalCandidate=r=>{
    if(!r||typeof r!=="object"||!key(r))return false;
    const dir=optionDirection(r);
    if(dir==="NEUTRAL")return false;
    const rating=String(r.rating??r.aiRating??"").toUpperCase();
    const signal=String(r.signal??"").toUpperCase();
    if(rating.includes("AVOID")||signal==="AVOID")return false;
    const composite=[r.finalScore,r.rankingScore,r.aiFinalScore,r.scannerScore,r.score].map(num).find(v=>v!==0)??0;
    const livePrice=num(r.currentPrice??r.price??r.stockPrice??r.ltp);
    return Math.abs(composite)>=DASHBOARD_MIN_SCORE&&livePrice>0;
  };
  const validStockLevels=r=>{
    const dir=optionDirection(r);
    const entry=num(r.stockEntry??r.underlyingEntry??r.marketEntry??r.triggerPrice??r.price??r.currentPrice);
    const livePrice=num(r.currentPrice??r.price??r.stockPrice??r.ltp);
    const sl=num(r.stockStopLoss??r.underlyingStopLoss);
    const t1=num(r.stockTarget1??r.underlyingTarget1);
    const t2=num(r.stockTarget2??r.underlyingTarget2);
    if(!(entry>0&&livePrice>0&&sl>0&&t1>0&&t2>0))return false;
    if(dir==="BULLISH")return sl<entry&&t1>entry&&t2>t1&&livePrice>=entry;
    if(dir==="BEARISH")return sl>entry&&t1<entry&&t2<t1&&livePrice<=entry;
    return false;
  };
  const sortRows=(a,b)=>{
    const compositeA=Math.abs([a.finalScore,a.rankingScore,a.aiFinalScore,a.scannerScore,a.score].map(num).find(v=>v!==0)??0);
    const compositeB=Math.abs([b.finalScore,b.rankingScore,b.aiFinalScore,b.scannerScore,b.score].map(num).find(v=>v!==0)??0);
    return (compositeB-compositeA)||(confidence(b)-confidence(a))||(num(b.stockRiskReward??b.riskReward)-num(a.stockRiskReward??a.riskReward));
  };
  const trades=source.filter(r=>isDirectionalCandidate(r)&&decision(r)==="TRADE"&&validOptionRow(r)&&
    (r.qualified===true||r.dashboardEligible===true||r.scannerQualified===true||r.optionEngineQualified===true)&&validStockLevels(r)
  ).map(sanitizeOptionRow).sort(sortRows).slice(0,TOP_5);
  if(trades.length>=TOP_5)return trades;
  const tradeKeys=new Set(trades.map(key));
  const watch=source.filter(r=>isDirectionalCandidate(r)&&!tradeKeys.has(key(r))).sort(sortRows)
    .map(r=>({...sanitizeOptionRow({...r,optionsDecision:"WATCH",decision:"WATCH",optionEligible:false,optionDataValid:false,
      optionRejectionReason:r.optionRejectionReason||r.decisionReason||r.contractLookupReason||r.rejectionReason||"TRADE_GATES_NOT_PASSED"}),optionsDecision:"WATCH",decision:"WATCH",optionEligible:false,optionDataValid:false}))
    .filter(r=>!tradeKeys.has(key(r)));
  const result=[...trades];
  for(const row of watch){
    if(result.length>=TOP_5)break;
    if(result.some(x=>key(x)===key(row)))continue;
    result.push(row);
  }
  return result;
}
function buildEquityCandidates(liveRows){const rows=Array.isArray(liveRows)?liveRows:[];const bySymbol=new Map(rows.map(r=>[key(r),r]));const selected=[];const add=row=>{const k=key(row);if(!k||selected.some(x=>key(x)===k))return;selected.push(row);};for(const row of rows.slice(0,TOP_EQUITY))add(row);const movers=getTopMovers(rows,Math.max(20,Number(process.env.EQUITY_MOVER_POOL||30)));for(const mover of movers){if(selected.length<TOP_EQUITY){add(bySymbol.get(key(mover))||mover);continue;}if(selected.some(x=>key(x)===key(mover)))continue;const weakestIndex=selected.reduce((wi,row,i)=>num(row.volume)<num(selected[wi].volume)?i:wi,0);if(num(mover.volume)>num(selected[weakestIndex].volume))selected[weakestIndex]=bySymbol.get(key(mover))||mover;}return selected.slice(0,TOP_EQUITY);}
async function collectOptionEligible(liveRows,broker,priorityRows=[]){
  const rows=Array.isArray(liveRows)?liveRows:[];
  const priority=Array.isArray(priorityRows)?priorityRows:[];
  const baseMap=new Map();
  for(const row of [...priority,...rows]){
    const k=key(row);
    if(k&&!baseMap.has(k))baseMap.set(k,row);
  }
  const ordered=[...baseMap.values()];
  const priorityKeys=new Set(priority.map(key).filter(Boolean));
  const priorityPool=ordered.filter(r=>priorityKeys.has(key(r)));
  const regularPool=ordered.filter(r=>!priorityKeys.has(key(r)));
  let eligible=await filterOptionEligibleStocks(priorityPool,broker,TOP_100);
  if(eligible.length<TOP_100){
    const firstPool=Math.min(regularPool.length,OPTION_PREFLIGHT_POOL);
    const regularEligible=await filterOptionEligibleStocks(regularPool.slice(0,firstPool),broker,TOP_100-eligible.length);
    eligible=[...eligible,...regularEligible];
    if(eligible.length<TOP_100&&firstPool<regularPool.length){
      const remainder=await filterOptionEligibleStocks(regularPool.slice(firstPool),broker,TOP_100-eligible.length);
      const merged=new Map();
      for(const row of [...eligible,...remainder])merged.set(key(row),row);
      eligible=[...merged.values()];
    }
  }
  const priorityEligible=eligible.filter(r=>priorityKeys.has(key(r)));
  const regularEligible=eligible.filter(r=>!priorityKeys.has(key(r)));
  return [...priorityEligible,...regularEligible].slice(0,TOP_100).map((r,index)=>({...r,optionUniverseRank:index+1}));
}
async function main(){const started=new Date();console.log("=== AI SMART SCANNER V14 | SEPARATE FAST EQUITY + OPTIONS PIPELINES ===");const brokerName=String(process.env.BROKER||"UPSTOX").trim().toUpperCase();setBroker(brokerName);const broker=getActiveBroker();await broker.login();try{await loadInstruments()}catch(e){console.log(`Instrument load warning: ${e?.message||e}`)}try{await loadSymbolMaster()}catch(e){console.log(`Symbol master warning: ${e?.message||e}`)}const fnoUniverse=await getFastTradingUniverse(broker);const equityUniverse=await getNifty500Universe();console.log(`FAST F&O UNIVERSE: ${fnoUniverse.symbols.length}`);console.log(`NIFTY 500 EQUITY UNIVERSE: ${equityUniverse.symbols.length}`);const DHAN_OPTION_SYMBOLS=String(process.env.DHAN_OPTION_SYMBOLS||"").split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);const optionUniverseSymbols=fnoUniverse.symbols;const dhanMatchedSymbols=DHAN_OPTION_SYMBOLS.filter(s=>optionUniverseSymbols.includes(s));console.log(`OPTIONS SOURCE UNIVERSE: F&O=${optionUniverseSymbols.length} | Dhan reference configured=${DHAN_OPTION_SYMBOLS.length} matchedF&O=${dhanMatchedSymbols.length} | Dhan list is reference-only`);const topRanking=await getTop500ByLiveVolume(equityUniverse.symbols,broker,equityUniverse.symbols.length);const liveFnoRows=Array.isArray(topRanking?.top)?topRanking.top:[];if(!liveFnoRows.length)throw new Error("Live F&O ranking returned no stocks");console.log(`LIVE NIFTY 500 COVERAGE: ${liveFnoRows.length}/${equityUniverse.symbols.length} underlyings have live quotes`);let equityTop20=[];let dividendRows=[];if(config.EQUITY_SCAN_ENABLED!==false){const equityCandidates=buildEquityCandidates(liveFnoRows);const equitySymbols=equityCandidates.map(x=>x.symbol).filter(Boolean);console.log(`EQUITY CANDIDATES: ${equitySymbols.length} | volumeTop=${Math.min(TOP_EQUITY,liveFnoRows.length)} | moverProtection=ON`);const equityScan=await scanInBatches(equitySymbols);equityTop20=rankTop(equityScan.allResults,TOP_20);// Scan the complete dividend universe independently, even when a dividend stock also appears in the Top-50 equity candidates. This prevents the dividend sheet from receiving NOT_SCANNED placeholders for overlapping symbols and does not alter the original equity ranking/pipeline.
const dividendSymbols=[...DIVIDEND_LONG_TERM_SYMBOLS];const dividendScan=await scanInBatches(dividendSymbols);dividendRows=[...dividendScan.allResults];console.log(`EQUITY PIPELINE: Complete F&O live ranking → protected Top-50 scan → Top-20 output | rows=${equityTop20.length}`);}else{console.log("EQUITY SCAN: OFF — equity scan and dividend scan skipped; options pipeline unchanged.");}const optionUniverseRows=liveFnoRows.filter(r=>optionUniverseSymbols.includes(key(r)));
const topMoverUniverse=getTopMovers(liveFnoRows.filter(r=>optionUniverseSymbols.includes(key(r))),Math.max(20,Number(process.env.TOP_MOVER_SCAN_POOL||30)));
console.log("TOP MOVER UNIVERSE: "+topMoverUniverse.length+" | full scanner scan=ON");
const topMoverSymbols=topMoverUniverse.map(r=>key(r)).filter(Boolean);
const topMoverScan=await scanInBatches(topMoverSymbols);
console.log("TOP MOVER FULL SCAN: scanned="+topMoverScan.allResults.length+" | qualified="+topMoverScan.qualified.length);
const topMoverRows=topMoverUniverse;
const optionUniverseWithMovers=[...new Map([...topMoverRows,...optionUniverseRows].map(r=>[key(r),r])).values()];
console.log("OPTION TOP MOVERS: "+topMoverRows.length+" F&O movers promoted into option preflight");
const optionEligible=await collectOptionEligible(optionUniverseWithMovers,broker,topMoverRows);if(!optionEligible.length)console.warn(`⚠️ No liquid option candidate passed preflight. F&O=${fnoUniverse.symbols.length}, liveQuotes=${liveFnoRows.length}. Equity pipeline remains valid.`);const top100=optionEligible.slice(0,TOP_100);console.log("OPTION PIPELINE: full F&O universe="+optionUniverseSymbols.length+" → live quoted="+optionUniverseRows.length+" → top movers promoted="+topMoverRows.length+" → eligible options="+top100.length+" (target 220)");const optionSymbols=top100.map(x=>x.symbol).filter(Boolean);const optionScan=await scanInBatches(optionSymbols);const optionScanned=mergeBySymbol(optionScan.allResults,top100);const moverOptionScanned=topMoverScan.allResults;const combinedOptionScanned=mergeBySymbol(optionScanned,moverOptionScanned);const combinedFullScanMap=new Map(optionScanned.map(r=>[key(r),r]).filter(([k])=>k));for(const r of topMoverScan.allResults){const k=key(r);if(k)combinedFullScanMap.set(k,{...(combinedFullScanMap.get(k)||{}),...r});}const combinedFullScanRows=[...combinedFullScanMap.values()];
const optionTop20=rankOptionCandidates(combinedFullScanRows,TOP_20);console.log(`COMBINED TOP-20: original full-scan rows=${optionScanned.length} + top-mover full-scan rows=${topMoverScan.allResults.length} → Top-20=${optionTop20.length}`);const oiRows=await enrichUnderlyingOI(optionTop20);let decisions=[];try{decisions=(await calculateOptionsDecisions(oiRows)).map(sanitizeOptionRow)}catch(e){console.error(`Options engine failed: ${e?.message||e}`)}let decisionRows=mergeBySymbol(oiRows,decisions).map(sanitizeOptionRow);try{decisionRows=await enrichDashboardNews(decisionRows);console.log(`SCANNER NEWS: enriched ${decisionRows.length} Top-20 scanner rows`);}catch(e){console.warn(`Scanner news enrichment failed: ${e?.message||e}`)}let niftyDashboard=null;
try{
  niftyDashboard=await scanNiftyIndex(broker);
  const nr=niftyDashboard?.scannerRow;
  if(nr&&num(nr.price)>0){
    decisionRows=decisionRows.filter(r=>key(r)!=="NIFTY"&&key(r)!=="NIFTY 50");
    decisionRows=[...decisionRows.slice(0,Math.max(0,TOP_20-1)),nr];
    console.log("NIFTY STOCK-STYLE SCAN: appended as final SCANNER row with "+(nr.optionType||"NO SIDE")+" premium="+num(nr.optionPremiumEntry));
  }
}catch(e){console.error("NIFTY stock-style scan failed without stopping existing stock scanner: "+(e?.message||e))}
const dashboardCandidateMap=new Map(combinedFullScanRows.map(r=>[key(r),r]).filter(([k])=>k));for(const r of decisionRows){const k=key(r);if(k)dashboardCandidateMap.set(k,{...(dashboardCandidateMap.get(k)||{}),...r});}const dashboardCandidateRows=[...dashboardCandidateMap.values()];let dashboardRows=rankDashboard(dashboardCandidateRows);
const niftyDashboardRow=decisionRows.find(r=>key(r)==="NIFTY"||key(r)==="NIFTY 50");
if(niftyDashboardRow&&num(niftyDashboardRow.price)>0){
  // NIFTY is a required index row on the compact dashboard, even when its
  // option gate rejects the contract. Keep rejected/unclear setups visible as
  // WATCH with the rejection reason; never promote them to an executable trade.
  const niftyReady=validOptionRow(niftyDashboardRow);
  const niftyForDashboard=niftyReady
    ? sanitizeOptionRow(niftyDashboardRow)
    : {
        ...niftyDashboardRow,
        optionsDecision:"WATCH",
        decision:"WATCH",
        optionEligible:false,
        optionDataValid:false,
        optionEngineQualified:false,
        optionRejectionReason:niftyDashboardRow.rejectionReason||"NIFTY_OPTION_GATE_NOT_PASSED",
        optionPremiumEntry:0,
        optionLTP:0,
        optionEntry:0,
        entryPrice:0
      };
  dashboardRows=[
    ...dashboardRows.filter(r=>key(r)!=="NIFTY"&&key(r)!=="NIFTY 50").slice(0,TOP_5-1),
    niftyForDashboard
  ];
  console.log("NIFTY DASHBOARD: included index row; optionGate="+(niftyReady?"PASSED":"NOT PASSED — WATCH ONLY"));
}
const finalTrade=dashboardRows.filter(r=>decision(r)==="TRADE").slice(0,ONE_TRADE_LIMIT);console.log(`SCANNER: option Top-20=${decisionRows.length}`);console.log(`DASHBOARD: option Top-5=${dashboardRows.length}`);console.log(`FINAL TRADE: ${finalTrade.length}`);let commodityOptions=[];try{const {scanCommodityOptions}=require("./commodityOptionsScanner");commodityOptions=await scanCommodityOptions(broker);console.log(`MCX OPTIONS: independent scan returned ${commodityOptions.length} candidates`);}catch(e){console.error(`MCX options scan failed without stopping stock scanner: ${e?.message||e}`)}let core=false,strategy=false;try{const sheetResult=await updateGoogleSheet({scannerData:decisionRows,dashboardData:dashboardRows});if(sheetResult?.success===false)throw new Error(`Google Sheet update partially failed: scanner=${JSON.stringify(sheetResult.scanner||{})}; dashboard=${JSON.stringify(sheetResult.dashboard||{})}`);core=true;}catch(e){console.error(`Sheet update failed: ${e?.message||e}`)}try{await updateStrategySheets(equityTop20,decisions,equityTop20,DIVIDEND_LONG_TERM_SYMBOLS.map(s=>dividendRows.find(r=>key(r)===String(s).toUpperCase())||{stock:s,symbol:s,rejectionReason:"NOT_SCANNED"}),commodityOptions);strategy=true;}catch(e){console.error(`Strategy sheet update failed: ${e?.message||e}`)}try{await buildDashboard(dashboardRows,decisions,equityUniverse.symbols.length)}catch(e){console.error(`Dashboard update failed: ${e?.message||e}`)}
if(niftyDashboard?.index)console.log(`NIFTY stock-style row routed through SCANNER Top-20 and compact Dashboard Top-5 | ${niftyDashboard.index.trend} | LTP=${niftyDashboard.index.price}`);const elapsed=((Date.now()-started.getTime())/1000).toFixed(1);const counts={call:dashboardRows.filter(r=>["CALL","CE"].includes(String(r.optionType).toUpperCase())).length,put:dashboardRows.filter(r=>["PUT","PE"].includes(String(r.optionType).toUpperCase())).length,trade:decisions.filter(r=>decision(r)==="TRADE").length,watch:decisions.filter(r=>decision(r)==="WATCH").length,reject:decisions.filter(r=>decision(r)==="REJECT").length};const status=buildScannerStatus({status:core&&strategy?"SUCCESS":"PARTIAL_FAILURE",startedAt:started,universe:equityUniverse.name,broker:brokerName,scanned:decisionRows.length,successfulScans:decisionRows.filter(r=>!String(r.rejectionReason||"").includes("ERROR")).length,failedScans:decisionRows.filter(r=>String(r.rejectionReason||"").includes("ERROR")).length,callCandidates:counts.call,putCandidates:counts.put,tradeCount:counts.trade,watchCount:counts.watch,rejectCount:counts.reject,elapsedSeconds:elapsed});try{await updateGoogleSheet({action:"scanner_status",scannerStatus:status})}catch(e){console.error(`Status update failed: ${e?.message||e}`)}console.log(`✅ V14 COMPLETE in ${elapsed}s | FNO=${fnoUniverse.symbols.length} | LiveFNO=${liveFnoRows.length} | OptionTop100=${top100.length} | ScannerTop20=${decisionRows.length} | DashboardTop5=${dashboardRows.length}`);return{universe:equityUniverse,fnoUniverse,liveFnoRows,top100OptionRows:top100,optionScanned,optionTop20,optionDecisions:decisions,scannerData:decisionRows,finalDashboard:dashboardRows,finalTrade,equityTop20,dividendRows,scannerStatus:status};}
if(require.main===module)main().catch(e=>{console.error(`FATAL: ${e?.stack||e}`);process.exitCode=1});
module.exports={main,scanInBatches,rankTop,rankOptionCandidates,rankDashboard,validOptionRow,sanitizeOptionRow,buildEquityCandidates,collectOptionEligible};
