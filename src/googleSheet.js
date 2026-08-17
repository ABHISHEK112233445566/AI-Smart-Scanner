// ============================================================
// GOOGLE SHEET UPLOADER — FINAL VERSION
// ============================================================
//
// SHEETS UPDATED AUTOMATICALLY
//
// 1. SCANNER
//    - Clean scanner parameters only
//    - No duplicate/unnecessary columns
//
// 2. Dashboard
//    - Top 10 candidates
//    - Confidence >= 90
//    - No direction
//    - No AI score
//    - No strike
//    - No option LTP
//    - Includes stock price/setup + OI Mood
//
// 3. ACCURACY
//    - STOCK PRICE ONLY
//    - No option-price evaluation
//    - Tracks movement after signal
//    - Exact date + time when high/low/SL/T1/T2 area reached
//    - Calculates stock movement and accuracy
//
// 4. PARAMETER_MASTER
//    - Parameters in rows
//    - Stocks in columns
//    - Automatic headers
//    - Raw value received for every stock
//    - Interpretation
//    - CALL points
//    - PUT points
//    - Source file
//    - Source function
//
// 5. PARAMETER LIST
//    - Static parameter/source reference
//
// IMPORTANT
// - DO NOT MODIFY .env
// - updateGoogleSheet() remains exported for app.js
// ============================================================

const axios = require("axios");
const config = require("./config");

// ============================================================
// CONFIGURATION
// ============================================================

const DASHBOARD_MIN_SCORE = 90;
const DASHBOARD_MAX_ROWS = 10;

const GOOGLE_TIMEOUT = 30000;

// ============================================================
// GOOGLE SHEET URL
// ============================================================

function getGoogleSheetUrl() {
    return (
        process.env.GOOGLE_SHEET_WEBHOOK_URL ||
        process.env.GOOGLE_SCRIPT_URL ||
        process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
        process.env.GOOGLE_SHEET_URL ||
        process.env.GOOGLE_APPS_SCRIPT_URL ||
        config.GOOGLE_SHEET_WEBHOOK_URL ||
        config.GOOGLE_SCRIPT_URL ||
        config.GOOGLE_SHEETS_WEBHOOK_URL ||
        config.GOOGLE_SHEET_URL ||
        config.GOOGLE_APPS_SCRIPT_URL ||
        null
    );
}

// ============================================================
// FINAL SCANNER COLUMNS
// ============================================================
//
// Removed as requested:
//
// instrumentKey
// tradingSymbol
// scannerScore
// aiScore
// risk
// reward
// optionInstrumentKey
// optionType
// optionExpiryDays
// strikeInterval
// optionLotSize
// optionRisk
// optionReward
// callDirectionScore
// putDirectionScore
// directionDifference
//
// Also removed duplicate/non-essential fields.
//

const CLEAN_SCANNER_COLUMNS = [

    // --------------------------------------------------------
    // MARKET
    // --------------------------------------------------------

    "stock",
    "symbol",
    "price",

    // --------------------------------------------------------
    // STOCK DIRECTION / SIGNAL
    // --------------------------------------------------------

    "direction",
    "stockDirection",
    "technicalDirection",

    "signal",
    "bullishScore",
    "bearishScore",
    "aiFinalScore",

    // --------------------------------------------------------
    // STOCK TRADE SETUP
    // --------------------------------------------------------

    "entry",
    "stopLoss",
    "target1",
    "target2",
    "riskReward",

    "trend",
    "confidence",

    // --------------------------------------------------------
    // SUPPORT / RESISTANCE
    // --------------------------------------------------------

    "support1",
    "support2",
    "support3",

    "resistance1",
    "resistance2",
    "resistance3",

    // --------------------------------------------------------
    // BREAKOUT
    // --------------------------------------------------------

    "breakout",
    "breakoutType",
    "breakoutStrength",
    "breakoutScore",

    "aboveResistance",
    "belowSupport",
    "nearResistance",
    "nearSupport",

    "volumeConfirmed",
    "trendConfirmed",
    "momentumConfirmed",

    // --------------------------------------------------------
    // MTF
    // --------------------------------------------------------

    "dailyTrend",
    "fourHourTrend",
    "oneHourTrend",
    "fifteenMinTrend",

    "mtfScore",
    "mtfAlignment",
    "mtfAlignedTimeframes",

    // --------------------------------------------------------
    // PIVOTS
    // --------------------------------------------------------

    "pivot",
    "pivotR1",
    "pivotR2",
    "pivotR3",

    "pivotS1",
    "pivotS2",
    "pivotS3",

    // --------------------------------------------------------
    // CPR
    // --------------------------------------------------------

    "cprTop",
    "cprBottom",
    "cprWidth",
    "cprType",

    // --------------------------------------------------------
    // EMA
    // --------------------------------------------------------

    "ema5",
    "ema9",
    "ema20",
    "ema50",
    "ema100",
    "ema200",

    // --------------------------------------------------------
    // MOMENTUM
    // --------------------------------------------------------

    "rsi",
    "macd",
    "macdSignal",
    "histogram",

    // --------------------------------------------------------
    // TREND STRENGTH
    // --------------------------------------------------------

    "adx",
    "pdi",
    "mdi",

    // --------------------------------------------------------
    // VOLATILITY
    // --------------------------------------------------------

    "atr",

    "bollingerUpper",
    "bollingerMiddle",
    "bollingerLower",

    // --------------------------------------------------------
    // VOLUME
    // --------------------------------------------------------

    "volume",
    "volumeSMA20",
    "rvol",
    "volumeSpike",

    "obv",
    "mfi",

    // --------------------------------------------------------
    // TREND INDICATORS
    // --------------------------------------------------------

    "supertrend",
    "vwap",

    // --------------------------------------------------------
    // FINAL RANKING
    // --------------------------------------------------------

    "finalScore",
    "rating",
    "ranking",
    "rankingScore",

    "is85Plus",
    "is90Plus",

    // --------------------------------------------------------
    // OPTION INFORMATION NEEDED FOR DECISION
    // --------------------------------------------------------

    "optionSymbol",
    "optionExpiry",

    "recommendedStrike",
    "optionStrike",
    "optionStrikeDifference",

    "optionTickSize",

    "contractAvailable",
    "optionPriceAvailable",
    "optionSetupAvailable",

    // --------------------------------------------------------
    // OPTIONS DECISION
    // --------------------------------------------------------

    "optionsDecision",
    "optionsRating",
    "optionsConfidence",
    "optionsReason",

    // --------------------------------------------------------
    // OPTIONS GATES
    // --------------------------------------------------------

    "optionsGateDiagnostic",
    "tradeGates",
    "failedGates",
    "failedGateCount",
    "gateThresholds",

    // --------------------------------------------------------
    // MTF DIAGNOSTICS
    // --------------------------------------------------------

    "mtfAvailableTimeframes",
    "mtfUnavailableTimeframes",
    "mtfAvailableCount",
    "mtfRequiredAligned",
    "mtfDiagnostic",

    "breakoutConfirmed",
    "optionsBreakoutScore",

    "mtfAligned",
    "mtfDecisionScore",
    "alignedTimeframes",

    // --------------------------------------------------------
    // QUALITY
    // --------------------------------------------------------

    "scannerQuality",

    "directionQualityGate",
    "mtfQualityGate",
    "rrQualityGate",
    "momentumQualityGate",
    "trendQualityGate",

    "trendScore",
    "momentumScore",
    "volumeScore",
    "rrScore",

    "directionQuality",

    // --------------------------------------------------------
    // OI
    // --------------------------------------------------------

    "oiSupport1",
    "oiSupport2",
    "oiResistance1",
    "oiResistance2",

    "maxPain",

    "supportResistanceSource",

    "combinedSupportLevels",
    "combinedResistanceLevels",

    "cePe",
    "oiMood",
    "oiSentiment",

    "callOI",
    "putOI",
    "pcr",

    "breakdown",

    "qualityGates",

    // --------------------------------------------------------
    // TIMESTAMP
    // --------------------------------------------------------

    "timestamp"
];

