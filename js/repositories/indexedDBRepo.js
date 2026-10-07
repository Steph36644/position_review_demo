/* ===== Repository：IndexedDB 截图二进制（base64）存取 ===== */
window.App = window.App || {};

App.IndexedDBRepo = (function () {
  const C = () => App.Constants;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        const err = new Error('当前浏览器不支持 IndexedDB');
        err.name = 'IndexedDBNotSupported';
        reject(err);
        return;
      }
      const req = indexedDB.open(C().DB_NAME, C().DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(C().IMAGE_STORE)) {
          db.createObjectStore(C().IMAGE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function isAvailable() {
    return open().then(() => true).catch(() => false);
  }

  function tx(mode, handler) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(C().IMAGE_STORE, mode);
      const store = t.objectStore(C().IMAGE_STORE);
      let result;
      Promise.resolve(handler(store, (v) => { result = v; })).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  /** 写入/覆盖图片 */
  function putImage(key, base64) {
    return tx('readwrite', (store) => new Promise((resolve, reject) => {
      const req = store.put(base64, key);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    }));
  }

  /** 读取图片 */
  function getImage(key) {
    return tx('readonly', (store, setResult) => new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => { setResult(req.result); resolve(); };
      req.onerror = () => reject(req.error);
    }));
  }

  /** 删除图片 */
  function deleteImage(key) {
    return tx('readwrite', (store) => new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    }));
  }

  /** 全部图片 key */
  function allKeys() {
    return tx('readonly', (store, setResult) => new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => { setResult(req.result); resolve(); };
      req.onerror = () => reject(req.error);
    }));
  }

  /** 清空全部截图（重置全部数据时使用） */
  function clearAll() {
    return tx('readwrite', (store) => new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    }));
  }

  return { isAvailable, putImage, getImage, deleteImage, allKeys, clearAll };
})();
