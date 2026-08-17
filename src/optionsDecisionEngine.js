// ============================================================
// OPTIONS DECISION ENGINE — BALANCED V8
// ============================================================
//
// PURPOSE
// ------------------------------------------------------------
// Scanner
//    ↓
// Direction Evidence
//    ↓
// CALL / PUT / NO DIRECTION
//    ↓
// MTF Confirmation
//    ↓
// Stock Entry / SL / T1 / T2
//    ↓
// Risk / Reward
//    ↓
// Independent Quality Scores
//    ↓
// Confidence
//    ↓
// Real Option Contract
//    ↓
// Real Option LTP
//    ↓
// TRADE / WATCH / REJECT
//
// IMPORTANT
// ------------------------------------------------------------
// 1. Never force CALL.
// 2. Never force PUT.
// 3. Weak directional edge = NO DIRECTION.
// 4. Bullish and bearish scoring are symmetrical.
// 5. Missing 4H does NOT automatically kill a setup.
// 6. MTF confirmation is required for TRADE.
// 7. Real option contract only.
// 8. Real option LTP only.
// 9. No invented option symbol.
// 10. No invented option price.
// 11. Confidence is based on REAL evidence.
// 12. R:R cannot rescue weak direction.
// 13. Scanner remains broker independent.
// ============================================================

const broker = require("./brokers");


// ============================================================
// CONFIG
// ============================================================

const ENGINE_CONFIG = Object.freeze({

    // --------------------------------------------------------
    // Direction
    // --------------------------------------------------------

    MIN_DIRECTION_SCORE: 35,
    MIN_DIRECTION_DIFFERENCE: 10,

    // Minimum independent evidence
    MIN_DIRECTION_EVIDENCE: 3,

    // Strong direction
    STRONG_DIRECTION_DIFFERENCE: 16,


    // --------------------------------------------------------
    // TRADE
    // --------------------------------------------------------

    TRADE_CONFIDENCE: 82,
    TRADE_SCANNER_SCORE: 70,

    TRADE_DIRECTION_DIFFERENCE: 14,

    TRADE_MTF_ALIGNMENT: 3,

    TRADE_RR: 1.50,

    TRADE_MOMENTUM: 65,

    TRADE_TREND: 65,


    // --------------------------------------------------------
    // WATCH
    // --------------------------------------------------------

    WATCH_CONFIDENCE: 65,

    WATCH_SCANNER_SCORE: 55,

    WATCH_DIRECTION_DIFFERENCE: 10,

    WATCH_MTF_ALIGNMENT: 2,

    WATCH_RR: 1.20,


    // --------------------------------------------------------
    // Contract
    // --------------------------------------------------------

    MIN_EXPIRY_DAYS: 7,


    // --------------------------------------------------------
    // Risk
    // --------------------------------------------------------

    DEFAULT_ATR_MULTIPLIER: 1.0,


    // --------------------------------------------------------
    // Confidence weights
    //
    // Direction + MTF are deliberately dominant.
    // R:R cannot overpower direction.
    // --------------------------------------------------------

    CONFIDENCE_WEIGHTS: Object.freeze({

        scanner: 0.20,

        direction: 0.25,

        mtf: 0.15,

        trend: 0.12,

        momentum: 0.12,

        volume: 0.06,

        breakout: 0.04,

        rr: 0.06

    })

});


// ============================================================
// HELPERS
// ============================================================

function toNumber(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;

}


function clamp(value, min = 0, max = 100) {

    return Math.max(
        min,
        Math.min(
            max,
            toNumber(value)
        )
    );

}


function text(value) {

    return String(
        value ?? ""
    )
        .trim()
        .toUpperCase();

}


function isTrue(value) {

    if (value === true) {
        return true;
    }

    return (
        text(value) === "TRUE" ||
        text(value) === "YES" ||
        text(value) === "1"
    );

}


function firstPositive(...values) {

    for (const value of values) {

        const n = Number(value);

        if (
            Number.isFinite(n) &&
            n > 0
        ) {
            return n;
        }

    }

    return 0;

}


function uniqueSortedLevels(levels) {

    return [
        ...new Set(

            levels
                .map(Number)
                .filter(
                    v =>
                        Number.isFinite(v) &&
                        v > 0
                )
                .map(
                    v =>
                        Number(
                            v.toFixed(2)
                        )
                )

        )
    ];

}


// ============================================================
// STRIKE
// ============================================================

function getStrikeInterval(price) {

    price = Number(price);

    if (price < 500) {
        return 10;
    }

    if (price < 1000) {
        return 20;
    }

    if (price < 2000) {
        return 50;
    }

    return 100;

}


function getRecommendedStrike(
    price,
    optionType
) {

    const interval =
        getStrikeInterval(price);

    let strike =
        Math.round(
            Number(price) / interval
        ) * interval;


    // Slightly ITM
    if (optionType === "CALL") {

        strike -= interval;

    }
    else if (optionType === "PUT") {

        strike += interval;

    }


    return {

        strike,

        interval

    };

}


// ============================================================
// OPTION CONTRACT NORMALIZATION
// ============================================================

function normalizeOptionContract(
    contract,
    fallbackStrike
) {

    if (
        !contract ||
        typeof contract !== "object"
    ) {
        return null;
    }


    const instrumentKey =

        contract.instrumentKey ??
        contract.instrument_key ??
        contract.instrument_token ??
        contract.instrumentToken ??
        contract.exchange_token ??
        contract.exchangeToken ??
        null;


    const tradingSymbol =

        contract.tradingSymbol ??
        contract.trading_symbol ??
        contract.symbol ??
        contract.name ??
        null;


    const strike = Number(

        contract.strike ??
        contract.strikePrice ??
        contract.strike_price ??
        contract.strike_price_value ??
        fallbackStrike

    );


    const expiry =

        contract.expiry ??
        contract.expiryDate ??
        contract.expiry_date ??
        contract.expiry_date_time ??
        null;


    const expiryDays = Number(

        contract.expiryDays ??
        contract.expiry_days ??
        contract.daysToExpiry ??
        0

    );


    const optionType = text(

        contract.optionType ??
        contract.option_type ??
        contract.instrumentType ??
        ""

    );


    const lotSize =

        contract.lotSize ??
        contract.lot_size ??
        contract.lotsize ??
        null;


    const tickSize =

        contract.tickSize ??
        contract.tick_size ??
        null;


    if (
        !instrumentKey &&
        !tradingSymbol
    ) {
        return null;
    }


    if (
        !Number.isFinite(strike) ||
        strike <= 0
    ) {
        return null;
    }


    return {

        ...contract,

        instrumentKey,

        tradingSymbol,

        strike,

        expiry,

        expiryDays,

        optionType,

        lotSize,

        tickSize

    };

}


// ============================================================
// OPTION CONTRACT LOOKUP
// ============================================================

async function tryOptionContract(
    symbol,
    optionType,
    strike
) {

    if (
        !symbol ||
        !optionType
    ) {
        return null;
    }


    const numericStrike =
        Number(strike);


    if (
        !Number.isFinite(numericStrike) ||
        numericStrike <= 0
    ) {
        return null;
    }


    try {

        const contract =
            await broker.getOptionContract(

                symbol,

                numericStrike,

                optionType,

                ENGINE_CONFIG.MIN_EXPIRY_DAYS

            );


        return normalizeOptionContract(
            contract,
            numericStrike
        );

    }
    catch (error) {

        return null;

    }

}


