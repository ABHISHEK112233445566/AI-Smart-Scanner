const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "../src/optionsDecisionEngine.js");
const source = fs.readFileSync(file, "utf8");

const start = source.indexOf("function getStockPrice(d) {");
const end = source.indexOf("function calculateRiskReward(entry, stopLoss, target1, type) {");

if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate STOCK LEVELS block in optionsDecisionEngine.js");
}

const replacement = String.raw`function getStockPrice(d) {
    return firstPositive(d.price, d.ltp, d.lastPrice, d.close, d.currentPrice);
}

// ============================================================
// MARKET-STRUCTURE LEVELS ONLY
// ============================================================
// No artificial percentage/ATR SL or targets are allowed here.
// Entry may fall back to the real current market price. SL/T1/T2
// must come from actual market-derived support/resistance/swing
// levels already present in scanner data. Missing levels => 0,
// which is intentionally rejected later instead of manufactured.
// ============================================================

const MARKET_LEVEL_KEYS = Object.freeze({
    support: [
        "support", "support1", "support2", "support3",
        "s1", "s2", "s3", "pivotS1", "pivotS2", "pivotS3",
        "swingLow", "swing_low", "previousLow", "prevLow",
        "recentLow", "dayLow", "low"
    ],
    resistance: [
        "resistance", "resistance1", "resistance2", "resistance3",
        "r1", "r2", "r3", "pivotR1", "pivotR2", "pivotR3",
        "swingHigh", "swing_high", "previousHigh", "prevHigh",
        "recentHigh", "dayHigh", "high"
    ]
});

function collectMarketLevels(d, side) {
    const keys = MARKET_LEVEL_KEYS[side] || [];
    const values = [];

    for (const key of keys) {
        const value = d?.[key];
        if (Array.isArray(value)) values.push(...value);
        else if (value && typeof value === "object") {
            for (const nested of Object.values(value)) {
                if (Array.isArray(nested)) values.push(...nested);
                else values.push(nested);
            }
        } else values.push(value);
    }

    // Also accept explicit scanner level collections when available.
    const collection = d?.[side === "support" ? "supportLevels" : "resistanceLevels"];
    if (Array.isArray(collection)) values.push(...collection);

    return uniqueSortedLevels(values);
}

function nearestBelow(levels, price) {
    return levels.filter(v => v < price).sort((a, b) => b - a)[0] || 0;
}

function nearestAbove(levels, price) {
    return levels.filter(v => v > price).sort((a, b) => a - b)[0] || 0;
}

function getStockEntry(d, price, type) {
    const supplied = firstPositive(d.entry, d.stockEntry, d.underlyingEntry);
    if (supplied) return supplied;
    // This is the real current underlying market price, not a synthetic level.
    return firstPositive(price);
}

function getStockStopLoss(d, entry, type) {
    if (!Number.isFinite(entry) || entry <= 0) return 0;

    if (type === "CALL") {
        return nearestBelow(collectMarketLevels(d, "support"), entry);
    }

    if (type === "PUT") {
        return nearestAbove(collectMarketLevels(d, "resistance"), entry);
    }

    return 0;
}

function getStockTarget1(d, entry, type) {
    if (!Number.isFinite(entry) || entry <= 0) return 0;

    if (type === "CALL") {
        return nearestAbove(collectMarketLevels(d, "resistance"), entry);
    }

    if (type === "PUT") {
        return nearestBelow(collectMarketLevels(d, "support"), entry);
    }

    return 0;
}

function getStockTarget2(d, entry, target1, type) {
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(target1) || target1 <= 0) return 0;

    if (type === "CALL") {
        return nearestAbove(collectMarketLevels(d, "resistance"), target1);
    }

    if (type === "PUT") {
        return nearestBelow(collectMarketLevels(d, "support"), target1);
    }

    return 0;
}

`;

const updated = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, updated, "utf8");
console.log("✅ Market-structure stock levels corrected.");
console.log("   Entry: real market price / supplied trigger");
console.log("   SL: nearest actual support/resistance");
console.log("   T1: nearest actual opposing level");
console.log("   T2: next actual market level");
console.log("   No ATR/percentage fallback is used for stock SL/T1/T2.");
