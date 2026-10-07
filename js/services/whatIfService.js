/* ===== Service：v1.3.1 DAA-7 What-If 交易预演（深拷贝模拟，不落库铁律） ===== */
window.App = window.App || {};

App.WhatIfService = (function () {
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /** 校验拟交易（卖出/减仓须校验持仓数量上限） */
  function validateTrade(date, trade) {
    const errors = [];
    const t = trade || {};
    if (!t.name || !String(t.name).trim()) errors.push('标的名称必填');
    if (['buy', 'add', 'sell', 'reduce'].indexOf(t.action) < 0) errors.push('方向必须是 买入/加仓/卖出/减仓');
    const amount = Number(t.amount);
    if (!U().isPosInt(amount)) errors.push('数量必须是正整数');
    if (!U().isPosNum(t.price)) errors.push('价格必须是正数');
    const holdings = App.HoldingsService.getHoldings(date);
    const idx = holdings.findIndex(h => h.name === t.name && !h.cleared);
    if (t.action === 'sell' || t.action === 'reduce') {
      if (idx < 0) {
        errors.push('当前持仓中不存在「' + t.name + '」，无法卖出');
      } else {
        const pos = Number(holdings[idx].position);
        if (isNaN(pos) || pos <= 0) errors.push('该标的无可卖数量');
        else if (U().isPosInt(amount) && pos < amount) {
          errors.push('卖出数量超过持仓 ' + U().fmt(pos, 0) + ' 股');
        }
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  /** 在副本上应用单笔交易（纯函数：加仓加权平均成本；卖出≤0 视为清仓） */
  function applyTrade(holdings, overview, trade) {
    const idx = holdings.findIndex(h => h.name === trade.name);
    if (trade.action === 'buy' || trade.action === 'add') {
      if (idx >= 0) {
        const h = holdings[idx];
        const pos = Number(h.position) || 0;
        if (pos > 0) {
          const totalCost = (Number(h.cost) || 0) * pos + Number(trade.price) * Number(trade.amount);
          h.position = pos + Number(trade.amount);
          h.cost = totalCost / h.position;
        } else {
          h.position = Number(trade.amount);
          h.cost = Number(trade.price);
        }
        h.current_price = Number(trade.price);
        h.cleared = 0;
        h.market_value = h.position * h.current_price;
      } else {
        holdings.push({
          date: overview.date, name: trade.name,
          position: Number(trade.amount), available: Number(trade.amount),
          cost: Number(trade.price), current_price: Number(trade.price),
          market_value: Number(trade.amount) * Number(trade.price),
          day_pnl: 0, day_pnl_pct: 0, floating_pnl: 0, floating_pnl_pct: 0,
          cleared: 0
        });
      }
    } else {
      if (idx < 0) return { error: '持仓不存在' };
      const h = holdings[idx];
      h.position = Number(h.position) - Number(trade.amount);
      if (h.position <= 0) {
        h.position = 0; h.cleared = 1; h.market_value = 0;
      } else {
        h.market_value = h.position * Number(h.current_price);
      }
    }
    overview.market_value = holdings.reduce((s, h) => s + (h.cleared ? 0 : (Number(h.market_value) || 0)), 0);
    return { ok: true };
  }

  /**
   * 模拟单笔交易后的组合状态（全程操作深拷贝，禁止触碰 db().xxx = 与 saveXxx）
   * @returns {water, alerts, slices, simOverview, simHoldings} | null
   */
  function simulate(date, trade) {
    if (!validateTrade(date, trade).valid) return null;
    const ov = App.HoldingsService.getOverview(date);
    if (!ov || !ov.total_assets || Number(ov.total_assets) <= 0) return null;

    const simHoldings = JSON.parse(JSON.stringify(App.HoldingsService.getHoldings(date)));
    const simOverview = JSON.parse(JSON.stringify(ov));
    const r = applyTrade(simHoldings, simOverview, trade);
    if (r.error) return null;

    const plan = App.PlanService.getPlan();
    const md = App.MarketDataService.getMarketData(date);
    const suggestedCenter = md && md.suggested_position !== null ? md.suggested_position : null;
    const res = App.AlertService.evaluateAlertsWith(simOverview, simHoldings, plan, suggestedCenter);
    const slices = App.PortfolioSliceService.groupByWith(
      simHoldings, db().instruments, simOverview.total_assets, 'industry');
    return {
      water: res.water,
      alerts: res.alerts,
      slices: slices,
      simOverview: simOverview,
      simHoldings: simHoldings
    };
  }

  return { validateTrade, applyTrade, simulate };
})();
