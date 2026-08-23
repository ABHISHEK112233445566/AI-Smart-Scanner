// ============================================================
// AI SMART SCANNER — OPTIONS DECISION ENGINE
// MARKET-STRUCTURE ONLY VERSION
// ============================================================
// HARD RULES
// 1. Entry = actual underlying market price / supplied market trigger.
// 2. CALL SL = real support below entry.
// 3. PUT SL = real resistance above entry.
// 4. CALL T1 = nearest real resistance above entry.
// 5. PUT T1 = nearest real support below entry.
// 6. T2 = next real market level after T1.
// 7. R:R is calculated only from those real market levels.
// 8. NO ATR-generated price levels.
// 9. NO percentage-generated price levels.
// 10. NO synthetic target/stop levels.
// 11. If market structure is missing or invalid, REJECT.
// 12. Option premium SL/T1/T2 are NOT manufactured. They remain empty
//     unless genuine option-market levels are supplied by the data source.
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
    CONFIDENCE_WEIGHTS: Object.freeze({
        scanner: 0.20,
        direction: 0.25,
        mtf: 0.15,
        trend: 0.12,
        momentum: 0.12,
        volume: 0.06,
        breakout: 0.04,
        rr: 0.06
    })
});

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, toNumber(value)));
}

function text(value) {
    return String(value ?? "").trim().toUpperCase();
}

function firstValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
}

function firstPositive(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

function round2(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function uniqueLevels(values) {
    return [...new Set((values || [])
        .map(Number)
        .filter(v => Number.isFinite(v) && v > 0)
        .map(v => round2(v)))]
        .sort((a, b) => a - b);
}

function normalizeDirection(value) {
    const s = text(value);
    if (["BULLISH", "BULL", "LONG", "CALL", "CE", "BUY", "BUY SIGNAL", "STRONG BUY", "UP"].includes(s)) return "BULLISH";
    if (["BEARISH", "BEAR", "SHORT", "PUT", "PE", "SELL", "SELL SIGNAL", "STRONG SELL", "DOWN"].includes(s)) return "BEARISH";
    return "UNKNOWN";
}

function normalizeOptionType(value) {
    const s = text(value);
    if (s === "CALL" || s === "CE" || s.includes("CALL")) return "CALL";
    if (s === "PUT" || s === "PE" || s.includes("PUT")) return "PUT";
    return "";
}

function getBroker() {
    return brokerModule && typeof brokerModule.getBroker === "function"
        ? brokerModule.getBroker()
        : brokerModule;
}

function getStockPrice(data = {}) {
    return firstPositive(
        data.price,
        data.ltp,
        data.lastPrice,
        data.last_price,
        data.close,
        data.currentPrice,
        data.current_price
    );
}

function getStockEntry(data = {}, price = 0) {
    const supplied = firstPositive(
        data.marketEntry,
        data.market_entry,
        data.triggerPrice,
        data.trigger_price,
        data.entry,
        data.stockEntry,
        data.underlyingEntry
    );
    return supplied || firstPositive(price);
}

const SUPPORT_KEYS = [
    "support", "support1", "support2", "support3",
    "s1", "s2", "s3",
    "pivotS1", "pivotS2", "pivotS3",
    "cprLow", "cprLower", "lowerCpr",
    "swingLow", "swingLow1", "swingLow2", "swing_low",
    "previousLow", "prevLow", "previousDayLow", "prevDayLow",
    "recentLow", "dayLow",
    "oiSupport1", "oiSupport2", "oi_support1", "oi_support2",
    "putOISupport", "putOiSupport", "putOISupport2", "putOiSupport2"
];

const RESISTANCE_KEYS = [
    "resistance", "resistance1", "resistance2", "resistance3",
    "r1", "r2", "r3",
    "pivotR1", "pivotR2", "pivotR3",
    "cprHigh", "cprUpper", "upperCpr",
    "swingHigh", "swingHigh1", "swingHigh2", "swing_high",
    "previousHigh", "prevHigh", "previousDayHigh", "prevDayHigh",
    "recentHigh", "dayHigh",
    "oiResistance1", "oiResistance2", "oi_resistance1", "oi_resistance2",
    "callOIResistance", "callOiResistance", "callOIResistance2", "callOiResistance2"
];

function collectValues(data, keys) {
    const result = [];
    if (!data || typeof data !== "object") return result;

    for (const key of keys) {
        const value = data[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item && typeof item === "object") {
                    result.push(item.value, item.level, item.price, item.close);
                } else {
                    result.push(item);
                }
            }
        } else if (value && typeof value === "object") {
            result.push(...Object.values(value));
        } else {
            result.push(value);
        }
    }
    return result;
}

