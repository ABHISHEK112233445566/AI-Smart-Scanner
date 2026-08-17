const axios = require("axios");
const zlib = require("zlib");

// ============================================================
// UPSTOX BROKER ADAPTER
// ============================================================
//
// Purpose:
// - Broker adapter for Upstox
// - Broker-independent interface
// - Instrument master loading
// - Historical market data
// - ACTUAL FOUR_HOUR market candles from Upstox
// - Equity quotes
// - Option contracts
// - Option chain
// - Option LTP / quote
// - OI / option mood
//
// IMPORTANT:
// - FOUR_HOUR is requested DIRECTLY from Upstox.
// - NO 1H -> 4H local candle construction.
// - Angel One is NOT involved in FOUR_HOUR data.
// - instrumentService.js remains broker-independent.
// ============================================================

const BASE_URL = "https://api.upstox.com";

let instruments = [];
let instrumentsLoaded = false;

// ============================================================
// LOGIN
// ============================================================

async function login() {

    const accessToken =
        process.env.UPSTOX_ACCESS_TOKEN;

    if (!accessToken) {
        throw new Error(
            "UPSTOX_ACCESS_TOKEN is missing in .env"
        );
    }

    console.log(
        "✅ Upstox Access Token Found"
    );

    return {
        accessToken
    };
}

// ============================================================
// ACCESS TOKEN
// ============================================================

function getAccessToken() {

    const token =
        process.env.UPSTOX_ACCESS_TOKEN;

    if (!token) {
        throw new Error(
            "UPSTOX_ACCESS_TOKEN is missing in .env"
        );
    }

    return token;
}

// ============================================================
// API ERROR HELPER
// ============================================================

function getApiError(
    error,
    fallback = "Upstox API error"
) {

    const status =
        error?.response?.status;

    const data =
        error?.response?.data;

    let message =
        data?.errors?.[0]?.message ||
        data?.message ||
        error?.message ||
        fallback;

    if (status) {
        message =
            `HTTP ${status}: ${message}`;
    }

    return message;
}

// ============================================================
// LOAD UPSTOX INSTRUMENT MASTER
// ============================================================

async function loadInstruments() {

    if (
        instrumentsLoaded &&
        instruments.length > 0
    ) {
        return instruments;
    }

    console.log(
        "📥 Loading Upstox instrument master..."
    );

    try {

        const response =
            await axios.get(
                "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",
                {
                    timeout: 30000,
                    responseType: "arraybuffer"
                }
            );

        const data =
            zlib.gunzipSync(
                response.data
            );

        const parsed =
            JSON.parse(
                data.toString()
            );

        if (
            !Array.isArray(parsed) ||
            parsed.length === 0
        ) {
            throw new Error(
                "Upstox instrument master is empty or invalid"
            );
        }

        instruments = parsed;
        instrumentsLoaded = true;

        console.log(
            `✅ Upstox Instruments Loaded: ${instruments.length}`
        );

        return instruments;

    }
    catch (error) {

        instruments = [];
        instrumentsLoaded = false;

        throw new Error(
            `Failed to load Upstox instrument master: ${getApiError(error)}`
        );
    }
}

// ============================================================
// ENSURE INSTRUMENT MASTER
// ============================================================

async function ensureInstrumentsLoaded() {

    if (
        !instrumentsLoaded ||
        instruments.length === 0
    ) {
        await loadInstruments();
    }

    return instruments;
}

// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(symbol) {

    return String(symbol || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

// ============================================================
// CHECK INSTRUMENT KEY
// ============================================================

function isInstrumentKey(value) {

    return (
        typeof value === "string" &&
        value.includes("|")
    );
}

// ============================================================
// GET EQUITY INSTRUMENT
// ============================================================

async function getInstrument(symbol) {

    await ensureInstrumentsLoaded();

    const target =
        normalizeSymbol(symbol);

    if (!target) {
        return null;
    }

    // Already supplied an instrument key
    if (isInstrumentKey(target)) {

        const byKey =
            instruments.find(
                item =>
                    String(
                        item.instrument_key || ""
                    ).trim() === target
            );

        return byKey || null;
    }

    // --------------------------------------------------------
    // Primary NSE_EQ lookup
    // --------------------------------------------------------

    let instrument =
        instruments.find(item => {

            const segment =
                String(
                    item.segment || ""
                )
                    .trim()
                    .toUpperCase();

            if (
                segment !== "NSE_EQ"
            ) {
                return false;
            }

            const tradingSymbol =
                normalizeSymbol(
                    item.trading_symbol
                );

            const shortName =
                normalizeSymbol(
                    item.short_name
                );

            const name =
                normalizeSymbol(
                    item.name
                );

            return (
                tradingSymbol === target ||
                shortName === target ||
                name === target
            );
        });

    // --------------------------------------------------------
    // Secondary NSE lookup
    // --------------------------------------------------------

    if (!instrument) {

        instrument =
            instruments.find(item => {

                const exchange =
                    String(
                        item.exchange || ""
                    )
                        .trim()
                        .toUpperCase();

                const segment =
                    String(
                        item.segment || ""
                    )
                        .trim()
                        .toUpperCase();

                const tradingSymbol =
                    normalizeSymbol(
                        item.trading_symbol
                    );

                return (
                    (
                        segment === "NSE_EQ" ||
                        exchange === "NSE"
                    ) &&
                    tradingSymbol === target
                );
            });
    }

    return instrument || null;
}

// ============================================================
// GET EQUITY INSTRUMENT KEY
// ============================================================

async function getInstrumentKey(symbol) {

    if (
        symbol === null ||
        symbol === undefined
    ) {
        return null;
    }

    const resolved =
        await Promise.resolve(symbol);

    if (
        typeof resolved === "string" &&
        isInstrumentKey(
            resolved.trim()
        )
    ) {
        return resolved.trim();
    }

    if (
        resolved &&
        typeof resolved === "object"
    ) {

        const key =
            resolved.instrument_key ||
            resolved.instrumentKey ||
            resolved.key;

        if (
            typeof key === "string" &&
            isInstrumentKey(
                key.trim()
            )
        ) {
            return key.trim();
        }
    }

    const instrument =
        await getInstrument(
            resolved
        );

    if (!instrument) {
        return null;
    }

    return (
        instrument.instrument_key ||
        null
    );
}

// ============================================================
// RESOLVE INSTRUMENT KEY
// ============================================================

async function resolveInstrumentKey(value) {

    let resolved =
        await Promise.resolve(value);

    if (
        resolved &&
        typeof resolved === "object"
    ) {

        resolved =
            resolved.instrument_key ||
            resolved.instrumentKey ||
            resolved.key ||
            null;
    }

    if (
        typeof resolved !== "string"
    ) {
        return null;
    }

    resolved =
        resolved.trim();

    if (!resolved) {
        return null;
    }

    if (
        isInstrumentKey(resolved)
    ) {
        return resolved;
    }

    return await getInstrumentKey(
        resolved
    );
}

// ============================================================
// INTERVAL MAP
// ============================================================
//
// IMPORTANT:
// FOUR_HOUR is a REAL UPSTOX MARKET INTERVAL.
// It is NOT constructed from ONE_HOUR.
//
// ============================================================

const INTERVALS = {

    ONE_DAY: {
        unit: "days",
        interval: "1"
    },

    FOUR_HOUR: {
        unit: "hours",
        interval: "4"
    },

    ONE_HOUR: {
        unit: "hours",
        interval: "1"
    },

    THIRTY_MINUTE: {
        unit: "minutes",
        interval: "30"
    },

    FIFTEEN_MINUTE: {
        unit: "minutes",
        interval: "15"
    },

    FIVE_MINUTE: {
        unit: "minutes",
        interval: "5"
    }
};

// ============================================================
// IST DATE FORMAT
// ============================================================

function formatDateIST(date) {

    const parts =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone: "Asia/Kolkata",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }
        ).formatToParts(date);

    const values = {};

    for (
        const part
        of parts
    ) {

        if (
            part.type !== "literal"
        ) {
            values[part.type] =
                part.value;
        }
    }

    return (
        `${values.year}-${values.month}-${values.day}`
    );
}

// ============================================================
// GET DAYS BACK
// ============================================================

function getDaysBack(interval) {

    switch (interval) {

        case "ONE_DAY":
            return 450;

        case "FOUR_HOUR":
            return 85;

        case "ONE_HOUR":
            return 85;

        case "THIRTY_MINUTE":
            return 85;

        case "FIFTEEN_MINUTE":
            return 28;

        case "FIVE_MINUTE":
            return 28;

        default:
            return 28;
    }
}

// ============================================================
// VALIDATE CANDLE
// ============================================================

function isValidCandle(candle) {

    if (!candle) {
        return false;
    }

    if (!candle.time) {
        return false;
    }

    const open =
        Number(candle.open);

    const high =
        Number(candle.high);

    const low =
        Number(candle.low);

    const close =
        Number(candle.close);

    return (
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close) &&
        high >= low &&
        high >= open &&
        high >= close &&
        low <= open &&
        low <= close
    );
}

// ============================================================
// FETCH RAW HISTORICAL CANDLES
// ============================================================
//
// This function requests the exact interval supplied.
//
// FOUR_HOUR:
// Upstox API → actual 4H market candle.
//
// No local aggregation.
//
// ============================================================

