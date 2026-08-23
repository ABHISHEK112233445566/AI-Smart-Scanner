// ============================================================
// BROKER-INDEPENDENT INSTRUMENT SERVICE
// ============================================================
// Single delegation layer between scanner/options engine and broker.
// Keeps broker-specific logic inside broker adapters.
// ============================================================

let activeBroker = null;

function setBroker(broker) {
    if (!broker || typeof broker !== "object") {
        throw new Error("Invalid broker adapter supplied to instrumentService");
    }
    activeBroker = broker;
}

function getBroker() {
    if (!activeBroker) {
        throw new Error("No broker adapter configured for instrumentService");
    }
    return activeBroker;
}

function getBrokerName() {
    return activeBroker
        ? (activeBroker.name || activeBroker.brokerName || "UNKNOWN")
        : null;
}

function isBrokerConfigured() {
    return !!activeBroker;
}

function requireMethod(name) {
    const broker = getBroker();
    if (typeof broker[name] !== "function") {
        throw new Error(`Active broker does not implement instrument method: ${name}`);
    }
    return broker[name].bind(broker);
}

async function callBroker(name, ...args) {
    return await requireMethod(name)(...args);
}

function normalizeInstrument(instrument) {
    if (!instrument) return null;
    if (typeof instrument === "string") {
        const value = instrument.trim();
        return value ? { instrument_key: value } : null;
    }
    if (typeof instrument !== "object") return null;

    const key = instrument.instrument_key ||
        instrument.instrumentKey ||
        instrument.instrumentkey ||
        instrument.key || null;

    return key && !instrument.instrument_key
        ? { ...instrument, instrument_key: key }
        : instrument;
}

// ============================================================
// INSTRUMENT MASTER
// ============================================================

async function loadInstruments() {
    const broker = getBroker();

    // Upstox/modern adapters use loadInstruments().
    if (typeof broker.loadInstruments === "function") {
        return await broker.loadInstruments();
    }

    // Compatibility with older adapter interface.
    if (typeof broker.getInstrumentMaster === "function") {
        return await broker.getInstrumentMaster();
    }

    throw new Error("Active broker does not expose loadInstruments() or getInstrumentMaster()");
}

// ============================================================
// EQUITY INSTRUMENTS
// ============================================================

async function getInstrument(symbol) {
    if (symbol == null || symbol === "") return null;
    return normalizeInstrument(await callBroker("getInstrument", symbol));
}

async function getInstrumentKey(symbol) {
    if (symbol == null || symbol === "") return null;

    if (typeof symbol === "object") {
        const key = symbol.instrument_key || symbol.instrumentKey || symbol.instrumentkey || symbol.key;
        if (typeof key === "string" && key.trim()) return key.trim();
    }

    if (typeof symbol === "string" && symbol.includes("|")) {
        return symbol.trim();
    }

    const result = await callBroker("getInstrumentKey", symbol);
    if (typeof result === "string") return result.trim() || null;
    if (result && typeof result === "object") {
        const key = result.instrument_key || result.instrumentKey || result.instrumentkey || result.key;
        return typeof key === "string" ? key.trim() || null : null;
    }
    return null;
}

// ============================================================
// OPTION CONTRACTS
// ============================================================

async function getOptionContracts(symbol) {
    return await callBroker("getOptionContracts", symbol);
}

async function getOptionExpiries(symbol) {
    return await callBroker("getOptionExpiries", symbol);
}

async function getExpiryOptionContracts(symbol, expiry) {
    return await callBroker("getExpiryOptionContracts", symbol, expiry);
}

async function getValidOptionExpiry(symbol) {
    return await callBroker("getValidOptionExpiry", symbol);
}

async function getOptionContract(symbol, optionType, strike, expiry = null) {
    return await callBroker("getOptionContract", symbol, optionType, strike, expiry);
}

async function getOptionContractDetails(symbol, optionType, strike, expiry = null) {
    return await callBroker("getOptionContractDetails", symbol, optionType, strike, expiry);
}

async function getOptionLotSize(symbol, optionType, strike, expiry = null) {
    return await callBroker("getOptionLotSize", symbol, optionType, strike, expiry);
}

async function getOptionInstrumentKey(symbol, optionType, strike, expiry = null) {
    const result = await callBroker("getOptionInstrumentKey", symbol, optionType, strike, expiry);
    if (typeof result === "string") return result.trim() || null;
    if (result && typeof result === "object") {
        return result.instrument_key || result.instrumentKey || result.key || null;
    }
    return null;
}

async function getOptionStrikes(symbol, expiry, optionType = null) {
    return await callBroker("getOptionStrikes", symbol, expiry, optionType);
}

// ============================================================
// OPTION HELPERS
// ============================================================

function normalizeOptionType(optionType) {
    const broker = getBroker();
    if (typeof broker.normalizeOptionType === "function") {
        return broker.normalizeOptionType(optionType);
    }

    const type = String(optionType || "").trim().toUpperCase();
    if (type === "CALL" || type === "CE") return "CE";
    if (type === "PUT" || type === "PE") return "PE";
    return null;
}

function getOptionType(contract) {
    const broker = getBroker();
    if (typeof broker.getOptionType === "function") {
        return broker.getOptionType(contract);
    }
    if (!contract || typeof contract !== "object") return null;
    return normalizeOptionType(
        contract.option_type || contract.optionType || contract.type || contract.instrument_type
    );
}

function validateOptionContract(contract) {
    const broker = getBroker();
    if (typeof broker.validateOptionContract === "function") {
        return broker.validateOptionContract(contract);
    }
    if (!contract) return { valid: false, reason: "Contract not found" };
    if (typeof contract !== "object") return { valid: false, reason: "Invalid contract format" };
    return { valid: true, reason: null };
}

async function debugOptions(symbol) {
    return await callBroker("debugOptions", symbol);
}

module.exports = {
    setBroker,
    getBroker,
    isBrokerConfigured,
    getBrokerName,
    loadInstruments,
    getInstrument,
    getInstrumentKey,
    getOptionContracts,
    getOptionContract,
    getOptionContractDetails,
    getOptionLotSize,
    getOptionInstrumentKey,
    getOptionExpiries,
    getValidOptionExpiry,
    getExpiryOptionContracts,
    getOptionStrikes,
    getOptionType,
    validateOptionContract,
    normalizeOptionType,
    debugOptions
};
