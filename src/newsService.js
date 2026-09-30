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
  const blocks=String(xml||"").match(/<item(?:\\s[^>]*)?>[\\s\\S]*?<\\/item>/gi)||[];
  return blocks.map(item=>({title:stripHtml(tag(item,"title")),link:tag(item,"link"),published:tag(item,"pubDate"),source:stripHtml(tag(item,"source"))})).filter(x=>x.title);
}
function hoursOld(date){const t=new Date(date).getTime();if(!Number.isFinite(t))return Infinity;return Math.max(0,(Date.now()-t)/3600000);}
function formatAge(hours){if(!Number.isFinite(hours))return "";if(hours<1)return `${Math.max(1,Math.round(hours*60))}m ago`;if(hours<24)return `${Math.round(hours)}h ago`;return `${Math.floor(hours/24)}d ago`;}
function classify(title){
  const t=String(title||"").toLowerCase();
  const negative=/(fraud|probe|investigation|raid|penalty|fine|downgrade|default|loss|weak results|misses estimates|missed estimates|warning|lawsuit|resign|resignation|ban|order cancelled|cancelled order|fall|falls|plunge|plunges|cut|cuts|debt concern|regulatory action)/.test(t);
  const positive=/(order win|order worth|wins order|contract win|approval|approves|approved|acquisition|acquires|funding|fundraise|investment|partnership|deal|expansion|record profit|profit rises|beats estimates|upgrade|dividend|buyback|new project|launches|strong results|raises guidance)/.test(t);
  if(negative&&!positive)return "NEGATIVE";
  if(positive&&!negative)return "POSITIVE";
  return "NEUTRAL";
}
async function fetchText(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),NEWS_TIMEOUT_MS);
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{"User-Agent":"AI-Smart-Scanner/1.0"}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }finally{clearTimeout(timer);}
}
async function fetchNewsForSymbol(symbol){
  const s=cleanSymbol(symbol);
  if(!s)return{newsStatus:"NO_MAJOR_NEWS",newsHeadline:"",newsSource:"",newsAge:"",newsUrl:""};
  const cached=cache.get(s);
  if(cached&&Date.now()-cached.cachedAt<CACHE_TTL_MS)return cached.value;
  const query=encodeURIComponent(`"${s}" stock OR shares OR company when:${Math.max(1,Math.ceil(NEWS_MAX_AGE_HOURS/24))}d`);
  const url=`https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
  try{
    const xml=await fetchText(url);
    const cutoff=Date.now()-NEWS_MAX_AGE_HOURS*3600000;
    const items=parseItems(xml).filter(item=>{const t=new Date(item.published).getTime();return Number.isFinite(t)&&t>=cutoff;});
    const item=items[0];
    const value=item?{newsStatus:classify(item.title),newsHeadline:item.title.slice(0,240),newsSource:item.source||"News",newsAge:formatAge(hoursOld(item.published)),newsUrl:item.link||""}:{newsStatus:"NO_MAJOR_NEWS",newsHeadline:"No major news in last 24h",newsSource:"",newsAge:"",newsUrl:""};
    cache.set(s,{cachedAt:Date.now(),value});
    return value;
  }catch(error){
    const value={newsStatus:"NEWS_UNAVAILABLE",newsHeadline:"News feed unavailable",newsSource:"",newsAge:"",newsUrl:""};
    cache.set(s,{cachedAt:Date.now(),value});
    console.warn(`NEWS ${s}: ${error?.message||error}`);
    return value;
  }
}
async function enrichDashboardNews(rows=[]){
  const source=Array.isArray(rows)?rows:[];
  const out=[];
  for(let i=0;i<source.length;i+=NEWS_CONCURRENCY){
    const batch=source.slice(i,i+NEWS_CONCURRENCY);
    const enriched=await Promise.all(batch.map(async row=>({...row,...await fetchNewsForSymbol(row?.symbol??row?.stock??row?.name)})));
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
module.exports={fetchNewsForSymbol,enrichDashboardNews,formatDashboardNews};
