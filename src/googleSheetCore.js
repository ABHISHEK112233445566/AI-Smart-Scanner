// ============================================================
// AI SMART SCANNER — GOOGLE SHEET UPLOADER
// ============================================================
const axios=require('axios');
const config=require('./config');
const {calculateOIMoodForStock}=require('./oiMood');

const DASHBOARD_MIN_ROWS=5;
const DASHBOARD_SCORE=Number(process.env.DASHBOARD_MIN_SCORE??5);
const MIN_CONFIDENCE=Number(config.THRESHOLDS?.MIN_CONFIDENCE??70);
const MIN_RR=Number(config.THRESHOLDS?.MIN_RR??1.5);
const REQUIRED_OI_HEADERS=['oiMood','oiSentiment','oiDataAvailable','oiPriceChangePercent','oiChangePercent'];
const DASHBOARD_HEADERS=['stockPrice','symbol','optionType','entryPrice','bestStrike','optionLTP','confidence','target','stopLoss','oiMood','volume','avgVolume5','volumeRatio5','volumeConfirmed5','newsStatus','newsHeadline','newsSource','newsAge'];
const GOOGLE_TIMEOUT=120000;

function getGoogleSheetUrl(){
    const raw=process.env.GOOGLE_SHEET_WEBHOOK_URL||process.env.GOOGLE_SCRIPT_URL||process.env.GOOGLE_SHEETS_WEBHOOK_URL||process.env.GOOGLE_SHEET_URL||process.env.GOOGLE_APPS_SCRIPT_URL||config.GOOGLE_SHEET_WEBHOOK_URL||config.GOOGLE_SCRIPT_URL||config.GOOGLE_SHEETS_WEBHOOK_URL||config.GOOGLE_SHEET_URL||config.GOOGLE_APPS_SCRIPT_URL||null;
    if(!raw)return null;
    return String(raw).trim().replace(/\/$/,'');
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function score(r={}){return n(r.scannerScore??r.score)??0;}
function magnitude(r={}){return Math.min(100,Math.abs(score(r)));}
function direction(r={}){const d=String(r.direction??r.finalDirection??r.optionType??'').trim().toUpperCase();if(['CALL','CE','BUY','BULLISH','UP','LONG'].includes(d))return'BULLISH';if(['PUT','PE','SELL','BEARISH','DOWN','SHORT'].includes(d))return'BEARISH';return'SIDEWAYS';}
function optionType(r={}){const v=String(r.optionType??r.optionSymbol??'').toUpperCase();if(v.includes('PUT')||v==='PE'||v.includes(' PE'))return'PE';if(v.includes('CALL')||v==='CE'||v.includes(' CE'))return'CE';return direction(r)==='BEARISH'?'PE':direction(r)==='BULLISH'?'CE':'';}
function addOIMood(r={}){const x=r&&typeof r==='object'?r:{};let m=null;try{m=calculateOIMoodForStock(x);}catch(_){ }return{...x,oiMood:String(x.oiMood??x.OIMood??x.oi_mood??m?.mood??'UNKNOWN').trim()||'UNKNOWN',oiSentiment:String(x.oiSentiment??x.OISentiment??m?.sentiment??'UNKNOWN').trim()||'UNKNOWN',oiDataAvailable:m?.dataAvailable===true||x.oiDataAvailable===true,oiPriceChangePercent:n(x.oiPriceChangePercent??m?.priceChangePercent)??0,oiChangePercent:n(x.oiChangePercent??m?.oiChangePercent)??0};}
function selectDashboardRows(rows=[]){const list=(Array.isArray(rows)?rows:[]).filter(Boolean).map(addOIMood).filter(r=>direction(r)!=='SIDEWAYS');const ranked=[...list].sort((a,b)=>{const ds=magnitude(b)-magnitude(a);if(ds)return ds;return(n(b.confidence)??0)-(n(a.confidence)??0);});const actionable=ranked.filter(r=>r?.qualified===true&&magnitude(r)>=DASHBOARD_SCORE&&String(r?.rejectionReason??"").toUpperCase().indexOf("ERROR")<0);const nifty=actionable.find(r=>["NIFTY","NIFTY 50"].includes(String(r.symbol??r.stock??"").trim().toUpperCase()));if(!nifty)return actionable.slice(0,DASHBOARD_MIN_ROWS);return [...actionable.filter(r=>r!==nifty).slice(0,DASHBOARD_MIN_ROWS-1),nifty];}
function dashboardRow(r={}){return{stockPrice:n(r.stockPrice??r.price??r.livePrice??r.currentPrice??r.ltp),symbol:String(r.symbol??r.stock??r.tradingSymbol??'').trim(),optionType:optionType(r),entryPrice:n(r.stockEntry??r.underlyingEntry??r.marketEntry??r.entry??r.stockPrice??r.price??r.currentPrice),bestStrike:n(r.recommendedStrike??r.optionStrike??r.atmStrike),optionLTP:n(r.optionPremiumEntry??r.optionLTP??r.optionEntry),confidence:n(r.optionsConfidence??r.confidence),target:n(r.stockTarget1??r.target1??r.target),stopLoss:n(r.stockStopLoss??r.stopLoss),oiMood:String(r.oiMood??'UNKNOWN'),volume:n(r.volume),avgVolume5:n(r.avgVolume5),volumeRatio5:n(r.volumeRatio5),volumeConfirmed5:r.volumeConfirmed5===true,newsStatus:String(r.newsStatus??'NO_MAJOR_NEWS'),newsHeadline:String(r.newsHeadline??''),newsSource:String(r.newsSource??''),newsAge:String(r.newsAge??'')};}
function clean(v){if(v==null)return'';if(typeof v==='number')return Number.isFinite(v)?v:'';if(typeof v==='boolean')return v;if(typeof v==='object'){try{return JSON.stringify(v);}catch(_){return String(v);}}return String(v);}
function toIST(v){if(!v)return'';const d=v instanceof Date?new Date(v.getTime()):new Date(v);if(Number.isNaN(d.getTime()))return String(v);const p=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d).reduce((o,x)=>(o[x.type]=x.value,o),{});return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} IST`;}
function buildSheetPayload(sheet,objects=[]){const rows=(Array.isArray(objects)?objects:[]).filter(Boolean).map(addOIMood),headers=[];const seen=new Set();REQUIRED_OI_HEADERS.forEach(h=>{seen.add(h);headers.push(h);});rows.forEach(r=>Object.keys(r).forEach(k=>{if(!seen.has(k)){seen.add(k);headers.push(k);}}));return{action:'replaceSheet',sheet,clearFirst:true,headers,rows:rows.map(r=>headers.map(h=>h==='score'||h==='finalScore'||h==='rankingScore'||h==='aiFinalScore'?Math.max(-100,Math.min(100,Number(r[h])||0)):clean(r[h]))),timestamp:new Date().toISOString()};}
function buildDashboardPayload(rows=[]){const selected=selectDashboardRows(rows).map(dashboardRow);return{action:'replaceSheet',sheet:'Dashboard',clearFirst:true,headers:DASHBOARD_HEADERS,rows:selected.map(r=>DASHBOARD_HEADERS.map(h=>clean(r[h]))),timestamp:new Date().toISOString()};}
async function postToGoogleSheet(payload){
    const url=getGoogleSheetUrl();
    if(!url)throw new Error('Google Sheet webhook URL is not configured.');
    try{
        const r=await axios.post(url,payload,{timeout:GOOGLE_TIMEOUT,headers:{'Content-Type':'application/json'},validateStatus:()=>true});
        if(r.status<200||r.status>=300){const body=typeof r.data==='string'?r.data:JSON.stringify(r.data??{});const preview=body.replace(/\s+/g,' ').slice(0,300);throw new Error(`Google Apps Script HTTP ${r.status} for action ${payload?.action||'unknown'} / sheet ${payload?.sheet||'n/a'}: ${preview}`);}
        if(r.data&&typeof r.data==='object'&&r.data.success===false)throw new Error(`Google Apps Script rejected action ${payload?.action||'unknown'} / sheet ${payload?.sheet||'n/a'}: ${r.data.error||'unknown error'}`);
        return r;
    }catch(e){
        if(e?.response){const body=typeof e.response.data==='string'?e.response.data:JSON.stringify(e.response.data??{});throw new Error(`Google Apps Script request failed: HTTP ${e.response.status||'unknown'}: ${body.replace(/\s+/g,' ').slice(0,300)}`);}
        throw e;
    }
}
async function updateNiftyDashboard(niftyDashboard={}){const r=await postToGoogleSheet({action:'nifty_dashboard',title:'NIFTY 50 INDEX SCAN',headers:Array.isArray(niftyDashboard.headers)?niftyDashboard.headers:[],rows:Array.isArray(niftyDashboard.rows)?niftyDashboard.rows:[],index:niftyDashboard.index||{}});return r?.data||{};}
async function postReplaceSheet(sheet,objects){const r=await postToGoogleSheet(buildSheetPayload(sheet,objects));return r?.data||{};}
async function postDashboard(rows){const r=await postToGoogleSheet(buildDashboardPayload(rows));return r?.data||{};}
async function updateGoogleSheet(payload={}){
    if(String(payload.action||'').trim()==='scanner_status'){const r=await postToGoogleSheet({action:'scanner_status',scannerStatus:payload.scannerStatus||payload.status||{}});return r?.data||{};}
    const scannerData=Array.isArray(payload.scannerData)?payload.scannerData:[];
    const dashboardData=Array.isArray(payload.dashboardData)?payload.dashboardData:[];
    const scanner=await postReplaceSheet('SCANNER',scannerData);
    const dashboard=await postDashboard(dashboardData);
    return{success:true,scanner,dashboard,scannerRows:scannerData.length,dashboardRows:selectDashboardRows(dashboardData).length};
}
function buildScannerStatus(x={}){const now=new Date();return{status:String(x.status||'SUCCESS').toUpperCase(),lastScanTime:now.toISOString(),lastScanTimeIST:toIST(now),lastScanSource:process.env.GITHUB_ACTIONS?'GitHub Actions':'Local',broker:String(x.broker||process.env.BROKER||'UPSTOX').toUpperCase(),universe:String(x.universe||'ALL').toUpperCase(),stocksScanned:Number(x.scanned)||0,successfulScans:Number(x.successfulScans)||0,failedScans:Number(x.failedScans)||0,callCandidates:Number(x.callCandidates)||0,putCandidates:Number(x.putCandidates)||0,tradeCount:Number(x.tradeCount)||0,watchCount:Number(x.watchCount)||0,rejectCount:Number(x.rejectCount)||0,elapsedSeconds:Number(x.elapsedSeconds)||0,durationMs:Number(x.durationMs)||0};}
module.exports={updateGoogleSheet,updateNiftyDashboard,postToGoogleSheet,getGoogleSheetUrl,selectDashboardRows,score,magnitude,direction,buildScannerStatus,DASHBOARD_MAX_ROWS:DASHBOARD_MIN_ROWS,MIN_CONFIDENCE,MIN_RR,addOIMood,buildDashboardPayload,postDashboard};
