/* ===== Controller：v1.3.1 P1-4 What-If 交易预演抽屉（实时重算，不落库） ===== */
window.App = window.App || {};

App.WhatIfController = (function () {
  const U = () => App.Utils;
  const C = () => App.Constants;
  const DRAWER = 'whatIfDrawer';

  let currentResult = null;

  function show() {
    const d = document.getElementById(DRAWER);
    if (!d) return;
    d.classList.remove('hidden');
    d.classList.add('flex');
    resetInputs();
    // 预填日期 = 看板日期
    const date = App.DashboardController.getDate();
    if (!date || !App.HoldingsService.getOverview(date)) {
      document.getElementById('wi-noData').classList.remove('hidden');
      document.getElementById('wi-form').classList.add('hidden');
    } else {
      document.getElementById('wi-noData').classList.add('hidden');
      document.getElementById('wi-form').classList.remove('hidden');
      recompute();
    }
  }

  function hide() {
    const d = document.getElementById(DRAWER);
    if (d) { d.classList.add('hidden'); d.classList.remove('flex'); }
    currentResult = null;
  }

  function resetInputs() {
    document.getElementById('wi-name').value = '';
    document.getElementById('wi-action').value = 'buy';
    document.getElementById('wi-amount').value = '';
    document.getElementById('wi-price').value = '';
    document.getElementById('wi-result').innerHTML =
      '<p class="text-xs text-slate-400 text-center py-6">输入拟交易后实时计算（防抖 300ms）</p>';
    currentResult = null;
  }

  /** 填充标的下拉 */
  function rebuildNameSelect() {
    const sel = document.getElementById('wi-name');
    if (!sel) return;
    const names = App.InstrumentService.getAllHoldingNames();
    sel.innerHTML = '<option value="">请选择标的</option>' +
      names.map(n => '<option value="' + U().escapeHtml(n) + '">' + U().escapeHtml(n) + '</option>').join('');
  }

  /** 防抖重算 */
  const recompute = U().debounce(function () {
    const date = App.DashboardController.getDate();
    if (!date) return;
    const trade = {
      name: document.getElementById('wi-name').value,
      action: document.getElementById('wi-action').value,
      amount: document.getElementById('wi-amount').value,
      price: document.getElementById('wi-price').value
    };
    const resultEl = document.getElementById('wi-result');

    // 校验
    const v = App.WhatIfService.validateTrade(date, trade);
    if (!v.valid) {
      resultEl.innerHTML = '<p class="text-xs text-red-500">' + U().escapeHtml(v.errors[0]) + '</p>';
      currentResult = null;
      return;
    }

    const res = App.WhatIfService.simulate(date, trade);
    if (!res) {
      resultEl.innerHTML = '<p class="text-xs text-slate-400">无法计算（数据缺失）</p>';
      return;
    }
    currentResult = res;
    renderResult(date, trade, res);
  }, 300);

  function pct(x) { return (x === null || x === undefined) ? '-' : Number(x).toFixed(1) + '%'; }

  function waterStatusText(w) {
    if (!w) return '-';
    return { in: '带内 ✓', above: '高于上限 ⚠', below: '低于下限' }[w.status] || '-';
  }

  function renderResult(date, trade, res) {
    const plan = App.PlanService.getPlan();
    const ov = App.HoldingsService.getOverview(date);
    const beforePos = ov && ov.total_assets ? Number(ov.market_value) / Number(ov.total_assets) * 100 : null;
    const afterPos = res.water ? res.water.position_pct : null;
    const posWorse = afterPos !== null && beforePos !== null && afterPos > beforePos;

    // 单标的占比变化
    const simH = res.simHoldings.find(h => h.name === trade.name);
    const origH = App.HoldingsService.getHoldings(date).find(h => h.name === trade.name);
    const beforeSingle = origH && ov.total_assets ? Number(origH.market_value) / Number(ov.total_assets) * 100 : null;
    const afterSingle = simH && res.simOverview.total_assets ? Number(simH.market_value) / Number(res.simOverview.total_assets) * 100 : null;

    let html = '<div class="space-y-3 text-xs">';
    html += '<div class="grid grid-cols-2 gap-3">' +
      '<div><p class="text-slate-400 mb-0.5">总仓位</p>' +
      '<p class="text-sm font-semibold ' + (posWorse ? 'text-red-600' : 'text-green-600') + '">' +
      pct(beforePos) + ' → ' + pct(afterPos) + '</p>' +
      '<p class="text-[10px] text-slate-400">' + waterStatusText(res.water) + '</p></div>' +
      '<div><p class="text-slate-400 mb-0.5">单标的占比</p>' +
      '<p class="text-sm font-semibold text-slate-700">' + pct(beforeSingle) + ' → ' + pct(afterSingle) + '</p>' +
      '<p class="text-[10px] text-slate-400">上限 ' + plan.single_position_max + '%</p></div>' +
      '</div>';

    // 行业占比（取该标的所属行业，若无则未分类）
    if (res.slices) {
      const inst = App.InstrumentService.getInstrument(trade.name);
      const indKey = inst ? inst.industry : '未分类';
      const indSlice = res.slices.find(s => s.key === indKey);
      const beforeInd = (function () {
        const beforeSlices = App.PortfolioSliceService.groupBy(date, 'industry');
        if (!beforeSlices) return null;
        const s = beforeSlices.find(x => x.key === indKey);
        return s ? s.pct : 0;
      })();
      html += '<div><p class="text-slate-400 mb-0.5">行业占比（' + U().escapeHtml(indKey) + '）</p>' +
        '<p class="text-sm font-semibold ' + (indSlice && indSlice.pct > plan.single_industry_max ? 'text-red-600' : 'text-slate-700') + '">' +
        pct(beforeInd) + ' → ' + (indSlice ? pct(indSlice.pct) : '-') + '</p>' +
        '<p class="text-[10px] text-slate-400">上限 ' + plan.single_industry_max + '%</p></div>';
    }

    // 告警项
    if (res.alerts.length) {
      html += '<div class="border-t border-slate-100 pt-2">' +
        '<p class="text-slate-500 mb-1">触发告警（' + res.alerts.length + '）</p>' +
        res.alerts.map(a => '<p class="text-red-600">· ' + U().escapeHtml(a.message) + '</p>').join('') +
        '</div>';
    } else {
      html += '<div class="border-t border-slate-100 pt-2"><p class="text-green-600">无新增告警 ✓</p></div>';
    }
    html += '</div>';

    document.getElementById('wi-result').innerHTML = html;
  }

  /** 去执行：跳转交易录入弹窗并预填 */
  function gotoExecute() {
    const trade = {
      name: document.getElementById('wi-name').value,
      action: document.getElementById('wi-action').value,
      amount: document.getElementById('wi-amount').value,
      price: document.getElementById('wi-price').value
    };
    if (!trade.name || !trade.amount || !trade.price) {
      U().toast('请先填写完整拟交易', 'warn'); return;
    }
    hide();
    if (App.TradeForm && typeof App.TradeForm.openForAction === 'function') {
      App.TradeForm.openForAction(trade.action, trade.name);
      // 预填数量和价格（买入表单）
      setTimeout(() => {
        const amtEl = document.getElementById('bf-amount');
        const pxEl = document.getElementById('bf-price');
        if (amtEl) amtEl.value = trade.amount;
        if (pxEl) pxEl.value = trade.price;
      }, 100);
    }
  }

  function init() {
    // 按钮
    document.getElementById('btnWhatIf').addEventListener('click', show);
    document.getElementById('wi-close').addEventListener('click', hide);
    document.getElementById('wi-clear').addEventListener('click', resetInputs);
    document.getElementById('wi-execute').addEventListener('click', gotoExecute);

    // 预填标的下拉
    rebuildNameSelect();

    // 输入实时重算
    ['wi-name', 'wi-action', 'wi-amount', 'wi-price'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', recompute);
      if (el) el.addEventListener('change', recompute);
    });

    // 点击遮罩关闭
    document.getElementById(DRAWER).addEventListener('click', e => {
      if (e.target.id === DRAWER) hide();
    });
  }

  return { init, show, rebuildNameSelect };
})();
