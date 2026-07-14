import { aiClient, isTavernEnv } from '../core/ai-client.js';
import { eventBus } from '../core/event-bus.js';
import { escAttr } from '../utils/format.js';
import { bindCustomSelects } from './custom-select.js';

export class ApiConfigForm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    try {
      this._config = JSON.parse(this.getAttribute('config') || '{}');
    } catch {
      this._config = {};
    }
    this._showAdvanced = this.hasAttribute('show-advanced');
    this._render();
    this._bindEvents();
    bindCustomSelects(this.shadowRoot);
  }

  _render() {
    const config = this._config;
    const backend = config.backend || 'openai';
    
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .settings-form { display: grid; gap: 20px; text-align: left; }
        .settings-row { display: grid; gap: 8px; }
        .settings-row label { color: #c69c6d; font-size: 12px; letter-spacing: .08em; font-weight: 500; text-transform: uppercase; }
        .settings-input, .settings-select {
          width: 100%; box-sizing: border-box; padding: 8px 4px;
          border: none; border-bottom: 1px solid rgba(255,255,255,0.1); border-radius: 0; background: transparent;
          color: #e8e4d9; font: 14px/1.4 'Noto Sans SC','Microsoft YaHei UI','PingFang SC', system-ui, sans-serif;
          outline: none; transition: all .3s ease;
        }
        .settings-input:focus, .settings-select:focus { 
          border-bottom-color: rgba(198,156,109,0.8); 
          box-shadow: 0 1px 0 0 rgba(198,156,109,0.3);
          background: rgba(255,255,255,0.02);
        }
        .settings-input::placeholder { color: rgba(232,228,217,0.2); }
        .settings-hint { color: rgba(232,228,217,0.4); font-size: 12px; line-height: 1.6; }
        .settings-model-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; }
        .settings-check { display: flex; gap: 8px; align-items: center; color: #e8e4d9; font-size: 13px; }
        .settings-check input { accent-color: #c69c6d; cursor: pointer; }
        .settings-subcard { border: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.15); padding: 18px; display: grid; gap: 16px; border-radius: 8px; }
        .settings-fetch {
          padding: 8px 16px; border: 1px solid rgba(198,156,109,0.3); border-radius: 4px;
          background: rgba(198,156,109,0.05); color: #c69c6d; font: 13px/1.4 'Noto Sans SC', system-ui, sans-serif;
          cursor: pointer; white-space: nowrap; transition: all 0.2s ease;
        }
        .settings-fetch:hover { border-color: rgba(198,156,109,0.8); background: rgba(198,156,109,0.15); box-shadow: 0 0 10px rgba(198,156,109,0.1); }
        .settings-fetch:disabled { opacity: .45; cursor: wait; }

        .model-list-wrap {
          display: none; max-height: 200px; overflow-y: auto; overflow-x: hidden;
          margin-top: 4px; border: 1px solid rgba(198,156,109,0.2); border-radius: 6px;
          background: rgba(7,10,14,0.95); backdrop-filter: blur(12px);
        }
        .model-list-wrap.open { display: block; }
        .model-item {
          padding: 8px 12px; cursor: pointer; font-size: 13px; color: #a39f98;
          border-bottom: 1px solid rgba(255,255,255,0.04); transition: all 0.15s;
          font-family: 'Noto Sans SC', system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .model-item:hover { background: rgba(198,156,109,0.1); color: #e8e4d9; }
        .model-item.selected { background: rgba(235,97,63,0.12); color: #ff8a65; border-left: 3px solid #eb613f; }
        .model-count { font-size: 11px; color: rgba(198,156,109,0.6); margin-top: 4px; }
        
        /* 简易模式下的额外样式 */
        .simple-mode .settings-input, .simple-mode .settings-select { font-size: 15px; }
        .simple-mode .settings-row label { font-size: 13px; }
      </style>
      <div class="settings-form ${this._showAdvanced ? '' : 'simple-mode'}" id="settings-form">
        <div class="settings-row">
          <label for="settings-api-url">API 地址</label>
          <input class="settings-input" id="settings-api-url" value="${this._escAttr(config.apiUrl || 'https://api.openai.com/v1')}" placeholder="https://api.openai.com/v1" autocomplete="off" autocapitalize="off" spellcheck="false" />
          ${!this._showAdvanced ? '<div class="settings-hint">支持 OpenAI / Anthropic / DeepSeek / 自定义兼容 API</div>' : ''}
        </div>
        <div class="settings-row">
          <label for="settings-api-key">API Key (本地免密模型可留空)</label>
          <input class="settings-input" id="settings-api-key" type="password" value="${this._escAttr(config.apiKey || '')}" placeholder="输入密钥 (本地免密可留空)" autocomplete="new-password" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="settings-row">
          <label for="settings-api-model">模型名称</label>
          <div class="settings-model-row">
            <input class="settings-input" id="settings-api-model" value="${this._escAttr(config.model || '')}" placeholder="点击读取模型，或手动输入" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <button class="settings-fetch" type="button" id="settings-fetch-models">读取模型</button>
          </div>
          <div class="model-list-wrap" id="settings-model-list"></div>
          <div class="settings-hint" id="settings-model-status">从当前 API 地址读取 /models 列表。</div>
        </div>
        <div class="settings-row">
          <label for="settings-api-backend">术式类型</label>
          <select class="settings-select" id="settings-api-backend">
            ${isTavernEnv ? this._option('tavern', '🍺 酒馆模型 (推荐)', backend) : ''}
            ${this._option('openai', 'OpenAI 兼容', backend)}
            ${this._option('claude', 'Claude / Anthropic', backend)}
            ${this._option('deepseek', 'DeepSeek', backend)}
            ${this._option('custom', '自定义兼容', backend)}
          </select>
        </div>
        
        <div class="settings-row">
          <label class="settings-check" style="margin-top: 8px;">
            <input type="checkbox" id="settings-disable-streaming" ${config.disableStreaming ? 'checked' : ''} /> 
            关闭流式输出 (等待生成完毕后一次性显示)
          </label>
          <div class="settings-hint" style="margin-top: -4px;">对于某些不支持流式传输的中转代理 API，开启此项可避免报错。</div>
        </div>
        
      </div>
    `;
  }

  _option(value, label, selected) {
    return `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;
  }

  _escAttr(value) {
    return escAttr(value);
  }

  _bindEvents() {
    // ── Helper: populate a model-list div with fetched models ──
    const populateList = (listEl, models, inputEl, statusEl) => {
      if (!listEl) return;
      listEl.innerHTML = models.map(id =>
        `<div class="model-item" data-model="${this._escAttr(id)}">${this._escAttr(id)}</div>`
      ).join('');
      listEl.classList.add('open');
      // Click handler on list
      listEl.querySelectorAll('.model-item').forEach(item => {
        item.addEventListener('click', () => {
          if (inputEl) inputEl.value = item.dataset.model;
          // Highlight selected
          listEl.querySelectorAll('.model-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
        });
      });
      if (statusEl) statusEl.textContent = `已读取 ${models.length} 个模型，点击下方列表选择`;
      if (models.length > 0 && inputEl && !inputEl.value) {
        inputEl.value = models[0];
        const firstItem = listEl.querySelector('.model-item');
        if (firstItem) firstItem.classList.add('selected');
      }
    };

    // ── Generic fetcher ──
    const doFetch = async (fetchBtn, listEl, inputEl, statusEl, apiUrlOverride, apiKeyOverride) => {
      const config = this.getConfig(true);
      if (!config) return;
      if (!config?.apiUrl && !apiUrlOverride) {
        eventBus.emit('app:toast', '请先填写 API 地址。');
        return;
      }
      fetchBtn.disabled = true;
      fetchBtn.textContent = '读取中';
      if (statusEl) statusEl.textContent = '正在连接模型端点...';
      try {
        const fetchConfig = {
          ...config,
          apiUrl: apiUrlOverride || config.apiUrl,
          apiKey: apiKeyOverride || config.apiKey
        };
        const models = await aiClient.listModels(fetchConfig);
        if (!models.length) throw new Error('服务返回为空模型列表');
        populateList(listEl, models, inputEl, statusEl);
        eventBus.emit('app:toast', `已读取 ${models.length} 个模型`);
      } catch (error) {
        if (statusEl) statusEl.textContent = '读取失败: ' + (error.message || '未知错误');
        eventBus.emit('app:toast', error.message || '模型列表读取失败');
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '读取模型';
      }
    };

    // ── Main model ──
    const mainFetch = this.shadowRoot.querySelector('#settings-fetch-models');
    const mainInput = this.shadowRoot.querySelector('#settings-api-model');
    const mainList = this.shadowRoot.querySelector('#settings-model-list');
    const mainStatus = this.shadowRoot.querySelector('#settings-model-status');
    mainFetch?.addEventListener('click', () => doFetch(mainFetch, mainList, mainInput, mainStatus));
    // Toggle list on input focus
    mainInput?.addEventListener('focus', () => { if (mainList?.children.length) mainList.classList.add('open'); });
    mainInput?.addEventListener('blur', () => setTimeout(() => mainList?.classList.remove('open'), 200));

  }

  getConfig(allowEmptyModel = false) {
    const root = this.shadowRoot;
    if (!root) return null;
    const apiUrl = root.querySelector('#settings-api-url')?.value.trim();
    const apiKey = root.querySelector('#settings-api-key')?.value.trim();
    const model = root.querySelector('#settings-api-model')?.value.trim();
    const backend = root.querySelector('#settings-api-backend')?.value;

    // 酒馆模型不需要 API 地址和密钥
    if (backend === 'tavern') {
      if (!allowEmptyModel && !model) return null;
      return { backend: 'tavern', model: model || 'tavern-default', apiUrl: '', apiKey: '', disableStreaming: false };
    }

    if (!apiUrl || (!allowEmptyModel && !model)) return null;

    let finalApiUrl = apiUrl;
    if (backend === 'deepseek' && !apiUrl) finalApiUrl = 'https://api.deepseek.com/v1';
    if (backend === 'claude' && !apiUrl) finalApiUrl = 'https://api.anthropic.com/v1';

    const disableStreaming = root.querySelector('#settings-disable-streaming')?.checked || false;
    const config = { apiUrl: finalApiUrl, apiKey, model, backend, disableStreaming };

    config.variableUpdater = this._config.variableUpdater;
    
    return config;
  }
}

customElements.define('api-config-form', ApiConfigForm);
