// ============================================================
// STOCK SCANNER V3
// ============================================================
// PURPOSE
// ============================================================
// - Broker independent
// - Daily historical data
// - Technical indicators
// - AI score
// - Stock trade setup
// - Support / Resistance
// - Breakout
// - Multi-timeframe analysis
// - Pivot / CPR
// - Final ranking
// - Options decision
//
// CORE RULES
// ============================================================
// 1. NEVER force CALL.
// 2. NEVER force PUT.
// 3. NEVER convert bearish into bullish.
// 4. AI signal cannot blindly override technical structure.
// 5. Bullish and bearish structures are calculated independently.
// 6. Conflicting technical structure = NEUTRAL.
// 7. OptionsDecisionEngine decides CALL / PUT / NO DIRECTION.
// 8. Dashboard qualification = 85+.
// 9. Scanner data keeps only useful fields.
// ============================================================

const {
    getHistoricalData,
    getInstrument
} = require("./brokers");

const {
    calculateIndicators
} = require("./indicators");

const {
    calculateScore
} = require("./aiEngine");

const {
    calculateTradeSetup
} = require("./tradeSetup");

const {
    calculateSupportResistance
} = require("./supportResistance");

const {
    calculateBreakout
} = require("./breakout");

const {
    getMultiTimeframeAnalysis
} = require("./mtfScanner");

const {
    calculatePivotPoints
} = require("./pivotPoints");

const {
    calculateCPR
} = require("./cpr");

const {
    calculateFinalRank
} = require("./rankingEngine");

const {
    calculateOptionsDecision
} = require("./optionsDecisionEngine");


// ============================================================
// CONFIGURATION
// ============================================================

const DASHBOARD_MIN_SCORE = 85;


// ============================================================
// BASIC HELPERS
// ============================================================

function toNumber(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;
}


function safeObject(value) {

    return (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    )
        ? value
        : {};
}


function safeBoolean(value) {

    if (value === true) return true;
    if (value === false) return false;

    if (typeof value === "string") {

        return value
            .trim()
            .toUpperCase() === "TRUE";

    }

    return false;
}


function clampScore(value) {

    return Math.max(
        0,
        Math.min(
            100,
            Math.round(
                toNumber(value)
            )
        )
    );
}


// ============================================================
// DIRECTION NORMALIZATION
// ============================================================

function normalizeDirection(value) {

    const direction =
        String(value || "")
            .trim()
            .toUpperCase();

    if (
        [
            "BULLISH",
            "BULL",
            "LONG",
            "CALL",
            "CE",
            "BUY",
            "BUY SIGNAL",
            "STRONG BUY"
        ].includes(direction)
    ) {

        return "BULLISH";

    }


    if (
        [
            "BEARISH",
            "BEAR",
            "SHORT",
            "PUT",
            "PE",
            "SELL",
            "SELL SIGNAL",
            "STRONG SELL"
        ].includes(direction)
    ) {

        return "BEARISH";

    }


    return "NEUTRAL";

}


// ============================================================
// MACD
// ============================================================

function getMACDValues(indicators = {}) {

    const macdObject =
        safeObject(
            indicators.macd
        );


    const macd =
        toNumber(
            macdObject.MACD ??
            macdObject.macd ??
            indicators.MACD
        );


    const signal =
        toNumber(
            macdObject.signal ??
            macdObject.Signal ??
            indicators.macdSignal ??
            indicators.MACDSignal
        );


    const histogram =
        toNumber(
            macdObject.histogram ??
            macdObject.Histogram ??
            indicators.histogram,
            macd - signal
        );


    return {
        macd,
        signal,
        histogram
    };

}


// ============================================================
// TECHNICAL DIRECTION
// ============================================================
// IMPORTANT
// ------------------------------------------------------------
// This does NOT use AI.
// Bullish and bearish scores are calculated independently.
// ============================================================

