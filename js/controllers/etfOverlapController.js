/* ===== Controller：v1.3.1 D4 ETF 重叠检测面板 ===== */
window.App = window.App || {};

App.EtfOverlapController = (function () {
  const U = () => App.Utils;
  const C = () => App.Constants;

  function render() {
    const date = App.DashboardController ? App.DashboardController.getDate() : null;
    const box = document.getElementById('etfOverlapBody');
    const empty = document.getElementById('etfOverlapEmpty');
    const hint = document.getElementById('etfOverlapHint');
    if (!box) return;

    if (!date) { box.innerHTML = ''; if (empty) empty.classList.remove('hidden'); return; }

    const holdings = App.HoldingsService.getHoldings(date);
    const pairs = App.EtfOverlapService.detect(date);

    // 无 ETF 持仓 → 空状态
    const hasEtf = holdings.some(h => {
      const inst = App.InstrumentService.getInstrument(h.name);
      return inst && inst.is_etf;
    });
    if (!hasEtf) {
      box.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      if (hint) hint.classList.add('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    if (pairs.length === 0) {
      box.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">暂无可检测的重叠组合（成分股数据不足）</p>';
    } else {
      box.innerHTML = pairs.map(p => {
        const over = App.EtfOverlapService.isOverThreshold(p);
        const pct = (p.ratio * 100).toFixed(0);
        const overlapText = p.overlap.length ? p.overlap.join('、') : '—';
        return '<tr class="' + (over ? 'bg-amber-50' : '') + '">' +
          '<td class="px-3 py-2 text-slate-700">' + U().escapeHtml(p.a) + '</td>' +
          '<td class="px-3 py-2 text-slate-700">' + U().escapeHtml(p.b) + '</td>' +
          '<td class="px-3 py-2 text-slate-500 text-xs">' + U().escapeHtml(overlapText) + '</td>' +
          '<td class="px-3 py-2 text-right number ' + (over ? 'text-amber-700 font-semibold' : 'text-slate-400') + '">' +
          (over ? '⚠ ' : '') + pct + '%</td>' +
          '</tr>';
      }).join('');
    }

    // 成分股遗漏提示
    const missing = App.EtfOverlapService.missingTop10Count(holdings, App.InstrumentService.getInstruments());
    if (hint) {
      if (missing > 0) {
        hint.textContent = missing + ' 只 ETF 未填成分股，重叠检测可能遗漏';
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
  }

  function init() {
    // 面板折叠
    const header = document.getElementById('etfOverlapHeader');
    const body = document.getElementById('etfOverlapBodyWrap');
    if (header && body) {
      header.addEventListener('click', () => {
        body.classList.toggle('hidden');
        const btn = header.querySelector('.etf-collapse');
        if (btn) btn.textContent = body.classList.contains('hidden') ? '展开 ▾' : '收起 ▴';
      });
    }
  }

  return { init, render };
})();
