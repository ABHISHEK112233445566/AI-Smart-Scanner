// ============================================================
// RANKING ENGINE V5 — SIGNED MARKET RANKING
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
    const source = String(stock?.rrSource ?? stock?.riskRewardSource ?? stock?.levelsSource ?? "").toUpperCase();
    const validFlag = stock?.rrValidated === true || stock?.riskRewardValidated === true;
    const marketSource = source.includes("MARKET") || source.includes("STRUCTURE");
    if (rr <= 0 || (!validFlag && !marketSource)) return 0;
    return rr;
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
function calculateMtfScore(stock) { return clamp(toNumber(stock?.mtfScore ?? stock?.mtf?.score ?? stock?.mtfConfirmationScore), 0, 100); }
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
    if (!stock || typeof stock !== "object") return { finalScore:0, rating:"❌ AVOID", direction:"SIDEWAYS", aiScore:0, mtfScore:0, breakoutScore:0, volumeScore:0, adxScore:0, rrScore:0, validatedRR:0, is85Plus:false };
    const direction = normalizeDirection(stock.direction ?? stock.trend ?? stock.optionType ?? stock.signalDirection);
    const rawAi = normalizeSignedScore(stock.score ?? stock.aiScore);
    const aiStrength = Math.abs(rawAi);
    const mtfScore = calculateMtfScore(stock);
    const breakoutScore = calculateBreakoutScore(stock);
    const volumeScore = calculateVolumeScore(stock);
    const adxScore = calculateAdxScore(stock);
    const validatedRR = getValidatedRR(stock);
    const rrScore = calculateRiskRewardScore(stock);

    // Score strength is always positive during magnitude calculation.
    // Direction is applied exactly once at the end.
    let magnitude = aiStrength * 0.35 + mtfScore * 0.20 + breakoutScore + volumeScore + adxScore + rrScore;
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
        rrScore,
        validatedRR,
        rrValidated:validatedRR > 0,
        is85Plus:Math.abs(finalScore) >= 85
    };
}
module.exports = { calculateFinalRank };
