/* ===== Controller：交易流水 Tab（列表 / 搜索 / 删除） ===== */
window.App = window.App || {};

App.TradeListController = (function () {
  const U = () => App.Utils;
  const C = () => App.Constants;

  function rowHtml(t) {
    const isBuy = C().BUY_ACTIONS.includes(t.action);
    const typeCol = isBuy
      ? '<span class="tag tag-reason">' + U().escapeHtml(t.reason_type) + '</span>'
      : '<span class="tag tag-' + U().escapeHtml(t.sell_type) + '">' + U().escapeHtml(t.sell_type) + '</span>';
    const summary = isBuy
      ? U().escapeHtml(U().truncate(t.buy_reason, 40))
      : U().escapeHtml(U().truncate(t.sell_note, 40));
    const modified = t.created_at && t.updated_at && t.updated_at.slice(0, 16) !== t.created_at.slice(0, 16);

    return '<tr class="border-t border-slate-50 hover:bg-slate-50/60">' +
      '<td class="px-4 py-3 text-slate-500 number">' + t.date +
      (modified ? '<span class="ml-1 text-[10px] text-amber-600">已修改</span>' : '') + '</td>' +
      '<td class="px-4 py-3 font-medium text-slate-700">' + U().escapeHtml(t.name) + '</td>' +
      '<td class="px-4 py-3"><span class="tag tag-' + t.action + '">' +
      C().ACTION_LABELS[t.action] + '</span></td>' +
      '<td class="px-4 py-3 text-right number text-slate-600">' + U().fmt(t.amount, 0) + '</td>' +
      '<td class="px-4 py-3 text-right number text-slate-600">' + U().fmt(t.price, 4) + '</td>' +
      '<td class="px-4 py-3">' + typeCol + '</td>' +
      '<td class="px-4 py-3 text-slate-500 max-w-[200px]">' + summary + '</td>' +
      '<td class="px-4 py-3 text-center whitespace-nowrap">' +
      '<button data-edit="' + t.id + '" class="text-[11px] text-slate-400 hover:text-slate-700 transition-colors mr-2">编辑</button>' +
      '<button data-del="' + t.id + '" class="text-[11px] text-slate-400 hover:text-red-600 transition-colors">删除</button>' +
      '</td></tr>';
  }

  function render(keyword) {
    keyword = (keyword || '').trim().toLowerCase();
    let trades = App.TradeService.getAllTrades()
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

    if (keyword) {
      trades = trades.filter(t =>
        t.name.toLowerCase().includes(keyword) ||
        (t.buy_reason || '').toLowerCase().includes(keyword) ||
        (t.sell_note || '').toLowerCase().includes(keyword) ||
        (t.reason_type || '').toLowerCase().includes(keyword)
      );
    }

    document.getElementById('tradesTbody').innerHTML =
      trades.length ? trades.map(rowHtml).join('')
        : '<tr><td colspan="8" class="text-center text-slate-400 py-10">暂无交易记录，点击「记一笔交易」开始录入</td></tr>';
    document.getElementById('tradeCount').textContent = '共 ' + trades.length + ' 笔';
  }

  function onDelete(id) {
    if (!confirm('确认删除该笔交易？此操作不可恢复。')) return;
    try {
      App.TradeService.deleteTrade(id);
      render(document.getElementById('tradeSearch').value);
      App.DashboardController.renderAll();
      U().toast('交易已删除', 'success');
    } catch (e) {
      U().toast(e.message, 'error');
    }
  }

  function init() {
    document.getElementById('tradesTbody').addEventListener('click', e => {
      const delBtn = e.target.closest('[data-del]');
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const t = App.TradeService.getTrade(editBtn.getAttribute('data-edit'));
        if (t) App.TradeForm.openTradeForEdit(t);
      } else if (delBtn) {
        onDelete(delBtn.getAttribute('data-del'));
      }
    });
    document.getElementById('tradeSearch').addEventListener('input',
      U().debounce(e => render(e.target.value), 200));
  }

  return { init, render };
})();