function collectMarketLevels(data = {}, side) {
    const keys = side === "support" ? SUPPORT_KEYS : RESISTANCE_KEYS;
    const result = [];
    result.push(...collectValues(data, keys));

    const sr = data.supportResistance || data.support_resistance || data.sr || {};
    result.push(...collectValues(sr, keys));

    const pivot = data.pivot || data.pivots || {};
    result.push(...collectValues(pivot, side === "support"
        ? ["s1", "s2", "s3", "S1", "S2", "S3", "support1", "support2", "support3"]
        : ["r1", "r2", "r3", "R1", "R2", "R3", "resistance1", "resistance2", "resistance3"]));

    const explicit = data[side === "support" ? "supportLevels" : "resistanceLevels"];
    if (Array.isArray(explicit)) result.push(...explicit);

    return uniqueLevels(result);
}

function getRealSupportLevels(data, entry) {
    return collectMarketLevels(data, "support")
        .filter(level => level > 0 && level < entry)
        .sort((a, b) => b - a);
}

function getRealResistanceLevels(data, entry) {
    return collectMarketLevels(data, "resistance")
        .filter(level => level > entry)
        .sort((a, b) => a - b);
}

function calculateMarketSetup(data, entry, type) {
    const supports = getRealSupportLevels(data, entry);
    const resistances = getRealResistanceLevels(data, entry);

    let stopLoss = 0;
    let target1 = 0;
    let target2 = 0;
    let stopSource = "MARKET_STRUCTURE_REQUIRED";
    let target1Source = "MARKET_STRUCTURE_REQUIRED";
    let target2Source = "MARKET_STRUCTURE_REQUIRED";

    if (type === "CALL") {
        stopLoss = supports[0] || 0;
        target1 = resistances[0] || 0;
        target2 = resistances.find(level => level > target1) || 0;
        if (stopLoss) stopSource = "MARKET_SUPPORT";
        if (target1) target1Source = "MARKET_RESISTANCE";
        if (target2) target2Source = "NEXT_MARKET_RESISTANCE";
    } else if (type === "PUT") {
        stopLoss = resistances[0] || 0;
        target1 = supports[0] || 0;
        target2 = supports.find(level => level < target1) || 0;
        if (stopLoss) stopSource = "MARKET_RESISTANCE";
        if (target1) target1Source = "MARKET_SUPPORT";
        if (target2) target2Source = "NEXT_MARKET_SUPPORT";
    }

    const validGeometry = type === "CALL"
        ? stopLoss < entry && target1 > entry && target2 > target1
        : type === "PUT"
            ? stopLoss > entry && target1 < entry && target2 < target1
            : false;

    const risk = type === "CALL" ? entry - stopLoss : stopLoss - entry;
    const reward = type === "CALL" ? target1 - entry : entry - target1;
    const riskReward = risk > 0 && reward > 0 ? round2(reward / risk) : 0;

    let reason = "VALID_MARKET_STRUCTURE";
    if (!stopLoss || !target1 || !target2) reason = "MISSING_MARKET_STRUCTURE_LEVEL";
    else if (!validGeometry) reason = type === "CALL" ? "INVALID_CALL_MARKET_GEOMETRY" : "INVALID_PUT_MARKET_GEOMETRY";
    else if (!(risk > 0 && reward > 0)) reason = "INVALID_MARKET_RR";

    return {
        valid: validGeometry && riskReward > 0,
        entry: round2(entry),
        stopLoss: round2(stopLoss),
        target1: round2(target1),
        target2: round2(target2),
        risk: round2(risk),
        reward: round2(reward),
        riskReward,
        rr: riskReward,
        stopSource,
        target1Source,
        target2Source,
        levelsSource: "MARKET_STRUCTURE_ONLY",
        supportLevels: supports,
        resistanceLevels: resistances,
        reason
    };
}