async function fetchHistoricalCandles(
    instrumentKey,
    interval
) {

    const intervalData =
        INTERVALS[interval];

    if (!intervalData) {

        throw new Error(
            `Unsupported interval: ${interval}`
        );
    }

    const today =
        new Date();

    const daysBack =
        getDaysBack(interval);

    const from =
        new Date(today);

    from.setDate(
        today.getDate() -
        daysBack
    );

    const toDate =
        formatDateIST(today);

    const fromDate =
        formatDateIST(from);

    const encodedInstrument =
        encodeURIComponent(
            instrumentKey
        );

    const url =
        `${BASE_URL}/v3/historical-candle/` +
        `${encodedInstrument}/` +
        `${intervalData.unit}/` +
        `${intervalData.interval}/` +
        `${toDate}/` +
        `${fromDate}`;

    console.log(
        `📊 Upstox Historical Data: ${instrumentKey} | ${interval}`
    );

    try {

        const response =
            await axios.get(
                url,
                {
                    headers: {

                        Accept:
                            "application/json",

                        Authorization:
                            `Bearer ${getAccessToken()}`
                    },

                    timeout: 20000
                }
            );

        if (
            !response.data ||
            !response.data.data
        ) {

            throw new Error(
                "Invalid Upstox historical response"
            );
        }

        const rawCandles =
            response.data.data.candles;

        if (
            !Array.isArray(rawCandles) ||
            rawCandles.length === 0
        ) {

            throw new Error(
                "EMPTY_DATA"
            );
        }

        const candles =
            rawCandles

                .map(candle => {

                    if (
                        !Array.isArray(candle) ||
                        candle.length < 5
                    ) {
                        return null;
                    }

                    return {

                        time:
                            candle[0],

                        open:
                            Number(candle[1]),

                        high:
                            Number(candle[2]),

                        low:
                            Number(candle[3]),

                        close:
                            Number(candle[4]),

                        volume:
                            Number(
                                candle[5] || 0
                            )
                    };
                })

                .filter(isValidCandle)

                .sort(
                    (a, b) =>
                        new Date(a.time) -
                        new Date(b.time)
                );

        if (
            candles.length === 0
        ) {

            throw new Error(
                "No valid historical candles after validation"
            );
        }

        console.log(
            `✅ Upstox ${interval} Candles: ${candles.length}`
        );

        return candles;

    }
    catch (error) {

        throw new Error(
            `Upstox historical data failed | ${instrumentKey} | ${interval} | ${getApiError(error)}`
        );
    }
}

// ============================================================
// HISTORICAL DATA
// ============================================================
//
// FOUR_HOUR:
// Directly requested from Upstox.
// No construction.
// No aggregation.
// No Angel One fallback.
//
// ============================================================

async function getHistoricalData(
    symbol,
    interval = "ONE_DAY"
) {

    const instrumentKey =
        await resolveInstrumentKey(
            symbol
        );

    if (!instrumentKey) {

        throw new Error(
            `Upstox instrument not found: ${symbol}`
        );
    }

    if (
        !INTERVALS[interval]
    ) {

        throw new Error(
            `Unsupported Upstox timeframe: ${interval}`
        );
    }

    if (
        interval === "FOUR_HOUR"
    ) {

        console.log(
            `🕓 REQUESTING ACTUAL UPSTOX FOUR_HOUR MARKET CANDLES: ${instrumentKey}`
        );
    }

    return await fetchHistoricalCandles(
        instrumentKey,
        interval
    );
}

// ============================================================
// EQUITY LTP QUOTE
// ============================================================

async function getQuote(symbol) {

    const instrumentKey =
        await resolveInstrumentKey(
            symbol
        );

    if (!instrumentKey) {

        throw new Error(
            `Upstox instrument not found: ${symbol}`
        );
    }

    const encoded =
        encodeURIComponent(
            instrumentKey
        );

    try {

        const response =
            await axios.get(

                `${BASE_URL}/v3/market-quote/ltp` +
                `?instrument_key=${encoded}`,

                {
                    headers: {

                        Accept:
                            "application/json",

                        Authorization:
                            `Bearer ${getAccessToken()}`
                    },

                    timeout: 10000
                }
            );

        if (
            !response.data ||
            !response.data.data
        ) {

            throw new Error(
                "Invalid Upstox LTP response"
            );
        }

        return response.data;

    }
    catch (error) {

        throw new Error(
            `Upstox quote failed | ${instrumentKey} | ${getApiError(error)}`
        );
    }
}

// ============================================================
// OPTION LTP
// ============================================================

async function getOptionLTP(
    instrumentKey
) {

    const resolvedKey =
        await resolveInstrumentKey(
            instrumentKey
        );

    if (!resolvedKey) {

        throw new Error(
            `Invalid option instrument key: ${instrumentKey}`
        );
    }

    const response =
        await getQuote(
            resolvedKey
        );

    const data =
        response.data || {};

    const firstKey =
        Object.keys(data)[0];

    if (!firstKey) {

        throw new Error(
            "Option LTP not available"
        );
    }

    const quote =
        data[firstKey];

    const ltp =
        Number(
            quote.last_price
        );

    if (
        !Number.isFinite(ltp) ||
        ltp <= 0
    ) {

        throw new Error(
            `Invalid option LTP for ${resolvedKey}`
        );
    }

    return ltp;
}

// ============================================================
// OPTION QUOTE
// ============================================================

async function getOptionQuote(
    instrumentKey
) {

    const resolvedKey =
        await resolveInstrumentKey(
            instrumentKey
        );

    if (!resolvedKey) {

        throw new Error(
            `Invalid option instrument key: ${instrumentKey}`
        );
    }

    const response =
        await getQuote(
            resolvedKey
        );

    const data =
        response.data || {};

    const firstKey =
        Object.keys(data)[0];

    if (!firstKey) {

        throw new Error(
            "Option quote not available"
        );
    }

    const quote =
        data[firstKey];

    const ltp =
        Number(
            quote.last_price
        );

    if (
        !Number.isFinite(ltp) ||
        ltp <= 0
    ) {

        throw new Error(
            `Invalid option LTP for ${resolvedKey}`
        );
    }

    return {

        instrumentKey:
            resolvedKey,

        ltp,

        volume:
            Number(
                quote.volume || 0
            ),

        open:
            Number(
                quote.open || 0
            ),

        high:
            Number(
                quote.high || 0
            ),

        low:
            Number(
                quote.low || 0
            ),

        close:
            Number(
                quote.close || 0
            ),

        timestamp:
            quote.timestamp ||
            null,

        raw:
            quote
    };
}

