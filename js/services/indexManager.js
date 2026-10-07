/* ===== 内存索引管理器：加速 trades 查询与 qty_open 计算 ===== */
window.App = window.App || {};

App.IndexManager = (function () {
  const C = () => App.Constants;

  const indexById = new Map();
  const indexByDate = new Map();
  const indexByName = new Map();
  // 每条买入已被卖出消耗的数量（增量维护）
  const consumedQtyById = new Map();

  /** 是否为已生效成交（filled/partial；无 status 字段的历史数据视为已成交） */
  function isEffectiveTrade(t) {
    return !t.status || C().EFFECTIVE_TRADE_STATUSES.includes(t.status);
  }

  function addToMapList(map, key, val) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(val);
  }

  function removeFromMapList(map, key, val) {
    const list = map.get(key);
    if (!list) return;
    const i = list.indexOf(val);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) map.delete(key);
  }

  /** 全量重建（启动 / 迁移后） */
  function rebuild(trades) {
    indexById.clear();
    indexByDate.clear();
    indexByName.clear();
    consumedQtyById.clear();
    (trades || []).forEach(t => {
      indexById.set(t.id, t);
      addToMapList(indexByDate, t.date, t);
      addToMapList(indexByName, t.name, t);
    });
    // 全量重算消耗（仅已成交卖出计入）
    (trades || []).forEach(sell => {
      if (!C().SELL_ACTIONS.includes(sell.action) || !isEffectiveTrade(sell)) return;
      if (sell.linked_qty_map) {
        Object.keys(sell.linked_qty_map).forEach(buyId => {
          const qty = Number(sell.linked_qty_map[buyId]) || 0;
          consumedQtyById.set(buyId, (consumedQtyById.get(buyId) || 0) + qty);
        });
      }
    });
  }

  /** 增量应用一条卖出的消耗（sign=1 写入 / -1 摘除） */
  function applyConsumption(linkedQtyMap, sign) {
    if (!linkedQtyMap) return;
    Object.keys(linkedQtyMap).forEach(buyId => {
      const q = Number(linkedQtyMap[buyId]) || 0;
      consumedQtyById.set(buyId, (consumedQtyById.get(buyId) || 0) + sign * q);
    });
  }

  function add(trade) {
    indexById.set(trade.id, trade);
    addToMapList(indexByDate, trade.date, trade);
    addToMapList(indexByName, trade.name, trade);
    if (C().BUY_ACTIONS.includes(trade.action)) {
      if (!consumedQtyById.has(trade.id)) consumedQtyById.set(trade.id, 0);
    } else if (C().SELL_ACTIONS.includes(trade.action) && isEffectiveTrade(trade)) {
      applyConsumption(trade.linked_qty_map, 1);
    }
  }

  function remove(trade) {
    indexById.delete(trade.id);
    removeFromMapList(indexByDate, trade.date, trade);
    removeFromMapList(indexByName, trade.name, trade);
    if (C().SELL_ACTIONS.includes(trade.action) && isEffectiveTrade(trade)) {
      applyConsumption(trade.linked_qty_map, -1);
    }
    consumedQtyById.delete(trade.id);
  }

  /** 删除/修改卖出后，重算该卖出涉及买入的消耗（安全兜底；仅已成交卖出） */
  function recalcConsumedFor(buyIds, allSells) {
    buyIds.forEach(buyId => {
      let consumed = 0;
      allSells.forEach(sell => {
        if (!isEffectiveTrade(sell)) return;
        if (sell.linked_qty_map && sell.linked_qty_map[buyId]) {
          consumed += Number(sell.linked_qty_map[buyId]) || 0;
        }
      });
      consumedQtyById.set(buyId, consumed);
    });
  }

  function getById(id) { return indexById.get(id) || null; }
  function getByName(name) { return indexByName.get(name) || []; }
  function getByDate(date) { return indexByDate.get(date) || []; }
  function getAll() { return Array.from(indexById.values()); }
  function getConsumed(buyId) { return consumedQtyById.get(buyId) || 0; }

  /** 某标的未平仓买入（qty_open > 0；未成交/已撤单不计入） */
  function getOpenBuys(name) {
    return (indexByName.get(name) || [])
      .filter(t => C().BUY_ACTIONS.includes(t.action))
      .filter(isEffectiveTrade)
      .filter(t => {
        const open = t.amount - getConsumed(t.id);
        return open > 0;
      });
  }

  return {
    rebuild, add, remove, recalcConsumedFor, isEffectiveTrade,
    getById, getByName, getByDate, getAll, getConsumed, getOpenBuys
  };
})();