function calculateDirection(data = {}, price = 0) {
    const frames = [["dailyTrend", 12], ["fourHourTrend", 8], ["oneHourTrend", 14], ["fifteenMinTrend", 10]];
    let call = 0;
    let put = 0;
    let callEvidence = 0;
    let putEvidence = 0;

    for (const [key, weight] of frames) {
        const direction = normalizeDirection(data[key]);
        if (direction === "BULLISH") { call += weight; callEvidence++; }
        if (direction === "BEARISH") { put += weight; putEvidence++; }
    }

    const ema5 = toNumber(data.ema5);
    const ema9 = toNumber(data.ema9);
    const ema20 = toNumber(data.ema20);
    const ema50 = toNumber(data.ema50);

    if (ema5 && ema9 && ema20 && ema50) {
        if (ema5 > ema9 && ema9 > ema20 && ema20 > ema50) { call += 12; callEvidence++; }
        if (ema5 < ema9 && ema9 < ema20 && ema20 < ema50) { put += 12; putEvidence++; }
    }

    if (ema20 && ema50 && price) {
        if (price > ema20 && price > ema50) { call += 7; callEvidence++; }
        if (price < ema20 && price < ema50) { put += 7; putEvidence++; }
    }

    const rsi = toNumber(data.rsi);
    if (rsi >= 55 && rsi <= 70) { call += 8; callEvidence++; }
    if (rsi >= 30 && rsi <= 45) { put += 8; putEvidence++; }

    const macd = toNumber(data.macdValue ?? data.macd);
    const macdSignal = toNumber(data.macdSignal);
    const histogram = toNumber(data.histogram ?? data.macdHistogram);
    if (Number.isFinite(macd) && Number.isFinite(macdSignal)) {
        if (macd > macdSignal && histogram >= 0) { call += 8; callEvidence++; }
        if (macd < macdSignal && histogram <= 0) { put += 8; putEvidence++; }
    }

    const adx = toNumber(data.adx);
    const pdi = toNumber(data.pdi);
    const mdi = toNumber(data.mdi);
    if (adx >= 20) {
        if (pdi > mdi) { call += 7; callEvidence++; }
        if (mdi > pdi) { put += 7; putEvidence++; }
    }

    const vwap = toNumber(data.vwap);
    if (vwap && price > vwap) { call += 5; callEvidence++; }
    if (vwap && price < vwap) { put += 5; putEvidence++; }

    const supertrend = normalizeDirection(data.supertrend);
    if (supertrend === "BULLISH") { call += 5; callEvidence++; }
    if (supertrend === "BEARISH") { put += 5; putEvidence++; }

    const signal = normalizeDirection(data.signal);
    if (signal === "BULLISH") { call += 5; callEvidence++; }
    if (signal === "BEARISH") { put += 5; putEvidence++; }

    const trend = normalizeDirection(data.trend);
    if (trend === "BULLISH") { call += 3; callEvidence++; }
    if (trend === "BEARISH") { put += 3; putEvidence++; }

    const difference = Math.abs(call - put);
    let optionType = null;
    if (call > put && call >= ENGINE_CONFIG.MIN_DIRECTION_SCORE && difference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE && callEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE) optionType = "CALL";
    if (put > call && put >= ENGINE_CONFIG.MIN_DIRECTION_SCORE && difference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE && putEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE) optionType = "PUT";

    return { optionType, callScore: call, putScore: put, directionDifference: difference, callEvidence, putEvidence, dominantScore: Math.max(call, put), dominantEvidence: call > put ? callEvidence : putEvidence };
}

