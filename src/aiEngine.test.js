const assert=require("assert");
const {calculateBullishScore,calculateBearishScore}=require("./aiEngine");
assert.strictEqual(calculateBullishScore({obvTrend:"BULLISH"},100),5,
  "a rising OBV trend should contribute the existing bullish OBV weight");
assert.strictEqual(calculateBearishScore({obvTrend:"BEARISH"},100),5,
  "a falling OBV trend should contribute the existing bearish OBV weight");
assert.strictEqual(calculateBullishScore({obv:123456},100),0,
  "a raw OBV level without a direction must not create bullish points");
assert.strictEqual(calculateBearishScore({obv:123456},100),0,
  "a raw OBV level without a direction must not create bearish points");
console.log("AI OBV direction regression tests passed");
