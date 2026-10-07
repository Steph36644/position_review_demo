/* 运行时逻辑测试（Node 环境 + localStorage 桩），测完删除 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ----- 浏览器环境桩 ----- */
const store = new Map();
const localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const document = {
  getElementById: () => null,
  addEventListener: () => {},
  createElement: () => ({ classList: { add(){}, remove(){} }, appendChild(){} })
};
const sandbox = { localStorage, document, console, setTimeout, clearTimeout };
// 浏览器中 window 即全局：window.App 等价于全局 App
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.indexedDB = undefined;
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

/* ----- 按浏览器顺序加载（不加载 seed/UI/控制器） ----- */
load('../js/constants.js');
load('../js/utils.js');
load('../js/models.js');
load('../js/repositories/localStorageRepo.js');
load('../js/services/indexManager.js');
load('../js/services/holdingsService.js');
load('../js/services/tradeService.js');
load('../js/services/matchingEngine.js');
load('../js/services/planService.js');
load('../js/services/alertService.js');
load('../js/services/attributionService.js');
load('../js/services/reviewService.js');
load('../js/services/snapshotService.js');
load('../js/services/marketDataProvider.js');
load('../js/services/marketTempService.js');
load('../js/services/marketDataService.js');
load('../js/services/instrumentService.js');
load('../js/services/portfolioSliceService.js');
load('../js/services/etfOverlapService.js');
load('../js/services/whatIfService.js');

const A = sandbox.window.App;
A.LocalStorageRepo.init(null);
A.IndexManager.rebuild([]);

/* ----- 测试工具 ----- */
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function throws(fn, errName, msg) {
  try { fn(); failed++; console.error('  ✗ FAIL（未抛异常）: ' + msg); }
  catch (e) {
    if (errName && e.name !== errName) {
      failed++; console.error('  ✗ FAIL（异常类型 ' + e.name + '≠' + errName + '）: ' + msg);
    } else passed++;
  }
}

const validBuy = (patch) => Object.assign({
  date: '2026-09-10', name: '测试标的A', action: 'buy', amount: 1000, price: 10,
  buy_reason: '测试核心理由足够长', reason_type: '基本面', expected_period: '中期(1-3月)',
  invalid_condition: '测试失效条件足够长', target_price_low: 10, target_price_high: 15, stop_loss: 8
}, patch || {});

/* ===== T1：R1 必填校验 ===== */
console.log('T1 R1 必填校验');
throws(() => A.TradeService.createTrade(validBuy({ name: '' })), 'ValidationException', '名称空');
throws(() => A.TradeService.createTrade(validBuy({ amount: 1.5 })), 'ValidationException', '数量非整数');
throws(() => A.TradeService.createTrade(validBuy({ amount: -1 })), 'ValidationException', '数量负数');
throws(() => A.TradeService.createTrade(validBuy({ buy_reason: '' })), 'ValidationException', '理由空');
throws(() => A.TradeService.createTrade(validBuy({ reason_type: '随便选' })), 'ValidationException', '理由类型非法');
throws(() => A.TradeService.createTrade(validBuy({ target_price_low: 16 })), 'ValidationException', '目标下沿>上沿');
// stop_loss ≥ price：服务端允许保存，仅产生软警告
const warnBuy = A.TradeService.createTrade(validBuy({ name: '警告标的', stop_loss: 12 }));
assert(!!warnBuy, '止损≥价格允许保存');
assert(A.TradeService.buyWarnings(validBuy({ stop_loss: 12 })).length === 1, '产生止损软警告');

/* ===== T2：合法买入落库 ===== */
console.log('T2 合法买入');
const buy = A.TradeService.createTrade(validBuy());
assert(!!buy.id && buy.linked_buy_ids.length === 0, '买入 id 生成、卖出关联为空');
assert(A.TradeService.calcQtyOpen(buy.id) === 1000, '新建买入 qty_open=1000');
assert(A.TradeService.getOpenBuys('测试标的A').length === 1, '未平仓列表含该买入');

/* ===== T3：R2 违规卖出 ===== */
console.log('T3 R2 违规卖出');
throws(() => A.TradeService.createTrade({
  date: '2026-09-11', name: '幽灵标的', action: 'sell', amount: 100, price: 9,
  sell_type: '违规', sell_note: '跌', linked_buy_ids: []
}), 'ValidationException', '违规说明<5字');
const violation = A.TradeService.createTrade({
  date: '2026-09-11', name: '幽灵标的', action: 'sell', amount: 100, price: 9,
  sell_type: '违规', sell_note: '情绪化操作卖出', linked_buy_ids: []
});
assert(!!violation, '违规卖出保存成功');
assert(A.MatchingEngine.getViolations().length === 1, '违规清单 1 笔');
assert(A.TradeService.calcQtyOpen(buy.id) === 1000, '违规卖出不消耗任何 qty_open');

/* ===== T4：R2 部分卖出（兑现） ===== */
console.log('T4 R2 部分卖出配比');
// 600 ≤ qty_open(1000)，配比充足
const partialSell = A.TradeService.createTrade({
  date: '2026-09-12', name: '测试标的A', action: 'reduce', amount: 600, price: 12,
  sell_type: '兑现', sell_note: '达到目标区间减仓',
  linked_buy_ids: [buy.id], linked_qty_map: { [buy.id]: 600 }
});
assert(!!partialSell, '600 股部分卖出成功');
assert(A.TradeService.calcQtyOpen(buy.id) === 400, '部分卖出后 qty_open=400');

