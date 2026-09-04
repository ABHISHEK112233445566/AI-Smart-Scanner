const {getBroker}=require('./brokers');
const {getGoogleSheetUrl}=require('./googleSheet');
const {evaluateAccuracy}=require('./accuracyTracker');
const axios=require('axios');
const TIMEFRAME='FIVE_MINUTE',MAX_ROWS=500,ACCURACY_WRITE_BATCH_SIZE=50;
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
const clean=v=>String(v??'').trim();
const parseDate=v=>{if(!v)return null;const d=v instanceof Date?new Date(v.getTime()):new Date(v);return Number.isNaN(d.getTime())?null:d;};
async function sheetRequest(payload){const url=getGoogleSheetUrl();if(!url)throw new Error('Google Sheet webhook URL is not configured');return axios.post(url,payload,{timeout:120000,headers:{'Content-Type':'application/json'}});}
async function readAccuracyRows(){const r=await sheetRequest({action:'getAccuracyRows',limit:MAX_ROWS});if(r?.data?.success===false)throw new Error(r.data.error||'Google Sheets rejected getAccuracyRows');return Array.isArray(r?.data?.rows)?r.data.rows:[];}
function directionFromOptionType(v){const t=clean(v).toUpperCase();return t==='CE'||t==='CALL'?'CALL':t==='PE'||t==='PUT'?'PUT':'';}
function rowToRecord(row){const pt=parseDate(row.predictionTime)||new Date();const dir=directionFromOptionType(row.optionType);return{recordId:clean(row.recordId),timestamp:pt.toISOString(),date:pt.toISOString().slice(0,10),time:pt.toISOString().slice(11,19),stock:clean(row.symbol),symbol:clean(row.symbol),direction:dir,decision:'TRADE',confidence:n(row.confidence),stockPriceAtSignal:n(row.stockPrice),stockEntry:n(row.predictedEntry),stockStopLoss:n(row.stopLoss),stockTarget1:n(row.target),stockTarget2:null,targetSLReached:clean(row.targetSLReached).toUpperCase()||'PENDING',slReason:clean(row.slReason),resultTime:clean(row.resultTime),resultPrice:n(row.resultPrice),accuracyPercent:n(row.accuracyPercent),evaluationStatus:clean(row.targetSLReached).toUpperCase()==='PENDING'?'PENDING':'COMPLETED',evaluationDate:''};}
function liveCandle(q){const ltp=n(q?.ltp??q?.last_price);if(!(ltp>0))return null;const rawTime=q?.lastTradeTime??q?.last_trade_time??q?.timestamp;let time=parseDate(rawTime);if(!time&&/^[0-9]+$/.test(String(rawTime||'')))time=new Date(Number(rawTime));return{time:(time||new Date()).toISOString(),open:n(q?.open)||ltp,high:n(q?.high)||ltp,low:n(q?.low)||ltp,close:ltp,volume:n(q?.volume)||0};}
function quoteLtp(q){return n(q?.ltp??q?.last_price??q?.data?.last_price??q?.data?.[q?.instrumentKey]?.last_price);}
function updatePayload(record,currentPrice){return{recordId:record.recordId,currentPrice:n(currentPrice),targetSLReached:record.targetSLReached||'PENDING',slReason:record.slReason||'',resultTime:record.resultTime||'',resultPrice:record.resultPrice??'',accuracyPercent:record.accuracyPercent??0};}
async function writeAccuracyUpdates(updates){
  if(!updates.length)return{updated:0,notFound:0};
  let updated=0,notFound=0;
  const totalBatches=Math.ceil(updates.length/ACCURACY_WRITE_BATCH_SIZE);
  for(let i=0;i<updates.length;i+=ACCURACY_WRITE_BATCH_SIZE){
    const batch=updates.slice(i,i+ACCURACY_WRITE_BATCH_SIZE);
    const batchNo=Math.floor(i/ACCURACY_WRITE_BATCH_SIZE)+1;
    const r=await sheetRequest({action:'updateAccuracy',updates:batch});
    if(r?.data?.success===false)throw new Error(r.data.error||'Google Sheets rejected accuracy update');
    updated+=Number(r?.data?.updated||0);
    notFound+=Number(r?.data?.notFound||0);
    console.log(`📊 ACCURACY SHEET WRITE: batch ${batchNo}/${totalBatches} updated=${Number(r?.data?.updated||0)} notFound=${Number(r?.data?.notFound||0)}`);
  }
  return{updated,notFound};
}
async function evaluateLiveAccuracy(){const rows=await readAccuracyRows();if(!rows.length)return{found:0,evaluated:0,updated:0,skipped:0,istNormalized:0};const broker=getBroker();if(!broker?.getHistoricalData||!broker?.getQuote)throw new Error('Active broker must implement getHistoricalData() and getQuote()');const cache=new Map(),updates=[];let skipped=0;for(const raw of rows){const record=rowToRecord(raw);if(!record.recordId||!record.symbol||!record.direction){skipped++;continue;}try{const q=await broker.getQuote(record.symbol);const current=quoteLtp(q);const locked=['TARGET','SL'].includes(record.targetSLReached);if(locked){updates.push(updatePayload(record,current));continue;}if(!cache.has(record.symbol))cache.set(record.symbol,await broker.getHistoricalData(record.symbol,TIMEFRAME));let candles=[...(Array.isArray(cache.get(record.symbol))?cache.get(record.symbol):[])];const lc=liveCandle(q?.data?.[q?.instrumentKey]||q);if(lc)candles.push(lc);candles.sort((a,b)=>(parseDate(a?.time)?.getTime()||0)-(parseDate(b?.time)?.getTime()||0));const evaluated=evaluateAccuracy(record,candles,new Date());updates.push(updatePayload(evaluated,current));console.log(`📡 ACCURACY ${record.symbol}: LTP=${current??'-'} result=${evaluated.targetSLReached} slReason=${evaluated.slReason||'-'}`);}catch(e){console.log(`⚠️ Accuracy live evaluation failed ${record.symbol}: ${e.message}`);skipped++;}}const result=await writeAccuracyUpdates(updates);return{found:rows.length,evaluated:updates.length,updated:Number(result.updated||0),notFound:Number(result.notFound||0),skipped,istNormalized:0};}
module.exports={evaluateLiveAccuracy};