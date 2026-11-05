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
 * FAST TRADING UNIVERSE
 * We still load the instrument master (needed for instrument keys), but we
 * no longer create a live-quote ranking for every NSE equity.
 *
 * Equity universe = stocks that have an NSE equity-derivative contract.
 * This is a liquid, actively traded subset and is also the natural universe
 * for the options pipeline. The instrument master is local/in-memory work;
 * the expensive market-quote calls are performed only for this subset.
 */
// Complete stock-options symbol list copied from ICICI Direct's ALL options-stocks page.
// This is the scanner's configured stock-option universe; no Top-N or liquidity
// filtering is applied while building the universe. Live quote/contract availability
// is handled later by the existing market-data and options-contract stages.
const ICICI_OPTION_STOCK_SYMBOLS = `360ONE ABB APLAPOLLO AUBANK ADANIENSOL ADANIENT ADANIGREEN ADANIPORTS ADANIPOWER ABCAPITAL ALKEM AMBER AMBUJACEM ANANDRATHI ANGELONE APOLLOHOSP ASHOKLEY ASIANPAINT ASTRAL ATHERENERG AUROPHARMA DMART AXISBANK BSE BAJAJ-AUTO BAJFINANCE BAJAJFINSV BANDHANBNK BANKBARODA BANKINDIA MAHABANK BDL BEL BHARATFORG BHEL BPCL BHARTIARTL BIOCON BLUESTARCO BOSCHLTD BRITANNIA CGPOWER CANBK CDSL CHOLAFIN CIPLA CUB COALINDIA COCHINSHIP COFORGE COLPAL CAMS CONCOR COROMANDEL CROMPTON CUMMINSIND DLF DABUR DATAPATTNS DELHIVERY DIVISLAB DIXON DRREDDY EICHERMOT ETERNAL NYKAA FEDERALBNK FORCEMOT FORTIS GAIL GVT&D GMRAIRPORT GLENMARK GODFRYPHLP GODREJCP GODREJPROP GRASIM HCLTECH HDFCAMC HDFCBANK HDFCLIFE HAVELLS HEROMOTOCO HINDALCO HAL HINDPETRO HINDUNILVR HINDZINC HITACHIENERGY HYUNDAI ICICIBANK ICICIGI ICICIPRULI IDFCFIRSTB ITC INDIANB IEX INDHOTEL IOC IRFC IREDA INDUSTOWER INDUSINDBK NAUKRI INFY INOXWIND INDIGO JSWENERGY JSWSTEEL JINDALSTEL JIOFIN JUBLFOOD KEI KFINTECH KPITTECH KALYANKJIL KARURVYSYA KAYNES KOTAKBANK LTF LICHSGFIN LTM LT LAURUSLABS LICI LODHA LUPIN M&M MANAPPURAM MANKIND MARICO MARUTI MFSL MAXHEALTH MAZDOCK MOTILALOFS MPHASIS MCX MUTHOOTFIN NBCC NHPC NMDC NTPC NATIONALUM NAVINFLUOR NESTLEIND NAM-INDIA OBEROIRLTY ONGC OIL PAYTM OFSS PIIND POLICYBZR PGEL PNBHOUSING PAGEIND PATANJALI PERSISTENT PETRONET PHOENIXLTD PIDILITIND POLYCAB PFC POWERGRID PREMIERENE PRESTIGE PNB RBLBANK RECLTD RADICO RVNL RELIANCE SBICARD SBILIFE SRF SAGILITY MOTHERSON SHREECEM SHRIRAMFIN SIEMENS SOLARINDS SONACOMS SBIN SAIL SUNPHARMA SUPREMEIND SUZLON SWIGGY SYRMA TVSMOTOR TCS TATACONSUM TATAELXSI TMPV TATAPOWER TATASTEEL TECHM TITAN TORNTPHARM TRENT TIINDIA UPL UJJIVANSFB ULTRACEMCO UNIONBANK UNITDSPR UNOMINDA VBL VEDL VMM IDEA VOLTAS WAAREEENER WIPRO YESBANK ZYDUSLIFE`.split(/\s+/).filter(Boolean);