// 超量卖出
throws(() => A.TradeService.createTrade({
  date: '2026-09-13', name: '测试标的A', action: 'sell', amount: 500, price: 15,
  sell_type: '兑现', sell_note: '超量卖出测试',
  linked_buy_ids: [buy.id], linked_qty_map: { [buy.id]: 500 }
}), 'LinkedBuyNotEnoughException', '超出 qty_open 拒绝');

// 消耗数量之和≠卖出数量
throws(() => A.TradeService.createTrade({
  date: '2026-09-13', name: '测试标的A', action: 'sell', amount: 400, price: 15,
  sell_type: '兑现', sell_note: '数量不等测试',
  linked_buy_ids: [buy.id], linked_qty_map: { [buy.id]: 300 }
}), 'ValidationException', '消耗之和≠卖出数量拒绝');

/* ===== T5：闭环判定（R3 视图） ===== */
console.log('T5 闭环状态机');
let view = A.MatchingEngine.getReconciliationView({});
let nodeA = view.find(g => g.name === '测试标的A').buys[0];
assert(nodeA.closure_status === 'PARTIAL', '节点状态 PARTIAL');
assert(nodeA.linked_sells.length === 1, '挂载 1 条关联卖出');

// 剩余 400 全部卖出 → CLOSED
A.TradeService.createTrade({
  date: '2026-09-14', name: '测试标的A', action: 'clear', amount: 400, price: 15,
  sell_type: '兑现', sell_note: '目标达成清仓',
  linked_buy_ids: [buy.id], linked_qty_map: { [buy.id]: 400 }
});
assert(A.TradeService.calcQtyOpen(buy.id) === 0, '清仓后 qty_open=0');
view = A.MatchingEngine.getReconciliationView({});
nodeA = view.find(g => g.name === '测试标的A').buys[0];
assert(nodeA.closure_status === 'CLOSED', '节点状态 CLOSED');

/* ===== T6：删除保护与级联重算 ===== */
console.log('T6 删除保护');
throws(() => A.TradeService.deleteTrade(buy.id), 'TradeHasLinksException', '已关联买入禁止删除');
// 删除卖出后 qty_open 恢复
A.TradeService.deleteTrade(partialSell.id);
// 仍有 clear 的 400 股消耗，故 qty_open = 1000 - 400 = 600
assert(A.TradeService.calcQtyOpen(buy.id) === 600, '删除部分卖出后 qty_open 恢复 600');

/* ===== T7：S1 快照聚合 ===== */
console.log('T7 S1 快照聚合');
const draft = A.ReviewService.fillTodaySnapshot('2026-09-14');
assert(draft.operations.length === 1 && draft.operations[0].name === '测试标的A', '聚合当日操作 1 笔');
assert(draft.pnl_attribution && typeof draft.pnl_attribution === 'object' &&
  !Array.isArray(draft.pnl_attribution) && draft.position_in_band === null, 'v1.2 字段留空占位');

/* ===== T8：更新交易 ===== */
console.log('T8 更新交易');
const updated = A.TradeService.updateTrade(violation.id, { price: 9.5 });
assert(updated.price === 9.5 && updated.id === violation.id, '更新价格成功');

/* ===== T9：单日 / 单标的数据删除 ===== */
console.log('T9 单日/单标的删除');
const H = A.HoldingsService;
const repo = A.LocalStorageRepo;

H.saveSnapshot('2026-09-20', [
  { name: '删除标的X', position: 100, market_value: 1000 },
  { name: '删除标的Y', position: 200, market_value: 2000 }
], { total_assets: 3000 });
repo.getDB().snapshots['2026-09-20'] = { image_id: 'snap_2026-09-20', confirmed: true };
repo.saveSnapshots();
A.ReviewService.saveReview('2026-09-20', A.Models.createReview({ tomorrow_plan: '测试复盘' }));

let im = H.getDateImpact('2026-09-20');
assert(im.holdingsRows === 2 && im.hasOverview && im.hasReview && im.hasSnapshot, '单日影响面统计完整');

H.deleteDateData('2026-09-20', {});
assert(H.getHoldings('2026-09-20').length === 0 && !H.getOverview('2026-09-20'), '单日持仓与总览已删除');
assert(!repo.getDB().snapshots['2026-09-20'], '单日快照元数据已删除');
assert(!!A.ReviewService.getReview('2026-09-20'), '未勾选删除复盘时复盘保留');
H.deleteDateData('2026-09-20', { includeReview: true });
assert(!A.ReviewService.getReview('2026-09-20'), '勾选后复盘一并删除');

H.saveSnapshot('2026-09-21', [
  { name: '删除标的X', position: 100, market_value: 1000 },
  { name: '删除标的Y', position: 200, market_value: 2000 }
], null);
H.saveSnapshot('2026-09-22', [
  { name: '删除标的X', position: 110, market_value: 1100 }
], null);
const nameIm = H.getNameImpact('删除标的X');
assert(nameIm.rows === 2 && nameIm.dates.length === 2, '单标的影响面跨 2 日共 2 条');
const delName = H.deleteNameData('删除标的X');
assert(delName.rows === 2, '单标的删除返回 2 条');
assert(H.getHoldings('2026-09-21').length === 1 && H.getHoldings('2026-09-21')[0].name === '删除标的Y', '其余标的行保留');
assert(H.getDates().indexOf('2026-09-22') < 0, '标的行清空后空日期键自动移除');
assert(H.allKnownNames().indexOf('删除标的Y') >= 0, '名称并集可查得剩余标的');

