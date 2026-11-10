"use strict";

const { positive, number, parseTimestamp } = require("./normalize");
const { LIMITS } = require("./schema");

function expiryDate(value) {
  const s=String(value??"").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d=new Date(s);
  return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function sideOf(contract) {
  const type=String(contract?.instrument_type??contract?.option_type??contract?.optionType??"").toUpperCase();
  if (["CE","CALL"].includes(type)) return "CE";
  if (["PE","PUT"].includes(type)) return "PE";
  const name=String(contract?.trading_symbol??contract?.tradingSymbol??"").toUpperCase();
  return name.endsWith("CE")?"CE":name.endsWith("PE")?"PE":null;
}
function selectContract(contracts, direction, spot, now=new Date()) {
  const side=direction==="BULLISH"?"CE":direction==="BEARISH"?"PE":null;
  if (!side||positive(spot)===null) return { valid:false,reason:"DIRECTION_OR_SPOT_MISSING" };
  const today=new Date(now); today.setHours(0,0,0,0);
  const eligible=(Array.isArray(contracts)?contracts:[]).filter(c=>{
    const expiry=expiryDate(c.expiry),d=expiry?new Date(expiry+"T00:00:00"):null;
    const days=d?Math.ceil((d-today)/86400000):-1;
    return sideOf(c)===side&&days>=7&&positive(c.strike_price??c.strike)!==null&&
      Boolean(c.instrument_key??c.instrumentKey);
  });
  if(!eligible.length) return { valid:false,reason:"NO_VALID_SIDE_EXPIRY_CONTRACT" };
  const expiry=[...new Set(eligible.map(c=>expiryDate(c.expiry)))].sort()[0];
  const same=eligible.filter(c=>expiryDate(c.expiry)===expiry);
  same.sort((a,b)=>Math.abs(number(a.strike_price??a.strike)-spot)-Math.abs(number(b.strike_price??b.strike)-spot));
  const contract=same[0];
  return { valid:true,side,strike:number(contract.strike_price??contract.strike),expiry,instrumentKey:contract.instrument_key??contract.instrumentKey,tradingSymbol:contract.trading_symbol??contract.tradingSymbol??"",contract };
}
function optionPremiumLevels(candles) {
  const rows=(Array.isArray(candles)?candles:[]).filter(c=>c&&[c.open,c.high,c.low,c.close,c.volume].every(v=>number(v)!==null));
  if(rows.length<LIMITS.MIN_OPTION_CANDLES) return {valid:false,reason:"OPTION_5M_HISTORY_INSUFFICIENT",candlesUsed:rows.length};
  const closed=rows.slice(-31,-1),entry=positive(rows.at(-1)?.close);
  if(!entry||closed.length<15) return {valid:false,reason:"OPTION_5M_SWINGS_UNAVAILABLE",candlesUsed:rows.length};
  const lows=closed.slice(-20).map(c=>c.low), highs=closed.slice(-20).map(c=>c.high);
  const stop=Math.max(...lows.filter(v=>v<entry));
  const target=Math.min(...highs.filter(v=>v>entry));
  const risk=entry-stop,reward=target-entry,rr=risk>0&&reward>0?reward/risk:null;
  if(!(stop>0&&target>entry&&rr>=1.5)) return {valid:false,reason:"OPTION_PREMIUM_RR_BELOW_1_5_OR_LEVELS_MISSING",entry,stopLoss:stop||null,target:target||null,riskReward:rr,candlesUsed:rows.length};
  return {valid:true,entry,stopLoss:stop,target,riskReward:rr,candlesUsed:rows.length,levelSource:"OPTION_5M_OHLC_SWINGS"};
}
async function analyzeOption(stock,broker) {
  const direction=stock.directionalAnalysis?.direction??stock.direction;
  if(!["BULLISH","BEARISH"].includes(direction)) return {...stock,optionStatus:"REJECTED",optionReason:"NO_DIRECTIONAL_BIAS"};
  try {
    const contracts=await broker.getOptionContracts(stock.instrumentKey);
    const selected=selectContract(contracts,direction,stock.quote?.ltp);
    if(!selected.valid) return {...stock,optionStatus:"REJECTED",optionReason:selected.reason};
    const quote=await broker.getOptionQuote(selected.instrumentKey);
    const premiumQuote=quote?.raw??quote;
    const optionQuote={ltp:positive(quote?.ltp??premiumQuote?.last_price),volume:number(quote?.volume??premiumQuote?.volume),oi:number(quote?.oi??premiumQuote?.oi),previousOI:number(quote?.previousOI??premiumQuote?.prev_oi),timestamp:quote?.timestamp??premiumQuote?.timestamp??null};
    if(!optionQuote.ltp) return {...stock,optionStatus:"REJECTED",optionReason:"OPTION_LTP_UNAVAILABLE"};
    const candlesRaw=await broker.getHistoricalData(selected.instrumentKey,"FIVE_MINUTE");
    const candles=(Array.isArray(candlesRaw)?candlesRaw:[]).map(c=>({time:c.time??c.timestamp,open:number(c.open),high:number(c.high),low:number(c.low),close:number(c.close),volume:number(c.volume)})).filter(c=>c.open&&c.high&&c.low&&c.close&&c.volume!==null);
    const levels=optionPremiumLevels(candles);
    const liquidity=optionQuote.volume!==null&&optionQuote.oi!==null&&optionQuote.volume>=5000&&optionQuote.oi>=10000;
    const quoteMatches=optionQuote.ltp>0;
    const optionTimestamp=parseTimestamp(optionQuote.timestamp);\n    const optionQuoteAgeMs=optionTimestamp===null?null:Date.now()-optionTimestamp;\n    const optionQuoteFresh=optionQuoteAgeMs!==null&&optionQuoteAgeMs>=0&&optionQuoteAgeMs<=120000;\n    const tradeReady=levels.valid&&liquidity&&quoteMatches&&optionQuoteFresh;
    return {...stock,optionStatus:tradeReady?"VALID":"WATCH",optionReason:tradeReady?"OPTION_SETUP_VALID":levels.reason||(!liquidity?"OPTION_LIQUIDITY_BELOW_MINIMUM":"OPTION_DATA_INCOMPLETE"),optionContract:selected,optionQuote,optionQuoteAgeMs,optionQuoteFresh,optionPremiumSetup:levels,optionLiquidityConfirmed:liquidity};
  } catch(error) {
    return {...stock,optionStatus:"FAILED",optionReason:error?.message||String(error)};
  }
}
module.exports = { selectContract, optionPremiumLevels, analyzeOption, sideOf, expiryDate };
