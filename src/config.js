require("dotenv").config();

module.exports = {
    BROKER: (process.env.BROKER || "UPSTOX").trim().toUpperCase(),

    UPSTOX: {
        ACCESS_TOKEN: process.env.UPSTOX_ACCESS_TOKEN || ""
    },

    ANGELONE: {
        API_KEY: process.env.API_KEY || "",
        CLIENT_ID: process.env.CLIENT_ID || "",
        MPIN: process.env.MPIN || "",
        TOTP_SECRET: process.env.TOTP_SECRET || ""
    },

    API_KEY: process.env.API_KEY || "",
    CLIENT_ID: process.env.CLIENT_ID || "",
    MPIN: process.env.MPIN || "",
    TOTP_SECRET: process.env.TOTP_SECRET || "",
    GOOGLE_SHEET_URL: process.env.GOOGLE_SHEET_URL || "",

    // NIFTY100 is the permanent default universe.
    SCANNER_UNIVERSE: (process.env.SCANNER_UNIVERSE || "NIFTY100").trim().toUpperCase(),
    MAX_STOCKS: 0,

    EMA_PERIODS: [5, 9, 20, 50, 100, 200],
    EMA_SHORT: 20,
    EMA_LONG: 200,
    RSI_PERIOD: 14,
    MACD: { FAST: 12, SLOW: 26, SIGNAL: 9 },
    ADX_PERIOD: 14,
    ATR_PERIOD: 14,
    SUPERTREND: { ATR_PERIOD: 10, MULTIPLIER: 3 },
    BOLLINGER: { PERIOD: 20, STD_DEV: 2 },

    // Single score standard used throughout the scanner.
    // AI score range is -100 to +100:
    // +85 or higher = bullish qualification
    // -85 or lower = bearish qualification
    // -84 to +84 = not qualified
    THRESHOLDS: {
        AI_BUY_SCORE: 85,
        AI_SELL_SCORE: -85,
        AI_WATCH_SCORE: 60,
        DASHBOARD_MIN_SCORE: 85,
        DASHBOARD_MAX_ROWS: 10,
        MIN_CONFIDENCE: 70,
        MIN_RR: 1.5
    },

    AI_BUY_SCORE: 85,
    AI_SELL_SCORE: -85,
    AI_WATCH_SCORE: 60,
    DASHBOARD_MIN_SCORE: 85,
    DASHBOARD_MAX_ROWS: 10,

    // Single scheduler source of truth: scanner.js is run by scheduler.js every 30 minutes.
    SCHEDULER: {
        TIMEZONE: "Asia/Kolkata",
        START_HOUR: 9,
        START_MINUTE: 10,
        END_HOUR: 15,
        END_MINUTE: 30,
        INTERVAL_MINUTES: 30,
        TIMEOUT_MINUTES: 420
    }
};
