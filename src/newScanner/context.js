"use strict";

const axios=require("axios");
const {symbol,number}=require("./normalize");
const NEWS_TTL_MS=15*60*1000,cache=new Map();

const COMPANY_ALIASES=Object.freeze({
  BSE:["BSE LIMITED","BSE LTD","BOMBAY STOCK EXCHANGE"],
  RADICO:["RADICO KHAITAN"],
  KARURVYSYA:["KARUR VYSYA BANK","KARUR VYSYA"],
  DRREDDY:["DR REDDYS LABORATORIES","DR. REDDYS LABORATORIES","DR REDDYS","DR. REDDYS"],
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
  if(String(broker?.name||"").toUpperCase()==="UPSTOX"&&process.env.UPSTOX_ACCESS_TOKEN) {
    const response=await axios.get("https://api.upstox.com/v2/market-quote/quotes",{params:{instrument_key:keys.join(",")},headers:{Accept:"application/json",Authorization:"Bearer "+process.env.UPSTOX_ACCESS_TOKEN},timeout:20000});
    const data=response?.data?.data||{};
    return keys.map(key=>{const raw=data[key]||data[encodeURIComponent(key)]||Object.entries(data).find(([k])=>decodeURIComponent(k)===key)?.[1];return raw?{oi:number(raw.oi??raw.open_interest),previousOI:number(raw.prev_oi??raw.previous_oi)}:null;});
  }
  return Promise.all(keys.map(async key=>{try{const q=await broker.getOptionQuote(key);return{oi:number(q.oi),previousOI:number(q.previousOI)};}catch(_){return null;}}));
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
async function fetchUnderlyingOI(stock,broker) {
  try {
    const contracts=await broker.getOptionContracts(stock.instrumentKey);
    const minExpiry=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    const eligible=contracts.filter(c=>String(c.expiry||"").slice(0,10)>=minExpiry&&Number(c.strike_price??c.strike)>0);
    const expiry=[...new Set(eligible.map(c=>String(c.expiry).slice(0,10)))].sort()[0];
    const chain=eligible.filter(c=>String(c.expiry).slice(0,10)===expiry);
    const spot=Number(stock.quote?.ltp)||0;
    const sorted=[...chain].sort((a,b)=>Math.abs(Number(a.strike_price??a.strike)-spot)-Math.abs(Number(b.strike_price??b.strike)-spot));
    const sampled=[];
    for(const side of ["CE","PE"]) {
      const sideRows=sorted.filter(c=>String(c.instrument_type??c.option_type??"").toUpperCase()===side||
        String(c.trading_symbol??"").toUpperCase().endsWith(side));
      sampled.push(...sideRows.slice(0,10));
    }
    const keys=sampled.map(c=>c.instrument_key??c.instrumentKey);
    const quotes=await fetchOptionQuotes(keys,broker);
    const rows=sampled.map((c,index)=>{
      const q=quotes[index];
      const type=String(c.instrument_type??c.option_type??"").toUpperCase()||String(c.trading_symbol??"").toUpperCase().slice(-2);
      return q?{type,oi:q.oi,previousOI:q.previousOI}:null;
    });
    const valid=rows.filter(x=>x&&x.oi!==null&&x.previousOI!==null);
    const oi=valid.reduce((s,x)=>s+x.oi,0),previousOI=valid.reduce((s,x)=>s+x.previousOI,0);
    if(!valid.length||previousOI<=0)return{dataStatus:"UNAVAILABLE",reason:"OPTION_CHAIN_OI_UNAVAILABLE",mood:"UNKNOWN",sentiment:"UNKNOWN"};
    const changePercent=(oi-previousOI)/previousOI*100,price=stock.quote?.ltp,prev=stock.quote?.previousClose;
    const pricePercent=price&&prev?(price-prev)/prev*100:null;
    // Combined CE+PE OI cannot identify long/short buildup reliably.
    const mood=changePercent>=1?"AGGREGATE_OI_RISING":changePercent<=-1?"AGGREGATE_OI_FALLING":"AGGREGATE_OI_FLAT";
    return{dataStatus:"VALID",source:"UPSTOX_OPTION_CHAIN_NEAR_ATM_SAMPLE",expiry,contractsChecked:valid.length,oi,previousOI,changePercent,priceChangePercent:pricePercent,mood,sentiment:"UNKNOWN",directionalUse:"NOT_PERMITTED",warning:"Combined CE+PE OI is contextual only; side-specific OI/PCR is required for directional classification."};
  } catch(error) { return{dataStatus:"UNAVAILABLE",reason:error.message,mood:"UNKNOWN",sentiment:"UNKNOWN"}; }
}
module.exports={fetchNews,fetchUnderlyingOI,parseXmlItems,isCompanyNewsRelevant};
