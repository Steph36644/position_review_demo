/* ===== Service：v1.3.1 DAA-6 ETF 重叠检测（纯函数，成分股数量占比口径） ===== */
window.App = window.App || {};

App.EtfOverlapService = (function () {
  const C = () => App.Constants;

  function db() { return App.LocalStorageRepo.getDB(); }

  /**
   * 两两重叠（上三角 A<B，至少一方为 ETF；成分股缺失的组合跳过）
   * 重叠度 = |S_A ∩ S_B| / min(|S_A|, |S_B|)，个股视为单元素集合 {name}
   * @returns OverlapPair[]：{a, b, overlap:string[], ratio:number} 按 ratio 降序
   */
  function detectWith(holdings, instruments) {
    const inst = instruments || {};
    const names = (holdings || []).filter(h => h && !h.cleared && h.name).map(h => h.name);
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j];
        const ia = inst[a], ib = inst[b];
        const aIsEtf = !!(ia && ia.is_etf), bIsEtf = !!(ib && ib.is_etf);
        if (!aIsEtf && !bIsEtf) continue;
        const sa = aIsEtf ? (ia.etf_top10 || []) : [a];
        const sb = bIsEtf ? (ib.etf_top10 || []) : [b];
        if (!sa.length || !sb.length) continue;
        const setB = new Set(sb);
        const overlap = sa.filter(x => setB.has(x));
        pairs.push({
          a: a, b: b,
          overlap: overlap,
          ratio: overlap.length / Math.min(sa.length, sb.length)
        });
      }
    }
    pairs.sort((x, y) => y.ratio - x.ratio);
    return pairs;
  }

  function detect(date) {
    return detectWith(App.HoldingsService.getHoldings(date), db().instruments);
  }

  /** 成分股缺失的 ETF 数量（面板底部遗漏提示用） */
  function missingTop10Count(holdings, instruments) {
    const inst = instruments || {};
    let n = 0;
    (holdings || []).filter(h => h && !h.cleared).forEach(h => {
      const info = inst[h.name];
      if (info && info.is_etf && (!info.etf_top10 || !info.etf_top10.length)) n++;
    });
    return n;
  }

  /** 是否超过告警阈值 */
  function isOverThreshold(pair) {
    return pair.ratio > C().ETF_OVERLAP_THRESHOLD;
  }

  return { detectWith, detect, missingTop10Count, isOverThreshold };
})();
