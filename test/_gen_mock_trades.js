/* 一次性脚本：生成 v1.1.1 模拟交易数据集并注入 js/data/seed.js，运行后删除 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { throw new Error('FAIL: ' + msg); }
}

/* ---------- 基础字典 ---------- */
const CP = [
  '华泰证券股份有限公司（做市商席位 A88012）',
  '中信证券股份有限公司（做市商席位 A88105）',
  '国泰君安证券股份有限公司（做市商席位 A80233）',
  '招商证券股份有限公司（竞价交易席位 B60318）',
  '海通证券股份有限公司（做市商席位 A87651）',
  '广发证券股份有限公司（做市商席位 A83320）',
  '申万宏源证券有限公司（竞价交易席位 B61207）',
  '中信建投证券股份有限公司（做市商席位 A85490）',
  '兴业证券股份有限公司（竞价交易席位 B62880）',
  '中国证券金融股份有限公司（转融通专用席位）'
];

const B = {
  H_B1: {
    reason: '恒生科技回踩20日线获支撑，MACD水下金叉，超跌反弹窗口，按计划建底仓',
    rtype: '技术面', period: '中期(1-3月)',
    invalid: '放量跌破0.552前低且南向资金连续5日净流出，反弹逻辑失效',
    tlow: 0.60, thigh: 0.65, stop: 0.552
  },
  H_B2: {
    reason: '指数回落至0.544前期密集成交区，RSI进入超卖区间，博弈技术性反弹加仓',
    rtype: '技术面', period: '短期(<1月)',
    invalid: '反弹无量且收盘跌破0.528，超跌反弹逻辑被否',
    tlow: 0.575, thigh: 0.60, stop: 0.528
  },
  H_B3: {
    reason: '尾盘情绪修复，挂0.5420限价单博节后开门红，当日未成交',
    rtype: '情绪', period: '短期(<1月)',
    invalid: '节后低开跌破0.528且成交量继续萎缩',
    tlow: 0.575, thigh: 0.60, stop: 0.528
  },
  D_B1: {
    reason: '红利ETF股息率回升至6%上方，3.35以下估值具备防御配置价值',
    rtype: '估值', period: '长期(>6月)',
    invalid: '10年期国债收益率快速上行导致股息优势收敛，或收盘跌破3.30',
    tlow: 3.42, thigh: 3.46, stop: 3.30
  },
  D_B2: {
    reason: '回调至3.342，股息率吸引力进一步提升，按网格计划补仓一档',
    rtype: '估值', period: '中期(3-6月)',
    invalid: '跌破3.29且红利低波指数相对收益转负',
    tlow: 3.42, thigh: 3.48, stop: 3.29
  },
  D_B3: {
    reason: '早盘挂3.335限价买单，价格全天未触及，午后撤单观望',
    rtype: '估值', period: '中期(3-6月)',
    invalid: '跌破3.29或社融数据低于预期',
    tlow: 3.40, thigh: 3.46, stop: 3.29
  },
  K_B1: {
    reason: '科创50成分股Q2业绩预告向好，半导体设备订单超预期，估值处于年内低位',
    rtype: '基本面', period: '中期(3-6月)',
    invalid: '半年报业绩不及预期或放量跌破1.62支撑位',
    tlow: 1.85, thigh: 1.95, stop: 1.62
  },
  K_B2: {
    reason: '指数急跌至1.614关键支撑，计划加仓60000股摊低成本，实际成交40000股',
    rtype: '技术面', period: '中期(1-3月)',
    invalid: '有效跌破1.57且北向资金持续流出',
    tlow: 1.75, thigh: 1.85, stop: 1.57
  },
  G_B1: {
    reason: '创新药医保谈判与集采政策预期催化，板块资金连续净流入，事件驱动建仓',
    rtype: '事件', period: '短期(<1月)',
    invalid: '医保谈判降价超预期或跌破1.22平台',
    tlow: 1.40, thigh: 1.50, stop: 1.22
  },
  G_B2: {
    reason: '龙头中报超预期确认景气度，板块回调至1.357按计划二次布局',
    rtype: '基本面', period: '中期(3-6月)',
    invalid: '放量跌破1.30且行业基本面高频数据走弱',
    tlow: 1.45, thigh: 1.55, stop: 1.30
  }
};

