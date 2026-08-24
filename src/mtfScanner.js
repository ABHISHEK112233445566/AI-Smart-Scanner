// ============================================================
// MULTI TIMEFRAME SCANNER V11
// ============================================================
// Broker-independent MTF analysis.
// IMPORTANT: Upstox/other brokers are not required to provide native 4H.
// 4H is deterministically built from 1H candles so the scanner never
// silently loses its 4H timeframe.
// ============================================================

const { getBroker } = require('./brokers');
const { calculateIndicators } = require('./indicators');

function emptyTrend(reason='NO_DATA') {
  return { trend:'UNKNOWN', direction:'UNKNOWN', bullish:false, bearish:false, score:0, bullishPoints:0, bearishPoints:0, valid:false, reason };
}
function num(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }
function normalize(candles){
  if(!Array.isArray(candles)) return [];
  return candles.map(c=>({
    timestamp:c?.timestamp ?? c?.time ?? c?.datetime ?? c?.date ?? c?.[0],
    time:c?.time ?? c?.timestamp ?? c?.datetime ?? c?.date ?? c?.[0],
    open:num(c?.open ?? c?.o ?? c?.[1]), high:num(c?.high ?? c?.h ?? c?.[2]),
    low:num(c?.low ?? c?.l ?? c?.[3]), close:num(c?.close ?? c?.c ?? c?.[4]), volume:num(c?.volume ?? c?.v ?? c?.[5])
  })).filter(c=>c.open>0&&c.high>0&&c.low>0&&c.close>0&&c.high>=c.low&&c.high>=c.open&&c.high>=c.close&&c.low<=c.open&&c.low<=c.close)
    .sort((a,b)=>new Date(a.time)-new Date(b.time));
}
function normalizeDirection(v){ const s=String(v||'').toUpperCase(); if(s.includes('BULLISH')) return 'BULLISH'; if(s.includes('BEARISH')) return 'BEARISH'; return 'UNKNOWN'; }
function calculateTrend(symbol, interval, candles){
  try {
    const data=normalize(candles); if(data.length<50) return emptyTrend('INSUFFICIENT_CANDLES');
    const d=calculateIndicators(data); if(!d) return emptyTrend('INDICATOR_FAILURE');
    const e20=num(d.ema20), e50=num(d.ema50), e200=num(d.ema200), rsi=num(d.rsi);
    const m=d.macd&&typeof d.macd==='object'?d.macd:{}; const macd=num(m.MACD??m.macd??d.macdValue), signal=num(m.signal??m.Signal??d.macdSignal);
    const a=d.adx&&typeof d.adx==='object'?d.adx:{}; const adx=num(a.adx??a.ADX??d.adxValue), pdi=num(a.pdi??a.PDI??d.pdi), mdi=num(a.mdi??a.MDI??d.mdi);
    let bull=0,bear=0;
    if(e20&&e50){ if(e20>e50) bull++; else if(e20<e50) bear++; }
    if(e50&&e200){ if(e50>e200) bull++; else if(e50<e200) bear++; }
    const last=data[data.length-1].close; if(last>e20) bull++; else if(last<e20) bear++;
    if(rsi>50) bull++; else if(rsi>0&&rsi<50) bear++;
    if(macd>signal) bull++; else if(macd<signal) bear++;
    if(adx>=20){ if(pdi>mdi) bull++; else if(mdi>pdi) bear++; }
    const bullish=bull>=3&&bull>bear, bearish=bear>=3&&bear>bull;
    const trend=bullish?(bull>=4?'STRONG BULLISH':'BULLISH'):bearish?(bear>=4?'STRONG BEARISH':'BEARISH'):'SIDEWAYS';
    return {trend,direction:normalizeDirection(trend),bullish,bearish,score:bullish?bull:-bear,bullishPoints:bull,bearishPoints:bear,valid:true,reason:'OK'};
  } catch(e){ console.log(`⚠️ ${symbol} ${interval} MTF failed: ${e.message}`); return emptyTrend('CALCULATION_ERROR'); }
}
function bucket4H(candles){
  const data=normalize(candles); if(!data.length) return [];
  const buckets=new Map();
  for(const c of data){
    const d=new Date(c.time); if(Number.isNaN(d.getTime())) continue;
    // NSE session-aligned 4H buckets: 09:15-13:15 and 13:15-17:15.
    const key=new Date(d); key.setMinutes(d.getMinutes()>=15?15:0,0,0); key.setHours(d.getHours()-(d.getHours()%4));
    const k=key.toISOString();
    const prev=buckets.get(k);
    if(!prev) buckets.set(k,{time:c.time,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume});
    else { prev.high=Math.max(prev.high,c.high); prev.low=Math.min(prev.low,c.low); prev.close=c.close; prev.volume+=c.volume; }
  }
  return [...buckets.values()].sort((a,b)=>new Date(a.time)-new Date(b.time));
}
async function getTrend(symbol, interval){
  try{
    const broker=getBroker(); if(!broker||typeof broker.getHistoricalData!=='function') throw new Error('Active broker does not implement getHistoricalData()');
    if(interval==='FOUR_HOUR'){
      const oneHour=await broker.getHistoricalData(symbol,'ONE_HOUR');
      const fourHour=bucket4H(oneHour);
      return calculateTrend(symbol,interval,fourHour);
    }
    return calculateTrend(symbol,interval,await broker.getHistoricalData(symbol,interval));
  }catch(e){ console.log(`⚠️ ${symbol} ${interval} MTF failed: ${e.message}`); return emptyTrend('BROKER_DATA_ERROR'); }
}
async function getMultiTimeframeAnalysis(symbol){
  const [daily,fourHour,oneHour,fifteen]=await Promise.all([
    getTrend(symbol,'ONE_DAY'),getTrend(symbol,'FOUR_HOUR'),getTrend(symbol,'ONE_HOUR'),getTrend(symbol,'FIFTEEN_MINUTE')
  ]);
  const t=[daily,fourHour,oneHour,fifteen], weights=[30,30,20,20];
  let mtfScore=0; t.forEach((x,i)=>{if(x.bullish)mtfScore+=weights[i];else if(x.bearish)mtfScore-=weights[i];});
  const valid=t.filter(x=>x.valid), bull=valid.filter(x=>x.bullish).length, bear=valid.filter(x=>x.bearish).length;
  const alignment=Math.max(bull,bear);
  const bias=bull>bear?'BULLISH':bear>bull?'BEARISH':'NEUTRAL';
  let overallTrend='SIDEWAYS'; if(mtfScore>=70)overallTrend='STRONG BULLISH';else if(mtfScore>=40)overallTrend='BULLISH';else if(mtfScore<=-70)overallTrend='STRONG BEARISH';else if(mtfScore<=-40)overallTrend='BEARISH';
  let alignmentLabel='MIXED'; if(valid.length===4&&bull===4)alignmentLabel='FULL BULLISH'; else if(valid.length===4&&bear===4)alignmentLabel='FULL BEARISH'; else if(bull>=3&&bull>bear)alignmentLabel='BULLISH ALIGNED'; else if(bear>=3&&bear>bull)alignmentLabel='BEARISH ALIGNED'; else if(!bull&&!bear)alignmentLabel='UNKNOWN';
  return {
    dailyTrend:daily.direction,fourHourTrend:fourHour.direction,oneHourTrend:oneHour.direction,fifteenMinTrend:fifteen.direction,
    dailyTrendLabel:daily.trend,fourHourTrendLabel:fourHour.trend,oneHourTrendLabel:oneHour.trend,fifteenMinTrendLabel:fifteen.trend,
    mtfScore,bullishTimeframes:bull,bearishTimeframes:bear,unknownTimeframes:t.length-valid.length,validTimeframes:valid.length,
    directionBias:bias,overallTrend,alignment:alignmentLabel,mtfAlignment:alignment,alignedTimeframes:alignment,
    details:{daily,fourHour,oneHour,fifteen}
  };
}
module.exports={getMultiTimeframeAnalysis,getTrend,bucket4H};
