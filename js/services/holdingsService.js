/* ===== Service：DAQ-2 每日 holdings / overview 读写 ===== */
window.App = window.App || {};

App.HoldingsService = (function () {
  function db() { return App.LocalStorageRepo.getDB(); }

  function getHoldings(date) {
    return db().holdings[date] || [];
  }

  function getOverview(date) {
    return db().overview[date] || null;
  }

  function getDates() {
    return App.LocalStorageRepo.getDates();
  }

  /** 保存当日快照（holdings + overview）；v1.2 起触发水位/告警重算 */
  function saveSnapshot(date, holdings, overview) {
    (holdings || []).forEach(h => { h.date = date; });
    db().holdings[date] = holdings || [];
    if (overview) {
      overview.date = date;
      db().overview[date] = overview;
    }
    App.LocalStorageRepo.saveHoldings();
    App.LocalStorageRepo.saveOverview();
    notifyRecalc();
  }

  /** v1.2：数据变更 → 水位/告警统一重算入口（控制器未加载时跳过，如 Node 测试环境） */
  function notifyRecalc() {
    if (App.AlertBannerController && typeof App.AlertBannerController.recalc === 'function') {
      App.AlertBannerController.recalc();
    }
  }

  /** 历史出现过的全部标的名称（OCR 匹配 / datalist 用） */
  function knownNames() {
    const set = new Set();
    Object.keys(db().holdings).forEach(d => {
      (db().holdings[d] || []).forEach(h => { if (h.name) set.add(h.name); });
    });
    return Array.from(set).sort();
  }

  /** 获取某日之前最近一次持仓（异常变动对比用） */
  function getPreviousHoldings(date) {
    const dates = Object.keys(db().holdings).filter(d => d < date).sort();
    if (dates.length === 0) return { date: null, holdings: [] };
    const d = dates[dates.length - 1];
    return { date: d, holdings: db().holdings[d] };
  }

  /* ---------- 数据删除：影响面统计 + 执行 ---------- */

  /** 单日数据影响面（删除预览用） */
  function getDateImpact(date) {
    return {
      holdingsRows: (db().holdings[date] || []).length,
      hasOverview: !!db().overview[date],
      hasReview: !!db().reviews[date],
      hasSnapshot: !!db().snapshots[date],
      tradeCount: App.IndexManager.getByDate(date).length
    };
  }

  /**
   * 删除单日数据：持仓明细 + 账户总览 + 快照元数据；复盘记录可选
   * 交易流水由 TradeService.deleteTradesByIds 单独处理
   */
  function deleteDateData(date, options) {
    options = options || {};
    const impact = getDateImpact(date);
    delete db().holdings[date];
    delete db().overview[date];
    delete db().snapshots[date];
    if (options.includeReview) delete db().reviews[date];
    App.LocalStorageRepo.saveHoldings();
    App.LocalStorageRepo.saveOverview();
    App.LocalStorageRepo.saveSnapshots();
    if (options.includeReview) App.LocalStorageRepo.saveReviews();
    return impact;
  }

  /** 单标的数据影响面（跨全部日期的持仓行） */
  function getNameImpact(name) {
    let rows = 0;
    const dates = [];
    Object.keys(db().holdings).forEach(d => {
      const n = (db().holdings[d] || []).filter(h => h.name === name).length;
      if (n > 0) { rows += n; dates.push(d); }
    });
    return {
      name: name,
      rows: rows,
      dates: dates.sort(),
      tradeCount: App.IndexManager.getByName(name).length
    };
  }

  /** 删除单标的在所有日期快照中的持仓行；清空后自动移除空日期键 */
  function deleteNameData(name) {
    const impact = getNameImpact(name);
    impact.dates.forEach(d => {
      const kept = (db().holdings[d] || []).filter(h => h.name !== name);
      if (kept.length === 0) delete db().holdings[d];
      else db().holdings[d] = kept;
    });
    App.LocalStorageRepo.saveHoldings();
    return impact;
  }

  /** 全部出现过的标的名称（持仓 + 交易流水并集） */
  function allKnownNames() {
    const set = new Set(knownNames());
    App.IndexManager.getAll().forEach(t => { if (t.name) set.add(t.name); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  return {
    getHoldings, getOverview, getDates, saveSnapshot,
    knownNames, getPreviousHoldings,
    getDateImpact, deleteDateData, getNameImpact, deleteNameData, allKnownNames
  };
})();
