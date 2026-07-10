import { eventBus } from '../core/event-bus.js';
import { escHtml, escAttr } from '../utils/format.js';
import GameModal from './modal.js';

class DeveloperPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._unsubs = [];
  }

  connectedCallback() {
    this.render();
    this._unsubs = [
      eventBus.on('debug:prompt-trace', () => this.render()),
      eventBus.on('debug:agent-prompt-trace', () => this.render()),
      eventBus.on('debug:variable-updater-prompt-trace', () => this.render())
    ];
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn?.());
    this._unsubs = [];
  }

  render() {
    const main = this._readJson('naruto_prompt_trace', null);
    const variableUpdater = this._readJson('naruto_variable_updater_prompt_trace', null);
    const agents = this._readJson('naruto_agent_prompt_traces', []);
    const agentList = Array.isArray(agents) ? agents : [];

    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;height:100%;color:var(--text-primary);font-family:var(--font-body);}
        .dev-panel{height:100%;display:flex;flex-direction:column;background:rgba(7,10,14,.18);}
        .dev-head{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        .dev-title{font-family:var(--font-title);font-weight:800;letter-spacing:2px;color:var(--c-kin-bright);font-size:15px}
        .dev-sub{font-size:11px;color:var(--text-tertiary);line-height:1.6;margin-top:4px}
        .dev-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
        button{border:1px solid rgba(198,156,109,.35);background:rgba(198,156,109,.08);color:var(--text-primary);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
        button:hover{background:rgba(198,156,109,.16);border-color:rgba(198,156,109,.55)}
        .dev-body{flex:1;overflow:auto;padding:14px 14px 24px;}
        .dev-card{border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(0,0,0,.18);padding:12px;margin-bottom:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
        .dev-card-title{font-weight:800;color:var(--c-kin-bright);margin-bottom:6px;font-size:13px;letter-spacing:1px}
        .dev-meta{font-size:11px;color:var(--text-tertiary);line-height:1.7;margin-bottom:8px;word-break:break-word}
        .role-chain{display:grid;gap:6px;margin:8px 0 12px}
        .role-item{border:0;margin:0;padding:0;border-radius:8px;background:rgba(255,255,255,.035);overflow:hidden}
        .role-item[open]{background:rgba(255,255,255,.055)}
        .role-summary{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) 52px;grid-template-areas:'idx role len' 'idx source source';column-gap:6px;row-gap:1px;align-items:center;padding:7px 8px;color:var(--text-secondary)}
        .role-summary::-webkit-details-marker{display:none}
        .role-item .role-summary::before{content:'▸';color:var(--c-kin-bright);grid-column:1;position:absolute;margin-left:-2px;transform:translateX(-2px)}
        .role-item[open] .role-summary::before{content:'▾'}
        .idx{grid-area:idx;padding-left:12px;font-size:10px;color:var(--text-tertiary);font-variant-numeric:tabular-nums}
        .role{grid-area:role;font-size:8px;line-height:1;font-weight:800;color:#8fd3ff;text-transform:uppercase}
        .source{grid-area:source;font-size:12px;line-height:1.35;font-weight:800;color:var(--text-primary);overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere}
        .len{grid-area:len;text-align:right;font-size:10px;color:var(--text-tertiary);font-variant-numeric:tabular-nums}
        details.block{margin-top:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:8px}
        details.block>summary{cursor:pointer;color:var(--c-kin-bright);font-size:12px;margin:4px 0;line-height:1.5}
        pre{white-space:pre-wrap;word-break:break-word;max-height:520px;overflow:auto;border:1px solid rgba(255,255,255,.06);border-radius:8px;background:rgba(0,0,0,.30);padding:10px;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--text-secondary);user-select:text}
        .role-item pre{margin:0 8px 8px;max-height:420px}
        .empty{padding:30px 18px;text-align:center;color:var(--text-tertiary);border:1px dashed rgba(255,255,255,.14);border-radius:12px;line-height:1.8}
        .pill{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;background:rgba(143,211,255,.10);color:#8fd3ff;border:1px solid rgba(143,211,255,.18);font-size:10px;margin-right:4px}
      </style>
      <div class="dev-panel">
        <div class="dev-head">
          <div>
            <div class="dev-title">提示词查看</div>
            <div class="dev-sub">查看真实 role 链、完整预设内容、世界书/知识库、动态状态、记忆与 Agent 注入。</div>
          </div>
          <div class="dev-actions">
            <button data-action="copy">复制全部</button>
            <button data-action="clear">清空</button>
          </div>
        </div>
        <div class="dev-body">
          ${main ? this._renderTraceCard(main) : '<div class="empty">暂无预设记录</div>'}
          ${variableUpdater ? this._renderTraceCard(variableUpdater) : ''}
          ${agentList.length ? `<div class="dev-card"><div class="dev-card-title">Agent 子调用链 <span class="pill">最近 ${agentList.length} 次</span></div>${agentList.map(t => this._renderTraceCard(t)).join('')}</div>` : ''}
        </div>
      </div>`;

    this.shadowRoot.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
      try {
        localStorage.removeItem('naruto_prompt_trace');
        localStorage.removeItem('naruto_variable_updater_prompt_trace');
        localStorage.removeItem('naruto_agent_prompt_traces');
      } catch {}
      this.render();
    });
    this.shadowRoot.querySelector('[data-action="copy"]')?.addEventListener('click', () => this._copyAll());
  }

  _renderTraceCard(trace) {
    const messages = this._getTraceMessages(trace);
    const totalChars = messages.reduce((sum, m) => sum + Number(m.length || String(m.content || '').length || 0), 0);
    const roleItems = messages.map((msg, index) => this._renderRoleItem(msg, index)).join('');
    const fullPrompt = this._formatFullPrompt(messages);
    const injections = (trace.injections || []).map((item, idx) => {
      const name = this._cleanLabel(item.name || item.source || '注入项');
      const length = Number(item.length || String(item.content || '').length).toLocaleString();
      return `
        <details class="block">
          <summary>${idx + 1}. ${this._esc(name)}（${length}字）</summary>
          <pre>${this._esc(item.content || '')}</pre>
        </details>`;
    }).join('');

    return `
      <section class="dev-card">
        <div class="dev-card-title">${this._esc(trace.title || trace.kind || '预设链条')}</div>
        <div class="dev-meta">
          <span class="pill">${this._esc(trace.kind || 'main')}</span>
          ${trace.agentType ? `<span class="pill">${this._esc(trace.agentType)}</span>` : ''}
          ${trace.updaterEnabled !== undefined ? `<span class="pill">变量：${trace.updaterEnabled ? '二阶段' : '主模型'}</span>` : ''}<br>
          时间：${this._esc(this._formatLocalTime(trace.createdAt))}<br>
          用户输入：${this._esc(trace.userInput || '')}<br>
          消息数：${messages.length}；总字符：${totalChars.toLocaleString()}
        </div>
        <details class="block" open>
          <summary>真实 Role 链条（${this._esc(this._formatLocalTime(trace.createdAt))}）</summary>
          <div class="role-chain">${roleItems || '<div class="empty">无 role 链记录</div>'}</div>
        </details>
        <details class="block">
          <summary>完整预设内容</summary>
          <pre>${this._esc(fullPrompt || '无预设消息')}</pre>
        </details>
        <details class="block">
          <summary>注入项拆解</summary>
          ${injections || '<div class="empty">无注入拆解</div>'}
        </details>
      </section>`;
  }

  _renderRoleItem(msg, fallbackIndex) {
    const index = Number.isFinite(Number(msg.index)) ? Number(msg.index) + 1 : fallbackIndex + 1;
    const role = msg.role || 'system';
    const source = this._cleanLabel(msg.source || '');
    const label = this._cleanLabel(msg.label || '');
    const title = [source, label].filter(Boolean).join(' / ');
    const length = Number(msg.length || String(msg.content || '').length || 0).toLocaleString();

    return `
      <details class="role-item">
        <summary class="role-summary" title="${this._escAttr(title)}">
          <span class="idx">#${index}</span>
          <span class="role">${this._esc(role)}</span>
          <span class="source">${this._esc(title || '(无来源)')}</span>
          <span class="len">${length}字</span>
        </summary>
        <pre>${this._esc(msg.content || '')}</pre>
      </details>`;
  }

  _getTraceMessages(trace) {
    if (Array.isArray(trace.messages) && trace.messages.length) return trace.messages;
    if (!Array.isArray(trace.roleChain)) return [];
    return trace.roleChain.map(row => ({ ...row, content: '' }));
  }

  _formatFullPrompt(messages) {
    return messages.map((msg, fallbackIndex) => {
      const idx = Number.isFinite(Number(msg.index)) ? Number(msg.index) + 1 : fallbackIndex + 1;
      const source = [this._cleanLabel(msg.source), this._cleanLabel(msg.label)].filter(Boolean).join(' / ');
      return [
        `===== #${idx} role=${msg.role || 'system'}${source ? ` | ${source}` : ''} | ${Number(msg.length || String(msg.content || '').length || 0).toLocaleString()}字 =====`,
        msg.content || ''
      ].join('\n');
    }).join('\n\n');
  }

  _formatLocalTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  _cleanLabel(value) {
    return String(value || '')
      .replace(/^\?{3}\s*Bottom$/, '主预设 Bottom')
      .replace(/^\?{3}\s*Top$/, '主预设 Top')
      .replace(/\?{3}\s*Bottom/g, '主预设 Bottom')
      .replace(/\?{3}\s*Top/g, '主预设 Top');
  }

  async _copyAll() {
    const text = this._formatPromptTraceText();
    try {
      await navigator.clipboard.writeText(text);
      GameModal.alert({ title: '已复制', message: '预设 / 注入链条已复制到剪贴板。' });
    } catch {
      GameModal.prompt({ title: '复制预设 / 注入链条', message: '选中下方内容复制', value: text, multiline: true, rows: 14, okLabel: '关闭' });
    }
  }

  _readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  _formatPromptTraceText() {
    const main = this._readJson('naruto_prompt_trace', null);
    const variableUpdater = this._readJson('naruto_variable_updater_prompt_trace', null);
    const agents = this._readJson('naruto_agent_prompt_traces', []);
    const blocks = [];
    const dump = (trace) => {
      if (!trace) return;
      const messages = this._getTraceMessages(trace);
      blocks.push(`===== ${trace.title || trace.kind || '预设链条'} =====`);
      blocks.push(`time: ${this._formatLocalTime(trace.createdAt)}`);
      blocks.push(`userInput: ${trace.userInput || ''}`);
      blocks.push('--- role chain ---');
      for (const msg of messages) {
        const index = Number.isFinite(Number(msg.index)) ? Number(msg.index) + 1 : messages.indexOf(msg) + 1;
        blocks.push(`#${index} ${msg.role || ''} | ${this._cleanLabel(msg.source)} | ${this._cleanLabel(msg.label)} | ${msg.length || 0} chars`);
      }
      blocks.push('--- full preset ---');
      blocks.push(this._formatFullPrompt(messages));
      blocks.push('--- injections ---');
      for (const item of trace.injections || []) blocks.push(`\n[${this._cleanLabel(item.name || 'injection')}]\n${item.content || ''}`);
    };
    dump(main);
    dump(variableUpdater);
    for (const trace of (Array.isArray(agents) ? agents : [])) dump(trace);
    return blocks.join('\n');
  }

  _esc(value) { return escHtml(value); }
  _escAttr(value) { return escAttr(value); }
}

if (!customElements.get('developer-panel')) customElements.define('developer-panel', DeveloperPanel);

export default DeveloperPanel;
