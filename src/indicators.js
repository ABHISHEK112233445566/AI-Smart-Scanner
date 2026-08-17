// ============================================================
// TECHNICAL INDICATORS ENGINE
// ============================================================
// Purpose:
// - Calculate all scanner technical indicators
// - EMA 5 / 9 / 20 / 50 / 100 / 200
// - RSI
// - MACD
// - Bollinger Bands
// - ATR
// - ADX / PDI / MDI
// - Volume / Volume SMA / RVOL / Volume Spike
// - OBV
// - MFI
// - VWAP
// - Supertrend
// - Strong input validation
// - Null / NaN / Infinity protection
// - Avoid false technical signals when insufficient history exists
// ============================================================

const {
    EMA,
    SMA,
    RSI,
    MACD,
    BollingerBands,
    ATR,
    ADX,
    OBV,
    MFI
} = require("technicalindicators");

const {
    calculateSupertrend
} = require("./supertrend");


// ============================================================
// CONSTANTS
// ============================================================

const MIN_CANDLES = 2;

const EMA_PERIODS = {
    ema5: 5,
    ema9: 9,
    ema20: 20,
    ema50: 50,
    ema100: 100,
    ema200: 200
};

const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const BOLLINGER_PERIOD = 20;
const BOLLINGER_STDDEV = 2;
const ATR_PERIOD = 14;
const ADX_PERIOD = 14;
const VOLUME_SMA_PERIOD = 20;
const MFI_PERIOD = 14;

const RVOL_SPIKE_THRESHOLD = 1.5;


// ============================================================
// HELPERS
// ============================================================

function toNumber(value, fallback = 0) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function safeNumber(value, fallback = null) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


function safeLast(array, fallback = null) {

    if (!Array.isArray(array) || array.length === 0) {
        return fallback;
    }

    const value =
        array[array.length - 1];

    return value === undefined ||
        value === null
        ? fallback
        : value;
}


function safeCalculate(calculation, fallback = null) {

    try {

        const result =
            calculation();

        return safeLast(
            result,
            fallback
        );

    }
    catch (error) {

        return fallback;

    }

}


// ============================================================
// VALIDATE CANDLE
// ============================================================

function isValidCandle(candle) {

    if (!candle || typeof candle !== "object") {
        return false;
    }

    const high =
        Number(candle.high);

    const low =
        Number(candle.low);

    const close =
        Number(candle.close);

    const volume =
        candle.volume === undefined ||
        candle.volume === null ||
        candle.volume === ""
            ? 0
            : Number(candle.volume);

    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(volume)
    ) {
        return false;
    }

    if (
        high <= 0 ||
        low <= 0 ||
        close <= 0
    ) {
        return false;
    }

    if (high < low) {
        return false;
    }

    if (
        close > high ||
        close < low
    ) {
        return false;
    }

    if (volume < 0) {
        return false;
    }

    return true;
}


// ============================================================
// VALIDATE CANDLES
// ============================================================

function validateCandles(candles) {

    if (!Array.isArray(candles)) {
        return false;
    }

    if (candles.length < MIN_CANDLES) {
        return false;
    }

    return candles.every(
        isValidCandle
    );

}


// ============================================================
// NORMALIZE CANDLES
// ============================================================

function normalizeCandles(candles) {

    return candles.map(
        candle => ({

            ...candle,

            high:
                Number(candle.high),

            low:
                Number(candle.low),

            close:
                Number(candle.close),

            volume:
                Math.max(
                    0,
                    Number(candle.volume || 0)
                )

        })
    );

}


// ============================================================
// EMPTY RESULT
// ============================================================

function emptyIndicators() {

    return {

        ema5: null,
        ema9: null,
        ema20: null,
        ema50: null,
        ema100: null,
        ema200: null,

        rsi: null,

        macd: null,

        bollinger: null,

        atr: null,

        adx: null,

        volume: 0,
        volumeSMA20: null,
        rvol: null,
        volumeSpike: false,

        obv: null,

        mfi: null,

        vwap: null,

        supertrend: null

    };

}


// ============================================================
// VWAP
// ============================================================
// Calculates cumulative VWAP over the supplied candle series.
//
// Important:
// - If intraday candles are supplied, this represents VWAP over
//   the supplied intraday series.
// - If daily candles are supplied, this is cumulative VWAP over
//   the supplied daily history.
// - It does NOT pretend to be a true exchange session VWAP
//   unless the input candles represent one trading session.
// ============================================================