// ============================================================
// GET OPTION CONTRACTS
// ============================================================

async function getOptionContracts(
    underlyingInstrumentKey
) {

    const resolvedKey =
        await resolveInstrumentKey(
            underlyingInstrumentKey
        );

    if (!resolvedKey) {

        throw new Error(
            `Invalid Upstox underlying instrument key: ${underlyingInstrumentKey}`
        );
    }

    const encodedInstrument =
        encodeURIComponent(
            resolvedKey
        );

    const url =
        `${BASE_URL}/v2/option/contract` +
        `?instrument_key=${encodedInstrument}`;

    console.log(
        `📋 Fetching option contracts: ${resolvedKey}`
    );

    try {

        const response =
            await axios.get(
                url,
                {
                    headers: {

                        Accept:
                            "application/json",

                        Authorization:
                            `Bearer ${getAccessToken()}`
                    },

                    timeout: 15000
                }
            );

        if (
            !response.data ||
            !Array.isArray(
                response.data.data
            )
        ) {

            throw new Error(
                "Invalid Upstox option contract response"
            );
        }

        console.log(
            `✅ Option contracts received: ${response.data.data.length}`
        );

        return response.data.data;

    }
    catch (error) {

        throw new Error(
            `Upstox option contract failed | ${getApiError(error)}`
        );
    }
}

// ============================================================
// SELECT EXPIRY
// ============================================================

function selectExpiry(
    contracts,
    minimumDays = 7
) {

    if (
        !Array.isArray(contracts) ||
        contracts.length === 0
    ) {
        return null;
    }

    const minimum =
        Number.isFinite(
            Number(minimumDays)
        )
            ? Number(minimumDays)
            : 7;

    const today =
        new Date();

    today.setHours(
        0,
        0,
        0,
        0
    );

    const expiryDates = [
        ...new Set(
            contracts
                .map(
                    contract =>
                        contract.expiry
                )
                .filter(Boolean)
                .map(
                    expiry =>
                        String(expiry)
                            .trim()
                )
        )
    ];

    const validExpiries =
        expiryDates

            .map(expiry => {

                const expiryDate =
                    new Date(
                        `${expiry}T00:00:00`
                    );

                if (
                    Number.isNaN(
                        expiryDate.getTime()
                    )
                ) {
                    return null;
                }

                const daysToExpiry =
                    Math.ceil(
                        (
                            expiryDate -
                            today
                        ) /
                        (
                            1000 *
                            60 *
                            60 *
                            24
                        )
                    );

                return {

                    expiry,

                    daysToExpiry,

                    expiryDate
                };
            })

            .filter(Boolean)

            .filter(
                item =>
                    item.daysToExpiry >=
                    minimum
            )

            .sort(
                (a, b) =>
                    a.expiryDate -
                    b.expiryDate
            );

    if (
        validExpiries.length === 0
    ) {
        return null;
    }

    return validExpiries[0];
}

// ============================================================
// FIND NEAREST VALID OPTION CONTRACT
// ============================================================

function findOptionContract(
    contracts,
    strike,
    optionType,
    selectedExpiry
) {

    if (
        !Array.isArray(contracts) ||
        contracts.length === 0
    ) {
        return null;
    }

    const targetStrike =
        Number(strike);

    if (
        !Number.isFinite(
            targetStrike
        ) ||
        targetStrike <= 0
    ) {
        return null;
    }

    const targetType =
        normalizeOptionType(
            optionType
        );

    if (!targetType) {
        return null;
    }

    if (!selectedExpiry) {
        return null;
    }

    const expiryString =
        String(
            selectedExpiry
        ).trim();

    const validContracts =
        contracts.filter(item => {

            const itemStrike =
                Number(
                    item.strike_price
                );

            const itemType =
                normalizeOptionType(
                    item.instrument_type
                );

            const itemExpiry =
                String(
                    item.expiry ||
                    ""
                ).trim();

            return (
                Number.isFinite(
                    itemStrike
                ) &&
                itemStrike > 0 &&
                itemType === targetType &&
                itemExpiry === expiryString &&
                item.instrument_key
            );
        });

    if (
        validContracts.length === 0
    ) {
        return null;
    }

    let nearestContract =
        null;

    let nearestDistance =
        Infinity;

    for (
        const contract
        of validContracts
    ) {

        const contractStrike =
            Number(
                contract.strike_price
            );

        const distance =
            Math.abs(
                contractStrike -
                targetStrike
            );

        if (
            distance <
            nearestDistance
        ) {

            nearestDistance =
                distance;

            nearestContract =
                contract;
        }
    }

    return nearestContract;
}

// ============================================================
// GET COMPLETE OPTION CONTRACT
// ============================================================

