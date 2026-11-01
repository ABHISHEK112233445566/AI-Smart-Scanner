const assert=require('assert');
const {marketSetup}=require('./optionsDecisionEngine');
const {calculateFinalRank}=require('./rankingEngine');

const put=marketSetup({supportLevels:[97,94,90],resistanceLevels:[102],direction:'BEARISH'},100,'PUT');
assert.strictEqual(put.valid,true,'bearish setup must use resistance as stop and support as target');
assert.strictEqual(put.stopLoss,102);
assert.strictEqual(put.target1,97);
assert.strictEqual(put.riskReward,1.5);

const call=marketSetup({supportLevels:[98],resistanceLevels:[103,106],direction:'BULLISH'},100,'CALL');
assert.strictEqual(call.valid,true,'bullish setup must use support as stop and resistance as target');
assert.strictEqual(call.stopLoss,98);
assert.strictEqual(call.target1,103);

const invalidRank=calculateFinalRank({direction:'BEARISH',score:90,stockEntry:100,stockStopLoss:102,stockTarget1:0,stockRiskReward:2,mtfScore:100,volumeConfirmed:true});
assert.strictEqual(invalidRank.validatedRR,0,'missing stock target must never earn RR credit');
assert.strictEqual(invalidRank.rrScore,0,'missing stock target must never earn RR score');

const validRank=calculateFinalRank({direction:'BEARISH',score:70,stockEntry:100,stockStopLoss:102,stockTarget1:97,stockRiskReward:1.5,mtfScore:80,volumeConfirmed:true});
assert.strictEqual(validRank.validatedRR,1.5,'bearish RR must be recomputed from underlying levels');
assert.strictEqual(validRank.rrScore,5);

console.log('Trade setup and RR regression tests passed');
