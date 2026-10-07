/* ===== Controller：R3 理由-交易对账视图（筛选 / 违规清单 / 分组配对） ===== */
window.App = window.App || {};

App.ReconciliationController = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  function currentFilter() {
    const statusSel = document.getElementById('rcFilterStatus');
    const closureStatus = Array.from(statusSel.selectedOptions).map(o => o.value);
    return {
      dateRange: [
        document.getElementById('rcFilterStart').value,
        document.getElementById('rcFilterEnd').value
      ],
      closureStatus: closureStatus.length ? closureStatus : null
    };
  }

  /* ---------- 违规卡片 ---------- */
  function violationHtml(t) {
    return '<div class="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-1.5 fade-in">' +
      '<div class="flex items-center justify-between">' +
      '<span class="text-sm font-bold text-red-900">' + U().escapeHtml(t.name) + '</span>' +
      '<span class="tag tag-违规">违规</span></div>' +
      '<p class="text-[11px] text-red-800">' + t.date + ' · ' +
      U().fmt(t.amount, 0) + ' 股 · 价格 ' + U().fmt(t.price, 4) + '</p>' +
      '<p class="text-xs text-red-900 leading-relaxed">' + U().escapeHtml(t.sell_note) + '</p>' +
      '<p class="text-[10px] text-red-400">无对应买入理由</p>' +
      '</div>';
  }

  function renderViolations(filter) {
    const list = App.MatchingEngine.getViolations(filter);
    const section = document.getElementById('violationSection');
    if (list.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    document.getElementById('violationCount').textContent = list.length + ' 笔';
    document.getElementById('violationList').innerHTML = list.map(violationHtml).join('');
  }

  /* ---------- 分组配对 ---------- */
  function statusBadge(node) {
    const map = {
      CLOSED: { dot: 'c-CLOSED', text: '已完全平仓', cls: 'text-green-700' },
      PARTIAL: { dot: 'c-PARTIAL', text: '部分平仓（' + node.consumed + '/' + node.trade.amount + '）', cls: 'text-yellow-700' },
      OPEN: { dot: 'c-OPEN', text: '未平仓', cls: 'text-slate-500' }
    };
    const s = map[node.closure_status];
    return '<span class="inline-flex items-center gap-1.5 text-[10px] ' + s.cls + '">' +
      '<span class="closure-dot ' + s.dot + '"></span>' + s.text + '</span>';
  }

  function sellLineHtml(sell) {
    return '<div class="flex items-center gap-2 pl-5 py-1 text-[11px]">' +
      '<svg class="w-3 h-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>' +
      '<span class="text-slate-500">' + sell.date + '</span>' +
      '<span class="tag tag-' + U().escapeHtml(sell.sell_type) + '">' + U().escapeHtml(sell.sell_type) + '</span>' +
      '<span class="text-slate-600 number">' + U().fmt(consumedQtyFor(sell), 0) + ' 股</span>' +
      '<span class="text-slate-400 truncate">' + U().escapeHtml(U().truncate(sell.sell_note, 30)) + '</span>' +
      '</div>';
  }

  /** 卖出在该买入节点下展示的数量（来自 linked_qty_map） */
  function consumedQtyFor(sell) {
    // linked_sells 挂载于节点上下文，这里简单取卖出 amount（一笔卖出挂在其关联买入下；
    // 多买入配比时在各节点显示对应消耗，由 node 上下文决定——调用处传入）
    return sell.amount;
  }

  function buyNodeHtml(node) {
    const t = node.trade;
    const sellLines = node.linked_sells.map(s => {
      const qty = s.linked_qty_map ? s.linked_qty_map[t.id] : s.amount;
      let html = sellLineHtml(s);
      html = html.replace(U().fmt(consumedQtyFor(s), 0), U().fmt(qty, 0));
      return html;
    }).join('');

    return '<div class="border border-slate-100 rounded-xl p-3.5 space-y-1.5 ' +
      (node.has_violation ? 'bg-red-50/40 border-red-200' : '') + '">' +
      '<div class="flex items-start justify-between gap-2">' +
      '<div class="text-xs">' +
      '<span class="font-semibold text-slate-800">' + t.date + '</span>' +
      '<span class="text-slate-400 mx-1">·</span>' +
      '<span class="text-slate-600 number">' + U().fmt(t.amount, 0) + ' 股</span>' +
      '<span class="tag tag-reason ml-1.5">' + U().escapeHtml(t.reason_type) + '</span>' +
      (node.has_violation ? '<span class="tag tag-违规 ml-1">含违规</span>' : '') +
      '</div>' +
      statusBadge(node) +
      '</div>' +
      '<p class="text-[11px] text-slate-500 leading-relaxed">' +
      U().escapeHtml(U().truncate(t.buy_reason, 60)) + '</p>' +
      '<p class="text-[10px] text-slate-400">目标 ' + U().fmt(t.target_price_low, 3) +
      '–' + U().fmt(t.target_price_high, 3) + ' · 止损 ' + U().fmt(t.stop_loss, 3) + '</p>' +
      (sellLines ? '<div class="border-l-2 border-slate-100 ml-2 mt-1">' + sellLines + '</div>' : '') +
      '</div>';
  }

  function groupHtml(group) {
    return '<div class="bg-white rounded-2xl card-shadow p-4 space-y-3 fade-in">' +
      '<div class="flex items-center gap-2">' +
      '<h3 class="text-sm font-bold text-slate-800">' + U().escapeHtml(group.name) + '</h3>' +
      '<span class="text-[10px] text-slate-400">' + group.buys.length + ' 条买入记录</span>' +
      '</div>' +
      '<div class="space-y-2">' + group.buys.map(buyNodeHtml).join('') + '</div>' +
      '</div>';
  }

  function render() {
    const filter = currentFilter();
    renderViolations(filter);

    const groups = App.MatchingEngine.getReconciliationView(filter);
    const container = document.getElementById('reconciliationGroups');
    const empty = document.getElementById('rcEmpty');

    if (groups.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    container.innerHTML = groups.map(groupHtml).join('');
  }

  function resetFilters() {
    document.getElementById('rcFilterStart').value = '';
    document.getElementById('rcFilterEnd').value = '';
    Array.from(document.getElementById('rcFilterStatus').options).forEach(o => o.selected = false);
    render();
  }

  function init() {
    ['rcFilterStart', 'rcFilterEnd', 'rcFilterStatus'].forEach(id => {
      document.getElementById(id).addEventListener('change', render);
    });
    document.getElementById('rcBtnReset').addEventListener('click', resetFilters);
  }

  return { init, render };
})();
