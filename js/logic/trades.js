/* Pure helpers for the mock trade journal. Snapshots are not rewritten from trades. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    Object.keys(api).forEach(function (k) { root.App[k] = api[k]; });
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var OPEN_ACTIONS = { buy: true, add: true };
  var CLOSE_ACTIONS = { sell: true, reduce: true, clear: true };
  var EFFECTIVE_STATUS = { filled: true, partial: true };

  var ACTION_LABEL = {
    buy: '买入',
    add: '加仓',
    reduce: '减仓',
    sell: '卖出',
    clear: '清仓'
  };

  var STATUS_LABEL = {
    filled: '已成',
    partial: '部成',
    cancelled: '已撤',
    pending: '未成'
  };

  function isOpen(trade) { return !!(trade && OPEN_ACTIONS[trade.action]); }
  function isClose(trade) { return !!(trade && CLOSE_ACTIONS[trade.action]); }
  function isEffective(trade) { return !!(trade && EFFECTIVE_STATUS[trade.status]); }

  function compareTrades(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var ta = a.trade_time || '';
    var tb = b.trade_time || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  }

  function sortTrades(trades) {
    return (trades || []).slice().sort(compareTrades);
  }

  function signedQty(trade) {
    if (!isEffective(trade)) return 0;
    var qty = Number(trade.amount) || 0;
    if (isOpen(trade)) return qty;
    if (isClose(trade)) return -qty;
    return 0;
  }

  function positionFromTrades(trades, name, asOfDate) {
    var qty = 0;
    sortTrades(trades).forEach(function (trade) {
      if (trade.name !== name) return;
      if (asOfDate && trade.date > asOfDate) return;
      qty += signedQty(trade);
    });
    return qty;
  }

  function tradeSymbols(trades) {
    var seen = {};
    var names = [];
    (trades || []).forEach(function (trade) {
      if (!seen[trade.name]) {
        seen[trade.name] = true;
        names.push(trade.name);
      }
    });
    names.sort();
    return names;
  }

  function filterTrades(trades, query) {
    var q = query || {};
    return sortTrades(trades).filter(function (trade) {
      if (q.name && trade.name !== q.name) return false;
      if (q.action && trade.action !== q.action) return false;
      if (q.status && trade.status !== q.status) return false;
      if (q.date && trade.date !== q.date) return false;
      if (q.text) {
        var blob = [trade.buy_reason, trade.sell_note, trade.name, trade.counterparty, trade.sell_type, trade.reason_type]
          .filter(Boolean).join(' ');
        if (blob.indexOf(q.text) === -1) return false;
      }
      return true;
    });
  }

  function tradeStats(trades) {
    var stats = { total: 0, effective: 0, byAction: {}, byStatus: {} };
    (trades || []).forEach(function (trade) {
      stats.total += 1;
      stats.byAction[trade.action] = (stats.byAction[trade.action] || 0) + 1;
      stats.byStatus[trade.status] = (stats.byStatus[trade.status] || 0) + 1;
      if (isEffective(trade)) stats.effective += 1;
    });
    return stats;
  }

  function indexById(trades) {
    var map = {};
    (trades || []).forEach(function (trade) { map[trade.id] = trade; });
    return map;
  }

  function realizedOnSell(trades, sell) {
    if (!isClose(sell) || !isEffective(sell)) return null;
    var qtyMap = sell.linked_qty_map || {};
    var ids = Object.keys(qtyMap);
    if (!ids.length) return null;
    var byId = indexById(trades);
    var pnl = 0;
    var covered = 0;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var qty = Number(qtyMap[id]) || 0;
      var buy = byId[id];
      if (!buy || buy.price == null || sell.price == null) return null;
      pnl += (Number(sell.price) - Number(buy.price)) * qty;
      covered += qty;
    }
    return {
      pnl: Math.round(pnl * 100) / 100,
      covered: covered,
      unlinked: (Number(sell.amount) || 0) - covered
    };
  }

  function journalPositions(trades, asOfDate) {
    return tradeSymbols(trades).map(function (name) {
      return { name: name, qty: positionFromTrades(trades, name, asOfDate) };
    });
  }

  return {
    OPEN_ACTIONS: OPEN_ACTIONS,
    CLOSE_ACTIONS: CLOSE_ACTIONS,
    EFFECTIVE_STATUS: EFFECTIVE_STATUS,
    ACTION_LABEL: ACTION_LABEL,
    STATUS_LABEL: STATUS_LABEL,
    isOpen: isOpen,
    isClose: isClose,
    isEffective: isEffective,
    sortTrades: sortTrades,
    signedQty: signedQty,
    positionFromTrades: positionFromTrades,
    tradeSymbols: tradeSymbols,
    filterTrades: filterTrades,
    tradeStats: tradeStats,
    realizedOnSell: realizedOnSell,
    journalPositions: journalPositions
  };
});
