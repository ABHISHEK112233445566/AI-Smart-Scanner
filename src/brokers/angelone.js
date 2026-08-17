// ============================================================
// ANGEL ONE SMARTAPI BROKER ADAPTER
// ============================================================
// Broker-independent adapter for AI Smart Scanner
//
// Supports:
// - Angel One SmartAPI REST login
// - NSE equity instruments
// - Historical candles
// - Equity LTP / quote
// - Option contracts through Angel One Scrip Master
// - Option LTP / quote
// - Option chain
// - Instrument lookup
//
// IMPORTANT:
// - Does NOT use smartapi-javascript constructor.
// - Uses SmartAPI REST endpoints directly through axios.
// - Does NOT construct 4H candles from 1H candles.
// - Does NOT convert FOUR_HOUR -> ONE_HOUR.
// - 4H must come from the market/data source.
// ============================================================

const axios = require("axios");

// ============================================================
// CONFIGURATION
// ============================================================

const BASE_URL =
    "https://apiconnect.angelone.in";

const SCRIPT_MASTER_URL =
    "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";

const REQUEST_TIMEOUT =
    Number(process.env.ANGELONE_TIMEOUT_MS) || 15000;

const EXCHANGE_MAP = {
    NSE: "NSE",
    BSE: "BSE",
    NFO: "NFO",
    MCX: "MCX",
    CDS: "CDS"
};

// ============================================================
// SESSION STATE
// ============================================================

let accessToken = null;
let refreshToken = null;
let feedToken = null;
let clientCode = null;

let scriptMaster = [];
let scriptMasterLoaded = false;

// ============================================================
// SUPPORTED ANGEL ONE INTERVALS
// ============================================================
//
// IMPORTANT:
// FOUR_HOUR IS INTENTIONALLY NOT INCLUDED.
//
// We will NOT create 4H candles from 1H candles.
// We will NOT silently replace 4H with 1H.
//
// ============================================================

const INTERVALS = {
    ONE_MINUTE: "ONE_MINUTE",
    THREE_MINUTE: "THREE_MINUTE",
    FIVE_MINUTE: "FIVE_MINUTE",
    TEN_MINUTE: "TEN_MINUTE",
    FIFTEEN_MINUTE: "FIFTEEN_MINUTE",
    THIRTY_MINUTE: "THIRTY_MINUTE",
    ONE_HOUR: "ONE_HOUR",
    ONE_DAY: "ONE_DAY"
};

// ============================================================
// SAFE NUMBER
// ============================================================

function toNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

// ============================================================
// DATE FORMAT
// ============================================================

