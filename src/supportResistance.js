// ============================================================
// SUPPORT & RESISTANCE ENGINE
// REAL MARKET-STRUCTURE ONLY
// ============================================================
// HARD RULES
// 1. Levels come from actual OHLC swing structure and supplied OI strikes.
// 2. No ATR levels.
// 3. No percentage offsets.
// 4. No synthetic support/resistance.
// 5. Return multiple genuine levels so the options engine can use:
//      CALL: SL = support, T1 = resistance, T2 = next resistance
//      PUT : SL = resistance, T1 = support, T2 = next support
// 6. Missing levels remain 0 and the options engine must reject the setup.
// ============================================================

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function round2(value) {
    const n = toNumber(value);
    return Number(n.toFixed(2));
}

function uniqueSorted(levels) {
    return [...new Set(
        (levels || [])
            .map(toNumber)
            .filter(v => v > 0)
            .map(round2)
    )].sort((a, b) => a - b);
}

function getCurrentPrice(candles) {
    if (!Array.isArray(candles)) return 0;
    for (let i = candles.length - 1; i >= 0; i--) {
        const close = toNumber(candles[i]?.close);
        if (close > 0) return close;
    }
    return 0;
}

function emptyPriceLevels() {
    return {
        support1: 0,
        support2: 0,
        support3: 0,
        resistance1: 0,
        resistance2: 0,
        resistance3: 0
    };
}

// ============================================================
// ACTUAL OHLC SWING STRUCTURE
// ============================================================

function calculatePriceActionLevels(candles) {
    if (!Array.isArray(candles) || candles.length < 7) {
        return emptyPriceLevels();
    }

    const valid = candles
        .map(c => ({
            high: toNumber(c?.high),
            low: toNumber(c?.low),
            close: toNumber(c?.close)
        }))
        .filter(c => c.high > 0 && c.low > 0 && c.close > 0 && c.high >= c.low);

    if (valid.length < 7) return emptyPriceLevels();

    const currentPrice = valid[valid.length - 1].close;
    const lookback = Math.min(valid.length, 150);
    const data = valid.slice(-lookback);

    const swingHighs = [];
    const swingLows = [];

    // A level is accepted only when it is an actual confirmed swing
    // in the supplied OHLC data. No artificial distance is added.
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

        if (isSwingHigh && c.high > currentPrice) {
            swingHighs.push(c.high);
        }

        if (isSwingLow && c.low < currentPrice) {
            swingLows.push(c.low);
        }
    }

    const supports = uniqueSorted(swingLows)
        .filter(level => level < currentPrice)
        .sort((a, b) => b - a);

    const resistances = uniqueSorted(swingHighs)
        .filter(level => level > currentPrice)
        .sort((a, b) => a - b);

    return {
        support1: round2(supports[0] || 0),
        support2: round2(supports[1] || 0),
        support3: round2(supports[2] || 0),
        resistance1: round2(resistances[0] || 0),
        resistance2: round2(resistances[1] || 0),
        resistance3: round2(resistances[2] || 0)
    };
}

// ============================================================
// OI MARKET LEVELS
// ============================================================

function getOiLevel(data, keys) {
    if (!data || typeof data !== "object") return 0;

    for (const key of keys) {
        const value = toNumber(data[key]);
        if (value > 0) return value;
    }

    return 0;
}

