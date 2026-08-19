// ============================================================
// OPTIONS DECISION ENGINE — CORRECTED V10
// ============================================================
// Rules: no forced direction, no fake contract/LTP, symmetric
// CALL/PUT scoring, strict contract type/expiry validation,
// independent stock-vs-option risk, deterministic batch output.
// ============================================================

const brokerModule = require("./brokers");

const ENGINE_CONFIG = Object.freeze({
    MIN_DIRECTION_SCORE: 35,
    MIN_DIRECTION_DIFFERENCE: 10,
    MIN_DIRECTION_EVIDENCE: 3,
    STRONG_DIRECTION_DIFFERENCE: 16,
    TRADE_CONFIDENCE: 82,
    WATCH_CONFIDENCE: 65,
    TRADE_SCANNER_SCORE: 70,
    WATCH_SCANNER_SCORE: 55,
    TRADE_DIRECTION_DIFFERENCE: 14,
    TRADE_MTF_ALIGNMENT: 3,
    WATCH_MTF_ALIGNMENT: 2,
    TRADE_RR: 1.5,
    WATCH_RR: 1.2,
    TRADE_MOMENTUM: 65,
    TRADE_TREND: 65,
    MIN_EXPIRY_DAYS: 7,
    OPTION_STOP_PERCENT: 0.20,
    OPTION_TARGET1_RISK_MULTIPLIER: 1,
    OPTION_TARGET2_RISK_MULTIPLIER: 2,
    CONFIDENCE_WEIGHTS: Object.freeze({
        scanner: 0.20, direction: 0.25, mtf: 0.15, trend: 0.12,
        momentum: 0.12, volume: 0.06, breakout: 0.04, rr: 0.06
    })
});

function toNumber(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function clamp(v, min = 0, max = 100) { return Math.max(min, Math.min(max, toNumber(v))); }
function text(v) { return String(v ?? "").trim().toUpperCase(); }
function firstValue(...values) { for (const v of values) if (v !== undefined && v !== null && v !== "") return v; return null; }
function firstPositive(...values) { for (const v of values) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; } return 0; }
function uniqueSortedLevels(levels) { return [...new Set(levels.map(Number).filter(v => Number.isFinite(v) && v > 0).map(v => Number(v.toFixed(2))) )]; }

function normalizeDirection(v) {
    const s = text(v);
    if (s.includes("BULL") || s.includes("BUY") || s === "UP" || s === "CALL" || s === "CE") return "BULLISH";
    if (s.includes("BEAR") || s.includes("SELL") || s === "DOWN" || s === "PUT" || s === "PE") return "BEARISH";
    return "UNKNOWN";
}

function normalizeOptionType(v) {
    const s = text(v);
    if (s === "CALL" || s === "CE" || s.includes("CALL")) return "CALL";
    if (s === "PUT" || s === "PE" || s.includes("PUT")) return "PUT";
    return "";
}

function getBroker() {
    if (brokerModule && typeof brokerModule.getBroker === "function") return brokerModule.getBroker();
    return brokerModule;
}

function getStrikeInterval(price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return 50;
    if (p < 500) return 10;
    if (p < 1000) return 20;
    if (p < 2000) return 50;
    return 100;
}

function getRecommendedStrike(price, optionType) {
    const interval = getStrikeInterval(price);
    let strike = Math.round(Number(price) / interval) * interval;
    if (optionType === "CALL") strike -= interval;
    if (optionType === "PUT") strike += interval;
    return { strike: Math.max(interval, strike), interval };
}

function normalizeOptionContract(contract, fallbackStrike = 0) {
    if (!contract || typeof contract !== "object") return null;
    const instrumentKey = firstValue(contract.instrumentKey, contract.instrument_key, contract.instrument_token, contract.instrumentToken, contract.exchange_token, contract.exchangeToken, contract.token);
    const tradingSymbol = firstValue(contract.tradingSymbol, contract.trading_symbol, contract.symbol, contract.name);
    const strike = toNumber(firstValue(contract.strike, contract.strikePrice, contract.strike_price, contract.strike_price_value, fallbackStrike));
    const expiry = firstValue(contract.expiry, contract.expiryDate, contract.expiry_date, contract.expiry_date_time);
    const expiryDays = toNumber(firstValue(contract.expiryDays, contract.expiry_days, contract.daysToExpiry), 0);
    let optionType = normalizeOptionType(firstValue(contract.optionType, contract.option_type, contract.instrumentType, contract.option, ""));
    if (!optionType && tradingSymbol) optionType = normalizeOptionType(tradingSymbol);
    const lotSize = firstValue(contract.lotSize, contract.lot_size, contract.lotsize);
    const tickSize = firstValue(contract.tickSize, contract.tick_size);
    if (!instrumentKey && !tradingSymbol) return null;
    if (!Number.isFinite(strike) || strike <= 0) return null;
    return { ...contract, instrumentKey, tradingSymbol, strike, expiry, expiryDays, optionType, lotSize, tickSize };
}

