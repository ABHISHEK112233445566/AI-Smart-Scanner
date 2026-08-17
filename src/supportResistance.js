// ============================================================
// SUPPORT & RESISTANCE ENGINE
// PRICE ACTION + OI BASED LEVELS
// ============================================================

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

// ============================================================
// GET OI LEVEL FROM POSSIBLE FIELD NAMES
// ============================================================

function getOiLevel(data, keys) {

    if (!data || typeof data !== "object") {
        return 0;
    }

    for (const key of keys) {

        const value = toNumber(data[key]);

        if (value > 0) {
            return value;
        }
    }

    return 0;
}

// ============================================================
// CALCULATE PRICE ACTION SUPPORT / RESISTANCE
// ============================================================

function calculatePriceActionLevels(candles) {

    if (!Array.isArray(candles) || candles.length === 0) {
        return {
            support1: 0,
            support2: 0,
            resistance1: 0,
            resistance2: 0
        };
    }

    const validCandles = candles.filter(c =>
        c &&
        Number(c.high) > 0 &&
        Number(c.low) > 0
    );

    if (validCandles.length === 0) {
        return {
            support1: 0,
            support2: 0,
            resistance1: 0,
            resistance2: 0
        };
    }

    const highs =
        validCandles.map(c => Number(c.high));

    const lows =
        validCandles.map(c => Number(c.low));

    const recentHighs =
        highs.slice(-50);

    const recentLows =
        lows.slice(-50);

    const firstHalfHighs =
        recentHighs.slice(0, 25);

    const firstHalfLows =
        recentLows.slice(0, 25);

    const resistance1 =
        Math.max(...recentHighs);

    const support1 =
        Math.min(...recentLows);

    const resistance2 =
        firstHalfHighs.length > 0
            ? Math.max(...firstHalfHighs)
            : resistance1;

    const support2 =
        firstHalfLows.length > 0
            ? Math.min(...firstHalfLows)
            : support1;

    return {

        support1:
            Number(
                support1.toFixed(2)
            ),

        support2:
            Number(
                support2.toFixed(2)
            ),

        resistance1:
            Number(
                resistance1.toFixed(2)
            ),

        resistance2:
            Number(
                resistance2.toFixed(2)
            )
    };
}

// ============================================================
// CALCULATE OI SUPPORT / RESISTANCE
//
// Supports:
//   - Highest Put OI
//   - Highest Put OI Change
//
// Resistances:
//   - Highest Call OI
//   - Highest Call OI Change
//
// Flexible field names are supported.
// ============================================================