function calculateMTF(type, data = {}) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    const values = [["DAILY", data.dailyTrend], ["4H", data.fourHourTrend], ["1H", data.oneHourTrend], ["15M", data.fifteenMinTrend]].map(([name, value]) => ({ name, value: normalizeDirection(value) }));
    const available = values.filter(v => v.value !== "UNKNOWN");
    const aligned = available.filter(v => v.value === expected);
    const opposition = available.filter(v => v.value !== expected);
    const score = available.length ? clamp(50 + ((aligned.length - opposition.length) / available.length) * 50) : 0;
    return { score, alignment: aligned.length, opposition: opposition.length, available: available.length, required: 3, alignedTimeframes: aligned.map(v => v.name), availableTimeframes: available.map(v => v.name), isAligned: aligned.length >= 3, fullAlignment: available.length === 4 && aligned.length === 4 };
}

function calculateTrendScore(data = {}, type) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    let score = 50;
    const ema5 = toNumber(data.ema5); const ema9 = toNumber(data.ema9); const ema20 = toNumber(data.ema20); const ema50 = toNumber(data.ema50);
    if (ema5 && ema9 && ema20 && ema50) {
        const bullish = ema5 > ema9 && ema9 > ema20 && ema20 > ema50;
        const bearish = ema5 < ema9 && ema9 < ema20 && ema20 < ema50;
        if ((expected === "BULLISH" && bullish) || (expected === "BEARISH" && bearish)) score += 35;
        if ((expected === "BULLISH" && bearish) || (expected === "BEARISH" && bullish)) score -= 35;
    }
    const trend = normalizeDirection(data.trend);
    if (trend === expected) score += 15; else if (trend !== "UNKNOWN") score -= 15;
    return clamp(score);
}

function calculateMomentumScore(data = {}, type) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    let score = 50;
    const rsi = toNumber(data.rsi); const macd = toNumber(data.macdValue ?? data.macd); const signal = toNumber(data.macdSignal); const histogram = toNumber(data.histogram ?? data.macdHistogram);
    if (rsi) {
        if ((expected === "BULLISH" && rsi >= 55 && rsi <= 70) || (expected === "BEARISH" && rsi >= 30 && rsi <= 45)) score += 20;
        else if ((expected === "BULLISH" && rsi < 50) || (expected === "BEARISH" && rsi > 50)) score -= 20;
    }
    if (Number.isFinite(macd) && Number.isFinite(signal)) {
        const bullish = macd > signal && histogram >= 0; const bearish = macd < signal && histogram <= 0;
        if ((expected === "BULLISH" && bullish) || (expected === "BEARISH" && bearish)) score += 30;
        else if ((expected === "BULLISH" && bearish) || (expected === "BEARISH" && bullish)) score -= 30;
    }
    return clamp(score);
}

function calculateVolumeScore(data = {}) {
    const rvol = toNumber(data.rvol);
    if (rvol <= 0) return 50;
    if (rvol >= 2) return 100;
    if (rvol >= 1.5) return 85;
    if (rvol >= 1.2) return 70;
    if (rvol >= 1) return 55;
    return 35;
}

function calculateBreakoutScore(data = {}, type) {
    const breakout = text(data.breakout); const breakoutType = text(data.breakoutType); const expected = type === "CALL" ? "BULL" : "BEAR";
    if (breakout.includes(expected) || breakoutType.includes(expected)) return 100;
    if (breakout.includes("BREAK") || breakoutType.includes("BREAK")) return 65;
    return 50;
}

function calculateRRScore(rr) {
    const value = Number(rr);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 2.5) return 100; if (value >= 2) return 90; if (value >= 1.5) return 80; if (value >= 1.2) return 65; if (value >= 1) return 50; return 25;
}

