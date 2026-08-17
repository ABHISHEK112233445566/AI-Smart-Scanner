require("dotenv").config();

const broker = require("./brokers");


// =========================================
// BROKER
// =========================================

console.log(
    `🔌 Active Broker: ${broker.brokerName}`
);


// =========================================
// LOGIN
// =========================================

async function loginAngelOne() {

    return broker.login();

}


// =========================================
// HISTORICAL DATA
// =========================================

async function getHistoricalData(
    symbol,
    interval = "ONE_DAY"
) {

    return broker.getHistoricalData(
        symbol,
        interval
    );

}


// =========================================
// QUOTE
// =========================================

async function getQuote(symbol) {

    return broker.getQuote(
        symbol
    );

}


// =========================================
// EXPORT
// =========================================

module.exports = {

    loginAngelOne,

    getHistoricalData,

    getQuote

};