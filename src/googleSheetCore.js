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
const DASHBOARD_HEADERS=['stockPrice','symbol','optionType','entryPrice','bestStrike','optionLTP','confidence','target','stopLoss','oiMood','volume','avgVolume5','volumeRatio5','volumeConfirmed5','newsStatus','newsHeadline','newsSource','newsAge','niftyAnalysisBias','niftyAnalysisConfidence','niftyAnalysisStatus','niftyChainDataQuality','niftyChainStrikesScanned','niftyChainContractsScanned','niftyChainValidContracts','niftyBullishEvidence','niftyBearishEvidence','niftyNeutralEvidence','niftyOptionChainSummary','niftyAnalysisReason','niftyAnalysisDetails','niftyAnalysisUpdatedAt','optionsDecision','optionEligible','optionRejectionReason','optionContractIdentityValid','optionLiveDataAvailable','optionLiquidityConfirmed','stockVolumeConfirmed'];
const GOOGLE_TIMEOUT=120000;

function getGoogleSheetUrl(){
    const raw=process.env.GOOGLE_SHEET_WEBHOOK_URL||process.env.GOOGLE_SCRIPT_URL||process.env.GOOGLE_SHEETS_WEBHOOK_URL||process.env.GOOGLE_SHEET_URL||process.env.GOOGLE_APPS_SCRIPT_URL||config.GOOGLE_SHEET_WEBHOOK_URL||config.GOOGLE_SCRIPT_URL||config.GOOGLE_SHEETS_WEBHOOK_URL||config.GOOGLE_SHEET_URL||config.GOOGLE_APPS_SCRIPT_URL||null;
    if(!raw)return null;
    return String(raw).trim().replace(/\/$/,'');
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function score(r={}){for(const value of [r.finalScore,r.rankingScore,r.aiFinalScore,r.scannerScore,r.score]){const x=n(value);if(x!==null&&x!==0)return x;}return 0;}
function magnitude(r={}){return Math.min(100,Math.abs(score(r)));}
function direction(r={}){
  // Prefer a usable directional value over a generic SIDEWAYS/NEUTRAL field.
  const values=[r.stockDirection,r.technicalDirection,r.direction,r.finalDirection,r.optionType,r.cePe,r.side]
    .map(v=>String(v??'').trim().toUpperCase());
  for(const d of values){
    if(['CALL','CE','BUY','BULLISH','UP','LONG'].includes(d)||d.includes('BULLISH'))return'BULLISH';
    if(['PUT','PE','SELL','BEARISH','DOWN','SHORT'].includes(d)||d.includes('BEARISH'))return'BEARISH';
  }
  return'SIDEWAYS';
}
function optionType(r={}){const v=String(r.optionType??r.optionSymbol??'').toUpperCase();if(v.includes('PUT')||v==='PE'||v.includes(' PE'))return'PE';if(v.includes('CALL')||v==='CE'||v.includes(' CE'))return'CE';return direction(r)==='BEARISH'?'PE':direction(r)==='BULLISH'?'CE':'';}
function addOIMood(r={}){const x=r&&typeof r==='object'?r:{};let m=null;try{m=calculateOIMoodForStock(x);}catch(_){ }return{...x,oiMood:String(x.oiMood??x.OIMood??x.oi_mood??m?.mood??'UNKNOWN').trim()||'UNKNOWN',oiSentiment:String(x.oiSentiment??x.OISentiment??m?.sentiment??'UNKNOWN').trim()||'UNKNOWN',oiDataAvailable:m?.dataAvailable===true||x.oiDataAvailable===true,oiPriceChangePercent:n(x.oiPriceChangePercent??m?.priceChangePercent)??0,oiChangePercent:n(x.oiChangePercent??m?.oiChangePercent)??0};}
function selectDashboardRows(rows=[]){
  const list=(Array.isArray(rows)?rows:[]).filter(Boolean).map(addOIMood);
  const ranked=[...list].sort((a,b)=>(magnitude(b)-magnitude(a))||((n(b.confidence)??0)-(n(a.confidence)??0)));
  const niftyName=r=>["NIFTY","NIFTY 50"].includes(String(r?.symbol??r?.stock??"").trim().toUpperCase());
  const noError=r=>String(r?.rejectionReason??"").toUpperCase().indexOf("ERROR")<0;
  const validPrice=r=>[r?.stockPrice,r?.price,r?.currentPrice,r?.ltp].map(n).find(v=>v!==null&&v>0)>0;
  const nifty=list.find(r=>niftyName(r)&&validPrice(r)&&noError(r));
  const actionable=ranked.filter(r=>{
    if(niftyName(r)||magnitude(r)<DASHBOARD_SCORE||!noError(r))return false;
    const rating=String(r?.rating??r?.aiRating??"").toUpperCase(),signal=String(r?.signal??"").toUpperCase();
    if(rating.includes("AVOID")||signal==="AVOID")return false;
    return ["BULLISH","BEARISH"].includes(direction(r));
  });
  if(!nifty)return actionable.slice(0,DASHBOARD_MIN_ROWS);
  return [...actionable.slice(0,DASHBOARD_MIN_ROWS-1),nifty];
}
function dashboardRow(r={}){const contract=r.optionLiquidityContractData&&typeof r.optionLiquidityContractData==='object'?r.optionLiquidityContractData:{};const strike=n(r.recommendedStrike??r.bestStrike??r.optionStrike??r.atmStrike??contract.strike??contract.strike_price??contract.strikePrice);const premium=n(r.optionPremiumEntry??r.optionLTP??r.optionLtp??r.optionEntry??r.optionPrice??r.optionLiquidityLTP);return{stockPrice:n(r.stockPrice??r.price??r.livePrice??r.currentPrice??r.ltp),symbol:String(r.symbol??r.stock??r.tradingSymbol??'').trim(),optionType:optionType(r),entryPrice:premium>0?premium:0,bestStrike:strike>0?strike:0,optionLTP:premium>0?premium:0,confidence:n(r.optionsConfidence??r.confidence),target:n(r.stockTarget1??r.underlyingTarget1??r.tradeSetup?.stockTarget1),stopLoss:n(r.stockStopLoss??r.underlyingStopLoss??r.tradeSetup?.stockStopLoss),oiMood:String(r.oiMood??'UNKNOWN'),volume:n(r.volume),avgVolume5:n(r.avgVolume5),volumeRatio5:n(r.volumeRatio5),volumeConfirmed5:r.volumeConfirmed5===true,newsStatus:String(r.newsStatus??'NO_MAJOR_NEWS'),newsHeadline:String(r.newsHeadline??''),newsSource:String(r.newsSource??''),newsAge:String(r.newsAge??''),niftyAnalysisBias:String(r.niftyAnalysisBias??''),niftyAnalysisConfidence:n(r.niftyAnalysisConfidence),niftyAnalysisStatus:String(r.niftyAnalysisStatus??''),niftyChainDataQuality:String(r.niftyChainDataQuality??''),niftyChainStrikesScanned:n(r.niftyChainStrikesScanned),niftyChainContractsScanned:n(r.niftyChainContractsScanned),niftyChainValidContracts:n(r.niftyChainValidContracts),niftyBullishEvidence:n(r.niftyBullishEvidence),niftyBearishEvidence:n(r.niftyBearishEvidence),niftyNeutralEvidence:n(r.niftyNeutralEvidence),niftyOptionChainSummary:String(r.niftyOptionChainSummary??''),niftyAnalysisReason:String(r.niftyAnalysisReason??''),niftyAnalysisDetails:String(r.niftyAnalysisDetails??''),niftyAnalysisUpdatedAt:String(r.niftyAnalysisUpdatedAt??''),optionsDecision:String(r.optionsDecision??r.decision??'WATCH').trim().toUpperCase(),optionEligible:r.optionEligible===true&&r.optionDataValid===true,optionRejectionReason:String([r.optionRejectionReason,r.decisionReason,r.contractLookupReason,r.rejectionReason,r.reason].find(v=>String(v??'').trim())||(strike>0&&premium>0?'TRADE_GATES_NOT_PASSED':'NO_VALID_LIVE_OPTION_CONTRACT_OR_PREMIUM')),optionContractIdentityValid:r.optionContractIdentityValid===true,optionLiveDataAvailable:r.optionLiveDataAvailable===true,optionLiquidityConfirmed:r.optionLiquidityConfirmed===true,stockVolumeConfirmed:r.volumeConfirmed5===true};}
function clean(v){if(v==null)return'';if(typeof v==='number')return Number.isFinite(v)?v:'';if(typeof v==='boolean')return v;if(typeof v==='object'){try{return JSON.stringify(v);}catch(_){return String(v);}}return String(v);}
function toIST(v){if(!v)return'';const d=v instanceof Date?new Date(v.getTime()):new Date(v);if(Number.isNaN(d.getTime()))return String(v);const p=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d).reduce((o,x)=>(o[x.type]=x.value,o),{});return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} IST`;}
function buildSheetPayload(sheet,objects=[]){const rows=(Array.isArray(objects)?objects:[]).filter(Boolean).map(addOIMood),headers=[];const seen=new Set();REQUIRED_OI_HEADERS.forEach(h=>{seen.add(h);headers.push(h);});rows.forEach(r=>Object.keys(r).forEach(k=>{if(!seen.has(k)){seen.add(k);headers.push(k);}}));return{action:'replaceSheet',sheet,clearFirst:true,headers,rows:rows.map(r=>headers.map(h=>/date|expiry|timestamp|updatedat|lasttradetime/i.test(h)&&(r[h]===0||r[h]==='0'||r[h]===null||r[h]===undefined||r[h]==='')?'':h==='score'||h==='finalScore'||h==='rankingScore'||h==='aiFinalScore'?Math.max(-100,Math.min(100,Number(r[h])||0)):clean(r[h]))),timestamp:new Date().toISOString()};}
function buildDashboardPayload(rows=[]){const selected=selectDashboardRows(rows).map(r=>{const decision=String(r.optionsDecision??r.decision??'').trim().toUpperCase();return dashboardRow(decision==='REJECT'?{...r,optionsDecision:'WATCH',decision:'WATCH',optionEligible:false,optionDataValid:false}:r);});if(!selected.length)selected.push(dashboardRow({stock:'NO CURRENT DIRECTIONAL CANDIDATE',symbol:'NO CURRENT DIRECTIONAL CANDIDATE',optionsDecision:'WATCH',decision:'WATCH',optionEligible:false,optionDataValid:false,optionRejectionReason:'NO_DIRECTIONAL_CANDIDATE_PASSED_MINIMUM_SCORE_OR_DIRECTION_GATES'}));return{action:'replaceSheet',sheet:'Dashboard',clearFirst:true,headers:DASHBOARD_HEADERS,rows:selected.map(r=>DASHBOARD_HEADERS.map(h=>clean(r[h]))),timestamp:new Date().toISOString()};}
async function postToGoogleSheet(payload){
    const url=getGoogleSheetUrl();
    if(!url)throw new Error('Google Sheet webhook URL is not configured.');
    try{
        const r=await axios.post(url,payload,{timeout:GOOGLE_TIMEOUT,headers:{'Content-Type':'application/json'},validateStatus:()=>true});
        if(r.status<200||r.status>=300){const body=typeof r.data==='string'?r.data:JSON.stringify(r.data??{});const preview=body.replace(/\s+/g,' ').slice(0,300);throw new Error(`Google Apps Script HTTP ${r.status} for action ${payload?.action||'unknown'} / sheet ${payload?.sheet||'n/a'}: ${preview}`);}
        // A 200 response is not proof that Apps Script wrote the sheet:
        // expired deployments and permission pages often return HTML with status 200.
        // Accept only an explicit JSON success acknowledgement.
        let body=r.data;
        if(typeof body==='string'){
            const trimmed=body.trim();
            if(!trimmed.startsWith('{')&&!trimmed.startsWith('[')){
                throw new Error(`Google Apps Script returned non-JSON content for action ${payload?.action||'unknown'} / sheet ${payload?.sheet||'n/a'} (possible stale deployment, access page, or wrong webhook URL): ${trimmed.replace(/\\s+/g,' ').slice(0,250)}`);
            }
            try{body=JSON.parse(trimmed);}catch(parseError){
                throw new Error(`Google Apps Script returned invalid JSON for action ${payload?.action||'unknown'} / sheet ${payload?.sheet||'n/a'}: ${parseError.message}`);
            }
        }
        if(!body||typeof body!=='object'||body.success!==true){
            const detail=body&&typeof body==='object'?(body.error||JSON.stringify(body).slice(0,250)):'empty or invalid response';
            throw new Error(`Google Apps Script did not confirm success for action ${payload?.action||'unknown'} / sheet ${payload?.sheet||'n/a'}: ${detail}`);
        }
        r.data=body;
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
    const selectedDashboard=selectDashboardRows(dashboardData);
    const scannerTask=scannerData.length?postReplaceSheet('SCANNER',scannerData):Promise.resolve({skipped:true,reason:'EMPTY_SCAN_PRESERVED_EXISTING_SHEET'});
    const dashboardTask=postDashboard(dashboardData);
    const [scannerResult,dashboardResult]=await Promise.allSettled([scannerTask,dashboardTask]);
    const scanner=scannerResult.status==='fulfilled'?scannerResult.value:{success:false,error:scannerResult.reason?.message||String(scannerResult.reason)};
    const dashboard=dashboardResult.status==='fulfilled'?dashboardResult.value:{success:false,error:dashboardResult.reason?.message||String(dashboardResult.reason)};
    return{success:scannerResult.status==='fulfilled'&&dashboardResult.status==='fulfilled',scanner,dashboard,scannerRows:scannerData.length,dashboardRows:selectedDashboard.length,scannerPreserved:scannerData.length===0,dashboardPreserved:selectedDashboard.length===0};
}
function buildScannerStatus(x={}){const now=new Date();return{status:String(x.status||'SUCCESS').toUpperCase(),lastScanTime:now.toISOString(),lastScanTimeIST:toIST(now),lastScanSource:process.env.GITHUB_ACTIONS?'GitHub Actions':'Local',broker:String(x.broker||process.env.BROKER||'UPSTOX').toUpperCase(),universe:String(x.universe||'ALL').toUpperCase(),stocksScanned:Number(x.scanned)||0,successfulScans:Number(x.successfulScans)||0,failedScans:Number(x.failedScans)||0,callCandidates:Number(x.callCandidates)||0,putCandidates:Number(x.putCandidates)||0,tradeCount:Number(x.tradeCount)||0,watchCount:Number(x.watchCount)||0,rejectCount:Number(x.rejectCount)||0,elapsedSeconds:Number(x.elapsedSeconds)||0,durationMs:Number(x.durationMs)||0};}
module.exports={updateGoogleSheet,updateNiftyDashboard,postToGoogleSheet,getGoogleSheetUrl,selectDashboardRows,score,magnitude,direction,buildScannerStatus,DASHBOARD_MAX_ROWS:DASHBOARD_MIN_ROWS,MIN_CONFIDENCE,MIN_RR,addOIMood,buildDashboardPayload,postDashboard};