/* ===== T10：批量级联删除（先卖后买 + 外部关联拦截） ===== */
console.log('T10 批量级联删除');
// 集合内互相关联：买入 + 关联卖出同时删除 → 先卖后买均可成功
const b1 = A.TradeService.createTrade(validBuy({ name: '级联标的', date: '2026-10-01' }));
const s1 = A.TradeService.createTrade({
  date: '2026-10-02', name: '级联标的', action: 'sell', amount: 600, price: 12,
  sell_type: '兑现', sell_note: '级联删除测试卖出',
  linked_buy_ids: [b1.id], linked_qty_map: { [b1.id]: 600 }
});
const r1 = A.TradeService.deleteTradesByIds([b1.id, s1.id]);
assert(r1.deleted.length === 2 && r1.failed.length === 0, '集合内买卖级联删除 2 条成功');
assert(!A.TradeService.getTrade(b1.id) && !A.TradeService.getTrade(s1.id), '两条记录均已移除');

// 买入被集合之外的卖出关联 → 拦截并给出原因
const b2 = A.TradeService.createTrade(validBuy({ name: '外部关联标的', date: '2026-10-03' }));
A.TradeService.createTrade({
  date: '2026-10-04', name: '外部关联标的', action: 'sell', amount: 400, price: 12,
  sell_type: '兑现', sell_note: '集合外卖出占位',
  linked_buy_ids: [b2.id], linked_qty_map: { [b2.id]: 400 }
});
const r2 = A.TradeService.deleteTradesByIds([b2.id]);
assert(r2.deleted.length === 0 && r2.failed.length === 1, '被集合外卖出关联的买入拦截为 failed');
assert(!!A.TradeService.getTrade(b2.id), '被拦截的买入仍然存在');
assert(A.TradeService.calcQtyOpen(b2.id) === 600, '失败操作不影响已有关联消耗');

/* ===== T11：仓位计划默认与校验（v1.2 P1-1） ===== */
console.log('T11 仓位计划默认与校验');
const P = A.PlanService;
P.initDefault();
let plan = P.getPlan();
assert(plan.total_position_band[0] === 60 && plan.total_position_band[1] === 80 &&
  plan.single_position_max === 25 && plan.single_industry_max === 30 && plan.cash_min === 15,
  '默认计划值 60-80/25/30/15');
assert(localStorage.getItem('pr2_plan') !== null, 'plan 已持久化到 pr2_plan');
throws(() => P.savePlan({ total_position_band: [80, 60], single_position_max: 25, single_industry_max: 30, cash_min: 15 }),
  'ValidationException', 'lo≥hi 拒绝');
throws(() => P.savePlan({ total_position_band: [60, 80], single_position_max: 0, single_industry_max: 30, cash_min: 15 }),
  'ValidationException', '单标的上限 0 拒绝');
throws(() => P.savePlan({ total_position_band: [60, 80], single_position_max: 25, single_industry_max: 30, cash_min: 100 }),
  'ValidationException', '现金下限 100 拒绝');
throws(() => P.savePlan({ total_position_band: ['a', 80], single_position_max: 25, single_industry_max: 30, cash_min: 15 }),
  'ValidationException', '非整数拒绝');
const savedPlan = P.savePlan({ total_position_band: [50, 90], single_position_max: 30, single_industry_max: 40, cash_min: 10 });
assert(savedPlan.updated_at && savedPlan.total_position_band[1] === 90 && P.getPlan().cash_min === 10,
  'savePlan 落库且 updated_at 更新');
A.LocalStorageRepo.getDB().plan = { broken: true };
assert(P.getPlan().single_position_max === 25, 'plan 损坏时重建默认值');

/* ===== T12：水位计算闭区间边界（v1.2 DAA-2） ===== */
console.log('T12 水位闭区间边界');
P.savePlan({ total_position_band: [60, 80], single_position_max: 25, single_industry_max: 30, cash_min: 10 });
const BAND = { total_position_band: [60, 80] };
const WL = (mv, ta) => A.AlertService.calcWaterLevel({ market_value: mv, total_assets: ta }, BAND);
let w = WL(7200, 10000);
assert(w.status === 'in' && w.position_pct === 72 && w.dev_pp === 8 && w.dist_upper === 8 && w.dist_lower === 12,
  '72% 带内 dev_pp=距最近边界 8');
w = WL(8000, 10000);
assert(w.status === 'in' && w.dev_pp === 0 && w.dist_upper === 0, '80% 恰等于上限仍为 in（闭区间）');
w = WL(8010, 10000);
assert(w.status === 'above' && w.dev_pp === 0.1, '80.1% above dev_pp=0.1');
w = WL(6000, 10000);
assert(w.status === 'in' && w.dist_lower === 0, '60% 恰等于下限仍为 in');
w = WL(5990, 10000);
assert(w.status === 'below' && w.dev_pp === -0.1, '59.9% below dev_pp=-0.1');
assert(A.AlertService.calcWaterLevel({ market_value: 1000, total_assets: 0 }, BAND) === null, '总资产 0 → null');
assert(A.AlertService.calcWaterLevel({ market_value: 1000, total_assets: null }, BAND) === null, '总资产缺失 → null');