// ============================================================
// DASHBOARD COLUMNS
// ============================================================
//
// User requested removal of:
//
// direction
// AI score
// strike
// option LTP
//
// OI Mood is per-stock.
//

const DASHBOARD_COLUMNS = [

    "rank",

    "stock",
    "symbol",

    "price",

    "signal",

    "entry",
    "stopLoss",
    "target1",
    "target2",

    "riskReward",

    "trend",
    "confidence",

    "dailyTrend",
    "fourHourTrend",
    "oneHourTrend",
    "fifteenMinTrend",

    "mtfScore",
    "mtfAlignment",

    "optionsDecision",
    "optionsRating",
    "optionsConfidence",

    "oiMood",
    "oiSentiment",

    "callOI",
    "putOI",
    "pcr",

    "support1",
    "resistance1",

    "breakout",
    "volumeConfirmed",

    "timestamp"
];

// ============================================================
// ACCURACY COLUMNS
// ============================================================
//
// STOCK PRICE ONLY.
//
// We are NOT evaluating:
// - option LTP
// - option entry
// - option SL
// - option targets
// - strike price
//
// Accuracy is based on the underlying STOCK.
//

const ACCURACY_COLUMNS = [

    "recordId",

    "date",
    "time",
    "timestamp",

    "stock",
    "symbol",

    "decision",
    "confidence",

    // Signal stock price
    "stockPriceAtSignal",

    // Stock trade levels
    "stockEntry",
    "stockStopLoss",
    "stockTarget1",
    "stockTarget2",

    // Highest / lowest price reached AFTER signal
    "highestStockPriceReached",
    "highestStockPriceDate",
    "highestStockPriceTime",

    "lowestStockPriceReached",
    "lowestStockPriceDate",
    "lowestStockPriceTime",

    // Movement from stock entry
    "maxFavorableMove",
    "maxFavorableMovePercent",

    "maxAdverseMove",
    "maxAdverseMovePercent",

    // Exact times when levels were reached
    "stopLossReached",
    "stopLossReachedDate",
    "stopLossReachedTime",

    "target1Reached",
    "target1ReachedDate",
    "target1ReachedTime",

    "target2Reached",
    "target2ReachedDate",
    "target2ReachedTime",

    // Final accuracy
    "accuracyPercent",

    "evaluationStatus",
    "evaluationDate"
];

// ============================================================
// PARAMETER MASTER COLUMNS
// ============================================================
//
// IMPORTANT:
//
// Parameter = row
// Stock = column
//
// Example:
//
// Parameter | Interpretation | CALL Points | PUT Points |
// Source File | Source Function | RELIANCE | SBIN | HDFCBANK
//
// This lets us see many stocks at once.
//

const PARAMETER_MASTER_BASE_COLUMNS = [

    "Stage",
    "Parameter",
    "Interpretation",
    "CALL Points",
    "PUT Points",
    "Source File",
    "Source Function"
];

// ============================================================
// PARAMETER LIST COLUMNS
// ============================================================

const PARAMETER_LIST_COLUMNS = [

    "#",
    "Stage",
    "Parameter",
    "Raw Data",
    "Unit",
    "Timeframe",
    "Interpretation",
    "CALL Points",
    "PUT Points",
    "Source File",
    "Source Function",
    "Status",
    "Error/Notes"
];

// ============================================================
// PARAMETER DEFINITIONS
// ============================================================
//
// These define:
//
// 1. What we receive
// 2. What it means
// 3. CALL contribution
// 4. PUT contribution
// 5. Source file
// 6. Source function
//
// If the value is not directly scored by a known engine,
// points remain "-".
//

