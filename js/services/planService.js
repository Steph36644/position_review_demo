/* ===== Service：v1.2 P1-1 仓位计划（DAQ-3 读取/校验/保存/默认初始化） ===== */
window.App = window.App || {};

App.PlanService = (function () {
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /** 无 plan 时以默认值写入并落库（PRD 边界：首次启动即有默认计划） */
  function initDefault() {
    const plan = App.Models.createPlan({ updated_at: U().nowIso() });
    db().plan = plan;
    App.LocalStorageRepo.savePlan();
    return plan;
  }

  /** 读取（必然存在：缺失/损坏时以默认值重建） */
  function getPlan() {
    const p = db().plan;
    if (!p || !Array.isArray(p.total_position_band) || p.total_position_band.length !== 2) {
      console.warn('plan 缺失或损坏，已重建默认值');
      return initDefault();
    }
    // v1.2.3：老版本 plan 无 market_temp 字段，补全默认值（不覆盖已有的）
    if (!p.market_temp) {
      const def = App.Models.createPlan().market_temp;
      p.market_temp = def;
      App.LocalStorageRepo.savePlan();
    } else if (!p.market_temp.weights || p.market_temp.weights.index === undefined) {
      // 新口径迁移：旧结构权重为 trend/divergence，整体替换为新默认（该配置弹窗未开放，无用户自定义损失）
      p.market_temp = App.Models.createPlan().market_temp;
      App.LocalStorageRepo.savePlan();
    }
    return p;
  }

  /**
   * 校验（纯函数，弹窗实时校验与 savePlan 共用）
   * total_position_band: 0 ≤ lo < hi ≤ 100 整数
   * single_position_max / single_industry_max: 0 < v ≤ 100 整数
   * cash_min: 0 ≤ v < 100 整数
   */
  function validatePlan(input) {
    const errors = [];
    const isInt = v => v !== '' && v !== null && v !== undefined &&
      Number.isInteger(Number(v)) && !isNaN(Number(v));

    const band = input.total_position_band;
    if (!Array.isArray(band) || band.length !== 2 || !isInt(band[0]) || !isInt(band[1])) {
      errors.push('目标仓位带必须为两个整数（0–100）');
    } else {
      const lo = Number(band[0]), hi = Number(band[1]);
      if (lo < 0 || hi > 100) errors.push('目标仓位带必须在 0–100 之间');
      else if (lo >= hi) errors.push('仓位带下限必须小于上限');
    }

    const spm = Number(input.single_position_max);
    if (!isInt(input.single_position_max) || spm <= 0 || spm > 100) {
      errors.push('单标的占比上限必须为 1–100 的整数');
    }

    const sim = Number(input.single_industry_max);
    if (!isInt(input.single_industry_max) || sim <= 0 || sim > 100) {
      errors.push('单行业占比上限必须为 1–100 的整数');
    }

    const cm = Number(input.cash_min);
    if (!isInt(input.cash_min) || cm < 0 || cm >= 100) {
      errors.push('现金占比下限必须为 0–99 的整数');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  /** 校验 → 落库（updated_at）→ 触发告警重算（忽略记录失效） */
  function savePlan(input) {
    const v = validatePlan(input);
    if (!v.valid) {
      const err = new Error(v.errors[0]);
      err.name = 'ValidationException';
      err.errors = v.errors;
      throw err;
    }
    // v1.2.3：保留已有 market_temp 配置（计划设置弹窗暂未开放该配置，避免重置）
    const existingMt = (db().plan && db().plan.market_temp) || App.Models.createPlan().market_temp;
    const plan = App.Models.createPlan({
      total_position_band: [Number(input.total_position_band[0]), Number(input.total_position_band[1])],
      single_position_max: Number(input.single_position_max),
      single_industry_max: Number(input.single_industry_max),
      cash_min: Number(input.cash_min),
      market_temp: existingMt,
      updated_at: U().nowIso()
    });
    db().plan = plan;
    App.LocalStorageRepo.savePlan();

    // plan 变更 → 告警重算 + 当日忽略记录失效（PRD §3.3.3 忽略失效②）
    if (App.AlertBannerController && typeof App.AlertBannerController.recalc === 'function') {
      App.AlertBannerController.recalc({ invalidateIgnores: true });
    }
    return plan;
  }

  return { initDefault, getPlan, validatePlan, savePlan };
})();
