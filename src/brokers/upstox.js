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

async function login() {
    getAccessToken();
    console.log("✅ Upstox Access Token Found");
    return { accessToken: process.env.UPSTOX_ACCESS_TOKEN };
}

function apiError(error, fallback = "Upstox API error") {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const message = data?.errors?.[0]?.message || data?.message || error?.message || fallback;
    return status ? `HTTP ${status}: ${message}` : message;
}

async function loadInstruments() {
    if (instrumentsLoaded && instruments.length) return instruments;
    console.log("📥 Loading Upstox instrument master...");
    try {
        const response = await axios.get("https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz", { responseType: "arraybuffer", timeout: 30000 });
        const parsed = JSON.parse(zlib.gunzipSync(response.data).toString("utf8"));
        if (!Array.isArray(parsed) || !parsed.length) throw new Error("Instrument master is empty");
        instruments = parsed;
        instrumentsLoaded = true;
        console.log(`✅ Upstox Instruments Loaded: ${instruments.length}`);
        return instruments;
    } catch (error) {
        instruments = [];
        instrumentsLoaded = false;
        throw new Error(`Failed to load Upstox instrument master: ${apiError(error)}`);
    }
}

async function ensureInstrumentsLoaded() {
    if (!instrumentsLoaded || !instruments.length) await loadInstruments();
    return instruments;
}

function normalizeSymbol(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/-EQ$/, "");
}

function isInstrumentKey(value) {
    return typeof value === "string" && /^[A-Z0-9_]+\|[^|]+$/i.test(value.trim());
}

function isNseEquity(item) {
    const segment = String(item?.segment || "").trim().toUpperCase();
    const exchange = String(item?.exchange || "").trim().toUpperCase();
    return segment === "NSE_EQ" || (exchange === "NSE" && String(item?.instrument_type || "").toUpperCase() === "EQ");
}

async function getInstrument(symbol) {
    await ensureInstrumentsLoaded();
    const target = normalizeSymbol(symbol);
    if (!target) return null;
    if (isInstrumentKey(String(symbol || "").trim())) {
        return instruments.find(x => String(x.instrument_key || "").trim() === String(symbol).trim()) || null;
    }

    // Exact NSE trading symbol is the ONLY primary lookup. Do not match name/short_name first.
    const exact = instruments.find(item => isNseEquity(item) && normalizeSymbol(item.trading_symbol) === target);
    if (exact) return exact;

    // Controlled fallback for masters that omit segment metadata.
    return instruments.find(item => {
        const exchange = String(item?.exchange || "").trim().toUpperCase();
        return exchange === "NSE" && normalizeSymbol(item.trading_symbol) === target;
    }) || null;
}

async function getInstrumentKey(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return String(value.instrument_key || value.instrumentKey || value.key || "") || null;
    const text = String(value).trim();
    if (!text) return null;
    if (isInstrumentKey(text)) return text;
    const instrument = await getInstrument(text);
    return instrument?.instrument_key || null;
}

async function resolveInstrumentKey(value) {
    return getInstrumentKey(value);
}

const INTERVALS = {
    ONE_DAY: { unit: "days", interval: "1" },
    FOUR_HOUR: { unit: "hours", interval: "4" },
    ONE_HOUR: { unit: "hours", interval: "1" },
    THIRTY_MINUTE: { unit: "minutes", interval: "30" },
    FIFTEEN_MINUTE: { unit: "minutes", interval: "15" },
    FIVE_MINUTE: { unit: "minutes", interval: "5" }
};

function normalizeInterval(interval) {
    const v = String(interval || "ONE_DAY").trim().toUpperCase();
    return ({ "1D":"ONE_DAY", "1H":"ONE_HOUR", "60M":"ONE_HOUR", "30M":"THIRTY_MINUTE", "15M":"FIFTEEN_MINUTE", "5M":"FIVE_MINUTE", "4H":"FOUR_HOUR" })[v] || v;
}

function formatDateIST(date) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(date);
    const x = {}; for (const part of p) if (part.type !== "literal") x[part.type] = part.value;
    return `${x.year}-${x.month}-${x.day}`;
}

function daysBack(interval) {
    switch (normalizeInterval(interval)) {
        case "ONE_DAY": return 450;
        case "FOUR_HOUR": return 85;
        case "ONE_HOUR": return 85;
        case "THIRTY_MINUTE": return 85;
        case "FIFTEEN_MINUTE": return 28;
        case "FIVE_MINUTE": return 28;
        default: return 28;
    }
}

