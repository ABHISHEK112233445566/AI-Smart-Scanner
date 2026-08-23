// ============================================================
// SUPPORT & RESISTANCE ENGINE
// MARKET-STRUCTURE + OI LEVELS
// ============================================================
// Rules:
// 1. Use actual swing structure, not arbitrary candle extrema.
// 2. Return levels relative to the current market price.
// 3. OI support/resistance must also be price-relative.
// 4. Never create synthetic/percentage/ATR levels here.
// ============================================================

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function round2(value) {
    return Number(toNumber(value).toFixed(2));
}

function uniqueSorted(levels) {
    return [...new Set(levels.map(round2).filter(v => v > 0))].sort((a, b) => a - b);
}

function getCurrentPrice(candles) {
    const valid = Array.isArray(candles)
        ? candles.filter(c => c && toNumber(c.close) > 0)
        : [];
    return valid.length ? toNumber(valid[valid.length - 1].close) : 0;
}

function getOiLevel(data, keys) {
    if (!data || typeof data !== "object") return 0;
    for (const key of keys) {
        const value = toNumber(data[key]);
        if (value > 0) return value;
    }
    return 0;
}

function emptyPriceLevels() {
    return {
        support1: 0,
        support2: 0,
        resistance1: 0,
        resistance2: 0
    };
}

// ============================================================
// SWING STRUCTURE
// ============================================================
// A swing low is lower than the candles immediately around it.
// A swing high is higher than the candles immediately around it.
// We use a small confirmation window and recent history so levels
// represent actual market structure rather than simply the lowest
// or highest candle in an arbitrary 50-candle window.
// ============================================================

function calculatePriceActionLevels(candles) {
    if (!Array.isArray(candles) || candles.length < 7) return emptyPriceLevels();

    const valid = candles
        .map(c => ({
            high: toNumber(c?.high),
            low: toNumber(c?.low),
            close: toNumber(c?.close)
        }))
        .filter(c => c.high > 0 && c.low > 0 && c.close > 0);

    if (valid.length < 7) return emptyPriceLevels();

    const currentPrice = valid[valid.length - 1].close;
    const lookback = Math.min(valid.length, 100);
    const data = valid.slice(-lookback);
    const swingHighs = [];
    const swingLows = [];

    for (let i = 2; i < data.length - 2; i++) {
        const c = data[i];
        const isSwingHigh =
            c.high >= data[i - 1].high &&
            c.high >= data[i - 2].high &&
            c.high > data[i + 1].high &&
            c.high >= data[i + 2].high;

        const isSwingLow =
            c.low <= data[i - 1].low &&
            c.low <= data[i - 2].low &&
            c.low < data[i + 1].low &&
            c.low <= data[i + 2].low;

        if (isSwingHigh && c.high > currentPrice) swingHighs.push(c.high);
        if (isSwingLow && c.low < currentPrice) swingLows.push(c.low);
    }

    // Include only the actual current candle range as a structural level
    // when it is clearly on the correct side. This is deliberately last
    // resort; no artificial offset is added.
    const supports = uniqueSorted(swingLows).sort((a, b) => b - a);
    const resistances = uniqueSorted(swingHighs).sort((a, b) => a - b);

    return {
        support1: round2(supports[0] || 0),
        support2: round2(supports[1] || 0),
        resistance1: round2(resistances[0] || 0),
        resistance2: round2(resistances[1] || 0)
    };
}

// ============================================================
// OI SUPPORT / RESISTANCE
// ============================================================