async function getFastTradingUniverse(broker){
  if(!broker||typeof broker.loadInstruments!=='function')throw new Error('Broker instrument master is unavailable');
  const master=await getWholeNseUniverse(broker);
  const liveFnoSymbols=[...new Set((master.optionEligibleSymbols||[]).map(normalizeSymbol).filter(Boolean))].sort();
  if(!liveFnoSymbols.length)throw new Error('No NSE stock-option underlyings found in the live broker instrument master');

  // Audit each configured symbol against the actual NSE_EQ instrument key and
  // the NSE_FO underlying_key. Do not change the configured universe based on
  // symbol-name similarity alone; report exact-key and symbol-only matches.
  const configuredInstrumentAudit=ICICI_OPTION_STOCK_SYMBOLS.map(raw=>{
    const symbol=normalizeSymbol(raw);
    const equityKeys=[...(master.equityKeysBySymbol?.get(symbol)||[])].sort();
    const equityKey=equityKeys.length===1?equityKeys[0]:null;
    const foKeys=[...(master.foRowsByUnderlyingSymbol?.get(symbol)||[])].sort();
    const exactFoLinked=equityKey?!!master.foRowsByUnderlyingKey?.has(equityKey):false;
    const foSymbolPresent=foKeys.length>0||(master.optionEligibleSymbols||[]).some(x=>normalizeSymbol(x)===symbol);
    let status='MATCH';
    if(equityKeys.length===0)status='NO_NSE_EQ';
    else if(equityKeys.length>1)status='DUPLICATE_NSE_EQ_KEYS';
    else if(exactFoLinked)status='MATCH';
    else if(foSymbolPresent)status='FO_SYMBOL_ONLY_KEY_MISMATCH';
    else status='NO_NSE_FO';
    return{configuredSymbol:raw,nseEquitySymbol:symbol,nseEquityInstrumentKey:equityKey,equityKeyCount:equityKeys.length,foUnderlyingKeys:foKeys,exactFoKeyMatch:exactFoLinked,status};
  });
  const auditCounts=configuredInstrumentAudit.reduce((a,row)=>(a[row.status]=(a[row.status]||0)+1,a),{});
  console.log('NSE_EQ + NSE_FO INSTRUMENT-KEY AUDIT: '+JSON.stringify(auditCounts));
  for(const row of configuredInstrumentAudit)console.log('INSTRUMENT KEY MATCH: '+JSON.stringify(row));

  // Preserve current symbol-intersection behavior until the complete audit is reviewed.
  const liveFnoSet=new Set(liveFnoSymbols);
  const configuredSymbols=[...new Set(ICICI_OPTION_STOCK_SYMBOLS.map(normalizeSymbol).filter(symbol=>liveFnoSet.has(symbol)))].sort();
  const configuredMissing=ICICI_OPTION_STOCK_SYMBOLS.filter(symbol=>!liveFnoSet.has(normalizeSymbol(symbol)));
  const symbols=configuredSymbols.length?configuredSymbols:liveFnoSymbols;
  console.log('CONFIGURED OPTIONS UNIVERSE: '+configuredSymbols.length+'/'+ICICI_OPTION_STOCK_SYMBOLS.length+' configured symbols verified in live F&O master');
  if(configuredMissing.length)console.log('CONFIGURED SYMBOLS NOT IN LIVE F&O MASTER: '+configuredMissing.join(', '));
  return{
    name:configuredSymbols.length?'CONFIGURED_NSE_FNO_STOCK_OPTIONS':'UPSTOX_NSE_FNO_STOCK_OPTIONS_FALLBACK',
    symbols,
    universeSize:symbols.length,
    optionEligibleSymbols:symbols,
    optionEligibleCount:symbols.length,
    configuredSymbols,
    liveFnoSymbols,
    configuredMissing,
    configuredInstrumentAudit,
    instrumentAuditCounts:auditCounts,
    source:configuredSymbols.length?'Configured options stocks intersected with live Upstox NSE F&O master':'Live Upstox NSE derivative instrument master fallback'
  };
}
function equityByKeyHasSymbol(map,symbol){for(const value of map.values())if(value===symbol)return true;return false;}

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