function formatDateTime(date) {
    const d = new Date(date);

    if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid date: ${date}`);
    }

    const yyyy = d.getFullYear();

    const mm = String(
        d.getMonth() + 1
    ).padStart(2, "0");

    const dd = String(
        d.getDate()
    ).padStart(2, "0");

    const hh = String(
        d.getHours()
    ).padStart(2, "0");

    const min = String(
        d.getMinutes()
    ).padStart(2, "0");

    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// ============================================================
// AUTH HEADERS
// ============================================================

function getHeaders() {
    const apiKey =
        process.env.ANGELONE_API_KEY ||
        process.env.ANGEL_API_KEY ||
        process.env.SMARTAPI_API_KEY;

    if (!apiKey) {
        throw new Error(
            "ANGELONE_API_KEY is missing in .env"
        );
    }

    if (!accessToken) {
        throw new Error(
            "Angel One access token is missing. Login first."
        );
    }

    return {
        Authorization:
            `Bearer ${accessToken}`,

        "Content-Type":
            "application/json",

        Accept:
            "application/json",

        "X-PrivateKey":
            apiKey,

        "X-UserType":
            "USER",

        "X-SourceID":
            "WEB",

        "X-ClientLocalIP":
            process.env.ANGELONE_LOCAL_IP ||
            "127.0.0.1",

        "X-ClientPublicIP":
            process.env.ANGELONE_PUBLIC_IP ||
            "127.0.0.1",

        "X-MACAddress":
            process.env.ANGELONE_MAC_ADDRESS ||
            "00:00:00:00:00:00"
    };
}

// ============================================================
// GENERATE TOTP
// ============================================================

function generateTOTP() {
    const directTOTP =
        process.env.ANGELONE_TOTP;

    if (directTOTP) {
        return String(
            directTOTP
        ).trim();
    }

    const secret =
        process.env.ANGELONE_TOTP_SECRET ||
        process.env.ANGEL_TOTP_SECRET ||
        process.env.SMARTAPI_TOTP_SECRET;

    if (!secret) {
        throw new Error(
            "ANGELONE_TOTP or ANGELONE_TOTP_SECRET is missing in .env"
        );
    }

    try {
        const otplib =
            require("otplib");

        if (
            otplib.authenticator &&
            typeof otplib.authenticator.generate ===
                "function"
        ) {
            return otplib.authenticator.generate(
                secret
            );
        }

        if (
            otplib.totp &&
            typeof otplib.totp.generate ===
                "function"
        ) {
            return otplib.totp.generate(
                secret
            );
        }
    } catch (error) {
        throw new Error(
            "TOTP generation requires the 'otplib' package or ANGELONE_TOTP in .env"
        );
    }

    throw new Error(
        "Unable to generate Angel One TOTP"
    );
}

// ============================================================
// LOGIN
// ============================================================

async function login() {
    const apiKey =
        process.env.ANGELONE_API_KEY ||
        process.env.ANGEL_API_KEY ||
        process.env.SMARTAPI_API_KEY;

    const userId =
        process.env.ANGELONE_CLIENT_CODE ||
        process.env.ANGEL_CLIENT_CODE ||
        process.env.SMARTAPI_CLIENT_CODE;

    const password =
        process.env.ANGELONE_PASSWORD ||
        process.env.ANGEL_PASSWORD ||
        process.env.SMARTAPI_PASSWORD;

    if (!apiKey) {
        throw new Error(
            "ANGELONE_API_KEY is missing in .env"
        );
    }

    if (!userId) {
        throw new Error(
            "ANGELONE_CLIENT_CODE is missing in .env"
        );
    }

    if (!password) {
        throw new Error(
            "ANGELONE_PASSWORD is missing in .env"
        );
    }

    const totp =
        generateTOTP();

    console.log(
        "🔐 Angel One login..."
    );

    const response =
        await axios.post(
            `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
            {
                clientcode:
                    userId,

                password:
                    password,

                totp:
                    totp
            },
            {
                headers: {
                    "Content-Type":
                        "application/json",

                    Accept:
                        "application/json",

                    "X-PrivateKey":
                        apiKey,

                    "X-UserType":
                        "USER",

                    "X-SourceID":
                        "WEB",

                    "X-ClientLocalIP":
                        process.env.ANGELONE_LOCAL_IP ||
                        "127.0.0.1",

                    "X-ClientPublicIP":
                        process.env.ANGELONE_PUBLIC_IP ||
                        "127.0.0.1",

                    "X-MACAddress":
                        process.env.ANGELONE_MAC_ADDRESS ||
                        "00:00:00:00:00:00"
                },

                timeout:
                    REQUEST_TIMEOUT
            }
        );

    const data =
        response.data;

    if (
        !data ||
        data.status !== true ||
        !data.data
    ) {
        throw new Error(
            `Angel One login failed: ${
                data?.message ||
                "Unknown authentication error"
            }`
        );
    }

    accessToken =
        data.data.jwtToken ||
        null;

    refreshToken =
        data.data.refreshToken ||
        null;

    feedToken =
        data.data.feedToken ||
        null;

    clientCode =
        userId;

    if (!accessToken) {
        throw new Error(
            "Angel One login succeeded but jwtToken was not returned"
        );
    }

    console.log(
        "✅ Angel One login successful"
    );

    return {
        accessToken,
        refreshToken,
        feedToken,
        clientCode
    };
}

// ============================================================
// SESSION STATUS
// ============================================================

function isLoggedIn() {
    return Boolean(
        accessToken
    );
}

// ============================================================
// LOGOUT
// ============================================================

