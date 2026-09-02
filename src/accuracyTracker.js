// ============================================================
// AI SMART SCANNER — ACCURACY TRACKER
// ============================================================
// Evaluates the UNDERLYING STOCK after the signal timestamp.
// Records first target/SL outcome, exact candle time and price.
// ============================================================

const ACCURACY_HEADERS = [
    "recordId", "date", "time", "timestamp",
    "stock", "symbol", "direction", "decision", "confidence",
    "stockPriceAtSignal", "stockEntry", "stockStopLoss",
    "stockTarget1", "stockTarget2",
    "highestStockPriceReached", "highestStockPriceDate", "highestStockPriceTime",
    "lowestStockPriceReached", "lowestStockPriceDate", "lowestStockPriceTime",
    "maxFavorableMove", "maxFavorableMovePercent",
    "maxAdverseMove", "maxAdverseMovePercent",
    "stopLossReached", "stopLossReachedDate", "stopLossReachedTime",
    "target1Reached", "target1ReachedDate", "target1ReachedTime",
    "target2Reached", "target2ReachedDate", "target2ReachedTime",
    "targetSLReached", "resultTime", "resultPrice", "accuracyPercent", "evaluationStatus", "evaluationDate"
];

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function directionOf(prediction) {
    const d = String(prediction?.direction || prediction?.stockDirection || prediction?.technicalDirection || "").trim().toUpperCase();
    if (["CALL", "BUY", "BULLISH", "LONG", "UP"].includes(d)) return "CALL";
    if (["PUT", "SELL", "BEARISH", "SHORT", "DOWN"].includes(d)) return "PUT";
    return "NO DIRECTION";
}

function parseDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function makeRecordId(prediction, timestamp = new Date()) {
    const symbol = String(prediction?.symbol || prediction?.stock || "UNKNOWN").trim().toUpperCase();
    return `${symbol}_${timestamp.getTime()}`;
}

function createAccuracyRecord(prediction, timestamp = new Date()) {
    const price = number(prediction?.price ?? prediction?.stockPrice);
    const entry = number(prediction?.entry ?? prediction?.stockEntry ?? price);
    const stopLoss = number(prediction?.stopLoss ?? prediction?.stockStopLoss);
    const target1 = number(prediction?.target1 ?? prediction?.stockTarget1);
    const target2 = number(prediction?.target2 ?? prediction?.stockTarget2);
    return {
        recordId: makeRecordId(prediction, timestamp),
        date: timestamp.toISOString().slice(0, 10),
        time: timestamp.toISOString().slice(11, 19),
        timestamp: timestamp.toISOString(),
        stock: prediction?.stock || prediction?.symbol || "",
        symbol: prediction?.symbol || prediction?.stock || "",
        direction: directionOf(prediction),
        decision: prediction?.optionsDecision || prediction?.decision || prediction?.signal || "",
        confidence: number(prediction?.confidence ?? prediction?.optionsConfidence),
        stockPriceAtSignal: price,
        stockEntry: entry,
        stockStopLoss: stopLoss,
        stockTarget1: target1,
        stockTarget2: target2,
        highestStockPriceReached: price,
        highestStockPriceDate: timestamp.toISOString().slice(0, 10),
        highestStockPriceTime: timestamp.toISOString().slice(11, 19),
        lowestStockPriceReached: price,
        lowestStockPriceDate: timestamp.toISOString().slice(0, 10),
        lowestStockPriceTime: timestamp.toISOString().slice(11, 19),
        maxFavorableMove: 0,
        maxFavorableMovePercent: 0,
        maxAdverseMove: 0,
        maxAdverseMovePercent: 0,
        stopLossReached: false,
        stopLossReachedDate: "",
        stopLossReachedTime: "",
        target1Reached: false,
        target1ReachedDate: "",
        target1ReachedTime: "",
        target2Reached: false,
        target2ReachedDate: "",
        target2ReachedTime: "",
        targetSLReached: "PENDING",
        resultTime: "",
        resultPrice: null,
        accuracyPercent: 0,
        evaluationStatus: "PENDING",
        evaluationDate: ""
    };
}

