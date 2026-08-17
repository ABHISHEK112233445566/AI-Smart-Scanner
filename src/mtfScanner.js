// ============================================================
// MULTI TIMEFRAME SCANNER - CORRECTED V8
// ============================================================
//
// Purpose:
// - Broker-independent MTF analysis
// - Uses active broker adapter only
// - Supports DAILY
// - Builds FOUR_HOUR from ONE_HOUR candles
// - Supports ONE_HOUR
// - Supports FIFTEEN_MINUTE
// - Balanced bullish + bearish scoring
// - UNKNOWN timeframes do NOT create false alignment
// - Never directly imports Angel One / Upstox
//
// IMPORTANT:
// - Do NOT import ./smartapi here
// - Do NOT import Upstox directly
// - Do NOT request FOUR_HOUR directly from broker
// - FOUR_HOUR is constructed from ONE_HOUR candles
// ============================================================

const { getBroker } = require("./brokers");
const { calculateIndicators } = require("./indicators");


// ============================================================
// GET ACTIVE BROKER
// ============================================================

function getActiveBroker() {

    const broker = getBroker();

    if (
        !broker ||
        typeof broker.getHistoricalData !== "function"
    ) {
        throw new Error(
            "Active broker does not implement getHistoricalData()"
        );
    }

    return broker;
}


// ============================================================
// EMPTY TREND RESULT
// ============================================================

function emptyTrend() {

    return {
        trend: "UNKNOWN",
        bullish: false,
        bearish: false,
        score: 0,
        bullishPoints: 0,
        bearishPoints: 0,
        valid: false
    };
}


// ============================================================
// NORMALIZE CANDLE
// ============================================================

function normalizeCandle(candle) {

    if (
        !candle ||
        typeof candle !== "object"
    ) {
        return null;
    }

    const timestamp =
        candle.timestamp ??
        candle.time ??
        candle.datetime ??
        candle.date ??
        candle[0];

    const open =
        Number(
            candle.open ??
            candle.o ??
            candle[1]
        );

    const high =
        Number(
            candle.high ??
            candle.h ??
            candle[2]
        );

    const low =
        Number(
            candle.low ??
            candle.l ??
            candle[3]
        );

    const close =
        Number(
            candle.close ??
            candle.c ??
            candle[4]
        );

    const volume =
        Number(
            candle.volume ??
            candle.v ??
            candle[5] ??
            0
        );

    if (
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
    ) {
        return null;
    }

    return {
        timestamp,
        open,
        high,
        low,
        close,
        volume:
            Number.isFinite(volume)
                ? volume
                : 0
    };
}


// ============================================================
// SORT CANDLES
// ============================================================

function sortCandles(candles) {

    if (!Array.isArray(candles)) {
        return [];
    }

    return candles
        .map(normalizeCandle)
        .filter(Boolean)
        .sort((a, b) => {

            const ta =
                new Date(a.timestamp).getTime();

            const tb =
                new Date(b.timestamp).getTime();

            if (
                Number.isFinite(ta) &&
                Number.isFinite(tb)
            ) {
                return ta - tb;
            }

            return 0;
        });
}


// ============================================================
// BUILD FOUR HOUR CANDLES
// ============================================================
//
// IMPORTANT:
//
// NSE session:
// 09:15 -> 15:30
//
// We construct:
//
// 09:15 -> 13:15
// 13:15 -> 15:30
//
// The second candle is naturally shorter because NSE closes
// at 15:30.
//
// We DO NOT require exactly four candles.
//
// This is important because the second 4H bucket contains only
// the remaining regular-session candles.
//
// ============================================================

