#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
var format = require(path.join(root, 'js/logic/format.js'));
var portfolio = require(path.join(root, 'js/logic/portfolio.js'));
var tradesApi = require(path.join(root, 'js/logic/trades.js'));
var stateApi = require(path.join(root, 'js/logic/state.js'));
var schema = require(path.join(root, 'js/logic/schema.js'));

var passed = 0;
var failed = 0;

function check(name, cond) {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL ' + name);
}

function loadSeed() {
  var sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'js/data/seed.js'), 'utf8'),
    sandbox,
    { filename: 'js/data/seed.js' }
  );
  return sandbox.App.Seed;
}

function nearly(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) <= (eps == null ? 0.05 : eps);
}

var seedText = fs.readFileSync(path.join(root, 'js/data/seed.js'), 'utf8');
var seed = loadSeed();
var report = stateApi.demoSeedReport(seed);

check('schema is 1.3', schema.SCHEMA_VERSION === '1.3');
check('demo seed report ok', report.ok);
check('23 trades', seed.trades.length === 23 && report.tradeCount === 23);
check('19 dates', report.dateCount === 19);
check('range starts 2026-09-01', report.start === '2026-09-01');
check('range ends 2026-09-28', report.end === '2026-09-28');
check('four fictional symbols', report.symbols.join(',') === ['红利ETF', '恒生科技', '港股通创新药', '科创50'].sort().join(','));
check('seed header is demo', seedText.indexOf('自动生成：v0.0 Demo 内置种子数据') === 0);
var blocked = ['真实', '持仓'].join('');
var blockedSnapshot = ['券商', '账户快照'].join('');
check('seed has no forbidden phrase', seedText.indexOf(blocked) === -1 && seedText.indexOf(blockedSnapshot) === -1);
check('seed dates omit 2026-09-30', seed.dates.indexOf('2026-09-30') === -1);

function walk(dir, acc) {
  fs.readdirSync(dir).forEach(function (name) {
    if (name === '.git' || name === 'node_modules') return;
    var full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  });
  return acc;
}

walk(root, []).forEach(function (file) {
  var base = path.basename(file);
  check('no real backup filename ' + base, !/seed\.js\.bak-real/i.test(base));
  if (!/\.(js|html|css|md|json)$/.test(base)) return;
  var text = fs.readFileSync(file, 'utf8');
  check('no forbidden text in ' + path.relative(root, file), text.indexOf(blocked) === -1 && text.indexOf(blockedSnapshot) === -1);
});

var dates = portfolio.listDates(seed);
dates.forEach(function (date) {
  var rows = portfolio.holdingsFor(seed, date, true);
  var ov = portfolio.overviewFor(seed, date);
  check('overview exists ' + date, !!ov);
  check('four holdings ' + date, rows.length === 4);
  check('market value sums ' + date, nearly(portfolio.sumField(rows, 'market_value'), ov.market_value));
  check('day pnl sums ' + date, nearly(portfolio.sumField(rows, 'day_pnl'), ov.day_pnl));
  check('floating pnl sums ' + date, nearly(portfolio.sumField(rows, 'floating_pnl'), ov.floating_pnl));
});

check('opening assets', portfolio.overviewFor(seed, '2026-09-01').total_assets === 991408.5);
check('latest assets', portfolio.overviewFor(seed, '2026-09-28').total_assets === 967399);

var weights = portfolio.marketValueWeights(portfolio.holdingsFor(seed, '2026-09-01', false));
check('weights sum to 100', nearly(weights.reduce(function (s, row) { return s + row.weight; }, 0), 100));

var rank = portfolio.dayPnlRank(portfolio.holdingsFor(seed, '2026-09-21', false));
check('day pnl rank is descending', rank[0].day_pnl >= rank[rank.length - 1].day_pnl);

