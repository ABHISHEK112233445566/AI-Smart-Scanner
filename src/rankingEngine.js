// ============================================================
// RANKING ENGINE V2
// ============================================================
// Purpose:
// - Calculate final stock ranking score from 0–100
// - Remain completely direction-neutral
// - Support both BULLISH/CALL and BEARISH/PUT
// - Combine AI, MTF, breakout, volume, ADX and R:R
// - Validate all numeric inputs
// - Prevent invalid / negative / >100 component scores
// - Support boolean and string confirmation values
// - Preserve existing calculateFinalRank() API
// - NEVER force CALL or PUT
// - NEVER convert bearish stocks into BUY ratings
// ============================================================


// ============================================================
// BASIC HELPERS
// ============================================================

function toNumber(value, fallback = 0) {

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;

}


// ============================================================
// NORMALIZE SCORE
// ============================================================

function normalizeScore(value) {

    return Math.max(
        0,
        Math.min(
            100,
            toNumber(value)
        )
    );

}


// ============================================================
// NORMALIZE DIRECTION
// ============================================================

function normalizeDirection(value) {

    const direction =
        String(value || "")
            .trim()
            .toUpperCase();


    if (
        direction === "CALL" ||
        direction === "CE" ||
        direction === "BULLISH" ||
        direction === "BUY"
    ) {

        return "BULLISH";

    }


    if (
        direction === "PUT" ||
        direction === "PE" ||
        direction === "BEARISH" ||
        direction === "SELL"
    ) {

        return "BEARISH";

    }


    return "SIDEWAYS";

}


// ============================================================
// BOOLEAN NORMALIZATION
// ============================================================

function isConfirmed(value) {

    if (value === true) {

        return true;

    }


    if (typeof value === "string") {

        const normalized =
            value
                .trim()
                .toUpperCase();


        return (
            normalized === "TRUE" ||
            normalized === "YES" ||
            normalized === "CONFIRMED"
        );

    }


    return false;

}


// ============================================================
// BREAKOUT SCORE
// ============================================================

function calculateBreakoutScore(stock) {

    if (
        !isConfirmed(
            stock.breakout
        )
    ) {

        return 0;

    }


    const strength =
        String(
            stock.breakoutStrength || ""
        )
            .trim()
            .toUpperCase();


    switch (strength) {

        case "VERY STRONG":
            return 15;

        case "STRONG":
            return 12;

        case "MEDIUM":
            return 8;

        case "WEAK":
            return 4;

        default:
            return 0;

    }

}


// ============================================================
// ADX SCORE
// ============================================================

function calculateAdxScore(stock) {

    const adx =
        toNumber(
            stock.adx ??
            stock.adxValue ??
            stock.ADX
        );


    if (adx >= 35) {

        return 10;

    }


    if (adx >= 25) {

        return 7;

    }


    if (adx >= 20) {

        return 4;

    }


    return 0;

}


// ============================================================
// RISK / REWARD SCORE
// ============================================================

function calculateRiskRewardScore(stock) {

    const rr =
        toNumber(
            stock.riskReward ??
            stock.rr ??
            stock.RR
        );


    if (rr >= 3) {

        return 10;

    }


    if (rr >= 2) {

        return 8;

    }


    if (rr >= 1.5) {

        return 5;

    }


    return 0;

}


// ============================================================
// VOLUME SCORE
// ============================================================

function calculateVolumeScore(stock) {

    if (
        isConfirmed(
            stock.volumeConfirmed
        )
    ) {

        return 10;

    }


    if (
        isConfirmed(
            stock.volumeSpike
        )
    ) {

        return 10;

    }


    const rvol =
        toNumber(
            stock.rvol
        );


    if (
        rvol >= 1.2
    ) {

        return 10;

    }


    return 0;

}


// ============================================================
// MTF SCORE
// ============================================================
//
// Supports:
// - mtfScore
// - mtf.score
// - mtfConfirmationScore
//
// Direction is NOT changed here.
// The Options Decision Engine remains responsible
// for final CALL / PUT / NO DIRECTION selection.
// ============================================================

function calculateMtfScore(stock) {

    return normalizeScore(
        stock.mtfScore ??
        stock.mtf?.score ??
        stock.mtfConfirmationScore
    );

}


// ============================================================
// GET DIRECTION
// ============================================================
//
// Ranking engine does NOT invent direction.
//
// It only reads direction already calculated by
// AI / scanner / options decision layers.
// ============================================================

function getDirection(stock) {

    return normalizeDirection(

        stock.direction ??
        stock.trend ??
        stock.optionType ??
        stock.signalDirection

    );

}


// ============================================================
// DIRECTION-AWARE RATING
// ============================================================
//
// IMPORTANT:
// This function does NOT create CALL/PUT decisions.
//
// It only describes the quality of an already-existing
// directional signal.
//
// Therefore:
// BULLISH -> BUY wording
// BEARISH -> SELL wording
// SIDEWAYS -> WATCH/WAIT wording
//
// This prevents bearish stocks from being labelled BUY.
// ============================================================

