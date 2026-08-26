const brokerModule = require("./brokers");

const C = Object.freeze({
    MIN_DIRECTION_SCORE: 35,
    MIN_DIRECTION_DIFFERENCE: 10,
    MIN_DIRECTION_EVIDENCE: 3,
    WATCH_CONFIDENCE: 65,
    TRADE_CONFIDENCE: 85,
    WATCH_RR: 1.2,
    TRADE_RR: 1.5,
    MIN_EXPIRY_DAYS: 7
});

const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const positive = (...values) => { for (const v of values) { const n = num(v); if (n > 0) return n; } return 0; };
const clamp = v => Math.max(0, Math.min(100, num(v)));
const round2 = v => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : 0;
const text = v => String(v ?? "").trim().toUpperCase();

function getBroker() { return brokerModule.getBroker ? brokerModule.getBroker() : brokerModule; }
function normalizeDirection(value) {
    const s = text(value);
    if (["BULLISH","BULL","LONG","CALL","CE","BUY","UP"].includes(s) || s.includes("BULLISH")) return "BULLISH";
    if (["BEARISH","BEAR","SHORT","PUT","PE","SELL","DOWN"].includes(s) || s.includes("BEARISH")) return "BEARISH";
    return "UNKNOWN";
}
function stockPrice(d) { return positive(d?.price, d?.ltp, d?.lastPrice, d?.last_price, d?.close, d?.currentPrice); }
function stockEntry(d, price) { return positive(d?.marketEntry, d?.triggerPrice, d?.entry, d?.stockEntry, d?.underlyingEntry, price); }

const SUPPORT_KEYS = ["support","support1","support2","support3","s1","s2","s3","pivotS1","pivotS2","pivotS3","oiSupport1","oiSupport2","oiSupport3","swingLow","previousLow","recentLow","dayLow"];
const RESISTANCE_KEYS = ["resistance","resistance1","resistance2","resistance3","r1","r2","r3","pivotR1","pivotR2","pivotR3","oiResistance1","oiResistance2","oiResistance3","swingHigh","previousHigh","recentHigh","dayHigh"];

function collectLevels(source, keys) {
    if (!source || typeof source !== "object") return [];
    const result = [];
    for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item && typeof item === "object") result.push(item.value, item.level, item.price, item.close);
                else result.push(item);
            }
        } else if (value && typeof value === "object") {
            result.push(...Object.values(value));
        } else result.push(value);
    }
    return result.map(num).filter(v => v > 0);
}

function getLevels(data, side) {
    const keys = side === "support" ? SUPPORT_KEYS : RESISTANCE_KEYS;
    const sr = data?.supportResistance || data?.support_resistance || data?.sr || {};
    const pivot = data?.pivot || data?.pivots || {};
    const pivotKeys = side === "support" ? ["s1","s2","s3","S1","S2","S3"] : ["r1","r2","r3","R1","R2","R3"];
    const values = [
        ...collectLevels(data, keys),
        ...collectLevels(sr, keys),
        ...collectLevels(pivot, pivotKeys),
        ...(Array.isArray(data?.[side + "Levels"]) ? data[side + "Levels"] : [])
    ];
    return [...new Set(values.map(round2).filter(v => v > 0))].sort((a, b) => a - b);
}