function contractMatches(contract, optionType) {
    if (!contract) return false;
    const expected = normalizeOptionType(optionType);
    const actual = normalizeOptionType(contract.optionType || contract.instrumentType || contract.tradingSymbol || contract.trading_symbol);
    return !!expected && !!actual && expected === actual;
}

function validExpiry(contract) {
    if (!contract) return false;
    if (contract.expiryDays > 0) return contract.expiryDays >= ENGINE_CONFIG.MIN_EXPIRY_DAYS;
    if (!contract.expiry) return false;
    const d = new Date(contract.expiry);
    if (!Number.isNaN(d.getTime())) {
        const days = (d.getTime() - Date.now()) / 86400000;
        return days >= ENGINE_CONFIG.MIN_EXPIRY_DAYS - 0.01;
    }
    // Some broker adapters return DD-MMM-YYYY or YYYY-MM-DD strings.
    const parsed = new Date(String(contract.expiry).replace(/-/g, " "));
    return !Number.isNaN(parsed.getTime()) && (parsed.getTime() - Date.now()) / 86400000 >= ENGINE_CONFIG.MIN_EXPIRY_DAYS - 0.01;
}

async function tryOptionContract(symbol, optionType, strike) {
    const broker = getBroker();
    if (!broker || typeof broker.getOptionContract !== "function") return null;
    const s = Number(strike);
    if (!symbol || !Number.isFinite(s) || s <= 0) return null;
    try {
        const raw = await broker.getOptionContract(symbol, s, optionType, ENGINE_CONFIG.MIN_EXPIRY_DAYS);
        const c = normalizeOptionContract(raw, s);
        if (!c || !contractMatches(c, optionType) || !validExpiry(c)) return null;
        return c;
    } catch (_) { return null; }
}

async function searchContractsDirectly(symbol, optionType, requestedStrike) {
    const broker = getBroker();
    if (!broker || typeof broker.getOptionContracts !== "function") return null;
    try {
        const raw = await broker.getOptionContracts(symbol);
        if (!Array.isArray(raw)) return null;
        const normalized = raw.map(c => normalizeOptionContract(c, requestedStrike)).filter(Boolean);
        // CRITICAL: never fall back to an untyped/wrong-side contract.
        const pool = normalized.filter(c => contractMatches(c, optionType) && validExpiry(c));
        if (!pool.length) return null;
        pool.sort((a, b) => Math.abs(a.strike - requestedStrike) - Math.abs(b.strike - requestedStrike));
        return pool[0];
    } catch (error) {
        console.log(`⚠️ Direct option search failed: ${symbol} | ${error.message}`);
        return null;
    }
}

function buildStrikeSearchList(recommendedStrike, interval) {
    const base = Number(recommendedStrike), step = Number(interval);
    if (!Number.isFinite(base) || !Number.isFinite(step) || step <= 0) return [];
    const out = [base];
    for (let d = 1; d <= 8; d++) { if (base - step * d > 0) out.push(base - step * d); out.push(base + step * d); }
    return [...new Set(out)];
}

async function resolveOptionContract(symbol, optionType, recommendedStrike, strikeInterval) {
    if (!symbol || !optionType) return null;
    const requested = Number(recommendedStrike);
    if (!Number.isFinite(requested) || requested <= 0) return null;
    const interval = Number(strikeInterval) > 0 ? Number(strikeInterval) : getStrikeInterval(requested);
    let best = null, bestDistance = Infinity;
    for (const strike of buildStrikeSearchList(requested, interval)) {
        const c = await tryOptionContract(symbol, optionType, strike);
        if (!c) continue;
        const distance = Math.abs(Number(c.strike) - requested);
        if (distance < bestDistance) { best = c; bestDistance = distance; }
        if (distance === 0) break;
    }
    return best || await searchContractsDirectly(symbol, optionType, requested);
}

