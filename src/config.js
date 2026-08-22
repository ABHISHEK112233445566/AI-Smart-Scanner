require("dotenv").config();

module.exports = {

    // ========================================================
    // BROKER CONFIGURATION
    // ========================================================

    BROKER: (
        process.env.BROKER || "UPSTOX"
    ).trim().toUpperCase(),

    // ========================================================
    // UPSTOX
    // ========================================================

    UPSTOX: {
        ACCESS_TOKEN:
            process.env.UPSTOX_ACCESS_TOKEN || ""
    },

    // ========================================================
    // ANGEL ONE
    // ========================================================

    ANGELONE: {
        API_KEY: process.env.API_KEY || "",
        CLIENT_ID: process.env.CLIENT_ID || "",
        MPIN: process.env.MPIN || "",
        TOTP_SECRET: process.env.TOTP_SECRET || ""
    },

    // Backward compatibility
    API_KEY: process.env.API_KEY || "",
    CLIENT_ID: process.env.CLIENT_ID || "",
    MPIN: process.env.MPIN || "",
    TOTP_SECRET: process.env.TOTP_SECRET || "",

    // ========================================================
    // GOOGLE SHEET
    // ========================================================

    GOOGLE_SHEET_URL:
        process.env.GOOGLE_SHEET_URL || "",

    // ========================================================
    // STOCK UNIVERSE
    // ========================================================
    // NIFTY50 / NIFTY100 / BANKNIFTY / CUSTOM use maintained
    // universe files. ALL_NSE uses the active broker instrument
    // master and therefore is not limited to a hard-coded list.

    SCANNER_UNIVERSE: (
        process.env.SCANNER_UNIVERSE || "NIFTY100"
    ).trim().toUpperCase(),

    SCANNER_INTERVAL: 60,

    // 0 = no artificial stock-count limit.
    // The scanner may still be constrained by broker/API rate limits.
    MAX_STOCKS: 0,

    // ========================================================
    // TECHNICAL INDICATORS
    // ========================================================

    EMA_PERIODS: [5, 9, 20, 50, 100, 200],
    EMA_SHORT: 20,
    EMA_LONG: 200,
    RSI_PERIOD: 14,

    MACD: {
        FAST: 12,
        SLOW: 26,
        SIGNAL: 9
    },

    ADX_PERIOD: 14,
    ATR_PERIOD: 14,

    SUPERTREND: {
        ATR_PERIOD: 10,
        MULTIPLIER: 3
    },

    BOLLINGER: {
        PERIOD: 20,
        STD_DEV: 2
    },

    // ========================================================
    // AI / SCANNER SCORE THRESHOLDS
    // ========================================================

    AI_BUY_SCORE: 80,
    AI_WATCH_SCORE: 60,

    // ========================================================
    // DASHBOARD
    // ========================================================

    DASHBOARD_MIN_SCORE: 90,
    DASHBOARD_MAX_ROWS: 10

};