function reachedLevel(direction, high, low, level, type) {
    if (!Number.isFinite(level) || level <= 0) return false;
    if (direction === "CALL") return type === "TARGET" ? high >= level : low <= level;
    if (direction === "PUT") return type === "TARGET" ? low <= level : high >= level;
    return false;
}

function touchInCandle(direction, candle, level, type) {
    if (!candle || !Number.isFinite(level) || level <= 0) return false;
    const high = number(candle.high);
    const low = number(candle.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
    return reachedLevel(direction, high, low, level, type);
}

function firstTouch(candles, direction, level, type) {
    if (!Number.isFinite(level) || level <= 0) return null;
    for (const candle of candles) {
        if (touchInCandle(direction, candle, level, type)) {
            return parseDate(candle?.time);
        }
    }
    return null;
}

function firstTouchEvent(candles, direction, level, type) {
    if (!Number.isFinite(level) || level <= 0) return null;
    for (const candle of candles) {
        if (!touchInCandle(direction, candle, level, type)) continue;
        const time = parseDate(candle?.time);
        if (!time) continue;
        const high = number(candle.high);
        const low = number(candle.low);
        let price = level;
        // A candle crossing the level is recorded at the actual target/SL level.
        if (type === "TARGET" && direction === "CALL") price = Math.max(level, Math.min(high, level));
        if (type === "TARGET" && direction === "PUT") price = Math.min(level, Math.max(low, level));
        if (type === "STOP" && direction === "CALL") price = Math.min(level, Math.max(low, level));
        if (type === "STOP" && direction === "PUT") price = Math.max(level, Math.min(high, level));
        return { time, price: Number.isFinite(price) ? price : level };
    }
    return null;
}

function evaluateAccuracy(record, candles, evaluatedAt = new Date()) {
    if (!record || !Array.isArray(candles) || candles.length === 0) return record;

    const direction = String(record.direction || "").toUpperCase();
    const evaluationTime = parseDate(evaluatedAt) || new Date();
    if (!["CALL", "PUT"].includes(direction)) {
        record.evaluationStatus = "NO_DIRECTION";
        record.targetSLReached = "PENDING";
        record.evaluationDate = evaluationTime.toISOString();
        return record;
    }

    const entry = number(record.stockEntry);
    if (!Number.isFinite(entry) || entry <= 0) {
        record.evaluationStatus = "INVALID_ENTRY";
        record.targetSLReached = "PENDING";
        record.evaluationDate = evaluationTime.toISOString();
        return record;
    }

    const signalTime = parseDate(record.timestamp || `${record.date || ""}T${record.time || ""}`);
    const postSignalCandles = candles
        .filter(c => {
            const t = parseDate(c?.time);
            if (!t || t > evaluationTime) return false;
            return !signalTime || t >= signalTime;
        })
        .sort((a, b) => (parseDate(a?.time)?.getTime() || 0) - (parseDate(b?.time)?.getTime() || 0));

    if (!postSignalCandles.length) {
        record.evaluationStatus = "WAITING_FOR_POST_SIGNAL_DATA";
        record.targetSLReached = "PENDING";
        record.evaluationDate = evaluationTime.toISOString();
        return record;
    }

    let high = -Infinity;
    let low = Infinity;
    let highTime = null;
    let lowTime = null;

    for (const candle of postSignalCandles) {
        const h = number(candle?.high);
        const l = number(candle?.low);
        const t = parseDate(candle?.time);
        if (Number.isFinite(h) && h > high) { high = h; highTime = t; }
        if (Number.isFinite(l) && l < low) { low = l; lowTime = t; }
    }

    if (!Number.isFinite(high) || !Number.isFinite(low)) {
        record.evaluationStatus = "NO_VALID_POST_SIGNAL_DATA";
        record.targetSLReached = "PENDING";
        record.evaluationDate = evaluationTime.toISOString();
        return record;
    }

    record.highestStockPriceReached = high;
    record.lowestStockPriceReached = low;
    record.highestStockPriceDate = highTime?.toISOString().slice(0, 10) || "";
    record.highestStockPriceTime = highTime?.toISOString().slice(11, 19) || "";
    record.lowestStockPriceDate = lowTime?.toISOString().slice(0, 10) || "";
    record.lowestStockPriceTime = lowTime?.toISOString().slice(11, 19) || "";

    const favorable = direction === "CALL" ? high - entry : entry - low;
    const adverse = direction === "CALL" ? entry - low : high - entry;
    record.maxFavorableMove = Number(Math.max(0, favorable).toFixed(2));
    record.maxFavorableMovePercent = Number((Math.max(0, favorable) / entry * 100).toFixed(2));
    record.maxAdverseMove = Number(Math.max(0, adverse).toFixed(2));
    record.maxAdverseMovePercent = Number((Math.max(0, adverse) / entry * 100).toFixed(2));

    const stop = number(record.stockStopLoss);
    const t1 = number(record.stockTarget1);
    const t2 = number(record.stockTarget2);
    const stopEvent = firstTouchEvent(postSignalCandles, direction, stop, "STOP");
    const t1Event = firstTouchEvent(postSignalCandles, direction, t1, "TARGET");
    const t2Event = firstTouchEvent(postSignalCandles, direction, t2, "TARGET");

    if (stopEvent) {
        record.stopLossReached = true;
        record.stopLossReachedDate = stopEvent.time.toISOString().slice(0, 10);
        record.stopLossReachedTime = stopEvent.time.toISOString().slice(11, 19);
    }
    if (t1Event) {
        record.target1Reached = true;
        record.target1ReachedDate = t1Event.time.toISOString().slice(0, 10);
        record.target1ReachedTime = t1Event.time.toISOString().slice(11, 19);
    }
    if (t2Event) {
        record.target2Reached = true;
        record.target2ReachedDate = t2Event.time.toISOString().slice(0, 10);
        record.target2ReachedTime = t2Event.time.toISOString().slice(11, 19);
    }

    // The result is the FIRST event after the signal. If both are inside the
    // same 5-minute candle, OHLC cannot reveal intrabar order, so keep it pending
    // rather than falsely claiming which was first.
    const events = [
        stopEvent ? { type: "SL", ...stopEvent } : null,
        t1Event ? { type: "TARGET", ...t1Event } : null
    ].filter(Boolean).sort((a, b) => a.time.getTime() - b.time.getTime());

    if (events.length && events[0].time.getTime() !== events[1]?.time?.getTime()) {
        const first = events[0];
        record.targetSLReached = first.type;
        record.resultTime = first.time.toISOString();
        record.resultPrice = number(first.price);
        record.accuracyPercent = first.type === "TARGET" ? 100 : 0;
        record.evaluationStatus = first.type === "TARGET" ? "TARGET_REACHED" : "SL_REACHED";
    } else if (events.length === 1) {
        const first = events[0];
        record.targetSLReached = first.type;
        record.resultTime = first.time.toISOString();
        record.resultPrice = number(first.price);
        record.accuracyPercent = first.type === "TARGET" ? 100 : 0;
        record.evaluationStatus = first.type === "TARGET" ? "TARGET_REACHED" : "SL_REACHED";
    } else {
        record.targetSLReached = "PENDING";
        record.resultTime = "";
        record.resultPrice = null;
        record.accuracyPercent = 0;
        record.evaluationStatus = "IN_PROGRESS";
    }

    record.evaluationDate = evaluationTime.toISOString();
    return record;
}

function accuracyRecordToRow(record) {
    return ACCURACY_HEADERS.map(header => record?.[header] ?? "");
}

module.exports = {
    ACCURACY_HEADERS,
    createAccuracyRecord,
    evaluateAccuracy,
    accuracyRecordToRow,
    directionOf
};
