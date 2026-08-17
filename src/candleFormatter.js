// ============================================================
// CANDLE FORMATTER
// ============================================================
// Purpose:
// - Convert raw broker candle arrays into standard candle objects
// - Validate input before formatting
// - Prevent NaN / invalid OHLC values
// - Preserve existing API
// ============================================================

function formatCandles(rawCandles) {

    // ========================================================
    // INPUT VALIDATION
    // ========================================================

    if (!Array.isArray(rawCandles)) {
        return [];
    }

    // ========================================================
    // FORMAT + VALIDATE CANDLES
    // ========================================================

    return rawCandles
        .map(candle => {

            if (!Array.isArray(candle)) {
                return null;
            }

            const time =
                candle[0];

            const open =
                Number(candle[1]);

            const high =
                Number(candle[2]);

            const low =
                Number(candle[3]);

            const close =
                Number(candle[4]);

            const volume =
                Number(candle[5] ?? 0);

            // ------------------------------------------------
            // REQUIRED OHLC VALIDATION
            // ------------------------------------------------

            if (
                !time ||
                !Number.isFinite(open) ||
                !Number.isFinite(high) ||
                !Number.isFinite(low) ||
                !Number.isFinite(close)
            ) {
                return null;
            }

            // ------------------------------------------------
            // OHLC LOGICAL VALIDATION
            // ------------------------------------------------

            if (
                high < low ||
                open < 0 ||
                high < 0 ||
                low < 0 ||
                close < 0
            ) {
                return null;
            }

            return {

                time,

                open,

                high,

                low,

                close,

                volume:
                    Number.isFinite(volume) &&
                    volume >= 0
                        ? volume
                        : 0

            };

        })
        .filter(Boolean);

}

// ============================================================
// EXPORT
// ============================================================

module.exports = {
    formatCandles
};