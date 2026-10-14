/* ===== Service：v1.3.2 备份导出/导入（含 IndexedDB 截图）=====
   允许进入备份的只有持仓业务字段和截图本体。
   API Key、ocr_byok 一律不写出、导入时也丢弃。 */
window.App = window.App || {};

App.BackupService = (function () {
  const SECRET_KEYS = ['apiKey', 'api_key', 'ocr_byok', 'ocrByok', 'ocr_settings', 'authorization'];

  function stripSecrets(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    SECRET_KEYS.forEach(function (k) { delete obj[k]; });
    return obj;
  }

  /** 从 IndexedDB 收集截图。不可用时返回空对象，不阻断结构化数据导出。 */
  async function collectScreenshots() {
    if (!App.IndexedDBRepo || typeof App.IndexedDBRepo.isAvailable !== 'function') return {};
    const ok = await App.IndexedDBRepo.isAvailable();
    if (!ok) return {};
    const keys = await App.IndexedDBRepo.allKeys();
    const shots = {};
    for (let i = 0; i < (keys || []).length; i++) {
      const key = keys[i];
      const img = await App.IndexedDBRepo.getImage(key);
      if (typeof img === 'string' && img) shots[String(key)] = img;
    }
    return shots;
  }

  /**
   * 组装可下载的备份对象。
   * @param {object} source 通常是 LocalStorageRepo.getDB()
   * @param {object} screenshots imageId → base64/dataURL
   */
  function buildPayload(source, screenshots) {
    const src = source || {};
    const payload = {
      app: 'position-review-demo',
      version: App.Constants.APP_VERSION,
      exported_at: App.Utils.nowIso(),
      overview: src.overview || {},
      holdings: src.holdings || {},
      trades: Array.isArray(src.trades) ? src.trades : [],
      reviews: src.reviews || {},
      snapshots: src.snapshots || {},
      plan: src.plan || null,
      market_data: src.market_data || {},
      instruments: src.instruments || {},
      screenshots: screenshots || {}
    };
    return stripSecrets(payload);
  }

  async function restoreScreenshots(screenshots) {
    const shots = screenshots && typeof screenshots === 'object' ? screenshots : {};
    const keys = Object.keys(shots);
    if (!keys.length) return { restored: 0, skipped: 0 };
    if (!App.IndexedDBRepo || typeof App.IndexedDBRepo.isAvailable !== 'function') {
      return { restored: 0, skipped: keys.length };
    }
    const ok = await App.IndexedDBRepo.isAvailable();
    if (!ok) return { restored: 0, skipped: keys.length };
    let restored = 0;
    for (let i = 0; i < keys.length; i++) {
      const val = shots[keys[i]];
      if (typeof val !== 'string' || !val) continue;
      await App.IndexedDBRepo.putImage(keys[i], val);
      restored++;
    }
    return { restored: restored, skipped: keys.length - restored };
  }

  /**
   * 导入备份：结构化数据整体替换，截图写回 IndexedDB。
   * 文件里若夹带密钥字段，直接丢弃，不写入 ocr 设置。
   */
  async function importPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const err = new Error('备份文件不是有效的 JSON 对象');
      err.name = 'ValidationException';
      throw err;
    }
    const hasBody = data.overview || data.holdings || data.trades || data.snapshots || data.instruments;
    if (!hasBody) {
      const err = new Error('备份里没有可恢复的持仓数据');
      err.name = 'ValidationException';
      throw err;
    }
    const clean = stripSecrets({
      overview: data.overview,
      holdings: data.holdings,
      trades: data.trades,
      reviews: data.reviews,
      snapshots: data.snapshots,
      plan: data.plan,
      market_data: data.market_data,
      instruments: data.instruments
    });
    App.LocalStorageRepo.replaceAll(clean);
    const shots = await restoreScreenshots(data.screenshots);
    return { screenshotCount: shots.restored, screenshotsSkipped: shots.skipped };
  }

  return { buildPayload, collectScreenshots, importPayload, stripSecrets, SECRET_KEYS: SECRET_KEYS.slice() };
})();
