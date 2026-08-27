const axios = require("axios");
const zlib = require("zlib");

const BASE_URL = "https://api.upstox.com";
const IST = "Asia/Kolkata";
let instruments = [];
let instrumentsLoaded = false;

const name = "UPSTOX";

function getAccessToken() {
    const token = process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) throw new Error("UPSTOX_ACCESS_TOKEN is missing in .env");
    return token;
}

async function login() { getAccessToken(); console.log("✅ Upstox Access Token Found"); return { accessToken: process.env.UPSTOX_ACCESS_TOKEN }; }
function apiError(error, fallback="Upstox API error") { const status=error?.response?.status; const data=error?.response?.data; const message=data?.errors?.[0]?.message||data?.message||error?.message||fallback; return status?`HTTP ${status}: ${message}`:message; }

async function loadInstruments() {
    if (instrumentsLoaded && instruments.length) return instruments;
    console.log("📥 Loading Upstox instrument master...");
    try { const r=await axios.get("https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",{responseType:"arraybuffer",timeout:30000}); const p=JSON.parse(zlib.gunzipSync(r.data).toString("utf8")); if(!Array.isArray(p)||!p.length) throw new Error("Instrument master is empty"); instruments=p; instrumentsLoaded=true; console.log(`✅ Upstox Instruments Loaded: ${instruments.length}`); return instruments; } catch(e){ instruments=[]; instrumentsLoaded=false; throw new Error(`Failed to load Upstox instrument master: ${apiError(e)}`); }
}
async function ensureInstrumentsLoaded(){if(!instrumentsLoaded||!instruments.length) await loadInstruments(); return instruments;}
function normalizeSymbol(v){return String(v||"").trim().toUpperCase().replace(/\s+/g,"").replace(/-EQ$/i,"");}
function isInstrumentKey(v){return typeof v==="string"&&/^[A-Z0-9_]+\|[^|]+$/i.test(v.trim());}
function isNseEquity(i){const s=String(i?.segment||"").toUpperCase(),e=String(i?.exchange||"").toUpperCase();return s==="NSE_EQ"||(e==="NSE"&&String(i?.instrument_type||"").toUpperCase()==="EQ");}
async function getInstrument(symbol){await ensureInstrumentsLoaded();const t=normalizeSymbol(symbol);if(!t)return null;if(isInstrumentKey(String(symbol||"").trim()))return instruments.find(x=>String(x.instrument_key||"").trim()===String(symbol).trim())||null;return instruments.find(i=>isNseEquity(i)&&normalizeSymbol(i.trading_symbol)===t)||instruments.find(i=>String(i?.exchange||"").toUpperCase()==="NSE"&&normalizeSymbol(i.trading_symbol)===t)||null;}
async function getInstrumentKey(v){if(v==null)return null;if(typeof v==="object")return String(v.instrument_key||v.instrumentKey||v.key||"")||null;const t=String(v).trim();if(!t)return null;if(isInstrumentKey(t))return t;const i=await getInstrument(t);return i?.instrument_key||null;}
async function resolveInstrumentKey(v){return getInstrumentKey(v);}

