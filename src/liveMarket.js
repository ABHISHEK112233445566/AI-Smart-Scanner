const axios = require("axios");

const UPSTOX_BASE = "https://api.upstox.com";
const MAX_TOP_STOCKS = 20;
const MIN_VOLUME = 1;
const MIN_OI = 1;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeQuoteMap(data) {
  const out = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (!value || typeof value !== "object") continue;
    out.push({
      instrumentKey: value.instrument_token || value.instrumentKey || key,
      symbol: value.symbol || "",
      price: n(value.last_price),
      volume: n(value.volume),
      oi: n(value.oi),
      previousOI: n(value.prev_oi ?? value.previous_oi),
      oiDayHigh: n(value.oi_day_high),
      oiDayLow: n(value.oi_day_low),
      timestamp: value.timestamp || null,
      raw: value
    });
  }
  return out;
}

async function upstoxFullQuotes(instrumentKeys) {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error("UPSTOX_ACCESS_TOKEN is missing");
  const keys = [...new Set(instrumentKeys.filter(Boolean))];
  if (!keys.length) return [];
  const response = await axios.get(`${UPSTOX_BASE}/v2/market-quote/quotes`, {
    params: { instrument_key: keys.join(",") },
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    timeout: 15000
  });
  return normalizeQuoteMap(response?.data?.data);
}

async function resolveEquityKeys(symbols, broker) {
  const rows = [];
  for (const symbol of symbols) {
    try {
      const instrument = await broker.getInstrument(symbol);
      const key = instrument?.instrument_key || instrument?.instrumentKey || null;
      if (key) rows.push({ symbol, key });
    } catch (_) {}
  }
  return rows;
}

async function getTop20ByLiveVolume(symbols, broker, limit = MAX_TOP_STOCKS) {
  const source = [...new Set((Array.isArray(symbols) ? symbols : []).map(x => String(x || "").trim().toUpperCase()).filter(Boolean))];
  const resolved = await resolveEquityKeys(source, broker);
  if (!resolved.length) throw new Error("No NSE equity instruments resolved for live-volume ranking");

  let quotes = [];
  const chunkSize = 450;
  for (let i = 0; i < resolved.length; i += chunkSize) {
    const chunk = resolved.slice(i, i + chunkSize);
    const result = await upstoxFullQuotes(chunk.map(x => x.key));
    const byKey = new Map(result.map(q => [q.instrumentKey, q]));
    for (const item of chunk) {
      const q = byKey.get(item.key);
      if (q) quotes.push({ symbol: item.symbol, instrumentKey: item.key, ...q });
    }
  }

  const valid = quotes.filter(q => q.price > 0 && q.volume >= MIN_VOLUME);
  if (!valid.length) throw new Error("Live market volume unavailable for scanner universe");

  valid.sort((a, b) => (b.volume - a.volume) || (b.price - a.price));
  const top = valid.slice(0, limit).map((q, index) => ({
    ...q,
    liveVolumeRank: index + 1,
    volumeConfirmed: q.volume > 0,
    liveMarketConfirmed: true
  }));

  return { top, allQuotes: valid, universeSize: source.length };
}

function chooseContract(contracts, direction, spot) {
  const side = direction === "BULLISH" ? "CE" : "PE";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const usable = (Array.isArray(contracts) ? contracts : []).filter(c => {
    const expiry = String(c?.expiry || "");
    const d = expiry ? new Date(`${expiry}T00:00:00`) : null;
    const days = d && !Number.isNaN(d.getTime()) ? Math.ceil((d - today) / 86400000) : -1;
    return String(c?.instrument_type || c?.option_type || "").toUpperCase() === side && days >= 7 && n(c?.strike_price ?? c?.strike) > 0 && (c?.instrument_key || c?.instrumentKey);
  });
  if (!usable.length) return null;
  const expiry = [...new Set(usable.map(c => c.expiry))].sort()[0];
  const sameExpiry = usable.filter(c => c.expiry === expiry);
  return sameExpiry.reduce((best, c) => {
    if (!best) return c;
    return Math.abs(n(c.strike_price ?? c.strike) - spot) < Math.abs(n(best.strike_price ?? best.strike) - spot) ? c : best;
  }, null);
}

async function getOptionConfirmation(row, direction, broker) {
  const symbol = row?.symbol || row?.stock;
  const spot = n(row?.price);
  if (!symbol || spot <= 0 || !broker || typeof broker.getOptionContracts !== "function") {
    return { confirmed: false, reason: "OPTION_DATA_API_UNAVAILABLE" };
  }
  try {
    const contracts = await broker.getOptionContracts(symbol);
    const contract = chooseContract(contracts, direction, spot);
    if (!contract) return { confirmed: false, reason: "NO_VALID_OPTION_CONTRACT" };
    const key = contract.instrument_key || contract.instrumentKey;
    const [quote] = await upstoxFullQuotes([key]);
    if (!quote) return { confirmed: false, reason: "LIVE_OPTION_QUOTE_UNAVAILABLE", optionInstrumentKey: key };
    const volume = n(quote.volume);
    const oi = n(quote.oi);
    const previousOI = n(quote.previousOI);
    const oiChange = previousOI > 0 ? oi - previousOI : 0;
    const oiChangePercent = previousOI > 0 ? (oiChange / previousOI) * 100 : 0;
    return {
      confirmed: volume >= MIN_VOLUME && oi >= MIN_OI,
      reason: volume >= MIN_VOLUME && oi >= MIN_OI ? "LIVE_VOLUME_OI_CONFIRMED" : "INSUFFICIENT_LIVE_OPTION_VOLUME_OI",
      optionSymbol: contract.trading_symbol || "",
      optionInstrumentKey: key,
      optionType: direction === "BULLISH" ? "CE" : "PE",
      optionStrike: n(contract.strike_price ?? contract.strike),
      optionExpiry: contract.expiry || "",
      optionLTP: quote.price,
      optionVolume: volume,
      optionOI: oi,
      optionPreviousOI: previousOI,
      optionOIChange: oiChange,
      optionOIChangePercent: oiChangePercent,
      optionTimestamp: quote.timestamp || null
    };
  } catch (error) {
    return { confirmed: false, reason: `LIVE_OPTION_CONFIRMATION_ERROR:${error?.message || error}` };
  }
}

module.exports = { getTop20ByLiveVolume, getOptionConfirmation, upstoxFullQuotes, MAX_TOP_STOCKS };
