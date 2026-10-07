/* ===== Service：DAA-1 买卖配对引擎（对账视图 / 违规清单 / 闭环判定） ===== */
window.App = window.App || {};

App.MatchingEngine = (function () {
  const C = () => App.Constants;

  /** 构建单条买入的对账节点 */
  function buildBuyNode(buy, nameTrades) {
    const consumed = App.IndexManager.getConsumed(buy.id);
    const linkedSells = nameTrades
      .filter(t => C().SELL_ACTIONS.includes(t.action))
      .filter(App.IndexManager.isEffectiveTrade)
      .filter(t => (t.linked_buy_ids || []).includes(buy.id))
      .sort((a, b) => a.date.localeCompare(b.date));

    let status;
    if (consumed <= 0) status = C().CLOSURE_STATUS.OPEN;
    else if (consumed >= buy.amount) status = C().CLOSURE_STATUS.CLOSED;
    else status = C().CLOSURE_STATUS.PARTIAL;

    return {
      trade: buy,
      consumed: consumed,
      qty_open: Math.max(0, buy.amount - consumed),
      closure_status: status,
      has_violation: linkedSells.some(s => s.sell_type === C().VIOLATION_TYPE),
      linked_sells: linkedSells
    };
  }

  /**
   * 获取对账视图：按标的分组
   * @param {object} filter dateRange/names/sellTypes/closureStatus
   */
  function getReconciliationView(filter) {
    filter = filter || {};
    const all = App.IndexManager.getAll();

    const byName = new Map();
    all.forEach(t => {
      if (!byName.has(t.name)) byName.set(t.name, []);
      byName.get(t.name).push(t);
    });

    let groups = [];
    byName.forEach((nameTrades, name) => {
      const buys = nameTrades
        .filter(t => C().BUY_ACTIONS.includes(t.action))
        .filter(App.IndexManager.isEffectiveTrade)
        .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
      if (buys.length === 0) return;
      const nodes = buys.map(b => buildBuyNode(b, nameTrades));
      groups.push({ name: name, buys: nodes });
    });

    groups = applyFilters(groups, filter);
    groups.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return groups;
  }

  function applyFilters(groups, filter) {
    let result = groups;

    if (filter.names && filter.names.length > 0) {
      result = result.filter(g => filter.names.includes(g.name));
    }

    if (filter.dateRange && filter.dateRange[0]) {
      const start = filter.dateRange[0];
      const end = filter.dateRange[1] || '9999-12-31';
      result = result.map(g => ({
        name: g.name,
        buys: g.buys.filter(b => b.trade.date >= start && b.trade.date <= end)
      })).filter(g => g.buys.length > 0);
    }

    if (filter.closureStatus && filter.closureStatus.length > 0) {
      result = result.map(g => ({
        name: g.name,
        buys: g.buys.filter(b => filter.closureStatus.includes(b.closure_status))
      })).filter(g => g.buys.length > 0);
    }

    if (filter.sellTypes && filter.sellTypes.length > 0) {
      result = result.map(g => ({
        name: g.name,
        buys: g.buys.filter(b =>
          b.linked_sells.some(s => filter.sellTypes.includes(s.sell_type))
        )
      })).filter(g => g.buys.length > 0);
    }

    return result;
  }

  /** 违规交易清单（sell_type=违规） */
  function getViolations(filter) {
    filter = filter || {};
    let list = App.IndexManager.getAll()
      .filter(t => C().SELL_ACTIONS.includes(t.action))
      .filter(App.IndexManager.isEffectiveTrade)
      .filter(t => t.sell_type === C().VIOLATION_TYPE)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (filter.dateRange && filter.dateRange[0]) {
      const start = filter.dateRange[0];
      const end = filter.dateRange[1] || '9999-12-31';
      list = list.filter(t => t.date >= start && t.date <= end);
    }
    return list;
  }

  return { getReconciliationView, getViolations, buildBuyNode };
})();