/* ===== T13：三维度告警（单标的超阈 / 现金闭区间 / 水位越带） ===== */
console.log('T13 三维度告警');
const HS = A.HoldingsService;
const AL = A.AlertService;
// v1.3.1：为 T13 标的设置主数据，避免"未分类"聚合触发行业告警干扰原测试
const DB13 = A.LocalStorageRepo.getDB();
DB13.instruments = {
  '集中标的M': A.Models.createInstrument({ name: '集中标的M', industry: '行业A', style: '成长', market: '沪' }),
  '普通标的N': A.Models.createInstrument({ name: '普通标的N', industry: '行业B', style: '红利', market: '沪' }),
  '已清仓Z': A.Models.createInstrument({ name: '已清仓Z', industry: '行业C', style: '价值', market: '沪' })
};
A.LocalStorageRepo.saveInstruments();
P.savePlan({ total_position_band: [50, 90], single_position_max: 30, single_industry_max: 40, cash_min: 10 });
HS.saveSnapshot('2026-10-05', [
  { name: '集中标的M', position: 3000, market_value: 3000 },
  { name: '普通标的N', position: 2000, market_value: 2000 },
  { name: '已清仓Z', position: 0, market_value: 0, cleared: 1 }
], { total_assets: 10000, market_value: 5000 });
let ev = AL.evaluateAlerts('2026-10-05');
assert(ev.water && ev.water.status === 'in' && ev.alerts.length === 0, '50% 带内、单标的 30%==上限、现金 50%：无告警');
assert(HS.getHoldings('2026-10-05').length === 3, '含已清仓标的共 3 行');

HS.saveSnapshot('2026-10-05', [
  { name: '集中标的M', position: 3500, market_value: 3500 },
  { name: '普通标的N', position: 2000, market_value: 2000 }
], { total_assets: 10000, market_value: 5500 });
ev = AL.evaluateAlerts('2026-10-05');
assert(ev.alerts.length === 1 && ev.alerts[0].dim === 'single' && ev.alerts[0].name === '集中标的M' &&
  ev.alerts[0].actual === 35 && ev.alerts[0].dev_pp === 5, '单标的 35% > 30% 触发告警 dev_pp=5');

P.savePlan({ total_position_band: [50, 90], single_position_max: 35, single_industry_max: 40, cash_min: 45 });
ev = AL.evaluateAlerts('2026-10-05');
assert(ev.alerts.length === 0, '单标的 35%==上限、现金 45%==下限均不告警（闭区间）');

P.savePlan({ total_position_band: [50, 90], single_position_max: 35, single_industry_max: 40, cash_min: 46 });
ev = AL.evaluateAlerts('2026-10-05');
assert(ev.alerts.length === 1 && ev.alerts[0].dim === 'cash' && ev.alerts[0].dev_pp === 1, '现金 45% < 46% 触发告警');

HS.saveSnapshot('2026-10-06', [
  { name: '满仓标的', position: 9500, market_value: 9500 }
], { total_assets: 10000, market_value: 9500 });
P.savePlan({ total_position_band: [50, 90], single_position_max: 100, single_industry_max: 100, cash_min: 5 });
ev = AL.evaluateAlerts('2026-10-06');
assert(ev.alerts.length === 1 && ev.alerts[0].dim === 'position' && ev.alerts[0].dev_pp === 5 &&
  ev.alerts[0].target.type === 'water', '95% > 上限 90% 触发水位告警');

/* ===== T14：忽略留痕与幂等（v1.2 P1-3） ===== */
console.log('T14 忽略留痕与幂等');
P.savePlan({ total_position_band: [50, 90], single_position_max: 100, single_industry_max: 100, cash_min: 46 });
const evIg = AL.evaluateAlerts('2026-10-05');
assert(evIg.alerts.length === 1, '忽略前当日可见 1 条现金告警');
assert(AL.ignoreAlert('2026-10-05', evIg.alerts[0]) === true, '首次忽略成功');
assert(AL.ignoreAlert('2026-10-05', evIg.alerts[0]) === false, '重复忽略幂等跳过');
const revIg = A.ReviewService.getReview('2026-10-05');
assert(revIg.ignored_alerts.length === 1 && revIg.ignored_alerts[0].dim === 'cash' &&
  !!revIg.ignored_alerts[0].ignored_at, '忽略留痕含 ignored_at');
assert(AL.filterIgnored(evIg.alerts, revIg).length === 0, '忽略后过滤为 0 条');

