// ============================================================
// OI MOOD ENGINE — PER STOCK
// ============================================================
//
// PURPOSE
// ------------------------------------------------------------
// Calculates OI mood independently for EACH stock.
//
// Price UP   + OI UP   = LONG BUILDUP
// Price DOWN + OI UP   = SHORT BUILDUP
// Price UP   + OI DOWN = SHORT COVERING
// Price DOWN + OI DOWN = LONG UNWINDING
//
// Price/OI movement too small = NEUTRAL
// Missing/unreliable OI data   = UNKNOWN
//
// OUTPUT
// ------------------------------------------------------------
// {
//     mood,
//     sentiment,
//     priceChange,
//     priceChangePercent,
//     oiChange,
//     oiChangePercent
// }
//
// IMPORTANT
// ------------------------------------------------------------
// This file does NOT use overall market OI.
// Every stock receives its own calculation.
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const PRICE_THRESHOLD = 0.10;   // %
const OI_THRESHOLD = 1.00;      // %


// ============================================================
// NUMBER NORMALIZER
// ============================================================

function toNumber(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return NaN;
    }

    if (typeof value === "string") {

        value = value
            .replace(/,/g, "")
            .replace(/%/g, "")
            .trim();

    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : NaN;
}


// ============================================================
// CALCULATE OI MOOD
// ============================================================

function calculateOIMood({

    currentPrice,
    previousPrice,
    currentOI,
    previousOI

} = {}) {

    const price =
        toNumber(currentPrice);

    const prevPrice =
        toNumber(previousPrice);

    const oi =
        toNumber(currentOI);

    const prevOI =
        toNumber(previousOI);


    // ========================================================
    // VALIDATION
    // ========================================================

    if (
        !Number.isFinite(price) ||
        !Number.isFinite(prevPrice) ||
        !Number.isFinite(oi) ||
        !Number.isFinite(prevOI) ||
        prevPrice <= 0 ||
        prevOI <= 0
    ) {

        return {

            mood: "UNKNOWN",

            sentiment: "UNKNOWN",

            priceChange: 0,

            priceChangePercent: 0,

            oiChange: 0,

            oiChangePercent: 0,

            priceDirection: "UNKNOWN",

            oiDirection: "UNKNOWN",

            dataAvailable: false

        };

    }


    // ========================================================
    // PRICE CHANGE
    // ========================================================

    const priceChange =
        price - prevPrice;


    const priceChangePercent =
        (priceChange / prevPrice) * 100;


    // ========================================================
    // OI CHANGE
    // ========================================================

    const oiChange =
        oi - prevOI;


    const oiChangePercent =
        (oiChange / prevOI) * 100;


    // ========================================================
    // PRICE DIRECTION
    // ========================================================

    let priceDirection =
        "FLAT";


    if (
        priceChangePercent >=
        PRICE_THRESHOLD
    ) {

        priceDirection =
            "UP";

    }

    else if (
        priceChangePercent <=
        -PRICE_THRESHOLD
    ) {

        priceDirection =
            "DOWN";

    }


    // ========================================================
    // OI DIRECTION
    // ========================================================

    let oiDirection =
        "FLAT";


    if (
        oiChangePercent >=
        OI_THRESHOLD
    ) {

        oiDirection =
            "UP";

    }

    else if (
        oiChangePercent <=
        -OI_THRESHOLD
    ) {

        oiDirection =
            "DOWN";

    }


    // ========================================================
    // OI MOOD
    // ========================================================

    let mood =
        "NEUTRAL";


    // --------------------------------------------------------
    // PRICE UP + OI UP
    // --------------------------------------------------------

    if (
        priceDirection === "UP" &&
        oiDirection === "UP"
    ) {

        mood =
            "LONG BUILDUP";

    }


    // --------------------------------------------------------
    // PRICE DOWN + OI UP
    // --------------------------------------------------------

    else if (
        priceDirection === "DOWN" &&
        oiDirection === "UP"
    ) {

        mood =
            "SHORT BUILDUP";

    }


    // --------------------------------------------------------
    // PRICE UP + OI DOWN
    // --------------------------------------------------------

    else if (
        priceDirection === "UP" &&
        oiDirection === "DOWN"
    ) {

        mood =
            "SHORT COVERING";

    }


    // --------------------------------------------------------
    // PRICE DOWN + OI DOWN
    // --------------------------------------------------------

    else if (
        priceDirection === "DOWN" &&
        oiDirection === "DOWN"
    ) {

        mood =
            "LONG UNWINDING";

    }


    // ========================================================
    // SENTIMENT
    // ========================================================

    let sentiment =
        "NEUTRAL";


    if (
        mood === "LONG BUILDUP" ||
        mood === "SHORT COVERING"
    ) {

        sentiment =
            "BULLISH";

    }

    else if (
        mood === "SHORT BUILDUP" ||
        mood === "LONG UNWINDING"
    ) {

        sentiment =
            "BEARISH";

    }


    // ========================================================
    // RETURN
    // ========================================================

    return {

        mood,

        sentiment,

        priceChange,

        priceChangePercent,

        oiChange,

        oiChangePercent,

        priceDirection,

        oiDirection,

        dataAvailable: true

    };

}


// ============================================================
// HELPER — CALCULATE FROM A STOCK OBJECT
// ============================================================
//
// This allows scanner code to pass a complete stock object
// without changing the core calculation.
//
// Supported field names:
// currentPrice / price / close
// previousPrice / prevPrice / previousClose
// currentOI / oi / openInterest
// previousOI / prevOI / previousOpenInterest
// ============================================================

function calculateOIMoodForStock(stock = {}) {

    if (
        !stock ||
        typeof stock !== "object"
    ) {

        return calculateOIMood();

    }


    const currentPrice =
        stock.currentPrice ??
        stock.price ??
        stock.close;


    const previousPrice =
        stock.previousPrice ??
        stock.prevPrice ??
        stock.previousClose;


    const currentOI =
        stock.currentOI ??
        stock.oi ??
        stock.openInterest;


    const previousOI =
        stock.previousOI ??
        stock.prevOI ??
        stock.previousOpenInterest;


    return calculateOIMood({

        currentPrice,

        previousPrice,

        currentOI,

        previousOI

    });

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateOIMood,

    calculateOIMoodForStock,

    PRICE_THRESHOLD,

    OI_THRESHOLD

};