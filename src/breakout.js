const core = require('./breakoutCore');
const { detectChartPattern } = require('./chartPatterns');

function calculateBreakout(candles, indicators = {}, sr = {}) {
    const result = core.calculateBreakout(candles, indicators, sr) || {};
    let pattern;
    try { pattern = detectChartPattern(candles); } catch (_) { pattern = null; }
    return pattern ? { ...result, ...pattern } : result;
}

const detectBreakout = calculateBreakout;
module.exports = { calculateBreakout, detectBreakout };