function normalizeQuoteLTP(quote) {
    if (typeof quote === "number") return quote > 0 ? quote : 0;
    if (!quote || typeof quote !== "object") return 0;
    return firstPositive(quote.ltp, quote.lastPrice, quote.last_price, quote.last_traded_price, quote.close, quote.lp);
}

async function resolveOptionQuote(contract) {
    if (!contract) return null;
    const broker = getBroker();
    if (!broker) return null;
    const key = firstValue(contract.instrumentKey, contract.instrument_key, contract.instrument_token, contract.tradingSymbol, contract.trading_symbol);
    if (!key) return null;
    try {
        const methods = ["getOptionQuote", "getQuote"];
        for (const method of methods) {
            if (typeof broker[method] !== "function") continue;
            const raw = await broker[method](key);
            const ltp = normalizeQuoteLTP(raw);
            if (ltp > 0) return { ...(raw && typeof raw === "object" ? raw : {}), ltp };
        }
    } catch (error) { console.log(`⚠️ Option quote failed: ${key} | ${error.message}`); }
    return null;
}

function getStockPrice(d) { return firstPositive(d.price, d.ltp, d.lastPrice, d.close, d.currentPrice); }
function getStockEntry(d, price, type) {
    const supplied = firstPositive(d.entry, d.stockEntry, d.underlyingEntry);
    if (supplied) return supplied;
    const atr = firstPositive(d.atr);
    return atr ? (type === "CALL" ? price + atr * 0.10 : price - atr * 0.10) : price;
}
function getStockStopLoss(d, entry, type) {
    const supplied = firstPositive(d.stopLoss, d.stockStopLoss, d.underlyingStopLoss);
    if (supplied) return supplied;
    const atr = firstPositive(d.atr), support = firstPositive(d.support1, d.pivotS1), resistance = firstPositive(d.resistance1, d.pivotR1);
    if (type === "CALL") return support > 0 && support < entry ? support : (atr ? entry - atr : entry * 0.98);
    return resistance > entry ? resistance : (atr ? entry + atr : entry * 1.02);
}
function getStockTarget1(d, entry, type) {
    const supplied = firstPositive(d.target1, d.stockTarget1, d.underlyingTarget1);
    if (supplied) return supplied;
    const atr = firstPositive(d.atr), resistance = firstPositive(d.resistance1, d.pivotR1), support = firstPositive(d.support1, d.pivotS1);
    if (type === "CALL") return resistance > entry ? resistance : (atr ? entry + atr : entry * 1.03);
    return support > 0 && support < entry ? support : (atr ? entry - atr : entry * 0.97);
}
function getStockTarget2(d, entry, target1, type) {
    const supplied = firstPositive(d.target2, d.stockTarget2, d.underlyingTarget2);
    if (supplied) return supplied;
    const atr = firstPositive(d.atr), distance = Math.abs(target1 - entry), extra = atr ? atr * 2 : distance * 2;
    return type === "CALL" ? Math.max(target1, entry + extra) : Math.min(target1, entry - extra);
}
function calculateRiskReward(entry, stopLoss, target1, type) {
    const risk = type === "CALL" ? entry - stopLoss : stopLoss - entry;
    const reward = type === "CALL" ? target1 - entry : entry - target1;
    return risk > 0 && reward > 0 ? Number((reward / risk).toFixed(2)) : 0;
}

function getOISupportResistance(d) {
    return {
        oiSupport1: firstPositive(d.oiSupport1, d.oi_support1, d.putOISupport, d.putOiSupport, d.putOILevel, d.putOiLevel, d.maxPutOI, d.maxPutOi),
        oiSupport2: firstPositive(d.oiSupport2, d.oi_support2, d.oiSupport, d.oi_support, d.putOISupport2, d.putOiSupport2),
        oiResistance1: firstPositive(d.oiResistance1, d.oi_resistance1, d.callOIResistance, d.callOiResistance, d.callOILevel, d.callOiLevel, d.maxCallOI, d.maxCallOi),
        oiResistance2: firstPositive(d.oiResistance2, d.oi_resistance2, d.oiResistance, d.oi_resistance, d.callOIResistance2, d.callOiResistance2),
        maxPain: firstPositive(d.maxPain, d.max_pain, d.optionMaxPain, d.option_max_pain)
    };
}
function buildCombinedLevels(d) {
    const oi = getOISupportResistance(d);
    const supports = uniqueSortedLevels([d.support1, d.support2, d.pivotS1, d.pivotS2, oi.oiSupport1, oi.oiSupport2]);
    const resistances = uniqueSortedLevels([d.resistance1, d.resistance2, d.pivotR1, d.pivotR2, oi.oiResistance1, oi.oiResistance2]);
    return { technical: { support1: firstPositive(d.support1), support2: firstPositive(d.support2), resistance1: firstPositive(d.resistance1), resistance2: firstPositive(d.resistance2), pivotS1: firstPositive(d.pivotS1), pivotS2: firstPositive(d.pivotS2), pivotR1: firstPositive(d.pivotR1), pivotR2: firstPositive(d.pivotR2) }, oi, supports, resistances };
}