function calculateScannerScore(data = {}, direction = {}) {
    const raw = firstPositive(data.aiFinalScore, data.finalScore, data.score, data.scannerScore, data.rankingScore);
    if (raw <= 0 || !direction.optionType) return 0;
    const directionScore = direction.optionType === "CALL" ? direction.callScore : direction.putScore;
    return clamp(clamp(raw) * 0.70 + clamp(directionScore) * 0.30);
}

function calculateConfidence(data, direction, mtf, rr) {
    if (!direction.optionType) return { confidence: 0, scannerScore: 0, directionScore: 0, mtfScore: 0, trendScore: 0, momentumScore: 0, volumeScore: 0, breakoutScore: 0, rrScore: 0 };
    const scannerScore = calculateScannerScore(data, direction);
    const directionScore = direction.optionType === "CALL" ? direction.callScore : direction.putScore;
    const trendScore = calculateTrendScore(data, direction.optionType);
    const momentumScore = calculateMomentumScore(data, direction.optionType);
    const volumeScore = calculateVolumeScore(data);
    const breakoutScore = calculateBreakoutScore(data, direction.optionType);
    const rrScore = calculateRRScore(rr);
    const w = ENGINE_CONFIG.CONFIDENCE_WEIGHTS;
    let confidence = scannerScore * w.scanner + clamp(directionScore) * w.direction + mtf.score * w.mtf + trendScore * w.trend + momentumScore * w.momentum + volumeScore * w.volume + breakoutScore * w.breakout + rrScore * w.rr;
    if (direction.dominantEvidence < 3) confidence -= 15;
    if (direction.directionDifference < 10) confidence -= 15;
    if (mtf.available === 0) confidence -= 20;
    if (mtf.alignment < 2) confidence -= 8;
    if (rr < 1.2) confidence -= 10;
    return { confidence: Math.round(clamp(confidence)), scannerScore: Math.round(scannerScore), directionScore: Math.round(clamp(directionScore)), mtfScore: Math.round(mtf.score), trendScore: Math.round(trendScore), momentumScore: Math.round(momentumScore), volumeScore: Math.round(volumeScore), breakoutScore: Math.round(breakoutScore), rrScore: Math.round(rrScore) };
}

function evaluateQualityGates(data, direction, mtf, rr, confidence) {
    const scannerScore = calculateScannerScore(data, direction);
    const gates = { direction: !!direction.optionType, directionEvidence: direction.dominantEvidence >= 3, directionDifference: direction.directionDifference >= 10, mtf: mtf.alignment >= 2, tradeMTF: mtf.alignment >= 3, riskReward: rr >= 1.2, tradeRiskReward: rr >= 1.5, confidence: confidence >= 65, tradeConfidence: confidence >= 82, scanner: scannerScore >= 55, tradeScanner: scannerScore >= 70 };
    const failedGates = Object.entries(gates).filter(([, ok]) => !ok).map(([key]) => key);
    return { ...gates, passedCount: Object.values(gates).filter(Boolean).length, totalCount: Object.keys(gates).length, failedGates, allPassed: failedGates.length === 0 };
}

// ============================================================
// OPTION CONTRACTS
// ============================================================

function getStrikeInterval(price) {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return 50;
    if (p < 500) return 10;
    if (p < 1000) return 20;
    if (p < 2000) return 50;
    return 100;
}

function getRecommendedStrike(price, type) {
    const interval = getStrikeInterval(price);
    let strike = Math.round(Number(price) / interval) * interval;
    if (type === "CALL") strike -= interval;
    if (type === "PUT") strike += interval;
    return { strike: Math.max(interval, strike), interval };
}

