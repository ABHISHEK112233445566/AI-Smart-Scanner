require("dotenv").config();

const symbolUniverses = require("./symbols");
const { setBroker, getActiveBroker } = require("./brokers");
const { loadSymbolMaster } = require("./services/symbolService");
const { scanStocks } = require("./scanner");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { updateGoogleSheet } = require("./googleSheet");
const { updateStrategySheets } = require("./strategySheets");
const { buildDashboard } = require("./dashboard");
const { createAccuracyRecord } = require("./accuracyTracker");

const DASHBOARD_MIN_CONFIDENCE = 85;
const FINAL_TOP_COUNT = 5;

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeDecision(row) {
    return String(row?.optionsDecision ?? row?.decision ?? "")
        .trim()
        .toUpperCase();
}

function getStockKey(row) {
    return String(row?.stock ?? row?.symbol ?? row?.name ?? "")
        .trim()
        .toUpperCase();
}

function normalizeUniverseName(value) {
    return String(value || "ALL")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "");
}

function getConfidence(row) {
    return safeNumber(
        row?.optionsConfidence ??
        row?.optionConfidence ??
        row?.confidence,
        0
    );
}

function getScannerSymbols() {
    const requested = normalizeUniverseName(
        process.env.SCANNER_UNIVERSE || "ALL"
    );

    const aliases = {
        ALL: "ALL",
        ALLSYMBOLS: "ALL",
        NIFTY50: "NIFTY50",
        NIFTY100: "NIFTY100",
        BANKNIFTY: "BANKNIFTY",
        CUSTOM: "CUSTOM"
    };

    const universeName = aliases[requested] || "ALL";
    const selected = symbolUniverses[universeName];

    if (!Array.isArray(selected) || selected.length === 0) {
        throw new Error(
            `Scanner universe '${universeName}' is empty or unavailable.`
        );
    }

    const symbols = [
        ...new Set(
            selected
                .map(symbol => String(symbol || "").trim().toUpperCase())
                .filter(Boolean)
        )
    ];

    return {
        name: universeName,
        symbols
    };
}

function mergeScannerAndOptionData(stocks, decisions) {
    const optionMap = new Map();

    for (const decision of Array.isArray(decisions) ? decisions : []) {
        const key = getStockKey(decision);
        if (key) optionMap.set(key, decision);
    }

    return (Array.isArray(stocks) ? stocks : []).map(stock => {
        const option = optionMap.get(getStockKey(stock));

        if (!option) return stock;

        return {
            ...stock,
            ...option,
            stock: option.stock || stock.stock,
            symbol: option.symbol || stock.symbol || stock.stock
        };
    });
}

function buildAccuracyData(scannerData) {
    const timestamp = new Date();

    return (Array.isArray(scannerData) ? scannerData : [])
        .filter(row => getStockKey(row))
        .map(row => createAccuracyRecord(row, timestamp));
}

function sortOptionDecisions(decisions) {
    if (!Array.isArray(decisions)) return [];

    const rank = {
        TRADE: 3,
        WATCH: 2,
        REJECT: 1
    };

    return [...decisions].sort((a, b) => {
        const decisionDifference =
            (rank[normalizeDecision(b)] || 0) -
            (rank[normalizeDecision(a)] || 0);

        if (decisionDifference !== 0) {
            return decisionDifference;
        }

        const confidenceDifference =
            getConfidence(b) - getConfidence(a);

        if (confidenceDifference !== 0) {
            return confidenceDifference;
        }

        return (
            safeNumber(b?.finalScore ?? b?.score) -
            safeNumber(a?.finalScore ?? a?.score)
        );
    });
}

function getFinalCandidates(optionDecisions) {
    return optionDecisions
        .filter(option => getConfidence(option) >= DASHBOARD_MIN_CONFIDENCE)
        .slice(0, FINAL_TOP_COUNT);
}