function buildFourHourCandles(hourlyCandles) {

    const candles =
        sortCandles(hourlyCandles);

    if (candles.length < 2) {
        return [];
    }

    const groups = new Map();

    for (const candle of candles) {

        const date =
            new Date(candle.timestamp);

        if (
            Number.isNaN(date.getTime())
        ) {
            continue;
        }

        const minutes =
            date.getHours() * 60 +
            date.getMinutes();

        let bucketStart = null;

        // -----------------------------------------------
        // 09:15 - 13:15
        // -----------------------------------------------

        if (
            minutes >= 555 &&
            minutes < 795
        ) {
            bucketStart = 555;
        }

        // -----------------------------------------------
        // 13:15 - 15:30
        // -----------------------------------------------

        else if (
            minutes >= 795 &&
            minutes <= 930
        ) {
            bucketStart = 795;
        }

        else {
            continue;
        }

        const bucketDate =
            new Date(date);

        bucketDate.setHours(
            Math.floor(bucketStart / 60),
            bucketStart % 60,
            0,
            0
        );

        const key =
            bucketDate.toISOString();

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups
            .get(key)
            .push(candle);
    }

    const fourHourCandles = [];

    for (
        const [timestamp, group]
        of groups.entries()
    ) {

        if (!group.length) {
            continue;
        }

        group.sort(
            (a, b) =>
                new Date(a.timestamp).getTime() -
                new Date(b.timestamp).getTime()
        );

        const first =
            group[0];

        const last =
            group[group.length - 1];

        fourHourCandles.push({

            timestamp,

            open:
                first.open,

            high:
                Math.max(
                    ...group.map(
                        c => c.high
                    )
                ),

            low:
                Math.min(
                    ...group.map(
                        c => c.low
                    )
                ),

            close:
                last.close,

            volume:
                group.reduce(
                    (total, c) =>
                        total +
                        (
                            Number(c.volume) || 0
                        ),
                    0
                )
        });
    }

    return fourHourCandles.sort(
        (a, b) =>
            new Date(a.timestamp).getTime() -
            new Date(b.timestamp).getTime()
    );
}


// ============================================================
// GET TREND FROM CANDLES
// ============================================================

function calculateTrendFromCandles(
    symbol,
    interval,
    candles
) {

    try {

        console.log(
            `MTF Candles: ${symbol} ${interval} = ${
                Array.isArray(candles)
                    ? candles.length
                    : 0
            }`
        );

        // ----------------------------------------------------
        // Minimum data
        // ----------------------------------------------------

        if (
            !Array.isArray(candles) ||
            candles.length < 50
        ) {

            console.log(
                `⚠️ Insufficient MTF candles: ${symbol} ${interval}`
            );

            return emptyTrend();
        }

        const data =
            calculateIndicators(candles);

        if (!data) {

            console.log(
                `⚠️ Indicators unavailable: ${symbol} ${interval}`
            );

            return emptyTrend();
        }


        // ====================================================
        // SAFE VALUES
        // ====================================================

        const ema20 =
            Number(data.ema20 ?? 0);

        const ema50 =
            Number(data.ema50 ?? 0);

        const ema200 =
            Number(data.ema200 ?? 0);

        const rsi =
            Number(data.rsi ?? 0);


        // ====================================================
        // MACD
        // ====================================================

        let macd = 0;
        let macdSignal = 0;

        if (
            data.macd &&
            typeof data.macd === "object"
        ) {

            macd =
                Number(
                    data.macd.MACD ??
                    data.macd.macd ??
                    data.macd.value ??
                    0
                );

            macdSignal =
                Number(
                    data.macd.signal ??
                    data.macd.Signal ??
                    0
                );

        } else {

            macd =
                Number(data.macd ?? 0);

            macdSignal =
                Number(
                    data.macdSignal ?? 0
                );
        }


        // ====================================================
        // ADX / DI
        // ====================================================

        const adx =
            Number(
                data.adx ??
                data.ADX ??
                0
            );

        const plusDI =
            Number(
                data.plusDI ??
                data.pdi ??
                data.PDI ??
                0
            );

        const minusDI =
            Number(
                data.minusDI ??
                data.mdi ??
                data.MDI ??
                0
            );


        // ====================================================
        // VALIDITY
        // ====================================================

        const hasEMA20 =
            Number.isFinite(ema20) &&
            ema20 > 0;

        const hasEMA50 =
            Number.isFinite(ema50) &&
            ema50 > 0;

        const hasEMA200 =
            Number.isFinite(ema200) &&
            ema200 > 0;

        const hasRSI =
            Number.isFinite(rsi) &&
            rsi > 0;

        const hasMACD =
            Number.isFinite(macd) &&
            Number.isFinite(macdSignal);

        const hasADX =
            Number.isFinite(adx) &&
            adx > 0;

        const hasDI =
            Number.isFinite(plusDI) &&
            Number.isFinite(minusDI);


        // ====================================================
        // BULLISH
        // ====================================================

        let bullishPoints = 0;

        if (
            hasEMA20 &&
            hasEMA50 &&
            ema20 > ema50
        ) {
            bullishPoints++;
        }

        if (
            hasEMA50 &&
            hasEMA200 &&
            ema50 > ema200
        ) {
            bullishPoints++;
        }

        if (
            hasRSI &&
            rsi > 50
        ) {
            bullishPoints++;
        }

        if (
            hasMACD &&
            macd > macdSignal
        ) {
            bullishPoints++;
        }

        if (
            hasADX &&
            hasDI &&
            adx >= 20 &&
            plusDI > minusDI
        ) {
            bullishPoints++;
        }


        // ====================================================
        // BEARISH
        // ====================================================

        let bearishPoints = 0;

        if (
            hasEMA20 &&
            hasEMA50 &&
            ema20 < ema50
        ) {
            bearishPoints++;
        }

        if (
            hasEMA50 &&
            hasEMA200 &&
            ema50 < ema200
        ) {
            bearishPoints++;
        }

        if (
            hasRSI &&
            rsi < 50
        ) {
            bearishPoints++;
        }

        if (
            hasMACD &&
            macd < macdSignal
        ) {
            bearishPoints++;
        }

        if (
            hasADX &&
            hasDI &&
            adx >= 20 &&
            minusDI > plusDI
        ) {
            bearishPoints++;
        }


        // ====================================================
        // DETERMINE TREND
        // ====================================================

        let trend = "SIDEWAYS";
        let bullish = false;
        let bearish = false;
        let score = 0;

        if (
            bullishPoints >= 3 &&
            bullishPoints > bearishPoints
        ) {

            trend =
                bullishPoints >= 4
                    ? "STRONG BULLISH"
                    : "BULLISH";

            bullish = true;
            score = bullishPoints;

        }

        else if (
            bearishPoints >= 3 &&
            bearishPoints > bullishPoints
        ) {

            trend =
                bearishPoints >= 4
                    ? "STRONG BEARISH"
                    : "BEARISH";

            bearish = true;
            score = -bearishPoints;
        }


        return {

            trend,
            bullish,
            bearish,
            score,
            bullishPoints,
            bearishPoints,
            valid: true
        };

    }

    catch (error) {

        console.log(
            `⚠️ ${symbol} ${interval} MTF calculation failed: ${
                error?.message || error
            }`
        );

        return emptyTrend();
    }
}