function calculateOILevels(oiData, currentPrice = 0) {
    if (!oiData) {
        return {
            oiSupport1: 0,
            oiSupport2: 0,
            oiSupport3: 0,
            oiResistance1: 0,
            oiResistance2: 0,
            oiResistance3: 0
        };
    }

    let rows = [];

    if (Array.isArray(oiData)) rows = oiData;
    else if (Array.isArray(oiData.data)) rows = oiData.data;
    else if (Array.isArray(oiData.records)) rows = oiData.records;
    else if (Array.isArray(oiData.options)) rows = oiData.options;
    else if (Array.isArray(oiData.optionChain)) rows = oiData.optionChain;

    const directSupport = [
        getOiLevel(oiData, ["oiSupport1", "oi_support1", "putOiSupport", "putOISupport", "highestPutOIstrike", "highestPutOIStrike", "maxPutOIStrike"]),
        getOiLevel(oiData, ["oiSupport2", "oi_support2", "secondPutOiSupport", "secondHighestPutOIstrike", "secondHighestPutOIStrike"]),
        getOiLevel(oiData, ["oiSupport3", "oi_support3", "thirdPutOiSupport", "thirdHighestPutOIstrike", "thirdHighestPutOIStrike"])
    ];

    const directResistance = [
        getOiLevel(oiData, ["oiResistance1", "oi_resistance1", "callOiResistance", "callOIResistance", "highestCallOIstrike", "highestCallOIStrike", "maxCallOIStrike"]),
        getOiLevel(oiData, ["oiResistance2", "oi_resistance2", "secondCallOiResistance", "secondHighestCallOIstrike", "secondHighestCallOIStrike"]),
        getOiLevel(oiData, ["oiResistance3", "oi_resistance3", "thirdCallOiResistance", "thirdHighestCallOIstrike", "thirdHighestCallOIStrike"])
    ];

    const normalized = rows.map(row => {
        if (!row || typeof row !== "object") return null;

        const strike = getOiLevel(row, [
            "strike", "strikePrice", "strike_price", "strike_price_value"
        ]);

        if (!strike) return null;

        return {
            strike,
            callOI: getOiLevel(row, [
                "callOI", "callOi", "call_oi", "ceOI", "ceOi", "ce_oi",
                "callOpenInterest", "call_open_interest"
            ]),
            putOI: getOiLevel(row, [
                "putOI", "putOi", "put_oi", "peOI", "peOi", "pe_oi",
                "putOpenInterest", "put_open_interest"
            ]),
            callOIChange: getOiLevel(row, [
                "callOIChange", "callOiChange", "call_oi_change",
                "ceOIChange", "ceOiChange", "ce_oi_change"
            ]),
            putOIChange: getOiLevel(row, [
                "putOIChange", "putOiChange", "put_oi_change",
                "peOIChange", "peOiChange", "pe_oi_change"
            ])
        };
    }).filter(Boolean);

    if (!normalized.length) {
        return {
            oiSupport1: currentPrice > 0 && directSupport[0] < currentPrice ? round2(directSupport[0]) : 0,
            oiSupport2: currentPrice > 0 && directSupport[1] < currentPrice ? round2(directSupport[1]) : 0,
            oiSupport3: currentPrice > 0 && directSupport[2] < currentPrice ? round2(directSupport[2]) : 0,
            oiResistance1: currentPrice > 0 && directResistance[0] > currentPrice ? round2(directResistance[0]) : 0,
            oiResistance2: currentPrice > 0 && directResistance[1] > currentPrice ? round2(directResistance[1]) : 0,
            oiResistance3: currentPrice > 0 && directResistance[2] > currentPrice ? round2(directResistance[2]) : 0
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

    const supportCandidates = uniqueSorted([
        ...supports,
        ...supportChanges,
        ...directSupport
    ])
        .filter(v => !currentPrice || v < currentPrice)
        .sort((a, b) => b - a);

    const resistanceCandidates = uniqueSorted([
        ...resistances,
        ...resistanceChanges,
        ...directResistance
    ])
        .filter(v => !currentPrice || v > currentPrice)
        .sort((a, b) => a - b);

    return {
        oiSupport1: round2(supportCandidates[0] || 0),
        oiSupport2: round2(supportCandidates[1] || 0),
        oiSupport3: round2(supportCandidates[2] || 0),
        oiResistance1: round2(resistanceCandidates[0] || 0),
        oiResistance2: round2(resistanceCandidates[1] || 0),
        oiResistance3: round2(resistanceCandidates[2] || 0)
    };
}

// ============================================================
// MERGE REAL LEVELS
// ============================================================

function calculateSupportResistance(candles, oiData = null) {
    const currentPrice = getCurrentPrice(candles);
    const priceLevels = calculatePriceActionLevels(candles);
    const oiLevels = calculateOILevels(oiData, currentPrice);

    const supportLevels = uniqueSorted([
        priceLevels.support1,
        priceLevels.support2,
        priceLevels.support3,
        oiLevels.oiSupport1,
        oiLevels.oiSupport2,
        oiLevels.oiSupport3
    ])
        .filter(v => v < currentPrice)
        .sort((a, b) => b - a);

    const resistanceLevels = uniqueSorted([
        priceLevels.resistance1,
        priceLevels.resistance2,
        priceLevels.resistance3,
        oiLevels.oiResistance1,
        oiLevels.oiResistance2,
        oiLevels.oiResistance3
    ])
        .filter(v => v > currentPrice)
        .sort((a, b) => a - b);

    return {
        ...priceLevels,
        ...oiLevels,
        currentPrice,
        supportLevels,
        resistanceLevels,
        // Explicitly expose the first three genuine market levels.
        support1: round2(supportLevels[0] || 0),
        support2: round2(supportLevels[1] || 0),
        support3: round2(supportLevels[2] || 0),
        resistance1: round2(resistanceLevels[0] || 0),
        resistance2: round2(resistanceLevels[1] || 0),
        resistance3: round2(resistanceLevels[2] || 0)
    };
}

function getBestCallSupport(entry, levels) {
    const candidates = [
        ...(Array.isArray(levels?.supportLevels) ? levels.supportLevels : []),
        levels?.oiSupport1,
        levels?.oiSupport2,
        levels?.oiSupport3,
        levels?.support1,
        levels?.support2,
        levels?.support3
    ]
        .map(toNumber)
        .filter(v => v > 0 && v < entry)
        .sort((a, b) => b - a);

    return candidates[0] || 0;
}

function getBestCallResistance(entry, levels) {
    const candidates = [
        ...(Array.isArray(levels?.resistanceLevels) ? levels.resistanceLevels : []),
        levels?.oiResistance1,
        levels?.oiResistance2,
        levels?.oiResistance3,
        levels?.resistance1,
        levels?.resistance2,
        levels?.resistance3
    ]
        .map(toNumber)
        .filter(v => v > entry)
        .sort((a, b) => a - b);

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
