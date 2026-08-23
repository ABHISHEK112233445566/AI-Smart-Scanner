// ============================================================
// OPTIONS DECISION ENGINE — V14 MARKET-STRUCTURE RISK ENGINE
// ============================================================
// IMPORTANT:
// - All Entry / SL / T1 / T2 / R:R values are calculated in Node.js.
// - Google Sheets receives values only; this file creates no formulas.
// - Market levels are preferred over arbitrary levels.
// - ATR is used only as a Node-side safety fallback when genuine levels
//   are unavailable or too close to the entry.
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
    MIN_STOP_ATR_MULTIPLIER: 0.75,
    MIN_STOP_PERCENT: 0.004,
    MIN_TARGET_RR: 1.5,
    MIN_TARGET_ATR_MULTIPLIER: 1.0,
    MAX_STOP_ATR_MULTIPLIER: 2.5,
    OPTION_STOP_PERCENT: 0.20,
    OPTION_TARGET1_RISK_MULTIPLIER: 1,
    OPTION_TARGET2_RISK_MULTIPLIER: 2,
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

function toNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, toNumber(v)));
}

function text(v) {
    return String(v ?? "").trim().toUpperCase();
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

function uniqueSortedLevels(values) {
    return [...new Set(
        (values || [])
            .map(Number)
            .filter(v => Number.isFinite(v) && v > 0)
            .map(v => Number(v.toFixed(2)))
    )].sort((a, b) => a - b);
}

function normalizeDirection(v) {
    const s = text(v);
    if (["BULLISH", "BULL", "LONG", "CALL", "CE", "BUY", "BUY SIGNAL", "STRONG BUY", "UP"].includes(s)) return "BULLISH";
    if (["BEARISH", "BEAR", "SHORT", "PUT", "PE", "SELL", "SELL SIGNAL", "STRONG SELL", "DOWN"].includes(s)) return "BEARISH";
    return "UNKNOWN";
}

function normalizeOptionType(v) {
    const s = text(v);
    if (s === "CALL" || s === "CE" || s.includes("CALL")) return "CALL";
    if (s === "PUT" || s === "PE" || s.includes("PUT")) return "PUT";
    return "";
}

function getBroker() {
    return brokerModule && typeof brokerModule.getBroker === "function"
        ? brokerModule.getBroker()
        : brokerModule;
}

// ============================================================
// OPTION CONTRACT HELPERS
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

    const raw = String(contract.expiry).trim();
    let date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
        const m = raw.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})$/);
        if (m) date = new Date(`${m[1]} ${m[2]} ${m[3]} 23:59:59`);
    }

    if (Number.isNaN(date.getTime())) {
        const m = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (m) date = new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59`);
    }

    if (Number.isNaN(date.getTime())) return -Infinity;
    return (date.getTime() - Date.now()) / 86400000;
}

function contractMatches(contract, type) {
    const expected = normalizeOptionType(type);
    const actual = normalizeOptionType(firstValue(
        contract?.optionType,
        contract?.option_type,
        contract?.instrumentType,
        contract?.option,
        contract?.tradingSymbol,
        contract?.trading_symbol
    ));
    return !!expected && !!actual && expected === actual;
}

function validContract(contract, type) {
    return !!contract &&
        contractMatches(contract, type) &&
        expiryDaysFromContract(contract) >= ENGINE_CONFIG.MIN_EXPIRY_DAYS - 0.01 &&
        Number(contract.strike) > 0;
}

async function searchContractsDirectly(symbol, type, requestedStrike) {
    const broker = getBroker();
    if (!broker || typeof broker.getOptionContracts !== "function") return null;

    try {
        const raw = await broker.getOptionContracts(symbol);
        if (!Array.isArray(raw)) return null;

        const valid = raw
            .map(contract => normalizeOptionContract(contract))
            .filter(contract => validContract(contract, type));

        if (!valid.length) return null;

        valid.sort((a, b) => {
            const expiryDifference = expiryDaysFromContract(a) - expiryDaysFromContract(b);
            if (Math.abs(expiryDifference) > 0.25) return expiryDifference;
            return Math.abs(a.strike - requestedStrike) - Math.abs(b.strike - requestedStrike);
        });

        const expiry = expiryDaysFromContract(valid[0]);
        return valid
            .filter(contract => Math.abs(expiryDaysFromContract(contract) - expiry) <= 0.25)
            .sort((a, b) => Math.abs(a.strike - requestedStrike) - Math.abs(b.strike - requestedStrike))[0] || null;
    } catch (error) {
        console.log(`⚠️ Direct option search failed: ${symbol} | ${error.message}`);
        return null;
    }
}

async function tryOptionContract(symbol, type, strike) {
    const broker = getBroker();
    if (!broker || typeof broker.getOptionContract !== "function") return null;

    try {
        const contract = normalizeOptionContract(
            await broker.getOptionContract(
                symbol,
                type,
                Number(strike),
                ENGINE_CONFIG.MIN_EXPIRY_DAYS
            ),
            strike
        );
        return validContract(contract, type) ? contract : null;
    } catch (_) {
        return null;
    }
}

async function resolveOptionContract(symbol, type, strike, interval) {
    if (!symbol || !type || !Number.isFinite(Number(strike))) return null;

    const direct = await searchContractsDirectly(symbol, type, Number(strike));
    if (direct) return direct;

    const step = Number(interval) > 0 ? Number(interval) : getStrikeInterval(strike);
    const strikes = [...new Set([
        strike,
        strike - step,
        strike + step,
        strike - step * 2,
        strike + step * 2
    ].filter(v => v > 0))];

    for (const candidateStrike of strikes) {
        const contract = await tryOptionContract(symbol, type, candidateStrike);
        if (contract) return contract;
    }

    return null;
}

function normalizeQuoteLTP(quote) {
    if (typeof quote === "number") return quote > 0 ? quote : 0;
    if (!quote || typeof quote !== "object") return 0;
    return firstPositive(
        quote.ltp,
        quote.lastPrice,
        quote.last_price,
        quote.last_traded_price,
        quote.close,
        quote.lp
    );
}

async function resolveOptionQuote(contract) {
    if (!contract) return null;
    const broker = getBroker();
    if (!broker) return null;

    const key = firstValue(
        contract.instrumentKey,
        contract.instrument_key,
        contract.instrument_token,
        contract.tradingSymbol,
        contract.trading_symbol
    );

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

// ============================================================
// MARKET STRUCTURE
// ============================================================

const MARKET_LEVEL_KEYS = Object.freeze({
    support: [
        "support", "support1", "support2", "support3",
        "s1", "s2", "s3",
        "pivotS1", "pivotS2", "pivotS3",
        "cprLow", "cprLower", "lowerCpr",
        "swingLow", "swing_low",
        "previousLow", "prevLow", "previousDayLow", "prevDayLow",
        "recentLow", "dayLow", "low"
    ],
    resistance: [
        "resistance", "resistance1", "resistance2", "resistance3",
        "r1", "r2", "r3",
        "pivotR1", "pivotR2", "pivotR3",
        "cprHigh", "cprUpper", "upperCpr",
        "swingHigh", "swing_high",
        "previousHigh", "prevHigh", "previousDayHigh", "prevDayHigh",
        "recentHigh", "dayHigh", "high"
    ]
});

function collectMarketLevels(data, side) {
    const values = [];

    for (const key of MARKET_LEVEL_KEYS[side] || []) {
        const value = data?.[key];
        if (Array.isArray(value)) values.push(...value);
        else if (value && typeof value === "object") values.push(...Object.values(value).flat(Infinity));
        else values.push(value);
    }

    const extra = data?.[side === "support" ? "supportLevels" : "resistanceLevels"];
    if (Array.isArray(extra)) values.push(...extra.flat(Infinity));

    return uniqueSortedLevels(values);
}

function getStockPrice(data) {
    return firstPositive(
        data.price,
        data.ltp,
        data.lastPrice,
        data.close,
        data.currentPrice,
        data.current_price
    );
}

function getStockEntry(data, price) {
    // The underlying stock entry is the current validated market price.
    // Existing entry values are accepted only when they are close to price;
    // this prevents stale/derived entries from creating fake R:R.
    const p = Number(price);
    const supplied = firstPositive(data.entry, data.stockEntry, data.underlyingEntry);
    if (!p) return supplied;
    if (!supplied) return p;
    const deviation = Math.abs(supplied - p) / p;
    return deviation <= 0.015 ? supplied : p;
}

function getATR(data) {
    return firstPositive(
        data.atr,
        data.ATR,
        data.averageTrueRange,
        data.average_true_range
    );
}

function getMinimumStopDistance(data, entry) {
    const atr = getATR(data);
    return Math.max(
        atr * ENGINE_CONFIG.MIN_STOP_ATR_MULTIPLIER,
        entry * ENGINE_CONFIG.MIN_STOP_PERCENT
    );
}

function getMaximumStopDistance(data, entry) {
    const atr = getATR(data);
    const base = Math.max(
        atr * ENGINE_CONFIG.MAX_STOP_ATR_MULTIPLIER,
        entry * 0.012
    );
    return base > 0 ? base : entry * 0.012;
}

function nearestValidSupport(data, entry) {
    const minimum = getMinimumStopDistance(data, entry);
    const maximum = getMaximumStopDistance(data, entry);

    const levels = collectMarketLevels(data, "support")
        .filter(level => level < entry && entry - level >= minimum);

    if (!levels.length) return 0;

    const withinRisk = levels
        .filter(level => entry - level <= maximum)
        .sort((a, b) => b - a);

    return withinRisk[0] || levels.sort((a, b) => b - a)[0] || 0;
}

function nearestValidResistance(data, entry) {
    const minimum = getMinimumStopDistance(data, entry);
    const maximum = getMaximumStopDistance(data, entry);

    const levels = collectMarketLevels(data, "resistance")
        .filter(level => level > entry && level - entry >= minimum);

    if (!levels.length) return 0;

    const withinRisk = levels
        .filter(level => level - entry <= maximum)
        .sort((a, b) => a - b);

    return withinRisk[0] || levels.sort((a, b) => a - b)[0] || 0;
}

function getStockStopLoss(data, entry, type) {
    const minimum = getMinimumStopDistance(data, entry);
    const atr = getATR(data);

    if (type === "CALL") {
        const level = nearestValidSupport(data, entry);
        if (level > 0 && entry - level >= minimum) return Number(level.toFixed(2));
        const fallbackDistance = Math.max(atr || 0, entry * 0.006);
        return Number((entry - fallbackDistance).toFixed(2));
    }

    if (type === "PUT") {
        const level = nearestValidResistance(data, entry);
        if (level > 0 && level - entry >= minimum) return Number(level.toFixed(2));
        const fallbackDistance = Math.max(atr || 0, entry * 0.006);
        return Number((entry + fallbackDistance).toFixed(2));
    }

    return 0;
}

function getRequiredTargetDistance(data, entry, stop) {
    const risk = Math.abs(entry - stop);
    const atr = getATR(data);
    return Math.max(
        risk * ENGINE_CONFIG.MIN_TARGET_RR,
        atr * ENGINE_CONFIG.MIN_TARGET_ATR_MULTIPLIER,
        entry * 0.006
    );
}

function getStockTarget1(data, entry, stop, type) {
    if (!(entry > 0 && stop > 0)) return 0;

    const required = getRequiredTargetDistance(data, entry, stop);
    const resistance = type === "CALL" ? "resistance" : "support";
    const levels = collectMarketLevels(data, resistance);

    if (type === "CALL") {
        const candidates = levels.filter(level => level > entry && level - entry >= required);
        if (candidates.length) return Number(candidates.sort((a, b) => a - b)[0].toFixed(2));
        return Number((entry + required).toFixed(2));
    }

    if (type === "PUT") {
        const candidates = levels.filter(level => level < entry && entry - level >= required);
        if (candidates.length) return Number(candidates.sort((a, b) => b - a)[0].toFixed(2));
        return Number((entry - required).toFixed(2));
    }

    return 0;
}

function getStockTarget2(data, entry, target1, type) {
    if (!(target1 > 0)) return 0;

    const risk = Math.abs(entry - firstPositive(data.stopLoss, data.stockStopLoss, entry));
    const minimumStep = Math.max(risk * 0.75, entry * 0.004, getATR(data) * 0.75);
    const resistance = type === "CALL" ? "resistance" : "support";
    const levels = collectMarketLevels(data, resistance);

    if (type === "CALL") {
        const candidates = levels.filter(level => level > target1 && level - target1 >= minimumStep);
        if (candidates.length) return Number(candidates.sort((a, b) => a - b)[0].toFixed(2));
        return Number((target1 + minimumStep).toFixed(2));
    }

    if (type === "PUT") {
        const candidates = levels.filter(level => level < target1 && target1 - level >= minimumStep);
        if (candidates.length) return Number(candidates.sort((a, b) => b - a)[0].toFixed(2));
        return Number((target1 - minimumStep).toFixed(2));
    }

    return 0;
}

function calculateRiskReward(entry, stopLoss, target1, type) {
    const risk = type === "CALL" ? entry - stopLoss : stopLoss - entry;
    const reward = type === "CALL" ? target1 - entry : entry - target1;
    if (!(risk > 0 && reward > 0)) return 0;
    return Number((reward / risk).toFixed(2));
}

function validateStockSetup(entry, stopLoss, target1, target2, type, rr) {
    if (!(entry > 0 && stopLoss > 0 && target1 > 0 && target2 > 0)) {
        return { valid: false, reason: "MISSING_MARKET_LEVEL" };
    }

    if (type === "CALL" && !(stopLoss < entry && target1 > entry && target2 > target1)) {
        return { valid: false, reason: "INVALID_CALL_LEVEL_GEOMETRY" };
    }

    if (type === "PUT" && !(stopLoss > entry && target1 < entry && target2 < target1)) {
        return { valid: false, reason: "INVALID_PUT_LEVEL_GEOMETRY" };
    }

    if (!(Number.isFinite(rr) && rr >= ENGINE_CONFIG.WATCH_RR)) {
        return { valid: false, reason: "LOW_RR" };
    }

    return { valid: true, reason: "VALID" };
}

// ============================================================
// DIRECTION / QUALITY SCORING
// ============================================================

function calculateDirection(data, price) {
    const timeframes = [
        ["dailyTrend", 12],
        ["oneHourTrend", 14],
        ["fifteenMinTrend", 10],
        ["fourHourTrend", 8]
    ];

    let call = 0;
    let put = 0;
    let callEvidence = 0;
    let putEvidence = 0;

    for (const [key, weight] of timeframes) {
        const direction = normalizeDirection(data[key]);
        if (direction === "BULLISH") {
            call += weight;
            callEvidence++;
        } else if (direction === "BEARISH") {
            put += weight;
            putEvidence++;
        }
    }

    const ema5 = toNumber(data.ema5);
    const ema9 = toNumber(data.ema9);
    const ema20 = toNumber(data.ema20);
    const ema50 = toNumber(data.ema50);

    if (ema5 && ema9 && ema20 && ema50) {
        if (ema5 > ema9 && ema9 > ema20 && ema20 > ema50) {
            call += 12;
            callEvidence++;
        } else if (ema5 < ema9 && ema9 < ema20 && ema20 < ema50) {
            put += 12;
            putEvidence++;
        }
    }

    if (ema20 && ema50) {
        if (price > ema20 && price > ema50) {
            call += 7;
            callEvidence++;
        } else if (price < ema20 && price < ema50) {
            put += 7;
            putEvidence++;
        }
    }

    const rsi = toNumber(data.rsi);
    if (rsi >= 55 && rsi <= 70) {
        call += 8;
        callEvidence++;
    } else if (rsi >= 30 && rsi <= 45) {
        put += 8;
        putEvidence++;
    }

    const macd = toNumber(data.macdValue ?? data.macd);
    const macdSignal = toNumber(data.macdSignal);
    const histogram = toNumber(data.histogram ?? data.macdHistogram);
    if (macd > macdSignal && histogram >= 0) {
        call += 8;
        callEvidence++;
    } else if (macd < macdSignal && histogram <= 0) {
        put += 8;
        putEvidence++;
    }

    const adx = toNumber(data.adx);
    const pdi = toNumber(data.pdi);
    const mdi = toNumber(data.mdi);
    if (adx >= 20) {
        if (pdi > mdi) {
            call += 7;
            callEvidence++;
        } else if (mdi > pdi) {
            put += 7;
            putEvidence++;
        }
    }

    const vwap = toNumber(data.vwap);
    if (vwap) {
        if (price > vwap) {
            call += 5;
            callEvidence++;
        } else if (price < vwap) {
            put += 5;
            putEvidence++;
        }
    }

    const supertrend = normalizeDirection(data.supertrend);
    if (supertrend === "BULLISH") {
        call += 5;
        callEvidence++;
    } else if (supertrend === "BEARISH") {
        put += 5;
        putEvidence++;
    }

    const signal = normalizeDirection(data.signal);
    if (signal === "BULLISH") {
        call += 5;
        callEvidence++;
    } else if (signal === "BEARISH") {
        put += 5;
        putEvidence++;
    }

    const trend = normalizeDirection(data.trend);
    if (trend === "BULLISH") {
        call += 3;
        callEvidence++;
    } else if (trend === "BEARISH") {
        put += 3;
        putEvidence++;
    }

    const difference = Math.abs(call - put);
    const optionType = call > put && call >= ENGINE_CONFIG.MIN_DIRECTION_SCORE && difference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE && callEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE
        ? "CALL"
        : put > call && put >= ENGINE_CONFIG.MIN_DIRECTION_SCORE && difference >= ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE && putEvidence >= ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE
            ? "PUT"
            : null;

    return {
        optionType,
        callScore: call,
        putScore: put,
        directionDifference: difference,
        callEvidence,
        putEvidence,
        dominantScore: Math.max(call, put),
        dominantEvidence: call > put ? callEvidence : putEvidence
    };
}

function calculateMTF(type, data) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    const values = [
        ["DAILY", data.dailyTrend],
        ["4H", data.fourHourTrend],
        ["1H", data.oneHourTrend],
        ["15M", data.fifteenMinTrend]
    ].map(([name, value]) => ({ name, value: normalizeDirection(value) }));

    const available = values.filter(item => item.value !== "UNKNOWN");
    const aligned = available.filter(item => item.value === expected);
    const opposition = available.filter(item => item.value !== expected);
    const score = available.length
        ? clamp(((aligned.length - opposition.length) / available.length) * 50 + 50)
        : 0;

    return {
        score,
        alignment: aligned.length,
        opposition: opposition.length,
        available: available.length,
        required: 3,
        alignedTimeframes: aligned.map(item => item.name),
        availableTimeframes: available.map(item => item.name),
        isAligned: aligned.length >= 3,
        fullAlignment: available.length === 4 && aligned.length === 4
    };
}

function calculateTrendScore(data, type) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    let score = 50;

    const ema5 = toNumber(data.ema5);
    const ema9 = toNumber(data.ema9);
    const ema20 = toNumber(data.ema20);
    const ema50 = toNumber(data.ema50);

    if (ema5 && ema9 && ema20 && ema50) {
        const bullish = ema5 > ema9 && ema9 > ema20 && ema20 > ema50;
        const bearish = ema5 < ema9 && ema9 < ema20 && ema20 < ema50;
        if ((expected === "BULLISH" && bullish) || (expected === "BEARISH" && bearish)) score += 35;
        else if ((expected === "BULLISH" && bearish) || (expected === "BEARISH" && bullish)) score -= 35;
    }

    const trend = normalizeDirection(data.trend);
    if (trend === expected) score += 15;
    else if (trend !== "UNKNOWN") score -= 15;

    return clamp(score);
}

function calculateMomentumScore(data, type) {
    const expected = type === "CALL" ? "BULLISH" : "BEARISH";
    let score = 50;

    const rsi = toNumber(data.rsi);
    const macd = toNumber(data.macdValue ?? data.macd);
    const signal = toNumber(data.macdSignal);
    const histogram = toNumber(data.histogram ?? data.macdHistogram);

    if (rsi) {
        if ((expected === "BULLISH" && rsi >= 55 && rsi <= 70) || (expected === "BEARISH" && rsi >= 30 && rsi <= 45)) score += 20;
        else if ((expected === "BULLISH" && rsi < 50) || (expected === "BEARISH" && rsi > 50)) score -= 20;
    }

    if (Number.isFinite(macd) && Number.isFinite(signal)) {
        const bullish = macd > signal && histogram >= 0;
        const bearish = macd < signal && histogram <= 0;
        if ((expected === "BULLISH" && bullish) || (expected === "BEARISH" && bearish)) score += 30;
        else if ((expected === "BULLISH" && bearish) || (expected === "BEARISH" && bullish)) score -= 30;
    }

    return clamp(score);
}

function calculateVolumeScore(data) {
    const rvol = toNumber(data.rvol);
    if (rvol <= 0) return 50;
    if (rvol >= 2) return 100;
    if (rvol >= 1.5) return 85;
    if (rvol >= 1.2) return 70;
    if (rvol >= 1) return 55;
    return 35;
}

function calculateBreakoutScore(data, type) {
    const breakout = text(data.breakout);
    const breakoutType = text(data.breakoutType);
    const expected = type === "CALL" ? "BULL" : "BEAR";

    if (breakout.includes(expected) || breakoutType.includes(expected)) return 100;
    if (breakout.includes("BREAK") || breakoutType.includes("BREAK")) return 65;
    return 50;
}

function calculateRRScore(rr) {
    const value = Number(rr);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 2.5) return 100;
    if (value >= 2) return 90;
    if (value >= 1.5) return 80;
    if (value >= 1.2) return 65;
    if (value >= 1) return 50;
    return 25;
}

function calculateScannerScore(data, direction) {
    const raw = firstPositive(
        data.aiFinalScore,
        data.finalScore,
        data.score,
        data.scannerScore,
        data.rankingScore
    );

    if (raw <= 0 || !direction?.optionType) return 0;

    const directionScore = direction.optionType === "CALL"
        ? direction.callScore
        : direction.putScore;

    return clamp(clamp(raw) * 0.70 + clamp(directionScore) * 0.30);
}

function calculateConfidence(data, direction, mtf, rr) {
    if (!direction.optionType) {
        return {
            confidence: 0,
            scannerScore: 0,
            directionScore: 0,
            mtfScore: 0,
            trendScore: 0,
            momentumScore: 0,
            volumeScore: 0,
            breakoutScore: 0,
            rrScore: 0
        };
    }

    const scannerScore = calculateScannerScore(data, direction);
    const directionScore = direction.optionType === "CALL" ? direction.callScore : direction.putScore;
    const trendScore = calculateTrendScore(data, direction.optionType);
    const momentumScore = calculateMomentumScore(data, direction.optionType);
    const volumeScore = calculateVolumeScore(data);
    const breakoutScore = calculateBreakoutScore(data, direction.optionType);
    const rrScore = calculateRRScore(rr);
    const weights = ENGINE_CONFIG.CONFIDENCE_WEIGHTS;

    let confidence =
        scannerScore * weights.scanner +
        clamp(directionScore) * weights.direction +
        mtf.score * weights.mtf +
        trendScore * weights.trend +
        momentumScore * weights.momentum +
        volumeScore * weights.volume +
        breakoutScore * weights.breakout +
        rrScore * weights.rr;

    if (direction.dominantEvidence < 3) confidence -= 15;
    if (direction.directionDifference < 10) confidence -= 15;
    if (mtf.available === 0) confidence -= 20;
    if (mtf.alignment < 2) confidence -= 8;
    if (rr < 1.2) confidence -= 10;

    return {
        confidence: Math.round(clamp(confidence)),
        scannerScore: Math.round(scannerScore),
        directionScore: Math.round(clamp(directionScore)),
        mtfScore: Math.round(mtf.score),
        trendScore: Math.round(trendScore),
        momentumScore: Math.round(momentumScore),
        volumeScore: Math.round(volumeScore),
        breakoutScore: Math.round(breakoutScore),
        rrScore: Math.round(rrScore)
    };
}

function evaluateQualityGates(data, direction, mtf, rr, confidence) {
    const scannerScore = calculateScannerScore(data, direction);
    const gates = {
        direction: !!direction.optionType,
        directionEvidence: direction.dominantEvidence >= 3,
        directionDifference: direction.directionDifference >= 10,
        mtf: mtf.alignment >= 2,
        tradeMTF: mtf.alignment >= 3,
        riskReward: rr >= 1.2,
        tradeRiskReward: rr >= 1.5,
        confidence: confidence >= 65,
        tradeConfidence: confidence >= 82,
        scanner: scannerScore >= 55,
        tradeScanner: scannerScore >= 70
    };

    const failedGates = Object.entries(gates)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    return {
        ...gates,
        passedCount: Object.values(gates).filter(Boolean).length,
        totalCount: Object.keys(gates).length,
        failedGates,
        allPassed: failedGates.length === 0
    };
}

function calculateOptionTradeSetup(type, premium, stockRR) {
    const entry = Number(premium);
    if (!Number.isFinite(entry) || entry <= 0) return null;

    const risk = entry * ENGINE_CONFIG.OPTION_STOP_PERCENT;
    const stopLoss = Math.max(0.05, entry - risk);
    const target1 = entry + risk * ENGINE_CONFIG.OPTION_TARGET1_RISK_MULTIPLIER;
    const target2 = entry + risk * ENGINE_CONFIG.OPTION_TARGET2_RISK_MULTIPLIER;

    return {
        optionType: type,
        optionEntry: +entry.toFixed(2),
        optionStopLoss: +stopLoss.toFixed(2),
        optionTarget1: +target1.toFixed(2),
        optionTarget2: +target2.toFixed(2),
        optionRisk: +risk.toFixed(2),
        optionReward: +(target2 - entry).toFixed(2),
        optionRiskReward: risk > 0 ? +((target2 - entry) / risk).toFixed(2) : 0,
        stockRiskReward: +toNumber(stockRR).toFixed(2)
    };
}

function getDecision(direction, mtf, rr, confidence, gates, contract, quote) {
    if (!direction.optionType) {
        return { decision: "REJECT", rating: "NO DIRECTION", reason: "Directional evidence is insufficient." };
    }

    if (!contract) {
        return { decision: "REJECT", rating: "NO CONTRACT", reason: "No valid option contract with required side and expiry." };
    }

    if (!quote) {
        return { decision: "REJECT", rating: "NO LTP", reason: "Real option contract found but live option LTP is unavailable." };
    }

    if (rr < ENGINE_CONFIG.WATCH_RR) {
        return { decision: "REJECT", rating: "LOW R:R", reason: "Underlying risk/reward is below minimum." };
    }

    if (
        confidence >= ENGINE_CONFIG.TRADE_CONFIDENCE &&
        gates.tradeMTF &&
        gates.tradeRiskReward &&
        gates.tradeConfidence &&
        gates.tradeScanner &&
        gates.directionEvidence &&
        gates.directionDifference
    ) {
        return {
            decision: "TRADE",
            rating: "A",
            reason: "Direction, MTF, risk/reward, confidence and real option data are aligned."
        };
    }

    if (confidence >= ENGINE_CONFIG.WATCH_CONFIDENCE && gates.mtf && gates.riskReward) {
        return {
            decision: "WATCH",
            rating: "B",
            reason: "Valid setup but not all TRADE gates are met."
        };
    }

    return {
        decision: "REJECT",
        rating: "C",
        reason: "Setup does not satisfy minimum quality gates."
    };
}

// ============================================================
// MAIN DECISION
// ============================================================

async function makeOptionDecision(data = {}) {
    const symbol = firstValue(data.symbol, data.stock, data.name);
    const price = getStockPrice(data);

    if (!symbol || price <= 0) {
        return {
            ...data,
            symbol,
            direction: null,
            optionType: null,
            decision: "REJECT",
            confidence: 0,
            qualityGates: "INVALID_STOCK_DATA",
            failedGates: ["symbol", "price"]
        };
    }

    const direction = calculateDirection(data, price);

    if (!direction.optionType) {
        return {
            ...data,
            symbol,
            price,
            direction: "NO DIRECTION",
            finalDirection: null,
            optionType: null,
            callScore: direction.callScore,
            putScore: direction.putScore,
            scoreDifference: direction.directionDifference,
            callEvidence: direction.callEvidence,
            putEvidence: direction.putEvidence,
            entry: 0,
            stopLoss: 0,
            target1: 0,
            target2: 0,
            riskReward: 0,
            stockRiskReward: 0,
            confidence: 0,
            decision: "REJECT",
            rating: "NO DIRECTION",
            optionsDecision: "REJECT",
            optionsRating: "NO DIRECTION",
            optionsConfidence: 0,
            optionsReason: "Directional evidence is insufficient.",
            contractAvailable: false,
            optionPriceAvailable: false,
            optionSetupAvailable: false,
            qualityGates: "NO_DIRECTION",
            failedGates: ["direction"]
        };
    }

    const type = direction.optionType;
    const entry = getStockEntry(data, price);
    const stopLoss = getStockStopLoss(data, entry, type);
    const target1 = getStockTarget1(data, entry, stopLoss, type);
    const target2 = getStockTarget2({ ...data, stopLoss }, entry, target1, type);
    const riskReward = calculateRiskReward(entry, stopLoss, target1, type);
    const marketSetup = validateStockSetup(entry, stopLoss, target1, target2, type, riskReward);

    const mtf = calculateMTF(type, data);
    const confidence = calculateConfidence(data, direction, mtf, riskReward);
    const gates = evaluateQualityGates(data, direction, mtf, riskReward, confidence.confidence);
    const strike = getRecommendedStrike(price, type);

    let contract = null;
    try {
        contract = await resolveOptionContract(symbol, type, strike.strike, strike.interval);
    } catch (_) {}

    const quote = contract ? await resolveOptionQuote(contract) : null;
    const optionSetup = quote ? calculateOptionTradeSetup(type, quote.ltp, riskReward) : null;
    const decision = marketSetup.valid
        ? getDecision(direction, mtf, riskReward, confidence.confidence, gates, contract, quote)
        : {
            decision: "REJECT",
            rating: marketSetup.reason,
            reason: "Stock setup rejected because genuine market levels do not form valid risk/reward geometry."
        };

    const oiSupport1 = firstPositive(data.oiSupport1, data.oi_support1, data.putOISupport, data.putOiSupport, data.putOILevel, data.putOiLevel, data.maxPutOI, data.maxPutOi);
    const oiSupport2 = firstPositive(data.oiSupport2, data.oi_support2, data.oiSupport, data.oi_support, data.putOISupport2, data.putOiSupport2);
    const oiResistance1 = firstPositive(data.oiResistance1, data.oi_resistance1, data.callOIResistance, data.callOiResistance, data.callOILevel, data.callOiLevel, data.maxCallOI, data.maxCallOi);
    const oiResistance2 = firstPositive(data.oiResistance2, data.oi_resistance2, data.oiResistance, data.oi_resistance, data.callOIResistance2, data.callOiResistance2);
    const maxPain = firstPositive(data.maxPain, data.max_pain, data.optionMaxPain, data.option_max_pain);

    return {
        ...data,
        symbol,
        price,
        direction: type,
        finalDirection: type,
        optionType: type,
        callScore: direction.callScore,
        putScore: direction.putScore,
        scoreDifference: direction.directionDifference,
        callEvidence: direction.callEvidence,
        putEvidence: direction.putEvidence,
        entry: +entry.toFixed(2),
        stopLoss: +stopLoss.toFixed(2),
        target1: +target1.toFixed(2),
        target2: +target2.toFixed(2),
        stockEntry: +entry.toFixed(2),
        stockStopLoss: +stopLoss.toFixed(2),
        stockTarget1: +target1.toFixed(2),
        stockTarget2: +target2.toFixed(2),
        riskReward,
        stockRiskReward: riskReward,
        mtfScore: mtf.score,
        mtfAlignment: mtf.alignment,
        mtfAligned: mtf.isAligned,
        alignedTimeframes: mtf.alignedTimeframes,
        mtfAvailableTimeframes: mtf.availableTimeframes,
        mtfAvailableCount: mtf.available,
        mtfDiagnostic: {
            alignment: mtf.alignment,
            available: mtf.available,
            opposition: mtf.opposition
        },
        confidence: confidence.confidence,
        scannerScore: confidence.scannerScore,
        directionQuality: confidence.directionScore,
        directionScore: confidence.directionScore,
        trendScore: confidence.trendScore,
        momentumScore: confidence.momentumScore,
        volumeScore: confidence.volumeScore,
        breakoutScore: confidence.breakoutScore,
        rrScore: confidence.rrScore,
        recommendedStrike: strike.strike,
        optionStrike: contract ? contract.strike : strike.strike,
        strikeInterval: strike.interval,
        optionStrikeDifference: contract ? Math.abs(Number(contract.strike) - strike.strike) : null,
        contractAvailable: !!contract,
        optionSymbol: contract?.tradingSymbol ?? null,
        tradingSymbol: contract?.tradingSymbol ?? null,
        instrumentKey: contract?.instrumentKey ?? null,
        optionExpiry: contract?.expiry ?? null,
        expiry: contract?.expiry ?? null,
        optionExpiryDays: contract ? expiryDaysFromContract(contract) : null,
        optionLotSize: contract?.lotSize ?? null,
        optionTickSize: contract?.tickSize ?? null,
        optionPriceAvailable: !!quote,
        optionLTP: quote?.ltp ?? null,
        optionQuote: quote || null,
        optionSetupAvailable: !!optionSetup,
        optionEntry: optionSetup?.optionEntry ?? null,
        optionStopLoss: optionSetup?.optionStopLoss ?? null,
        optionTarget1: optionSetup?.optionTarget1 ?? null,
        optionTarget2: optionSetup?.optionTarget2 ?? null,
        optionRisk: optionSetup?.optionRisk ?? null,
        optionReward: optionSetup?.optionReward ?? null,
        optionRiskReward: optionSetup?.optionRiskReward ?? null,
        oiSupport1,
        oiSupport2,
        oiResistance1,
        oiResistance2,
        maxPain,
        combinedSupportLevels: uniqueSortedLevels([
            data.support1,
            data.support2,
            data.pivotS1,
            data.pivotS2,
            oiSupport1,
            oiSupport2
        ]),
        combinedResistanceLevels: uniqueSortedLevels([
            data.resistance1,
            data.resistance2,
            data.pivotR1,
            data.pivotR2,
            oiResistance1,
            oiResistance2
        ]),
        decision: decision.decision,
        rating: decision.rating,
        reason: decision.reason,
        optionsDecision: decision.decision,
        optionsRating: decision.rating,
        optionsConfidence: confidence.confidence,
        optionsReason: decision.reason,
        qualityGates: gates,
        failedGates: gates.failedGates,
        failedGateCount: gates.failedGates.length,
        tradeGates: gates,
        diagnostic: {
            direction,
            mtf,
            confidence,
            gates,
            marketSetup,
            contractFound: !!contract,
            optionQuoteFound: !!quote,
            optionSetupFound: !!optionSetup,
            stopDistanceMinimum: getMinimumStopDistance(data, entry),
            stopDistanceMaximum: getMaximumStopDistance(data, entry)
        }
    };
}

async function generateOptionDecisions(results = []) {
    if (!Array.isArray(results)) return [];

    const output = [];
    for (const data of results) {
        try {
            output.push(await makeOptionDecision(data));
        } catch (error) {
            const symbol = firstValue(data?.symbol, data?.stock, "UNKNOWN");
            console.log(`❌ Option decision failed: ${symbol} | ${error.message}`);
            output.push({
                ...data,
                symbol,
                decision: "REJECT",
                optionsDecision: "REJECT",
                confidence: 0,
                optionsConfidence: 0,
                reason: error.message,
                optionsReason: error.message,
                failedGates: ["ENGINE_ERROR"]
            });
        }
    }

    return output;
}

function sortOptionDecisions(decisions) {
    if (!Array.isArray(decisions)) return [];
    const rank = { TRADE: 3, WATCH: 2, REJECT: 1 };

    return [...decisions].sort((a, b) =>
        (rank[text(b.decision)] || 0) - (rank[text(a.decision)] || 0) ||
        toNumber(b.confidence) - toNumber(a.confidence) ||
        toNumber(b.riskReward) - toNumber(a.riskReward)
    );
}

const evaluateOptionDecision = makeOptionDecision;
const decideOptionTrade = makeOptionDecision;
const calculateOptionsDecisions = generateOptionDecisions;
const runOptionDecisionEngine = generateOptionDecisions;
const processOptionDecisions = generateOptionDecisions;

module.exports = {
    calculateOptionsDecisions,
    ENGINE_CONFIG,
    makeOptionDecision,
    evaluateOptionDecision,
    decideOptionTrade,
    generateOptionDecisions,
    runOptionDecisionEngine,
    processOptionDecisions,
    sortOptionDecisions,
    calculateDirection,
    calculateMTF,
    calculateTrendScore,
    calculateMomentumScore,
    calculateVolumeScore,
    calculateBreakoutScore,
    calculateRRScore,
    calculateConfidence,
    evaluateQualityGates,
    calculateOptionTradeSetup,
    getRecommendedStrike,
    getStrikeInterval,
    normalizeOptionContract,
    resolveOptionContract,
    resolveOptionQuote,
    calculateRiskReward
};
