const axios=require('axios');
const BASE_URL='https://api.upstox.com',CACHE_MS=20000,MAX_CONCURRENT=2,RETRY_429=3,cache=new Map();
let active=0;
const waiters=[];
function token(){const t=process.env.UPSTOX_ACCESS_TOKEN;if(!t)throw new Error('UPSTOX_ACCESS_TOKEN is missing');return t;}
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function pct(a,b){return b>0?((a-b)/b)*100:0;}
function priceDir(v){return v>=0.10?'UP':v<=-0.10?'DOWN':'FLAT';}
function oiDir(v){return v>=1?'UP':v<=-1?'DOWN':'FLAT';}
function classify(pc,oc){const p=priceDir(pc),o=oiDir(oc);if(p==='UP'&&o==='UP')return['LONG BUILDUP','BULLISH'];if(p==='DOWN'&&o==='UP')return['SHORT BUILDUP','BEARISH'];if(p==='UP'&&o==='DOWN')return['SHORT COVERING','BULLISH'];if(p==='DOWN'&&o==='DOWN')return['LONG UNWINDING','BEARISH'];return['NEUTRAL','NEUTRAL'];}
function normalizeExpiry(v){const s=String(v??'').trim();if(!s)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);}
function expiryFromContracts(contracts){const today=new Date();today.setHours(0,0,0,0);return[...new Set((contracts||[]).map(c=>normalizeExpiry(c?.expiry??c?.expiry_date)).filter(Boolean))].map(x=>({x,d:new Date(x+'T00:00:00')})).filter(x=>!Number.isNaN(x.d.getTime())&&x.d>=today).sort((a,b)=>a.d-b.d)[0]?.x||null;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function withLimit(fn){while(active>=MAX_CONCURRENT)await new Promise(resolve=>waiters.push(resolve));active++;try{return await fn();}finally{active--;waiters.shift()?.();}}
async function get(url,config){for(let attempt=0;;attempt++){try{return await withLimit(()=>axios.get(url,config));}catch(e){const status=e?.response?.status;if(status!==429||attempt>=RETRY_429)throw e;const retryAfter=Number(e?.response?.headers?.['retry-after']);const delay=Number.isFinite(retryAfter)&&retryAfter>0?Math.min(10000,retryAfter*1000):1000*Math.pow(2,attempt);await sleep(delay);}}}
async function getUnderlyingOIMood({instrumentKey,currentPrice,previousPrice}={}){
 const key=String(instrumentKey||'').trim();
 if(!key)return{mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:'NO_UNDERLYING_KEY'};
 const cached=cache.get(key);if(cached&&Date.now()-cached.at<CACHE_MS)return{...cached.value,cached:true};
 try{
  const h={Accept:'application/json',Authorization:`Bearer ${token()}`};
  const contractsRes=await get(`${BASE_URL}/v2/option/contract`,{params:{instrument_key:key},headers:h,timeout:12000});
  const contracts=Array.isArray(contractsRes?.data?.data)?contractsRes.data.data:[];
  const expiry=expiryFromContracts(contracts);
  if(!expiry)throw new Error('NO_CURRENT_OPTION_EXPIRY');
  const r=await get(`${BASE_URL}/v2/option/chain`,{params:{instrument_key:key,expiry_date:expiry},headers:h,timeout:12000});
  const rows=Array.isArray(r?.data?.data)?r.data.data:[];
  if(!rows.length)throw new Error(`EMPTY_OPTION_CHAIN:${expiry}`);
  let callOI=0,putOI=0,prevCallOI=0,prevPutOI=0;
  for(const row of rows){
   const c=row?.call_options?.market_data||{},p=row?.put_options?.market_data||{};
   callOI+=Math.max(0,num(c.oi));putOI+=Math.max(0,num(p.oi));
   prevCallOI+=Math.max(0,num(c.prev_oi??c.previous_oi));prevPutOI+=Math.max(0,num(p.prev_oi??p.previous_oi));
  }
  const oi=callOI+putOI,previousOI=prevCallOI+prevPutOI,oiChange=oi-previousOI,oiChangePercent=pct(oi,previousOI),price=num(currentPrice),prevPrice=num(previousPrice);
  if(!(oi>0&&previousOI>0&&price>0&&prevPrice>0)){
   const value={mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:'INCOMPLETE_OI_OR_PRICE',oi,previousOI,oiChange,oiChangePercent,callOI,putOI,prevCallOI,prevPutOI,expiry,source:`UPSTOX_OPTION_CHAIN_${expiry}`};
   cache.set(key,{at:Date.now(),value});return value;
  }
  const priceChange=price-prevPrice,priceChangePercent=pct(price,prevPrice),[mood,sentiment]=classify(priceChangePercent,oiChangePercent),value={mood,sentiment,dataAvailable:true,priceChange,priceChangePercent,oiChange,oiChangePercent,oi,previousOI,callOI,putOI,prevCallOI,prevPutOI,expiry,source:'UPSTOX_OPTION_CHAIN',reason:'OK'};
  cache.set(key,{at:Date.now(),value});return value;
 }catch(e){
  const status=e?.response?.status;
  const value={mood:'UNKNOWN',sentiment:'UNKNOWN',dataAvailable:false,reason:`OI_API_FAILED:${status||e?.message||'UNKNOWN'}`};
  cache.set(key,{at:Date.now(),value});return value;
 }
}
module.exports={getUnderlyingOIMood};
