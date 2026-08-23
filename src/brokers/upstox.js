const axios = require("axios");
const zlib = require("zlib");

// ============================================================
// UPSTOX BROKER ADAPTER
// ============================================================
// Contract lookup hardening:
// - Accept CE/PE and CALL/PUT from every known Upstox field.
// - Normalize expiry values before comparison.
// - Never require an exact requested strike; choose nearest valid strike.
// - Keep underlying instrument lookup broker-independent.
// ============================================================

const BASE_URL = "https://api.upstox.com";

let instruments = [];
let instrumentsLoaded = false;

async function login() {
    const accessToken = process.env.UPSTOX_ACCESS_TOKEN;
    if (!accessToken) throw new Error("UPSTOX_ACCESS_TOKEN is missing in .env");
    console.log("✅ Upstox Access Token Found");
    return { accessToken };
}

function getAccessToken() {
    const token = process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) throw new Error("UPSTOX_ACCESS_TOKEN is missing in .env");
    return token;
}

function getApiError(error, fallback = "Upstox API error") {
    const status = error?.response?.status;
    const data = error?.response?.data;
    let message = data?.errors?.[0]?.message || data?.message || error?.message || fallback;
    if (status) message = `HTTP ${status}: ${message}`;
    return message;
}

async function loadInstruments() {
    if (instrumentsLoaded && instruments.length > 0) return instruments;
    console.log("📥 Loading Upstox instrument master...");
    try {
        const response = await axios.get(
            "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",
            { timeout: 30000, responseType: "arraybuffer" }
        );
        const parsed = JSON.parse(zlib.gunzipSync(response.data).toString());
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error("Upstox instrument master is empty or invalid");
        }
        instruments = parsed;
        instrumentsLoaded = true;
        console.log(`✅ Upstox Instruments Loaded: ${instruments.length}`);
        return instruments;
    } catch (error) {
        instruments = [];
        instrumentsLoaded = false;
        throw new Error(`Failed to load Upstox instrument master: ${getApiError(error)}`);
    }
}

async function ensureInstrumentsLoaded() {
    if (!instrumentsLoaded || instruments.length === 0) await loadInstruments();
    return instruments;
}

