const axios=require("axios");
const UPSTOX_BASE="https://api.upstox.com";
const MAX_TOP_STOCKS=20;
const TOP_NSE_STOCKS=500;
const TOP_OPTION_STOCKS=100;
const MIN_VOLUME=1;
const MIN_OI=1;
const MIN_OPTION_VOLUME=Math.max(1,Number(process.env.MIN_OPTION_VOLUME||5000));
const MIN_OPTION_OI=Math.max(1,Number(process.env.MIN_OPTION_OI||10000));
const OPTION_LIQUIDITY_CANDIDATE_POOL=200;

function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f;}
function normalizeSymbol(v){return String(v||"").trim().toUpperCase().replace(/\s+/g,"").replace(/^NSE[_:]?EQ[|:]/,"").replace(/^NSE[|:]/,"").replace(/\.NS$/i,"").replace(/-EQ$/i,"");}
function normalizeQuoteMap(data){const out=[];for(const[key,value]of Object.entries(data||{})){if(!value||typeof value!=="object")continue;out.push({instrumentKey:value.instrument_token||value.instrumentKey||key,symbol:value.symbol||"",price:n(value.last_price??value.lastPrice),volume:n(value.volume??value.volume_traded??value.volumeTraded),oi:n(value.oi??value.open_interest??value.openInterest),previousOI:n(value.prev_oi??value.previous_oi??value.previousOI),oiDayHigh:n(value.oi_day_high),oiDayLow:n(value.oi_day_low),timestamp:value.timestamp||null,lastTradeTime:value.last_trade_time||value.lastTradeTime||null,raw:value});}return out;}

async function upstoxFullQuotes(instrumentKeys){
 const token=process.env.UPSTOX_ACCESS_TOKEN;if(!token)throw new Error("UPSTOX_ACCESS_TOKEN is missing");
 const keys=[...new Set((instrumentKeys||[]).filter(Boolean))];if(!keys.length)return[];
 const response=await axios.get(`${UPSTOX_BASE}/v2/market-quote/quotes`,{params:{instrument_key:keys.join(",")},headers:{Accept:"application/json",Authorization:`Bearer ${token}`},timeout:15000});
 return normalizeQuoteMap(response?.data?.data);
}

/*
 * PERFORMANCE FIX:
 * The complete Upstox instrument master is already loaded before this module
 * is used by app.js. The old implementation called broker.getInstrument()
 * once per NSE symbol (~9,700 calls). That was unnecessary because the master
 * already contains symbol -> instrument_key.
 *
 * Build the lookup map once per broker/master and reuse it for the scan.
 */
let equityKeyCache=null;
let equityKeyCacheSource=null;
let equityKeyCachePromise=null;

function isNseEquity(i){
 const segment=String(i?.segment||"").toUpperCase();
 const exchange=String(i?.exchange||"").toUpperCase();
 const type=String(i?.instrument_type||"").toUpperCase();
 return segment==="NSE_EQ"||(exchange==="NSE"&&type==="EQ");
}

function buildEquityKeyMap(instruments){
 const map=new Map();
 for(const i of Array.isArray(instruments)?instruments:[]){
   if(!isNseEquity(i))continue;
   const key=String(i?.instrument_key||i?.instrumentKey||"").trim();
   const symbol=normalizeSymbol(i?.trading_symbol??i?.tradingSymbol??i?.symbol);
   if(key&&symbol&&!map.has(symbol))map.set(symbol,key);
 }
 return map;
}

async function getEquityKeyMap(broker){
 if(!broker)throw new Error("Broker is required for live-volume ranking");
 if(equityKeyCache&&equityKeyCacheSource===broker)return equityKeyCache;
 if(equityKeyCachePromise&&equityKeyCacheSource===broker)return equityKeyCachePromise;

 equityKeyCacheSource=broker;
 equityKeyCachePromise=(async()=>{
   let instruments=null;
   if(typeof broker.loadInstruments==="function")instruments=await broker.loadInstruments();
   if(Array.isArray(instruments)&&instruments.length){
     const map=buildEquityKeyMap(instruments);
     if(map.size){equityKeyCache=map;return map;}
   }
   return null;
 })();

 try{
   const map=await equityKeyCachePromise;
   if(map)return map;
 }finally{
   equityKeyCachePromise=null;
 }

 // Compatibility fallback for brokers that do not expose a usable
 // instrument master. This path is intentionally not used by Upstox.
 return null;
}

