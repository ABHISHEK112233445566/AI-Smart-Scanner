const axios = require("axios");
const config = require("./config");

const TIMEOUT = 120000;
const EQUITY_MAX_ROWS = 50;
const OPTIONS_MAX_ROWS = 20;

// ============================================================
// EQUITY
// ============================================================
// EQUITY is independent from the option engine.
// It contains only BUY opportunities and separates them into
// SHORT TERM and LONG TERM.
// ============================================================

const EQUITY_COLUMNS = [
  "rank","horizon","stock","symbol","price","buyZone","entry",
  "stopLoss","target1","target2","holdingPeriod","rsi","support",
  "resistance","volumeConfirmed","breakout","setupQuality",
  "recommendation","reason","timestamp"
];

// ============================================================
// OPTIONS
// ============================================================
// CALL_OPTIONS and PUT_OPTIONS are BUY-only sheets.
// WATCH and REJECT rows are intentionally NOT written.
// This keeps the mobile sheet focused on actionable option buying.
// ============================================================

const OPTION_COLUMNS = [
  "rank","stock","symbol","optionType","optionSymbol","optionExpiry",
  "recommendedStrike","optionStrike","price","entry","stopLoss","target1",
  "target2","riskReward","optionsDecision","optionsRating","optionsConfidence",
  "optionsReason","tradeGates","failedGates","failedGateCount","contractAvailable",
  "optionPriceAvailable","optionSetupAvailable","dailyTrend","fourHourTrend",
  "oneHourTrend","fifteenMinTrend","mtfScore","mtfAlignment","breakout","oiMood",
  "oiSentiment","callOI","putOI","pcr","timestamp"
];

function webhook() {
  return process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.GOOGLE_SCRIPT_URL ||
    process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_SHEET_URL ||
    process.env.GOOGLE_APPS_SCRIPT_URL || config.GOOGLE_SHEET_WEBHOOK_URL ||
    config.GOOGLE_SCRIPT_URL || config.GOOGLE_SHEETS_WEBHOOK_URL ||
    config.GOOGLE_SHEET_URL || config.GOOGLE_APPS_SCRIPT_URL || null;
}

function clean(v) {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  if (typeof v === "boolean") return v;
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  return String(v);
}

