// ============================================================
// BROKER INDEX / BROKER MANAGER
// ============================================================
//
// Purpose:
// - Keep scanner broker-independent
// - Select active broker
// - Synchronize active broker with instrumentService
// - Expose common broker interface
// - Forward instruments
// - Forward historical data
// - Forward quotes
// - Forward option functions
// - Forward OI / mood
//
// Supported brokers:
// - Angel One
// - Upstox
//
// IMPORTANT:
// Scanner should communicate only with this file.
//
// Broker-specific implementation stays inside:
//   brokers/angelone.js
//   brokers/upstox.js
//
// IMPORTANT FIX:
// When setBroker() is called, the selected broker is ALSO
// registered inside instrumentService.
//
// This prevents:
//   "No broker adapter configured for instrumentService"
// ============================================================


const angelOne = require("./angelone");
const upstox = require("./upstox");
const instrumentService = require("./instrumentService");


// ============================================================
// BROKER REGISTRY
// ============================================================

const brokers = Object.freeze({

    ANGELONE: angelOne,

    ANGEL_ONE: angelOne,

    UPSTOX: upstox

});


// ============================================================
// ACTIVE BROKER
// ============================================================

let activeBroker = null;


// ============================================================
// NORMALIZE BROKER NAME
// ============================================================

function normalizeBrokerName(
    brokerName
) {

    return String(
        brokerName || ""
    )
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");

}


// ============================================================
// VALIDATE BROKER ADAPTER
// ============================================================

function validateBrokerAdapter(
    broker
) {

    if (
        !broker ||
        typeof broker !== "object"
    ) {

        throw new Error(
            "Invalid broker adapter"
        );

    }


    // --------------------------------------------------------
    // Required scanner interface
    // --------------------------------------------------------

    const requiredFunctions = [

        "getHistoricalData",

        "getQuote",

        "getInstrument",

        "getInstrumentKey"

    ];


    const missing =
        requiredFunctions.filter(
            functionName =>
                typeof broker[
                    functionName
                ] !== "function"
        );


    if (
        missing.length > 0
    ) {

        throw new Error(
            `Broker adapter ${
                broker.name ||
                "UNKNOWN"
            } missing required functions: ${
                missing.join(", ")
            }`
        );

    }


    return true;

}


// ============================================================
// SET BROKER
// ============================================================
//
// IMPORTANT:
//
// This function now synchronizes:
//
// brokers/index.js
//        ↓
// instrumentService.js
//
// Both MUST point to the SAME broker adapter.
//
// ============================================================

function setBroker(
    broker
) {

    let selectedBroker = null;

    let brokerLabel = null;


    // --------------------------------------------------------
    // Already a broker adapter object
    // --------------------------------------------------------

    if (
        broker &&
        typeof broker === "object"
    ) {

        selectedBroker =
            broker;

        brokerLabel =
            broker.name ||
            broker.brokerName ||
            "CUSTOM";

    }


    // --------------------------------------------------------
    // Broker name
    // --------------------------------------------------------

    else {

        const brokerName =
            normalizeBrokerName(
                broker
            );


        if (!brokerName) {

            throw new Error(
                "Broker name is required"
            );

        }


        selectedBroker =
            brokers[
                brokerName
            ];


        if (!selectedBroker) {

            throw new Error(
                `Unsupported broker: ${broker}`
            );

        }


        brokerLabel =
            selectedBroker.name ||
            selectedBroker.brokerName ||
            brokerName;

    }


    // --------------------------------------------------------
    // Validate BEFORE replacing active broker
    // --------------------------------------------------------

    validateBrokerAdapter(
        selectedBroker
    );


    // --------------------------------------------------------
    // IMPORTANT:
    // Synchronize instrumentService FIRST
    // --------------------------------------------------------
    //
    // If this fails, we do NOT update the manager's
    // activeBroker. This prevents the two services from
    // getting out of sync.
    //
    // --------------------------------------------------------

    instrumentService.setBroker(
        selectedBroker
    );


    // --------------------------------------------------------
    // Set active broker
    // --------------------------------------------------------

    activeBroker =
        selectedBroker;


    // --------------------------------------------------------
    // Verification log
    // --------------------------------------------------------

    console.log(
        `✅ Active broker set: ${brokerLabel}`
    );


    console.log(
        `🔌 Instrument Service broker: ${
            instrumentService.getBrokerName() ||
            "UNKNOWN"
        }`
    );


    return activeBroker;

}


// ============================================================
// GET BROKER
// ============================================================

