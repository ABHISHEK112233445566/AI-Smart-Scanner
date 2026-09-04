const axios=require('axios');
const config=require('./config');

const DASHBOARD_MAX_ROWS=5;
const MIN_DASHBOARD_ROWS=5;
const MIN_CONFIDENCE=Number(config.THRESHOLDS?.MIN_CONFIDENCE??70);
const MIN_RR=Number(config.THRESHOLDS?.MIN_RR??1.5);
const REQUIRED_OI_HEADERS=['oiMood','oiSentiment','oiDataAvailable','oiPriceChangePercent','oiChangePercent'];
const DASHBOARD_HEADERS=['stockPrice','symbol','optionType','entryPrice','bestStrike','optionLTP','confidence','target','stopLoss','oiMood'];
const ACCURACY_HEADERS=['recordId','predictionTime','symbol','stockPrice','optionType','confidence','predictedEntry','target','stopLoss','currentPrice','targetSLReached','slReason','resultTime','resultPrice','accuracyPercent'];
const GOOGLE_TIMEOUT=120000;

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function magnitude(r={}){return n(r.aiFinalScore??r.scannerScore??r.score??r.confidence)??0;}
function toIST(v=new Date()){
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return '';
  return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d).replace(',','')+' IST';
}
function addOIMood(r={}){return {...r,oiMood:r.oiMood??r.oiSentiment??''};}
function dashboardRow(r={}){
  return {
    stockPrice:r.stockPrice??r.price??r.currentPrice??'',
    symbol:r.symbol??r.stock??'',
    optionType:r.optionType??'',
    entryPrice:r.stockEntry??r.underlyingEntry??r.entry??r.entryPrice??'',
    bestStrike:r.recommendedStrike??r.bestStrike??r.strike??'',
    optionLTP:r.optionPremiumEntry??r.optionLTP??r.optionEntry??'',
    confidence:r.optionsConfidence??r.confidence??r.aiFinalScore??r.score??'',
    target:r.stockTarget??r.target1??r.target??'',
    stopLoss:r.stockStopLoss??r.stopLoss??'',
    oiMood:r.oiMood??r.oiSentiment??''
  };
}

function hasUsableOptionData(r={}){
  const contract=Boolean(r.optionInstrumentKey||r.optionSymbol||r.recommendedStrike||r.bestStrike||r.optionType);
  const ltp=n(r.optionPremiumEntry??r.optionLTP??r.optionEntry);
  return contract||ltp!==null;
}

function selectDashboardRows(rows=[]){
  const source=Array.isArray(rows)?rows.filter(Boolean):[];
  const seen=new Set();
  const valid=source.filter(r=>{
    const symbol=String(r.symbol??r.stock??r.tradingSymbol??'').trim().toUpperCase();
    if(symbol&&seen.has(symbol))return false;
    if(symbol)seen.add(symbol);
    return Boolean(symbol||magnitude(r)>0);
  }).sort((a,b)=>{
    const ar=magnitude(a),br=magnitude(b);
    const ac=n(a.optionsConfidence??a.confidence)??0,bc=n(b.optionsConfidence??b.confidence)??0;
    const ao=hasUsableOptionData(a)?1:0,bo=hasUsableOptionData(b)?1:0;
    return (br+bc+bo*.01)-(ar+ac+ao*.01);
  });

  const above80=valid.filter(r=>magnitude(r)>=80);
  if(above80.length>0){
    if(above80.length>=MIN_DASHBOARD_ROWS)return above80.map(addOIMood).map(dashboardRow);
    const below80=valid.filter(r=>magnitude(r)<80);
    return [...above80,...below80.slice(0,MIN_DASHBOARD_ROWS-above80.length)].map(addOIMood).map(dashboardRow);
  }
  return valid.slice(0,MIN_DASHBOARD_ROWS).map(addOIMood).map(dashboardRow);
}