const INTERVALS={ONE_DAY:{unit:"days",interval:"1"},FOUR_HOUR:{unit:"hours",interval:"4"},ONE_HOUR:{unit:"hours",interval:"1"},THIRTY_MINUTE:{unit:"minutes",interval:"30"},FIFTEEN_MINUTE:{unit:"minutes",interval:"15"},FIVE_MINUTE:{unit:"minutes",interval:"5"}};
function normalizeInterval(v){const x=String(v||"ONE_DAY").toUpperCase();return({"1D":"ONE_DAY","1H":"ONE_HOUR","60M":"ONE_HOUR","30M":"THIRTY_MINUTE","15M":"FIFTEEN_MINUTE","5M":"FIVE_MINUTE","4H":"FOUR_HOUR"})[x]||x;}
function formatDateIST(date){const p=new Intl.DateTimeFormat("en-CA",{timeZone:IST,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date),x={};for(const q of p)if(q.type!=="literal")x[q.type]=q.value;return `${x.year}-${x.month}-${x.day}`;}
function daysBack(i){switch(normalizeInterval(i)){case"ONE_DAY":return 450;case"FOUR_HOUR":case"ONE_HOUR":case"THIRTY_MINUTE":return 85;case"FIFTEEN_MINUTE":case"FIVE_MINUTE":return 28;default:return 28;}}
function validCandle(c){if(!c||!c.time)return false;const o=+c.open,h=+c.high,l=+c.low,cl=+c.close;return[o,h,l,cl].every(Number.isFinite)&&h>=Math.max(o,cl)&&l<=Math.min(o,cl)&&h>=l;}

async function getHistoricalData(symbol,interval="ONE_DAY"){const n=normalizeInterval(interval);if(!INTERVALS[n])throw new Error(`Unsupported Upstox timeframe: ${interval}`);const key=await resolveInstrumentKey(symbol);if(!key)throw new Error(`Upstox instrument not found: ${symbol}`);const today=new Date(),from=new Date(today);from.setDate(from.getDate()-daysBack(n));const c=INTERVALS[n];const url=`${BASE_URL}/v3/historical-candle/${encodeURIComponent(key)}/${c.unit}/${c.interval}/${formatDateIST(today)}/${formatDateIST(from)}`;try{const r=await axios.get(url,{headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`},timeout:20000});const raw=r?.data?.data?.candles;if(!Array.isArray(raw)||!raw.length)throw new Error("EMPTY_DATA");const candles=raw.map(a=>Array.isArray(a)&&a.length>=5?{time:a[0],open:+a[1],high:+a[2],low:+a[3],close:+a[4],volume:+(a[5]||0)}:null).filter(validCandle).sort((a,b)=>new Date(a.time)-new Date(b.time));if(!candles.length)throw new Error("No valid historical candles after validation");return candles;}catch(e){throw new Error(`Upstox historical data failed | ${key} | ${n} | ${apiError(e)}`);}}

function findQuote(data,key){if(!data||typeof data!=="object")return null;const w=String(key||"").trim();if(data[w])return data[w];const n=w.replace(/%7C/gi,"|");for(const[k,v]of Object.entries(data)){if(k===n||decodeURIComponent(k)===n)return v;}const keys=Object.keys(data);return keys.length===1?data[keys[0]]:null;}

async function getQuote(symbol){const key=await resolveInstrumentKey(symbol);if(!key)throw new Error(`Upstox instrument not found: ${symbol}`);try{const r=await axios.get(`${BASE_URL}/v3/market-quote/ltp?instrument_key=${encodeURIComponent(key)}`,{headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`},timeout:10000});const q=findQuote(r?.data?.data,key);if(!q)throw new Error(`Quote not returned for ${key}`);return{...r.data,data:{[key]:q}};}catch(e){throw new Error(`Upstox quote failed | ${key} | ${apiError(e)}`);}}

function extractLtp(q){const candidates=[q?.last_price,q?.lastPrice,q?.ltp,q?.last_traded_price,q?.lastTradedPrice,q?.close_price,q?.closePrice];for(const v of candidates){const n=Number(v);if(Number.isFinite(n)&&n>0)return n;}return 0;}
function extractNumber(...values){for(const v of values){const n=Number(v);if(Number.isFinite(n)&&n>=0)return n;}return 0;}

async function getOptionLTP(instrumentKey){const x=await getOptionQuote(instrumentKey);return x.ltp;}

async function getOptionQuote(instrumentKey){const key=await resolveInstrumentKey(instrumentKey);if(!key)throw new Error(`Invalid option instrument key: ${instrumentKey}`);const response=await getQuote(key);const quote=findQuote(response.data,key);const ltp=extractLtp(quote);if(!(ltp>0))throw new Error(`Invalid option LTP for ${key}`);return{instrumentKey:key,ltp,volume:extractNumber(quote?.volume,quote?.volume_traded,quote?.volumeTraded),oi:extractNumber(quote?.oi,quote?.open_interest,quote?.openInterest),open:extractNumber(quote?.open),high:extractNumber(quote?.high),low:extractNumber(quote?.low),close:extractNumber(quote?.close,quote?.close_price),timestamp:quote?.timestamp||quote?.timestamp_nanos||null,raw:quote};}

