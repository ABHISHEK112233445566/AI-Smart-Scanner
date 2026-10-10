// ============================================================
// AI SMART SCANNER — DASHBOARD NEWS SERVICE
// ============================================================
// Dashboard-only enrichment. This service never changes scanner
// scores, option decisions, entries, stops, targets or rankings.
// ============================================================

const NEWS_TIMEOUT_MS=Math.max(2000,Number(process.env.NEWS_TIMEOUT_MS||5000));
const NEWS_MAX_AGE_HOURS=Math.max(1,Number(process.env.NEWS_MAX_AGE_HOURS||24));
const NEWS_CONCURRENCY=Math.max(1,Number(process.env.NEWS_CONCURRENCY||4));
const CACHE_TTL_MS=Math.max(60000,Number(process.env.NEWS_CACHE_TTL_MS||600000));
const cache=new Map();

function cleanSymbol(value){return String(value??"").trim().toUpperCase().replace(/[^A-Z0-9&.-]/g,"");}
function decodeXml(value){return String(value??"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();}
function stripHtml(value){return decodeXml(value).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();}
function tag(item,name){const re=new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i");const m=String(item).match(re);return m?decodeXml(m[1]):"";}
function parseItems(xml){
  const blocks=String(xml||"").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];
  return blocks.map(item=>({title:stripHtml(tag(item,"title")),link:tag(item,"link"),published:tag(item,"pubDate"),source:stripHtml(tag(item,"source"))})).filter(x=>x.title);
}
function hoursOld(date){const t=new Date(date).getTime();if(!Number.isFinite(t))return Infinity;return Math.max(0,(Date.now()-t)/3600000);}
function formatAge(hours){if(!Number.isFinite(hours))return "";if(hours<1)return `${Math.max(1,Math.round(hours*60))}m ago`;if(hours<24)return `${Math.round(hours)}h ago`;return `${Math.floor(hours/24)}d ago`;}
function newsDirection(status){const s=String(status||'').toUpperCase();return s==='POSITIVE'?'BULLISH':s==='NEGATIVE'?'BEARISH':'NEUTRAL';}
function newsScope(title,symbol){const t=String(title||'').toLowerCase(),s=String(symbol||'').toLowerCase();const market=/(sensex|nifty|nifty 50|bank nifty|markets?|market continues|indices|index|rupee|crude oil|foreign fund|fii|dii)/.test(t);const mentionsSymbol=s&&t.includes(s.replace(/[^a-z0-9]/g,''));return market&&!mentionsSymbol?'MARKET':'STOCK';}
function newsConfirmation(status,technicalDirection){const n=newsDirection(status),t=String(technicalDirection||'').toUpperCase();if(n==='NEUTRAL'||!['BULLISH','BEARISH'].includes(t))return 'NEUTRAL';return n===t?'CONFIRMED':'CONFLICT';}
function classify(title){
  const t=String(title||"").toLowerCase();
  const negative=/(fraud|probe|investigation|raid|penalty|fine|downgrade|default|loss|weak results|misses estimates|missed estimates|warning|lawsuit|resign|resignation|ban|order cancelled|cancelled order|fall|falls|plunge|plunges|cut|cuts|debt concern|regulatory action)/.test(t);
  const positive=/(order win|order worth|wins order|contract win|approval|approves|approved|acquisition|acquires|funding|fundraise|investment|partnership|deal|expansion|record profit|profit rises|beats estimates|upgrade|dividend|buyback|new project|launches|strong results|raises guidance)/.test(t);
  if(negative&&!positive)return "NEGATIVE";
  if(positive&&!negative)return "POSITIVE";
  return "NEUTRAL";
}
async function fetchResponse(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),NEWS_TIMEOUT_MS);
  try{
    const response=await fetch(url,{
      signal:controller.signal,
      headers:{
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 AI-Smart-Scanner/1.0",
        "Accept":"application/rss+xml, application/xml, text/xml, application/json, text/plain, */*",
        "Accept-Language":"en-IN,en;q=0.9"
      }
    });
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return response;
  }finally{clearTimeout(timer);}
}
async function fetchText(url){
  const response=await fetchResponse(url);
  return response.text();
}
async function fetchJson(url){
  const response=await fetchResponse(url);
  return response.json();
}
function emptyNews(message="No major news in last 24h"){
  return{newsStatus:"NO_MAJOR_NEWS",newsDirection:"NEUTRAL",newsScope:"NONE",newsHeadline:message,newsSource:"",newsAge:"",newsUrl:""};
}
function normalizeNewsItem(item,symbol){
  const title=stripHtml(item?.title||"");
  const link=String(item?.link||"").trim();
  const source=stripHtml(item?.source||item?.publisher||"");
  const timestamp=Number(item?.providerPublishTime);
  const published=Number.isFinite(timestamp)?new Date(timestamp*1000):new Date(item?.published||"");
  if(!title||!Number.isFinite(published.getTime()))return null;
  const symbolClean=cleanSymbol(symbol).replace(/[^A-Z0-9]/g,"");
  const titleClean=title.toUpperCase().replace(/[^A-Z0-9]/g,"");
  const related=(Array.isArray(item?.relatedTickers)?item.relatedTickers:[]).map(x=>cleanSymbol(x)).map(x=>x.replace(/[^A-Z0-9]/g,""));
  const relevant=titleClean.includes(symbolClean)||related.includes(symbolClean);
  return{title,link,source,published,relevant};
}
function chooseFreshNews(items,symbol){
  const cutoff=Date.now()-NEWS_MAX_AGE_HOURS*3600000;
  return items
    .map(item=>normalizeNewsItem(item,symbol))
    .filter(Boolean)
    .filter(item=>item.published.getTime()>=cutoff)
    .sort((a,b)=>(Number(b.relevant)-Number(a.relevant))||(b.published-a.published))[0]||null;
}
async function fetchYahooNews(symbol){
  const s=cleanSymbol(symbol);
  const query=encodeURIComponent(`${s} NSE India stock`);
  const data=await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${query}&newsCount=10&quotesCount=0`);
  return chooseFreshNews(Array.isArray(data?.news)?data.news:[],s);
}
async function fetchNewsForSymbol(symbol){
  const s=cleanSymbol(symbol);
  if(!s)return{newsStatus:"NO_MAJOR_NEWS",newsDirection:"NEUTRAL",newsScope:"NONE",newsHeadline:"",newsSource:"",newsAge:"",newsUrl:""};
  const cached=cache.get(s);
  if(cached&&Date.now()-cached.cachedAt<CACHE_TTL_MS)return cached.value;
  const query=encodeURIComponent(`"${s}" stock OR shares OR company when:${Math.max(1,Math.ceil(NEWS_MAX_AGE_HOURS/24))}d`);
  const googleUrl=`https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
  try{
    let item=null;
    try{
      const xml=await fetchText(googleUrl);
      const cutoff=Date.now()-NEWS_MAX_AGE_HOURS*3600000;
      const googleItems=parseItems(xml).filter(x=>{const t=new Date(x.published).getTime();return Number.isFinite(t)&&t>=cutoff;});
      item=chooseFreshNews(googleItems.map(x=>({title:x.title,link:x.link,source:x.source,published:x.published})),s);
    }catch(error){
      console.warn(`NEWS GOOGLE ${s}: ${error?.message||error}`);
    }
    if(!item){
      try{
        item=await fetchYahooNews(s);
      }catch(error){
        console.warn(`NEWS YAHOO ${s}: ${error?.message||error}`);
      }
    }
    if(item){
      const status=classify(item.title);
      const value={newsStatus:status,newsDirection:newsDirection(status),newsScope:newsScope(item.title,s),newsHeadline:item.title.slice(0,240),newsSource:item.source||"News",newsAge:formatAge(hoursOld(item.published)),newsUrl:item.link||""};
      cache.set(s,{cachedAt:Date.now(),value});
      return value;
    }
    const value=emptyNews();
    cache.set(s,{cachedAt:Date.now(),value});
    return value;
  }catch(error){
    const value={newsStatus:"NEWS_UNAVAILABLE",newsDirection:"NEUTRAL",newsScope:"NONE",newsHeadline:"News feed unavailable",newsSource:"",newsAge:"",newsUrl:""};
    console.warn(`NEWS ${s}: ${error?.message||error}`);
    return value;
  }
}
async function fetchNewsForIndex(){
  const cacheKey="NIFTY50_INDEX_NEWS";
  const cached=cache.get(cacheKey);
  if(cached&&Date.now()-cached.cachedAt<CACHE_TTL_MS)return cached.value;
  const query=encodeURIComponent(`("Nifty 50" OR "Nifty index" OR NSE market OR Indian stock market) when:${Math.max(1,Math.ceil(NEWS_MAX_AGE_HOURS/24))}d`);
  try{
    const xml=await fetchText(`https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`);
    const cutoff=Date.now()-NEWS_MAX_AGE_HOURS*3600000;
    const items=parseItems(xml).filter(x=>{const t=new Date(x.published).getTime();return Number.isFinite(t)&&t>=cutoff;}).sort((a,b)=>new Date(b.published)-new Date(a.published));
    const item=items[0]||null;
    const status=item?classify(item.title):"NO_MAJOR_NEWS";
    const value=item?{newsStatus:status,newsDirection:newsDirection(status),newsScope:"MARKET",newsHeadline:item.title.slice(0,240),newsSource:item.source||"Google News",newsAge:formatAge(hoursOld(item.published)),newsUrl:item.link||""}:{newsStatus:"NO_MAJOR_NEWS",newsDirection:"NEUTRAL",newsScope:"MARKET",newsHeadline:"No major Nifty/market headline found in the configured news window",newsSource:"Google News",newsAge:"",newsUrl:""};
    cache.set(cacheKey,{cachedAt:Date.now(),value});
    return value;
  }catch(error){
    const value={newsStatus:"NEWS_UNAVAILABLE",newsDirection:"NEUTRAL",newsScope:"MARKET",newsHeadline:"Nifty/market news feed unavailable",newsSource:"",newsAge:"",newsUrl:""};
    console.warn(`NIFTY INDEX NEWS: ${error?.message||error}`);
    return value;
  }
}
async function enrichDashboardNews(rows=[]){
  const source=Array.isArray(rows)?rows:[];
  const out=[];
  for(let i=0;i<source.length;i+=NEWS_CONCURRENCY){
    const batch=source.slice(i,i+NEWS_CONCURRENCY);
    const enriched=await Promise.all(batch.map(async row=>{const news=await fetchNewsForSymbol(row?.symbol??row?.stock??row?.name);const technicalDirection=String(row?.technicalDirection??row?.stockDirection??row?.direction??'').toUpperCase();return{...row,...news,newsConfirmation:newsConfirmation(news.newsStatus,technicalDirection),newsTechnicalDirection:technicalDirection};}));
    out.push(...enriched);
  }
  return out;
}
function formatDashboardNews(row={}){
  const status=String(row.newsStatus||"NO_MAJOR_NEWS").toUpperCase();
  const icon=status==="POSITIVE"?"🟢":status==="NEGATIVE"?"🔴":status==="NEUTRAL"?"⚪":"⚠️";
  if(status==="NO_MAJOR_NEWS")return "⚪ No major news (24h)";
  if(status==="NEWS_UNAVAILABLE")return "⚠️ News unavailable";
  const age=row.newsAge?` • ${row.newsAge}`:"";
  const source=row.newsSource?` • ${row.newsSource}`:"";
  return `${icon} ${row.newsHeadline||"News available"}${source}${age}`.slice(0,500);
}
module.exports={fetchNewsForSymbol,fetchNewsForIndex,enrichDashboardNews,formatDashboardNews,newsDirection,newsConfirmation,newsScope};
