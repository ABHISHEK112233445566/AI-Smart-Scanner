// ============================================================
// CENTRAL PIVOT RANGE (CPR) V2
// ============================================================
// Calculates today's CPR from the previous COMPLETED trading
// session. Handles both intraday data containing today's partial
// candle and data containing completed sessions only.
// ============================================================

function toDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()))) {
        let n = Number(value);
        if (!Number.isFinite(n)) return null;
        // Broker timestamps may be seconds or milliseconds.
        if (n < 1e12) n *= 1000;
        const d = new Date(n);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === "string") {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    return null;
}

function istDateKey(value) {
    const d = toDate(value);
    if (!d) return null;

    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });

    return formatter.format(d);
}

function isValidOHLC(candle) {
    if (!candle || typeof candle !== "object") return false;

    const high = Number(candle.high);
    const low = Number(candle.low);
    const open = Number(candle.open);
    const close = Number(candle.close);

    if (![high, low, open, close].every(Number.isFinite)) return false;
    if (high <= 0 || low <= 0 || open <= 0 || close <= 0) return false;

    // Fundamental OHLC relationship.
    return low <= open && open <= high && low <= close && close <= high;
}

function findPreviousCompletedCandle(candles) {
    const valid = candles.filter(isValidOHLC);
    if (valid.length < 1) return null;

    // If the latest candle belongs to today's IST session, it may be
    // an incomplete/live daily candle. Use the preceding completed
    // trading candle. If it belongs to an earlier session, it is the
    // latest completed session and should be used directly.
    const todayKey = istDateKey(Date.now());
    const last = valid[valid.length - 1];
    const lastKey = istDateKey(last.time);

    if (todayKey && lastKey && lastKey === todayKey) {
        return valid.length >= 2 ? valid[valid.length - 2] : null;
    }

    return last;
}

function calculateCPR(candles) {
    if (!Array.isArray(candles) || candles.length < 1) return null;

    const previous = findPreviousCompletedCandle(candles);
    if (!previous || !isValidOHLC(previous)) return null;

    const high = Number(previous.high);
    const low = Number(previous.low);
    const close = Number(previous.close);

    const pivot = (high + low + close) / 3;
    const bc = (high + low) / 2;
    const tc = (pivot * 2) - bc;
    const top = Math.max(tc, bc);
    const bottom = Math.min(tc, bc);
    const width = top - bottom;

    if (
        !Number.isFinite(pivot) ||
        !Number.isFinite(top) ||
        !Number.isFinite(bottom) ||
        !Number.isFinite(width) ||
        pivot <= 0 ||
        top <= 0 ||
        bottom <= 0 ||
        width < 0
    ) return null;

    let type = "NORMAL";
    if (width < pivot * 0.0025) type = "NARROW";
    else if (width > pivot * 0.008) type = "WIDE";

    return {
        pivot: Number(pivot.toFixed(2)),
        top: Number(top.toFixed(2)),
        bottom: Number(bottom.toFixed(2)),
        width: Number(width.toFixed(2)),
        type,
        sourceTime: previous.time
    };
}

module.exports = { calculateCPR };