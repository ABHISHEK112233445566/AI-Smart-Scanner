// ============================================================
// STOCK TRADE SETUP ENGINE V9
// MARKET-STRUCTURE ONLY
// ============================================================
// Entry = actual market price / supplied market trigger.
// SL/T1/T2 = genuine market levels only.
// NO ATR-generated prices.
// NO percentage-generated prices.
// NO synthetic SL/targets.
// Target selection may move to a LATER genuine market level when
// the nearest genuine level gives poor risk/reward.
// ============================================================

function positive(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
function round(v) { return positive(v) ? Number(Number(v).toFixed(2)) : 0; }
function unique(values) { return [...new Set(values.map(positive).filter(Boolean).map(round))]; }

function getDirection(stock = {}, option = {}) {
    const v = String(option.optionType || option.type || stock.optionType || stock.direction || stock.finalDirection || stock.stockDirection || "").trim().toUpperCase();
    if (["CALL","CE","BULL","BULLISH","LONG","BUY"].includes(v)) return "CALL";
    if (["PUT","PE","BEAR","BEARISH","SHORT","SELL"].includes(v)) return "PUT";
    return null;
}

function getEntry(stock = {}, option = {}) {
    return positive(option.entry ?? stock.marketEntry ?? stock.market_entry ?? stock.entry ?? stock.stockEntry ?? stock.underlyingEntry ?? stock.price ?? stock.ltp ?? stock.lastPrice ?? stock.close ?? stock.currentPrice);
}

function collect(data, keys) {
    const out = [];
    if (!data || typeof data !== "object") return out;
    for (const key of keys) {
        const value = data[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item && typeof item === "object") out.push(item.value, item.level, item.price, item.close);
                else out.push(item);
            }
        } else if (value && typeof value === "object") {
            out.push(...Object.values(value));
        } else out.push(value);
    }
    return out.map(positive).filter(Boolean);
}

function getLevels(stock = {}) {
    const supportKeys = [
        "support1","support2","support3","s1","s2","s3",
        "pivotS1","pivotS2","pivotS3","swingLow","swingLow1","swingLow2",
        "previousLow","prevLow","previousDayLow","prevDayLow","recentLow","dayLow"
    ];
    const resistanceKeys = [
        "resistance1","resistance2","resistance3","r1","r2","r3",
        "pivotR1","pivotR2","pivotR3","swingHigh","swingHigh1","swingHigh2",
        "previousHigh","prevHigh","previousDayHigh","prevDayHigh","recentHigh","dayHigh"
    ];
    const sr = stock.supportResistance || stock.support_resistance || stock.sr || {};
    const pivot = stock.pivot || stock.pivots || {};

    const supports = unique([
        ...collect(stock, supportKeys),
        ...(Array.isArray(stock.supportLevels) ? stock.supportLevels : []),
        ...collect(sr, supportKeys),
        ...collect(pivot, ["s1","s2","s3","S1","S2","S3","support1","support2","support3"])
    ]).sort((a,b)=>b-a);

    const resistances = unique([
        ...collect(stock, resistanceKeys),
        ...(Array.isArray(stock.resistanceLevels) ? stock.resistanceLevels : []),
        ...collect(sr, resistanceKeys),
        ...collect(pivot, ["r1","r2","r3","R1","R2","R3","resistance1","resistance2","resistance3"])
    ]).sort((a,b)=>a-b);

    return { supports, resistances };
}

function riskReward(entry, stop, target, direction) {
    const risk = direction === "CALL" ? entry - stop : stop - entry;
    const reward = direction === "CALL" ? target - entry : entry - target;
    if (risk <= 0 || reward <= 0) return 0;
    return Number((reward / risk).toFixed(2));
}

