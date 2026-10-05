/* Browser shell. Books come from the built-in demo seed; notes stay in localStorage. */
(function () {
  var App = window.App;
  var state = null;
  var currentDate = null;
  var activeTab = 'overview';
  var tradeQuery = { name: '', action: '', status: '', text: '' };
  var openTradeId = null;
  var includeCleared = false;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toneClass(n) { return App.pnlTone(n); }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(App.STORAGE_KEY); } catch (err) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.book && parsed.notes && parsed.schema === App.SCHEMA_VERSION) return parsed;
      } catch (err) { /* fall through to seed */ }
    }
    return App.bootstrap(App.Seed);
  }

  function saveState() {
    try { localStorage.setItem(App.STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* private mode */ }
  }

  function dates() { return App.listDates(state.book); }

  function ensureDate() {
    var list = dates();
    if (!currentDate || list.indexOf(currentDate) === -1) currentDate = list[list.length - 1] || '';
  }

  function fillDates() {
    var select = document.getElementById('dateSelect');
    var list = dates();
    select.innerHTML = list.map(function (date) {
      return '<option value="' + esc(date) + '">' + esc(date) + '</option>';
    }).join('');
    select.value = currentDate;
  }

  function setTab(name) {
    activeTab = name;
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    ['overview', 'holdings', 'trades', 'review'].forEach(function (tab) {
      document.getElementById('tab-' + tab).setAttribute('aria-selected', tab === name ? 'true' : 'false');
      document.getElementById('panel-' + tab).classList.toggle('active', tab === name);
    });
    renderActive();
  }

  function renderActive() {
    if (activeTab === 'overview') renderOverview();
    else if (activeTab === 'holdings') renderHoldings();
    else if (activeTab === 'trades') renderTrades();
    else renderReview();
  }

  function renderOverview() {
    var ov = App.overviewFor(state.book, currentDate) || {};
    var rows = App.holdingsFor(state.book, currentDate, false);
    var weights = App.marketValueWeights(rows);
    var rank = App.dayPnlRank(rows);
    var series = App.assetSeries(state.book);
    var values = series.map(function (point) { return point.total_assets; });
    var pts = App.seriesPoints(values, 640, 220, { l: 16, r: 16, t: 16, b: 28 });
    var line = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
    var area = pts.length ? (pts[0].x + ',192 ' + line + ' ' + pts[pts.length - 1].x + ',192') : '';
    var labels = series.map(function (point, i) {
      if (i !== 0 && i !== series.length - 1 && i !== Math.floor(series.length / 2)) return '';
      var x = pts[i] ? pts[i].x : 0;
      return '<text class="axis" x="' + x + '" y="214" text-anchor="middle">' + esc(point.date.slice(5)) + '</text>';
    }).join('');

    var maxAbs = rank.reduce(function (m, row) { return Math.max(m, Math.abs(Number(row.day_pnl) || 0)); }, 0) || 1;

    document.getElementById('panel-overview').innerHTML =
      '<div class="metrics">' +
        metric('总资产', App.fmtNumber(ov.total_assets), 'flat') +
        metric('总市值', App.fmtNumber(ov.market_value), 'flat', '仓位 ' + (ov.position_pct == null ? '-' : ov.position_pct + '%')) +
        metric('浮动盈亏', App.fmtSigned(ov.floating_pnl), toneClass(ov.floating_pnl)) +
        metric('当日盈亏', App.fmtSigned(ov.day_pnl), toneClass(ov.day_pnl), App.fmtPct(ov.day_pnl_pct)) +
      '</div>' +
      '<div class="stat-row">' +
        stat('可用资金', App.fmtNumber(ov.available)) +
        stat('可取资金', App.fmtNumber(ov.withdrawable)) +
        stat('试验快照日', esc(currentDate)) +
      '</div>' +
      '<div class="split">' +
        '<section class="card"><h2>总资产</h2>' +
          '<svg class="chart" viewBox="0 0 640 220" role="img" aria-label="总资产曲线">' +
            '<polygon class="chart-area" points="' + area + '"></polygon>' +
            '<polyline class="chart-line" points="' + line + '"></polyline>' + labels +
          '</svg>' +
        '</section>' +
        '<section class="card"><h2>当日盈亏</h2>' +
          rank.map(function (row) {
            var width = Math.max(4, Math.round(Math.abs(Number(row.day_pnl)) / maxAbs * 100));
            return '<div class="bar-row"><span>' + esc(row.name) + '</span><div class="track"><div class="fill ' + toneClass(row.day_pnl) + '" style="width:' + width + '%"></div></div><span class="num ' + toneClass(row.day_pnl) + '">' + esc(App.fmtSigned(row.day_pnl, 1)) + '</span></div>';
          }).join('') +
          '<h2 style="margin-top:18px">市值占比</h2>' +
          weights.map(function (row) {
            return '<div class="weight-row"><span>' + esc(row.name) + '</span><div class="track"><div class="fill weight" style="width:' + Math.max(2, row.weight).toFixed(1) + '%"></div></div><span class="num">' + row.weight.toFixed(1) + '%</span></div>';
          }).join('') +
        '</section>' +
      '</div>';
  }

  function metric(label, value, tone, sub) {
    return '<section class="card"><p class="k">' + esc(label) + '</p><p class="v ' + tone + '">' + esc(value) + '</p>' +
      (sub ? '<p class="sub ' + tone + '">' + esc(sub) + '</p>' : '') + '</section>';
  }

  function stat(label, value) {
    return '<section class="card"><p class="k">' + esc(label) + '</p><p class="v">' + value + '</p></section>';
  }

  function renderHoldings() {
    var rows = App.holdingsFor(state.book, currentDate, includeCleared);
    var totalMv = Number((App.overviewFor(state.book, currentDate) || {}).market_value) || 0;
    var cards = rows.map(function (row) {
      var weight = totalMv ? (Number(row.market_value) / totalMv) * 100 : 0;
      var tone = toneClass(row.day_pnl);
      var plan = state.notes.plans[App.noteKey(currentDate, row.name)] || '';
      var tag = row.cleared
        ? '<span class="tag">已清仓</span>'
        : '<span class="tag ' + tone + '">' + esc(App.fmtPct(row.day_pnl_pct)) + '</span>';
      return '<article class="card holding ' + (row.cleared ? 'flat' : tone) + '">' +
        '<header><div><h3>' + esc(row.name) + tag + '</h3><p class="sub">快照持仓</p></div>' +
        '<div style="text-align:right"><strong class="num">' + esc(App.fmtNumber(row.market_value)) + '</strong><p class="sub">占比 ' + weight.toFixed(1) + '%</p></div></header>' +
        '<div class="kv">' +
          kv('持仓 / 可用', App.fmtNumber(row.position, 0) + ' / ' + App.fmtNumber(row.available, 0)) +
          kv('成本 / 现价', App.fmtNumber(row.cost, 4) + ' / ' + App.fmtNumber(row.current_price, 4)) +
          kv('浮动盈亏', App.fmtSigned(row.floating_pnl), toneClass(row.floating_pnl)) +
          kv('浮动盈亏%', App.fmtPct(row.floating_pnl_pct), toneClass(row.floating_pnl_pct)) +
          kv('当日盈亏', App.fmtSigned(row.day_pnl), toneClass(row.day_pnl)) +
          kv('当日盈亏%', App.fmtPct(row.day_pnl_pct), toneClass(row.day_pnl_pct)) +
        '</div>' +
        '<label class="field" for="plan-' + esc(row.name) + '">当日备注</label>' +
        '<textarea id="plan-' + esc(row.name) + '" data-plan="' + esc(row.name) + '" placeholder="只保存在本机，恢复演示数据时会清空">' + esc(plan) + '</textarea>' +
        '<p class="sub"><button type="button" class="btn ghost" data-open-symbol="' + esc(row.name) + '">查看该标的流水</button></p>' +
      '</article>';
    }).join('');

    document.getElementById('panel-holdings').innerHTML =
      '<div class="toolbar" style="margin-bottom:12px">' +
        '<button type="button" class="btn" id="btnCleared">' + (includeCleared ? '隐藏已清仓' : '显示已清仓') + '</button>' +
        '<span class="journal-note">持仓卡片来自每日试验快照。交易页的模拟流水单独存放，不会改写这些数量。</span>' +
      '</div>' +
      '<div class="holdings">' + (cards || '<p class="empty">这一天没有持仓快照。</p>') + '</div>';

    var clearedBtn = document.getElementById('btnCleared');
    if (clearedBtn) clearedBtn.addEventListener('click', function () {
      includeCleared = !includeCleared;
      renderHoldings();
    });
    document.querySelectorAll('[data-plan]').forEach(function (el) {
      el.addEventListener('input', function () {
        state.notes.plans[App.noteKey(currentDate, el.getAttribute('data-plan'))] = el.value;
        saveState();
      });
    });
    document.querySelectorAll('[data-open-symbol]').forEach(function (el) {
      el.addEventListener('click', function () {
        tradeQuery.name = el.getAttribute('data-open-symbol');
        setTab('trades');
      });
    });
  }

  function kv(label, value, tone) {
    return '<p><span class="k">' + esc(label) + '</span><span class="num ' + (tone || '') + '">' + esc(value) + '</span></p>';
  }

  function renderTrades() {
    var symbols = App.tradeSymbols(state.book.trades);
    var rows = App.filterTrades(state.book.trades, {
      name: tradeQuery.name,
      action: tradeQuery.action,
      status: tradeQuery.status,
      text: tradeQuery.text
    });
    var stats = App.tradeStats(state.book.trades);
    var positions = App.journalPositions(state.book.trades, currentDate);

    var options = function (list, current, allLabel) {
      var html = '<option value="">' + esc(allLabel) + '</option>';
      list.forEach(function (item) {
        var value = item.value || item;
        var label = item.label || item;
        html += '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
      });
      return html;
    };

    var body = rows.map(function (trade) {
      var tone = trade.action === 'buy' || trade.action === 'add' ? 'up' : 'down';
      var main = '<tr class="trade" data-trade="' + esc(trade.id) + '">' +
        '<td>' + esc(trade.date) + ' ' + esc(trade.trade_time || '') + '</td>' +
        '<td>' + esc(trade.name) + '</td>' +
        '<td class="' + tone + '">' + esc(App.ACTION_LABEL[trade.action] || trade.action) + '</td>' +
        '<td class="num">' + esc(App.fmtNumber(trade.amount, 0)) + '</td>' +
        '<td class="num">' + esc(App.fmtNumber(trade.price, 4)) + '</td>' +
        '<td>' + esc(App.STATUS_LABEL[trade.status] || trade.status) + '</td>' +
        '<td>' + esc(trade.sell_type || trade.reason_type || '') + '</td>' +
      '</tr>';
      if (openTradeId !== trade.id) return main;
      var realized = App.realizedOnSell(state.book.trades, trade);
      var links = Object.keys(trade.linked_qty_map || {}).map(function (id) {
        return id + ' × ' + trade.linked_qty_map[id];
      }).join('，');
      return main + '<tr class="detail"><td colspan="7"><div class="detail-grid">' +
        detail('编号', trade.id) +
        detail('对手方', trade.counterparty) +
        detail('买入理由', trade.buy_reason) +
        detail('预计周期', trade.expected_period) +
        detail('失效条件', trade.invalid_condition) +
        detail('目标价', trade.target_price_low == null ? '' : (trade.target_price_low + ' – ' + trade.target_price_high)) +
        detail('止损', trade.stop_loss) +
        detail('卖出说明', trade.sell_note) +
        detail('关联买入', links) +
        detail('关联部分已实现盈亏', realized ? App.fmtSigned(realized.pnl) : '—') +
      '</div></td></tr>';
    }).join('');

    document.getElementById('panel-trades').innerHTML =
      '<section class="card" style="margin-bottom:12px">' +
        '<p class="journal-note">流水共 ' + stats.total + ' 笔，其中已成或部成 ' + stats.effective + ' 笔。下面的剩余数量只按流水推算，和持仓页的试验快照不是同一套数量。</p>' +
        '<div class="pills">' + positions.map(function (item) {
          return '<span class="pill">' + esc(item.name) + ' ' + esc(App.fmtNumber(item.qty, 0)) + '</span>';
        }).join('') + '</div>' +
      '</section>' +
      '<div class="filters">' +
        '<select id="fSymbol" aria-label="标的">' + options(symbols, tradeQuery.name, '全部标的') + '</select>' +
        '<select id="fAction" aria-label="方向">' + options([
          { value: 'buy', label: '买入' }, { value: 'add', label: '加仓' }, { value: 'reduce', label: '减仓' },
          { value: 'sell', label: '卖出' }, { value: 'clear', label: '清仓' }
        ], tradeQuery.action, '全部方向') + '</select>' +
        '<select id="fStatus" aria-label="状态">' + options([
          { value: 'filled', label: '已成' }, { value: 'partial', label: '部成' },
          { value: 'pending', label: '未成' }, { value: 'cancelled', label: '已撤' }
        ], tradeQuery.status, '全部状态') + '</select>' +
        '<input id="fText" type="search" placeholder="搜索理由或说明" value="' + esc(tradeQuery.text) + '" />' +
      '</div>' +
      '<div class="card table-wrap"><table><thead><tr><th>时间</th><th>标的</th><th>方向</th><th>数量</th><th>价格</th><th>状态</th><th>类型</th></tr></thead><tbody>' +
        (body || '<tr><td colspan="7" class="empty">没有符合条件的成交。</td></tr>') +
      '</tbody></table></div>';

    document.getElementById('fSymbol').addEventListener('change', function (e) { tradeQuery.name = e.target.value; renderTrades(); });
    document.getElementById('fAction').addEventListener('change', function (e) { tradeQuery.action = e.target.value; renderTrades(); });
    document.getElementById('fStatus').addEventListener('change', function (e) { tradeQuery.status = e.target.value; renderTrades(); });
    var textBox = document.getElementById('fText');
    textBox.addEventListener('input', function (e) {
      tradeQuery.text = e.target.value;
      var caret = e.target.selectionStart;
      renderTrades();
      var next = document.getElementById('fText');
      next.focus();
      next.setSelectionRange(caret, caret);
    });
    document.querySelectorAll('tr.trade').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-trade');
        openTradeId = openTradeId === id ? null : id;
        renderTrades();
      });
    });
  }

  function detail(label, value) {
    return '<p class="k">' + esc(label) + '</p><p>' + esc(value || '—') + '</p>';
  }

  function renderReview() {
    var text = state.notes.reviews[currentDate] || '';
    var dayTrades = App.filterTrades(state.book.trades, { date: currentDate });
    document.getElementById('panel-review').innerHTML =
      '<section class="card">' +
        '<h2>' + esc(currentDate) + ' 整体复盘</h2>' +
        '<p class="journal-note">写在这里的文字只留在本机。重置备注或恢复演示数据都会清掉它。</p>' +
        '<textarea id="reviewBox" placeholder="记录当天的计划执行、偏差和下一次要守住的条件">' + esc(text) + '</textarea>' +
      '</section>' +
      '<section class="card" style="margin-top:12px"><h2>当日流水 ' + dayTrades.length + ' 笔</h2>' +
        (dayTrades.length ? '<ul>' + dayTrades.map(function (trade) {
          return '<li>' + esc(trade.trade_time || '') + ' ' + esc(trade.name) + ' ' +
            esc(App.ACTION_LABEL[trade.action] || trade.action) + ' ' +
            esc(App.fmtNumber(trade.amount, 0)) + ' @ ' + esc(App.fmtNumber(trade.price, 4)) +
            '（' + esc(App.STATUS_LABEL[trade.status] || trade.status) + '）</li>';
        }).join('') + '</ul>' : '<p class="empty">这一天没有模拟成交。</p>') +
      '</section>';
    document.getElementById('reviewBox').addEventListener('input', function (e) {
      state.notes.reviews[currentDate] = e.target.value;
      saveState();
    });
  }

  function boot() {
    var report = App.demoSeedReport(App.Seed);
    if (!report.ok) {
      document.getElementById('panel-overview').innerHTML = '<p class="empty">内置演示种子未通过自检：' + esc(report.reasons.join(', ')) + '</p>';
      return;
    }
    state = loadState();
    ensureDate();
    fillDates();
    saveState();
    var hash = (location.hash || '#overview').slice(1);
    if (['overview', 'holdings', 'trades', 'review'].indexOf(hash) === -1) hash = 'overview';
    setTab(hash);

    document.getElementById('dateSelect').addEventListener('change', function (e) {
      currentDate = e.target.value;
      renderActive();
    });
    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.getAttribute('data-tab')); });
    });
    document.getElementById('btnRestore').addEventListener('click', function () {
      if (!window.confirm('用内置虚构试验数据覆盖本机账本，并清空备注？此操作只影响当前浏览器。')) return;
      state = App.restoreDemo(App.Seed);
      tradeQuery = { name: '', action: '', status: '', text: '' };
      openTradeId = null;
      ensureDate();
      fillDates();
      saveState();
      renderActive();
    });
    document.getElementById('btnReset').addEventListener('click', function () {
      if (!window.confirm('清空本机的复盘和持仓备注？试验账本会保留。')) return;
      state = App.resetNotes(state);
      saveState();
      renderActive();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
