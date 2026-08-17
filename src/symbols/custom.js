const { getAllSymbols } = require("../services/symbolService");

async function getAllStocks() {

    const symbols = getAllSymbols();

    return symbols
        .filter(
            s =>
                s.exch_seg === "NSE" &&
                s.symbol.endsWith("-EQ")
        )
        .map(s => ({
            name: s.name,
            symbol: s.symbol.replace("-EQ", ""),
            exchange: "NSE",
            token: s.token
        }));

}

module.exports = getAllStocks;