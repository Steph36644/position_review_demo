/* ===== v1.2.3 Service：大盘温度计算（可插拔维度 Registry + 加权接口） ===== */
/* 新口径：总温度 = 指数位置 50% + 量能 50%，锚点间线性插值，0 封底 100 封顶
 * - 指数位置：沪指收盘对 40 周线（≈MA200 交易日）乖离率，-15%→0 / 0%→50 / +15%→100
 * - 量能：5 日均成交额 ÷ 250 日均成交额（沪深两市合计），0.5→0 / 1.0→50 / 1.5→100
 * - 核心公式：建议仓位中枢 = 100 − 温度（每日收盘后计算，次日生效）
 * - 特殊区间：>80 过热（只卖不买） / <20 极寒（可打满 90%+）
 */
window.App = window.App || {};

App.MarketTempService = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  /**
   * 维度注册表：{ id: { name, fn } }
   * fn(series, date) => number (0-100)，返回 null 表示该维度数据不足
   * series：按日期升序的行情数组 [{date, open, high, low, close, volume, amount}, ...]
   * amount 为沪深两市合计成交额（元）；深市缺失时为 null
   */
  const dimensions = {};

  function registerDimension(id, name, fn) {
    dimensions[id] = { name: name, fn: fn };
  }

  function unregisterDimension(id) { delete dimensions[id]; }

  function listDimensions() {
    return Object.keys(dimensions).map(function (id) {
      return { id: id, name: dimensions[id].name };
    });
  }

  /* ---------- 辅助：取某日在序列中的索引 ---------- */
  function indexOfDate(series, date) {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].date === date) return i;
    }
    return -1;
  }

  /* ---------- 辅助：简单移动平均（窗口内必须全部为有效数值，否则 null） ---------- */
  function sma(values, period) {
    if (values.length < period) return null;
    const slice = values.slice(values.length - period);
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      const v = Number(slice[i]);
      if (slice[i] === null || slice[i] === undefined || isNaN(v) || v === 0) return null;
      sum += v;
    }
    return sum / period;
  }

  /**
   * 锚点间分段线性插值；超出首尾锚点时封底/封顶
   * @param {number} x 输入值
   * @param {Array<[number, number]>} anchors 升序锚点 [[x0,y0],[x1,y1],...]
   */
  function interp(x, anchors) {
    if (x === null || x === undefined || isNaN(Number(x))) return null;
    x = Number(x);
    if (x <= anchors[0][0]) return anchors[0][1];
    if (x >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
    for (let i = 1; i < anchors.length; i++) {
      if (x <= anchors[i][0]) {
        const x0 = anchors[i - 1][0], y0 = anchors[i - 1][1];
        const x1 = anchors[i][0], y1 = anchors[i][1];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return anchors[anchors.length - 1][1];
  }

  function clamp01(v) {
    return Math.max(0, Math.min(100, v));
  }

  /* ---------- 默认维度 1：指数位置（收盘对 40 周线乖离率） ---------- */
  function indexDimension(series, date) {
    const cfg = C().MARKET_TEMP_DEFAULTS;
    const period = cfg.index_ma_period;
    const idx = indexOfDate(series, date);
    if (idx < 0) return null;
    const closes = series.slice(0, idx + 1).map(function (r) { return r.close; });
    const ma = sma(closes, period);
    if (ma === null) return null;
    const close = closes[closes.length - 1];
    if (close === null || close === undefined || isNaN(Number(close))) return null;
    // 乖离率(%) = (收盘 − MA200) / MA200 × 100
    const biasPct = (close - ma) / ma * 100;
    return Math.round(clamp01(interp(biasPct, cfg.index_anchors)));
  }

  /* ---------- 默认维度 2：量能（5 日均成交额 ÷ 250 日均成交额，沪深合计） ---------- */
  function volumeDimension(series, date) {
    const cfg = C().MARKET_TEMP_DEFAULTS;
    const idx = indexOfDate(series, date);
    if (idx < 0) return null;
    const amounts = series.slice(0, idx + 1).map(function (r) { return r.amount; });
    const maShort = sma(amounts, cfg.volume_ma_short);
    const maLong = sma(amounts, cfg.volume_ma_long);
    if (maShort === null || maLong === null) return null;
    const ratio = maShort / maLong;
    return Math.round(clamp01(interp(ratio, cfg.volume_anchors)));
  }

  // 注册默认维度（后续可增删）
  registerDimension('index', '指数位置', indexDimension);
  registerDimension('volume', '量能', volumeDimension);

  /* ---------- 核心：按 weights 加权计算温度 ---------- */
  function calcTemperature(series, date, plan) {
    const cfg = C().MARKET_TEMP_DEFAULTS;
    const weights = (plan && plan.market_temp && plan.market_temp.weights) || cfg.weights;
    const thresholds = (plan && plan.market_temp && plan.market_temp.status_thresholds) || cfg.status_thresholds;
    const zones = (plan && plan.market_temp && plan.market_temp.special_zones) || cfg.special_zones;

    const details = {};
    let weightedSum = 0;
    let totalWeight = 0;
    Object.keys(dimensions).forEach(function (id) {
      const w = weights[id];
      if (w === undefined || w === null) return;
      const score = dimensions[id].fn(series, date);
      details[id] = score;
      if (score !== null) {
        weightedSum += score * w;
        totalWeight += w;
      }
    });

    const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;

    let status = null;
    let zone = null;
    let suggestedPosition = null;
    if (finalScore !== null) {
      if (finalScore < thresholds.cold) status = 'cold';
      else if (finalScore < thresholds.cool) status = 'cool';
      else if (finalScore < thresholds.warm) status = 'warm';
      else status = 'hot';

      // 特殊风控区间（严格不等号：>80 过热，<20 极寒）
      if (finalScore > zones.overheat) zone = C().MARKET_TEMP_ZONE.OVERHEAT;
      else if (finalScore < zones.freezing) zone = C().MARKET_TEMP_ZONE.FREEZING;

      // 核心公式：建议仓位中枢 = 100 − 温度
      suggestedPosition = 100 - finalScore;
    }

    return {
      score: finalScore,
      status: status,
      zone: zone,
      details: details,
      suggested_position: suggestedPosition
    };
  }

  /* ---------- 由多日序列生成单日 market_data（含指标 + 温度） ---------- */
  function buildMarketData(series, date, plan, source) {
    const md = App.Models.createMarketData(date);
    const cfg = C().MARKET_TEMP_DEFAULTS;
    const idx = indexOfDate(series, date);
    if (idx < 0) return md;

    const row = series[idx];
    md.index_code = row.index_code || (plan.market_temp && plan.market_temp.index_code);
    md.index_name = row.index_name || (plan.market_temp && plan.market_temp.index_name);
    md.open = row.open; md.high = row.high; md.low = row.low; md.close = row.close;
    md.volume = row.volume; md.amount = (row.amount === undefined ? null : row.amount);

    const closes = series.slice(0, idx + 1).map(function (r) { return r.close; });
    const vols = series.slice(0, idx + 1).map(function (r) { return r.volume; });
    const amounts = series.slice(0, idx + 1).map(function (r) { return r.amount; });
    md.ma5 = sma(closes, 5);
    md.ma20 = sma(closes, 20);
    md.ma60 = sma(closes, 60);
    md.ma200 = sma(closes, cfg.index_ma_period);
    md.volume_ma5 = sma(vols, 5);
    md.volume_ma20 = sma(vols, 20);
    md.amount_ma5 = sma(amounts, cfg.volume_ma_short);
    md.amount_ma250 = sma(amounts, cfg.volume_ma_long);

    const temp = calcTemperature(series, date, plan);
    md.temp_score = temp.score;
    md.temp_status = temp.status;
    md.temp_zone = temp.zone;
    md.temp_details = temp.details;
    md.suggested_position = temp.suggested_position;
    md.data_source = source || 'sina';
    md.fetched_at = U().nowIso();
    return md;
  }

  return {
    registerDimension, unregisterDimension, listDimensions,
    calcTemperature, buildMarketData, interp, sma
  };
})();
