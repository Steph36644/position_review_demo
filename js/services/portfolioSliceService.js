/* ===== Service：v1.3.1 DAA-5 行业/风格切片聚合（纯函数，分母恒为总资产） ===== */
window.App = window.App || {};

App.PortfolioSliceService = (function () {

  function db() { return App.LocalStorageRepo.getDB(); }

  function round1(x) { return Math.round(x * 10) / 10; }

  /** 各维度的"未设置"分组名（D2 风格按 PRD §3.3.3 用"未设置风格"） */
  const UNSET_KEY = { industry: '未分类', style: '未设置风格', market: '未知市场' };

  /**
   * 通用分组聚合（PRD §3.2.2 口径，全产品唯一实现）
   * @returns Slice[] | null：[{key, marketValue, pct, items:[]}] 按 pct 降序
   * total_assets 缺失或 ≤0 → null（不判定）
   */
  function groupByWith(holdings, instruments, totalAssets, dimKey) {
    const t = Number(totalAssets);
    if (!totalAssets || isNaN(t) || t <= 0) return null;
    const inst = instruments || {};
    const unset = UNSET_KEY[dimKey] || '未分类';
    const groups = {};
    (holdings || []).filter(h => h && !h.cleared && h.name).forEach(h => {
      const info = inst[h.name];
      const key = (info && info[dimKey]) ? info[dimKey] : unset;
      if (!groups[key]) groups[key] = { key: key, marketValue: 0, items: [] };
      groups[key].marketValue += Number(h.market_value) || 0;
      groups[key].items.push(h.name);
    });
    const slices = Object.keys(groups).map(k => ({
      key: k,
      marketValue: groups[k].marketValue,
      pct: groups[k].marketValue / t * 100,
      items: groups[k].items
    }));
    slices.sort((a, b) => b.pct - a.pct);
    return slices;
  }

  /** 按看板日期从 DB 取数聚合 */
  function groupBy(date, dimKey) {
    const holdings = App.HoldingsService.getHoldings(date);
    const ov = App.HoldingsService.getOverview(date);
    return groupByWith(holdings, db().instruments, ov ? ov.total_assets : null, dimKey);
  }

  /**
   * 勾稽校验：Σ占比 + 现金占比 ≈ 100（正常浮点误差 < 0.1）
   * @returns {sumPct, cashPct, diff}
   */
  function verifyTotals(slices, totalAssets) {
    const t = Number(totalAssets);
    if (!slices || !totalAssets || isNaN(t) || t <= 0) {
      return { sumPct: null, cashPct: null, diff: null };
    }
    const sumMv = slices.reduce((s, x) => s + (Number(x.marketValue) || 0), 0);
    const sumPct = sumMv / t * 100;
    const cashPct = (t - sumMv) / t * 100;
    return {
      sumPct: round1(sumPct),
      cashPct: round1(cashPct),
      diff: Math.abs(sumPct + cashPct - 100)
    };
  }

  return { groupByWith, groupBy, verifyTotals };
})();
