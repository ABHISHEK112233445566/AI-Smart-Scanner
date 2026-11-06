const assert=require("assert");
const {calculateMtfScore,calculateFinalRank}=require("./rankingEngine");
assert.strictEqual(calculateMtfScore({mtfScore:-75},"BEARISH"),75,
  "negative MTF score should support bearish direction");
assert.strictEqual(calculateMtfScore({mtfScore:75},"BEARISH"),0,
  "positive bullish MTF score must not support bearish direction");
assert.strictEqual(calculateMtfScore({mtfScore:75},"BULLISH"),75,
  "positive MTF score should support bullish direction");
assert.strictEqual(calculateMtfScore({mtfScore:-75},"BULLISH"),0,
  "negative bearish MTF score must not support bullish direction");
assert.strictEqual(calculateMtfScore({mtfScore:-75},"SIDEWAYS"),0);
const bullish={direction:"BULLISH",score:80,mtfScore:-75};
const bearish={direction:"BEARISH",score:-80,mtfScore:75};
assert.strictEqual(calculateFinalRank(bullish).mtfScore,0);
assert.strictEqual(calculateFinalRank(bearish).mtfScore,0);
console.log("Ranking MTF direction regression tests passed");
