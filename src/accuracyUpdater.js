// ============================================================
// ACCURACY UPDATER — V4
// ============================================================

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function updateAccuracyRecord(record, market = {}) {
    if (!record || typeof record !== "object") throw new Error("Invalid accuracy record");

    const high = num(market.high);
    const low = num(market.low);
    const last = num(market.last ?? market.close);
    const entry = num(record.entry);
    if (entry === null || entry === 0) return record;

    const isPut = String(record.optionType || record.direction || "").toUpperCase() === "PUT";

    if (high !== null) record.actualHigh = Math.max(num(record.actualHigh) ?? high, high);
    if (low !== null) record.actualLow = Math.min(num(record.actualLow) ?? low, low);

    const actualHigh = num(record.actualHigh);
    const actualLow = num(record.actualLow);

    if (actualHigh !== null && actualLow !== null) {
        record.maxFavorableMove = isPut ? entry - actualLow : actualHigh - entry;
        record.maxAdverseMove = isPut ? actualHigh - entry : entry - actualLow;
        record.maxFavorablePercent = record.maxFavorableMove / entry * 100;
        record.maxAdversePercent = record.maxAdverseMove / entry * 100;
    }

    const now = market.time || new Date().toISOString();
    const t1 = num(record.target1);
    const t2 = num(record.target2);
    const sl = num(record.stopLoss);

    if (!record.target1Reached && t1 !== null && actualHigh !== null && actualLow !== null) {
        record.target1Reached = isPut ? actualLow <= t1 : actualHigh >= t1;
        if (record.target1Reached) record.target1Time = now;
    }

    if (!record.target2Reached && t2 !== null && actualHigh !== null && actualLow !== null) {
        record.target2Reached = isPut ? actualLow <= t2 : actualHigh >= t2;
        if (record.target2Reached) record.target2Time = now;
    }

    if (!record.stopLossReached && sl !== null && actualHigh !== null && actualLow !== null) {
        record.stopLossReached = isPut ? actualHigh >= sl : actualLow <= sl;
        if (record.stopLossReached) record.stopLossTime = now;
    }

    if (record.target2Reached) record.finalOutcome = "T2_HIT";
    else if (record.stopLossReached) record.finalOutcome = "SL_HIT";
    else if (record.target1Reached) record.finalOutcome = "T1_HIT";
    else if (last !== null) record.finalOutcome = "OPEN";

    return record;
}

module.exports = { updateAccuracyRecord };