function calculateOILevels(oiData) {

    if (!oiData) {
        return {
            oiSupport1: 0,
            oiSupport2: 0,
            oiResistance1: 0,
            oiResistance2: 0
        };
    }

    let rows = [];

    // --------------------------------------------------------
    // ARRAY DIRECTLY
    // --------------------------------------------------------

    if (Array.isArray(oiData)) {
        rows = oiData;
    }

    // --------------------------------------------------------
    // COMMON OBJECT WRAPPERS
    // --------------------------------------------------------

    else if (Array.isArray(oiData.data)) {
        rows = oiData.data;
    }

    else if (Array.isArray(oiData.records)) {
        rows = oiData.records;
    }

    else if (Array.isArray(oiData.options)) {
        rows = oiData.options;
    }

    else if (Array.isArray(oiData.optionChain)) {
        rows = oiData.optionChain;
    }

    // --------------------------------------------------------
    // DIRECT OI LEVELS ALREADY PROVIDED
    // --------------------------------------------------------

    const directSupport1 =
        getOiLevel(
            oiData,
            [
                "oiSupport1",
                "oi_support1",
                "putOiSupport",
                "putOISupport",
                "highestPutOIstrike",
                "highestPutOIStrike",
                "maxPutOIStrike"
            ]
        );

    const directSupport2 =
        getOiLevel(
            oiData,
            [
                "oiSupport2",
                "oi_support2",
                "secondPutOiSupport",
                "secondHighestPutOIstrike",
                "secondHighestPutOIStrike"
            ]
        );

    const directResistance1 =
        getOiLevel(
            oiData,
            [
                "oiResistance1",
                "oi_resistance1",
                "callOiResistance",
                "callOIResistance",
                "highestCallOIstrike",
                "highestCallOIStrike",
                "maxCallOIStrike"
            ]
        );

    const directResistance2 =
        getOiLevel(
            oiData,
            [
                "oiResistance2",
                "oi_resistance2",
                "secondCallOiResistance",
                "secondHighestCallOIstrike",
                "secondHighestCallOIStrike"
            ]
        );

    if (rows.length === 0) {

        return {

            oiSupport1:
                directSupport1,

            oiSupport2:
                directSupport2,

            oiResistance1:
                directResistance1,

            oiResistance2:
                directResistance2
        };
    }

    // ========================================================
    // NORMALIZE OI ROWS
    // ========================================================

    const normalized = rows
        .map(row => {

            if (!row || typeof row !== "object") {
                return null;
            }

            const strike =
                getOiLevel(
                    row,
                    [
                        "strike",
                        "strikePrice",
                        "strike_price",
                        "strike_price_value"
                    ]
                );

            const callOI =
                getOiLevel(
                    row,
                    [
                        "callOI",
                        "callOi",
                        "call_oi",
                        "ceOI",
                        "ceOi",
                        "ce_oi",
                        "callOpenInterest",
                        "call_open_interest"
                    ]
                );

            const putOI =
                getOiLevel(
                    row,
                    [
                        "putOI",
                        "putOi",
                        "put_oi",
                        "peOI",
                        "peOi",
                        "pe_oi",
                        "putOpenInterest",
                        "put_open_interest"
                    ]
                );

            const callOIChange =
                getOiLevel(
                    row,
                    [
                        "callOIChange",
                        "callOiChange",
                        "call_oi_change",
                        "ceOIChange",
                        "ceOiChange",
                        "ce_oi_change"
                    ]
                );

            const putOIChange =
                getOiLevel(
                    row,
                    [
                        "putOIChange",
                        "putOiChange",
                        "put_oi_change",
                        "peOIChange",
                        "peOiChange",
                        "pe_oi_change"
                    ]
                );

            if (!strike || strike <= 0) {
                return null;
            }

            return {
                strike,
                callOI,
                putOI,
                callOIChange,
                putOIChange
            };
        })
        .filter(Boolean);

    if (normalized.length === 0) {

        return {

            oiSupport1:
                directSupport1,

            oiSupport2:
                directSupport2,

            oiResistance1:
                directResistance1,

            oiResistance2:
                directResistance2
        };
    }

    // ========================================================
    // PUT OI = SUPPORT
    // ========================================================

    const putOiLevels =
        normalized
            .filter(row =>
                row.putOI > 0
            )
            .sort(
                (a, b) =>
                    b.putOI - a.putOI
            );

    // ========================================================
    // CALL OI = RESISTANCE
    // ========================================================

    const callOiLevels =
        normalized
            .filter(row =>
                row.callOI > 0
            )
            .sort(
                (a, b) =>
                    b.callOI - a.callOI
            );

    // ========================================================
    // FALLBACK TO OI CHANGE
    // ========================================================

    const putOiChangeLevels =
        normalized
            .filter(row =>
                row.putOIChange > 0
            )
            .sort(
                (a, b) =>
                    b.putOIChange -
                    a.putOIChange
            );

    const callOiChangeLevels =
        normalized
            .filter(row =>
                row.callOIChange > 0
            )
            .sort(
                (a, b) =>
                    b.callOIChange -
                    a.callOIChange
            );

    const oiSupport1 =
        putOiLevels[0]?.strike ||
        putOiChangeLevels[0]?.strike ||
        directSupport1 ||
        0;

    const oiSupport2 =
        putOiLevels[1]?.strike ||
        putOiChangeLevels[1]?.strike ||
        directSupport2 ||
        0;

    const oiResistance1 =
        callOiLevels[0]?.strike ||
        callOiChangeLevels[0]?.strike ||
        directResistance1 ||
        0;

    const oiResistance2 =
        callOiLevels[1]?.strike ||
        callOiChangeLevels[1]?.strike ||
        directResistance2 ||
        0;

    return {

        oiSupport1:
            Number(
                oiSupport1.toFixed(2)
            ),

        oiSupport2:
            Number(
                oiSupport2.toFixed(2)
            ),

        oiResistance1:
            Number(
                oiResistance1.toFixed(2)
            ),

        oiResistance2:
            Number(
                oiResistance2.toFixed(2)
            )
    };
}