async function getOptionContracts(symbol){const key=await resolveInstrumentKey(symbol);if(!key)throw new Error(`Upstox underlying instrument not found: ${symbol}`);try{const r=await axios.get(`${BASE_URL}/v2/option/contract?instrument_key=${encodeURIComponent(key)}`,{headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`},timeout:15000});if(!Array.isArray(r?.data?.data))throw new Error("Invalid Upstox option contract response");return r.data.data;}catch(e){throw new Error(`Upstox option contract failed | ${key} | ${apiError(e)}`);}}

function normalizeOptionType(v){const x=String(v||"").trim().toUpperCase();if(["CALL","CE","C"].includes(x))return"CE";if(["PUT","PE","P"].includes(x))return"PE";return null;}
function normalizeExpiry(v){if(!v)return"";const s=String(v).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.getTime())?s:d.toISOString().slice(0,10);}
function getOptionType(c){const d=normalizeOptionType(c?.instrument_type||c?.option_type||c?.optionType||c?.option_type_name);if(d)return d;const s=String(c?.trading_symbol||c?.tradingsymbol||"").toUpperCase();return s.endsWith("CE")?"CE":s.endsWith("PE")?"PE":null;}
function selectExpiry(contracts,minimumDays=7){const min=Math.max(0,+minimumDays||0),today=new Date();today.setHours(0,0,0,0);return [...new Set((contracts||[]).map(c=>normalizeExpiry(c?.expiry)).filter(Boolean))].map(expiry=>{const d=new Date(`${expiry}T00:00:00`);return Number.isNaN(d.getTime())?null:{expiry,expiryDate:d,daysToExpiry:Math.ceil((d-today)/86400000)};}).filter(x=>x&&x.daysToExpiry>=min).sort((a,b)=>a.expiryDate-b.expiryDate)[0]||null;}
function findOptionContract(contracts,strike,type,expiry){const target=+strike,t=normalizeOptionType(type),e=normalizeExpiry(expiry);const valid=(contracts||[]).filter(c=>Number(c?.strike_price??c?.strike)>0&&getOptionType(c)===t&&normalizeExpiry(c?.expiry)===e&&(c?.instrument_key||c?.instrumentKey));if(!valid.length)return null;return valid.reduce((best,c)=>{const d=Math.abs(+(c.strike_price??c.strike)-target);return!best||d<best.distance||(d===best.distance&&+(c.strike_price??c.strike)<+(best.contract.strike_price??best.contract.strike))?{contract:c,distance:d}:best;},null)?.contract||null;}
function validateOptionContract(contract,expected={}){if(!contract)return{valid:false,reason:"CONTRACT_NOT_FOUND"};const key=contract.instrumentKey||contract.instrument_key,strike=+(contract.strike??contract.strike_price),type=getOptionType(contract),expiry=normalizeExpiry(contract.expiry);if(!key)return{valid:false,reason:"INSTRUMENT_KEY_MISSING"};if(!(strike>0))return{valid:false,reason:"INVALID_STRIKE"};if(!type)return{valid:false,reason:"INVALID_OPTION_TYPE"};if(!expiry)return{valid:false,reason:"EXPIRY_MISSING"};if(expected.type&&type!==normalizeOptionType(expected.type))return{valid:false,reason:"OPTION_TYPE_MISMATCH"};if(expected.expiry&&expiry!==normalizeExpiry(expected.expiry))return{valid:false,reason:"EXPIRY_MISMATCH"};if(expected.strike&&strike!==+expected.strike)return{valid:false,reason:"STRIKE_MISMATCH"};return{valid:true,reason:null};}

async function getOptionContract(symbol,arg2,arg3,arg4=null,arg5=null){let type,strike,expiry=null,minDays=7;if(normalizeOptionType(arg2)){type=normalizeOptionType(arg2);strike=arg3;expiry=arg4;if(arg5!=null)minDays=+arg5||7;}else{strike=arg2;type=normalizeOptionType(arg3);if(arg4!=null)minDays=+arg4||7;expiry=arg5;}if(!type)throw new Error(`Invalid option type: ${arg2||arg3}`);if(!(+strike>0))throw new Error(`Invalid option strike: ${strike}`);const underlyingKey=await resolveInstrumentKey(symbol);if(!underlyingKey)throw new Error(`Upstox underlying instrument not found: ${symbol}`);const contracts=await getOptionContracts(underlyingKey);const expiryInfo=expiry?{expiry:normalizeExpiry(expiry),daysToExpiry:0}:selectExpiry(contracts,minDays);if(!expiryInfo)throw new Error(`No valid expiry available for ${symbol}`);const c=findOptionContract(contracts,strike,type,expiryInfo.expiry);if(!c)throw new Error(`Option contract not found | ${symbol} | ${type} | ${strike} | ${expiryInfo.expiry}`);return{...c,instrumentKey:c.instrument_key||c.instrumentKey,tradingSymbol:c.trading_symbol||c.tradingsymbol,strike:Number(c.strike_price??c.strike),optionType:getOptionType(c),expiry:normalizeExpiry(c.expiry),underlyingKey};}

module.exports={name,login,loadInstruments,ensureInstrumentsLoaded,getInstrument,getInstrumentKey,resolveInstrumentKey,getHistoricalData,getQuote,getOptionLTP,getOptionQuote,getOptionContracts,getOptionContract,findOptionContract,validateOptionContract,normalizeOptionType,selectExpiry};