/* ---------- 交易计划（23 笔，时间顺序即数组顺序） ---------- */
// bk: buy key（元数据）; links: [[buyId, qty], ...]; st: filled/partial/pending/cancelled
const plan = [
  ['G_B1', '2026-09-01', '09:40:11', '港股通创新药', 'buy',   100000, 1.288,  'filled',   null, null, []],
  ['H_B1', '2026-09-02', '09:35:10', '恒生科技',     'buy',   100000, 0.574,  'filled',   null, null, []],
  ['K_B1', '2026-09-02', '13:05:11', '科创50',       'buy',   80000,  1.7083, 'filled',   null, null, []],
  ['D_B1', '2026-09-03', '10:02:11', '红利ETF',      'buy',   60000,  3.348,  'filled',   null, null, []],
  ['H',    '2026-09-04', '10:15:22', '恒生科技',     'reduce',40000,  0.5807, 'filled', '兑现', '反弹至0.581目标区下沿，按计划兑现40000股', [['H_B1', 40000]]],
  ['D_B3', '2026-09-10', '09:42:06', '红利ETF',      'buy',   20000,  3.335,  'cancelled', null, null, []],
  ['D',    '2026-09-11', '13:40:22', '红利ETF',      'sell',  20000,  3.3368, 'filled', '失效', '跌破3.34支撑且红利风格走弱，持有逻辑失效，先减20000股', [['D_B1', 20000]]],
  ['G',    '2026-09-11', '14:35:22', '港股通创新药', 'reduce',40000,  1.229,  'filled', '证伪', '政策利好兑现后连续回调至1.229，事件驱动逻辑证伪减仓40000股', [['G_B1', 40000]]],
  ['K_B2', '2026-09-14', '14:25:33', '科创50',       'add',   40000,  1.614,  'partial',  null, null, []],
  ['H_B2', '2026-09-15', '14:20:33', '恒生科技',     'add',   50000,  0.544,  'filled',   null, null, []],
  ['D_B2', '2026-09-15', '10:10:33', '红利ETF',      'add',   40000,  3.342,  'filled',   null, null, []],
  ['K',    '2026-09-16', '09:55:22', '科创50',       'reduce',30000,  1.7058, 'filled', '兑现', '反弹至1.706，先兑现30000股锁定反弹收益', [['K_B1', 30000]]],
  ['K',    '2026-09-17', '13:15:55', '科创50',       'sell',  20000,  1.6955, 'filled', '证伪', '反弹一日游且量价背离，业绩逻辑短期证伪，再减20000股', [['K_B1', 20000]]],
  ['G',    '2026-09-21', '10:15:33', '港股通创新药', 'clear', 60000,  1.364,  'filled', '兑现', '大涨5.49%至1.364到达目标区，清仓剩余60000股', [['G_B1', 60000]]],
  ['H',    '2026-09-21', '09:45:44', '恒生科技',     'sell',  30000,  0.5591, 'filled', '兑现', '反弹至0.559先落袋加仓部分30000股', [['H_B2', 30000]]],
  ['G_B2', '2026-09-22', '09:50:44', '港股通创新药', 'buy',   50000,  1.357,  'filled',   null, null, []],
  ['D',    '2026-09-22', '09:35:44', '红利ETF',      'reduce',40000,  3.3826, 'filled', '兑现', '冲高至3.383阶段目标，分批兑现40000股（两笔买入各20000股）', [['D_B1', 20000], ['D_B2', 20000]]],
  ['D',    '2026-09-23', '14:05:55', '红利ETF',      'sell',  40000,  3.3534, 'filled', '兑现', '冲高分批兑现剩余40000股，两笔建仓全部闭环', [['D_B1', 20000], ['D_B2', 20000]]],
  ['K',    '2026-09-23', '10:25:44', '科创50',       'clear', 30000,  1.7537, 'filled', '兑现', '反弹至1.754目标区，清仓首笔建仓中剩余的30000股', [['K_B1', 30000]]],
  ['H',    '2026-09-24', '13:30:55', '恒生科技',     'sell',  20000,  0.5514, 'filled', '证伪', '反弹量能不足且外资持续流出，加仓逻辑证伪，卖掉加仓剩余20000股', [['H_B2', 20000]]],
  ['K',    '2026-09-24', '11:05:07', '科创50',       'sell',  10000,  1.7127, 'filled', '违规', '未按计划情绪化操作：盘中追高买入后恐慌卖出10000股', []],
  ['H_B3', '2026-09-28', '14:50:06', '恒生科技',     'add',   30000,  0.5423, 'pending',  null, null, []],
  ['G',    '2026-09-28', '13:20:55', '港股通创新药', 'reduce',20000,  1.318,  'pending', '失效', '跌破1.32短线支撑，挂1.318减仓20000股，当日未成交', []]
];