function calculateVWAP(candles) {

    if (
        !Array.isArray(candles) ||
        candles.length === 0
    ) {
        return null;
    }

    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const candle of candles) {

        if (!isValidCandle(candle)) {
            continue;
        }

        const high =
            Number(candle.high);

        const low =
            Number(candle.low);

        const close =
            Number(candle.close);

        const volume =
            Math.max(
                0,
                Number(candle.volume || 0)
            );

        const typicalPrice =
            (
                high +
                low +
                close
            ) / 3;

        cumulativeTPV +=
            typicalPrice *
            volume;

        cumulativeVolume +=
            volume;

    }

    if (
        !Number.isFinite(cumulativeVolume) ||
        cumulativeVolume <= 0
    ) {

        const latestClose =
            safeNumber(
                candles[candles.length - 1]?.close
            );

        return latestClose;

    }

    const vwap =
        cumulativeTPV /
        cumulativeVolume;

    return Number.isFinite(vwap)
        ? vwap
        : null;

}


// ============================================================
// CALCULATE EMA
// ============================================================

function calculateEMA(
    close,
    period
) {

    if (
        !Array.isArray(close) ||
        close.length < period
    ) {
        return null;
    }

    return safeCalculate(
        () =>
            EMA.calculate({
                period,
                values: close
            }),
        null
    );

}


// ============================================================
// CALCULATE INDICATORS
// ============================================================

