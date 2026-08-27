// ============================================================
// AI SMART SCANNER — GOOGLE SHEET UPLOADER V14
// Dashboard: TOP 5 from option-ready Top-20 universe.
// IMPORTANT: Dashboard entry/SL/targets are STOCK (underlying) levels.
// Option LTP is displayed separately and is NEVER used as stock entry.
// ============================================================
const axios = require('axios');
const config = require('./config');
const { calculateOIMoodForStock } = require('./oiMood');

const DASHBOARD_MAX_ROWS = 5;
const MIN_CONFIDENCE = Number(config.THRESHOLDS?.MIN_CONFIDENCE ?? 70);
const MIN_RR = Number(config.THRESHOLDS?.MIN_RR ?? 1.5);
const REQUIRED_OI_HEADERS = ['oiMood','oiSentiment','oiDataAvailable','oiPriceChangePercent','oiChangePercent'];
const DASHBOARD_HEADERS = ['stockPrice','symbol','optionType','entryPrice','bestStrike','optionLTP','confidence','target','stopLoss','oiMood'];
const GOOGLE_TIMEOUT = 120000;

function getGoogleSheetUrl(){return process.env.GOOGLE_SHEET_WEBHOOK_URL||process.env.GOOGLE_SCRIPT_URL||process.env.GOOGLE_SHEETS_WEBHOOK_URL||process.env.GOOGLE_SHEET_URL||process.env.GOOGLE_APPS_SCRIPT_URL||config.GOOGLE_SHEET_WEBHOOK_URL||config.GOOGLE_SCRIPT_URL||config.GOOGLE_SHEETS_WEBHOOK_URL||config.GOOGLE_SHEET_URL||config.GOOGLE_APPS_SCRIPT_URL||null;}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function rr(row={}){const x=n(row.riskReward??row.stockRiskReward??row.rr);return x!==null&&x>0?x:0;}
function score(row={}){return n(row.finalScore??row.rankingScore??row.aiFinalScore??row.score??row.scannerScore)??0;}
function magnitude(row={}){return Math.abs(score(row));}
function direction(row={}){const d=String(row.direction??row.finalDirection??row.optionType??'').trim().toUpperCase();if(['CALL','CE','BUY','BULLISH','UP','LONG'].includes(d))return'BULLISH';if(['PUT','PE','SELL','BEARISH','DOWN','SHORT'].includes(d))return'BEARISH';return'SIDEWAYS';}
function normalizeSignedScore(row={}){const s=score(row),d=direction(row),m=Math.min(100,Math.abs(s));return d==='BULLISH'?m:d==='BEARISH'?-m:0;}
function tradeEligible(row={}){const decision=String(row.decision??row.optionsDecision??'').trim().toUpperCase();return decision==='TRADE';}
function optionType(row={}){const v=String(row.optionType??row.optionSymbol??'').toUpperCase();if(v.includes('PUT')||v.includes(' PE')||v==='PE')return'PE';if(v.includes('CALL')||v.includes(' CE')||v==='CE')return'CE';return direction(row)==='BEARISH'?'PE':direction(row)==='BULLISH'?'CE':'';}

function dashboardRow(row={}){
  const type=optionType(row);
  // STOCK/UNDERLYING entry — never option premium.
  const stockEntry=n(row.stockEntry??row.underlyingEntry??row.marketEntry??row.entry??row.stockPrice??row.price??row.currentPrice);
  const stockSL=n(row.stockStopLoss??row.stopLoss);
  const stockT1=n(row.stockTarget1??row.target1??row.target);
  return {
    stockPrice:n(row.stockPrice??row.price??row.livePrice??row.currentPrice??row.ltp),
    symbol:String(row.symbol??row.stock??row.tradingSymbol??'').trim(),
    optionType:type,
    entryPrice:stockEntry,
    bestStrike:n(row.recommendedStrike??row.optionStrike??row.atmStrike),
    optionLTP:n(row.optionPremiumEntry??row.optionLTP??row.optionEntry),
    confidence:n(row.optionsConfidence??row.confidence),
    target:stockT1,
    stopLoss:stockSL,
    oiMood:String(row.oiMood??row.OIMood??row.oi_mood??'UNKNOWN').trim().toUpperCase()||'UNKNOWN'
  };
}

