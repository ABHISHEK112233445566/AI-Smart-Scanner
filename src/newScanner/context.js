"use strict";

const axios=require("axios");
const {symbol,number}=require("./normalize");
const NEWS_TTL_MS=15*60*1000,cache=new Map();
function parseXmlItems(xml) {
  const out=[],blocks=String(xml??"").match(/<item>[\s\S]*?<\/item>/gi)||[];
  for(const block of blocks){
    const get=tag=>{const m=block.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)</"+tag+">","i"));return m?m[1].replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').trim():"";};
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
    const items=parseXmlItems(response.data).filter(x=>x.title&&Number.isFinite(Date.parse(x.published))&&Date.parse(x.published)>=cutoff).sort((a,b)=>Date.parse(b.published)-Date.parse(a.published));
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
    const selected=contracts.filter(c=>{const expiry=String(c.expiry||"").slice(0,10);return expiry&&expiry>=new Date(Date.now()+7*86400000).toISOString().slice(0,10)&&Number(c.strike_price??c.strike)>0;});
    const nearest=[...new Set(selected.map(c=>String(c.expiry).slice(0,10)))].sort()[0];
    const chain=selected.filter(c=>String(c.expiry).slice(0,10)===nearest);
    const sampled=chain.slice(0,Math.min(chain.length,80));
    const rows=await Promise.all(sampled.map(async c=>{const key=c.instrument_key??c.instrumentKey;try{const q=await broker.getOptionQuote(key);return{type:String(c.instrument_type??c.option_type??"").toUpperCase(),oi:number(q.oi),previousOI:number(q.previousOI)};}catch(_){return null;}}));
    const valid=rows.filter(x=>x&&x.oi!==null&&x.previousOI!==null),oi=valid.reduce((s,x)=>s+x.oi,0),previousOI=valid.reduce((s,x)=>s+x.previousOI,0);
    if(!valid.length||previousOI<=0)return{dataStatus:"UNAVAILABLE",reason:"OPTION_CHAIN_OI_UNAVAILABLE",mood:"UNKNOWN",sentiment:"UNKNOWN"};
    const changePercent=(oi-previousOI)/previousOI*100,price=stock.quote?.ltp,prev=stock.quote?.previousClose;
    const pricePercent=price&&prev?(price-prev)/prev*100:null;
    let mood="NEUTRAL",sentiment="NEUTRAL";
    if(pricePercent!==null&&Math.abs(pricePercent)>=.1&&Math.abs(changePercent)>=1){
      if(pricePercent>0&&changePercent>0){mood="LONG BUILDUP";sentiment="BULLISH";}
      else if(pricePercent<0&&changePercent>0){mood="SHORT BUILDUP";sentiment="BEARISH";}
      else if(pricePercent>0&&changePercent<0){mood="SHORT COVERING";sentiment="BULLISH";}
      else {mood="LONG UNWINDING";sentiment="BEARISH";}
    }
    return{dataStatus:"VALID",source:"UPSTOX_OPTION_CHAIN_AGGREGATE",expiry:nearest,contractsChecked:valid.length,oi,previousOI,changePercent,priceChangePercent:pricePercent,mood,sentiment,warning:"Aggregate CE+PE OI is contextual only; do not use as sole direction signal."};
  } catch(error) { return{dataStatus:"UNAVAILABLE",reason:error.message,mood:"UNKNOWN",sentiment:"UNKNOWN"}; }
}
module.exports={fetchNews,fetchUnderlyingOI,parseXmlItems};