function calculateIndicators(candles) {

    // ========================================================
    // INPUT VALIDATION
    // ========================================================

    if (!validateCandles(candles)) {
        return emptyIndicators();
    }


    // ========================================================
    // NORMALIZE INPUT
    // ========================================================

    const normalizedCandles =
        normalizeCandles(candles);


    const close =
        normalizedCandles.map(
            candle => candle.close
        );

    const high =
        normalizedCandles.map(
            candle => candle.high
        );

    const low =
        normalizedCandles.map(
            candle => candle.low
        );

    const volume =
        normalizedCandles.map(
            candle => candle.volume
        );


    // ========================================================
    // EMA
    // ========================================================

    const ema5 =
        calculateEMA(
            close,
            EMA_PERIODS.ema5
        );

    const ema9 =
        calculateEMA(
            close,
            EMA_PERIODS.ema9
        );

    const ema20 =
        calculateEMA(
            close,
            EMA_PERIODS.ema20
        );

    const ema50 =
        calculateEMA(
            close,
            EMA_PERIODS.ema50
        );

    const ema100 =
        calculateEMA(
            close,
            EMA_PERIODS.ema100
        );

    const ema200 =
        calculateEMA(
            close,
            EMA_PERIODS.ema200
        );


    // ========================================================
    // RSI
    // ========================================================

    const rsi =
        close.length >= RSI_PERIOD + 1
            ? safeCalculate(
                () =>
                    RSI.calculate({
                        period: RSI_PERIOD,
                        values: close
                    }),
                null
            )
            : null;


    // ========================================================
    // MACD
    // ========================================================

    const macd =
        close.length >= MACD_SLOW + MACD_SIGNAL
            ? safeCalculate(
                () =>
                    MACD.calculate({

                        values: close,

                        fastPeriod:
                            MACD_FAST,

                        slowPeriod:
                            MACD_SLOW,

                        signalPeriod:
                            MACD_SIGNAL,

                        SimpleMAOscillator:
                            false,

                        SimpleMASignal:
                            false

                    }),
                null
            )
            : null;


    // ========================================================
    // BOLLINGER BANDS
    // ========================================================

    const bollinger =
        close.length >= BOLLINGER_PERIOD
            ? safeCalculate(
                () =>
                    BollingerBands.calculate({

                        period:
                            BOLLINGER_PERIOD,

                        stdDev:
                            BOLLINGER_STDDEV,

                        values:
                            close

                    }),
                null
            )
            : null;


    // ========================================================
    // ATR
    // ========================================================

    const atr =
        close.length >= ATR_PERIOD + 1
            ? safeCalculate(
                () =>
                    ATR.calculate({

                        high,

                        low,

                        close,

                        period:
                            ATR_PERIOD

                    }),
                null
            )
            : null;


    // ========================================================
    // ADX
    // ========================================================

    const adx =
        close.length >= ADX_PERIOD + 1
            ? safeCalculate(
                () =>
                    ADX.calculate({

                        high,

                        low,

                        close,

                        period:
                            ADX_PERIOD

                    }),
                null
            )
            : null;


    // ========================================================
    // VOLUME
    // ========================================================

    const latestVolume =
        safeNumber(
            volume[
                volume.length - 1
            ],
            0
        );


    const volumeSMA20 =
        volume.length >= VOLUME_SMA_PERIOD
            ? safeCalculate(
                () =>
                    SMA.calculate({

                        period:
                            VOLUME_SMA_PERIOD,

                        values:
                            volume

                    }),
                null
            )
            : null;


    // ========================================================
    // RVOL
    // ========================================================
    //
    // Uses the latest completed 20-period average returned by
    // technicalindicators.
    //
    // We intentionally return null when there is insufficient
    // history instead of falsely reporting RVOL = 0.
    // ========================================================

    let rvol = null;

    if (
        Number.isFinite(latestVolume) &&
        Number.isFinite(volumeSMA20) &&
        volumeSMA20 > 0
    ) {

        rvol =
            latestVolume /
            volumeSMA20;

        if (Number.isFinite(rvol)) {

            rvol =
                Number(
                    rvol.toFixed(2)
                );

        }
        else {

            rvol = null;

        }

    }


    // ========================================================
    // VOLUME SPIKE
    // ========================================================

    const volumeSpike =
        Number.isFinite(rvol) &&
        rvol >= RVOL_SPIKE_THRESHOLD;


    // ========================================================
    // OBV
    // ========================================================

    const obv =
        close.length >= 2
            ? safeCalculate(
                () =>
                    OBV.calculate({

                        close,

                        volume

                    }),
                null
            )
            : null;


    // ========================================================
    // MFI
    // ========================================================

    const mfi =
        close.length >= MFI_PERIOD + 1
            ? safeCalculate(
                () =>
                    MFI.calculate({

                        high,

                        low,

                        close,

                        volume,

                        period:
                            MFI_PERIOD

                    }),
                null
            )
            : null;


    // ========================================================
    // VWAP
    // ========================================================

    const vwap =
        calculateVWAP(
            normalizedCandles
        );


    // ========================================================
    // SUPERTREND
    // ========================================================

    let supertrend = null;

    try {

        if (
            normalizedCandles.length >=
            ATR_PERIOD + 1
        ) {

            supertrend =
                calculateSupertrend(
                    normalizedCandles
                );

        }

    }
    catch (error) {

        console.log(
            `⚠️ Supertrend calculation failed: ${
                error.message
            }`
        );

        supertrend = null;

    }


    // ========================================================
    // FINAL NORMALIZATION
    // ========================================================

    return {

        // ====================================================
        // EMA
        // ====================================================

        ema5:
            safeNumber(ema5),

        ema9:
            safeNumber(ema9),

        ema20:
            safeNumber(ema20),

        ema50:
            safeNumber(ema50),

        ema100:
            safeNumber(ema100),

        ema200:
            safeNumber(ema200),


        // ====================================================
        // RSI
        // ====================================================

        rsi:
            safeNumber(rsi),


        // ====================================================
        // MACD
        // ====================================================

        macd:
            macd &&
            typeof macd === "object"
                ? {

                    MACD:
                        safeNumber(
                            macd.MACD
                        ),

                    signal:
                        safeNumber(
                            macd.signal
                        ),

                    histogram:
                        safeNumber(
                            macd.histogram
                        )

                }
                : null,


        // ====================================================
        // BOLLINGER
        // ====================================================

        bollinger:
            bollinger &&
            typeof bollinger === "object"
                ? {

                    upper:
                        safeNumber(
                            bollinger.upper
                        ),

                    middle:
                        safeNumber(
                            bollinger.middle
                        ),

                    lower:
                        safeNumber(
                            bollinger.lower
                        )

                }
                : null,


        // ====================================================
        // ATR
        // ====================================================

        atr:
            safeNumber(atr),


        // ====================================================
        // ADX
        // ====================================================

        adx:
            adx &&
            typeof adx === "object"
                ? {

                    adx:
                        safeNumber(
                            adx.adx
                        ),

                    pdi:
                        safeNumber(
                            adx.pdi
                        ),

                    mdi:
                        safeNumber(
                            adx.mdi
                        )

                }
                : null,


        // ====================================================
        // VOLUME
        // ====================================================

        volume:
            latestVolume,

        volumeSMA20:
            safeNumber(
                volumeSMA20
            ),

        rvol,

        volumeSpike,


        // ====================================================
        // OBV
        // ====================================================

        obv:
            safeNumber(obv),


        // ====================================================
        // MFI
        // ====================================================

        mfi:
            safeNumber(mfi),


        // ====================================================
        // VWAP
        // ====================================================

        vwap:
            safeNumber(vwap),


        // ====================================================
        // SUPERTREND
        // ====================================================

        supertrend

    };

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateIndicators,

    calculateVWAP,

    validateCandles

};