// ============================================================
// DIRECT CONTRACT SEARCH
// ============================================================

async function searchContractsDirectly(
    symbol,
    optionType,
    requestedStrike
) {

    try {

        if (
            typeof broker.getOptionContracts !==
            "function"
        ) {

            return null;

        }


        const contracts =
            await broker.getOptionContracts(
                symbol
            );


        if (!Array.isArray(contracts)) {

            return null;

        }


        const normalized =
            contracts
                .map(
                    contract =>
                        normalizeOptionContract(
                            contract,
                            requestedStrike
                        )
                )
                .filter(Boolean);


        const wantedType =
            text(optionType);


        const typeFiltered =
            normalized.filter(
                contract => {

                    const type =
                        text(
                            contract.optionType
                        );


                    if (!type) {
                        return true;
                    }


                    if (
                        wantedType === "CALL"
                    ) {

                        return (
                            type === "CALL" ||
                            type === "CE"
                        );

                    }


                    if (
                        wantedType === "PUT"
                    ) {

                        return (
                            type === "PUT" ||
                            type === "PE"
                        );

                    }


                    return false;

                }
            );


        const pool =
            typeFiltered.length > 0
                ? typeFiltered
                : normalized;


        if (
            pool.length === 0
        ) {

            return null;

        }


        pool.sort(

            (a, b) =>

                Math.abs(
                    Number(a.strike) -
                    Number(requestedStrike)
                )

                -

                Math.abs(
                    Number(b.strike) -
                    Number(requestedStrike)
                )

        );


        return pool[0] || null;

    }
    catch (error) {

        console.log(

            `⚠️ Direct option search failed: ` +
            `${symbol} | ${optionType} | ` +
            `${requestedStrike} | ${error.message}`

        );

        return null;

    }

}


// ============================================================
// STRIKE SEARCH
// ============================================================

function buildStrikeSearchList(
    recommendedStrike,
    interval
) {

    const base =
        Number(recommendedStrike);

    const step =
        Number(interval);


    if (
        !Number.isFinite(base) ||
        !Number.isFinite(step) ||
        step <= 0
    ) {

        return [];

    }


    const strikes = [base];


    for (
        let distance = 1;
        distance <= 8;
        distance++
    ) {

        const lower =
            base -
            step * distance;

        const upper =
            base +
            step * distance;


        if (lower > 0) {

            strikes.push(lower);

        }


        strikes.push(upper);

    }


    return strikes;

}


// ============================================================
// RESOLVE CONTRACT
// ============================================================

async function resolveOptionContract(
    symbol,
    optionType,
    recommendedStrike,
    strikeInterval
) {

    if (
        !symbol ||
        !optionType
    ) {

        return null;

    }


    const requestedStrike =
        Number(recommendedStrike);


    if (
        !Number.isFinite(
            requestedStrike
        )
    ) {

        return null;

    }


    const interval =
        Number(strikeInterval) > 0
            ? Number(strikeInterval)
            : getStrikeInterval(
                requestedStrike
            );


    const searchStrikes =
        buildStrikeSearchList(
            requestedStrike,
            interval
        );


    let bestContract = null;

    let bestDistance =
        Infinity;


    for (
        const strike
        of searchStrikes
    ) {

        const contract =
            await tryOptionContract(

                symbol,

                optionType,

                strike

            );


        if (!contract) {
            continue;
        }


        const actualStrike =
            Number(
                contract.strike
            );


        if (
            !Number.isFinite(
                actualStrike
            )
        ) {

            continue;

        }


        const distance =
            Math.abs(
                actualStrike -
                requestedStrike
            );


        if (
            distance <
            bestDistance
        ) {

            bestContract =
                contract;

            bestDistance =
                distance;

        }


        if (
            distance === 0
        ) {

            break;

        }

    }


    if (!bestContract) {

        bestContract =
            await searchContractsDirectly(

                symbol,

                optionType,

                requestedStrike

            );

    }


    return bestContract;

}


// ============================================================
// OPTION QUOTE
// ============================================================

async function resolveOptionQuote(
    instrumentKey
) {

    if (!instrumentKey) {

        return null;

    }


    try {

        if (
            typeof broker.getOptionQuote !==
            "function"
        ) {

            return null;

        }


        const quote =
            await broker.getOptionQuote(
                instrumentKey
            );


        if (!quote) {

            return null;

        }


        const ltp =
            Number(

                quote.ltp ??
                quote.lastPrice ??
                quote.last_price ??
                quote.close

            );


        if (
            !Number.isFinite(ltp) ||
            ltp <= 0
        ) {

            return null;

        }


        return {

            ...quote,

            ltp

        };

    }
    catch (error) {

        console.log(

            `⚠️ Option quote failed: ` +
            `${instrumentKey} | ${error.message}`

        );

        return null;

    }

}


// ============================================================
// OPTION TRADE SETUP
// ============================================================
//
// NOTE:
// Direction of the underlying is already established.
// For both CE and PE, option premium itself is bought.
// Therefore premium SL/targets remain LONG OPTION logic.
// ============================================================

function calculateOptionTradeSetup(
    optionType,
    optionLTP,
    stockData,
    stockRiskReward
) {

    const premium =
        Number(optionLTP);


    if (
        !Number.isFinite(premium) ||
        premium <= 0
    ) {

        return null;

    }


    const optionRisk =
        premium * 0.20;


    const entry =
        premium;


    const stopLoss =
        entry -
        optionRisk;


    const target1 =
        entry +
        optionRisk;


    const target2 =
        entry +
        optionRisk * 2;


    const risk =
        entry -
        stopLoss;


    const reward =
        target2 -
        entry;


    const riskReward =
        risk > 0
            ? reward / risk
            : 0;


    return {

        optionType,

        optionEntry:
            Number(
                entry.toFixed(2)
            ),

        optionStopLoss:
            Number(
                stopLoss.toFixed(2)
            ),

        optionTarget1:
            Number(
                target1.toFixed(2)
            ),

        optionTarget2:
            Number(
                target2.toFixed(2)
            ),

        optionRisk:
            Number(
                optionRisk.toFixed(2)
            ),

        optionReward:
            Number(
                reward.toFixed(2)
            ),

        optionRiskReward:
            Number(
                riskReward.toFixed(2)
            ),

        stockRiskReward:
            Number(
                Number(
                    stockRiskReward || 0
                ).toFixed(2)
            )

    };

}


// ============================================================
// OI LEVELS
// ============================================================