function getRating(
    finalScore,
    direction
) {

    finalScore =
        normalizeScore(
            finalScore
        );


    direction =
        normalizeDirection(
            direction
        );


    // ========================================================
    // BULLISH
    // ========================================================

    if (
        direction === "BULLISH"
    ) {

        if (
            finalScore >= 90
        ) {

            return "⭐⭐⭐⭐⭐ ELITE BUY";

        }


        if (
            finalScore >= 80
        ) {

            return "⭐⭐⭐⭐ STRONG BUY";

        }


        if (
            finalScore >= 70
        ) {

            return "⭐⭐⭐ BUY";

        }


        if (
            finalScore >= 60
        ) {

            return "⭐⭐ WATCH";

        }


        return "❌ AVOID";

    }


    // ========================================================
    // BEARISH
    // ========================================================

    if (
        direction === "BEARISH"
    ) {

        if (
            finalScore >= 90
        ) {

            return "⭐⭐⭐⭐⭐ ELITE SELL";

        }


        if (
            finalScore >= 80
        ) {

            return "⭐⭐⭐⭐ STRONG SELL";

        }


        if (
            finalScore >= 70
        ) {

            return "⭐⭐⭐ SELL";

        }


        if (
            finalScore >= 60
        ) {

            return "⭐⭐ WATCH";

        }


        return "❌ AVOID";

    }


    // ========================================================
    // SIDEWAYS
    // ========================================================

    if (
        finalScore >= 70
    ) {

        return "⭐⭐⭐ WATCH";

    }


    if (
        finalScore >= 60
    ) {

        return "⭐⭐ WATCH";

    }


    if (
        finalScore >= 40
    ) {

        return "⚠ WAIT";

    }


    return "❌ AVOID";

}


// ============================================================
// MAIN RANKING FUNCTION
// ============================================================

function calculateFinalRank(stock) {

    if (
        !stock ||
        typeof stock !== "object"
    ) {

        return {

            finalScore: 0,

            rating:
                "❌ AVOID",

            direction:
                "SIDEWAYS",

            aiScore: 0,

            mtfScore: 0,

            breakoutScore: 0,

            volumeScore: 0,

            adxScore: 0,

            rrScore: 0,

            is90Plus: false

        };

    }


    // ========================================================
    // DIRECTION
    // ========================================================

    const direction =
        getDirection(
            stock
        );


    // ========================================================
    // AI SCORE — 35%
    // ========================================================

    const aiScore =
        normalizeScore(
            stock.score ??
            stock.finalScore ??
            stock.aiScore
        );


    let finalScore =
        aiScore *
        0.35;


    // ========================================================
    // MULTI TIMEFRAME — 20%
    // ========================================================

    const mtfScore =
        calculateMtfScore(
            stock
        );


    finalScore +=
        mtfScore *
        0.20;


    // ========================================================
    // BREAKOUT — 15%
    // ========================================================

    const breakoutScore =
        calculateBreakoutScore(
            stock
        );


    finalScore +=
        breakoutScore;


    // ========================================================
    // VOLUME — 10%
    // ========================================================

    const volumeScore =
        calculateVolumeScore(
            stock
        );


    finalScore +=
        volumeScore;


    // ========================================================
    // ADX — 10%
    // ========================================================

    const adxScore =
        calculateAdxScore(
            stock
        );


    finalScore +=
        adxScore;


    // ========================================================
    // RISK / REWARD — 10%
    // ========================================================

    const rrScore =
        calculateRiskRewardScore(
            stock
        );


    finalScore +=
        rrScore;


    // ========================================================
    // FINAL SCORE VALIDATION
    // ========================================================

    finalScore =
        Math.round(
            Math.max(
                0,
                Math.min(
                    100,
                    finalScore
                )
            )
        );


    // ========================================================
    // RATING
    // ========================================================

    const rating =
        getRating(
            finalScore,
            direction
        );


    // ========================================================
    // 90+ QUALIFICATION
    // ========================================================
    //
    // IMPORTANT:
    // 90+ ranking does NOT mean automatic TRADE.
    //
    // Options Decision Engine still decides:
    //
    // CALL
    // PUT
    // NO DIRECTION
    //
    // and applies its own MTF / quality / option gates.
    // ========================================================

    const is90Plus =
        finalScore >= 90;


    // ========================================================
    // COMPONENT BREAKDOWN
    // ========================================================

    return {

        finalScore,

        rating,

        // ----------------------------------------------------
        // Direction
        // ----------------------------------------------------

        direction,

        // ----------------------------------------------------
        // Components
        // ----------------------------------------------------

        aiScore:
            Number(
                aiScore.toFixed(2)
            ),

        mtfScore:
            Number(
                mtfScore.toFixed(2)
            ),

        breakoutScore,

        volumeScore,

        adxScore,

        rrScore,

        // ----------------------------------------------------
        // Qualification
        // ----------------------------------------------------

        is90Plus

    };

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    calculateFinalRank

};