/* ===== v1.2.3 Controller：大盘温度展示与交互 ===== */
window.App = window.App || {};

App.MarketTempController = (function () {
  const U = () => App.Utils;
  let currentDate = null;

  function setDate(date) { currentDate = date; render(); }

  function getPlan() { return App.PlanService.getPlan(); }

  /* ---------- 渲染当日大盘温度 ---------- */
  function render() {
    if (!currentDate) return;
    const md = App.MarketDataService.getMarketData(currentDate);
    const plan = getPlan();
    const mt = plan.market_temp || App.Constants.MARKET_TEMP_DEFAULTS;

    const indexName = document.getElementById('mtIndexName');
    if (indexName) indexName.textContent = md && md.index_name ? ('· ' + md.index_name) : ('· ' + (mt.index_name || ''));

    if (!md) {
      setText('mtClose', '-'); setText('mtMa', '');
      setText('mtScore', '-'); setText('mtStatus', '未获取', 'text-slate-400');
      setZone(null);
      setText('mtVolRatio', '-'); setText('mtVolMa', '');
      setText('mtSuggestPos', '-'); setText('mtSource', '点击「刷新行情」获取');
      renderDimensions(null, mt);
      return;
    }

    setText('mtClose', md.close !== null ? U().fmt(md.close, 2) : '-');
    setText('mtMa', md.ma200 !== null ? ('MA200(40周线) ' + U().fmt(md.ma200, 2)) :
      (md.ma20 !== null ? ('MA20 ' + U().fmt(md.ma20, 2)) : ''));

    setText('mtScore', md.temp_score !== null ? md.temp_score : '-');
    const statusEl = document.getElementById('mtStatus');
    if (statusEl) {
      statusEl.textContent = App.MarketDataService.statusLabel(md.temp_status);
      statusEl.className = 'text-xs font-semibold ' + App.MarketDataService.statusClass(md.temp_status);
    }
    setZone(md.temp_zone);

    // 量能比：5 日均成交额 ÷ 250 日均成交额（沪深合计）
    let volRatio = '-';
    if (md.amount_ma5 && md.amount_ma250) {
      volRatio = (md.amount_ma5 / md.amount_ma250).toFixed(2);
    }
    setText('mtVolRatio', volRatio);
    setText('mtVolMa', md.amount_ma250 !== null ? ('额 MA250 ' + U().fmt(md.amount_ma250, 0)) : '');

    setText('mtSuggestPos', md.suggested_position !== null ? (md.suggested_position + '%') : '-');
    setText('mtSource', '来源：' + (md.data_source === 'manual' ? '手动录入' : '新浪行情') +
      (md.fetched_at ? ' · ' + md.fetched_at.slice(5, 16) : ''));

    // 渲染各维度得分（公式详情面板）
    renderDimensions(md, mt);
  }

  /* ---------- 特殊风控区间标签（过热/极寒） ---------- */
  function setZone(zone) {
    const el = document.getElementById('mtZone');
    if (!el) return;
    if (!zone) {
      el.textContent = '';
      el.className = 'text-[10px] mt-0.5';
      return;
    }
    el.textContent = App.MarketDataService.zoneLabel(zone);
    el.className = 'text-[10px] mt-0.5 inline-block px-1.5 py-0.5 rounded border ' +
      App.MarketDataService.zoneClass(zone);
  }

  /* ---------- 渲染各维度得分明细 ---------- */
  function renderDimensions(md, mt) {
    const listEl = document.getElementById('mtDimensionList');
    if (!listEl) return;
    const weights = mt.weights || {};
    const dimLabels = { index: '指数位置', volume: '量能' };
    const dimDescs = {
      index: '收盘对 40 周线（MA200）乖离率',
      volume: '5 日均成交额 ÷ 250 日均（沪深合计）'
    };
    const ids = ['index', 'volume'];
    const details = md && md.temp_details ? md.temp_details : {};

    let html = '<p class="text-[11px] text-slate-500">各维度得分（当日，权重各 50%）</p>';
    ids.forEach(function (id) {
      const w = weights[id];
      const score = details[id];
      const hasScore = score !== null && score !== undefined;
      const scoreText = hasScore ? score : '—';
      const weightText = w !== undefined ? Math.round(w * 100) + '%' : '—';
      // 得分颜色：低蓝、中灰、高红（模拟温度色阶）
      let scoreCls = 'text-slate-500';
      if (hasScore) {
        if (score < 25) scoreCls = 'text-blue-400';
        else if (score < 50) scoreCls = 'text-slate-300';
        else if (score < 75) scoreCls = 'text-amber-400';
        else scoreCls = 'text-red-400';
      }
      html += '<div class="flex items-center justify-between text-xs">' +
        '<div class="min-w-0">' +
        '<span class="text-slate-300">' + dimLabels[id] + '</span>' +
        '<span class="text-slate-500 ml-1.5">权重 ' + weightText + '</span>' +
        '<p class="text-[10px] text-slate-500 truncate">' + dimDescs[id] + '</p>' +
        '</div>' +
        '<span class="number font-semibold ' + scoreCls + ' shrink-0 ml-2">' + scoreText + '</span>' +
        '</div>';
    });
    listEl.innerHTML = html;
  }

  function setText(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls) el.className = (el.className.replace(/text-\S+/g, '') + ' ' + cls).trim();
  }

  /* ---------- 刷新行情（自动拉取 + 计算温度） ---------- */
  function refresh() {
    const errEl = document.getElementById('mtError');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
    const btn = document.getElementById('mtRefresh');
    if (btn) { btn.textContent = '获取中…'; btn.disabled = true; }

    const plan = getPlan();
    App.MarketDataService.fetchAndCompute(plan).then(function (res) {
      if (btn) { btn.textContent = '刷新行情'; btn.disabled = false; }
      if (res.count === 0) {
        showError('行情数据为空，请稍后重试或手动录入');
        return;
      }
      U().toast('已获取 ' + res.count + ' 个交易日行情并计算温度', 'success');
      render();
      // 刷新看板水位（温度可能影响建议仓位）
      if (App.AlertBannerController && typeof App.AlertBannerController.recalc === 'function') {
        App.AlertBannerController.recalc();
      }
    }).catch(function (err) {
      if (btn) { btn.textContent = '刷新行情'; btn.disabled = false; }
      showError(err.message || '行情获取失败');
    });
  }

  function showError(msg) {
    const errEl = document.getElementById('mtError');
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
  }

  /* ---------- 手动录入（兜底） ---------- */
  function openManual() {
    if (!currentDate) return;
    const close = prompt('请输入当日指数收盘价（' + currentDate + '）：', '');
    if (close === null || close === '') return;
    const amount = prompt('请输入当日沪深两市合计成交额（元，可留空）：', '') || '';
    const volume = prompt('请输入当日成交量（股，可留空）：', '') || '0';
    const open = prompt('请输入当日开盘价（可留空）：', '') || close;
    const high = prompt('请输入当日最高价（可留空）：', '') || close;
    const low = prompt('请输入当日最低价（可留空）：', '') || close;

    try {
      const md = App.MarketDataService.saveManual({
        date: currentDate, open: open, high: high, low: low, close: close,
        volume: volume, amount: amount
      }, getPlan());
      if (md.temp_score === null) {
        U().toast('已录入，但历史数据不足无法计算温度（建议先刷新行情获取历史序列）', 'warn');
      } else {
        U().toast('已录入并计算温度：' + md.temp_score + ' 分（' + App.MarketDataService.statusLabel(md.temp_status) + '）', 'success');
      }
      render();
    } catch (e) {
      U().toast(e.message || '录入失败', 'error');
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    document.getElementById('mtRefresh').addEventListener('click', refresh);
    document.getElementById('mtManual').addEventListener('click', openManual);
    // 计算公式面板展开/收起
    const toggle = document.getElementById('mtFormulaToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        const panel = document.getElementById('mtFormulaPanel');
        if (!panel) return;
        const hidden = panel.classList.toggle('hidden');
        toggle.textContent = hidden ? '计算公式 ▾' : '计算公式 ▴';
      });
    }
  }

  return { init, render, setDate, refresh };
})();
