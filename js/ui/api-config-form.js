import { aiClient, isTavernEnv } from '../core/ai-client.js';
import { PROMPTS } from '../data/prompts.js';
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
        #settings-model-select { margin-top: 8px; }
        
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
            <input class="settings-input" id="settings-api-model" list="settings-model-options" value="${this._escAttr(config.model || '')}" placeholder="读取模型后选择，或手动输入完整模型名" autocomplete="off" autocapitalize="off" spellcheck="false" />
            <button class="settings-fetch" type="button" id="settings-fetch-models">读取模型</button>
          </div>
          <datalist id="settings-model-options"></datalist>
          <select class="settings-select" id="settings-model-select" hidden><option value="">选择已读取模型</option></select>
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
        
        ${this._showAdvanced ? `
        <div class="settings-row">
          <label for="settings-prompt-preset">默认叙事预设</label>
          <select class="settings-select" id="settings-prompt-preset">
            ${Object.values(PROMPTS.PROMPT_PRESETS || {}).map(preset => this._option(preset.id, preset.name, config.promptPreset || PROMPTS.DEFAULT_PROMPT_PRESET_ID)).join('')}
          </select>
          <div class="settings-hint">当前默认使用 Narutomech Alpha-1003 适配版；它会按动态时间线判断人物、组织与事件合理性。</div>
        </div>
        <div class="settings-subcard">
          <label class="settings-check"><input type="checkbox" id="settings-var-enabled" ${config.variableUpdater?.enabled ? 'checked' : ''} /> 启用二次变量更新模型</label>
          <div class="settings-hint">主模型负责叙事；二次模型在后台读取本回合内容，补充/修正变量、任务、关系和记忆标签。关闭时只解析主模型输出。</div>
          <div class="settings-row">
            <label for="settings-var-model">变量更新模型</label>
            <input class="settings-input" id="settings-var-model" value="${this._escAttr(config.variableUpdater?.model || config.model || '')}" placeholder="留空则使用主模型" autocomplete="off" autocapitalize="off" spellcheck="false" />
          </div>
          <div class="settings-row">
            <label for="settings-var-api-url">变量模型 API 地址</label>
            <input class="settings-input" id="settings-var-api-url" value="${this._escAttr(config.variableUpdater?.apiUrl || config.apiUrl || '')}" placeholder="留空则使用主 API 地址" autocomplete="off" autocapitalize="off" spellcheck="false" />
          </div>
          <div class="settings-row">
            <label for="settings-var-api-key">变量模型 API Key</label>
            <input class="settings-input" id="settings-var-api-key" type="password" value="${this._escAttr(config.variableUpdater?.apiKey || '')}" placeholder="留空则使用主 API Key" autocomplete="new-password" autocapitalize="off" spellcheck="false" />
          </div>
          <div class="settings-row">
            <label for="settings-var-backend">变量模型类型</label>
            <select class="settings-select" id="settings-var-backend">
              ${this._option('inherit', '跟随主模型', config.variableUpdater?.backend || 'inherit')}
              ${this._option('openai', 'OpenAI 兼容', config.variableUpdater?.backend || 'inherit')}
              ${this._option('claude', 'Claude / Anthropic', config.variableUpdater?.backend || 'inherit')}
              ${this._option('deepseek', 'DeepSeek', config.variableUpdater?.backend || 'inherit')}
              ${this._option('custom', '自定义兼容', config.variableUpdater?.backend || 'inherit')}
            </select>
          </div>
        </div>
        ` : ''}
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
    const fetchBtn = this.shadowRoot.querySelector('#settings-fetch-models');
    const modelInput = this.shadowRoot.querySelector('#settings-api-model');
    const modelSelect = this.shadowRoot.querySelector('#settings-model-select');
    const modelOptions = this.shadowRoot.querySelector('#settings-model-options');
    const status = this.shadowRoot.querySelector('#settings-model-status');

    fetchBtn?.addEventListener('click', async () => {
      const config = this.getConfig(true);
      if (!config) return;
      if (config.backend === 'tavern') {
        status.textContent = '酒馆模型无需读取，使用当前 API 连接即可。';
        return;
      }
      if (!config?.apiUrl) {
        eventBus.emit('app:toast', '请先填写 API 地址。');
        return;
      }
      fetchBtn.disabled = true;
      fetchBtn.textContent = '读取中';
      status.textContent = '正在连接模型端点...';
      try {
        const models = await aiClient.listModels(config);
        if (!models.length) throw new Error('服务返回为空模型列表');
        modelOptions.innerHTML = models.map(id => `<option value="${this._escAttr(id)}"></option>`).join('');
        modelSelect.innerHTML = '<option value="">选择已读取模型</option>' + models.map(id => `<option value="${this._escAttr(id)}">${this._escAttr(id)}</option>`).join('');
        modelSelect.hidden = false;
        if (!modelInput.value && models[0]) modelInput.value = models[0];
        status.textContent = `已读取 ${models.length} 个模型。`;
        eventBus.emit('app:toast', `已读取 ${models.length} 个模型`);
      } catch (error) {
        status.textContent = '读取失败，可继续手动填写模型名。';
        eventBus.emit('app:toast', error.message || '模型列表读取失败');
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '读取模型';
      }
    });

    modelSelect?.addEventListener('change', () => {
      if (modelSelect.value) modelInput.value = modelSelect.value;
    });
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

    if (this._showAdvanced) {
      config.promptPreset = root.querySelector('#settings-prompt-preset')?.value || PROMPTS.DEFAULT_PROMPT_PRESET_ID;
      const varEnabled = root.querySelector('#settings-var-enabled')?.checked;
      if (varEnabled) {
        config.variableUpdater = {
          enabled: true,
          model: root.querySelector('#settings-var-model')?.value.trim() || model,
          apiUrl: root.querySelector('#settings-var-api-url')?.value.trim() || finalApiUrl,
          apiKey: root.querySelector('#settings-var-api-key')?.value.trim() || apiKey,
          backend: root.querySelector('#settings-var-backend')?.value || 'inherit'
        };
      } else {
        config.variableUpdater = { enabled: false };
      }
    } else {
      // Retain existing advanced settings if they exist
      config.promptPreset = this._config.promptPreset || PROMPTS.DEFAULT_PROMPT_PRESET_ID;
      config.variableUpdater = this._config.variableUpdater;
    }
    
    return config;
  }
}

customElements.define('api-config-form', ApiConfigForm);