// The caller supplies the option-ready Top-20. Keep selection independent of TRADE/WATCH/REJECT.
function selectDashboardRows(rows=[]){
  return (Array.isArray(rows)?rows:[]).filter(Boolean).filter(r=>{
    const hasContract=Boolean(r.optionInstrumentKey||r.optionSymbol||r.recommendedStrike||r.optionType);
    const ltp=n(r.optionPremiumEntry??r.optionLTP??r.optionEntry);
    return hasContract&&ltp!==null&&ltp>0;
  }).sort((a,b)=>{
    const ar=n(a.rankingScore??a.finalScore??a.aiFinalScore??a.score??a.scannerScore)??0;
    const br=n(b.rankingScore??b.finalScore??b.aiFinalScore??b.score??b.scannerScore)??0;
    const ac=n(a.optionsConfidence??a.confidence)??0;
    const bc=n(b.optionsConfidence??b.confidence)??0;
    return (br+bc)-(ar+ac);
  }).slice(0,DASHBOARD_MAX_ROWS).map(addOIMood).map(dashboardRow);
}
function addOIMood(row={}){const stock=row&&typeof row==='object'?row:{};let mood=null;try{mood=calculateOIMoodForStock(stock);}catch(_){mood=null;}return{...stock,oiMood:String(stock.oiMood??stock.OIMood??stock.oi_mood??mood?.mood??'UNKNOWN').trim()||'UNKNOWN',oiSentiment:String(stock.oiSentiment??stock.OISentiment??mood?.sentiment??'UNKNOWN').trim()||'UNKNOWN',oiDataAvailable:mood?.dataAvailable===true||stock.oiDataAvailable===true,oiPriceChangePercent:n(stock.oiPriceChangePercent??mood?.priceChangePercent)??0,oiChangePercent:n(stock.oiChangePercent??mood?.oiChangePercent)??0};}
function cleanCell(v){if(v===undefined||v===null)return'';if(v instanceof Date)return v.toISOString();if(typeof v==='number')return Number.isFinite(v)?v:'';if(typeof v==='boolean')return v;if(typeof v==='object'){try{return JSON.stringify(v);}catch(_){return String(v);}}return String(v);}
function buildSheetPayload(sheet,objects=[]){const rows=(Array.isArray(objects)?objects:[]).filter(Boolean).map(addOIMood),headers=[],seen=new Set();REQUIRED_OI_HEADERS.forEach(h=>{seen.add(h);headers.push(h);});rows.forEach(row=>Object.keys(row).forEach(k=>{if(!seen.has(k)){seen.add(k);headers.push(k);}}));const outRows=rows.map(row=>uniqueHeaders.map(h=>{if(h==='score'||h==='finalScore'||h==='rankingScore'||h==='aiFinalScore')return normalizeSignedScore(row);return cleanCell(row[h]);}));const uniqueHeaders=[];const hs=new Set();for(const h of headers)if(!hs.has(h)){hs.add(h);uniqueHeaders.push(h);}return{action:'replaceSheet',sheet,clearFirst:true,headers:uniqueHeaders,rows:outRows,timestamp:new Date().toISOString()};}
function buildDashboardPayload(rows=[]){const selected=selectDashboardRows(rows);return{action:'replaceSheet',sheet:'Dashboard',clearFirst:true,headers:DASHBOARD_HEADERS,rows:selected.map(r=>DASHBOARD_HEADERS.map(h=>cleanCell(r[h]))),timestamp:new Date().toISOString()};}
async function postToGoogleSheet(payload={}){const url=getGoogleSheetUrl();if(!url)throw new Error('Google Sheet webhook URL is not configured');return axios.post(url,payload,{timeout:GOOGLE_TIMEOUT,headers:{'Content-Type':'application/json'}});}
async function postReplaceSheet(sheet,objects){const response=await postToGoogleSheet(buildSheetPayload(sheet,objects));if(response?.data?.success===false)throw new Error(`Google Sheets rejected ${sheet}: ${response.data.error||'unknown error'}`);return response?.data||{};}
async function postDashboard(rows){const response=await postToGoogleSheet(buildDashboardPayload(rows));if(response?.data?.success===false)throw new Error(`Google Sheets rejected Dashboard: ${response.data.error||'unknown error'}`);return response?.data||{};}
function buildAccuracyRow(row={}){const r=addOIMood(row),signed=normalizeSignedScore(r),d=direction(r),now=new Date().toISOString();return{...r,predictionId:String(r.predictionId??r.predictionID??`${r.symbol||r.stock||'UNKNOWN'}_${Date.now()}`).trim(),accuracyPredictionTime:r.accuracyPredictionTime||r.predictionTime||r.timestamp||now,accuracySnapshotTime:now,livePrice:n(r.livePrice??r.currentPrice??r.ltp??r.price),predictedDirection:r.predictedDirection||d,predictedScore:signed,predictedEntry:n(r.predictedEntry??r.stockEntry??r.entry),predictedStopLoss:n(r.predictedStopLoss??r.stockStopLoss??r.stopLoss),predictedTarget1:n(r.predictedTarget1??r.stockTarget1??r.target1),predictedTarget2:n(r.predictedTarget2??r.stockTarget2??r.target2),predictedRiskReward:rr(r),evaluationStatus:r.evaluationStatus||'PENDING',actualPrice:n(r.actualPrice),evaluationResult:r.evaluationResult||'PENDING'};}
async function postAccuracyRows(rows=[]){const list=(Array.isArray(rows)?rows:[]).filter(Boolean);if(!list.length)return{success:true,rowCount:0};const enriched=list.map(buildAccuracyRow),headers=[],seen=new Set();REQUIRED_OI_HEADERS.forEach(h=>{seen.add(h);headers.push(h);});enriched.forEach(row=>Object.keys(row).forEach(k=>{if(!seen.has(k)){seen.add(k);headers.push(k);}}));const response=await postToGoogleSheet({action:'appendRows',sheet:'ACCURACY',headers,rows:enriched.map(row=>headers.map(h=>h==='score'||h==='finalScore'||h==='rankingScore'||h==='aiFinalScore'?normalizeSignedScore(row):cleanCell(row[h]))),timestamp:new Date().toISOString()});if(response?.data?.success===false)throw new Error(`Google Sheets rejected ACCURACY: ${response.data.error||'unknown error'}`);return response?.data||{};}
async function updateGoogleSheet(payload={}){if(!payload||typeof payload!=='object')throw new Error('Google Sheet payload must be an object');if(String(payload.action||'').trim()==='scanner_status'){const response=await postToGoogleSheet({action:'scanner_status',scannerStatus:payload.scannerStatus||payload.status||{}});if(response?.data?.success===false)throw new Error(`Google Sheets rejected SCANNER_STATUS: ${response.data.error||'unknown error'}`);return response?.data||{};}const scannerData=Array.isArray(payload.scannerData)?payload.scannerData:[],dashboardData=Array.isArray(payload.dashboardData)?payload.dashboardData:[],accuracyData=Array.isArray(payload.accuracyData)?payload.accuracyData:[],scanner=await postReplaceSheet('SCANNER',scannerData),dashboard=await postDashboard(dashboardData),accuracy=await postAccuracyRows(accuracyData);return{success:true,scanner,dashboard,accuracy,scannerRows:scannerData.length,dashboardRows:selectDashboardRows(dashboardData).length,accuracyRows:accuracyData.length};}
function buildScannerStatus({status='SUCCESS',startedAt,universe='ALL',broker=process.env.BROKER||'UPSTOX',scanned=0,successfulScans=0,failedScans=0,callCandidates=0,putCandidates=0,tradeCount=0,watchCount=0,rejectCount=0,elapsedSeconds=0}={}){const completedAt=new Date(),started=startedAt instanceof Date?startedAt:new Date(startedAt||completedAt),ist=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(completedAt).replace(',','');return{status:String(status).toUpperCase(),lastScanTime:completedAt.toISOString(),lastScanTimeIST:ist,lastScanSource:process.env.GITHUB_ACTIONS?'GitHub Actions':'Local',broker:String(broker||'UPSTOX').toUpperCase(),universe:String(universe||'ALL').toUpperCase(),stocksScanned:Number(scanned)||0,successfulScans:Number(successfulScans)||0,failedScans:Number(failedScans)||0,callCandidates:Number(callCandidates)||0,putCandidates:Number(putCandidates)||0,tradeCount:Number(tradeCount)||0,watchCount:Number(watchCount)||0,rejectCount:Number(rejectCount)||0,elapsedSeconds:Number(elapsedSeconds)||0,durationMs:Math.max(0,completedAt.getTime()-started.getTime())};}
module.exports={updateGoogleSheet,postToGoogleSheet,getGoogleSheetUrl,selectDashboardRows,tradeEligible,rr,score,magnitude,direction,normalizeSignedScore,buildAccuracyRow,postAccuracyRows,buildScannerStatus,DASHBOARD_MAX_ROWS,MIN_CONFIDENCE,MIN_RR,addOIMood,buildDashboardPayload,postDashboard};