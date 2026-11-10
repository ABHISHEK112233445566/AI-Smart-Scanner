const core = require('./breakoutCore');
const { detectChartPattern } = require('./chartPatterns');
const patternContext = require('./patternContext');

function calculateBreakout(candles, indicators = {}, sr = {}) {
    const result = core.calculateBreakout(candles, indicators, sr) || {};
    let pattern;
    let patternDetectionStatus = "NOT_DETECTED";
    let patternDetectionError = "";
    try {
        pattern = detectChartPattern(candles);
        if (pattern && Array.isArray(candles) && candles.length) {
            patternContext.set(candles, pattern);
            patternDetectionStatus = "DETECTED";
        }
    } catch (error) {
        pattern = null;
        patternDetectionStatus = "CALCULATION_FAILED";
        patternDetectionError = String(error?.message || error);
    }
    return { ...result, ...(pattern || {}), patternDetectionStatus, patternDetectionError };
}

const detectBreakout = calculateBreakout;
module.exports = { calculateBreakout, detectBreakout };