function determineTechnicalDirection(
    indicators = {},
    price = 0
) {

    const currentPrice =
        toNumber(
            price ||
            indicators.price
        );


    const ema20 =
        toNumber(
            indicators.ema20 ??
            indicators.EMA20
        );


    const ema50 =
        toNumber(
            indicators.ema50 ??
            indicators.EMA50
        );


    const ema100 =
        toNumber(
            indicators.ema100 ??
            indicators.EMA100
        );


    const ema200 =
        toNumber(
            indicators.ema200 ??
            indicators.EMA200
        );


    const rsi =
        toNumber(
            indicators.rsi ??
            indicators.RSI
        );


    const {
        macd,
        signal,
        histogram
    } =
        getMACDValues(
            indicators
        );


    const adxObject =
        safeObject(
            indicators.adx
        );


    const adx =
        toNumber(
            adxObject.adx ??
            indicators.adxValue
        );


    const pdi =
        toNumber(
            adxObject.pdi ??
            adxObject.PDI
        );


    const mdi =
        toNumber(
            adxObject.mdi ??
            adxObject.MDI
        );


    if (
        currentPrice <= 0 ||
        ema20 <= 0 ||
        ema50 <= 0
    ) {

        return "NEUTRAL";

    }


    // ========================================================
    // BULLISH
    // ========================================================

    let bullish = 0;


    if (currentPrice > ema20)
        bullish += 1;

    if (ema20 > ema50)
        bullish += 1;

    if (
        ema100 > 0 &&
        ema50 > ema100
    )
        bullish += 1;

    if (
        ema200 > 0 &&
        ema100 > ema200
    )
        bullish += 1;

    if (rsi > 50)
        bullish += 1;

    if (macd > signal)
        bullish += 1;

    if (histogram > 0)
        bullish += 1;

    if (
        adx >= 20 &&
        pdi > mdi
    )
        bullish += 2;


    // ========================================================
    // BEARISH
    // ========================================================

    let bearish = 0;


    if (currentPrice < ema20)
        bearish += 1;

    if (ema20 < ema50)
        bearish += 1;

    if (
        ema100 > 0 &&
        ema50 < ema100
    )
        bearish += 1;

    if (
        ema200 > 0 &&
        ema100 < ema200
    )
        bearish += 1;

    if (rsi < 50)
        bearish += 1;

    if (macd < signal)
        bearish += 1;

    if (histogram < 0)
        bearish += 1;

    if (
        adx >= 20 &&
        mdi > pdi
    )
        bearish += 2;


    // ========================================================
    // STRONG STRUCTURE
    // ========================================================

    if (
        bullish >= 6 &&
        bullish >= bearish + 2
    ) {

        return "BULLISH";

    }


    if (
        bearish >= 6 &&
        bearish >= bullish + 2
    ) {

        return "BEARISH";

    }


    // ========================================================
    // SECONDARY STRUCTURE
    // ========================================================

    const bullishStructure =
        currentPrice > ema20 &&
        ema20 > ema50 &&
        rsi >= 50 &&
        macd >= signal;


    const bearishStructure =
        currentPrice < ema20 &&
        ema20 < ema50 &&
        rsi <= 50 &&
        macd <= signal;


    if (
        bullishStructure &&
        !bearishStructure
    ) {

        return "BULLISH";

    }


    if (
        bearishStructure &&
        !bullishStructure
    ) {

        return "BEARISH";

    }


    return "NEUTRAL";

}


// ============================================================
// STOCK DIRECTION
// ============================================================
// Technical structure gets priority.
// AI is NOT allowed to turn bearish technical structure bullish.
// ============================================================

function determineStockDirection(
    signal,
    trend,
    indicators
) {

    const aiDirection =
        normalizeDirection(
            signal
        );


    const trendDirection =
        normalizeDirection(
            trend
        );


    const technicalDirection =
        determineTechnicalDirection(
            indicators,
            indicators.price
        );


    // Strong technical direction wins.
    if (
        technicalDirection === "BULLISH"
    ) {

        return "BULLISH";

    }


    if (
        technicalDirection === "BEARISH"
    ) {

        return "BEARISH";

    }


    // Technical neutral:
    // only accept AI + trend if they agree.

    if (
        aiDirection !== "NEUTRAL" &&
        trendDirection !== "NEUTRAL"
    ) {

        if (
            aiDirection === trendDirection
        ) {

            return aiDirection;

        }

        return "NEUTRAL";

    }


    if (
        aiDirection !== "NEUTRAL"
    ) {

        return aiDirection;

    }


    if (
        trendDirection !== "NEUTRAL"
    ) {

        return trendDirection;

    }


    return "NEUTRAL";

}


// ============================================================
// INSTRUMENT KEY
// ============================================================