async function getOptionContract(
    symbol,
    arg2,
    arg3,
    arg4 = null,
    arg5 = null
) {

    let optionType = null;
    let strike = null;
    let minimumDays = 7;
    let expiry = null;

    const normalizedArg2 =
        normalizeOptionType(
            arg2
        );

    // Common:
    // symbol, optionType, strike, expiry, minimumDays

    if (
        normalizedArg2
    ) {

        optionType =
            normalizedArg2;

        strike =
            arg3;

        expiry =
            arg4;

        if (
            arg5 !== null &&
            arg5 !== undefined &&
            Number.isFinite(
                Number(arg5)
            )
        ) {
            minimumDays =
                Number(arg5);
        }

    }

    // Legacy:
    // symbol, strike, optionType, minimumDays, expiry

    else {

        strike =
            arg2;

        optionType =
            normalizeOptionType(
                arg3
            );

        if (
            arg4 !== null &&
            arg4 !== undefined &&
            Number.isFinite(
                Number(arg4)
            )
        ) {
            minimumDays =
                Number(arg4);
        }

        expiry =
            arg5;
    }

    if (!optionType) {

        throw new Error(
            `Invalid option type: ${arg2 || arg3}`
        );
    }

    const numericStrike =
        Number(strike);

    if (
        !Number.isFinite(
            numericStrike
        ) ||
        numericStrike <= 0
    ) {

        throw new Error(
            `Invalid option strike: ${strike}`
        );
    }

    const underlyingInstrumentKey =
        await resolveInstrumentKey(
            symbol
        );

    if (
        !underlyingInstrumentKey
    ) {

        throw new Error(
            `Upstox underlying instrument not found: ${symbol}`
        );
    }

    const contracts =
        await getOptionContracts(
            underlyingInstrumentKey
        );

    if (
        !contracts ||
        contracts.length === 0
    ) {

        throw new Error(
            "No option contracts found"
        );
    }

    let expiryInfo = null;

    if (expiry) {

        const expiryString =
            String(expiry)
                .trim();

        const expiryDate =
            new Date(
                `${expiryString}T00:00:00`
            );

        if (
            Number.isNaN(
                expiryDate.getTime()
            )
        ) {

            throw new Error(
                `Invalid expiry: ${expiry}`
            );
        }

        const today =
            new Date();

        today.setHours(
            0,
            0,
            0,
            0
        );

        const daysToExpiry =
            Math.ceil(
                (
                    expiryDate -
                    today
                ) /
                (
                    1000 *
                    60 *
                    60 *
                    24
                )
            );

        if (
            daysToExpiry <
            minimumDays
        ) {

            throw new Error(
                `Expiry ${expiryString} has only ${daysToExpiry} days remaining; minimum required is ${minimumDays}`
            );
        }

        expiryInfo = {

            expiry:
                expiryString,

            daysToExpiry
        };

    }
    else {

        expiryInfo =
            selectExpiry(
                contracts,
                minimumDays
            );
    }

    if (!expiryInfo) {

        throw new Error(
            `No expiry available with minimum ${minimumDays} days`
        );
    }

    const contract =
        findOptionContract(
            contracts,
            numericStrike,
            optionType,
            expiryInfo.expiry
        );

    if (!contract) {

        throw new Error(
            `No valid option contract found | ` +
            `Requested Strike: ${numericStrike} | ` +
            `Type: ${optionType} | ` +
            `Expiry: ${expiryInfo.expiry}`
        );
    }

    const lotSize =
        Number(
            contract.lot_size
        );

    if (
        !Number.isFinite(
            lotSize
        ) ||
        lotSize <= 0
    ) {

        throw new Error(
            `Invalid lot size for ${contract.trading_symbol}`
        );
    }

    const instrumentKey =
        contract.instrument_key;

    if (!instrumentKey) {

        throw new Error(
            `Instrument key missing for ${contract.trading_symbol}`
        );
    }

    return {

        expiry:
            contract.expiry,

        expiryDays:
            expiryInfo.daysToExpiry,

        instrumentKey,

        tradingSymbol:
            contract.trading_symbol,

        strike:
            Number(
                contract.strike_price
            ),

        optionType:
            normalizeOptionType(
                contract.instrument_type
            ) ||
            optionType,

        lotSize,

        tickSize:
            Number(
                contract.tick_size || 0
            ),

        weekly:
            contract.weekly,

        underlyingKey:
            contract.underlying_key,

        rawContract:
            contract
    };
}

// ============================================================
// OPTION CHAIN
// ============================================================

async function getOptionChain(
    symbol,
    expiryDate
) {

    const instrumentKey =
        await resolveInstrumentKey(
            symbol
        );

    if (!instrumentKey) {

        throw new Error(
            `Upstox underlying instrument not found: ${symbol}`
        );
    }

    if (!expiryDate) {

        throw new Error(
            "Expiry date is required"
        );
    }

    const encodedInstrument =
        encodeURIComponent(
            instrumentKey
        );

    const url =
        `${BASE_URL}/v2/option/chain` +
        `?instrument_key=${encodedInstrument}` +
        `&expiry_date=${encodeURIComponent(
            expiryDate
        )}`;

    try {

        const response =
            await axios.get(
                url,
                {
                    headers: {

                        Accept:
                            "application/json",

                        Authorization:
                            `Bearer ${getAccessToken()}`
                    },

                    timeout: 15000
                }
            );

        if (
            !response.data ||
            !Array.isArray(
                response.data.data
            )
        ) {

            throw new Error(
                "Invalid Upstox option chain response"
            );
        }

        return response.data.data;

    }
    catch (error) {

        throw new Error(
            `Upstox option chain failed | ${getApiError(error)}`
        );
    }
}