function invalid(direction, entry, reason, supports = [], resistances = []) {
    return {
        valid:false,
        isValid:false,
        direction,
        optionType:direction,
        entry:round(entry),
        stockEntry:round(entry),
        stopLoss:0,
        sl:0,
        target1:0,
        t1:0,
        target2:0,
        t2:0,
        risk:0,
        reward:0,
        riskReward:0,
        rr:0,
        stopSource:"MARKET_STRUCTURE_REQUIRED",
        target1Source:"MARKET_STRUCTURE_REQUIRED",
        target2Source:"MARKET_STRUCTURE_REQUIRED",
        targetSource:"MARKET_STRUCTURE_REQUIRED",
        levelsSource:"MARKET_STRUCTURE_ONLY",
        supportLevels:supports,
        resistanceLevels:resistances,
        reason
    };
}

function calculateTradeSetup(stock = {}, option = {}) {
    const direction = getDirection(stock, option);
    const entry = getEntry(stock, option);
    if (!direction) return invalid(null, entry, "NO_DIRECTION");
    if (!entry) return invalid(direction, 0, "NO_MARKET_ENTRY");

    const { supports:allSupports, resistances:allResistances } = getLevels(stock);
    const supports = allSupports.filter(v => v < entry).sort((a,b)=>b-a);
    const resistances = allResistances.filter(v => v > entry).sort((a,b)=>a-b);

    if (!supports.length || !resistances.length) {
        return invalid(direction, entry, "MISSING_MARKET_STRUCTURE_LEVEL", supports, resistances);
    }

    let stop = 0;
    let target1 = 0;
    let target2 = 0;
    let target1Index = -1;
    let stopSource = "";
    let target1Source = "";
    let target2Source = "";

    if (direction === "CALL") {
        stop = supports[0];
        // Use the first REAL resistance that gives at least 1.5R.
        target1Index = resistances.findIndex(level => riskReward(entry, stop, level, direction) >= 1.5);
        if (target1Index < 0) return invalid(direction, entry, "NO_VALID_MARKET_RR_LEVEL", supports, resistances);
        target1 = resistances[target1Index];
        target2 = resistances[target1Index + 1] || 0;
        stopSource = "MARKET_SUPPORT";
        target1Source = target1Index === 0 ? "MARKET_RESISTANCE" : "NEXT_VALID_MARKET_RESISTANCE";
        target2Source = target2 ? "NEXT_MARKET_RESISTANCE" : "MARKET_STRUCTURE_REQUIRED";
    } else {
        stop = resistances[0];
        // Use the first REAL support that gives at least 1.5R.
        target1Index = supports.findIndex(level => riskReward(entry, stop, level, direction) >= 1.5);
        if (target1Index < 0) return invalid(direction, entry, "NO_VALID_MARKET_RR_LEVEL", supports, resistances);
        target1 = supports[target1Index];
        target2 = supports[target1Index + 1] || 0;
        stopSource = "MARKET_RESISTANCE";
        target1Source = target1Index === 0 ? "MARKET_SUPPORT" : "NEXT_VALID_MARKET_SUPPORT";
        target2Source = target2 ? "NEXT_MARKET_SUPPORT" : "MARKET_STRUCTURE_REQUIRED";
    }

    const risk = direction === "CALL" ? entry - stop : stop - entry;
    const reward = direction === "CALL" ? target1 - entry : entry - target1;
    const rr = riskReward(entry, stop, target1, direction);

    if (!(risk > 0 && reward > 0 && rr >= 1.5)) {
        return invalid(direction, entry, "INVALID_MARKET_RR", supports, resistances);
    }

    return {
        valid:true,
        isValid:true,
        direction,
        optionType:direction,
        entry:round(entry),
        stockEntry:round(entry),
        stopLoss:round(stop),
        sl:round(stop),
        target1:round(target1),
        t1:round(target1),
        target2:round(target2),
        t2:round(target2),
        risk:round(risk),
        reward:round(reward),
        riskReward:rr,
        rr,
        stopSource,
        target1Source,
        target2Source,
        targetSource:target1Source,
        levelsSource:"MARKET_STRUCTURE_ONLY",
        supportLevels:supports,
        resistanceLevels:resistances,
        reason:"VALID_MARKET_STRUCTURE_RR"
    };
}

module.exports = calculateTradeSetup;
module.exports.calculateTradeSetup = calculateTradeSetup;
module.exports.getDirection = getDirection;
module.exports.riskReward = riskReward;
