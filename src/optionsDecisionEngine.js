const brokerModule = require('./brokers');

const C = Object.freeze({
  MIN_DIRECTION_SCORE: 35,
  MIN_DIRECTION_DIFFERENCE: 10,
  MIN_DIRECTION_EVIDENCE: 3,
  WATCH_CONFIDENCE: 65,
  TRADE_CONFIDENCE: 85,
  WATCH_RR: 1.2,
  TRADE_RR: 1.5,
  MIN_EXPIRY_DAYS: 7,
  TRADE_SCANNER_SCORE: 85
});

const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const positive = (...v) => v.map(num).find(x => x !== null && x > 0) || 0;
const clamp = v => Math.max(0, Math.min(100, num(v) ?? 0));
const round2 = v => num(v) === null ? 0 : Number(Number(v).toFixed(2));
const text = v => String(v ?? '').trim().toUpperCase();
function getBroker() { return typeof brokerModule.getBroker === 'function' ? brokerModule.getBroker() : brokerModule; }
function normalizeDirection(v) {
  const s = text(v);
  if (s === 'BULLISH' || s === 'BULL' || s === 'LONG' || s === 'CALL' || s === 'CE' || s === 'BUY' || s === 'UP' || s.includes('BULLISH')) return 'BULLISH';
  if (s === 'BEARISH' || s === 'BEAR' || s === 'SHORT' || s === 'PUT' || s === 'PE' || s === 'SELL' || s === 'DOWN' || s.includes('BEARISH')) return 'BEARISH';
  return 'UNKNOWN';
}
function stockPrice(d) { return positive(d?.price,d?.ltp,d?.lastPrice,d?.last_price,d?.close,d?.currentPrice); }
function stockEntry(d,p) { return positive(d?.marketEntry,d?.triggerPrice,d?.entry,d?.stockEntry,d?.underlyingEntry,p); }

const SUPPORT_KEYS=['support','support1','support2','support3','s1','s2','s3','pivotS1','pivotS2','pivotS3','oiSupport1','oiSupport2','oiSupport3','swingLow','previousLow','recentLow','dayLow'];
const RESISTANCE_KEYS=['resistance','resistance1','resistance2','resistance3','r1','r2','r3','pivotR1','pivotR2','pivotR3','oiResistance1','oiResistance2','oiResistance3','swingHigh','previousHigh','recentHigh','dayHigh'];
function collectLevels(source,keys){
  if(!source||typeof source!=='object')return[]; const out=[];
  for(const k of keys){const v=source[k]; if(Array.isArray(v)) for(const x of v) out.push(x&&typeof x==='object'?(x.value??x.level??x.price??x.close):x); else if(v&&typeof v==='object') out.push(...Object.values(v)); else out.push(v);}
  return out.map(num).filter(x=>x!==null&&x>0);
}
function getLevels(d,side){
  const keys=side==='support'?SUPPORT_KEYS:RESISTANCE_KEYS; const sr=d?.supportResistance||d?.support_resistance||d?.sr||{}; const p=d?.pivot||d?.pivots||{};
  const pk=side==='support'?['s1','s2','s3','S1','S2','S3']:['r1','r2','r3','R1','R2','R3'];
  return [...new Set([...collectLevels(d,keys),...collectLevels(sr,keys),...collectLevels(p,pk),...(Array.isArray(d?.[side+'Levels'])?d[side+'Levels']:[])].map(num).filter(x=>x!==null&&x>0).map(round2))].sort((a,b)=>a-b);
}
function marketSetup(d,entry,type){
  const supports=getLevels(d,'support').filter(x=>x<entry).sort((a,b)=>b-a), resistances=getLevels(d,'resistance').filter(x=>x>entry).sort((a,b)=>a-b);
  const sl=type==='CALL'?(supports[0]||0):(resistances[0]||0), targets=type==='CALL'?resistances:supports;
  const risk=type==='CALL'?entry-sl:sl-entry;
  if(entry<=0||sl<=0||risk<=0||!targets.length)return {valid:false,entry:round2(entry),stopLoss:round2(sl),target1:0,target2:0,risk:round2(Math.max(0,risk)),reward:0,riskReward:0,reason:'INVALID_MARKET_SETUP',supportLevels:supports,resistanceLevels:resistances};
  const rr=t=>risk>0?((type==='CALL'?t-entry:entry-t)/risk):0; const validTargets=targets.filter(t=>rr(t)>0); const t1=validTargets[0]||0; const t2=validTargets.find(t=>t!==t1&&rr(t)>rr(t1))||0; const reward=t1>0?Math.max(0,type==='CALL'?t1-entry:entry-t1):0;
  return {valid:t1>0&&risk>0,riskReward:round2(reward/risk),entry:round2(entry),stopLoss:round2(sl),target1:round2(t1),target2:round2(t2),risk:round2(risk),reward:round2(reward),supportLevels:supports,resistanceLevels:resistances,stopSource:type==='CALL'?'MARKET_SUPPORT':'MARKET_RESISTANCE',target1Source:'MARKET_STRUCTURE',target2Source:t2?'NEXT_MARKET_STRUCTURE':'NONE',reason:rr(t1)>=C.TRADE_RR?'VALID_MARKET_STRUCTURE_RR':'LOW_MARKET_RR'};
}

