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
  const newsPoints=(news==="BULLISH"&&a.direction==="BULLISH")||(news==="BEARISH"&&a.direction==="BEARISH")?5:0;
  return Math.min(100,Math.round(evidence*.55+aligned*4+Math.min(10,rr*3)+volumePoints+newsPoints));
}

function validatedUnderlyingStructure(row) {
  const s=row?.underlyingLevels||{};
  const direction=row?.directionalAnalysis?.direction;
  const entry=Number(s.entry),stop=Number(s.stopLoss),target=Number(s.target);
  const validNumbers=[entry,stop,target].every(v=>Number.isFinite(v)&&v>0);
  if(!validNumbers||s.valid!==true||!["BULLISH","BEARISH"].includes(direction))return false;
  const risk=direction==="BULLISH"?entry-stop:stop-entry;
  const reward=direction==="BULLISH"?target-entry:entry-target;
  if(!(risk>0&&reward>0))return false;
  const calculatedRR=reward/risk;
  const reportedRR=Number(s.riskReward);
  return Number.isFinite(reportedRR)&&calculatedRR>=1.5&&reportedRR>=1.5&&
    Math.abs(reportedRR-calculatedRR)<=Math.max(0.02,calculatedRR*0.02);
}

function rankCandidates(rows) {
  // Keep directional WATCH candidates in SCANNER for diagnostics. A WATCH row
  // may have incomplete option data or invalid structure, so it must not be
  // promoted to the compact Dashboard where no decision/rejection column exists.
  const candidates=(Array.isArray(rows)?rows:[]).filter(r=>
    ["BULLISH","BEARISH"].includes(r.directionalAnalysis?.direction) &&
    r.directionalAnalysis?.dataStatus==="VALID" &&
    ["TRADE","WATCH"].includes(r.decision)
  );
  const sorted=candidates.map(r=>({...r,confidence:candidateScore(r)}))
    .sort((a,b)=>b.confidence-a.confidence||
      (Number(b.optionPremiumSetup?.riskReward)||0)-(Number(a.optionPremiumSetup?.riskReward)||0));
  const selected=sorted.slice(0,LIMITS.SCANNER_ROWS);
  const nifty=sorted.find(r=>(r.isNiftyIndex===true||String(r.symbol).toUpperCase()==="NIFTY")&&validatedUnderlyingStructure(r));
  if(nifty&&!selected.some(r=>r.symbol===nifty.symbol)){
    if(selected.length>=LIMITS.SCANNER_ROWS)selected[selected.length-1]=nifty;
    else selected.push(nifty);
  }
  return selected.map((r,i)=>({...r,scannerRank:i+1}));
}

function dashboardRows(rows) {
  // Dashboard has no decision/rejection column. Only publish rows with a
  // complete, directionally correct underlying plan and independently
  // recomputed structural RR >= 1.5. Keep rejected/WATCH diagnostics in SCANNER.
  const sorted=(Array.isArray(rows)?rows:[]).filter(r=>
    ["TRADE","WATCH"].includes(r.decision)&&validatedUnderlyingStructure(r)
  ).sort((a,b)=>b.confidence-a.confidence);
  const selected=sorted.slice(0,LIMITS.DASHBOARD_ROWS);
  const nifty=sorted.find(r=>r.isNiftyIndex===true||String(r.symbol).toUpperCase()==="NIFTY");
  if(nifty&&!selected.some(r=>r.symbol===nifty.symbol)){
    if(selected.length>=LIMITS.DASHBOARD_ROWS)selected[selected.length-1]=nifty;
    else selected.push(nifty);
  }
  return selected;
}
module.exports={candidateScore,rankCandidates,dashboardRows,validatedUnderlyingStructure};