// Normalize both the broker-neutral contract shape and the native
// Upstox /v2/option/contract response shape. The latter uses:
//   instrument_key, trading_symbol, strike_price, expiry, instrument_type
// while the decision engine works with:
//   instrumentKey, tradingSymbol, strike, expiry, optionType
function normalizeOptionContract(contract, fallbackStrike = 0) {
    if (!contract || typeof contract !== "object") return null;

    const instrumentKey = firstValue(
        contract.instrumentKey,
        contract.instrument_key,
        contract.instrument_token,
        contract.instrumentToken,
        contract.exchange_token,
        contract.exchangeToken,
        contract.token
    );

    const tradingSymbol = firstValue(
        contract.tradingSymbol,
        contract.trading_symbol,
        contract.symbol,
        contract.name
    );

    const strike = toNumber(firstValue(
        contract.strike,
        contract.strikePrice,
        contract.strike_price,
        contract.strike_price_value,
        fallbackStrike
    ));

    const expiry = firstValue(
        contract.expiry,
        contract.expiryDate,
        contract.expiry_date,
        contract.expiry_date_time
    );

    const expiryDays = toNumber(firstValue(
        contract.expiryDays,
        contract.expiry_days,
        contract.daysToExpiry
    ));

    let optionType = normalizeOptionType(firstValue(
        contract.optionType,
        contract.option_type,
        contract.instrumentType,
        contract.instrument_type,
        contract.option,
        ""
    ));

    if (!optionType && tradingSymbol) optionType = normalizeOptionType(tradingSymbol);

    if ((!instrumentKey && !tradingSymbol) || strike <= 0) return null;

    return {
        ...contract,
        instrumentKey,
        tradingSymbol,
        strike,
        expiry,
        expiryDays,
        optionType,
        lotSize: firstValue(contract.lotSize, contract.lot_size, contract.lotsize),
        tickSize: firstValue(contract.tickSize, contract.tick_size)
    };
}

function expiryDaysFromContract(contract) {
    if (!contract) return -Infinity;
    const explicit = Number(contract.expiryDays);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (!contract.expiry) return -Infinity;
    const date = new Date(String(contract.expiry));
    if (Number.isNaN(date.getTime())) return -Infinity;
    return (date.getTime() - Date.now()) / 86400000;
}

function validContract(contract, type) {
    return !!contract && normalizeOptionType(contract.optionType || contract.tradingSymbol) === type && expiryDaysFromContract(contract) >= ENGINE_CONFIG.MIN_EXPIRY_DAYS - 0.01 && Number(contract.strike) > 0;
}

async function resolveOptionContract(symbol, type, strike, interval) {
    const broker = getBroker();
    if (!broker) return null;

    if (typeof broker.getOptionContracts === "function") {
        try {
            const raw = await broker.getOptionContracts(symbol);
            if (Array.isArray(raw)) {
                const valid = raw.map(c => normalizeOptionContract(c)).filter(c => validContract(c, type));
                if (valid.length) {
                    valid.sort((a, b) => {
                        const expiryDiff = expiryDaysFromContract(a) - expiryDaysFromContract(b);
                        if (Math.abs(expiryDiff) > 0.25) return expiryDiff;
                        return Math.abs(a.strike - strike) - Math.abs(b.strike - strike);
                    });
                    const expiry = expiryDaysFromContract(valid[0]);
                    return valid.filter(c => Math.abs(expiryDaysFromContract(c) - expiry) <= 0.25)
                        .sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike))[0] || null;
                }
            }
        } catch (error) {
            console.log(`⚠️ Direct option search failed: ${symbol} | ${error.message}`);
        }
    }

    if (typeof broker.getOptionContract === "function") {
        const step = Number(interval) > 0 ? Number(interval) : getStrikeInterval(strike);
        const candidates = [...new Set([strike, strike - step, strike + step, strike - step * 2, strike + step * 2].filter(v => v > 0))];
        for (const candidate of candidates) {
            try {
                const contract = normalizeOptionContract(await broker.getOptionContract(symbol, type, candidate, ENGINE_CONFIG.MIN_EXPIRY_DAYS), candidate);
                if (validContract(contract, type)) return contract;
            } catch (_) {}
        }
    }
    return null;
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

    for (const method of ["getOptionQuote", "getQuote"]) {
        if (typeof broker[method] !== "function") continue;
        try {
            const quote = await broker[method](key);
            const ltp = normalizeQuoteLTP(quote);
            if (ltp > 0) return { ...(quote && typeof quote === "object" ? quote : {}), ltp };
        } catch (error) {
            console.log(`⚠️ Option quote failed: ${key} | ${error.message}`);
        }
    }
    return null;
}