function direction(d,price){
  let callScore=0,putScore=0,callEvidence=0,putEvidence=0;
  // Must match mtfScanner: Daily + 1H + 30M + 15M. No 4H dependency.
  for(const [k,w] of [['dailyTrend',12],['oneHourTrend',14],['thirtyMinTrend',8],['fifteenMinTrend',10]]){const x=normalizeDirection(d?.[k]);if(x==='BULLISH'){callScore+=w;callEvidence++;}else if(x==='BEARISH'){putScore+=w;putEvidence++;}}
  const e5=num(d?.ema5),e9=num(d?.ema9),e20=num(d?.ema20),e50=num(d?.ema50);
  if([e5,e9,e20,e50].every(x=>x!==null&&x>0)){if(e5>e9&&e9>e20&&e20>e50){callScore+=12;callEvidence++;}if(e5<e9&&e9<e20&&e20<e50){putScore+=12;putEvidence++;}}
  if(e20!==null&&e50!==null&&price>0){if(price>e20&&price>e50){callScore+=7;callEvidence++;}if(price<e20&&price<e50){putScore+=7;putEvidence++;}}
  const rsi=num(d?.rsi);if(rsi!==null){if(rsi>=55&&rsi<=70){callScore+=8;callEvidence++;}if(rsi>=30&&rsi<=45){putScore+=8;putEvidence++;}}
  const m=d?.macd&&typeof d.macd==='object'?d.macd:{};const macd=num(d?.macdValue??d?.macd??m.MACD),signal=num(d?.macdSignal??m.signal),hist=num(d?.histogram??d?.macdHistogram??m.histogram);if(macd!==null&&signal!==null&&hist!==null){if(macd>signal&&hist>=0){callScore+=8;callEvidence++;}if(macd<signal&&hist<=0){putScore+=8;putEvidence++;}}
  const a=d?.adx&&typeof d.adx==='object'?d.adx:{};const adx=num(d?.adxValue??a.adx??d?.adx),pdi=num(d?.pdi??a.pdi),mdi=num(d?.mdi??a.mdi);if(adx!==null&&pdi!==null&&mdi!==null&&adx>=20){if(pdi>mdi){callScore+=7;callEvidence++;}if(mdi>pdi){putScore+=7;putEvidence++;}}
  const vwap=num(d?.vwap);if(vwap!==null&&price>vwap){callScore+=5;callEvidence++;}else if(vwap!==null&&price<vwap){putScore+=5;putEvidence++;}
  const st=normalizeDirection(d?.supertrend?.trend??d?.supertrend);if(st==='BULLISH'){callScore+=5;callEvidence++;}else if(st==='BEARISH'){putScore+=5;putEvidence++;}
  const sd=normalizeDirection(d?.signal),td=normalizeDirection(d?.trend);if(sd==='BULLISH'){callScore+=5;callEvidence++;}else if(sd==='BEARISH'){putScore+=5;putEvidence++;}if(td==='BULLISH'){callScore+=3;callEvidence++;}else if(td==='BEARISH'){putScore+=3;putEvidence++;}
  const diff=Math.abs(callScore-putScore);let optionType=null;if(callScore>putScore&&callScore>=C.MIN_DIRECTION_SCORE&&diff>=C.MIN_DIRECTION_DIFFERENCE&&callEvidence>=C.MIN_DIRECTION_EVIDENCE)optionType='CALL';else if(putScore>callScore&&putScore>=C.MIN_DIRECTION_SCORE&&diff>=C.MIN_DIRECTION_DIFFERENCE&&putEvidence>=C.MIN_DIRECTION_EVIDENCE)optionType='PUT';
  return {optionType,callScore,putScore,directionDifference:diff,callEvidence,putEvidence,dominantEvidence:optionType==='CALL'?callEvidence:optionType==='PUT'?putEvidence:0};
}

