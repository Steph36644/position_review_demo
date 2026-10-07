/* ===== Controller：S1 结构化复盘（四段面板 / 一键填入 / 自动保存）
   ===== v1.2 扩展：②段归因下拉化（单源 AttributionService）、③段只读水位、忽略告警留痕小节 ===== */
window.App = window.App || {};

App.ReviewController = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  let reviewDate = null;

  /* ---------- ① 操作清单渲染 ---------- */
  function renderOperations(operations) {
    const box = document.getElementById('rvOperations');
    if (!operations || operations.length === 0) {
      box.innerHTML = '<p class="text-[11px] text-slate-400 py-1">当日无交易（operations 为空，仍可保存复盘）</p>';
      return;
    }
    box.innerHTML = operations.map(op =>
      '<div class="rv-op-item">' +
      '<span class="tag tag-' + op.action + '">' + C().ACTION_LABELS[op.action] + '</span>' +
      '<span class="font-medium text-slate-700">' + U().escapeHtml(op.name) + '</span>' +
      '<span class="text-slate-400">' + U().fmt(op.amount, 0) + ' 股 × ' + U().fmt(op.price, 4) + '</span>' +
      (op.reason_type ? '<span class="tag tag-reason ml-auto">' + U().escapeHtml(op.reason_type) + '</span>' : '') +
      '</div>').join('');
  }

  /* ---------- ② 归因渲染（v1.2：下拉化，含当日已清仓持仓与当日卖出标的） ---------- */
  function renderAttribution() {
    const box = document.getElementById('rvAttribution');
    const hint = document.getElementById('rvAttributionHint');

    let names = [];
    if (App.AttributionService) {
      names = Array.from(App.AttributionService.getTagsForDate(reviewDate).keys());
    }
    if (names.length === 0) {
      box.innerHTML = '';
      hint.classList.remove('hidden');
      hint.textContent = '当日无持仓快照，请先通过「手动录入」或「上传截图」录入当日持仓';
      return;
    }
    hint.classList.add('hidden');
    box.innerHTML = names.map(name =>
      '<div class="flex items-center gap-2">' +
      '<span class="text-xs text-slate-600 w-28 truncate">' + U().escapeHtml(name) + '</span>' +
      App.AttributionService.selectHtml(reviewDate, name) +
      '</div>').join('');
  }

  /** v1.2：看板改选归因后同步②段（直接函数调用，避免事件系统） */
  function refreshAttribution(date) {
    if (date !== reviewDate) return;
    renderAttribution();
  }

  /* ---------- ③ 仓位水位（v1.2：只读，由系统按当日快照与当前计划实时判定） ---------- */
  function renderWaterSection() {
    const box = document.getElementById('rvWaterLevel');
    if (!box) return;
    // v1.3.1 修复：与看板口径一致，水位以大盘温度建议仓位中枢为基准
    const md = App.MarketDataService.getMarketData(reviewDate);
    const suggestedCenter = md && md.suggested_position !== null ? md.suggested_position : null;
    const water = App.AlertService.calcWaterLevel(
      App.HoldingsService.getOverview(reviewDate), App.PlanService.getPlan(), suggestedCenter);
    if (!water) {
      box.innerHTML = '<p class="text-xs text-slate-400">当日无持仓/总资产快照，未判定（请先录入当日持仓）</p>';
      return;
    }
    const statusText = water.status === 'in' ? '在带内 ✓'
      : (water.status === 'above' ? '高于上限（越界）' : '低于下限（越界）');
    const statusCls = water.status === 'in' ? 'text-green-600' : 'text-red-600';
    const devText = water.status === 'in'
      ? '距上限 ' + water.dist_upper.toFixed(1) + 'pp / 距下限 ' + water.dist_lower.toFixed(1) + 'pp'
      : (water.status === 'above'
        ? '超出上限 +' + water.dev_pp.toFixed(1) + 'pp'
        : '低于下限 ' + water.dev_pp.toFixed(1) + 'pp');
    box.innerHTML =
      '<div class="rv-op-item flex-col items-stretch gap-1">' +
      '<p class="text-xs text-slate-600">当前仓位 <b class="number">' + water.position_pct.toFixed(1) +
      '%</b>，' + (water.center !== null
        ? '中枢 ' + water.center + '% · 有效带 ' + water.band[0] + '–' + water.band[1] + '%'
        : '目标带 ' + water.band[0] + '–' + water.band[1] + '%') +
      '：<b class="' + statusCls + '">' + statusText + '</b></p>' +
      '<p class="text-[11px] text-slate-400">偏离：' + devText +
      '（按当日快照与当前计划实时判定；「一键填入今日快照」后写入复盘记录）</p>' +
      '</div>';
  }

  /* ---------- v1.2：今日已忽略告警小节（正常组 + 失效置灰组） ---------- */
  function renderIgnoredAlerts() {
    const box = document.getElementById('rvIgnoredAlerts');
    if (!box) return;
    const review = App.ReviewService.getReview(reviewDate);
    const active = (review && Array.isArray(review.ignored_alerts)) ? review.ignored_alerts : [];
    const expired = (review && Array.isArray(review.ignored_alerts_expired)) ? review.ignored_alerts_expired : [];
    if (active.length === 0 && expired.length === 0) {
      box.innerHTML = '<p class="text-[11px] text-slate-400">当日无忽略记录（在看板告警横幅点击「今日忽略」后在此留痕）</p>';
      return;
    }
    const itemHtml = (a, isExpired) =>
      '<li class="text-[11px] ' + (isExpired ? 'text-slate-400' : 'text-slate-600') + '">' +
      U().escapeHtml(a.message || (a.dim + (a.name ? '：' + a.name : ''))) +
      '<span class="text-slate-400">（阈值 ' + U().escapeHtml(String(a.threshold)) + '% / 实际 ' +
      U().escapeHtml(String(a.actual)) + '%）</span>' +
      (isExpired ? '<span class="text-amber-500 ml-1">计划已调整，失效</span>' : '') +
      '</li>';
    box.innerHTML = '<ul class="space-y-1">' +
      active.map(a => itemHtml(a, false)).join('') +
      expired.map(a => itemHtml(a, true)).join('') +
      '</ul>';
  }

  /** v1.2：横幅「今日忽略」后同步小节（AlertBannerController 直接调用） */
  function refreshAlertsSection(date) {
    if (date !== reviewDate) return;
    renderIgnoredAlerts();
  }

  /* ---------- 收集复盘（v1.2 修复：不再返回 position_in_band / water_level / pnl_attribution） ---------- */
  // 水位由 ReviewService.syncWaterLevel / fillTodaySnapshot 写回；
  // 归因唯一写入口为 AttributionService.setTag（看板/复盘下拉均走它），自动保存时原样保留
  function collectReview() {
    return {
      tomorrow_plan: document.getElementById('rvTomorrowPlan').value
    };
  }

  /* ---------- 保存（自动，防抖；合并时保留系统写回字段） ---------- */
  const autoSave = U().debounce(() => {
    const status = document.getElementById('reviewSaveStatus');
    try {
      const existing = App.ReviewService.getReview(reviewDate);
      const preserved = existing ? {
        operations: existing.operations || [],
        created_at: existing.created_at,
        pnl_attribution: existing.pnl_attribution || {},
        position_in_band: existing.position_in_band !== undefined ? existing.position_in_band : null,
        water_level: existing.water_level !== undefined ? existing.water_level : null,
        ignored_alerts: existing.ignored_alerts || [],
        ignored_alerts_expired: existing.ignored_alerts_expired || [],
        attribution_overrides: existing.attribution_overrides || []
      } : {};
      const review = App.Models.createReview(Object.assign(preserved, collectReview()));
      App.ReviewService.saveReview(reviewDate, review);
      status.textContent = '已自动保存 ' + new Date().toLocaleTimeString('zh-CN');
      status.className = 'text-xs text-green-500';
    } catch (e) {
      status.textContent = '保存失败：' + e.message;
      status.className = 'text-xs text-red-500';
    }
  }, 500);

  /* ---------- 加载某日复盘 ---------- */
  function load(date) {
    reviewDate = date;
    document.getElementById('reviewDate').value = date;
    const review = App.ReviewService.getReview(date);

    renderOperations(review ? review.operations : []);
    renderAttribution();
    renderWaterSection();
    renderIgnoredAlerts();
    document.getElementById('rvTomorrowPlan').value = review ? (review.tomorrow_plan || '') : '';
    document.getElementById('reviewSaveStatus').textContent = review ? '' : '当日复盘尚未创建，输入后自动保存';
  }

  /* ---------- 一键填入 ---------- */
  function fillSnapshot() {
    const draft = App.ReviewService.fillTodaySnapshot(reviewDate);
    renderOperations(draft.operations);
    renderAttribution();
    renderWaterSection();
    renderIgnoredAlerts();
    if (!document.getElementById('rvTomorrowPlan').value) {
      document.getElementById('rvTomorrowPlan').value = draft.tomorrow_plan || '';
    }
    // 立即持久化：draft 含水位/归因初值/operations；collectReview 仅补充明日计划
    const review = App.Models.createReview(Object.assign({}, draft, collectReview()));
    App.ReviewService.saveReview(reviewDate, review);
    const status = document.getElementById('reviewSaveStatus');
    status.textContent = '快照已填入并保存 ' + new Date().toLocaleTimeString('zh-CN');
    status.className = 'text-xs text-green-500';
    U().toast('已填入今日快照（' + draft.operations.length + ' 笔操作）', 'success');
  }

  /* ---------- 面板折叠 ---------- */
  function initPanels() {
    document.querySelectorAll('#reviewPanels .rv-toggle').forEach(btn => {
      btn.closest('.bg-white').classList.add('rv-panel-open');
      btn.addEventListener('click', () => {
        btn.closest('.bg-white').classList.toggle('rv-panel-open');
      });
    });
  }

  function init() {
    initPanels();
    document.getElementById('reviewDate').value = U().today();
    reviewDate = U().today();

    document.getElementById('reviewDate').addEventListener('change', e => load(e.target.value));
    document.getElementById('btnFillSnapshot').addEventListener('click', fillSnapshot);

    // v1.2：②段归因下拉改选 → 唯一写入口 setTag（留痕），并同步看板卡片
    document.getElementById('rvAttribution').addEventListener('change', e => {
      const sel = e.target.closest('[data-attr-select]');
      if (!sel) return;
      const name = sel.getAttribute('data-attr-select');
      try {
        App.AttributionService.setTag(reviewDate, name, sel.value);
        U().toast('归因已更新并留痕', 'success');
        renderAttribution();
        if (App.DashboardController && App.DashboardController.renderAttributionTags) {
          App.DashboardController.renderAttributionTags();
        }
      } catch (err) {
        U().toast(err.message || '修改失败', 'error');
        renderAttribution();   // 还原显示
      }
    });
    document.getElementById('rvTomorrowPlan').addEventListener('input', autoSave);

    load(reviewDate);
  }

  return { init, load, refreshAttribution, refreshAlertsSection };
})();
