// ============================================================
// BROKER-INDEPENDENT INSTRUMENT SERVICE
// ============================================================
//
// Purpose:
//
// optionsDecisionEngine
//        ↓
// instrumentService
//        ↓
// active broker adapter
//        ↓
// Angel One / Upstox / Future Broker
//
// IMPORTANT:
// - NO broker-specific API implementation here
// - All broker-specific work stays inside broker adapters
// - All calls are safely delegated to the active broker
// - Promise/object instrument responses are normalized
// - Existing interfaces are preserved
// ============================================================

let activeBroker = null;


// ============================================================
// SET ACTIVE BROKER
// ============================================================

function setBroker(broker) {

    if (
        !broker ||
        typeof broker !== "object"
    ) {

        throw new Error(
            "Invalid broker adapter supplied to instrumentService"
        );

    }

    activeBroker = broker;

    console.log(
        `🔌 Instrument Service connected to broker: ${
            broker.name ||
            broker.brokerName ||
            "ACTIVE BROKER"
        }`
    );

}


// ============================================================
// GET ACTIVE BROKER
// ============================================================

function getBroker() {

    if (!activeBroker) {

        throw new Error(
            "No broker adapter configured for instrumentService"
        );

    }

    return activeBroker;

}


// ============================================================
// CHECK BROKER METHOD
// ============================================================

function requireMethod(
    methodName
) {

    const broker =
        getBroker();


    if (
        typeof broker[methodName] !==
        "function"
    ) {

        throw new Error(
            `Active broker does not implement instrument method: ${methodName}`
        );

    }


    return broker[
        methodName
    ].bind(broker);

}


// ============================================================
// SAFE ASYNC DELEGATION
// ============================================================
//
// Prevents:
// - accidental [object Promise]
// - unhandled synchronous errors
// - inconsistent sync/async broker adapters
// ============================================================

async function callBroker(
    methodName,
    ...args
) {

    const method =
        requireMethod(
            methodName
        );

    return await method(
        ...args
    );

}


// ============================================================
// NORMALIZE INSTRUMENT RESULT
// ============================================================
//
// Returns a consistent instrument object where possible.
// Does NOT invent missing broker data.
// ============================================================

function normalizeInstrument(
    instrument
) {

    if (
        !instrument
    ) {

        return null;
    }


    if (
        typeof instrument === "string"
    ) {

        const value =
            instrument.trim();

        if (!value) {
            return null;
        }

        return {
            instrument_key: value
        };

    }


    if (
        typeof instrument !== "object"
    ) {

        return null;
    }


    const instrumentKey =
        instrument.instrument_key ||
        instrument.instrumentKey ||
        instrument.instrumentkey ||
        instrument.key ||
        null;


    if (
        instrumentKey &&
        !instrument.instrument_key
    ) {

        return {
            ...instrument,
            instrument_key:
                instrumentKey
        };

    }


    return instrument;

}


// ============================================================
// LOAD INSTRUMENTS
// ============================================================

async function loadInstruments() {

    return await callBroker(
        "loadInstruments"
    );

}


// ============================================================
// GET EQUITY INSTRUMENT
// ============================================================

async function getInstrument(
    symbol
) {

    if (
        symbol === null ||
        symbol === undefined
    ) {

        return null;
    }


    const result =
        await callBroker(
            "getInstrument",
            symbol
        );


    return normalizeInstrument(
        result
    );

}


// ============================================================
// GET EQUITY INSTRUMENT KEY
// ============================================================

async function getInstrumentKey(
    symbol
) {

    if (
        symbol === null ||
        symbol === undefined
    ) {

        return null;
    }


    // --------------------------------------------------------
    // Already supplied as an instrument object
    // --------------------------------------------------------

    if (
        typeof symbol === "object"
    ) {

        const key =
            symbol.instrument_key ||
            symbol.instrumentKey ||
            symbol.instrumentkey ||
            symbol.key ||
            null;

        if (
            typeof key === "string" &&
            key.trim()
        ) {

            return key.trim();

        }

    }


    // --------------------------------------------------------
    // Already supplied as instrument key
    // --------------------------------------------------------

    if (
        typeof symbol === "string" &&
        symbol.includes("|")
    ) {

        return symbol.trim();

    }


    // --------------------------------------------------------
    // Ask broker
    // --------------------------------------------------------

    const result =
        await callBroker(
            "getInstrumentKey",
            symbol
        );


    // --------------------------------------------------------
    // Normalize broker response
    // --------------------------------------------------------

    if (
        typeof result === "string"
    ) {

        return result.trim() || null;

    }


    if (
        result &&
        typeof result === "object"
    ) {

        const key =
            result.instrument_key ||
            result.instrumentKey ||
            result.instrumentkey ||
            result.key ||
            null;


        if (
            typeof key === "string"
        ) {

            return key.trim() || null;

        }

    }


    return null;

}


// ============================================================
// GET OPTION CONTRACTS
// ============================================================

async function getOptionContracts(
    symbol
) {

    return await callBroker(
        "getOptionContracts",
        symbol
    );

}


// ============================================================
// GET ALL OPTION EXPIRIES
// ============================================================

async function getOptionExpiries(
    symbol
) {

    return await callBroker(
        "getOptionExpiries",
        symbol
    );

}


