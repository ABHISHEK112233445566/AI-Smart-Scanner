// ============================================================
// CENTRAL PIVOT RANGE (CPR)
// ============================================================
// Purpose:
// - Calculate CPR from previous trading candle
// - Validate OHLC before calculation
// - Classify CPR as NARROW / NORMAL / WIDE
// ============================================================

function calculateCPR(candles) {

    // ========================================================
    // INPUT VALIDATION
    // ========================================================

    if (
        !Array.isArray(candles) ||
        candles.length < 2
    ) {
        return null;
    }

    const previous =
        candles[candles.length - 2];

    if (!previous) {
        return null;
    }

    // ========================================================
    // OHLC
    // ========================================================

    const high =
        Number(previous.high);

    const low =
        Number(previous.low);

    const close =
        Number(previous.close);

    // ========================================================
    // VALIDATE OHLC
    // ========================================================

    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
    ) {
        return null;
    }

    if (
        high <= 0 ||
        low < 0 ||
        close <= 0 ||
        high < low
    ) {
        return null;
    }

    // ========================================================
    // CPR CALCULATION
    // ========================================================

    const pivot =
        (high + low + close) / 3;

    const bc =
        (high + low) / 2;

    const tc =
        (pivot * 2) - bc;

    const top =
        Math.max(tc, bc);

    const bottom =
        Math.min(tc, bc);

    const width =
        top - bottom;

    // ========================================================
    // FINAL VALIDATION
    // ========================================================

    if (
        !Number.isFinite(pivot) ||
        !Number.isFinite(top) ||
        !Number.isFinite(bottom) ||
        !Number.isFinite(width) ||
        pivot <= 0 ||
        width < 0
    ) {
        return null;
    }

    // ========================================================
    // CPR TYPE
    // ========================================================

    let type =
        "NORMAL";

    if (
        width <
        pivot * 0.0025
    ) {

        type =
            "NARROW";

    } else if (
        width >
        pivot * 0.008
    ) {

        type =
            "WIDE";
    }

    // ========================================================
    // RESULT
    // ========================================================

    return {

        pivot:
            Number(
                pivot.toFixed(2)
            ),

        top:
            Number(
                top.toFixed(2)
            ),

        bottom:
            Number(
                bottom.toFixed(2)
            ),

        width:
            Number(
                width.toFixed(2)
            ),

        type

    };

}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    calculateCPR
};