const NSE_EQUITY_SEGMENT="NSE_EQ";
const NSE_FO_SEGMENT="NSE_FO";
const NSE_OPTION_TYPES=new Set(["CE","PE"]);

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
async function getFastTradingUniverse(broker){
  if(!broker||typeof broker.loadInstruments!=='function')throw new Error('Broker instrument master is unavailable');
  const instruments=await broker.loadInstruments();
  if(!Array.isArray(instruments)||!instruments.length)throw new Error('NSE instrument master is empty');

  const equityByKey=new Map();
  for(const i of instruments.filter(isNseEquity)){
    const key=String(i?.instrument_key??i?.instrumentKey??'').trim();
    const symbol=normalizeSymbol(i?.trading_symbol??i?.tradingSymbol??i?.symbol);
    if(key&&symbol&&!equityByKey.has(key))equityByKey.set(key,symbol);
  }

  const fno=new Set();
  for(const derivative of instruments.filter(isNseDerivative)){
    const underlyingKey=String(derivative?.underlying_key??derivative?.underlyingKey??derivative?.underlying_instrument_key??derivative?.underlyingInstrumentKey??'').trim();
    if(underlyingKey&&equityByKey.has(underlyingKey)){fno.add(equityByKey.get(underlyingKey));continue;}
    const symbol=getUnderlyingSymbol(derivative);
    if(symbol)fno.add(symbol);
  }

  const symbols=[...fno].filter(s=>equityByKeyHasSymbol(equityByKey,s));
  if(!symbols.length)throw new Error('No NSE F&O equity underlyings found');

  return{
    name:'FAST_FNO_UNIVERSE',
    symbols,
    universeSize:symbols.length,
    optionEligibleSymbols:symbols,
    optionEligibleCount:symbols.length,
    source:'Upstox instrument master: NSE equity derivatives underlyings'
  };
}
function equityByKeyHasSymbol(map,symbol){for(const value of map.values())if(value===symbol)return true;return false;}

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

module.exports={getFastTradingUniverse,getWholeNseUniverse,normalizeSymbol,isNseEquity,isNseDerivative};