function calculateDirection(d, price) {
    const vals = [
        ["dailyTrend", 12], ["oneHourTrend", 14], ["fifteenMinTrend", 10], ["fourHourTrend", 8]
    ];
    let callScore = 0, putScore = 0, callEvidence = 0, putEvidence = 0;
    for (const [key, weight] of vals) { const dir = normalizeDirection(d[key]); if (dir === "BULLISH") { callScore += weight; callEvidence++; } else if (dir === "BEARISH") { putScore += weight; putEvidence++; } }
    const ema5 = toNumber(d.ema5), ema9 = toNumber(d.ema9), ema20 = toNumber(d.ema20), ema50 = toNumber(d.ema50);
    if (ema5 > 0 && ema9 > 0 && ema20 > 0 && ema50 > 0) {
        if (ema5 > ema9 && ema9 > ema20 && ema20 > ema50) { callScore += 12; callEvidence++; }
        else if (ema5 < ema9 && ema9 < ema20 && ema20 < ema50) { putScore += 12; putEvidence++; }
    }
    if (ema20 > 0 && ema50 > 0) { if (price > ema20 && price > ema50) { callScore += 7; callEvidence++; } else if (price < ema20 && price < ema50) { putScore += 7; putEvidence++; } }
    const rsi = toNumber(d.rsi); if (rsi >= 55 && rsi <= 70) { callScore += 8; callEvidence++; } else if (rsi >= 30 && rsi <= 45) { putScore += 8; putEvidence++; }
    const macd = toNumber(d.macdValue ?? d.macd), macdSignal = toNumber(d.macdSignal), hist = toNumber(d.histogram ?? d.macdHistogram);
    if (macd > macdSignal && hist >= 0) { callScore += 8; callEvidence++; } else if (macd < macdSignal && hist <= 0) { putScore += 8; putEvidence++; }
    const adx = toNumber(d.adx), pdi = toNumber(d.pdi), mdi = toNumber(d.mdi); if (adx >= 20) { if (pdi > mdi) { callScore += 7; callEvidence++; } else if (mdi > pdi) { putScore += 7; putEvidence++; } }
    const vwap = toNumber(d.vwap); if (vwap > 0) { if (price > vwap) { callScore += 5; callEvidence++; } else if (price < vwap) { putScore += 5; putEvidence++; } }
    const st = normalizeDirection(d.supertrend); if (st === "BULLISH") { callScore += 5; callEvidence++; } else if (st === "BEARISH") { putScore += 5; putEvidence++; }
    const signal = normalizeDirection(d.signal); if (signal === "BULLISH") { callScore += 5; callEvidence++; } else if (signal === "BEARISH") { putScore += 5; putEvidence++; }
    const trend = normalizeDirection(d.trend); if (trend === "BULLISH") { callScore += 3; callEvidence++; } else if (trend === "BEARISH") { putScore += 3; putEvidence++; }
    const difference = Math.abs(callScore - putScore), dominantScore = Math.max(callScore, putScore);
    const dominantEvidence = callScore > putScore ? callEvidence : putScore > callScore ? putEvidence : Math.max(callEvidence, putEvidence);
    let optionType = null;
    if (callScore > putScore && callScore >= ENGINE_CONFIG.MIN_DIRECTION_SCORE && difference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE && callEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE) optionType = "CALL";
    else if (putScore > callScore && putScore >= ENGINE_CONFIG.MIN_DIRECTION_SCORE && difference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE && putEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE) optionType = "PUT";
    return { optionType, callScore, putScore, directionDifference: difference, callEvidence, putEvidence, dominantScore, dominantEvidence };
}

