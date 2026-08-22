// ============================================================
// AI SMART SCANNER — ACCURACY TRACKER
// ============================================================
//
// Purpose:
// - Store every scanner prediction independently of trade execution.
// - Evaluate the UNDERLYING STOCK, not option premium.
// - Record the highest high and lowest low made AFTER the signal.
// - Record exact date/time when stock SL/T1/T2 levels were reached.
// - Support repeated evaluation during the day.
// - Designed for Google Sheets ACCURACY sheet.
//
// IMPORTANT:
// - No trading decision is made here.
// - No option-price accuracy is calculated here.
// - Direction is evaluated from the stock price.
// - PRE-SIGNAL candles are NEVER included in evaluation.
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
    "accuracyPercent", "evaluationStatus", "evaluationDate"
];

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function directionOf(prediction) {
    const d = String(
        prediction?.direction ||
        prediction?.stockDirection ||
        prediction?.technicalDirection ||
        ""
    ).trim().toUpperCase();

    if (["CALL", "BUY", "BULLISH", "LONG", "UP"].includes(d)) return "CALL";
    if (["PUT", "SELL", "BEARISH", "SHORT", "DOWN"].includes(d)) return "PUT";
    return "NO DIRECTION";
}

function makeRecordId(prediction, timestamp = new Date()) {
    const symbol = String(
        prediction?.symbol || prediction?.stock || "UNKNOWN"
    ).trim().toUpperCase();

    return `${symbol}_${timestamp.getTime()}`;
}

function createAccuracyRecord(prediction, timestamp = new Date()) {
    const price = number(
        prediction?.price ?? prediction?.stockPrice
    );

    const entry = number(
        prediction?.entry ??
        prediction?.stockEntry ??
        price
    );

    const stopLoss = number(
        prediction?.stopLoss ??
        prediction?.stockStopLoss
    );

    const target1 = number(
        prediction?.target1 ??
        prediction?.stockTarget1
    );

    const target2 = number(
        prediction?.target2 ??
        prediction?.stockTarget2
    );

    return {
        recordId: makeRecordId(prediction, timestamp),
        date: timestamp.toISOString().slice(0, 10),
        time: timestamp.toISOString().slice(11, 19),
        timestamp: timestamp.toISOString(),
        stock: prediction?.stock || prediction?.symbol || "",
        symbol: prediction?.symbol || prediction?.stock || "",
        direction: directionOf(prediction),
        decision:
            prediction?.optionsDecision ||
            prediction?.decision ||
            prediction?.signal ||
            "",
        confidence: number(
            prediction?.confidence ??
            prediction?.optionsConfidence
        ),
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
        accuracyPercent: 0,
        evaluationStatus: "PENDING",
        evaluationDate: ""
    };
}

function reachedLevel(direction, price, level, type) {
    if (!Number.isFinite(price) || !Number.isFinite(level)) {
        return false;
    }

    if (direction === "CALL") {
        return type === "TARGET"
            ? price >= level
            : price <= level;
    }

    if (direction === "PUT") {
        return type === "TARGET"
            ? price <= level
            : price >= level;
    }

    return false;
}

function parseDate(value) {
    if (!value) return null;

    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    return Number.isNaN(date.getTime())
        ? null
        : date;
}