function getGoogleSheetUrl(){
  return process.env.GOOGLE_SHEET_WEBHOOK_URL||process.env.GOOGLE_SHEET_URL||config.GOOGLE_SHEET_WEBHOOK_URL||config.GOOGLE_SHEET_URL||'';
}
function buildSheetPayload(sheet,rows=[]){
  const safeRows=Array.isArray(rows)?rows:[];
  const headers=[...new Set(safeRows.flatMap(r=>r&&typeof r==='object'?Object.keys(r):[]))];
  return {action:safeRows.length?'replaceSheet':'clearSheet',sheet,clearFirst:true,headers,rows:safeRows};
}
function buildDashboardPayload(rows=[]){
  const selected=selectDashboardRows(rows);
  return {action:'replaceSheet',sheet:'Dashboard',clearFirst:true,headers:DASHBOARD_HEADERS,rows:selected};
}
function buildAccuracyPayload(rows=[]){
  const safeRows=(Array.isArray(rows)?rows:[]).map(r=>({...r,predictionTime:toIST(r.predictionTime),resultTime:r.resultTime?toIST(r.resultTime):''}));
  return {action:'appendRows',sheet:'Accuracy',headers:ACCURACY_HEADERS,rows:safeRows};
}
async function postToGoogleSheet(payload={}){
  const url=getGoogleSheetUrl();
  if(!url)throw new Error('Google Sheet webhook URL is missing');
  return axios.post(url,payload,{timeout:GOOGLE_TIMEOUT,headers:{'Content-Type':'application/json'}});
}
async function postReplaceSheet(sheet,rows=[]){
  if(!Array.isArray(rows)||rows.length===0)throw new Error(`Refusing to clear ${sheet}: no rows available`);
  const response=await postToGoogleSheet(buildSheetPayload(sheet,rows));
  if(response?.data?.success===false)throw new Error(`${sheet} sheet rejected update: ${response.data.message||'unknown error'}`);
  return response?.data||{};
}
async function postDashboard(rows=[]){
  const selected=selectDashboardRows(rows);
  if(selected.length===0)throw new Error('Refusing to clear Dashboard: no valid candidates available');
  const response=await postToGoogleSheet({action:'replaceSheet',sheet:'Dashboard',clearFirst:true,headers:DASHBOARD_HEADERS,rows:selected});
  if(response?.data?.success===false)throw new Error(`Dashboard sheet rejected update: ${response.data.message||'unknown error'}`);
  return {...(response?.data||{}),rowsWritten:selected.length};
}
async function postAccuracyRows(rows=[]){
  if(!Array.isArray(rows)||rows.length===0)return {success:true,rowsWritten:0,skipped:true};
  const response=await postToGoogleSheet(buildAccuracyPayload(rows));
  if(response?.data?.success===false)throw new Error(`Accuracy sheet rejected update: ${response.data.message||'unknown error'}`);
  return response?.data||{};
}
async function updateGoogleSheet(payload={}){
  if(!payload||typeof payload!=='object')throw new Error('Google Sheet payload must be an object');
  if(String(payload.action||'').trim()==='scanner_status'){
    const response=await postToGoogleSheet({action:'scanner_status',scannerStatus:payload.scannerStatus||payload.status||{}});
    if(response?.data?.success===false)throw new Error(response.data.message||'scanner_status update failed');
    return response?.data||{};
  }

  const scannerData=Array.isArray(payload.scannerData)?payload.scannerData.filter(Boolean):[];
  const dashboardData=Array.isArray(payload.dashboardData)?payload.dashboardData.filter(Boolean):[];
  const accuracyData=Array.isArray(payload.accuracyData)?payload.accuracyData.filter(Boolean):[];
  const dashboardSource=dashboardData.length?dashboardData:scannerData;
  const result={success:true,scanner:null,dashboard:null,accuracy:null,scannerRows:scannerData.length,dashboardRows:0,accuracyRows:accuracyData.length,warnings:[]};

  if(!scannerData.length){
    result.success=false;
    result.warnings.push('SCANNER write skipped because scannerData is empty; existing sheet was preserved.');
  }else{
    try{
      result.scanner=await postReplaceSheet('SCANNER',scannerData);
      console.log('📤 SCANNER SHEET:',JSON.stringify(result.scanner));
    }catch(error){
      result.success=false;
      result.warnings.push(`SCANNER write failed: ${error.message}`);
      console.error('❌ SCANNER SHEET WRITE:',error.message);
    }
  }

  try{
    const selected=selectDashboardRows(dashboardSource);
    result.dashboardRows=selected.length;
    if(!selected.length){
      result.success=false;
      result.warnings.push('Dashboard write skipped because no valid candidates were available; existing sheet was preserved.');
    }else{
      result.dashboard=await postDashboard(dashboardSource);
      console.log('📤 DASHBOARD SHEET:',JSON.stringify(result.dashboard));
    }
  }catch(error){
    result.success=false;
    result.warnings.push(`Dashboard write failed: ${error.message}`);
    console.error('❌ DASHBOARD SHEET WRITE:',error.message);
  }

  try{
    result.accuracy=await postAccuracyRows(accuracyData);
    console.log('📤 ACCURACY SHEET:',JSON.stringify(result.accuracy));
  }catch(error){
    result.success=false;
    result.warnings.push(`Accuracy write failed: ${error.message}`);
    console.error('❌ ACCURACY SHEET WRITE:',error.message);
  }

  console.log('📊 GOOGLE SHEET RESULT:',JSON.stringify(result));
  return result;
}

function buildScannerStatus(status={}){
  return {action:'scanner_status',scannerStatus:{...status,updatedAt:toIST(status.updatedAt||new Date())}};
}

module.exports={
  updateGoogleSheet,buildScannerStatus,buildSheetPayload,buildDashboardPayload,buildAccuracyPayload,selectDashboardRows,toIST,getGoogleSheetUrl,
  ACCURACY_HEADERS,DASHBOARD_HEADERS,REQUIRED_OI_HEADERS,MIN_CONFIDENCE,MIN_RR,DASHBOARD_MAX_ROWS,MIN_DASHBOARD_ROWS
};