function toNumber(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;} function clamp(v,min,max){return Math.max(min,Math.min(max,v));} function normalizeSignedScore(v){return clamp(toNumber(v),-100,100);} function normalizeDirection(v){const d=String(v||'').trim().toUpperCase();if(['CALL','CE','BULLISH','BUY','UP','LONG'].includes(d))return'BULLISH';if(['PUT','PE','BEARISH','SELL','DOWN','SHORT'].includes(d))return'BEARISH';return'SIDEWAYS';} function isConfirmed(v){if(v===true)return true;if(typeof v!=='string')return false;return['TRUE','YES','CONFIRMED'].includes(v.trim().toUpperCase());}
function getValidatedRR(stock,direction){
  const entry=toNumber(stock?.stockEntry??stock?.entry??stock?.underlyingEntry??stock?.marketEntry??stock?.price);
  const stop=toNumber(stock?.stockStopLoss??stock?.stopLoss);
  const target=toNumber(stock?.stockTarget1??stock?.target1);
  const d=normalizeDirection(direction??stock?.direction??stock?.stockDirection??stock?.optionType);
  if(entry<=0||stop<=0||target<=0||d==='SIDEWAYS'||stop===entry)return 0;
  const risk=d==='BULLISH'?entry-stop:stop-entry;
  const reward=d==='BULLISH'?target-entry:entry-target;
  if(!(risk>0&&reward>0))return 0;
  const actual=reward/risk;
  const reported=toNumber(stock?.stockRiskReward??stock?.riskReward??stock?.rr);
  // A supplied RR is accepted only when it agrees with the geometry of the
  // same underlying-stock entry, stop and first target.
  if(reported>0&&Math.abs(reported-actual)>Math.max(0.15,actual*0.12))return 0;
  return Number(actual.toFixed(2));
}
function calculateRiskRewardScore(stock,direction){const rr=getValidatedRR(stock,direction);if(rr>=3)return 10;if(rr>=2)return 8;if(rr>=1.5)return 5;if(rr>=1.2)return 3;return 0;} function calculateBreakoutScore(stock){if(!isConfirmed(stock?.breakout))return 0;const s=String(stock?.breakoutStrength||'').trim().toUpperCase();if(s==='VERY STRONG')return 15;if(s==='STRONG')return 12;if(s==='MEDIUM')return 8;if(s==='WEAK')return 4;return 0;} function calculateAdxScore(stock){const a=toNumber(stock?.adx??stock?.adxValue??stock?.ADX);if(a>=35)return 10;if(a>=25)return 7;if(a>=20)return 4;return 0;} function calculateVolumeScore(stock){if(isConfirmed(stock?.volumeConfirmed)||isConfirmed(stock?.volumeSpike))return 10;return toNumber(stock?.rvol)>=1.2?10:0;} function calculateMomentumScore(stock){return clamp(Math.round(toNumber(stock?.momentumScore)*2),0,10);} function calculateMtfScore(stock,direction){const raw=toNumber(stock?.mtfScore??stock?.mtf?.score??stock?.mtfConfirmationScore);if(!Number.isFinite(raw))return 0;const d=normalizeDirection(direction);/* MTF scores may be signed. For a bearish setup, -75 means 75 points of bearish alignment, not zero. */return d==='BEARISH'?clamp(Math.abs(raw),0,100):clamp(raw,0,100);}
function getPattern(stock){
    const b=stock?.breakout&&typeof stock.breakout==='object'?stock.breakout:{};
    let pattern=String(stock?.chartPattern??b.chartPattern??'').trim();
    let status=String(stock?.patternStatus??b.patternStatus??'').trim().toUpperCase();
    let direction=normalizeDirection(stock?.patternDirection??b.patternDirection);
    let confidence=clamp(toNumber(stock?.patternConfidence??b.patternConfidence),0,100);
    let score=clamp(toNumber(stock?.patternScore??b.patternScore),0,10);
    if((!pattern||pattern==='NONE')&&(!score||score===0)){
        try{
            const ctx=require('./patternContext').getForStock(stock);
            if(ctx){
                pattern=String(ctx.chartPattern??'NONE').trim();
                status=String(ctx.patternStatus??'NONE').trim().toUpperCase();
                direction=normalizeDirection(ctx.patternDirection);
                confidence=clamp(toNumber(ctx.patternConfidence),0,100);
                score=clamp(toNumber(ctx.patternScore),0,10);
            }
        }catch(_){/* pattern context is optional */}
    }
    return{pattern:pattern||'NONE',status:status||'NONE',direction,confidence,score};
}
function calculatePatternContribution(stock,finalDirection){const p=getPattern(stock);if(!p.pattern||p.pattern==='NONE'||p.direction==='SIDEWAYS'||p.score<=0)return{...p,contribution:0};let magnitude=Math.round(p.score*(p.confidence>=90?1:p.confidence>=80?.8:p.confidence>=70?.6:.4));if(p.status==='BUILDING')magnitude=Math.round(magnitude*.7);if(p.status==='NONE'||p.status==='FAILED')magnitude=0;magnitude=clamp(magnitude,0,7);const contribution=(p.direction===finalDirection?magnitude:-magnitude);return{...p,contribution};}
function getRating(score,direction){const m=Math.abs(normalizeSignedScore(score));direction=normalizeDirection(direction);if(direction==='BULLISH')return m>=90?'⭐⭐⭐⭐⭐ ELITE BUY':m>=85?'⭐⭐⭐⭐ STRONG BUY':m>=70?'⭐⭐⭐ BUY':'⭐⭐ WATCH';if(direction==='BEARISH')return m>=90?'⭐⭐⭐⭐⭐ ELITE SELL':m>=85?'⭐⭐⭐⭐ STRONG SELL':m>=70?'⭐⭐⭐ SELL':'⭐⭐ WATCH';return '⭐⭐ WATCH';}
function calculateFinalRank(stock){if(!stock||typeof stock!=='object')return{finalScore:0,rating:'❌ AVOID',direction:'SIDEWAYS',aiScore:0,mtfScore:0,breakoutScore:0,volumeScore:0,adxScore:0,momentumScore:0,rrScore:0,patternScore:0,patternContribution:0,validatedRR:0,is85Plus:false};const direction=normalizeDirection(stock.direction??stock.trend??stock.optionType??stock.signalDirection),rawAi=normalizeSignedScore(stock.score??stock.aiScore),aiStrength=Math.abs(rawAi),mtfScore=calculateMtfScore(stock,direction),breakoutScore=calculateBreakoutScore(stock),volumeScore=calculateVolumeScore(stock),adxScore=calculateAdxScore(stock),momentumScore=calculateMomentumScore(stock),validatedRR=getValidatedRR(stock,direction),rrScore=calculateRiskRewardScore(stock,direction),pattern=calculatePatternContribution(stock,direction);const magnitude=Math.round(clamp(aiStrength*.40+mtfScore*.20+breakoutScore+volumeScore+adxScore+momentumScore+rrScore+pattern.contribution,0,100));const aiDirection=rawAi>0?'BULLISH':rawAi<0?'BEARISH':'SIDEWAYS',finalDirection=direction!=='SIDEWAYS'?direction:aiDirection,finalScore=finalDirection==='BULLISH'?magnitude:finalDirection==='BEARISH'?-magnitude:0;stock.aiFinalScore=finalScore;stock.rankingScore=finalScore;stock.finalScore=finalScore;return{finalScore,rating:getRating(finalScore,finalDirection),direction:finalDirection,aiScore:Number(rawAi.toFixed(2)),aiStrength:Number(aiStrength.toFixed(2)),mtfScore:Number(mtfScore.toFixed(2)),breakoutScore,volumeScore,adxScore,momentumScore,rrScore,patternScore:pattern.score,patternConfidence:pattern.confidence,patternContribution:pattern.contribution,patternStatus:pattern.status,chartPattern:pattern.pattern,patternDirection:pattern.direction,validatedRR,rrValidated:validatedRR>0,is85Plus:Math.abs(finalScore)>=85};}
module.exports={calculateFinalRank,calculatePatternContribution};