function getBroker() {

    if (!activeBroker) {

        throw new Error(
            "No active broker configured. Call setBroker() before using broker services."
        );

    }


    return activeBroker;

}


// ============================================================
// GET ACTIVE BROKER
// ============================================================

function getActiveBroker() {

    return getBroker();

}


// ============================================================
// VALIDATE ACTIVE BROKER
// ============================================================

function validateBroker() {

    const broker =
        getBroker();


    return validateBrokerAdapter(
        broker
    );

}


// ============================================================
// LOGIN
// ============================================================

async function login() {

    const broker =
        getBroker();


    if (
        typeof broker.login !==
        "function"
    ) {

        throw new Error(
            `Broker ${
                broker.name ||
                "UNKNOWN"
            } does not expose login()`
        );

    }


    return await broker.login();

}


// ============================================================
// LOAD INSTRUMENTS
// ============================================================

async function loadInstruments() {

    const broker =
        getBroker();


    if (
        typeof broker.loadInstruments !==
        "function"
    ) {

        throw new Error(
            `Broker ${
                broker.name ||
                "UNKNOWN"
            } does not expose loadInstruments()`
        );

    }


    return await broker.loadInstruments();

}


// ============================================================
// GET ACCESS TOKEN
// ============================================================

function getAccessToken() {

    const broker =
        getBroker();


    if (
        typeof broker.getAccessToken !==
        "function"
    ) {

        throw new Error(
            `Broker ${
                broker.name ||
                "UNKNOWN"
            } does not expose getAccessToken()`
        );

    }


    return broker.getAccessToken();

}


// ============================================================
// GENERIC ASYNC FORWARDER
// ============================================================

async function forwardAsync(
    functionName,
    args
) {

    const broker =
        getBroker();


    if (
        typeof broker[
            functionName
        ] !== "function"
    ) {

        throw new Error(
            `Broker ${
                broker.name ||
                "UNKNOWN"
            } does not expose ${functionName}()`
        );

    }


    return await broker[
        functionName
    ](
        ...args
    );

}


// ============================================================
// GENERIC SYNC FORWARDER
// ============================================================

function forwardSync(
    functionName,
    args
) {

    const broker =
        getBroker();


    if (
        typeof broker[
            functionName
        ] !== "function"
    ) {

        throw new Error(
            `Broker ${
                broker.name ||
                "UNKNOWN"
            } does not expose ${functionName}()`
        );

    }


    return broker[
        functionName
    ](
        ...args
    );

}


// ============================================================
// INSTRUMENTS
// ============================================================

async function getInstrument(
    symbol
) {

    return await forwardAsync(
        "getInstrument",
        [symbol]
    );

}


async function getInstrumentKey(
    symbol
) {

    return await forwardAsync(
        "getInstrumentKey",
        [symbol]
    );

}


// ============================================================
// MARKET DATA
// ============================================================

async function getHistoricalData(
    symbol,
    interval = "ONE_DAY"
) {

    return await forwardAsync(
        "getHistoricalData",
        [
            symbol,
            interval
        ]
    );

}


async function getQuote(
    symbol
) {

    return await forwardAsync(
        "getQuote",
        [symbol]
    );

}


// ============================================================
// OPTION CONTRACTS
// ============================================================

async function getOptionContracts(
    symbol
) {

    return await forwardAsync(
        "getOptionContracts",
        [symbol]
    );

}


async function getOptionContract(
    ...args
) {

    return await forwardAsync(
        "getOptionContract",
        args
    );

}


async function getOptionContractBySymbol(
    ...args
) {

    return await forwardAsync(
        "getOptionContractBySymbol",
        args
    );

}


async function getOptionLTP(
    ...args
) {

    return await forwardAsync(
        "getOptionLTP",
        args
    );

}


async function getOptionQuote(
    ...args
) {

    return await forwardAsync(
        "getOptionQuote",
        args
    );

}


async function getOptionLTPByContract(
    ...args
) {

    return await forwardAsync(
        "getOptionLTPByContract",
        args
    );

}


async function getOptionQuoteByContract(
    ...args
) {

    return await forwardAsync(
        "getOptionQuoteByContract",
        args
    );

}


async function getOptionChain(
    ...args
) {

    return await forwardAsync(
        "getOptionChain",
        args
    );

}


async function getOptionExpiries(
    ...args
) {

    return await forwardAsync(
        "getOptionExpiries",
        args
    );

}


async function getValidOptionExpiry(
    ...args
) {

    return await forwardAsync(
        "getValidOptionExpiry",
        args
    );

}


