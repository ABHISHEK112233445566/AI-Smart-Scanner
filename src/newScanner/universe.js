"use strict";

const axios = require("axios");
const { symbol } = require("./normalize");

const NIFTY500_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv";
const NIFTY500_FALLBACK_URL = "https://raw.githubusercontent.com/BKKB20/nse-index-history/main/current_members/NIFTY_500.csv";

function isEquity(instrument) {
  return String(instrument?.segment ?? "").toUpperCase() === "NSE_EQ" ||
    (String(instrument?.exchange ?? "").toUpperCase() === "NSE" &&
     String(instrument?.instrument_type ?? "").toUpperCase() === "EQ");
}
function isStockOption(instrument) {
  const segment = String(instrument?.segment ?? "").toUpperCase();
  const exchange = String(instrument?.exchange ?? "").toUpperCase();
  const type = String(instrument?.instrument_type ?? "").toUpperCase();
  const optionType = String(instrument?.option_type ?? "").toUpperCase();
  const underlyingType = String(instrument?.underlying_type ?? "").toUpperCase();
  if (segment !== "NSE_FO" && exchange !== "NSE") return false;
  if (type === "OPTSTK") return !optionType || ["CE", "PE"].includes(optionType);
  if (["CE", "PE"].includes(type)) return !underlyingType || underlyingType === "EQUITY";
  return ["CE", "PE"].includes(optionType) && (!underlyingType || underlyingType === "EQUITY");
}
function parseCsvSymbols(csv) {
  const lines = String(csv ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 450) throw new Error(`NIFTY500_CONSTITUENTS_TOO_SHORT:${lines.length}`);
  const rows = lines.slice(1).map(line => line.split(",").map(x => x.trim().replace(/^"|"$/g, "")));
  const symbols = [...new Set(rows.map(cols => symbol(cols[2] || cols[0])).filter(x => x && x !== "SYMBOL"))];
  if (symbols.length < 450) throw new Error(`NIFTY500_INVALID_SYMBOL_COUNT:${symbols.length}`);
  return symbols;
}
async function fetchNifty500(http = axios) {
  const failures = [];
  for (const url of [NIFTY500_URL, NIFTY500_FALLBACK_URL]) {
    try {
      const response = await http.get(url, {
        timeout: 20000, responseType: "text",
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/csv,text/plain,*/*", "Referer": "https://www.niftyindices.com/" }
      });
      const symbols = parseCsvSymbols(response.data);
      return { name: "NIFTY_500", source: url, symbols, count: symbols.length };
    } catch (error) { failures.push(`${url}: ${error.message}`); }
  }
  throw new Error(`NIFTY500_FETCH_FAILED: ${failures.join(" | ")}`);
}
function buildFnoUniverse(instruments) {
  if (!Array.isArray(instruments) || !instruments.length) throw new Error("BROKER_INSTRUMENT_MASTER_EMPTY");
  const equities = new Map();
  for (const item of instruments.filter(isEquity)) {
    const s = symbol(item.trading_symbol ?? item.tradingSymbol ?? item.symbol);
    const key = String(item.instrument_key ?? item.instrumentKey ?? "").trim();
    if (s && key && !equities.has(s)) equities.set(s, { symbol: s, instrumentKey: key });
  }
  const foByKey = new Map();
  for (const item of instruments.filter(isStockOption)) {
    const underlyingKey = String(item.underlying_key ?? item.underlyingKey ?? "").trim();
    const underlyingSymbol = symbol(item.underlying_symbol ?? item.underlyingSymbol ?? item.underlying_stock_symbol);
    if (!underlyingKey) continue;
    if (!foByKey.has(underlyingKey)) foByKey.set(underlyingKey, new Set());
    if (underlyingSymbol) foByKey.get(underlyingKey).add(underlyingSymbol);
  }
  const rows = [];
  for (const [stock, equity] of equities) {
    const linkedSymbols = foByKey.get(equity.instrumentKey);
    if (!linkedSymbols) continue;
    rows.push({ ...equity, fnoVerified: true, identitySource: "NSE_EQ_TO_NSE_FO_UNDERLYING_KEY" });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
function buildFnoMovers(quotedRows, limit=100, minimumVolume=0) {
  const valid=(Array.isArray(quotedRows)?quotedRows:[])
    .filter(row=>row.fnoEligible===true&&row.quote?.valid===true&&row.quote.previousClose>0&&row.quote.volume!==null&&row.quote.volume>=minimumVolume)
    .map(row=>({...row,changePercent:row.quote.changePercent}));
  const gainers=[...valid].filter(row=>row.changePercent>0).sort((a,b)=>b.changePercent-a.changePercent).slice(0,Math.ceil(limit/2));
  const losers=[...valid].filter(row=>row.changePercent<0).sort((a,b)=>a.changePercent-b.changePercent).slice(0,Math.floor(limit/2));
  return [...new Map([...gainers,...losers].map(row=>[row.symbol,row])).values()];
}
function buildUniverse(nifty500, fnoStocks) {
  const nifty = new Set((nifty500?.symbols ?? []).map(symbol).filter(Boolean));
  const fno = new Map((fnoStocks ?? []).map(row => [symbol(row.symbol), row]));
  const nifty500Rows = [...nifty].map(s => ({ symbol: s, inNifty500: true, fnoEligible: fno.has(s), ...(fno.get(s) || {}) }));
  const fnoRows = [...fno.values()].map(row => ({ ...row, inNifty500: nifty.has(row.symbol), fnoEligible: true }));
  return {
    nifty500: nifty500Rows,
    fnoStocks: fnoRows,
    combined: [...new Map([...nifty500Rows, ...fnoRows].map(row => [row.symbol, row])).values()]
  };
}
module.exports = { fetchNifty500, parseCsvSymbols, buildFnoUniverse, buildFnoMovers, buildUniverse, isEquity, isStockOption };
