// ============================================================
// RANKING ENGINE V6 — VALIDATED MARKET QUALITY RANKING
// ============================================================
// Fixes:
// 1) Valid market-structure RR is now recognised even when rrSource/rrValidated
//    metadata is absent from the scanner row.
// 2) RR no longer disappears from ranking merely because metadata was dropped.
// 3) Momentum is included as a bounded 0-10 contribution.
// 4) AI/MTF/volume/ADX/RR/momentum are weighted consistently to a 100-point score.
// ============================================================

function toNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function normalizeSignedScore(value) { return clamp(toNumber(value), -100, 100); }
function normalizeDirection(value) {
    const d = String(value || "").trim().toUpperCase();
    if (["CALL","CE","BULLISH","BUY","UP","LONG"].includes(d)) return "BULLISH";
    if (["PUT","PE","BEARISH","SELL","DOWN","SHORT"].includes(d)) return "BEARISH";
    return "SIDEWAYS";
}
function isConfirmed(value) {
    if (value === true) return true;
    if (typeof value !== "string") return false;
    return ["TRUE","YES","CONFIRMED"].includes(value.trim().toUpperCase());
}

function getValidatedRR(stock) {
    const rr = toNumber(stock?.riskReward ?? stock?.rr ?? stock?.RR, 0);
    if (rr <= 0) return 0;

    const source = String(
        stock?.rrSource ?? stock?.riskRewardSource ?? stock?.levelsSource ??
        stock?.trade?.rrSource ?? stock?.trade?.riskRewardSource ?? ""
    ).toUpperCase();
    const explicitValid = stock?.rrValidated === true || stock?.riskRewardValidated === true || stock?.trade?.rrValidated === true;
    const marketSource = source.includes("MARKET") || source.includes("STRUCTURE") || source.includes("SUPPORT") || source.includes("RESISTANCE");

    // Scanner trade setup already validates that entry/SL/targets exist and RR > 0.
    // If those fields are present, treat the RR as market-valid even when the
    // metadata flag was not copied into the flattened scanner row.
    const entry = toNumber(stock?.entry ?? stock?.stockEntry ?? stock?.trade?.entry, 0);
    const stop = toNumber(stock?.stopLoss ?? stock?.stockStopLoss ?? stock?.trade?.stopLoss, 0);
    const target = toNumber(stock?.target1 ?? stock?.stockTarget1 ?? stock?.trade?.target1, 0);
    const structurallyValid = entry > 0 && stop > 0 && target > 0 && entry !== stop;

    if (!(explicitValid || marketSource || structurallyValid)) return 0;
    return rr;
}

function calculateRiskRewardScore(stock) {
    const rr = getValidatedRR(stock);
    if (rr >= 3) return 10;
    if (rr >= 2) return 8;
    if (rr >= 1.5) return 5;
    if (rr >= 1.2) return 3;
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

function calculateMomentumScore(stock) {
    const m = toNumber(stock?.momentumScore, 0);
    return clamp(Math.round(m * 2), 0, 10);
}

function calculateMtfScore(stock) {
    return clamp(toNumber(stock?.mtfScore ?? stock?.mtf?.score ?? stock?.mtfConfirmationScore), 0, 100);
}

function getRating(score, direction) {
    const magnitude = Math.abs(normalizeSignedScore(score));
    direction = normalizeDirection(direction);
    if (direction === "BULLISH") {
        if (magnitude >= 90) return "⭐⭐⭐⭐⭐ ELITE BUY";
        if (magnitude >= 85) return "⭐⭐⭐⭐ STRONG BUY";
        if (magnitude >= 70) return "⭐⭐⭐ BUY";
        if (magnitude >= 60) return "⭐⭐ WATCH";
        return "❌ AVOID";
    }
    if (direction === "BEARISH") {
        if (magnitude >= 90) return "⭐⭐⭐⭐⭐ ELITE SELL";
        if (magnitude >= 85) return "⭐⭐⭐⭐ STRONG SELL";
        if (magnitude >= 70) return "⭐⭐⭐ SELL";
        if (magnitude >= 60) return "⭐⭐ WATCH";
        return "❌ AVOID";
    }
    if (magnitude >= 70) return "⭐⭐⭐ WATCH";
    if (magnitude >= 60) return "⭐⭐ WATCH";
    if (magnitude >= 40) return "⚠ WAIT";
    return "❌ AVOID";
}

function calculateFinalRank(stock) {
    if (!stock || typeof stock !== "object") return { finalScore:0, rating:"❌ AVOID", direction:"SIDEWAYS", aiScore:0, mtfScore:0, breakoutScore:0, volumeScore:0, adxScore:0, momentumScore:0, rrScore:0, validatedRR:0, is85Plus:false };

    const direction = normalizeDirection(stock.direction ?? stock.trend ?? stock.optionType ?? stock.signalDirection);
    const rawAi = normalizeSignedScore(stock.score ?? stock.aiScore);
    const aiStrength = Math.abs(rawAi);
    const mtfScore = calculateMtfScore(stock);
    const breakoutScore = calculateBreakoutScore(stock);
    const volumeScore = calculateVolumeScore(stock);
    const adxScore = calculateAdxScore(stock);
    const momentumScore = calculateMomentumScore(stock);
    const validatedRR = getValidatedRR(stock);
    const rrScore = calculateRiskRewardScore(stock);

    // Components total 100 points:
    // AI 40 + MTF 20 + breakout 15 + volume 10 + ADX 10 + momentum 10 + RR 10.
    // Breakout/RR can overlap with confirmation, so the final value is capped at 100.
    let magnitude =
        aiStrength * 0.40 +
        mtfScore * 0.20 +
        breakoutScore +
        volumeScore +
        adxScore +
        momentumScore +
        rrScore;
    magnitude = Math.round(clamp(magnitude, 0, 100));

    const aiDirection = rawAi > 0 ? "BULLISH" : rawAi < 0 ? "BEARISH" : "SIDEWAYS";
    const finalDirection = direction !== "SIDEWAYS" ? direction : aiDirection;
    const finalScore = finalDirection === "BULLISH" ? magnitude : finalDirection === "BEARISH" ? -magnitude : 0;

    stock.aiFinalScore = finalScore;
    stock.rankingScore = finalScore;
    stock.finalScore = finalScore;

    return {
        finalScore,
        rating:getRating(finalScore, finalDirection),
        direction:finalDirection,
        aiScore:Number(rawAi.toFixed(2)),
        aiStrength:Number(aiStrength.toFixed(2)),
        mtfScore:Number(mtfScore.toFixed(2)),
        breakoutScore,
        volumeScore,
        adxScore,
        momentumScore,
        rrScore,
        validatedRR,
        rrValidated:validatedRR > 0,
        is85Plus:Math.abs(finalScore) >= 85
    };
}

module.exports = { calculateFinalRank };