function n(row, keys, fallback = 0) {
  for (const k of keys) {
    const v = Number(row?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function s(row, keys, fallback = "") {
  for (const k of keys) {
    if (
      row?.[k] !== undefined &&
      row?.[k] !== null &&
      String(row[k]).trim() !== ""
    ) return row[k];
  }
  return fallback;
}

function yes(row, keys) {
  for (const k of keys) {
    if (row?.[k] === true) return true;
    if (String(row?.[k] ?? "").toLowerCase() === "true") return true;
  }
  return false;
}

function stock(row) {
  return String(
    s(row, ["stock", "symbol", "tradingSymbol", "name"], "")
  ).trim().toUpperCase();
}

function price(row) {
  return n(row, ["price", "ltp", "lastPrice", "currentPrice", "close"]);
}

function support(row, i = 1) {
  return n(row, [`support${i}`, "support", "s1"]);
}

function resistance(row, i = 1) {
  return n(row, [`resistance${i}`, "resistance", "r1"]);
}

function bull(row) {
  const d = String(
    s(row, ["direction", "stockDirection", "technicalDirection", "finalDirection"], "")
  ).toUpperCase();
  return d === "BULLISH" || d === "CALL" || yes(row, ["isBullish"]);
}

function trend(row, k) {
  return String(row?.[k] ?? "").toUpperCase() === "BULLISH";
}

function mtf(row) {
  const x = n(row, ["mtfAvailableCount"], NaN);
  if (Number.isFinite(x) && x > 0) return x;
  return ["dailyTrend", "fourHourTrend", "oneHourTrend", "fifteenMinTrend"]
    .filter(k => trend(row, k)).length;
}

function emaQuality(row) {
  const p = price(row);
  const e20 = n(row, ["ema20"]);
  const e50 = n(row, ["ema50"]);
  const e200 = n(row, ["ema200"]);
  return p > 0 &&
    (!e20 || p >= e20) &&
    (!e50 || p >= e50) &&
    (!e200 || p >= e200) &&
    (!e50 || !e200 || e50 >= e200);
}

function shortCandidate(row) {
  const p = price(row);
  const r = n(row, ["rsi"]);
  const s1 = support(row);
  const r1 = resistance(row);

  if (!stock(row) || !p || !bull(row) || !trend(row, "dailyTrend")) return false;
  if (!trend(row, "oneHourTrend") && !trend(row, "fifteenMinTrend")) return false;
  if (r < 45 || r > 72 || mtf(row) < 2) return false;
  if (s1 && s1 >= p) return false;
  if (!(r1 > p) && !yes(row, ["volumeConfirmed", "breakout"])) return false;
  return true;
}

function longCandidate(row) {
  const p = price(row);
  const r = n(row, ["rsi"]);
  const e50 = n(row, ["ema50"]);
  const e200 = n(row, ["ema200"]);
  const s1 = support(row);

  if (!stock(row) || !p || !bull(row) || !trend(row, "dailyTrend")) return false;
  if (e200 > 0 && p < e200) return false;
  if (e50 > 0 && e200 > 0 && e50 < e200) return false;
  if (r < 40 || r > 78) return false;
  if (s1 && s1 > p * 1.03) return false;
  return true;
}

function idea(row, horizon) {
  const p = price(row);
  const s1 = support(row, 1);
  const s2 = support(row, 2);
  const s3 = support(row, 3);
  const r1 = resistance(row, 1);
  const r2 = resistance(row, 2);
  const r3 = resistance(row, 3);
  const entry0 = n(row, ["stockEntry", "entry"], p);
  const sl0 = n(row, ["stockStopLoss", "stopLoss"]);
  const vol = yes(row, ["volumeConfirmed", "volumeConfirmation", "volumeConfirm"]);
  const br = s(row, ["breakoutType", "breakout"], "NONE");

  let entry, sl, t1, t2, buyZone, period, quality, reason;

  if (horizon === "SHORT TERM") {
    entry = entry0 > 0 ? entry0 : p;
    sl = sl0 > 0 && sl0 < entry ? sl0 : (s1 > 0 && s1 < entry ? s1 : "");
    t1 = r1 > entry ? r1 : (r2 > entry ? r2 : "");
    t2 = r2 > t1 ? r2 : (r3 > t1 ? r3 : "");
    buyZone = s1 > 0 && s1 < entry ? `${s1} - ${entry}` : entry;
    period = "Days to few weeks";
    quality = vol || String(br).toUpperCase() !== "NONE" ? "STRONG" : "GOOD";
    reason = "Bullish daily setup with short-term timeframe alignment and a valid equity buying structure.";
  } else {
    entry = p;
    sl = sl0 > 0 && sl0 < entry
      ? sl0
      : (s2 > 0 && s2 < entry ? s2 : (s1 > 0 && s1 < entry ? s1 : ""));
    t1 = r2 > entry ? r2 : (r1 > entry ? r1 : "");
    t2 = r3 > t1 ? r3 : (r2 > t1 ? r2 : "");
    buyZone = s1 > 0 && s2 > 0
      ? `${Math.min(s1, s2)} - ${Math.max(s1, s2)}`
      : (s1 > 0 ? s1 : entry);
    period = "Months to years";
    quality = emaQuality(row) ? "STRONG" : "GOOD";
    reason = "Bullish daily structure with long-term EMA support and a suitable accumulation setup.";
  }

  return {
    horizon,
    stock: stock(row),
    symbol: s(row, ["symbol", "stock", "tradingSymbol"], stock(row)),
    price: p,
    buyZone,
    entry,
    stopLoss: sl,
    target1: t1,
    target2: t2,
    holdingPeriod: period,
    rsi: n(row, ["rsi"]),
    support: s1 || s2 || s3 || "",
    resistance: r1 || r2 || r3 || "",
    volumeConfirmed: vol ? "YES" : "NO",
    breakout: clean(br),
    setupQuality: quality,
    recommendation: "BUY",
    reason,
    timestamp: new Date().toISOString()
  };
}

function buildEquity(rows) {
  const out = [];
  const seen = new Set();

  for (const row of rows) {
    const key = stock(row);
    if (!key || seen.has(key)) continue;

    if (shortCandidate(row)) {
      out.push(idea(row, "SHORT TERM"));
      seen.add(key);
      continue;
    }

    if (longCandidate(row)) {
      out.push(idea(row, "LONG TERM"));
      seen.add(key);
    }
  }

  const q = { STRONG: 2, GOOD: 1 };

  return out
    .sort((a, b) =>
      (q[b.setupQuality] - q[a.setupQuality]) ||
      ((b.rsi || 0) - (a.rsi || 0))
    )
    .slice(0, EQUITY_MAX_ROWS)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

// ============================================================
// OPTION BUY FILTER
// ============================================================

function optionType(row) {
  const x = String(
    s(row, [
      "optionType", "optionsType", "option_type", "type",
      "instrument_type", "side", "direction"
    ], "")
  ).toUpperCase();

  if (x === "CALL" || x === "CE" || x.includes("CALL")) return "CALL";
  if (x === "PUT" || x === "PE" || x.includes("PUT")) return "PUT";
  return "";
}

function decision(row) {
  return String(
    s(row, ["optionsDecision", "decision", "optionDecision", "tradeDecision"], "")
  ).toUpperCase();
}

function confidence(row) {
  return n(row, ["optionsConfidence", "confidence", "optionConfidence"]);
}

function riskReward(row) {
  return n(row, ["riskReward", "rr", "stockRiskReward"]);
}

function failedGateCount(row) {
  const explicit = n(row, ["failedGateCount", "failedGatesCount"], NaN);
  if (Number.isFinite(explicit)) return explicit;

  const gates = row?.tradeGates;
  if (gates && typeof gates === "object") {
    return Array.isArray(gates.failedGates) ? gates.failedGates.length : 0;
  }

  return Array.isArray(row?.failedGates) ? row.failedGates.length : 0;
}

function optionBuyCandidate(row) {
  const type = optionType(row);
  if (!type) return false;

  // Only genuine TRADE decisions enter the buy sheets.
  if (decision(row) !== "TRADE") return false;

  // Contract and live premium must exist.
  if (!yes(row, ["contractAvailable", "hasContract", "optionContractAvailable"])) return false;
  if (!yes(row, ["optionPriceAvailable", "hasOptionPrice", "optionLtpAvailable"])) return false;

  // The engine must have produced a complete option setup.
  if (!yes(row, ["optionSetupAvailable", "hasOptionSetup"])) return false;

  // All quality gates must pass.
  if (failedGateCount(row) > 0) return false;

  const conf = confidence(row);
  const rr = riskReward(row);

  if (conf < 82) return false;
  if (rr < 1.5) return false;

  return true;
}

function optionValue(row, col) {
  const aliases = {
    stock: ["symbol", "tradingSymbol"],
    symbol: ["stock", "tradingSymbol"],
    price: ["ltp", "lastPrice", "currentPrice", "close"],
    entry: ["stockEntry"],
    stopLoss: ["stockStopLoss"],
    target1: ["stockTarget1"],
    target2: ["stockTarget2"],
    riskReward: ["rr", "stockRiskReward"],
    optionType: ["optionsType", "option_type", "type", "side"],
    optionSymbol: ["tradingsymbol", "tradingSymbol"],
    optionExpiry: ["expiry", "expiryDate"],
    recommendedStrike: ["strike", "strikePrice"],
    optionStrike: ["strike", "strikePrice", "recommendedStrike"],
    optionsDecision: ["decision", "optionDecision", "tradeDecision"],
    optionsRating: ["rating", "optionRating"],
    optionsConfidence: ["confidence", "optionConfidence"],
    optionsReason: ["reason", "optionReason"],
    failedGates: ["failedGateList"],
    failedGateCount: ["failedGatesCount"],
    contractAvailable: ["hasContract", "optionContractAvailable"],
    optionPriceAvailable: ["hasOptionPrice", "optionLtpAvailable"],
    optionSetupAvailable: ["hasOptionSetup"],
    mtfAlignment: ["mtfAligned", "alignment"],
    timestamp: ["time", "scanTime", "lastScanTime"]
  };

  if (row?.[col] !== undefined && row[col] !== null && row[col] !== "") {
    return row[col];
  }

  for (const k of aliases[col] || []) {
    if (row?.[k] !== undefined && row[k] !== null && row[k] !== "") {
      return row[k];
    }
  }

  return "";
}

function optionSort(rows) {
  return [...rows].sort((a, b) =>
    confidence(b) - confidence(a) ||
    riskReward(b) - riskReward(a) ||
    n(b, ["mtfScore"]) - n(a, ["mtfScore"])
  );
}

function optionRows(rows) {
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    if (!optionBuyCandidate(row)) continue;

    const key = `${stock(row)}|${optionType(row)}|${String(
      optionValue(row, "optionSymbol")
    ).toUpperCase()}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return optionSort(out).slice(0, OPTIONS_MAX_ROWS);
}

async function postSheet(sheet, headers, rows) {
  const url = webhook();
  if (!url) throw new Error("Google Sheet webhook URL is missing.");

  const res = await axios.post(
    url,
    {
      action: "replaceSheet",
      sheet,
      clearFirst: true,
      headers,
      rows,
      timestamp: new Date().toISOString()
    },
    {
      timeout: TIMEOUT,
      headers: { "Content-Type": "application/json" }
    }
  );

  if (res?.data?.success === false) {
    throw new Error(
      `Google Sheets rejected ${sheet}: ${res.data.error || "unknown error"}`
    );
  }

  return res?.data || {};
}

async function updateStrategySheets(scannerData, optionDecisions) {
  const scanner = Array.isArray(scannerData) ? scannerData.filter(Boolean) : [];
  const options = Array.isArray(optionDecisions) ? optionDecisions.filter(Boolean) : [];

  const equity = buildEquity(scanner);
  const equityRows = equity.map(r => EQUITY_COLUMNS.map(c => clean(r[c])));

  // IMPORTANT:
  // Both option sheets are cleared every run first, then only actionable
  // TRADE candidates are written. This prevents yesterday's WATCH/REJECT
  // rows from remaining visible when today's scan has no trade.
  const unique = optionRows(options);
  const calls = unique.filter(r => optionType(r) === "CALL");
  const puts = unique.filter(r => optionType(r) === "PUT");

  const callRows = calls.map((r, i) =>
    OPTION_COLUMNS.map(c => c === "rank" ? i + 1 : clean(optionValue(r, c)))
  );

  const putRows = puts.map((r, i) =>
    OPTION_COLUMNS.map(c => c === "rank" ? i + 1 : clean(optionValue(r, c)))
  );

  const equityResult = await postSheet("EQUITY", EQUITY_COLUMNS, equityRows);
  const callResult = await postSheet("CALL_OPTIONS", OPTION_COLUMNS, callRows);
  const putResult = await postSheet("PUT_OPTIONS", OPTION_COLUMNS, putRows);

  return {
    success: true,
    equityRows: equityRows.length,
    callRows: callRows.length,
    putRows: putRows.length,
    equity: equityResult,
    calls: callResult,
    puts: putResult
  };
}

module.exports = {
  EQUITY_COLUMNS,
  OPTION_COLUMNS,
  updateStrategySheets
};
