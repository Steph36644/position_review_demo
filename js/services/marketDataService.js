/* ===== v1.2.3 Service：大盘数据编排（获取 → 计算温度 → 存储） ===== */
window.App = window.App || {};

App.MarketDataService = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;
  function db() { return App.LocalStorageRepo.getDB(); }

  function getMarketData(date) {
    return db().market_data[date] || null;
  }

  function saveMarketData(md) {
    db().market_data[md.date] = md;
    App.LocalStorageRepo.saveMarketData();
  }

  function getAll() { return db().market_data; }

  /**
   * 拉取指数最近 N 日 K 线并计算每日温度，批量写入 market_data
   * 新口径：沪（上证指数，价格+沪市额）+ 深（深证综指，深市额）双指数对齐，
   * amount 为沪深两市合计成交额；深市拉取失败时 amount=null（量能维度跳过，指数维度仍计算）
   * @param {Object} plan 仓位计划（含 market_temp 配置）
   * @returns {Promise<{count:number, latest:Object|null}>}
   */
  function fetchAndCompute(plan) {
    const mt = plan && plan.market_temp ? plan.market_temp : C().MARKET_TEMP_DEFAULTS;
    const code = mt.index_code;
    const code2 = mt.index2_code;
    const datalen = mt.lookback_days;

    const pSh = App.MarketDataProvider.getIndexDaily(code, datalen);
    const pSz = code2
      ? App.MarketDataProvider.getIndexDaily(code2, datalen).catch(function () { return null; })
      : Promise.resolve(null);

    return Promise.all([pSh, pSz]).then(function (res) {
      const shRows = res[0], szRows = res[1];
      if (!shRows || shRows.length === 0) {
        return { count: 0, latest: null };
      }
      // 深市成交额按日期索引
      let szAmountMap = null;
      if (szRows && szRows.length > 0) {
        szAmountMap = {};
        szRows.forEach(function (r) { szAmountMap[r.date] = r.amount; });
      }
      // 合并：价格取沪指，amount 取两市合计（任一缺失则当日 amount=null）
      const series = shRows.map(function (r) {
        let amount = null;
        if (!szAmountMap) {
          amount = (r.amount === undefined || r.amount === null) ? null : r.amount;
        } else if (r.amount !== null && r.amount !== undefined &&
                   szAmountMap[r.date] !== null && szAmountMap[r.date] !== undefined) {
          amount = r.amount + szAmountMap[r.date];
        }
        return {
          date: r.date, open: r.open, high: r.high, low: r.low,
          close: r.close, volume: r.volume, amount: amount
        };
      });

      let count = 0;
      let latest = null;
      series.forEach(function (row) {
        const md = App.MarketTempService.buildMarketData(series, row.date, plan, 'sina');
        if (md.temp_score !== null) {
          saveMarketData(md);
          count++;
          if (!latest || md.date > latest.date) latest = md;
        }
      });
      return { count: count, latest: latest };
    });
  }

  /**
   * 手动录入单日行情并计算温度（接口失败兜底）
   * @param {Object} input {date, open, high, low, close, volume, amount}
   *        amount 为沪深两市合计成交额（元，可留空）
   * @param {Object} plan
   */
  function saveManual(input, plan) {
    const row = App.MarketDataProvider.manualInput(input);
    // 构造只含该日的序列（温度计算需要多日，若历史已有则合并）
    const history = Object.values(db().market_data)
      .filter(function (m) { return m.date <= row.date; })
      .map(function (m) {
        return {
          date: m.date, open: m.open, high: m.high, low: m.low, close: m.close,
          volume: m.volume, amount: m.amount
        };
      });
    history.push(row);
    history.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    const md = App.MarketTempService.buildMarketData(history, row.date, plan, 'manual');
    saveMarketData(md);
    return md;
  }

  /** 温度状态 → 样式类（深色主题下的红绿映射） */
  function statusClass(status) {
    return { cold: 'text-blue-400', cool: 'text-slate-300', warm: 'text-amber-400', hot: 'text-red-400' }[status] || 'text-slate-400';
  }

  function statusLabel(status) {
    return C().MARKET_TEMP_STATUS_LABEL[status] || '-';
  }

  /** 特殊风控区间 → 样式类 */
  function zoneClass(zone) {
    return {
      freezing: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
      overheat: 'text-red-300 bg-red-500/10 border-red-500/30'
    }[zone] || '';
  }

  /** 特殊风控区间 → 完整提示文案 */
  function zoneLabel(zone) {
    return (C().MARKET_TEMP_ZONE && C().MARKET_TEMP_ZONE.LABEL[zone]) || '';
  }

  return { getMarketData, saveMarketData, getAll, fetchAndCompute, saveManual, statusClass, statusLabel, zoneClass, zoneLabel };
})();