function getOISupportResistance(
    stockData
) {

    const oiSupport1 =
        firstPositive(

            stockData.oiSupport1,
            stockData.oi_support1,
            stockData.putOISupport,
            stockData.putOiSupport,
            stockData.putOILevel,
            stockData.putOiLevel,
            stockData.maxPutOI,
            stockData.maxPutOi

        );


    const oiSupport2 =
        firstPositive(

            stockData.oiSupport2,
            stockData.oi_support2,
            stockData.oiSupport,
            stockData.oi_support,
            stockData.putOISupport2,
            stockData.putOiSupport2

        );


    const oiResistance1 =
        firstPositive(

            stockData.oiResistance1,
            stockData.oi_resistance1,
            stockData.callOIResistance,
            stockData.callOiResistance,
            stockData.callOILevel,
            stockData.callOiLevel,
            stockData.maxCallOI,
            stockData.maxCallOi

        );


    const oiResistance2 =
        firstPositive(

            stockData.oiResistance2,
            stockData.oi_resistance2,
            stockData.oiResistance,
            stockData.oi_resistance,
            stockData.callOIResistance2,
            stockData.callOiResistance2

        );


    const maxPain =
        firstPositive(

            stockData.maxPain,
            stockData.max_pain,
            stockData.optionMaxPain,
            stockData.option_max_pain

        );


    return {

        oiSupport1,
        oiSupport2,
        oiResistance1,
        oiResistance2,
        maxPain

    };

}


// ============================================================
// COMBINED LEVELS
// ============================================================

function buildCombinedLevels(
    stockData
) {

    const support1 =
        firstPositive(
            stockData.support1
        );


    const support2 =
        firstPositive(
            stockData.support2
        );


    const resistance1 =
        firstPositive(
            stockData.resistance1
        );


    const resistance2 =
        firstPositive(
            stockData.resistance2
        );


    const pivotS1 =
        firstPositive(
            stockData.pivotS1
        );


    const pivotS2 =
        firstPositive(
            stockData.pivotS2
        );


    const pivotR1 =
        firstPositive(
            stockData.pivotR1
        );


    const pivotR2 =
        firstPositive(
            stockData.pivotR2
        );


    const oi =
        getOISupportResistance(
            stockData
        );


    const supports =
        uniqueSortedLevels([

            support1,
            support2,
            pivotS1,
            pivotS2,
            oi.oiSupport1,
            oi.oiSupport2

        ]);


    const resistances =
        uniqueSortedLevels([

            resistance1,
            resistance2,
            pivotR1,
            pivotR2,
            oi.oiResistance1,
            oi.oiResistance2

        ]);


    return {

        technical: {

            support1,
            support2,
            resistance1,
            resistance2,
            pivotS1,
            pivotS2,
            pivotR1,
            pivotR2

        },

        oi,

        supports,

        resistances

    };

}


// ============================================================
// DIRECTION ENGINE V8
// ============================================================
//
// Major correction:
// ------------------------------------------------------------
// The previous engine converted raw indicator values directly
// into direction points and then treated the resulting
// difference as "quality".
//
// V8 separates:
//   1. directional score
//   2. evidence count
//   3. directional difference
//
// 4H is informational when unavailable.
// Daily / 1H / 15M are the core MTF direction signals.
// ============================================================

function calculateDirection(
    stockData,
    price
) {

    const trend =
        text(stockData.trend);

    const signal =
        text(stockData.signal);

    const dailyTrend =
        text(stockData.dailyTrend);

    const fourHourTrend =
        text(stockData.fourHourTrend);

    const oneHourTrend =
        text(stockData.oneHourTrend);

    const fifteenMinTrend =
        text(stockData.fifteenMinTrend);


    const ema5 =
        toNumber(stockData.ema5);

    const ema9 =
        toNumber(stockData.ema9);

    const ema20 =
        toNumber(stockData.ema20);

    const ema50 =
        toNumber(stockData.ema50);

    const rsi =
        toNumber(stockData.rsi);

    const adx =
        toNumber(stockData.adx);

    const pdi =
        toNumber(stockData.pdi);

    const mdi =
        toNumber(stockData.mdi);

    const macd =
        toNumber(stockData.macd);

    const macdSignal =
        toNumber(stockData.macdSignal);

    const histogram =
        toNumber(stockData.histogram);

    const vwap =
        toNumber(stockData.vwap);

    const supertrend =
        text(stockData.supertrend);


    let callScore = 0;

    let putScore = 0;

    let callEvidence = 0;

    let putEvidence = 0;


    // ========================================================
    // MTF CORE
    // ========================================================

    if (
        dailyTrend.includes("BULL")
    ) {

        callScore += 12;
        callEvidence++;

    }
    else if (
        dailyTrend.includes("BEAR")
    ) {

        putScore += 12;
        putEvidence++;

    }


    if (
        oneHourTrend.includes("BULL")
    ) {

        callScore += 14;
        callEvidence++;

    }
    else if (
        oneHourTrend.includes("BEAR")
    ) {

        putScore += 14;
        putEvidence++;

    }


    if (
        fifteenMinTrend.includes("BULL")
    ) {

        callScore += 10;
        callEvidence++;

    }
    else if (
        fifteenMinTrend.includes("BEAR")
    ) {

        putScore += 10;
        putEvidence++;

    }


    // 4H only contributes if actually available.
    if (
        fourHourTrend.includes("BULL")
    ) {

        callScore += 8;
        callEvidence++;

    }
    else if (
        fourHourTrend.includes("BEAR")
    ) {

        putScore += 8;
        putEvidence++;

    }


    // ========================================================
    // EMA STRUCTURE
    // ========================================================

    if (
        ema5 > 0 &&
        ema9 > 0 &&
        ema20 > 0 &&
        ema50 > 0
    ) {

        if (
            ema5 > ema9 &&
            ema9 > ema20 &&
            ema20 > ema50
        ) {

            callScore += 12;
            callEvidence++;

        }
        else if (
            ema5 < ema9 &&
            ema9 < ema20 &&
            ema20 < ema50
        ) {

            putScore += 12;
            putEvidence++;

        }

    }


    // ========================================================
    // PRICE VS EMA
    // ========================================================

    if (
        ema20 > 0 &&
        ema50 > 0
    ) {

        if (
            price > ema20 &&
            price > ema50
        ) {

            callScore += 7;
            callEvidence++;

        }
        else if (
            price < ema20 &&
            price < ema50
        ) {

            putScore += 7;
            putEvidence++;

        }

    }


    // ========================================================
    // RSI
    // ========================================================

    if (rsi > 0) {

        if (
            rsi >= 55 &&
            rsi <= 70
        ) {

            callScore += 8;
            callEvidence++;

        }
        else if (
            rsi >= 30 &&
            rsi <= 45
        ) {

            putScore += 8;
            putEvidence++;

        }

    }


    // ========================================================
    // MACD
    // ========================================================

    if (
        macd > macdSignal &&
        histogram > 0
    ) {

        callScore += 8;
        callEvidence++;

    }
    else if (
        macd < macdSignal &&
        histogram < 0
    ) {

        putScore += 8;
        putEvidence++;

    }


    // ========================================================
    // ADX + DI
    // ========================================================

    if (
        adx >= 20
    ) {

        if (
            pdi > mdi
        ) {

            callScore += 7;
            callEvidence++;

        }
        else if (
            mdi > pdi
        ) {

            putScore += 7;
            putEvidence++;

        }

    }


    // ========================================================
    // VWAP
    // ========================================================

    if (
        vwap > 0
    ) {

        if (
            price > vwap
        ) {

            callScore += 5;
            callEvidence++;

        }
        else if (
            price < vwap
        ) {

            putScore += 5;
            putEvidence++;

        }

    }


    // ========================================================
    // SUPERTREND
    // ========================================================

    if (

        supertrend.includes("BULL") ||
        supertrend.includes("BUY") ||
        supertrend.includes("UP")

    ) {

        callScore += 5;
        callEvidence++;

    }
    else if (

        supertrend.includes("BEAR") ||
        supertrend.includes("SELL") ||
        supertrend.includes("DOWN")

    ) {

        putScore += 5;
        putEvidence++;

    }


    // ========================================================
    // SCANNER SIGNAL
    // ========================================================

    if (
        signal.includes("BUY")
    ) {

        callScore += 5;
        callEvidence++;

    }
    else if (
        signal.includes("SELL")
    ) {

        putScore += 5;
        putEvidence++;

    }


    // ========================================================
    // GENERAL TREND
    // ========================================================

    if (
        trend.includes("BULL")
    ) {

        callScore += 3;
        callEvidence++;

    }
    else if (
        trend.includes("BEAR")
    ) {

        putScore += 3;
        putEvidence++;

    }


    // ========================================================
    // FINAL DIRECTION
    // ========================================================

    const directionDifference =
        Math.abs(
            callScore -
            putScore
        );


    const dominantScore =
        Math.max(
            callScore,
            putScore
        );


    const dominantEvidence =
        callScore > putScore
            ? callEvidence
            : putEvidence;


    let optionType = null;


    // CALL
    if (
        callScore > putScore &&
        callScore >=
            ENGINE_CONFIG.MIN_DIRECTION_SCORE &&
        directionDifference >=
            ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE &&
        callEvidence >=
            ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE
    ) {

        optionType = "CALL";

    }


    // PUT
    else if (
        putScore > callScore &&
        putScore >=
            ENGINE_CONFIG.MIN_DIRECTION_SCORE &&
        directionDifference >=
            ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE &&
        putEvidence >=
            ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE
    ) {

        optionType = "PUT";

    }


    return {

        optionType,

        callScore,

        putScore,

        directionDifference,

        callEvidence,

        putEvidence,

        dominantScore,

        dominantEvidence

    };

}


