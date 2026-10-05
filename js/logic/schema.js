/* Schema marker for the public demo seed shape (trades / dates / holdings / overview). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    root.App.SCHEMA_VERSION = api.SCHEMA_VERSION;
    root.App.DEMO_RANGE = api.DEMO_RANGE;
    root.App.STORAGE_KEY = api.STORAGE_KEY;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  return {
    SCHEMA_VERSION: '1.3',
    DEMO_RANGE: { start: '2026-09-01', end: '2026-09-28' },
    STORAGE_KEY: 'position-review-demo:v1.3'
  };
});