function marketSetup(data, entry, type) {
    const supports = getLevels(data, "support").filter(x => x < entry).sort((a, b) => b - a);
    const resistances = getLevels(data, "resistance").filter(x => x > entry).sort((a, b) => a - b);

    const stopLoss = type === "CALL" ? (supports[0] || 0) : (resistances[0] || 0);
    const targets = type === "CALL" ? resistances : supports;
    const risk = type === "CALL" ? entry - stopLoss : stopLoss - entry;

    if (entry <= 0 || stopLoss <= 0 || risk <= 0 || !targets.length) {
        return { valid: false, entry: round2(entry), stopLoss: round2(stopLoss), target1: 0, target2: 0, risk: round2(Math.max(0, risk)), reward: 0, riskReward: 0, reason: "INVALID_MARKET_SETUP", supportLevels: supports, resistanceLevels: resistances };
    }

    const rrFor = target => risk > 0 ? ((type === "CALL" ? target - entry : entry - target) / risk) : 0;
    const validTargets = targets.filter(target => rrFor(target) > 0);
    const target1 = validTargets[0] || 0;
    const target2 = validTargets.find(target => target !== target1 && rrFor(target) > rrFor(target1)) || 0;
    const reward = target1 > 0 ? Math.max(0, type === "CALL" ? target1 - entry : entry - target1) : 0;
    const riskReward = risk > 0 && reward > 0 ? round2(reward / risk) : 0;

    return {
        valid: stopLoss > 0 && target1 > 0 && riskReward > 0,
        entry: round2(entry),
        stopLoss: round2(stopLoss),
        target1: round2(target1),
        target2: round2(target2),
        risk: round2(risk),
        reward: round2(reward),
        riskReward,
        supportLevels: supports,
        resistanceLevels: resistances,
        stopSource: type === "CALL" ? "MARKET_SUPPORT" : "MARKET_RESISTANCE",
        target1Source: "MARKET_STRUCTURE",
        target2Source: target2 > 0 ? "NEXT_MARKET_STRUCTURE" : "NONE",
        reason: riskReward >= C.TRADE_RR ? "VALID_MARKET_STRUCTURE_RR" : "LOW_MARKET_RR"
    };
}

function direction(data, price) {
    let callScore = 0, putScore = 0, callEvidence = 0, putEvidence = 0;
    for (const [key, weight] of [["dailyTrend",12],["fourHourTrend",8],["oneHourTrend",14],["fifteenMinTrend",10]]) {
        const d = normalizeDirection(data?.[key]);
        if (d === "BULLISH") { callScore += weight; callEvidence++; }
        if (d === "BEARISH") { putScore += weight; putEvidence++; }
    }

    const e5=num(data?.ema5), e9=num(data?.ema9), e20=num(data?.ema20), e50=num(data?.ema50);
    if (e5 && e9 && e20 && e50) {
        if (e5 > e9 && e9 > e20 && e20 > e50) { callScore += 12; callEvidence++; }
        if (e5 < e9 && e9 < e20 && e20 < e50) { putScore += 12; putEvidence++; }
    }
    if (e20 && e50 && price) {
        if (price > e20 && price > e50) { callScore += 7; callEvidence++; }
        if (price < e20 && price < e50) { putScore += 7; putEvidence++; }
    }

    const rsi = num(data?.rsi);
    if (rsi >= 55 && rsi <= 70) { callScore += 8; callEvidence++; }
    if (rsi >= 30 && rsi <= 45) { putScore += 8; putEvidence++; }

    const macd=num(data?.macdValue ?? data?.macd), signal=num(data?.macdSignal), hist=num(data?.histogram ?? data?.macdHistogram);
    if (macd > signal && hist >= 0) { callScore += 8; callEvidence++; }
    if (macd < signal && hist <= 0) { putScore += 8; putEvidence++; }

    const adx=num(data?.adx), pdi=num(data?.pdi), mdi=num(data?.mdi);
    if (adx >= 20 && pdi > mdi) { callScore += 7; callEvidence++; }
    if (adx >= 20 && mdi > pdi) { putScore += 7; putEvidence++; }

    const vwap=num(data?.vwap);
    if (vwap && price > vwap) { callScore += 5; callEvidence++; }
    if (vwap && price < vwap) { putScore += 5; putEvidence++; }

    const st=normalizeDirection(data?.supertrend?.trend ?? data?.supertrend);
    if (st === "BULLISH") { callScore += 5; callEvidence++; }
    if (st === "BEARISH") { putScore += 5; putEvidence++; }

    const signalDirection=normalizeDirection(data?.signal), trendDirection=normalizeDirection(data?.trend);
    if (signalDirection === "BULLISH") { callScore += 5; callEvidence++; }
    if (signalDirection === "BEARISH") { putScore += 5; putEvidence++; }
    if (trendDirection === "BULLISH") { callScore += 3; callEvidence++; }
    if (trendDirection === "BEARISH") { putScore += 3; putEvidence++; }

    const difference=Math.abs(callScore-putScore);
    const optionType = callScore > putScore && callScore >= C.MIN_DIRECTION_SCORE && difference >= C.MIN_DIRECTION_DIFFERENCE && callEvidence >= C.MIN_DIRECTION_EVIDENCE
        ? "CALL"
        : putScore > callScore && putScore >= C.MIN_DIRECTION_SCORE && difference >= C.MIN_DIRECTION_DIFFERENCE && putEvidence >= C.MIN_DIRECTION_EVIDENCE
            ? "PUT" : null;

    return { optionType, callScore, putScore, directionDifference:difference, callEvidence, putEvidence, dominantEvidence: optionType === "CALL" ? callEvidence : optionType === "PUT" ? putEvidence : 0 };
}

