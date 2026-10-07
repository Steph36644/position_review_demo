/* ===== Controller：v1.3.1 DAQ-4 标的主数据编辑弹窗 + 持仓卡片入口 ===== */
window.App = window.App || {};

App.InstrumentController = (function () {
  const U = () => App.Utils;
  const C = () => App.Constants;
  const MODAL = 'instrumentModal';

  let editingName = null;
  let top10List = [];   // etf_top10 临时数组

  function showModal() {
    const m = document.getElementById(MODAL);
    if (!m) return;
    m.classList.remove('hidden');
    m.classList.add('flex');
  }
  function hideModal() {
    const m = document.getElementById(MODAL);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  }

  /** 填充标的下拉（持仓 name 集合，PRD §5.3 铁律 6：禁止自由输入） */
  function rebuildNameSelect(prefer) {
    const sel = document.getElementById('if-name');
    if (!sel) return;
    const names = App.InstrumentService.getAllHoldingNames();
    sel.innerHTML = '<option value="">请选择标的</option>' +
      names.map(n => '<option value="' + U().escapeHtml(n) + '">' + U().escapeHtml(n) + '</option>').join('');
    if (prefer && names.indexOf(prefer) >= 0) sel.value = prefer;
  }

  function fillForm(name) {
    editingName = name;
    const inst = App.InstrumentService.getInstrument(name);
    rebuildNameSelect(name);
    document.getElementById('if-industry').value = inst ? inst.industry : '';
    // style 单选
    document.querySelectorAll('input[name="if-style"]').forEach(r => {
      r.checked = inst ? (r.value === inst.style) : (r.value === '成长');
    });
    // market 单选
    document.querySelectorAll('input[name="if-market"]').forEach(r => {
      r.checked = inst ? (r.value === inst.market) : (r.value === '沪');
    });
    const isEtf = inst ? !!inst.is_etf : false;
    document.getElementById('if-isEtf').checked = isEtf;
    top10List = inst && inst.etf_top10 ? inst.etf_top10.slice() : [];
    renderTop10();
    toggleTop10Section();
    document.getElementById('if-errors').innerHTML = '';
  }

  function toggleTop10Section() {
    const sec = document.getElementById('if-top10Section');
    if (!sec) return;
    sec.classList.toggle('hidden', !document.getElementById('if-isEtf').checked);
  }

  function renderTop10() {
    const wrap = document.getElementById('if-top10List');
    if (!wrap) return;
    wrap.innerHTML = top10List.map((s, i) =>
      '<span class="inline-flex items-center gap-1 bg-slate-100 rounded px-2 py-1 text-xs text-slate-700">' +
      U().escapeHtml(s) +
      '<button type="button" data-top10-idx="' + i + '" class="text-slate-400 hover:text-red-600 ml-0.5">×</button>' +
      '</span>').join('');
  }

  function addTop10() {
    const input = document.getElementById('if-top10Input');
    const val = String(input.value || '').trim();
    if (!val) return;
    if (top10List.length >= 10) { U().toast('前十大成分股最多 10 只', 'warn'); return; }
    if (top10List.indexOf(val) >= 0) { U().toast('该成分股已存在', 'warn'); return; }
    top10List.push(val);
    input.value = '';
    renderTop10();
  }

  function readForm() {
    const styleEl = document.querySelector('input[name="if-style"]:checked');
    const marketEl = document.querySelector('input[name="if-market"]:checked');
    return {
      name: document.getElementById('if-name').value,
      industry: document.getElementById('if-industry').value,
      style: styleEl ? styleEl.value : '',
      market: marketEl ? marketEl.value : '',
      is_etf: document.getElementById('if-isEtf').checked,
      etf_top10: top10List.slice()
    };
  }

  function validateLive() {
    const input = readForm();
    const res = App.InstrumentService.validateInstrument(input);
    document.getElementById('if-errors').innerHTML =
      res.errors.map(e => '<p class="field-error">' + U().escapeHtml(e) + '</p>').join('');
    document.getElementById('if-save').disabled = !res.valid;
  }

  function openEditor(name) {
    if (name) {
      fillForm(name);
    } else {
      editingName = null;
      rebuildNameSelect();
      document.getElementById('if-industry').value = '';
      document.querySelectorAll('input[name="if-style"]').forEach(r => { r.checked = r.value === '成长'; });
      document.querySelectorAll('input[name="if-market"]').forEach(r => { r.checked = r.value === '沪'; });
      document.getElementById('if-isEtf').checked = false;
      top10List = [];
      renderTop10();
      toggleTop10Section();
      document.getElementById('if-errors').innerHTML = '';
    }
    showModal();
  }

  function save() {
    try {
      App.InstrumentService.saveInstrument(readForm());
      hideModal();
      U().toast('主数据已保存，切片/重叠/告警已即时重算', 'success');
    } catch (e) {
      U().toast(e.message || '保存失败', 'error');
    }
  }

  function init() {
    // 行业预置列表
    const dl = document.getElementById('industryList');
    if (dl) {
      dl.innerHTML = C().INDUSTRY_PRESET.map(n => '<option value="' + U().escapeHtml(n) + '">').join('');
    }

    // 批量入口按钮
    const mgrBtn = document.getElementById('btnInstrumentMgr');
    if (mgrBtn) mgrBtn.addEventListener('click', () => openEditor(null));

    // ETF 开关联动成分股区
    const isEtfEl = document.getElementById('if-isEtf');
    if (isEtfEl) isEtfEl.addEventListener('change', toggleTop10Section);

    // 成分股添加
    const addBtn = document.getElementById('if-top10Add');
    const input = document.getElementById('if-top10Input');
    if (addBtn) addBtn.addEventListener('click', addTop10);
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTop10(); } });

    // 成分股删除（事件委托）
    const listWrap = document.getElementById('if-top10List');
    if (listWrap) listWrap.addEventListener('click', e => {
      const btn = e.target.closest('[data-top10-idx]');
      if (btn) {
        top10List.splice(Number(btn.getAttribute('data-top10-idx')), 1);
        renderTop10();
      }
    });

    // 实时校验
    ['if-name', 'if-industry', 'if-isEtf'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', validateLive);
      if (el) el.addEventListener('change', validateLive);
    });
    document.querySelectorAll('input[name="if-style"], input[name="if-market"]').forEach(r => {
      r.addEventListener('change', validateLive);
    });

    document.getElementById('if-save').addEventListener('click', save);

    // 通用关闭
    document.getElementById(MODAL).addEventListener('click', e => {
      if (e.target.closest('.modal-close-btn')) hideModal();
    });
  }

  return { init, openEditor };
})();
