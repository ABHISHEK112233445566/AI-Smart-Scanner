// ============================================================
// SYMBOL SERVICE
// ============================================================
// Broker-neutral symbol registry.
// Upstox is the primary broker. Angel One is only a fallback
// instrument source when explicitly requested by the broker layer.
// This service must NOT force an Angel One network dependency when
// Upstox is active.
// ============================================================

let symbolMaster = [];

function normalizeSymbol(value) {
    return String(value || "").trim().toUpperCase().replace(/-EQ$/, "");
}

function setSymbolMaster(symbols) {
    symbolMaster = Array.isArray(symbols) ? symbols : [];
    return symbolMaster;
}

function getSymbolToken(stockName) {
    const symbol = normalizeSymbol(stockName);
    return symbolMaster.find(s => {
        const candidate = normalizeSymbol(s?.symbol || s?.tradingSymbol || s?.tradingsymbol || s?.name);
        return candidate === symbol && (!s?.exchange || String(s.exchange).toUpperCase() === "NSE" || s?.exch_seg === "NSE");
    }) || null;
}

function getAllSymbols() {
    return [...symbolMaster];
}

function hasSymbols() {
    return symbolMaster.length > 0;
}

// Backward-compatible API. The old implementation downloaded the Angel One
// master file directly from this module. That caused an unnecessary external
// dependency even when Upstox was the active broker. Loading is now explicit:
// the active broker/instrument adapter should call setSymbolMaster().
async function loadSymbolMaster(provider) {
    if (hasSymbols()) return symbolMaster;
    if (provider && typeof provider.loadInstruments === "function") {
        const result = await provider.loadInstruments();
        return setSymbolMaster(result);
    }
    return symbolMaster;
}

module.exports = {
    loadSymbolMaster,
    setSymbolMaster,
    getSymbolToken,
    getAllSymbols,
    hasSymbols,
    normalizeSymbol
};