async function resolveEquityKeys(symbols,broker){
 const source=[...new Set((symbols||[]).map(normalizeSymbol).filter(Boolean))];
 const map=await getEquityKeyMap(broker);
 if(map){
   const rows=[];
   for(const symbol of source){
     const key=map.get(symbol);
     if(key)rows.push({symbol,key});
   }
   return rows;
 }

 // Broker compatibility fallback. Kept for non-master brokers.
 const rows=[];
 for(const symbol of source){
   try{
     const instrument=await broker.getInstrument(symbol);
     const key=instrument?.instrument_key||instrument?.instrumentKey||null;
     if(key)rows.push({symbol,key});
   }catch(_){}
 }
 return rows;
}

async function rankByLiveVolume(symbols,broker,limit){
 const started=Date.now();
 const source=[...new Set((Array.isArray(symbols)?symbols:[]).map(normalizeSymbol).filter(Boolean))];
 const resolved=await resolveEquityKeys(source,broker);
 if(!resolved.length)throw new Error("No NSE equity instruments resolved for live-volume ranking");

 let quotes=[];
 const chunkSize=450;
 for(let i=0;i<resolved.length;i+=chunkSize){
   const chunk=resolved.slice(i,i+chunkSize);
   const result=await upstoxFullQuotes(chunk.map(x=>x.key));
   const byKey=new Map(result.map(q=>[q.instrumentKey,q]));
   for(const item of chunk){
     const q=byKey.get(item.key);
     if(q)quotes.push({symbol:item.symbol,instrumentKey:item.key,...q});
   }
 }
 const valid=quotes.filter(q=>q.price>0&&q.volume>=MIN_VOLUME);
 if(!valid.length)throw new Error("Live market volume unavailable for scanner universe");
 valid.sort((a,b)=>(b.volume-a.volume)||(b.price-a.price));
 const top=valid.slice(0,Math.min(limit,valid.length)).map((q,index)=>({...q,liveVolumeRank:index+1,volumeConfirmed:q.volume>=MIN_VOLUME,liveMarketConfirmed:true,liveQuoteTimestamp:q.timestamp||q.lastTradeTime||null}));
 console.log(`⚡ LIVE VOLUME RANKING: ${source.length} symbols → ${resolved.length} keys → ${valid.length} live quotes → Top ${top.length} in ${((Date.now()-started)/1000).toFixed(1)}s`);
 return{top,allQuotes:valid,universeSize:source.length};
}

async function getTop500ByLiveVolume(symbols,broker,limit=TOP_NSE_STOCKS){return rankByLiveVolume(symbols,broker,Math.min(TOP_NSE_STOCKS,Math.max(1,limit)));}
function getTop100OptionStocks(top500Rows,optionEligibleSymbols,limit=TOP_OPTION_STOCKS){const rowsInput=Array.isArray(top500Rows)?top500Rows:[];const eligible=new Set((Array.isArray(optionEligibleSymbols)?optionEligibleSymbols:[]).map(normalizeSymbol).filter(Boolean));const rows=rowsInput.filter(r=>eligible.has(normalizeSymbol(r?.symbol??r?.tradingSymbol??r?.stock)));rows.sort((a,b)=>(b.volume-a.volume)||(b.price-a.price));return rows.slice(0,Math.min(TOP_OPTION_STOCKS,Math.max(1,limit))).map((r,index)=>({...r,optionUniverseRank:index+1,optionEligible:true}));}
async function getTop20ByLiveVolume(symbols,broker,limit=MAX_TOP_STOCKS){return rankByLiveVolume(symbols,broker,Math.min(MAX_TOP_STOCKS,Math.max(1,limit)));}

