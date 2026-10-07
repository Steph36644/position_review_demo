/* ===== Controller：交易方向选择 + R1 买入弹窗 + R2 卖出弹窗（含实时校验，支持编辑） ===== */
window.App = window.App || {};

App.TradeForm = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  let editingId = null;      // 非 null 时保存走 update
  let lockedName = null;     // 从持仓卡片进入时锁定标的
  let selectedSellType = null;
  let currentAction = null;  // 当前卖出弹窗的实际 action（sell/reduce/clear）
  let linkedState = new Map(); // buyId -> { checked, qty }

  /* ---------- 弹窗通用 ---------- */
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

  function openPicker() {
    editingId = null;
    showModal('actionModal');
  }

  /* ============ R1 买入表单 ============ */

  function initBuySelects() {
    const rt = document.getElementById('bf-reasonType');
    if (rt.options.length <= 1) {
      C().REASON_TYPES.forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; rt.appendChild(o);
      });
    }
    const ep = document.getElementById('bf-expectedPeriod');
    if (ep.options.length <= 1) {
      C().EXPECTED_PERIODS.forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; ep.appendChild(o);
      });
    }
  }

  function openBuyForm(action, presetName) {
    initBuySelects();
    editingId = null;
    lockedName = presetName || null;

    document.getElementById('buyModalTitle').textContent =
      C().ACTION_LABELS[action] + ' · 理由录入';
    document.getElementById('bf-action').value = C().ACTION_LABELS[action];
    document.getElementById('bf-name').value = lockedName || '';
    document.getElementById('bf-name').readOnly = !!lockedName;
    document.getElementById('bf-amount').value = '';
    document.getElementById('bf-price').value = '';
    document.getElementById('bf-date').value = U().today();
    document.getElementById('bf-buyReason').value = '';
    document.getElementById('bf-reasonType').value = '';
    document.getElementById('bf-expectedPeriod').value = '';
    document.getElementById('bf-invalidCondition').value = '';
    document.getElementById('bf-targetLow').value = '';
    document.getElementById('bf-targetHigh').value = '';
    document.getElementById('bf-stopLoss').value = '';
    document.getElementById('bf-errors').innerHTML = '';
    document.getElementById('bf-warnings').innerHTML = '';
    document.getElementById('bf-save').textContent = '保存';
    document.getElementById('bf-save').disabled = true;
    showModal('buyModal');
    validateBuyForm();
  }

  /** 编辑模式填充已有 trade */
  function openTradeForEdit(trade) {
    if (C().BUY_ACTIONS.includes(trade.action)) {
      initBuySelects();
      lockedName = null;
      editingId = trade.id;
      document.getElementById('buyModalTitle').textContent = '修改买入记录';
      document.getElementById('bf-action').value = C().ACTION_LABELS[trade.action];
      document.getElementById('bf-name').value = trade.name;
      document.getElementById('bf-name').readOnly = false;
      document.getElementById('bf-amount').value = trade.amount;
      document.getElementById('bf-price').value = trade.price;
      document.getElementById('bf-date').value = trade.date;
      document.getElementById('bf-buyReason').value = trade.buy_reason;
      document.getElementById('bf-reasonType').value = trade.reason_type;
      document.getElementById('bf-expectedPeriod').value = trade.expected_period;
      document.getElementById('bf-invalidCondition').value = trade.invalid_condition;
      document.getElementById('bf-targetLow').value = trade.target_price_low;
      document.getElementById('bf-targetHigh').value = trade.target_price_high;
      document.getElementById('bf-stopLoss').value = trade.stop_loss;
      document.getElementById('bf-save').textContent = '保存修改';
      showModal('buyModal');
      validateBuyForm();
    } else {
      lockedName = null;
      openSellForm(trade.action, null, trade);
    }
  }

  function collectBuyInput() {
    return {
      action: document.getElementById('bf-action').value === '新建买入' ? 'buy'
        : C().BUY_ACTIONS.find(a => C().ACTION_LABELS[a] === document.getElementById('bf-action').value) || 'buy',
      name: document.getElementById('bf-name').value,
      amount: document.getElementById('bf-amount').value,
      price: document.getElementById('bf-price').value,
      date: document.getElementById('bf-date').value,
      buy_reason: document.getElementById('bf-buyReason').value,
      reason_type: document.getElementById('bf-reasonType').value,
      expected_period: document.getElementById('bf-expectedPeriod').value,
      invalid_condition: document.getElementById('bf-invalidCondition').value,
      target_price_low: document.getElementById('bf-targetLow').value,
      target_price_high: document.getElementById('bf-targetHigh').value,
      stop_loss: document.getElementById('bf-stopLoss').value
    };
  }

  /** 实时细粒度校验：返回 errors（阻断）与 warnings（软提示） */
  function checkBuyForm() {
    const i = collectBuyInput();
    const errors = [];

    if (!i.name.trim()) errors.push('标的名称不能为空');
    if (!U().isPosInt(i.amount)) errors.push('数量必须为正整数');
    if (!U().isPosNum(i.price)) errors.push('价格必须为正数');
    if (!i.date) errors.push('交易日期不能为空');

    if (!String(i.buy_reason).trim()) errors.push('核心理由不能为空');
    else if (i.buy_reason.length > 100) errors.push('核心理由不能超过 100 字');

    if (!i.reason_type) errors.push('请选择理由类型');
    if (!i.expected_period) errors.push('请选择预期持有周期');

    if (!String(i.invalid_condition).trim()) errors.push('失效条件不能为空');
    else if (i.invalid_condition.length > 100) errors.push('失效条件不能超过 100 字');

    if (!U().isPosNum(i.target_price_low)) errors.push('目标区间下沿必须为正数');
    if (!U().isPosNum(i.target_price_high)) errors.push('目标区间上沿必须为正数');
    if (U().isPosNum(i.target_price_low) && U().isPosNum(i.target_price_high) &&
      Number(i.target_price_low) > Number(i.target_price_high)) {
      errors.push('目标区间下沿不能大于上沿');
    }
    if (!U().isPosNum(i.stop_loss)) errors.push('止损位必须为正数');

    const warnings = App.TradeService.buyWarnings(i);
    return { errors, warnings };
  }

  function validateBuyForm() {
    const { errors, warnings } = checkBuyForm();
    document.getElementById('bf-save').disabled = errors.length > 0;
    document.getElementById('bf-errors').innerHTML = errors.length
      ? errors.map(e => '<p class="field-error">• ' + U().escapeHtml(e) + '</p>').join('') : '';
    document.getElementById('bf-warnings').innerHTML = warnings.length
      ? warnings.map(w => '<p class="field-warn">⚠ ' + U().escapeHtml(w) + '（仍可保存）</p>').join('') : '';
  }

  function saveBuy() {
    const input = collectBuyInput();
    try {
      if (editingId) App.TradeService.updateTrade(editingId, input);
      else App.TradeService.createTrade(input);
      hideModal('buyModal');
      App.TradeListController.render(document.getElementById('tradeSearch').value);
      App.DashboardController.renderAll();
      U().toast(editingId ? '买入记录已更新' : '买入记录已保存', 'success');
      editingId = null;
    } catch (e) {
      document.getElementById('bf-errors').innerHTML =
        '<p class="field-error">• ' + U().escapeHtml(e.message) + '</p>';
    }
  }

  /* ============ R2 卖出表单 ============ */

  function openSellForm(action, presetName, tradeForEdit) {
    editingId = tradeForEdit ? tradeForEdit.id : null;
    lockedName = presetName || null;
    selectedSellType = tradeForEdit ? tradeForEdit.sell_type : null;
    currentAction = action;
    linkedState = new Map();

    document.getElementById('sellModalTitle').textContent =
      (tradeForEdit ? '修改' : '') + C().ACTION_LABELS[action] + ' · 强制对照买入理由';

    document.getElementById('sf-name').value = tradeForEdit ? tradeForEdit.name : (lockedName || '');
    document.getElementById('sf-name').readOnly = !!lockedName && !tradeForEdit;
    document.getElementById('sf-amount').value = tradeForEdit ? tradeForEdit.amount : '';
    document.getElementById('sf-price').value = tradeForEdit ? tradeForEdit.price : '';
    document.getElementById('sf-date').value = tradeForEdit ? tradeForEdit.date : U().today();
    document.getElementById('sf-sellNote').value = tradeForEdit ? (tradeForEdit.sell_note || '') : '';
    document.getElementById('sf-errors').innerHTML = '';
    document.getElementById('sf-save').textContent = tradeForEdit ? '保存修改' : '保存';

    // sell_type 按钮态
    document.querySelectorAll('#sf-sellType .selltype-pick').forEach(b => {
      b.classList.remove('st-兑现', 'st-证伪', 'st-失效', 'st-违规');
    });
    if (selectedSellType) markSellType(selectedSellType);

    if (tradeForEdit && tradeForEdit.linked_qty_map) {
      Object.keys(tradeForEdit.linked_qty_map).forEach(bid => {
        linkedState.set(bid, { checked: true, qty: tradeForEdit.linked_qty_map[bid] });
      });
    }

    renderOpenBuys();
    showModal('sellModal');
    validateSellForm();
  }

  function markSellType(type) {
    selectedSellType = type;
    document.querySelectorAll('#sf-sellType .selltype-pick').forEach(b => {
      b.classList.remove('st-兑现', 'st-证伪', 'st-失效', 'st-违规');
      if (b.getAttribute('data-type') === type) b.classList.add('st-' + type);
    });
    document.getElementById('sf-noteLabel').innerHTML = type === '违规'
      ? '违规说明（至少 5 个字）<span class="text-red-500">*</span>'
      : '卖出说明（一句话）<span class="text-red-500">*</span>';

    if (type === '违规') {
      linkedState.clear();
    }
    renderOpenBuys();
    validateSellForm();
  }

  /** 渲染右侧未平仓买入列表 */
  function renderOpenBuys() {
    const name = document.getElementById('sf-name').value.trim();
    const container = document.getElementById('sf-openBuys');
    const noData = document.getElementById('sf-noOpenBuys');
    container.innerHTML = '';

    let openBuys = [];
    if (name) {
      openBuys = App.TradeService.getOpenBuys(name);
    }

    const disabled = selectedSellType === '违规' || selectedSellType === null;

    if (openBuys.length === 0) {
      noData.classList.remove('hidden');
      if (selectedSellType && selectedSellType !== '违规') {
        noData.textContent = '该标的暂无未平仓买入记录，只能按「违规」卖出';
      } else {
        noData.textContent = selectedSellType === '违规'
          ? '违规卖出不关联买入记录' : '请先填写标的名称并选择卖出分类';
      }
    } else {
      noData.classList.add('hidden');
    }

    openBuys.forEach(b => {
      const st = linkedState.get(b.id) || { checked: false, qty: null };
      linkedState.set(b.id, st);
      const div = document.createElement('div');
      div.className = 'bg-white rounded-lg border border-slate-200 p-2.5 ' +
        (selectedSellType === '违规' ? 'opacity-40 pointer-events-none' : '');
      div.innerHTML =
        '<label class="flex items-start gap-2 cursor-pointer">' +
        '<input type="checkbox" data-link="' + b.id + '" class="mt-0.5" ' +
        (st.checked ? 'checked' : '') + (disabled && !st.checked ? ' disabled' : '') + ' />' +
        '<span class="flex-1 text-[11px] text-slate-600">' +
        '<span class="font-medium text-slate-800">' + U().escapeHtml(b.date) + '</span> · ' +
        U().fmt(b.amount, 0) + ' 股 · ' + U().escapeHtml(b.reason_type) +
        '<br><span class="text-slate-400">未平仓 <b class="text-slate-600">' + U().fmt(b.qty_open, 0) +
        '</b> 股 · ' + U().escapeHtml(U().truncate(b.buy_reason, 22)) + '</span>' +
        '</span></label>' +
        '<div class="mt-1.5 flex items-center gap-1.5 pl-6">' +
        '<span class="text-[10px] text-slate-400">本次消耗</span>' +
        '<input type="number" min="1" step="1" data-qty="' + b.id + '" value="' +
        (st.qty || '') + '" class="form-input !py-1 !text-[11px]" placeholder="0" ' +
        (!st.checked || selectedSellType === '违规' ? 'disabled' : '') + ' /></div>';
      container.appendChild(div);
    });
  }

  function collectSellInput() {
    const linked_buy_ids = [];
    const linked_qty_map = {};
    linkedState.forEach((st, buyId) => {
      if (st.checked && selectedSellType !== '违规') {
        linked_buy_ids.push(buyId);
        linked_qty_map[buyId] = Number(st.qty);
      }
    });
    return {
      action: currentAction,
      name: document.getElementById('sf-name').value,
      amount: document.getElementById('sf-amount').value,
      price: document.getElementById('sf-price').value,
      date: document.getElementById('sf-date').value,
      sell_type: selectedSellType,
      sell_note: document.getElementById('sf-sellNote').value,
      linked_buy_ids,
      linked_qty_map
    };
  }

  function checkSellForm() {
    const i = collectSellInput();
    const errors = [];

    if (!i.name.trim()) errors.push('标的名称不能为空');
    if (!U().isPosInt(i.amount)) errors.push('数量必须为正整数');
    if (!U().isPosNum(i.price)) errors.push('价格必须为正数');
    if (!i.date) errors.push('交易日期不能为空');
    if (!i.sell_type) errors.push('请选择卖出分类');

    if (i.sell_type === '违规') {
      if (String(i.sell_note).trim().length < 5) errors.push('违规说明至少 5 个字');
      return errors;
    }
    if (!i.sell_type) return errors;

    if (!String(i.sell_note).trim()) errors.push('卖出说明不能为空');
    if (i.linked_buy_ids.length === 0) errors.push('请勾选至少一条未平仓买入记录');

    let total = 0;
    i.linked_buy_ids.forEach(bid => {
      const q = Number(i.linked_qty_map[bid]);
      if (!U().isPosInt(q)) errors.push('每条选中买入的消耗数量须为正整数');
      total += q;
    });
    if (i.linked_buy_ids.length > 0 && U().isPosInt(i.amount) && total !== Number(i.amount)) {
      errors.push('消耗数量之和（' + total + '）须等于卖出数量（' + Number(i.amount) + '）');
    }
    return errors;
  }

  function validateSellForm() {
    const errors = checkSellForm();
    document.getElementById('sf-save').disabled = errors.length > 0;
    document.getElementById('sf-errors').innerHTML = errors.length
      ? errors.map(e => '<p class="field-error">• ' + U().escapeHtml(e) + '</p>').join('') : '';
  }

  function saveSell() {
    const input = collectSellInput();
    try {
      if (editingId) App.TradeService.updateTrade(editingId, input);
      else App.TradeService.createTrade(input);
      hideModal('sellModal');
      App.TradeListController.render(document.getElementById('tradeSearch').value);
      App.DashboardController.renderAll();
      U().toast(editingId ? '卖出记录已更新' : '卖出记录已保存', 'success');
      editingId = null;
    } catch (e) {
      document.getElementById('sf-errors').innerHTML =
        '<p class="field-error">• ' + U().escapeHtml(e.message) + '</p>';
    }
  }

  /* ---------- 入口 ---------- */
  function openForAction(action, presetName) {
    hideModal('actionModal');
    if (C().BUY_ACTIONS.includes(action)) openBuyForm(action, presetName);
    else openSellForm(action, presetName);
  }

  /* ---------- 事件绑定 ---------- */
  function init() {
    document.getElementById('btnNewTrade').addEventListener('click', openPicker);
    document.getElementById('btnNewTrade2').addEventListener('click', openPicker);

    document.getElementById('actionPicker').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn) openForAction(btn.getAttribute('data-action'));
    });

    // R1 实时校验
    ['bf-name', 'bf-amount', 'bf-price', 'bf-date', 'bf-buyReason', 'bf-reasonType',
      'bf-expectedPeriod', 'bf-invalidCondition', 'bf-targetLow', 'bf-targetHigh', 'bf-stopLoss']
      .forEach(id => {
        document.getElementById(id).addEventListener('input', validateBuyForm);
        document.getElementById(id).addEventListener('change', validateBuyForm);
      });
    document.getElementById('bf-save').addEventListener('click', saveBuy);

    // R2
    document.getElementById('sf-sellType').addEventListener('click', e => {
      const btn = e.target.closest('[data-type]');
      if (btn) markSellType(btn.getAttribute('data-type'));
    });
    ['sf-name', 'sf-amount', 'sf-price', 'sf-date', 'sf-sellNote']
      .forEach(id => {
        document.getElementById(id).addEventListener('input', validateSellForm);
        document.getElementById(id).addEventListener('change', () => {
          if (id === 'sf-name') renderOpenBuys();
          validateSellForm();
        });
      });

    document.getElementById('sf-openBuys').addEventListener('change', e => {
      const cb = e.target.closest('[data-link]');
      const qtyInput = e.target.closest('[data-qty]');
      if (cb) {
        const buyId = cb.getAttribute('data-link');
        const st = linkedState.get(buyId) || { checked: false, qty: null };
        st.checked = cb.checked;
        if (cb.checked && !st.qty) {
          // 便捷默认：仅勾选一条时带入卖出数量
          const checkedCount = Array.from(linkedState.values()).filter(s => s.checked).length;
          if (checkedCount === 1) {
            const amount = document.getElementById('sf-amount').value;
            if (U().isPosInt(amount)) st.qty = Number(amount);
          }
        }
        linkedState.set(buyId, st);
        renderOpenBuys();
        validateSellForm();
      }
      if (qtyInput) {
        const buyId = qtyInput.getAttribute('data-qty');
        const st = linkedState.get(buyId) || { checked: true, qty: null };
        st.qty = Number(qtyInput.value);
        linkedState.set(buyId, st);
        validateSellForm();
      }
    });
    document.getElementById('sf-save').addEventListener('click', saveSell);

    // 通用：关闭按钮 / 点击遮罩空白
    document.addEventListener('click', e => {
      const btn = e.target.closest('.modal-close-btn');
      if (btn) {
        const m = btn.closest('.modal-mask');
        m.classList.add('hidden'); m.classList.remove('flex');
      }
    });
    document.querySelectorAll('.modal-mask').forEach(m => {
      m.addEventListener('click', e => {
        if (e.target === m) {
          m.classList.add('hidden'); m.classList.remove('flex');
        }
      });
    });
  }

  return { init, openForAction, openTradeForEdit };
})();
