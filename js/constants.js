/* ===== 常量与枚举（v1.1） ===== */
window.App = window.App || {};

App.Constants = {
  // 交易方向
  ACTIONS: { BUY: 'buy', ADD: 'add', SELL: 'sell', REDUCE: 'reduce', CLEAR: 'clear' },
  BUY_ACTIONS: ['buy', 'add'],
  SELL_ACTIONS: ['sell', 'reduce', 'clear'],
  ACTION_LABELS: { buy: '新建买入', add: '加仓', sell: '卖出', reduce: '减仓', clear: '清仓' },

  // R2 卖出四分类
  SELL_TYPES: ['兑现', '证伪', '失效', '违规'],
  VIOLATION_TYPE: '违规',

  // 交易状态（模拟数据/委托单生命周期；仅 filled/partial 参与持仓与对账计算）
  TRADE_STATUS: { FILLED: 'filled', PARTIAL: 'partial', PENDING: 'pending', CANCELLED: 'cancelled' },
  TRADE_STATUS_LABELS: { filled: '已成交', partial: '部分成交', pending: '未成交', cancelled: '已撤单' },
  EFFECTIVE_TRADE_STATUSES: ['filled', 'partial'],

  // R1 理由类型 / 持有周期
  REASON_TYPES: ['基本面', '技术面', '事件', '估值', '情绪'],
  EXPECTED_PERIODS: ['短期(<1月)', '中期(1-3月)', '中期(3-6月)', '长期(>6月)'],

  // DAQ-6 OCR 状态 / 闭环状态
  OCR_STATUS: { SUCCESS: 'success', PARTIAL: 'partial', FAILED: 'failed', SKIPPED: 'skipped' },
  CLOSURE_STATUS: { OPEN: 'OPEN', PARTIAL: 'PARTIAL', CLOSED: 'CLOSED' },

  // 阈值
  OCR_CONFIDENCE_THRESHOLD: 0.7,
  OCR_TIMEOUT_MS: 90000,
  MAX_IMAGE_SIZE: 5 * 1024 * 1024,
  ANOMALY_CHANGE_RATIO: 0.5,

  // localStorage keys
  LS_KEYS: {
    overview: 'pr2_overview',
    holdings: 'pr2_holdings',
    trades: 'pr2_trades',
    reviews: 'pr2_reviews',
    snapshots: 'pr2_snapshots',
    plan: 'pr2_plan',
    market_data: 'pr2_market_data',   // v1.2.3：大盘行情 + 温度
    instruments: 'pr2_instruments',   // v1.3.1：标的主数据
    version: 'pr2_version',
    mockVersion: 'pr2_mock_version',
    backup: 'pr2_backup_v0'
  },

  // ===== v1.2 仓位计划（P1-1 / DAQ-3）=====
  // 默认值仅用于首次初始化写入 plan，之后一切判定以用户设置值为准（阈值可设置强约束）
  PLAN_DEFAULTS: {
    total_position_band: [60, 80],
    single_position_max: 25,
    single_industry_max: 30,   // v1.3 行业数据落地后生效，v1.2 仅存储
    cash_min: 15
  },
  PLAN_LIMITS: { bandMin: 0, bandMax: 100 },

  // ===== v1.2.3 大盘温度（市场环境评估）=====
  // 新口径：总温度 = 指数位置 50% + 量能 50%，锚点间线性插值，0 封底 100 封顶
  // 核心公式：建议仓位中枢 = 100 − 温度（每日收盘后计算，次日生效）
  MARKET_TEMP_DEFAULTS: {
    index_code: 'sh000001',       // 沪：上证指数（价格口径 + 沪市成交额）
    index_name: '上证指数',
    index2_code: 'sz399106',      // 深：深证综指（国证深证综指口径，仅取成交额）
    lookback_days: 260,           // 拉取 K 线天数（需覆盖 MA200 与 250 日均额）
    weights: {                    // 各维度权重（内部归一化）
      index: 0.5,                 // 指数位置：收盘对 40 周线（≈MA200 交易日）乖离率
      volume: 0.5                 // 量能：5 日均成交额 ÷ 250 日均成交额（沪深两市合计）
    },
    // 指数位置锚点：乖离率(%) → 维度温度
    index_anchors: [
      [-15, 0], [0, 50], [15, 100]
    ],
    index_ma_period: 200,         // 40 周线 ≈ 200 个交易日
    // 量能锚点：量比（5日均额 / 250日均额）→ 维度温度
    volume_anchors: [
      [0.5, 0], [1.0, 50], [1.5, 100]
    ],
    volume_ma_short: 5,
    volume_ma_long: 250,
    status_thresholds: {          // 温度分档（0-100，展示用）
      cold: 25,                   // < 25 冷
      cool: 50,                   // 25-50 凉
      warm: 75,                   // 50-75 温
      hot: 100                    // 75-100 热
    },
    // 特殊风控区间（严格不等号）
    special_zones: {
      freezing: 20,               // < 20 极寒区：允许打满 90%+
      overheat: 80                // > 80 过热区：只卖不买
    }
  },
  MARKET_TEMP_STATUS: { COLD: 'cold', COOL: 'cool', WARM: 'warm', HOT: 'hot' },
  MARKET_TEMP_STATUS_LABEL: { cold: '冷', cool: '凉', warm: '温', hot: '热' },
  // 特殊区间标签与动作提示
  MARKET_TEMP_ZONE: {
    FREEZING: 'freezing',
    OVERHEAT: 'overheat',
    LABEL: {
      freezing: '极寒区 · 可打满 90%+，接受先阴跌',
      overheat: '过热区 · 只卖不买，新信号放弃'
    }
  },

  // ===== v1.2 盈亏归因标签（S2 / DAA-4）=====
  ATTRIBUTION: {
    IN_HOLD:   '体系内-持有',
    IN_CASHIN: '体系内-兑现',
    IN_RISK:   '体系内-风控',
    OUT_VIOL:  '体系外-违规',
    OUT_MISS:  '体系外-判断失误',
    PENDING:   '待归因'
  },
  ATTRIBUTION_IN:  ['体系内-持有', '体系内-兑现', '体系内-风控'],
  ATTRIBUTION_OUT: ['体系外-违规', '体系外-判断失误'],
  // 违规锁定标的的唯一可选集合（防洗白验收铁律）
  ATTRIBUTION_VIOLATION_LOCKED: ['体系外-违规', '体系外-判断失误'],

  // ===== v1.2 告警维度（DAA-3 维度注册表 key；industry/style 为 v1.3 占位）=====
  ALERT_DIMS: { POSITION: 'position', SINGLE: 'single', CASH: 'cash', INDUSTRY: 'industry' },
  WATER_STATUS: { IN: 'in', ABOVE: 'above', BELOW: 'below' },

  // ===== v1.3.1 标的主数据（DAQ-4）=====
  // 行业预置（申万一级 + 恒生分类 + 指数基金/未分类；用户可自定义输入）
  INDUSTRY_PRESET: ['电力设备', '医药生物', '食品饮料', '电子', '计算机', '传媒',
    '机械设备', '汽车', '有色金属', '化工', '银行', '非银金融',
    '房地产', '建筑材料', '国防军工', '农林牧渔', '纺织服饰',
    '商贸零售', '社会服务', '综合', '指数基金', '未分类'],
  // 风格（5 类固定枚举，单选）
  STYLE: { DIVIDEND: '红利', GROWTH: '成长', VALUE: '价值', CYCLICAL: '周期', THEME: '主题' },
  STYLE_LIST: ['红利', '成长', '价值', '周期', '主题'],
  STYLE_COLOR: { '红利': '#f59e0b', '成长': '#dc2626', '价值': '#2563eb', '周期': '#6b7280', '主题': '#9333ea' },
  // 市场
  MARKET: { SH: '沪', SZ: '深', HK: '港', US: '美' },
  MARKET_LIST: ['沪', '深', '港', '美'],
  // ETF 重叠检测阈值（重叠度 > 15% 触发提醒）
  ETF_OVERLAP_THRESHOLD: 0.15,

  // 内置模拟数据集版本（变化时启动阶段会用 seed 交易数据替换本地测试交易）
  MOCK_DATA_VERSION: 'mock-2026-10-02-1',

  // IndexedDB
  DB_NAME: 'pr2_indexeddb',
  DB_VERSION: 1,
  IMAGE_STORE: 'images',

  APP_VERSION: 'v1.3.1',
  SCHEMA_VERSION: 'v1.3'
};
