// ============================================================
// AI SMART SCANNER - DASHBOARD ENGINE V2
// ============================================================
// Dashboard uses STOCK price levels only.
// Dashboard score gate = 85. Confidence is a separate quality gate.
// Option premium is never used for Entry / SL / Target.
// A candidate must have score >= 85, confidence >= 85, valid option
// contract + live LTP, genuine stock levels and valid stock R:R.
// ============================================================

const DASHBOARD_MIN_SCORE = 85;
const DASHBOARD_MIN_CONFIDENCE = 85;
const DASHBOARD_MAX_ROWS = 10;

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getNestedValue(object, paths = []) {
    if (!object || typeof object !== "object") return undefined;
    for (const path of paths) {
        let current = object;
        let valid = true;
        for (const part of String(path).split(".")) {
            if (current === null || current === undefined || typeof current !== "object" || !(part in current)) {
                valid = false;
                break;
            }
            current = current[part];
        }
        if (valid) return current;
    }
    return undefined;
}

function getISTDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const values = {};
    for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
    return values;
}
function getISTTimestamp(date = new Date()) {
    const p = getISTDateParts(date);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+05:30`;
}
function getISTMinutes(date = new Date()) { const p = getISTDateParts(date); return Number(p.hour) * 60 + Number(p.minute); }
function getISTWeekday(date = new Date()) {
    const p = getISTDateParts(date);
    return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
}
function getOptionType(option) {
    if (!option || typeof option !== "object") return "";
    const direct = String(option.optionType ?? option.option_type ?? option.finalDirection ?? option.direction ?? "").trim().toUpperCase();
    if (["CALL", "CE", "BULLISH"].includes(direct)) return "CALL";
    if (["PUT", "PE", "BEARISH"].includes(direct)) return "PUT";
    const symbol = String(option.optionSymbol ?? option.option_symbol ?? option.tradingSymbol ?? option.trading_symbol ?? "").trim().toUpperCase();
    if (/\bCE\b$/.test(symbol) || symbol.endsWith("CE")) return "CALL";
    if (/\bPE\b$/.test(symbol) || symbol.endsWith("PE")) return "PUT";
    return "";
}
function getDecision(option) { return String(option?.optionsDecision ?? option?.optionDecision ?? option?.decision ?? "").trim().toUpperCase(); }
function getConfidence(option) { return safeNumber(getNestedValue(option, ["optionsConfidence", "optionConfidence", "confidence", "score.confidence", "decision.confidence"])); }
function getScore(option) { return safeNumber(getNestedValue(option, ["rankingScore", "finalScore", "aiFinalScore", "scannerScore", "score"])); }
function getStockPrice(option) { return safeNumber(getNestedValue(option, ["price", "stockPrice", "underlyingPrice"])); }
function getStockEntry(option) { return safeNumber(getNestedValue(option, ["stockEntry", "stock_entry", "entry", "tradeSetup.stockEntry", "tradeSetup.entry"])); }
function getStockStopLoss(option) { return safeNumber(getNestedValue(option, ["stockStopLoss", "stock_stop_loss", "stopLoss", "tradeSetup.stockStopLoss", "tradeSetup.stopLoss"])); }
function getStockTarget1(option) { return safeNumber(getNestedValue(option, ["stockTarget1", "stock_target_1", "target1", "tradeSetup.stockTarget1", "tradeSetup.target1"])); }
function getStockTarget2(option) { return safeNumber(getNestedValue(option, ["stockTarget2", "stock_target_2", "target2", "tradeSetup.stockTarget2", "tradeSetup.target2"])); }
function getStockRiskReward(option) { return safeNumber(getNestedValue(option, ["stockRiskReward", "riskReward", "stockRiskRewardRatio"])); }
function getADX(option) {
    const value = getNestedValue(option, ["adx", "ADX", "indicators.adx", "indicatorData.adx"]);
    if (value && typeof value === "object") return safeNumber(value.adx ?? value.value, 0);
    return value === undefined || value === null || value === "" ? "" : safeNumber(value, value);
}
function getMood(option) { return String(getNestedValue(option, ["oiMood", "OIMood", "oi_mood", "mood", "optionMood"]) ?? "").trim().toUpperCase(); }
function getStockName(option) { return String(option?.stock ?? option?.symbol ?? option?.name ?? "").trim(); }

function validateStockSetup(option) {
    const type = getOptionType(option), entry = getStockEntry(option), sl = getStockStopLoss(option), t1 = getStockTarget1(option), t2 = getStockTarget2(option), rr = getStockRiskReward(option), price = getStockPrice(option);
    if (!type || entry <= 0 || sl <= 0 || rr <= 0 || price <= 0) return false;
    const target = t2 > 0 ? t2 : t1;
    if (target <= 0) return false;
    if (type === "CALL") return sl < entry && target > entry;
    if (type === "PUT") return sl > entry && target < entry;
    return false;
}
function getDashboardUniverse(results) { if (Array.isArray(results?.allResults)) return results.allResults; return Array.isArray(results) ? results : []; }

function buildDashboard(results = [], optionDecisions = [], totalStocks = 0) {
    const scanResults = getDashboardUniverse(results);
    const decisions = Array.isArray(optionDecisions) ? optionDecisions.filter(Boolean) : [];
    const total = safeNumber(totalStocks) > 0 ? safeNumber(totalStocks) : scanResults.length;
    const successfulScans = scanResults.filter(row => row && typeof row === "object" && String(row.rejectionReason || "").toUpperCase() !== "ERROR").length;
    const failedScans = Math.max(0, total - successfulScans);
    const lastScan = getISTTimestamp();
    const minutes = getISTMinutes();
    const weekday = getISTWeekday();
    const marketStatus = weekday >= 1 && weekday <= 5 && minutes >= 555 && minutes <= 930 ? "Market Open" : "Market Closed";
    const callCount = decisions.filter(o => getOptionType(o) === "CALL").length;
    const putCount = decisions.filter(o => getOptionType(o) === "PUT").length;
    const noDirectionCount = decisions.filter(o => !getOptionType(o)).length;
    const tradeCount = decisions.filter(o => getDecision(o) === "TRADE").length;
    const watchCount = decisions.filter(o => getDecision(o) === "WATCH").length;
    const rejectCount = decisions.filter(o => getDecision(o) === "REJECT").length;

    const qualityCandidates = decisions.filter(option =>
        getScore(option) >= DASHBOARD_MIN_SCORE &&
        getConfidence(option) >= DASHBOARD_MIN_CONFIDENCE &&
        (getDecision(option) === "TRADE" || getDecision(option) === "WATCH") &&
        (getOptionType(option) === "CALL" || getOptionType(option) === "PUT") &&
        option.contractAvailable === true && option.optionPriceAvailable === true && validateStockSetup(option)
    );
    const sortedOptions = [...qualityCandidates].sort((a, b) => (getScore(b) - getScore(a)) || (getConfidence(b) - getConfidence(a)) || (getStockRiskReward(b) - getStockRiskReward(a)));
    const top10 = sortedOptions.slice(0, DASHBOARD_MAX_ROWS).map((option, index) => {
        const type = getOptionType(option), target = getStockTarget2(option) > 0 ? getStockTarget2(option) : getStockTarget1(option);
        return { rank:index + 1, stock:getStockName(option), cePe:type === "CALL" ? "CE" : "PE", score:getScore(option), entry:getStockEntry(option), stopLoss:getStockStopLoss(option), target, mood:getMood(option), adx:getADX(option), confidence:getConfidence(option), riskReward:getStockRiskReward(option), decision:getDecision(option), strike:safeNumber(option.optionStrike ?? option.recommendedStrike, 0), optionLTP:safeNumber(option.optionLTP, 0), optionSymbol:option.optionSymbol || option.tradingSymbol || "" };
    });
    const strongBuy = qualityCandidates.length;
    let marketMood = "NEUTRAL";
    if (callCount > putCount) marketMood = "BULLISH"; else if (putCount > callCount) marketMood = "BEARISH";
    const headers = ["Stock", "CE / PE", "Score", "Stock Entry", "Stock SL", "Stock Target", "Mood", "ADX"];
    const summary = { "Last Scan":lastScan, "Market Status":marketStatus, "Total Stocks":total, "Successful Scans":successfulScans, "Failed Scans":failedScans, "Strong Buy (85+)":strongBuy, "Market Mood":marketMood, CALL:callCount, PUT:putCount, "No Direction":noDirectionCount, TRADE:tradeCount, "WATCH Decisions":watchCount, REJECT:rejectCount };
    return { generatedAt:lastScan, summary, headers, top10, top10Count:top10.length, lastScan, marketStatus, totalStocks:total, successfulScans, failedScans, strongBuy, buy:0, watch:0, avoid:0, mood:marketMood, callCount, putCount, noDirectionCount, tradeCount, watchCount, rejectCount, dashboardMinScore:DASHBOARD_MIN_SCORE, dashboardMinConfidence:DASHBOARD_MIN_CONFIDENCE, dashboardFilter:"SCORE >= 85 + CONFIDENCE >= 85 + VALID CONTRACT + LIVE LTP + VALID STOCK LEVELS + VALID STOCK R:R" };
}

module.exports = { buildDashboard, validateStockSetup, DASHBOARD_MIN_SCORE, DASHBOARD_MIN_CONFIDENCE, DASHBOARD_MAX_ROWS };
