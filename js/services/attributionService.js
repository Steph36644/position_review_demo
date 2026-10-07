/* ===== Service：v1.2 S2 盈亏归因（DAA-4 默认标签 + 覆盖留痕 + 单源读取） ===== */
window.App = window.App || {};

class AttributionLockedException extends Error {
  constructor(msg) { super(msg); this.name = 'AttributionLockedException'; }
}
App.Exceptions = App.Exceptions || {};
App.Exceptions.AttributionLockedException = AttributionLockedException;

App.AttributionService = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /** 当日该标的全部有效卖出（filled/partial） */
  function daySells(date, name) {
    return App.IndexManager.getByDate(date)
      .filter(App.IndexManager.isEffectiveTrade)
      .filter(t => C().SELL_ACTIONS.includes(t.action) && t.name === name);
  }

  function hasSellType(date, name, types) {
    return daySells(date, name).some(t => types.includes(t.sell_type));
  }

  /**
   * 违规锁定判定（与当前标签无关：只要当日存在违规卖出即锁定，防洗白）
   */
  function isLockedToOut(date, name) {
    return hasSellType(date, name, [C().VIOLATION_TYPE]);
  }

  /**
   * DAA-4 默认计算（不落库）
   * 优先级：体系外-违规 > 体系内-风控(证伪/失效) > 体系内-兑现 > 体系内-持有 > 待归因
   */
  function computeDefault(date, name) {
    const T = C().ATTRIBUTION;
    const sells = daySells(date, name);
    if (sells.some(t => t.sell_type === C().VIOLATION_TYPE)) return T.OUT_VIOL;
    if (sells.some(t => t.sell_type === '证伪' || t.sell_type === '失效')) return T.IN_RISK;
    if (sells.some(t => t.sell_type === '兑现')) return T.IN_CASHIN;
    if (sells.length === 0 && App.IndexManager.getOpenBuys(name).length > 0) return T.IN_HOLD;
    return T.PENDING;
  }

  /**
   * 单源读取：标的当日生效标签
   * 1) reviews[date].pnl_attribution[name] 存在（含历史自由文本）→ source:'override'
   * 2) 否则 → DAA-4 默认计算值，source:'default'
   * locked 仅由当日是否存在违规卖出决定
   */
  function getTag(date, name) {
    const review = db().reviews[date];
    const stored = review && review.pnl_attribution ? review.pnl_attribution[name] : undefined;
    const locked = isLockedToOut(date, name);
    if (stored !== undefined && stored !== null && stored !== '') {
      return { tag: stored, source: 'override', locked: locked };
    }
    return { tag: computeDefault(date, name), source: 'default', locked: locked };
  }

  /**
   * 下拉可用选项：违规锁定标的仅体系外两项；
   * 锁定但已存值为体系内（历史遗留冲突）时保留当前值供改选；历史自由文本值保留显示
   */
  function optionsFor(info) {
    const all = [
      C().ATTRIBUTION.IN_HOLD, C().ATTRIBUTION.IN_CASHIN, C().ATTRIBUTION.IN_RISK,
      C().ATTRIBUTION.OUT_VIOL, C().ATTRIBUTION.OUT_MISS, C().ATTRIBUTION.PENDING
    ];
    let opts = info.locked
      ? all.filter(t => C().ATTRIBUTION_VIOLATION_LOCKED.includes(t))
      : all.slice();
    if (opts.indexOf(info.tag) < 0) opts = [info.tag].concat(opts);  // 自定义历史值 / 锁定冲突值保留
    return opts;
  }

  /**
   * 归因下拉 HTML（看板持仓卡片与复盘②段共用同一构建，保证单源一致）
   * default 值加虚线边框区分"建议值/已确认"（PRD §5.3 铁律 1 的 UI 呈现）
   */
  function selectHtml(date, name) {
    const info = getTag(date, name);
    const esc = s => U().escapeHtml(s).replace(/"/g, '&quot;');
    const conflict = info.locked && C().ATTRIBUTION_IN.includes(info.tag);
    const cls = 'attr-select ' +
      (info.source === 'default' ? 'attr-default' : 'attr-override') +
      (conflict ? ' attr-conflict' : '');
    const opts = optionsFor(info).map(t =>
      '<option value="' + esc(t) + '"' + (t === info.tag ? ' selected' : '') + '>' + U().escapeHtml(t) + '</option>'
    ).join('');
    const conflictTip = conflict ? '<span class="text-[10px] text-red-600 shrink-0">当日有违规卖出，须改选体系外</span>' : '';
    return '<span class="inline-flex items-center gap-1.5 min-w-0">' +
      '<select data-attr-select="' + esc(name) + '" data-attr-date="' + date + '" class="' + cls + '">' + opts + '</select>' +
      conflictTip + '</span>';
  }

  /**
   * 唯一写入口：用户覆盖（留痕）
   * 违规锁定标的改选体系内 → 抛 AttributionLockedException（UI 通过下拉过滤预防，此处兜底）
   */
  function setTag(date, name, newTag) {
    if (isLockedToOut(date, name) && C().ATTRIBUTION_IN.includes(newTag)) {
      throw new AttributionLockedException('该标的当日存在违规卖出，不能归为体系内标签');
    }
    const oldTag = getTag(date, name).tag;
    const review = db().reviews[date] || (db().reviews[date] = App.Models.createReview({}));
    if (!review.pnl_attribution) review.pnl_attribution = {};
    review.pnl_attribution[name] = newTag;
    if (oldTag !== newTag) {
      if (!Array.isArray(review.attribution_overrides)) review.attribution_overrides = [];
      review.attribution_overrides.push({ name: name, from: oldTag, to: newTag, at: U().nowIso() });
    }
    App.LocalStorageRepo.saveReviews();
  }

  /**
   * 当日全部标的标签（复盘②段/看板渲染共用）
   * 标的集合 = 当日 holdings（含 cleared）∪ 当日有效卖出 trades 的 name
   */
  function getTagsForDate(date) {
    const names = new Set();
    App.HoldingsService.getHoldings(date).forEach(h => { if (h.name) names.add(h.name); });
    App.IndexManager.getByDate(date)
      .filter(App.IndexManager.isEffectiveTrade)
      .filter(t => C().SELL_ACTIONS.includes(t.action))
      .forEach(t => { if (t.name) names.add(t.name); });
    const map = new Map();
    names.forEach(n => map.set(n, getTag(date, n)));
    return map;
  }

  return { getTag, computeDefault, isLockedToOut, setTag, getTagsForDate, optionsFor, selectHtml };
})();
