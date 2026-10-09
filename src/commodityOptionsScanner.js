// Independent MCX commodity-options pipeline.
// This module is intentionally isolated from the NSE stock scanner and Dashboard.
const IST = "Asia/Kolkata";
const MAX_COMMODITIES = Math.max(1, Number(process.env.MCX_OPTIONS_MAX_COMMODITIES || 80));
const MIN_OPTION_VOLUME = Math.max(0, Number(process.env.MCX_OPTIONS_MIN_VOLUME || 1));
const MIN_OPTION_OI = Math.max(0, Number(process.env.MCX_OPTIONS_MIN_OI || 1));

function text(v) { return String(v ?? "").trim(); }
function upper(v) { return text(v).toUpperCase(); }
function num(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function first(obj, keys) { for (const key of keys) if (obj?.[key] != null && text(obj[key]) !== "") return obj[key]; return ""; }
function keyOf(i) { return text(first(i, ["instrument_key", "instrumentKey", "key"])); }
function symbolOf(i) {
  const explicit = upper(first(i, ["underlying_symbol", "underlyingSymbol", "underlying", "underlying_name", "underlyingName"]));
  if (explicit) return explicit.replace(/\\s+/g, "");
  const raw = upper(first(i, ["trading_symbol", "tradingsymbol", "tradingSymbol", "name", "short_name"])).replace(/\\s+/g, "");
  return raw
    .replace(/\\d{1,2}[A-Z]{3}\\d{2}FUT.*$/, "")
    .replace(/\\d{1,2}[A-Z]{3}FUT.*$/, "")
    .replace(/\\d{1,2}[A-Z]{3}\\d{2}.*$/, "")
    .replace(/\\d{1,2}[A-Z]{3}.*$/, "")
    .replace(/\\d{4,}.*$/, "");
}
function segmentOf(i) { return upper(first(i, ["segment", "exchange_segment"])); }
function exchangeOf(i) { return upper(first(i, ["exchange", "exchange_name"])); }
function typeOf(i) {
  for (const value of [i?.option_type, i?.optionType, i?.instrument_type, i?.instrumentType]) {
    const t = upper(value);
    if (["CE", "CALL"].includes(t)) return "CE";
    if (["PE", "PUT"].includes(t)) return "PE";
  }
  return upper(first(i, ["instrument_type", "instrumentType", "option_type", "optionType"]));
}
function expiryOf(i) {
  const raw = first(i, ["expiry", "expiry_date", "expiryDate"]);
  if (raw == null || raw === "") return "";
  if (typeof raw === "number" || /^\d{10,13}$/.test(String(raw))) {
    const n = Number(raw);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function daysTo(expiry) {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: IST }));
  today.setHours(0, 0, 0, 0);
  const d = new Date(expiry + "T00:00:00");
  return Number.isNaN(d.getTime()) ? -1 : Math.ceil((d - today) / 86400000);
}
function isMcx(i) {
  const segment = segmentOf(i), exchange = exchangeOf(i);
  return segment.includes("MCX") || exchange === "MCX";
}
function isFuture(i) {
  const type = upper(first(i, ["instrument_type", "instrumentType"]));
  const name = upper(first(i, ["trading_symbol", "tradingSymbol", "name"]));
  return isMcx(i) && (["FUTCOM", "FUT", "FUTURES"].includes(type) || type.includes("FUT")) && !type.includes("OPT") && Boolean(keyOf(i)) && Boolean(symbolOf(i) || name);
}
function isCommodityOption(i) {
  return isMcx(i) && ["CE", "PE"].includes(typeOf(i)) && Boolean(keyOf(i)) && num(first(i, ["strike_price", "strike", "strikePrice"])) > 0 && Boolean(expiryOf(i));
}
function getQuoteObject(response, instrumentKey) {
  if (response && typeof response === "object" && num(first(response, ["last_price", "lastPrice", "ltp", "last_traded_price"])) > 0) return response;
  const data = response?.data?.data || response?.data || {};
  if (data[instrumentKey]) return data[instrumentKey];
  const decoded = instrumentKey.replace(/%7C/gi, "|");
  for (const [k, v] of Object.entries(data)) if (k === decoded || decodeURIComponent(k) === decoded) return v;
  const values = Object.values(data);
  return values.length === 1 ? values[0] : null;
}
function quotePrice(q) { return num(first(q, ["last_price", "lastPrice", "ltp", "last_traded_price"])); }
function quoteVolume(q) { return num(first(q, ["volume", "volume_traded", "volumeTraded"])); }
function quoteOI(q) { return num(first(q, ["oi", "open_interest", "openInterest"])); }
function quoteOpen(q) { return num(first(q?.ohlc || q, ["open", "open_price"])); }
function quotePreviousClose(q) { return num(first(q?.ohlc || q, ["close", "previous_close", "prev_close"])); }
function confidenceFor(changePct, volume, oi) {
  return Math.max(55, Math.min(90, Math.round(58 + Math.min(18, Math.abs(changePct) * 8) + (volume > 0 ? 7 : 0) + (oi > 0 ? 7 : 0))));
}

