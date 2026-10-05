/* Number formatting that does not depend on Intl locale data. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.App = root.App || {};
    Object.keys(api).forEach(function (k) { root.App[k] = api[k]; });
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  function fmtNumber(n, digits) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '-';
    var digitsUsed = digits === undefined || digits === null ? 2 : digits;
    var num = Number(n);
    var neg = num < 0;
    var fixed = Math.abs(num).toFixed(digitsUsed);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  function fmtSigned(n, digits) {
    var text = fmtNumber(n, digits);
    if (text === '-' || text === '0' || text === '0.00' || text.indexOf('-') === 0) return text;
    if (Number(n) > 0) return '+' + text;
    return text;
  }

  function fmtPct(n) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '-';
    var num = Number(n);
    var body = Math.abs(num).toFixed(2) + '%';
    if (num > 0) return '+' + body;
    if (num < 0) return '-' + body;
    return body;
  }

  function pnlTone(n) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) || Number(n) === 0) return 'flat';
    return Number(n) > 0 ? 'up' : 'down';
  }

  function roundTo(n, digits) {
    var m = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(Number(n) * m) / m;
  }

  return {
    fmtNumber: fmtNumber,
    fmtSigned: fmtSigned,
    fmtPct: fmtPct,
    pnlTone: pnlTone,
    roundTo: roundTo
  };
});
