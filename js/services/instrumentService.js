/* ===== Service：v1.3.1 DAQ-4 标的主数据（instruments CRUD，单源） ===== */
window.App = window.App || {};

App.InstrumentService = (function () {
  const U = () => App.Utils;
  const C = () => App.Constants;

  function db() { return App.LocalStorageRepo.getDB(); }

  function getInstruments() { return db().instruments || {}; }

  function getInstrument(name) {
    return getInstruments()[name] || null;
  }

  /** 全部出现过的标的名称（持仓 + 交易流水并集，主数据下拉唯一来源） */
  function getAllHoldingNames() {
    return App.HoldingsService.allKnownNames();
  }

  /**
   * 校验（纯函数）：industry/style/market 必填；style/market 限定枚举；
   * etf_top10 仅 is_etf=true 有意义且 ≤10；非 ETF 不得填成分股
   */
  function validateInstrument(input) {
    const errors = [];
    if (!input.name || !String(input.name).trim()) errors.push('标的名称不能为空');
    if (!input.industry || !String(input.industry).trim()) errors.push('行业分类必填');
    if (!input.style) errors.push('风格标签必填');
    else if (C().STYLE_LIST.indexOf(input.style) < 0) errors.push('风格标签必须是：' + C().STYLE_LIST.join('/'));
    if (!input.market) errors.push('所属市场必填');
    else if (C().MARKET_LIST.indexOf(input.market) < 0) errors.push('所属市场必须是：' + C().MARKET_LIST.join('/'));
    const top10 = Array.isArray(input.etf_top10) ? input.etf_top10 : [];
    if (input.is_etf && top10.length > 10) errors.push('前十大成分股最多 10 只');
    if (!input.is_etf && top10.length > 0) errors.push('非 ETF 标的不需要填成分股');
    return { valid: errors.length === 0, errors: errors };
  }

  /** 校验 → 规范化 → 落库；name 必须存在于持仓/交易 name 集合（PRD §5.3 铁律 6） */
  function saveInstrument(input) {
    const name = String(input.name || '').trim();
    if (getAllHoldingNames().indexOf(name) < 0) {
      const err = new Error('标的「' + name + '」不在持仓/交易记录中，请先录入交易或持仓');
      err.name = 'ValidationException';
      throw err;
    }
    const norm = App.Models.createInstrument({
      name: name,
      industry: String(input.industry || '').trim(),
      style: input.style,
      market: input.market,
      is_etf: !!input.is_etf,
      etf_top10: Array.isArray(input.etf_top10)
        ? input.etf_top10.map(s => String(s).trim()).filter(Boolean) : [],
      updated_at: U().nowIso()
    });
    const res = validateInstrument(norm);
    if (!res.valid) {
      const err = new Error(res.errors[0]);
      err.name = 'ValidationException';
      err.errors = res.errors;
      throw err;
    }
    db().instruments[name] = norm;
    App.LocalStorageRepo.saveInstruments();
    notifyRecalc();
    return norm;
  }

  function deleteInstrument(name) {
    if (db().instruments && db().instruments[name]) {
      delete db().instruments[name];
      App.LocalStorageRepo.saveInstruments();
      notifyRecalc();
    }
  }

  /** 主数据变更 → 切片/重叠/行业告警即时重算（控制器未加载时跳过，如 Node 测试环境） */
  function notifyRecalc() {
    if (App.AlertBannerController && typeof App.AlertBannerController.recalc === 'function') {
      App.AlertBannerController.recalc();
    }
    if (App.DashboardController && typeof App.DashboardController.renderSlices === 'function') {
      App.DashboardController.renderSlices();
    }
    if (App.DashboardController && typeof App.DashboardController.renderInstrumentBadges === 'function') {
      App.DashboardController.renderInstrumentBadges();
    }
    if (App.EtfOverlapController && typeof App.EtfOverlapController.render === 'function') {
      App.EtfOverlapController.render();
    }
  }

  return { getInstruments, getInstrument, getAllHoldingNames, validateInstrument, saveInstrument, deleteInstrument };
})();