// ============================================================
// MTF
// ============================================================

function calculateMTF(
    optionType,
    stockData
) {

    const trends = [

        {
            name: "DAILY",
            value: text(stockData.dailyTrend),
            weight: 1
        },

        {
            name: "4H",
            value: text(stockData.fourHourTrend),
            weight: 1
        },

        {
            name: "1H",
            value: text(stockData.oneHourTrend),
            weight: 1
        },

        {
            name: "15M",
            value: text(stockData.fifteenMinTrend),
            weight: 1
        }

    ];


    let alignedTimeframes = 0;

    let availableTimeframes = 0;


    for (
        const item
        of trends
    ) {

        if (!item.value) {
            continue;
        }


        availableTimeframes++;


        if (
            optionType === "CALL" &&
            item.value.includes("BULL")
        ) {

            alignedTimeframes++;

        }


        if (
            optionType === "PUT" &&
            item.value.includes("BEAR")
        ) {

            alignedTimeframes++;

        }

    }


    let mtfScore = 0;


    if (
        availableTimeframes > 0
    ) {

        mtfScore =
            (
                alignedTimeframes /
                availableTimeframes
            ) *
            100;

    }


    // Scanner-provided score is used only if valid.
    const providedMTF =
        toNumber(
            stockData.mtfScore,
            0
        );


    if (
        providedMTF > 0
    ) {

        mtfScore =
            (
                mtfScore * 0.60
            ) +
            (
                clamp(providedMTF) * 0.40
            );

    }


    return {

        alignedTimeframes,

        availableTimeframes,

        mtfScore:
            clamp(mtfScore),

        mtfAligned:
            alignedTimeframes >=
            ENGINE_CONFIG.TRADE_MTF_ALIGNMENT

    };

}


// ============================================================
// CONFIRMATIONS
// ============================================================

function getConfirmations(
    stockData
) {

    return {

        breakoutConfirmed:
            isTrue(
                stockData.breakout
            ),

        volumeConfirmed:
            isTrue(
                stockData.volumeConfirmed
            ),

        trendConfirmed:
            isTrue(
                stockData.trendConfirmed
            ),

        momentumConfirmed:
            isTrue(
                stockData.momentumConfirmed
            )

    };

}


// ============================================================
// BREAKOUT SCORE
// ============================================================

function calculateBreakoutScore(
    confirmations
) {

    let score = 0;


    if (
        confirmations.breakoutConfirmed
    ) {

        score += 40;

    }


    if (
        confirmations.volumeConfirmed
    ) {

        score += 20;

    }


    if (
        confirmations.trendConfirmed
    ) {

        score += 20;

    }


    if (
        confirmations.momentumConfirmed
    ) {

        score += 20;

    }


    return clamp(score);

}


// ============================================================
// STOCK LEVELS
// ============================================================

function calculateStockLevels(
    optionType,
    price,
    stockData
) {

    const atr =
        toNumber(
            stockData.atr
        );


    const levels =
        buildCombinedLevels(
            stockData
        );


    const supports =
        levels.supports;


    const resistances =
        levels.resistances;


    let entry =
        toNumber(
            stockData.entry
        );


    if (
        entry <= 0
    ) {

        entry = price;

    }


    // ========================================================
    // CRITICAL:
    // Entry must match current stock price unless scanner
    // explicitly provides a valid directional entry.
    // ========================================================

    if (
        Math.abs(entry - price) >
        Math.max(
            price * 0.05,
            atr * 3
        )
    ) {

        entry = price;

    }


    let stopLoss =
        toNumber(
            stockData.stopLoss
        );


    // ========================================================
    // CALL STOP
    // ========================================================

    if (
        optionType === "CALL" &&
        (
            stopLoss <= 0 ||
            stopLoss >= entry
        )
    ) {

        const possibleStops = [

            ...supports,

            atr > 0
                ? entry - atr
                : 0

        ]
            .filter(
                level =>
                    level > 0 &&
                    level < entry
            );


        if (
            possibleStops.length > 0
        ) {

            stopLoss =
                Math.max(
                    ...possibleStops
                );

        }
        else {

            stopLoss =
                atr > 0
                    ? entry - atr
                    : entry * 0.98;

        }

    }


    // ========================================================
    // PUT STOP
    // ========================================================

    if (
        optionType === "PUT" &&
        (
            stopLoss <= 0 ||
            stopLoss <= entry
        )
    ) {

        const possibleStops = [

            ...resistances,

            atr > 0
                ? entry + atr
                : 0

        ]
            .filter(
                level =>
                    level > entry
            );


        if (
            possibleStops.length > 0
        ) {

            stopLoss =
                Math.min(
                    ...possibleStops
                );

        }
        else {

            stopLoss =
                atr > 0
                    ? entry + atr
                    : entry * 1.02;

        }

    }


    const risk =
        Math.abs(
            entry -
            stopLoss
        );


    if (
        !Number.isFinite(risk) ||
        risk <= 0
    ) {

        return null;

    }


    let target1 = 0;

    let target2 = 0;


    // ========================================================
    // CALL TARGETS
    // ========================================================

    if (
        optionType === "CALL"
    ) {

        const upside =
            resistances
                .filter(
                    level =>
                        level > entry
                )
                .sort(
                    (a, b) =>
                        a - b
                );


        target1 =
            upside[0] || 0;


        target2 =
            upside[1] || 0;


        if (
            target1 <= 0 ||
            target1 - entry < risk
        ) {

            target1 =
                entry + risk;

        }


        if (
            target2 <= target1
        ) {

            target2 =
                target1 + risk;

        }

    }


    // ========================================================
    // PUT TARGETS
    // ========================================================

    if (
        optionType === "PUT"
    ) {

        const downside =
            supports
                .filter(
                    level =>
                        level > 0 &&
                        level < entry
                )
                .sort(
                    (a, b) =>
                        b - a
                );


        target1 =
            downside[0] || 0;


        target2 =
            downside[1] || 0;


        if (
            target1 <= 0 ||
            entry - target1 < risk
        ) {

            target1 =
                entry - risk;

        }


        if (
            target2 <= 0 ||
            target2 >= target1
        ) {

            target2 =
                target1 - risk;

        }

    }


    const reward =
        Math.abs(
            target2 -
            entry
        );


    const riskReward =
        risk > 0
            ? reward / risk
            : 0;


    return {

        entry,

        stopLoss,

        risk,

        target1,

        target2,

        reward,

        riskReward,

        levels

    };

}