function validCandle(c) {
    if (!c || !c.time) return false;
    const o=Number(c.open),h=Number(c.high),l=Number(c.low),cl=Number(c.close);
    return [o,h,l,cl].every(Number.isFinite) && h>=Math.max(o,cl) && l<=Math.min(o,cl) && h>=l;
}

async function getHistoricalData(symbol, interval="ONE_DAY") {
    const normalized = normalizeInterval(interval);
    if (!INTERVALS[normalized]) throw new Error(`Unsupported Upstox timeframe: ${interval}`);
    const key = await resolveInstrumentKey(symbol);
    if (!key) throw new Error(`Upstox instrument not found: ${symbol}`);
    const today = new Date();
    const from = new Date(today.getTime());
    from.setDate(from.getDate() - daysBack(normalized));
    const cfg = INTERVALS[normalized];
    const url = `${BASE_URL}/v3/historical-candle/${encodeURIComponent(key)}/${cfg.unit}/${cfg.interval}/${formatDateIST(today)}/${formatDateIST(from)}`;
    try {
        const response = await axios.get(url, { headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`}, timeout:20000 });
        const raw = response?.data?.data?.candles;
        if (!Array.isArray(raw) || !raw.length) throw new Error("EMPTY_DATA");
        const candles = raw.map(c => Array.isArray(c) && c.length>=5 ? {time:c[0],open:Number(c[1]),high:Number(c[2]),low:Number(c[3]),close:Number(c[4]),volume:Number(c[5]||0)} : null).filter(validCandle).sort((a,b)=>new Date(a.time)-new Date(b.time));
        if (!candles.length) throw new Error("No valid historical candles after validation");
        return candles;
    } catch (error) {
        throw new Error(`Upstox historical data failed | ${key} | ${normalized} | ${apiError(error)}`);
    }
}

function findQuote(data, requestedKey) {
    if (!data || typeof data !== "object") return null;
    const wanted = String(requestedKey || "").trim();
    if (data[wanted]) return data[wanted];
    const wantedNorm = wanted.replace(/%7C/gi,"|");
    for (const [key,value] of Object.entries(data)) {
        if (key === wantedNorm || decodeURIComponent(key) === wantedNorm) return value;
    }
    const keys = Object.keys(data);
    return keys.length === 1 ? data[keys[0]] : null;
}

async function getQuote(symbol) {
    const key = await resolveInstrumentKey(symbol);
    if (!key) throw new Error(`Upstox instrument not found: ${symbol}`);
    try {
        const response = await axios.get(`${BASE_URL}/v3/market-quote/ltp?instrument_key=${encodeURIComponent(key)}`, { headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`}, timeout:10000 });
        const quote = findQuote(response?.data?.data, key);
        if (!quote) throw new Error(`Quote not returned for ${key}`);
        return { ...response.data, data: { [key]: quote } };
    } catch (error) {
        throw new Error(`Upstox quote failed | ${key} | ${apiError(error)}`);
    }
}

async function getOptionLTP(instrumentKey) {
    const key = await resolveInstrumentKey(instrumentKey);
    if (!key) throw new Error(`Invalid option instrument key: ${instrumentKey}`);
    const response = await getQuote(key);
    const quote = findQuote(response.data, key);
    const ltp = Number(quote?.last_price);
    if (!Number.isFinite(ltp) || ltp <= 0) throw new Error(`Invalid option LTP for ${key}`);
    return ltp;
}

async function getOptionQuote(instrumentKey) {
    const key = await resolveInstrumentKey(instrumentKey);
    if (!key) throw new Error(`Invalid option instrument key: ${instrumentKey}`);
    const response = await getQuote(key);
    const quote = findQuote(response.data, key);
    const ltp = Number(quote?.last_price);
    if (!Number.isFinite(ltp) || ltp <= 0) throw new Error(`Invalid option LTP for ${key}`);
    return { instrumentKey:key, ltp, volume:Number(quote.volume||0), open:Number(quote.open||0), high:Number(quote.high||0), low:Number(quote.low||0), close:Number(quote.close||0), timestamp:quote.timestamp||null, raw:quote };
}