function evaluateAccuracy(record, candles, evaluatedAt = new Date()) {
    if (
        !record ||
        !Array.isArray(candles) ||
        candles.length === 0
    ) {
        return record;
    }

    const direction = String(
        record.direction || ""
    ).toUpperCase();

    if (!["CALL", "PUT"].includes(direction)) {
        record.evaluationStatus = "NO_DIRECTION";
        record.evaluationDate = evaluatedAt.toISOString();
        return record;
    }

    const entry = number(record.stockEntry);

    if (!Number.isFinite(entry) || entry <= 0) {
        record.evaluationStatus = "INVALID_ENTRY";
        record.evaluationDate = evaluatedAt.toISOString();
        return record;
    }

    // --------------------------------------------------------
    // CRITICAL: evaluate ONLY candles formed after the signal.
    // --------------------------------------------------------

    const signalTime = parseDate(
        record.timestamp ||
        `${record.date || ""}T${record.time || ""}`
    );

    const evaluationTime = parseDate(
        evaluatedAt
    ) || new Date();

    const postSignalCandles = candles.filter(candle => {
        const candleTime = parseDate(candle?.time);

        if (!candleTime) return false;

        // Never evaluate future candles beyond evaluation time.
        if (candleTime > evaluationTime) return false;

        // If signal timestamp exists, exclude every candle before it.
        if (signalTime && candleTime < signalTime) return false;

        return true;
    });

    if (postSignalCandles.length === 0) {
        record.evaluationStatus = "WAITING_FOR_POST_SIGNAL_DATA";
        record.evaluationDate = evaluationTime.toISOString();
        return record;
    }

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let highTime = null;
    let lowTime = null;

    for (const candle of postSignalCandles) {
        const h = number(candle?.high);
        const l = number(candle?.low);
        const candleTime = parseDate(candle?.time) || evaluationTime;

        if (Number.isFinite(h) && h > high) {
            high = h;
            highTime = candleTime;
        }

        if (Number.isFinite(l) && l < low) {
            low = l;
            lowTime = candleTime;
        }
    }

    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low)
    ) {
        record.evaluationStatus = "NO_VALID_POST_SIGNAL_DATA";
        record.evaluationDate = evaluationTime.toISOString();
        return record;
    }

    record.highestStockPriceReached = high;
    record.lowestStockPriceReached = low;
    record.highestStockPriceDate =
        highTime?.toISOString().slice(0, 10) || "";
    record.highestStockPriceTime =
        highTime?.toISOString().slice(11, 19) || "";
    record.lowestStockPriceDate =
        lowTime?.toISOString().slice(0, 10) || "";
    record.lowestStockPriceTime =
        lowTime?.toISOString().slice(11, 19) || "";

    const favorable = direction === "CALL"
        ? high - entry
        : entry - low;

    const adverse = direction === "CALL"
        ? entry - low
        : high - entry;

    record.maxFavorableMove = Number(
        favorable.toFixed(2)
    );

    record.maxFavorableMovePercent = Number(
        ((favorable / entry) * 100).toFixed(2)
    );

    record.maxAdverseMove = Number(
        adverse.toFixed(2)
    );

    record.maxAdverseMovePercent = Number(
        ((adverse / entry) * 100).toFixed(2)
    );

    const stop = number(record.stockStopLoss);
    const t1 = number(record.stockTarget1);
    const t2 = number(record.stockTarget2);

    if (
        reachedLevel(
            direction,
            direction === "CALL" ? low : high,
            stop,
            "STOP"
        )
    ) {
        record.stopLossReached = true;
        record.stopLossReachedDate = direction === "CALL"
            ? record.lowestStockPriceDate
            : record.highestStockPriceDate;
        record.stopLossReachedTime = direction === "CALL"
            ? record.lowestStockPriceTime
            : record.highestStockPriceTime;
    }

    if (
        reachedLevel(
            direction,
            direction === "CALL" ? high : low,
            t1,
            "TARGET"
        )
    ) {
        record.target1Reached = true;
        record.target1ReachedDate = direction === "CALL"
            ? record.highestStockPriceDate
            : record.lowestStockPriceDate;
        record.target1ReachedTime = direction === "CALL"
            ? record.highestStockPriceTime
            : record.lowestStockPriceTime;
    }

    if (
        reachedLevel(
            direction,
            direction === "CALL" ? high : low,
            t2,
            "TARGET"
        )
    ) {
        record.target2Reached = true;
        record.target2ReachedDate = direction === "CALL"
            ? record.highestStockPriceDate
            : record.lowestStockPriceDate;
        record.target2ReachedTime = direction === "CALL"
            ? record.highestStockPriceTime
            : record.lowestStockPriceTime;
    }

    if (record.target2Reached) {
        record.accuracyPercent = 100;
    } else if (record.target1Reached) {
        record.accuracyPercent = 75;
    } else if (record.stopLossReached) {
        record.accuracyPercent = 0;
    } else {
        record.accuracyPercent = Math.max(
            0,
            Math.min(
                100,
                record.maxFavorableMovePercent
            )
        );
    }

    // If both SL and a target were touched in the evaluation window,
    // keep the stronger achieved target as the final status. The sheet
    // still records SL_REACHED separately.
    record.evaluationStatus =
        record.target2Reached
            ? "T2_REACHED"
            : record.target1Reached
                ? "T1_REACHED"
                : record.stopLossReached
                    ? "SL_REACHED"
                    : "IN_PROGRESS";

    record.evaluationDate = evaluationTime.toISOString();

    return record;
}

function accuracyRecordToRow(record) {
    return ACCURACY_HEADERS.map(
        header => record?.[header] ?? ""
    );
}

module.exports = {
    ACCURACY_HEADERS,
    createAccuracyRecord,
    evaluateAccuracy,
    accuracyRecordToRow,
    directionOf
};