function resolveInstrumentKey(instrument) {

    if (
        typeof instrument === "string" &&
        instrument.trim()
    ) {

        return instrument.trim();

    }


    if (
        !instrument ||
        typeof instrument !== "object"
    ) {

        return null;

    }


    const candidates = [

        instrument.instrumentKey,
        instrument.instrument_key,

        instrument.instrumentToken,
        instrument.instrument_token,

        instrument.exchangeToken,
        instrument.exchange_token,

        instrument.token,

        instrument.key,

        instrument.instrumentId,
        instrument.instrument_id,

        instrument.symbol,
        instrument.tradingsymbol,
        instrument.tradingSymbol

    ];


    for (
        const candidate of candidates
    ) {

        if (
            candidate !== null &&
            candidate !== undefined &&
            String(candidate).trim()
        ) {

            return String(candidate).trim();

        }

    }


    return null;

}


// ============================================================
// CANDLE VALIDATION
// ============================================================

function getLatestValidCandle(candles) {

    if (
        !Array.isArray(candles) ||
        candles.length === 0
    ) {

        return null;

    }


    for (
        let i = candles.length - 1;
        i >= 0;
        i--
    ) {

        const candle =
            candles[i];


        if (
            candle &&
            typeof candle === "object"
        ) {

            const close =
                toNumber(
                    candle.close,
                    NaN
                );


            if (
                Number.isFinite(close) &&
                close > 0
            ) {

                return candle;

            }

        }

    }


    return null;

}


function validateCandles(candles) {

    if (
        !Array.isArray(candles)
    ) {

        return false;

    }


    if (
        candles.length < 220
    ) {

        return false;

    }


    return candles.every(
        candle => {

            if (
                !candle ||
                typeof candle !== "object"
            ) {

                return false;

            }


            const high =
                Number(candle.high);

            const low =
                Number(candle.low);

            const close =
                Number(candle.close);


            return (
                Number.isFinite(high) &&
                Number.isFinite(low) &&
                Number.isFinite(close) &&
                high >= low &&
                close > 0
            );

        }
    );

}


// ============================================================
// SCORE NORMALIZATION
// ============================================================

function extractScoreData(
    scoreData,
    latestPrice
) {

    const data =
        safeObject(
            scoreData
        );


    const score =
        clampScore(
            data.score ??
            data.aiScore
        );


    const finalScore =
        clampScore(
            data.finalScore ??
            data.aiFinalScore ??
            score
        );


    const bullishScore =
        clampScore(
            data.bullishScore ??
            data.bullScore ??
            data.callScore
        );


    const bearishScore =
        clampScore(
            data.bearishScore ??
            data.bearScore ??
            data.putScore
        );


    return {

        score,

        finalScore,

        bullishScore,

        bearishScore,

        rating:
            data.rating ||
            "N/A",

        signal:
            data.signal ||
            data.direction ||
            "NO SIGNAL",

        price:
            latestPrice

    };

}


// ============================================================
// BUILD STOCK ANALYSIS
// ============================================================

