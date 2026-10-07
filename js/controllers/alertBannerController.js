/* ===== Controller：v1.2 P1-3 集中度告警横幅（渲染/跳转/今日忽略/忽略失效） ===== */
window.App = window.App || {};

App.AlertBannerController = (function () {
  const U = () => App.Utils;

  let currentAlerts = [];     // 当前横幅展示（已过滤忽略）的告警项
  let lastAlertKeys = null;   // 折叠态记忆：新告警出现则重置为展开
  let collapsed = false;

  /* ---------- 唯一重算入口（防抖 100ms，技术文档 §3.3） ---------- */
  const recalc = U().debounce(function (opts) { recalcNow(opts || {}); }, 100);

  function recalcNow(opts) {
    const date = App.DashboardController.getDate();
    if (!date) return;

    // plan 变更 → 全部忽略记录失效留痕（PRD §3.3.3 忽略失效②；8.3 双字段分离）
    if (opts.invalidateIgnores) expireIgnoredAlerts();

    // 水位写回复盘③段（统一写回时机，技术文档 §5.6）
    const evalRes = App.AlertService.evaluateAlerts(date);
    App.ReviewService.syncWaterLevel(date, evalRes.water);

    // 横幅渲染（过滤当日已忽略项）
    const review = App.ReviewService.getReview(date);
    const visible = App.AlertService.filterIgnored(evalRes.alerts, review);
    renderBanner(visible);

    // 水位卡片刷新（renderAll 调用时已渲染过，跳过避免仪表动画重复）
    if (!opts.fromRenderAll && App.DashboardController.renderWaterLevel) {
      App.DashboardController.renderWaterLevel();
    }
  }

  /** plan 变更后：全部日期 ignored_alerts 逐项移入 ignored_alerts_expired（留痕） */
  function expireIgnoredAlerts() {
    const reviews = App.LocalStorageRepo.getDB().reviews;
    let changed = false;
    Object.keys(reviews).forEach(d => {
      const r = reviews[d];
      if (Array.isArray(r.ignored_alerts) && r.ignored_alerts.length > 0) {
        if (!Array.isArray(r.ignored_alerts_expired)) r.ignored_alerts_expired = [];
        r.ignored_alerts.forEach(a =>
          r.ignored_alerts_expired.push(Object.assign({}, a, { expired_reason: 'plan_changed' })));
        r.ignored_alerts = [];
        changed = true;
      }
    });
    if (changed) App.LocalStorageRepo.saveReviews();
  }

  /* ---------- 横幅渲染 ---------- */
  function renderBanner(alerts) {
    const banner = document.getElementById('alertBanner');
    const list = document.getElementById('abList');
    const count = document.getElementById('abCount');
    const collapseBtn = document.getElementById('abCollapse');
    if (!banner || !list) return;

    if (!alerts || alerts.length === 0) {
      banner.classList.add('hidden');
      list.innerHTML = '';
      currentAlerts = [];
      lastAlertKeys = null;
      collapsed = false;
      return;
    }

    // 存在新告警（键集合变化）→ 自动展开（PRD：自动展开）
    const keys = alerts.map(a => a.dim + ':' + (a.name || '')).join('|');
    if (keys !== lastAlertKeys) collapsed = false;
    lastAlertKeys = keys;
    currentAlerts = alerts;

    banner.classList.remove('hidden');
    count.textContent = alerts.length;
    list.innerHTML = alerts.map((a, i) =>
      '<li class="flex items-center gap-2 text-xs" data-idx="' + i + '">' +
      '<span class="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>' +
      '<span class="text-red-700 flex-1 min-w-0">' + U().escapeHtml(a.message) + '</span>' +
      '<button class="ab-goto text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-100 transition-colors shrink-0">查看</button>' +
      '<button class="ab-ignore text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-white transition-colors shrink-0">今日忽略</button>' +
      '</li>').join('');
    list.classList.toggle('hidden', collapsed);
    if (collapseBtn) collapseBtn.textContent = collapsed ? '展开 ▾' : '收起 ▴';
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    renderBanner(currentAlerts);
  }

  /* ---------- 查看详情跳转（PRD §3.3.3；v1.3.1 增加行业切片跳转） ---------- */
  function gotoTarget(item) {
    if (!item || !item.target) return;
    if (item.target.type === 'holding') {
      const esc = String(item.target.anchor).replace(/"/g, '\\"');
      const card = document.querySelector('#holdingsGrid [data-holding-name="' + esc + '"]');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('flash-highlight');
        void card.offsetWidth;   // 重启动画
        card.classList.add('flash-highlight');
        setTimeout(() => card.classList.remove('flash-highlight'), 1600);
      } else {
        U().toast('未找到该持仓卡片（可能当日无该标的快照）', 'warn');
      }
    } else if (item.target.type === 'slice') {
      // v1.3.1 行业告警 → 切换到行业 Tab 并滚动至图表区
      if (App.DashboardController && typeof App.DashboardController.setSliceDim === 'function') {
        App.DashboardController.setSliceDim(item.target.anchor || 'industry');
      }
      const chartWrap = document.getElementById('pieChart');
      if (chartWrap) {
        chartWrap.closest('section').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      // 水位/现金告警 → 展开水位卡片占比明细并滚动
      const bd = document.getElementById('wlBreakdown');
      const cardEl = document.getElementById('waterfallSlot');
      if (bd && cardEl) {
        bd.classList.remove('hidden');
        const toggle = document.getElementById('wlDrillToggle');
        if (toggle) toggle.textContent = '收起占比明细 ▴';
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardEl.classList.remove('flash-highlight');
        void cardEl.offsetWidth;
        cardEl.classList.add('flash-highlight');
        setTimeout(() => cardEl.classList.remove('flash-highlight'), 1600);
      }
    }
  }

  /* ---------- 今日忽略（留痕到当日复盘） ---------- */
  function ignoreItem(idx) {
    const item = currentAlerts[idx];
    if (!item) return;
    try {
      const date = App.DashboardController.getDate();
      App.AlertService.ignoreAlert(date, item);
      // 同步刷新复盘忽略小节（直接函数调用，技术文档 §5.4 决策）
      if (App.ReviewController && App.ReviewController.refreshAlertsSection) {
        App.ReviewController.refreshAlertsSection(date);
      }
      recalc();
      U().toast('该告警今日不再展示，已记入当日复盘', 'success');
    } catch (e) {
      console.error(e);
      U().toast(e.message || '忽略失败', 'error');
    }
  }

  function init() {
    const header = document.getElementById('abHeader');
    if (header) header.addEventListener('click', toggleCollapse);
    const list = document.getElementById('abList');
    if (list) {
      list.addEventListener('click', e => {
        const li = e.target.closest('li[data-idx]');
        if (!li) return;
        const idx = Number(li.getAttribute('data-idx'));
        if (e.target.closest('.ab-goto')) gotoTarget(currentAlerts[idx]);
        else if (e.target.closest('.ab-ignore')) ignoreItem(idx);
      });
    }
  }

  return { init, recalc };
})();
