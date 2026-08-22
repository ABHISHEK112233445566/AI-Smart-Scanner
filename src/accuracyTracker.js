// ============================================================
// ACCURACY TRACKER — V4
// ============================================================
// One prediction record per stock/option direction per trading day.
// Later scans reuse the same predictionId so ACCURACY can update the
// existing row instead of creating a duplicate prediction each scan.
// ============================================================

function makePredictionId(item = {}) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const stock = String(item.stock || item.symbol || "UNKNOWN").replace(/[^A-Z0-9_-]/gi, "").toUpperCase();
    const type = String(item.optionType || item.direction || "EQUITY").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    return `${date}_${stock}_${type}`;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function createPrediction(item = {}) {
    const entry = toNumber(item.entry ?? item.stockEntry ?? item.price);
    const stopLoss = toNumber(item.stopLoss ?? item.sl);
    const target1 = toNumber(item.target1 ?? item.t1);
    const target2 = toNumber(item.target2 ?? item.t2);
    return {
        predictionId: item.predictionId || makePredictionId(item),
        predictionTime: item.predictionTime || new Date().toISOString(),
        stock: item.stock || item.symbol || "",
        symbol: item.symbol || item.stock || "",
        assetType: item.assetType || (item.optionType ? "OPTION" : "EQUITY"),
        optionType: item.optionType || "",
        strike: item.recommendedStrike ?? item.strike ?? "",
        direction: item.direction || "",
        decision: item.optionsDecision || item.decision || "",
        confidence: toNumber(item.optionsConfidence ?? item.confidence) ?? 0,
        entry, stopLoss, target1, target2,
        actualHigh: null, actualLow: null,
        maxFavorableMove: null, maxAdverseMove: null,
        maxFavorablePercent: null, maxAdversePercent: null,
        target1Reached: false, target2Reached: false, stopLossReached: false,
        target1Time: null, target2Time: null, stopLossTime: null,
        finalOutcome: "PENDING", completedTime: null
    };
}

function updatePrediction(record, marketData = {}) {
    const high = toNumber(marketData.high ?? marketData.price ?? marketData.last ?? marketData.close);
    const low = toNumber(marketData.low ?? marketData.price ?? marketData.last ?? marketData.close);
    const last = toNumber(marketData.last ?? marketData.close ?? marketData.price);
    const entry = toNumber(record.entry);
    if (!record || entry === null || entry === 0) return record;

    if (high !== null) record.actualHigh = Math.max(record.actualHigh ?? high, high);
    if (low !== null) record.actualLow = Math.min(record.actualLow ?? low, low);

    const actualHigh = toNumber(record.actualHigh);
    const actualLow = toNumber(record.actualLow);
    const isPut = String(record.optionType || record.direction || "").toUpperCase() === "PUT";

    if (actualHigh !== null && actualLow !== null) {
        record.maxFavorableMove = isPut ? entry - actualLow : actualHigh - entry;
        record.maxAdverseMove = isPut ? actualHigh - entry : entry - actualLow;
        record.maxFavorablePercent = (record.maxFavorableMove / entry) * 100;
        record.maxAdversePercent = (record.maxAdverseMove / entry) * 100;
    }

    const now = marketData.time || new Date().toISOString();
    if (!record.target1Reached && record.target1 !== null && actualHigh !== null && actualLow !== null) {
        record.target1Reached = isPut ? actualLow <= record.target1 : actualHigh >= record.target1;
        if (record.target1Reached) record.target1Time = now;
    }
    if (!record.target2Reached && record.target2 !== null && actualHigh !== null && actualLow !== null) {
        record.target2Reached = isPut ? actualLow <= record.target2 : actualHigh >= record.target2;
        if (record.target2Reached) record.target2Time = now;
    }
    if (!record.stopLossReached && record.stopLoss !== null && actualHigh !== null && actualLow !== null) {
        record.stopLossReached = isPut ? actualHigh >= record.stopLoss : actualLow <= record.stopLoss;
        if (record.stopLossReached) record.stopLossTime = now;
    }

    if (record.target2Reached) {
        record.finalOutcome = "T2_HIT";
        record.completedTime = record.target2Time || now;
    } else if (record.stopLossReached) {
        record.finalOutcome = "SL_HIT";
        record.completedTime = record.stopLossTime || now;
    } else if (record.target1Reached) {
        record.finalOutcome = "T1_HIT";
    } else if (last !== null) {
        record.finalOutcome = "OPEN";
    }
    return record;
}

function predictionToRow(record) {
    return [record.predictionId, record.predictionTime, record.stock, record.symbol, record.assetType, record.optionType, record.strike, record.direction, record.decision, record.confidence, record.entry, record.stopLoss, record.target1, record.target2, record.actualHigh, record.actualLow, record.maxFavorableMove, record.maxAdverseMove, record.maxFavorablePercent, record.maxAdversePercent, record.target1Reached, record.target2Reached, record.stopLossReached, record.target1Time, record.target2Time, record.stopLossTime, record.finalOutcome, record.completedTime];
}

const ACCURACY_HEADERS = [
    "predictionId", "predictionTime", "stock", "symbol", "assetType", "optionType", "strike",
    "direction", "decision", "confidence", "entry", "stopLoss", "target1", "target2",
    "actualHigh", "actualLow", "maxFavorableMove", "maxAdverseMove", "maxFavorablePercent",
    "maxAdversePercent", "target1Reached", "target2Reached", "stopLossReached", "target1Time",
    "target2Time", "stopLossTime", "finalOutcome", "completedTime"
];

module.exports = { makePredictionId, createPrediction, updatePrediction, predictionToRow, ACCURACY_HEADERS };