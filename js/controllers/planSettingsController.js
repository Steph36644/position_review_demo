/* ===== Controller：v1.2 P1-1 仓位计划与告警阈值设置弹窗 ===== */
window.App = window.App || {};

App.PlanSettings = (function () {
  const U = () => App.Utils;
  const MODAL = 'planModal';

  const FIELDS = ['pf-bandLo', 'pf-bandHi', 'pf-singleMax', 'pf-industryMax', 'pf-cashMin'];

  function showModal() {
    const m = document.getElementById(MODAL);
    m.classList.remove('hidden');
    m.classList.add('flex');
  }
  function hideModal() {
    const m = document.getElementById(MODAL);
    m.classList.add('hidden');
    m.classList.remove('flex');
  }

  function readInput() {
    return {
      total_position_band: [
        document.getElementById('pf-bandLo').value,
        document.getElementById('pf-bandHi').value
      ],
      single_position_max: document.getElementById('pf-singleMax').value,
      single_industry_max: document.getElementById('pf-industryMax').value,
      cash_min: document.getElementById('pf-cashMin').value
    };
  }

  /** 实时校验：非法输入 → 保存按钮禁用 + 红字提示（PRD §3.1.3） */
  function validateLive() {
    const input = readInput();
    const res = App.PlanService.validatePlan(input);
    document.getElementById('pf-errors').innerHTML =
      res.errors.map(e => '<p class="field-error">' + U().escapeHtml(e) + '</p>').join('');
    // 非法字段红框
    const badBand = res.errors.some(e => e.indexOf('仓位带') >= 0);
    document.getElementById('pf-bandLo').classList.toggle('invalid', badBand);
    document.getElementById('pf-bandHi').classList.toggle('invalid', badBand);
    document.getElementById('pf-singleMax').classList.toggle('invalid',
      res.errors.some(e => e.indexOf('单标的') >= 0));
    document.getElementById('pf-industryMax').classList.toggle('invalid',
      res.errors.some(e => e.indexOf('单行业') >= 0));
    document.getElementById('pf-cashMin').classList.toggle('invalid',
      res.errors.some(e => e.indexOf('现金') >= 0));
    document.getElementById('pf-save').disabled = !res.valid;
  }

  function open() {
    const plan = App.PlanService.getPlan();
    document.getElementById('pf-bandLo').value = plan.total_position_band[0];
    document.getElementById('pf-bandHi').value = plan.total_position_band[1];
    document.getElementById('pf-singleMax').value = plan.single_position_max;
    document.getElementById('pf-industryMax').value = plan.single_industry_max;
    document.getElementById('pf-cashMin').value = plan.cash_min;
    validateLive();
    showModal();
  }

  function save() {
    try {
      const plan = App.PlanService.savePlan(readInput());
      hideModal();
      U().toast('仓位计划已保存（水位/告警已按新阈值重算）', 'success');
      return plan;
    } catch (e) {
      U().toast(e.message || '保存失败', 'error');
      return null;
    }
  }

  function init() {
    // 入口 1：水位卡片右上角；入口 2：顶部工具区
    const btn1 = document.getElementById('btnPlanSettings');
    const btn2 = document.getElementById('btnPlanSettings2');
    if (btn1) btn1.addEventListener('click', open);
    if (btn2) btn2.addEventListener('click', open);
    FIELDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', validateLive);
    });
    document.getElementById('pf-save').addEventListener('click', save);
    // 通用关闭（取消按钮 / 右上角 / 遮罩点击）
    document.getElementById(MODAL).addEventListener('click', e => {
      if (e.target.closest('.modal-close-btn')) hideModal();
    });
  }

  return { init, open };
})();
