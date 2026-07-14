import {
  DEFAULT_VARIABLE_UPDATER_PRESET,
  VARIABLE_UPDATER_MACROS,
  getVariableUpdaterPreset,
  normalizeVariableUpdaterPreset,
  saveVariableUpdaterPreset
} from '../data/variable-updater-preset.js';
import { escHtml, escAttr } from '../utils/format.js';
import GameModal from './modal.js';

class VariableUpdaterPresetEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._preset = null;
    this._expanded = 0;
  }

  connectedCallback() {
    this._preset = getVariableUpdaterPreset();
    this._render();
  }

  _render() {
    const entries = this._preset?.entries || [];
    this.shadowRoot.innerHTML = `
      <style>
        :host { position:fixed; inset:0; z-index:100002; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; color:#e8e4d9; font-family:'Noto Sans SC',system-ui,sans-serif; background:rgba(3,5,8,.94); backdrop-filter:blur(10px); }
        .editor { width:min(1040px,100%); height:min(88vh,900px); display:flex; flex-direction:column; overflow:hidden; background:#0d1117; border:1px solid rgba(198,156,109,.24); border-radius:12px; box-shadow:0 24px 80px rgba(0,0,0,.55); }
        header,.toolbar,footer { flex:none; display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid rgba(255,255,255,.07); }
        header { justify-content:space-between; }
        footer { border-top:1px solid rgba(255,255,255,.07); border-bottom:0; justify-content:space-between; color:#777; font-size:11px; }
        h2 { margin:0; font:700 16px/1.3 'Noto Serif SC',serif; letter-spacing:2px; }
        .actions,.toolbar { display:flex; gap:8px; flex-wrap:wrap; }
        .toolbar input { flex:1; min-width:220px; }
        button,input,select,textarea { box-sizing:border-box; font:inherit; }
        button { border:1px solid rgba(255,255,255,.14); border-radius:6px; padding:7px 12px; color:#ddd; background:rgba(255,255,255,.04); cursor:pointer; }
        button:hover { border-color:rgba(235,97,63,.65); background:rgba(235,97,63,.08); }
        button.primary { color:#fff; background:#eb613f; border-color:#eb613f; font-weight:700; }
        button.danger { color:#ef7774; }
        input,select,textarea { color:#e8e4d9; background:#070a0e; border:1px solid rgba(255,255,255,.12); border-radius:6px; padding:9px 10px; outline:none; }
        input:focus,select:focus,textarea:focus { border-color:#eb613f; }
        .macro-bar { padding:10px 16px; color:#999; font-size:11px; line-height:1.8; border-bottom:1px solid rgba(255,255,255,.06); }
        code { margin-right:8px; color:#ffad8f; user-select:all; }
        main { flex:1; min-height:0; overflow:auto; padding:10px 16px 24px; }
        .entry { border-bottom:1px solid rgba(255,255,255,.06); border-left:2px solid transparent; }
        .entry.open { border-left-color:#eb613f; background:rgba(255,255,255,.018); }
        .entry-head { display:flex; align-items:center; gap:9px; padding:12px 10px; cursor:pointer; }
        .index { width:24px; color:#666; font-size:11px; text-align:center; }
        .toggle { width:34px; height:19px; border:0; border-radius:10px; padding:0; background:#34383d; position:relative; }
        .toggle::after { content:''; position:absolute; width:13px; height:13px; border-radius:50%; top:3px; left:3px; background:#aaa; transition:.2s; }
        .toggle.on { background:rgba(235,97,63,.4); }
        .toggle.on::after { left:18px; background:#eb613f; }
        .entry-name { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .entry-name.off { color:#666; text-decoration:line-through; }
        .role { color:#999; font-size:10px; border:1px solid rgba(255,255,255,.1); border-radius:4px; padding:2px 6px; }
        .entry-tools { display:flex; gap:5px; }
        .entry-tools button { padding:4px 8px; font-size:11px; }
        .entry-body { display:none; padding:0 12px 16px 44px; }
        .entry.open .entry-body { display:block; }
        .field { display:grid; grid-template-columns:60px 1fr; gap:10px; align-items:center; margin-bottom:10px; color:#999; font-size:12px; }
        textarea { width:100%; min-height:260px; resize:vertical; font:12px/1.65 'JetBrains Mono',Consolas,monospace; white-space:pre-wrap; }
        .empty { padding:60px 20px; text-align:center; color:#777; }
        input[type=file] { display:none; }
        @media(max-width:700px) { :host{padding:0}.editor{height:100vh;border-radius:0}.entry-body{padding-left:12px}.field{grid-template-columns:1fr}.actions{justify-content:flex-end}header{align-items:flex-start}textarea{min-height:220px} }
      </style>
      <section class="editor" role="dialog" aria-modal="true" aria-label="变量更新预设编辑器">
        <header>
          <div><h2>变量更新预设</h2></div>
          <div class="actions">
            <input id="import-file" type="file" accept=".json,application/json">
            <button data-action="import">导入</button>
            <button data-action="export">导出</button>
            <button data-action="reset">恢复默认</button>
            <button class="primary" data-action="save">保存</button>
            <button data-action="close">关闭</button>
          </div>
        </header>
        <div class="toolbar">
          <input id="preset-name" value="${escAttr(this._preset?.name || '')}" placeholder="预设名称">
          <button data-action="add">+ 新增预设条目</button>
        </div>
        <div class="macro-bar">
          可用动态宏：${VARIABLE_UPDATER_MACROS.map(item => `<code>{{${escHtml(item.key)}}}</code>${escHtml(item.label)}`).join('　')}
        </div>
        <main>
          ${entries.length ? entries.map((entry, index) => this._renderEntry(entry, index)).join('') : '<div class="empty">当前预设没有条目。</div>'}
        </main>
        <footer><span>共 ${entries.length} 条，启用 ${entries.filter(entry => entry.enabled !== false).length} 条</span><span>运行时按当前顺序组成真实 role 链</span></footer>
      </section>`;
    this._bind();
  }

  _renderEntry(entry, index) {
    const open = this._expanded === index;
    return `
      <article class="entry${open ? ' open' : ''}" data-index="${index}">
        <div class="entry-head">
          <span class="index">${index + 1}</span>
          <button class="toggle${entry.enabled !== false ? ' on' : ''}" data-action="toggle" title="启用/停用"></button>
          <span class="entry-name${entry.enabled === false ? ' off' : ''}">${escHtml(entry.name || '未命名条目')}</span>
          <span class="role">${escHtml(entry.role || 'system')}</span>
          <span class="entry-tools">
            <button data-action="up" title="上移">▲</button>
            <button data-action="down" title="下移">▼</button>
            <button class="danger" data-action="delete" title="删除">删除</button>
          </span>
        </div>
        <div class="entry-body">
          <label class="field"><span>名称</span><input data-field="name" value="${escAttr(entry.name || '')}"></label>
          <label class="field"><span>Role</span><select data-field="role">
            <option value="system"${entry.role === 'system' ? ' selected' : ''}>system</option>
            <option value="user"${entry.role === 'user' ? ' selected' : ''}>user</option>
            <option value="assistant"${entry.role === 'assistant' ? ' selected' : ''}>assistant</option>
          </select></label>
          <textarea data-field="content" spellcheck="false">${escHtml(entry.content || '')}</textarea>
        </div>
      </article>`;
  }

  _bind() {
    const root = this.shadowRoot;
    root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      this._handle(button.dataset.action, button.closest('.entry'));
    }));
    root.querySelectorAll('.entry-head').forEach(head => head.addEventListener('click', event => {
      if (event.target.closest('[data-action]')) return;
      this._sync();
      this._expanded = Number(head.closest('.entry').dataset.index);
      this._render();
    }));
    root.querySelector('#import-file')?.addEventListener('change', event => this._importFile(event.target.files?.[0]));
  }

  async _handle(action, entryElement) {
    if (action === 'close') return this.remove();
    if (action === 'save') {
      this._sync();
      try {
        this._preset = saveVariableUpdaterPreset(this._preset);
        this.dispatchEvent(new CustomEvent('preset-saved', { bubbles: true, composed: true, detail: this._preset }));
        this.remove();
      } catch (error) {
        GameModal.alert({ title: '保存失败', message: error.message });
      }
      return;
    }
    if (action === 'import') return this.shadowRoot.querySelector('#import-file')?.click();
    if (action === 'export') return this._export();
    if (action === 'reset') {
      const confirmed = await GameModal.confirm({ title: '恢复默认', message: '当前未保存修改将被默认变量更新预设覆盖。' });
      if (!confirmed) return;
      this._preset = JSON.parse(JSON.stringify(DEFAULT_VARIABLE_UPDATER_PRESET));
      this._expanded = 0;
      return this._render();
    }
    if (action === 'add') {
      this._sync();
      this._preset.entries.push({ id: `custom_${Date.now()}`, name: '新预设条目', enabled: true, role: 'system', content: '' });
      this._expanded = this._preset.entries.length - 1;
      return this._render();
    }

    const index = Number(entryElement?.dataset.index);
    if (!Number.isInteger(index)) return;
    this._sync();
    if (action === 'toggle') this._preset.entries[index].enabled = this._preset.entries[index].enabled === false;
    if (action === 'up' && index > 0) {
      [this._preset.entries[index - 1], this._preset.entries[index]] = [this._preset.entries[index], this._preset.entries[index - 1]];
      this._expanded = index - 1;
    }
    if (action === 'down' && index < this._preset.entries.length - 1) {
      [this._preset.entries[index + 1], this._preset.entries[index]] = [this._preset.entries[index], this._preset.entries[index + 1]];
      this._expanded = index + 1;
    }
    if (action === 'delete') {
      const confirmed = await GameModal.confirm({ title: '删除预设条目', message: `确认删除「${this._preset.entries[index].name}」？` });
      if (!confirmed) return;
      this._preset.entries.splice(index, 1);
      this._expanded = Math.min(index, this._preset.entries.length - 1);
    }
    this._render();
  }

  _sync() {
    const root = this.shadowRoot;
    if (!root || !this._preset) return;
    this._preset.name = root.querySelector('#preset-name')?.value.trim() || '未命名变量更新预设';
    root.querySelectorAll('.entry').forEach(element => {
      const entry = this._preset.entries[Number(element.dataset.index)];
      if (!entry) return;
      entry.name = element.querySelector('[data-field=name]')?.value || entry.name;
      entry.role = element.querySelector('[data-field=role]')?.value || entry.role;
      entry.content = element.querySelector('[data-field=content]')?.value ?? entry.content;
    });
  }

  _export() {
    this._sync();
    const blob = new Blob([JSON.stringify(this._preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `variable_updater_preset_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  _importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this._preset = normalizeVariableUpdaterPreset(JSON.parse(reader.result));
        this._expanded = this._preset.entries.length ? 0 : -1;
        this._render();
      } catch (error) {
        GameModal.alert({ title: '导入失败', message: error.message });
      }
    };
    reader.readAsText(file);
  }
}

customElements.define('variable-updater-preset-editor', VariableUpdaterPresetEditor);
export default VariableUpdaterPresetEditor;
