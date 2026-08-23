// MARKET STRUCTURE PATCH
// Keeps SL/T1/T2 tied to existing market levels only.
// No ATR, percentage, or synthetic prices are created.
const Module = require('module');
const originalLoad = Module._load;

function n(v) { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; }
function uniq(a) { return [...new Set(a.map(n).filter(Boolean))].sort((x,y)=>x-y); }
function direction(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (['CALL','CE','BULLISH','BULL','BUY','LONG'].includes(s)) return 'CALL';
  if (['PUT','PE','BEARISH','BEAR','SELL','SHORT'].includes(s)) return 'PUT';
  return '';
}
function levels(c, side, entry) {
  const arr = Array.isArray(c?.[side + 'Levels']) ? c[side + 'Levels'] : [];
  const keys = side === 'support'
    ? ['support1','support2','support3','s1','s2','s3','pivotS1','pivotS2','pivotS3']
    : ['resistance1','resistance2','resistance3','r1','r2','r3','pivotR1','pivotR2','pivotR3'];
  const vals = [...arr, ...keys.map(k=>c?.[k])];
  return uniq(vals).filter(x => side === 'support' ? x < entry : x > entry);
}
function prepareCandidate(c) {
  if (!c || typeof c !== 'object') return c;
  const type = direction(c.optionType || c.direction || c.finalDirection || c.stockDirection);
  const entry = n(c.entry || c.price || c.ltp || c.close);
  if (!type || !entry) return c;

  const supports = levels(c, 'support', entry).sort((a,b)=>b-a);
  const resistances = levels(c, 'resistance', entry).sort((a,b)=>a-b);
  if (!supports.length || !resistances.length) return c;

  if (type === 'CALL') {
    const stop = supports[0];
    const risk = entry - stop;
    if (!(risk > 0)) return c;
    const targetIndex = resistances.findIndex(r => ((r-entry)/risk) >= 1.5);
    if (targetIndex < 0) return c;
    const target = resistances[targetIndex];
    const next = resistances.slice(targetIndex + 1);
    return {
      ...c,
      support1: stop,
      support2: supports[1] || 0,
      support3: supports[2] || 0,
      supportLevels: supports,
      resistance1: target,
      resistance2: next[0] || 0,
      resistance3: next[1] || 0,
      resistanceLevels: [target, ...next],
      pivot: { ...(c.pivot || {}), r1: target, r2: next[0] || 0, r3: next[1] || 0 }
    };
  }

  const stop = resistances[0];
  const risk = stop - entry;
  if (!(risk > 0)) return c;
  const targetIndex = supports.findIndex(s => ((entry-s)/risk) >= 1.5);
  if (targetIndex < 0) return c;
  const target = supports[targetIndex];
  const next = supports.slice(targetIndex + 1);
  return {
    ...c,
    resistance1: stop,
    resistance2: resistances[1] || 0,
    resistance3: resistances[2] || 0,
    resistanceLevels: resistances,
    support1: target,
    support2: next[0] || 0,
    support3: next[1] || 0,
    supportLevels: [target, ...next],
    pivot: { ...(c.pivot || {}), s1: target, s2: next[0] || 0, s3: next[1] || 0 }
  };
}

Module._load = function(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (!request.endsWith('optionsDecisionEngine')) return loaded;
  if (typeof loaded !== 'function' || loaded.__marketStructurePatched) return loaded;

  const wrapped = async function(input, ...rest) {
    const prepared = Array.isArray(input) ? input.map(prepareCandidate) : input;
    return loaded.call(this, prepared, ...rest);
  };
  Object.setPrototypeOf(wrapped, Object.getPrototypeOf(loaded));
  Object.assign(wrapped, loaded);
  wrapped.__marketStructurePatched = true;
  return wrapped;
};
