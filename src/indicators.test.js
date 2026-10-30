const assert=require("assert");
const calculateIndicators=require("./indicators");

function candle(time,volume,close=100){
  return{time,open:close,high:close+1,low:close-1,close,volume};
}
function dailyCandles(){
  return[100,200,300,400,500,600,900].map((volume,i)=>candle(`2026-10-${String(20+i).padStart(2,"0")}T00:00:00+05:30`,volume,100+i));
}
function intradaySessions(currentVolume=150,days=6){
  const dates=["2026-10-23","2026-10-26","2026-10-27","2026-10-28","2026-10-29","2026-10-30"].slice(6-days);
  const rows=[];
  for(let d=0;d<dates.length;d++){
    const volume=d===dates.length-1?currentVolume:100;
    for(const time of["09:15:00","09:20:00","09:25:00"])
      rows.push(candle(`${dates[d]}T${time}+05:30`,volume,100+d));
  }
  return rows;
}

const daily=calculateIndicators(dailyCandles());
assert.strictEqual(daily.volumeRatio5,Number((900/400).toFixed(2)),
  "daily relative volume must compare the latest completed daily candle with the previous five sessions");
assert.strictEqual(daily.volumePaceRatio5,null,
  "daily candles must not be assigned an intraday volume pace");

const intraday=calculateIndicators(intradaySessions(150,6));
assert.strictEqual(intraday.avgVolume5,null,
  "intraday bars must not be mistaken for completed daily volume samples");
assert.strictEqual(intraday.volumeRatio5,null,
  "intraday bars must not be presented as daily relative volume");
assert.strictEqual(intraday.volumeExpectedByNow5,300,
  "expected volume must be the average cumulative volume of five prior sessions at the same IST time");
assert.strictEqual(intraday.volumePaceRatio5,1.5,
  "volume pace must compare current cumulative session volume with the five-session same-time average");
assert.strictEqual(intraday.volumeConfirmed5,true);

const insufficient=calculateIndicators(intradaySessions(150,5));
assert.strictEqual(insufficient.volumePaceRatio5,null,
  "volume pace must remain unavailable when fewer than five prior sessions exist");
assert.strictEqual(insufficient.volumeConfirmed5,false,
  "missing historical pace data must never be treated as volume confirmation");

console.log("Indicator volume regression tests passed");
