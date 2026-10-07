/* ===== 数据模型工厂：规范化字段、默认值 ===== */
window.App = window.App || {};

App.Models = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  /**
   * 由表单输入构造一条规范 Trade（未写库前的对象）
   * 买卖字段互斥补全
   */
  function createTrade(input) {
    const isBuy = C().BUY_ACTIONS.includes(input.action);
    const now = U().nowIso();
    const qty = Number(input.amount);
    const px = Number(input.price);
    // 交易金额：显式传入优先，否则按 数量×价格 推导（保留 2 位小数）
    let tradeAmount;
    if (input.trade_amount === undefined || input.trade_amount === null || input.trade_amount === '') {
      tradeAmount = Math.round(qty * px * 100) / 100;
    } else {
      tradeAmount = Number(input.trade_amount);
    }
    const trade = {
      id: input.id || U().generateId(),
      date: input.date,
      trade_time: input.trade_time ? String(input.trade_time) : '',
      name: String(input.name).trim(),
      action: input.action,
      amount: qty,
      price: px,
      trade_amount: tradeAmount,
      status: input.status || C().TRADE_STATUS.FILLED,
      counterparty: input.counterparty ? String(input.counterparty).trim() : '',

      // 买入字段
      buy_reason: isBuy ? String(input.buy_reason).trim() : null,
      reason_type: isBuy ? input.reason_type : null,
      expected_period: isBuy ? input.expected_period : null,
      invalid_condition: isBuy ? String(input.invalid_condition).trim() : null,
      target_price_low: isBuy ? Number(input.target_price_low) : null,
      target_price_high: isBuy ? Number(input.target_price_high) : null,
      stop_loss: isBuy ? Number(input.stop_loss) : null,

      // 卖出字段
      sell_type: isBuy ? null : (input.sell_type || null),
      sell_note: isBuy ? null : (input.sell_note ? String(input.sell_note).trim() : null),
      linked_buy_ids: isBuy ? [] : (Array.isArray(input.linked_buy_ids) ? input.linked_buy_ids.slice() : []),
      linked_qty_map: isBuy ? {} : (input.linked_qty_map || {}),

      created_at: input.created_at || now,
      updated_at: now
    };
    return trade;
  }

  /** 空复盘对象（v1.2 扩展：water_level / ignored_alerts / attribution_overrides） */
  function createReview(extra) {
    const review = {
      operations: [],
      pnl_attribution: {},          // v1.2 值为归因标签枚举（旧自由文本兼容保留）
      position_in_band: null,       // v1.2 起由 AlertService/ReviewService 写回
      tomorrow_plan: '',
      water_level: null,            // v1.2：{position_pct, band, status, dev_pp, dist_upper, dist_lower} | null
      ignored_alerts: [],           // v1.2：[{dim, name?, threshold, actual, message, ignored_at}]
      ignored_alerts_expired: [],   // v1.2：plan 变更后失效的忽略记录（留痕）
      attribution_overrides: [],    // v1.2：[{name, from, to, at}]
      created_at: U().nowIso(),
      updated_at: U().nowIso()
    };
    return Object.assign(review, extra || {});
  }

  /** v1.2 仓位计划对象（DB.plan 单例） */
  function createPlan(extra) {
    const d = C().PLAN_DEFAULTS;
    const mt = C().MARKET_TEMP_DEFAULTS;
    const plan = {
      total_position_band: d.total_position_band.slice(),
      single_position_max: d.single_position_max,
      single_industry_max: d.single_industry_max,
      cash_min: d.cash_min,
      // v1.2.3：大盘温度配置（维度权重/锚点/特殊区间）
      market_temp: {
        index_code: mt.index_code,
        index_name: mt.index_name,
        index2_code: mt.index2_code,
        lookback_days: mt.lookback_days,
        weights: Object.assign({}, mt.weights),
        index_anchors: mt.index_anchors.map(function (a) { return a.slice(); }),
        index_ma_period: mt.index_ma_period,
        volume_anchors: mt.volume_anchors.map(function (a) { return a.slice(); }),
        volume_ma_short: mt.volume_ma_short,
        volume_ma_long: mt.volume_ma_long,
        status_thresholds: Object.assign({}, mt.status_thresholds),
        special_zones: Object.assign({}, mt.special_zones)
      },
      updated_at: null
    };
    return Object.assign(plan, extra || {});
  }

  /** v1.2.3 单日大盘数据（行情原始值 + 计算指标 + 温度结果） */
  function createMarketData(date, extra) {
    const md = {
      date: date,
      index_code: null,
      index_name: null,
      // 行情原始值
      open: null, high: null, low: null, close: null,
      volume: null, amount: null,
      // 由多日序列聚合的技术指标（写入当日便于展示）
      ma5: null, ma20: null, ma60: null,
      ma200: null,                  // 40 周线（≈200 交易日）
      volume_ma5: null, volume_ma20: null,
      amount_ma5: null,             // 5 日均成交额（沪深合计）
      amount_ma250: null,           // 250 日均成交额（沪深合计）
      // 温度计算结果
      temp_score: null,            // 0-100，null 表示数据不足
      temp_status: null,           // cold/cool/warm/hot
      temp_zone: null,             // freezing/overheat/null（特殊风控区间）
      temp_details: {},            // { dimensionId: score } 各维度得分
      suggested_position: null,    // 建议仓位中枢 = 100 − temp_score（%）
      data_source: null,           // 'sina' | 'manual'
      fetched_at: null
    };
    return Object.assign(md, extra || {});
  }

  /** 快照元数据 */
  function createSnapshotMeta(date, extra) {
    const meta = {
      image_id: 'snap_' + date,
      uploaded_at: U().nowIso(),
      ocr_status: C().OCR_STATUS.SKIPPED,
      ocr_raw: null,
      confirmed: false,
      confirmed_at: null
    };
    return Object.assign(meta, extra || {});
  }

  /** 构造一条 holdings 行（手动录入/OCR 共用） */
  function createHoldingRow(date, name) {
    return {
      date: date,
      name: name || '',
      market_value: null,
      position: null,
      available: null,
      cost: null,
      current_price: null,
      day_pnl: null,
      day_pnl_pct: null,
      floating_pnl: null,
      floating_pnl_pct: null,
      cleared: 0
    };
  }

  /** 空 overview */
  function createOverview(date) {
    return {
      date: date,
      total_assets: null,
      market_value: null,
      floating_pnl: null,
      day_pnl: null,
      day_pnl_pct: null,
      available: null,
      withdrawable: null,
      position_pct: null
    };
  }

  /** v1.3.1 标的主数据（DAQ-4）：以 name 为主键 */
  function createInstrument(input) {
    const inst = {
      name: input && input.name ? String(input.name).trim() : '',
      industry: input && input.industry ? String(input.industry).trim() : '未分类',
      style: (input && input.style && C().STYLE_LIST.indexOf(input.style) >= 0) ? input.style : '成长',
      market: (input && input.market && C().MARKET_LIST.indexOf(input.market) >= 0) ? input.market : '沪',
      is_etf: !!(input && input.is_etf),
      etf_top10: (input && Array.isArray(input.etf_top10)) ? input.etf_top10.slice() : [],
      updated_at: input && input.updated_at ? input.updated_at : U().nowIso()
    };
    return inst;
  }

  return { createTrade, createReview, createPlan, createMarketData, createSnapshotMeta, createHoldingRow, createOverview, createInstrument };
})();
