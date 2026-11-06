const NSE_EQUITY_SEGMENT="NSE_EQ";
const NSE_FO_SEGMENT="NSE_FO";
const NSE_OPTION_TYPES=new Set(["CE","PE"]);
const axios=require("axios");
const NIFTY500_URL="https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv";
const NIFTY500_FALLBACK_URL="https://raw.githubusercontent.com/BKKB20/nse-index-history/main/current_members/NIFTY_500.csv";

function normalizeSymbol(v){return String(v||'').trim().toUpperCase().replace(/\s+/g,'').replace(/^NSE[_:]?EQ[|:]/,'').replace(/^NSE[|:]/,'').replace(/\.NS$/i,'').replace(/-EQ$/i,'');}
function isNseEquity(i){const segment=String(i?.segment||'').toUpperCase(),exchange=String(i?.exchange||'').toUpperCase(),type=String(i?.instrument_type||'').toUpperCase();return segment===NSE_EQUITY_SEGMENT||(exchange==='NSE'&&type==='EQ');}
function isNseDerivative(i){const segment=String(i?.segment||'').toUpperCase(),exchange=String(i?.exchange||'').toUpperCase(),type=String(i?.instrument_type||'').toUpperCase(),optionType=String(i?.option_type||i?.optionType||'').toUpperCase(),underlyingType=String(i?.underlying_type||i?.underlyingType||'').toUpperCase();if(segment!==NSE_FO_SEGMENT&&exchange!=='NSE')return false;if(NSE_OPTION_TYPES.has(type))return !underlyingType||underlyingType==='EQUITY';if((type==='OPTSTK'||type==='OPTIDX')&&(!optionType||NSE_OPTION_TYPES.has(optionType)))return type==='OPTSTK'||underlyingType==='EQUITY';if(NSE_OPTION_TYPES.has(optionType))return !underlyingType||underlyingType==='EQUITY';return false;}
function getUnderlyingSymbol(i){return normalizeSymbol(i?.underlying_symbol??i?.underlyingSymbol??i?.underlying_stock_symbol??i?.underlyingStockSymbol??i?.underlying);}

/*
 * The NIFTY 500 is the sole starting universe. A stock enters the options
 * pipeline only when its unique NSE_EQ instrument key is exactly referenced
 * by an NSE_FO stock-option row (underlying_key + underlying_symbol).
 * No manually maintained stock list or symbol-only fallback is permitted.
 */