// ============================================================
// QUALITY SCORES V8
// ============================================================

function calculateQualityScores(
    optionType,
    stockData,
    direction,
    mtf,
    breakoutScore,
    riskReward
) {

    const rsi =
        toNumber(
            stockData.rsi
        );


    const adx =
        toNumber(
            stockData.adx
        );


    const rvol =
        toNumber(
            stockData.rvol
        );


    // ========================================================
    // DIRECTION QUALITY
    // ========================================================
    //
    // Difference alone is NOT enough.
    // Evidence count is included.
    // ========================================================

    const directionBase =
        clamp(
            direction.directionDifference *
            4
        );


    const evidenceBonus =
        clamp(
            direction.dominantEvidence *
            8
        );


    const directionQuality =
        clamp(
            directionBase +
            evidenceBonus
        );


    // ========================================================
    // TREND QUALITY
    // ========================================================

    let trendScore = 40;


    if (
        direction.dominantEvidence >= 5
    ) {

        trendScore += 25;

    }
    else if (
        direction.dominantEvidence >= 4
    ) {

        trendScore += 18;

    }
    else if (
        direction.dominantEvidence >= 3
    ) {

        trendScore += 10;

    }


    if (
        direction.directionDifference >=
        ENGINE_CONFIG.STRONG_DIRECTION_DIFFERENCE
    ) {

        trendScore += 10;

    }


    if (
        mtf.alignedTimeframes >= 3
    ) {

        trendScore += 15;

    }
    else if (
        mtf.alignedTimeframes >= 2
    ) {

        trendScore += 8;

    }


    trendScore =
        clamp(trendScore);


    // ========================================================
    // MOMENTUM
    // ========================================================

    let momentumScore = 45;


    if (
        optionType === "CALL"
    ) {

        if (
            rsi >= 55 &&
            rsi <= 68
        ) {

            momentumScore = 88;

        }
        else if (
            rsi > 50 &&
            rsi < 75
        ) {

            momentumScore = 72;

        }
        else if (
            rsi >= 45
        ) {

            momentumScore = 60;

        }

    }
    else {

        if (
            rsi >= 32 &&
            rsi <= 45
        ) {

            momentumScore = 88;

        }
        else if (
            rsi < 50 &&
            rsi > 25
        ) {

            momentumScore = 72;

        }
        else if (
            rsi <= 55
        ) {

            momentumScore = 60;

        }

    }


    if (
        adx >= 25
    ) {

        momentumScore += 8;

    }
    else if (
        adx >= 20
    ) {

        momentumScore += 4;

    }


    momentumScore =
        clamp(momentumScore);


    // ========================================================
    // VOLUME
    // ========================================================

    let volumeScore = 45;


    if (
        rvol >= 1.5
    ) {

        volumeScore = 100;

    }
    else if (
        rvol >= 1.25
    ) {

        volumeScore = 85;

    }
    else if (
        rvol >= 1.0
    ) {

        volumeScore = 70;

    }
    else if (
        rvol >= 0.8
    ) {

        volumeScore = 55;

    }


    // ========================================================
    // R:R
    // ========================================================

    let rrScore = 20;


    if (
        riskReward >= 3
    ) {

        rrScore = 100;

    }
    else if (
        riskReward >= 2
    ) {

        rrScore = 90;

    }
    else if (
        riskReward >= 1.5
    ) {

        rrScore = 80;

    }
    else if (
        riskReward >= 1.2
    ) {

        rrScore = 65;

    }
    else if (
        riskReward >= 1
    ) {

        rrScore = 50;

    }


    return {

        directionQuality,

        trendScore,

        momentumScore,

        volumeScore,

        rrScore,

        breakoutScore,

        mtfScore:
            mtf.mtfScore

    };

}


// ============================================================
// CONFIDENCE V8
// ============================================================

function calculateConfidence(
    scannerScore,
    quality
) {

    const W =
        ENGINE_CONFIG.CONFIDENCE_WEIGHTS;


    const confidence =

        scannerScore *
        W.scanner

        +

        quality.directionQuality *
        W.direction

        +

        quality.mtfScore *
        W.mtf

        +

        quality.trendScore *
        W.trend

        +

        quality.momentumScore *
        W.momentum

        +

        quality.volumeScore *
        W.volume

        +

        quality.breakoutScore *
        W.breakout

        +

        quality.rrScore *
        W.rr;


    return Math.round(
        clamp(confidence)
    );

}


// ============================================================
// RATING
// ============================================================

function getRating(
    confidence,
    decision
) {

    if (
        decision === "TRADE"
    ) {

        if (
            confidence >= 90
        ) {

            return "⭐⭐⭐⭐⭐ ELITE";

        }

        return "⭐⭐⭐⭐ STRONG";

    }


    if (
        decision === "WATCH"
    ) {

        return "⭐⭐⭐ WATCH";

    }


    return "❌ REJECT";

}


// ============================================================
// GATE DIAGNOSTIC
// ============================================================

function buildGateDiagnostic(
    scannerScore,
    direction,
    mtf,
    riskReward,
    quality,
    contractAvailable,
    optionPriceAvailable,
    optionSetupAvailable
) {

    return {

        confidence:
            false,

        scanner:
            scannerScore >=
            ENGINE_CONFIG.TRADE_SCANNER_SCORE,

        direction:
            direction.directionDifference >=
            ENGINE_CONFIG.TRADE_DIRECTION_DIFFERENCE,

        directionEvidence:
            direction.dominantEvidence >=
            ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE,

        mtf:
            mtf.alignedTimeframes >=
            ENGINE_CONFIG.TRADE_MTF_ALIGNMENT,

        fourHour:
            true,

        rr:
            riskReward >=
            ENGINE_CONFIG.TRADE_RR,

        momentum:
            quality.momentumScore >=
            ENGINE_CONFIG.TRADE_MOMENTUM,

        trend:
            quality.trendScore >=
            ENGINE_CONFIG.TRADE_TREND,

        contract:
            contractAvailable,

        optionLTP:
            optionPriceAvailable,

        optionSetup:
            optionSetupAvailable

    };

}


