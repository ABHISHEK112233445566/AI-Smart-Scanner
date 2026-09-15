const core = require('./googleSheetCore');

function enrichRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(row => {
        const r = row && typeof row === 'object' ? row : {};
        const rank = r.ranking && typeof r.ranking === 'object' ? r.ranking : {};
        const breakout = r.breakout && typeof r.breakout === 'object' ? r.breakout : {};
        return {
            ...r,
            chartPattern: r.chartPattern ?? rank.chartPattern ?? breakout.chartPattern ?? 'NONE',
            patternStatus: r.patternStatus ?? rank.patternStatus ?? breakout.patternStatus ?? 'NONE',
            patternDirection: r.patternDirection ?? rank.patternDirection ?? breakout.patternDirection ?? 'NEUTRAL',
            patternTimeframe: r.patternTimeframe ?? breakout.patternTimeframe ?? '1D',
            patternConfidence: r.patternConfidence ?? rank.patternConfidence ?? breakout.patternConfidence ?? 0,
            patternScore: r.patternScore ?? rank.patternScore ?? breakout.patternScore ?? 0,
            patternContribution: r.patternContribution ?? rank.patternContribution ?? breakout.patternContribution ?? 0,
            patternBreakoutLevel: r.patternBreakoutLevel ?? breakout.patternBreakoutLevel ?? 0,
            patternInvalidationLevel: r.patternInvalidationLevel ?? breakout.patternInvalidationLevel ?? 0,
            patternTarget: r.patternTarget ?? breakout.patternTarget ?? 0,
            patternDescription: r.patternDescription ?? breakout.patternDescription ?? '',
            patternDetectedAt: r.patternDetectedAt ?? breakout.patternDetectedAt ?? ''
        };
    });
}

async function updateGoogleSheet(payload = {}) {
    return core.updateGoogleSheet({
        ...payload,
        scannerData: enrichRows(payload.scannerData),
        dashboardData: enrichRows(payload.dashboardData),
        accuracyData: payload.accuracyData
    });
}

module.exports = { ...core, updateGoogleSheet };