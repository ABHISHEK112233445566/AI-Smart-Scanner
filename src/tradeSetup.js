// ============================================================
// TRADE SETUP — MARKET-STRUCTURE ONLY
// ============================================================

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round(value) {
  const n = positiveNumber(value);
  return n ? Number(n.toFixed(2)) : 0;
}

function getDirection(stock = {}, option = {}) {
  const raw = String(
    option.optionType ?? stock.optionType ?? stock.direction ??
    stock.finalDirection ?? stock.stockDirection ?? ''
  ).trim().toUpperCase();

  if (['CALL', 'CE', 'BULLISH', 'BUY'].includes(raw)) return 'CALL';
  if (['PUT', 'PE', 'BEARISH', 'SELL'].includes(raw)) return 'PUT';
  return null;
}

function collectLevels(stock = {}, entry) {
  const values = [
    ...(Array.isArray(stock.supportLevels) ? stock.supportLevels : []),
    stock.support1, stock.support2, stock.support3,
    stock.pivotS1, stock.pivotS2, stock.pivotS3,
    stock.oiSupport1, stock.oiSupport2, stock.oiSupport3
  ];

  const supports = [...new Set(values.map(positiveNumber).filter(v => v < entry))]
    .sort((a, b) => b - a);

  const resistanceValues = [
    ...(Array.isArray(stock.resistanceLevels) ? stock.resistanceLevels : []),
    stock.resistance1, stock.resistance2, stock.resistance3,
    stock.pivotR1, stock.pivotR2, stock.pivotR3,
    stock.oiResistance1, stock.oiResistance2, stock.oiResistance3
  ];

  const resistances = [...new Set(resistanceValues.map(positiveNumber).filter(v => v > entry))]
    .sort((a, b) => a - b);

  return { supports, resistances };
}

function riskReward(entry, stop, target, direction) {
  const e = Number(entry), s = Number(stop), t = Number(target);
  if (![e, s, t].every(Number.isFinite) || e <= 0 || s <= 0 || t <= 0) return 0;

  const risk = direction === 'CALL' ? e - s : s - e;
  const reward = direction === 'CALL' ? t - e : e - t;
  return risk > 0 && reward > 0 ? Number((reward / risk).toFixed(2)) : 0;
}

module.exports = function calculateTradeSetup(stock = {}, option = {}) {
  const direction = getDirection(stock, option);
  const entry = positiveNumber(
    option.entry ?? stock.marketEntry ?? stock.entry ?? stock.stockEntry ??
    stock.price ?? stock.ltp ?? stock.close
  );
  const { supports, resistances } = collectLevels(stock, entry);

  const base = {
    valid: false,
    isValid: false,
    direction,
    optionType: direction,
    entry: round(entry),
    stockEntry: round(entry),
    stopLoss: 0,
    sl: 0,
    target1: 0,
    t1: 0,
    target2: 0,
    t2: 0,
    risk: 0,
    reward: 0,
    riskReward: 0,
    rr: 0,
    stopSource: 'MARKET_STRUCTURE_REQUIRED',
    target1Source: 'MARKET_STRUCTURE_REQUIRED',
    target2Source: 'MARKET_STRUCTURE_OPTIONAL',
    targetSource: 'MARKET_STRUCTURE_REQUIRED',
    levelsSource: 'MARKET_STRUCTURE_ONLY',
    supportLevels: supports,
    resistanceLevels: resistances,
    reason: 'UNKNOWN'
  };

  if (!direction) return { ...base, direction: null, optionType: null, reason: 'NO_DIRECTION' };
  if (!entry) return { ...base, reason: 'NO_MARKET_ENTRY' };

  // CALL: support below entry is the protective level; resistance above is target.
  // PUT: resistance above entry is the protective level; support below is target.
  const stop = direction === 'CALL' ? (supports[0] || 0) : (resistances[0] || 0);
  const candidates = direction === 'CALL' ? resistances : supports;

  if (!stop) {
    return {
      ...base,
      stopLoss: 0,
      sl: 0,
      reason: direction === 'CALL'
        ? 'MISSING_MARKET_SUPPORT'
        : 'MISSING_MARKET_RESISTANCE'
    };
  }

  const risk = direction === 'CALL' ? entry - stop : stop - entry;
  if (!(risk > 0)) return { ...base, reason: 'INVALID_MARKET_RISK' };

  // Only a target that actually satisfies the minimum 1.5 R:R can become T1.
  // Do not return a low-RR target as if it were a usable trade target.
  const validTargets = candidates.filter(target => riskReward(entry, stop, target, direction) >= 1.5);

  if (!validTargets.length) {
    return {
      ...base,
      stopLoss: round(stop),
      sl: round(stop),
      risk: round(risk),
      stopSource: direction === 'CALL' ? 'MARKET_SUPPORT' : 'MARKET_RESISTANCE',
      reason: candidates.length ? 'NO_TARGET_WITH_MIN_RR_1_5' : 'MISSING_MARKET_TARGET'
    };
  }

  const target1 = validTargets[0];
  const target2 = validTargets[1] || 0;
  const reward = direction === 'CALL' ? target1 - entry : entry - target1;
  const rr = riskReward(entry, stop, target1, direction);

  const result = {
    ...base,
    valid: true,
    isValid: true,
    entry: round(entry),
    stockEntry: round(entry),
    stopLoss: round(stop),
    sl: round(stop),
    target1: round(target1),
    t1: round(target1),
    target2: round(target2),
    t2: round(target2),
    risk: round(risk),
    reward: round(reward),
    riskReward: rr,
    rr,
    stopSource: direction === 'CALL' ? 'MARKET_SUPPORT' : 'MARKET_RESISTANCE',
    target1Source: 'MARKET_STRUCTURE',
    target2Source: target2 ? 'NEXT_MARKET_STRUCTURE' : 'MARKET_STRUCTURE_OPTIONAL',
    targetSource: 'MARKET_STRUCTURE',
    levelsSource: 'MARKET_STRUCTURE_ONLY',
    reason: 'VALID_MARKET_STRUCTURE_RR'
  };

  return result;
};

module.exports.calculateTradeSetup = module.exports;
module.exports.getDirection = getDirection;
module.exports.riskReward = riskReward;