// ============================================================
// GET TREND FOR ONE TIMEFRAME
// ============================================================

async function getTrend(
    symbol,
    interval
) {

    try {

        console.log(
            `MTF Request: ${symbol} ${interval}`
        );

        const broker =
            getActiveBroker();


        // ====================================================
        // FOUR HOUR
        // ====================================================

        if (
            interval === "FOUR_HOUR"
        ) {

            const hourlyCandles =
                await broker.getHistoricalData(
                    symbol,
                    "ONE_HOUR"
                );

            if (
                !Array.isArray(hourlyCandles) ||
                hourlyCandles.length < 50
            ) {

                console.log(
                    `⚠️ Insufficient ONE_HOUR candles for FOUR_HOUR: ${symbol}`
                );

                return emptyTrend();
            }

            const fourHourCandles =
                buildFourHourCandles(
                    hourlyCandles
                );

            console.log(
                `MTF Built FOUR_HOUR: ${symbol} = ${fourHourCandles.length}`
            );

            return calculateTrendFromCandles(
                symbol,
                "FOUR_HOUR",
                fourHourCandles
            );
        }


        // ====================================================
        // NORMAL TIMEFRAME
        // ====================================================

        const candles =
            await broker.getHistoricalData(
                symbol,
                interval
            );

        return calculateTrendFromCandles(
            symbol,
            interval,
            candles
        );

    }

    catch (error) {

        console.log(
            `⚠️ ${symbol} ${interval} MTF failed: ${
                error?.message || error
            }`
        );

        return emptyTrend();
    }
}


// ============================================================
// MULTI TIMEFRAME ANALYSIS
// ============================================================
//
// WEIGHTS:
//
// DAILY       30
// FOUR_HOUR   30
// ONE_HOUR    20
// 15 MINUTE   20
//
// TOTAL      100
//
// IMPORTANT:
// UNKNOWN timeframe = 0 points
//
// UNKNOWN does NOT count as bullish/bearish.
//
// ============================================================