function mtf(type, data) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    const values = [["DAILY",data?.dailyTrend],["4H",data?.fourHourTrend],["1H",data?.oneHourTrend],["15M",data?.fifteenMinTrend]].map(([name,value]) => ({name,value:normalizeDirection(value)}));
    const available=values.filter(x=>x.value!=="UNKNOWN");
    const aligned=available.filter(x=>x.value===expected);
    const opposition=available.filter(x=>x.value!==expected);
    const score=available.length ? clamp(50 + ((aligned.length-opposition.length)/available.length)*50) : 0;
    return { score, alignment:aligned.length, opposition:opposition.length, available:available.length, alignedTimeframes:aligned.map(x=>x.name), isAligned:aligned.length>=3 };
}

function confidence(data, dir, mtfResult, rr) {
    const scanner=clamp(data?.rankingScore ?? data?.finalScore ?? data?.aiFinalScore ?? data?.aiScore ?? data?.scannerScore ?? data?.score);
    const directionScore=clamp(dir.optionType === "CALL" ? dir.callScore : dir.putScore);
    const expected=dir.optionType === "CALL" ? "BULLISH" : "BEARISH";
    const trendScore=normalizeDirection(data?.trend)===expected ? 100 : 50;
    const rsi=num(data?.rsi);
    const momentumScore=((dir.optionType === "CALL" && rsi>=55 && rsi<=70) || (dir.optionType === "PUT" && rsi>=30 && rsi<=45)) ? 100 : 50;
    const rvol=num(data?.rvol);
    const volumeScore=rvol>=2?100:rvol>=1.5?85:rvol>=1.2?70:rvol>=1?55:35;
    const rrScore=rr>=2.5?100:rr>=2?90:rr>=1.5?80:rr>=1.2?65:0;
    const value=clamp(scanner*.25 + directionScore*.22 + mtfResult.score*.15 + trendScore*.12 + momentumScore*.10 + volumeScore*.06 + 50*.04 + rrScore*.06);
    return { confidence:Math.round(value), scannerScore:Math.round(scanner), directionScore:Math.round(directionScore), trendScore, momentumScore, volumeScore, rrScore };
}

function gates(dir, mtfResult, rr, conf, scanner) {
    const base={ direction:!!dir.optionType, directionEvidence:dir.dominantEvidence>=3, directionDifference:dir.directionDifference>=10, mtf:mtfResult.alignment>=2, riskReward:rr>=C.WATCH_RR, confidence:conf>=C.WATCH_CONFIDENCE, scanner:scanner>=55 };
    const trade={...base, tradeMTF:mtfResult.alignment>=3, tradeRiskReward:rr>=C.TRADE_RR, tradeConfidence:conf>=C.TRADE_CONFIDENCE, tradeScanner:scanner>=70};
    return { base, trade, basePassed:Object.values(base).every(Boolean), tradePassed:Object.values(trade).every(Boolean), failedBase:Object.keys(base).filter(k=>!base[k]), failedTrade:Object.keys(trade).filter(k=>!trade[k]) };
}

function strikeValue(c) { return positive(c?.strike, c?.strike_price, c?.strikePrice, c?.strike_price_value); }
function expiryValue(c) { return String(c?.expiry ?? c?.expiry_date ?? c?.expiryDate ?? "").trim().slice(0,10); }
function normalizeExpiry(value) { const s=String(value ?? "").trim(); if (!s) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d=new Date(s); return Number.isNaN(d.getTime()) ? s.slice(0,10) : d.toISOString().slice(0,10); }
function optionType(c) { return text(c?.option_type ?? c?.optionType ?? c?.instrument_type ?? c?.option_type_name).endsWith("CE") || text(c?.trading_symbol ?? c?.tradingsymbol).endsWith("CE") ? "CE" : text(c?.option_type ?? c?.optionType ?? c?.instrument_type ?? c?.option_type_name).endsWith("PE") || text(c?.trading_symbol ?? c?.tradingsymbol).endsWith("PE") ? "PE" : null; }

