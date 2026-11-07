const {upstoxApiGet}=require("./brokers/upstox");
const axios=require("axios");
const UPSTOX_BASE="https://api.upstox.com";
const MAX_TOP_STOCKS=20;
const TOP_NSE_STOCKS=500;
const TOP_OPTION_STOCKS=220;
const MIN_VOLUME=1;
const MIN_OI=1;
const MIN_OPTION_VOLUME=Math.max(1,Number(process.env.MIN_OPTION_VOLUME||5000));
const MIN_OPTION_OI=Math.max(1,Number(process.env.MIN_OPTION_OI||10000));
const OPTION_LIQUIDITY_CANDIDATE_POOL=500;

function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f;}
function normalizeSymbol(v){return String(v||"").trim().toUpperCase().replace(/\s+/g,"").replace(/^NSE[_:]?EQ[|:]/,"").replace(/^NSE[|:]/,"").replace(/\.NS$/i,"").replace(/-EQ$/i,"");}
function normalizeQuoteMap(data){const out=[];for(const[key,value]of Object.entries(data||{})){if(!value||typeof value!=="object")continue;out.push({instrumentKey:value.instrument_token||value.instrumentKey||key,symbol:value.symbol||"",price:n(value.last_price??value.lastPrice),previousClose:n(value.previous_close??value.previousClose)>0?n(value.previous_close??value.previousClose):Math.max(0,n(value.last_price??value.lastPrice)-n(value.net_change??value.netChange)),netChange:n(value.net_change??value.netChange),volume:n(value.volume??value.volume_traded??value.volumeTraded),oi:n(value.oi??value.open_interest??value.openInterest),previousOI:n(value.prev_oi??value.previous_oi??value.previousOI),oiDayHigh:n(value.oi_day_high),oiDayLow:n(value.oi_day_low),timestamp:value.timestamp||null,lastTradeTime:value.last_trade_time||value.lastTradeTime||null,raw:value});}return out;}

async function upstoxFullQuotes(instrumentKeys){
 const token=process.env.UPSTOX_ACCESS_TOKEN;if(!token)throw new Error("UPSTOX_ACCESS_TOKEN is missing");
 const keys=[...new Set((instrumentKeys||[]).filter(Boolean))];if(!keys.length)return[];
 const response=await upstoxApiGet(`${UPSTOX_BASE}/v2/market-quote/quotes`,{params:{instrument_key:keys.join(",")},headers:{Accept:"application/json",Authorization:`Bearer ${token}`},timeout:15000},"bulk market quotes");
 return normalizeQuoteMap(response?.data?.data);
}