function buildStockAnalysis({

    stockSymbol,
    instrumentKey,
    latestPrice,

    indicators,
    scoreData,

    trade,
    sr,
    breakout,
    mtf,
    pivot,
    cpr,

    stockDirection,
    technicalDirection

}) {

    const macd =
        getMACDValues(
            indicators
        );


    const adx =
        safeObject(
            indicators.adx
        );


    return {

        // ====================================================
        // IDENTITY
        // ====================================================

        stock:
            stockSymbol,

        symbol:
            stockSymbol,

        tradingSymbol:
            stockSymbol,

        instrumentKey,


        // ====================================================
        // PRICE
        // ====================================================

        price:
            latestPrice,


        // ====================================================
        // DIRECTION
        // ====================================================

        direction:
            stockDirection,

        stockDirection,

        technicalDirection,

        isBullish:
            stockDirection === "BULLISH",

        isBearish:
            stockDirection === "BEARISH",


        // ====================================================
        // AI
        // ====================================================

        score:
            scoreData.score,

        scannerScore:
            scoreData.score,

        aiScore:
            scoreData.score,

        aiRating:
            scoreData.rating,

        signal:
            scoreData.signal,

        bullishScore:
            scoreData.bullishScore,

        bearishScore:
            scoreData.bearishScore,

        callScore:
            scoreData.bullishScore,

        putScore:
            scoreData.bearishScore,

        aiFinalScore:
            scoreData.finalScore,


        // ====================================================
        // STOCK SETUP
        // ====================================================

        entry:
            toNumber(
                trade.entry
            ),

        stopLoss:
            toNumber(
                trade.stopLoss
            ),

        target1:
            toNumber(
                trade.target1
            ),

        target2:
            toNumber(
                trade.target2
            ),

        risk:
            toNumber(
                trade.risk
            ),

        reward:
            toNumber(
                trade.reward
            ),

        riskReward:
            toNumber(
                trade.riskReward
            ),

        trend:
            trade.trend || "",

        confidence:
            clampScore(
                trade.confidence
            ),


        // ====================================================
        // SUPPORT / RESISTANCE
        // ====================================================

        support1:
            toNumber(sr.support1),

        support2:
            toNumber(sr.support2),

        support3:
            toNumber(sr.support3),

        resistance1:
            toNumber(sr.resistance1),

        resistance2:
            toNumber(sr.resistance2),

        resistance3:
            toNumber(sr.resistance3),


        // ====================================================
        // BREAKOUT
        // ====================================================

        breakout:
            safeBoolean(
                breakout.breakout
            ),

        breakoutType:
            breakout.breakoutType || "",

        breakoutStrength:
            breakout.breakoutStrength || "",

        breakoutScore:
            toNumber(
                breakout.breakoutScore
            ),

        aboveResistance:
            safeBoolean(
                breakout.aboveResistance
            ),

        belowSupport:
            safeBoolean(
                breakout.belowSupport
            ),

        nearResistance:
            safeBoolean(
                breakout.nearResistance
            ),

        nearSupport:
            safeBoolean(
                breakout.nearSupport
            ),

        volumeConfirmed:
            safeBoolean(
                breakout.volumeConfirmed
            ),

        trendConfirmed:
            safeBoolean(
                breakout.trendConfirmed
            ),

        momentumConfirmed:
            safeBoolean(
                breakout.momentumConfirmed
            ),


        // ====================================================
        // MTF
        // ====================================================

        dailyTrend:
            mtf.dailyTrend || "",

        fourHourTrend:
            mtf.fourHourTrend || "",

        oneHourTrend:
            mtf.oneHourTrend || "",

        fifteenMinTrend:
            mtf.fifteenMinTrend || "",

        mtfScore:
            toNumber(
                mtf.mtfScore
            ),

        mtfAlignment:
            toNumber(
                mtf.mtfAlignment
            ),

        mtfAlignedTimeframes:
            toNumber(
                mtf.alignedTimeframes
            ),


        // ====================================================
        // PIVOT
        // ====================================================

        pivot:
            toNumber(
                pivot.pivot
            ),

        pivotR1:
            toNumber(pivot.r1),

        pivotR2:
            toNumber(pivot.r2),

        pivotR3:
            toNumber(pivot.r3),

        pivotS1:
            toNumber(pivot.s1),

        pivotS2:
            toNumber(pivot.s2),

        pivotS3:
            toNumber(pivot.s3),


        // ====================================================
        // CPR
        // ====================================================

        cprTop:
            toNumber(cpr.top),

        cprBottom:
            toNumber(cpr.bottom),

        cprWidth:
            toNumber(cpr.width),

        cprType:
            cpr.type || "",


        // ====================================================
        // EMA
        // ====================================================

        ema5:
            toNumber(indicators.ema5),

        ema9:
            toNumber(indicators.ema9),

        ema20:
            toNumber(indicators.ema20),

        ema50:
            toNumber(indicators.ema50),

        ema100:
            toNumber(indicators.ema100),

        ema200:
            toNumber(indicators.ema200),


        // ====================================================
        // MOMENTUM
        // ====================================================

        rsi:
            toNumber(indicators.rsi),

        macd:
            macd.macd,

        macdSignal:
            macd.signal,

        histogram:
            macd.histogram,


        // ====================================================
        // ADX
        // ====================================================

        adx:
            toNumber(adx.adx),

        pdi:
            toNumber(adx.pdi),

        mdi:
            toNumber(adx.mdi),


        // ====================================================
        // VOLATILITY
        // ====================================================

        atr:
            toNumber(indicators.atr),


        // ====================================================
        // BOLLINGER
        // ====================================================

        bollingerUpper:
            toNumber(
                indicators.bollinger?.upper
            ),

        bollingerMiddle:
            toNumber(
                indicators.bollinger?.middle
            ),

        bollingerLower:
            toNumber(
                indicators.bollinger?.lower
            ),


        // ====================================================
        // VOLUME
        // ====================================================

        volume:
            toNumber(
                indicators.volume
            ),

        volumeSMA20:
            toNumber(
                indicators.volumeSMA20
            ),

        rvol:
            toNumber(
                indicators.rvol
            ),

        volumeSpike:
            safeBoolean(
                indicators.volumeSpike
            ),


        // ====================================================
        // OTHER INDICATORS
        // ====================================================

        obv:
            toNumber(
                indicators.obv
            ),

        mfi:
            toNumber(
                indicators.mfi
            ),

        supertrend:
            indicators.supertrend?.trend ??
            indicators.supertrend ??
            "",

        vwap:
            toNumber(
                indicators.vwap
            )

    };

}