async function resolveContract(symbol, type, spot) {
    const broker=getBroker();
    if (!broker || typeof broker.getOptionContracts !== "function") return {contract:null,reason:"BROKER_OPTION_CONTRACT_API_MISSING"};
    try {
        const contracts=await broker.getOptionContracts(symbol);
        if (!Array.isArray(contracts) || !contracts.length) return {contract:null,reason:"NO_OPTION_CONTRACTS"};
        const targetType=type === "CALL" ? "CE" : "PE";
        const today=new Date(); today.setHours(0,0,0,0);
        const usable=contracts.filter(c => {
            const strike=strikeValue(c), expiry=normalizeExpiry(expiryValue(c));
            const d=expiry ? new Date(`${expiry}T00:00:00`) : null;
            const days=d && !Number.isNaN(d.getTime()) ? Math.ceil((d-today)/86400000) : -1;
            return strike>0 && optionType(c)===targetType && days>=C.MIN_EXPIRY_DAYS && Boolean(c?.instrument_key || c?.instrumentKey);
        });
        if (!usable.length) return {contract:null,reason:"NO_VALID_EXPIRY_OR_SIDE_CONTRACTS"};
        const strikes=[...new Set(usable.map(strikeValue))].sort((a,b)=>a-b);
        const atm=strikes.reduce((best,s)=>Math.abs(s-spot)<Math.abs(best-spot)?s:best,strikes[0]);
        const index=strikes.indexOf(atm);
        const recommendedStrike=type === "CALL" ? strikes[Math.max(0,index-1)] : strikes[Math.min(strikes.length-1,index+1)];
        const selected=usable.reduce((best,c)=>!best || Math.abs(strikeValue(c)-recommendedStrike)<Math.abs(strikeValue(best)-recommendedStrike) ? c : best,null);
        if (!selected) return {contract:null,reason:"NO_VALID_STRIKE"};
        return { contract:selected, recommendedStrike:strikeValue(selected), atmStrike:atm, expiry:normalizeExpiry(expiryValue(selected)), reason:null };
    } catch(error) { return {contract:null,reason:error?.message || "CONTRACT_LOOKUP_FAILED"}; }
}

async function getOptionQuote(contract) {
    const broker=getBroker();
    if (!broker || !contract) return null;
    const key=contract.instrument_key || contract.instrumentKey;
    if (!key) return null;
    try {
        if (typeof broker.getOptionQuote === "function") return await broker.getOptionQuote(key);
        if (typeof broker.getOptionLTP === "function") return { ltp: await broker.getOptionLTP(key) };
    } catch(error) { console.log(`⚠️ Option quote failed ${key}: ${error.message}`); }
    return null;
}

function premiumLevels(quote) {
    const entry=round2(quote?.ltp ?? quote?.last_price ?? quote?.price);
    if (entry<=0) return {valid:false,entry:0,stopLoss:0,target1:0,target2:0,risk:0,reward:0,riskReward:0};
    const stopLoss=round2(entry*0.70), target1=round2(entry*1.30), target2=round2(entry*1.60);
    const risk=round2(entry-stopLoss), reward=round2(target1-entry);
    return {valid:true,entry,stopLoss,target1,target2,risk,reward,riskReward:round2(reward/risk)};
}

