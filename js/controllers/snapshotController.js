/* ===== Controller：DAQ-6 截图上传 → OCR → 预填确认表格 → 落库 ===== */
window.App = window.App || {};

App.SnapshotController = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  let processing = false;
  // v1.1.2：overview 区仅保留总资产输入，其余字段由持仓聚合计算
  const OVERVIEW_FIELDS = [
    { key: 'total_assets', label: '总资产' }
  ];

  /* ---------- 文件校验 ---------- */
  function validateFile(file) {
    const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!okTypes.includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      return '不支持的文件格式，仅支持 JPG / PNG / WEBP';
    }
    if (file.size === 0) return '文件内容为空';
    if (file.size > C().MAX_IMAGE_SIZE) {
      return '文件超过 5MB（当前 ' + (file.size / 1024 / 1024).toFixed(2) + 'MB），请压缩后重试';
    }
    return null;
  }

  /* ---------- 图像预处理（放大 + 灰度） ---------- */
  function preprocess(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          // 手机截图文字小：目标宽 2400px（上限 3 倍），已足够大则不放大
          const scale = img.width < 2000 ? Math.min(3, 2400 / img.width) : 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const px = data.data;
          // 1) 灰度（红涨绿跌/蓝色负数文字统一转为暗色）
          const gray = new Uint8Array(px.length / 4);
          for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          }
          // 2) Otsu 全局二值化（截图背景单一，比灰度图对小字号识别更稳）
          const hist = new Array(256).fill(0);
          for (let j = 0; j < gray.length; j++) hist[gray[j]]++;
          const total = gray.length;
          let sum = 0;
          for (let t = 0; t < 256; t++) sum += t * hist[t];
          let sumB = 0, wB = 0, maxVar = 0, threshold = 127;
          for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (!wB) continue;
            const wF = total - wB;
            if (!wF) break;
            sumB += t * hist[t];
            const mB = sumB / wB, mF = (sum - sumB) / wF;
            const v = wB * wF * (mB - mF) * (mB - mF);
            if (v > maxVar) { maxVar = v; threshold = t; }
          }
          for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
            const v = gray[j] > threshold ? 255 : 0;
            px[i] = px[i + 1] = px[i + 2] = v;
            px[i + 3] = 255;
          }
          ctx.putImageData(data, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  /* ---------- 状态/进度 UI ---------- */
  function setStatus(show, label, pct) {
    const box = document.getElementById('up-status');
    const track = document.getElementById('up-progressTrack');
    if (show) { box.classList.remove('hidden'); box.classList.add('flex'); track.classList.remove('hidden'); }
    else { box.classList.add('hidden'); box.classList.remove('flex'); track.classList.add('hidden'); }
    document.getElementById('up-statusLabel').textContent = label || '';
    document.getElementById('up-progressPct').textContent = (pct !== undefined && pct !== null)
      ? Math.round(pct * 100) + '%' : '';
    document.getElementById('up-progressFill').style.width = (pct ? pct * 100 : 0) + '%';
  }

  function showError(msg) {
    const box = document.getElementById('up-error');
    box.classList.remove('hidden');
    box.textContent = msg;
  }
  function hideError() {
    document.getElementById('up-error').classList.add('hidden');
  }

  /* ---------- 预填表格渲染 ---------- */
  function rowHtml(h) {
    const lowConf = (Number(h._conf) || 0) < C().OCR_CONFIDENCE_THRESHOLD;
    const nameCls = h._name_known ? '' : 'cell-pending';
    const numCls = lowConf ? 'cell-lowconf' : 'cell-pending';
    const anomalyCls = h._anomaly ? ' cell-anomaly' : '';
    const newTag = h._is_new ? '<span class="tag tag-reason ml-1">新标的</span>' : '';
    const anomalyTag = h._anomaly ? '<span class="tag tag-违规 ml-1">数量异常变动</span>' : '';

    function cell(val, cls) {
      return '<td class="px-2 py-1 ' + cls + anomalyCls + '">' +
        '<input class="prefill-input" value="' + U().escapeHtml(val === null || val === undefined ? '' : val) + '" />' +
        '</td>';
    }

    // v1.1.2：4 列输入（标的/持仓量/成本/现价）+ 1 列只读浮动盈亏
    return '<tr data-row>' +
      '<td class="px-2 py-1 ' + nameCls + '">' +
      '<div class="flex items-center"><input class="prefill-input pf-name" list="upNameList" value="' +
      U().escapeHtml(h.name) + '" />' + newTag + anomalyTag + '</div></td>' +
      cell(h.position, numCls) +
      cell(h.cost, 'cell-pending') +
      cell(h.current_price, numCls) +
      '<td class="px-2 py-1 text-right number text-xs pf-calc text-slate-400">—</td>' +
      '<td class="px-2 py-1 text-center"><button data-row-del class="text-slate-300 hover:text-red-600 text-xs">✕</button></td>' +
      '</tr>';
  }

  function renderPrefill(holdings) {
    document.getElementById('up-prefillWrap').classList.remove('hidden');
    document.getElementById('up-prefillTbody').innerHTML = holdings.map(rowHtml).join('');
    document.getElementById('up-confirm').disabled = false;
    recalcSnapshot();
  }

  function renderOverview(overview) {
    document.getElementById('up-overviewGrid').innerHTML = OVERVIEW_FIELDS.map(f =>
      '<div><label class="block text-[10px] text-slate-400 mb-0.5">' + f.label + '</label>' +
      '<input data-ov="' + f.key + '" class="form-input !py-1.5 !text-xs" value="' +
      U().escapeHtml((overview && overview[f.key] !== undefined && overview[f.key] !== null) ? overview[f.key] : '') + '" /></div>'
    ).join('') +
    '<div class="col-span-full flex flex-wrap gap-x-6 gap-y-1 pt-1 text-[11px] text-slate-500">' +
    '<span>总市值：<b id="up-calcMv" class="number text-slate-700">—</b></span>' +
    '<span>浮动盈亏：<b id="up-calcFp" class="number">—</b></span>' +
    '<span>仓位：<b id="up-calcPct" class="number text-slate-700">—</b></span>' +
    '</div>';
  }

  function addRow() {
    const tbody = document.getElementById('up-prefillTbody');
    const h = App.Models.createHoldingRow(document.getElementById('up-date').value);
    h._conf = 1; h._name_known = false;
    tbody.insertAdjacentHTML('beforeend', rowHtml(h));
  }

  /* ---------- 实时计算：浮动盈亏列 + overview 聚合 ---------- */
  function recalcSnapshot() {
    let sumMv = 0, sumFp = 0, hasRow = false;
    document.querySelectorAll('#up-prefillTbody tr').forEach(tr => {
      const inputs = tr.querySelectorAll('input.prefill-input');
      const pos = Number(inputs[1].value || '0');
      const cost = Number(inputs[2].value || '0');
      const px = Number(inputs[3].value || '0');
      const calc = tr.querySelector('.pf-calc');
      if (pos > 0 && cost > 0 && px > 0) {
        hasRow = true;
        const mv = pos * px;
        const fp = (px - cost) * pos;
        sumMv += mv; sumFp += fp;
        const pct = (px - cost) / cost * 100;
        if (calc) calc.innerHTML = '<span class="' + U().colorClass(fp) + ' font-semibold">' + (fp >= 0 ? '+' : '') + U().fmt(Math.round(fp * 100) / 100) + '</span>' + ' <span class="text-[10px] ' + U().colorClass(fp) + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%</span>';
      } else {
        if (calc) calc.innerHTML = '<span class="text-slate-300">—</span>';
      }
    });
    const taInp = document.querySelector('#up-overviewGrid [data-ov="total_assets"]');
    const ta = taInp && taInp.value !== '' ? Number(taInp.value) : null;
    const mvEl = document.getElementById('up-calcMv');
    const fpEl = document.getElementById('up-calcFp');
    const pctEl = document.getElementById('up-calcPct');
    if (!mvEl) return;
    if (hasRow) {
      const mv = Math.round(sumMv * 100) / 100;
      const fp = Math.round(sumFp * 100) / 100;
      mvEl.textContent = U().fmt(mv);
      fpEl.textContent = (fp >= 0 ? '+' : '') + U().fmt(fp);
      fpEl.className = 'number ' + U().colorClass(fp);
      pctEl.textContent = (ta && ta > 0) ? (sumMv / ta * 100).toFixed(1) + '%' : '—';
    } else {
      mvEl.textContent = '—'; fpEl.textContent = '—'; fpEl.className = 'number'; pctEl.textContent = '—';
    }
  }

  /* ---------- 收集确认数据 ---------- */
  function collectHoldings() {
    const date = document.getElementById('up-date').value;
    const rows = [];
    document.querySelectorAll('#up-prefillTbody tr').forEach(tr => {
      const inputs = tr.querySelectorAll('input.prefill-input');
      const num = v => (v === '' ? null : Number(v));
      const h = {
        date: date,
        name: inputs[0].value.trim(),
        position: num(inputs[1].value),
        available: num(inputs[1].value),  // v1.1.2：单用户场景 可用=持仓
        cost: num(inputs[2].value),
        current_price: num(inputs[3].value),
        floating_pnl: null,
        market_value: null,
        day_pnl: null, day_pnl_pct: null, floating_pnl_pct: null,
        cleared: 0
      };
      if (h.position && h.current_price) {
        h.market_value = Math.round(h.position * h.current_price * 100) / 100;
      }
      if (h.cost !== null && h.current_price !== null && h.position) {
        h.floating_pnl = Math.round((h.current_price - h.cost) * h.position * 100) / 100;
      }
      if (h.cost && h.current_price) {
        h.floating_pnl_pct = Math.round(((h.current_price - h.cost) / h.cost) * 10000) / 100;
      }
      rows.push(h);
    });
    return rows;
  }

  function collectOverview(holdings) {
    const overview = App.Models.createOverview(document.getElementById('up-date').value);
    const taInp = document.querySelector('#up-overviewGrid [data-ov="total_assets"]');
    overview.total_assets = taInp && taInp.value !== '' ? Number(taInp.value) : null;
    // v1.1.2：由持仓聚合派生
    let sumMv = 0, sumFp = 0, has = false;
    (holdings || []).forEach(h => {
      if (h.market_value !== null) { sumMv += h.market_value; has = true; }
      if (h.floating_pnl !== null) sumFp += h.floating_pnl;
    });
    if (has) {
      overview.market_value = Math.round(sumMv * 100) / 100;
      overview.floating_pnl = Math.round(sumFp * 100) / 100;
      if (overview.total_assets && overview.total_assets > 0) {
        overview.position_pct = Math.round(sumMv / overview.total_assets * 1000) / 10;
      }
    }
    overview.day_pnl = null;
    overview.day_pnl_pct = null;
    overview.available = null;
    overview.withdrawable = null;
    return overview;
  }

  /** 确认前校验：每行名称 + 持仓量/现价合法 */
  function validateForConfirm(holdings) {
    if (holdings.length === 0) return '至少需要一行持仓数据';
    for (const h of holdings) {
      if (!h.name) return '存在未填写标的名称的行';
      if (!U().isPosInt(h.position)) return '「' + h.name + '」持仓量必须为正整数';
      if (!U().isPosNum(h.current_price)) return '「' + h.name + '」现价必须为正数';
    }
    return null;
  }

  /* ---------- 主流程：处理文件 ---------- */
  async function handleFile(file) {
    hideError();
    const errMsg = validateFile(file);
    if (errMsg) { showError(errMsg); return; }

    processing = true;
    try {
      setStatus(true, '图像预处理中…', 0.05);
      const base64 = await preprocess(file);

      setStatus(true, 'OCR 识别中…', 0.15);
      const useCloud = document.getElementById('up-useCloud').checked;
      const date = document.getElementById('up-date').value;

      const result = await App.SnapshotService.uploadSnapshot(
        date, base64, useCloud,
        pct => setStatus(true, 'OCR 识别中…', pct)
      );

      setStatus(true, result.ocrStatus === 'success' ? '识别完成' : '识别部分完成，请修正标红字段', 1);
      renderPrefill(result.prefill);
      renderOverview(result.overview);
      if (!result.imageStored) {
        U().toast('IndexedDB 不可用，截图本体未留存，不影响数据落库', 'warn');
      }
      if (result.ocrStatus === 'partial') {
        U().toast('部分字段置信度较低（标红），请逐项确认', 'warn');
      }
      setTimeout(() => setStatus(false), 2500);
    } catch (e) {
      console.error(e);
      setStatus(true, '识别失败', null);
      showError(e.message + '。可点击下方「跳过截图，直接手动填写」继续录入。');
      U().toast('OCR 失败，请手动录入', 'error');
    } finally {
      processing = false;
    }
  }

  /* ---------- 确认落库 ---------- */
  function onConfirm() {
    const holdings = collectHoldings();
    const err = validateForConfirm(holdings);
    if (err) { U().toast(err, 'error'); return; }
    const overview = collectOverview(holdings);
    try {
      App.SnapshotService.confirmSnapshot(document.getElementById('up-date').value, holdings, overview);
      document.getElementById('uploadModal').classList.add('hidden');
      document.getElementById('uploadModal').classList.remove('flex');
      App.DashboardController.rebuildDateSelect();
      App.DashboardController.renderAll();
      U().toast('当日持仓已确认落库', 'success');
    } catch (e) {
      U().toast(e.message, 'error');
    }
  }

  /* ---------- 重置/打开 ---------- */
  function resetModal() {
    hideError();
    setStatus(false);
    document.getElementById('up-prefillWrap').classList.add('hidden');
    document.getElementById('up-prefillTbody').innerHTML = '';
    document.getElementById('up-overviewGrid').innerHTML = '';
    document.getElementById('up-confirm').disabled = true;
    document.getElementById('up-useCloud').checked = false;
    document.getElementById('fileInput').value = '';
  }

  function openModal() {
    resetModal();
    document.getElementById('up-date').value = App.DashboardController.getDate() || U().today();
    document.getElementById('uploadModal').classList.remove('hidden');
    document.getElementById('uploadModal').classList.add('flex');

    // 名称自动补全列表
    const dl = document.getElementById('upNameList');
    if (!dl) {
      const d = document.createElement('datalist'); d.id = 'upNameList';
      document.getElementById('up-prefillTbody').appendChild(d);
    }
    const list = document.getElementById('upNameList');
    if (list) {
      list.innerHTML = App.HoldingsService.knownNames()
        .map(n => '<option value="' + U().escapeHtml(n) + '">').join('');
    }
  }

  /* ---------- 事件 ---------- */
  function init() {
    document.getElementById('btnOpenUpload').addEventListener('click', openModal);

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });
    dropZone.addEventListener('dragover', e => {
      e.preventDefault(); dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    document.getElementById('up-addRow').addEventListener('click', addRow);
    document.getElementById('up-prefillTbody').addEventListener('click', e => {
      const btn = e.target.closest('[data-row-del]');
      if (btn) { btn.closest('tr').remove(); recalcSnapshot(); }
    });
    document.getElementById('up-prefillTbody').addEventListener('input', () => recalcSnapshot());
    document.getElementById('up-overviewGrid').addEventListener('input', () => recalcSnapshot());
    document.getElementById('up-confirm').addEventListener('click', onConfirm);

    document.getElementById('up-skip').addEventListener('click', () => {
      document.getElementById('uploadModal').classList.add('hidden');
      document.getElementById('uploadModal').classList.remove('flex');
      App.ManualEntry.openModal(document.getElementById('up-date').value);
    });

    // 云端开关：勾选时二次告知
    document.getElementById('up-useCloud').addEventListener('change', e => {
      if (e.target.checked) {
        if (!confirm('启用云端 OCR 后，截图将上传至第三方 OCR 服务。\n（v1.1.1 尚未配置云端服务商，开启后仍会自动回退本地 OCR）\n\n是否确认开启？')) {
          e.target.checked = false;
        }
      }
    });
  }

  return { init, openModal };
})();