var series = portfolio.assetSeries(seed);
var pts = portfolio.seriesPoints(series.map(function (p) { return p.total_assets; }), 640, 220, { l: 16, r: 16, t: 16, b: 28 });
check('chart starts at left pad', pts[0].x === 16);
check('chart ends at right edge', pts[pts.length - 1].x === 624);
var maxValue = Math.max.apply(null, series.map(function (p) { return p.total_assets; }));
var maxPoint = pts.filter(function (p) { return p.value === maxValue; })[0];
var minY = Math.min.apply(null, pts.map(function (p) { return p.y; }));
check('max asset is highest on the chart', maxPoint.y === minY);

check('format thousands', format.fmtNumber(991408.5) === '991,408.50');
check('format signed', format.fmtSigned(1251.6) === '+1,251.60' && format.fmtSigned(-10) === '-10.00');
check('format pct', format.fmtPct(-0.86) === '-0.86%' && format.fmtPct(1.62) === '+1.62%');
check('tone', format.pnlTone(1) === 'up' && format.pnlTone(-1) === 'down' && format.pnlTone(0) === 'flat');

var stats = tradesApi.tradeStats(seed.trades);
check('status mix', stats.byStatus.filled === 19 && stats.byStatus.partial === 1 && stats.byStatus.cancelled === 1 && stats.byStatus.pending === 2);
check('effective excludes pending and cancelled', stats.effective === 20);

check('创新药 journal qty', tradesApi.positionFromTrades(seed.trades, '港股通创新药', '2026-09-28') === 50000);
check('恒生科技 journal qty', tradesApi.positionFromTrades(seed.trades, '恒生科技', '2026-09-28') === 60000);
check('科创50 journal qty', tradesApi.positionFromTrades(seed.trades, '科创50', '2026-09-28') === 30000);
check('红利ETF journal qty', tradesApi.positionFromTrades(seed.trades, '红利ETF', '2026-09-28') === 0);
check('pending add is ignored', tradesApi.positionFromTrades(seed.trades, '恒生科技', '2026-09-28') === tradesApi.positionFromTrades(seed.trades, '恒生科技', '2026-09-24'));
check('cancelled buy is ignored', tradesApi.positionFromTrades(seed.trades, '红利ETF', '2026-09-10') === 60000);

var sell = seed.trades.filter(function (t) { return t.id === 't260904101522b05'; })[0];
var realized = tradesApi.realizedOnSell(seed.trades, sell);
check('linked reduce pnl', realized && realized.pnl === 268 && realized.covered === 40000 && realized.unlinked === 0);

var split = seed.trades.filter(function (t) { return t.id === 't260922093544b17'; })[0];
var splitPnl = tradesApi.realizedOnSell(seed.trades, split);
check('split link pnl', splitPnl && splitPnl.pnl === 1504 && splitPnl.covered === 40000);

var pending = seed.trades.filter(function (t) { return t.id === 't260928132055b23'; })[0];
check('pending sell has no realized pnl', tradesApi.realizedOnSell(seed.trades, pending) === null);

var filtered = tradesApi.filterTrades(seed.trades, { name: '红利ETF', status: 'cancelled' });
check('filter cancelled dividend etf', filtered.length === 1 && filtered[0].id === 't260910094206a06');

var doc = stateApi.bootstrap(seed);
doc.book.trades.push({ id: 'extra' });
doc.notes.reviews['2026-09-28'] = '本地备注';
var restored = stateApi.restoreDemo(seed);
check('restore drops edited trades', restored.book.trades.length === 23);
check('restore clears notes', Object.keys(restored.notes.reviews).length === 0);
var reset = stateApi.resetNotes(doc);
check('reset keeps edited book', reset.book.trades.length === 24);
check('reset clears notes only', Object.keys(reset.notes.reviews).length === 0 && Object.keys(reset.notes.plans).length === 0);
check('cleared holdings stay hidden by default', portfolio.holdingsFor({ dates: ['2026-09-01'], holdings: { '2026-09-01': [{ name: '甲', cleared: 0 }, { name: '乙', cleared: 1 }] } }, '2026-09-01', false).length === 1);

console.log('logic_test: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
