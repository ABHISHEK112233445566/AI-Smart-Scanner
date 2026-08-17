// ============================================================
// PIVOT POINTS
// ============================================================
// Purpose:
// - Calculate Classic Pivot Points from the previous candle
// - Validate candle input and OHLC values
// - Prevent NaN / Infinity / invalid pivot levels
// - Preserve existing API
// ============================================================

function calculatePivotPoints(candles) {

    // ========================================================
    // INPUT VALIDATION
    // ========================================================

    if (!Array.isArray(candles) || candles.length < 2) {
        return null;
    }

    // ========================================================
    // PREVIOUS CANDLE
    // ========================================================

    const previous =
        candles[candles.length - 2];

    if (!previous || typeof previous !== "object") {
        return null;
    }

    // ========================================================
    // OHLC VALIDATION
    // ========================================================

    const high = Number(previous.high);
    const low = Number(previous.low);
    const close = Number(previous.close);

    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
    ) {
        return null;
    }

    if (
        high <= 0 ||
        low <= 0 ||
        close <= 0
    ) {
        return null;
    }

    // High must not be below Low
    if (high < low) {
        return null;
    }

    // Close should be within the candle range.
    // Small market-data inconsistencies are rejected
    // instead of producing unreliable levels.
    if (
        close < low ||
        close > high
    ) {
        return null;
    }

    // ========================================================
    // CLASSIC PIVOT CALCULATION
    // ========================================================

    const pivot =
        (high + low + close) / 3;

    const r1 =
        (2 * pivot) - low;

    const s1 =
        (2 * pivot) - high;

    const r2 =
        pivot + (high - low);

    const s2 =
        pivot - (high - low);

    const r3 =
        high + 2 * (pivot - low);

    const s3 =
        low - 2 * (high - pivot);

    // ========================================================
    // RESULT VALIDATION
    // ========================================================

    const levels = [
        pivot,
        r1,
        r2,
        r3,
        s1,
        s2,
        s3
    ];

    if (
        levels.some(
            level =>
                !Number.isFinite(level) ||
                level <= 0
        )
    ) {
        return null;
    }

    // ========================================================
    // RETURN
    // ========================================================

    return {

        pivot:
            Number(
                pivot.toFixed(2)
            ),

        r1:
            Number(
                r1.toFixed(2)
            ),

        r2:
            Number(
                r2.toFixed(2)
            ),

        r3:
            Number(
                r3.toFixed(2)
            ),

        s1:
            Number(
                s1.toFixed(2)
            ),

        s2:
            Number(
                s2.toFixed(2)
            ),

        s3:
            Number(
                s3.toFixed(2)
            )
    };
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    calculatePivotPoints
};