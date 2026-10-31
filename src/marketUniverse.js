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
  const instruments=await broker.loadInstruments();
  if(!Array.isArray(instruments)||!instruments.length)throw new Error('NSE instrument master is empty');
  const symbols=[...ICICI_OPTION_STOCK_SYMBOLS];
  return{
    name:'ICICI_DIRECT_OPTION_STOCKS',
    symbols,
    universeSize:symbols.length,
    optionEligibleSymbols:symbols,
    optionEligibleCount:symbols.length,
    source:'ICICI Direct ALL options-stocks list'
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
  const optionUnderlyings=new Set();
  for(const derivative of instruments.filter(isNseDerivative)){const underlyingKey=String(derivative?.underlying_key??derivative?.underlyingKey??derivative?.underlying_instrument_key??derivative?.underlyingInstrumentKey??'').trim();if(underlyingKey&&equityByKey.has(underlyingKey)){optionUnderlyings.add(equityByKey.get(underlyingKey));continue;}const symbol=getUnderlyingSymbol(derivative);if(symbol)optionUnderlyings.add(symbol);}
  return{name:'WHOLE_NSE',symbols:equities,universeSize:equities.length,optionEligibleSymbols:[...optionUnderlyings],optionEligibleCount:optionUnderlyings.size,source:'Upstox complete NSE instrument master'};
}

module.exports={getFastTradingUniverse,getNifty500Universe,getWholeNseUniverse,normalizeSymbol,isNseEquity,isNseDerivative};
