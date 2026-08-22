// ============================================================
// SCANNER UNIVERSE CONFIGURATION V4
// ============================================================
// Enable/disable universes without changing scanner logic.
// Duplicate symbols are removed by the universe engine.
//
// STOCK UNIVERSES
// ------------------------------------------------------------
// NIFTY50 / NIFTY100 are populated from src/symbols/.
// NIFTY200 / NIFTY500 are intentionally empty until their
// verified constituent lists are added.
//
// INDEX OPTIONS
// ------------------------------------------------------------
// NIFTY and BANKNIFTY are enabled independently from stocks.
// ============================================================

module.exports = {

    STOCK_UNIVERSES: {
        CUSTOM: false,
        NIFTY50: true,
        NIFTY100: false,
        NIFTY200: false,
        NIFTY500: false
    },

    INDEX_OPTIONS: {
        NIFTY: true,
        BANKNIFTY: true
    },

    // Maximum symbols allowed into the deep-analysis stage.
    // Fast scanning may cover the complete enabled universe.
    DEEP_SCAN_LIMIT: 30,

    // Keep true so the master scanner can retain every valid
    // fast/deep result instead of showing only trade candidates.
    MASTER_SCANNER_KEEP_ALL: true

};