async function logout() {
    if (!clientCode) {
        accessToken = null;
        refreshToken = null;
        feedToken = null;
        return;
    }

    try {
        await axios.post(
            `${BASE_URL}/rest/secure/angelbroking/user/v1/logout`,
            {
                clientcode:
                    clientCode
            },
            {
                headers:
                    getHeaders(),

                timeout:
                    REQUEST_TIMEOUT
            }
        );
    } catch (error) {
        console.log(
            `⚠️ Angel One logout warning: ${error.message}`
        );
    } finally {
        accessToken = null;
        refreshToken = null;
        feedToken = null;
        clientCode = null;
    }
}

// ============================================================
// LOAD SCRIPT MASTER
// ============================================================

async function loadInstruments() {
    if (
        scriptMasterLoaded &&
        scriptMaster.length > 0
    ) {
        return scriptMaster;
    }

    console.log(
        "📥 Loading Angel One Scrip Master..."
    );

    const response =
        await axios.get(
            SCRIPT_MASTER_URL,
            {
                timeout: 30000
            }
        );

    if (
        !response.data ||
        !Array.isArray(
            response.data
        )
    ) {
        throw new Error(
            "Invalid Angel One Scrip Master response"
        );
    }

    scriptMaster =
        response.data;

    scriptMasterLoaded =
        true;

    console.log(
        `✅ Angel One Scrip Master Loaded: ${scriptMaster.length}`
    );

    return scriptMaster;
}

// ============================================================
// ENSURE SCRIPT MASTER
// ============================================================

async function ensureScriptMaster() {
    if (
        !scriptMasterLoaded ||
        scriptMaster.length === 0
    ) {
        await loadInstruments();
    }
}

// ============================================================
// NORMALIZE SYMBOL
// ============================================================

function normalizeSymbol(symbol) {
    return String(
        symbol || ""
    )
        .trim()
        .toUpperCase()
        .replace(
            /-EQ$/,
            ""
        );
}

// ============================================================
// FIND EQUITY INSTRUMENT
// ============================================================

async function getInstrument(symbol) {
    await ensureScriptMaster();

    const target =
        normalizeSymbol(symbol);

    if (!target) {
        return null;
    }

    const exact =
        scriptMaster.find(
            item => {
                const exchange =
                    String(
                        item.exch_seg ||
                        ""
                    ).toUpperCase();

                if (
                    exchange !== "NSE"
                ) {
                    return false;
                }

                const symbolName =
                    String(
                        item.symbol ||
                        ""
                    )
                        .trim()
                        .toUpperCase();

                const name =
                    String(
                        item.name ||
                        ""
                    )
                        .trim()
                        .toUpperCase();

                return (
                    symbolName ===
                        `${target}-EQ` ||

                    symbolName ===
                        target ||

                    name ===
                        target
                );
            }
        );

    return exact || null;
}

// ============================================================
// GET INSTRUMENT TOKEN
// ============================================================

async function getInstrumentToken(symbol) {
    const instrument =
        await getInstrument(
            symbol
        );

    if (!instrument) {
        return null;
    }

    return String(
        instrument.token || ""
    );
}

// ============================================================
// GET INSTRUMENT KEY
// ============================================================

async function getInstrumentKey(symbol) {
    const instrument =
        await getInstrument(
            symbol
        );

    if (!instrument) {
        return null;
    }

    return (
        `NSE|${instrument.token}`
    );
}

// ============================================================
// GET EXCHANGE
// ============================================================

function getExchangeFromInstrument(
    instrument
) {
    const exchange =
        String(
            instrument?.exch_seg ||
            "NSE"
        ).toUpperCase();

    return (
        EXCHANGE_MAP[exchange] ||
        exchange
    );
}

// ============================================================
// RESOLVE INSTRUMENT
// ============================================================

async function resolveInstrument(
    symbolOrInstrument
) {
    if (
        symbolOrInstrument &&
        typeof symbolOrInstrument ===
            "object"
    ) {
        return symbolOrInstrument;
    }

    const text =
        String(
            symbolOrInstrument ||
            ""
        ).trim();

    if (!text) {
        throw new Error(
            "Symbol or instrument is required"
        );
    }

    if (
        text.includes("|")
    ) {
        const [
            exchange,
            token
        ] =
            text.split("|");

        return {
            exch_seg:
                exchange,

            token:
                token,

            symbol:
                ""
        };
    }

    const instrument =
        await getInstrument(
            text
        );

    if (!instrument) {
        throw new Error(
            `Angel One instrument not found: ${text}`
        );
    }

    return instrument;
}