function getDecision(direction, mtf, rr, confidence, gates, contract, quote, marketSetup) {
    if (!direction.optionType) return { decision: "REJECT", rating: "NO DIRECTION", reason: "Directional evidence is insufficient." };
    if (!marketSetup.valid) return { decision: "REJECT", rating: marketSetup.reason, reason: "Stock setup rejected because genuine market levels do not form valid risk/reward geometry." };
    if (!contract) return { decision: "REJECT", rating: "NO CONTRACT", reason: "No valid option contract with required side and expiry." };
    if (!quote) return { decision: "REJECT", rating: "NO LTP", reason: "Real option contract found but live option LTP is unavailable." };
    if (rr < ENGINE_CONFIG.WATCH_RR) return { decision: "REJECT", rating: "LOW_RR", reason: "Underlying market-structure risk/reward is below minimum." };
    if (confidence >= ENGINE_CONFIG.TRADE_CONFIDENCE && gates.tradeMTF && gates.tradeRiskReward && gates.tradeConfidence && gates.tradeScanner && gates.directionEvidence && gates.directionDifference) return { decision: "TRADE", rating: "A", reason: "Market structure, direction, MTF, risk/reward, confidence and live option data are aligned." };
    if (confidence >= ENGINE_CONFIG.WATCH_CONFIDENCE && gates.mtf && gates.riskReward) return { decision: "WATCH", rating: "B", reason: "Valid market-structure setup but not all TRADE gates are met." };
    return { decision: "REJECT", rating: "C", reason: "Setup does not satisfy minimum quality gates." };
}

