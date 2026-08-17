// ============================================================
// BREAKOUT / BREAKDOWN ENGINE V5
// ============================================================
// Purpose:
// - Detect fresh bullish breakouts
// - Detect fresh bearish breakdowns
// - Detect bullish/bearish setup conditions
// - Detect early developing bullish/bearish moves
// - Distinguish fresh events from existing price states
// - Balanced CALL / PUT scoring
// - Symmetric bullish / bearish confirmation
// - Volume + VWAP + ADX + DI confirmation
// - Prevent repeated breakout/breakdown events
// - Prevent bullish-only bias
// - Preserve existing breakout API
// ============================================================


// ============================================================
// SAFE NUMBER
// ============================================================

function num(value, fallback = 0) {

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;

}


// ============================================================
// SAFE OBJECT
// ============================================================

function obj(value) {

    return (
        value &&
        typeof value === "object"
    )
        ? value
        : {};

}


// ============================================================
// MACD VALUES
// ============================================================

function getMACD(indicators) {

    const macd = obj(indicators.macd);

    return {

        value: num(
            macd.MACD ??
            macd.macd
        ),

        signal: num(
            macd.signal ??
            macd.Signal
        ),

        histogram: num(
            macd.histogram ??
            macd.Histogram
        )

    };

}


// ============================================================
// ADX VALUES
// ============================================================

function getADX(indicators) {

    const adx = obj(indicators.adx);

    return {

        value: num(
            adx.adx ??
            indicators.adxValue
        ),

        pdi: num(
            adx.pdi ??
            indicators.pdi
        ),

        mdi: num(
            adx.mdi ??
            indicators.mdi
        )

    };

}


// ============================================================
// VALID CANDLE
// ============================================================

function normalizeCandle(candle) {

    if (
        !candle ||
        typeof candle !== "object"
    ) {

        return null;

    }

    const close = num(candle.close, NaN);
    const high = num(candle.high, NaN);
    const low = num(candle.low, NaN);

    if (
        !Number.isFinite(close) ||
        close <= 0
    ) {

        return null;

    }

    if (
        !Number.isFinite(high) ||
        high <= 0
    ) {

        return null;

    }

    if (
        !Number.isFinite(low) ||
        low <= 0
    ) {

        return null;

    }

    if (high < low) {

        return null;

    }

    return {

        ...candle,

        close,
        high,
        low

    };

}


// ============================================================
// LAST VALID CANDLE
// ============================================================

function getLastCandle(candles) {

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
            normalizeCandle(candles[i]);

        if (candle) {

            return candle;

        }

    }

    return null;

}


// ============================================================
// PREVIOUS VALID CANDLE
// ============================================================

function getPreviousCandle(candles) {

    if (
        !Array.isArray(candles) ||
        candles.length < 2
    ) {

        return null;

    }

    let validCount = 0;

    for (
        let i = candles.length - 1;
        i >= 0;
        i--
    ) {

        const candle =
            normalizeCandle(candles[i]);

        if (!candle) {

            continue;

        }

        validCount++;

        if (validCount === 2) {

            return candle;

        }

    }

    return null;

}


// ============================================================
// MAIN CALCULATION
// ============================================================

