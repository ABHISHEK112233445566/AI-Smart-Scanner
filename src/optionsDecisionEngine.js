const brokerModule = require("./brokers");

const C = Object.freeze({
    MIN_DIRECTION_SCORE: 35,
    MIN_DIRECTION_DIFFERENCE: 10,
    MIN_DIRECTION_EVIDENCE: 3,
    WATCH_CONFIDENCE: 65,
    TRADE_CONFIDENCE: 82,
    WATCH_RR: 1.2,
    TRADE_RR: 1.5,
    MIN_EXPIRY_DAYS: 7
});

const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const positive = (...values) => { for (const v of values) { const n = num(v); if (n > 0) return n; } return 0; };
const clamp = v => Math.max(0, Math.min(100, num(v)));
const round2 = v => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : 0;
const text = v => String(v ?? "").trim().toUpperCase();
const first = (...values) => values.find(v => v !== undefined && v !== null && v !== "") ?? null;

function normalizeDirection(value) {
    const s = text(value);
    if (["BULLISH","BULL","LONG","CALL","CE","BUY","UP"].includes(s) || s.includes("BULLISH")) return "BULLISH";
    if (["BEARISH","BEAR","SHORT","PUT","PE","SELL","DOWN"].includes(s) || s.includes("BEARISH")) return "BEARISH";
    return "UNKNOWN";
}

function getBroker() { return brokerModule.getBroker ? brokerModule.getBroker() : brokerModule; }
function stockPrice(d) { return positive(d.price,d.ltp,d.lastPrice,d.last_price,d.close,d.currentPrice); }
function stockEntry(d,p) { return positive(d.marketEntry,d.triggerPrice,d.entry,d.stockEntry,d.underlyingEntry,p); }

const SUPPORT_KEYS=["support","support1","support2","support3","s1","s2","s3","pivotS1","pivotS2","pivotS3","oiSupport1","oiSupport2","oiSupport3","swingLow","previousLow","recentLow","dayLow"];
const RESISTANCE_KEYS=["resistance","resistance1","resistance2","resistance3","r1","r2","r3","pivotR1","pivotR2","pivotR3","oiResistance1","oiResistance2","oiResistance3","swingHigh","previousHigh","recentHigh","dayHigh"];

function collectLevels(source, keys) {
    const result=[];
    for (const key of keys) {
        const v=source?.[key];
        if (Array.isArray(v)) result.push(...v.flatMap(x=>x&&typeof x==="object"?[x.value,x.level,x.price,x.close]:[x]));
        else if (v&&typeof v==="object") result.push(...Object.values(v));
        else result.push(v);
    }
    return result.map(num).filter(v=>v>0);
}

function getLevels(data, side) {
    const keys=side==="support"?SUPPORT_KEYS:RESISTANCE_KEYS;
    const sr=data.supportResistance||data.support_resistance||data.sr||{};
    const pivot=data.pivot||data.pivots||{};
    const pivotKeys=side==="support"?["s1","s2","s3","S1","S2","S3"]:["r1","r2","r3","R1","R2","R3"];
    const values=[...collectLevels(data,keys),...collectLevels(sr,keys),...collectLevels(pivot,pivotKeys),...(Array.isArray(data[side+"Levels"])?data[side+"Levels"]:[])];
    return [...new Set(values.map(round2))].sort((a,b)=>a-b);
}

function marketSetup(data, entry, type) {
    const supports=getLevels(data,"support").filter(x=>x<entry).sort((a,b)=>b-a);
    const resistances=getLevels(data,"resistance").filter(x=>x>entry).sort((a,b)=>a-b);
    const stop=type==="CALL"?(supports[0]||0):(resistances[0]||0);
    const targets=type==="CALL"?resistances:supports;
    const risk=type==="CALL"?entry-stop:stop-entry;
    const rrFor=t=>risk>0?((type==="CALL"?t-entry:entry-t)/risk):0;
    const t1=targets.find(t=>rrFor(t)>=C.TRADE_RR)||targets[0]||0;
    const t2=targets.find(t=>t!==t1&&rrFor(t)>rrFor(t1))||0;
    const reward=t1>0?(type==="CALL"?t1-entry:entry-t1):0;
    const rr=risk>0&&reward>0?round2(reward/risk):0;
    return {valid:stop>0&&t1>0&&rr>=C.TRADE_RR,entry:round2(entry),stopLoss:round2(stop),target1:round2(t1),target2:round2(t2),risk:round2(risk),reward:round2(reward),riskReward:rr,supportLevels:supports,resistanceLevels:resistances,stopSource:stop?(type==="CALL"?"MARKET_SUPPORT":"MARKET_RESISTANCE"):"MARKET_STRUCTURE_REQUIRED",target1Source:t1?"MARKET_STRUCTURE":"MARKET_STRUCTURE_REQUIRED",target2Source:t2?"NEXT_MARKET_STRUCTURE":"MARKET_STRUCTURE_OPTIONAL",levelsSource:"MARKET_STRUCTURE_ONLY",reason:!stop||!t1?"MISSING_MARKET_STRUCTURE_LEVEL":rr>=C.TRADE_RR?"VALID_MARKET_STRUCTURE_RR":"LOW_MARKET_RR"};
}