const BUY_ACTIONS = ['buy', 'add'];
const SELL_ACTIONS = ['sell', 'reduce', 'clear'];
const EFFECTIVE = ['filled', 'partial'];
const idMap = {};

function iso(date, hms, deltaSec) {
  const [y, m, d] = date.split('-').map(Number);
  let [hh, mm, ss] = hms.split(':').map(Number);
  const total = Date.UTC(y, m - 1, d, hh - 8, mm, ss) + (deltaSec || 0) * 1000;
  return new Date(total).toISOString();
}

function makeId(date, hms, suffix) {
  const p = n => String(n).padStart(2, '0');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = hms.split(':').map(Number);
  return 't' + String(y).slice(2) + p(m) + p(d) + p(hh) + p(mm) + p(ss) + suffix;
}

/* ---------- 构造交易对象（字段与 models.createTrade 输出一致） ---------- */
const trades = plan.map((row, i) => {
  const [bk, date, hms, name, action, qty, price, status, sellType, note, links] = row;
  const isBuy = BUY_ACTIONS.includes(action);
  const buyKey = isBuy ? bk : null;
  if (isBuy) {
    idMap[bk] = makeId(date, hms, 'a' + String(i + 1).padStart(2, '0'));
  }
  const t = {
    id: isBuy ? idMap[bk] : makeId(date, hms, 'b' + String(i + 1).padStart(2, '0')),
    date,
    trade_time: hms.slice(0, 5),
    name,
    action,
    amount: qty,
    price,
    trade_amount: Math.round(qty * price * 100) / 100,
    status,
    counterparty: CP[i % CP.length],
    buy_reason: null, reason_type: null, expected_period: null,
    invalid_condition: null, target_price_low: null, target_price_high: null, stop_loss: null,
    sell_type: null, sell_note: null,
    linked_buy_ids: [], linked_qty_map: {},
    created_at: iso(date, hms),
    updated_at: iso(date, hms)
  };
  if (isBuy) {
    const meta = B[buyKey];
    t.buy_reason = meta.reason;
    t.reason_type = meta.rtype;
    t.expected_period = meta.period;
    t.invalid_condition = meta.invalid;
    t.target_price_low = meta.tlow;
    t.target_price_high = meta.thigh;
    t.stop_loss = meta.stop;
  } else {
    t.sell_type = sellType;
    t.sell_note = note;
    if (sellType !== '违规' && EFFECTIVE.includes(status)) {
      links.forEach(([bk2, q]) => {
        t.linked_buy_ids.push(idMap[bk2]);
        t.linked_qty_map[idMap[bk2]] = q;
      });
    }
  }
  return t;
});

