// ============================================================
// OI MOOD ENGINE
// ============================================================
// Calculates OI mood from the exact instrument supplied.
// Stock objects use stock price/OI fields.
// Option objects MUST use option-specific fields when present.
// ============================================================

const PRICE_THRESHOLD = 0.10;
const OI_THRESHOLD = 1.00;

function toNumber(value) {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "string') value = value.replace(/,/g, "").replace(/%/g, "").trim();
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
}

function calculateOIMood({ currentPrice, previousPrice, currentOI, previousOI } = {}) {
    const price = toNumber(currentPrice);
    const prevPrice = toNumber(previousPrice);
    const oi = toNumber(currentOI);
    const prevOI = toNumber(previousOI);

    if (!Number.isFinite(price) || !Number.isFinite(prevPrice) || !Number.isFinite(oi) || !Number.isFinite(prevOI) || prevPrice <= 0 || prevOI <= 0) {
        return {
            mood: "UNKNOWN", sentiment: "UNKNOWN", priceChange: 0, priceChangePercent: 0,
            oiChange: 0, oiChangePercent: 0, priceDirection: "UNKNOWN", oiDirection: "UNKNOWN",
            dataAvailable: false
        };
    }

    const priceChange = price - prevPrice;
    const priceChangePercent = (priceChange / prevPrice) * 100;
    const oiChange = oi - prevOI;
    const oiChangePercent = (oiChange / prevOI) * 100;

    const priceDirection = priceChangePercent >= PRICE_THRESHOLD ? "UP" : priceChangePercent <= -PRICE_THRESHOLD ? "DOWN" : "FLAT";
    const oiDirection = oiChangePercent >= OI_THRESHOLD ? "UP" : oiChangePercent <= -OI_THRESHOLD ? "DOWN" : "FLAT";

    let mood = "NEUTRAL";
    if (priceDirection === "UP" && oiDirection === "UP") mood = "LONG BUILDUP";
    else if (priceDirection === "DOWN" && oiDirection === "UP") mood = "SHORT BUILDUP";
    else if (priceDirection === "UP" && oiDirection === "DOWN") mood = "SHORT COVERING";
    else if (priceDirection === "DOWN" && oiDirection === "DOWN") mood = "LONG UNWINDING";

    const sentiment = (mood === "LONG BUILDUP" || mood === "SHORT COVERING") ? "BULLISH" :
        (mood === "SHORT BUILDUP" || mood === "LONG UNWINDING") ? "BEARISH" : "NEUTRAL";

    return {
        mood, sentiment, priceChange, priceChangePercent, oiChange, oiChangePercent,
        priceDirection, oiDirection, dataAvailable: true
    };
}

// IMPORTANT: when option fields exist, they always take precedence.
// This prevents the option Dashboard from accidentally displaying stock OI mood.
function calculateOIMoodForStock(stock = {}) {
    if (!stock || typeof stock !== "object") return calculateOIMood();

    const hasOptionIdentity = Boolean(
        stock.optionInstrumentKey || stock.optionInstrument || stock.optionSymbol ||
        stock.optionType || stock.recommendedStrike || stock.atmStrike
    );

    if (hasOptionIdentity) {
        return calculateOIMood({
            currentPrice: stock.optionCurrentPrice ?? stock.optionLTP ?? stock.optionPremiumEntry,
            previousPrice: stock.optionPreviousPrice ?? stock.optionPrevLTP ?? stock.optionPreviousLTP,
            currentOI: stock.optionCurrentOI ?? stock.optionOI ?? stock.optionOpenInterest,
            previousOI: stock.optionPreviousOI ?? stock.optionPrevOI ?? stock.optionPreviousOpenInterest
        });
    }

    return calculateOIMood({
        currentPrice: stock.currentPrice ?? stock.price ?? stock.close,
        previousPrice: stock.previousPrice ?? stock.prevPrice ?? stock.previousClose,
        currentOI: stock.currentOI ?? stock.oi ?? stock.openInterest,
        previousOI: stock.previousOI ?? stock.prevOI ?? stock.previousOpenInterest
    });
}

module.exports = { calculateOIMood, calculateOIMoodForStock, PRICE_THRESHOLD, OI_THRESHOLD };