const { ATR } = require("technicalindicators");

function calculateSupertrend(candles, period = 10, multiplier = 3) {

    const high = candles.map(c => Number(c.high));
    const low = candles.map(c => Number(c.low));
    const close = candles.map(c => Number(c.close));

    const atr = ATR.calculate({
        high,
        low,
        close,
        period
    });

    const offset = period;

    let finalUpperBand = [];
    let finalLowerBand = [];
    let supertrend = [];
    let trend = [];

    for (let i = offset; i < close.length; i++) {

        const atrValue = atr[i - offset];

        const hl2 = (high[i] + low[i]) / 2;

        const basicUpper = hl2 + multiplier * atrValue;
        const basicLower = hl2 - multiplier * atrValue;

        if (i === offset) {

            finalUpperBand.push(basicUpper);
            finalLowerBand.push(basicLower);

        } else {

            const prevUpper = finalUpperBand.at(-1);
            const prevLower = finalLowerBand.at(-1);
            const prevClose = close[i - 1];

            finalUpperBand.push(
                (basicUpper < prevUpper || prevClose > prevUpper)
                    ? basicUpper
                    : prevUpper
            );

            finalLowerBand.push(
                (basicLower > prevLower || prevClose < prevLower)
                    ? basicLower
                    : prevLower
            );

        }

        if (supertrend.length === 0) {

            if (close[i] <= finalUpperBand.at(-1)) {

                supertrend.push(finalUpperBand.at(-1));
                trend.push("BEARISH");

            } else {

                supertrend.push(finalLowerBand.at(-1));
                trend.push("BULLISH");

            }

        } else {

            const prevSupertrend = supertrend.at(-1);

            if (prevSupertrend === finalUpperBand[finalUpperBand.length - 2]) {

                if (close[i] <= finalUpperBand.at(-1)) {

                    supertrend.push(finalUpperBand.at(-1));
                    trend.push("BEARISH");

                } else {

                    supertrend.push(finalLowerBand.at(-1));
                    trend.push("BULLISH");

                }

            } else {

                if (close[i] >= finalLowerBand.at(-1)) {

                    supertrend.push(finalLowerBand.at(-1));
                    trend.push("BULLISH");

                } else {

                    supertrend.push(finalUpperBand.at(-1));
                    trend.push("BEARISH");

                }

            }

        }

    }

    return {

        value: supertrend.at(-1),

        trend: trend.at(-1),

        buySignal:
            trend.length > 1 &&
            trend.at(-1) === "BULLISH" &&
            trend.at(-2) === "BEARISH",

        sellSignal:
            trend.length > 1 &&
            trend.at(-1) === "BEARISH" &&
            trend.at(-2) === "BULLISH"

    };

}

module.exports = {
    calculateSupertrend
};