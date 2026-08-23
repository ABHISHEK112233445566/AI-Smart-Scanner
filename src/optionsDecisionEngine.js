// ============================================================
// OPTIONS DECISION ENGINE — V12 MARKET-STRUCTURE VALIDATION
// ============================================================
// Rules:
// - Never force CALL/PUT.
// - Never manufacture stock SL/T1/T2.
// - Stock R:R is calculated only from validated market levels.
// - Option R:R is kept separate from stock R:R.
// - Contract side + expiry + strike must be validated.
// - Broker fallback order: symbol, optionType, strike, minExpiryDays.
// ============================================================

const brokerModule = require("./brokers");

const ENGINE_CONFIG = Object.freeze({
    MIN_DIRECTION_SCORE: 35,
    MIN_DIRECTION_DIFFERENCE: 10,
    MIN_DIRECTION_EVIDENCE: 3,
    TRADE_CONFIDENCE: 82,
    WATCH_CONFIDENCE: 65,
    TRADE_SCANNER_SCORE: 70,
    WATCH_SCANNER_SCORE: 55,
    TRADE_MTF_ALIGNMENT: 3,
    WATCH_MTF_ALIGNMENT: 2,
    TRADE_RR: 1.5,
    WATCH_RR: 1.2,
    MIN_EXPIRY_DAYS: 7,
    OPTION_STOP_PERCENT: 0.20,
    OPTION_TARGET1_RISK_MULTIPLIER: 1,
    OPTION_TARGET2_RISK_MULTIPLIER: 2,
    CONFIDENCE_WEIGHTS: Object.freeze({ scanner:0.20,direction:0.25,mtf:0.15,trend:0.12,momentum:0.12,volume:0.06,breakout:0.04,rr:0.06 })
});

function toNumber(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback;}
function clamp(v,min=0,max=100){return Math.max(min,Math.min(max,toNumber(v)));}
function text(v){return String(v??"").trim().toUpperCase();}
function firstValue(...values){for(const v of values)if(v!==undefined&&v!==null&&v!=="")return v;return null;}
function firstPositive(...values){for(const v of values){const n=Number(v);if(Number.isFinite(n)&&n>0)return n;}return 0;}
function uniqueSortedLevels(values){return [...new Set((values||[]).map(Number).filter(v=>Number.isFinite(v)&&v>0).map(v=>Number(v.toFixed(2))))].sort((a,b)=>a-b);}
function normalizeDirection(v){const s=text(v);if(["BULLISH","BULL","LONG","CALL","CE","BUY","BUY SIGNAL","STRONG BUY","UP"].includes(s))return"BULLISH";if(["BEARISH","BEAR","SHORT","PUT","PE","SELL","SELL SIGNAL","STRONG SELL","DOWN"].includes(s))return"BEARISH";return"UNKNOWN";}
function normalizeOptionType(v){const s=text(v);if(s==="CALL"||s==="CE"||s.includes("CALL"))return"CALL";if(s==="PUT"||s==="PE"||s.includes("PUT"))return"PUT";return"";}
function getBroker(){return brokerModule&&typeof brokerModule.getBroker==="function"?brokerModule.getBroker():brokerModule;}

function getStrikeInterval(price){const p=Number(price);if(!Number.isFinite(p)||p<=0)return 50;if(p<500)return 10;if(p<1000)return 20;if(p<2000)return 50;return 100;}
function getRecommendedStrike(price,optionType){const interval=getStrikeInterval(price);let strike=Math.round(Number(price)/interval)*interval;if(optionType==="CALL")strike-=interval;if(optionType==="PUT")strike+=interval;return{strike:Math.max(interval,strike),interval};}