// ============================================================
// NO DIRECTION
// ============================================================

function buildNoDirectionResult(
    stockData,
    direction
) {

    const scannerScore =
        clamp(
            toNumber(
                stockData.finalScore ??
                stockData.score
            )
        );


    return {

        ...stockData,

        optionType: null,

        optionSymbol: null,

        optionInstrumentKey: null,

        optionExpiry: null,

        optionLTP: null,

        recommendedStrike: null,

        strikeInterval: null,

        optionsDecision:
            "REJECT",

        optionsRating:
            "❌ NO DIRECTION",

        optionsConfidence:
            0,

        optionsReason:

            `No clear direction | ` +

            `CALL: ${direction.callScore} | ` +

            `PUT: ${direction.putScore} | ` +

            `Difference: ${direction.directionDifference} | ` +

            `Evidence: ${direction.dominantEvidence}`,

        callDirectionScore:
            direction.callScore,

        putDirectionScore:
            direction.putScore,

        directionDifference:
            direction.directionDifference,

        callDirectionEvidence:
            direction.callEvidence,

        putDirectionEvidence:
            direction.putEvidence,

        scannerScore,

        tradeGates: {

            direction: false,

            directionEvidence: false

        },

        failedGates: [

            "DIRECTION"

        ],

        failedGateCount: 1,

        gateThresholds:
            ENGINE_CONFIG

    };

}


// ============================================================
// MAIN DECISION
// ============================================================