function calculateMTF(type, d) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    const values = [["DAILY", d.dailyTrend], ["4H", d.fourHourTrend], ["1H", d.oneHourTrend], ["15M", d.fifteenMinTrend]].map(([name, value]) => ({ name, value: normalizeDirection(value) }));
    const available = values.filter(x => x.value !== "UNKNOWN"), aligned = available.filter(x => x.value === expected), opposite = available.filter(x => x.value !== expected);
    const score = available.length ? clamp(((aligned.length - opposite.length) / available.length) * 50 + 50) : 0;
    return { score, alignment: aligned.length, opposition: opposite.length, available: available.length, required: ENGINE_CONFIG.TRADE_MTF_ALIGNMENT, alignedTimeframes: aligned.map(x => x.name), availableTimeframes: available.map(x => x.name), isAligned: aligned.length >= ENGINE_CONFIG.TRADE_MTF_ALIGNMENT, fullAlignment: available.length === 4 && aligned.length === 4 };
}
function calculateTrendScore(d, type) {
    if (!type) return 0; let score = 50, e5 = toNumber(d.ema5), e9 = toNumber(d.ema9), e20 = toNumber(d.ema20), e50 = toNumber(d.ema50);
    const bullish = e5 > e9 && e9 > e20 && e20 > e50, bearish = e5 > 0 && e9 > 0 && e20 > 0 && e50 > 0 && e5 < e9 && e9 < e20 && e20 < e50;
    if (e5 > 0 && e9 > 0 && e20 > 0 && e50 > 0) { if ((type === "CALL" && bullish) || (type === "PUT" && bearish)) score += 35; else if ((type === "CALL" && bearish) || (type === "PUT" && bullish)) score -= 35; }
    const trend = normalizeDirection(d.trend), expected = type === "CALL" ? "BULLISH" : "BEARISH"; if (trend === expected) score += 15; else if (trend !== "UNKNOWN") score -= 15;
    return clamp(score);
}
function calculateMomentumScore(d, type) {
    if (!type) return 0; const expected = type === "CALL" ? "BULLISH" : "BEARISH"; let score = 50, rsi = toNumber(d.rsi), macd = toNumber(d.macdValue ?? d.macd), sig = toNumber(d.macdSignal), hist = toNumber(d.histogram ?? d.macdHistogram);
    if (rsi > 0) { if ((expected === "BULLISH" && rsi >= 55 && rsi <= 70) || (expected === "BEARISH" && rsi >= 30 && rsi <= 45)) score += 20; else if ((expected === "BULLISH" && rsi < 50) || (expected === "BEARISH" && rsi > 50)) score -= 20; }
    const bull = macd > sig && hist >= 0, bear = macd < sig && hist <= 0; if ((expected === "BULLISH" && bull) || (expected === "BEARISH" && bear)) score += 30; else if ((expected === "BULLISH" && bear) || (expected === "BEARISH" && bull)) score -= 30;
    return clamp(score);
}
function calculateVolumeScore(d) { const r = toNumber(d.rvol); if (r <= 0) return 50; if (r >= 2) return 100; if (r >= 1.5) return 85; if (r >= 1.2) return 70; if (r >= 1) return 55; return 35; }
function calculateBreakoutScore(d, type) { const s = text(d.breakout), t = text(d.breakoutType), expected = type === "CALL" ? "BULL" : "BEAR"; if (s.includes(expected) || t.includes(expected)) return 100; if (s.includes("BREAK") || t.includes("BREAK")) return 65; return 50; }
function calculateRRScore(rr) { const r = Number(rr); if (!Number.isFinite(r) || r <= 0) return 0; if (r >= 2.5) return 100; if (r >= 2) return 90; if (r >= 1.5) return 80; if (r >= 1.2) return 65; if (r >= 1) return 50; return 25; }
function calculateScannerScore(d, direction) { const raw = firstPositive(d.aiFinalScore, d.finalScore, d.score, d.scannerScore); if (!raw || !direction?.optionType) return 0; const ds = direction.optionType === "CALL" ? direction.callScore : direction.putScore; return clamp(clamp(raw) * 0.70 + clamp(ds) * 0.30); }

function calculateOptionTradeSetup(optionType, optionLTP, stockRiskReward) {
    const premium = Number(optionLTP); if (!Number.isFinite(premium) || premium <= 0) return null;
    const risk = premium * ENGINE_CONFIG.OPTION_STOP_PERCENT, entry = premium, sl = Math.max(0.05, entry - risk), t1 = entry + risk, t2 = entry + risk * 2;
    return { optionType, optionEntry: Number(entry.toFixed(2)), optionStopLoss: Number(sl.toFixed(2)), optionTarget1: Number(t1.toFixed(2)), optionTarget2: Number(t2.toFixed(2)), optionRisk: Number((entry-sl).toFixed(2)), optionReward: Number((t2-entry).toFixed(2)), optionRiskReward: Number(((t2-entry)/(entry-sl)).toFixed(2)), stockRiskReward: Number(toNumber(stockRiskReward).toFixed(2)) };
}