function direction(data,p) {
    let call=0,put=0,ce=0,pe=0;
    for (const [key,weight] of [["dailyTrend",12],["fourHourTrend",8],["oneHourTrend",14],["fifteenMinTrend",10]]) {
        const d=normalizeDirection(data[key]);
        if(d==="BULLISH"){call+=weight;ce++;} else if(d==="BEARISH"){put+=weight;pe++;}
    }
    const e5=num(data.ema5),e9=num(data.ema9),e20=num(data.ema20),e50=num(data.ema50);
    if(e5&&e9&&e20&&e50){if(e5>e9&&e9>e20&&e20>e50){call+=12;ce++;}if(e5<e9&&e9<e20&&e20<e50){put+=12;pe++;}}
    if(e20&&e50&&p){if(p>e20&&p>e50){call+=7;ce++;}if(p<e20&&p<e50){put+=7;pe++;}}
    const rsi=num(data.rsi); if(rsi>=55&&rsi<=70){call+=8;ce++;} if(rsi>=30&&rsi<=45){put+=8;pe++;}
    const macd=num(data.macdValue??data.macd),sig=num(data.macdSignal),hist=num(data.histogram??data.macdHistogram); if(macd>sig&&hist>=0){call+=8;ce++;} if(macd<sig&&hist<=0){put+=8;pe++;}
    const adx=num(data.adx),pdi=num(data.pdi),mdi=num(data.mdi); if(adx>=20&&pdi>mdi){call+=7;ce++;} if(adx>=20&&mdi>pdi){put+=7;pe++;}
    const vwap=num(data.vwap); if(vwap&&p>vwap){call+=5;ce++;} if(vwap&&p<vwap){put+=5;pe++;}
    const st=normalizeDirection(data.supertrend?.trend??data.supertrend); if(st==="BULLISH"){call+=5;ce++;} if(st==="BEARISH"){put+=5;pe++;}
    const signal=normalizeDirection(data.signal),trend=normalizeDirection(data.trend); if(signal==="BULLISH"){call+=5;ce++;} if(signal==="BEARISH"){put+=5;pe++;} if(trend==="BULLISH"){call+=3;ce++;} if(trend==="BEARISH"){put+=3;pe++;}
    const diff=Math.abs(call-put), type=call>put&&call>=C.MIN_DIRECTION_SCORE&&diff>=C.MIN_DIRECTION_DIFFERENCE&&ce>=C.MIN_DIRECTION_EVIDENCE?"CALL":put>call&&put>=C.MIN_DIRECTION_SCORE&&diff>=C.MIN_DIRECTION_DIFFERENCE&&pe>=C.MIN_DIRECTION_EVIDENCE?"PUT":null;
    return {optionType:type,callScore:call,putScore:put,directionDifference:diff,callEvidence:ce,putEvidence:pe,dominantEvidence:call>put?ce:pe};
}

function mtf(type,data){const expected=type==="CALL"?"BULLISH":"BEARISH";const values=[["DAILY",data.dailyTrend],["4H",data.fourHourTrend],["1H",data.oneHourTrend],["15M",data.fifteenMinTrend]].map(([name,value])=>({name,value:normalizeDirection(value)}));const available=values.filter(x=>x.value!=="UNKNOWN"),aligned=available.filter(x=>x.value===expected),opposition=available.filter(x=>x.value!==expected);const score=available.length?clamp(50+((aligned.length-opposition.length)/available.length)*50):0;return {score,alignment:aligned.length,opposition:opposition.length,available:available.length,required:3,alignedTimeframes:aligned.map(x=>x.name),availableTimeframes:available.map(x=>x.name),isAligned:aligned.length>=3};}