async function calculateOptionsDecision(
    stockData
) {

    if (!stockData) {
        return null;
    }


    const price =
        Number(
            stockData.price
        );


    if (
        !Number.isFinite(price) ||
        price <= 0
    ) {

        return {

            ...stockData,

            optionType: null,

            optionsDecision:
                "REJECT",

            optionsRating:
                "❌ INVALID",

            optionsConfidence:
                0,

            optionsReason:
                "Invalid stock price"

        };

    }


    // ========================================================
    // DIRECTION
    // ========================================================

    const direction =
        calculateDirection(
            stockData,
            price
        );


    if (
        !direction.optionType
    ) {

        return buildNoDirectionResult(
            stockData,
            direction
        );

    }


    const optionType =
        direction.optionType;


    // ========================================================
    // MTF
    // ========================================================

    const mtf =
        calculateMTF(
            optionType,
            stockData
        );


    // ========================================================
    // CONFIRMATIONS
    // ========================================================

    const confirmations =
        getConfirmations(
            stockData
        );


    const breakoutScore =
        calculateBreakoutScore(
            confirmations
        );


    // ========================================================
    // STOCK LEVELS
    // ========================================================

    const stockLevels =
        calculateStockLevels(

            optionType,

            price,

            stockData

        );


    if (!stockLevels) {

        return {

            ...stockData,

            optionType,

            optionsDecision:
                "REJECT",

            optionsRating:
                "❌ INVALID RISK",

            optionsConfidence:
                0,

            optionsReason:
                "Unable to calculate valid stock risk",

            callDirectionScore:
                direction.callScore,

            putDirectionScore:
                direction.putScore,

            directionDifference:
                direction.directionDifference

        };

    }


    // ========================================================
    // SCANNER SCORE
    // ========================================================

    const scannerScore =
        clamp(

            toNumber(

                stockData.finalScore ??
                stockData.score ??
                0

            )

        );


    // ========================================================
    // QUALITY
    // ========================================================

    const quality =
        calculateQualityScores(

            optionType,

            stockData,

            direction,

            mtf,

            breakoutScore,

            stockLevels.riskReward

        );


    // ========================================================
    // CONFIDENCE
    // ========================================================

    let optionsConfidence =
        calculateConfidence(

            scannerScore,

            quality

        );


    // ========================================================
    // HARD DIRECTION SAFETY
    // ========================================================
    //
    // Confidence can NEVER compensate for weak direction.
    // ========================================================

    if (
        direction.directionDifference <
        ENGINE_CONFIG.MIN_DIRECTION_DIFFERENCE
    ) {

        optionsConfidence =
            Math.min(
                optionsConfidence,
                59
            );

    }


    if (
        direction.dominantEvidence <
        ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE
    ) {

        optionsConfidence =
            Math.min(
                optionsConfidence,
                59
            );

    }


    // ========================================================
    // TRADE QUALITY
    // ========================================================

    const tradeQuality =

        scannerScore >=
            ENGINE_CONFIG.TRADE_SCANNER_SCORE &&

        direction.directionDifference >=
            ENGINE_CONFIG.TRADE_DIRECTION_DIFFERENCE &&

        direction.dominantEvidence >=
            ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE &&

        mtf.alignedTimeframes >=
            ENGINE_CONFIG.TRADE_MTF_ALIGNMENT &&

        stockLevels.riskReward >=
            ENGINE_CONFIG.TRADE_RR &&

        quality.momentumScore >=
            ENGINE_CONFIG.TRADE_MOMENTUM &&

        quality.trendScore >=
            ENGINE_CONFIG.TRADE_TREND;


    // ========================================================
    // WATCH QUALITY
    // ========================================================

    const watchQuality =

        scannerScore >=
            ENGINE_CONFIG.WATCH_SCANNER_SCORE &&

        direction.directionDifference >=
            ENGINE_CONFIG.WATCH_DIRECTION_DIFFERENCE &&

        direction.dominantEvidence >=
            ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE &&

        mtf.alignedTimeframes >=
            ENGINE_CONFIG.WATCH_MTF_ALIGNMENT &&

        stockLevels.riskReward >=
            ENGINE_CONFIG.WATCH_RR;


    let optionsDecision =
        "REJECT";


    if (
        tradeQuality &&
        optionsConfidence >=
            ENGINE_CONFIG.TRADE_CONFIDENCE
    ) {

        optionsDecision =
            "TRADE";

    }
    else if (
        watchQuality &&
        optionsConfidence >=
            ENGINE_CONFIG.WATCH_CONFIDENCE
    ) {

        optionsDecision =
            "WATCH";

    }


    // ========================================================
    // STRIKE
    // ========================================================

    const strikeData =
        getRecommendedStrike(

            price,

            optionType

        );


    const recommendedStrike =
        strikeData.strike;


    const strikeInterval =
        strikeData.interval;


    // ========================================================
    // CONTRACT
    // ========================================================

    let optionContract = null;

    let optionQuote = null;

    let optionSetup = null;


    const symbol =
        stockData.symbol ||
        stockData.tradingSymbol ||
        stockData.name;


    // --------------------------------------------------------
    // Lookup only WATCH/TRADE
    // --------------------------------------------------------

    if (
        optionsDecision !==
        "REJECT"
    ) {

        optionContract =
            await resolveOptionContract(

                symbol,

                optionType,

                recommendedStrike,

                strikeInterval

            );


        if (
            optionContract &&
            optionContract.instrumentKey
        ) {

            optionQuote =
                await resolveOptionQuote(

                    optionContract.instrumentKey

                );

        }


        if (
            optionQuote
        ) {

            optionSetup =
                calculateOptionTradeSetup(

                    optionType,

                    optionQuote.ltp,

                    stockData,

                    stockLevels.riskReward

                );

        }

    }


    // ========================================================
    // CONTRACT QUALITY
    // ========================================================

    const contractAvailable =
        !!optionContract;


    const optionPriceAvailable =
        !!optionQuote &&
        Number(
            optionQuote.ltp
        ) > 0;


    const optionSetupAvailable =
        !!optionSetup;


    // Missing option market data means:
    // TRADE → WATCH
    //
    // It must NEVER create a fake TRADE.
    if (
        optionsDecision === "TRADE" &&
        (
            !contractAvailable ||
            !optionPriceAvailable ||
            !optionSetupAvailable
        )
    ) {

        optionsDecision =
            "WATCH";

    }


    // ========================================================
    // GATES
    // ========================================================

    const tradeGates =
        buildGateDiagnostic(

            scannerScore,

            direction,

            mtf,

            stockLevels.riskReward,

            quality,

            contractAvailable,

            optionPriceAvailable,

            optionSetupAvailable

        );


    tradeGates.confidence =
        optionsConfidence >=
        ENGINE_CONFIG.TRADE_CONFIDENCE;


    const failedGates =
        Object.entries(
            tradeGates
        )

            .filter(
                ([, passed]) =>
                    !passed
            )

            .map(
                ([name]) =>
                    name.toUpperCase()
            );


    // ========================================================
    // REASON
    // ========================================================

    let optionsReason = "";


    if (
        optionsDecision === "TRADE"
    ) {

        optionsReason =

            `${optionType} confirmed | ` +

            `CALL ${direction.callScore} | ` +

            `PUT ${direction.putScore} | ` +

            `Diff ${direction.directionDifference} | ` +

            `Evidence ${direction.dominantEvidence} | ` +

            `MTF ${mtf.alignedTimeframes}/${mtf.availableTimeframes} | ` +

            `RR ${stockLevels.riskReward.toFixed(2)} | ` +

            `Confidence ${optionsConfidence}`;

    }
    else if (
        optionsDecision === "WATCH"
    ) {

        if (
            !contractAvailable
        ) {

            optionsReason =
                "Real option contract unavailable";

        }
        else if (
            !optionPriceAvailable
        ) {

            optionsReason =
                "Real option LTP unavailable";

        }
        else if (
            direction.directionDifference <
            ENGINE_CONFIG.TRADE_DIRECTION_DIFFERENCE
        ) {

            optionsReason =
                "Directional edge below TRADE threshold";

        }
        else if (
            mtf.alignedTimeframes <
            ENGINE_CONFIG.TRADE_MTF_ALIGNMENT
        ) {

            optionsReason =
                `MTF confirmation ${mtf.alignedTimeframes}/${mtf.availableTimeframes}`;

        }
        else if (
            stockLevels.riskReward <
            ENGINE_CONFIG.TRADE_RR
        ) {

            optionsReason =
                `R:R ${stockLevels.riskReward.toFixed(2)} below trade threshold`;

        }
        else {

            optionsReason =
                `Confidence ${optionsConfidence} below trade threshold`;

        }

    }
    else {

        if (
            scannerScore <
            ENGINE_CONFIG.WATCH_SCANNER_SCORE
        ) {

            optionsReason =
                "Scanner score too weak";

        }
        else if (
            direction.directionDifference <
            ENGINE_CONFIG.WATCH_DIRECTION_DIFFERENCE
        ) {

            optionsReason =
                "Directional edge too weak";

        }
        else if (
            direction.dominantEvidence <
            ENGINE_CONFIG.MIN_DIRECTION_EVIDENCE
        ) {

            optionsReason =
                "Insufficient independent directional evidence";

        }
        else if (
            mtf.alignedTimeframes <
            ENGINE_CONFIG.WATCH_MTF_ALIGNMENT
        ) {

            optionsReason =
                "Insufficient MTF confirmation";

        }
        else if (
            stockLevels.riskReward <
            ENGINE_CONFIG.WATCH_RR
        ) {

            optionsReason =
                `Poor R:R ${stockLevels.riskReward.toFixed(2)}`;

        }
        else {

            optionsReason =
                "Insufficient confirmation";

        }

    }


    // ========================================================
    // RATING
    // ========================================================

    const optionsRating =
        getRating(

            optionsConfidence,

            optionsDecision

        );


    // ========================================================
    // FINAL RESULT
    // ========================================================

    return {

        ...stockData,


        // ----------------------------------------------------
        // DIRECTION
        // ----------------------------------------------------

        optionType,

        callDirectionScore:
            direction.callScore,

        putDirectionScore:
            direction.putScore,

        directionDifference:
            direction.directionDifference,

        callDirectionEvidence:
            direction.callEvidence,

        putDirectionEvidence:
            direction.putEvidence,

        directionEvidence:
            direction.dominantEvidence,


        // ----------------------------------------------------
        // CONTRACT
        // ----------------------------------------------------

        optionSymbol:
            optionContract
                ? optionContract.tradingSymbol
                : null,

        optionInstrumentKey:
            optionContract
                ? optionContract.instrumentKey
                : null,

        optionExpiry:
            optionContract
                ? optionContract.expiry
                : null,

        optionExpiryDays:
            optionContract
                ? optionContract.expiryDays
                : null,

        recommendedStrike,

        strikeInterval,

        optionStrike:
            optionContract
                ? optionContract.strike
                : null,

        optionStrikeDifference:
            optionContract
                ? Number(

                    (
                        Number(
                            optionContract.strike
                        ) -
                        Number(
                            recommendedStrike
                        )
                    ).toFixed(2)

                )
                : null,

        optionLotSize:
            optionContract
                ? optionContract.lotSize
                : null,

        optionTickSize:
            optionContract
                ? optionContract.tickSize
                : null,


        // ----------------------------------------------------
        // OPTION DATA
        // ----------------------------------------------------

        optionLTP:
            optionQuote
                ? optionQuote.ltp
                : null,

        optionVolume:
            optionQuote
                ? (
                    optionQuote.volume ??
                    optionQuote.totalVolume ??
                    optionQuote.total_volume ??
                    null
                )
                : null,

        optionOpen:
            optionQuote
                ? (
                    optionQuote.open ??
                    optionQuote.openPrice ??
                    optionQuote.open_price ??
                    null
                )
                : null,

        optionHigh:
            optionQuote
                ? (
                    optionQuote.high ??
                    optionQuote.highPrice ??
                    optionQuote.high_price ??
                    null
                )
                : null,

        optionLow:
            optionQuote
                ? (
                    optionQuote.low ??
                    optionQuote.lowPrice ??
                    optionQuote.low_price ??
                    null
                )
                : null,


        // ----------------------------------------------------
        // OPTION SETUP
        // ----------------------------------------------------

        optionEntry:
            optionSetup
                ? optionSetup.optionEntry
                : null,

        optionStopLoss:
            optionSetup
                ? optionSetup.optionStopLoss
                : null,

        optionTarget1:
            optionSetup
                ? optionSetup.optionTarget1
                : null,

        optionTarget2:
            optionSetup
                ? optionSetup.optionTarget2
                : null,

        optionRisk:
            optionSetup
                ? optionSetup.optionRisk
                : null,

        optionReward:
            optionSetup
                ? optionSetup.optionReward
                : null,

        optionRiskReward:
            optionSetup
                ? optionSetup.optionRiskReward
                : null,


        contractAvailable,

        optionPriceAvailable,

        optionSetupAvailable,


        // ----------------------------------------------------
        // DECISION
        // ----------------------------------------------------

        optionsDecision,

        optionsRating,

        optionsConfidence,

        optionsReason,


        // ----------------------------------------------------
        // MTF
        // ----------------------------------------------------

        mtfAligned:
            mtf.mtfAligned,

        mtfDecisionScore:
            mtf.mtfScore,

        alignedTimeframes:
            mtf.alignedTimeframes,

        availableTimeframes:
            mtf.availableTimeframes,


        // ----------------------------------------------------
        // CONFIRMATIONS
        // ----------------------------------------------------

        breakoutConfirmed:
            confirmations.breakoutConfirmed,

        volumeConfirmed:
            confirmations.volumeConfirmed,

        trendConfirmed:
            confirmations.trendConfirmed,

        momentumConfirmed:
            confirmations.momentumConfirmed,

        optionsBreakoutScore:
            breakoutScore,


        // ----------------------------------------------------
        // STOCK SETUP
        // ----------------------------------------------------

        entry:
            stockLevels.entry,

        stopLoss:
            stockLevels.stopLoss,

        risk:
            stockLevels.risk,

        target1:
            stockLevels.target1,

        target2:
            stockLevels.target2,

        reward:
            stockLevels.reward,

        riskReward:
            stockLevels.riskReward,


        // ----------------------------------------------------
        // QUALITY
        // ----------------------------------------------------

        scannerScore,

        scannerQuality:
            scannerScore >=
            ENGINE_CONFIG.TRADE_SCANNER_SCORE,

        trendScore:
            quality.trendScore,

        trendQualityGate:
            quality.trendScore >=
            ENGINE_CONFIG.TRADE_TREND,

        momentumScore:
            quality.momentumScore,

        momentumQualityGate:
            quality.momentumScore >=
            ENGINE_CONFIG.TRADE_MOMENTUM,

        volumeScore:
            quality.volumeScore,

        rrScore:
            quality.rrScore,

        rrQualityGate:
            stockLevels.riskReward >=
            ENGINE_CONFIG.TRADE_RR,

        directionQuality:
            quality.directionQuality,

        directionQualityGate:
            direction.directionDifference >=
            ENGINE_CONFIG.TRADE_DIRECTION_DIFFERENCE,

        mtfQualityGate:
            mtf.alignedTimeframes >=
            ENGINE_CONFIG.TRADE_MTF_ALIGNMENT,


        // ----------------------------------------------------
        // GATES
        // ----------------------------------------------------

        tradeGates,

        failedGates,

        failedGateCount:
            failedGates.length,

        gateThresholds:
            ENGINE_CONFIG,


        // ----------------------------------------------------
        // LEVELS
        // ----------------------------------------------------

        support1:
            stockLevels.levels.technical.support1,

        support2:
            stockLevels.levels.technical.support2,

        resistance1:
            stockLevels.levels.technical.resistance1,

        resistance2:
            stockLevels.levels.technical.resistance2,

        pivotS1:
            stockLevels.levels.technical.pivotS1,

        pivotS2:
            stockLevels.levels.technical.pivotS2,

        pivotR1:
            stockLevels.levels.technical.pivotR1,

        pivotR2:
            stockLevels.levels.technical.pivotR2,


        oiSupport1:
            stockLevels.levels.oi.oiSupport1 ||
            null,

        oiSupport2:
            stockLevels.levels.oi.oiSupport2 ||
            null,

        oiResistance1:
            stockLevels.levels.oi.oiResistance1 ||
            null,

        oiResistance2:
            stockLevels.levels.oi.oiResistance2 ||
            null,

        maxPain:
            stockLevels.levels.oi.maxPain ||
            null,


        supportResistanceSource:

            (

                stockLevels.levels.oi.oiSupport1 ||
                stockLevels.levels.oi.oiSupport2 ||
                stockLevels.levels.oi.oiResistance1 ||
                stockLevels.levels.oi.oiResistance2

            )

                ? "TECHNICAL + OI"
                : "TECHNICAL",


        combinedSupportLevels:
            stockLevels.levels.supports,

        combinedResistanceLevels:
            stockLevels.levels.resistances,


        // ----------------------------------------------------
        // INDICATORS
        // ----------------------------------------------------

        rsi:
            toNumber(
                stockData.rsi
            ),

        adx:
            toNumber(
                stockData.adx
            ),

        atr:
            toNumber(
                stockData.atr
            ),

        rvol:
            toNumber(
                stockData.rvol
            )

    };

}


