/* ===== Controller：DAQ-2 手动录入当日持仓（v1.1.2 精简版：4 列输入 + 实时计算） ===== */
window.App = window.App || {};

App.ManualEntry = (function () {
  const U = () => App.Utils;

  /* ---------- 单行渲染：名称 | 持仓量 | 成本 | 现价 | 浮动盈亏(只读) ---------- */
  function rowHtml(h) {
    function cell(val, cls) {
      return '<td class="px-2 py-1"><input class="prefill-input ' + (cls || '') + '" value="' +
        U().escapeHtml(val === null || val === undefined ? '' : val) + '" /></td>';
    }
    return '<tr data-row>' +
      '<td class="px-2 py-1"><input class="prefill-input pf-name" list="mnNameList" value="' +
      U().escapeHtml(h.name || '') + '" /></td>' +
      cell(h.position) + cell(h.cost) + cell(h.current_price) +
      '<td class="px-2 py-1 text-right number text-xs pf-calc text-slate-400">—</td>' +
      '<td class="px-2 py-1 text-center"><button data-row-del class="text-slate-300 hover:text-red-600 text-xs">✕</button></td>' +
      '</tr>';
  }

  function addRow() {
    document.getElementById('mn-tbody').insertAdjacentHTML(
      'beforeend', rowHtml(App.Models.createHoldingRow(document.getElementById('mn-date').value)));
  }

  function renderRows(holdings) {
    document.getElementById('mn-tbody').innerHTML = holdings.length
      ? holdings.map(rowHtml).join('') : '';
    if (!holdings.length) addRow();
  }

  /* ---------- overview 区：仅总资产输入 + 三行实时计算展示 ---------- */
  function renderOverview(overview) {
    document.getElementById('mn-overviewGrid').innerHTML =
      '<div><label class="block text-[10px] text-slate-400 mb-0.5">总资产</label>' +
      '<input data-ov="total_assets" class="form-input !py-1.5 !text-xs" value="' +
      U().escapeHtml((overview && overview.total_assets !== undefined && overview.total_assets !== null)
        ? overview.total_assets : '') + '" /></div>' +
      '<div class="col-span-full flex flex-wrap gap-x-6 gap-y-1 pt-1 text-[11px] text-slate-500" id="mn-calcLine">' +
      '<span>总市值：<b id="mn-calcMv" class="number text-slate-700">—</b></span>' +
      '<span>浮动盈亏：<b id="mn-calcFp" class="number">—</b></span>' +
      '<span>仓位：<b id="mn-calcPct" class="number text-slate-700">—</b></span>' +
      '</div>';
  }

  /** 读取当前表格所有行（不落库的中间结构） */
  function readRows() {
    const rows = [];
    document.querySelectorAll('#mn-tbody tr').forEach(tr => {
      const inputs = tr.querySelectorAll('input.prefill-input');
      const num = v => (v === '' ? null : Number(v));
      rows.push({
        tr,
        calcCell: tr.querySelector('.pf-calc'),
        name: inputs[0].value.trim(),
        position: num(inputs[1].value),
        cost: num(inputs[2].value),
        current_price: num(inputs[3].value)
      });
    });
    return rows;
  }

  /** 实时计算：每行浮动盈亏 + overview 聚合（市值/浮动盈亏/仓位%） */
  function recalc() {
    const rows = readRows();
    let sumMv = 0, sumFp = 0, hasRow = false;

    rows.forEach(r => {
      const valid = r.position !== null && r.cost !== null && r.current_price !== null &&
        r.position > 0 && r.cost > 0 && r.current_price > 0;
      if (valid) {
        hasRow = true;
        const mv = r.position * r.current_price;
        const fp = (r.current_price - r.cost) * r.position;
        const pct = (r.current_price - r.cost) / r.cost * 100;
        sumMv += mv;
        sumFp += fp;
        r.calcCell.innerHTML =
          '<span class="' + U().colorClass(fp) + ' font-semibold">' +
          (fp >= 0 ? '+' : '') + U().fmt(Math.round(fp * 100) / 100) + '</span>' +
          ' <span class="text-[10px] ' + U().colorClass(fp) + '">' +
          (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</span>';
      } else {
        r.calcCell.innerHTML = '<span class="text-slate-300">—</span>';
      }
    });

    const taInp = document.querySelector('#mn-overviewGrid [data-ov="total_assets"]');
    const ta = taInp && taInp.value !== '' ? Number(taInp.value) : null;

    const mvEl = document.getElementById('mn-calcMv');
    const fpEl = document.getElementById('mn-calcFp');
    const pctEl = document.getElementById('mn-calcPct');
    if (!mvEl) return;

    if (hasRow) {
      const mv = Math.round(sumMv * 100) / 100;
      const fp = Math.round(sumFp * 100) / 100;
      mvEl.textContent = U().fmt(mv);
      fpEl.textContent = (fp >= 0 ? '+' : '') + U().fmt(fp);
      fpEl.className = 'number ' + U().colorClass(fp);
      if (ta && ta > 0) {
        pctEl.textContent = (sumMv / ta * 100).toFixed(1) + '%';
      } else {
        pctEl.textContent = '—';
      }
    } else {
      mvEl.textContent = '—';
      fpEl.textContent = '—';
      fpEl.className = 'number';
      pctEl.textContent = '—';
    }
  }

  /* ---------- 收集落库（自动补全计算字段） ---------- */
  function collectHoldings() {
    const date = document.getElementById('mn-date').value;
    const rows = [];
    readRows().forEach(r => {
      const h = {
        date,
        name: r.name,
        position: r.position,
        available: r.position,        // v1.1.2：单用户场景 可用=持仓
        cost: r.cost,
        current_price: r.current_price,
        floating_pnl: null,
        market_value: null,
        day_pnl: null, day_pnl_pct: null, floating_pnl_pct: null,
        cleared: 0
      };
      if (h.position && h.current_price) {
        h.market_value = Math.round(h.position * h.current_price * 100) / 100;
      }
      if (h.cost !== null && h.current_price !== null && h.position) {
        h.floating_pnl = Math.round((h.current_price - h.cost) * h.position * 100) / 100;
      }
      if (h.cost && h.current_price) {
        h.floating_pnl_pct = Math.round(((h.current_price - h.cost) / h.cost) * 10000) / 100;
      }
      rows.push(h);
    });
    // 完全空白行（名称空且数值全空）剔除
    return rows.filter(h => h.name || h.position || h.current_price);
  }

  function collectOverview(holdings) {
    const date = document.getElementById('mn-date').value;
    const overview = App.Models.createOverview(date);
    const taInp = document.querySelector('#mn-overviewGrid [data-ov="total_assets"]');
    overview.total_assets = taInp && taInp.value !== '' ? Number(taInp.value) : null;

    // 由持仓聚合派生：总市值 / 浮动盈亏 / 仓位%
    let sumMv = 0, sumFp = 0, has = false;
    (holdings || []).forEach(h => {
      if (h.market_value !== null) { sumMv += h.market_value; has = true; }
      if (h.floating_pnl !== null) sumFp += h.floating_pnl;
    });
    if (has) {
      overview.market_value = Math.round(sumMv * 100) / 100;
      overview.floating_pnl = Math.round(sumFp * 100) / 100;
      if (overview.total_assets && overview.total_assets > 0) {
        overview.position_pct = Math.round(sumMv / overview.total_assets * 1000) / 10;
      }
    }
    // 废弃字段保持 null
    overview.day_pnl = null;
    overview.day_pnl_pct = null;
    overview.available = null;
    overview.withdrawable = null;
    return overview;
  }

  function onSave() {
    const date = document.getElementById('mn-date').value;
    const holdings = collectHoldings();
    for (const h of holdings) {
      if (!h.name) { U().toast('存在未填写标的名称的行', 'error'); return; }
      if (h.position !== null && !U().isPosInt(h.position)) {
        U().toast('「' + h.name + '」持仓量必须为正整数', 'error'); return;
      }
      if (h.current_price !== null && !U().isPosNum(h.current_price)) {
        U().toast('「' + h.name + '」现价必须为正数', 'error'); return;
      }
    }
    const overview = collectOverview(holdings);
    App.HoldingsService.saveSnapshot(date, holdings, overview);

    // 当日截图状态：纯手动录入标记 skipped（仅当无快照记录时）
    const db = App.LocalStorageRepo.getDB();
    if (!db.snapshots[date]) App.SnapshotService.markSkipped(date);

    document.getElementById('manualModal').classList.add('hidden');
    document.getElementById('manualModal').classList.remove('flex');
    App.DashboardController.rebuildDateSelect();
    App.DashboardController.renderAll();
    U().toast('当日持仓已保存', 'success');
  }

  function openModal(presetDate) {
    const date = presetDate || App.DashboardController.getDate() || U().today();
    document.getElementById('mn-date').value = date;
    renderRows(App.HoldingsService.getHoldings(date));
    renderOverview(App.HoldingsService.getOverview(date));
    recalc();

    // 名称补全
    let list = document.getElementById('mnNameList');
    if (!list) {
      list = document.createElement('datalist'); list.id = 'mnNameList';
      document.getElementById('manualModal').appendChild(list);
    }
    list.innerHTML = App.HoldingsService.knownNames()
      .map(n => '<option value="' + U().escapeHtml(n) + '">').join('');

    document.getElementById('manualModal').classList.remove('hidden');
    document.getElementById('manualModal').classList.add('flex');
  }

  const recalcDebounced = () => {
    let t;
    return function () { clearTimeout(t); t = setTimeout(recalc, 100); };
  };
  const debouncedRecalc = recalcDebounced();

  function init() {
    document.getElementById('btnManualEntry').addEventListener('click', () => openModal());
    document.getElementById('mn-addRow').addEventListener('click', () => { addRow(); });
    document.getElementById('mn-tbody').addEventListener('click', e => {
      const btn = e.target.closest('[data-row-del]');
      if (btn) {
        btn.closest('tr').remove();
        recalc();
      }
    });
    // 输入实时计算（防抖 100ms）
    document.getElementById('mn-tbody').addEventListener('input', debouncedRecalc);
    document.getElementById('mn-overviewGrid').addEventListener('input', debouncedRecalc);
    document.getElementById('mn-save').addEventListener('click', onSave);
    document.getElementById('mn-date').addEventListener('change', e => {
      const d = e.target.value;
      renderRows(App.HoldingsService.getHoldings(d));
      renderOverview(App.HoldingsService.getOverview(d));
      recalc();
    });
  }

  return { init, openModal };
})();