function calculateConfidence(d, direction, mtf, rr) {
    if (!direction?.optionType) return { confidence: 0, scannerScore: 0, directionScore: 0, mtfScore: 0, trendScore: 0, momentumScore: 0, volumeScore: 0, breakoutScore: 0, rrScore: 0 };
    const scannerScore = calculateScannerScore(d, direction), directionScore = clamp((direction.optionType === "CALL" ? direction.callScore : direction.putScore) / 100 * 100), trendScore = calculateTrendScore(d, direction.optionType), momentumScore = calculateMomentumScore(d, direction.optionType), volumeScore = calculateVolumeScore(d), breakoutScore = calculateBreakoutScore(d, direction.optionType), rrScore = calculateRRScore(rr), w = ENGINE_CONFIG.CONFIDENCE_WEIGHTS;
    let confidence = scannerScore*w.scanner + directionScore*w.direction + mtf.score*w.mtf + trendScore*w.trend + momentumScore*w.momentum + volumeScore*w.volume + breakoutScore*w.breakout + rrScore*w.rr;
    if (direction.dominantEvidence < ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE) confidence -= 15;
    if (direction.directionDifference < ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE) confidence -= 15;
    if (!mtf.available) confidence -= 20;
    if (mtf.alignment < 2) confidence -= 8;
    if (rr < ENGINE_CONFIG.WATCH_RR) confidence -= 10;
    confidence = clamp(confidence);
    return { confidence: Math.round(confidence), scannerScore: Math.round(scannerScore), directionScore: Math.round(directionScore), mtfScore: Math.round(mtf.score), trendScore: Math.round(trendScore), momentumScore: Math.round(momentumScore), volumeScore: Math.round(volumeScore), breakoutScore: Math.round(breakoutScore), rrScore: Math.round(rrScore) };
}

function evaluateQualityGates(d, direction, mtf, rr, confidence) {
    const scanner = calculateScannerScore(d, direction);
    const gates = {
        direction: !!direction.optionType,
        directionEvidence: direction.dominantEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE,
        directionDifference: direction.directionDifference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE,
        mtf: mtf.alignment >= ENGINE_CONFIG.WATCH_MTF_ALIGNMENT,
        tradeMTF: mtf.alignment >= ENGINE_CONFIG.TRADE_MTF_ALIGNMENT,
        riskReward: rr >= ENGINE_CONFIG.WATCH_RR,
        tradeRiskReward: rr >= ENGINE_CONFIG.TRADE_RR,
        confidence: confidence >= ENGINE_CONFIG.WATCH_CONFIDENCE,
        tradeConfidence: confidence >= ENGINE_CONFIG.TRADE_CONFIDENCE,
        scanner: scanner >= ENGINE_CONFIG.WATCH_SCANNER_SCORE,
        tradeScanner: scanner >= ENGINE_CONFIG.TRADE_SCANNER_SCORE
    };
    const failedGates = Object.entries(gates).filter(([,v]) => !v).map(([k]) => k);
    return { ...gates, passedCount: Object.values(gates).filter(Boolean).length, totalCount: Object.keys(gates).length, failedGates, allPassed: failedGates.length === 0 };
}

function getDecision(direction, mtf, rr, confidence, gates, contract, quote) {
    if (!direction.optionType) return { decision:"REJECT", rating:"NO DIRECTION", reason:"Directional evidence is insufficient." };
    if (!contract) return { decision:"WATCH", rating:"NO CONTRACT", reason:"Direction exists but no valid real option contract was found." };
    if (!quote) return { decision:"WATCH", rating:"NO LTP", reason:"Real option contract found but live option LTP is unavailable." };
    if (rr < ENGINE_CONFIG.WATCH_RR) return { decision:"REJECT", rating:"LOW R:R", reason:"Underlying risk/reward is below minimum." };
    if (confidence >= ENGINE_CONFIG.TRADE_CONFIDENCE && gates.tradeMTF && gates.tradeRiskReward && gates.tradeConfidence && gates.tradeScanner && gates.directionEvidence && gates.directionDifference && gates.mtf) return { decision:"TRADE", rating:"A", reason:"Direction, MTF, risk/reward, confidence and real option data are aligned." };
    if (confidence >= ENGINE_CONFIG.WATCH_CONFIDENCE && gates.mtf && gates.riskReward) return { decision:"WATCH", rating:"B", reason:"Valid setup, but one or more TRADE gates are not met." };
    return { decision:"REJECT", rating:"C", reason:"Setup does not satisfy minimum quality gates." };
}

