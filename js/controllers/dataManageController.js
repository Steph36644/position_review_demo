/* ===== Controller：数据管理（一键重置全部 + 单日/单标的删除） ===== */
window.App = window.App || {};

App.DataManage = (function () {
  const U = () => App.Utils;
  const C = () => App.Constants;

  const RESET_MODAL = 'resetModal';
  const DELETE_MODAL = 'deleteDataModal';
  const ARM_SECONDS = 4;

  /* ================= 通用弹窗开关 ================= */

  function showModal(id) {
    const m = document.getElementById(id);
    m.classList.remove('hidden');
    m.classList.add('flex');
  }
  function hideModal(id) {
    const m = document.getElementById(id);
    m.classList.add('hidden');
    m.classList.remove('flex');
  }

  /* ================= 功能一：重置全部数据（双保险确认） ================= */

  let resetArmed = false;
  let resetTimer = null;

  function disarmReset() {
    resetArmed = false;
    clearTimeout(resetTimer);
    const btn = document.getElementById('rs-go');
    btn.textContent = '确认重置全部数据';
    btn.classList.remove('btn-danger-armed', 'bg-red-800');
    btn.classList.add('bg-red-600');
  }

  function armReset() {
    resetArmed = true;
    const btn = document.getElementById('rs-go');
    btn.textContent = '再次点击确认重置（' + ARM_SECONDS + ' 秒内）';
    btn.classList.remove('bg-red-600');
    btn.classList.add('bg-red-800', 'btn-danger-armed');
    resetTimer = setTimeout(disarmReset, ARM_SECONDS * 1000);
  }

  function openReset() {
    // 统计当前数据量
    const db = App.LocalStorageRepo.getDB();
    const dateCount = App.LocalStorageRepo.getDates().length;
    document.getElementById('rs-countTrades').textContent = db.trades.length;
    document.getElementById('rs-countDates').textContent = dateCount;
    document.getElementById('rs-countReviews').textContent = Object.keys(db.reviews).length;

    document.getElementById('rs-ack').checked = false;
    document.getElementById('rs-seed').checked = true;
    document.getElementById('rs-go').disabled = true;
    disarmReset();
    showModal(RESET_MODAL);
  }

  /**
   * 执行重置：
   * 1. 先清空全部 localStorage 业务键 + v0.0 遗留键（核心数据，必须完成）
   * 2. keepSeed=false 时写入空结构（重启后为空白状态；否则重新播种演示数据）
   * 3. IndexedDB 截图尽力清空（3 秒超时保护，不阻断重置与刷新）
   */
  async function executeReset(keepSeed) {
    const btn = document.getElementById('rs-go');
    btn.disabled = true;
    btn.textContent = '正在清空数据…';

    // 1. 清业务键（pr_*）
    Object.keys(C().LS_KEYS).forEach(k => localStorage.removeItem(C().LS_KEYS[k]));
    // 清 v0.0 遗留键
    localStorage.removeItem('uploadedSnapshots');
    Object.keys(localStorage)
      .filter(k => /^review_\d{4}-\d{2}-\d{2}$/.test(k))
      .forEach(k => localStorage.removeItem(k));

    // 2. 空白模式：写入空结构，使启动时不再播种演示数据
    if (!keepSeed) {
      localStorage.setItem(C().LS_KEYS.overview, '{}');
      localStorage.setItem(C().LS_KEYS.holdings, '{}');
      localStorage.setItem(C().LS_KEYS.trades, '[]');
      localStorage.setItem(C().LS_KEYS.reviews, '{}');
      localStorage.setItem(C().LS_KEYS.snapshots, '{}');
      localStorage.setItem(C().LS_KEYS.instruments, '{}');   // v1.3.1：主数据
      localStorage.setItem(C().LS_KEYS.version, C().SCHEMA_VERSION);
    }

    // 3. 截图清理为尽力操作，超时/失败均不阻断
    try {
      await Promise.race([
        App.IndexedDBRepo.clearAll(),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    } catch (e) {
      console.warn('IndexedDB 截图清空失败，已继续重置', e);
    }

    location.reload();
  }

  /* ================= 功能二：单日 / 单标的删除 ================= */

  let deleteMode = 'date'; // date | name

  function switchMode(mode) {
    deleteMode = mode;
    document.querySelectorAll('.dm-mode-btn').forEach(b => {
      const active = b.getAttribute('data-mode') === mode;
      b.classList.toggle('bg-slate-800', active);
      b.classList.toggle('text-white', active);
      b.classList.toggle('bg-white', !active);
      b.classList.toggle('text-slate-600', !active);
    });
    document.getElementById('dm-panel-date').classList.toggle('hidden', mode !== 'date');
    document.getElementById('dm-panel-name').classList.toggle('hidden', mode !== 'name');
    refreshDeleteImpact();
  }

  /** 填充标的下拉（持仓 + 交易流水并集） */
  function rebuildNameSelect(prefer) {
    const sel = document.getElementById('dm-name');
    const names = App.HoldingsService.allKnownNames();
    sel.innerHTML = '<option value="">请选择标的</option>' +
      names.map(n => '<option value="' + U().escapeHtml(n) + '">' + U().escapeHtml(n) + '</option>').join('');
    if (prefer && names.indexOf(prefer) >= 0) sel.value = prefer;
  }

  function optCheckbox(id, label, checked, disabled, sub) {
    return '<label class="flex items-start gap-2 ' + (disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer') + '">' +
      '<input type="checkbox" id="' + id + '" class="mt-0.5 rounded" ' +
      (checked ? 'checked' : '') + (disabled ? 'disabled' : '') + ' />' +
      '<span class="text-xs text-slate-600">' + label + (sub ? '<span class="block text-[10px] text-slate-400">' + sub + '</span>' : '') +
      '</span></label>';
  }

  /** 渲染前先保留动态复选框的勾选态（innerHTML 会重建节点） */
  function readOptState(id) {
    const el = document.getElementById(id);
    return !!(el && el.checked);
  }

  /** 渲染影响面 + 选项，并联动确认按钮 */
  function refreshDeleteImpact() {
    const box = document.getElementById('dm-impact');
    const failBox = document.getElementById('dm-failures');
    failBox.classList.add('hidden');

    // 重建前捕获当前勾选态
    const reviewChecked = readOptState('dm-opt-review');
    const tradesChecked = readOptState('dm-opt-trades');

    let canDelete = false;
    let html = '';

    if (deleteMode === 'date') {
      const d = document.getElementById('dm-date').value;
      if (!d) {
        box.innerHTML = '<p class="text-xs text-slate-400">请先选择要删除的日期</p>';
        document.getElementById('dm-go').disabled = true;
        return;
      }
      const im = App.HoldingsService.getDateImpact(d);
      const fixed = [];
      if (im.holdingsRows > 0) fixed.push('持仓明细 <b>' + im.holdingsRows + '</b> 条');
      if (im.hasOverview) fixed.push('账户总览 <b>1</b> 份');
      if (im.hasSnapshot) fixed.push('OCR 快照记录与截图 <b>1</b> 份');
      if (fixed.length) {
        canDelete = true;
        html += '<div class="rounded-lg bg-red-50 border border-red-100 p-2.5 space-y-1">' +
          '<p class="text-[11px] font-semibold text-red-800">将删除（必删项）</p>' +
          fixed.map(t => '<p class="text-xs text-red-700">· ' + t + '</p>').join('') +
          '</div>';
      }
      const opts = [];
      opts.push(optCheckbox('dm-opt-review', '同时删除当日「每日复盘」', reviewChecked, !im.hasReview,
        im.hasReview ? '该日存在复盘记录' : '该日无复盘记录'));
      opts.push(optCheckbox('dm-opt-trades', '同时删除当日交易流水（共 ' + im.tradeCount + ' 笔）', tradesChecked, im.tradeCount === 0,
        '被其它日期卖出关联的买入将无法删除，会逐条提示'));
      html += '<div class="space-y-1.5">' + opts.join('') + '</div>';
      if (reviewChecked && im.hasReview) canDelete = true;
      if (tradesChecked && im.tradeCount > 0) canDelete = true;
      if (!fixed.length && im.tradeCount === 0 && !im.hasReview) {
        html = '<p class="text-xs text-slate-400">该日期下没有任何数据</p>' + html;
      }
    } else {
      const name = document.getElementById('dm-name').value;
      if (!name) {
        box.innerHTML = '<p class="text-xs text-slate-400">请先选择要删除的标的</p>';
        document.getElementById('dm-go').disabled = true;
        return;
      }
      const im = App.HoldingsService.getNameImpact(name);
      if (im.rows > 0) {
        canDelete = true;
        const dateText = im.dates.slice(0, 5).join('、') + (im.dates.length > 5 ? ' 等 ' + im.dates.length + ' 个日期' : '');
        html += '<div class="rounded-lg bg-red-50 border border-red-100 p-2.5 space-y-1">' +
          '<p class="text-[11px] font-semibold text-red-800">将删除（必删项）</p>' +
          '<p class="text-xs text-red-700">· 各日持仓明细共 <b>' + im.rows + '</b> 条</p>' +
          '<p class="text-[10px] text-red-400">涉及日期：' + U().escapeHtml(dateText) + '</p>' +
          '<p class="text-[10px] text-slate-400">账户总览为账户级数据，不受影响</p>' +
          '</div>';
      }
      html += '<div class="space-y-1.5">' +
        optCheckbox('dm-opt-trades', '同时删除该标的全部交易流水（共 ' + im.tradeCount + ' 笔）', tradesChecked, im.tradeCount === 0,
          '被其它卖出关联的买入将无法删除，会逐条提示') +
        '</div>';
      if (tradesChecked && im.tradeCount > 0) canDelete = true;
      if (im.rows === 0 && im.tradeCount === 0) {
        html = '<p class="text-xs text-slate-400">该标的下没有任何数据</p>' + html;
      }
    }

    box.innerHTML = html;
    document.getElementById('dm-go').disabled = !canDelete;
  }

  /** 因复选框是动态渲染的，每次刷新后需重新读取勾选态并联动按钮 */
  function syncDeleteButton() {
    refreshDeleteImpact();
  }

  function showFailures(failed) {
    const box = document.getElementById('dm-failures');
    box.classList.remove('hidden');
    box.innerHTML =
      '<p class="text-xs font-semibold text-red-700 mb-1">以下 ' + failed.length +
      ' 笔交易因关联关系未能删除，请先在「交易流水」中处理关联的卖出记录：</p>' +
      '<ul class="space-y-1 max-h-32 overflow-y-auto">' +
      failed.map(f =>
        '<li class="text-[11px] text-red-600">· ' +
        U().escapeHtml(f.trade.date) + ' ' + U().escapeHtml(f.trade.name) + ' ' +
        U().escapeHtml(C().ACTION_LABELS[f.trade.action] || f.trade.action) +
        ' ' + U().fmt(f.trade.amount, 0) + ' 股 — ' + U().escapeHtml(f.message) +
        '</li>').join('') +
      '</ul>';
  }

  async function executeDelete() {
    const btn = document.getElementById('dm-go');
    btn.disabled = true;
    let tradeResult = null;
    let summary = '';

    try {
      if (deleteMode === 'date') {
        const d = document.getElementById('dm-date').value;
        if (!d) { U().toast('请选择日期', 'warn'); return; }
        const includeReview = document.getElementById('dm-opt-review')
          && document.getElementById('dm-opt-review').checked;
        const includeTrades = document.getElementById('dm-opt-trades')
          && document.getElementById('dm-opt-trades').checked;

        if (includeTrades) {
          const ids = App.TradeService.getTradesByDate(d).map(t => t.id);
          tradeResult = App.TradeService.deleteTradesByIds(ids);
        }
        const im = App.HoldingsService.deleteDateData(d, { includeReview: includeReview });
        try { await App.IndexedDBRepo.deleteImage('snap_' + d); } catch (e) { /* 无截图忽略 */ }

        summary = '已删除 ' + d + ' 数据';
        const extras = [];
        if (im.holdingsRows) extras.push('持仓 ' + im.holdingsRows + ' 条');
        if (im.hasOverview) extras.push('账户总览');
        if (im.hasSnapshot) extras.push('快照/截图');
        if (includeReview && im.hasReview) extras.push('复盘');
        if (tradeResult) extras.push('交易 ' + tradeResult.deleted.length + ' 笔');
        if (extras.length) summary += '（' + extras.join('、') + '）';
      } else {
        const name = document.getElementById('dm-name').value;
        if (!name) { U().toast('请选择标的', 'warn'); return; }
        const includeTrades = document.getElementById('dm-opt-trades')
          && document.getElementById('dm-opt-trades').checked;

        if (includeTrades) {
          const ids = App.TradeService.getAllTrades().filter(t => t.name === name).map(t => t.id);
          tradeResult = App.TradeService.deleteTradesByIds(ids);
        }
        const im = App.HoldingsService.deleteNameData(name);
        summary = '已删除标的「' + name + '」持仓 ' + im.rows + ' 条' +
          (tradeResult ? '、交易 ' + tradeResult.deleted.length + ' 笔' : '');
      }

      // 刷新看板与日期选择器
      rebuildNameSelect();
      App.DashboardController.rebuildDateSelect();
      App.DashboardController.renderAll();
      refreshDeleteImpact();

      if (tradeResult && tradeResult.failed.length > 0) {
        showFailures(tradeResult.failed);
        U().toast(summary + '；但有 ' + tradeResult.failed.length + ' 笔交易未能删除', 'error');
      } else {
        hideModal(DELETE_MODAL);
        U().toast(summary, 'success');
      }
    } catch (e) {
      console.error(e);
      U().toast(e.message || '删除失败', 'error');
      btn.disabled = false;
    }
  }

  function openDelete() {
    document.getElementById('dm-failures').classList.add('hidden');
    document.getElementById('dm-date').value = App.DashboardController.getDate() || U().today();
    rebuildNameSelect();
    switchMode('date');
    showModal(DELETE_MODAL);
  }

  /* ================= 初始化 ================= */

  function init() {
    document.getElementById('btnResetAll').addEventListener('click', openReset);
    document.getElementById('btnDeleteData').addEventListener('click', openDelete);

    // 重置弹窗
    document.getElementById('rs-ack').addEventListener('change', e => {
      document.getElementById('rs-go').disabled = !e.target.checked;
      if (!e.target.checked) disarmReset();
    });
    document.getElementById('rs-go').addEventListener('click', () => {
      if (document.getElementById('rs-go').disabled) return;
      if (!resetArmed) { armReset(); return; }
      clearTimeout(resetTimer);
      executeReset(document.getElementById('rs-seed').checked);
    });

    // 删除弹窗：模式切换
    document.querySelectorAll('.dm-mode-btn').forEach(b => {
      b.addEventListener('click', () => switchMode(b.getAttribute('data-mode')));
    });
    document.getElementById('dm-date').addEventListener('change', refreshDeleteImpact);
    document.getElementById('dm-name').addEventListener('change', refreshDeleteImpact);
    // 动态复选框事件委托
    document.getElementById('dm-impact').addEventListener('change', e => {
      if (e.target.closest('#dm-opt-review, #dm-opt-trades')) syncDeleteButton();
    });
    document.getElementById('dm-go').addEventListener('click', executeDelete);

    // 通用关闭（取消按钮 / 右上角 / 遮罩点击）
    document.getElementById(RESET_MODAL).addEventListener('click', e => {
      if (e.target.closest('.modal-close-btn')) { hideModal(RESET_MODAL); disarmReset(); }
    });
    document.getElementById(DELETE_MODAL).addEventListener('click', e => {
      if (e.target.closest('.modal-close-btn')) hideModal(DELETE_MODAL);
    });
  }

  return { init };
})();
