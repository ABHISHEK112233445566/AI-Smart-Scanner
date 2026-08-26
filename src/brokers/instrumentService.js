// ============================================================
// BROKER-INDEPENDENT INSTRUMENT SERVICE
// ============================================================
// Single delegation layer between scanner/options engine and broker.
// The service validates and normalizes instrument data at the boundary
// so missing/invalid broker responses do not silently propagate.
// ============================================================

let activeBroker = null;

function setBroker(broker) {
    if (!broker || typeof broker !== "object") throw new Error("Invalid broker adapter supplied to instrumentService");
    activeBroker = broker;
}

function getBroker() {
    if (!activeBroker) throw new Error("No broker adapter configured for instrumentService");
    return activeBroker;
}

function getBrokerName() {
    return activeBroker ? (activeBroker.name || activeBroker.brokerName || "UNKNOWN") : null;
}

function isBrokerConfigured() { return !!activeBroker; }

function requireMethod(name) {
    const broker = getBroker();
    if (typeof broker[name] !== "function") throw new Error(`Active broker does not implement instrument method: ${name}`);
    return broker[name].bind(broker);
}

async function callBroker(name, ...args) { return await requireMethod(name)(...args); }

function normalizeInstrument(instrument) {
    if (!instrument) return null;
    if (typeof instrument === "string") {
        const value = instrument.trim();
        return value ? { instrument_key: value } : null;
    }
    if (typeof instrument !== "object") return null;
    const key = instrument.instrument_key || instrument.instrumentKey || instrument.instrumentkey || instrument.key || null;
    if (typeof key !== "string" || !key.trim()) return null;
    return instrument.instrument_key === key ? instrument : { ...instrument, instrument_key: key.trim() };
}

function cleanSymbol(symbol) {
    if (symbol && typeof symbol === "object") {
        return String(symbol.trading_symbol || symbol.tradingSymbol || symbol.symbol || symbol.tradingsymbol || "").trim().toUpperCase();
    }
    return String(symbol ?? "").trim().toUpperCase();
}

async function loadInstruments() {
    const broker = getBroker();
    if (typeof broker.loadInstruments === "function") return await broker.loadInstruments();
    if (typeof broker.getInstrumentMaster === "function") return await broker.getInstrumentMaster();
    throw new Error("Active broker does not expose loadInstruments() or getInstrumentMaster()");
}

async function getInstrument(symbol) {
    const value = cleanSymbol(symbol);
    if (!value) return null;
    const result = await callBroker("getInstrument", value);
    return normalizeInstrument(result);
}

async function getInstrumentKey(symbol) {
    if (symbol && typeof symbol === "object") {
        const direct = symbol.instrument_key || symbol.instrumentKey || symbol.instrumentkey || symbol.key;
        if (typeof direct === "string" && direct.trim()) return direct.trim();
    }
    const value = cleanSymbol(symbol);
    if (!value) return null;
    if (value.includes("|")) return value;
    const result = await callBroker("getInstrumentKey", value);
    if (typeof result === "string") return result.trim() || null;
    if (result && typeof result === "object") {
        const key = result.instrument_key || result.instrumentKey || result.instrumentkey || result.key;
        return typeof key === "string" ? key.trim() || null : null;
    }
    return null;
}

async function getOptionContracts(symbol) { return await callBroker("getOptionContracts", cleanSymbol(symbol)); }
async function getOptionExpiries(symbol) { return await callBroker("getOptionExpiries", cleanSymbol(symbol)); }
async function getExpiryOptionContracts(symbol, expiry) { return await callBroker("getExpiryOptionContracts", cleanSymbol(symbol), expiry); }
async function getValidOptionExpiry(symbol) { return await callBroker("getValidOptionExpiry", cleanSymbol(symbol)); }
async function getOptionContract(symbol, optionType, strike, expiry = null) { return await callBroker("getOptionContract", cleanSymbol(symbol), optionType, strike, expiry); }
async function getOptionContractDetails(symbol, optionType, strike, expiry = null) { return await callBroker("getOptionContractDetails", cleanSymbol(symbol), optionType, strike, expiry); }
async function getOptionLotSize(symbol, optionType, strike, expiry = null) { return await callBroker("getOptionLotSize", cleanSymbol(symbol), optionType, strike, expiry); }

async function getOptionInstrumentKey(symbol, optionType, strike, expiry = null) {
    const result = await callBroker("getOptionInstrumentKey", cleanSymbol(symbol), optionType, strike, expiry);
    if (typeof result === "string") return result.trim() || null;
    if (result && typeof result === "object") return result.instrument_key || result.instrumentKey || result.key || null;
    return null;
}

async function getOptionStrikes(symbol, expiry, optionType = null) { return await callBroker("getOptionStrikes", cleanSymbol(symbol), expiry, optionType); }

function normalizeOptionType(optionType) {
    const broker = getBroker();
    if (typeof broker.normalizeOptionType === "function") return broker.normalizeOptionType(optionType);
    const type = String(optionType || "").trim().toUpperCase();
    if (type === "CALL" || type === "CE") return "CE";
    if (type === "PUT" || type === "PE") return "PE";
    return null;
}

function getOptionType(contract) {
    const broker = getBroker();
    if (typeof broker.getOptionType === "function") return broker.getOptionType(contract);
    if (!contract || typeof contract !== "object") return null;
    return normalizeOptionType(contract.option_type || contract.optionType || contract.type || contract.instrument_type || contract.trading_symbol || contract.tradingsymbol);
}

function validateOptionContract(contract) {
    const broker = getBroker();
    if (typeof broker.validateOptionContract === "function") return broker.validateOptionContract(contract);
    if (!contract || typeof contract !== "object") return { valid: false, reason: "Contract not found or invalid" };
    const key = contract.instrument_key || contract.instrumentKey || contract.key;
    const strike = Number(contract.strike ?? contract.strike_price ?? contract.strikePrice);
    const type = getOptionType(contract);
    if (!key || !Number.isFinite(strike) || strike <= 0 || !type) return { valid: false, reason: "Missing instrument key, strike, or option type" };
    return { valid: true, reason: null };
}

async function debugOptions(symbol) { return await callBroker("debugOptions", cleanSymbol(symbol)); }

module.exports = {
    setBroker, getBroker, isBrokerConfigured, getBrokerName, loadInstruments,
    getInstrument, getInstrumentKey, getOptionContracts, getOptionContract,
    getOptionContractDetails, getOptionLotSize, getOptionInstrumentKey,
    getOptionExpiries, getValidOptionExpiry, getExpiryOptionContracts,
    getOptionStrikes, getOptionType, validateOptionContract, normalizeOptionType,
    debugOptions
};
