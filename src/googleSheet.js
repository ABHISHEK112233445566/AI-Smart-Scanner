// ============================================================
// AI SMART SCANNER — GOOGLE SHEET UPLOADER V8
// ============================================================
// OI Mood is mandatory on every SCANNER / Dashboard / ACCURACY row.
// If valid current + previous price/OI are supplied, mood is calculated
// from the per-stock OI engine. If upstream OI is unavailable, the sheet
// explicitly records UNKNOWN rather than silently leaving the field blank.
// ============================================================
const axios = require('axios');
const config = require('./config');
const { calculateOIMoodForStock } = require('./oiMood');

const DASHBOARD_MIN_SCORE = Number(config.THRESHOLDS?.DASHBOARD_MIN_SCORE ?? config.DASHBOARD_MIN_SCORE ?? 85);
const DASHBOARD_MAX_ROWS = Number(config.THRESHOLDS?.DASHBOARD_MAX_ROWS ?? config.DASHBOARD_MAX_ROWS ?? 10);
const MIN_CONFIDENCE = Number(config.THRESHOLDS?.MIN_CONFIDENCE ?? 70);
const MIN_RR = Number(config.THRESHOLDS?.MIN_RR ?? 1.5);
const GOOGLE_TIMEOUT = 120000;
const REQUIRED_OI_HEADERS = ['oiMood', 'oiSentiment', 'oiDataAvailable', 'oiPriceChangePercent', 'oiChangePercent'];

function getGoogleSheetUrl() {
  return process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.GOOGLE_SCRIPT_URL ||
    process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_SHEET_URL ||
    process.env.GOOGLE_APPS_SCRIPT_URL || config.GOOGLE_SHEET_WEBHOOK_URL ||
    config.GOOGLE_SCRIPT_URL || config.GOOGLE_SHEETS_WEBHOOK_URL ||
    config.GOOGLE_SHEET_URL || config.GOOGLE_APPS_SCRIPT_URL || null;
}
function n(v) { const x=Number(v); return Number.isFinite(x)?x:null; }
function rr(row={}) { const x=n(row.riskReward ?? row.rr); return x!==null&&x>0?x:0; }
function isValidTradeRow(row={}) { const c=n(row.confidence ?? row.optionsConfidence) ?? 0; return c>=MIN_CONFIDENCE && rr(row)>=MIN_RR; }
function dashboardScore(row={}) { return n(row.rankingScore ?? row.finalScore ?? row.aiFinalScore ?? row.aiScore ?? row.scannerScore ?? row.score) ?? 0; }
function selectDashboardRows(rows=[]) {
  return (Array.isArray(rows)?rows:[]).filter(row=>dashboardScore(row)>=DASHBOARD_MIN_SCORE)
    .sort((a,b)=>dashboardScore(b)-dashboardScore(a)).slice(0,DASHBOARD_MAX_ROWS);
}

function addOIMood(row={}) {
  const stock = row && typeof row === 'object' ? row : {};
  let mood = null;
  try { mood = calculateOIMoodForStock(stock); } catch (_) { mood = null; }
  const suppliedMood = String(stock.oiMood ?? stock.OIMood ?? stock.oi_mood ?? '').trim();
  const suppliedSentiment = String(stock.oiSentiment ?? stock.OISentiment ?? '').trim();

  return {
    ...stock,
    // A non-empty value is compulsory. UNKNOWN explicitly means upstream
    // OI data was not available/reliable for this stock.
    oiMood: suppliedMood || mood?.mood || 'UNKNOWN',
    oiSentiment: suppliedSentiment || mood?.sentiment || 'UNKNOWN',
    oiDataAvailable: mood?.dataAvailable === true || stock.oiDataAvailable === true,
    oiPriceChangePercent: n(stock.oiPriceChangePercent ?? mood?.priceChangePercent) ?? 0,
    oiChangePercent: n(stock.oiChangePercent ?? mood?.oiChangePercent) ?? 0
  };
}

function cleanCell(v) {
  if(v===undefined||v===null)return '';
  if(v instanceof Date)return v.toISOString();
  if(typeof v==='number')return Number.isFinite(v)?v:'';
  if(typeof v==='boolean')return v;
  if(typeof v==='object'){try{return JSON.stringify(v);}catch(_){return String(v);}}
  return String(v);
}

function buildSheetPayload(sheet,objects=[]) {
  const rows=Array.isArray(objects)?objects.filter(Boolean).map(addOIMood):[];
  const set=new Set(REQUIRED_OI_HEADERS),headers=[...REQUIRED_OI_HEADERS];
  for(const row of rows)for(const key of Object.keys(row))if(!set.has(key)){set.add(key);headers.push(key);}
  if(!headers.length)headers.push('status');
  return {action:'replaceSheet',sheet,clearFirst:true,headers,rows:rows.map(r=>headers.map(h=>cleanCell(r[h]))),timestamp:new Date().toISOString()};
}

