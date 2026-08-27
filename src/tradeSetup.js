// ============================================================
// TRADE SETUP — MARKET STRUCTURE + VALID TARGET PROJECTION
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
  const supportValues = [
    ...(Array.isArray(stock.supportLevels) ? stock.supportLevels : []),
    stock.support, stock.support1, stock.support2, stock.support3,
    stock.s1, stock.s2, stock.s3,
    stock.pivotS1, stock.pivotS2, stock.pivotS3,
    stock.oiSupport1, stock.oiSupport2, stock.oiSupport3,
    stock.swingLow, stock.previousLow, stock.recentLow, stock.dayLow
  ];

  const resistanceValues = [
    ...(Array.isArray(stock.resistanceLevels) ? stock.resistanceLevels : []),
    stock.resistance, stock.resistance1, stock.resistance2, stock.resistance3,
    stock.r1, stock.r2, stock.r3,
    stock.pivotR1, stock.pivotR2, stock.pivotR3,
    stock.oiResistance1, stock.oiResistance2, stock.oiResistance3,
    stock.swingHigh, stock.previousHigh, stock.recentHigh, stock.dayHigh
  ];

  const supports = [...new Set(supportValues.map(positiveNumber).filter(v => v > 0 && v < entry))]
    .sort((a, b) => b - a);

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

