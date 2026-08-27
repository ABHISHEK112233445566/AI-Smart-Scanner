const axios = require('axios');

const BASE_URL = 'https://api.upstox.com';
const CACHE_MS = 20_000;
const cache = new Map();

function token(){
  const t = process.env.UPSTOX_ACCESS_TOKEN;
  if(!t) throw new Error('UPSTOX_ACCESS_TOKEN is missing');
  return t;
}
function num(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function pct(a,b){ return b > 0 ? ((a-b)/b)*100 : 0; }
function directionFromPrice(v){ return v >= 0.10 ? 'UP' : v <= -0.10 ? 'DOWN' : 'FLAT'; }
function directionFromOI(v){ return v >= 1 ? 'UP' : v <= -1 ? 'DOWN' : 'FLAT'; }
function mood(priceChangePct, oiChangePct){
  const p=directionFromPrice(priceChangePct), o=directionFromOI(oiChangePct);
  if(p==='UP'&&o==='UP') return ['LONG BUILDUP','BULLISH'];
  if(p==='DOWN'&&o==='UP') return ['SHORT BUILDUP','BEARISH'];
  if(p==='UP'&&o==='DOWN') return ['SHORT COVERING','BULLISH'];
  if(p==='DOWN'&&o==='DOWN') return ['LONG UNWINDING','BEARISH'];
  return ['NEUTRAL','NEUTRAL'];
}

async function getUnderlyingOIMood({instrumentKey,currentPrice,previousPrice}={}){
  const key=String(instrumentKey||'').trim();
  if(!key) return {mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:'NO_UNDERLYING_KEY'};
  const cached=cache.get(key);
  if(cached && Date.now()-cached.at<CACHE_MS) return {...cached.value,cached:true};
  try{
    const r=await axios.get(`${BASE_URL}/v2/option/chain`,{
      params:{instrument_key:key,expiry_date:'current_month'},
      headers:{Accept:'application/json',Authorization:`Bearer ${token()}`},
      timeout:12000
    });
    const rows=Array.isArray(r?.data?.data)?r.data.data:[];
    if(!rows.length) throw new Error('EMPTY_OPTION_CHAIN');
    let callOI=0,putOI=0,prevCallOI=0,prevPutOI=0;
    for(const row of rows){
      const c=row?.call_options?.market_data||{}, p=row?.put_options?.market_data||{};
      callOI+=Math.max(0,num(c.oi)); putOI+=Math.max(0,num(p.oi));
      prevCallOI+=Math.max(0,num(c.prev_oi)); prevPutOI+=Math.max(0,num(p.prev_oi));
    }
    const oi=callOI+putOI, previousOI=prevCallOI+prevPutOI;
    const oiChange=oi-previousOI, oiChangePercent=pct(oi,previousOI);
    const price=num(currentPrice), prevPrice=num(previousPrice);
    if(!(oi>0&&previousOI>0&&price>0&&prevPrice>0)){
      const value={mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:'INCOMPLETE_OI_OR_PRICE',oi,previousOI,oiChange,oiChangePercent,callOI,putOI,prevCallOI,prevPutOI,source:'UPSTOX_OPTION_CHAIN_CURRENT_MONTH'};
      cache.set(key,{at:Date.now(),value}); return value;
    }
    const priceChange=price-prevPrice, priceChangePercent=pct(price,prevPrice);
    const [m,s]=mood(priceChangePercent,oiChangePercent);
    const value={mood:m,sentiment:s,dataAvailable:true,priceChange,priceChangePercent,oiChange,oiChangePercent,oi,previousOI,callOI,putOI,prevCallOI,prevPutOI,source:'UPSTOX_OPTION_CHAIN_CURRENT_MONTH',reason:'OK'};
    cache.set(key,{at:Date.now(),value}); return value;
  }catch(e){
    const value={mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:`OI_API_FAILED:${e?.response?.status||e?.message||'UNKNOWN'}`};
    cache.set(key,{at:Date.now(),value});
    return value;
  }
}

module.exports={getUnderlyingOIMood};