function confidence(data,dir,m,rr) {
    // Preserve the original scanner score. Do not overwrite it with a second scanner calculation.
    const scanner=clamp(first(data.rankingScore,data.finalScore,data.aiFinalScore,data.aiScore,data.scannerScore,data.score)||0);
    const direction=clamp(dir.optionType==="CALL"?dir.callScore:dir.putScore);
    const trend=clamp(50+(normalizeDirection(data.trend)===(dir.optionType==="CALL"?"BULLISH":"BEARISH")?15:0));
    const rsi=num(data.rsi); const momentum=clamp(50+(((dir.optionType==="CALL"&&rsi>=55&&rsi<=70)||(dir.optionType==="PUT"&&rsi>=30&&rsi<=45))?20:0));
    const rvol=num(data.rvol); const volume=rvol>=2?100:rvol>=1.5?85:rvol>=1.2?70:rvol>=1?55:35;
    const rrScore=rr>=2.5?100:rr>=2?90:rr>=1.5?80:rr>=1.2?65:0;
    const value=clamp(scanner*.25+direction*.22+m.score*.15+trend*.12+momentum*.10+volume*.06+50*.04+rrScore*.06);
    return {confidence:Math.round(value),scannerScore:Math.round(scanner),directionScore:Math.round(direction),trendScore:Math.round(trend),momentumScore:Math.round(momentum),volumeScore:Math.round(volume),rrScore:Math.round(rrScore)};
}

function gates(dir,m,rr,conf,scanner) {
    const base={direction:!!dir.optionType,directionEvidence:dir.dominantEvidence>=3,directionDifference:dir.directionDifference>=10,mtf:m.alignment>=2,riskReward:rr>=C.WATCH_RR,confidence:conf>=C.WATCH_CONFIDENCE,scanner:scanner>=55};
    const trade={...base,tradeMTF:m.alignment>=3,tradeRiskReward:rr>=C.TRADE_RR,tradeConfidence:conf>=C.TRADE_CONFIDENCE,tradeScanner:scanner>=70};
    return {base,trade,failedBase:Object.keys(base).filter(k=>!base[k]),failedTrade:Object.keys(trade).filter(k=>!trade[k]),basePassed:Object.values(base).every(Boolean),tradePassed:Object.values(trade).every(Boolean)};
}

function recommendedStrike(contracts,spot,type) {
    const valid=(contracts||[]).filter(c=>c&&Number(c.strike)>0);
    if(!valid.length) return null;
    const strikes=[...new Set(valid.map(c=>Number(c.strike)).filter(Number.isFinite))].sort((a,b)=>a-b);
    const atm=strikes.reduce((best,s)=>Math.abs(s-spot)<Math.abs(best-spot)?s:best,strikes[0]);
    const index=strikes.indexOf(atm);
    // CALL: one strike ITM; PUT: one strike ITM. This is based on actual available strikes.
    const target=type==="CALL"?strikes[Math.max(0,index-1)]:strikes[Math.min(strikes.length-1,index+1)];
    return {strike:target,atmStrike:atm,strikeInterval:index>0?Math.abs(strikes[index]-strikes[index-1]):0};
}