async function makeOptionDecision(stockData = {}) {
    const symbol = firstValue(stockData.symbol, stockData.stock, stockData.name), price = getStockPrice(stockData);
    if (!symbol || price <= 0) return { ...stockData, symbol, direction:null, optionType:null, decision:"REJECT", confidence:0, qualityGates:"INVALID_STOCK_DATA", failedGates:["symbol","price"] };
    const direction = calculateDirection(stockData, price);
    if (!direction.optionType) return { ...stockData, symbol, price, direction:"NO DIRECTION", optionType:null, callScore:direction.callScore, putScore:direction.putScore, scoreDifference:direction.directionDifference, callEvidence:direction.callEvidence, putEvidence:direction.putEvidence, entry:0, stopLoss:0, target1:0, target2:0, riskReward:0, confidence:0, decision:"REJECT", rating:"NO DIRECTION", optionsDecision:"REJECT", optionsRating:"NO DIRECTION", optionsConfidence:0, optionsReason:"Directional evidence is insufficient.", contractAvailable:false, optionPriceAvailable:false, optionSetupAvailable:false, qualityGates:"NO_DIRECTION", failedGates:["direction"] };
    const optionType = direction.optionType;
    const entry = getStockEntry(stockData, price, optionType);
    let stopLoss = getStockStopLoss(stockData, entry, optionType), target1 = getStockTarget1(stockData, entry, optionType), target2 = getStockTarget2(stockData, entry, target1, optionType);
    const risk = Math.abs(entry - stopLoss);
    if (risk <= 0) return { ...stockData, symbol, price, direction:optionType, optionType, decision:"REJECT", confidence:0, reason:"Invalid stock risk: entry and stop-loss are equal.", failedGates:["stockRisk"] };
    if (optionType === "CALL") { if (stopLoss >= entry) stopLoss = entry-risk; if (target1 <= entry) target1 = entry+risk; if (target2 <= target1) target2 = target1+risk; }
    else { if (stopLoss <= entry) stopLoss = entry+risk; if (target1 >= entry) target1 = entry-risk; if (target2 >= target1) target2 = target1-risk; }
    const riskReward = calculateRiskReward(entry, stopLoss, target1, optionType), mtf = calculateMTF(optionType, stockData), confidenceData = calculateConfidence(stockData, direction, mtf, riskReward), gates = evaluateQualityGates(stockData, direction, mtf, riskReward, confidenceData.confidence), strikeInfo = getRecommendedStrike(price, optionType);
    let contract = null; try { contract = await resolveOptionContract(symbol, optionType, strikeInfo.strike, strikeInfo.interval); } catch (_) { contract = null; }
    const optionQuote = contract ? await resolveOptionQuote(contract) : null;
    const optionSetup = optionQuote ? calculateOptionTradeSetup(optionType, optionQuote.ltp, riskReward) : null;
    const decision = getDecision(direction, mtf, riskReward, confidenceData.confidence, gates, contract, optionQuote), levels = buildCombinedLevels(stockData);
    return {
        ...stockData, symbol, price, direction:optionType, finalDirection:optionType, optionType,
        callScore:direction.callScore, putScore:direction.putScore, scoreDifference:direction.directionDifference, callEvidence:direction.callEvidence, putEvidence:direction.putEvidence,
        entry:Number(entry.toFixed(2)), stopLoss:Number(stopLoss.toFixed(2)), target1:Number(target1.toFixed(2)), target2:Number(target2.toFixed(2)),
        stockEntry:Number(entry.toFixed(2)), stockStopLoss:Number(stopLoss.toFixed(2)), stockTarget1:Number(target1.toFixed(2)), stockTarget2:Number(target2.toFixed(2)), riskReward, stockRiskReward:riskReward,
        mtfScore:mtf.score, mtfAlignment:mtf.alignment, mtfAligned:mtf.isAligned, alignedTimeframes:mtf.alignedTimeframes, mtfAvailableTimeframes:mtf.availableTimeframes, mtfAvailableCount:mtf.available, mtfDiagnostic:{alignment:mtf.alignment,available:mtf.available,opposition:mtf.opposition},
        confidence:confidenceData.confidence, scannerScore:confidenceData.scannerScore, directionQuality:confidenceData.directionScore, trendScore:confidenceData.trendScore, momentumScore:confidenceData.momentumScore, volumeScore:confidenceData.volumeScore, breakoutScore:confidenceData.breakoutScore, rrScore:confidenceData.rrScore,
        recommendedStrike:strikeInfo.strike, optionStrike:contract ? contract.strike : strikeInfo.strike, strikeInterval:strikeInfo.interval, optionStrikeDifference:contract ? Math.abs(Number(contract.strike)-strikeInfo.strike) : null,
        contractAvailable:!!contract, optionSymbol:contract?.tradingSymbol || null, tradingSymbol:contract?.tradingSymbol || null, instrumentKey:contract?.instrumentKey || null, optionExpiry:contract?.expiry || null, expiry:contract?.expiry || null, optionExpiryDays:contract?.expiryDays || null, optionLotSize:contract?.lotSize || null, optionTickSize:contract?.tickSize || null,
        optionPriceAvailable:!!optionQuote, optionLTP:optionQuote?.ltp ?? null, optionQuote:optionQuote || null,
        optionSetupAvailable:!!optionSetup, optionEntry:optionSetup?.optionEntry ?? null, optionStopLoss:optionSetup?.optionStopLoss ?? null, optionTarget1:optionSetup?.optionTarget1 ?? null, optionTarget2:optionSetup?.optionTarget2 ?? null, optionRisk:optionSetup?.optionRisk ?? null, optionReward:optionSetup?.optionReward ?? null, optionRiskReward:optionSetup?.optionRiskReward ?? null,
        oiSupport1:levels.oi.oiSupport1, oiSupport2:levels.oi.oiSupport2, oiResistance1:levels.oi.oiResistance1, oiResistance2:levels.oi.oiResistance2, maxPain:levels.oi.maxPain, combinedSupportLevels:levels.supports, combinedResistanceLevels:levels.resistances,
        decision:decision.decision, rating:decision.rating, reason:decision.reason, optionsDecision:decision.decision, optionsRating:decision.rating, optionsConfidence:confidenceData.confidence, optionsReason:decision.reason,
        qualityGates:gates, failedGates:gates.failedGates, failedGateCount:gates.failedGates.length, tradeGates:gates,
        diagnostic:{direction,mtf,confidence:confidenceData,gates,contractFound:!!contract,optionQuoteFound:!!optionQuote,optionSetupFound:!!optionSetup}
    };
}