function mtf(type,d){
  const expected=type==='CALL'?'BULLISH':'BEARISH'; const values=[['DAILY',d?.dailyTrend],['1H',d?.oneHourTrend],['30M',d?.thirtyMinTrend],['15M',d?.fifteenMinTrend]].map(([name,v])=>({name,value:normalizeDirection(v)}));
  const available=values.filter(x=>x.value!=='UNKNOWN'),aligned=available.filter(x=>x.value===expected),opposition=available.filter(x=>x.value!==expected); const score=available.length?Math.round(clamp(50+((aligned.length-opposition.length)/available.length)*50)):0;
  return {score,alignment:aligned.length,opposition:opposition.length,available:available.length,alignedTimeframes:aligned.map(x=>x.name),isAligned:aligned.length>=3,complete:available.length===4};
}
function confidence(d,dir,m,rr){
  const scanner=clamp(d?.rankingScore??d?.finalScore??d?.aiFinalScore??d?.aiScore??d?.scannerScore??d?.score);const ds=clamp(dir.optionType==='CALL'?dir.callScore:dir.putScore);const expected=dir.optionType==='CALL'?'BULLISH':'BEARISH';const trend=normalizeDirection(d?.trend)===expected?100:50;const rsi=num(d?.rsi);const momentum=((dir.optionType==='CALL'&&rsi>=55&&rsi<=70)||(dir.optionType==='PUT'&&rsi>=30&&rsi<=45))?100:50;const rv=num(d?.rvol);const volume=rv>=2?100:rv>=1.5?85:rv>=1.2?70:rv>=1?55:35;const rrScore=rr>=2.5?100:rr>=2?90:rr>=1.5?80:rr>=1.2?65:0;const value=scanner*.25+ds*.22+m.score*.15+trend*.12+momentum*.10+volume*.06+rrScore*.10;return {confidence:Math.round(clamp(value)),scannerScore:Math.round(scanner),directionScore:Math.round(ds),trendScore:trend,momentumScore:momentum,volumeScore:volume,rrScore};
}
function gates(dir,m,rr,conf,scanner){const base={direction:!!dir.optionType,directionEvidence:dir.dominantEvidence>=3,directionDifference:dir.directionDifference>=10,mtf:m.alignment>=2,riskReward:rr>=C.WATCH_RR,confidence:conf>=C.WATCH_CONFIDENCE,scanner:scanner>=55};const trade={...base,tradeMTF:m.alignment>=3&&m.complete,tradeRiskReward:rr>=C.TRADE_RR,tradeConfidence:conf>=C.TRADE_CONFIDENCE,tradeScanner:scanner>=C.TRADE_SCANNER_SCORE};return {base,trade,basePassed:Object.values(base).every(Boolean),tradePassed:Object.values(trade).every(Boolean),failedBase:Object.keys(base).filter(k=>!base[k]),failedTrade:Object.keys(trade).filter(k=>!trade[k])};}
function strikeValue(c){return positive(c?.strike,c?.strike_price,c?.strikePrice,c?.strike_price_value);}
function expiryValue(c){return c?.expiry??c?.expiry_date??c?.expiryDate??'';}
function normalizeExpiry(v){const s=String(v??'').trim();if(!s)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);}
function optionType(c){const s=text(c?.option_type??c?.optionType??c?.instrument_type??c?.option_type_name),t=text(c?.trading_symbol??c?.tradingsymbol);if(s.endsWith('CE')||t.endsWith('CE'))return 'CE';if(s.endsWith('PE')||t.endsWith('PE'))return 'PE';return null;}
async function resolveContract(symbol,type,spot){const broker=getBroker();if(!broker||typeof broker.getOptionContracts!=='function')return {contract:null,reason:'BROKER_OPTION_CONTRACT_API_MISSING'};try{const all=await broker.getOptionContracts(symbol);if(!Array.isArray(all)||!all.length)return {contract:null,reason:'NO_OPTION_CONTRACTS'};const target=type==='CALL'?'CE':'PE';const today=new Date();today.setHours(0,0,0,0);const usable=all.filter(c=>{const ex=normalizeExpiry(expiryValue(c)),d=ex?new Date(ex+'T00:00:00'):null,days=d&&!Number.isNaN(d.getTime())?Math.ceil((d-today)/86400000):-1;return strikeValue(c)>0&&optionType(c)===target&&days>=C.MIN_EXPIRY_DAYS&&(c?.instrument_key||c?.instrumentKey);});if(!usable.length)return {contract:null,reason:'NO_VALID_EXPIRY_OR_SIDE_CONTRACTS'};const strikes=[...new Set(usable.map(strikeValue))].sort((a,b)=>a-b);const atm=strikes.reduce((best,s)=>Math.abs(s-spot)<Math.abs(best-spot)?s:best,strikes[0]);const idx=strikes.indexOf(atm);const recommended=type==='CALL'?strikes[Math.max(0,idx-1)]:strikes[Math.min(strikes.length-1,idx+1)];const selected=usable.reduce((best,c)=>!best||Math.abs(strikeValue(c)-recommended)<Math.abs(strikeValue(best)-recommended)?c:best,null);return {contract:selected,atmStrike:atm,recommendedStrike:strikeValue(selected),expiry:normalizeExpiry(expiryValue(selected)),reason:'OK'};}catch(e){return {contract:null,reason:'OPTION_CONTRACT_LOOKUP_ERROR'};}}
async function getOptionQuote(c){const broker=getBroker();const key=c?.instrument_key||c?.instrumentKey;if(!broker||!key)return null;try{if(typeof broker.getOptionLTP==='function'){const q=await broker.getOptionLTP(key);return typeof q==='object'?q:{ltp:q};}if(typeof broker.getLTP==='function'){const q=await broker.getLTP(key);return typeof q==='object'?q:{ltp:q};}}catch(e){console.log(`⚠️ Option quote failed ${key}: ${e.message}`);}return null;}
function premiumLevels(q){const entry=positive(q?.ltp,q?.last_price,q?.price);if(entry<=0)return {valid:false,entry:0,stopLoss:0,target1:0,target2:0,risk:0,reward:0,riskReward:0};const sl=round2(entry*.70),t1=round2(entry*1.30),t2=round2(entry*1.60),risk=round2(entry-sl),reward=round2(t1-entry);return {valid:true,entry:round2(entry),stopLoss:sl,target1:t1,target2:t2,risk,reward,riskReward:round2(reward/risk)};}

