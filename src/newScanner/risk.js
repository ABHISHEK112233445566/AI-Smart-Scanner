"use strict";

const { positive } = require("./normalize");

const DAILY_MAX_LOSS_RUPEES=1000;
const MAX_TRADES_PER_DAY=1;
const NO_REENTRY_AFTER_EXIT=true;

function validateCandidate(row) {
  const reasons=[];
  if(row?.dataStatus!=="VALID") reasons.push("UNDERLYING_QUOTE_NOT_VALID");
  if(row?.quote?.previousClose===null) reasons.push("PREVIOUS_CLOSE_UNAVAILABLE");
  if(row?.marketDataFresh!==true) reasons.push("UNDERLYING_QUOTE_STALE_OR_MARKET_CLOSED");
  if(row?.tradeWindowOpen!==true) reasons.push("OUTSIDE_APPROVED_TRADE_WINDOW");
  const latestVolume=Number(row?.directionalAnalysis?.indicators?.latestVolume)||0;
  const averageVolume=Number(row?.directionalAnalysis?.indicators?.averageVolume)||0;
  if(!(latestVolume>0&&averageVolume>0&&latestVolume>=averageVolume)) reasons.push("UNDERLYING_VOLUME_NOT_CONFIRMED");
  if(row?.directionalAnalysis?.direction!=="BULLISH"&&row?.directionalAnalysis?.direction!=="BEARISH") reasons.push("DIRECTION_NOT_CONFIRMED");
  if(!(row?.underlyingLevels?.valid===true&&positive(row.underlyingLevels.riskReward)>=1.5)) reasons.push("UNDERLYING_MARKET_STRUCTURE_OR_RR_INVALID");
  if(row?.optionStatus!=="VALID") reasons.push(row?.optionReason||"OPTION_SETUP_NOT_VALID");
  const aligned=row?.timeframeAnalysis?.direction===row?.directionalAnalysis?.direction && Math.max(row?.timeframeAnalysis?.bullishTimeframes||0,row?.timeframeAnalysis?.bearishTimeframes||0)>=3;
  if(!aligned) reasons.push("MTF_ALIGNMENT_NOT_CONFIRMED");
  const oppositePattern=row?.directionalAnalysis?.direction==="BULLISH"?"BEARISH":"BULLISH";
  const confirmedOpposingPatterns=(row?.timeframeAnalysis?.rows||[]).filter(x=>x.patternStatus==="CONFIRMED"&&x.patternDirection===oppositePattern).length;
  if(confirmedOpposingPatterns>=2) reasons.push("CONFIRMED_PATTERN_CONFLICT_ACROSS_TIMEFRAMES");
  if(row?.optionQuoteFresh!==true) reasons.push("OPTION_QUOTE_STALE_OR_TIMESTAMP_MISSING");
  if(row?.optionCandlesFresh!==true) reasons.push("OPTION_5M_CANDLES_STALE_OR_MISSING");
  if(row?.oi?.dataStatus!=="VALID") reasons.push("OI_DATA_UNAVAILABLE");
  if(row?.news?.status==="NEWS_UNAVAILABLE") reasons.push("NEWS_DATA_UNAVAILABLE");
  return { passed:reasons.length===0,reasons };
}
function buildDailyRiskState({date,tradeCount=0,realizedPnl=0,hasExited=false}={}) {
  return {date,tradeCount:Number(tradeCount)||0,realizedPnl:Number(realizedPnl)||0,hasExited:Boolean(hasExited),maxTrades:MAX_TRADES_PER_DAY,maxLoss:DAILY_MAX_LOSS_RUPEES,entriesAllowed:(Number(tradeCount)||0)<MAX_TRADES_PER_DAY&&(Number(realizedPnl)||0)>-DAILY_MAX_LOSS_RUPEES&&!hasExited};
}
function validateEntryPermission(state={}) {
  if(!state.entriesAllowed)return {allowed:false,reason:"DAILY_RISK_LIMIT_REACHED"};
  if(state.tradeCount>=MAX_TRADES_PER_DAY)return {allowed:false,reason:"ONE_TRADE_PER_DAY_LIMIT"};
  if(state.realizedPnl<=-DAILY_MAX_LOSS_RUPEES)return {allowed:false,reason:"DAILY_MAX_LOSS_REACHED"};
  if(NO_REENTRY_AFTER_EXIT&&state.hasExited)return {allowed:false,reason:"NO_REENTRY_AFTER_EXIT"};
  return {allowed:true,reason:"RISK_LIMITS_CLEAR"};
}
module.exports={validateCandidate,buildDailyRiskState,validateEntryPermission,DAILY_MAX_LOSS_RUPEES,MAX_TRADES_PER_DAY};
