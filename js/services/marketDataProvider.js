/* ===== v1.2.3 Service：大盘行情数据获取（东方财富 CORS 接口，零后端） ===== */
window.App = window.App || {};

App.MarketDataProvider = (function () {
  const U = () => App.Utils;

  /**
   * 新浪代码（sh000001 / sz399001）→ 东方财富 secid（1.000001 / 0.399001）
   * 沪市 market=1，深市 market=0
   */
  function toSecid(code) {
    code = String(code).toLowerCase();
    if (code.indexOf('sh') === 0) return '1.' + code.slice(2);
    if (code.indexOf('sz') === 0) return '0.' + code.slice(2);
    return code;
  }

  /**
   * 东方财富 K 线接口（CORS 全开，fetch 直接调用）
   * klines 每项格式："日期,开盘,收盘,最高,最低,成交量,成交额"
   * @param {string} code 新浪格式指数代码，如 sh000001
   * @param {number} datalen 拉取天数
   * @returns {Promise<Array>} [{date, open, high, low, close, volume, amount}, ...] 升序
   */
  function getIndexDaily(code, datalen) {
    const secid = toSecid(code);
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get' +
      '?secid=' + encodeURIComponent(secid) +
      '&fields1=f1,f2,f3' +
      '&fields2=f51,f52,f53,f54,f55,f56,f57' +
      '&klt=101&fqt=0&end=20500101&lmt=' + datalen;

    return fetch(url, { mode: 'cors' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('行情接口 HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (json) {
        if (!json || !json.data || !Array.isArray(json.data.klines) || json.data.klines.length === 0) {
          throw new Error('行情接口返回数据为空');
        }
        const rows = json.data.klines.map(function (line) {
          const p = line.split(',');
          return {
            date: p[0],
            open: Number(p[1]),
            close: Number(p[2]),
            high: Number(p[3]),
            low: Number(p[4]),
            volume: Number(p[5]),
            amount: p[6] ? Number(p[6]) : null
          };
        });
        // 接口返回已按日期升序
        return rows;
      });
  }

  /**
   * 手动录入单日行情（接口拉取失败时的兜底）
   */
  function manualInput(input) {
    return {
      date: String(input.date),
      open: Number(input.open) || null,
      high: Number(input.high) || null,
      low: Number(input.low) || null,
      close: Number(input.close) || null,
      volume: Number(input.volume) || null,
      amount: input.amount ? Number(input.amount) : null
    };
  }

  return { getIndexDaily, manualInput, toSecid };
})();
