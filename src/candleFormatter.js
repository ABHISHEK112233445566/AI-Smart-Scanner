// ============================================================
// CANDLE FORMATTER V2
// ============================================================
// Purpose:
// - Convert raw broker candle arrays into standard candle objects
// - Validate input before formatting
// - Reject invalid/physically impossible OHLC values
// - Prevent NaN / invalid values reaching indicators and scanners
// - Preserve existing API
// ============================================================

function formatCandles(rawCandles) {
    if (!Array.isArray(rawCandles)) return [];

    return rawCandles
        .map(candle => {
            if (!Array.isArray(candle) || candle.length < 5) return null;

            const time = candle[0];
            const open = Number(candle[1]);
            const high = Number(candle[2]);
            const low = Number(candle[3]);
            const close = Number(candle[4]);
            const volume = Number(candle[5] ?? 0);

            // Required fields must be valid finite numbers.
            if (
                !time ||
                !Number.isFinite(open) ||
                !Number.isFinite(high) ||
                !Number.isFinite(low) ||
                !Number.isFinite(close)
            ) {
                return null;
            }

            // Prices cannot be negative or zero for normal NSE candles.
            if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
                return null;
            }

            // Fundamental OHLC relationship:
            // low <= open <= high and low <= close <= high.
            // Also reject an inverted high/low range.
            if (
                high < low ||
                open < low ||
                open > high ||
                close < low ||
                close > high
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
                    Number.isFinite(volume) && volume >= 0
                        ? volume
                        : 0
            };
        })
        .filter(Boolean);
}

module.exports = {
    formatCandles
};