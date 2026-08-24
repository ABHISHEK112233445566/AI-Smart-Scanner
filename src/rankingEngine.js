// ============================================================
// RANKING ENGINE V3 — VALIDATED MARKET R:R
// ============================================================

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeScore(value) {
    return Math.max(0, Math.min(100, toNumber(value)));
}

function normalizeDirection(value) {
    const d = String(value || "").trim().toUpperCase();
    if (["CALL", "CE", "BULLISH", "BUY", "UP"].includes(d)) return "BULLISH";
    if (["PUT", "PE", "BEARISH", "SELL", "DOWN"].includes(d)) return "BEARISH";
    return "SIDEWAYS";
}

function isConfirmed(value) {
    if (value === true) return true;
    if (typeof value !== "string") return false;
    return ["TRUE", "YES", "CONFIRMED"].includes(value.trim().toUpperCase());
}

// Only a validated, market-derived R:R is eligible for ranking.
// If the upstream setup does not explicitly confirm its source,
// R:R contributes ZERO rather than rewarding an artificial value.
function getValidatedRR(stock) {
    const rr = toNumber(stock?.riskReward ?? stock?.rr ?? stock?.RR, 0);
    const source = String(stock?.rrSource ?? stock?.riskRewardSource ?? stock?.levelsSource ?? "").toUpperCase();
    const validFlag = stock?.rrValidated === true || stock?.riskRewardValidated === true;
    const marketSource = source.includes("MARKET") || source.includes("STRUCTURE");
    if (rr <= 0 || !Number.isFinite(rr)) return 0;
    if (validFlag || marketSource) return rr;
    return 0;
}

function calculateRiskRewardScore(stock) {
    const rr = getValidatedRR(stock);
    if (rr >= 3) return 10;
    if (rr >= 2) return 8;
    if (rr >= 1.5) return 5;
    return 0;
}

function calculateBreakoutScore(stock) {
    if (!isConfirmed(stock?.breakout)) return 0;
    const s = String(stock?.breakoutStrength || "").trim().toUpperCase();
    if (s === "VERY STRONG") return 15;
    if (s === "STRONG") return 12;
    if (s === "MEDIUM") return 8;
    if (s === "WEAK") return 4;
    return 0;
}

function calculateAdxScore(stock) {
    const adx = toNumber(stock?.adx ?? stock?.adxValue ?? stock?.ADX);
    if (adx >= 35) return 10;
    if (adx >= 25) return 7;
    if (adx >= 20) return 4;
    return 0;
}

function calculateVolumeScore(stock) {
    if (isConfirmed(stock?.volumeConfirmed) || isConfirmed(stock?.volumeSpike)) return 10;
    return toNumber(stock?.rvol) >= 1.2 ? 10 : 0;
}

function calculateMtfScore(stock) {
    return normalizeScore(stock?.mtfScore ?? stock?.mtf?.score ?? stock?.mtfConfirmationScore);
}

function getRating(score, direction) {
    direction = normalizeDirection(direction);
    if (direction === "BULLISH") {
        if (score >= 90) return "⭐⭐⭐⭐⭐ ELITE BUY";
        if (score >= 80) return "⭐⭐⭐⭐ STRONG BUY";
        if (score >= 70) return "⭐⭐⭐ BUY";
        if (score >= 60) return "⭐⭐ WATCH";
        return "❌ AVOID";
    }
    if (direction === "BEARISH") {
        if (score >= 90) return "⭐⭐⭐⭐⭐ ELITE SELL";
        if (score >= 80) return "⭐⭐⭐⭐ STRONG SELL";
        if (score >= 70) return "⭐⭐⭐ SELL";
        if (score >= 60) return "⭐⭐ WATCH";
        return "❌ AVOID";
    }
    if (score >= 70) return "⭐⭐⭐ WATCH";
    if (score >= 60) return "⭐⭐ WATCH";
    if (score >= 40) return "⚠ WAIT";
    return "❌ AVOID";
}

function calculateFinalRank(stock) {
    if (!stock || typeof stock !== "object") {
        return { finalScore: 0, rating: "❌ AVOID", direction: "SIDEWAYS", aiScore: 0, mtfScore: 0, breakoutScore: 0, volumeScore: 0, adxScore: 0, rrScore: 0, validatedRR: 0, is90Plus: false };
    }

    const direction = normalizeDirection(stock.direction ?? stock.trend ?? stock.optionType ?? stock.signalDirection);
    const aiScore = normalizeScore(stock.score ?? stock.aiScore);
    const mtfScore = calculateMtfScore(stock);
    const breakoutScore = calculateBreakoutScore(stock);
    const volumeScore = calculateVolumeScore(stock);
    const adxScore = calculateAdxScore(stock);
    const validatedRR = getValidatedRR(stock);
    const rrScore = calculateRiskRewardScore(stock);

    let finalScore = aiScore * 0.35 + mtfScore * 0.20 + breakoutScore + volumeScore + adxScore + rrScore;
    finalScore = Math.round(Math.max(0, Math.min(100, finalScore)));

    // IMPORTANT FLOW FIX:
    // The options engine consumes aiFinalScore when calculating its scanner
    // gate. After ranking, aiFinalScore must represent the validated scanner
    // rank, not the upstream AI-only score. Keep aiScore unchanged so the
    // original AI score remains available for diagnostics.
    stock.aiFinalScore = finalScore;
    stock.rankingScore = finalScore;
    stock.finalScore = finalScore;

    return {
        finalScore,
        rating: getRating(finalScore, direction),
        direction,
        aiScore: Number(aiScore.toFixed(2)),
        mtfScore: Number(mtfScore.toFixed(2)),
        breakoutScore,
        volumeScore,
        adxScore,
        rrScore,
        validatedRR,
        rrValidated: validatedRR > 0,
        is90Plus: finalScore >= 90
    };
}

module.exports = { calculateFinalRank };
