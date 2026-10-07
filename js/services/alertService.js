/* ===== Service：v1.2 DAA-2 水位 + DAA-3 三维度告警（纯函数，维度注册表可插拔） ===== */
window.App = window.App || {};

App.AlertService = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /** dev_pp 统一 1 位小数 */
  function round1(x) { return Math.round(x * 10) / 10; }

  /**
   * 占比统一口径（PRD §3.1.2，全产品唯一实现）：
   * 分母恒为总资产；total_assets 缺失或 ≤0 时返回 null（不判定）
   */
  function safePct(numerator, totalAssets) {
    const t = Number(totalAssets);
    if (!totalAssets || isNaN(t) || t <= 0) return null;
    const n = Number(numerator);
    if (n === null || n === undefined || isNaN(n)) return null;
    return n / t * 100;
  }

  /**
   * DAA-2 水位计算（v1.2.3：以建议仓位中枢为基准）
   * - 若传入 suggestedCenter（来自大盘温度），则以其为基准中心，
   *   用用户仓位带宽度（hi-lo）作对称容差，得到有效带 [center - w/2, center + w/2]
   * - 若未传建议中枢，回退到用户原始仓位带 [lo, hi]
   * WaterLevel = {
   *   position_pct, center, band:[effectiveLo,effectiveHi], original_band:[lo,hi],
   *   status:'in'|'above'|'below', dev_pp, dist_upper, dist_lower, center_dev_pp
   * }
   * 边界：pct 恰等于边界 → in（闭区间）；dev_pp 带符号 1 位小数
   */
  function calcWaterLevel(overview, plan, suggestedCenter) {
    if (!overview || !plan || !Array.isArray(plan.total_position_band)) return null;
    const pct = safePct(overview.market_value, overview.total_assets);
    if (pct === null) return null;
    const lo = plan.total_position_band[0], hi = plan.total_position_band[1];
    const width = hi - lo;

    // 基准中心：优先用大盘温度建议中枢，否则用用户带中点
    let center = null;
    if (suggestedCenter !== null && suggestedCenter !== undefined && !isNaN(Number(suggestedCenter))) {
      center = Number(suggestedCenter);
    }
    const hasCenter = center !== null;
    const effLo = hasCenter ? Math.max(0, center - width / 2) : lo;
    const effHi = hasCenter ? Math.min(100, center + width / 2) : hi;

    let status, dev_pp;
    if (pct > effHi) {
      status = C().WATER_STATUS.ABOVE; dev_pp = round1(pct - effHi);
    } else if (pct < effLo) {
      status = C().WATER_STATUS.BELOW; dev_pp = round1(pct - effLo);
    } else {
      status = C().WATER_STATUS.IN; dev_pp = round1(Math.min(effHi - pct, pct - effLo));
    }
    return {
      position_pct: round1(pct),
      center: hasCenter ? round1(center) : null,
      band: [round1(effLo), round1(effHi)],
      original_band: [lo, hi],
      status: status,
      dev_pp: dev_pp,
      dist_upper: round1(effHi - pct),
      dist_lower: round1(pct - effLo),
      center_dev_pp: hasCenter ? round1(pct - center) : null
    };
  }

  /* ---------- DAA-3 维度判定器注册表（v1.3 追加 industry/style 即可） ---------- */
  const DIM_EVALUATORS = {
    /** 总仓位水位带（v1.2.3：以建议仓位中枢为基准） */
    position: function (ctx) {
      const w = ctx.water;
      if (!w) return [];
      if (w.status === C().WATER_STATUS.ABOVE) {
        const base = w.center !== null
          ? ('建议中枢 ' + w.center + '%，高于上限 ' + w.band[1] + '%')
          : ('超出目标带上限 ' + w.band[1] + '%');
        return [{
          dim: C().ALERT_DIMS.POSITION,
          threshold: w.band[1], actual: w.position_pct, dev_pp: w.dev_pp,
          message: '总仓位 ' + w.position_pct.toFixed(1) + '%，' + base + '（+' + w.dev_pp.toFixed(1) + 'pp）',
          target: { type: 'water' }
        }];
      }
      if (w.status === C().WATER_STATUS.BELOW) {
        const base = w.center !== null
          ? ('建议中枢 ' + w.center + '%，低于下限 ' + w.band[0] + '%')
          : ('低于目标带下限 ' + w.band[0] + '%');
        return [{
          dim: C().ALERT_DIMS.POSITION,
          threshold: w.band[0], actual: w.position_pct, dev_pp: w.dev_pp,
          message: '总仓位 ' + w.position_pct.toFixed(1) + '%，' + base + '（' + w.dev_pp.toFixed(1) + 'pp）',
          target: { type: 'water' }
        }];
      }
      return [];
    },
    /** 单标的占比（仅未清仓；同维度多标的逐项列出，降序） */
    single: function (ctx) {
      const total = ctx.overview ? Number(ctx.overview.total_assets) : NaN;
      if (!total || isNaN(total) || total <= 0) return [];
      const max = ctx.plan.single_position_max;
      const items = [];
      (ctx.holdings || []).filter(h => !h.cleared).forEach(h => {
        const pct = safePct(h.market_value, total);
        if (pct === null || pct <= max) return;
        items.push({
          dim: C().ALERT_DIMS.SINGLE,
          name: h.name,
          threshold: max, actual: round1(pct), dev_pp: round1(pct - max),
          message: h.name + ' 占比 ' + round1(pct).toFixed(1) + '%，超过单标的上限 ' + max + '%',
          target: { type: 'holding', anchor: h.name }
        });
      });
      items.sort((a, b) => b.actual - a.actual);
      return items;
    },
    /** 现金占比下限（cash_pct == cash_min 不告警，闭区间） */
    cash: function (ctx) {
      const total = ctx.overview ? Number(ctx.overview.total_assets) : NaN;
      if (!total || isNaN(total) || total <= 0) return [];
      const mv = ctx.overview.market_value;
      if (mv === null || mv === undefined || isNaN(Number(mv))) return [];
      const cashPct = (total - Number(mv)) / total * 100;
      const min = ctx.plan.cash_min;
      if (cashPct >= min) return [];
      return [{
        dim: C().ALERT_DIMS.CASH,
        threshold: min, actual: round1(cashPct), dev_pp: round1(min - cashPct),
        message: '现金占比 ' + round1(cashPct).toFixed(1) + '%，低于下限 ' + min + '%',
        target: { type: 'water' }
      }];
    },
    /** v1.3.1 DAA-3 行业维度告警：单行业占比 > single_industry_max 触发（闭区间，恰等于不告警） */
    industry: function (ctx) {
      const total = ctx.overview ? Number(ctx.overview.total_assets) : NaN;
      if (!total || isNaN(total) || total <= 0) return [];
      const max = ctx.plan.single_industry_max;
      // 优先用传入的切片（What-If 场景），否则按 holdings+instruments 计算
      let slices = ctx.slices;
      if (!slices && App.PortfolioSliceService) {
        slices = App.PortfolioSliceService.groupByWith(
          ctx.holdings, ctx.instruments, ctx.overview.total_assets, 'industry');
      }
      if (!slices) return [];
      return slices
        .filter(s => s.pct > max)
        .map(s => ({
          dim: C().ALERT_DIMS.INDUSTRY,
          name: s.key,
          threshold: max, actual: round1(s.pct), dev_pp: round1(s.pct - max),
          message: s.key + ' 占比 ' + round1(s.pct).toFixed(1) + '%，超过单行业上限 ' + max + '%',
          target: { type: 'slice', anchor: 'industry', value: s.key }
        }));
    }
  };

  /** 内部：基于 ctx 执行所有维度评估器 */
  function runEvaluators(ctx) {
    let alerts = [];
    Object.keys(DIM_EVALUATORS).forEach(dim => {
      alerts = alerts.concat(DIM_EVALUATORS[dim](ctx));
    });
    return alerts;
  }

  /**
   * 三维度告警判定（同时返回水位，供卡片与复盘写回一次取值）
   * @returns {{water: WaterLevel|null, alerts: AlertItem[]}}
   * AlertItem = {dim, name?, threshold, actual, dev_pp?, message, target}
   */
  function evaluateAlerts(date) {
    const plan = App.PlanService.getPlan();
    const overview = App.HoldingsService.getOverview(date);
    const holdings = App.HoldingsService.getHoldings(date);
    // v1.2.3：水位以大盘温度建议仓位中枢为基准
    const md = App.MarketDataService.getMarketData(date);
    const suggestedCenter = md && md.suggested_position !== null ? md.suggested_position : null;
    const water = calcWaterLevel(overview, plan, suggestedCenter);
    const instruments = App.InstrumentService ? App.InstrumentService.getInstruments() : {};
    const ctx = { overview: overview, holdings: holdings, plan: plan, water: water, instruments: instruments };
    return { water: water, alerts: runEvaluators(ctx) };
  }

  /**
   * v1.3.1 What-If 重载：接受传入的 overview/holdings/plan（深拷贝副本），不从 DB 取
   * @returns {{water: WaterLevel|null, alerts: AlertItem[]}}
   */
  function evaluateAlertsWith(overview, holdings, plan, suggestedCenter) {
    const water = calcWaterLevel(overview, plan, suggestedCenter);
    const instruments = App.InstrumentService ? App.InstrumentService.getInstruments() : {};
    const ctx = { overview: overview, holdings: holdings, plan: plan, water: water, instruments: instruments };
    return { water: water, alerts: runEvaluators(ctx) };
  }

  /** 忽略键 = dim + name */
  function keyOf(item) { return item.dim + ':' + (item.name || ''); }

  /** 忽略过滤：review.ignored_alerts 中的项（按 dim+name）不再展示 */
  function filterIgnored(alerts, review) {
    const ignored = (review && Array.isArray(review.ignored_alerts)) ? review.ignored_alerts : [];
    const keys = new Set(ignored.map(keyOf));
    return alerts.filter(a => !keys.has(keyOf(a)));
  }

  /** 忽略（写留痕，幂等：同 dim+name 已存在则跳过） */
  function ignoreAlert(date, item) {
    const review = db().reviews[date];
    if (!review) db().reviews[date] = App.Models.createReview({});
    const r = db().reviews[date];
    if (!Array.isArray(r.ignored_alerts)) r.ignored_alerts = [];
    const key = keyOf(item);
    if (r.ignored_alerts.some(a => keyOf(a) === key)) return false;
    r.ignored_alerts.push({
      dim: item.dim,
      name: item.name || null,
      threshold: item.threshold,
      actual: item.actual,
      message: item.message,
      ignored_at: U().nowIso()
    });
    App.LocalStorageRepo.saveReviews();
    return true;
  }

  return { calcWaterLevel, evaluateAlerts, evaluateAlertsWith, filterIgnored, ignoreAlert, safePct };
})();
