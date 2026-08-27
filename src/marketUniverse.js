const axios = require("axios");

const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  "Accept": "text/csv,text/plain,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/"
};

const URLS = {
  NIFTY500: "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
  BANKNIFTY: "https://nsearchives.nseindia.com/content/indices/ind_niftybanklist.csv"
};

function parseCsvSymbols(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(x => x.trim().replace(/^"|"$/g, "").toUpperCase());
  const symbolIndex = header.findIndex(x => x === "SYMBOL");
  if (symbolIndex < 0) return [];
  return [...new Set(lines.slice(1).map(line => {
    const cells = line.match(/("[^"]*"|[^,])+/g) || [];
    const value = String(cells[symbolIndex] || "").trim().replace(/^"|"$/g, "").toUpperCase();
    return value;
  }).filter(Boolean))];
}

async function fetchIndexSymbols(indexName) {
  const url = URLS[indexName];
  if (!url) throw new Error(`Unsupported NSE index universe: ${indexName}`);
  const response = await axios.get(url, { headers: NSE_HEADERS, timeout: 20000, responseType: "text" });
  const symbols = parseCsvSymbols(response.data);
  if (!symbols.length) throw new Error(`${indexName} constituent list is empty`);
  return symbols;
}

async function getNifty500AndBankNiftyUniverse() {
  const [nifty500, bankNifty] = await Promise.all([
    fetchIndexSymbols("NIFTY500"),
    fetchIndexSymbols("BANKNIFTY")
  ]);
  const merged = [...new Set([...nifty500, ...bankNifty])];
  return {
    name: "NIFTY500+BANKNIFTY",
    nifty500,
    bankNifty,
    symbols: merged,
    universeSize: merged.length,
    bankNiftyConstituents: bankNifty.length,
    source: "NSE index constituent CSV"
  };
}

module.exports = { fetchIndexSymbols, getNifty500AndBankNiftyUniverse };
