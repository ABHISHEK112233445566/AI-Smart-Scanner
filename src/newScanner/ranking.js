"use strict";

const { LIMITS } = require("./schema");

function directionalEdge(row) {
  const a = row?.directionalAnalysis || {};
  const direction = a.direction;
  if (!["BULLISH", "BEARISH"].includes(direction)) return 0;
  const rows = row?.timeframeAnalysis?.rows || [];
  const valid = rows.filter(x => x?.dataStatus === "VALID" && ["BULLISH", "BEARISH"].includes(x.direction));
  if (!valid.length) return direction === "BULLISH"
    ? Number(a.bullScore || 0) - Number(a.bearScore || 0)
    : Number(a.bearScore || 0) - Number(a.bullScore || 0);
  const weights = { daily: 1.5, fourHour: 1.4, oneHour: 1.2, fifteenMinute: 1, fiveMinute: 1 };
  let total = 0, weightTotal = 0;
  for (const frame of valid) {
    const w = weights[frame.timeframe] || 1;
    const bull = Number(frame.bullScore ?? 0), bear = Number(frame.bearScore ?? 0);
    const edge = frame.direction === "BULLISH" ? bull - bear : bear - bull;
    const signed = direction === "BULLISH" ? edge : -edge;
    total += signed * w;
    weightTotal += w;
  }
  return weightTotal ? total / weightTotal : 0;
}

function candidateScore(row) {
  const a = row.directionalAnalysis || {};
  const edge = Math.max(0, Math.min(100, directionalEdge(row)));
  const direction = a.direction;
  const oi = row.oi || {};
  const oiMood = String(oi.mood || oi.sentiment || "").toUpperCase();
  const oiConflict = direction === "BULLISH"
    ? /BEARISH|SHORT_BUILDUP|LONG_UNWINDING/.test(oiMood)
    : direction === "BEARISH" && /BULLISH|LONG_BUILDUP|SHORT_COVERING/.test(oiMood);
  const rr = Number(row.optionPremiumSetup?.riskReward) || 0;
  const rrPoints = Math.min(5, Math.max(0, rr * 2));
  const volume = Number(row.quote?.volume) || 0;
  const volumePoints = volume > 0 ? Math.min(3, Math.log10(volume)) : 0;
  let score = edge * 0.75 + rrPoints + volumePoints;
  if (oiConflict) score -= 12;
  if (oiMood === "UNKNOWN" || !oiMood) score -= 3;
  if (row.marketDataFresh === false) score = Math.min(score, 45);
  return Math.max(0, Math.min(100, Math.round(score)));
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
module.exports={candidateScore,rankCandidates,dashboardRows,validatedUnderlyingStructure,directionalEdge};
