/* localStorage document for the demo: snapshot book + journal + local notes. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    Object.keys(api).forEach(function (k) { root.App[k] = api[k]; });
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var SCHEMA_VERSION = '1.3';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function bookFromSeed(seed) {
    return {
      trades: clone(seed.trades || []),
      dates: clone(seed.dates || []),
      holdings: clone(seed.holdings || {}),
      overview: clone(seed.overview || {})
    };
  }

  function emptyNotes() {
    return { reviews: {}, plans: {} };
  }

  function noteKey(date, name) {
    return date + '|' + name;
  }

  function bootstrap(seed) {
    return {
      schema: SCHEMA_VERSION,
      source: 'demo-seed',
      book: bookFromSeed(seed),
      notes: emptyNotes()
    };
  }

  function restoreDemo(seed) {
    return bootstrap(seed);
  }

  function resetNotes(state) {
    var next = clone(state);
    next.notes = emptyNotes();
    return next;
  }

  function demoSeedReport(seed) {
    var reasons = [];
    var trades = (seed && seed.trades) || [];
    var dates = (seed && seed.dates ? seed.dates.slice() : []).sort();
    var symbols = {};
    trades.forEach(function (trade) { symbols[trade.name] = true; });
    var symbolList = Object.keys(symbols).sort();
    if (trades.length !== 23) reasons.push('trade-count');
    if (dates[0] !== '2026-09-01' || dates[dates.length - 1] !== '2026-09-28') reasons.push('date-range');
    if (dates.length !== 19) reasons.push('date-count');
    if (symbolList.length !== 4) reasons.push('symbol-count');
    if (dates.indexOf('2026-09-30') !== -1) reasons.push('unexpected-date');
    var packed = JSON.stringify(seed || {});
    var blocked = ['真实', '持仓'].join('');
    var blockedSnapshot = ['券商', '账户快照'].join('');
    if (packed.indexOf(blocked) !== -1 || packed.indexOf(blockedSnapshot) !== -1) reasons.push('forbidden-text');
    return {
      ok: reasons.length === 0,
      reasons: reasons,
      tradeCount: trades.length,
      dateCount: dates.length,
      symbols: symbolList,
      start: dates[0] || null,
      end: dates[dates.length - 1] || null
    };
  }

  return {
    clone: clone,
    bookFromSeed: bookFromSeed,
    emptyNotes: emptyNotes,
    noteKey: noteKey,
    bootstrap: bootstrap,
    restoreDemo: restoreDemo,
    resetNotes: resetNotes,
    demoSeedReport: demoSeedReport
  };
});