// ============================================================
// MERGE PRICE + OI LEVELS
// ============================================================

function calculateSupportResistance(
    candles,
    oiData = null
) {

    const priceLevels =
        calculatePriceActionLevels(
            candles
        );

    const oiLevels =
        calculateOILevels(
            oiData
        );

    return {

        // ----------------------------------------------------
        // PRICE ACTION
        // ----------------------------------------------------

        support1:
            priceLevels.support1,

        support2:
            priceLevels.support2,

        resistance1:
            priceLevels.resistance1,

        resistance2:
            priceLevels.resistance2,

        // ----------------------------------------------------
        // OI LEVELS
        // ----------------------------------------------------

        oiSupport1:
            oiLevels.oiSupport1,

        oiSupport2:
            oiLevels.oiSupport2,

        oiResistance1:
            oiLevels.oiResistance1,

        oiResistance2:
            oiLevels.oiResistance2
    };
}

// ============================================================
// GET BEST SUPPORT FOR CALL
// ============================================================

function getBestCallSupport(
    entry,
    levels
) {

    const candidates = [

        Number(levels?.oiSupport1) || 0,
        Number(levels?.oiSupport2) || 0,
        Number(levels?.support1) || 0,
        Number(levels?.support2) || 0

    ]
        .filter(level =>
            level > 0 &&
            level < entry
        )
        .sort(
            (a, b) =>
                b - a
        );

    return candidates[0] || 0;
}

// ============================================================
// GET BEST RESISTANCE FOR CALL
// ============================================================

function getBestCallResistance(
    entry,
    levels
) {

    const candidates = [

        Number(levels?.oiResistance1) || 0,
        Number(levels?.oiResistance2) || 0,
        Number(levels?.resistance1) || 0,
        Number(levels?.resistance2) || 0

    ]
        .filter(level =>
            level > entry
        )
        .sort(
            (a, b) =>
                a - b
        );

    return candidates[0] || 0;
}

// ============================================================
// GET BEST RESISTANCE FOR PUT
// ============================================================

function getBestPutResistance(
    entry,
    levels
) {

    const candidates = [

        Number(levels?.oiResistance1) || 0,
        Number(levels?.oiResistance2) || 0,
        Number(levels?.resistance1) || 0,
        Number(levels?.resistance2) || 0

    ]
        .filter(level =>
            level > entry
        )
        .sort(
            (a, b) =>
                a - b
        );

    return candidates[0] || 0;
}

// ============================================================
// GET BEST SUPPORT FOR PUT
// ============================================================

function getBestPutSupport(
    entry,
    levels
) {

    const candidates = [

        Number(levels?.oiSupport1) || 0,
        Number(levels?.oiSupport2) || 0,
        Number(levels?.support1) || 0,
        Number(levels?.support2) || 0

    ]
        .filter(level =>
            level > 0 &&
            level < entry
        )
        .sort(
            (a, b) =>
                b - a
        );

    return candidates[0] || 0;
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateSupportResistance,

    calculatePriceActionLevels,

    calculateOILevels,

    getBestCallSupport,

    getBestCallResistance,

    getBestPutSupport,

    getBestPutResistance

};