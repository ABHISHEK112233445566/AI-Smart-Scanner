const has=(v)=>v!==null&&v!==undefined&&v!==""&&!(typeof v==="number"&&!Number.isFinite(v));
const obj=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const num=(v)=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const direction=(v)=>{const s=String(v??"").trim().toUpperCase();if(["BULLISH","BULL","UP","BUY","RISING"].includes(s)||s.includes("BULL"))return"BULLISH";if(["BEARISH","BEAR","DOWN","SELL","FALLING"].includes(s)||s.includes("BEAR"))return"BEARISH";return"NEUTRAL";};
function status(value, candles, minimum=1, explicitReason=""){
  if(explicitReason)return explicitReason;
  if(!has(value))return candles<minimum?"INSUFFICIENT_HISTORY":"CALCULATION_UNAVAILABLE";
  return"AVAILABLE";
}
function item(value,source,timeframe,candles,minimum=1,extra={}){
  return{value:value??null,status:status(value,candles,minimum),source,timeframe,...extra};
}
const WEIGHTS=[5,5,5,5,5,5,10,8,8,4,5,5,5,5,10,10];
function buildParameterCoverage({indicators={},breakout={},mtf={},sr={},pivot={},cpr={},trade={},scoreData={},stockDirection="NEUTRAL"}={}){
  const i=obj(indicators),b=obj(breakout),m=obj(mtf),s=obj(sr),p=obj(pivot),c=obj(cpr),t=obj(trade),q=obj(i.dataQuality),dailyCount=Number(q.validCandles)||0;
  const macd=obj(i.macd),adx=obj(i.adx),bb=obj(i.bollinger),intraday5=obj(i.intraday5),intraday15=obj(i.intraday15);
  const values={
    price:i.price,ema5:i.ema5,ema9:i.ema9,ema20:i.ema20,ema50:i.ema50,ema100:i.ema100,ema200:i.ema200,
    rsi:i.rsi,macd:macd.MACD??macd.macd??i.macdValue??i.macd,macdSignal:macd.signal??i.macdSignal,
    macdHistogram:macd.histogram??i.macdHistogram,adx:adx.adx??i.adxValue,pdi:adx.pdi??adx.PDI??i.pdi,
    mdi:adx.mdi??adx.MDI??i.mdi,vwap:i.vwap??i.sessionVwap,supertrend:i.supertrend?.trend??i.supertrend,
    atr:i.atr,bollingerUpper:bb.upper,bollingerMiddle:bb.middle,bollingerLower:bb.lower,
    volume:i.volume,volumeSMA20:i.volumeSMA20,avgVolume5:i.avgVolume5,rvol:i.rvol,volumeSpike:i.volumeSpike,
    obv:i.obv,obvTrend:i.obvTrend,mfi:i.mfi,breakout:b.breakout,chartPattern:b.chartPattern,
    patternStatus:b.patternStatus,patternDirection:b.patternDirection,patternConfidence:b.patternConfidence,
    support1:s.support1,support2:s.support2,resistance1:s.resistance1,resistance2:s.resistance2,
    pivot:p.pivot,cprTop:c.top,cprBottom:c.bottom,stockEntry:t.entry,stockStopLoss:t.stopLoss,
    stockTarget1:t.target1,stockTarget2:t.target2,stockRiskReward:t.riskReward
  };
  const minimums={ema5:5,ema9:9,ema20:20,ema50:50,ema100:100,ema200:200,rsi:15,macd:35,macdSignal:35,macdHistogram:35,adx:30,pdi:30,mdi:30,atr:15,bollingerUpper:20,bollingerMiddle:20,bollingerLower:20,volumeSMA20:20,mfi:15,obv:2};
  const parameters={};
  for(const [name,value] of Object.entries(values)){
    const min=minimums[name]||1;
    const timeframe=["vwap"].includes(name)?"15m":"1D";
    const source=name.startsWith("pattern")||name==="chartPattern"||name==="breakout"?"breakout/chartPatterns":name.startsWith("support")||name.startsWith("resistance")?"supportResistance":name==="pivot"?"pivotPoints":name.startsWith("cpr")?"cpr":"indicators";
    parameters[name]=item(value,source,timeframe,dailyCount,min);
  }
  // Intraday fields are tracked independently; daily data must not stand in for them.
  for(const [tf,data] of [["5m",intraday5],["15m",intraday15]]){
    const d=obj(data),count=Number(d.dataQuality?.validCandles)||0;
    for(const name of ["ema20","rsi","macd","vwap","volume","rvol"]){
      const value=name==="macd"?(d.macd?.MACD??d.macd?.macd??null):d[name];
      parameters[tf+"."+name]=item(value,"indicators",tf,count,{ema20:20,rsi:15,macd:35,vwap:1,volume:1,rvol:20}[name]||1);
    }
  }
  const mtfDetails=obj(m.details);
  for(const [name,tf] of [["daily","1D"],["fourHour","4H"],["oneHour","1H"],["fifteenMin","15m"]]){
    const detail=obj(mtfDetails[name]);
    parameters["mtf."+name]={value:detail.direction??null,status:detail.valid===true?"AVAILABLE":detail.reason||"TIMEFRAME_UNAVAILABLE",source:"mtfScanner",timeframe:tf,valid:detail.valid===true};
  }
  const call=direction(stockDirection)==="BULLISH",put=direction(stockDirection)==="BEARISH";
  const factors=[
    ["priceVsEma20",["price","ema20"],i.price>i.ema20,i.price<i.ema20],
    ["priceVsEma50",["price","ema50"],i.price>i.ema50,i.price<i.ema50],
    ["ema20VsEma50",["ema20","ema50"],i.ema20>i.ema50,i.ema20<i.ema50],
    ["ema50VsEma100",["ema50","ema100"],i.ema50>i.ema100,i.ema50<i.ema100],
    ["ema100VsEma200",["ema100","ema200"],i.ema100>i.ema200,i.ema100<i.ema200],
    ["priceVsVwap",["price","vwap"],i.price>i.vwap,i.price<i.vwap],
    ["supertrend",["supertrend"],direction(i.supertrend?.trend??i.supertrend)==="BULLISH",direction(i.supertrend?.trend??i.supertrend)==="BEARISH"],
    ["rsi",["rsi"],num(i.rsi)>=55&&num(i.rsi)<=70,num(i.rsi)>=30&&num(i.rsi)<=45],
    ["macdVsSignal",["macd","macdSignal"],num(macd.MACD)>num(macd.signal),num(macd.MACD)<num(macd.signal)],
    ["macdHistogram",["macdHistogram"],num(macd.histogram)>0,num(macd.histogram)<0],
    ["bollingerMiddle",["price","bollingerMiddle"],i.price>bb.middle,i.price<bb.middle],
    ["rvol",["rvol"],num(i.rvol)>=1.2,num(i.rvol)>=1.2],
    ["volumeSpike",["volumeSpike"],i.volumeSpike===true,i.volumeSpike===true],
    ["obvDirection",["obvTrend"],direction(i.obvTrend)==="BULLISH",direction(i.obvTrend)==="BEARISH"],
    ["adx",["adx"],num(adx.adx??i.adxValue)>25,num(adx.adx??i.adxValue)>25],
    ["diSpread",["pdi","mdi"],num(adx.pdi??i.pdi)>num(adx.mdi??i.mdi),num(adx.mdi??i.mdi)>num(adx.pdi??i.pdi)]
  ];
  const scoringFactors=factors.map(([name,deps,callCondition,putCondition],index)=>{
    const missing=deps.filter(dep=>!has(values[dep]));
    const evaluated=missing.length===0;
    return{name,dependencies:deps,status:evaluated?"EVALUATED":"NOT_EVALUATED_MISSING_INPUT",missingInputs:missing,weight:WEIGHTS[index],callCondition:evaluated?Boolean(callCondition):null,putCondition:evaluated?Boolean(putCondition):null,callPoints:evaluated&&callCondition?WEIGHTS[index]:0,putPoints:evaluated&&putCondition?WEIGHTS[index]:0};
  });
  const available=Object.values(parameters).filter(x=>x.status==="AVAILABLE").length;
  const unavailable=Object.values(parameters).length-available;
  return{version:1,generatedAt:new Date().toISOString(),summary:{totalParameters:Object.keys(parameters).length,available,unavailable,scoringFactors:Object.keys(scoringFactors).length,scoringFactorsEvaluated:scoringFactors.filter(x=>x.status==="EVALUATED").length,scoringFactorsNotEvaluated:scoringFactors.filter(x=>x.status!=="EVALUATED").length},parameters,scoringFactors,stages:{chartPattern:{status:has(b.chartPattern)&&b.chartPattern!=="NONE"?"DETECTED":b.patternError?"CALCULATION_FAILED":"NOT_DETECTED",pattern:b.chartPattern??"NONE",direction:b.patternDirection??"NEUTRAL",confidence:b.patternConfidence??null},marketStructure:{status:Object.values(s).some(has)?"AVAILABLE":"UNAVAILABLE"},mtf:{status:m.validTimeframes>0?"PARTIAL_OR_AVAILABLE":"UNAVAILABLE",validTimeframes:m.validTimeframes??0,unknownTimeframes:m.unknownTimeframes??4},options:{status:"NOT_CHECKED_PRE_OPTION_STAGE"},oi:{status:"NOT_CHECKED_PRE_OPTION_STAGE"}},scoreContext:{direction:stockDirection,aiBullishScore:scoreData.bullishScore??null,aiBearishScore:scoreData.bearishScore??null,finalScore:scoreData.finalScore??scoreData.score??null}};
}
module.exports={buildParameterCoverage};