async function resolveContract(symbol,type,spot) {
    const broker=getBroker();
    if(!broker) return {contract:null,reason:"BROKER_UNAVAILABLE"};
    try {
        if(typeof broker.getOptionContracts!=="function") return {contract:null,reason:"BROKER_OPTION_CONTRACT_API_MISSING"};
        const contracts=await broker.getOptionContracts(symbol);
        if(!Array.isArray(contracts)||!contracts.length) return {contract:null,reason:"NO_OPTION_CONTRACTS"};
        const expiry=typeof broker.getValidOptionExpiry==="function"?await broker.getValidOptionExpiry(symbol,C.MIN_EXPIRY_DAYS):null;
        if(!expiry) return {contract:null,reason:"NO_VALID_EXPIRY"};
        const normalizedType=typeof broker.normalizeOptionType==="function"?broker.normalizeOptionType(type):(type==="CALL"?"CE":"PE");
        const sideContracts=contracts.filter(c=>String(c.optionType||c.option_type||c.instrument_type||"").toUpperCase()===normalizedType || (typeof broker.getOptionType==="function"&&broker.getOptionType(c)===normalizedType));
        const usable=sideContracts.filter(c=>String(c.expiry||"").slice(0,10)===String(expiry).slice(0,10));
        const rec=recommendedStrike(usable,spot,type);
        if(!rec) return {contract:null,reason:"NO_VALID_STRIKES"};
        let contract=null;
        if(typeof broker.getOptionContractBySymbol==="function") contract=await broker.getOptionContractBySymbol(symbol,type,rec.strike,expiry,C.MIN_EXPIRY_DAYS);
        if(!contract&&typeof broker.getOptionContract==="function") contract=await broker.getOptionContract(symbol,type,rec.strike,expiry,C.MIN_EXPIRY_DAYS);
        if(!contract) return {contract:null,reason:"NO_VALID_OPTION_CONTRACT",recommended:rec,expiry};
        if(typeof broker.validateOptionContract==="function") { const check=broker.validateOptionContract(contract,{type,expiry}); if(!check.valid) return {contract:null,reason:check.reason,recommended:rec,expiry}; }
        if(contract.underlyingKey) { const underlying=await broker.getInstrumentKey(symbol); if(underlying&&contract.underlyingKey!==underlying) return {contract:null,reason:"UNDERLYING_MISMATCH",recommended:rec,expiry}; }
        return {contract,reason:null,recommended:rec,expiry};
    } catch(error) { return {contract:null,reason:error?.message||"CONTRACT_LOOKUP_FAILED"}; }
}

async function resolveQuote(contract) {
    if(!contract) return null;
    const broker=getBroker(); const key=contract.instrumentKey||contract.instrument_key;
    if(!key) return null;
    try { if(typeof broker.getOptionQuoteByContract==="function") return await broker.getOptionQuoteByContract(contract); if(typeof broker.getOptionQuote==="function") return await broker.getOptionQuote(key); if(typeof broker.getOptionLTP==="function") return {ltp:await broker.getOptionLTP(key)}; } catch(error) { console.log(`⚠️ Option quote failed ${key}: ${error.message}`); }
    return null;
}

function optionPremiumLevels(ltp) {
    const entry=round2(ltp); if(entry<=0) return {valid:false};
    // Premium risk levels are deliberately conservative and separate from underlying levels.
    const stopLoss=round2(entry*0.70), target1=round2(entry*1.30), target2=round2(entry*1.60);
    return {valid:true,entry,stopLoss,target1,target2,risk:round2(entry-stopLoss),reward:round2(target1-entry),riskReward:round2((target1-entry)/(entry-stopLoss))};
}