function calculateOILevels(oiData, currentPrice = 0) {
    if (!oiData) {
        return { oiSupport1: 0, oiSupport2: 0, oiResistance1: 0, oiResistance2: 0 };
    }

    let rows = [];
    if (Array.isArray(oiData)) rows = oiData;
    else if (Array.isArray(oiData.data)) rows = oiData.data;
    else if (Array.isArray(oiData.records)) rows = oiData.records;
    else if (Array.isArray(oiData.options)) rows = oiData.options;
    else if (Array.isArray(oiData.optionChain)) rows = oiData.optionChain;

    const directSupport1 = getOiLevel(oiData, ["oiSupport1", "oi_support1", "putOiSupport", "putOISupport", "highestPutOIstrike", "highestPutOIStrike", "maxPutOIStrike"]);
    const directSupport2 = getOiLevel(oiData, ["oiSupport2", "oi_support2", "secondPutOiSupport", "secondHighestPutOIstrike", "secondHighestPutOIStrike"]);
    const directResistance1 = getOiLevel(oiData, ["oiResistance1", "oi_resistance1", "callOiResistance", "callOIResistance", "highestCallOIstrike", "highestCallOIStrike", "maxCallOIStrike"]);
    const directResistance2 = getOiLevel(oiData, ["oiResistance2", "oi_resistance2", "secondCallOiResistance", "secondHighestCallOIstrike", "secondHighestCallOIStrike"]);

    const normalized = rows.map(row => {
        if (!row || typeof row !== "object") return null;
        const strike = getOiLevel(row, ["strike", "strikePrice", "strike_price", "strike_price_value"]);
        if (!strike) return null;
        return {
            strike,
            callOI: getOiLevel(row, ["callOI", "callOi", "call_oi", "ceOI", "ceOi", "ce_oi", "callOpenInterest", "call_open_interest"]),
            putOI: getOiLevel(row, ["putOI", "putOi", "put_oi", "peOI", "peOi", "pe_oi", "putOpenInterest", "put_open_interest"]),
            callOIChange: getOiLevel(row, ["callOIChange", "callOiChange", "call_oi_change", "ceOIChange", "ceOiChange", "ce_oi_change"]),
            putOIChange: getOiLevel(row, ["putOIChange", "putOiChange", "put_oi_change", "peOIChange", "peOiChange", "pe_oi_change"])
        };
    }).filter(Boolean);

    if (!normalized.length) {
        return {
            oiSupport1: currentPrice > 0 && directSupport1 < currentPrice ? round2(directSupport1) : 0,
            oiSupport2: currentPrice > 0 && directSupport2 < currentPrice ? round2(directSupport2) : 0,
            oiResistance1: currentPrice > 0 && directResistance1 > currentPrice ? round2(directResistance1) : 0,
            oiResistance2: currentPrice > 0 && directResistance2 > currentPrice ? round2(directResistance2) : 0
        };
    }

    const supports = normalized
        .filter(r => r.putOI > 0 && (!currentPrice || r.strike < currentPrice))
        .sort((a, b) => b.putOI - a.putOI)
        .map(r => r.strike);

    const resistances = normalized
        .filter(r => r.callOI > 0 && (!currentPrice || r.strike > currentPrice))
        .sort((a, b) => b.callOI - a.callOI)
        .map(r => r.strike);

    const supportChanges = normalized
        .filter(r => r.putOIChange > 0 && (!currentPrice || r.strike < currentPrice))
        .sort((a, b) => b.putOIChange - a.putOIChange)
        .map(r => r.strike);

    const resistanceChanges = normalized
        .filter(r => r.callOIChange > 0 && (!currentPrice || r.strike > currentPrice))
        .sort((a, b) => b.callOIChange - a.callOIChange)
        .map(r => r.strike);

    const supportCandidates = uniqueSorted([...supports, ...supportChanges]).sort((a, b) => b - a);
    const resistanceCandidates = uniqueSorted([...resistances, ...resistanceChanges]).sort((a, b) => a - b);

    return {
        oiSupport1: round2(supportCandidates[0] || (currentPrice > 0 && directSupport1 < currentPrice ? directSupport1 : 0)),
        oiSupport2: round2(supportCandidates[1] || (currentPrice > 0 && directSupport2 < currentPrice ? directSupport2 : 0)),
        oiResistance1: round2(resistanceCandidates[0] || (currentPrice > 0 && directResistance1 > currentPrice ? directResistance1 : 0)),
        oiResistance2: round2(resistanceCandidates[1] || (currentPrice > 0 && directResistance2 > currentPrice ? directResistance2 : 0))
    };
}

// ============================================================
// MERGE LEVELS
// ============================================================

function calculateSupportResistance(candles, oiData = null) {
    const currentPrice = getCurrentPrice(candles);
    const priceLevels = calculatePriceActionLevels(candles);
    const oiLevels = calculateOILevels(oiData, currentPrice);

    return {
        ...priceLevels,
        ...oiLevels,
        currentPrice,
        // Explicit market-structure arrays make downstream selection safer.
        supportLevels: uniqueSorted([priceLevels.support1, priceLevels.support2, oiLevels.oiSupport1, oiLevels.oiSupport2])
            .filter(v => v < currentPrice).sort((a, b) => b - a),
        resistanceLevels: uniqueSorted([priceLevels.resistance1, priceLevels.resistance2, oiLevels.oiResistance1, oiLevels.oiResistance2])
            .filter(v => v > currentPrice).sort((a, b) => a - b)
    };
}

function getBestCallSupport(entry, levels) {
    const candidates = [
        ...(Array.isArray(levels?.supportLevels) ? levels.supportLevels : []),
        levels?.oiSupport1, levels?.oiSupport2, levels?.support1, levels?.support2
    ].map(toNumber).filter(v => v > 0 && v < entry).sort((a, b) => b - a);
    return candidates[0] || 0;
}

function getBestCallResistance(entry, levels) {
    const candidates = [
        ...(Array.isArray(levels?.resistanceLevels) ? levels.resistanceLevels : []),
        levels?.oiResistance1, levels?.oiResistance2, levels?.resistance1, levels?.resistance2
    ].map(toNumber).filter(v => v > entry).sort((a, b) => a - b);
    return candidates[0] || 0;
}

function getBestPutResistance(entry, levels) {
    return getBestCallResistance(entry, levels);
}

function getBestPutSupport(entry, levels) {
    return getBestCallSupport(entry, levels);
}

module.exports = {
    calculateSupportResistance,
    calculatePriceActionLevels,
    calculateOILevels,
    getBestCallSupport,
    getBestCallResistance,
    getBestPutSupport,
    getBestPutResistance
};