// ============================================================
// OPTION CONTRACT BY SYMBOL
// ============================================================

async function getOptionContractBySymbol(
    symbol,
    optionType,
    strike,
    expiry = null,
    minimumDays = 7
) {

    return await getOptionContract(
        symbol,
        optionType,
        strike,
        expiry,
        minimumDays
    );
}

// ============================================================
// OPTION LTP BY CONTRACT
// ============================================================

async function getOptionLTPByContract(
    contract
) {

    if (
        !contract ||
        !contract.instrumentKey
    ) {

        throw new Error(
            "Valid option contract with instrumentKey is required"
        );
    }

    return await getOptionLTP(
        contract.instrumentKey
    );
}

// ============================================================
// OPTION QUOTE BY CONTRACT
// ============================================================

async function getOptionQuoteByContract(
    contract
) {

    if (
        !contract ||
        !contract.instrumentKey
    ) {

        throw new Error(
            "Valid option contract with instrumentKey is required"
        );
    }

    return await getOptionQuote(
        contract.instrumentKey
    );
}

// ============================================================
// SELECT VALID EXPIRY
// ============================================================

function selectValidExpiry(
    expiries,
    minimumDays = 7
) {

    if (
        !Array.isArray(expiries) ||
        expiries.length === 0
    ) {
        return null;
    }

    const contracts =
        expiries.map(
            expiry => ({
                expiry
            })
        );

    const selected =
        selectExpiry(
            contracts,
            minimumDays
        );

    return selected
        ? selected.expiry
        : null;
}

// ============================================================
// GET OPTION EXPIRIES
// ============================================================

async function getOptionExpiries(
    symbol
) {

    const contracts =
        await getOptionContracts(
            symbol
        );

    return [
        ...new Set(
            contracts
                .map(
                    contract =>
                        contract.expiry
                )
                .filter(Boolean)
                .map(
                    expiry =>
                        String(expiry)
                )
        )
    ].sort();
}

// ============================================================
// GET VALID OPTION EXPIRY
// ============================================================

async function getValidOptionExpiry(
    symbol,
    minimumDays = 7
) {

    const contracts =
        await getOptionContracts(
            symbol
        );

    const selected =
        selectExpiry(
            contracts,
            minimumDays
        );

    return selected
        ? selected.expiry
        : null;
}

// ============================================================
// GET EXPIRY OPTION CONTRACTS
// ============================================================

async function getExpiryOptionContracts(
    symbol,
    expiry
) {

    const contracts =
        await getOptionContracts(
            symbol
        );

    const targetExpiry =
        String(
            expiry || ""
        ).trim();

    if (!targetExpiry) {
        return [];
    }

    return contracts.filter(
        contract =>
            String(
                contract.expiry || ""
            ).trim() === targetExpiry
    );
}

// ============================================================
// OPTION CONTRACT DETAILS
// ============================================================

async function getOptionContractDetails(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    return await getOptionContract(
        symbol,
        optionType,
        strike,
        expiry,
        7
    );
}

// ============================================================
// OPTION LOT SIZE
// ============================================================

async function getOptionLotSize(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    const contract =
        await getOptionContract(
            symbol,
            optionType,
            strike,
            expiry,
            7
        );

    return contract.lotSize;
}

// ============================================================
// OPTION INSTRUMENT KEY
// ============================================================

async function getOptionInstrumentKey(
    symbol,
    optionType,
    strike,
    expiry = null
) {

    const contract =
        await getOptionContract(
            symbol,
            optionType,
            strike,
            expiry,
            7
        );

    return contract.instrumentKey;
}

// ============================================================
// OPTION STRIKES
// ============================================================

async function getOptionStrikes(
    symbol,
    expiry,
    optionType = null
) {

    const contracts =
        await getExpiryOptionContracts(
            symbol,
            expiry
        );

    const normalizedType =
        optionType
            ? normalizeOptionType(
                optionType
            )
            : null;

    const strikes =
        contracts

            .filter(contract => {

                if (!normalizedType) {
                    return true;
                }

                return (
                    normalizeOptionType(
                        contract.instrument_type
                    ) ===
                    normalizedType
                );
            })

            .map(
                contract =>
                    Number(
                        contract.strike_price
                    )
            )

            .filter(
                Number.isFinite
            )

            .filter(
                strike =>
                    strike > 0
            );

    return [
        ...new Set(strikes)
    ].sort(
        (a, b) =>
            a - b
    );
}

// ============================================================
// OPTION TYPE NORMALIZATION
// ============================================================

function normalizeOptionType(
    optionType
) {

    const type =
        String(optionType || "")
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

    if (!contract) {
        return null;
    }

    return normalizeOptionType(
        contract.instrument_type ||
        contract.optionType
    );
}

// ============================================================
// VALIDATE OPTION CONTRACT
// ============================================================