/* ===== T15：归因默认五路径 + 违规锁定 + 覆盖留痕（v1.2 DAA-4） ===== */
console.log('T15 归因默认与锁定');
const AT = A.AttributionService;
const TAG = A.Constants.ATTRIBUTION;
const dBuy = A.TradeService.createTrade(validBuy({ name: '归因标的A', date: '2026-10-10' }));
assert(AT.computeDefault('2026-10-10', '归因标的A') === TAG.IN_HOLD, '有未平仓买入无卖出 → 体系内-持有');
assert(AT.getTag('2026-10-10', '归因标的A').source === 'default', '未覆盖时 source=default');
A.TradeService.createTrade({
  date: '2026-10-11', name: '归因标的A', action: 'reduce', amount: 500, price: 11,
  sell_type: '兑现', sell_note: '兑现测试卖出', linked_buy_ids: [dBuy.id], linked_qty_map: { [dBuy.id]: 500 }
});
assert(AT.computeDefault('2026-10-11', '归因标的A') === TAG.IN_CASHIN, '兑现 → 体系内-兑现');
A.TradeService.createTrade({
  date: '2026-10-12', name: '归因标的A', action: 'reduce', amount: 250, price: 11,
  sell_type: '证伪', sell_note: '证伪测试卖出', linked_buy_ids: [dBuy.id], linked_qty_map: { [dBuy.id]: 250 }
});
assert(AT.computeDefault('2026-10-12', '归因标的A') === TAG.IN_RISK, '证伪优先于兑现 → 体系内-风控');
A.TradeService.createTrade({
  date: '2026-10-12', name: '违规标的B', action: 'sell', amount: 100, price: 9,
  sell_type: '违规', sell_note: '违规测试卖出足够长', linked_buy_ids: []
});
assert(AT.computeDefault('2026-10-12', '违规标的B') === TAG.OUT_VIOL, '违规 → 体系外-违规');
assert(AT.computeDefault('2026-10-12', '无交易标的C') === TAG.PENDING, '无交易 → 待归因');
assert(AT.isLockedToOut('2026-10-12', '违规标的B') === true, '违规锁定判定');
throws(() => AT.setTag('2026-10-12', '违规标的B', TAG.IN_HOLD), 'AttributionLockedException', '锁定标的改体系内抛异常');
const lockedOpts = AT.optionsFor(AT.getTag('2026-10-12', '违规标的B'));
assert(lockedOpts.length === 2 && lockedOpts.includes(TAG.OUT_VIOL) && lockedOpts.includes(TAG.OUT_MISS),
  '锁定标的选项仅体系外两项');
AT.setTag('2026-10-12', '违规标的B', TAG.OUT_MISS);
let infoB = AT.getTag('2026-10-12', '违规标的B');
assert(infoB.tag === TAG.OUT_MISS && infoB.source === 'override', '体系外覆盖生效 source=override');
const rev12 = A.ReviewService.getReview('2026-10-12');
assert(rev12.attribution_overrides.length === 1 && rev12.attribution_overrides[0].name === '违规标的B' &&
  rev12.attribution_overrides[0].from === TAG.OUT_VIOL && rev12.attribution_overrides[0].to === TAG.OUT_MISS &&
  !!rev12.attribution_overrides[0].at, '覆盖留痕 from/to/at');
AT.setTag('2026-10-12', '违规标的B', TAG.OUT_MISS);
assert(A.ReviewService.getReview('2026-10-12').attribution_overrides.length === 1, '同值重复设置不追加留痕');

/* ===== T16：fillTodaySnapshot 联动 + syncWaterLevel（v1.2 S1 写回） ===== */
console.log('T16 快照联动与水位写回');
HS.saveSnapshot('2026-10-14', [
  { name: '归因标的A', position: 100, market_value: 900 }
], { total_assets: 1000, market_value: 900 });
AT.setTag('2026-10-14', '归因标的A', TAG.IN_CASHIN);
const d14 = A.ReviewService.fillTodaySnapshot('2026-10-14');
assert(d14.pnl_attribution['归因标的A'] === TAG.IN_CASHIN, '一键填入保留已覆盖归因不重置');
assert(d14.water_level && d14.water_level.position_pct === 90 && d14.position_in_band === true,
  '填入快照写水位 90% 恰等于上限仍带内');
const wlNew = AL.calcWaterLevel({ market_value: 100, total_assets: 1000 }, P.getPlan());
A.ReviewService.syncWaterLevel('2026-10-14', wlNew);
let r14 = A.ReviewService.getReview('2026-10-14');
assert(r14.water_level.position_pct === 10 && r14.position_in_band === false, 'syncWaterLevel 更新为 10% below');
assert(r14.pnl_attribution['归因标的A'] === TAG.IN_CASHIN, 'syncWaterLevel 不动归因覆盖');
delete A.LocalStorageRepo.getDB().reviews['2026-10-15'];
A.ReviewService.syncWaterLevel('2026-10-15', null);
assert(!A.ReviewService.getReview('2026-10-15'), '无复盘且无水位不创建');
A.ReviewService.syncWaterLevel('2026-10-16', wlNew);
r14 = A.ReviewService.getReview('2026-10-16');
assert(r14 && r14.water_level && r14.position_in_band === false, '无复盘且有水位自动创建');
const tags13 = AT.getTagsForDate('2026-10-14');
assert(tags13.has('归因标的A') && tags13.get('归因标的A').source === 'override', 'getTagsForDate 含持仓标的');

/* ===== T16b：水位口径统一回归（v1.3.1：复盘填入与看板一致，以大盘温度建议中枢为基准） ===== */
console.log('T16b 水位建议中枢口径统一');
// 此处 plan 为 [50, 90]（T14 末态）：中枢 50 → 有效带 [30, 70]；80% 仓位旧口径（原始带）为 in / 新口径为 above
const pb = P.getPlan().total_position_band;
const effLoB = Math.max(0, 50 - (pb[1] - pb[0]) / 2);
const effHiB = Math.min(100, 50 + (pb[1] - pb[0]) / 2);
HS.saveSnapshot('2026-10-17', [
  { name: '归因标的A', position: 100, market_value: 800 }
], { total_assets: 1000, market_value: 800 });
A.MarketDataService.saveMarketData(Object.assign(
  A.Models.createMarketData('2026-10-17'), { temp_score: 50, suggested_position: 50 }));
const d17 = A.ReviewService.fillTodaySnapshot('2026-10-17');
assert(d17.water_level && d17.water_level.center === 50,
  '填入快照水位以大盘温度建议中枢 50 为基准');
assert(d17.water_level.band[0] === effLoB && d17.water_level.band[1] === effHiB,
  '有效带 = 中枢 ± 带宽/2 → [' + effLoB + ', ' + effHiB + ']（非用户原始带 ' + pb.join('~') + '）');