function normalizeExpiry(v){const s=String(v??"").trim();if(!s)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);}
function optionType(c){const x=String(c?.instrument_type??c?.option_type??c?.optionType??"").toUpperCase();if(["CE","CALL","C"].includes(x))return"CE";if(["PE","PUT","P"].includes(x))return"PE";const s=String(c?.trading_symbol||c?.tradingsymbol||"").toUpperCase();return s.endsWith("CE")?"CE":s.endsWith("PE")?"PE":null;}
function chooseContract(contracts,direction,spot){const side=direction==="BULLISH"?"CE":"PE",today=new Date();today.setHours(0,0,0,0);const usable=(Array.isArray(contracts)?contracts:[]).filter(c=>{const expiry=normalizeExpiry(c?.expiry??c?.expiry_date),d=expiry?new Date(`${expiry}T00:00:00`):null,days=d&&!Number.isNaN(d.getTime())?Math.ceil((d-today)/86400000):-1;return optionType(c)===side&&days>=7&&n(c?.strike_price??c?.strike)>0&&(c?.instrument_key||c?.instrumentKey);});if(!usable.length)return null;const expiry=[...new Set(usable.map(c=>normalizeExpiry(c?.expiry??c?.expiry_date)).filter(Boolean))].sort()[0],sameExpiry=usable.filter(c=>normalizeExpiry(c?.expiry??c?.expiry_date)===expiry);return sameExpiry.reduce((best,c)=>!best||Math.abs(n(c.strike_price??c.strike)-spot)<Math.abs(n(best.strike_price??best.strike)-spot)?c:best,null);}

async function getOptionLiquidityConfirmation(row,broker){
 const symbol=row?.symbol||row?.stock,spot=n(row?.price);
 if(!symbol||spot<=0||!broker||typeof broker.getOptionContracts!=="function")return{confirmed:false,reason:"OPTION_DATA_API_UNAVAILABLE"};
 try{
   const contracts=await broker.getOptionContracts(symbol),today=new Date();today.setHours(0,0,0,0);
   const usable=(Array.isArray(contracts)?contracts:[]).filter(c=>{const expiry=normalizeExpiry(c?.expiry??c?.expiry_date),d=expiry?new Date(expiry+"T00:00:00"):null,days=d&&!Number.isNaN(d.getTime())?Math.ceil((d-today)/86400000):-1;return days>=7&&n(c?.strike_price??c?.strike)>0&&(c?.instrument_key||c?.instrumentKey);});
   if(!usable.length)return{confirmed:false,reason:"NO_VALID_OPTION_CONTRACT"};
   const expiry=[...new Set(usable.map(c=>normalizeExpiry(c?.expiry??c?.expiry_date)).filter(Boolean))].sort()[0],sameExpiry=usable.filter(c=>normalizeExpiry(c?.expiry??c?.expiry_date)===expiry),strikes=[...new Set(sameExpiry.map(c=>n(c?.strike_price??c?.strike)).filter(v=>v>0))].sort((a,b)=>a-b);
   if(!strikes.length)return{confirmed:false,reason:"NO_VALID_OPTION_STRIKES"};
   const atm=strikes.reduce((best,s)=>Math.abs(s-spot)<Math.abs(best-spot)?s:best,strikes[0]),selected=[];
   for(const side of ["CE","PE"]){const candidates=sameExpiry.filter(c=>optionType(c)===side).sort((a,b)=>Math.abs(n(a?.strike_price??a?.strike)-atm)-Math.abs(n(b?.strike_price??b?.strike)-atm));if(candidates[0])selected.push(candidates[0]);}
   const keys=selected.map(c=>c.instrument_key||c.instrumentKey).filter(Boolean),quotes=await upstoxFullQuotes(keys),byKey=new Map(quotes.map(q=>[q.instrumentKey,q]));
   const sides=selected.map(c=>{const key=c.instrument_key||c.instrumentKey,q=byKey.get(key),volume=n(q?.volume),oi=n(q?.oi);return{side:optionType(c),optionSymbol:c.trading_symbol||c.tradingsymbol||"",optionInstrumentKey:key,optionStrike:n(c?.strike_price??c?.strike),optionExpiry:expiry,optionLTP:n(q?.price),optionVolume:volume,optionOI:oi,confirmed:volume>=MIN_OPTION_VOLUME&&oi>=MIN_OPTION_OI};});
   const confirmedSide=sides.find(x=>x.confirmed);
   return{confirmed:Boolean(confirmedSide),reason:confirmedSide?"LIVE_OPTION_LIQUIDITY_CONFIRMED":"INSUFFICIENT_LIVE_OPTION_LIQUIDITY",selectedSide:confirmedSide?.side||"",optionVolume:confirmedSide?.optionVolume||0,optionOI:confirmedSide?.optionOI||0,optionLTP:confirmedSide?.optionLTP||0,optionSymbol:confirmedSide?.optionSymbol||"",optionInstrumentKey:confirmedSide?.optionInstrumentKey||"",optionStrike:confirmedSide?.optionStrike||0,optionExpiry:confirmedSide?.optionExpiry||expiry,sides};
 }catch(error){return{confirmed:false,reason:"LIVE_OPTION_LIQUIDITY_ERROR:"+String(error?.message||error)};}
}

