// ============================================================
// STOCK TRADE SETUP ENGINE V8
// MARKET-STRUCTURE ONLY
// ============================================================
// Entry = real underlying market price/trigger.
// SL/T1/T2 = genuine support/resistance only.
// ATR is a sanity metric only; it never creates price levels.
// Missing structure => invalid setup.
// ============================================================

function positive(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
function round(v) { return positive(v) ? Number(Number(v).toFixed(2)) : 0; }

function getDirection(stock = {}, option = {}) {
    const v = String(option.optionType || option.type || stock.optionType || stock.direction || stock.finalDirection || "").trim().toUpperCase();
    if (["CALL","CE","BULL","BULLISH","LONG","BUY"].includes(v)) return "CALL";
    if (["PUT","PE","BEAR","BEARISH","SHORT","SELL"].includes(v)) return "PUT";
    return null;
}

function getEntry(stock = {}, option = {}) {
    return positive(option.entry ?? stock.entry ?? stock.stockEntry ?? stock.underlyingEntry ?? stock.price ?? stock.ltp ?? stock.lastPrice ?? stock.close ?? stock.currentPrice);
}

function collect(data, keys) {
    const out = [];
    if (!data || typeof data !== "object") return out;
    for (const key of keys) {
        const value = data[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                const n = positive(typeof item === "object" ? item.value ?? item.level ?? item.price : item);
                if (n) out.push(n);
            }
        } else {
            const n = positive(value);
            if (n) out.push(n);
        }
    }
    return out;
}

function getLevels(stock = {}) {
    const supportKeys = ["support1","support2","support3","s1","s2","s3","pivotS1","pivotS2","pivotS3","swingLow","swingLow1","swingLow2","support","supportLevels"];
    const resistanceKeys = ["resistance1","resistance2","resistance3","r1","r2","r3","pivotR1","pivotR2","pivotR3","swingHigh","swingHigh1","swingHigh2","resistance","resistanceLevels"];
    const sr = stock.supportResistance || stock.sr || {};
    const pivot = stock.pivot || stock.pivots || {};
    const supports = [...collect(stock, supportKeys), ...collect(sr, supportKeys), ...collect(pivot,["s1","s2","s3","S1","S2","S3","support1","support2","support3"])].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>b-a);
    const resistances = [...collect(stock, resistanceKeys), ...collect(sr, resistanceKeys), ...collect(pivot,["r1","r2","r3","R1","R2","R3","resistance1","resistance2","resistance3"])].filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
    return { supports, resistances };
}

function below(levels, entry) { return levels.filter(v => v < entry).sort((a,b)=>b-a)[0] || 0; }
function below2(levels, entry, first) { return levels.filter(v => v < entry && v < first).sort((a,b)=>b-a)[0] || 0; }
function above(levels, entry) { return levels.filter(v => v > entry).sort((a,b)=>a-b)[0] || 0; }
function above2(levels, entry, first) { return levels.filter(v => v > entry && v > first).sort((a,b)=>a-b)[0] || 0; }

function getATR(stock = {}) {
    return positive(stock.atr ?? stock.ATR ?? stock.atrValue ?? stock.indicators?.atr ?? stock.indicators?.ATR ?? stock.technical?.atr ?? stock.technical?.ATR);
}

function riskReward(entry, stop, target, direction) {
    const risk = direction === "CALL" ? entry - stop : stop - entry;
    const reward = direction === "CALL" ? target - entry : entry - target;
    if (risk <= 0 || reward <= 0) return 0;
    return Number((reward / risk).toFixed(2));
}

function invalid(direction, entry, reason) {
    return { valid:false, isValid:false, direction, optionType:direction, entry:round(entry), stockEntry:round(entry), stopLoss:0, sl:0, target1:0, t1:0, target2:0, t2:0, riskReward:0, rr:0, stopSource:"MARKET_STRUCTURE_REQUIRED", targetSource:"MARKET_STRUCTURE_REQUIRED", levelsSource:"MARKET_STRUCTURE_ONLY", reason };
}

function calculateTradeSetup(stock = {}, option = {}) {
    const direction = getDirection(stock, option);
    const entry = getEntry(stock, option);
    if (!direction) return invalid(null, entry, "NO_DIRECTION");
    if (!entry) return invalid(direction, 0, "NO_MARKET_ENTRY");

    const { supports, resistances } = getLevels(stock);
    const atr = getATR(stock);
    let stop = 0, target1 = 0, target2 = 0, stopSource = "", targetSource = "";

    if (direction === "CALL") {
        stop = below(supports, entry);
        target1 = above(resistances, entry);
        target2 = above2(resistances, entry, target1);
        stopSource = stop ? "MARKET_SUPPORT" : "MARKET_STRUCTURE_REQUIRED";
        targetSource = target1 ? "MARKET_RESISTANCE" : "MARKET_STRUCTURE_REQUIRED";
    } else {
        stop = above(resistances, entry);
        target1 = below(supports, entry);
        target2 = below2(supports, entry, target1);
        stopSource = stop ? "MARKET_RESISTANCE" : "MARKET_STRUCTURE_REQUIRED";
        targetSource = target1 ? "MARKET_SUPPORT" : "MARKET_STRUCTURE_REQUIRED";
    }

    if (!stop || !target1) return invalid(direction, entry, "MISSING_MARKET_STRUCTURE_LEVEL");
    const rr = riskReward(entry, stop, target1, direction);
    if (!rr) return invalid(direction, entry, "INVALID_MARKET_RR");

    const risk = direction === "CALL" ? entry - stop : stop - entry;
    const reward = direction === "CALL" ? target1 - entry : entry - target1;

    return {
        valid:true, isValid:true, direction, optionType:direction,
        entry:round(entry), stockEntry:round(entry),
        stopLoss:round(stop), sl:round(stop),
        target1:round(target1), t1:round(target1),
        target2:round(target2), t2:round(target2),
        risk:round(risk), reward:round(reward),
        riskReward:rr, rr, stopSource, targetSource,
        atr, stopATR:atr ? Number((risk/atr).toFixed(2)) : 0,
        target1ATR:atr ? Number((reward/atr).toFixed(2)) : 0,
        levelsSource:"MARKET_STRUCTURE_ONLY"
    };
}

module.exports = calculateTradeSetup;
module.exports.calculateTradeSetup = calculateTradeSetup;
module.exports.getDirection = getDirection;
module.exports.riskReward = riskReward;