assert(d17.water_level.status === 'above' && d17.position_in_band === false,
  '80% 高于有效带上限 ' + effHiB + '% 判 above（旧口径原始带同数据为 in，口径已切换）');
const wlCtrl = AL.calcWaterLevel(
  A.HoldingsService.getOverview('2026-10-17'), P.getPlan(), 50);
assert(wlCtrl.center === 50 && wlCtrl.band[0] === effLoB && wlCtrl.band[1] === effHiB && wlCtrl.status === 'above',
  'calcWaterLevel 显式传中枢后带与状态一致（看板/复盘共用）');
delete A.LocalStorageRepo.getDB().market_data['2026-10-17'];
A.LocalStorageRepo.saveMarketData();

/* ===== T17：大盘温度（新口径：指数位置 50% + 量能 50%，仓位 = 100 − 温度） ===== */
console.log('T17 大盘温度计算');
const MT = A.MarketTempService;
const MTCFG = A.Constants.MARKET_TEMP_DEFAULTS;
const dims = MT.listDimensions();
assert(dims.some(d => d.id === 'index') && dims.some(d => d.id === 'volume'),
  '默认注册 index/volume 两维度');
assert(!dims.some(d => d.id === 'trend') && !dims.some(d => d.id === 'divergence'),
  '旧维度 trend/divergence 已移除');

// 生成 N 日序列（日期连续递增；amount 为沪深合计成交额）
function genSeries(days, priceFn, amountFn) {
  const arr = [];
  const base = new Date('2025-01-01T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const close = typeof priceFn === 'function' ? priceFn(i) : priceFn;
    const amount = typeof amountFn === 'function' ? amountFn(i) : amountFn;
    arr.push({
      date: d.toISOString().slice(0, 10),
      open: close, high: close, low: close, close: close,
      volume: 1e8, amount: amount
    });
  }
  return arr;
}
// 前 days-n 日基准值、末 n 日跳变
function stepSeries(days, n, basePrice, endPrice, baseAmount, endAmount) {
  return genSeries(days,
    function (i) { return i < days - n ? basePrice : endPrice; },
    function (i) { return i < days - n ? baseAmount : endAmount; });
}

const planTemp = A.Models.createPlan();
const DAYS = 260;

/* --- 锚点间线性插值：精确边界 + 封底封顶 + 中点 --- */
assert(MT.interp(-15, MTCFG.index_anchors) === 0, '指数锚点 乖离 -15% → 0');
assert(MT.interp(0, MTCFG.index_anchors) === 50, '指数锚点 乖离 0% → 50');
assert(MT.interp(15, MTCFG.index_anchors) === 100, '指数锚点 乖离 +15% → 100');
assert(MT.interp(-30, MTCFG.index_anchors) === 0, '指数锚点 乖离 -30% 封底 0');
assert(MT.interp(30, MTCFG.index_anchors) === 100, '指数锚点 乖离 +30% 封顶 100');
assert(MT.interp(0.5, MTCFG.volume_anchors) === 0, '量能锚点 量比 0.5 → 0');
assert(MT.interp(1.0, MTCFG.volume_anchors) === 50, '量能锚点 量比 1.0 → 50');
assert(MT.interp(1.5, MTCFG.volume_anchors) === 100, '量能锚点 量比 1.5 → 100');
assert(MT.interp(0.75, MTCFG.volume_anchors) === 25, '量能锚点 量比 0.75 → 线性 25');

/* --- 中性场景：价格/成交额长期恒定（乖离 0、量比 1.0）→ 两维 50、总温 50、仓位 50 --- */
const seriesMid = genSeries(DAYS, 3000, 1e10);
const tempMid = MT.calcTemperature(seriesMid, seriesMid[DAYS - 1].date, planTemp);
assert(tempMid.score === 50, '恒定价量 → 总温度 50（' + tempMid.score + '）');
assert(tempMid.details.index === 50 && tempMid.details.volume === 50,
  '两维度各 50（index=' + tempMid.details.index + ', volume=' + tempMid.details.volume + '）');
assert(tempMid.status === 'warm', '50 分落入温档（' + tempMid.status + '）');
assert(tempMid.zone === null, '50 分不属于特殊区间');
assert(tempMid.suggested_position === 50, '核心公式：仓位 = 100 − 50 = 50');

/* --- 过热场景：末 5 日价格拉高 + 放量 → 温度 > 80，只卖不买 --- */
const seriesHot = stepSeries(DAYS, 5, 3000, 3450, 1e10, 1.5e10);
const tempHot = MT.calcTemperature(seriesHot, seriesHot[DAYS - 1].date, planTemp);
assert(tempHot.score > 80, '拉高放量 → 温度 > 80（' + tempHot.score + '）');
assert(tempHot.zone === 'overheat', '过热区标记（' + tempHot.zone + '）');
assert(tempHot.suggested_position === 100 - tempHot.score,
  '过热仓位中枢 = 100 − ' + tempHot.score + ' = ' + tempHot.suggested_position);

/* --- 极寒场景：末 5 日价格杀跌 + 缩量 → 温度 < 20，可打满 --- */
const seriesCold = stepSeries(DAYS, 5, 3000, 2550, 1e10, 0.5e10);
const tempCold = MT.calcTemperature(seriesCold, seriesCold[DAYS - 1].date, planTemp);
assert(tempCold.score < 20, '杀跌缩量 → 温度 < 20（' + tempCold.score + '）');
assert(tempCold.zone === 'freezing', '极寒区标记（' + tempCold.zone + '）');
assert(tempCold.suggested_position === 100 - tempCold.score && tempCold.suggested_position > 80,
  '极寒仓位中枢 > 80（' + tempCold.suggested_position + '）');
