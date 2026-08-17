require("dotenv").config();

const {
    login,
    getHistoricalData,
    getInstrumentKey
} = require("./brokers");

async function test() {

    try {

        console.log("\n===============================");
        console.log("   UPSTOX CONNECTION TEST");
        console.log("===============================\n");


        // =====================================
        // LOGIN
        // =====================================

        await login();


        // =====================================
        // TEST STOCK
        // =====================================

        const symbol = "TITAN";


        console.log(
            `\n🔎 Finding instrument: ${symbol}`
        );


        const instrumentKey =
            getInstrumentKey(symbol);


        console.log(
            "Instrument Key:",
            instrumentKey
        );


        if (!instrumentKey) {

            throw new Error(
                `Instrument not found: ${symbol}`
            );

        }


        // =====================================
        // TEST DAILY
        // =====================================

        console.log(
            "\n📊 Testing ONE_DAY..."
        );


        const daily =
            await getHistoricalData(
                symbol,
                "ONE_DAY"
            );


        console.log(
            "ONE_DAY candles:",
            daily.length
        );


        console.log(
            "Last daily candle:",
            daily.at(-1)
        );


        // =====================================
        // TEST 1 HOUR
        // =====================================

        console.log(
            "\n📊 Testing ONE_HOUR..."
        );


        const hourly =
            await getHistoricalData(
                symbol,
                "ONE_HOUR"
            );


        console.log(
            "ONE_HOUR candles:",
            hourly.length
        );


        console.log(
            "Last hourly candle:",
            hourly.at(-1)
        );


        // =====================================
        // TEST 15 MINUTE
        // =====================================

        console.log(
            "\n📊 Testing FIFTEEN_MINUTE..."
        );


        const fifteen =
            await getHistoricalData(
                symbol,
                "FIFTEEN_MINUTE"
            );


        console.log(
            "FIFTEEN_MINUTE candles:",
            fifteen.length
        );


        console.log(
            "Last 15-minute candle:",
            fifteen.at(-1)
        );


        // =====================================
        // SUCCESS
        // =====================================

        console.log(
            "\n================================"
        );

        console.log(
            "✅ UPSTOX TEST SUCCESSFUL"
        );

        console.log(
            "================================\n"
        );


    }
    catch (error) {

        console.error(
            "\n❌ UPSTOX TEST FAILED"
        );

        console.error(
            error.message
        );

    }

}


test();