const core = require('./breakoutCore');
const { detectChartPattern } = require('./chartPatterns');
const patternContext = require('./patternContext');

function calculateBreakout(candles, indicators = {}, sr = {}) {
    const result = core.calculateBreakout(candles, indicators, sr) || {};
    let pattern;
    try {
        pattern = detectChartPattern(candles);
        if (pattern && Array.isArray(candles) && candles.length) patternContext.set(candles, pattern);
    } catch (_) {
        pattern = null;
    }
    return pattern ? { ...result, ...pattern } : result;
}

const detectBreakout = calculateBreakout;
module.exports = { calculateBreakout, detectBreakout };
