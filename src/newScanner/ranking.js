"use strict";

const { LIMITS } = require("./schema");

function candidateScore(row) {
  const a=row.directionalAnalysis||{}, t=row.timeframeAnalysis||{};
  const evidence=Math.max(a.bullScore||0,a.bearScore||0);
  const aligned=Math.max(t.bullishTimeframes||0,t.bearishTimeframes||0);
  const rr=Number(row.optionPremiumSetup?.riskReward)||0;
  const volume=Number(row.quote?.volume)||0;
  const volumePoints=volume>0?Math.min(5,Math.log10(volume)):0;
  const news=row.news?.direction;
  const newsPoints=news==="BULLISH"&&a.direction==="BULLISH"||news==="BEARISH"&&a.direction==="BEARISH"?5:0;
  return Math.min(100,Math.round(evidence*.55+aligned*4+Math.min(10,rr*3)+volumePoints+newsPoints));
}
function rankCandidates(rows) {
  const eligible=(Array.isArray(rows)?rows:[]).filter(r=>r.riskValidation?.passed===true);
  return eligible.map(r=>({...r,confidence:candidateScore(r)}))
    .sort((a,b)=>b.confidence-a.confidence||b.optionPremiumSetup.riskReward-a.optionPremiumSetup.riskReward)
    .slice(0,LIMITS.SCANNER_ROWS).map((r,i)=>({...r,scannerRank:i+1}));
}
function dashboardRows(rows) {
  return [...rows].filter(r=>["TRADE","WATCH"].includes(r.decision))
    .sort((a,b)=>b.confidence-a.confidence).slice(0,LIMITS.DASHBOARD_ROWS);
}
module.exports={candidateScore,rankCandidates,dashboardRows};