function normalizeOptionContract(contract,fallbackStrike=0){
    if(!contract||typeof contract!=="object")return null;
    const instrumentKey=firstValue(contract.instrumentKey,contract.instrument_key,contract.instrument_token,contract.instrumentToken,contract.exchange_token,contract.exchangeToken,contract.token);
    const tradingSymbol=firstValue(contract.tradingSymbol,contract.trading_symbol,contract.symbol,contract.name);
    const strike=toNumber(firstValue(contract.strike,contract.strikePrice,contract.strike_price,contract.strike_price_value,fallbackStrike));
    const expiry=firstValue(contract.expiry,contract.expiryDate,contract.expiry_date,contract.expiry_date_time);
    const expiryDays=toNumber(firstValue(contract.expiryDays,contract.expiry_days,contract.daysToExpiry));
    let optionType=normalizeOptionType(firstValue(contract.optionType,contract.option_type,contract.instrumentType,contract.option,""));
    if(!optionType&&tradingSymbol)optionType=normalizeOptionType(tradingSymbol);
    if((!instrumentKey&&!tradingSymbol)||strike<=0)return null;
    return{...contract,instrumentKey,tradingSymbol,strike,expiry,expiryDays,optionType,lotSize:firstValue(contract.lotSize,contract.lot_size,contract.lotsize),tickSize:firstValue(contract.tickSize,contract.tick_size)};
}
function expiryDaysFromContract(contract){
    if(!contract)return-Infinity;
    const explicit=Number(contract.expiryDays);
    if(Number.isFinite(explicit)&&explicit>0)return explicit;
    if(!contract.expiry)return-Infinity;
    const raw=String(contract.expiry).trim();let date=new Date(raw);
    if(Number.isNaN(date.getTime())){const m=raw.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})$/);if(m)date=new Date(`${m[1]} ${m[2]} ${m[3]} 23:59:59`);}
    if(Number.isNaN(date.getTime())){const m=raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);if(m)date=new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59`);}
    return Number.isNaN(date.getTime())?-Infinity:(date.getTime()-Date.now())/86400000;
}
function contractMatches(contract,expectedType){const expected=normalizeOptionType(expectedType);const actual=normalizeOptionType(firstValue(contract?.optionType,contract?.option_type,contract?.instrumentType,contract?.option,contract?.tradingSymbol,contract?.trading_symbol));return!!expected&&!!actual&&expected===actual;}
function validContract(contract,optionType){return!!contract&&contractMatches(contract,optionType)&&expiryDaysFromContract(contract)>=ENGINE_CONFIG.MIN_EXPIRY_DAYS-0.01&&Number(contract.strike)>0;}

async function searchContractsDirectly(symbol,optionType,requestedStrike){
    const broker=getBroker();if(!broker||typeof broker.getOptionContracts!=="function")return null;
    try{
        const raw=await broker.getOptionContracts(symbol);if(!Array.isArray(raw))return null;
        const valid=raw.map(c=>normalizeOptionContract(c)).filter(c=>validContract(c,optionType));if(!valid.length)return null;
        valid.sort((a,b)=>{const expiryDiff=expiryDaysFromContract(a)-expiryDaysFromContract(b);return Math.abs(expiryDiff)>0.25?expiryDiff:Math.abs(a.strike-requestedStrike)-Math.abs(b.strike-requestedStrike);});
        const expiry=expiryDaysFromContract(valid[0]);
        return valid.filter(c=>Math.abs(expiryDaysFromContract(c)-expiry)<=0.25).sort((a,b)=>Math.abs(a.strike-requestedStrike)-Math.abs(b.strike-requestedStrike))[0]||null;
    }catch(error){console.log(`⚠️ Direct option search failed: ${symbol} | ${error.message}`);return null;}
}
async function tryOptionContract(symbol,optionType,strike){
    const broker=getBroker();if(!broker||typeof broker.getOptionContract!=="function")return null;
    try{
        // FIX: active broker fallback expects symbol, optionType, strike, expiryDays.
        const raw=await broker.getOptionContract(symbol,optionType,Number(strike),ENGINE_CONFIG.MIN_EXPIRY_DAYS);
        const contract=normalizeOptionContract(raw,strike);return validContract(contract,optionType)?contract:null;
    }catch(_){return null;}
}
async function resolveOptionContract(symbol,optionType,recommendedStrike,strikeInterval){
    if(!symbol||!optionType)return null;const requested=Number(recommendedStrike);if(!Number.isFinite(requested)||requested<=0)return null;
    const direct=await searchContractsDirectly(symbol,optionType,requested);if(direct)return direct;
    const interval=Number(strikeInterval)>0?Number(strikeInterval):getStrikeInterval(requested);
    const strikes=[...new Set([requested,requested-interval,requested+interval,requested-2*interval,requested+2*interval].filter(v=>v>0))];
    for(const strike of strikes){const contract=await tryOptionContract(symbol,optionType,strike);if(contract)return contract;}
    return null;
}

function normalizeQuoteLTP(quote){if(typeof quote==="number")return quote>0?quote:0;if(!quote||typeof quote!=="object")return 0;return firstPositive(quote.ltp,quote.lastPrice,quote.last_price,quote.last_traded_price,quote.close,quote.lp);}
async function resolveOptionQuote(contract){
    if(!contract)return null;const broker=getBroker();if(!broker)return null;
    const key=firstValue(contract.instrumentKey,contract.instrument_key,contract.instrument_token,contract.tradingSymbol,contract.trading_symbol);if(!key)return null;
    for(const method of ["getOptionQuote","getQuote"]){if(typeof broker[method]!=="function")continue;try{const raw=await broker[method](key);const ltp=normalizeQuoteLTP(raw);if(ltp>0)return{...(raw&&typeof raw==="object"?raw:{}),ltp};}catch(error){console.log(`⚠️ Option quote failed: ${key} | ${error.message}`);}}
    return null;
}

// Raw candle high/low/dayHigh/dayLow are deliberately excluded from stock
// SL/targets. They can create microscopic risk and fake R:R values.
const MARKET_LEVEL_KEYS=Object.freeze({
    support:["support","support1","support2","support3","s1","s2","s3","pivotS1","pivotS2","pivotS3","swingLow","swing_low","previousLow","prevLow","recentLow"],
    resistance:["resistance","resistance1","resistance2","resistance3","r1","r2","r3","pivotR1","pivotR2","pivotR3","swingHigh","swing_high","previousHigh","prevHigh","recentHigh"]
});
function collectMarketLevels(d,side){const values=[];for(const key of MARKET_LEVEL_KEYS[side]||[]){const value=d?.[key];if(Array.isArray(value))values.push(...value);else if(value&&typeof value==="object")values.push(...Object.values(value).flat(Infinity));else values.push(value);}const collection=d?.[side==="support"?"supportLevels":"resistanceLevels"];if(Array.isArray(collection))values.push(...collection.flat(Infinity));return uniqueSortedLevels(values);}
function nearestBelow(levels,price){return levels.filter(v=>v<price).sort((a,b)=>b-a)[0]||0;}
function nearestAbove(levels,price){return levels.filter(v=>v>price).sort((a,b)=>a-b)[0]||0;}
function getStockPrice(d){return firstPositive(d.price,d.ltp,d.lastPrice,d.close,d.currentPrice);}
function getStockEntry(d,price){return firstPositive(d.entry,d.stockEntry,d.underlyingEntry,price);}
function getStockStopLoss(d,entry,type){return type==="CALL"?nearestBelow(collectMarketLevels(d,"support"),entry):type==="PUT"?nearestAbove(collectMarketLevels(d,"resistance"),entry):0;}
function getStockTarget1(d,entry,type){return type==="CALL"?nearestAbove(collectMarketLevels(d,"resistance"),entry):type==="PUT"?nearestBelow(collectMarketLevels(d,"support"),entry):0;}
function getStockTarget2(d,entry,target1,type){if(!(target1>0))return 0;return type==="CALL"?nearestAbove(collectMarketLevels(d,"resistance"),target1):type==="PUT"?nearestBelow(collectMarketLevels(d,"support"),target1):0;}
function calculateRiskReward(entry,stopLoss,target1,type){const risk=type==="CALL"?entry-stopLoss:stopLoss-entry;const reward=type==="CALL"?target1-entry:entry-target1;return risk>0&&reward>0?Number((reward/risk).toFixed(2)):0;}
function validateStockSetup(entry,stopLoss,target1,target2,type,rr){
    if(!(entry>0&&stopLoss>0&&target1>0&&target2>0))return{valid:false,reason:"MISSING_MARKET_LEVEL"};
    if(type==="CALL"&&!(stopLoss<entry&&target1>entry&&target2>target1))return{valid:false,reason:"INVALID_CALL_LEVEL_GEOMETRY"};
    if(type==="PUT"&&!(stopLoss>entry&&target1<entry&&target2<target1))return{valid:false,reason:"INVALID_PUT_LEVEL_GEOMETRY"};
    if(!(Number.isFinite(rr)&&rr>=ENGINE_CONFIG.WATCH_RR))return{valid:false,reason:"LOW_RR"};
    return{valid:true,reason:"VALID"};
}

function calculateDirection(d,price){
    const tfs=[["dailyTrend",12],["oneHourTrend",14],["fifteenMinTrend",10],["fourHourTrend",8]];let callScore=0,putScore=0,callEvidence=0,putEvidence=0;
    for(const [key,w] of tfs){const dir=normalizeDirection(d[key]);if(dir==="BULLISH"){callScore+=w;callEvidence++;}else if(dir==="BEARISH"){putScore+=w;putEvidence++;}}
    const e5=toNumber(d.ema5),e9=toNumber(d.ema9),e20=toNumber(d.ema20),e50=toNumber(d.ema50);if(e5>0&&e9>0&&e20>0&&e50>0){if(e5>e9&&e9>e20&&e20>e50){callScore+=12;callEvidence++;}else if(e5<e9&&e9<e20&&e20<e50){putScore+=12;putEvidence++;}}
    if(e20>0&&e50>0){if(price>e20&&price>e50){callScore+=7;callEvidence++;}else if(price<e20&&price<e50){putScore+=7;putEvidence++;}}
    const rsi=toNumber(d.rsi);if(rsi>=55&&rsi<=70){callScore+=8;callEvidence++;}else if(rsi>=30&&rsi<=45){putScore+=8;putEvidence++;}
    const macd=toNumber(d.macdValue??d.macd),signal=toNumber(d.macdSignal),hist=toNumber(d.histogram??d.macdHistogram);if(macd>signal&&hist>=0){callScore+=8;callEvidence++;}else if(macd<signal&&hist<=0){putScore+=8;putEvidence++;}
    const adx=toNumber(d.adx),pdi=toNumber(d.pdi),mdi=toNumber(d.mdi);if(adx>=20){if(pdi>mdi){callScore+=7;callEvidence++;}else if(mdi>pdi){putScore+=7;putEvidence++;}}
    const vwap=toNumber(d.vwap);if(vwap>0){if(price>vwap){callScore+=5;callEvidence++;}else if(price<vwap){putScore+=5;putEvidence++;}}
    const st=normalizeDirection(d.supertrend);if(st==="BULLISH"){callScore+=5;callEvidence++;}else if(st==="BEARISH"){putScore+=5;putEvidence++;}
    const sig=normalizeDirection(d.signal);if(sig==="BULLISH"){callScore+=5;callEvidence++;}else if(sig==="BEARISH"){putScore+=5;putEvidence++;}
    const trend=normalizeDirection(d.trend);if(trend==="BULLISH"){callScore+=3;callEvidence++;}else if(trend==="BEARISH"){putScore+=3;putEvidence++;}
    const difference=Math.abs(callScore-putScore);const optionType=callScore>putScore&&callScore>=ENGINE_CONFIG.MIN_DIRECTION_SCORE&&difference>=ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE&&callEvidence>=ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE?"CALL":putScore>callScore&&putScore>=ENGINE_CONFIG.MIN_DIRECTION_SCORE&&difference>=ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE&&putEvidence>=ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE?"PUT":null;
    return{optionType,callScore,putScore,directionDifference:difference,callEvidence,putEvidence,dominantScore:Math.max(callScore,putScore),dominantEvidence:callScore>putScore?callEvidence:putEvidence};
}
function calculateMTF(optionType,d){const expected=optionType==="CALL"?"BULLISH":"BEARISH";const values=[["DAILY",d.dailyTrend],["4H",d.fourHourTrend],["1H",d.oneHourTrend],["15M",d.fifteenMinTrend]].map(([name,value])=>({name,value:normalizeDirection(value)}));const available=values.filter(x=>x.value!=="UNKNOWN"),aligned=available.filter(x=>x.value===expected),opposition=available.filter(x=>x.value!==expected),score=available.length?clamp(((aligned.length-opposition.length)/available.length)*50+50):0;return{score,alignment:aligned.length,opposition:opposition.length,available:available.length,required:ENGINE_CONFIG.TRADE_MTF_ALIGNMENT,alignedTimeframes:aligned.map(x=>x.name),availableTimeframes:available.map(x=>x.name),isAligned:aligned.length>=ENGINE_CONFIG.TRADE_MTF_ALIGNMENT,fullAlignment:available.length===4&&aligned.length===4};}
function calculateTrendScore(d,type){const expected=type==="CALL"?"BULLISH":"BEARISH";let score=50;const e5=toNumber(d.ema5),e9=toNumber(d.ema9),e20=toNumber(d.ema20),e50=toNumber(d.ema50);if(e5>0&&e9>0&&e20>0&&e50>0){const bull=e5>e9&&e9>e20&&e20>e50,bear=e5<e9&&e9<e20&&e20<e50;if((expected==="BULLISH"&&bull)||(expected==="BEARISH"&&bear))score+=35;else if((expected==="BULLISH"&&bear)||(expected==="BEARISH"&&bull))score-=35;}const trend=normalizeDirection(d.trend);if(trend===expected)score+=15;else if(trend!=="UNKNOWN")score-=15;return clamp(score);}
function calculateMomentumScore(d,type){const expected=type==="CALL"?"BULLISH":"BEARISH";let score=50;const rsi=toNumber(d.rsi),macd=toNumber(d.macdValue??d.macd),signal=toNumber(d.macdSignal),hist=toNumber(d.histogram??d.macdHistogram);if(rsi>0){if((expected==="BULLISH"&&rsi>=55&&rsi<=70)||(expected==="BEARISH"&&rsi>=30&&rsi<=45))score+=20;else if((expected==="BULLISH"&&rsi<50)||(expected==="BEARISH"&&rsi>50))score-=20;}if(Number.isFinite(macd)&&Number.isFinite(signal)){const bull=macd>signal&&hist>=0,bear=macd<signal&&hist<=0;if((expected==="BULLISH"&&bull)||(expected==="BEARISH"&&bear))score+=30;else if((expected==="BULLISH"&&bear)||(expected==="BEARISH"&&bull))score-=30;}return clamp(score);}
function calculateVolumeScore(d){const r=toNumber(d.rvol);if(r<=0)return 50;if(r>=2)return 100;if(r>=1.5)return 85;if(r>=1.2)return 70;if(r>=1)return 55;return 35;}
function calculateBreakoutScore(d,type){const b=text(d.breakout),bt=text(d.breakoutType),expected=type==="CALL"?"BULL":"BEAR";if(b.includes(expected)||bt.includes(expected))return 100;if(b.includes("BREAK")||bt.includes("BREAK"))return 65;return 50;}
function calculateRRScore(rr){const n=Number(rr);if(!Number.isFinite(n)||n<=0)return 0;if(n>=2.5)return 100;if(n>=2)return 90;if(n>=1.5)return 80;if(n>=1.2)return 65;if(n>=1)return 50;return 25;}
function calculateScannerScore(d,direction){const raw=firstPositive(d.aiFinalScore,d.finalScore,d.score,d.scannerScore);if(raw<=0||!direction?.optionType)return 0;const directional=direction.optionType==="CALL"?direction.callScore:direction.putScore;return clamp(clamp(raw)*0.70+clamp(directional)*0.30);}
function calculateConfidence(d,direction,mtf,rr){if(!direction.optionType)return{confidence:0,scannerScore:0,directionScore:0,mtfScore:0,trendScore:0,momentumScore:0,volumeScore:0,breakoutScore:0,rrScore:0};const scannerScore=calculateScannerScore(d,direction),directionScore=direction.optionType==="CALL"?direction.callScore:direction.putScore,trendScore=calculateTrendScore(d,direction.optionType),momentumScore=calculateMomentumScore(d,direction.optionType),volumeScore=calculateVolumeScore(d),breakoutScore=calculateBreakoutScore(d,direction.optionType),rrScore=calculateRRScore(rr),w=ENGINE_CONFIG.CONFIDENCE_WEIGHTS;let confidence=scannerScore*w.scanner+clamp(directionScore)*w.direction+mtf.score*w.mtf+trendScore*w.trend+momentumScore*w.momentum+volumeScore*w.volume+breakoutScore*w.breakout+rrScore*w.rr;if(direction.dominantEvidence<ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE)confidence-=15;if(direction.directionDifference<ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE)confidence-=15;if(mtf.available===0)confidence-=20;if(mtf.alignment<2)confidence-=8;if(rr<ENGINE_CONFIG.WATCH_RR)confidence-=10;return{confidence:Math.round(clamp(confidence)),scannerScore:Math.round(scannerScore),directionScore:Math.round(clamp(directionScore)),mtfScore:Math.round(mtf.score),trendScore:Math.round(trendScore),momentumScore:Math.round(momentumScore),volumeScore:Math.round(volumeScore),breakoutScore:Math.round(breakoutScore),rrScore:Math.round(rrScore)};}
function evaluateQualityGates(d,direction,mtf,rr,confidence){const scannerScore=calculateScannerScore(d,direction);const gates={direction:!!direction.optionType,directionEvidence:direction.dominantEvidence>=ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE,directionDifference:direction.directionDifference>=ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE,mtf:mtf.alignment>=ENGINE_CONFIG.WATCH_MTF_ALIGNMENT,tradeMTF:mtf.alignment>=ENGINE_CONFIG.TRADE_MTF_ALIGNMENT,riskReward:rr>=ENGINE_CONFIG.WATCH_RR,tradeRiskReward:rr>=ENGINE_CONFIG.TRADE_RR,confidence:confidence>=ENGINE_CONFIG.WATCH_CONFIDENCE,tradeConfidence:confidence>=ENGINE_CONFIG.TRADE_CONFIDENCE,scanner:scannerScore>=ENGINE_CONFIG.WATCH_SCANNER_SCORE,tradeScanner:scannerScore>=ENGINE_CONFIG.TRADE_SCANNER_SCORE};const failedGates=Object.entries(gates).filter(([,v])=>!v).map(([k])=>k);return{...gates,passedCount:Object.values(gates).filter(Boolean).length,totalCount:Object.keys(gates).length,failedGates,allPassed:failedGates.length===0};}
function calculateOptionTradeSetup(optionType,optionLTP,stockRR){const premium=Number(optionLTP);if(!Number.isFinite(premium)||premium<=0)return null;const risk=premium*ENGINE_CONFIG.OPTION_STOP_PERCENT,entry=premium,stopLoss=Math.max(0.05,entry-risk),target1=entry+risk*ENGINE_CONFIG.OPTION_TARGET1_RISK_MULTIPLIER,target2=entry+risk*ENGINE_CONFIG.OPTION_TARGET2_RISK_MULTIPLIER,optionRisk=entry-stopLoss,optionReward=target2-entry;return{optionType,optionEntry:Number(entry.toFixed(2)),optionStopLoss:Number(stopLoss.toFixed(2)),optionTarget1:Number(target1.toFixed(2)),optionTarget2:Number(target2.toFixed(2)),optionRisk:Number(optionRisk.toFixed(2)),optionReward:Number(optionReward.toFixed(2)),optionRiskReward:optionRisk>0?Number((optionReward/optionRisk).toFixed(2)):0,stockRiskReward:Number(toNumber(stockRR).toFixed(2))};}
function getDecision(direction,mtf,rr,confidence,gates,contract,quote){if(!direction.optionType)return{decision:"REJECT",rating:"NO DIRECTION",reason:"Directional evidence is insufficient."};if(!contract)return{decision:"REJECT",rating:"NO CONTRACT",reason:"No valid option contract with required side and expiry."};if(!quote)return{decision:"REJECT",rating:"NO LTP",reason:"Real option contract found but live option LTP is unavailable."};if(rr<ENGINE_CONFIG.WATCH_RR)return{decision:"REJECT",rating:"LOW R:R",reason:"Underlying risk/reward is below minimum."};if(confidence>=ENGINE_CONFIG.TRADE_CONFIDENCE&&gates.tradeMTF&&gates.tradeRiskReward&&gates.tradeConfidence&&gates.tradeScanner&&gates.directionEvidence&&gates.directionDifference)return{decision:"TRADE",rating:"A",reason:"Direction, MTF, risk/reward, confidence and real option data are aligned."};if(confidence>=ENGINE_CONFIG.WATCH_CONFIDENCE&&gates.mtf&&gates.riskReward)return{decision:"WATCH",rating:"B",reason:"Valid setup but not all TRADE gates are met."};return{decision:"REJECT",rating:"C",reason:"Setup does not satisfy minimum quality gates."};}

async function makeOptionDecision(stockData={}){
    const symbol=firstValue(stockData.symbol,stockData.stock,stockData.name),price=getStockPrice(stockData);
    if(!symbol||price<=0)return{...stockData,symbol,direction:null,optionType:null,decision:"REJECT",confidence:0,qualityGates:"INVALID_STOCK_DATA",failedGates:["symbol","price"]};
    const direction=calculateDirection(stockData,price);
    if(!direction.optionType)return{...stockData,symbol,price,direction:"NO DIRECTION",finalDirection:null,optionType:null,callScore:direction.callScore,putScore:direction.putScore,scoreDifference:direction.directionDifference,callEvidence:direction.callEvidence,putEvidence:direction.putEvidence,entry:0,stopLoss:0,target1:0,target2:0,riskReward:0,confidence:0,decision:"REJECT",rating:"NO DIRECTION",optionsDecision:"REJECT",optionsRating:"NO DIRECTION",optionsConfidence:0,optionsReason:"Directional evidence is insufficient.",contractAvailable:false,optionPriceAvailable:false,optionSetupAvailable:false,qualityGates:"NO_DIRECTION",failedGates:["direction"]};
    const optionType=direction.optionType,entry=getStockEntry(stockData,price),stopLoss=getStockStopLoss(stockData,entry,optionType),target1=getStockTarget1(stockData,entry,optionType),target2=getStockTarget2(stockData,entry,target1,optionType),riskReward=calculateRiskReward(entry,stopLoss,target1,optionType),setupValidation=validateStockSetup(entry,stopLoss,target1,target2,optionType,riskReward);
    if(!setupValidation.valid)return{...stockData,symbol,price,direction:optionType,finalDirection:optionType,optionType,callScore:direction.callScore,putScore:direction.putScore,scoreDifference:direction.directionDifference,callEvidence:direction.callEvidence,putEvidence:direction.putEvidence,entry:Number(entry.toFixed(2)),stopLoss:Number(toNumber(stopLoss).toFixed(2)),target1:Number(toNumber(target1).toFixed(2)),target2:Number(toNumber(target2).toFixed(2)),riskReward:0,stockRiskReward:0,confidence:0,decision:"REJECT",rating:setupValidation.reason,optionsDecision:"REJECT",optionsRating:setupValidation.reason,optionsConfidence:0,optionsReason:"Stock setup rejected because genuine market levels do not form valid risk/reward geometry.",contractAvailable:false,optionPriceAvailable:false,optionSetupAvailable:false,qualityGates:"INVALID_MARKET_SETUP",failedGates:["marketStructure"]};
    const mtf=calculateMTF(optionType,stockData),confidenceData=calculateConfidence(stockData,direction,mtf,riskReward),gates=evaluateQualityGates(stockData,direction,mtf,riskReward,confidenceData.confidence),strikeInfo=getRecommendedStrike(price,optionType);
    let contract=null;try{contract=await resolveOptionContract(symbol,optionType,strikeInfo.strike,strikeInfo.interval);}catch(_){contract=null;}
    const optionQuote=contract?await resolveOptionQuote(contract):null,optionSetup=optionQuote?calculateOptionTradeSetup(optionType,optionQuote.ltp,riskReward):null,decision=getDecision(direction,mtf,riskReward,confidenceData.confidence,gates,contract,optionQuote);
    const oiSupport1=firstPositive(stockData.oiSupport1,stockData.oi_support1,stockData.putOISupport,stockData.putOiSupport,stockData.putOILevel,stockData.putOiLevel,stockData.maxPutOI,stockData.maxPutOi),oiSupport2=firstPositive(stockData.oiSupport2,stockData.oi_support2,stockData.oiSupport,stockData.oi_support,stockData.putOISupport2,stockData.putOiSupport2),oiResistance1=firstPositive(stockData.oiResistance1,stockData.oi_resistance1,stockData.callOIResistance,stockData.callOiResistance,stockData.callOILevel,stockData.callOiLevel,stockData.maxCallOI,stockData.maxCallOi),oiResistance2=firstPositive(stockData.oiResistance2,stockData.oi_resistance2,stockData.oiResistance,stockData.oi_resistance,stockData.callOIResistance2,stockData.callOiResistance2),maxPain=firstPositive(stockData.maxPain,stockData.max_pain,stockData.optionMaxPain,stockData.option_max_pain);
    const combinedSupportLevels=uniqueSortedLevels([stockData.support1,stockData.support2,stockData.pivotS1,stockData.pivotS2,oiSupport1,oiSupport2]),combinedResistanceLevels=uniqueSortedLevels([stockData.resistance1,stockData.resistance2,stockData.pivotR1,stockData.pivotR2,oiResistance1,oiResistance2]);
    return{...stockData,symbol,price,direction:optionType,finalDirection:optionType,optionType,callScore:direction.callScore,putScore:direction.putScore,scoreDifference:direction.directionDifference,callEvidence:direction.callEvidence,putEvidence:direction.putEvidence,entry:Number(entry.toFixed(2)),stopLoss:Number(stopLoss.toFixed(2)),target1:Number(target1.toFixed(2)),target2:Number(target2.toFixed(2)),stockEntry:Number(entry.toFixed(2)),stockStopLoss:Number(stopLoss.toFixed(2)),stockTarget1:Number(target1.toFixed(2)),stockTarget2:Number(target2.toFixed(2)),riskReward,stockRiskReward:riskReward,mtfScore:mtf.score,mtfAlignment:mtf.alignment,mtfAligned:mtf.isAligned,alignedTimeframes:mtf.alignedTimeframes,mtfAvailableTimeframes:mtf.availableTimeframes,mtfAvailableCount:mtf.available,mtfDiagnostic:{alignment:mtf.alignment,available:mtf.available,opposition:mtf.opposition},confidence:confidenceData.confidence,scannerScore:confidenceData.scannerScore,directionQuality:confidenceData.directionScore,trendScore:confidenceData.trendScore,momentumScore:confidenceData.momentumScore,volumeScore:confidenceData.volumeScore,breakoutScore:confidenceData.breakoutScore,rrScore:confidenceData.rrScore,recommendedStrike:strikeInfo.strike,optionStrike:contract?contract.strike:strikeInfo.strike,strikeInterval:strikeInfo.interval,optionStrikeDifference:contract?Math.abs(Number(contract.strike)-strikeInfo.strike):null,contractAvailable:!!contract,optionSymbol:contract?contract.tradingSymbol:null,tradingSymbol:contract?contract.tradingSymbol:null,instrumentKey:contract?contract.instrumentKey:null,optionExpiry:contract?contract.expiry:null,expiry:contract?contract.expiry:null,optionExpiryDays:contract?expiryDaysFromContract(contract):null,optionLotSize:contract?contract.lotSize:null,optionTickSize:contract?contract.tickSize:null,optionPriceAvailable:!!optionQuote,optionLTP:optionQuote?optionQuote.ltp:null,optionQuote:optionQuote||null,optionSetupAvailable:!!optionSetup,optionEntry:optionSetup?.optionEntry??null,optionStopLoss:optionSetup?.optionStopLoss??null,optionTarget1:optionSetup?.optionTarget1??null,optionTarget2:optionSetup?.optionTarget2??null,optionRisk:optionSetup?.optionRisk??null,optionReward:optionSetup?.optionReward??null,optionRiskReward:optionSetup?.optionRiskReward??null,oiSupport1,oiSupport2,oiResistance1,oiResistance2,maxPain,combinedSupportLevels,combinedResistanceLevels,decision:decision.decision,rating:decision.rating,reason:decision.reason,optionsDecision:decision.decision,optionsRating:decision.rating,optionsConfidence:confidenceData.confidence,optionsReason:decision.reason,qualityGates:gates,failedGates:gates.failedGates,failedGateCount:gates.failedGates.length,tradeGates:gates,diagnostic:{direction,mtf,confidence:confidenceData,gates,marketSetup:setupValidation,contractFound:!!contract,optionQuoteFound:!!optionQuote,optionSetupFound:!!optionSetup}};
}
async function generateOptionDecisions(scannerResults=[]){if(!Array.isArray(scannerResults))return[];const results=[];for(const stockData of scannerResults){try{results.push(await makeOptionDecision(stockData));}catch(error){const symbol=firstValue(stockData?.symbol,stockData?.stock,"UNKNOWN");console.log(`❌ Option decision failed: ${symbol} | ${error.message}`);results.push({...stockData,symbol,decision:"REJECT",optionsDecision:"REJECT",confidence:0,optionsConfidence:0,reason:error.message,optionsReason:error.message,failedGates:["ENGINE_ERROR"]});}}return results;}
function sortOptionDecisions(decisions){if(!Array.isArray(decisions))return[];const rank={TRADE:3,WATCH:2,REJECT:1};return[...decisions].sort((a,b)=>{const d=(rank[text(b.decision)]||0)-(rank[text(a.decision)]||0);return d||toNumber(b.confidence)-toNumber(a.confidence);});}
const evaluateOptionDecision=makeOptionDecision,decideOptionTrade=makeOptionDecision,calculateOptionsDecisions=generateOptionDecisions,runOptionDecisionEngine=generateOptionDecisions,processOptionDecisions=generateOptionDecisions;
module.exports={calculateOptionsDecisions,ENGINE_CONFIG,makeOptionDecision,evaluateOptionDecision,decideOptionTrade,generateOptionDecisions,runOptionDecisionEngine,processOptionDecisions,sortOptionDecisions,calculateDirection,calculateMTF,calculateTrendScore,calculateMomentumScore,calculateVolumeScore,calculateBreakoutScore,calculateRRScore,calculateConfidence,evaluateQualityGates,calculateOptionTradeSetup,getRecommendedStrike,getStrikeInterval,normalizeOptionContract,resolveOptionContract,resolveOptionQuote,calculateRiskReward};
