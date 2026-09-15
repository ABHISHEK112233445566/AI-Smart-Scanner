// Shared in-process chart-pattern context.
// scanner.js currently keeps breakout results local, so this module safely
// bridges the pattern result from breakout.js to rankingEngine.js.
const cache = new Map();
const MAX_ENTRIES = 2000;

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function keyFromCandles(candles) {
    if (!Array.isArray(candles) || !candles.length) return '';
    const last = candles[candles.length - 1] || {};
    const prev = candles.length > 1 ? candles[candles.length - 2] || {} : {};
    return [num(last.close), num(last.high), num(last.low), num(last.volume), num(prev.close), num(prev.high), num(prev.low)].join('|');
}

function set(candles, pattern) {
    const key = keyFromCandles(candles);
    if (!key || !pattern) return;
    const last = candles[candles.length - 1] || {};
    const prev = candles.length > 1 ? candles[candles.length - 2] || {} : {};
    cache.set(key, {
        ...pattern,
        close: num(last.close),
        volume: num(last.volume),
        previousClose: num(prev.close),
        cachedAt: Date.now()
    });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

function getForStock(stock) {
    if (!stock || typeof stock !== 'object') return null;
    const price = num(stock.price ?? stock.currentPrice);
    const previousClose = num(stock.previousClose);
    const volume = num(stock.volume);
    for (const value of cache.values()) {
        if (value.close === price && value.previousClose === previousClose && value.volume === volume) return value;
    }
    return null;
}

function clear() { cache.clear(); }

module.exports = { set, getForStock, keyFromCandles, clear };