async function main() {
    const scanStartedAt = new Date();

    console.log(
        "\n===============================\n" +
        "   AI SMART SCANNER V5\n" +
        "===============================\n"
    );

    // ========================================================
    // BROKER
    // ========================================================

    const brokerName = String(
        process.env.BROKER || "UPSTOX"
    )
        .trim()
        .toUpperCase();

    setBroker(brokerName);

    const activeBroker = getActiveBroker();

    if (
        !activeBroker ||
        typeof activeBroker.login !== "function"
    ) {
        throw new Error(
            "Active broker does not implement login()"
        );
    }

    console.log(`Broker Configuration: ${brokerName}`);
    console.log(
        `Active Broker: ${activeBroker?.name || brokerName}`
    );

    await activeBroker.login();

    console.log("✅ Broker Login Successful\n");

    // ========================================================
    // SYMBOL MASTER
    // ========================================================

    try {
        await loadSymbolMaster();
        console.log(
            "✅ Symbol master loaded successfully.\n"
        );
    } catch (error) {
        console.log(
            `⚠️ Symbol master load skipped: ${error?.message || error}`
        );
    }

    // ========================================================
    // UNIVERSE
    // ========================================================

    const universe = getScannerSymbols();
    const symbols = universe.symbols;

    console.log("========================================");
    console.log(`        ${universe.name} SCANNER`);
    console.log("========================================");
    console.log(`Total Stocks Loaded: ${symbols.length}`);
    console.log(
        "Pipeline: DAILY → DIRECTION → MOMENTUM → MTF → RANK → OPTIONS"
    );
    console.log("========================================\n");

    // ========================================================
    // STOCK SCANNER
    // ========================================================

    const scanResult = await scanStocks(symbols);

    const qualifiedStocks = Array.isArray(scanResult)
        ? scanResult
        : [];

    const allScannerResults =
        Array.isArray(scanResult?.allResults)
            ? scanResult.allResults
            : qualifiedStocks;

    console.log(
        "\n========== STOCK QUALIFICATION =========="
    );
    console.log(
        `Complete universe scanned: ${allScannerResults.length}`
    );
    console.log(
        `Qualified shortlist: ${qualifiedStocks.length}`
    );

    // ========================================================
    // OPTIONS DECISION ENGINE
    // ========================================================

    console.log(
        "\n========== OPTIONS DECISION ENGINE =========="
    );

    let optionDecisions = [];

    try {
        const decisions =
            await calculateOptionsDecisions(
                qualifiedStocks
            );

        optionDecisions = Array.isArray(decisions)
            ? decisions
            : [];
    } catch (error) {
        console.error(
            `❌ Options Decision Engine failed: ${error?.message || error}`
        );
    }

    optionDecisions = sortOptionDecisions(optionDecisions);

    // ========================================================
    // OPTION DECISION LOG
    // ========================================================

    optionDecisions.forEach((option, index) => {
        const entry = safeNumber(option?.entry);
        const stopLoss = safeNumber(option?.stopLoss);
        const target1 = safeNumber(option?.target1);
        const target2 = safeNumber(option?.target2);
        const rr = safeNumber(option?.riskReward);
        const confidence = getConfidence(option);

        console.log(
            `${index + 1}. ${option?.stock || option?.symbol || "N/A"}` +
            ` | ${option?.optionType || "N/A"}` +
            ` | Strike: ${option?.recommendedStrike ?? "N/A"}` +
            ` | Entry: ${entry.toFixed(2)}` +
            ` | SL: ${stopLoss.toFixed(2)}` +
            ` | T1: ${target1.toFixed(2)}` +
            ` | T2: ${target2.toFixed(2)}` +
            ` | R:R: ${rr.toFixed(2)}` +
            ` | Confidence: ${confidence}` +
            ` | ${normalizeDecision(option) || "N/A"}`
        );
    });

    // ========================================================
    // COMPLETE DATASET
    // ========================================================

    const completeScannerData =
        mergeScannerAndOptionData(
            allScannerResults,
            optionDecisions
        );

    // Accuracy must use the complete scanner universe,
    // not only the final TOP candidates.
    const accuracyData =
        buildAccuracyData(completeScannerData);

    // ========================================================
    // FINAL TOP 5
    // ========================================================

    const finalTop5 =
        getFinalCandidates(optionDecisions);

    console.log("\n========== FINAL TOP 5 ==========");

    if (finalTop5.length === 0) {
        console.log(
            `No candidates reached ${DASHBOARD_MIN_CONFIDENCE}+ confidence.`
        );
    }

    finalTop5.forEach((option, index) => {
        console.log(
            `${index + 1}. ${option?.stock || option?.symbol || "N/A"}` +
            ` | ${option?.optionType || "N/A"}` +
            ` | Strike: ${option?.recommendedStrike ?? "N/A"}` +
            ` | Confidence: ${getConfidence(option)}` +
            ` | ${normalizeDecision(option) || "N/A"}`
        );
    });

    // ========================================================
    // GOOGLE SHEETS CORE
    // ========================================================

    try {
        await updateGoogleSheet({
            scannerData: completeScannerData,
            dashboardData: optionDecisions,
            accuracyData
        });

        console.log(
            `📈 Accuracy records prepared: ${accuracyData.length}`
        );
    } catch (error) {
        console.error(
            `⚠️ Google Sheet core update failed: ${error?.message || error}`
        );
    }

    // ========================================================
    // STRATEGY SHEETS
    // EQUITY / CALL / PUT
    // ========================================================

    try {
        const strategyResult =
            await updateStrategySheets(
                completeScannerData,
                optionDecisions
            );

        console.log(
            `📊 Strategy sheets updated | ` +
            `EQUITY: ${strategyResult?.equityRows ?? 0} | ` +
            `CALL: ${strategyResult?.callRows ?? 0} | ` +
            `PUT: ${strategyResult?.putRows ?? 0}`
        );
    } catch (error) {
        console.error(
            `⚠️ Strategy sheet update failed: ${error?.message || error}`
        );
    }

    // ========================================================
    // DASHBOARD
    // ========================================================
    // IMPORTANT:
    // Dashboard receives the COMPLETE scanner universe and ALL
    // option decisions. It must not receive only TOP 5.
    // ========================================================

    let dashboardData = null;

    try {
        if (typeof buildDashboard === "function") {
            dashboardData = await buildDashboard(
                allScannerResults,
                optionDecisions,
                symbols.length
            );

            console.log(
                `📊 Dashboard prepared: ${dashboardData?.top10Count ?? 0} candidates`
            );
        }
    } catch (error) {
        console.error(
            `⚠️ Dashboard update failed: ${error?.message || error}`
        );
    }

    // ========================================================
    // FINAL SUMMARY
    // ========================================================

    const elapsedSeconds = (
        (Date.now() - scanStartedAt.getTime()) /
        1000
    ).toFixed(1);

    console.log(
        "\n========================================\n" +
        "       SCAN COMPLETE\n" +
        "========================================"
    );

    console.log(`Universe: ${universe.name}`);
    console.log(`Universe size: ${symbols.length}`);
    console.log(
        `Complete scanner rows: ${completeScannerData.length}`
    );
    console.log(
        `Accuracy records: ${accuracyData.length}`
    );
    console.log(
        `Qualified stocks: ${qualifiedStocks.length}`
    );
    console.log(
        `Option decisions: ${optionDecisions.length}`
    );
    console.log(
        `Confidence ${DASHBOARD_MIN_CONFIDENCE}+: ${optionDecisions.filter(option => getConfidence(option) >= DASHBOARD_MIN_CONFIDENCE).length}`
    );
    console.log(
        `Final TOP ${FINAL_TOP_COUNT}: ${finalTop5.length}`
    );
    console.log(`Elapsed: ${elapsedSeconds}s`);
    console.log(
        "========================================\n"
    );

    return {
        universe: universe.name,
        scanned: symbols.length,
        allScannerResults,
        qualifiedStocks,
        completeScannerData,
        accuracyData,
        optionDecisions,
        finalTop5,
        dashboardData,
        elapsedSeconds: Number(elapsedSeconds)
    };
}

main().catch(error => {
    console.error("\n❌ Scanner failed:");
    console.error(error?.message || error);
    process.exitCode = 1;
});