// ============================================================
// GET CONTRACTS FOR EXPIRY
// ============================================================

async function getExpiryOptionContracts(
    symbol,
    expiry
) {

    return await callBroker(
        "getExpiryOptionContracts",
        symbol,
        expiry
    );

}


// ============================================================
// GET VALID OPTION EXPIRY
// ============================================================

async function getValidOptionExpiry(
    symbol
) {

    return await callBroker(
        "getValidOptionExpiry",
        symbol
    );

}


// ============================================================
// GET OPTION CONTRACT
// ============================================================
//
// Supports both:
// symbol, optionType, strike, expiry
//
// Broker adapter remains responsible for interpretation.
// ============================================================

async function getOptionContract(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    return await callBroker(
        "getOptionContract",
        symbol,
        optionType,
        strike,
        expiry
    );

}


// ============================================================
// GET OPTION CONTRACT DETAILS
// ============================================================

async function getOptionContractDetails(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    return await callBroker(
        "getOptionContractDetails",
        symbol,
        optionType,
        strike,
        expiry
    );

}


// ============================================================
// GET OPTION LOT SIZE
// ============================================================

async function getOptionLotSize(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    return await callBroker(
        "getOptionLotSize",
        symbol,
        optionType,
        strike,
        expiry
    );

}


// ============================================================
// GET OPTION INSTRUMENT KEY
// ============================================================

async function getOptionInstrumentKey(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    const result =
        await callBroker(
            "getOptionInstrumentKey",
            symbol,
            optionType,
            strike,
            expiry
        );


    if (
        typeof result === "string"
    ) {

        return result.trim() || null;

    }


    if (
        result &&
        typeof result === "object"
    ) {

        return (
            result.instrument_key ||
            result.instrumentKey ||
            result.key ||
            null
        );

    }


    return null;

}


// ============================================================
// GET OPTION STRIKES
// ============================================================

async function getOptionStrikes(
    symbol,
    expiry,
    optionType = null
) {

    return await callBroker(
        "getOptionStrikes",
        symbol,
        expiry,
        optionType
    );

}


// ============================================================
// OPTION TYPE NORMALIZATION
// ============================================================

function normalizeOptionType(
    optionType
) {

    const broker =
        getBroker();


    if (
        typeof broker.normalizeOptionType ===
        "function"
    ) {

        return broker.normalizeOptionType(
            optionType
        );

    }


    const type =
        String(
            optionType || ""
        )
            .trim()
            .toUpperCase();


    if (
        type === "CALL" ||
        type === "CE"
    ) {

        return "CE";

    }


    if (
        type === "PUT" ||
        type === "PE"
    ) {

        return "PE";

    }


    return null;

}


// ============================================================
// GET OPTION TYPE
// ============================================================

function getOptionType(
    contract
) {

    const broker =
        getBroker();


    if (
        typeof broker.getOptionType ===
        "function"
    ) {

        return broker.getOptionType(
            contract
        );

    }


    if (
        !contract ||
        typeof contract !== "object"
    ) {

        return null;

    }


    const value =
        contract.option_type ||
        contract.optionType ||
        contract.type ||
        contract.instrument_type ||
        null;


    return normalizeOptionType(
        value
    );

}


// ============================================================
// VALIDATE OPTION CONTRACT
// ============================================================

function validateOptionContract(
    contract
) {

    const broker =
        getBroker();


    if (
        typeof broker.validateOptionContract ===
        "function"
    ) {

        return broker.validateOptionContract(
            contract
        );

    }


    if (
        !contract
    ) {

        return {

            valid: false,

            reason:
                "Contract not found"

        };

    }


    if (
        typeof contract !== "object"
    ) {

        return {

            valid: false,

            reason:
                "Invalid contract format"

        };

    }


    const instrumentKey =
        contract.instrument_key ||
        contract.instrumentKey ||
        contract.key ||
        null;


    if (
        instrumentKey &&
        typeof instrumentKey === "string"
    ) {

        return {

            valid: true,

            reason: null

        };

    }


    // --------------------------------------------------------
    // Some brokers may not expose instrument_key.
    // Do not reject an otherwise valid broker contract here.
    // --------------------------------------------------------

    return {

        valid: true,

        reason: null

    };

}


// ============================================================
// DEBUG OPTIONS
// ============================================================

async function debugOptions(
    symbol
) {

    return await callBroker(
        "debugOptions",
        symbol
    );

}


// ============================================================
// BROKER STATUS
// ============================================================

function isBrokerConfigured() {

    return (
        activeBroker !== null
    );

}


function getBrokerName() {

    if (
        !activeBroker
    ) {

        return null;

    }


    return (
        activeBroker.name ||
        activeBroker.brokerName ||
        null
    );

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    // Broker connection

    setBroker,

    getBroker,

    isBrokerConfigured,

    getBrokerName,


    // Instruments

    loadInstruments,

    getInstrument,

    getInstrumentKey,


    // Options

    getOptionContracts,

    getOptionContract,

    getOptionContractDetails,

    getOptionLotSize,

    getOptionInstrumentKey,

    getOptionExpiries,

    getValidOptionExpiry,

    getExpiryOptionContracts,

    getOptionStrikes,


    // Helpers

    getOptionType,

    validateOptionContract,

    normalizeOptionType,

    debugOptions

};