// ============================================================
// NORMALIZE INTERVAL
// ============================================================

function normalizeInterval(
    interval
) {
    const value =
        String(
            interval ||
            "ONE_DAY"
        )
            .trim()
            .toUpperCase();

    const aliases = {
        "1M":
            "ONE_MINUTE",

        "3M":
            "THREE_MINUTE",

        "5M":
            "FIVE_MINUTE",

        "10M":
            "TEN_MINUTE",

        "15M":
            "FIFTEEN_MINUTE",

        "30M":
            "THIRTY_MINUTE",

        "1H":
            "ONE_HOUR",

        "60M":
            "ONE_HOUR",

        "1D":
            "ONE_DAY",

        "DAY":
            "ONE_DAY"
    };

    // IMPORTANT:
    // Do NOT map FOUR_HOUR to ONE_HOUR.

    return (
        aliases[value] ||
        value
    );
}

// ============================================================
// HISTORICAL LOOKBACK
// ============================================================

function getLookbackDays(
    interval
) {
    switch (
        normalizeInterval(interval)
    ) {
        case "ONE_DAY":
            return 450;

        case "ONE_HOUR":
            return 90;

        case "THIRTY_MINUTE":
            return 90;

        case "FIFTEEN_MINUTE":
            return 60;

        case "TEN_MINUTE":
            return 30;

        case "FIVE_MINUTE":
            return 30;

        case "THREE_MINUTE":
            return 30;

        case "ONE_MINUTE":
            return 30;

        default:
            return 30;
    }
}

// ============================================================
// HISTORICAL DATA
// ============================================================
//
// IMPORTANT:
// FOUR_HOUR is deliberately rejected here.
//
// We do NOT:
// FOUR_HOUR -> ONE_HOUR
// ONE_HOUR -> buildFourHourCandles()
// ============================================================

async function getHistoricalData(
    symbol,
    interval = "ONE_DAY"
) {
    if (!isLoggedIn()) {
        throw new Error(
            "Angel One login required before historical data"
        );
    }

    const normalizedInterval =
        normalizeInterval(
            interval
        );

    // ========================================================
    // CRITICAL 4H PROTECTION
    // ========================================================

    if (
        normalizedInterval ===
        "FOUR_HOUR"
    ) {
        throw new Error(
            "FOUR_HOUR market data is not provided by this Angel One adapter. 4H must come directly from the market/data source. No 1H-to-4H aggregation is allowed."
        );
    }

    const instrument =
        await resolveInstrument(
            symbol
        );

    const supported =
        Object.prototype.hasOwnProperty.call(
            INTERVALS,
            normalizedInterval
        );

    if (!supported) {
        throw new Error(
            `Unsupported Angel One interval: ${interval}`
        );
    }

    const today =
        new Date();

    const from =
        new Date(
            today
        );

    from.setDate(
        from.getDate() -
        getLookbackDays(
            normalizedInterval
        )
    );

    const params = {
        exchange:
            getExchangeFromInstrument(
                instrument
            ),

        symboltoken:
            String(
                instrument.token
            ),

        interval:
            INTERVALS[
                normalizedInterval
            ],

        fromdate:
            formatDateTime(
                from
            ),

        todate:
            formatDateTime(
                today
            )
    };

    console.log(
        `📊 Angel One Request: ${
            instrument.symbol ||
            symbol
        } ${normalizedInterval}`
    );

    const response =
        await axios.post(
            `${BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData`,
            params,
            {
                headers:
                    getHeaders(),

                timeout:
                    REQUEST_TIMEOUT
            }
        );

    const data =
        response.data;

    if (
        !data ||
        data.status !== true
    ) {
        throw new Error(
            `Angel One historical data failed: ${
                data?.message ||
                "Unknown error"
            }`
        );
    }

    const rawCandles =
        data.data;

    if (
        !Array.isArray(
            rawCandles
        ) ||
        rawCandles.length === 0
    ) {
        throw new Error(
            "EMPTY_DATA"
        );
    }

    const candles =
        rawCandles
            .map(
                normalizeCandle
            )
            .filter(
                candle =>
                    candle !== null
            )
            .sort(
                (a, b) =>
                    new Date(a.time) -
                    new Date(b.time)
            );

    console.log(
        `✅ Angel One Candles: ${candles.length}`
    );

    return candles;
}

