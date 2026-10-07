/* ===== Controller：持仓看板（总览 / 图表 / 持仓卡片 + 理由字段；v1.2 水位仪表 + 归因标签） ===== */
window.App = window.App || {};

App.DashboardController = (function () {
  const U = () => App.Utils;

  let currentDate = null;
  let showCleared = false;
  let pieChartInst = null;
  let barChartInst = null;
  let waterChartInst = null;
  let currentSliceDim = 'holding';   // v1.3.1：'holding' | 'industry' | 'style'

  function getDate() { return currentDate; }

  /** v1.3.1：切换切片维度 */
  function setSliceDim(dim) {
    currentSliceDim = dim;
    document.querySelectorAll('[data-slice-dim]').forEach(b => {
      b.classList.toggle('slice-tab-active', b.getAttribute('data-slice-dim') === dim);
    });
    renderSlices();
  }

  /* ---------- 日期选择器 ---------- */
  function rebuildDateSelect() {
    const sel = document.getElementById('dateSelect');
    sel.innerHTML = '';
    const dates = App.HoldingsService.getDates();
    dates.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      sel.appendChild(opt);
    });
    if (!currentDate || dates.indexOf(currentDate) < 0) {
      currentDate = dates[dates.length - 1] || U().today();
    }
    sel.value = currentDate;
  }

  function setDate(date) {
    currentDate = date;
    const sel = document.getElementById('dateSelect');
    if (sel.querySelector('option[value="' + date + '"]')) sel.value = date;
    renderAll();
    // v1.2.3：大盘温度跟随看板日期
    if (App.MarketTempController && typeof App.MarketTempController.setDate === 'function') {
      App.MarketTempController.setDate(date);
    }
    // v1.3.1：ETF 重叠检测跟随看板日期
    if (App.EtfOverlapController && typeof App.EtfOverlapController.render === 'function') {
      App.EtfOverlapController.render();
    }
  }

  /* ---------- 总览 ---------- */
  function renderOverview() {
    const ov = App.HoldingsService.getOverview(currentDate);
    if (!ov) {
      ['ov-totalAssets', 'ov-marketValue', 'ov-floatingPnl'].forEach(id => {
        document.getElementById(id).textContent = '-';
      });
      document.getElementById('ov-positionPct').textContent = '';
      document.getElementById('ov-positionPct2').textContent = '-';
      return;
    }
    document.getElementById('ov-totalAssets').textContent = U().fmt(ov.total_assets);
    document.getElementById('ov-marketValue').textContent = U().fmt(ov.market_value);
    document.getElementById('ov-positionPct').textContent =
      ov.position_pct ? '仓位 ' + U().fmt(ov.position_pct, 1) + '%' : '';

    const fpEl = document.getElementById('ov-floatingPnl');
    fpEl.textContent = (Number(ov.floating_pnl) >= 0 ? '+' : '') + U().fmt(ov.floating_pnl);
    fpEl.className = 'text-lg font-bold number ' + U().colorClass(ov.floating_pnl);

    document.getElementById('ov-positionPct2').textContent =
      ov.position_pct ? U().fmt(ov.position_pct, 1) + '%' : '-';
  }

  /* ---------- 图表（v1.3.1：支持标的/行业/风格维度切换） ---------- */
  const SLICE_PALETTE = ['#c9605c', '#5fa377', '#6b8fc4', '#c9a15f', '#8f7ab8', '#5d9aa8', '#b86e8a', '#7d9c5f', '#b3835a', '#5f7fb0'];

  /** 维度切换：复用同一 Chart.js 实例改数据，不销毁重建（技术文档决策 1） */
  function renderSlices() {
    const list = App.HoldingsService.getHoldings(currentDate).filter(h => !h.cleared);
    const ov = App.HoldingsService.getOverview(currentDate);
    const total = ov ? Number(ov.total_assets) : NaN;

    if (currentSliceDim === 'holding') {
      // 标的维度：饼图=市值分布，条形图=浮动盈亏
      const pieCtx = document.getElementById('pieChart').getContext('2d');
      if (pieChartInst) pieChartInst.destroy();
      pieChartInst = new Chart(pieCtx, {
        type: 'doughnut',
        data: {
          labels: list.map(h => h.name),
          datasets: [{
            data: list.map(h => h.market_value),
            backgroundColor: SLICE_PALETTE,
            borderWidth: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: {
            legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
            tooltip: { callbacks: { label: c => c.label + '  ' + U().fmt(c.parsed) } }
          }
        }
      });
      const barCtx = document.getElementById('barChart').getContext('2d');
      if (barChartInst) barChartInst.destroy();
      barChartInst = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: list.map(h => h.name),
          datasets: [{
            data: list.map(h => h.floating_pnl),
            backgroundColor: list.map(h => Number(h.floating_pnl) >= 0 ? '#c9605c' : '#5fa377'),
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 10 } }, grid: { color: '#262e3f' } },
            y: { ticks: { font: { size: 10 } }, grid: { display: false } }
          }
        }
      });
      // 清除切片勾稽显示
      const checkEl = document.getElementById('sliceCheck');
      if (checkEl) checkEl.innerHTML = '';
    } else {
      // 行业/风格维度：饼图 + 条形图均为占比降序
      const slices = App.PortfolioSliceService.groupBy(currentDate, currentSliceDim);
      const labels = (slices || []).map(s => s.key);
      const pcts = (slices || []).map(s => Number(s.pct.toFixed(1)));
      const colors = (slices || []).map((s, i) => {
        if (currentSliceDim === 'style') {
          return App.Constants.STYLE_COLOR[s.key] || SLICE_PALETTE[i % SLICE_PALETTE.length];
        }
        return SLICE_PALETTE[i % SLICE_PALETTE.length];
      });

      const pieCtx = document.getElementById('pieChart').getContext('2d');
      if (pieChartInst) pieChartInst.destroy();
      pieChartInst = new Chart(pieCtx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: pcts, backgroundColor: colors, borderWidth: 0 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: {
            legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
            tooltip: { callbacks: { label: c => c.label + '  ' + c.parsed + '%' } }
          }
        }
      });

      // 行业维度：超 single_industry_max 的行红色高亮
      const plan = App.PlanService.getPlan();
      const overMap = {};
      if (currentSliceDim === 'industry' && slices) {
        slices.forEach(s => { overMap[s.key] = s.pct > plan.single_industry_max; });
      }
      const barColors = (slices || []).map(s => overMap[s.key] ? '#dc2626' : (currentSliceDim === 'style' ? (App.Constants.STYLE_COLOR[s.key] || '#6b7280') : '#6b7280'));

      const barCtx = document.getElementById('barChart').getContext('2d');
      if (barChartInst) barChartInst.destroy();
      barChartInst = new Chart(barCtx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: pcts, backgroundColor: barColors, borderRadius: 4 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => c.label + '  ' + c.parsed + '%' } }
          },
          scales: {
            x: { ticks: { font: { size: 10 }, callback: v => v + '%' }, grid: { color: '#262e3f' }, max: 100 },
            y: { ticks: { font: { size: 10 } }, grid: { display: false } }
          }
        }
      });

      // 勾稽校验显示
      const checkEl = document.getElementById('sliceCheck');
      if (checkEl) {
        if (slices && ov) {
          const vt = App.PortfolioSliceService.verifyTotals(slices, ov.total_assets);
          checkEl.innerHTML = '合计 ' + vt.sumPct.toFixed(1) + '% + 现金 ' + vt.cashPct.toFixed(1) + '% = 100.0%';
        } else {
          checkEl.innerHTML = '';
        }
      }
    }
  }

  /** v1.3.1：渲染持仓卡片主数据角标（未设置主数据 → 黄色提示） */
  function renderInstrumentBadges() {
    const inst = App.InstrumentService ? App.InstrumentService.getInstruments() : {};
    document.querySelectorAll('#holdingsGrid [data-holding-name]').forEach(card => {
      const name = card.getAttribute('data-holding-name');
      const badge = card.querySelector('[data-inst-badge]');
      if (!badge) return;
      if (inst[name]) {
        badge.classList.add('hidden');
      } else {
        badge.classList.remove('hidden');
      }
    });
  }

  /* ---------- v1.2 P1-2 水位仪表（DAA-2） ---------- */

  /** 三段色带 + 当前值指针（v1.2.3：色带以建议仓位中枢为中心，标记中枢刻度） */
  function renderGauge(water) {
    const canvas = document.getElementById('waterGauge');
    if (!canvas) return;
    if (waterChartInst) { waterChartInst.destroy(); waterChartInst = null; }
    const lo = water.band[0], hi = water.band[1];
    const statusColor = { in: '#5fa377', above: '#c9605c', below: '#c9a15f' }[water.status];
    waterChartInst = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [lo, hi - lo, 100 - hi],          // 黄 | 绿 | 红 三段弧长（按有效带动态）
          backgroundColor: ['#c9a15f', '#5fa377', '#c9605c'],
          borderWidth: 0
        }]
      },
      options: {
        rotation: -90, circumference: 360, cutout: '72%',
        responsive: true, maintainAspectRatio: false,
        plugins: { tooltip: { enabled: false }, legend: { display: false } },
        animation: { duration: 300 }
      },
      plugins: [{
        id: 'waterPointer',
        afterDraw: function (chart) {
          const pct = Math.min(water.position_pct, 100);   // >100 钳制绘制，文案显示实际值
          const meta = chart.getDatasetMeta(0);
          const arc = meta.data && meta.data[0];
          if (!arc) return;
          const cx = arc.x, cy = arc.y, rIn = arc.innerRadius, rOut = arc.outerRadius;
          const ctx = chart.ctx;
          // 建议中枢刻度标记（白色短刻度线）
          if (water.center !== null) {
            const cAngle = (water.center / 100) * Math.PI * 2 - Math.PI / 2;
            ctx.save();
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(cAngle) * (rOut + 2), cy + Math.sin(cAngle) * (rOut + 2));
            ctx.lineTo(cx + Math.cos(cAngle) * (rOut + 7), cy + Math.sin(cAngle) * (rOut + 7));
            ctx.stroke();
            ctx.restore();
          }
          // 当前仓位指针
          const angle = (pct / 100) * Math.PI * 2 - Math.PI / 2;
          ctx.save();
          ctx.strokeStyle = statusColor;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * (rIn - 1), cy + Math.sin(angle) * (rIn - 1));
          ctx.lineTo(cx + Math.cos(angle) * (rOut + 3), cy + Math.sin(angle) * (rOut + 3));
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx + Math.cos(angle) * (rOut + 3), cy + Math.sin(angle) * (rOut + 3), 2.2, 0, Math.PI * 2);
          ctx.fillStyle = statusColor;
          ctx.fill();
          ctx.restore();
        }
      }]
    });
  }

  /** 下钻明细：各未清仓标的占比降序 + 现金行，超阈红色高亮 */
  function renderBreakdown(ov, plan) {
    const bd = document.getElementById('wlBreakdown');
    if (!bd) return;
    const total = Number(ov.total_assets);
    const rows = App.HoldingsService.getHoldings(currentDate)
      .filter(h => !h.cleared)
      .map(h => {
        const pct = (total > 0 && h.market_value !== null && h.market_value !== undefined)
          ? Number(h.market_value) / total * 100 : null;
        return { name: h.name, pct: pct, over: pct !== null && pct > plan.single_position_max };
      })
      .filter(r => r.pct !== null)
      .sort((a, b) => b.pct - a.pct);
    const mv = Number(ov.market_value);
    const cashPct = (total > 0 && !isNaN(mv)) ? (total - mv) / total * 100 : null;

    let html = rows.map(r =>
      '<div class="flex items-center justify-between text-[11px]">' +
      '<span class="text-slate-600 truncate">' + U().escapeHtml(r.name) + '</span>' +
      '<span class="number ' + (r.over ? 'text-red-600 font-semibold' : 'text-slate-500') + '">' +
      r.pct.toFixed(1) + '%' + (r.over ? ' ⚠' : '') + '</span></div>').join('');
    if (cashPct !== null) {
      const low = cashPct < plan.cash_min;
      html += '<div class="flex items-center justify-between text-[11px] border-t border-slate-100 pt-1 mt-1">' +
        '<span class="text-slate-600">现金</span>' +
        '<span class="number ' + (low ? 'text-red-600 font-semibold' : 'text-slate-500') + '">' +
        cashPct.toFixed(1) + '%' + (low ? ' ⚠' : '') + '</span></div>';
    }
    bd.innerHTML = html || '<p class="text-[11px] text-slate-400">暂无持仓明细</p>';
  }

  function renderWaterLevel() {
    const plan = App.PlanService.getPlan();
    const ov = App.HoldingsService.getOverview(currentDate);
    // v1.2.3：水位以大盘温度建议仓位中枢为基准
    const md = App.MarketDataService.getMarketData(currentDate);
    const suggestedCenter = md && md.suggested_position !== null ? md.suggested_position : null;
    const water = App.AlertService.calcWaterLevel(ov, plan, suggestedCenter);
    const wrap = document.getElementById('wlGaugeWrap');
    const statusEl = document.getElementById('wlStatus');
    const bandEl = document.getElementById('wlBand');
    const devEl = document.getElementById('wlDev');
    const pctEl = document.getElementById('ov-positionPct2');
    const drillBtn = document.getElementById('wlDrillToggle');
    const bd = document.getElementById('wlBreakdown');
    if (!statusEl || !pctEl) return;

    // 目标带文案：有建议中枢时显示中枢 + 有效带，否则显示原始带
    if (water && water.center !== null) {
      bandEl.textContent = '中枢 ' + water.center + '% · 带 ' + water.band[0] + '–' + water.band[1] + '%';
    } else {
      bandEl.textContent = '目标 ' + plan.total_position_band[0] + '–' + plan.total_position_band[1] + '%';
    }

    // 数据缺失：显示「—」与提示，不绘制色带判定（PRD §3.2.2）
    if (!water) {
      if (waterChartInst) { waterChartInst.destroy(); waterChartInst = null; }
      if (wrap) wrap.classList.add('hidden');
      pctEl.textContent = '-';
      statusEl.textContent = '请先录入当日持仓';
      statusEl.className = 'text-[11px] text-slate-400 font-normal';
      devEl.textContent = '';
      drillBtn.classList.add('hidden');
      bd.classList.add('hidden');
      bd.innerHTML = '';
      return;
    }

    if (wrap) wrap.classList.remove('hidden');
    pctEl.textContent = water.position_pct.toFixed(1) + '%';
    const statusMap = {
      in:    { text: '在带内 ✓', cls: 'text-green-600' },
      above: { text: '高于上限', cls: 'text-red-600' },
      below: { text: '低于下限', cls: 'text-amber-600' }
    };
    statusEl.textContent = statusMap[water.status].text;
    statusEl.className = 'text-xs font-semibold ' + statusMap[water.status].cls;
    // 偏离文案：优先展示相对建议中枢的偏离
    if (water.center !== null && water.center_dev_pp !== null) {
      const sign = water.center_dev_pp >= 0 ? '+' : '';
      devEl.textContent = '距中枢 ' + sign + water.center_dev_pp.toFixed(1) + 'pp';
    } else if (water.status === 'in') {
      devEl.textContent = '偏离：带内（距上限 ' + water.dist_upper.toFixed(1) +
        'pp / 距下限 ' + water.dist_lower.toFixed(1) + 'pp）';
    } else if (water.status === 'above') {
      devEl.textContent = '偏离：超出上限 +' + water.dev_pp.toFixed(1) + 'pp';
    } else {
      devEl.textContent = '偏离：低于下限 ' + water.dev_pp.toFixed(1) + 'pp';
    }
    drillBtn.classList.remove('hidden');
    renderGauge(water);
    renderBreakdown(ov, plan);
  }

  /* ---------- v1.2 S2 持仓卡片归因标签（DAA-4，单源 AttributionService） ---------- */

  function renderAttributionTags() {
    if (!App.AttributionService) return;
    document.querySelectorAll('#holdingsGrid [data-holding-name]').forEach(card => {
      const slot = card.querySelector('[data-attr-slot]');
      if (!slot) return;
      const name = card.getAttribute('data-holding-name');
      slot.innerHTML = App.AttributionService.selectHtml(currentDate, name);
    });
  }

  /* ---------- 持仓卡片 ---------- */

  /** 取该标的最近一条未平仓买入（含理由字段） */
  function latestOpenBuy(name) {
    const open = App.TradeService.getOpenBuys(name);
    return open.length ? open[open.length - 1] : null;
  }

  function holdingCardHtml(h) {
    const buy = latestOpenBuy(h.name);
    let reasonHtml;
    if (buy) {
      reasonHtml =
        '<div class="reason-block space-y-1">' +
        '<p class="text-xs text-slate-700 leading-relaxed">' + U().escapeHtml(buy.buy_reason) + '</p>' +
        '<div class="flex items-center gap-1.5 flex-wrap">' +
        '<span class="tag tag-reason">' + U().escapeHtml(buy.reason_type) + '</span>' +
        '<span class="tag tag-reason">' + U().escapeHtml(buy.expected_period) + '</span>' +
        '</div>' +
        '<p class="text-[11px] text-slate-500">目标区间 ' + U().fmt(buy.target_price_low, 3) +
        ' – ' + U().fmt(buy.target_price_high, 3) + '　止损 ' + U().fmt(buy.stop_loss, 3) + '</p>' +
        '<p class="text-[11px] text-slate-400">失效条件：' + U().escapeHtml(U().truncate(buy.invalid_condition, 30)) + '</p>' +
        '</div>';
    } else {
      reasonHtml =
        '<div class="reason-block"><p class="text-[11px] text-slate-400">暂无买入理由记录，请在首周回填（交易流水 → 新建买入可补录历史）</p></div>';
    }

    return '<div class="holding-card bg-white rounded-2xl card-shadow p-4 fade-in space-y-3" data-holding-name="' +
      U().escapeHtml(h.name).replace(/"/g, '&quot;') + '">' +
      '<div class="flex items-center justify-between">' +
      '<div class="flex items-center gap-2">' +
      '<h4 class="text-sm font-bold text-slate-800">' + U().escapeHtml(h.name) + '</h4>' +
      '<span data-inst-badge class="hidden text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded" title="未设置行业/风格等主数据">未设主数据</span>' +
      '</div>' +
      '<div class="flex items-center gap-1.5">' +
      (buy ? '<span class="closure-dot c-' + (buy.qty_open > 0 ? 'OPEN' : 'CLOSED') + '" title="未平仓 ' + buy.qty_open + ' 股"></span>' : '') +
      '<button onclick="App.InstrumentController.openEditor(\'' + U().escapeHtml(h.name).replace(/'/g, "\\'") + '\')" ' +
      'class="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors">主数据</button>' +
      '</div>' +
      '</div>' +

      '<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">' +
      '<p class="text-slate-400">持仓量</p><p class="text-right text-slate-600 number">' +
      U().fmt(h.position, 0) + '</p>' +
      '<p class="text-slate-400">成本/现价</p><p class="text-right text-slate-600 number">' +
      U().fmt(h.cost, 3) + ' / ' + U().fmt(h.current_price, 3) + '</p>' +
      '<p class="text-slate-400">浮动盈亏</p>' +
      '<p class="text-right number font-semibold ' + U().colorClass(h.floating_pnl) + '">' +
      (Number(h.floating_pnl) >= 0 ? '+' : '') + U().fmt(h.floating_pnl) +
      ' <span class="font-normal">' + U().fmtPct(h.floating_pnl_pct) + '</span></p>' +
      '</div>' +

      // v1.2 S2：归因标签（浮动盈亏下方，单源 AttributionService 填充）
      '<div class="flex items-center justify-between gap-2">' +
      '<span class="text-xs text-slate-400 shrink-0">归因</span>' +
      '<span data-attr-slot></span>' +
      '</div>' +

      reasonHtml +

      '<div class="grid grid-cols-3 gap-2">' +
      '<button onclick="App.TradeForm.openForAction(\'add\',\'' + U().escapeHtml(h.name).replace(/'/g, "\\'") + '\')" ' +
      'class="text-xs py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition-colors">+ 加仓</button>' +
      '<button onclick="App.TradeForm.openForAction(\'reduce\',\'' + U().escapeHtml(h.name).replace(/'/g, "\\'") + '\')" ' +
      'class="text-xs py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors">− 减仓</button>' +
      '<button onclick="App.TradeForm.openForAction(\'clear\',\'' + U().escapeHtml(h.name).replace(/'/g, "\\'") + '\')" ' +
      'class="text-xs py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">✕ 清仓</button>' +
      '</div>' +
      '</div>';
  }

  function renderHoldings() {
    const grid = document.getElementById('holdingsGrid');
    let list = App.HoldingsService.getHoldings(currentDate);
    if (!showCleared) list = list.filter(h => !h.cleared);
    grid.innerHTML = list.length
      ? list.map(h => holdingCardHtml(h)).join('')
      : '<p class="text-sm text-slate-400 col-span-full text-center py-8">当日无持仓数据，可点击「手动录入持仓」或「上传截图」</p>';
  }

  function toggleShowCleared() {
    showCleared = !showCleared;
    document.getElementById('btnToggleCleared').textContent =
      showCleared ? '隐藏已清仓' : '显示已清仓';
    renderHoldings();
  }

  function renderAll() {
    renderOverview();
    renderSlices();
    renderHoldings();
    renderWaterLevel();
    renderAttributionTags();
    renderInstrumentBadges();
    // v1.2：统一重算入口（水位写回 + 告警横幅）；fromRenderAll 避免仪表重复渲染
    if (App.AlertBannerController) {
      App.AlertBannerController.recalc({ fromRenderAll: true });
    }
  }

  /* ---------- 导出备份 ---------- */
  function exportBackup() {
    const data = App.LocalStorageRepo.getDB();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '持仓复盘备份_' + U().today() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    U().toast('备份已导出（截图本体存于 IndexedDB，不在备份内）', 'success');
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // v1.2.2 深色主题：Chart.js 默认文字/网格线全局适配
    if (window.Chart) {
      Chart.defaults.color = '#99a1b4';
      Chart.defaults.borderColor = '#262e3f';
    }
    rebuildDateSelect();
    document.getElementById('dateSelect').addEventListener('change', e => {
      currentDate = e.target.value;
      renderAll();
      if (App.MarketTempController && typeof App.MarketTempController.setDate === 'function') {
        App.MarketTempController.setDate(currentDate);
      }
      if (App.EtfOverlapController && typeof App.EtfOverlapController.render === 'function') {
        App.EtfOverlapController.render();
      }
    });
    document.getElementById('btnToggleCleared').addEventListener('click', toggleShowCleared);
    document.getElementById('btnExport').addEventListener('click', exportBackup);

    // v1.3.1：切片维度 Tab 切换
    document.querySelectorAll('[data-slice-dim]').forEach(b => {
      b.addEventListener('click', () => setSliceDim(b.getAttribute('data-slice-dim')));
    });

    // v1.2：下钻占比明细展开/收起
    document.getElementById('wlDrillToggle').addEventListener('click', () => {
      const bd = document.getElementById('wlBreakdown');
      const hidden = bd.classList.toggle('hidden');
      document.getElementById('wlDrillToggle').textContent =
        hidden ? '查看占比明细 ▾' : '收起占比明细 ▴';
    });

    // v1.2 S2：看板卡片归因改选（唯一写入口 AttributionService.setTag）
    document.getElementById('holdingsGrid').addEventListener('change', e => {
      const sel = e.target.closest('[data-attr-select]');
      if (!sel) return;
      const name = sel.getAttribute('data-attr-select');
      try {
        App.AttributionService.setTag(currentDate, name, sel.value);
        U().toast('归因已更新并留痕', 'success');
        renderAttributionTags();
        if (App.ReviewController && App.ReviewController.refreshAttribution) {
          App.ReviewController.refreshAttribution(currentDate);
        }
      } catch (err) {
        U().toast(err.message || '修改失败', 'error');
        renderAttributionTags();   // 还原显示
      }
    });
  }

  return { init, renderAll, renderSlices, renderInstrumentBadges, setSliceDim, getDate, setDate, rebuildDateSelect, renderWaterLevel, renderAttributionTags };
})();