function validateOptionContract(
    contract
) {

    if (!contract) {

        return {

            valid: false,

            reason:
                "Contract not found"
        };
    }

    const instrumentKey =
        contract.instrumentKey ||
        contract.instrument_key;

    const strike =
        Number(
            contract.strike ??
            contract.strike_price
        );

    const optionType =
        getOptionType(
            contract
        );

    const expiry =
        contract.expiry;

    if (!instrumentKey) {

        return {

            valid: false,

            reason:
                "Instrument key missing"
        };
    }

    if (
        !Number.isFinite(strike) ||
        strike <= 0
    ) {

        return {

            valid: false,

            reason:
                "Invalid strike"
        };
    }

    if (!optionType) {

        return {

            valid: false,

            reason:
                "Invalid option type"
        };
    }

    if (!expiry) {

        return {

            valid: false,

            reason:
                "Expiry missing"
        };
    }

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

    const contracts =
        await getOptionContracts(
            symbol
        );

    const expiries =
        [
            ...new Set(
                contracts
                    .map(
                        contract =>
                            contract.expiry
                    )
                    .filter(Boolean)
            )
        ];

    return {

        symbol,

        contractCount:
            contracts.length,

        expiries,

        sample:
            contracts.slice(
                0,
                10
            )
    };
}

// ============================================================
// SAFE NUMBER
// ============================================================

function safeNumber(value) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : 0;
}

// ============================================================
// GET OPTION MARKET DATA
// ============================================================

function getOptionMarketData(
    option
) {

    if (
        !option ||
        !option.market_data
    ) {

        return {

            ltp: 0,
            closePrice: 0,
            oi: 0,
            prevOi: 0,
            volume: 0
        };
    }

    const market =
        option.market_data;

    return {

        ltp:
            safeNumber(
                market.ltp
            ),

        closePrice:
            safeNumber(
                market.close_price
            ),

        oi:
            safeNumber(
                market.oi
            ),

        prevOi:
            safeNumber(
                market.prev_oi
            ),

        volume:
            safeNumber(
                market.volume
            )
    };
}

// ============================================================
// CALCULATE OI CHANGE
// ============================================================

function calculateOIChange(
    oi,
    prevOi
) {

    const current =
        safeNumber(oi);

    const previous =
        safeNumber(prevOi);

    if (
        previous <= 0
    ) {

        return {

            change:
                current,

            percent:
                0
        };
    }

    const change =
        current -
        previous;

    const percent =
        (
            change /
            previous
        ) * 100;

    return {

        change,

        percent
    };
}

// ============================================================
// CLASSIFY BUILDUP
// ============================================================

function classifyBuildup(
    priceChangePercent,
    oiChangePercent
) {

    const priceChange =
        safeNumber(
            priceChangePercent
        );

    const oiChange =
        safeNumber(
            oiChangePercent
        );

    const PRICE_THRESHOLD =
        0.10;

    const OI_THRESHOLD =
        1.00;

    const priceUp =
        priceChange >
        PRICE_THRESHOLD;

    const priceDown =
        priceChange <
        -PRICE_THRESHOLD;

    const oiUp =
        oiChange >
        OI_THRESHOLD;

    const oiDown =
        oiChange <
        -OI_THRESHOLD;

    if (
        priceUp &&
        oiUp
    ) {
        return "LONG BUILDUP";
    }

    if (
        priceDown &&
        oiUp
    ) {
        return "SHORT BUILDUP";
    }

    if (
        priceUp &&
        oiDown
    ) {
        return "SHORT COVERING";
    }

    if (
        priceDown &&
        oiDown
    ) {
        return "LONG UNWINDING";
    }

    return "NEUTRAL";
}

// ============================================================
// OPTION-SIDE SENTIMENT
// ============================================================

function calculateOptionSideMood(
    option
) {

    const market =
        getOptionMarketData(
            option
        );

    const price =
        market.ltp;

    const previousPrice =
        market.closePrice;

    const priceChangePercent =
        previousPrice > 0
            ? (
                (
                    price -
                    previousPrice
                ) /
                previousPrice
            ) * 100
            : 0;

    const oi =
        calculateOIChange(
            market.oi,
            market.prevOi
        );

    const buildup =
        classifyBuildup(
            priceChangePercent,
            oi.percent
        );

    return {

        ltp:
            price,

        previousPrice,

        priceChangePercent,

        oi:
            market.oi,

        previousOI:
            market.prevOi,

        oiChange:
            oi.change,

        oiChangePercent:
            oi.percent,

        buildup
    };
}

// ============================================================
// FIND ATM ROW
// ============================================================

function findATMRow(
    chain
) {

    if (
        !Array.isArray(chain) ||
        chain.length === 0
    ) {
        return null;
    }

    const firstSpot =
        safeNumber(
            chain[0]?.underlying_spot_price
        );

    let spot =
        firstSpot;

    if (
        spot <= 0
    ) {

        for (
            const row
            of chain
        ) {

            const candidate =
                safeNumber(
                    row?.underlying_spot_price
                );

            if (
                candidate > 0
            ) {

                spot =
                    candidate;

                break;
            }
        }
    }

    if (
        spot <= 0
    ) {
        return null;
    }

    let nearest =
        null;

    let distance =
        Infinity;

    for (
        const row
        of chain
    ) {

        const strike =
            safeNumber(
                row.strike_price
            );

        if (
            strike <= 0
        ) {
            continue;
        }

        const currentDistance =
            Math.abs(
                strike -
                spot
            );

        if (
            currentDistance <
            distance
        ) {

            distance =
                currentDistance;

            nearest =
                row;
        }
    }

    return nearest;
}

