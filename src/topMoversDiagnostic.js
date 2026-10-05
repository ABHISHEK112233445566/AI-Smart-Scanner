require("dotenv").config();

const { scanInBatches } = require("./appV14");
const { calculateOptionsDecisions } = require("./optionsDecisionEngine");
const { getUnderlyingOIMood } = require("./underlyingOI");

const TOP_MOVERS = ["ITC","BSE","TMPV","SHRIRAMFIN","BAJFINANCE","BHARTIARTL","ETERNAL","NTPC","ADANIPORTS","TCS"];
const key = r => String(r?.stock ?? r?.symbol ?? "").trim().toUpperCase();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

async function enrichUnderlyingOI(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const out = [];
  const concurrency = Math.max(4, Number(process.env.OI_ENRICH_CONCURRENCY || 8));
  for (let i = 0; i < source.length; i += concurrency) {
    const batch = source.slice(i, i + concurrency);
    const checked = await Promise.all(batch.map(async row => {
      try {
        const oi = await getUnderlyingOIMood({
          instrumentKey: row.instrumentKey,
          currentPrice: num(row.currentPrice ?? row.price),
          previousPrice: num(row.previousPrice ?? row.prevPrice ?? row.previousClose),
        });
        return { ...row, oiCheckAttempted:true, oiMood:oi.mood||"UNKNOWN", oiSentiment:oi.sentiment||"UNKNOWN", oiDataAvailable:oi.dataAvailable===true, oiPriceChangePercent:num(oi.priceChangePercent), oiChangePercent:num(oi.oiChangePercent), oi:num(oi.oi), previousOI:num(oi.previousOI), underlyingOISource:oi.source||"", underlyingOIReason:oi.reason||"" };
      } catch (e) {
        return { ...row, oiCheckAttempted:true, oiMood:"UNKNOWN", oiSentiment:"UNKNOWN", oiDataAvailable:false, oiPriceChangePercent:0, oiChangePercent:0, underlyingOIReason:"ENRICHMENT_FAILED:"+(e?.message||e) };
      }
    }));
    out.push(...checked);
  }
  return out;
}

function diagnosticRow(r) {
  return {
    stock:key(r), price:r.currentPrice??r.price, direction:r.direction, scannerScore:r.scannerScore, aiScore:r.aiScore, aiFinalScore:r.aiFinalScore, aiRating:r.aiRating, signal:r.signal, confidence:r.confidence,
    oiMood:r.oiMood, oiSentiment:r.oiSentiment, oiChangePercent:r.oiChangePercent,
    chartPattern:r.chartPattern, patternStatus:r.patternStatus, patternDirection:r.patternDirection, patternConfidence:r.patternConfidence, patternScore:r.patternScore, patternContribution:r.patternContribution, patternConflict:r.patternConflict,
    breakout:r.breakout, breakoutType:r.breakoutType, breakoutStrength:r.breakoutStrength,
    volumeConfirmed:r.volumeConfirmed, volumeConfirmed5:r.volumeConfirmed5, volumeQuality:r.volumeQuality, volumeRatio5:r.volumeRatio5, rvol:r.rvol, volumeSpike:r.volumeSpike,
    trendConfirmed:r.trendConfirmed, momentumConfirmed:r.momentumConfirmed, momentumScore:r.momentumScore,
    dailyTrend:r.dailyTrend, fourHourTrend:r.fourHourTrend, oneHourTrend:r.oneHourTrend, fifteenMinTrend:r.fifteenMinTrend, mtfScore:r.mtfScore, mtfAlignment:r.mtfAlignment,
    rsi:r.rsi, macd:r.macd, macdSignal:r.macdSignal, histogram:r.histogram, adx:r.adx, pdi:r.pdi, mdi:r.mdi, vwap:r.vwap,
    entry:r.entry, stopLoss:r.stopLoss, target1:r.target1, target2:r.target2, riskReward:r.riskReward, qualified:r.qualified, rejectionReason:r.rejectionReason||"",
    optionType:r.optionType, optionsDecision:r.optionsDecision, decisionReason:r.decisionReason||r.reason||"", optionsConfidence:r.optionsConfidence, optionEligible:r.optionEligible, optionLiquidityConfirmed:r.optionLiquidityConfirmed, optionPremiumEntry:r.optionPremiumEntry, optionPremiumRiskReward:r.optionPremiumRiskReward,
    optionsTradeGatePassed:r.pipeline?.optionsTradeGatePassed===true, staleEntryTrigger:r.pipeline?.staleEntryTrigger===true, waitingForStockTrigger:r.pipeline?.waitingForStockTrigger===true, failedBaseGates:r.gates?.failedBase||[], failedTradeGates:r.gates?.failedTrade||[]
  };
}

async function main() {
  console.log("\n=== TOP-MOVERS DIAGNOSTIC | ISOLATED FROM ORIGINAL SCANNER ===");
  console.log("Original scanner universe, sheets, dashboard and scheduler are NOT modified.");
  console.log("Diagnostic symbols: "+TOP_MOVERS.join(", ")+"\n");
  const scan = await scanInBatches(TOP_MOVERS);
  const oiRows = await enrichUnderlyingOI(scan.allResults);
  let decisions = [];
  try { decisions = await calculateOptionsDecisions(oiRows); } catch (e) { console.error("Options diagnostic failed: "+(e?.message||e)); }
  const bySymbol = new Map(decisions.map(r => [key(r), r]));
  const merged = TOP_MOVERS.map(symbol => bySymbol.get(symbol) || oiRows.find(r => key(r) === symbol) || {stock:symbol, symbol, qualified:false, rejectionReason:"NO_RESULT"});
  const report = merged.map(diagnosticRow);
  console.log(JSON.stringify({ diagnosticOnly:true, originalScannerChanged:false, originalSheetsChanged:false, originalDashboardChanged:false, originalSchedulerChanged:false, scanDate:"2026-10-05", results:report }, null, 2));
  console.log("\n=== DIAGNOSTIC SUMMARY ===");
  for (const r of report) { const failures=[...(r.failedBaseGates||[]), ...(r.failedTradeGates||[])]; console.log(r.stock.padEnd(14)+" score="+String(r.aiFinalScore??"").padStart(4)+" qualified="+String(r.qualified).padEnd(5)+" decision="+String(r.optionsDecision||"N/A").padEnd(6)+" fail="+(failures.join("|")||r.rejectionReason||"NONE")); }
}

if (require.main === module) main().catch(error => { console.error("FATAL: "+(error?.stack||error)); process.exitCode=1; });
module.exports = { TOP_MOVERS, main, enrichUnderlyingOI, diagnosticRow };