let equityKeyCache=null;
let equityKeyCacheSource=null;
let equityKeyCachePromise=null;
function isNseEquity(i){const segment=String(i?.segment||"").toUpperCase();const exchange=String(i?.exchange||"").toUpperCase();const type=String(i?.instrument_type||"").toUpperCase();return segment==="NSE_EQ"||(exchange==="NSE"&&type==="EQ");}
function buildEquityKeyMap(instruments){
 const keysBySymbol=new Map();
 for(const i of Array.isArray(instruments)?instruments:[]){
  if(!isNseEquity(i))continue;
  const key=String(i?.instrument_key||i?.instrumentKey||"").trim();
  const symbol=normalizeSymbol(i?.trading_symbol??i?.tradingSymbol??i?.symbol);
  if(!key||!symbol)continue;
  if(!keysBySymbol.has(symbol))keysBySymbol.set(symbol,new Set());
  keysBySymbol.get(symbol).add(key);
 }
 const map=new Map();
 for(const [symbol,keys] of keysBySymbol)if(keys.size===1)map.set(symbol,[...keys][0]);
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
 try{return await equityKeyCachePromise;}finally{equityKeyCachePromise=null;}
}
async function resolveEquityKeys(symbols,broker){
 const source=[...new Set((symbols||[]).map(normalizeSymbol).filter(Boolean))];
 const map=await getEquityKeyMap(broker);
 if(map){
  const rows=[];
  for(const symbol of source){const key=map.get(symbol);if(key)rows.push({symbol,key});}
  return rows;
 }
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
function buildLiveQuoteCoverage(symbols,resolved,quotes,failedKeys=[]){
 const source=[...new Set((Array.isArray(symbols)?symbols:[]).map(normalizeSymbol).filter(Boolean))];
 const resolvedBySymbol=new Map((Array.isArray(resolved)?resolved:[]).map(x=>[normalizeSymbol(x.symbol),x]));
 const quoteByKey=new Map((Array.isArray(quotes)?quotes:[]).map(q=>[String(q.instrumentKey||"").trim(),q]));
 const failed=new Set((Array.isArray(failedKeys)?failedKeys:[]).map(String));
 return source.map(symbol=>{
  const item=resolvedBySymbol.get(symbol);
  if(!item?.key)return{symbol,stock:symbol,instrumentKey:"",price:0,volume:0,liveMarketConfirmed:false,dataStatus:"INSTRUMENT_KEY_MISSING",dataReason:"No unique NSE_EQ instrument key resolved"};
  const q=quoteByKey.get(String(item.key));
  if(!q){
   const requestFailed=failed.has(String(item.key));
   return{symbol,stock:symbol,instrumentKey:item.key,price:0,volume:0,liveMarketConfirmed:false,dataStatus:requestFailed?"QUOTE_REQUEST_FAILED":"QUOTE_UNAVAILABLE",dataReason:requestFailed?"Upstox bulk quote request failed for this key":"Upstox returned no quote for this key"};
  }
  const row={...q,symbol,stock:symbol,instrumentKey:item.key,liveMarketConfirmed:q.price>0,dataReason:""};
  if(!(n(q.price)>0))return{...row,dataStatus:"INVALID_PRICE",dataReason:"Quote returned without a positive LTP"};
  if(!(n(q.volume)>0))return{...row,dataStatus:"ZERO_VOLUME",dataReason:"Quote returned with zero or unavailable volume"};
  return{...row,dataStatus:"LIVE_DATA_AVAILABLE"};
 });
}
async function rankByLiveVolume(symbols,broker,limit){
 const started=Date.now();
 const source=[...new Set((Array.isArray(symbols)?symbols:[]).map(normalizeSymbol).filter(Boolean))];
 const resolved=await resolveEquityKeys(source,broker);
 if(!resolved.length){const allRows=buildLiveQuoteCoverage(source,[],[],[]);const coverage=allRows.reduce((out,row)=>(out[row.dataStatus]=(out[row.dataStatus]||0)+1,out),{});console.warn("LIVE QUOTE DATA COVERAGE: "+JSON.stringify({universe:source.length,instrumentKeys:0,quotes:0,status:coverage}));return{top:[],allQuotes:[],allRows,coverage,universeSize:source.length,resolvedCount:0,quoteCount:0};}
 const quotes=[],failedKeys=[];
 const chunkSize=450;
 for(let i=0;i<resolved.length;i+=chunkSize){
  const chunk=resolved.slice(i,i+chunkSize);
  try{quotes.push(...await upstoxFullQuotes(chunk.map(x=>x.key)));}
  catch(error){
   for(const item of chunk)failedKeys.push(item.key);
   console.error("LIVE QUOTE CHUNK FAILED: "+(error?.message||error));
  }
 }
 const allRows=buildLiveQuoteCoverage(source,resolved,quotes,failedKeys);
 const valid=allRows.filter(q=>q.dataStatus==="LIVE_DATA_AVAILABLE");
 valid.sort((a,b)=>(b.volume-a.volume)||(b.price-a.price));
 const top=valid.slice(0,Math.min(limit,valid.length)).map((q,index)=>({...q,liveVolumeRank:index+1,volumeConfirmed:true,liveMarketConfirmed:true,liveQuoteTimestamp:q.timestamp||q.lastTradeTime||null}));
 const counts=allRows.reduce((out,row)=>(out[row.dataStatus]=(out[row.dataStatus]||0)+1,out),{});
 console.log("LIVE QUOTE DATA COVERAGE: "+JSON.stringify({universe:source.length,instrumentKeys:resolved.length,quotes:quotes.length,status:counts}));
 console.log(`⚡ LIVE VOLUME RANKING: ${source.length} symbols → ${resolved.length} keys → ${valid.length} usable live quotes → Top ${top.length} in ${((Date.now()-started)/1000).toFixed(1)}s`);
 return{top,allQuotes:valid,allRows,coverage:counts,universeSize:source.length,resolvedCount:resolved.length,quoteCount:quotes.length};
}
async function getTop500ByLiveVolume(symbols,broker,limit=TOP_NSE_STOCKS){return rankByLiveVolume(symbols,broker,Math.min(TOP_NSE_STOCKS,Math.max(1,limit)));}
function getTopMovers(rows,limit=100){const valid=(Array.isArray(rows)?rows:[]).filter(r=>n(r?.price)>0&&n(r?.previousClose)>0&&n(r?.volume)>=MIN_VOLUME).map(r=>({...r,changePercent:((n(r.price)-n(r.previousClose))/n(r.previousClose))*100}));const gainers=[...valid].sort((a,b)=>(b.changePercent-a.changePercent)||(b.volume-a.volume)).slice(0,limit);const losers=[...valid].sort((a,b)=>(a.changePercent-b.changePercent)||(b.volume-a.volume)).slice(0,limit);const map=new Map();for(const r of [...gainers,...losers])map.set(normalizeSymbol(r.symbol),r);return[...map.values()];}
function getTop100OptionStocks(top500Rows,optionEligibleSymbols,limit=TOP_OPTION_STOCKS){const rowsInput=Array.isArray(top500Rows)?top500Rows:[];const eligible=new Set((Array.isArray(optionEligibleSymbols)?optionEligibleSymbols:[]).map(normalizeSymbol).filter(Boolean));const rows=rowsInput.filter(r=>eligible.has(normalizeSymbol(r?.symbol??r?.tradingSymbol??r?.stock)));rows.sort((a,b)=>(b.volume-a.volume)||(b.price-a.price));return rows.slice(0,Math.min(TOP_OPTION_STOCKS,Math.max(1,limit))).map((r,index)=>({...r,optionUniverseRank:index+1,optionEligible:true}));}
async function getTop20ByLiveVolume(symbols,broker,limit=MAX_TOP_STOCKS){return rankByLiveVolume(symbols,broker,Math.min(MAX_TOP_STOCKS,Math.max(1,limit)));}
function normalizeExpiry(v){const s=String(v??"").trim();if(!s)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);}
function optionType(c){const x=String(c?.instrument_type??c?.option_type??c?.optionType??"").toUpperCase();if(["CE","CALL","C"].includes(x))return"CE";if(["PE","PUT","P"].includes(x))return"PE";const s=String(c?.trading_symbol||c?.tradingsymbol||"").toUpperCase();return s.endsWith("CE")?"CE":s.endsWith("PE")?"PE":null;}
function chooseContract(contracts,direction,spot){const side=direction==="BULLISH"?"CE":"PE",today=new Date();today.setHours(0,0,0,0);const usable=(Array.isArray(contracts)?contracts:[]).filter(c=>{const expiry=normalizeExpiry(c?.expiry??c?.expiry_date),d=expiry?new Date(`${expiry}T00:00:00`):null,days=d&&!Number.isNaN(d.getTime())?Math.ceil((d-today)/86400000):-1;return optionType(c)===side&&days>=0&&n(c?.strike_price??c?.strike)>0&&(c?.instrument_key||c?.instrumentKey);});if(!usable.length)return null;const expiry=[...new Set(usable.map(c=>normalizeExpiry(c?.expiry??c?.expiry_date)).filter(Boolean))].sort()[0],sameExpiry=usable.filter(c=>normalizeExpiry(c?.expiry??c?.expiry_date)===expiry);return sameExpiry.reduce((best,c)=>!best||Math.abs(n(c.strike_price??c.strike)-spot)<Math.abs(n(best.strike_price??best.strike)-spot)?c:best,null);}
async function getOptionLiquidityConfirmation(row,broker){const symbol=row?.symbol||row?.stock,spot=n(row?.price);if(!symbol||spot<=0||!broker||typeof broker.getOptionContracts!=="function")return{confirmed:false,reason:"OPTION_DATA_API_UNAVAILABLE"};try{const contracts=await broker.getOptionContracts(symbol),today=new Date();today.setHours(0,0,0,0);const usable=(Array.isArray(contracts)?contracts:[]).filter(c=>{const expiry=normalizeExpiry(c?.expiry??c?.expiry_date),d=expiry?new Date(expiry+"T00:00:00"):null,days=d&&!Number.isNaN(d.getTime())?Math.ceil((d-today)/86400000):-1;return days>=7&&n(c?.strike_price??c?.strike)>0&&(c?.instrument_key||c?.instrumentKey);});if(!usable.length)return{confirmed:false,reason:"NO_VALID_OPTION_CONTRACT"};const expiry=[...new Set(usable.map(c=>normalizeExpiry(c?.expiry??c?.expiry_date)).filter(Boolean))].sort()[0],sameExpiry=usable.filter(c=>normalizeExpiry(c?.expiry??c?.expiry_date)===expiry),strikes=[...new Set(sameExpiry.map(c=>n(c?.strike_price??c?.strike)).filter(v=>v>0))].sort((a,b)=>a-b);if(!strikes.length)return{confirmed:false,reason:"NO_VALID_OPTION_STRIKES"};const atm=strikes.reduce((best,s)=>Math.abs(s-spot)<Math.abs(best-spot)?s:best,strikes[0]),selectedContracts=[];for(const side of ["CE","PE"]){const candidates=sameExpiry.filter(c=>optionType(c)===side).sort((a,b)=>Math.abs(n(a?.strike_price??a?.strike)-atm)-Math.abs(n(b?.strike_price??b?.strike)-atm));if(candidates[0])selectedContracts.push(candidates[0]);}const keys=selectedContracts.map(c=>c.instrument_key||c.instrumentKey).filter(Boolean),quotes=await upstoxFullQuotes(keys),byKey=new Map(quotes.map(q=>[q.instrumentKey,q]));const sides=selectedContracts.map(c=>{const key=c.instrument_key||c.instrumentKey,q=byKey.get(key),volume=n(q?.volume),oi=n(q?.oi);return{contract:c,side:optionType(c),optionSymbol:c.trading_symbol||c.tradingsymbol||"",optionInstrumentKey:key,optionStrike:n(c?.strike_price??c?.strike),optionExpiry:expiry,optionLTP:n(q?.price),optionVolume:volume,optionOI:oi,confirmed:volume>=MIN_OPTION_VOLUME&&oi>=MIN_OPTION_OI&&n(q?.price)>0&&n(c?.strike_price??c?.strike)>0&&Boolean(key)};});const direction=String(row?.direction||row?.stockDirection||"").toUpperCase();const expectedSide=direction==="BEARISH"?"PE":direction==="BULLISH"?"CE":"";const confirmedSide=expectedSide?sides.find(x=>x.side===expectedSide&&x.confirmed):null;const anyConfirmed=sides.find(x=>x.confirmed)||null;const selected=confirmedSide||anyConfirmed;const preflightConfirmed=Boolean(expectedSide?confirmedSide:anyConfirmed);return{confirmed:preflightConfirmed,reason:confirmedSide?"LIVE_OPTION_LIQUIDITY_AVAILABLE":(!expectedSide&&anyConfirmed)?"LIVE_OPTION_LIQUIDITY_AVAILABLE_ANY_SIDE":anyConfirmed?"WRONG_OPTION_SIDE_LIQUIDITY":"INSUFFICIENT_LIVE_OPTION_LIQUIDITY",selectedSide:selected?.side||"",selectedContract:selected?.contract||null,optionVolume:selected?.optionVolume||0,optionOI:selected?.optionOI||0,optionLTP:selected?.optionLTP||0,optionSymbol:selected?.optionSymbol||"",optionInstrumentKey:selected?.optionInstrumentKey||"",optionStrike:selected?.optionStrike||0,optionExpiry:selected?.optionExpiry||expiry,availableOptionSides:sides.filter(x=>x.confirmed).map(x=>x.side),sides};}catch(error){return{confirmed:false,reason:"LIVE_OPTION_LIQUIDITY_ERROR:"+String(error?.message||error)};}}
async function filterOptionEligibleStocks(topRows,broker,limit=TOP_OPTION_STOCKS){const input=(Array.isArray(topRows)?topRows:[]).filter(row=>n(row?.price)>0&&n(row?.volume)>=MIN_VOLUME),confirmed=[],target=Math.min(TOP_OPTION_STOCKS,Math.max(1,limit)),concurrency=8;for(let i=0;i<input.length;i+=concurrency){const batch=input.slice(i,i+concurrency),checked=await Promise.all(batch.map(async row=>({row,liquidity:await getOptionLiquidityConfirmation(row,broker)})));for(const x of checked){if(x.liquidity.confirmed)confirmed.push({...x.row,optionEligible:true,optionLiquidityConfirmed:true,optionLiquidityReason:x.liquidity.reason,optionLiquidityVolume:x.liquidity.optionVolume,optionLiquidityOI:x.liquidity.optionOI,optionLiquiditySide:x.liquidity.selectedSide,optionLiquidityLTP:x.liquidity.optionLTP,optionLiquidityContract:x.liquidity.optionInstrumentKey,optionLiquidityContractData:x.liquidity.selectedContract||null,optionLiquidityExpiry:x.liquidity.optionExpiry,optionLiquidityAvailableSides:x.liquidity.availableOptionSides||[]});if(confirmed.length>=target)break;}if(confirmed.length>=target)break;}confirmed.sort((a,b)=>(b.volume-a.volume)||(b.optionLiquidityVolume-a.optionLiquidityVolume)||(b.optionLiquidityOI-a.optionLiquidityOI));return confirmed.slice(0,target).map((r,index)=>({...r,optionUniverseRank:index+1}));}
async function getOptionConfirmation(row,direction,broker){const symbol=row?.symbol||row?.stock,spot=n(row?.price);if(!symbol||spot<=0||!broker||typeof broker.getOptionContracts!=="function")return{confirmed:false,reason:"OPTION_DATA_API_UNAVAILABLE"};try{const contracts=await broker.getOptionContracts(symbol),contract=chooseContract(contracts,direction,spot);if(!contract)return{confirmed:false,reason:"NO_VALID_OPTION_CONTRACT"};const key=contract.instrument_key||contract.instrumentKey,quote=(await upstoxFullQuotes([key])).find(q=>q.instrumentKey===key);if(!quote)return{confirmed:false,reason:"LIVE_OPTION_QUOTE_UNAVAILABLE",optionInstrumentKey:key};const volume=n(quote.volume),oi=n(quote.oi),previousOI=n(quote.previousOI),oiChange=previousOI>0?oi-previousOI:0,oiChangePercent=previousOI>0?(oiChange/previousOI)*100:0,confirmed=volume>=MIN_VOLUME&&oi>=MIN_OI;return{confirmed,reason:confirmed?"LIVE_VOLUME_OI_CONFIRMED":"INSUFFICIENT_LIVE_OPTION_VOLUME_OI",optionSymbol:contract.trading_symbol||contract.tradingsymbol||"",optionInstrumentKey:key,optionType:direction==="BULLISH"?"CE":"PE",optionStrike:n(contract.strike_price??contract.strike),optionExpiry:normalizeExpiry(contract.expiry??contract.expiry_date)||"",optionLTP:quote.price,optionVolume:volume,optionOI:oi,optionPreviousOI:previousOI,optionOIChange:oiChange,optionOIChangePercent:oiChangePercent,optionTimestamp:quote.timestamp||null,optionLastTradeTime:quote.lastTradeTime||null};}catch(error){return{confirmed:false,reason:`LIVE_OPTION_CONFIRMATION_ERROR:${error?.message||error}`};}}
module.exports={getTop20ByLiveVolume,getTop500ByLiveVolume,getTop100OptionStocks,getTopMovers,filterOptionEligibleStocks,getOptionLiquidityConfirmation,getOptionConfirmation,upstoxFullQuotes,buildLiveQuoteCoverage,buildEquityKeyMap,MAX_TOP_STOCKS,TOP_NSE_STOCKS,TOP_OPTION_STOCKS,MIN_OPTION_VOLUME,MIN_OPTION_OI};
