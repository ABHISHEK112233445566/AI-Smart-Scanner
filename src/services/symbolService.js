const axios = require("axios");

let symbolMaster = [];

// =========================================
// LOAD ANGEL ONE SYMBOL MASTER
// =========================================

async function loadSymbolMaster() {

    if (symbolMaster.length > 0) {
        return;
    }

    console.log("Loading Angel One Symbol Master...");

    const response = await axios.get(
        "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    );

    symbolMaster = response.data;

    console.log(
        `✅ Symbol Master Loaded (${symbolMaster.length} symbols)`
    );
}


// =========================================
// GET SYMBOL TOKEN
// =========================================

function getSymbolToken(stockName) {

    const symbol = String(stockName)
        .trim()
        .toUpperCase();

    return symbolMaster.find(
        s =>
            s.exch_seg === "NSE" &&
            s.symbol === `${symbol}-EQ`
    );
}


// =========================================
// GET ALL SYMBOLS
// =========================================

function getAllSymbols() {

    return symbolMaster;
}


// =========================================
// EXPORT
// =========================================

module.exports = {
    loadSymbolMaster,
    getSymbolToken,
    getAllSymbols
};