async function getExpiryOptionContracts(
    ...args
) {

    return await forwardAsync(
        "getExpiryOptionContracts",
        args
    );

}


async function getOptionContractDetails(
    ...args
) {

    return await forwardAsync(
        "getOptionContractDetails",
        args
    );

}


async function getOptionLotSize(
    ...args
) {

    return await forwardAsync(
        "getOptionLotSize",
        args
    );

}


async function getOptionInstrumentKey(
    ...args
) {

    return await forwardAsync(
        "getOptionInstrumentKey",
        args
    );

}


async function getOptionStrikes(
    ...args
) {

    return await forwardAsync(
        "getOptionStrikes",
        args
    );

}


// ============================================================
// OPTION TYPE
// ============================================================

function getOptionType(
    ...args
) {

    return forwardSync(
        "getOptionType",
        args
    );

}


// ============================================================
// NORMALIZE OPTION TYPE
// ============================================================

function normalizeOptionType(
    ...args
) {

    return forwardSync(
        "normalizeOptionType",
        args
    );

}


// ============================================================
// VALIDATE OPTION CONTRACT
// ============================================================

function validateOptionContract(
    ...args
) {

    return forwardSync(
        "validateOptionContract",
        args
    );

}


// ============================================================
// DEBUG OPTIONS
// ============================================================

async function debugOptions(
    ...args
) {

    return await forwardAsync(
        "debugOptions",
        args
    );

}


// ============================================================
// SELECT EXPIRY
// ============================================================

function selectExpiry(
    ...args
) {

    return forwardSync(
        "selectExpiry",
        args
    );

}


// ============================================================
// SELECT VALID EXPIRY
// ============================================================

function selectValidExpiry(
    ...args
) {

    return forwardSync(
        "selectValidExpiry",
        args
    );

}


// ============================================================
// FIND OPTION CONTRACT
// ============================================================

function findOptionContract(
    ...args
) {

    return forwardSync(
        "findOptionContract",
        args
    );

}


// ============================================================
// OI MOOD
// ============================================================

async function getOIMood(
    ...args
) {

    return await forwardAsync(
        "getOIMood",
        args
    );

}


// ============================================================
// OI CHANGE
// ============================================================

function calculateOIChange(
    ...args
) {

    return forwardSync(
        "calculateOIChange",
        args
    );

}


// ============================================================
// BUILDUP CLASSIFICATION
// ============================================================

function classifyBuildup(
    ...args
) {

    return forwardSync(
        "classifyBuildup",
        args
    );

}


// ============================================================
// GET BROKER NAME
// ============================================================

function getBrokerName() {

    const broker =
        getBroker();


    return (
        broker.name ||
        broker.brokerName ||
        "UNKNOWN"
    );

}


// ============================================================
// ACTIVE BROKER CHECK
// ============================================================

function isBrokerConfigured() {

    return !!activeBroker;

}


// ============================================================
// GET REGISTERED BROKER NAMES
// ============================================================

function getAvailableBrokers() {

    return Object.keys(
        brokers
    );

}


// ============================================================
// VERIFY INSTRUMENT SERVICE SYNCHRONIZATION
// ============================================================

function isInstrumentServiceConfigured() {

    return instrumentService.isBrokerConfigured();

}


function getInstrumentServiceBrokerName() {

    return instrumentService.getBrokerName();

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    // Broker registry

    brokers,


    // Broker management

    setBroker,

    getBroker,

    getActiveBroker,

    getBrokerName,

    getAvailableBrokers,

    isBrokerConfigured,

    validateBroker,


    // Instrument service status

    isInstrumentServiceConfigured,

    getInstrumentServiceBrokerName,


    // Authentication

    login,

    getAccessToken,


    // Instruments

    loadInstruments,

    getInstrument,

    getInstrumentKey,


    // Market data

    getHistoricalData,

    getQuote,


    // Options

    getOptionContracts,

    getOptionContract,

    getOptionContractBySymbol,

    getOptionLTP,

    getOptionQuote,

    getOptionLTPByContract,

    getOptionQuoteByContract,

    getOptionChain,

    getOptionExpiries,

    getValidOptionExpiry,

    getExpiryOptionContracts,

    getOptionContractDetails,

    getOptionLotSize,

    getOptionInstrumentKey,

    getOptionStrikes,

    getOptionType,

    normalizeOptionType,

    validateOptionContract,

    debugOptions,


    // Expiry / strike helpers

    selectExpiry,

    selectValidExpiry,

    findOptionContract,


    // OI / Mood

    getOIMood,

    calculateOIChange,

    classifyBuildup

};