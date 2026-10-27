// ============================================================
// AI SMART SCANNER — EARNINGS INTELLIGENCE
// Independent event enrichment. If NSE data is unavailable, this
// module fails open and leaves the existing scanner decisions intact.
// ============================================================
const NSE_HOME = "https://www.nseindia.com";
const NSE_BOARD_MEETINGS_API = `${NSE_HOME}/api/corporate-board-meetings`;
const TIMEOUT_MS = Math.max(2000, Number(process.env.EARNINGS_TIMEOUT_MS || 7000));
const CACHE_TTL_MS = Math.max(60000, Number(process.env.EARNINGS_CACHE_TTL_MS || 900000));
let cached = { at: 0, events: [] };

function cleanSymbol(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9&.-]/g, "");
}
function asDate(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dateParam(date) {
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}
function dayDiff(a, b) {
  return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
}
function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const n = Number(String(value).replace(/,/g, "").replace(/%$/, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function financialResultsMeeting(item) {
  const purpose = String(item?.bm_purpose ?? item?.purpose ?? item?.bm_desc ?? item?.meetingPurpose ?? item?.meeting_purpose ?? item?.description ?? "").toLowerCase();
  return /(financial\s+results?|quarterly\s+results?|half[- ]yearly\s+results?|annual\s+results?|audited\s+results?|unaudited\s+results?)/i.test(purpose);
}
function normalizeEvent(item) {
  const symbol = cleanSymbol(item?.bm_symbol ?? item?.symbol ?? item?.companySymbol ?? item?.ticker);
  const date = asDate(item?.bm_date ?? item?.meeting_date ?? item?.meetingDate ?? item?.date);
  if (!symbol || !date || !financialResultsMeeting(item)) return null;
  return {
    symbol,
    earningsMeetingDate: date.toISOString().slice(0, 10),
    earningsMeetingPurpose: String(item?.bm_purpose ?? item?.purpose ?? item?.bm_desc ?? item?.meetingPurpose ?? item?.meeting_purpose ?? item?.description ?? "Financial results").trim().slice(0, 240),
    earningsEventSource: "NSE_BOARD_MEETINGS",
    earningsEventUrl: String(item?.attchmntFile ?? item?.attachment ?? item?.url ?? "").trim(),
    _meetingDate: date
  };
}
async function fetchNseJson(url, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36 AI-Smart-Scanner/1.0",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-IN,en;q=0.9",
        "Referer": NSE_HOME + "/",
        "Origin": NSE_HOME,
        ...(cookie ? { Cookie: cookie } : {})
      }
    });
    if (!response.ok) throw new Error(`NSE HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}
async function fetchBoardMeetings() {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 3);
  const to = new Date(now); to.setDate(to.getDate() + 7);
  const params = new URLSearchParams({
    index: "equities",
    from_date: dateParam(from),
    to_date: dateParam(to)
  });
  let cookie = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const home = await fetch(NSE_HOME, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36", "Accept": "text/html,application/xhtml+xml" }
      });
      cookie = typeof home.headers.getSetCookie === "function"
        ? home.headers.getSetCookie().map(v => v.split(";")[0]).join("; ")
        : String(home.headers.get("set-cookie") || "").split(/,(?=[^;]+=)/).map(v => v.split(";")[0]).join("; ");
    } finally { clearTimeout(timer); }
  } catch (error) {
    console.warn(`EARNINGS NSE session warning: ${error?.message || error}`);
  }
  const data = await fetchNseJson(`${NSE_BOARD_MEETINGS_API}?${params.toString()}`, cookie);
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.records) ? data.records : Array.isArray(data?.result) ? data.result : [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return list.map(normalizeEvent).filter(Boolean).filter(e => {
    const diff = dayDiff(e._meetingDate, today);
    return diff >= -3 && diff <= 7;
  }).sort((a, b) => a._meetingDate - b._meetingDate);
}
async function getEarningsEvents() {
  if (cached.events.length && Date.now() - cached.at < CACHE_TTL_MS) return cached.events;
  try {
    const events = await fetchBoardMeetings();
    cached = { at: Date.now(), events };
    console.log(`EARNINGS CALENDAR: NSE financial-results meetings=${events.length}`);
    return events;
  } catch (error) {
    console.warn(`EARNINGS CALENDAR unavailable; existing scoring preserved: ${error?.message || error}`);
    return [];
  }
}
function movement(row) {
  const current = firstNumber(row?.currentPrice, row?.livePrice, row?.price, row?.ltp);
  const previous = firstNumber(row?.previousClose, row?.prevClose, row?.previousPrice, row?.prevPrice);
  const explicit = firstNumber(row?.changePercent, row?.priceChangePercent, row?.dayChangePercent, row?.pChange, row?.percentChange);
  const changePct = explicit || (current > 0 && previous > 0 ? (current - previous) / previous * 100 : 0);
  const volumeRatio = firstNumber(row?.volumeRatio5, row?.volumePaceRatio5, row?.volumeRatio, row?.relativeVolume);
  return { changePct, volumeRatio };
}
function applyEvent(row, event, today) {
  const diff = dayDiff(event._meetingDate, today);
  const status = diff === 0 ? "RESULTS_MEETING_TODAY"
    : diff > 0 ? (diff === 1 ? "RESULTS_MEETING_TOMORROW" : "RESULTS_MEETING_UPCOMING")
    : diff === -1 ? "RECENT_RESULTS_MEETING_1D" : "RECENT_RESULTS_MEETING_2_3D";
  const { changePct, volumeRatio } = movement(row);
  let direction = "NEUTRAL";
  // Upcoming results add only a small neutral event-awareness contribution.
  // They do not predict direction. Directional contribution is allowed only
  // after a recent meeting and when price movement + volume confirm together.
  let contribution = diff >= 0 ? 3 : 0;
  if (diff < 0 && volumeRatio >= 1.2) {
    if (changePct >= 1) { direction = "BULLISH"; contribution = 5; }
    else if (changePct <= -1) { direction = "BEARISH"; contribution = -5; }
  }
  const base = firstNumber(row?.earningsBaseScore, row?.finalScore, row?.rankingScore, row?.aiFinalScore, row?.aiScore, row?.scannerScore, row?.score);
  const adjusted = base + contribution;
  return {
    ...row,
    earningsEventDetected: true,
    earningsEventStatus: status,
    earningsMeetingDate: event.earningsMeetingDate,
    earningsMeetingPurpose: event.earningsMeetingPurpose,
    earningsEventSource: event.earningsEventSource,
    earningsEventUrl: event.earningsEventUrl,
    earningsDaysFromMeeting: diff,
    earningsDirection: direction,
    earningsScoreContribution: contribution,
    earningsCatalystScore: diff >= 0 ? 3 : 0,
    earningsPriceChangePercent: Number(changePct.toFixed(2)),
    earningsVolumeRatio: Number(volumeRatio.toFixed(2)),
    earningsBaseScore: base,
    earningsAdjustedScore: adjusted,
    finalScore: adjusted
  };
}
function applyNoEvent(row) {
  return {
    ...row,
    earningsEventDetected: false,
    earningsEventStatus: "NO_CONFIRMED_RESULTS_MEETING",
    earningsMeetingDate: "",
    earningsMeetingPurpose: "",
    earningsEventSource: "",
    earningsEventUrl: "",
    earningsDaysFromMeeting: "",
    earningsDirection: "NEUTRAL",
    earningsScoreContribution: 0,
    earningsCatalystScore: 0,
    earningsPriceChangePercent: 0,
    earningsVolumeRatio: 0
  };
}
async function enrichEarningsRows(rows = [], universeSymbols = []) {
  const events = await getEarningsEvents();
  const universe = new Set((Array.isArray(universeSymbols) ? universeSymbols : []).map(cleanSymbol).filter(Boolean));
  const eventBySymbol = new Map();
  for (const event of events) {
    if (!universe.size || universe.has(event.symbol)) {
      const existing = eventBySymbol.get(event.symbol);
      if (!existing || Math.abs(dayDiff(event._meetingDate, new Date())) < Math.abs(dayDiff(existing._meetingDate, new Date()))) eventBySymbol.set(event.symbol, event);
    }
  }
  const today = new Date();
  const rowsWithEvents = events.filter(e => !universe.size || universe.has(e.symbol));
  const enriched = (Array.isArray(rows) ? rows : []).map(row => {
    const symbol = cleanSymbol(row?.stock ?? row?.symbol ?? row?.tradingSymbol);
    const event = eventBySymbol.get(symbol);
    return event ? applyEvent(row, event, today) : applyNoEvent(row);
  });
  return {
    rows: enriched,
    checkedSymbols: universe.size,
    eventSymbols: rowsWithEvents.length,
    events: rowsWithEvents.map(({ _meetingDate, ...event }) => event)
  };
}
module.exports = { enrichEarningsRows, getEarningsEvents, fetchBoardMeetings };