/* 制造一笔“已修改”记录（H-S1 卖出当日盘后被编辑过，用于列表“已修改”标记测试） */
const hs1 = trades.find(t => t.date === '2026-09-04' && t.action === 'reduce');
hs1.updated_at = iso('2026-09-04', '15:02:33');

/* ---------- 读取现有 seed，做总市值基准与日期校验 ---------- */
const seedPath = path.resolve(__dirname, '../js/data/seed.js');
const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(seedPath, 'utf8'), sandbox, { filename: 'seed.js' });
const oldSeed = sandbox.App.Seed;

/* 价格波动带：来自 holdings 各标的历史 current_price */
const band = {};
Object.keys(oldSeed.holdings).forEach(d => {
  oldSeed.holdings[d].forEach(h => {
    if (!band[h.name]) band[h.name] = { min: h.current_price, max: h.current_price };
    band[h.name].min = Math.min(band[h.name].min, h.current_price);
    band[h.name].max = Math.max(band[h.name].max, h.current_price);
  });
});

/* ---------- 不变量校验 ---------- */
const ids = new Set();
const consumedByBuy = {};
const actions = new Set(), sellTypes = new Set(), statuses = new Set(),
  rtypes = new Set(), periods = new Set(), names = new Set();

trades.forEach(t => {
  assert(!ids.has(t.id), 'id 唯一: ' + t.id);
  ids.add(t.id);
  assert(oldSeed.dates.includes(t.date), '日期在行情日期内: ' + t.date);
  assert(Number.isInteger(t.amount) && t.amount > 0, '数量正整数');
  assert(t.price > 0 && t.trade_amount === Math.round(t.amount * t.price * 100) / 100,
    '交易金额=数量×价格: ' + t.id);
  assert(typeof t.counterparty === 'string' && t.counterparty.length > 5, '对手方非空: ' + t.id);
  assert(/^\d{2}:\d{2}$/.test(t.trade_time), '交易时间 HH:MM: ' + t.id);
  actions.add(t.action); statuses.add(t.status); names.add(t.name);

  if (EFFECTIVE.includes(t.status) && band[t.name]) {
    assert(t.price >= band[t.name].min && t.price <= band[t.name].max,
      '成交价在历史波动带内: ' + t.id + ' ' + t.price + ' vs ' + JSON.stringify(band[t.name]));
  }

  if (BUY_ACTIONS.includes(t.action)) {
    rtypes.add(t.reason_type); periods.add(t.expected_period);
    assert(['基本面', '技术面', '事件', '估值', '情绪'].includes(t.reason_type), '理由类型合法');
    assert(['短期(<1月)', '中期(1-3月)', '中期(3-6月)', '长期(>6月)'].includes(t.expected_period), '周期合法');
    assert(t.buy_reason && t.buy_reason.length <= 100, '买入理由合法');
    assert(t.invalid_condition && t.invalid_condition.length <= 100, '失效条件合法');
    assert(t.target_price_low > 0 && t.target_price_high >= t.target_price_low && t.stop_loss > 0, '目标/止损合法');
    consumedByBuy[t.id] = 0;
  } else {
    sellTypes.add(t.sell_type);
    assert(['兑现', '证伪', '失效', '违规'].includes(t.sell_type), '卖出分类合法');
    assert(t.sell_note && t.sell_note.length >= 1, '卖出说明非空');
    if (t.sell_type === '违规') {
      assert(t.linked_buy_ids.length === 0 && t.sell_note.length >= 5, '违规不关联买入且说明≥5字');
    } else if (EFFECTIVE.includes(t.status)) {
      assert(t.linked_buy_ids.length >= 1, '非违规卖出必须关联买入: ' + t.id);
      const sum = t.linked_buy_ids.reduce((s, bid) => s + t.linked_qty_map[bid], 0);
      assert(sum === t.amount, '配比之和=卖出数量: ' + t.id);
      t.linked_buy_ids.forEach(bid => {
        assert(consumedByBuy[bid] !== undefined, '关联对象必须是已存在买入: ' + t.id);
        consumedByBuy[bid] += t.linked_qty_map[bid];
      });
    }
  }
});

