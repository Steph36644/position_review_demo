/* ===== 通用工具函数 ===== */
window.App = window.App || {};

App.Utils = (function () {
  /** 数字格式化，默认 2 位小数 */
  function fmt(n, digits) {
    digits = (digits === undefined) ? 2 : digits;
    if (n === null || n === undefined || n === '') return '-';
    const num = Number(n);
    if (isNaN(num)) return '-';
    return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** 百分比格式化，正数带 + */
  function fmtPct(n) {
    if (n === null || n === undefined || n === '') return '-';
    const num = Number(n);
    if (isNaN(num)) return '-';
    return (num > 0 ? '+' : '') + num.toFixed(2) + '%';
  }

  /** 涨跌文字色（A 股：涨红跌绿） */
  function colorClass(n) {
    if (n === null || n === undefined || n === '') return 'text-slate-400';
    return Number(n) >= 0 ? 'rise-text' : 'fall-text';
  }

  function colorTagClass(n) {
    if (n === null || n === undefined || n === '') return 'bg-slate-100 text-slate-400';
    return Number(n) >= 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600';
  }

  /** 生成交易 ID：t + yyMMddHHmmss + 4 位随机 */
  function generateId() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const ts = '' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    const rand = Math.random().toString(16).slice(2, 6);
    return 't' + ts + rand;
  }

  /** 今日日期 YYYY-MM-DD */
  function today() {
    return toDateStr(new Date());
  }

  function toDateStr(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /** 防抖 */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), wait);
    };
  }

  /** HTML 转义 */
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 截断文本 */
  function truncate(s, len) {
    if (!s) return '';
    return s.length > len ? s.slice(0, len) + '…' : s;
  }

  /** 判断是否正整数 */
  function isPosInt(v) {
    const n = Number(v);
    return Number.isInteger(n) && n > 0;
  }

  /** 判断正数 */
  function isPosNum(v) {
    const n = Number(v);
    return !isNaN(n) && n > 0;
  }

  /** Toast 提示 */
  function toast(msg, type) {
    type = type || 'info';
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast-item toast-' + type;
    const icons = {
      success: '<svg class="w-4 h-4 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
      error: '<svg class="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
      warn: '<svg class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>',
      info: '<svg class="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    };
    el.innerHTML = (icons[type] || icons.info) + '<span class="text-slate-600 leading-relaxed">' + escapeHtml(msg) + '</span>';
    container.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  /** 安全执行：捕获业务异常并 toast */
  function safeCall(fn) {
    try {
      return fn();
    } catch (e) {
      console.error(e);
      toast(e.message || '操作失败', 'error');
      throw e;
    }
  }

  return {
    fmt, fmtPct, colorClass, colorTagClass, generateId, today, toDateStr, nowIso,
    debounce, escapeHtml, truncate, isPosInt, isPosNum, toast, safeCall
  };
})();