async function calculateOptionsDecision(data) {
    if (!data || typeof data !== "object") return null;
    const price=stockPrice(data);
    if (price<=0) return { stock:data.stock || data.symbol, optionType:null, optionsDecision:"REJECT", reason:"INVALID_STOCK_PRICE" };

    const dir=direction(data,price);
    if (!dir.optionType) return { stock:data.stock || data.symbol, symbol:data.symbol || data.stock, price, optionType:null, optionsDecision:"REJECT", reason:"DIRECTION_NOT_CLEAR", callScore:dir.callScore, putScore:dir.putScore };

    const entry=stockEntry(data,price);
    const setup=marketSetup(data,entry,dir.optionType);
    const mtfResult=mtf(dir.optionType,data);
    const scannerScore=clamp(data.rankingScore ?? data.finalScore ?? data.aiFinalScore ?? data.aiScore ?? data.scannerScore ?? data.score);
    const conf=confidence(data,dir,mtfResult,setup.riskReward);
    const gate=gates(dir,mtfResult,setup.riskReward,conf.confidence,scannerScore);

    let contractResult={contract:null,reason:"NOT_LOOKED_UP"};
    if (setup.valid) contractResult=await resolveContract(data.stock || data.symbol,dir.optionType,price);
    const optionQuote=contractResult.contract ? await getOptionQuote(contractResult.contract) : null;
    const premium=premiumLevels(optionQuote);

    let decision="REJECT";
    if (gate.basePassed) decision=gate.tradePassed && contractResult.contract && premium.valid ? "TRADE" : "WATCH";
    const reasons=[];
    if (!setup.valid) reasons.push(setup.reason || "INVALID_MARKET_SETUP");
    if (!gate.basePassed) reasons.push(...gate.failedBase);
    if (decision !== "TRADE") reasons.push(...gate.failedTrade);
    if (!contractResult.contract) reasons.push(contractResult.reason);
    if (setup.riskReward < C.TRADE_RR) reasons.push("LOW_MARKET_RR");
    const uniqueReasons=[...new Set(reasons.filter(Boolean))];

    return {
        ...data,
        stock:data.stock || data.symbol,
        symbol:data.symbol || data.stock,
        optionType:dir.optionType,
        callScore:dir.callScore,
        putScore:dir.putScore,
        directionDifference:dir.directionDifference,
        directionEvidence:dir.dominantEvidence,
        entry:setup.entry,
        stopLoss:setup.stopLoss,
        target1:setup.target1,
        target2:setup.target2,
        risk:setup.risk,
        reward:setup.reward,
        riskReward:setup.riskReward,
        stockEntry:setup.entry,
        stockStopLoss:setup.stopLoss,
        stockTarget1:setup.target1,
        stockTarget2:setup.target2,
        stockRiskReward:setup.riskReward,
        optionSymbol:contractResult.contract?.trading_symbol || contractResult.contract?.tradingsymbol || "",
        recommendedStrike:contractResult.recommendedStrike || strikeValue(contractResult.contract) || null,
        atmStrike:contractResult.atmStrike || null,
        optionExpiry:contractResult.expiry || null,
        optionInstrumentKey:contractResult.contract?.instrument_key || contractResult.contract?.instrumentKey || "",
        optionPremiumEntry:premium.entry,
        optionPremiumStopLoss:premium.stopLoss,
        optionPremiumTarget1:premium.target1,
        optionPremiumTarget2:premium.target2,
        optionPremiumRisk:premium.risk,
        optionPremiumReward:premium.reward,
        optionPremiumRiskReward:premium.riskReward,
        optionsConfidence:conf.confidence,
        confidence:conf.confidence,
        scannerScore:conf.scannerScore,
        directionScore:conf.directionScore,
        mtfScore:mtfResult.score,
        mtfAlignment:mtfResult.alignment,
        mtfAlignedTimeframes:mtfResult.alignedTimeframes,
        optionsDecision:decision,
        decision,
        decisionReason:uniqueReasons.join(",") || "VALID_SETUP",
        contractLookupReason:contractResult.reason || "OK",
        gates:gate,
        marketSetup:setup,
        optionPremiumSetup:premium,
        pipeline:{ ...(data.pipeline || {}), optionsChecked:true }
    };
}

async function calculateOptionsDecisions(rows) {
    const input=Array.isArray(rows) ? rows : [];
    const results=[];
    for (const row of input) {
        try {
            const result=await calculateOptionsDecision(row);
            if (result) results.push(result);
        } catch(error) {
            results.push({ stock:row?.stock || row?.symbol, symbol:row?.symbol || row?.stock, optionsDecision:"REJECT", decision:"REJECT", reason:error?.message || "OPTIONS_ENGINE_ERROR", optionsConfidence:0 });
        }
    }
    return results;
}

module.exports = { calculateOptionsDecision, calculateOptionsDecisions, marketSetup };
