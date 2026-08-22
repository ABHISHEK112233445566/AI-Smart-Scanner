// ============================================================
// UNIVERSE ENGINE V4
// ============================================================
// Builds one unique scan universe from configurable lists.
// A symbol appearing in multiple universes is scanned once.
// ============================================================

const universeConfig = require("./universeConfig");
const symbols = require("./symbols");

function normalizeSymbol(symbol) {
    return String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/-EQ$/i, "");
}

function uniqueSymbols(list) {
    const seen = new Set();
    const result = [];

    for (const item of list || []) {
        const symbol = normalizeSymbol(
            typeof item === "string" ? item : item.symbol
        );

        if (!symbol || seen.has(symbol)) continue;

        seen.add(symbol);
        result.push(
            typeof item === "string"
                ? symbol
                : { ...item, symbol }
        );
    }

    return result;
}

function getStockUniverse() {
    const selected = [];

    for (const [name, enabled] of Object.entries(
        universeConfig.STOCK_UNIVERSES
    )) {
        if (!enabled) continue;

        const source = symbols[name];
        if (!source) continue;

        if (typeof source === "function") {
            // CUSTOM is async and is resolved by getStockUniverseAsync().
            continue;
        }

        selected.push(...source);
    }

    return uniqueSymbols(selected);
}

async function getStockUniverseAsync() {
    const selected = [];

    for (const [name, enabled] of Object.entries(
        universeConfig.STOCK_UNIVERSES
    )) {
        if (!enabled) continue;

        const source = symbols[name];
        if (!source) continue;

        if (typeof source === "function") {
            const result = await source();
            selected.push(...(result || []));
        } else {
            selected.push(...source);
        }
    }

    return uniqueSymbols(selected);
}

function getEnabledIndexOptions() {
    return Object.entries(universeConfig.INDEX_OPTIONS)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
}

module.exports = {
    normalizeSymbol,
    uniqueSymbols,
    getStockUniverse,
    getStockUniverseAsync,
    getEnabledIndexOptions
};