async function filterOptionEligibleStocks(topRows,broker,limit=TOP_OPTION_STOCKS){
 const input=(Array.isArray(topRows)?topRows:[]).filter(row=>row?.volumeConfirmed5===true&&row?.qualified===true).slice(0,OPTION_LIQUIDITY_CANDIDATE_POOL),confirmed=[],target=Math.min(TOP_OPTION_STOCKS,Math.max(1,limit)),concurrency=8;
 for(let i=0;i<input.length;i+=concurrency){
   const batch=input.slice(i,i+concurrency),checked=await Promise.all(batch.map(async row=>({row,liquidity:await getOptionLiquidityConfirmation(row,broker)})));
   for(const x of checked){if(x.liquidity.confirmed)confirmed.push({...x.row,optionEligible:true,optionLiquidityConfirmed:true,optionLiquidityReason:x.liquidity.reason,optionLiquidityVolume:x.liquidity.optionVolume,optionLiquidityOI:x.liquidity.optionOI,optionLiquiditySide:x.liquidity.selectedSide,optionLiquidityLTP:x.liquidity.optionLTP,optionLiquidityContract:x.liquidity.optionInstrumentKey,optionLiquidityExpiry:x.liquidity.optionExpiry});if(confirmed.length>=target)break;}
   if(confirmed.length>=target)break;
 }
 confirmed.sort((a,b)=>(b.volume-a.volume)||(b.optionLiquidityVolume-a.optionLiquidityVolume)||(b.optionLiquidityOI-a.optionLiquidityOI));
 return confirmed.slice(0,target).map((r,index)=>({...r,optionUniverseRank:index+1}));
}

async function getOptionConfirmation(row,direction,broker){
 const symbol=row?.symbol||row?.stock,spot=n(row?.price);if(!symbol||spot<=0||!broker||typeof broker.getOptionContracts!=="function")return{confirmed:false,reason:"OPTION_DATA_API_UNAVAILABLE"};
 try{
   const contracts=await broker.getOptionContracts(symbol),contract=chooseContract(contracts,direction,spot);if(!contract)return{confirmed:false,reason:"NO_VALID_OPTION_CONTRACT"};
   const key=contract.instrument_key||contract.instrumentKey,quote=(await upstoxFullQuotes([key])).find(q=>q.instrumentKey===key);if(!quote)return{confirmed:false,reason:"LIVE_OPTION_QUOTE_UNAVAILABLE",optionInstrumentKey:key};
   const volume=n(quote.volume),oi=n(quote.oi),previousOI=n(quote.previousOI),oiChange=previousOI>0?oi-previousOI:0,oiChangePercent=previousOI>0?(oiChange/previousOI)*100:0,confirmed=volume>=MIN_VOLUME&&oi>=MIN_OI;
   return{confirmed,reason:confirmed?"LIVE_VOLUME_OI_CONFIRMED":"INSUFFICIENT_LIVE_OPTION_VOLUME_OI",optionSymbol:contract.trading_symbol||contract.tradingsymbol||"",optionInstrumentKey:key,optionType:direction==="BULLISH"?"CE":"PE",optionStrike:n(contract.strike_price??contract.strike),optionExpiry:normalizeExpiry(contract.expiry??contract.expiry_date)||"",optionLTP:quote.price,optionVolume:volume,optionOI:oi,optionPreviousOI:previousOI,optionOIChange:oiChange,optionOIChangePercent:oiChangePercent,optionTimestamp:quote.timestamp||null,optionLastTradeTime:quote.lastTradeTime||null};
 }catch(error){return{confirmed:false,reason:`LIVE_OPTION_CONFIRMATION_ERROR:${error?.message||error}`};}
}

module.exports={getTop20ByLiveVolume,getTop500ByLiveVolume,getTop100OptionStocks,filterOptionEligibleStocks,getOptionLiquidityConfirmation,getOptionConfirmation,upstoxFullQuotes,MAX_TOP_STOCKS,TOP_NSE_STOCKS,TOP_OPTION_STOCKS,MIN_OPTION_VOLUME,MIN_OPTION_OI};