async function getOptionContracts(symbol) {
    const key = await resolveInstrumentKey(symbol);
    if (!key) throw new Error(`Upstox underlying instrument not found: ${symbol}`);
    try {
        const response = await axios.get(`${BASE_URL}/v2/option/contract?instrument_key=${encodeURIComponent(key)}`, { headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`}, timeout:15000 });
        if (!Array.isArray(response?.data?.data)) throw new Error("Invalid Upstox option contract response");
        return response.data.data;
    } catch (error) { throw new Error(`Upstox option contract failed | ${key} | ${apiError(error)}`); }
}

function normalizeOptionType(value) {
    const v=String(value||"").trim().toUpperCase();
    if (["CALL","CE","C"].includes(v)) return "CE";
    if (["PUT","PE","P"].includes(v)) return "PE";
    return null;
}

function normalizeExpiry(value) {
    if (!value) return "";
    const s=String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d=new Date(s); return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0,10);
}

function getOptionType(contract) {
    const direct=normalizeOptionType(contract?.instrument_type || contract?.option_type || contract?.optionType || contract?.option_type_name);
    if (direct) return direct;
    const symbol=String(contract?.trading_symbol || contract?.tradingsymbol || "").toUpperCase();
    return symbol.endsWith("CE") ? "CE" : symbol.endsWith("PE") ? "PE" : null;
}

function selectExpiry(contracts, minimumDays=7) {
    const min=Math.max(0,Number(minimumDays)||0), today=new Date(); today.setHours(0,0,0,0);
    const dates=[...new Set((contracts||[]).map(c=>normalizeExpiry(c?.expiry)).filter(Boolean))].map(expiry=>{const d=new Date(`${expiry}T00:00:00`); if(Number.isNaN(d.getTime())) return null; return {expiry,expiryDate:d,daysToExpiry:Math.ceil((d-today)/86400000)};}).filter(Boolean).filter(x=>x.daysToExpiry>=min).sort((a,b)=>a.expiryDate-b.expiryDate);
    return dates[0]||null;
}

function findOptionContract(contracts, strike, optionType, selectedExpiry) {
    const target=Number(strike), type=normalizeOptionType(optionType), expiry=normalizeExpiry(selectedExpiry);
    if (!Array.isArray(contracts)||!contracts.length||!Number.isFinite(target)||target<=0||!type||!expiry) return null;
    const valid=contracts.filter(c=>Number(c?.strike_price??c?.strike)>0 && getOptionType(c)===type && normalizeExpiry(c?.expiry)===expiry && Boolean(c?.instrument_key||c?.instrumentKey));
    if (!valid.length) return null;
    return valid.reduce((best,c)=>{const d=Math.abs(Number(c.strike_price??c.strike)-target); return !best||d<best.distance|| (d===best.distance && Number(c.strike_price??c.strike)<Number(best.contract.strike_price??best.contract.strike)) ? {contract:c,distance:d}:best;},null)?.contract||null;
}

function validateOptionContract(contract, expected={}) {
    if (!contract) return {valid:false,reason:"CONTRACT_NOT_FOUND"};
    const key=contract.instrumentKey||contract.instrument_key;
    const strike=Number(contract.strike??contract.strike_price), type=getOptionType(contract), expiry=normalizeExpiry(contract.expiry);
    if (!key) return {valid:false,reason:"INSTRUMENT_KEY_MISSING"};
    if (!Number.isFinite(strike)||strike<=0) return {valid:false,reason:"INVALID_STRIKE"};
    if (!type) return {valid:false,reason:"INVALID_OPTION_TYPE"};
    if (!expiry) return {valid:false,reason:"EXPIRY_MISSING"};
    if (expected.type && type!==normalizeOptionType(expected.type)) return {valid:false,reason:"OPTION_TYPE_MISMATCH"};
    if (expected.expiry && expiry!==normalizeExpiry(expected.expiry)) return {valid:false,reason:"EXPIRY_MISMATCH"};
    if (expected.strike && strike!==Number(expected.strike)) return {valid:false,reason:"STRIKE_MISMATCH"};
    if (expected.underlyingKey && contract.underlying_key && contract.underlying_key!==expected.underlyingKey) return {valid:false,reason:"UNDERLYING_MISMATCH"};
    return {valid:true,reason:null};
}

async function getOptionContract(symbol,arg2,arg3,arg4=null,arg5=null) {
    let type,strike,expiry=null,minDays=7;
    if (normalizeOptionType(arg2)) { type=normalizeOptionType(arg2); strike=arg3; expiry=arg4; if(arg5!==null&&arg5!==undefined) minDays=Number(arg5)||7; }
    else { strike=arg2; type=normalizeOptionType(arg3); if(arg4!==null&&arg4!==undefined) minDays=Number(arg4)||7; expiry=arg5; }
    if (!type) throw new Error(`Invalid option type: ${arg2||arg3}`);
    if (!Number.isFinite(Number(strike))||Number(strike)<=0) throw new Error(`Invalid option strike: ${strike}`);
    const underlyingKey=await resolveInstrumentKey(symbol);
    if (!underlyingKey) throw new Error(`Upstox underlying instrument not found: ${symbol}`);
    const contracts=await getOptionContracts(underlyingKey);
    const expiryInfo=expiry ? (()=>{const e=normalizeExpiry(expiry),d=new Date(`${e}T00:00:00`),today=new Date();today.setHours(0,0,0,0);return Number.isNaN(d.getTime())?null:{expiry:e,daysToExpiry:Math.ceil((d-today)/86400000)};})() : selectExpiry(contracts,minDays);
    if (!expiryInfo) throw new Error(`No valid expiry available for ${symbol}`);
    if (expiryInfo.daysToExpiry < minDays) throw new Error(`Expiry ${expiryInfo.expiry} violates minimum ${minDays} days`);
    const contract=findOptionContract(contracts,Number(strike),type,expiryInfo.expiry);
    if (!contract) throw new Error(`No valid option contract | ${symbol} | ${type} | requested strike ${strike} | expiry ${expiryInfo.expiry}`);
    const key=contract.instrument_key||contract.instrumentKey;
    const lot=Number(contract.lot_size??contract.lotSize);
    const actualStrike=Number(contract.strike_price??contract.strike);
    if (!key) throw new Error("Option instrument key missing");
    if (!Number.isFinite(lot)||lot<=0) throw new Error(`Invalid lot size for ${contract.trading_symbol||key}`);
    const result={expiry:expiryInfo.expiry,expiryDays:expiryInfo.daysToExpiry,instrumentKey:key,tradingSymbol:contract.trading_symbol||contract.tradingsymbol||"",strike:actualStrike,optionType:type,lotSize:lot,tickSize:Number(contract.tick_size||contract.tickSize||0),weekly:contract.weekly,underlyingKey:contract.underlying_key||contract.underlyingKey||underlyingKey,rawContract:contract};
    const check=validateOptionContract(result,{type,expiry:expiryInfo.expiry});
    if(!check.valid) throw new Error(`Invalid option contract: ${check.reason}`);
    if (result.underlyingKey && result.underlyingKey!==underlyingKey) throw new Error(`Option underlying mismatch | expected ${underlyingKey} | got ${result.underlyingKey}`);
    return result;
}

async function getOptionContractBySymbol(symbol,optionType,strike,expiry=null,minimumDays=7){return getOptionContract(symbol,optionType,strike,expiry,minimumDays);}
async function getOptionLTPByContract(contract){return getOptionLTP(contract?.instrumentKey||contract?.instrument_key);}
async function getOptionQuoteByContract(contract){return getOptionQuote(contract?.instrumentKey||contract?.instrument_key);}
async function getOptionChain(symbol,expiryDate){const key=await resolveInstrumentKey(symbol);if(!key)throw new Error(`Upstox underlying instrument not found: ${symbol}`);const expiry=normalizeExpiry(expiryDate);if(!expiry)throw new Error("Expiry date is required");try{const r=await axios.get(`${BASE_URL}/v2/option/chain?instrument_key=${encodeURIComponent(key)}&expiry_date=${encodeURIComponent(expiry)}`,{headers:{Accept:"application/json",Authorization:`Bearer ${getAccessToken()}`},timeout:15000});if(!Array.isArray(r?.data?.data))throw new Error("Invalid Upstox option chain response");return r.data.data;}catch(e){throw new Error(`Upstox option chain failed | ${key} | ${apiError(e)}`);}}
async function getOptionExpiries(symbol){const c=await getOptionContracts(symbol);return [...new Set(c.map(x=>normalizeExpiry(x.expiry)).filter(Boolean))].sort();}
async function getValidOptionExpiry(symbol,minimumDays=7){return selectExpiry(await getOptionContracts(symbol),minimumDays)?.expiry||null;}
async function getExpiryOptionContracts(symbol,expiry){const e=normalizeExpiry(expiry);return (await getOptionContracts(symbol)).filter(c=>normalizeExpiry(c.expiry)===e);}
async function getOptionContractDetails(symbol,type,strike,expiry=null){return getOptionContract(symbol,type,strike,expiry,7);}
async function getOptionLotSize(symbol,type,strike,expiry=null){return (await getOptionContract(symbol,type,strike,expiry,7)).lotSize;}
async function getOptionInstrumentKey(symbol,type,strike,expiry=null){return (await getOptionContract(symbol,type,strike,expiry,7)).instrumentKey;}
async function getOptionStrikes(symbol,expiry,type=null){const t=type?normalizeOptionType(type):null;const c=await getExpiryOptionContracts(symbol,expiry);return [...new Set(c.filter(x=>!t||getOptionType(x)===t).map(x=>Number(x.strike_price??x.strike)).filter(x=>Number.isFinite(x)&&x>0))].sort((a,b)=>a-b);}
function selectValidExpiry(expiries,minDays=7){return selectExpiry((expiries||[]).map(expiry=>({expiry})),minDays)?.expiry||null;}
function debugOptions(symbol){return getOptionContracts(symbol).then(c=>({symbol,contractCount:c.length,expiries:[...new Set(c.map(x=>normalizeExpiry(x.expiry)).filter(Boolean))],sample:c.slice(0,10)}));}
function safeNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function getOptionMarketData(option){const m=option?.market_data||{};return {ltp:safeNumber(m.ltp),closePrice:safeNumber(m.close_price),oi:safeNumber(m.oi),prevOi:safeNumber(m.prev_oi),volume:safeNumber(m.volume)};}
function calculateOIChange(oi,prevOi){const a=safeNumber(oi),b=safeNumber(prevOi);return b>0?{change:a-b,percent:(a-b)/b*100}:{change:a,percent:0};}
function classifyBuildup(priceChangePercent,oiChangePercent){const p=safeNumber(priceChangePercent),o=safeNumber(oiChangePercent);if(p>0.1&&o>1)return"LONG BUILDUP";if(p<-0.1&&o>1)return"SHORT BUILDUP";if(p>0.1&&o<-1)return"SHORT COVERING";if(p<-0.1&&o<-1)return"LONG UNWINDING";return"NEUTRAL";}
async function getOIMood(symbol,expiryDate=null){try{const key=await resolveInstrumentKey(symbol);const expiry=expiryDate||await getValidOptionExpiry(key,7);if(!key||!expiry)throw new Error("No valid option expiry");const chain=await getOptionChain(key,expiry);if(!chain.length)throw new Error("Empty option chain");let spot=0,callOI=0,putOI=0,prevCall=0,prevPut=0,callVol=0,putVol=0;for(const row of chain){spot=spot||safeNumber(row.underlying_spot_price);const c=getOptionMarketData(row.call_options),p=getOptionMarketData(row.put_options);callOI+=c.oi;putOI+=p.oi;prevCall+=c.prevOi;prevPut+=p.prevOi;callVol+=c.volume;putVol+=p.volume;}const cc=calculateOIChange(callOI,prevCall),pc=calculateOIChange(putOI,prevPut);return {available:true,symbol,instrumentKey:key,expiry,spot,mood:pc.percent>cc.percent?"BULLISH":cc.percent>pc.percent?"BEARISH":"NEUTRAL",sentiment:pc.percent>cc.percent?"BULLISH":cc.percent>pc.percent?"BEARISH":"NEUTRAL",callOI,putOI,callOIChange:cc.change,putOIChange:pc.change,callOIChangePercent:cc.percent,putOIChangePercent:pc.percent,totalCallVolume:callVol,totalPutVolume:putVol,pcr:callOI>0?putOI/callOI:0};}catch(e){return {available:false,symbol,mood:"NEUTRAL",sentiment:"NEUTRAL",error:e.message};}}

module.exports={name,login,loadInstruments,getAccessToken,getHistoricalData,getQuote,getOptionLTP,getOptionQuote,getInstrument,getInstrumentKey,getOptionChain,getOptionContracts,getOptionContract,getOptionContractBySymbol,getOptionLTPByContract,getOptionQuoteByContract,getOptionExpiries,getExpiryOptionContracts,getValidOptionExpiry,getOptionContractDetails,getOptionLotSize,getOptionInstrumentKey,getOptionStrikes,normalizeOptionType,getOptionType,validateOptionContract,debugOptions,selectExpiry,selectValidExpiry,findOptionContract,getOIMood,calculateOIChange,classifyBuildup,INTERVALS};