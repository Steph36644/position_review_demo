/* ===== Service：每日持仓链（v1.3.4）=====
   新的一天用昨日成本与持仓量预填，收盘价留空。
   数量相对上一日有变化时，必须先写下买入/加仓/减仓/卖出/清仓草稿，且理由非空，才能保存。
   草稿写入当日快照的 position_drafts，不进入交易流水。 */
window.App = window.App || {};

App.DayChain = (function () {
  const C = () => App.Constants;

  function fail(msg, drafts) {
    const Err = (App.Exceptions && App.Exceptions.ValidationException) || Error;
    const err = new Err(msg);
    err.name = 'ValidationException';
    err.drafts = drafts || [];
    return err;
  }

  function numQty(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  /** 上一日有效持仓量。已清仓或数量 ≤0 视为 0。 */
  function previousMap(date) {
    const prev = App.HoldingsService.getPreviousHoldings(date);
    const map = new Map();
    (prev.holdings || []).forEach(function (h) {
      if (!h || !h.name) return;
      const q = numQty(h.position);
      map.set(h.name, (!h.cleared && q && q > 0) ? q : 0);
    });
    return { date: prev.date, map: map };
  }

  /**
   * 打开某一天的录入行。
   * 该日已有持仓则原样返回；否则从上一交易日带入成本与数量，现价置空。
   */
  function prefill(date) {
    const existing = App.HoldingsService.getHoldings(date) || [];
    if (existing.length) {
      return {
        mode: 'existing',
        prevDate: null,
        rows: existing.map(function (h) { return Object.assign({}, h); })
      };
    }
    const prev = App.HoldingsService.getPreviousHoldings(date);
    const rows = (prev.holdings || []).filter(function (h) {
      return h && h.name && !h.cleared && numQty(h.position) > 0;
    }).map(function (h) {
      const qty = numQty(h.position);
      return {
        date: date,
        name: h.name,
        position: qty,
        available: qty,
        cost: h.cost,
        current_price: null,
        market_value: null,
        floating_pnl: null,
        floating_pnl_pct: null,
        day_pnl: null,
        day_pnl_pct: null,
        cleared: 0
      };
    });
    return { mode: rows.length ? 'prefill' : 'empty', prevDate: prev.date, rows: rows };
  }

  /** 由数量变化推断默认方向。没有变化返回 null。 */
  function inferAction(prevQty, nextQty) {
    const prev = Number(prevQty) || 0;
    const next = Number(nextQty) || 0;
    if (next === prev) return null;
    if (prev <= 0 && next > 0) return C().ACTIONS.BUY;
    if (next > prev) return C().ACTIONS.ADD;
    if (next <= 0) return C().ACTIONS.CLEAR;
    return C().ACTIONS.REDUCE;
  }

  /** 该数量变化允许用户改选的方向。卖出可替代减仓或清仓；新建仓只允许买入。 */
  function allowedActions(prevQty, nextQty) {
    const action = inferAction(prevQty, nextQty);
    if (!action) return [];
    if (action === C().ACTIONS.BUY) return [C().ACTIONS.BUY];
    if (action === C().ACTIONS.ADD) return [C().ACTIONS.ADD, C().ACTIONS.BUY];
    if (action === C().ACTIONS.CLEAR) return [C().ACTIONS.CLEAR, C().ACTIONS.SELL];
    return [C().ACTIONS.REDUCE, C().ACTIONS.SELL];
  }

  /**
   * 对比上一日，列出必须填写的草稿。
   * 持仓量为空的行视为尚未填完，不当成清仓，也不算消失。
   */
  function requiredDrafts(date, holdings) {
    const prev = previousMap(date);
    const seen = new Set();
    const drafts = [];
    (holdings || []).forEach(function (h) {
      if (!h || !h.name) return;
      const next = numQty(h.position);
      if (next === null) {
        seen.add(h.name);
        return;
      }
      seen.add(h.name);
      const prevQty = prev.map.has(h.name) ? prev.map.get(h.name) : 0;
      const action = inferAction(prevQty, next);
      if (!action) return;
      drafts.push({
        name: h.name,
        action: action,
        prev_qty: prevQty,
        qty: next,
        delta: Math.abs(next - prevQty),
        reason: ''
      });
    });
    prev.map.forEach(function (qty, name) {
      if (qty <= 0 || seen.has(name)) return;
      drafts.push({
        name: name,
        action: C().ACTIONS.CLEAR,
        prev_qty: qty,
        qty: 0,
        delta: qty,
        reason: ''
      });
    });
    return drafts;
  }

  function mergeDrafts(required, userDrafts) {
    const byName = new Map();
    (userDrafts || []).forEach(function (d) {
      if (d && d.name) byName.set(d.name, d);
    });
    return required.map(function (d) {
      const old = byName.get(d.name);
      if (!old) return d;
      const allowed = allowedActions(d.prev_qty, d.qty);
      const action = allowed.indexOf(old.action) >= 0 ? old.action : d.action;
      return {
        name: d.name,
        action: action,
        prev_qty: d.prev_qty,
        qty: d.qty,
        delta: d.delta,
        reason: old.reason ? String(old.reason) : ''
      };
    });
  }

  /** 校验理由非空、方向与数量变化一致。不写库。 */
  function prepare(date, holdings, userDrafts) {
    const drafts = mergeDrafts(requiredDrafts(date, holdings), userDrafts);
    const errors = [];
    drafts.forEach(function (d) {
      const allowed = allowedActions(d.prev_qty, d.qty);
      if (allowed.indexOf(d.action) < 0) {
        errors.push('「' + d.name + '」的草稿方向与数量变化不一致');
      }
      if (!String(d.reason || '').trim()) {
        errors.push('「' + d.name + '」数量有变动，请填写非空理由后再保存');
      }
    });
    return { valid: errors.length === 0, errors: errors, drafts: drafts };
  }

  function attach(date, drafts) {
    const store = App.LocalStorageRepo.getDB();
    if (!store.snapshots[date]) {
      store.snapshots[date] = App.Models.createSnapshotMeta(date, {
        image_id: null,
        ocr_status: C().OCR_STATUS.SKIPPED,
        confirmed: true,
        confirmed_at: App.Utils.nowIso()
      });
    }
    store.snapshots[date].position_drafts = (drafts || []).map(function (d) {
      return {
        name: d.name,
        action: d.action,
        prev_qty: d.prev_qty,
        qty: d.qty,
        delta: d.delta,
        reason: String(d.reason || '').trim()
      };
    });
    App.LocalStorageRepo.saveSnapshots();
    return store.snapshots[date].position_drafts;
  }

  /**
   * 保存当日持仓，并把草稿写到快照。不调用 TradeService，不改交易流水。
   */
  function commit(date, holdings, overview, userDrafts) {
    const plan = prepare(date, holdings, userDrafts);
    if (!plan.valid) throw fail(plan.errors[0], plan.drafts);
    const rows = (holdings || []).map(function (h) {
      const row = Object.assign({}, h);
      row.date = date;
      if (numQty(row.position) === 0) row.cleared = 1;
      return row;
    });
    App.HoldingsService.saveSnapshot(date, rows, overview);
    attach(date, plan.drafts);
    return plan;
  }

  return {
    prefill, inferAction, allowedActions, requiredDrafts, prepare, attach, commit
  };
})();