async function generateOptionDecisions(scannerResults = []) {
    if (!Array.isArray(scannerResults)) return [];
    const results = [];
    for (const stockData of scannerResults) {
        try { results.push(await makeOptionDecision(stockData)); }
        catch (error) { const symbol = firstValue(stockData?.symbol, stockData?.stock, "UNKNOWN"); results.push({ ...stockData, symbol, decision:"REJECT", optionsDecision:"REJECT", confidence:0, optionsConfidence:0, reason:error.message, optionsReason:error.message, failedGates:["ENGINE_ERROR"] }); }
    }
    return results;
}

function sortOptionDecisions(decisions) {
    if (!Array.isArray(decisions)) return [];
    const rank = { TRADE:3, WATCH:2, REJECT:1 };
    return [...decisions].sort((a,b) => (rank[text(b.decision)]||0)-(rank[text(a.decision)]||0) || toNumber(b.confidence)-toNumber(a.confidence));
}

const evaluateOptionDecision = makeOptionDecision;
const decideOptionTrade = makeOptionDecision;
const calculateOptionsDecisions = generateOptionDecisions;
const runOptionDecisionEngine = generateOptionDecisions;
const processOptionDecisions = generateOptionDecisions;

module.exports = {
    calculateOptionsDecisions, ENGINE_CONFIG, makeOptionDecision, evaluateOptionDecision, decideOptionTrade,
    generateOptionDecisions, runOptionDecisionEngine, processOptionDecisions, sortOptionDecisions,
    calculateDirection, calculateMTF, calculateTrendScore, calculateMomentumScore, calculateVolumeScore,
    calculateBreakoutScore, calculateRRScore, calculateConfidence, evaluateQualityGates,
    calculateOptionTradeSetup, getRecommendedStrike, getStrikeInterval, normalizeOptionContract,
    resolveOptionContract, resolveOptionQuote, buildCombinedLevels, getOISupportResistance, calculateRiskReward
};