async function getFastTradingUniverse(broker,nifty500Symbols){
  if(!broker||typeof broker.loadInstruments!=='function')throw new Error('Broker instrument master is unavailable');
  const candidates=[...new Set((Array.isArray(nifty500Symbols)?nifty500Symbols:[]).map(normalizeSymbol).filter(Boolean))].sort();
  if(!candidates.length)throw new Error('NIFTY 500 candidate universe is empty; refusing to use a fallback stock list');
  const master=await getWholeNseUniverse(broker);
  const candidateSet=new Set(candidates);
  const configuredInstrumentAudit=candidates.map(symbol=>{
    const equityKeys=[...(master.equityKeysBySymbol?.get(symbol)||[])].sort();
    const equityKey=equityKeys.length===1?equityKeys[0]:null;
    const foKeys=[...(master.foRowsByUnderlyingSymbol?.get(symbol)||[])].sort();
    const exactFoLinked=equityKey?master.foRowsByUnderlyingKey?.get(equityKey)?.has(symbol)===true:false;
    let status='MATCH';
    if(equityKeys.length===0)status='NO_NSE_EQ';
    else if(equityKeys.length>1)status='DUPLICATE_NSE_EQ_KEYS';
    else if(!exactFoLinked)status=foKeys.length?'FO_SYMBOL_ONLY_KEY_MISMATCH':'NO_NSE_FO';
    return{nifty500Symbol:symbol,nseEquityInstrumentKey:equityKey,equityKeyCount:equityKeys.length,foUnderlyingKeys:foKeys,exactFoKeyMatch:exactFoLinked,status};
  });
  const auditCounts=configuredInstrumentAudit.reduce((a,row)=>(a[row.status]=(a[row.status]||0)+1,a),{});
  const mappedEquitySymbols=configuredInstrumentAudit.filter(row=>row.equityKeyCount===1).map(row=>row.nifty500Symbol);
  const optionEligibleSymbols=configuredInstrumentAudit.filter(row=>row.status==='MATCH').map(row=>row.nifty500Symbol);
  const rejectedSymbols=configuredInstrumentAudit.filter(row=>row.status!=='MATCH');
  console.log('NIFTY 500 → UPSTOX NSE_EQ/NSE_FO EXACT-KEY AUDIT: '+JSON.stringify({
    nifty500:candidates.length,mappedEquity: mappedEquitySymbols.length,
    optionEligible:optionEligibleSymbols.length,rejected:rejectedSymbols.length,status:auditCounts
  }));
  for(const row of configuredInstrumentAudit)if(row.status!=='MATCH')console.log('NIFTY 500 OPTION-ELIGIBILITY REJECT: '+JSON.stringify(row));
  if(!optionEligibleSymbols.length)throw new Error('No NIFTY 500 stocks have an exact NSE_EQ instrument-key match to NSE_FO stock options');
  return{
    name:'NIFTY500_UPSTOX_NSE_FO_STOCK_OPTIONS',
    symbols:optionEligibleSymbols,
    universeSize:optionEligibleSymbols.length,
    optionEligibleSymbols,
    optionEligibleCount:optionEligibleSymbols.length,
    nifty500Symbols:candidates,
    nifty500Count:candidates.length,
    mappedEquitySymbols,
    mappedEquityCount:mappedEquitySymbols.length,
    rejectedSymbols,
    configuredInstrumentAudit,
    instrumentAuditCounts:auditCounts,
    source:'NIFTY 500 constituents intersected with exact Upstox NSE_EQ/NSE_FO underlying instrument-key identities'
  };
}