function calculateBreakout(
    candles,
    indicators = {},
    sr = {}
) {

    indicators = obj(indicators);
    sr = obj(sr);


    // ========================================================
    // CANDLES
    // ========================================================

    const last =
        getLastCandle(candles);

    const previous =
        getPreviousCandle(candles);


    // ========================================================
    // INVALID DATA
    // ========================================================

    if (!last) {

        return {

            valid: false,

            breakout: false,
            breakoutType: "NONE",
            breakoutStrength: "NONE",
            breakoutScore: 0,

            breakdown: false,
            breakdownType: "NONE",
            breakdownStrength: "NONE",
            breakdownScore: 0,

            freshBreakout: false,
            freshBreakdown: false,

            aboveResistance: false,
            nearResistance: false,

            belowSupport: false,
            nearSupport: false,

            volumeConfirmed: false,
            trendConfirmed: false,
            momentumConfirmed: false,

            bearishVolumeConfirmed: false,
            bearishTrendConfirmed: false,
            bearishMomentumConfirmed: false,

            strongTrendConfirmed: false,
            strongBearishTrendConfirmed: false,

            bullishTrendDeveloping: false,
            bearishTrendDeveloping: false,

            vwapBullish: false,
            vwapBearish: false,

            adxConfirmed: false,
            strongADX: false,

            bullishDIConfirmed: false,
            bearishDIConfirmed: false,

            rvol: 0,
            rsi: 0,
            adx: 0,
            pdi: 0,
            mdi: 0,

            resistance1: 0,
            support1: 0,

            close: 0,
            high: 0,
            low: 0,

            previousClose: 0,

            reason:
                "Invalid or missing candle data"

        };

    }


    // ========================================================
    // PRICE
    // ========================================================

    const close =
        last.close;

    const high =
        last.high;

    const low =
        last.low;

    const previousClose =
        previous
            ? previous.close
            : 0;


    // ========================================================
    // SUPPORT / RESISTANCE
    // ========================================================

    const resistance1 =
        num(
            sr.resistance1 ??
            sr.resistance ??
            sr.r1
        );

    const support1 =
        num(
            sr.support1 ??
            sr.support ??
            sr.s1
        );


    // ========================================================
    // INDICATORS
    // ========================================================

    const rvol =
        num(indicators.rvol);

    const rsi =
        num(indicators.rsi);

    const ema20 =
        num(indicators.ema20);

    const ema50 =
        num(indicators.ema50);

    const ema100 =
        num(indicators.ema100);

    const ema200 =
        num(indicators.ema200);

    const vwap =
        num(indicators.vwap);

    const macd =
        getMACD(indicators);

    const adx =
        getADX(indicators);


    // ========================================================
    // PRICE LOCATION
    // ========================================================

    const aboveResistance =
        resistance1 > 0 &&
        close > resistance1;

    const belowSupport =
        support1 > 0 &&
        close < support1;


    // ========================================================
    // PROXIMITY
    // ========================================================

    const PROXIMITY_PERCENT = 0.005;

    const nearResistance =
        resistance1 > 0 &&
        close <= resistance1 &&
        close >=
            resistance1 *
            (1 - PROXIMITY_PERCENT);

    const nearSupport =
        support1 > 0 &&
        close >= support1 &&
        close <=
            support1 *
            (1 + PROXIMITY_PERCENT);


    // ========================================================
    // FRESH BREAKOUT
    // ========================================================

    const freshBreakout =
        resistance1 > 0 &&
        previous !== null &&
        previousClose <= resistance1 &&
        close > resistance1;


    // ========================================================
    // FRESH BREAKDOWN
    // ========================================================
    // Exact bearish mirror of fresh breakout.
    //
    // IMPORTANT:
    // We do NOT weaken this condition.
    //
    // A fresh BREAKDOWN requires an actual S/R cross.
    // Early bearish movement is handled separately below.
    // ========================================================

    const freshBreakdown =
        support1 > 0 &&
        previous !== null &&
        previousClose >= support1 &&
        close < support1;


    // ========================================================
    // VOLUME
    // ========================================================

    const volumeConfirmed =
        rvol >= 1.5;

    const volumeGood =
        rvol >= 1.2;

    const bearishVolumeConfirmed =
        rvol >= 1.5;

    const bearishVolumeGood =
        rvol >= 1.2;


    // ========================================================
    // BULLISH EMA TREND
    // ========================================================

    const trendConfirmed =
        ema20 > 0 &&
        ema50 > 0 &&
        ema100 > 0 &&
        ema20 > ema50 &&
        ema50 > ema100;

    const strongTrendConfirmed =
        trendConfirmed &&
        (
            ema200 <= 0 ||
            ema100 > ema200
        );


    // ========================================================
    // BEARISH EMA TREND
    // ========================================================

    const bearishTrendConfirmed =
        ema20 > 0 &&
        ema50 > 0 &&
        ema100 > 0 &&
        ema20 < ema50 &&
        ema50 < ema100;

    const strongBearishTrendConfirmed =
        bearishTrendConfirmed &&
        (
            ema200 <= 0 ||
            ema100 < ema200
        );


    // ========================================================
    // DEVELOPING BULLISH TREND
    // ========================================================

    const bullishTrendDeveloping =
        ema20 > 0 &&
        ema50 > 0 &&
        (
            ema20 > ema50 ||
            (
                ema100 > 0 &&
                ema20 > ema100
            )
        );


    // ========================================================
    // DEVELOPING BEARISH TREND
    // ========================================================
    // IMPORTANT FIX:
    //
    // Do not wait for EMA20 < EMA50 < EMA100.
    //
    // An early bearish move can begin with EMA20 turning below
    // EMA50 or EMA100 before complete alignment.
    // ========================================================

    const bearishTrendDeveloping =
        ema20 > 0 &&
        ema50 > 0 &&
        (
            ema20 < ema50 ||
            (
                ema100 > 0 &&
                ema20 < ema100
            )
        );


    // ========================================================
    // BULLISH MOMENTUM
    // ========================================================

    const momentumConfirmed =
        rsi >= 55 &&
        rsi <= 75 &&
        macd.value > macd.signal;

    const momentumGood =
        rsi >= 50 &&
        rsi <= 75 &&
        macd.value >= macd.signal;


    // ========================================================
    // BEARISH MOMENTUM
    // ========================================================
    // Balanced with bullish logic.
    //
    // Confirmed:
    // RSI 25-48 + bearish MACD
    //
    // Good:
    // RSI 25-52 + bearish MACD
    // ========================================================

    const bearishMomentumConfirmed =
        rsi >= 25 &&
        rsi <= 48 &&
        macd.value < macd.signal;

    const bearishMomentumGood =
        rsi >= 25 &&
        rsi <= 52 &&
        macd.value <= macd.signal;


    // ========================================================
    // VWAP
    // ========================================================

    const vwapBullish =
        vwap > 0 &&
        close > vwap;

    const vwapBearish =
        vwap > 0 &&
        close < vwap;


    // ========================================================
    // ADX
    // ========================================================

    const adxConfirmed =
        adx.value >= 20;

    const strongADX =
        adx.value >= 25;


    // ========================================================
    // DIRECTIONAL INDEX
    // ========================================================

    const bullishDIConfirmed =
        adx.pdi > 0 &&
        adx.mdi > 0 &&
        adx.pdi > adx.mdi;

    const bearishDIConfirmed =
        adx.pdi > 0 &&
        adx.mdi > 0 &&
        adx.mdi > adx.pdi;


    // ========================================================
    // BULLISH SCORE
    // ========================================================

    let breakoutScore = 0;


    // Price
    if (aboveResistance) {

        breakoutScore += 3;

    }
    else if (nearResistance) {

        breakoutScore += 1;

    }


    // Volume
    if (volumeConfirmed) {

        breakoutScore += 2;

    }
    else if (volumeGood) {

        breakoutScore += 1;

    }


    // Trend
    if (trendConfirmed) {

        breakoutScore += 2;

    }
    else if (bullishTrendDeveloping) {

        breakoutScore += 1;

    }


    // Momentum
    if (momentumConfirmed) {

        breakoutScore += 2;

    }
    else if (momentumGood) {

        breakoutScore += 1;

    }


    // VWAP
    if (vwapBullish) {

        breakoutScore += 1;

    }


    // ADX + DI
    if (
        adxConfirmed &&
        bullishDIConfirmed
    ) {

        breakoutScore += 1;

    }


    breakoutScore =
        Math.min(
            10,
            breakoutScore
        );


    // ========================================================
    // BEARISH SCORE
    // ========================================================

    let breakdownScore = 0;


    // Price
    if (belowSupport) {

        breakdownScore += 3;

    }
    else if (nearSupport) {

        breakdownScore += 1;

    }


    // Volume
    if (bearishVolumeConfirmed) {

        breakdownScore += 2;

    }
    else if (bearishVolumeGood) {

        breakdownScore += 1;

    }


    // Trend
    if (bearishTrendConfirmed) {

        breakdownScore += 2;

    }
    else if (bearishTrendDeveloping) {

        breakdownScore += 1;

    }


    // Momentum
    if (bearishMomentumConfirmed) {

        breakdownScore += 2;

    }
    else if (bearishMomentumGood) {

        breakdownScore += 1;

    }


    // VWAP
    if (vwapBearish) {

        breakdownScore += 1;

    }


    // ADX + DI
    if (
        adxConfirmed &&
        bearishDIConfirmed
    ) {

        breakdownScore += 1;

    }


    breakdownScore =
        Math.min(
            10,
            breakdownScore
        );


    // ========================================================
    // CLASSIFICATION VARIABLES
    // ========================================================

    let breakout = false;

    let breakoutType = "NONE";

    let breakoutStrength = "NONE";

    let breakdown = false;

    let breakdownType = "NONE";

    let breakdownStrength = "NONE";


    // ========================================================
    // FRESH BULLISH BREAKOUT
    // ========================================================
    // Full confirmation required.
    // ========================================================

    if (
        freshBreakout &&
        volumeConfirmed &&
        trendConfirmed &&
        momentumConfirmed &&
        adxConfirmed &&
        bullishDIConfirmed
    ) {

        breakout = true;

        breakoutType =
            "BREAKOUT";


        if (
            rvol >= 2 &&
            adx.value >= 30
        ) {

            breakoutStrength =
                "VERY STRONG";

        }
        else if (
            rvol >= 1.5 &&
            adx.value >= 25
        ) {

            breakoutStrength =
                "STRONG";

        }
        else {

            breakoutStrength =
                "NORMAL";

        }

    }


    // ========================================================
    // FRESH BEARISH BREAKDOWN
    // ========================================================

    if (
        freshBreakdown &&
        bearishVolumeConfirmed &&
        bearishTrendConfirmed &&
        bearishMomentumConfirmed &&
        adxConfirmed &&
        bearishDIConfirmed
    ) {

        breakdown = true;

        breakdownType =
            "BREAKDOWN";


        if (
            rvol >= 2 &&
            adx.value >= 30
        ) {

            breakdownStrength =
                "VERY STRONG";

        }
        else if (
            rvol >= 1.5 &&
            adx.value >= 25
        ) {

            breakdownStrength =
                "STRONG";

        }
        else {

            breakdownStrength =
                "NORMAL";

        }

    }


    // ========================================================
    // BULLISH SETUP
    // ========================================================
    // Only near resistance.
    // ========================================================

    if (
        !breakout &&
        nearResistance &&
        bullishTrendDeveloping &&
        momentumGood &&
        volumeGood &&
        adxConfirmed &&
        bullishDIConfirmed
    ) {

        breakoutType =
            "SETUP";

        breakoutStrength =
            "POTENTIAL";

    }


    // ========================================================
    // BEARISH SETUP
    // ========================================================
    // Only near support.
    //
    // This is the key early bearish path:
    //
    // A stock can be bearish before S1 is actually broken.
    // We recognize it as SETUP, NOT as BREAKDOWN.
    // ========================================================

    if (
        !breakdown &&
        nearSupport &&
        bearishTrendDeveloping &&
        bearishMomentumGood &&
        bearishVolumeGood &&
        adxConfirmed &&
        bearishDIConfirmed
    ) {

        breakdownType =
            "SETUP";

        breakdownStrength =
            "POTENTIAL";

    }


    // ========================================================
    // BULLISH WATCH
    // ========================================================

    if (
        !breakout &&
        breakoutType === "NONE" &&
        bullishTrendDeveloping &&
        momentumGood &&
        volumeGood &&
        adxConfirmed &&
        bullishDIConfirmed &&
        !belowSupport
    ) {

        breakoutType =
            "WATCH";

        breakoutStrength =
            "WEAK";

    }


    // ========================================================
    // BEARISH WATCH
    // ========================================================

    if (
        !breakdown &&
        breakdownType === "NONE" &&
        bearishTrendDeveloping &&
        bearishMomentumGood &&
        bearishVolumeGood &&
        adxConfirmed &&
        bearishDIConfirmed &&
        !aboveResistance
    ) {

        breakdownType =
            "WATCH";

        breakdownStrength =
            "WEAK";

    }


    // ========================================================
    // ESTABLISHED BULLISH MOVE PROTECTION
    // ========================================================
    // If price is already above resistance but did not cross it
    // on the current candle, do not call it a fresh breakout.
    // ========================================================

    if (
        aboveResistance &&
        !freshBreakout &&
        breakoutType === "BREAKOUT"
    ) {

        breakout = false;

        breakoutType =
            "WATCH";

        breakoutStrength =
            "WEAK";

    }


    // ========================================================
    // ESTABLISHED BEARISH MOVE PROTECTION
    // ========================================================

    if (
        belowSupport &&
        !freshBreakdown &&
        breakdownType === "BREAKDOWN"
    ) {

        breakdown = false;

        breakdownType =
            "WATCH";

        breakdownStrength =
            "WEAK";

    }


    // ========================================================
    // HARD DIRECTIONAL SAFETY
    // ========================================================

    if (
        belowSupport &&
        breakout
    ) {

        breakout = false;

        breakoutType =
            "NONE";

        breakoutStrength =
            "NONE";

    }


    if (
        aboveResistance &&
        breakdown
    ) {

        breakdown = false;

        breakdownType =
            "NONE";

        breakdownStrength =
            "NONE";

    }


    // ========================================================
    // FINAL CONFLICT PROTECTION
    // ========================================================
    // A candle cannot produce both confirmed directions.
    //
    // If both occur because of unusual S/R values, the stronger
    // score wins.
    //
    // Equal score = NO DIRECTION.
    // ========================================================

    if (
        breakout &&
        breakdown
    ) {

        if (
            breakoutScore >
            breakdownScore
        ) {

            breakdown = false;

            breakdownType =
                "NONE";

            breakdownStrength =
                "NONE";

        }
        else if (
            breakdownScore >
            breakoutScore
        ) {

            breakout = false;

            breakoutType =
                "NONE";

            breakoutStrength =
                "NONE";

        }
        else {

            breakout = false;

            breakoutType =
                "NONE";

            breakoutStrength =
                "NONE";

            breakdown = false;

            breakdownType =
                "NONE";

            breakdownStrength =
                "NONE";

        }

    }


    // ========================================================
    // FINAL STATE CONSISTENCY
    // ========================================================

    if (!breakout) {

        if (
            breakoutType === "BREAKOUT"
        ) {

            breakoutType =
                "NONE";

            breakoutStrength =
                "NONE";

        }

    }


    if (!breakdown) {

        if (
            breakdownType === "BREAKDOWN"
        ) {

            breakdownType =
                "NONE";

            breakdownStrength =
                "NONE";

        }

    }


    // ========================================================
    // RETURN
    // ========================================================

    return {

        valid: true,


        // ----------------------------------------------------
        // Bullish
        // ----------------------------------------------------

        breakout,

        breakoutType,

        breakoutStrength,

        breakoutScore,

        freshBreakout,

        aboveResistance,

        nearResistance,

        bullishTrendDeveloping,


        // ----------------------------------------------------
        // Bearish
        // ----------------------------------------------------

        breakdown,

        breakdownType,

        breakdownStrength,

        breakdownScore,

        freshBreakdown,

        belowSupport,

        nearSupport,

        bearishTrendDeveloping,


        // ----------------------------------------------------
        // Confirmation
        // ----------------------------------------------------

        volumeConfirmed,

        trendConfirmed,

        strongTrendConfirmed,

        momentumConfirmed,

        bearishVolumeConfirmed,

        bearishTrendConfirmed,

        strongBearishTrendConfirmed,

        bearishMomentumConfirmed,

        vwapBullish,

        vwapBearish,

        adxConfirmed,

        strongADX,

        bullishDIConfirmed,

        bearishDIConfirmed,


        // ----------------------------------------------------
        // Indicator values
        // ----------------------------------------------------

        rvol,

        rsi,

        adx:
            adx.value,

        pdi:
            adx.pdi,

        mdi:
            adx.mdi,


        // ----------------------------------------------------
        // Support / Resistance
        // ----------------------------------------------------

        resistance1,

        support1,


        // ----------------------------------------------------
        // Price
        // ----------------------------------------------------

        close,

        high,

        low,

        previousClose

    };

}


// ============================================================
// ALIAS
// ============================================================

const detectBreakout =
    calculateBreakout;


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateBreakout,

    detectBreakout

};