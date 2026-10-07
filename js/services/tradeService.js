/* ===== Service：交易流水 R1/R2 业务逻辑（校验 + 落库 + 索引维护） ===== */
window.App = window.App || {};

/* ----- 业务异常类型 ----- */
class ValidationException extends Error {
  constructor(msg) { super(msg); this.name = 'ValidationException'; }
}
class LinkedBuyNotEnoughException extends Error {
  constructor(msg) { super(msg); this.name = 'LinkedBuyNotEnoughException'; }
}
class TradeHasLinksException extends Error {
  constructor(msg) { super(msg); this.name = 'TradeHasLinksException'; }
}
App.Exceptions = { ValidationException, LinkedBuyNotEnoughException, TradeHasLinksException };

App.TradeService = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /** v1.2：交易变更 → 水位/归因/告警统一重算（控制器未加载时跳过，如 Node 测试环境） */
  function notifyRecalc() {
    if (App.AlertBannerController && typeof App.AlertBannerController.recalc === 'function') {
      App.AlertBannerController.recalc();
    }
  }

  /* ---------- R1 买入校验 ---------- */
  function validateBuy(i) {
    if (!i.name || !String(i.name).trim()) throw new ValidationException('标的名称不能为空');
    if (!U().isPosInt(i.amount)) throw new ValidationException('数量必须为正整数');
    if (!U().isPosNum(i.price)) throw new ValidationException('价格必须为正数');
    if (!i.date) throw new ValidationException('交易日期不能为空');

    const reason = String(i.buy_reason || '').trim();
    if (!reason) throw new ValidationException('核心理由不能为空');
    if (reason.length > 100) throw new ValidationException('核心理由不能超过 100 字');

    if (!C().REASON_TYPES.includes(i.reason_type)) throw new ValidationException('请选择理由类型');
    if (!C().EXPECTED_PERIODS.includes(i.expected_period)) throw new ValidationException('请选择预期持有周期');

    const invalid = String(i.invalid_condition || '').trim();
    if (!invalid) throw new ValidationException('失效条件不能为空');
    if (invalid.length > 100) throw new ValidationException('失效条件不能超过 100 字');

    if (!U().isPosNum(i.target_price_low)) throw new ValidationException('目标区间下沿必须为正数');
    if (!U().isPosNum(i.target_price_high)) throw new ValidationException('目标区间上沿必须为正数');
    if (Number(i.target_price_low) > Number(i.target_price_high)) {
      throw new ValidationException('目标区间下沿不能大于上沿');
    }
    if (!U().isPosNum(i.stop_loss)) throw new ValidationException('止损位必须为正数');
  }

  /** 买入软警告（不阻断保存）：止损≥价格、目标下沿>价格 */
  function buyWarnings(i) {
    const w = [];
    const price = Number(i.price);
    if (U().isPosNum(i.stop_loss) && Number(i.stop_loss) >= price) {
      w.push('止损位高于/等于现价，可能立即触发');
    }
    if (U().isPosNum(i.target_price_low) && Number(i.target_price_low) > price) {
      w.push('目标下沿已高于现价，请检查');
    }
    return w;
  }

  /* ---------- R2 卖出校验 ---------- */
  function validateSell(i) {
    if (!i.name || !String(i.name).trim()) throw new ValidationException('标的名称不能为空');
    if (!U().isPosInt(i.amount)) throw new ValidationException('数量必须为正整数');
    if (!U().isPosNum(i.price)) throw new ValidationException('价格必须为正数');
    if (!i.date) throw new ValidationException('交易日期不能为空');

    if (!C().SELL_TYPES.includes(i.sell_type)) throw new ValidationException('请选择卖出分类');

    const note = String(i.sell_note || '').trim();
    if (i.sell_type === C().VIOLATION_TYPE) {
      if (note.length < 5) throw new ValidationException('违规说明至少 5 个字');
      if (Array.isArray(i.linked_buy_ids) && i.linked_buy_ids.length > 0) {
        throw new ValidationException('违规卖出不能关联买入记录');
      }
      return; // 违规不消耗 qty_open
    }

    // 兑现 / 证伪 / 失效
    if (!Array.isArray(i.linked_buy_ids) || i.linked_buy_ids.length === 0) {
      throw new ValidationException('必须关联至少一条买入记录');
    }
    if (!note) throw new ValidationException('卖出说明不能为空');

    const map = i.linked_qty_map || {};
    let totalLinked = 0;
    i.linked_buy_ids.forEach(buyId => {
      const q = Number(map[buyId]);
      if (!U().isPosInt(q)) {
        throw new ValidationException('请为每条选中买入填写正确的消耗数量（正整数）');
      }
      totalLinked += q;
    });
    if (totalLinked !== Number(i.amount)) {
      throw new ValidationException('各买入消耗数量之和（' + totalLinked + '）必须等于本次卖出数量（' + Number(i.amount) + '）');
    }

    // 未平仓数量充足性校验
    let availableQty = 0;
    i.linked_buy_ids.forEach(buyId => {
      availableQty += calcQtyOpen(buyId);
    });
    if (Number(i.amount) > availableQty) {
      throw new LinkedBuyNotEnoughException('超出可关联数量：最多可关联 ' + availableQty + ' 股');
    }
  }

  /* ---------- DAA-1：未平仓数量 ---------- */
  function calcQtyOpen(buyTradeId) {
    const buy = App.IndexManager.getById(buyTradeId);
    if (!buy || !C().BUY_ACTIONS.includes(buy.action)) return 0;
    const open = buy.amount - App.IndexManager.getConsumed(buyTradeId);
    return Math.max(0, open);
  }

  function getOpenBuys(name) {
    return App.IndexManager.getOpenBuys(String(name).trim())
      .map(t => Object.assign({}, t, { qty_open: calcQtyOpen(t.id) }));
  }

  /* ---------- CRUD ---------- */

  /** 创建交易（R1/R2 共用） */
  function createTrade(input) {
    const isBuy = C().BUY_ACTIONS.includes(input.action);
    if (isBuy) validateBuy(input);
    else if (C().SELL_ACTIONS.includes(input.action)) validateSell(input);
    else throw new ValidationException('未知交易方向：' + input.action);

    const trade = App.Models.createTrade(input);
    db().trades.push(trade);
    App.IndexManager.add(trade);
    App.LocalStorageRepo.saveTrades();
    notifyRecalc();
    return trade;
  }

  function getTradesByDate(date) {
    return App.IndexManager.getByDate(date).slice();
  }

  function getAllTrades() {
    return App.IndexManager.getAll().slice();
  }

  function getTrade(id) {
    return App.IndexManager.getById(id);
  }

  /** 删除交易（撤销录入错误） */
  function deleteTrade(id) {
    const trade = App.IndexManager.getById(id);
    if (!trade) throw new ValidationException('交易记录不存在');

    if (C().BUY_ACTIONS.includes(trade.action)) {
      // 若已被卖出关联则禁止删除
      const linked = db().trades.some(s =>
        C().SELL_ACTIONS.includes(s.action) &&
        Array.isArray(s.linked_buy_ids) &&
        s.linked_buy_ids.includes(id)
      );
      if (linked) {
        throw new TradeHasLinksException('该买入已被卖出记录关联，请先删除/修改关联的卖出记录');
      }
    }

    // 从数组移除
    const arr = db().trades;
    const idx = arr.findIndex(t => t.id === id);
    if (idx >= 0) arr.splice(idx, 1);

    App.IndexManager.remove(trade);

    // 卖出删除后，重算其关联买入的消耗
    if (C().SELL_ACTIONS.includes(trade.action)) {
      App.IndexManager.recalcConsumedFor(
        trade.linked_buy_ids || [],
        db().trades.filter(t => C().SELL_ACTIONS.includes(t.action))
      );
    }

    App.LocalStorageRepo.saveTrades();
    notifyRecalc();
  }

  /** 更新交易（修正录入错误，重新走全部校验） */
  function updateTrade(id, patch) {
    const old = App.IndexManager.getById(id);
    if (!old) throw new ValidationException('交易记录不存在');

    // 先临时摘除旧记录对索引/消耗的影响
    const arr = db().trades;
    const idx = arr.findIndex(t => t.id === id);
    arr.splice(idx, 1);
    App.IndexManager.remove(old);
    if (C().SELL_ACTIONS.includes(old.action)) {
      App.IndexManager.recalcConsumedFor(
        old.linked_buy_ids || [],
        arr.filter(t => C().SELL_ACTIONS.includes(t.action))
      );
    }

    // 合并旧值与补丁（保留 id / created_at）
    const merged = Object.assign({}, old, patch, {
      id: id,
      created_at: old.created_at
    });

    try {
      const isBuy = C().BUY_ACTIONS.includes(merged.action);
      if (isBuy) validateBuy(merged);
      else validateSell(merged);

      const updated = App.Models.createTrade(merged);
      arr.push(updated);
      App.IndexManager.add(updated);
      App.LocalStorageRepo.saveTrades();
      notifyRecalc();
      return updated;
    } catch (e) {
      // 校验失败：回滚旧记录
      arr.push(old);
      App.IndexManager.add(old);
      if (C().SELL_ACTIONS.includes(old.action)) {
        App.IndexManager.recalcConsumedFor(
          old.linked_buy_ids || [],
          arr.filter(t => C().SELL_ACTIONS.includes(t.action))
        );
      }
      App.LocalStorageRepo.saveTrades();
      throw e;
    }
  }

  /**
   * 批量删除交易（按日/按标的删除时使用）
   * 每轮先尝试卖出、再尝试买入，使集合内互相关联的买卖可级联删除；
   * 被集合之外的卖出关联的买入始终无法删除，收集到 failed 返回
   * @param {string[]} ids
   * @returns {{deleted: Array, failed: Array<{trade: object, message: string}>}}
   */
  function deleteTradesByIds(ids) {
    let remaining = (ids || [])
      .map(id => App.IndexManager.getById(id))
      .filter(Boolean);
    const deleted = [];
    const errors = new Map();
    let progressed = true;
    while (remaining.length > 0 && progressed) {
      progressed = false;
      const sells = remaining.filter(t => C().SELL_ACTIONS.includes(t.action));
      const buys = remaining.filter(t => C().BUY_ACTIONS.includes(t.action));
      const next = [];
      // 先卖后买：先解除集合内买入的关联消耗
      sells.concat(buys).forEach(t => {
        try {
          deleteTrade(t.id);
          deleted.push(t);
          progressed = true;
        } catch (e) {
          errors.set(t.id, e.message || '删除失败');
          next.push(t);
        }
      });
      remaining = next;
    }
    const failed = remaining.map(t => ({
      trade: t,
      message: errors.get(t.id) || '存在关联关系，无法删除'
    }));
    return { deleted: deleted, failed: failed };
  }

  return {
    validateBuy, buyWarnings, validateSell,
    calcQtyOpen, getOpenBuys,
    createTrade, getTradesByDate, getAllTrades, getTrade,
    deleteTrade, deleteTradesByIds, updateTrade
  };
})();