// ============================================================
// PROCESS ALL
// ============================================================

async function calculateOptionsDecisions(
    stocks
) {

    if (
        !Array.isArray(stocks)
    ) {

        return [];

    }


    const results = [];


    for (
        const stock
        of stocks
    ) {

        try {

            const result =
                await calculateOptionsDecision(
                    stock
                );


            if (result) {

                results.push(
                    result
                );

            }

        }
        catch (error) {

            console.log(

                `⚠️ Options engine failed for ` +
                `${stock.symbol || stock.name}: ` +
                `${error.message}`

            );


            results.push({

                ...stock,

                optionType: null,

                optionSymbol: null,

                optionInstrumentKey: null,

                optionExpiry: null,

                optionLTP: null,

                optionsDecision:
                    "REJECT",

                optionsRating:
                    "❌ ERROR",

                optionsConfidence:
                    0,

                optionsReason:
                    error.message

            });

        }

    }


    return results.sort(

        (a, b) => {

            const confidenceDifference =

                Number(
                    b.optionsConfidence || 0
                )

                -

                Number(
                    a.optionsConfidence || 0
                );


            if (
                confidenceDifference !== 0
            ) {

                return confidenceDifference;

            }


            return (

                Number(
                    b.optionRiskReward ||
                    b.riskReward ||
                    0
                )

                -

                Number(
                    a.optionRiskReward ||
                    a.riskReward ||
                    0
                )

            );

        }

    );

}


// ============================================================
// TOP OPTIONS
// ============================================================

async function getTopOptionsCandidates(
    stocks,
    limit = 10
) {

    const decisions =
        await calculateOptionsDecisions(
            stocks
        );


    return decisions

        .filter(

            stock =>

                stock.optionType &&

                (

                    stock.optionsDecision ===
                    "TRADE"

                    ||

                    stock.optionsDecision ===
                    "WATCH"

                )

        )

        .sort(

            (a, b) =>

                Number(
                    b.optionsConfidence || 0
                )

                -

                Number(
                    a.optionsConfidence || 0
                )

        )

        .slice(
            0,
            limit
        );

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateOptionsDecision,

    calculateOptionsDecisions,

    getTopOptionsCandidates,

    getRecommendedStrike,

    getStrikeInterval,

    resolveOptionContract,

    resolveOptionQuote,

    calculateOptionTradeSetup,

    getOISupportResistance,

    buildCombinedLevels,

    calculateDirection,

    calculateMTF

};