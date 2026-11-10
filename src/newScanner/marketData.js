"use strict";

const { TIMEFRAMES, LIMITS } = require("./schema");
const axios=require("axios");
const { normalizeCandle, validateQuote, symbol } = require("./normalize");

function instrumentKeyMap(instruments) {
  const map = new Map();
  for (const item of Array.isArray(instruments) ? instruments : []) {
    const segment = String(item?.segment ?? "").toUpperCase();
    const exchange = String(item?.exchange ?? "").toUpperCase();
    const type = String(item?.instrument_type ?? "").toUpperCase();
    const key = String(item.instrument_key ?? item.instrumentKey ?? "").trim();
    if (!key) continue;
    if (segment === "NSE_EQ" || (exchange === "NSE" && type === "EQ")) {
      const name = symbol(item.trading_symbol ?? item.tradingSymbol ?? item.symbol);
      if (name && !map.has(name)) map.set(name, key);
    } else if (segment === "NSE_INDEX") {
      const identity = [item.trading_symbol, item.tradingSymbol, item.name, key].filter(Boolean).join(" ").toUpperCase();
      if (/NIFTY\s*50|NIFTY50/.test(identity) && !/BANK|NEXT|FINANCIAL|MIDCAP|IT|AUTO|PHARMA/.test(identity)) map.set("NIFTY", key);
    }
  }
  return map;
}
async function mapLimit(items, limit, worker) {
  const source = Array.isArray(items) ? items : [], output = new Array(source.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, source.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= source.length) return;
      try { output[index] = await worker(source[index], index); }
      catch (error) { output[index] = { error: error?.message || String(error) }; }
    }
  });
  await Promise.all(runners);
  return output;
}
async function fetchStockSnapshot(stock, broker, keyMap) {
  const instrumentKey = keyMap.get(symbol(stock.symbol));
  if (!instrumentKey) return { ...stock, dataStatus: "REJECTED", dataReason: "NSE_EQ_INSTRUMENT_KEY_NOT_FOUND" };
  try {
    const raw = await broker.getQuote(instrumentKey);
    const data = raw?.data ?? {};
    const quote = data[instrumentKey] ?? Object.values(data)[0] ?? raw;
    const normalized = validateQuote({
      ...quote,
      raw: quote,
      ltp: quote?.last_price ?? quote?.ltp,
      netChange: quote?.net_change ?? quote?.netChange,
      previousClose: quote?.previous_close ?? quote?.previousClose
    });
    return { ...stock, instrumentKey, quote: normalized, dataStatus: normalized.valid && normalized.previousClose ? "VALID" : "PARTIAL", dataReason: normalized.reason };
  } catch (error) {
    return { ...stock, instrumentKey, dataStatus: "FAILED", dataReason: error?.message || String(error) };
  }
}

async function fetchSnapshots(stocks, broker, instruments, options={}) {
  const keyMap=instrumentKeyMap(instruments);
  const source=Array.isArray(stocks)?stocks:[];
  const batchSize=Math.max(1,Math.min(100,Number(options.batchSize)||100));
  const resolvedKeys=new Map(keyMap);
  await mapLimit(source,8,async row=>{
    const name=symbol(row.symbol);
    if(resolvedKeys.has(name))return;
    try {
      const resolved=await broker.getInstrumentKey(row.symbol);
      const key=typeof resolved==="string"?resolved:(resolved?.instrument_key??resolved?.instrumentKey??"");
      if(key)resolvedKeys.set(name,String(key));
    } catch (_) {}
  });
  if(String(broker?.name||"").toUpperCase()==="UPSTOX"&&process.env.UPSTOX_ACCESS_TOKEN) {
    const output=[];
    for(let i=0;i<source.length;i+=batchSize) {
      const batch=source.slice(i,i+batchSize);
      const keyed=batch.map(row=>({row,key:resolvedKeys.get(symbol(row.symbol))})).filter(x=>x.key);
      const missing=batch.filter(row=>!resolvedKeys.has(symbol(row.symbol))).map(row=>({...row,dataStatus:"REJECTED",dataReason:"NSE_EQ_INSTRUMENT_KEY_NOT_FOUND"}));
      output.push(...missing);
      if(!keyed.length)continue;
      try {
        const response=await axios.get("https://api.upstox.com/v2/market-quote/quotes",{
          params:{instrument_key:keyed.map(x=>x.key).join(",")},
          headers:{Accept:"application/json",Authorization:"Bearer "+process.env.UPSTOX_ACCESS_TOKEN},
          timeout:20000
        });
        const data=response?.data?.data||{};
        for(const item of keyed) {
          const raw=data[item.key]||data[encodeURIComponent(item.key)]||Object.entries(data).find(([k])=>decodeURIComponent(k)===item.key)?.[1];
          if(!raw){output.push({...item.row,instrumentKey:item.key,dataStatus:"FAILED",dataReason:"QUOTE_NOT_RETURNED"});continue;}
          const quote=validateQuote({...raw,raw,last_price:raw.last_price,net_change:raw.net_change,previous_close:raw.previous_close});
          output.push({...item.row,instrumentKey:item.key,quote,dataStatus:quote.valid&&quote.previousClose?"VALID":"PARTIAL",dataReason:quote.reason});
        }
      } catch(error) {
        for(const item of keyed)output.push({...item.row,instrumentKey:item.key,dataStatus:"FAILED",dataReason:error?.response?.data?.errors?.[0]?.message||error.message});
      }
    }
    return output;
  }
  return mapLimit(source,Math.min(8,batchSize),row=>fetchStockSnapshot(row,broker,resolvedKeys));
}
async function fetchCandles(stock, broker, timeframes = TIMEFRAMES) {
  const results = {};
  for (const frame of timeframes) {
    try {
      const raw = await broker.getHistoricalData(stock.instrumentKey, frame.interval, { includeLiveQuote: false });
      const candles = (Array.isArray(raw) ? raw : []).map(normalizeCandle).filter(Boolean);
      const minimum = frame.key === "daily" ? LIMITS.MIN_DAILY_CANDLES : LIMITS.MIN_INTRADAY_CANDLES;
      results[frame.key] = {
        interval: frame.interval, candles, count: candles.length,
        status: candles.length >= minimum ? "VALID" : "INSUFFICIENT_HISTORY",
        required: minimum
      };
    } catch (error) {
      results[frame.key] = { interval: frame.interval, candles: [], count: 0, status: "FAILED", required: frame.key === "daily" ? LIMITS.MIN_DAILY_CANDLES : LIMITS.MIN_INTRADAY_CANDLES, error: error?.message || String(error) };
    }
  }
  return { ...stock, candles: results };
}
module.exports = { instrumentKeyMap, mapLimit, fetchStockSnapshot, fetchSnapshots, fetchCandles };