async function getMultiTimeframeAnalysis(
    symbol
) {

    console.log(
        `\n========== MTF ANALYSIS: ${symbol} ==========\n`
    );


    // ========================================================
    // FETCH ALL TIMEFRAMES
    // ========================================================

    const daily =
        await getTrend(
            symbol,
            "ONE_DAY"
        );

    const fourHour =
        await getTrend(
            symbol,
            "FOUR_HOUR"
        );

    const oneHour =
        await getTrend(
            symbol,
            "ONE_HOUR"
        );

    const fifteen =
        await getTrend(
            symbol,
            "FIFTEEN_MINUTE"
        );


    // ========================================================
    // MTF SCORE
    // ========================================================

    let mtfScore = 0;


    // DAILY
    if (daily.bullish) {
        mtfScore += 30;
    }
    else if (daily.bearish) {
        mtfScore -= 30;
    }


    // 4H
    if (fourHour.bullish) {
        mtfScore += 30;
    }
    else if (fourHour.bearish) {
        mtfScore -= 30;
    }


    // 1H
    if (oneHour.bullish) {
        mtfScore += 20;
    }
    else if (oneHour.bearish) {
        mtfScore -= 20;
    }


    // 15M
    if (fifteen.bullish) {
        mtfScore += 20;
    }
    else if (fifteen.bearish) {
        mtfScore -= 20;
    }


    // ========================================================
    // OVERALL TREND
    // ========================================================

    let overallTrend = "SIDEWAYS";

    if (mtfScore >= 70) {

        overallTrend =
            "STRONG BULLISH";

    }
    else if (mtfScore >= 40) {

        overallTrend =
            "BULLISH";

    }
    else if (mtfScore <= -70) {

        overallTrend =
            "STRONG BEARISH";

    }
    else if (mtfScore <= -40) {

        overallTrend =
            "BEARISH";
    }


    // ========================================================
    // VALID TIMEFRAMES
    // ========================================================

    const timeframes = [
        daily,
        fourHour,
        oneHour,
        fifteen
    ];

    const validTimeframes =
        timeframes.filter(
            tf => tf.valid
        );


    // ========================================================
    // DIRECTION COUNTS
    // ========================================================

    const bullishTimeframes =
        validTimeframes.filter(
            tf => tf.bullish
        ).length;

    const bearishTimeframes =
        validTimeframes.filter(
            tf => tf.bearish
        ).length;

    const unknownTimeframes =
        timeframes.length -
        validTimeframes.length;


    // ========================================================
    // ALIGNMENT
    // ========================================================

    let alignment = "MIXED";


    if (
        validTimeframes.length === 4 &&
        bullishTimeframes === 4
    ) {

        alignment =
            "FULL BULLISH";

    }

    else if (
        validTimeframes.length === 4 &&
        bearishTimeframes === 4
    ) {

        alignment =
            "FULL BEARISH";

    }

    else if (
        bullishTimeframes >= 3 &&
        bullishTimeframes > bearishTimeframes
    ) {

        alignment =
            "BULLISH ALIGNED";

    }

    else if (
        bearishTimeframes >= 3 &&
        bearishTimeframes > bullishTimeframes
    ) {

        alignment =
            "BEARISH ALIGNED";

    }

    else if (
        bullishTimeframes === 0 &&
        bearishTimeframes === 0
    ) {

        alignment =
            "UNKNOWN";

    }


    // ========================================================
    // DIRECTION CONSISTENCY
    // ========================================================

    let directionBias =
        "NEUTRAL";

    if (
        bullishTimeframes >
        bearishTimeframes
    ) {

        directionBias =
            "BULLISH";

    }

    else if (
        bearishTimeframes >
        bullishTimeframes
    ) {

        directionBias =
            "BEARISH";
    }


    // ========================================================
    // DEBUG
    // ========================================================

    console.log(
        `MTF Result: ${symbol} | ` +
        `Daily=${daily.trend} | ` +
        `4H=${fourHour.trend} | ` +
        `1H=${oneHour.trend} | ` +
        `15M=${fifteen.trend} | ` +
        `Score=${mtfScore} | ` +
        `Bull=${bullishTimeframes} | ` +
        `Bear=${bearishTimeframes} | ` +
        `Unknown=${unknownTimeframes} | ` +
        `Alignment=${alignment}`
    );


    // ========================================================
    // RETURN
    // ========================================================

    return {

        dailyTrend:
            daily.trend,

        fourHourTrend:
            fourHour.trend,

        oneHourTrend:
            oneHour.trend,

        fifteenMinTrend:
            fifteen.trend,

        mtfScore,

        overallTrend,

        bullishTimeframes,

        bearishTimeframes,

        unknownTimeframes,

        validTimeframes:
            validTimeframes.length,

        directionBias,

        alignment,

        details: {

            daily,

            fourHour,

            oneHour,

            fifteen

        }

    };
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    getMultiTimeframeAnalysis,

    buildFourHourCandles,

    getTrend

};