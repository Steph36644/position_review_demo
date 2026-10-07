/* ===== 应用入口：初始化编排 + Tab 切换 ===== */
window.App = window.App || {};

App.App = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  const TAB_SECTIONS = {
    dashboard: 'tab-dashboard',
    trades: 'tab-trades',
    reconciliation: 'tab-reconciliation',
    review: 'tab-review'
  };

  function switchTab(tab) {
    Object.keys(TAB_SECTIONS).forEach(k => {
      document.getElementById(TAB_SECTIONS[k]).classList.toggle('hidden', k !== tab);
    });
    document.querySelectorAll('#tabNav .tab-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });

    // 进入依赖 trades/holdings 的 Tab 时刷新
    if (tab === 'trades') {
      App.TradeListController.render(document.getElementById('tradeSearch').value);
    } else if (tab === 'reconciliation') {
      App.ReconciliationController.render();
    } else if (tab === 'review') {
      // 复盘日期默认跟随看板日期
      const d = App.DashboardController.getDate();
      if (d) App.ReviewController.load(d);
    } else if (tab === 'dashboard') {
      App.DashboardController.renderAll();
    }
  }

  function initTabs() {
    document.getElementById('tabNav').addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if (btn) switchTab(btn.getAttribute('data-tab'));
    });
  }

  function boot() {
    // 1. 载入存储（localStorage 优先，首次使用种子数据）
    App.LocalStorageRepo.init(App.Seed || null);

    // 1.5 首次使用种子数据时，持久化到 localStorage（避免只在内存中）
    // 注意：Migration.run() 会写 version 标记，所以要在它之前检查 trades 是否为空
    if (!localStorage.getItem(C().LS_KEYS.trades)) {
      App.LocalStorageRepo.saveTrades();
      console.info('种子交易数据已播种：', App.LocalStorageRepo.getDB().trades.length, '条');
    }

    // 2. v0.0 → v1.1 数据迁移（只执行一次）
    try {
      App.Migration.run();
      // 迁移可能只保存 holdings/overview/reviews，trades 需再次确保持久化
      if (!localStorage.getItem(C().LS_KEYS.trades)) {
        App.LocalStorageRepo.saveTrades();
      }
    } catch (e) {
      console.warn('迁移过程出现问题，已继续启动', e);
    }

    // 3. 构建内存索引
    App.IndexManager.rebuild(App.LocalStorageRepo.getDB().trades);

    // 3.5 仓位计划默认值兜底（v1.2：不存在或损坏时写入默认计划）
    try {
      App.PlanService.initDefault();
    } catch (e) {
      console.warn('仓位计划初始化出现问题，已继续启动', e);
    }

    // 4. 控制器初始化
    App.DashboardController.init();
    App.TradeListController.init();
    App.TradeForm.init();
    App.ReconciliationController.init();
    App.ReviewController.init();
    App.SnapshotController.init();
    App.ManualEntry.init();
    App.DataManage.init();
    App.PlanSettings.init();
    App.AlertBannerController.init();
    App.MarketTempController.init();
    // v1.3.1：主数据 / ETF 重叠 / What-If
    App.InstrumentController.init();
    App.EtfOverlapController.init();
    App.WhatIfController.init();

    // 5. Tab 与首屏
    initTabs();
    switchTab('dashboard');
    // v1.2.3：大盘温度跟随看板日期
    const d0 = App.DashboardController.getDate();
    if (d0) App.MarketTempController.setDate(d0);
    // v1.3.1：ETF 重叠检测首屏渲染
    if (d0) App.EtfOverlapController.render();

    console.info('%c持仓复盘工具 ' + C().APP_VERSION + ' 启动完成',
      'color:#e8ebf2;font-weight:bold');
  }

  return { boot, switchTab };
})();

document.addEventListener('DOMContentLoaded', () => App.App.boot());
