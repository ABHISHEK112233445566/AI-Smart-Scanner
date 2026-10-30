const assert=require("assert");
const {calculateTrend,TIMEFRAMES}=require("./mtfScanner");
const calculateIndicators=require("./indicators");

function candles(count){
  return Array.from({length:count},(_,i)=>{
    const close=100+i*0.5;
    const day=new Date(Date.UTC(2026,0,1+i)).toISOString();
    return{time:day,open:close-0.1,high:close+0.5,low:close-0.5,close,volume:10000+i*10};
  });
}
function expectedBullishPoints(data){
  const i=calculateIndicators(data),last=data[data.length-1].close;
  let points=0;
  if(i.ema20>i.ema50)points++;
  if(last>i.ema20)points++;
  if(i.rsi>50)points++;
  if(i.macd?.MACD>i.macd?.signal)points++;
  if(i.adx?.adx>=20&&i.adx?.pdi>i.adx?.mdi)points++;
  if(i.ema200!==null&&i.ema50>i.ema200)points++;
  return points;
}
const spec=TIMEFRAMES.find(x=>x.key==="daily");
const shortHistory=candles(60);
const shortResult=calculateTrend("EMA200_MISSING",spec,shortHistory);
assert.strictEqual(shortResult.valid,true,
  "a shorter history should remain usable when the required shorter-period indicators are available");
assert.strictEqual(shortResult.indicatorQuality.ema200,false,
  "unavailable EMA200 must be reported as unavailable");
assert.strictEqual(shortResult.bullishPoints,expectedBullishPoints(shortHistory),
  "missing EMA200 must not create an artificial bullish or bearish comparison");

const longHistory=candles(220);
const longResult=calculateTrend("EMA200_AVAILABLE",spec,longHistory);
assert.strictEqual(longResult.valid,true);
assert.strictEqual(longResult.indicatorQuality.ema200,true);
assert.strictEqual(longResult.bullishPoints,expectedBullishPoints(longHistory),
  "available EMA200 must contribute only its real comparison");
console.log("MTF EMA200 regression tests passed");
