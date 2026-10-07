/* ===== Service：DAQ-6 截图上传 / OCR 识别 / 预填 / 确认落库 ===== */
window.App = window.App || {};

class OcrFailedException extends Error {
  constructor(msg) { super(msg); this.name = 'OcrFailedException'; }
}
App.Exceptions.OcrFailedException = OcrFailedException;

App.SnapshotService = (function () {
  const C = () => App.Constants;
  const U = () => App.Utils;

  function db() { return App.LocalStorageRepo.getDB(); }

  /* ---------- 数字提取（千分位、负数、OCR 形近字修正） ---------- */
  function extractNumbers(s) {
    const fixed = s
      .replace(/(?<=[\d.,])[Oo](?=[\d.,]|$)/g, '0')
      .replace(/(?<=\d)[lI](?=[\d.,]|$)/g, '1');
    const matches = fixed.match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g);
    if (!matches) return [];
    return matches.map(m => parseFloat(m.replace(/,/g, '')));
  }

  /* ---------- 数字列 → 字段映射（多候选 + 勾稽校验选优） ---------- */
  function mapNumbers(nums) {
    const candidates = [
      { keys: ['market_value', 'position', 'available', 'cost', 'current_price', 'floating_pnl'] },
      { keys: ['market_value', 'floating_pnl', 'floating_pnl_pct', 'position', 'available', 'cost', 'current_price'] },
      { keys: ['market_value', 'position', 'cost', 'current_price', 'floating_pnl'] },
      { keys: ['market_value', 'position', 'available', 'cost', 'current_price'] },
      { keys: ['market_value', 'position', 'cost', 'current_price'] },
      // 两行堆叠布局（券商 App 常见）：上行=持仓/成本/当日盈亏，下行=市值/可用/现价/盈亏%
      { keys: ['position', 'cost', 'day_pnl', 'market_value', 'available', 'current_price', 'day_pnl_pct'] },
      { keys: ['position', 'cost', 'market_value', 'available', 'current_price'] }
    ];
    let best = null;
    candidates.forEach(c => {
      if (c.keys.length > nums.length) return;
      const obj = {};
      c.keys.forEach((k, i) => { obj[k] = nums[i]; });
      let score = 0;
      if (obj.position && obj.current_price && obj.market_value) {
        const est = obj.position * obj.current_price;
        // 分母必须取绝对值：market_value 槽位可能落入负数，否则 err 为负、score 爆表导致错位映射
        const err = Math.abs(est - obj.market_value) / Math.abs(obj.market_value || 1);
        score = 1 - Math.min(1, Math.max(0, err));
      } else if (obj.market_value) {
        score = 0.5;
      }
      if (obj.cost && obj.current_price && obj.position && obj.floating_pnl !== undefined) {
        const estPnl = (obj.current_price - obj.cost) * obj.position;
        const err2 = Math.abs(estPnl - obj.floating_pnl) / (Math.abs(obj.floating_pnl) + 1);
        score += Math.max(0, 0.5 - Math.min(0.5, err2));
      }
      if (!best || score > best.score) best = { obj, score };
    });
    return best && best.score >= 0.8 ? best.obj : null;
  }

  /**
   * 解析 OCR 文本 → holdings + overview
   * @param {string} text
   * @param {Array<{text:string, confidence:number}>} ocrLines 行级置信度
   */
  function parseOcrText(text, ocrLines) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const overview = {};
    const holdings = [];
    const names = App.HoldingsService.knownNames();

    // 行级置信度映射（按去空格文本匹配）
    const confMap = new Map();
    (ocrLines || []).forEach(l => {
      if (l && l.text) confMap.set(l.text.replace(/\s+/g, ''), (Number(l.confidence) || 0) / 100);
    });

    // 概览标签正则（容忍 OCR 插空格与形近字误识）
    const ovPatterns = [
      { re: /总\s*资\s*产|资\s*产\s*总\s*额/, key: 'total_assets' },
      { re: /总\s*市\s*值|持\s*仓\s*市\s*值/, key: 'market_value' },
      { re: /浮\s*动\s*.\s{0,2}亏|持\s*仓\s*.\s{0,2}亏/, key: 'floating_pnl' },
      { re: /当\s*日\s*(参\s*考)?\s*.\s{0,2}亏|今\s*日\s*.\s{0,2}亏/, key: 'day_pnl' },
      { re: /可\s*用\s*(资\s*金|金\s*额)?/, key: 'available' },
      { re: /可\s*取\s*(资\s*金|金\s*额)?/, key: 'withdrawable' }
    ];
    const ovLabelRe = /总资产|总市值|浮动盈亏|当日|今日|可用|可取|资产/;
    const compactOf = s => s.replace(/\s+/g, '');
    const nameToRe = name => new RegExp(name.split('').join('\\s*'));

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      let matched = false;
      ovPatterns.forEach(p => {
        if (overview[p.key] !== undefined) return;
        const m = line.match(p.re);
        if (!m) return;
        const rest = line.slice(line.indexOf(m[0]) + m[0].length);
        const nums = extractNumbers(rest);
        if (nums.length) { overview[p.key] = nums[0]; matched = true; }
      });
      if (matched) continue;

      // 标签行（无数值）+ 下一数值行 → 按标签出现顺序配对
      // （如「总资产 浮动盈亏 当日参考盈亏」/「277,842.29 +31,856.49 +2,218.00 0.80%」）
      const compact = compactOf(line);
      if (ovLabelRe.test(compact) && extractNumbers(line).length === 0 && li + 1 < lines.length) {
        const nextNums = extractNumbers(lines[li + 1]);
        if (nextNums.length >= 2) {
          const keys = [];
          ovPatterns.forEach(p => {
            if (overview[p.key] !== undefined) return;
            if (p.re.test(line)) keys.push(p.key);
          });
          keys.forEach((k, i) => { if (i < nextNums.length) overview[k] = nextNums[i]; });
          if (keys.length && nextNums.length === keys.length + 1) {
            const lastKey = keys[keys.length - 1];
            if (lastKey === 'day_pnl') overview.day_pnl_pct = nextNums[nextNums.length - 1];
            else if (lastKey === 'floating_pnl') overview.floating_pnl_pct = nextNums[nextNums.length - 1];
          }
          if (keys.length) li++;
        }
      }
    }

    // 持仓行：支持单行全字段 + 「两行堆叠」布局（上行=持仓/成本/当日盈亏，下行=市值/可用/现价/盈亏%）
    const headerRe = /名称|代码|市值|持仓|成本|现价|盈亏|占比|仓位|证券|市场/;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const compact = compactOf(line);
      if (ovLabelRe.test(compact) && extractNumbers(line).length <= 2) continue;
      if (headerRe.test(compact) && extractNumbers(line).length < 3) continue;

      let name = null, nameEnd = -1, nameKnown = false;
      for (let i = 0; i < names.length; i++) {
        const nm0 = names[i].replace(/\s+/g, '');
        if (compact.indexOf(nm0) >= 0) {
          const m0 = line.match(nameToRe(nm0));
          if (m0) { name = names[i]; nameEnd = line.indexOf(m0[0]) + m0[0].length; nameKnown = true; break; }
        }
      }
      if (!name) {
        const nm = line.match(/^[一-龥A-Za-z](?:\s*[一-龥A-Za-z·]|[0-9·]){1,11}/);
        if (nm) { name = nm[0].replace(/\s+/g, ''); nameEnd = nm[0].length; }
      }
      if (!name || ovLabelRe.test(name) || headerRe.test(name)) continue;

      const numStr = line.slice(nameEnd);
      const codeMatch = numStr.match(/^\s*[:：]?\s*(\d{6})\b/);
      let nums = extractNumbers(numStr);
      if (codeMatch && nums.length && nums[0] === parseInt(codeMatch[1], 10)) nums = nums.slice(1);
      if (!nums.length) continue;

      // 策略A：单行全字段
      let mapped = mapNumbers(nums);
      let consumedNext = false;

      // 策略B：两行堆叠 — 下一行为纯数值行时拼接映射（合法性由 mapNumbers 勾稽校验把关）
      if (!mapped && li + 1 < lines.length) {
        const nextLine = lines[li + 1];
        const nextNums = extractNumbers(nextLine);
        const isNumRow = nextNums.length >= 2 && nextNums.length >= nums.length &&
          !/[一-龥]/.test(nextLine);
        if (isNumRow) {
          const merged = mapNumbers(nums.concat(nextNums));
          if (merged && merged.market_value && merged.position) {
            mapped = merged;
            consumedNext = true;
          }
        }
      }

      if (!mapped || !mapped.market_value || !mapped.position) continue;
      if (consumedNext) li++;

      const h = {
        date: null,
        name: name,
        market_value: mapped.market_value,
        position: mapped.position,
        available: mapped.available !== undefined ? mapped.available : mapped.position,
        cost: mapped.cost !== undefined ? mapped.cost : null,
        current_price: mapped.current_price !== undefined ? mapped.current_price
          : (mapped.market_value / mapped.position),
        day_pnl: mapped.day_pnl !== undefined ? mapped.day_pnl : null,
        day_pnl_pct: mapped.day_pnl_pct !== undefined ? mapped.day_pnl_pct : null,
        floating_pnl: mapped.floating_pnl !== undefined ? mapped.floating_pnl : null,
        floating_pnl_pct: null,
        cleared: 0
      };
      if (h.floating_pnl === null && h.cost !== null) {
        h.floating_pnl = (h.current_price - h.cost) * h.position;
      }
      if (h.cost) h.floating_pnl_pct = ((h.current_price - h.cost) / h.cost) * 100;
      if (h.floating_pnl !== null) h.floating_pnl = Math.round(h.floating_pnl * 100) / 100;
      if (h.floating_pnl_pct !== null) h.floating_pnl_pct = Math.round(h.floating_pnl_pct * 100) / 100;
      if (h.day_pnl_pct !== null) h.day_pnl_pct = Math.round(h.day_pnl_pct * 100) / 100;

      // 行级置信度（名称已知视为高置信）
      const lineConf = confMap.get(compact);
      h._conf = nameKnown ? Math.max(0.9, (lineConf || 0)) : (lineConf || 0);
      h._name_known = nameKnown;
      holdings.push(h);
    }

    if (!holdings.length) return null;

    // 概览兜底
    const sumMv = holdings.reduce((s, h) => s + h.market_value, 0);
    const sumFp = holdings.reduce((s, h) => s + (h.floating_pnl || 0), 0);
    if (!overview.market_value) overview.market_value = Math.round(sumMv * 100) / 100;
    if (!overview.total_assets) {
      overview.total_assets = Math.round((overview.market_value + (overview.available || 0)) * 100) / 100;
    }
    if (overview.floating_pnl === undefined) overview.floating_pnl = Math.round(sumFp * 100) / 100;
    if (overview.available === undefined) {
      overview.available = Math.max(0, Math.round((overview.total_assets - overview.market_value) * 100) / 100);
    }
    if (overview.withdrawable === undefined) overview.withdrawable = overview.available;
    if (overview.day_pnl === undefined) overview.day_pnl = null;
    if (overview.day_pnl_pct === undefined) overview.day_pnl_pct = null;
    overview.position_pct = overview.total_assets
      ? Math.round((overview.market_value / overview.total_assets) * 1000) / 10 : null;

    return { overview, holdings };
  }

  /* ---------- Tesseract 本地 OCR ---------- */
  function runTesseract(base64, onProgress) {
    if (typeof Tesseract === 'undefined') {
      return Promise.reject(new OcrFailedException('OCR 引擎加载失败，请检查网络后刷新重试'));
    }
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new OcrFailedException('识别超时（90 秒），请更换更清晰的截图或手动录入')),
        C().OCR_TIMEOUT_MS);
    });
    const job = (async () => {
      const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(0.3 + m.progress * 0.7);
          }
        }
      });
      try {
        await worker.setParameters({
          user_defined_dpi: '300',        // 截图无 DPI 元信息，显式指定，避免按默认 70dpi 误判字号
          preserve_interword_spaces: '1'  // 保留列间距，解析依赖行内多列数字
        });
        const { data } = await worker.recognize(base64);
        const ocrLines = (data.lines || []).map(l => ({ text: l.text, confidence: l.confidence }));
        return { text: data.text, confidence: data.confidence, lines: ocrLines };
      } finally {
        worker.terminate();
      }
    })();
    return Promise.race([job, timeout]);
  }

  /**
   * 云端 OCR 入口（v1.1.1 未配置具体服务商 endpoint / key）
   * 启用时自动回退本地 OCR，由 controller 给出提示。
   * v1.2 如需接入，在此实现 fetch 调用即可，接口契约不变。
   */
  function runCloudOcr(/* base64, onProgress */) {
    return Promise.reject(new OcrFailedException('CLOUD_OCR_NOT_CONFIGURED'));
  }

  /* ---------- 异常变动检测（对比上次快照） ---------- */
  function detectAnomalies(date, holdings) {
    const prev = App.HoldingsService.getPreviousHoldings(date);
    if (!prev.date) return;
    const prevMap = new Map();
    prev.holdings.forEach(h => prevMap.set(h.name, h));
    holdings.forEach(h => {
      h._is_new = !h._name_known && !prevMap.has(h.name);
      const old = prevMap.get(h.name);
      if (old && old.position) {
        const ratio = Math.abs(h.position - old.position) / old.position;
        h._anomaly = ratio > C().ANOMALY_CHANGE_RATIO;
      }
    });
  }

  /**
   * 上传截图并 OCR
   * @returns {Promise<{ocrStatus:string, prefill:Array, overview:object}>}
   */
  async function uploadSnapshot(date, base64, useCloud, onProgress) {
    // 1. 截图存 IndexedDB（失败不阻断主流程，仅标记无法留存）
    let imageStored = false;
    const idbOk = await App.IndexedDBRepo.isAvailable();
    if (idbOk) {
      try {
        await App.IndexedDBRepo.putImage('snap_' + date, base64);
        imageStored = true;
      } catch (e) { console.warn('截图写入 IndexedDB 失败', e); }
    }

    // 2. OCR 识别（云端失败自动回退本地）
    let ocrResult;
    let usedCloud = false;
    if (useCloud) {
      try {
        ocrResult = await runCloudOcr(base64, onProgress);
        usedCloud = true;
      } catch (e) {
        if (e.message === 'CLOUD_OCR_NOT_CONFIGURED') {
          console.info('云端 OCR 未配置，回退本地 OCR');
        } else {
          console.warn('云端 OCR 失败，回退本地 OCR', e);
        }
        ocrResult = await runTesseract(base64, onProgress);
      }
    } else {
      ocrResult = await runTesseract(base64, onProgress);
    }

    // 3. 解析（window.__OCR_DEBUG 时输出原始识别文本到控制台，便于排查识别质量）
    if (window.__OCR_DEBUG) console.info('[OCR原始文本]\n' + ocrResult.text);
    const parsed = parseOcrText(ocrResult.text, ocrResult.lines);

    // 4. 写快照元数据
    const meta = App.Models.createSnapshotMeta(date, {
      image_id: imageStored ? ('snap_' + date) : null,
      uploaded_at: U().nowIso(),
      ocr_raw: { confidence: ocrResult.confidence, used_cloud: usedCloud },
      confirmed: false
    });

    if (!parsed) {
      meta.ocr_status = C().OCR_STATUS.FAILED;
      db().snapshots[date] = meta;
      App.LocalStorageRepo.saveSnapshots();
      throw new OcrFailedException('未能从截图中解析出有效持仓，请手动录入或更换截图');
    }

    detectAnomalies(date, parsed.holdings);

    // ocr_status：任一识别行置信度低于阈值 → partial
    const lowConf = parsed.holdings.some(h => (Number(h._conf) || 0) < C().OCR_CONFIDENCE_THRESHOLD);
    meta.ocr_status = lowConf ? C().OCR_STATUS.PARTIAL : C().OCR_STATUS.SUCCESS;
    db().snapshots[date] = meta;
    App.LocalStorageRepo.saveSnapshots();

    return {
      ocrStatus: meta.ocr_status,
      prefill: parsed.holdings,
      overview: parsed.overview,
      imageStored
    };
  }

  /** 确认落库：清理临时字段，写 holdings/overview，更新确认标记 */
  function confirmSnapshot(date, holdings, overview) {
    const clean = (holdings || []).map(h => {
      const row = Object.assign({}, h);
      delete row._conf;
      delete row._name_known;
      delete row._is_new;
      delete row._anomaly;
      return row;
    });
    App.HoldingsService.saveSnapshot(date, clean, overview);

    if (db().snapshots[date]) {
      db().snapshots[date].confirmed = true;
      db().snapshots[date].confirmed_at = U().nowIso();
      App.LocalStorageRepo.saveSnapshots();
    }
  }

  /** 跳过截图（不写图，仅标记 skipped） */
  function markSkipped(date) {
    const meta = App.Models.createSnapshotMeta(date, {
      image_id: null,
      ocr_status: C().OCR_STATUS.SKIPPED
    });
    db().snapshots[date] = meta;
    App.LocalStorageRepo.saveSnapshots();
  }

  return { uploadSnapshot, confirmSnapshot, markSkipped, parseOcrText, extractNumbers };
})();