assert(tempCold.score < tempMid.score && tempMid.score < tempHot.score,
  '温度排序 极寒 < 中性 < 过热');

/* --- 数据不足（4 日，不足 MA200/250日均额）→ null --- */
const shortSeries = genSeries(4, 3000, 1e10);
const tempShort = MT.calcTemperature(shortSeries, shortSeries[3].date, planTemp);
assert(tempShort.score === null && tempShort.suggested_position === null,
  '数据不足 → 温度与仓位中枢均为 null');

/* --- 单维度可用：成交额缺失（null）→ 仅指数维度，权重归一化 --- */
const noAmountSeries = genSeries(DAYS, 3000, null);
const tempNoAmt = MT.calcTemperature(noAmountSeries, noAmountSeries[DAYS - 1].date, planTemp);
assert(tempNoAmt.details.index === 50 && tempNoAmt.details.volume === null,
  '成交额缺失：指数 50、量能 null');
assert(tempNoAmt.score === 50, '仅一个有效维度 → 归一化后温度 50（' + tempNoAmt.score + '）');

/* --- 维度可插拔：注册恒返回 80 的维度，权重设为 1 --- */
MT.registerDimension('test_dim', '测试维度', function () { return 80; });
const planCustom = A.Models.createPlan();
planCustom.market_temp.weights = { test_dim: 1 };
const tempCustom = MT.calcTemperature(seriesMid, seriesMid[DAYS - 1].date, planCustom);
assert(tempCustom.score === 80, '自定义维度权重 1 → 温度等于该维度得分 80');
MT.unregisterDimension('test_dim');
assert(!MT.listDimensions().some(d => d.id === 'test_dim'), '注销后维度不再存在');

/* --- buildMarketData 产出完整 market_data（新口径字段） --- */
const md = MT.buildMarketData(seriesHot, seriesHot[DAYS - 1].date, planTemp, 'sina');
assert(md.temp_score !== null, 'buildMarketData 含温度');
assert(md.ma200 !== null && md.ma200 > 0, '含 40 周线 MA200（' + md.ma200 + '）');
assert(md.amount_ma5 !== null && md.amount_ma250 !== null, '含 5日/250 日均成交额');
assert(md.suggested_position === 100 - md.temp_score, '建议仓位中枢 = 100 − 温度');
assert(md.temp_zone === 'overheat', '过热场景 market_data 带 zone 标记');

/* ===== v1.3.1：标的主数据 / 切片 / 重叠 / What-If 测试 ===== */

/* --- InstrumentService.validateInstrument --- */
console.log('\n--- v1.3.1 标的主数据校验 ---');
const vr1 = A.InstrumentService.validateInstrument({ name: '宁德时代', industry: '电力设备', style: '成长', market: '沪', is_etf: false, etf_top10: [] });
assert(vr1.valid, '正常标的校验通过');
const vr2 = A.InstrumentService.validateInstrument({ name: 'X', industry: '', style: '成长', market: '沪' });
assert(!vr2.valid && vr2.errors.some(e => /行业/.test(e)), '行业为空 → 校验失败');
const vr3 = A.InstrumentService.validateInstrument({ name: 'X', industry: '电力设备', style: '未知', market: '沪' });
assert(!vr3.valid, '非法风格 → 校验失败');
const vr4 = A.InstrumentService.validateInstrument({ name: 'X', industry: '电力设备', style: '成长', market: '沪', is_etf: true, etf_top10: ['a','b','c','d','e','f','g','h','i','j','k'] });
assert(!vr4.valid, 'ETF 成分股 >10 → 校验失败');
const vr5 = A.InstrumentService.validateInstrument({ name: 'X', industry: '电力设备', style: '成长', market: '沪', is_etf: false, etf_top10: ['a'] });
assert(!vr5.valid, '非 ETF 填成分股 → 校验失败');

/* --- PortfolioSliceService.groupByWith --- */
console.log('\n--- v1.3.1 行业/风格切片聚合 ---');
const holdings = [
  { name: 'A', cleared: 0, market_value: 4500 },
  { name: 'B', cleared: 0, market_value: 3000 },
  { name: 'C', cleared: 0, market_value: 2000 },
  { name: 'D', cleared: 0, market_value: 500 }
];
const instruments = {
  A: { name: 'A', industry: '电力设备', style: '成长' },
  B: { name: 'B', industry: '电力设备', style: '红利' },
  C: { name: 'C', industry: '医药生物', style: '价值' }
  // D 无主数据 → 未分类
};
const slicesInd = A.PortfolioSliceService.groupByWith(holdings, instruments, 10000, 'industry');
assert(slicesInd !== null, '有总资产 → 切片非 null');
assert(slicesInd[0].key === '电力设备' && Math.round(slicesInd[0].pct) === 75,
  '电力设备 = (4500+3000)/10000 = 75%（实际 ' + slicesInd[0].pct + '）');
assert(slicesInd[1].key === '医药生物' && Math.round(slicesInd[1].pct) === 20,
  '医药生物 = 2000/10000 = 20%');
assert(slicesInd[2].key === '未分类' && Math.round(slicesInd[2].pct) === 5,
  '未分类 = 500/10000 = 5%');
