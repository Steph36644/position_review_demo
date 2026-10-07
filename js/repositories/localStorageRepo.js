/* ===== Repository：localStorage 结构化数据 CRUD ===== */
window.App = window.App || {};

App.LocalStorageRepo = (function () {
  const KEYS = () => App.Constants.LS_KEYS;

  // 运行时内存数据（页面加载时一次性载入）
  const DB = { overview: {}, holdings: {}, trades: [], reviews: {}, snapshots: {}, plan: null, market_data: {}, instruments: {} };
  let initialized = false;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('本地数据损坏，已忽略：', key, e);
      return fallback;
    }
  }

  function persist(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        const err = new Error('本地存储空间不足，请清理历史截图后重试（截图存于 IndexedDB，可在数据较多时清理）');
        err.name = 'StorageFullException';
        throw err;
      }
      throw e;
    }
  }

  /** 初始化：localStorage 优先，无数据时使用种子数据 */
  function init(seed) {
    if (initialized) return DB;
    DB.overview = read(KEYS().overview, (seed && seed.overview) || {});
    DB.holdings = read(KEYS().holdings, (seed && seed.holdings) || {});
    DB.trades = read(KEYS().trades, (seed && seed.trades) || []);
    DB.reviews = read(KEYS().reviews, {});
    DB.snapshots = read(KEYS().snapshots, {});
    DB.plan = read(KEYS().plan, null);   // v1.2：缺失时由 PlanService.initDefault() 兜底
    DB.market_data = read(KEYS().market_data, {});   // v1.2.3：大盘行情 + 温度
    DB.instruments = read(KEYS().instruments, {});   // v1.3.1：标的主数据
    initialized = true;
    return DB;
  }

  function getDB() { return DB; }

  function saveTrades() { persist(KEYS().trades, DB.trades); }
  function saveReviews() { persist(KEYS().reviews, DB.reviews); }
  function saveSnapshots() { persist(KEYS().snapshots, DB.snapshots); }
  function saveHoldings() { persist(KEYS().holdings, DB.holdings); }
  function saveOverview() { persist(KEYS().overview, DB.overview); }
  function savePlan() { persist(KEYS().plan, DB.plan); }
  function saveMarketData() { persist(KEYS().market_data, DB.market_data); }
  function saveInstruments() { persist(KEYS().instruments, DB.instruments); }

  function saveAll() {
    saveTrades(); saveReviews(); saveSnapshots(); saveHoldings(); saveOverview(); savePlan(); saveMarketData(); saveInstruments();
  }

  /** 导入备份整体替换 */
  function replaceAll(data) {
    if (data.overview) DB.overview = data.overview;
    if (data.holdings) DB.holdings = data.holdings;
    if (Array.isArray(data.trades)) DB.trades = data.trades;
    if (data.reviews) DB.reviews = data.reviews;
    if (data.snapshots) DB.snapshots = data.snapshots;
    if (data.plan) DB.plan = data.plan;   // v1.2：备份含 plan 时一并恢复
    if (data.market_data) DB.market_data = data.market_data;   // v1.2.3：备份含大盘数据时恢复
    if (data.instruments) DB.instruments = data.instruments;   // v1.3.1：备份含主数据时恢复
    saveAll();
  }

  function getDates() {
    const set = new Set();
    Object.keys(DB.overview).forEach(d => set.add(d));
    Object.keys(DB.holdings).forEach(d => set.add(d));
    return Array.from(set).sort();
  }

  return {
    init, getDB, getDates,
    saveTrades, saveReviews, saveSnapshots, saveHoldings, saveOverview, savePlan, saveMarketData, saveInstruments, saveAll,
    replaceAll
  };
})();