function normalizeSymbol(symbol) {
    return String(symbol || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isInstrumentKey(value) {
    return typeof value === "string" && value.includes("|");
}

async function getInstrument(symbol) {
    await ensureInstrumentsLoaded();
    const target = normalizeSymbol(symbol);
    if (!target) return null;

    if (isInstrumentKey(target)) {
        return instruments.find(item => String(item.instrument_key || "").trim() === target) || null;
    }

    let instrument = instruments.find(item => {
        const segment = String(item.segment || "").trim().toUpperCase();
        if (segment !== "NSE_EQ") return false;
        return [item.trading_symbol, item.short_name, item.name]
            .map(normalizeSymbol)
            .includes(target);
    });

    if (!instrument) {
        instrument = instruments.find(item => {
            const exchange = String(item.exchange || "").trim().toUpperCase();
            const segment = String(item.segment || "").trim().toUpperCase();
            return (segment === "NSE_EQ" || exchange === "NSE") &&
                normalizeSymbol(item.trading_symbol) === target;
        });
    }
    return instrument || null;
}

async function getInstrumentKey(symbol) {
    if (symbol === null || symbol === undefined) return null;
    const resolved = await Promise.resolve(symbol);
    if (typeof resolved === "string" && isInstrumentKey(resolved.trim())) return resolved.trim();
    if (resolved && typeof resolved === "object") {
        const key = resolved.instrument_key || resolved.instrumentKey || resolved.key;
        if (typeof key === "string" && isInstrumentKey(key.trim())) return key.trim();
    }
    const instrument = await getInstrument(resolved);
    return instrument?.instrument_key || null;
}

async function resolveInstrumentKey(value) {
    let resolved = await Promise.resolve(value);
    if (resolved && typeof resolved === "object") {
        resolved = resolved.instrument_key || resolved.instrumentKey || resolved.key || null;
    }
    if (typeof resolved !== "string") return null;
    resolved = resolved.trim();
    if (!resolved) return null;
    if (isInstrumentKey(resolved)) return resolved;
    return getInstrumentKey(resolved);
}

const INTERVALS = {
    ONE_DAY: { unit: "days", interval: "1" },
    FOUR_HOUR: { unit: "hours", interval: "4" },
    ONE_HOUR: { unit: "hours", interval: "1" },
    THIRTY_MINUTE: { unit: "minutes", interval: "30" },
    FIFTEEN_MINUTE: { unit: "minutes", interval: "15" },
    FIVE_MINUTE: { unit: "minutes", interval: "5" }
};

function formatDateIST(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const values = {};
    for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
    return `${values.year}-${values.month}-${values.day}`;
}

function getDaysBack(interval) {
    switch (interval) {
        case "ONE_DAY": return 450;
        case "FOUR_HOUR": return 85;
        case "ONE_HOUR": return 85;
        case "THIRTY_MINUTE": return 85;
        case "FIFTEEN_MINUTE": return 28;
        case "FIVE_MINUTE": return 28;
        default: return 28;
    }
}

function isValidCandle(candle) {
    if (!candle || !candle.time) return false;
    const open = Number(candle.open), high = Number(candle.high), low = Number(candle.low), close = Number(candle.close);
    return Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) &&
        high >= low && high >= open && high >= close && low <= open && low <= close;
}

async function fetchHistoricalCandles(instrumentKey, interval) {
    const intervalData = INTERVALS[interval];
    if (!intervalData) throw new Error(`Unsupported interval: ${interval}`);
    const today = new Date();
    const from = new Date(today);
    from.setDate(today.getDate() - getDaysBack(interval));
    const url = `${BASE_URL}/v3/historical-candle/${encodeURIComponent(instrumentKey)}/${intervalData.unit}/${intervalData.interval}/${formatDateIST(today)}/${formatDateIST(from)}`;
    try {
        const response = await axios.get(url, {
            headers: { Accept: "application/json", Authorization: `Bearer ${getAccessToken()}` },
            timeout: 20000
        });
        const rawCandles = response?.data?.data?.candles;
        if (!Array.isArray(rawCandles) || rawCandles.length === 0) throw new Error("EMPTY_DATA");
        const candles = rawCandles.map(candle => {
            if (!Array.isArray(candle) || candle.length < 5) return null;
            return { time: candle[0], open: Number(candle[1]), high: Number(candle[2]), low: Number(candle[3]), close: Number(candle[4]), volume: Number(candle[5] || 0) };
        }).filter(isValidCandle).sort((a, b) => new Date(a.time) - new Date(b.time));
        if (!candles.length) throw new Error("No valid historical candles after validation");
        return candles;
    } catch (error) {
        throw new Error(`Upstox historical data failed | ${instrumentKey} | ${interval} | ${getApiError(error)}`);
    }
}

async function getHistoricalData(symbol, interval = "ONE_DAY") {
    const instrumentKey = await resolveInstrumentKey(symbol);
    if (!instrumentKey) throw new Error(`Upstox instrument not found: ${symbol}`);
    if (!INTERVALS[interval]) throw new Error(`Unsupported Upstox timeframe: ${interval}`);
    return fetchHistoricalCandles(instrumentKey, interval);
}

async function getQuote(symbol) {
    const instrumentKey = await resolveInstrumentKey(symbol);
    if (!instrumentKey) throw new Error(`Upstox instrument not found: ${symbol}`);
    try {
        const response = await axios.get(`${BASE_URL}/v3/market-quote/ltp?instrument_key=${encodeURIComponent(instrumentKey)}`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${getAccessToken()}` }, timeout: 10000
        });
        if (!response?.data?.data) throw new Error("Invalid Upstox LTP response");
        return response.data;
    } catch (error) {
        throw new Error(`Upstox quote failed | ${instrumentKey} | ${getApiError(error)}`);
    }
}

async function getOptionLTP(instrumentKey) {
    const resolvedKey = await resolveInstrumentKey(instrumentKey);
    if (!resolvedKey) throw new Error(`Invalid option instrument key: ${instrumentKey}`);
    const response = await getQuote(resolvedKey);
    const data = response.data || {};
    const firstKey = Object.keys(data)[0];
    const ltp = Number(data[firstKey]?.last_price);
    if (!firstKey || !Number.isFinite(ltp) || ltp <= 0) throw new Error(`Invalid option LTP for ${resolvedKey}`);
    return ltp;
}

async function getOptionQuote(instrumentKey) {
    const resolvedKey = await resolveInstrumentKey(instrumentKey);
    if (!resolvedKey) throw new Error(`Invalid option instrument key: ${instrumentKey}`);
    const response = await getQuote(resolvedKey);
    const data = response.data || {};
    const firstKey = Object.keys(data)[0];
    const quote = data[firstKey];
    const ltp = Number(quote?.last_price);
    if (!firstKey || !Number.isFinite(ltp) || ltp <= 0) throw new Error(`Invalid option LTP for ${resolvedKey}`);
    return { instrumentKey: resolvedKey, ltp, volume: Number(quote.volume || 0), open: Number(quote.open || 0), high: Number(quote.high || 0), low: Number(quote.low || 0), close: Number(quote.close || 0), timestamp: quote.timestamp || null, raw: quote };
}

async function getOptionContracts(underlyingInstrumentKey) {
    const resolvedKey = await resolveInstrumentKey(underlyingInstrumentKey);
    if (!resolvedKey) throw new Error(`Invalid Upstox underlying instrument key: ${underlyingInstrumentKey}`);
    const url = `${BASE_URL}/v2/option/contract?instrument_key=${encodeURIComponent(resolvedKey)}`;
    try {
        const response = await axios.get(url, {
            headers: { Accept: "application/json", Authorization: `Bearer ${getAccessToken()}` }, timeout: 15000
        });
        if (!Array.isArray(response?.data?.data)) throw new Error("Invalid Upstox option contract response");
        return response.data.data;
    } catch (error) {
        throw new Error(`Upstox option contract failed | ${getApiError(error)}`);
    }
}

function normalizeOptionType(optionType) {
    const type = String(optionType || "").trim().toUpperCase();
    if (["CALL", "CE", "C"].includes(type)) return "CE";
    if (["PUT", "PE", "P"].includes(type)) return "PE";
    return null;
}

function normalizeExpiry(expiry) {
    if (!expiry) return "";
    const value = String(expiry).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().slice(0, 10);
}

function getContractOptionType(contract) {
    const direct = normalizeOptionType(
        contract?.instrument_type || contract?.option_type || contract?.optionType || contract?.option_type_name
    );
    if (direct) return direct;
    const symbol = String(contract?.trading_symbol || contract?.tradingsymbol || "").toUpperCase();
    if (/CE$/.test(symbol)) return "CE";
    if (/PE$/.test(symbol)) return "PE";
    return null;
}

function selectExpiry(contracts, minimumDays = 7) {
    if (!Array.isArray(contracts) || !contracts.length) return null;
    const minimum = Number.isFinite(Number(minimumDays)) ? Number(minimumDays) : 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiryDates = [...new Set(contracts.map(c => normalizeExpiry(c?.expiry)).filter(Boolean))];
    const valid = expiryDates.map(expiry => {
        const expiryDate = new Date(`${expiry}T00:00:00`);
        if (Number.isNaN(expiryDate.getTime())) return null;
        return { expiry, expiryDate, daysToExpiry: Math.ceil((expiryDate - today) / 86400000) };
    }).filter(Boolean).filter(x => x.daysToExpiry >= minimum).sort((a, b) => a.expiryDate - b.expiryDate);
    return valid[0] || null;
}

function findOptionContract(contracts, strike, optionType, selectedExpiry) {
    if (!Array.isArray(contracts) || !contracts.length) return null;
    const targetStrike = Number(strike);
    const targetType = normalizeOptionType(optionType);
    const targetExpiry = normalizeExpiry(selectedExpiry);
    if (!Number.isFinite(targetStrike) || targetStrike <= 0 || !targetType || !targetExpiry) return null;

    const validContracts = contracts.filter(contract => {
        const contractStrike = Number(contract?.strike_price ?? contract?.strike);
        const contractType = getContractOptionType(contract);
        const contractExpiry = normalizeExpiry(contract?.expiry);
        return Number.isFinite(contractStrike) && contractStrike > 0 &&
            contractType === targetType && contractExpiry === targetExpiry &&
            Boolean(contract?.instrument_key || contract?.instrumentKey);
    });

    if (!validContracts.length) return null;

    return validContracts.reduce((nearest, contract) => {
        const distance = Math.abs(Number(contract.strike_price ?? contract.strike) - targetStrike);
        if (!nearest || distance < nearest.distance) return { contract, distance };
        return nearest;
    }, null)?.contract || null;
}

async function getOptionContract(symbol, arg2, arg3, arg4 = null, arg5 = null) {
    let optionType, strike, minimumDays = 7, expiry = null;
    const normalizedArg2 = normalizeOptionType(arg2);
    if (normalizedArg2) {
        optionType = normalizedArg2;
        strike = arg3;
        expiry = arg4;
        if (arg5 !== null && arg5 !== undefined && Number.isFinite(Number(arg5))) minimumDays = Number(arg5);
    } else {
        strike = arg2;
        optionType = normalizeOptionType(arg3);
        if (arg4 !== null && arg4 !== undefined && Number.isFinite(Number(arg4))) minimumDays = Number(arg4);
        expiry = arg5;
    }
    if (!optionType) throw new Error(`Invalid option type: ${arg2 || arg3}`);
    const numericStrike = Number(strike);
    if (!Number.isFinite(numericStrike) || numericStrike <= 0) throw new Error(`Invalid option strike: ${strike}`);

    const underlyingInstrumentKey = await resolveInstrumentKey(symbol);
    if (!underlyingInstrumentKey) throw new Error(`Upstox underlying instrument not found: ${symbol}`);
    const contracts = await getOptionContracts(underlyingInstrumentKey);
    if (!contracts.length) throw new Error("No option contracts found");

    let expiryInfo;
    if (expiry) {
        const expiryString = normalizeExpiry(expiry);
        const expiryDate = new Date(`${expiryString}T00:00:00`);
        if (Number.isNaN(expiryDate.getTime())) throw new Error(`Invalid expiry: ${expiry}`);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const daysToExpiry = Math.ceil((expiryDate - today) / 86400000);
        if (daysToExpiry < minimumDays) throw new Error(`Expiry ${expiryString} has only ${daysToExpiry} days remaining; minimum required is ${minimumDays}`);
        expiryInfo = { expiry: expiryString, daysToExpiry };
    } else {
        expiryInfo = selectExpiry(contracts, minimumDays);
    }
    if (!expiryInfo) throw new Error(`No expiry available with minimum ${minimumDays} days`);

    const contract = findOptionContract(contracts, numericStrike, optionType, expiryInfo.expiry);
    if (!contract) throw new Error(`No valid option contract found | Requested Strike: ${numericStrike} | Type: ${optionType} | Expiry: ${expiryInfo.expiry}`);

    const instrumentKey = contract.instrument_key || contract.instrumentKey;
    const lotSize = Number(contract.lot_size ?? contract.lotSize);
    if (!instrumentKey) throw new Error(`Instrument key missing for ${contract.trading_symbol || contract.tradingsymbol || "contract"}`);
    if (!Number.isFinite(lotSize) || lotSize <= 0) throw new Error(`Invalid lot size for ${contract.trading_symbol || contract.tradingsymbol || instrumentKey}`);

    return {
        expiry: normalizeExpiry(contract.expiry), expiryDays: expiryInfo.daysToExpiry, instrumentKey,
        tradingSymbol: contract.trading_symbol || contract.tradingsymbol || "", strike: Number(contract.strike_price ?? contract.strike),
        optionType: getContractOptionType(contract) || optionType, lotSize, tickSize: Number(contract.tick_size || contract.tickSize || 0),
        weekly: contract.weekly, underlyingKey: contract.underlying_key || contract.underlyingKey, rawContract: contract
    };
}

async function getOptionChain(symbol, expiryDate) {
    const instrumentKey = await resolveInstrumentKey(symbol);
    if (!instrumentKey) throw new Error(`Upstox underlying instrument not found: ${symbol}`);
    if (!expiryDate) throw new Error("Expiry date is required");
    try {
        const response = await axios.get(`${BASE_URL}/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(normalizeExpiry(expiryDate))}`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${getAccessToken()}` }, timeout: 15000
        });
        if (!Array.isArray(response?.data?.data)) throw new Error("Invalid Upstox option chain response");
        return response.data.data;
    } catch (error) {
        throw new Error(`Upstox option chain failed | ${getApiError(error)}`);
    }
}