// 勾稽校验
const vt = A.PortfolioSliceService.verifyTotals(slicesInd, 10000);
assert(vt.sumPct === 100 && vt.cashPct === 0 && vt.diff < 0.1,
  '勾稽：Σ100% + 现金0% = 100%（sum=' + vt.sumPct + ' cash=' + vt.cashPct + ' diff=' + vt.diff + '）');
// 总资产 ≤0 → null
const slicesNull = A.PortfolioSliceService.groupByWith(holdings, instruments, 0, 'industry');
assert(slicesNull === null, '总资产 ≤0 → 切片为 null');

/* --- EtfOverlapService.detectWith --- */
console.log('\n--- v1.3.1 ETF 重叠检测 ---');
const etfHoldings = [
  { name: 'ETF1', cleared: 0 },
  { name: 'ETF2', cleared: 0 },
  { name: '个股X', cleared: 0 }
];
const etfInstruments = {
  ETF1: { name: 'ETF1', is_etf: true, etf_top10: ['A','B','C','D'] },
  ETF2: { name: 'ETF2', is_etf: true, etf_top10: ['B','C','E','F'] },
  个股X: { name: '个股X', is_etf: false }
};
const pairs = A.EtfOverlapService.detectWith(etfHoldings, etfInstruments);
const etfPair = pairs.find(p => p.a === 'ETF1' && p.b === 'ETF2');
assert(etfPair && etfPair.overlap.length === 2, 'ETF1∩ETF2 = {B,C} 共 2 只');
assert(etfPair.ratio === 2 / Math.min(4, 4), '重叠度 = 2/4 = 0.5（实际 ' + etfPair.ratio + '）');
assert(A.EtfOverlapService.isOverThreshold(etfPair), '0.5 > 0.15 → 超阈值');
const missing = A.EtfOverlapService.missingTop10Count(etfHoldings, etfInstruments);
assert(missing === 0, '所有 ETF 均有成分股 → missing=0');

/* --- AlertService 行业维度告警 --- */
console.log('\n--- v1.3.1 行业维度告警 ---');
// 把测试用 instruments 写入 DB（evaluateAlertsWith 从 DB 取主数据）
const DBv13 = A.LocalStorageRepo.getDB();
DBv13.instruments = Object.assign({}, instruments);
A.LocalStorageRepo.saveInstruments();
const plan1 = A.Models.createPlan({ single_industry_max: 30 });
const ov1 = { total_assets: 10000, market_value: 7000 };
// 电力设备 75% > 30% → 触发告警
const res1 = A.AlertService.evaluateAlertsWith(ov1, holdings, plan1, null);
const indAlerts = res1.alerts.filter(a => a.dim === 'industry');
assert(indAlerts.length === 1, '电力设备 75% > 30% → 1 条行业告警（实际 ' + indAlerts.length + '）');
assert(indAlerts[0].name === '电力设备' && indAlerts[0].actual === 75,
  '告警指向电力设备 75%');
// 边界：恰等于上限不告警
const plan2 = A.Models.createPlan({ single_industry_max: 75 });
const res2 = A.AlertService.evaluateAlertsWith(ov1, holdings, plan2, null);
const indAlerts2 = res2.alerts.filter(a => a.dim === 'industry');
assert(indAlerts2.length === 0, '占比恰等于上限 75% → 不告警（闭区间）');

/* --- WhatIfService.applyTrade + simulate --- */
console.log('\n--- v1.3.1 What-If 交易预演 ---');
const baseHoldings = [
  { name: 'A', position: 1000, cost: 10, current_price: 10, market_value: 10000, cleared: 0 }
];
const baseOv = { date: '2026-10-04', total_assets: 100000, market_value: 10000 };
// 加仓：加权平均成本
const rAdd = A.WhatIfService.applyTrade(JSON.parse(JSON.stringify(baseHoldings)), JSON.parse(JSON.stringify(baseOv)),
  { name: 'A', action: 'add', amount: 1000, price: 20 });
assert(rAdd.ok, '加仓成功');
const hAdd = baseHoldings; // applyTrade 第一个参数是副本，需重新调用
// 重新测试：用 fresh 副本
const copyH = JSON.parse(JSON.stringify(baseHoldings));
const copyOv = JSON.parse(JSON.stringify(baseOv));
A.WhatIfService.applyTrade(copyH, copyOv, { name: 'A', action: 'add', amount: 1000, price: 20 });
assert(copyH[0].position === 2000, '加仓后持仓 2000');
assert(copyH[0].cost === (10 * 1000 + 20 * 1000) / 2000, '加权平均成本 = (10*1000+20*1000)/2000 = 15');
// 卖出清仓
const copyH2 = JSON.parse(JSON.stringify(baseHoldings));
A.WhatIfService.applyTrade(copyH2, copyOv, { name: 'A', action: 'sell', amount: 1000, price: 12 });
assert(copyH2[0].position === 0 && copyH2[0].cleared === 1, '全部卖出 → 清仓 cleared=1');
// 卖出超过持仓 → 校验失败
const vSell = A.WhatIfService.validateTrade('2026-10-04', { name: 'A', action: 'sell', amount: 2000, price: 12 });
// validateTrade 从 DB 取持仓，DB 中无 A → 报错持仓不存在
assert(!vSell.valid, '卖出不在 DB 持仓中的标的 → 校验失败');

console.log('\n==================================');
console.log('通过 ' + passed + ' / 失败 ' + failed);
console.log('==================================');
process.exit(failed ? 1 : 0);