// ============================================================
// NORMALIZE CANDLE
// ============================================================

function normalizeCandle(
    candle
) {
    if (
        !Array.isArray(candle) ||
        candle.length < 5
    ) {
        return null;
    }

    const open =
        toNumber(
            candle[1],
            NaN
        );

    const high =
        toNumber(
            candle[2],
            NaN
        );

    const low =
        toNumber(
            candle[3],
            NaN
        );

    const close =
        toNumber(
            candle[4],
            NaN
        );

    if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
    ) {
        return null;
    }

    return {
        time:
            candle[0],

        open,

        high,

        low,

        close,

        volume:
            toNumber(
                candle[5],
                0
            )
    };
}

// ============================================================
// EQUITY QUOTE
// ============================================================

async function getQuote(
    symbol
) {
    if (!isLoggedIn()) {
        throw new Error(
            "Angel One login required before quote request"
        );
    }

    const instrument =
        await resolveInstrument(
            symbol
        );

    const exchange =
        getExchangeFromInstrument(
            instrument
        );

    const response =
        await axios.post(
            `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
            {
                mode:
                    "FULL",

                exchangeTokens: {
                    [exchange]: [
                        String(
                            instrument.token
                        )
                    ]
                }
            },
            {
                headers:
                    getHeaders(),

                timeout:
                    REQUEST_TIMEOUT
            }
        );

    const data =
        response.data;

    if (
        !data ||
        data.status !== true
    ) {
        throw new Error(
            `Angel One quote failed: ${
                data?.message ||
                "Unknown error"
            }`
        );
    }

    return data;
}

// ============================================================
// LTP
// ============================================================

async function getLTP(
    symbol
) {
    const instrument =
        await resolveInstrument(
            symbol
        );

    const exchange =
        getExchangeFromInstrument(
            instrument
        );

    const response =
        await axios.post(
            `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
            {
                mode:
                    "LTP",

                exchangeTokens: {
                    [exchange]: [
                        String(
                            instrument.token
                        )
                    ]
                }
            },
            {
                headers:
                    getHeaders(),

                timeout:
                    REQUEST_TIMEOUT
            }
        );

    const data =
        response.data;

    if (
        !data ||
        data.status !== true
    ) {
        throw new Error(
            `Angel One LTP failed: ${
                data?.message ||
                "Unknown error"
            }`
        );
    }

    const fetched =
        data.data?.fetched ||
        [];

    const item =
        fetched[0];

    if (!item) {
        throw new Error(
            `Angel One LTP not available: ${symbol}`
        );
    }

    const ltp =
        toNumber(
            item.ltp,
            NaN
        );

    if (
        !Number.isFinite(ltp)
    ) {
        throw new Error(
            `Invalid Angel One LTP: ${symbol}`
        );
    }

    return ltp;
}

// ============================================================
// OPTION CONTRACTS
// ============================================================

