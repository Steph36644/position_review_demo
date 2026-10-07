/* ===== Service：S1 结构化复盘（一键填入 / 保存 / 读取） ===== */
window.App = window.App || {};

App.ReviewService = (function () {
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /**
   * 一键填入快照：
   * operations 聚合当日 trades；v1.2 起 position_in_band/water_level 由水位计算写入，
   * pnl_attribution = 已覆盖值 ∪ DAA-4 默认初值（一键填入视为确认初值，PRD S2-6，不重置覆盖）；
   * tomorrow_plan 带入上次复盘的明日计划
   */
  function fillTodaySnapshot(date) {
    const existing = db().reviews[date] || null;
    // 仅已成交（含部分成交）记录进入当日操作汇总，未成交/已撤单不计
    const trades = App.TradeService.getTradesByDate(date)
      .filter(App.IndexManager.isEffectiveTrade);

    const operations = trades.map(t => ({
      name: t.name,
      action: t.action,
      reason_type: t.reason_type,
      amount: t.amount,
      price: t.price
    }));

    // 上一交易日复盘的明日计划（便于追踪）
    const prevDates = Object.keys(db().reviews).filter(d => d < date).sort();
    const prevDate = prevDates.length ? prevDates[prevDates.length - 1] : null;
    const prevPlan = prevDate ? (db().reviews[prevDate].tomorrow_plan || '') : '';

    // v1.2：水位状态（按当日快照与当前 plan）；v1.3.1 修复：与看板口径一致，以大盘温度建议中枢为基准
    const md = App.MarketDataService.getMarketData(date);
    const suggestedCenter = md && md.suggested_position !== null ? md.suggested_position : null;
    const wl = App.AlertService.calcWaterLevel(
      App.HoldingsService.getOverview(date), App.PlanService.getPlan(), suggestedCenter);

    // v1.2：归因 = 已覆盖值 ∪ 默认初值（已确认值不重置）
    const mergedAttr = Object.assign({},
      (existing && existing.pnl_attribution) || {});
    App.AttributionService.getTagsForDate(date).forEach((info, name) => {
      if (mergedAttr[name] === undefined) mergedAttr[name] = info.tag;
    });

    const draft = App.Models.createReview({
      operations: operations,
      pnl_attribution: mergedAttr,
      position_in_band: wl ? (wl.status === 'in') : null,
      water_level: wl,
      // 当日已有计划则保留，否则带入上次计划
      tomorrow_plan: (existing && existing.tomorrow_plan) || prevPlan || '',
      created_at: existing ? existing.created_at : undefined
    });

    return draft;
  }

  /**
   * v1.2：水位写回（由 AlertBannerController.recalc 统一调用）
   * 只触碰 position_in_band / water_level 两字段，不动 ignored/attribution 等留痕
   */
  function syncWaterLevel(date, wl) {
    const review = db().reviews[date];
    if (!review) {
      if (!wl) return;   // 无复盘且无水位：不创建空记录
      db().reviews[date] = App.Models.createReview({
        position_in_band: wl.status === 'in',
        water_level: wl
      });
    } else {
      review.position_in_band = wl ? (wl.status === 'in') : null;
      review.water_level = wl || null;
    }
    App.LocalStorageRepo.saveReviews();
  }

  function saveReview(date, review) {
    const now = U().nowIso();
    review.updated_at = now;
    if (!review.created_at) review.created_at = now;
    db().reviews[date] = review;
    App.LocalStorageRepo.saveReviews();
  }

  function getReview(date) {
    return db().reviews[date] || null;
  }

  return { fillTodaySnapshot, saveReview, getReview, syncWaterLevel };
})();
