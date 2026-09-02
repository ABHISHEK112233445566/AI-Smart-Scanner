const NSE_EQUITY_SEGMENT = "NSE_EQ";
const NSE_FO_SEGMENT = "NSE_FO";

function normalizeSymbol(v) {
  return String(v || "").trim().toUpperCase().replace(/\s+/g, "").replace(/-EQ$/i, "");
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
 */
async function getWholeNseUniverse(broker) {
  if (!broker || typeof broker.loadInstruments !== "function") {
    throw new Error("Broker instrument master is unavailable for whole-NSE universe");
  }

  const instruments = await broker.loadInstruments();
  if (!Array.isArray(instruments) || !instruments.length) {
    throw new Error("NSE instrument master is empty");
  }

  const equities = [...new Set(
    instruments
      .filter(isNseEquity)
      .map(i => normalizeSymbol(i?.trading_symbol ?? i?.tradingSymbol ?? i?.symbol))
      .filter(Boolean)
  )];

  if (!equities.length) throw new Error("No NSE equity symbols found in instrument master");

  const optionUnderlyings = new Set(
    instruments
      .filter(isNseDerivative)
      .map(getUnderlyingSymbol)
      .filter(Boolean)
  );

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
