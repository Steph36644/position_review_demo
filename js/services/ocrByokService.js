/* ===== Service：v1.3.3 云端 OCR BYOK（DeepSeek / Kimi / Qwen / GLM）=====
   密钥只写入本机 localStorage（pr2_ocr_byok）。
   不进入种子、不进入备份、不出现在仓库。
   公开演示或多用户部署必须把密钥挪到服务端，浏览器不能持有共享密钥。 */
window.App = window.App || {};

App.OcrByok = (function () {
  const C = () => App.Constants;

  const PROMPT = '你是持仓截图的 OCR。只输出截图里看得见的文字，按从上到下逐行保留，不要解释，不要使用 Markdown。数字保留原有的千分位和小数。';

  function blank() {
    return { provider: 'deepseek', apiKey: '' };
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(C().LS_KEYS.ocrByok);
      const o = raw ? JSON.parse(raw) : {};
      const provider = o && C().OCR_PROVIDERS[o.provider] ? o.provider : 'deepseek';
      const apiKey = o && typeof o.apiKey === 'string' ? o.apiKey : '';
      return { provider: provider, apiKey: apiKey };
    } catch (e) {
      return blank();
    }
  }

  /** 只接受 provider / apiKey。忽略备份或其他对象里夹带的多余字段。 */
  function saveSettings(partial) {
    const cur = getSettings();
    const provider = partial && C().OCR_PROVIDERS[partial.provider] ? partial.provider : cur.provider;
    const apiKey = partial && partial.apiKey !== undefined ? String(partial.apiKey) : cur.apiKey;
    const next = { provider: provider, apiKey: apiKey };
    localStorage.setItem(C().LS_KEYS.ocrByok, JSON.stringify(next));
    return { provider: next.provider, apiKey: next.apiKey };
  }

  function clearSettings() {
    localStorage.removeItem(C().LS_KEYS.ocrByok);
  }

  /**
   * 组装 OpenAI 兼容视觉请求。密钥只放在 Authorization 头，不进 body。
   * 未选服务商或未填密钥时抛出 message === CLOUD_OCR_NOT_CONFIGURED。
   */
  function buildRequest(base64, settings) {
    const s = settings || getSettings();
    const provider = C().OCR_PROVIDERS[s.provider];
    if (!provider || !s.apiKey) {
      const err = new Error('CLOUD_OCR_NOT_CONFIGURED');
      err.name = 'OcrFailedException';
      throw err;
    }
    const dataUrl = String(base64 || '').indexOf('data:') === 0
      ? String(base64)
      : ('data:image/png;base64,' + String(base64 || ''));
    return {
      endpoint: provider.endpoint,
      provider: provider.id,
      model: provider.model,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.apiKey
      },
      body: {
        model: provider.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }]
      }
    };
  }

  function readText(data) {
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.map(function (part) {
        return part && typeof part.text === 'string' ? part.text : '';
      }).join('\n');
    }
    return '';
  }

  /**
   * @param {string} base64
   * @param {object} [settings]
   * @param {function} [fetchImpl] 测试可注入
   */
  async function recognize(base64, settings, fetchImpl) {
    const req = buildRequest(base64, settings);
    const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      const err = new Error('CLOUD_OCR_NO_FETCH');
      err.name = 'OcrFailedException';
      throw err;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, C().CLOUD_OCR_TIMEOUT_MS) : null;
    try {
      const res = await fetchFn(req.endpoint, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller ? controller.signal : undefined
      });
      if (!res || !res.ok) {
        const status = res && res.status ? res.status : 0;
        const err = new Error('CLOUD_OCR_HTTP_' + status);
        err.name = 'OcrFailedException';
        throw err;
      }
      const data = await res.json();
      const text = readText(data).trim();
      if (!text) {
        const err = new Error('CLOUD_OCR_EMPTY');
        err.name = 'OcrFailedException';
        throw err;
      }
      return text;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { getSettings, saveSettings, clearSettings, buildRequest, recognize };
})();