async function getOptionContractBySymbol(symbol, optionType, strike, expiry = null, minimumDays = 7) {
    return getOptionContract(symbol, optionType, strike, expiry, minimumDays);
}
async function getOptionLTPByContract(contract) {
    if (!contract?.instrumentKey) throw new Error("Valid option contract with instrumentKey is required");
    return getOptionLTP(contract.instrumentKey);
}
async function getOptionQuoteByContract(contract) {
    if (!contract?.instrumentKey) throw new Error("Valid option contract with instrumentKey is required");
    return getOptionQuote(contract.instrumentKey);
}
function selectValidExpiry(expiries, minimumDays = 7) {
    const selected = selectExpiry((expiries || []).map(expiry => ({ expiry })), minimumDays);
    return selected?.expiry || null;
}
async function getOptionExpiries(symbol) {
    const contracts = await getOptionContracts(symbol);
    return [...new Set(contracts.map(c => normalizeExpiry(c.expiry)).filter(Boolean))].sort();
}
async function getValidOptionExpiry(symbol, minimumDays = 7) {
    const selected = selectExpiry(await getOptionContracts(symbol), minimumDays);
    return selected?.expiry || null;
}
async function getExpiryOptionContracts(symbol, expiry) {
    const target = normalizeExpiry(expiry);
    return (await getOptionContracts(symbol)).filter(c => normalizeExpiry(c.expiry) === target);
}
async function getOptionContractDetails(symbol, optionType, strike, expiry = null) {
    return getOptionContract(symbol, optionType, strike, expiry, 7);
}
async function getOptionLotSize(symbol, optionType, strike, expiry = null) {
    return (await getOptionContract(symbol, optionType, strike, expiry, 7)).lotSize;
}
async function getOptionInstrumentKey(symbol, optionType, strike, expiry = null) {
    return (await getOptionContract(symbol, optionType, strike, expiry, 7)).instrumentKey;
}
async function getOptionStrikes(symbol, expiry, optionType = null) {
    const normalizedType = optionType ? normalizeOptionType(optionType) : null;
    const contracts = await getExpiryOptionContracts(symbol, expiry);
    return [...new Set(contracts.filter(c => !normalizedType || getContractOptionType(c) === normalizedType).map(c => Number(c.strike_price ?? c.strike)).filter(Number.isFinite).filter(x => x > 0))].sort((a, b) => a - b);
}
function getOptionType(contract) { return getContractOptionType(contract); }
function validateOptionContract(contract) {
    if (!contract) return { valid: false, reason: "Contract not found" };
    const instrumentKey = contract.instrumentKey || contract.instrument_key;
    const strike = Number(contract.strike ?? contract.strike_price);
    const optionType = getOptionType(contract);
    if (!instrumentKey) return { valid: false, reason: "Instrument key missing" };
    if (!Number.isFinite(strike) || strike <= 0) return { valid: false, reason: "Invalid strike" };
    if (!optionType) return { valid: false, reason: "Invalid option type" };
    if (!contract.expiry) return { valid: false, reason: "Expiry missing" };
    return { valid: true, reason: null };
}
async function debugOptions(symbol) {
    const contracts = await getOptionContracts(symbol);
    return { symbol, contractCount: contracts.length, expiries: [...new Set(contracts.map(c => normalizeExpiry(c.expiry)).filter(Boolean))], sample: contracts.slice(0, 10) };
}
function safeNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function getOptionMarketData(option) {
    if (!option?.market_data) return { ltp: 0, closePrice: 0, oi: 0, prevOi: 0, volume: 0 };
    const market = option.market_data;
    return { ltp: safeNumber(market.ltp), closePrice: safeNumber(market.close_price), oi: safeNumber(market.oi), prevOi: safeNumber(market.prev_oi), volume: safeNumber(market.volume) };
}
function calculateOIChange(oi, prevOi) {
    const current = safeNumber(oi), previous = safeNumber(prevOi);
    if (previous <= 0) return { change: current, percent: 0 };
    const change = current - previous;
    return { change, percent: (change / previous) * 100 };
}
function classifyBuildup(priceChangePercent, oiChangePercent) {
    const priceChange = safeNumber(priceChangePercent), oiChange = safeNumber(oiChangePercent);
    const priceUp = priceChange > 0.10, priceDown = priceChange < -0.10, oiUp = oiChange > 1, oiDown = oiChange < -1;
    if (priceUp && oiUp) return "LONG BUILDUP";
    if (priceDown && oiUp) return "SHORT BUILDUP";
    if (priceUp && oiDown) return "SHORT COVERING";
    if (priceDown && oiDown) return "LONG UNWINDING";
    return "NEUTRAL";
}
function calculateOptionSideMood(option) {
    const market = getOptionMarketData(option), price = market.ltp, previousPrice = market.closePrice;
    const priceChangePercent = previousPrice > 0 ? ((price - previousPrice) / previousPrice) * 100 : 0;
    const oi = calculateOIChange(market.oi, market.prevOi);
    return { ltp: price, previousPrice, priceChangePercent, oi: market.oi, previousOI: market.prevOi, oiChange: oi.change, oiChangePercent: oi.percent, buildup: classifyBuildup(priceChangePercent, oi.percent) };
}
function findATMRow(chain) {
    if (!Array.isArray(chain) || !chain.length) return null;
    let spot = safeNumber(chain[0]?.underlying_spot_price);
    if (spot <= 0) for (const row of chain) { const candidate = safeNumber(row?.underlying_spot_price); if (candidate > 0) { spot = candidate; break; } }
    if (spot <= 0) return null;
    return chain.reduce((nearest, row) => {
        const strike = safeNumber(row.strike_price); if (strike <= 0) return nearest;
        const distance = Math.abs(strike - spot);
        return !nearest || distance < nearest.distance ? { row, distance } : nearest;
    }, null)?.row || null;
}
async function getOIMood(symbol, expiryDate = null) {
    try {
        const instrumentKey = await resolveInstrumentKey(symbol);
        if (!instrumentKey) throw new Error(`Instrument not found: ${symbol}`);
        let selectedExpiry = expiryDate;
        if (!selectedExpiry) selectedExpiry = await getValidOptionExpiry(instrumentKey, 7);
        if (!selectedExpiry) throw new Error("No valid option expiry found");
        const chain = await getOptionChain(instrumentKey, selectedExpiry);
        if (!chain.length) throw new Error("Empty option chain");
        const atm = findATMRow(chain); if (!atm) throw new Error("ATM option row not found");
        const callAnalysis = calculateOptionSideMood(atm.call_options), putAnalysis = calculateOptionSideMood(atm.put_options);
        let callOI = 0, putOI = 0, previousCallOI = 0, previousPutOI = 0, totalCallVolume = 0, totalPutVolume = 0;
        for (const row of chain) {
            const call = getOptionMarketData(row.call_options), put = getOptionMarketData(row.put_options);
            callOI += call.oi; putOI += put.oi; previousCallOI += call.prevOi; previousPutOI += put.prevOi; totalCallVolume += call.volume; totalPutVolume += put.volume;
        }
        const callOIChange = calculateOIChange(callOI, previousCallOI), putOIChange = calculateOIChange(putOI, previousPutOI);
        let sentiment = putOIChange.percent > callOIChange.percent ? "BULLISH" : callOIChange.percent > putOIChange.percent ? "BEARISH" : "NEUTRAL";
        const mood = callAnalysis.buildup !== "NEUTRAL" ? callAnalysis.buildup : putAnalysis.buildup !== "NEUTRAL" ? putAnalysis.buildup : "NEUTRAL";
        return { available: true, symbol, instrumentKey, expiry: selectedExpiry, spot: safeNumber(atm.underlying_spot_price), mood, sentiment, atmStrike: safeNumber(atm.strike_price), call: callAnalysis, put: putAnalysis, totalCallOI: callOI, totalPutOI: putOI, previousCallOI, previousPutOI, callOIChange: callOIChange.change, putOIChange: putOIChange.change, callOIChangePercent: callOIChange.percent, putOIChangePercent: putOIChange.percent, totalCallVolume, totalPutVolume, pcr: callOI > 0 ? putOI / callOI : 0 };
    } catch (error) {
        console.log(`⚠️ OI Mood unavailable for ${symbol}: ${error.message}`);
        return { available: false, symbol, mood: "NEUTRAL", sentiment: "NEUTRAL", error: error.message };
    }
}

const name = "UPSTOX";

module.exports = {
    name, login, loadInstruments, getAccessToken, getHistoricalData, getQuote, getOptionLTP, getOptionQuote,
    getInstrument, getInstrumentKey, getOptionChain, getOptionContracts, getOptionContract, getOptionContractBySymbol,
    getOptionLTPByContract, getOptionQuoteByContract, getOptionExpiries, getExpiryOptionContracts, getValidOptionExpiry,
    getOptionContractDetails, getOptionLotSize, getOptionInstrumentKey, getOptionStrikes, normalizeOptionType, getOptionType,
    validateOptionContract, debugOptions, selectExpiry, selectValidExpiry, findOptionContract, getOIMood, calculateOIChange,
    classifyBuildup, INTERVALS
};