Object.keys(consumedByBuy).forEach(bid => {
  const buy = trades.find(t => t.id === bid);
  assert(consumedByBuy[bid] <= buy.amount, '累计消耗不超过买入量: ' + bid);
});

/* 覆盖率 */
assert(trades.length >= 12, '至少12条（实际 ' + trades.length + '）');
assert(actions.size === 5, '覆盖5种交易方向');
assert(sellTypes.size === 4, '覆盖4种卖出分类');
assert(statuses.size === 4, '覆盖4种交易状态');
assert(rtypes.size === 5, '覆盖5种理由类型');
assert(periods.size === 4, '覆盖4种持有周期');
assert(names.size === 4, '覆盖4个持仓标的');

/* 闭环分布：CLOSED 5 / PARTIAL 1 / OPEN 2（仅有效买入） */
const closure = { OPEN: [], PARTIAL: [], CLOSED: [] };
trades.filter(t => BUY_ACTIONS.includes(t.action) && EFFECTIVE.includes(t.status)).forEach(t => {
  const c = consumedByBuy[t.id];
  const s = c <= 0 ? 'OPEN' : (c >= t.amount ? 'CLOSED' : 'PARTIAL');
  closure[s].push(t.name + ' ' + t.date);
});
assert(closure.CLOSED.length === 5, 'CLOSED=5: ' + closure.CLOSED.join(','));
assert(closure.PARTIAL.length === 1, 'PARTIAL=1: ' + closure.PARTIAL.join(','));
assert(closure.OPEN.length === 2, 'OPEN=2: ' + closure.OPEN.join(','));

/* ---------- 注入 seed.js（幂等：先剥离旧注入） ---------- */
let src = fs.readFileSync(seedPath, 'utf8');
src = src.replace(/App\.Seed = \{"trades":[\s\S]*?\],"dates":/, 'App.Seed = {"dates":');
const token = 'App.Seed = {"dates":';
assert(src.includes(token), 'seed 定位标记存在');
src = src.replace(token, 'App.Seed = {"trades":' + JSON.stringify(trades) + ',"dates":');
fs.writeFileSync(seedPath, src);

/* ---------- 注入后回读校验 ---------- */
const sb2 = { console };
sb2.window = sb2;
vm.createContext(sb2);
vm.runInContext(fs.readFileSync(seedPath, 'utf8'), sb2);
const seed2 = sb2.App.Seed;
assert(seed2.trades.length === trades.length, '回读交易条数一致');
assert(seed2.dates.length === oldSeed.dates.length, 'dates 未改动（' + seed2.dates.length + '）');
assert(Object.keys(seed2.holdings).length === Object.keys(oldSeed.holdings).length, 'holdings 日期数未改动');
assert(Object.keys(seed2.overview).length === Object.keys(oldSeed.overview).length, 'overview 日期数未改动');
assert(seed2.overview['2026-09-28'].market_value === 147740, '虚构演示 09-28 总市值');
assert(seed2.holdings['2026-09-28'].find(h => h.name === '恒生科技').market_value === 32538, '虚构演示 09-28 恒生科技市值');
assert(seed2.overview['2026-09-21'].total_assets === 486821, '虚构演示 09-21 总资产');

console.log('全部 ' + passed + ' 项校验通过，已注入 ' + trades.length + ' 条模拟交易');
console.log('闭环分布 CLOSED=' + closure.CLOSED.length + ' PARTIAL=' + closure.PARTIAL.length + ' OPEN=' + closure.OPEN.length);