function technicalConfidence(stock = {}, direction, rr) {
  const entry = positiveNumber(stock.price ?? stock.close ?? stock.entry);
  if (!entry) return 0;

  const e5 = positiveNumber(stock.ema5);
  const e9 = positiveNumber(stock.ema9);
  const e20 = positiveNumber(stock.ema20);
  const e50 = positiveNumber(stock.ema50);
  const rsi = Number(stock.rsi);
  const macd = Number(stock.macdValue ?? stock.macd);
  const signal = Number(stock.macdSignal);
  const adx = Number(stock.adx);
  const pdi = Number(stock.pdi);
  const mdi = Number(stock.mdi);
  const vwap = positiveNumber(stock.vwap);
  const rvol = Number(stock.rvol);

  let score = 50;
  const bull = direction === 'CALL';

  if ([e5, e9, e20, e50].every(Boolean)) {
    if (bull && e5 > e9 && e9 > e20 && e20 > e50) score += 12;
    if (!bull && e5 < e9 && e9 < e20 && e20 < e50) score += 12;
  }

  if (e20 && e50) {
    if (bull && entry > e20 && entry > e50) score += 8;
    if (!bull && entry < e20 && entry < e50) score += 8;
  }

  if (Number.isFinite(rsi)) {
    if (bull && rsi >= 55 && rsi <= 70) score += 7;
    if (!bull && rsi >= 30 && rsi <= 45) score += 7;
  }

  if (Number.isFinite(macd) && Number.isFinite(signal)) {
    if (bull && macd >= signal) score += 7;
    if (!bull && macd <= signal) score += 7;
  }

  if (Number.isFinite(adx) && adx >= 20) {
    if (bull && pdi > mdi) score += 7;
    if (!bull && mdi > pdi) score += 7;
  }

  if (vwap) {
    if (bull && entry > vwap) score += 4;
    if (!bull && entry < vwap) score += 4;
  }

  if (Number.isFinite(rvol)) {
    if (rvol >= 2) score += 5;
    else if (rvol >= 1.2) score += 3;
  }

  // R:R must not destroy market confidence. It is a trade-eligibility gate.
  // A valid technical setup can therefore have high confidence while still
  // being rejected when the available target is too close.
  if (rr >= 2) score += 3;
  else if (rr >= 1.5) score += 2;

  return Math.max(0, Math.min(100, Math.round(score)));
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
    confidence: 0,
    stopSource: 'MARKET_STRUCTURE_REQUIRED',
    target1Source: 'MARKET_STRUCTURE_REQUIRED',
    target2Source: 'MARKET_STRUCTURE_OPTIONAL',
    targetSource: 'MARKET_STRUCTURE_REQUIRED',
    levelsSource: 'MARKET_STRUCTURE',
    supportLevels: supports,
    resistanceLevels: resistances,
    reason: 'UNKNOWN'
  };

  if (!direction) return { ...base, direction: null, optionType: null, reason: 'NO_DIRECTION' };
  if (!entry) return { ...base, reason: 'NO_MARKET_ENTRY' };

  // CALL: support below entry protects the trade; resistance above entry is target.
  // PUT: resistance above entry protects the trade; support below entry is target.
  const stop = direction === 'CALL' ? (supports[0] || 0) : (resistances[0] || 0);
  const candidates = direction === 'CALL' ? resistances : supports;

  if (!stop) {
    return {
      ...base,
      confidence: technicalConfidence(stock, direction, 0),
      reason: direction === 'CALL' ? 'MISSING_MARKET_SUPPORT' : 'MISSING_MARKET_RESISTANCE'
    };
  }

  const risk = direction === 'CALL' ? entry - stop : stop - entry;
  if (!(risk > 0)) {
    return { ...base, confidence: technicalConfidence(stock, direction, 0), reason: 'INVALID_MARKET_RISK' };
  }

  // First preference: an actual market-structure level that gives >= 1.5 R:R.
  const validTargets = candidates.filter(target => riskReward(entry, stop, target, direction) >= 1.5);

  let target1 = validTargets[0] || 0;
  let target2 = validTargets[1] || 0;
  let target1Source = 'MARKET_STRUCTURE';
  let target2Source = target2 ? 'NEXT_MARKET_STRUCTURE' : 'MARKET_STRUCTURE_OPTIONAL';
  let targetSource = 'MARKET_STRUCTURE';

  // If nearby resistance/support is too close, do not leave T1 at zero.
  // Use a volatility-aware projection only when there is no market-structure
  // level capable of producing the minimum trade R:R. This keeps the setup
  // measurable and prevents the scanner from discarding strong directional
  // stocks simply because the nearest structure is too close.
  if (!target1) {
    const atr = positiveNumber(stock.atr);
    const minimumMove = risk * 1.5;
    const volatilityMove = atr > 0 ? atr * 2 : 0;
    const projectionMove = Math.max(minimumMove, volatilityMove);

    if (projectionMove > 0) {
      target1 = direction === 'CALL' ? entry + projectionMove : entry - projectionMove;
      target1 = round(target1);
      target1Source = atr > 0 ? 'ATR_PROJECTION_2X_MIN_RR' : 'MIN_RR_PROJECTION';
      targetSource = 'MARKET_STRUCTURE_OR_VOLATILITY_PROJECTION';
    }
  }

  if (!target1) {
    return {
      ...base,
      stopLoss: round(stop),
      sl: round(stop),
      risk: round(risk),
      confidence: technicalConfidence(stock, direction, 0),
      stopSource: direction === 'CALL' ? 'MARKET_SUPPORT' : 'MARKET_RESISTANCE',
      reason: candidates.length ? 'NO_TARGET_WITH_MIN_RR_1_5' : 'MISSING_MARKET_TARGET'
    };
  }

  const reward = direction === 'CALL' ? target1 - entry : entry - target1;
  const rr = riskReward(entry, stop, target1, direction);

  // A projected target must still satisfy the hard minimum R:R gate.
  if (!(rr >= 1.5)) {
    return {
      ...base,
      stopLoss: round(stop),
      sl: round(stop),
      target1: round(target1),
      t1: round(target1),
      risk: round(risk),
      reward: round(Math.max(0, reward)),
      riskReward: rr,
      rr,
      confidence: technicalConfidence(stock, direction, rr),
      stopSource: direction === 'CALL' ? 'MARKET_SUPPORT' : 'MARKET_RESISTANCE',
      target1Source,
      targetSource,
      reason: 'NO_TARGET_WITH_MIN_RR_1_5'
    };
  }

  // T2 is the next real structure when available. For a volatility-projected
  // T1, keep T2 optional rather than inventing another market level.
  if (!target2 && target1Source !== 'MARKET_STRUCTURE') target2 = 0;

  return {
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
    confidence: technicalConfidence(stock, direction, rr),
    stopSource: direction === 'CALL' ? 'MARKET_SUPPORT' : 'MARKET_RESISTANCE',
    target1Source,
    target2Source,
    targetSource,
    levelsSource: 'MARKET_STRUCTURE',
    reason: 'VALID_MARKET_STRUCTURE_RR'
  };
};

module.exports.calculateTradeSetup = module.exports;
module.exports.getDirection = getDirection;
module.exports.riskReward = riskReward;