async function calculateOptionsDecision(data){
  if(!data||typeof data!=='object')return null;const price=stockPrice(data);if(price<=0)return {stock:data?.stock||data?.symbol,optionType:null,optionsDecision:'REJECT',decision:'REJECT',reason:'INVALID_STOCK_PRICE'};
  const dir=direction(data,price);if(!dir.optionType)return {...data,stock:data.stock||data.symbol,symbol:data.symbol||data.stock,price,optionType:null,optionsDecision:'REJECT',decision:'REJECT',reason:'DIRECTION_NOT_CLEAR',callScore:dir.callScore,putScore:dir.putScore};
  const entry=stockEntry(data,price),setup=marketSetup(data,entry,dir.optionType),m=mtf(dir.optionType,data),scanner=clamp(data.rankingScore??data.finalScore??data.aiFinalScore??data.aiScore??data.scannerScore??data.score),conf=confidence(data,dir,m,setup.riskReward),gate=gates(dir,m,setup.riskReward,conf.confidence,scanner);
  let cr={contract:null,reason:'NOT_LOOKED_UP'};if(setup.valid)cr=await resolveContract(data.stock||data.symbol,dir.optionType,price);const quote=cr.contract?await getOptionQuote(cr.contract):null,premium=premiumLevels(quote);
  let decision='REJECT';if(gate.basePassed)decision=gate.tradePassed&&cr.contract&&premium.valid?'TRADE':'WATCH';const reasons=[];if(!setup.valid)reasons.push(setup.reason||'INVALID_MARKET_SETUP');if(!gate.basePassed)reasons.push(...gate.failedBase);if(decision!=='TRADE')reasons.push(...gate.failedTrade);if(!cr.contract)reasons.push(cr.reason);const unique=[...new Set(reasons.filter(Boolean))];
  return {...data,stock:data.stock||data.symbol,symbol:data.symbol||data.stock,price,optionType:dir.optionType,callScore:dir.callScore,putScore:dir.putScore,directionDifference:dir.directionDifference,directionEvidence:dir.dominantEvidence,entry:setup.entry,stopLoss:setup.stopLoss,target1:setup.target1,target2:setup.target2,risk:setup.risk,reward:setup.reward,riskReward:setup.riskReward,stockEntry:setup.entry,stockStopLoss:setup.stopLoss,stockTarget1:setup.target1,stockTarget2:setup.target2,stockRiskReward:setup.riskReward,optionSymbol:cr.contract?.trading_symbol||cr.contract?.tradingsymbol||'',recommendedStrike:cr.recommendedStrike||strikeValue(cr.contract)||null,atmStrike:cr.atmStrike||null,optionExpiry:cr.expiry||null,optionInstrumentKey:cr.contract?.instrument_key||cr.contract?.instrumentKey||'',optionPremiumEntry:premium.entry,optionPremiumStopLoss:premium.stopLoss,optionPremiumTarget1:premium.target1,optionPremiumTarget2:premium.target2,optionPremiumRisk:premium.risk,optionPremiumReward:premium.reward,optionPremiumRiskReward:premium.riskReward,optionsConfidence:conf.confidence,confidence:conf.confidence,scannerScore:conf.scannerScore,directionScore:conf.directionScore,mtfScore:m.score,mtfAlignment:m.alignment,mtfAlignedTimeframes:m.alignedTimeframes,mtfAvailableTimeframes:m.available,optionsDecision:decision,decision,gates:gate,decisionReason:unique.join(',')||'VALID_SETUP',contractLookupReason:cr.reason||'OK',marketSetup:setup,optionPremiumSetup:premium,pipeline:{...(data.pipeline||{}),optionsChecked:true}};
}
async function calculateOptionsDecisions(rows){const input=Array.isArray(rows)?rows:[];const results=[];for(const row of input){try{const r=await calculateOptionsDecision(row);if(r)results.push(r);}catch(e){results.push({stock:row?.stock||row?.symbol,symbol:row?.symbol||row?.stock,optionsDecision:'REJECT',decision:'REJECT',reason:e?.message||'OPTIONS_ENGINE_ERROR',optionsConfidence:0});}}return results;}
module.exports={calculateOptionsDecision,calculateOptionsDecisions,marketSetup};