async function makeOptionDecision(data={}) {
    const symbol=first(data.symbol,data.stock,data.name), price=stockPrice(data);
    if(!symbol||price<=0) return {...data,symbol,decision:"REJECT",optionsDecision:"REJECT",reason:"INVALID_STOCK_DATA",optionsReason:"INVALID_STOCK_DATA",confidence:0,optionsConfidence:0};
    const dir=direction(data,price);
    if(!dir.optionType) return {...data,symbol,price,direction:"NO DIRECTION",optionType:null,callScore:dir.callScore,putScore:dir.putScore,scoreDifference:dir.directionDifference,callEvidence:dir.callEvidence,putEvidence:dir.putEvidence,decision:"REJECT",optionsDecision:"REJECT",rating:"NO DIRECTION",optionsRating:"NO DIRECTION",reason:"Directional evidence is insufficient.",optionsReason:"Directional evidence is insufficient.",failedGates:["direction"],failedGateCount:1,marketSetupValid:false,contractAvailable:false,optionPriceAvailable:false};
    const type=dir.optionType, entry=stockEntry(data,price), setup=marketSetup(data,entry,type), m=mtf(type,data), pre=confidence(data,dir,m,setup.riskReward);
    const contractResult=await resolveContract(symbol,type,price), contract=contractResult.contract;
    const quote=await resolveQuote(contract); const premium=optionPremiumLevels(quote?.ltp||0);
    const g=gates(dir,m,setup.riskReward,pre.confidence,pre.scannerScore);
    let decision="REJECT", reason="";
    if(!setup.valid) reason="Underlying market-structure risk/reward is below minimum.";
    else if(!contract) reason=contractResult.reason||"No valid option contract.";
    else if(!quote?.ltp) reason="Real option contract found but live option LTP is unavailable.";
    else if(!premium.valid) reason="Invalid option premium.";
    else if(pre.confidence>=C.TRADE_CONFIDENCE&&g.tradePassed) {decision="TRADE";reason="Direction, MTF, market structure, valid contract and live option data satisfy TRADE gates.";}
    else if(pre.confidence>=C.WATCH_CONFIDENCE&&g.basePassed) {decision="WATCH";reason="Valid setup and option contract, but TRADE gates are not all satisfied.";}
    else reason="Setup does not satisfy minimum quality gates.";
    const rating=decision==="TRADE"?"A":decision==="WATCH"?"B":!setup.valid?"LOW_RR":!contract?"NO CONTRACT":!quote?"NO LTP":"C";
    return {...data,symbol,price,direction:type,finalDirection:type,optionType:type,callScore:dir.callScore,putScore:dir.putScore,scoreDifference:dir.directionDifference,callEvidence:dir.callEvidence,putEvidence:dir.putEvidence,entry:setup.entry,stopLoss:setup.stopLoss,target1:setup.target1,target2:setup.target2,stockEntry:setup.entry,stockStopLoss:setup.stopLoss,stockTarget1:setup.target1,stockTarget2:setup.target2,risk:setup.risk,reward:setup.reward,riskReward:setup.riskReward,stockRiskReward:setup.riskReward,stopSource:setup.stopSource,target1Source:setup.target1Source,target2Source:setup.target2Source,levelsSource:setup.levelsSource,supportLevels:setup.supportLevels,resistanceLevels:setup.resistanceLevels,mtfScore:m.score,mtfAlignment:m.alignment,mtfAligned:m.isAligned,alignedTimeframes:m.alignedTimeframes,mtfAvailableTimeframes:m.availableTimeframes,mtfAvailableCount:m.available,optionsConfidence:pre.confidence,confidence:pre.confidence,directionQuality:pre.directionScore,directionScore:pre.directionScore,trendScore:pre.trendScore,momentumScore:pre.momentumScore,volumeScore:pre.volumeScore,rrScore:pre.rrScore,scannerScore:pre.scannerScore,recommendedStrike:contractResult.recommended?.strike??null,atmStrike:contractResult.recommended?.atmStrike??null,optionStrike:contract?.strike??null,strikeInterval:contractResult.recommended?.strikeInterval??null,optionStrikeDifference:contract?.strike!=null&&contractResult.recommended?.strike!=null?Math.abs(num(contract.strike)-num(contractResult.recommended.strike)):null,contractAvailable:!!contract,optionPriceAvailable:!!quote?.ltp,optionSetupAvailable:!!premium.valid,optionSymbol:contract?.tradingSymbol||null,optionExpiry:contract?.expiry||contractResult.expiry||null,optionExpiryDays:contract?.expiryDays||null,optionInstrumentKey:contract?.instrumentKey||null,optionEntry:premium.entry||null,optionLTP:quote?.ltp||null,optionStopLoss:premium.stopLoss||null,optionTarget1:premium.target1||null,optionTarget2:premium.target2||null,optionRisk:premium.risk||null,optionReward:premium.reward||null,optionRiskReward:premium.riskReward||null,decision,optionsDecision:decision,rating,optionsRating:rating,reason,optionsReason:reason,contractLookupReason:contractResult.reason||null,failedGates:g.tradePassed?[]:g.failedTrade,failedGateCount:g.tradePassed?0:g.failedTrade.length,baseGates:g.base,tradeGates:g.trade,marketSetupValid:setup.valid,tradeEligible:g.tradePassed};
}

async function calculateOptionsDecisions(stocks=[]) {
    if(!Array.isArray(stocks)) return [];
    const results=[];
    for(const stock of stocks) { try { results.push(await makeOptionDecision(stock)); } catch(error) { results.push({...stock,decision:"REJECT",optionsDecision:"REJECT",reason:error?.message||"OPTIONS_ENGINE_ERROR",optionsReason:error?.message||"OPTIONS_ENGINE_ERROR",confidence:0,optionsConfidence:0}); } }
    return results;
}

module.exports={makeOptionDecision,calculateOptionsDecisions};
