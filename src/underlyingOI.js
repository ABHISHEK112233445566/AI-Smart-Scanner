const axios=require('axios');

const BASE_URL='https://api.upstox.com';
const CACHE_MS=20000;
const REQUEST_GAP_MS=250;
const MAX_429_RETRIES=3;
const cache=new Map();
let lastRequestAt=0;
let requestQueue=Promise.resolve();

function token(){
  const t=process.env.UPSTOX_ACCESS_TOKEN;
  if(!t)throw new Error('UPSTOX_ACCESS_TOKEN is missing');
  return t;
}
function num(v,f=0){
  const n=Number(v);
  return Number.isFinite(n)?n:f;
}
function pct(a,b){
  return b>0?((a-b)/b)*100:0;
}
function priceDir(v){
  return v>=0.10?'UP':v<=-0.10?'DOWN':'FLAT';
}
function oiDir(v){
  return v>=1?'UP':v<=-1?'DOWN':'FLAT';
}
function classify(pc,oc){
  const p=priceDir(pc),o=oiDir(oc);
  if(p==='UP'&&o==='UP')return['LONG BUILDUP','BULLISH'];
  if(p==='DOWN'&&o==='UP')return['SHORT BUILDUP','BEARISH'];
  if(p==='UP'&&o==='DOWN')return['SHORT COVERING','BULLISH'];
  if(p==='DOWN'&&o==='DOWN')return['LONG UNWINDING','BEARISH'];
  return['NEUTRAL','NEUTRAL'];
}
function sleep(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}
function queuedRequest(fn){
  const run=requestQueue.then(async()=>{
    const wait=Math.max(0,REQUEST_GAP_MS-(Date.now()-lastRequestAt));
    if(wait)await sleep(wait);
    lastRequestAt=Date.now();
    return fn();
  });
  requestQueue=run.catch(()=>{});
  return run;
}
async function getOptionChain(key,headers){
  let lastError;
  for(let attempt=0;attempt<=MAX_429_RETRIES;attempt++){
    try{
      return await queuedRequest(()=>axios.get(`${BASE_URL}/v2/option/chain`,{
        params:{instrument_key:key,expiry_date:'current_month'},
        headers,
        timeout:12000
      }));
    }catch(e){
      lastError=e;
      if(Number(e?.response?.status)!==429||attempt===MAX_429_RETRIES)throw e;
      await sleep(500*(attempt+1));
    }
  }
  throw lastError;
}

async function getUnderlyingOIMood({instrumentKey,currentPrice,previousPrice}={}){
  const key=String(instrumentKey||'').trim();
  if(!key)return{mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:'NO_UNDERLYING_KEY'};

  const cached=cache.get(key);
  if(cached&&Date.now()-cached.at<CACHE_MS)return{...cached.value,cached:true};

  try{
    const h={
      Accept:'application/json',
      Authorization:`Bearer ${token()}`
    };

    // Upstox supports relative expiry keywords on the option-chain API.
    // Fetch the chain directly instead of making a separate /option/contract
    // request first. This removes one API call per stock and reduces 429 risk.
    const r=await getOptionChain(key,h);
    const rows=Array.isArray(r?.data?.data)?r.data.data:[];

    if(!rows.length)throw new Error('EMPTY_OPTION_CHAIN:current_month');

    let callOI=0,putOI=0,prevCallOI=0,prevPutOI=0;
    for(const row of rows){
      const c=row?.call_options?.market_data||{};
      const p=row?.put_options?.market_data||{};
      callOI+=Math.max(0,num(c.oi));
      putOI+=Math.max(0,num(p.oi));
      prevCallOI+=Math.max(0,num(c.prev_oi??c.previous_oi));
      prevPutOI+=Math.max(0,num(p.prev_oi??p.previous_oi));
    }

    const expiry=String(rows[0]?.expiry||'current_month');
    const oi=callOI+putOI;
    const previousOI=prevCallOI+prevPutOI;
    const oiChange=oi-previousOI;
    const oiChangePercent=pct(oi,previousOI);
    const price=num(currentPrice);
    const prevPrice=num(previousPrice);

    if(!(oi>0&&previousOI>0&&price>0&&prevPrice>0)){
      const value={
        mood:'UNKNOWN',
        sentiment:'UNKNOWN',
        dataAvailable:false,
        reason:'INCOMPLETE_OI_OR_PRICE',
        oi,
        previousOI,
        oiChange,
        oiChangePercent,
        callOI,
        putOI,
        prevCallOI,
        prevPutOI,
        expiry,
        source:`UPSTOX_OPTION_CHAIN_${expiry}`
      };
      cache.set(key,{at:Date.now(),value});
      return value;
    }

    const priceChange=price-prevPrice;
    const priceChangePercent=pct(price,prevPrice);
    const [mood,sentiment]=classify(priceChangePercent,oiChangePercent);

    const value={
      mood,
      sentiment,
      dataAvailable:true,
      priceChange,
      priceChangePercent,
      oiChange,
      oiChangePercent,
      oi,
      previousOI,
      callOI,
      putOI,
      prevCallOI,
      prevPutOI,
      expiry,
      source:'UPSTOX_OPTION_CHAIN',
      reason:'OK'
    };

    cache.set(key,{at:Date.now(),value});
    return value;
  }catch(e){
    const status=Number(e?.response?.status)||0;
    const detail=e?.response?.data?.errors?.[0]?.message||e?.response?.data?.message||e?.message||'UNKNOWN';
    const value={
      mood:'UNKNOWN',
      sentiment:'UNKNOWN',
      dataAvailable:false,
      reason:`OI_API_FAILED:${status||detail}`
    };
    cache.set(key,{at:Date.now(),value});
    return value;
  }
}

module.exports={getUnderlyingOIMood};
