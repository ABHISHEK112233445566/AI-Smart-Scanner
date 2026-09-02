const NSE_EQUITY_SEGMENT = "NSE_EQ";
const NSE_FO_SEGMENT = "NSE_FO";

function normalizeSymbol(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^NSE[_:]?EQ[|:]/, "")
    .replace(/^NSE[|:]/, "")
    .replace(/\.NS$/i, "")
    .replace(/-EQ$/i, "");
}

function isNseEquity(i) {
  const segment = String(i?.segment || "").toUpperCase();
  const exchange = String(i?.exchange || "").toUpperCase();
  const type = String(i?.instrument_type || "").toUpperCase();
  return segment === NSE_EQUITY_SEGMENT || (exchange === "NSE" && type === "EQ");
}

function isNseDerivative(i) {
  const segment = String(i?.segment || "").toUpperCase();
  const exchange = String(i?.exchange || "").toUpperCase();
  const type = String(i?.instrument_type || "").toUpperCase();
  return segment === NSE_FO_SEGMENT ||
    (exchange === "NSE" && ["OPTSTK", "FUTSTK"].includes(type));
}

function getUnderlyingSymbol(i) {
  return normalizeSymbol(
    i?.underlying_symbol ??
    i?.underlyingSymbol ??
    i?.underlying_stock_symbol ??
    i?.underlyingStockSymbol ??
    i?.underlying
  );
}

/**
 * Build the scanner universe from the complete NSE equity instrument master.
 * No NIFTY index membership is used here.
 *
 * Option eligibility is resolved primarily through the derivative's
 * underlying_key -> NSE equity instrument_key mapping. This avoids the
 * common Upstox master mismatch where underlying_symbol is absent or is
 * represented differently from trading_symbol.
 */
async function getWholeNseUniverse(broker) {
  if (!broker || typeof broker.loadInstruments !== "function") {
    throw new Error("Broker instrument master is unavailable for whole-NSE universe");
  }

  const instruments = await broker.loadInstruments();
  if (!Array.isArray(instruments) || !instruments.length) {
    throw new Error("NSE instrument master is empty");
  }

  const equityRows = instruments.filter(isNseEquity);
  const equities = [...new Set(
    equityRows
      .map(i => normalizeSymbol(i?.trading_symbol ?? i?.tradingSymbol ?? i?.symbol))
      .filter(Boolean)
  )];

  if (!equities.length) throw new Error("No NSE equity symbols found in instrument master");

  const equityByKey = new Map();
  for (const equity of equityRows) {
    const key = String(equity?.instrument_key ?? equity?.instrumentKey ?? "").trim();
    const symbol = normalizeSymbol(equity?.trading_symbol ?? equity?.tradingSymbol ?? equity?.symbol);
    if (key && symbol) equityByKey.set(key, symbol);
  }

  const optionUnderlyings = new Set();
  for (const derivative of instruments.filter(isNseDerivative)) {
    const underlyingKey = String(
      derivative?.underlying_key ??
      derivative?.underlyingKey ??
      derivative?.underlying_instrument_key ??
      derivative?.underlyingInstrumentKey ??
      ""
    ).trim();

    if (underlyingKey && equityByKey.has(underlyingKey)) {
      optionUnderlyings.add(equityByKey.get(underlyingKey));
      continue;
    }

    const symbol = getUnderlyingSymbol(derivative);
    if (symbol) optionUnderlyings.add(symbol);
  }

  return {
    name: "WHOLE_NSE",
    symbols: equities,
    universeSize: equities.length,
    optionEligibleSymbols: [...optionUnderlyings],
    optionEligibleCount: optionUnderlyings.size,
    source: "Upstox complete NSE instrument master"
  };
}

module.exports = {
  getWholeNseUniverse,
  normalizeSymbol,
  isNseEquity,
  isNseDerivative
};
