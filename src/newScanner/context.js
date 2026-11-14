"use strict";

const axios=require("axios");
const {symbol,number}=require("./normalize");
const NEWS_TTL_MS=15*60*1000,cache=new Map();

const COMPANY_ALIASES=Object.freeze({
  BSE:["BSE LIMITED","BSE LTD","BOMBAY STOCK EXCHANGE"],
  RADICO:["RADICO KHAITAN"],
  KARURVYSYA:["KARUR VYSYA BANK","KARUR VYSYA"],
  DRREDDY:["DR REDDY'S LABORATORIES","DR. REDDY'S LABORATORIES","DR REDDYS LABORATORIES","DR. REDDYS LABORATORIES","DR REDDY","DR REDDYS"],
  NYKAA:["FSN E-COMMERCE","FSN E COMMERCE","NYKAA"]
});
function cleanTitle(value){return String(value??"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();}
function isCompanyNewsRelevant(title,stock) {
  const s=symbol(stock),t=cleanTitle(title).toUpperCase();
  if(!s||!t)return false;
  const tokenMatch=new RegExp("(^|[^A-Z0-9])"+s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"([^A-Z0-9]|$)").test(t);
  const aliases=COMPANY_ALIASES[s]||[];
  const aliasMatch=aliases.some(alias=>t.includes(alias));
  // Never accept a headline merely because it mentions an exchange, market,
  // or another unrelated listed company. Require the actual issuer/ticker.
  return tokenMatch||aliasMatch;
}
async function fetchOptionQuotes(keys,broker) {
  // Upstox's live market-quote response normally exposes current OI but not
  // previous-session OI. Read OI from the last two completed daily candles
  // instead of treating the missing prev_oi quote field as missing data.
  const rows=new Array(keys.length);
  let cursor=0;
  const workers=Array.from({length:Math.min(4,keys.length)},async()=>{
    while(true) {
      const index=cursor++;
      if(index>=keys.length)return;
      const key=keys[index];
      try {
        const candles=await broker.getHistoricalData(key,"ONE_DAY",{includeLiveQuote:false});
        const valid=(Array.isArray(candles)?candles:[])
          .filter(c=>number(c?.oi)!==null&&number(c?.oi)>=0)
          .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
        if(valid.length>=2) {
          rows[index]={oi:number(valid.at(-1).oi),previousOI:number(valid.at(-2).oi),price:number(valid.at(-1).close),previousPrice:number(valid.at(-2).close),source:"DAILY_CANDLE_OI"};
          continue;
        }
      } catch (_) {}
      try {
        const q=await broker.getOptionQuote(key);
        rows[index]={oi:number(q?.oi),previousOI:number(q?.previousOI),price:number(q?.ltp),previousPrice:number(q?.close),source:"LIVE_QUOTE_FALLBACK"};
      } catch (_) { rows[index]=null; }
    }
  });
  await Promise.all(workers);
  return rows;
}
function parseXmlItems(xml) {
  const out=[],blocks=String(xml??"").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];
  for(const block of blocks){
    const get=tag=>{const m=block.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)</"+tag+">","i"));return m?cleanTitle(m[1].replace("<![CDATA[","").replace("]]>","")):"";};
    out.push({title:get("title"),link:get("link"),published:get("pubDate"),source:get("source")});
  }
  return out;
}
async function fetchNews(stock,client=axios) {
  const s=symbol(stock),cached=cache.get(s);
  if(cached&&Date.now()-cached.time<NEWS_TTL_MS)return cached.value;
  const query=encodeURIComponent('"'+s+'" stock shares company when:2d');
  try {
    const response=await client.get("https://news.google.com/rss/search?q="+query+"&hl=en-IN&gl=IN&ceid=IN:en",{timeout:10000,headers:{"User-Agent":"Mozilla/5.0"}});
    const cutoff=Date.now()-48*3600000;
    const items=parseXmlItems(response.data)
      .filter(x=>x.title&&Number.isFinite(Date.parse(x.published))&&Date.parse(x.published)>=cutoff)
      .filter(x=>isCompanyNewsRelevant(x.title,s))
      .sort((a,b)=>Date.parse(b.published)-Date.parse(a.published));
    const item=items[0]||null,headline=item?.title||"";
    const positiveWords=/profit|growth|order win|upgrade|strong results|beats|record revenue|dividend|buyback/i;
    const negativeWords=/loss|fraud|downgrade|default|penalty|investigation|weak results|misses|resignation/i;
    const direction=item?(positiveWords.test(headline)&&!negativeWords.test(headline)?"BULLISH":negativeWords.test(headline)&&!positiveWords.test(headline)?"BEARISH":"NEUTRAL"):"NEUTRAL";
    const value={status:item?"NEWS_FOUND":"NO_MAJOR_NEWS",direction,headline,source:item?.source||"",published:item?.published||"",url:item?.link||""};
    cache.set(s,{time:Date.now(),value});return value;
  } catch(error) {
    return {status:"NEWS_UNAVAILABLE",direction:"UNKNOWN",headline:"",source:"",published:"",url:"",error:error.message};
  }
}
function classifyOptionBuildup(side,oiChangePercent,priceChangePercent) {
  if(oiChangePercent===null||priceChangePercent===null)return "UNKNOWN";
  if(oiChangePercent>=1)return priceChangePercent>=0.25?"LONG_BUILDUP":"SHORT_BUILDUP";
  if(oiChangePercent<=-1)return priceChangePercent<=-0.25?"LONG_UNWINDING":"SHORT_COVERING";
  return "NEUTRAL";
}
function optionBuildupDirection(side,mood) {
  if(mood==="UNKNOWN"||mood==="NEUTRAL")return "NEUTRAL";
  if(side==="CE")return mood==="LONG_BUILDUP"||mood==="SHORT_COVERING"?"BULLISH":"BEARISH";
  return mood==="LONG_BUILDUP"||mood==="SHORT_COVERING"?"BEARISH":"BULLISH";
}
async function fetchUnderlyingOI(stock,broker) {
  try {
    const contracts=await broker.getOptionContracts(stock.instrumentKey);
    const minExpiry=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    const eligible=(Array.isArray(contracts)?contracts:[]).filter(c=>String(c.expiry||"").slice(0,10)>=minExpiry&&Number(c.strike_price??c.strike)>0);
    const expiry=[...new Set(eligible.map(c=>String(c.expiry).slice(0,10)))].sort()[0];
    if(!expiry)return{dataStatus:"UNAVAILABLE",reason:"NO_ELIGIBLE_OPTION_EXPIRY",mood:"UNKNOWN",sentiment:"UNKNOWN"};
    const chain=eligible.filter(c=>String(c.expiry).slice(0,10)===expiry);
    const spot=Number(stock.quote?.ltp)||0;
    const sorted=[...chain].sort((a,b)=>Math.abs(Number(a.strike_price??a.strike)-spot)-Math.abs(Number(b.strike_price??b.strike)-spot));
    const sampled=[];
    for(const side of ["CE","PE"]) {
      const sideRows=sorted.filter(c=>String(c.instrument_type??c.option_type??"").toUpperCase()===side||
        String(c.trading_symbol??"").toUpperCase().endsWith(side));
      sampled.push(...sideRows.slice(0,10));
    }
    const keys=sampled.map(c=>c.instrument_key??c.instrumentKey).filter(Boolean);
    if(!keys.length)return{dataStatus:"UNAVAILABLE",reason:"NO_NEAR_ATM_OPTION_CONTRACTS",mood:"UNKNOWN",sentiment:"UNKNOWN"};
    const quotes=await fetchOptionQuotes(keys,broker);
    const rows=sampled.filter(c=>c.instrument_key??c.instrumentKey).map((c,index)=>{
      const q=quotes[index],type=String(c.instrument_type??c.option_type??"").toUpperCase()||String(c.trading_symbol??"").toUpperCase().slice(-2);
      return q?{type,oi:q.oi,previousOI:q.previousOI,price:q.price,previousPrice:q.previousPrice}:null;
    }).filter(x=>x&&["CE","PE"].includes(x.type));
    const sideStats={};
    for(const side of ["CE","PE"]) {
      const valid=rows.filter(x=>x.type===side&&x.oi!==null&&x.previousOI!==null&&x.previousOI>0);
      const oi=valid.reduce((s,x)=>s+x.oi,0),previousOI=valid.reduce((s,x)=>s+x.previousOI,0);
      const priced=valid.filter(x=>x.price!==null&&x.previousPrice!==null&&x.previousPrice>0);
      const priceChangePercent=priced.length?priced.reduce((s,x)=>s+(x.price/x.previousPrice-1)*100,0)/priced.length:null;
      const changePercent=previousOI>0?(oi-previousOI)/previousOI*100:null;
      sideStats[side]={contracts:valid.length,oi,previousOI,changePercent,priceChangePercent,
        mood:classifyOptionBuildup(side,changePercent,priceChangePercent)};
      sideStats[side].direction=optionBuildupDirection(side,sideStats[side].mood);
    }
    const usable=[sideStats.CE,sideStats.PE].filter(x=>x.contracts>0&&x.direction!=="NEUTRAL"&&x.direction!=="UNKNOWN");
    if(!usable.length)return{dataStatus:"UNAVAILABLE",reason:"OPTION_CHAIN_OI_OR_PREMIUM_HISTORY_UNAVAILABLE",mood:"UNKNOWN",sentiment:"UNKNOWN",sideStats};
    const bullish=usable.filter(x=>x.direction==="BULLISH").length,bearish=usable.length-bullish;
    const sentiment=bullish>bearish?"BULLISH":bearish>bullish?"BEARISH":"MIXED";
    const stockPrice=number(stock.quote?.ltp),previousClose=number(stock.quote?.previousClose);
    const priceChangePercent=stockPrice!==null&&previousClose!==null&&previousClose>0?(stockPrice/previousClose-1)*100:null;
    const mood=sentiment==="BULLISH"?"BULLISH_BUILDUP":sentiment==="BEARISH"?"BEARISH_BUILDUP":"MIXED_BUILDUP";
    return{dataStatus:"VALID",source:"UPSTOX_OPTION_CHAIN_SIDE_SPECIFIC_OI_AND_PREMIUM",expiry,
      contractsChecked:rows.length,sideStats,mood,sentiment,changePercent:null,priceChangePercent,
      directionalUse:"SIDE_SPECIFIC_OPTION_PREMIUM_AND_OI",warning:"Option-chain sentiment is an inference from CE/PE premium and OI changes, not a substitute for underlying futures OI."};
  } catch(error) { return{dataStatus:"UNAVAILABLE",reason:error.message,mood:"UNKNOWN",sentiment:"UNKNOWN"}; }
}
module.exports={fetchNews,fetchUnderlyingOI,parseXmlItems,isCompanyNewsRelevant,classifyOptionBuildup,optionBuildupDirection};
