/* ===== 数据迁移：v0.0（uploadedSnapshots / review_*）→ v1.1 结构 ===== */
window.App = window.App || {};

App.Migration = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  /**
   * 执行迁移（同步完成 localStorage 部分；pr_version 标记只执行一次）
   */
  function run() {
    if (localStorage.getItem(C().LS_KEYS.version) === C().SCHEMA_VERSION) {
      return { migrated: false };
    }

    const DB = App.LocalStorageRepo.getDB();
    let mergedUploads = 0;
    let mergedReviews = 0;

    // 1. v0.0 上传确认的 holdings/overview（localStorage key: uploadedSnapshots）
    let ups = {};
    try {
      ups = JSON.parse(localStorage.getItem('uploadedSnapshots') || '{}');
    } catch (e) { ups = {}; }

    Object.keys(ups).forEach(date => {
      const item = ups[date];
      if (!item) return;
      if (item.holdings && !DB.holdings[date]) {
        DB.holdings[date] = item.holdings;
        mergedUploads++;
      }
      if (item.overview && !DB.overview[date]) {
        DB.overview[date] = item.overview;
        mergedUploads++;
      }
    });

    // 2. v0.0 纯文本复盘 review_{date} → DB.reviews[date].tomorrow_plan
    Object.keys(localStorage).forEach(key => {
      const m = key.match(/^review_(\d{4}-\d{2}-\d{2})$/);
      if (!m) return;
      const date = m[1];
      const text = localStorage.getItem(key) || '';
      if (!DB.reviews[date]) {
        DB.reviews[date] = App.Models.createReview({
          operations: [],
          tomorrow_plan: text
        });
        mergedReviews++;
      }
    });

    // 3. 持久化并写版本标记
    App.LocalStorageRepo.saveHoldings();
    App.LocalStorageRepo.saveOverview();
    App.LocalStorageRepo.saveReviews();
    localStorage.setItem(C().LS_KEYS.version, C().SCHEMA_VERSION);

    console.info('数据迁移完成：合并上传快照字段', mergedUploads, '处，复盘', mergedReviews, '条');
    return { migrated: true, mergedUploads, mergedReviews };
  }

  return { run };
})();
