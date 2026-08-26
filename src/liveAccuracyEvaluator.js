const { getBroker } = require('./brokers');
const { getGoogleSheetUrl } = require('./googleSheet');
const { evaluateAccuracy } = require('./accuracyTracker');
const axios = require('axios');

const TIMEFRAME = 'FIFTEEN_MINUTE';
const MAX_ROWS = 100;

function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function clean(v) { return String(v ?? '').trim(); }

async function readAccuracyRows() {
  const url = getGoogleSheetUrl();
  if (!url) throw new Error('Google Sheet webhook URL is not configured');
  const response = await axios.post(url, { action: 'getAccuracyRows', limit: MAX_ROWS }, { timeout: 120000, headers: { 'Content-Type': 'application/json' } });
  if (response?.data?.success === false) throw new Error(response.data.error || 'Google Sheets rejected getAccuracyRows');
  return response?.data?.rows && Array.isArray(response.data.rows) ? response.data.rows : [];
}

function rowToRecord(row) {
  return {
    recordId: clean(row.recordId), timestamp: clean(row.timestamp), date: clean(row.date), time: clean(row.time),
    stock: clean(row.stock || row.symbol), symbol: clean(row.symbol || row.stock), direction: clean(row.direction),
    decision: clean(row.decision), confidence: n(row.confidence), stockPriceAtSignal: n(row.stockPriceAtSignal),
    stockEntry: n(row.stockEntry), stockStopLoss: n(row.stockStopLoss), stockTarget1: n(row.stockTarget1), stockTarget2: n(row.stockTarget2),
    highestStockPriceReached: n(row.highestStockPriceReached), highestStockPriceDate: clean(row.highestStockPriceDate), highestStockPriceTime: clean(row.highestStockPriceTime),
    lowestStockPriceReached: n(row.lowestStockPriceReached), lowestStockPriceDate: clean(row.lowestStockPriceDate), lowestStockPriceTime: clean(row.lowestStockPriceTime),
    maxFavorableMove: n(row.maxFavorableMove) || 0, maxFavorableMovePercent: n(row.maxFavorableMovePercent) || 0,
    maxAdverseMove: n(row.maxAdverseMove) || 0, maxAdverseMovePercent: n(row.maxAdverseMovePercent) || 0,
    stopLossReached: row.stopLossReached === true || clean(row.stopLossReached).toUpperCase() === 'TRUE',
    stopLossReachedDate: clean(row.stopLossReachedDate), stopLossReachedTime: clean(row.stopLossReachedTime),
    target1Reached: row.target1Reached === true || clean(row.target1Reached).toUpperCase() === 'TRUE',
    target1ReachedDate: clean(row.target1ReachedDate), target1ReachedTime: clean(row.target1ReachedTime),
    target2Reached: row.target2Reached === true || clean(row.target2Reached).toUpperCase() === 'TRUE',
    target2ReachedDate: clean(row.target2ReachedDate), target2ReachedTime: clean(row.target2ReachedTime),
    accuracyPercent: n(row.accuracyPercent) || 0, evaluationStatus: clean(row.evaluationStatus) || 'PENDING', evaluationDate: clean(row.evaluationDate)
  };
}

function updatePayload(record) {
  return {
    recordId: record.recordId,
    actualHigh: record.highestStockPriceReached,
    actualLow: record.lowestStockPriceReached,
    maxFavorableMove: record.maxFavorableMove,
    maxAdverseMove: record.maxAdverseMove,
    maxFavorablePercent: record.maxFavorableMovePercent,
    maxAdversePercent: record.maxAdverseMovePercent,
    target1Reached: record.target1Reached,
    target2Reached: record.target2Reached,
    stopLossReached: record.stopLossReached,
    target1Time: record.target1ReachedTime ? `${record.target1ReachedDate}T${record.target1ReachedTime}` : '',
    target2Time: record.target2ReachedTime ? `${record.target2ReachedDate}T${record.target2ReachedTime}` : '',
    stopLossTime: record.stopLossReachedTime ? `${record.stopLossReachedDate}T${record.stopLossReachedTime}` : '',
    finalOutcome: record.evaluationStatus,
    completedTime: record.evaluationDate,
    accuracyPercent: record.accuracyPercent,
    livePrice: record.highestStockPriceReached
  };
}

async function writeAccuracyUpdates(updates) {
  if (!updates.length) return { updated: 0, notFound: 0 };
  const url = getGoogleSheetUrl();
  if (!url) throw new Error('Google Sheet webhook URL is not configured');
  const response = await axios.post(url, { action: 'updateAccuracy', updates }, { timeout: 120000, headers: { 'Content-Type': 'application/json' } });
  if (response?.data?.success === false) throw new Error(response.data.error || 'Google Sheets rejected accuracy update');
  return response.data || {};
}

async function evaluateLiveAccuracy() {
  const rows = await readAccuracyRows();
  if (!rows.length) return { found: 0, evaluated: 0, updated: 0, skipped: 0 };
  const broker = getBroker();
  if (!broker?.getHistoricalData) throw new Error('Active broker does not implement getHistoricalData()');

  const cache = new Map();
  const updates = [];
  let skipped = 0;

  for (const raw of rows) {
    const record = rowToRecord(raw);
    if (!record.recordId || !record.symbol || !['CALL', 'PUT'].includes(record.direction)) { skipped++; continue; }
    if (String(record.evaluationStatus).toUpperCase() === 'T2_REACHED') { skipped++; continue; }
    try {
      if (!cache.has(record.symbol)) cache.set(record.symbol, await broker.getHistoricalData(record.symbol, TIMEFRAME));
      const candles = cache.get(record.symbol);
      const evaluated = evaluateAccuracy(record, candles, new Date());
      updates.push(updatePayload(evaluated));
    } catch (e) {
      console.log(`⚠️ Accuracy live evaluation failed ${record.symbol}: ${e.message}`);
      skipped++;
    }
  }

  const result = await writeAccuracyUpdates(updates);
  return { found: rows.length, evaluated: updates.length, updated: Number(result.updated || 0), notFound: Number(result.notFound || 0), skipped };
}

module.exports = { evaluateLiveAccuracy };