async function getNifty500Universe(){
  if(!axios||typeof axios.get!=="function")throw new Error("axios is unavailable for Nifty 500 universe");
  const urls=[NIFTY500_URL,NIFTY500_FALLBACK_URL];
  const errors=[];
  for(const url of urls){
    try{
      const response=await axios.get(url,{
        timeout:20000,
        responseType:"text",
        validateStatus:status=>status>=200&&status<300,
        headers:{
          "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "Accept":"text/csv,text/plain,*/*",
          "Referer":"https://www.niftyindices.com/"
        }
      });
      const raw=String(response.data||"").replace(/^\uFEFF/,"");
      const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      if(lines.length<450)throw new Error("too little data: "+lines.length+" rows");
      const symbols=[];
      for(const line of lines.slice(1)){
        const cols=line.split(",").map(v=>String(v||"").trim().replace(/^"|"$/g,""));
        const symbol=normalizeSymbol(cols.length>=3?cols[2]:cols[0]);
        if(symbol&&symbol!=="SYMBOL")symbols.push(symbol);
      }
      const unique=[...new Set(symbols)];
      if(unique.length<450)throw new Error("invalid constituent list: "+unique.length+" symbols");
      console.log("NIFTY 500 SOURCE: "+(url===NIFTY500_URL?"official NSE Indices":"fallback mirror")+" | symbols="+unique.length);
      return{name:"NIFTY_500",symbols:unique,universeSize:unique.length,source:url};
    }catch(e){
      errors.push(url+": "+(e?.message||e));
      console.warn("Nifty 500 source failed: "+url+" | "+(e?.message||e));
    }
  }
  throw new Error("Nifty 500 constituent fetch failed from all sources: "+errors.join(" || "));
}

async function getWholeNseUniverse(broker){
  if(!broker||typeof broker.loadInstruments!=='function')throw new Error('Broker instrument master is unavailable for whole-NSE universe');
  const instruments=await broker.loadInstruments();
  if(!Array.isArray(instruments)||!instruments.length)throw new Error('NSE instrument master is empty');
  const equityRows=instruments.filter(isNseEquity),equities=[...new Set(equityRows.map(i=>normalizeSymbol(i?.trading_symbol??i?.tradingSymbol??i?.symbol)).filter(Boolean))];
  if(!equities.length)throw new Error('No NSE equity symbols found in instrument master');
  const equityByKey=new Map();
  for(const equity of equityRows){const key=String(equity?.instrument_key??equity?.instrumentKey??'').trim(),symbol=normalizeSymbol(equity?.trading_symbol??equity?.tradingSymbol??equity?.symbol);if(key&&symbol)equityByKey.set(key,symbol);}
  const equityInstrumentKeyBySymbol=new Map();
  const equityKeysBySymbol=new Map();
  for(const equity of equityRows){
    const symbol=normalizeSymbol(equity?.trading_symbol??equity?.tradingSymbol??equity?.symbol);
    const key=String(equity?.instrument_key??equity?.instrumentKey??'').trim();
    if(!symbol||!key)continue;
    if(!equityKeysBySymbol.has(symbol))equityKeysBySymbol.set(symbol,new Set());
    equityKeysBySymbol.get(symbol).add(key);
  }
  // Only unambiguous NSE_EQ symbols can be used as stock instrument identities.
  for(const [symbol,keys] of equityKeysBySymbol){
    if(keys.size===1)equityInstrumentKeyBySymbol.set(symbol,[...keys][0]);
  }

  // Keep raw F&O records indexed both ways for diagnostics. Option eligibility
  // is derived only from a strict symbol + underlying_key match to NSE_EQ.
  const foRowsByUnderlyingKey=new Map();
  const foRowsByUnderlyingSymbol=new Map();
  const exactOptionUnderlyings=new Set();
  const foSymbolOnlyUnderlyings=new Set();
  for(const derivative of instruments.filter(isNseDerivative)){
    const underlyingKey=String(derivative?.underlying_key??derivative?.underlyingKey??derivative?.underlying_instrument_key??derivative?.underlyingInstrumentKey??'').trim();
    const symbol=getUnderlyingSymbol(derivative);
    if(underlyingKey){
      if(!foRowsByUnderlyingKey.has(underlyingKey))foRowsByUnderlyingKey.set(underlyingKey,new Set());
      if(symbol)foRowsByUnderlyingKey.get(underlyingKey).add(symbol);
    }
    if(symbol){
      foSymbolOnlyUnderlyings.add(symbol);
      if(!foRowsByUnderlyingSymbol.has(symbol))foRowsByUnderlyingSymbol.set(symbol,new Set());
      if(underlyingKey)foRowsByUnderlyingSymbol.get(symbol).add(underlyingKey);
    }
    if(!underlyingKey||!symbol)continue;
    const equitySymbol=equityByKey.get(underlyingKey);
    if(equitySymbol&&equitySymbol===symbol&&equityInstrumentKeyBySymbol.get(symbol)===underlyingKey){
      exactOptionUnderlyings.add(symbol);
    }
  }
  return{
    name:'WHOLE_NSE',symbols:equities,universeSize:equities.length,
    optionEligibleSymbols:[...exactOptionUnderlyings].sort(),
    optionEligibleCount:exactOptionUnderlyings.size,
    foSymbolOnlyUnderlyings:[...foSymbolOnlyUnderlyings].sort(),
    equityInstrumentKeyBySymbol,equityKeysBySymbol,foRowsByUnderlyingKey,foRowsByUnderlyingSymbol,
    source:'Upstox complete NSE instrument master'
  };
}

module.exports={getFastTradingUniverse,getNifty500Universe,getWholeNseUniverse,normalizeSymbol,isNseEquity,isNseDerivative};