async function postToGoogleSheet(payload){
  const url=getGoogleSheetUrl(); if(!url)throw new Error('Google Sheet webhook URL is not configured');
  return axios.post(url,payload,{timeout:GOOGLE_TIMEOUT,headers:{'Content-Type':'application/json'}});
}
async function postReplaceSheet(sheet,objects){
  const response=await postToGoogleSheet(buildSheetPayload(sheet,objects));
  if(response?.data?.success===false)throw new Error(`Google Sheets rejected ${sheet}: ${response.data.error||'unknown error'}`);
  return response?.data||{};
}

async function postAccuracyRows(rows=[]) {
  const list=Array.isArray(rows)?rows.filter(Boolean):[]; if(!list.length)return {success:true,rowCount:0};
  const now=new Date();
  const enriched=list.map(row=>{
    const oi=addOIMood(row);
    return {
      ...oi,
      accuracyPredictionTime: row.accuracyPredictionTime || row.timestamp || now.toISOString(),
      accuracySnapshotTime: now.toISOString(),
      livePrice: n(row.livePrice ?? row.currentPrice ?? row.price ?? row.ltp),
      predictedDirection: row.predictedDirection || row.direction || row.optionType || '',
      predictedEntry: n(row.predictedEntry ?? row.entry),
      predictedStopLoss: n(row.predictedStopLoss ?? row.stopLoss),
      predictedTarget1: n(row.predictedTarget1 ?? row.target1),
      predictedTarget2: n(row.predictedTarget2 ?? row.target2),
      predictedRiskReward: rr(row),
      evaluationStatus: row.evaluationStatus || 'PENDING',
      actualPrice: n(row.actualPrice),
      evaluationResult: row.evaluationResult || 'PENDING'
    };
  });
  const set=new Set(REQUIRED_OI_HEADERS),headers=[...REQUIRED_OI_HEADERS];
  for(const row of enriched)for(const key of Object.keys(row))if(!set.has(key)){set.add(key);headers.push(key);}
  const response=await postToGoogleSheet({action:'appendRows',sheet:'ACCURACY',headers,rows:enriched.map(r=>headers.map(h=>cleanCell(r[h]))),timestamp:now.toISOString()});
  if(response?.data?.success===false)throw new Error(`Google Sheets rejected ACCURACY: ${response.data.error||'unknown error'}`);
  return response?.data||{};
}

async function updateGoogleSheet(payload={}) {
  if(!payload||typeof payload!=='object')throw new Error('Google Sheet payload must be an object');
  if(String(payload.action||'').trim()==='scanner_status'){
    const response=await postToGoogleSheet({action:'scanner_status',scannerStatus:payload.scannerStatus||payload.status||{}});
    if(response?.data?.success===false)throw new Error(`Google Sheets rejected SCANNER_STATUS: ${response.data.error||'unknown error'}`);
    return response?.data||{};
  }
  const scannerData=Array.isArray(payload.scannerData)?payload.scannerData:[];
  const dashboardData=Array.isArray(payload.dashboardData)?payload.dashboardData:[];
  const accuracyData=Array.isArray(payload.accuracyData)?payload.accuracyData:[];
  const scanner=await postReplaceSheet('SCANNER',scannerData);
  const dashboard=await postReplaceSheet('Dashboard',dashboardData);
  const accuracy=await postAccuracyRows(accuracyData);
  return {success:true,scanner,dashboard,accuracy,scannerRows:scannerData.length,dashboardRows:dashboardData.length,accuracyRows:accuracyData.length};
}

function buildScannerStatus({status='SUCCESS',startedAt,universe='ALL',broker=process.env.BROKER||'UPSTOX',scanned=0,successfulScans=0,failedScans=0,callCandidates=0,putCandidates=0,tradeCount=0,watchCount=0,rejectCount=0,elapsedSeconds=0}={}){
  const completedAt=new Date(); const started=startedAt instanceof Date?startedAt:new Date(startedAt||completedAt);
  return {status:String(status).toUpperCase(),lastScanTime:completedAt.toISOString(),lastScanTimeIST:new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(completedAt).replace(',',''),lastScanSource:process.env.GITHUB_ACTIONS?'GitHub Actions':'Local',broker:String(broker||'UPSTOX').toUpperCase(),universe:String(universe||'ALL').toUpperCase(),stocksScanned:Number(scanned)||0,successfulScans:Number(successfulScans)||0,failedScans:Number(failedScans)||0,callCandidates:Number(callCandidates)||0,putCandidates:Number(putCandidates)||0,tradeCount:Number(tradeCount)||0,watchCount:Number(watchCount)||0,rejectCount:Number(rejectCount)||0,elapsedSeconds:Number(elapsedSeconds)||0,durationMs:Math.max(0,completedAt.getTime()-started.getTime())};
}

module.exports={updateGoogleSheet,postToGoogleSheet,getGoogleSheetUrl,selectDashboardRows,isValidTradeRow,rr,buildScannerStatus,DASHBOARD_MIN_SCORE,DASHBOARD_MAX_ROWS,MIN_CONFIDENCE,MIN_RR,addOIMood};