// ============================================================
// SCAN ONE STOCK
// ============================================================

async function scanStock(stock) {

    let stockSymbol = "";


    try {

        // ====================================================
        // 1. STOCK SYMBOL
        // ====================================================

        if (
            stock === null ||
            stock === undefined
        ) {

            throw new Error(
                "Invalid stock symbol"
            );

        }


        if (
            typeof stock === "object" &&
            !Array.isArray(stock)
        ) {

            stockSymbol =
                String(
                    stock.symbol ||
                    stock.tradingSymbol ||
                    stock.tradingsymbol ||
                    stock.name ||
                    ""
                ).trim();

        } else {

            stockSymbol =
                String(stock).trim();

        }


        if (!stockSymbol) {

            throw new Error(
                "Empty stock symbol"
            );

        }


        // ====================================================
        // 2. INSTRUMENT
        // ====================================================

        if (
            typeof getInstrument !== "function"
        ) {

            throw new Error(
                "Broker adapter does not expose getInstrument()"
            );

        }


        const instrument =
            await getInstrument(
                stockSymbol
            );


        if (!instrument) {

            throw new Error(
                `Instrument not found: ${stockSymbol}`
            );

        }


        const instrumentKey =
            resolveInstrumentKey(
                instrument
            );


        if (!instrumentKey) {

            throw new Error(
                `Instrument key missing: ${stockSymbol}`
            );

        }


        // ====================================================
        // 3. DAILY CANDLES
        // ====================================================

        if (
            typeof getHistoricalData !== "function"
        ) {

            throw new Error(
                "Broker adapter does not expose getHistoricalData()"
            );

        }


        const candles =
            await getHistoricalData(
                instrumentKey,
                "ONE_DAY"
            );


        if (
            !validateCandles(candles)
        ) {

            throw new Error(
                `Invalid/insufficient daily candles: ${
                    Array.isArray(candles)
                        ? candles.length
                        : 0
                }`
            );

        }


        // ====================================================
        // 4. PRICE
        // ====================================================

        const latestCandle =
            getLatestValidCandle(
                candles
            );


        if (!latestCandle) {

            throw new Error(
                "Latest valid candle unavailable"
            );

        }


        const latestPrice =
            toNumber(
                latestCandle.close,
                NaN
            );


        if (
            !Number.isFinite(latestPrice) ||
            latestPrice <= 0
        ) {

            throw new Error(
                "Invalid latest price"
            );

        }


        // ====================================================
        // 5. INDICATORS
        // ====================================================

        const indicators =
            safeObject(
                calculateIndicators(
                    candles
                )
            );


        // ====================================================
        // 6. AI SCORE
        // ====================================================

        const scoreData =
            extractScoreData(

                calculateScore({

                    price:
                        latestPrice,

                    ...indicators

                }),

                latestPrice

            );


        // ====================================================
        // 7. STOCK SETUP
        // ====================================================

        let trade = {};


        try {

            if (
                typeof calculateTradeSetup ===
                "function"
            ) {

                trade =
                    safeObject(
                        calculateTradeSetup(
                            latestPrice,
                            indicators
                        )
                    );

            }

        } catch (error) {

            console.log(
                `⚠️ ${stockSymbol}: trade setup unavailable | ${
                    error?.message || error
                }`
            );

        }


        // ====================================================
        // 8. SUPPORT / RESISTANCE
        // ====================================================

        const sr =
            safeObject(
                calculateSupportResistance(
                    candles
                )
            );


        // ====================================================
        // 9. BREAKOUT
        // ====================================================

        const breakout =
            safeObject(
                calculateBreakout(
                    candles,
                    indicators,
                    sr
                )
            );


        // ====================================================
        // 10. MTF
        // ====================================================

        let mtf = {};


        try {

            mtf =
                safeObject(
                    await getMultiTimeframeAnalysis(
                        stockSymbol
                    )
                );

        } catch (error) {

            console.log(
                `⚠️ ${stockSymbol}: MTF unavailable | ${
                    error?.message || error
                }`
            );

        }


        // ====================================================
        // 11. PIVOT
        // ====================================================

        const pivot =
            safeObject(
                calculatePivotPoints(
                    candles
                )
            );


        // ====================================================
        // 12. CPR
        // ====================================================

        const cpr =
            safeObject(
                calculateCPR(
                    candles
                )
            );


        // ====================================================
        // 13. DIRECTION
        // ====================================================

        const directionIndicators = {

            ...indicators,

            price:
                latestPrice

        };


        const technicalDirection =
            determineTechnicalDirection(
                directionIndicators,
                latestPrice
            );


        const stockDirection =
            determineStockDirection(

                scoreData.signal,

                trade.trend,

                directionIndicators

            );


        // ====================================================
        // 14. BUILD STOCK ANALYSIS
        // ====================================================

        const stockAnalysis =
            buildStockAnalysis({

                stockSymbol,
                instrumentKey,
                latestPrice,

                indicators,
                scoreData,

                trade,
                sr,
                breakout,
                mtf,
                pivot,
                cpr,

                stockDirection,
                technicalDirection

            });


        // ====================================================
        // 15. FINAL RANKING
        // ====================================================

        let ranking = {};


        try {

            ranking =
                safeObject(
                    calculateFinalRank(
                        stockAnalysis
                    )
                );

        } catch (error) {

            console.log(
                `⚠️ ${stockSymbol}: ranking unavailable | ${
                    error?.message || error
                }`
            );

        }


        const finalScore =
            clampScore(

                ranking.finalScore ??
                ranking.score ??
                stockAnalysis.score

            );


        stockAnalysis.finalScore =
            finalScore;


        stockAnalysis.rating =
            ranking.rating ||
            "❌ AVOID";


        // Keep ranking object because downstream
        // Google Sheet / diagnostics may use it.
        stockAnalysis.ranking =
            ranking;


        stockAnalysis.rankingScore =
            finalScore;


        // ====================================================
        // IMPORTANT: 85+ QUALIFICATION
        // ====================================================

        stockAnalysis.is85Plus =
            finalScore >= DASHBOARD_MIN_SCORE;


        // ====================================================
        // 90+ IS NO LONGER THE PRIMARY FLAG
        // ====================================================
        // Kept only for backward compatibility with old code.
        // Dashboard should use is85Plus / threshold 85.
        // ====================================================

        stockAnalysis.is90Plus =
            finalScore >= 90;


        // ====================================================
        // 16. OPTIONS DECISION
        // ====================================================
        // Scanner does NOT decide CALL/PUT.
        // ====================================================

        let optionsDecision = null;


        try {

            optionsDecision =
                await calculateOptionsDecision(
                    stockAnalysis
                );

        } catch (error) {

            console.log(
                `⚠️ ${stockSymbol}: options decision failed | ${
                    error?.message || error
                }`
            );

        }


        // ====================================================
        // 17. FINAL RESULT
        // ====================================================

        if (!optionsDecision) {

            return stockAnalysis;

        }


        return {

            ...stockAnalysis,

            ...safeObject(
                optionsDecision
            )

        };

    }


    catch (error) {

        console.log(
            `❌ ${stockSymbol || stock}: ${
                error?.message || error
            }`
        );

        return null;

    }

}


// ============================================================
// SCAN MULTIPLE STOCKS
// ============================================================

async function scanStocks(stocks) {

    if (
        !Array.isArray(stocks)
    ) {

        return [];

    }


    const results = [];


    for (
        const stock of stocks
    ) {

        try {

            const result =
                await scanStock(
                    stock
                );


            if (result) {

                results.push(
                    result
                );

            }

        } catch (error) {

            console.log(
                `⚠️ Stock scan failed: ${
                    stock
                } | ${
                    error?.message || error
                }`
            );

        }

    }


    return results;

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    scanStock,

    scanStocks,

    normalizeDirection,

    determineTechnicalDirection,

    determineStockDirection,

    DASHBOARD_MIN_SCORE

};