async function makeOptionDecision(data = {}) {
    const symbol = firstValue(data.symbol, data.stock, data.name);
    const price = getStockPrice(data);

    if (!symbol || price <= 0) return { ...data, symbol, direction: null, optionType: null, decision: "REJECT", optionsDecision: "REJECT", confidence: 0, optionsConfidence: 0, reason: "INVALID_STOCK_DATA", optionsReason: "INVALID_STOCK_DATA", failedGates: ["symbol", "price"] };

    const direction = calculateDirection(data, price);

    if (!direction.optionType) {
        return { ...data, symbol, price, direction: "NO DIRECTION", finalDirection: null, optionType: null, callScore: direction.callScore, putScore: direction.putScore, scoreDifference: direction.directionDifference, callEvidence: direction.callEvidence, putEvidence: direction.putEvidence, entry: 0, stopLoss: 0, target1: 0, target2: 0, stockEntry: 0, stockStopLoss: 0, stockTarget1: 0, stockTarget2: 0, riskReward: 0, stockRiskReward: 0, confidence: 0, optionsConfidence: 0, decision: "REJECT", optionsDecision: "REJECT", rating: "NO DIRECTION", optionsRating: "NO DIRECTION", reason: "Directional evidence is insufficient.", optionsReason: "Directional evidence is insufficient.", contractAvailable: false, optionPriceAvailable: false, optionSetupAvailable: false, levelsSource: "MARKET_STRUCTURE_ONLY", failedGates: ["direction"] };
    }

    const type = direction.optionType;
    const entry = getStockEntry(data, price);
    const marketSetup = calculateMarketSetup(data, entry, type);
    const mtf = calculateMTF(type, data);
    const confidence = calculateConfidence(data, direction, mtf, marketSetup.riskReward);
    const gates = evaluateQualityGates(data, direction, mtf, marketSetup.riskReward, confidence.confidence);
    const strike = getRecommendedStrike(price, type);

    let contract = null;
    try { contract = await resolveOptionContract(symbol, type, strike.strike, strike.interval); } catch (_) {}
    const quote = contract ? await resolveOptionQuote(contract) : null;

    const decision = getDecision(direction, mtf, marketSetup.riskReward, confidence.confidence, gates, contract, quote, marketSetup);

    const optionEntry = quote?.ltp ?? null;
    const optionStopLoss = firstPositive(data.optionStopLoss, data.optionSL, data.optionMarketStopLoss);
    const optionTarget1 = firstPositive(data.optionTarget1, data.optionT1, data.optionMarketTarget1);
    const optionTarget2 = firstPositive(data.optionTarget2, data.optionT2, data.optionMarketTarget2);
    const optionSetupAvailable = optionEntry > 0 && optionStopLoss > 0 && optionTarget1 > 0 && optionTarget2 > 0;

    return { ...data, symbol, price, direction: type, finalDirection: type, optionType: type, callScore: direction.callScore, putScore: direction.putScore, scoreDifference: direction.directionDifference, callEvidence: direction.callEvidence, putEvidence: direction.putEvidence, entry: marketSetup.entry, stopLoss: marketSetup.stopLoss, target1: marketSetup.target1, target2: marketSetup.target2, stockEntry: marketSetup.entry, stockStopLoss: marketSetup.stopLoss, stockTarget1: marketSetup.target1, stockTarget2: marketSetup.target2, riskReward: marketSetup.riskReward, stockRiskReward: marketSetup.riskReward, risk: marketSetup.risk, reward: marketSetup.reward, stopSource: marketSetup.stopSource, target1Source: marketSetup.target1Source, target2Source: marketSetup.target2Source, levelsSource: marketSetup.levelsSource, supportLevels: marketSetup.supportLevels, resistanceLevels: marketSetup.resistanceLevels, mtfScore: mtf.score, mtfAlignment: mtf.alignment, mtfAligned: mtf.isAligned, alignedTimeframes: mtf.alignedTimeframes, mtfAvailableTimeframes: mtf.availableTimeframes, mtfAvailableCount: mtf.available, confidence: confidence.confidence, optionsConfidence: confidence.confidence, scannerScore: confidence.scannerScore, directionQuality: confidence.directionScore, directionScore: confidence.directionScore, trendScore: confidence.trendScore, momentumScore: confidence.momentumScore, volumeScore: confidence.volumeScore, breakoutScore: confidence.breakoutScore, rrScore: confidence.rrScore, recommendedStrike: strike.strike, optionStrike: contract?.strike ?? strike.strike, strikeInterval: strike.interval, optionStrikeDifference: contract ? Math.abs(Number(contract.strike) - strike.strike) : null, contractAvailable: !!contract, optionPriceAvailable: !!quote, optionSetupAvailable, optionSymbol: contract?.tradingSymbol || null, optionExpiry: contract?.expiry || null, optionExpiryDays: contract ? expiryDaysFromContract(contract) : null, optionInstrumentKey: contract?.instrumentKey || null, optionEntry, optionLTP: optionEntry, optionStopLoss: optionStopLoss || null, optionTarget1: optionTarget1 || null, optionTarget2: optionTarget2 || null, decision: decision.decision, optionsDecision: decision.decision, rating: decision.rating, optionsRating: decision.rating, reason: decision.reason, optionsReason: decision.reason, tradeGates: gates, failedGates: gates.failedGates, failedGateCount: gates.failedGates.length, marketSetupValid: marketSetup.valid, marketSetupReason: marketSetup.reason, contractDetails: contract ? { instrumentKey: contract.instrumentKey, tradingSymbol: contract.tradingSymbol, strike: contract.strike, optionType: contract.optionType, expiry: contract.expiry, expiryDays: expiryDaysFromContract(contract), lotSize: contract.lotSize, tickSize: contract.tickSize } : null };
}

async function evaluateOptions(data = {}) { return makeOptionDecision(data); }

async function processOptions(data = {}) { return makeOptionDecision(data); }

async function analyzeOptions(data = {}) { return makeOptionDecision(data); }

module.exports = { makeOptionDecision, evaluateOptions, processOptions, analyzeOptions, resolveOptionContract, resolveOptionQuote, calculateDirection, calculateMTF, calculateMarketSetup, getRecommendedStrike, normalizeOptionContract, ENGINE_CONFIG };