// ============================================================
// GET STOCK OI MOOD
// ============================================================

async function getOIMood(
    symbol,
    expiryDate = null
) {

    try {

        const instrumentKey =
            await resolveInstrumentKey(
                symbol
            );

        if (!instrumentKey) {

            throw new Error(
                `Instrument not found: ${symbol}`
            );
        }

        let selectedExpiry =
            expiryDate;

        if (!selectedExpiry) {

            const contracts =
                await getOptionContracts(
                    instrumentKey
                );

            const expiryInfo =
                selectExpiry(
                    contracts,
                    7
                );

            if (!expiryInfo) {

                throw new Error(
                    "No valid option expiry found"
                );
            }

            selectedExpiry =
                expiryInfo.expiry;
        }

        const chain =
            await getOptionChain(
                instrumentKey,
                selectedExpiry
            );

        if (
            !Array.isArray(chain) ||
            chain.length === 0
        ) {

            throw new Error(
                "Empty option chain"
            );
        }

        const atm =
            findATMRow(
                chain
            );

        if (!atm) {

            throw new Error(
                "ATM option row not found"
            );
        }

        const callAnalysis =
            calculateOptionSideMood(
                atm.call_options
            );

        const putAnalysis =
            calculateOptionSideMood(
                atm.put_options
            );

        let callOI = 0;
        let putOI = 0;

        let previousCallOI = 0;
        let previousPutOI = 0;

        let totalCallVolume = 0;
        let totalPutVolume = 0;

        for (
            const row
            of chain
        ) {

            const call =
                getOptionMarketData(
                    row.call_options
                );

            const put =
                getOptionMarketData(
                    row.put_options
                );

            callOI +=
                call.oi;

            putOI +=
                put.oi;

            previousCallOI +=
                call.prevOi;

            previousPutOI +=
                put.prevOi;

            totalCallVolume +=
                call.volume;

            totalPutVolume +=
                put.volume;
        }

        const callOIChange =
            calculateOIChange(
                callOI,
                previousCallOI
            );

        const putOIChange =
            calculateOIChange(
                putOI,
                previousPutOI
            );

        const spot =
            safeNumber(
                atm.underlying_spot_price
            );

        let sentiment =
            "NEUTRAL";

        if (
            putOIChange.percent >
            callOIChange.percent
        ) {

            sentiment =
                "BULLISH";

        }
        else if (
            callOIChange.percent >
            putOIChange.percent
        ) {

            sentiment =
                "BEARISH";
        }

        let mood =
            "NEUTRAL";

        if (
            callAnalysis.buildup !==
            "NEUTRAL"
        ) {

            mood =
                callAnalysis.buildup;

        }
        else if (
            putAnalysis.buildup !==
            "NEUTRAL"
        ) {

            mood =
                putAnalysis.buildup;
        }

        return {

            available:
                true,

            symbol,

            instrumentKey,

            expiry:
                selectedExpiry,

            spot,

            mood,

            sentiment,

            atmStrike:
                safeNumber(
                    atm.strike_price
                ),

            call:
                callAnalysis,

            put:
                putAnalysis,

            totalCallOI:
                callOI,

            totalPutOI:
                putOI,

            previousCallOI,

            previousPutOI,

            callOIChange:
                callOIChange.change,

            putOIChange:
                putOIChange.change,

            callOIChangePercent:
                callOIChange.percent,

            putOIChangePercent:
                putOIChange.percent,

            totalCallVolume,

            totalPutVolume,

            pcr:
                callOI > 0
                    ? putOI / callOI
                    : 0
        };

    }
    catch (error) {

        console.log(
            `⚠️ OI Mood unavailable for ${symbol}: ${error.message}`
        );

        return {

            available:
                false,

            symbol,

            mood:
                "NEUTRAL",

            sentiment:
                "NEUTRAL",

            error:
                error.message
        };
    }
}

// ============================================================
// BROKER NAME
// ============================================================

const name =
    "UPSTOX";

// ============================================================
// EXPORT
// ============================================================

module.exports = {

    name,

    login,

    loadInstruments,

    getAccessToken,

    getHistoricalData,

    getQuote,

    getOptionLTP,

    getOptionQuote,

    getInstrument,

    getInstrumentKey,

    getOptionChain,

    getOptionContracts,

    getOptionContract,

    getOptionContractBySymbol,

    getOptionLTPByContract,

    getOptionQuoteByContract,

    getOptionExpiries,

    getExpiryOptionContracts,

    getValidOptionExpiry,

    getOptionContractDetails,

    getOptionLotSize,

    getOptionInstrumentKey,

    getOptionStrikes,

    normalizeOptionType,

    getOptionType,

    validateOptionContract,

    debugOptions,

    selectExpiry,

    selectValidExpiry,

    findOptionContract,

    getOIMood,

    calculateOIChange,

    classifyBuildup,

    INTERVALS
};