async function scanCommodityOptions(broker) {
  const brokerName = upper(broker?.name || process.env.BROKER || "UPSTOX");
  if (brokerName !== "UPSTOX") {
    console.warn("MCX OPTIONS: skipped because the configured broker adapter is not Upstox.");
    return [];
  }
  if (typeof broker?.ensureInstrumentsLoaded !== "function" || typeof broker?.getQuote !== "function" || typeof broker?.getOptionQuote !== "function") {
    console.warn("MCX OPTIONS: broker adapter does not expose the required instrument/quote methods.");
    return [];
  }

  const instruments = await broker.ensureInstrumentsLoaded();
  if (!Array.isArray(instruments) || !instruments.length) throw new Error("MCX instrument master is empty.");

  const options = instruments.filter(isCommodityOption);
  const futures = instruments.filter(isFuture);
  const futuresByUnderlying = new Map();
  for (const future of futures) {
    const symbol = symbolOf(future) || upper(first(future, ["trading_symbol", "tradingSymbol", "name"])).replace(/\d{2}[A-Z]{3}FUT.*$/, "");
    if (!symbol) continue;
    const expiry = expiryOf(future);
    if (expiry && daysTo(expiry) < 0) continue;
    const previous = futuresByUnderlying.get(symbol);
    if (!previous || (daysTo(expiry) >= 0 && daysTo(expiry) < daysTo(expiryOf(previous)))) futuresByUnderlying.set(symbol, future);
  }

  const optionGroups = new Map();
  for (const option of options) {
    const underlying = symbolOf(option);
    if (!underlying) continue;
    const expiry = expiryOf(option);
    if (daysTo(expiry) < 2) continue;
    const list = optionGroups.get(underlying) || [];
    list.push(option);
    optionGroups.set(underlying, list);
  }

  const results = [];
  const symbols = [...futuresByUnderlying.keys()].filter(s => optionGroups.has(s)).slice(0, MAX_COMMODITIES);
  for (const commodity of symbols) {
    const future = futuresByUnderlying.get(commodity);
    const futureKey = keyOf(future);
    try {
      const futureQuote = getQuoteObject(await broker.getQuote(futureKey), futureKey);
      const underlyingPrice = quotePrice(futureQuote);
      if (!(underlyingPrice > 0)) continue;
      const open = quoteOpen(futureQuote);
      const previousClose = quotePreviousClose(futureQuote);
      const changePct = previousClose > 0 ? ((underlyingPrice - previousClose) / previousClose) * 100 : (open > 0 ? ((underlyingPrice - open) / open) * 100 : 0);
      if (!open || Math.abs(changePct) < 0.05) continue;
      const side = underlyingPrice > open && changePct > 0 ? "CE" : underlyingPrice < open && changePct < 0 ? "PE" : "";
      if (!side) continue;

      const chain = optionGroups.get(commodity).filter(o => typeOf(o) === side);
      if (!chain.length) continue;
      const validExpiries = [...new Set(chain.map(expiryOf).filter(e => e && daysTo(e) >= 2))].sort();
      if (!validExpiries.length) continue;
      const expiry = validExpiries[0];
      const contracts = chain.filter(o => expiryOf(o) === expiry);
      const contract = contracts.reduce((best, item) => {
        const strike = num(first(item, ["strike_price", "strike", "strikePrice"]));
        const distance = Math.abs(strike - underlyingPrice);
        return !best || distance < best.distance ? { item, distance } : best;
      }, null)?.item;
      if (!contract) continue;

      const optionKey = keyOf(contract);
      const optionQuote = getQuoteObject(await broker.getOptionQuote(optionKey), optionKey);
      const premium = quotePrice(optionQuote);
      const volume = quoteVolume(optionQuote);
      const oi = quoteOI(optionQuote);
      if (!(premium > 0) || volume < MIN_OPTION_VOLUME || oi < MIN_OPTION_OI) continue;

      const confidence = confidenceFor(changePct, volume, oi);
      const strong = Math.abs(changePct) >= 0.35 && volume > 0 && oi > 0;
      const stop = Math.round(premium * 0.75 * 100) / 100;
      const target1 = Math.round(premium * 1.35 * 100) / 100;
      const target2 = Math.round(premium * 1.5 * 100) / 100;
      const tradingSymbol = text(first(contract, ["trading_symbol", "tradingsymbol", "tradingSymbol", "name"]));
      results.push({
        assetClass: "COMMODITY",
        exchange: "MCX",
        market: "MCX",
        stock: commodity,
        symbol: commodity,
        underlying: commodity,
        underlyingInstrumentKey: futureKey,
        underlyingPrice,
        price: underlyingPrice,
        currentPrice: underlyingPrice,
        direction: side === "CE" ? "BULLISH" : "BEARISH",
        stockDirection: side === "CE" ? "BULLISH" : "BEARISH",
        optionType: side,
        optionSide: side,
        optionName: tradingSymbol || commodity + " " + side,
        optionSymbol: tradingSymbol,
        optionExpiry: expiry,
        expiry,
        recommendedStrike: num(first(contract, ["strike_price", "strike", "strikePrice"])),
        optionStrike: num(first(contract, ["strike_price", "strike", "strikePrice"])),
        optionInstrumentKey: optionKey,
        optionPremiumEntry: premium,
        optionEntry: premium,
        optionLTP: premium,
        optionPremiumStopLoss: stop,
        optionStopLoss: stop,
        optionPremiumTarget1: target1,
        optionTarget1: target1,
        optionPremiumTarget2: target2,
        optionTarget2: target2,
        optionVolume: volume,
        optionOI: oi,
        lotSize: num(first(contract, ["lot_size", "lotSize", "minimum_lot"])),
        volume,
        oi,
        changePercent: Math.round(changePct * 100) / 100,
        optionsDecision: strong ? "TRADE" : "WATCH",
        decision: strong ? "TRADE" : "WATCH",
        optionsRating: strong ? "MCX_MOMENTUM" : "MCX_EARLY_SETUP",
        optionsConfidence: confidence,
        confidence,
        optionsReason: `Separate MCX ${side} setup; futures change ${changePct.toFixed(2)}%; live option premium, volume and OI verified.`,
        reason: `MCX futures direction ${side === "CE" ? "bullish" : "bearish"}; verify price action and risk before entry.`,
        contractAvailable: true,
        optionPriceAvailable: true,
        optionSetupAvailable: true,
        optionLiveDataAvailable: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.warn(`MCX OPTIONS: ${commodity} skipped: ${error?.message || error}`);
    }
  }
  results.sort((a, b) => Number(b.optionsConfidence || 0) - Number(a.optionsConfidence || 0));
  console.log(`MCX OPTIONS: eligible underlyings=${symbols.length}, live CE/PE candidates=${results.length}`);
  return results;
}

module.exports = { scanCommodityOptions, isMcx, isCommodityOption, isFuture };