async function getOptionContracts(
    symbol
) {
    await ensureScriptMaster();

    const target =
        normalizeSymbol(
            symbol
        );

    return scriptMaster.filter(
        item => {
            const exchange =
                String(
                    item.exch_seg ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            if (
                exchange !== "NFO"
            ) {
                return false;
            }

            const name =
                String(
                    item.name ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            const symbolName =
                String(
                    item.symbol ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            const underlying =
                String(
                    item.underlying ||
                    item.name ||
                    ""
                )
                    .trim()
                    .toUpperCase();

            return (
                name === target ||
                name === `${target}-EQ` ||
                underlying === target ||
                symbolName.startsWith(
                    target
                )
            );
        }
    );
}

// ============================================================
// OPTION TYPE
// ============================================================

function getOptionType(
    contract
) {
    const symbol =
        String(
            contract?.symbol ||
            ""
        )
            .trim()
            .toUpperCase();

    const type =
        String(
            contract?.instrumenttype ||
            contract?.instrument_type ||
            ""
        )
            .trim()
            .toUpperCase();

    if (
        type === "CE" ||
        symbol.endsWith("CE")
    ) {
        return "CE";
    }

    if (
        type === "PE" ||
        symbol.endsWith("PE")
    ) {
        return "PE";
    }

    return null;
}

// ============================================================
// OPTION EXPIRIES
// ============================================================

async function getOptionExpiries(
    symbol
) {
    const contracts =
        await getOptionContracts(
            symbol
        );

    const set =
        new Set();

    for (
        const contract of
        contracts
    ) {
        if (
            contract.expiry
        ) {
            set.add(
                String(
                    contract.expiry
                )
            );
        }
    }

    return Array.from(
        set
    ).sort(
        compareExpiry
    );
}

// ============================================================
// EXPIRY COMPARISON
// ============================================================

function compareExpiry(
    a,
    b
) {
    const da =
        parseExpiryDate(
            a
        );

    const db =
        parseExpiryDate(
            b
        );

    return da - db;
}

// ============================================================
// PARSE EXPIRY
// ============================================================

function parseExpiryDate(
    expiry
) {
    const text =
        String(
            expiry || ""
        )
            .trim()
            .toUpperCase();

    if (
        /^\d{4}-\d{2}-\d{2}$/.test(
            text
        )
    ) {
        return new Date(
            `${text}T00:00:00`
        );
    }

    const match =
        text.match(
            /^(\d{2})([A-Z]{3})(\d{4})$/
        );

    if (!match) {
        return new Date(
            text
        );
    }

    const day =
        Number(
            match[1]
        );

    const monthMap = {
        JAN: 0,
        FEB: 1,
        MAR: 2,
        APR: 3,
        MAY: 4,
        JUN: 5,
        JUL: 6,
        AUG: 7,
        SEP: 8,
        OCT: 9,
        NOV: 10,
        DEC: 11
    };

    return new Date(
        Number(
            match[3]
        ),
        monthMap[
            match[2]
        ],
        day
    );
}

// ============================================================
// SELECT VALID EXPIRY
// ============================================================

async function getValidOptionExpiry(
    symbol,
    minimumDays = 7
) {
    const expiries =
        await getOptionExpiries(
            symbol
        );

    if (
        expiries.length === 0
    ) {
        return null;
    }

    const today =
        new Date();

    today.setHours(
        0,
        0,
        0,
        0
    );

    const minimum =
        new Date(
            today
        );

    minimum.setDate(
        minimum.getDate() +
        Number(
            minimumDays
        )
    );

    for (
        const expiry of
        expiries
    ) {
        const date =
            parseExpiryDate(
                expiry
            );

        if (
            !Number.isNaN(
                date.getTime()
            ) &&
            date >= minimum
        ) {
            return expiry;
        }
    }

    return null;
}

// ============================================================
// OPTION CONTRACT
// ============================================================

async function getOptionContract(
    symbol,
    strike,
    optionType,
    minimumDays = 7,
    expiry = null
) {
    const contracts =
        await getOptionContracts(
            symbol
        );

    if (
        contracts.length === 0
    ) {
        return null;
    }

    const selectedExpiry =
        expiry ||
        await getValidOptionExpiry(
            symbol,
            minimumDays
        );

    if (!selectedExpiry) {
        return null;
    }

    const targetStrike =
        Number(
            strike
        );

    if (
        !Number.isFinite(
            targetStrike
        )
    ) {
        return null;
    }

    const targetType =
        String(
            optionType
        )
            .trim()
            .toUpperCase() ===
        "CALL"
            ? "CE"
            : "PE";

    const contract =
        contracts.find(
            item => {
                const itemStrike =
                    toNumber(
                        item.strike,
                        NaN
                    );

                const itemType =
                    getOptionType(
                        item
                    );

                return (
                    itemStrike ===
                        targetStrike &&

                    itemType ===
                        targetType &&

                    String(
                        item.expiry
                    ) ===
                        String(
                            selectedExpiry
                        )
                );
            }
        );

    if (!contract) {
        return null;
    }

    return normalizeOptionContract(
        contract
    );
}

// ============================================================
// NORMALIZE OPTION CONTRACT
// ============================================================

function normalizeOptionContract(
    contract
) {
    return {
        expiry:
            contract.expiry ||
            null,

        tradingSymbol:
            contract.symbol ||
            contract.tradingsymbol ||
            null,

        symbol:
            contract.symbol ||
            contract.tradingsymbol ||
            null,

        instrumentKey:
            `${contract.exch_seg || "NFO"}|${contract.token}`,

        symbolToken:
            String(
                contract.token ||
                ""
            ),

        strike:
            toNumber(
                contract.strike,
                NaN
            ),

        optionType:
            getOptionType(
                contract
            ),

        lotSize:
            toNumber(
                contract.lotsize,
                0
            ),

        tickSize:
            toNumber(
                contract.tick_size,
                0
            ),

        exchange:
            contract.exch_seg ||
            "NFO",

        raw:
            contract
    };
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
    return getOptionContract(
        symbol,
        strike,
        optionType,
        minimumDays,
        expiry
    );
}

// ============================================================
// OPTION LTP
// ============================================================

async function getOptionLTP(
    instrumentKey
) {
    if (!instrumentKey) {
        throw new Error(
            "Option instrument key is required"
        );
    }

    const parts =
        String(
            instrumentKey
        ).split("|");

    if (
        parts.length !== 2
    ) {
        throw new Error(
            `Invalid Angel One option instrument key: ${instrumentKey}`
        );
    }

    const exchange =
        parts[0];

    const token =
        parts[1];

    const response =
        await axios.post(
            `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
            {
                mode:
                    "LTP",

                exchangeTokens: {
                    [exchange]: [
                        token
                    ]
                }
            },
            {
                headers:
                    getHeaders(),

                timeout:
                    REQUEST_TIMEOUT
            }
        );

    const data =
        response.data;

    if (
        !data ||
        data.status !== true
    ) {
        throw new Error(
            `Angel One option LTP failed: ${
                data?.message ||
                instrumentKey
            }`
        );
    }

    const fetched =
        data.data?.fetched ||
        [];

    const item =
        fetched[0];

    if (!item) {
        throw new Error(
            `Option LTP not available: ${instrumentKey}`
        );
    }

    const ltp =
        toNumber(
            item.ltp,
            NaN
        );

    if (
        !Number.isFinite(
            ltp
        )
    ) {
        throw new Error(
            `Invalid option LTP: ${instrumentKey}`
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
    if (!instrumentKey) {
        throw new Error(
            "Option instrument key is required"
        );
    }

    const parts =
        String(
            instrumentKey
        ).split("|");

    if (
        parts.length !== 2
    ) {
        throw new Error(
            `Invalid Angel One option instrument key: ${instrumentKey}`
        );
    }

    const exchange =
        parts[0];

    const token =
        parts[1];

    const response =
        await axios.post(
            `${BASE_URL}/rest/secure/angelbroking/market/v1/quote/`,
            {
                mode:
                    "FULL",

                exchangeTokens: {
                    [exchange]: [
                        token
                    ]
                }
            },
            {
                headers:
                    getHeaders(),

                timeout:
                    REQUEST_TIMEOUT
            }
        );

    const data =
        response.data;

    if (
        !data ||
        data.status !== true
    ) {
        throw new Error(
            `Angel One option quote failed: ${
                data?.message ||
                instrumentKey
            }`
        );
    }

    const fetched =
        data.data?.fetched ||
        [];

    const item =
        fetched[0];

    if (!item) {
        throw new Error(
            `Option quote not available: ${instrumentKey}`
        );
    }

    return {
        instrumentKey,

        ltp:
            toNumber(
                item.ltp
            ),

        open:
            toNumber(
                item.open
            ),

        high:
            toNumber(
                item.high
            ),

        low:
            toNumber(
                item.low
            ),

        close:
            toNumber(
                item.close
            ),

        volume:
            toNumber(
                item.tradeVolume ||
                item.tradedVolume ||
                0
            ),

        timestamp:
            item.exchangeTimestamp ||
            item.lastTradeTimestamp ||
            null,

        raw:
            item
    };
}

// ============================================================
// OPTION CHAIN
// ============================================================

async function getOptionChain(
    symbol,
    expiryDate
) {
    const contracts =
        await getOptionContracts(
            symbol
        );

    const targetExpiry =
        expiryDate ||
        await getValidOptionExpiry(
            symbol
        );

    if (!targetExpiry) {
        return [];
    }

    return contracts
        .filter(
            contract =>
                String(
                    contract.expiry
                ) ===
                String(
                    targetExpiry
                )
        )
        .map(
            normalizeOptionContract
        );
}

// ============================================================
// OPTION EXPIRY LIST
// ============================================================

async function getOptionExpiryList(
    symbol
) {
    return getOptionExpiries(
        symbol
    );
}

// ============================================================
// VALID EXPIRY
// ============================================================

async function getValidExpiry(
    symbol,
    minimumDays = 7
) {
    return getValidOptionExpiry(
        symbol,
        minimumDays
    );
}

// ============================================================
// CONTRACTS FOR EXPIRY
// ============================================================

async function getContractsForExpiry(
    symbol,
    expiry
) {
    const contracts =
        await getOptionContracts(
            symbol
        );

    return contracts
        .filter(
            contract =>
                String(
                    contract.expiry
                ) ===
                String(
                    expiry
                )
        )
        .map(
            normalizeOptionContract
        );
}

// ============================================================
// AVAILABLE STRIKES
// ============================================================

async function getAvailableOptionStrikes(
    symbol,
    expiry,
    optionType = null
) {
    const contracts =
        await getContractsForExpiry(
            symbol,
            expiry
        );

    let filtered =
        contracts;

    if (optionType) {
        const targetType =
            String(
                optionType
            )
                .toUpperCase() ===
            "CALL"
                ? "CE"
                : "PE";

        filtered =
            contracts.filter(
                contract =>
                    contract.optionType ===
                    targetType
            );
    }

    return filtered
        .map(
            contract =>
                contract.strike
        )
        .filter(
            strike =>
                Number.isFinite(
                    strike
                )
        )
        .sort(
            (a, b) =>
                a - b
        );
}

// ============================================================
// EXACT OPTION CONTRACT
// ============================================================

async function getExactOptionContract(
    symbol,
    optionType,
    strike,
    expiry = null
) {
    return getOptionContract(
        symbol,
        strike,
        optionType,
        0,
        expiry
    );
}

// ============================================================
// OPTION DETAILS
// ============================================================

async function getOptionDetails(
    symbol,
    optionType,
    strike,
    expiry = null
) {
    return getOptionContract(
        symbol,
        strike,
        optionType,
        0,
        expiry
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
            strike,
            optionType,
            0,
            expiry
        );

    return (
        contract?.lotSize ||
        0
    );
}

// ============================================================
// OPTION INSTRUMENT KEY
// ============================================================

async function getOptionInstrumentKeyForContract(
    symbol,
    optionType,
    strike,
    expiry = null
) {
    const contract =
        await getOptionContract(
            symbol,
            strike,
            optionType,
            0,
            expiry
        );

    return (
        contract?.instrumentKey ||
        null
    );
}

// ============================================================
// EQUITY INSTRUMENT
// ============================================================

async function getEquityInstrument(
    symbol
) {
    return getInstrument(
        symbol
    );
}

// ============================================================
// ACTIVE BROKER
// ============================================================

function getActiveBroker() {
    return "ANGELONE";
}

// ============================================================
// ACCESS TOKEN
// ============================================================

function getAccessToken() {
    if (!accessToken) {
        throw new Error(
            "Angel One access token is not available"
        );
    }

    return accessToken;
}

// ============================================================
// REFRESH TOKEN
// ============================================================

function getRefreshToken() {
    return refreshToken;
}

// ============================================================
// FEED TOKEN
// ============================================================

function getFeedToken() {
    return feedToken;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {

    brokerName:
        "ANGELONE",

    getActiveBroker,

    login,

    logout,

    isLoggedIn,

    loadInstruments,

    getInstrument,

    getEquityInstrument,

    getInstrumentToken,

    getInstrumentKey,

    getHistoricalData,

    getQuote,

    getLTP,

    getOptionContracts,

    getOptionChain,

    getOptionLTP,

    getOptionQuote,

    getOptionContract,

    getOptionContractBySymbol,

    getExactOptionContract,

    getOptionDetails,

    getOptionLotSize,

    getOptionInstrumentKeyForContract,

    getOptionExpiries,

    getOptionExpiryList,

    getValidOptionExpiry,

    getValidExpiry,

    getContractsForExpiry,

    getAvailableOptionStrikes,

    getAccessToken,

    getRefreshToken,

    getFeedToken,

    INTERVALS
};