const PARAMETER_DEFINITIONS = [

    // ========================================================
    // MARKET
    // ========================================================

    {
        stage: "Market Data",
        parameter: "Stock",
        interpretation: "Stock being scanned",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    {
        stage: "Market Data",
        parameter: "Symbol",
        interpretation: "Stock symbol",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    {
        stage: "Market Data",
        parameter: "Price",
        interpretation: "Current stock price",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    // ========================================================
    // DIRECTION
    // ========================================================

    {
        stage: "Direction",
        parameter: "Direction",
        interpretation: "Final directional assessment",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    {
        stage: "Direction",
        parameter: "Stock Direction",
        interpretation: "Overall stock direction",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    {
        stage: "Direction",
        parameter: "Technical Direction",
        interpretation: "Technical directional assessment",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    {
        stage: "Direction",
        parameter: "Signal",
        interpretation: "Scanner signal generated from technical conditions",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "scanner.js",
        sourceFunction: "scanStock"
    },

    // ========================================================
    // EMA
    // ========================================================

    {
        stage: "Trend",
        parameter: "EMA 5",
        interpretation: "5-period EMA",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Trend",
        parameter: "EMA 9",
        interpretation: "9-period EMA",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Trend",
        parameter: "EMA 20",
        interpretation: "20-period EMA",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Trend",
        parameter: "EMA 50",
        interpretation: "50-period EMA",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Trend",
        parameter: "EMA 100",
        interpretation: "100-period EMA",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Trend",
        parameter: "EMA 200",
        interpretation: "200-period EMA",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    // ========================================================
    // MOMENTUM
    // ========================================================

    {
        stage: "Momentum",
        parameter: "RSI",
        interpretation: "Relative Strength Index; bullish/bearish momentum condition",
        callPoints: "+8",
        putPoints: "+8",
        sourceFile: "aiEngine.js / optionsDecisionEngine.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore / calculateOptionsDecision"
    },

    {
        stage: "Momentum",
        parameter: "MACD",
        interpretation: "MACD momentum condition",
        callPoints: "+7",
        putPoints: "+7",
        sourceFile: "aiEngine.js / optionsDecisionEngine.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore / calculateOptionsDecision"
    },

    {
        stage: "Momentum",
        parameter: "MACD Signal",
        interpretation: "MACD signal comparison reference",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Momentum",
        parameter: "MACD Histogram",
        interpretation: "Positive/negative momentum",
        callPoints: "+4",
        putPoints: "+4",
        sourceFile: "aiEngine.js / indicators.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore / calculateIndicators"
    },

    // ========================================================
    // ADX / DI
    // ========================================================

    {
        stage: "Trend Strength",
        parameter: "ADX",
        interpretation: "Trend strength",
        callPoints: "+6",
        putPoints: "+6",
        sourceFile: "aiEngine.js / optionsDecisionEngine.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore / calculateOptionsDecision"
    },

    {
        stage: "Trend Strength",
        parameter: "PDI",
        interpretation: "Positive directional strength",
        callPoints: "+10",
        putPoints: "-",
        sourceFile: "aiEngine.js",
        sourceFunction: "calculateBullishScore"
    },

    {
        stage: "Trend Strength",
        parameter: "MDI",
        interpretation: "Negative directional strength",
        callPoints: "-",
        putPoints: "+10",
        sourceFile: "aiEngine.js",
        sourceFunction: "calculateBearishScore"
    },

    // ========================================================
    // VWAP / SUPERTREND
    // ========================================================

    {
        stage: "Intraday",
        parameter: "VWAP",
        interpretation: "Price above/below VWAP",
        callPoints: "+5",
        putPoints: "+5",
        sourceFile: "aiEngine.js / indicators.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore / calculateVWAP"
    },

    {
        stage: "Trend",
        parameter: "Supertrend",
        interpretation: "Bullish/bearish trend confirmation",
        callPoints: "+5",
        putPoints: "+5",
        sourceFile: "supertrend.js / optionsDecisionEngine.js",
        sourceFunction: "calculateSupertrend / calculateOptionsDecision"
    },

    // ========================================================
    // VOLATILITY
    // ========================================================

    {
        stage: "Volatility",
        parameter: "ATR",
        interpretation: "Average True Range / stock volatility",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Volatility",
        parameter: "Bollinger Upper",
        interpretation: "Upper volatility boundary",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Volatility",
        parameter: "Bollinger Middle",
        interpretation: "Mean/reference level",
        callPoints: "+5",
        putPoints: "+5",
        sourceFile: "aiEngine.js / indicators.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore"
    },

    {
        stage: "Volatility",
        parameter: "Bollinger Lower",
        interpretation: "Lower volatility boundary",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    // ========================================================
    // VOLUME
    // ========================================================

    {
        stage: "Volume",
        parameter: "Volume",
        interpretation: "Current trading volume",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Volume",
        parameter: "Volume SMA20",
        interpretation: "20-period volume average",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Volume",
        parameter: "RVOL",
        interpretation: "Current volume relative to average",
        callPoints: "+5",
        putPoints: "+5",
        sourceFile: "aiEngine.js / indicators.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore"
    },

    {
        stage: "Volume",
        parameter: "Volume Spike",
        interpretation: "Abnormal volume confirmation",
        callPoints: "+5",
        putPoints: "+5",
        sourceFile: "aiEngine.js / indicators.js",
        sourceFunction: "calculateBullishScore / calculateBearishScore"
    },

    {
        stage: "Volume",
        parameter: "OBV",
        interpretation: "On Balance Volume",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    {
        stage: "Momentum",
        parameter: "MFI",
        interpretation: "Money Flow Index",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "indicators.js",
        sourceFunction: "calculateIndicators"
    },

    // ========================================================
    // BREAKOUT
    // ========================================================

    {
        stage: "Price Action",
        parameter: "Breakout",
        interpretation: "Valid bullish/bearish breakout",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "breakout.js",
        sourceFunction: "calculateBreakout"
    },

    {
        stage: "Price Action",
        parameter: "Breakout Type",
        interpretation: "Breakout classification",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "breakout.js",
        sourceFunction: "calculateBreakout"
    },

    {
        stage: "Price Action",
        parameter: "Breakout Strength",
        interpretation: "Strength of breakout",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "breakout.js",
        sourceFunction: "calculateBreakout"
    },

    {
        stage: "Price Action",
        parameter: "Breakout Score",
        interpretation: "Breakout contribution",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "breakout.js / rankingEngine.js",
        sourceFunction: "calculateBreakout / calculateFinalRank"
    },

    {
        stage: "Price Action",
        parameter: "Above Resistance",
        interpretation: "Price above resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "breakout.js",
        sourceFunction: "calculateBreakout"
    },

    {
        stage: "Price Action",
        parameter: "Below Support",
        interpretation: "Price below support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "breakout.js",
        sourceFunction: "calculateBreakout"
    },

    // ========================================================
    // MTF
    // ========================================================

    {
        stage: "MTF",
        parameter: "Daily Trend",
        interpretation: "Daily timeframe direction",
        callPoints: "+15",
        putPoints: "+15",
        sourceFile: "mtfScanner.js / optionsDecisionEngine.js",
        sourceFunction: "getMultiTimeframeAnalysis / calculateOptionsDecision"
    },

    {
        stage: "MTF",
        parameter: "4H Trend",
        interpretation: "4-hour timeframe direction",
        callPoints: "+12",
        putPoints: "+12",
        sourceFile: "mtfScanner.js / optionsDecisionEngine.js",
        sourceFunction: "getMultiTimeframeAnalysis / calculateOptionsDecision"
    },

    {
        stage: "MTF",
        parameter: "1H Trend",
        interpretation: "1-hour timeframe direction",
        callPoints: "+10",
        putPoints: "+10",
        sourceFile: "mtfScanner.js / optionsDecisionEngine.js",
        sourceFunction: "getMultiTimeframeAnalysis / calculateOptionsDecision"
    },

    {
        stage: "MTF",
        parameter: "15M Trend",
        interpretation: "15-minute execution direction",
        callPoints: "+8",
        putPoints: "+8",
        sourceFile: "mtfScanner.js / optionsDecisionEngine.js",
        sourceFunction: "getMultiTimeframeAnalysis / calculateOptionsDecision"
    },

    {
        stage: "MTF",
        parameter: "MTF Score",
        interpretation: "Multi-timeframe score",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "mtfScanner.js",
        sourceFunction: "getMultiTimeframeAnalysis"
    },

    {
        stage: "MTF",
        parameter: "MTF Alignment",
        interpretation: "Timeframe agreement",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "mtfScanner.js",
        sourceFunction: "getMultiTimeframeAnalysis"
    },

    // ========================================================
    // LEVELS
    // ========================================================

    {
        stage: "Levels",
        parameter: "Pivot",
        interpretation: "Central pivot level",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "pivotPoints.js",
        sourceFunction: "calculatePivotPoints"
    },

    {
        stage: "Levels",
        parameter: "Pivot R1",
        interpretation: "First pivot resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "pivotPoints.js",
        sourceFunction: "calculatePivotPoints"
    },

    {
        stage: "Levels",
        parameter: "Pivot R2",
        interpretation: "Second pivot resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "pivotPoints.js",
        sourceFunction: "calculatePivotPoints"
    },

    {
        stage: "Levels",
        parameter: "Pivot S1",
        interpretation: "First pivot support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "pivotPoints.js",
        sourceFunction: "calculatePivotPoints"
    },

    {
        stage: "Levels",
        parameter: "Pivot S2",
        interpretation: "Second pivot support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "pivotPoints.js",
        sourceFunction: "calculatePivotPoints"
    },

    {
        stage: "Levels",
        parameter: "CPR Top",
        interpretation: "CPR upper boundary",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "cpr.js",
        sourceFunction: "calculateCPR"
    },

    {
        stage: "Levels",
        parameter: "CPR Bottom",
        interpretation: "CPR lower boundary",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "cpr.js",
        sourceFunction: "calculateCPR"
    },

    {
        stage: "Levels",
        parameter: "CPR Width",
        interpretation: "CPR width",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "cpr.js",
        sourceFunction: "calculateCPR"
    },

    // ========================================================
    // SUPPORT / RESISTANCE
    // ========================================================

    {
        stage: "Support/Resistance",
        parameter: "Support 1",
        interpretation: "Primary stock support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "supportResistance.js",
        sourceFunction: "calculateSupportResistance"
    },

    {
        stage: "Support/Resistance",
        parameter: "Support 2",
        interpretation: "Secondary stock support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "supportResistance.js",
        sourceFunction: "calculateSupportResistance"
    },

    {
        stage: "Support/Resistance",
        parameter: "Resistance 1",
        interpretation: "Primary stock resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "supportResistance.js",
        sourceFunction: "calculateSupportResistance"
    },

    {
        stage: "Support/Resistance",
        parameter: "Resistance 2",
        interpretation: "Secondary stock resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "supportResistance.js",
        sourceFunction: "calculateSupportResistance"
    },

    // ========================================================
    // OI
    // ========================================================

    {
        stage: "OI",
        parameter: "OI Support 1",
        interpretation: "Primary OI support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "OI Support 2",
        interpretation: "Secondary OI support",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "OI Resistance 1",
        interpretation: "Primary OI resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "OI Resistance 2",
        interpretation: "Secondary OI resistance",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "Max Pain",
        interpretation: "Maximum-pain level",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "Call OI",
        interpretation: "Call open interest",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "Put OI",
        interpretation: "Put open interest",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "PCR",
        interpretation: "Put OI divided by Call OI",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "getOISupportResistance"
    },

    {
        stage: "OI",
        parameter: "OI Mood",
        interpretation: "LONG BUILDUP / SHORT BUILDUP / SHORT COVERING / LONG UNWINDING / NEUTRAL",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "oiMood.js",
        sourceFunction: "calculateOIMood"
    },

    {
        stage: "OI",
        parameter: "OI Sentiment",
        interpretation: "Bullish / bearish / neutral OI sentiment",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "oiMood.js",
        sourceFunction: "calculateOIMood"
    },

    // ========================================================
    // STOCK SETUP
    // ========================================================

    {
        stage: "Setup",
        parameter: "Entry",
        interpretation: "Underlying stock entry",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "tradeSetup.js",
        sourceFunction: "calculateTradeSetup"
    },

    {
        stage: "Setup",
        parameter: "Stop Loss",
        interpretation: "Underlying stock invalidation level",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "tradeSetup.js",
        sourceFunction: "calculateTradeSetup"
    },

    {
        stage: "Setup",
        parameter: "Target 1",
        interpretation: "Underlying stock first target",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "tradeSetup.js",
        sourceFunction: "calculateTradeSetup"
    },

    {
        stage: "Setup",
        parameter: "Target 2",
        interpretation: "Underlying stock second target",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "tradeSetup.js",
        sourceFunction: "calculateTradeSetup"
    },

    {
        stage: "Setup",
        parameter: "Risk/Reward",
        interpretation: "Stock reward relative to risk",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "tradeSetup.js / rankingEngine.js",
        sourceFunction: "calculateTradeSetup / calculateRiskRewardScore"
    },

    {
        stage: "Setup",
        parameter: "Confidence",
        interpretation: "Final setup confidence",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "tradeSetup.js / optionsDecisionEngine.js",
        sourceFunction: "calculateTradeSetup / calculateOptionsDecision"
    },

    // ========================================================
    // QUALITY
    // ========================================================

    {
        stage: "Quality",
        parameter: "Quality Gates",
        interpretation: "Trade eligibility gates",
        callPoints: "-",
        putPoints: "-",
        sourceFile: "optionsDecisionEngine.js",
        sourceFunction: "calculateOptionsDecision"
    }
];

// ============================================================
// VALUE CLEANER
// ============================================================

function cleanValue(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (
        typeof value === "boolean"
    ) {
        return value
            ? "TRUE"
            : "FALSE";
    }

    if (
        typeof value === "object"
    ) {
        try {
            return JSON.stringify(value);
        }
        catch (e) {
            return String(value);
        }
    }

    return value;
}

// ============================================================
// SAFE NUMBER
// ============================================================

function safeNumber(value, fallback = 0) {

    const n =
        Number(value);

    return Number.isFinite(n)
        ? n
        : fallback;
}

// ============================================================
// FIRST VALID VALUE
// ============================================================

function firstValid(...values) {

    for (const value of values) {

        if (
            value !== undefined &&
            value !== null &&
            value !== ""
        ) {
            return value;
        }
    }

    return "";
}

// ============================================================
// GET VALUE
// ============================================================

function getValue(row, key) {

    if (
        !row ||
        typeof row !== "object"
    ) {
        return "";
    }

    if (
        row[key] !== undefined &&
        row[key] !== null
    ) {
        return row[key];
    }

    const aliases = {

        stock: [
            "name",
            "stockName"
        ],

        symbol: [
            "ticker"
        ],

        price: [
            "ltp",
            "lastPrice",
            "currentPrice"
        ],

        confidence: [
            "optionsConfidence",
            "optionConfidence"
        ],

        optionsConfidence: [
            "optionConfidence",
            "confidence"
        ],

        entry: [
            "stockEntry",
            "underlyingEntry"
        ],

        stopLoss: [
            "stockStopLoss",
            "underlyingStopLoss"
        ],

        target1: [
            "stockTarget1",
            "underlyingTarget1"
        ],

        target2: [
            "stockTarget2",
            "underlyingTarget2"
        ],

        riskReward: [
            "rr",
            "stockRiskReward"
        ],

        oiMood: [
            "mood"
        ],

        oiSentiment: [
            "sentiment"
        ],

        optionsDecision: [
            "optionDecision",
            "decision"
        ],

        optionsConfidence: [
            "optionConfidence",
            "confidence"
        ],

        optionSymbol: [
            "contractSymbol"
        ],

        optionExpiry: [
            "expiry"
        ],

        recommendedStrike: [
            "strike"
        ],

        optionStrike: [
            "strike"
        ],

        timestamp: [
            "scanTimestamp",
            "createdAt",
            "time"
        ]
    };

    const possible =
        aliases[key] || [];

    for (
        const alias of possible
    ) {

        if (
            row[alias] !== undefined &&
            row[alias] !== null &&
            row[alias] !== ""
        ) {
            return row[alias];
        }
    }

    return "";
}

// ============================================================
// NORMALIZE ROWS
// ============================================================

function normalizeRows(input) {

    if (!input) {
        return [];
    }

    if (
        Array.isArray(input)
    ) {
        return input;
    }

    if (
        Array.isArray(input.data)
    ) {
        return input.data;
    }

    if (
        Array.isArray(input.scannerData)
    ) {
        return input.scannerData;
    }

    if (
        Array.isArray(input.results)
    ) {
        return input.results;
    }

    if (
        Array.isArray(input.scans)
    ) {
        return input.scans;
    }

    if (
        Array.isArray(input.predictions)
    ) {
        return input.predictions;
    }

    if (
        input.stock ||
        input.symbol
    ) {
        return [input];
    }

    return [];
}

// ============================================================
// POST TO GOOGLE APPS SCRIPT
// ============================================================

async function postToGoogleSheet(payload) {

    const url =
        getGoogleSheetUrl();

    if (!url) {

        throw new Error(
            "Google Sheet webhook URL is missing."
        );
    }

    const response =
        await axios.post(
            url,
            payload,
            {
                timeout:
                    GOOGLE_TIMEOUT,

                headers: {
                    "Content-Type":
                        "application/json"
                }
            }
        );

    return response.data;
}

// ============================================================
// BUILD GENERIC ROW
// ============================================================

function buildRow(
    source,
    columns
) {

    return columns.map(
        column =>
            cleanValue(
                getValue(
                    source,
                    column
                )
            )
    );
}

// ============================================================
// DASHBOARD CONFIDENCE
// ============================================================

function getDashboardConfidence(row) {

    return safeNumber(
        firstValid(
            row?.optionsConfidence,
            row?.confidence
        ),
        0
    );
}

// ============================================================
// DASHBOARD VALIDATION
// ============================================================

function isValidDashboardTrade(row) {

    const decision =
        String(
            firstValid(
                row?.optionsDecision,
                row?.decision
            )
        )
            .trim()
            .toUpperCase();

    const confidence =
        getDashboardConfidence(row);

    return (
        (
            decision === "TRADE" ||
            decision === "BUY" ||
            decision === "CALL" ||
            decision === "PUT"
        ) &&
        confidence >=
            DASHBOARD_MIN_SCORE
    );
}

// ============================================================
// SCANNER UPLOAD
// ============================================================

async function uploadScannerData(
    scannerData
) {

    const rows =
        normalizeRows(
            scannerData
        );

    const cleanRows =
        rows.map(
            row =>
                buildRow(
                    row,
                    CLEAN_SCANNER_COLUMNS
                )
        );

    return postToGoogleSheet({

        action:
            "replaceSheet",

        sheet:
            "SCANNER",

        clearFirst:
            true,

        headers:
            CLEAN_SCANNER_COLUMNS,

        rows:
            cleanRows,

        timestamp:
            new Date().toISOString()
    });
}

// ============================================================
// DASHBOARD UPLOAD
// ============================================================

async function uploadDashboardData(
    scannerData
) {

    const rows =
        normalizeRows(
            scannerData
        );

    const filtered =
        rows
            .filter(
                isValidDashboardTrade
            )
            .sort(
                (a, b) =>
                    getDashboardConfidence(b) -
                    getDashboardConfidence(a)
            )
            .slice(
                0,
                DASHBOARD_MAX_ROWS
            );

    const dashboardRows =
        filtered.map(
            (row, index) => {

                const result = {};

                for (
                    const column
                    of DASHBOARD_COLUMNS
                ) {

                    if (
                        column === "rank"
                    ) {

                        result[column] =
                            index + 1;

                    }
                    else {

                        result[column] =
                            getValue(
                                row,
                                column
                            );
                    }
                }

                return DASHBOARD_COLUMNS.map(
                    column =>
                        cleanValue(
                            result[column]
                        )
                );
            }
        );

    return postToGoogleSheet({

        action:
            "replaceSheet",

        sheet:
            "Dashboard",

        clearFirst:
            true,

        headers:
            DASHBOARD_COLUMNS,

        rows:
            dashboardRows,

        timestamp:
            new Date().toISOString()
    });
}

// ============================================================
// INDIA DATE / TIME
// ============================================================

function getIndiaDateParts(
    timestamp
) {

    const date =
        timestamp
            ? new Date(timestamp)
            : new Date();

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return {
            date: "",
            time: ""
        };
    }

    const dateText =
        new Intl.DateTimeFormat(
            "en-IN",
            {
                timeZone:
                    "Asia/Kolkata",
                year:
                    "numeric",
                month:
                    "2-digit",
                day:
                    "2-digit"
            }
        ).format(date);

    const timeText =
        new Intl.DateTimeFormat(
            "en-IN",
            {
                timeZone:
                    "Asia/Kolkata",
                hour:
                    "2-digit",
                minute:
                    "2-digit",
                second:
                    "2-digit",
                hour12:
                    false
            }
        ).format(date);

    const parts =
        dateText.split("/");

    return {

        date:
            `${parts[2]}-${parts[1]}-${parts[0]}`,

        time:
            timeText
    };
}

// ============================================================
// ACCURACY HELPERS
// ============================================================

function getStockEntry(row) {

    return safeNumber(
        firstValid(
            row?.entry,
            row?.stockEntry,
            row?.underlyingEntry,
            row?.price
        ),
        0
    );
}

function getStockStopLoss(row) {

    return safeNumber(
        firstValid(
            row?.stopLoss,
            row?.stockStopLoss,
            row?.underlyingStopLoss
        ),
        0
    );
}

function getStockTarget1(row) {

    return safeNumber(
        firstValid(
            row?.target1,
            row?.stockTarget1,
            row?.underlyingTarget1
        ),
        0
    );
}

function getStockTarget2(row) {

    return safeNumber(
        firstValid(
            row?.target2,
            row?.stockTarget2,
            row?.underlyingTarget2
        ),
        0
    );
}

// ============================================================
// INITIAL ACCURACY RECORD
// ============================================================
//
// This creates the prediction record.
//
// The evaluation fields remain blank initially.
// They are filled by the Google Apps Script as later
// stock prices/candles become available.
//

function buildAccuracyRow(
    row
) {

    if (
        !row ||
        typeof row !== "object"
    ) {
        return null;
    }

    const decision =
        String(
            firstValid(
                row.optionsDecision,
                row.decision
            )
        )
            .trim()
            .toUpperCase();

    if (
        decision !== "TRADE" &&
        decision !== "BUY" &&
        decision !== "CALL" &&
        decision !== "PUT"
    ) {

        return null;
    }

    const timestamp =
        firstValid(
            row.timestamp,
            row.scanTimestamp,
            row.createdAt
        ) ||
        new Date().toISOString();

    const parts =
        getIndiaDateParts(
            timestamp
        );

    const stock =
        firstValid(
            row.stock,
            row.symbol,
            row.name
        );

    const symbol =
        firstValid(
            row.symbol,
            row.stock
        );

    const stockPrice =
        safeNumber(
            firstValid(
                row.price,
                row.ltp,
                row.lastPrice
            ),
            0
        );

    const entry =
        getStockEntry(row);

    const recordId =
        `${Date.now()}_${String(stock).replace(/\s+/g, "_")}`;

    const result = {};

    for (
        const column
        of ACCURACY_COLUMNS
    ) {
        result[column] = "";
    }

    result.recordId =
        recordId;

    result.date =
        parts.date;

    result.time =
        parts.time;

    result.timestamp =
        timestamp;

    result.stock =
        stock;

    result.symbol =
        symbol;

    result.decision =
        decision;

    result.confidence =
        safeNumber(
            firstValid(
                row.optionsConfidence,
                row.confidence
            ),
            0
        );

    result.stockPriceAtSignal =
        stockPrice;

    result.stockEntry =
        entry;

    result.stockStopLoss =
        getStockStopLoss(row);

    result.stockTarget1 =
        getStockTarget1(row);

    result.stockTarget2 =
        getStockTarget2(row);

    result.evaluationStatus =
        "PENDING";

    return ACCURACY_COLUMNS.map(
        column =>
            cleanValue(
                result[column]
            )
    );
}

// ============================================================
// ACCURACY UPLOAD
// ============================================================

async function uploadAccuracyData(
    data
) {

    const rows =
        normalizeRows(data);

    const accuracyRows =
        rows
            .map(
                buildAccuracyRow
            )
            .filter(Boolean);

    if (
        accuracyRows.length === 0
    ) {

        return {
            success:
                true,

            skipped:
                true,

            reason:
                "No valid trade predictions"
        };
    }

    return postToGoogleSheet({

        action:
            "appendRows",

        sheet:
            "ACCURACY",

        headers:
            ACCURACY_COLUMNS,

        rows:
            accuracyRows,

        timestamp:
            new Date().toISOString()
    });
}

// ============================================================
// PARAMETER SOURCE MAP
// ============================================================
//
// Convert scanner field names into the parameter master names.
//

const PARAMETER_FIELD_MAP = {

    "Stock":
        "stock",

    "Symbol":
        "symbol",

    "Price":
        "price",

    "Direction":
        "direction",

    "Stock Direction":
        "stockDirection",

    "Technical Direction":
        "technicalDirection",

    "Signal":
        "signal",

    "EMA 5":
        "ema5",

    "EMA 9":
        "ema9",

    "EMA 20":
        "ema20",

    "EMA 50":
        "ema50",

    "EMA 100":
        "ema100",

    "EMA 200":
        "ema200",

    "RSI":
        "rsi",

    "MACD":
        "macd",

    "MACD Signal":
        "macdSignal",

    "MACD Histogram":
        "histogram",

    "ADX":
        "adx",

    "PDI":
        "pdi",

    "MDI":
        "mdi",

    "VWAP":
        "vwap",

    "Supertrend":
        "supertrend",

    "ATR":
        "atr",

    "Bollinger Upper":
        "bollingerUpper",

    "Bollinger Middle":
        "bollingerMiddle",

    "Bollinger Lower":
        "bollingerLower",

    "Volume":
        "volume",

    "Volume SMA20":
        "volumeSMA20",

    "RVOL":
        "rvol",

    "Volume Spike":
        "volumeSpike",

    "OBV":
        "obv",

    "MFI":
        "mfi",

    "Breakout":
        "breakout",

    "Breakout Type":
        "breakoutType",

    "Breakout Strength":
        "breakoutStrength",

    "Breakout Score":
        "breakoutScore",

    "Above Resistance":
        "aboveResistance",

    "Below Support":
        "belowSupport",

    "Daily Trend":
        "dailyTrend",

    "4H Trend":
        "fourHourTrend",

    "1H Trend":
        "oneHourTrend",

    "15M Trend":
        "fifteenMinTrend",

    "MTF Score":
        "mtfScore",

    "MTF Alignment":
        "mtfAlignment",

    "Pivot":
        "pivot",

    "Pivot R1":
        "pivotR1",

    "Pivot R2":
        "pivotR2",

    "Pivot S1":
        "pivotS1",

    "Pivot S2":
        "pivotS2",

    "CPR Top":
        "cprTop",

    "CPR Bottom":
        "cprBottom",

    "CPR Width":
        "cprWidth",

    "Support 1":
        "support1",

    "Support 2":
        "support2",

    "Resistance 1":
        "resistance1",

    "Resistance 2":
        "resistance2",

    "OI Support 1":
        "oiSupport1",

    "OI Support 2":
        "oiSupport2",

    "OI Resistance 1":
        "oiResistance1",

    "OI Resistance 2":
        "oiResistance2",

    "Max Pain":
        "maxPain",

    "Call OI":
        "callOI",

    "Put OI":
        "putOI",

    "PCR":
        "pcr",

    "OI Mood":
        "oiMood",

    "OI Sentiment":
        "oiSentiment",

    "Entry":
        "entry",

    "Stop Loss":
        "stopLoss",

    "Target 1":
        "target1",

    "Target 2":
        "target2",

    "Risk/Reward":
        "riskReward",

    "Confidence":
        "confidence",

    "Quality Gates":
        "qualityGates"
};

// ============================================================
// PARAMETER MASTER
// ============================================================
//
// FINAL STRUCTURE:
//
// Stage
// Parameter
// Interpretation
// CALL Points
// PUT Points
// Source File
// Source Function
// STOCK1
// STOCK2
// STOCK3
// ...
//
// Every stock becomes a column.
//
// Every parameter remains a row.
//

function buildParameterMasterPayload(
    scannerData
) {

    const rows =
        normalizeRows(
            scannerData
        );

    const uniqueStocks = [];

    for (
        const row of rows
    ) {

        const stock =
            String(
                firstValid(
                    row.stock,
                    row.symbol
                )
            )
                .trim();

        if (
            stock &&
            !uniqueStocks.includes(stock)
        ) {

            uniqueStocks.push(
                stock
            );
        }
    }

    const headers = [

        ...PARAMETER_MASTER_BASE_COLUMNS,

        ...uniqueStocks
    ];

    const outputRows = [];

    for (
        const definition
        of PARAMETER_DEFINITIONS
    ) {

        const field =
            PARAMETER_FIELD_MAP[
                definition.parameter
            ];

        const row = [

            definition.stage,

            definition.parameter,

            definition.interpretation,

            definition.callPoints,

            definition.putPoints,

            definition.sourceFile,

            definition.sourceFunction
        ];

        for (
            const stock
            of uniqueStocks
        ) {

            const source =
                rows.find(
                    item => {

                        const itemStock =
                            String(
                                firstValid(
                                    item.stock,
                                    item.symbol
                                )
                            )
                                .trim();

                        return (
                            itemStock ===
                            stock
                        );
                    }
                );

            if (
                !source ||
                !field
            ) {

                row.push("");

                continue;
            }

            row.push(
                cleanValue(
                    getValue(
                        source,
                        field
                    )
                )
            );
        }

        outputRows.push(row);
    }

    return {
        headers,
        rows:
            outputRows
    };
}

// ============================================================
// PARAMETER MASTER UPLOAD
// ============================================================

async function uploadParameterMaster(
    scannerData
) {

    const payload =
        buildParameterMasterPayload(
            scannerData
        );

    return postToGoogleSheet({

        action:
            "replaceSheet",

        sheet:
            "PARAMETER_MASTER",

        clearFirst:
            true,

        headers:
            payload.headers,

        rows:
            payload.rows,

        timestamp:
            new Date().toISOString()
    });
}

// ============================================================
// PARAMETER LIST
// ============================================================
//
// Static source reference.
// This is kept for compatibility and audit purposes.
//

function buildParameterListRows() {

    return PARAMETER_DEFINITIONS.map(
        (item, index) => [

            index + 1,

            item.stage,

            item.parameter,

            "",

            "",

            "",

            item.interpretation,

            item.callPoints,

            item.putPoints,

            item.sourceFile,

            item.sourceFunction,

            "ACTIVE",

            ""
        ]
    );
}

async function uploadParameterList() {

    return postToGoogleSheet({

        action:
            "replaceSheet",

        sheet:
            "Parameter List",

        clearFirst:
            true,

        headers:
            PARAMETER_LIST_COLUMNS,

        rows:
            buildParameterListRows(),

        timestamp:
            new Date().toISOString()
    });
}

// ============================================================
// MAIN UPDATE FUNCTION
// ============================================================
//
// Supports:
//
// updateGoogleSheet(results)
//
// OR:
//
// updateGoogleSheet({
//     scannerData: results,
//     dashboardData: results,
//     accuracyData: results
// })
//
// ============================================================

async function updateGoogleSheet(
    input = {}
) {

    let scannerData =
        input;

    let dashboardData =
        null;

    let accuracyData =
        null;

    // --------------------------------------------------------
    // WRAPPER OBJECT
    // --------------------------------------------------------

    if (
        input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        (
            input.scannerData !== undefined ||
            input.dashboardData !== undefined ||
            input.accuracyData !== undefined
        )
    ) {

        scannerData =
            input.scannerData || [];

        dashboardData =
            input.dashboardData ||
            scannerData;

        accuracyData =
            input.accuracyData ||
            scannerData;
    }

    // --------------------------------------------------------
    // SAFETY
    // --------------------------------------------------------

    const safeScannerData =
        normalizeRows(
            scannerData
        );

    const safeDashboardData =
        normalizeRows(
            dashboardData ||
            safeScannerData
        );

    const safeAccuracyData =
        normalizeRows(
            accuracyData ||
            safeScannerData
        );

    const results = {};

    // ========================================================
    // SCANNER
    // ========================================================

    results.scanner =
        await uploadScannerData(
            safeScannerData
        );

    console.log(
        `📊 SCANNER uploaded: ${safeScannerData.length}`
    );

    // ========================================================
    // DASHBOARD
    // ========================================================

    results.dashboard =
        await uploadDashboardData(
            safeDashboardData
        );

    // ========================================================
    // ACCURACY
    // ========================================================

    results.accuracy =
        await uploadAccuracyData(
            safeAccuracyData
        );

    // ========================================================
    // PARAMETER MASTER
    // ========================================================

    results.parameterMaster =
        await uploadParameterMaster(
            safeScannerData
        );

    console.log(
        "📋 PARAMETER_MASTER updated automatically."
    );

    // ========================================================
    // PARAMETER LIST
    // ========================================================

    results.parameterList =
        await uploadParameterList();

    console.log(
        "📋 Parameter List updated automatically."
    );

    // ========================================================
    // FINAL
    // ========================================================

    return {

        success:
            true,

        scannerRows:
            safeScannerData.length,

        dashboardRows:
            safeDashboardData
                .filter(
                    isValidDashboardTrade
                )
                .slice(
                    0,
                    DASHBOARD_MAX_ROWS
                )
                .length,

        accuracyRows:
            safeAccuracyData
                .map(
                    buildAccuracyRow
                )
                .filter(Boolean)
                .length,

        parameterRows:
            PARAMETER_DEFINITIONS.length,

        ...results
    };
}

// ============================================================
// ALIASES
// ============================================================

const uploadToGoogleSheet =
    uploadScannerData;

const sendToGoogleSheet =
    uploadScannerData;

const sendScannerData =
    uploadScannerData;

const sendDashboardData =
    uploadDashboardData;

const sendAccuracyData =
    uploadAccuracyData;

const sendParameterMaster =
    uploadParameterMaster;

const sendParameterList =
    uploadParameterList;

// ============================================================
// GETTERS
// ============================================================

function getScannerColumns() {

    return [
        ...CLEAN_SCANNER_COLUMNS
    ];
}

function getDashboardColumns() {

    return [
        ...DASHBOARD_COLUMNS
    ];
}

function getAccuracyColumns() {

    return [
        ...ACCURACY_COLUMNS
    ];
}

function getParameterMasterColumns() {

    return [
        ...PARAMETER_MASTER_BASE_COLUMNS
    ];
}

function getParameterListColumns() {

    return [
        ...PARAMETER_LIST_COLUMNS
    ];
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    // Main
    updateGoogleSheet,

    // Upload functions
    uploadScannerData,
    uploadDashboardData,
    uploadAccuracyData,
    uploadParameterMaster,
    uploadParameterList,

    uploadAll:
        updateGoogleSheet,

    // Compatibility aliases
    uploadToGoogleSheet,
    sendToGoogleSheet,
    sendScannerData,
    sendDashboardData,
    sendAccuracyData,
    sendParameterMaster,
    sendParameterList,

    // Builders
    buildRow,
    buildAccuracyRow,
    buildParameterMasterPayload,

    // Helpers
    normalizeRows,
    isValidDashboardTrade,
    getDashboardConfidence,
    getIndiaDateParts,

    // Column definitions
    CLEAN_SCANNER_COLUMNS,
    DASHBOARD_COLUMNS,
    ACCURACY_COLUMNS,
    PARAMETER_MASTER_BASE_COLUMNS,
    PARAMETER_LIST_COLUMNS,

    // Parameter definitions
    PARAMETER_DEFINITIONS,

    // Getters
    getScannerColumns,
    getDashboardColumns,
    getAccuracyColumns,
    getParameterMasterColumns,
    getParameterListColumns,

    // Dashboard constants
    DASHBOARD_MIN_SCORE,
    DASHBOARD_MAX_ROWS
};