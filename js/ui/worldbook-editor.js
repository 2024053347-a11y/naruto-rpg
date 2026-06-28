import { KNOWLEDGE_BASE } from '../data/knowledge-base.js';
import { eventBus } from '../core/event-bus.js';
import { escHtml, escAttr } from '../utils/format.js';
import GameModal from './modal.js';
import { worldbookStyles } from '../../css/components/worldbook-editor.css.js';

export class WorldbookEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._builtin = [];
    this._custom = [];
    this._selectedType = null;
    this._selectedIndex = -1;
    this._searchQuery = '';
    this._builtinExpanded = false;
  }

  connectedCallback() {
    this._load();
    this._render();
    this._bindEvents();
  }

  _load() {
    this._builtin = KNOWLEDGE_BASE.getDefaultEntries();
    this._custom = KNOWLEDGE_BASE.getCustomEntries().map((e, i) => ({ ...e, _idx: i }));
  }

  _save() {
    KNOWLEDGE_BASE.saveCustomEntries(this._custom.map(e => {
      const { _idx, ...entry } = e;
      return entry;
    }));
    eventBus.emit('app:toast', `已保存 ${this._custom.length} 条自定义世界书 (下次加载生效)`);
  }

  _export() {
    const data = JSON.stringify({
      builtinCount: this._builtin.length,
      custom: this._custom.map(e => { const { _idx, ...entry } = e; return entry; })
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worldbook_custom_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _import(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        const imported = Array.isArray(json) ? json : (json.custom || json.entries || []);
        if (!Array.isArray(imported)) throw new Error('无效格式');
        let added = 0, updated = 0;
        for (const entry of imported) {
          if (!entry.title) continue;
          const clean = { ...entry, source: 'custom', enabled: entry.enabled !== false, _idx: this._custom.length };
          delete clean.isAlwaysOn;
          const existed = this._custom.findIndex(e => e.title === clean.title);
          if (existed >= 0) { this._custom[existed] = clean; updated++; }
          else { this._custom.push(clean); added++; }
        }
        this._custom.forEach((e, i) => e._idx = i);
        this._save();
        this._render();
        this._bindEvents();
        GameModal.alert({ title: '导入完成', message: `新增 ${added} 条，更新 ${updated} 条自定义条目。` });
      } catch (e) {
        GameModal.alert({ title: '导入失败', message: e.message });
      }
    };
    reader.readAsText(file);
  }

  _toggleCustom(entry) {
    entry.enabled = !entry.enabled;
    this._save();
    this._render();
    this._bindEvents();
  }

  _toggleAllCustom(enable) {
    this._custom.forEach(e => e.enabled = enable);
    this._save();
    this._render();
    this._bindEvents();
  }

  _restoreDefaults() {
    GameModal.confirm({
      title: '恢复默认',
      message: '这将删除所有自定义世界书条目并恢复内置条目。确定继续？',
      okLabel: '确定', cancelLabel: '取消'
    }).then(confirmed => {
      if (confirmed) {
        this._custom = [];
        this._save();
        this._render();
        this._bindEvents();
      }
    });
  }

  _render() {
    const builtinSearch = this._searchQuery ? this._builtin.filter(b =>
      (b.title || '').toLowerCase().includes(this._searchQuery.toLowerCase()) ||
      (b.keys || []).some(k => k.toLowerCase().includes(this._searchQuery.toLowerCase()))
    ) : this._builtin;
    const customSearch = this._searchQuery ? this._custom.filter(c =>
      (c.title || '').toLowerCase().includes(this._searchQuery.toLowerCase()) ||
      (c.keys || []).some(k => k.toLowerCase().includes(this._searchQuery.toLowerCase()))
    ) : this._custom;
    const enabledCount = this._custom.filter(e => e.enabled !== false).length;

    const selectedEntry = this._selectedType === 'custom' && this._selectedIndex >= 0 && this._selectedIndex < this._custom.length
      ? this._custom[this._selectedIndex] : (this._selectedType === 'builtin' && this._selectedIndex >= 0 && this._selectedIndex < this._builtin.length
      ? this._builtin[this._selectedIndex] : null);
    const isBuiltin = this._selectedType === 'builtin';

    this.shadowRoot.innerHTML = `
      <style>${worldbookStyles}</style>
      <div class="wb-container">
        <div class="wb-header">
          <h2 class="wb-title">世界书编辑器 <span>| 内置 ${this._builtin.length} 条 + 自定义 ${this._custom.length} 条${enabledCount !== this._custom.length ? ` (启用 ${enabledCount}/${this._custom.length})` : ''}</span></h2>
          <div class="wb-actions">
            <button class="btn" id="btn-export">导出</button>
            <button class="btn" id="btn-import">导入</button>
            <button class="btn danger sm" id="btn-restore">恢复默认</button>
            <button class="btn" id="btn-close">返回</button>
            <input type="file" id="file-import" accept=".json" hidden />
          </div>
        </div>
        <div class="wb-body">
          <div class="wb-sidebar">
            <div class="wb-search-bar">
              <input type="text" class="wb-search-input" id="search-input" placeholder="搜索条目..." value="${escAttr(this._searchQuery)}">
            </div>
            <div class="wb-list" id="entry-list">
              <div class="wb-section-hdr" id="toggle-builtin">
                内置世界书 <span class="count">${builtinSearch.length} 条 · 只读</span>
                <span style="font-size:10px;color:rgba(232,228,217,0.3);">${this._builtinExpanded ? '▾' : '▸'}</span>
              </div>
              ${this._builtinExpanded ? builtinSearch.map(e => `
                <div class="wb-item${this._selectedType === 'builtin' && this._selectedIndex === this._builtin.indexOf(e) ? ' active' : ''}" data-type="builtin" data-title="${escAttr(e.title)}">
                  <span class="wb-builtin-tag">内置</span>
                  <span class="wb-item-title">${escHtml(e.title || '无标题')}</span>
                  <span class="wb-item-meta">${(e.keys||[]).length} 关键词</span>
                </div>`).join('') : ''}
              <div class="wb-section-hdr" style="margin-top:2px;">
                自定义世界书 <span class="count">${customSearch.length} 条${customSearch.length ? ` · 启用 ${customSearch.filter(e=>e.enabled!==false).length}` : ''}</span>
              </div>
              ${customSearch.map(e => `
                <div class="wb-item${this._selectedType === 'custom' && this._selectedIndex === e._idx ? ' active' : ''}" data-type="custom" data-idx="${e._idx}">
                  <div class="wb-item-toggle ${e.enabled !== false ? 'on' : ''}" data-action="toggle" data-idx="${e._idx}" title="${e.enabled !== false ? '已启用' : '已禁用'}"></div>
                  <span class="wb-item-title">${escHtml(e.title || '无标题')}</span>
                  <span class="wb-item-meta">${(e.keys||[]).length} 关键词</span>
                </div>`).join('')}
              ${customSearch.length === 0 ? '<div style="padding:12px;text-align:center;color:rgba(232,228,217,0.15);font-size:12px;">暂无自定义条目<br>点击「导入」或下方按钮添加</div>' : ''}
            </div>
            <div class="wb-sidebar-foot">
              <button class="btn sm" id="btn-add">+ 新建</button>
              <button class="btn sm good" id="btn-enable-all">全部启用</button>
              <button class="btn sm" id="btn-disable-all" style="opacity:0.6;">全部禁用</button>
            </div>
          </div>
          <div class="wb-editor">
            ${selectedEntry ? `
              ${isBuiltin ? `<div class="wb-readonly-banner">🔒 这是内置条目，无法编辑。如需修改可复制内容到自定义条目。</div>` : ''}
              <div class="wb-form-group">
                <label class="wb-form-label">标题</label>
                <input type="text" class="wb-input" id="entry-title" value="${escAttr(selectedEntry.title || '')}" placeholder="条目名称" ${isBuiltin ? 'disabled' : ''}>
              </div>
              ${!isBuiltin ? `
              <div class="wb-form-group" style="display:flex;align-items:center;gap:12px;">
                <label class="wb-form-label" style="margin:0;">挂载状态:</label>
                <div class="wb-item-toggle ${selectedEntry.enabled !== false ? 'on' : ''}" id="entry-toggle" style="cursor:pointer;" title="${selectedEntry.enabled !== false ? '已启用挂载' : '已禁用挂载'}"></div>
                <span style="font-size:12px;color:rgba(232,228,217,0.5);">${selectedEntry.enabled !== false ? '已挂载 · AI 可匹配此条目' : '未挂载 · AI 不会读取此条目'}</span>
              </div>` : ''}
              <div class="wb-form-group">
                <label class="wb-form-label">触发关键词 (逗号分隔)</label>
                <input type="text" class="wb-input" id="entry-keys" value="${escAttr((selectedEntry.keys || []).join(', '))}" placeholder="关键词1, 关键词2" ${isBuiltin ? 'disabled' : ''}>
              </div>
              <div class="wb-form-group" style="flex:1; display:flex; flex-direction:column;">
                <label class="wb-form-label">内容</label>
                <textarea class="wb-input wb-textarea" id="entry-content" style="flex:1;" placeholder="条目内容..." ${isBuiltin ? 'disabled' : ''}>${escHtml(selectedEntry.content || '')}</textarea>
              </div>
              ${!isBuiltin ? `
              <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="btn danger" id="btn-delete">删除此条目</button>
              </div>` : ''}
            ` : `<div class="wb-editor-empty">选择左侧条目查看详情<br><span style="font-size:11px;color:rgba(232,228,217,0.1);">内置条目只读 · 自定义条目可编辑</span></div>`}
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    const root = this.shadowRoot;

    root.querySelector('#btn-close')?.addEventListener('click', () => {
      this._saveCurrentEdit();
      this.remove();
    });

    root.querySelector('#btn-export')?.addEventListener('click', () => this._export());
    root.querySelector('#btn-restore')?.addEventListener('click', () => this._restoreDefaults());

    const fileInput = root.querySelector('#file-import');
    root.querySelector('#btn-import')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) this._import(e.target.files[0]);
      e.target.value = '';
    });

    root.querySelector('#search-input')?.addEventListener('input', (e) => {
      this._saveCurrentEdit();
      this._searchQuery = e.target.value;
      this._render();
      this._bindEvents();
      root.querySelector('#search-input')?.focus();
    });

    root.querySelector('#toggle-builtin')?.addEventListener('click', () => {
      this._saveCurrentEdit();
      this._builtinExpanded = !this._builtinExpanded;
      this._render();
      this._bindEvents();
    });

    root.querySelector('#btn-add')?.addEventListener('click', () => {
      this._saveCurrentEdit();
      this._custom.push({ title: '新条目', keys: [], content: '', source: 'custom', enabled: true, _idx: this._custom.length });
      this._selectedType = 'custom';
      this._selectedIndex = this._custom.length - 1;
      this._searchQuery = '';
      this._save();
      this._render();
      this._bindEvents();
    });

    root.querySelector('#btn-enable-all')?.addEventListener('click', () => this._toggleAllCustom(true));
    root.querySelector('#btn-disable-all')?.addEventListener('click', () => this._toggleAllCustom(false));

    root.querySelector('#btn-delete')?.addEventListener('click', async () => {
      if (this._selectedType !== 'custom' || this._selectedIndex < 0) return;
      const confirmed = await GameModal.confirm({ title: '删除条目', message: '确定删除此自定义条目？不可撤销。', okLabel: '删除', cancelLabel: '取消' });
      if (confirmed) {
        this._custom.splice(this._selectedIndex, 1);
        this._custom.forEach((e, i) => e._idx = i);
        this._selectedIndex = Math.min(this._selectedIndex, this._custom.length - 1);
        if (this._custom.length === 0) { this._selectedType = null; this._selectedIndex = -1; }
        this._save();
        this._render();
        this._bindEvents();
      }
    });

    root.querySelector('#entry-toggle')?.addEventListener('click', () => {
      if (this._selectedType !== 'custom' || this._selectedIndex < 0) return;
      this._custom[this._selectedIndex].enabled = !this._custom[this._selectedIndex].enabled;
      this._save();
      this._render();
      this._bindEvents();
    });

    const allItems = root.querySelectorAll('.wb-item');
    allItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const toggleEl = e.target.closest('.wb-item-toggle');
        if (toggleEl) return;
        this._saveCurrentEdit();
        const type = item.dataset.type;
        if (type === 'builtin') {
          const title = item.dataset.title;
          const idx = this._builtin.findIndex(b => b.title === title);
          if (idx >= 0) { this._selectedType = 'builtin'; this._selectedIndex = idx; }
        } else if (type === 'custom') {
          const idx = parseInt(item.dataset.idx, 10);
          if (idx >= 0 && idx < this._custom.length) { this._selectedType = 'custom'; this._selectedIndex = idx; }
        }
        this._render();
        this._bindEvents();
      });
    });

    const toggles = root.querySelectorAll('.wb-item-toggle');
    toggles.forEach(t => {
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(t.dataset.idx, 10);
        if (idx >= 0 && idx < this._custom.length) {
          this._custom[idx].enabled = !this._custom[idx].enabled;
          if (this._selectedType === 'custom' && this._selectedIndex === idx) {
            this._selectedEntry = this._custom[idx];
          }
          this._save();
          this._render();
          this._bindEvents();
        }
      });
    });
  }

  _saveCurrentEdit() {
    if (this._selectedType !== 'custom' || this._selectedIndex < 0 || this._selectedIndex >= this._custom.length) return;
    const root = this.shadowRoot;
    const titleEl = root.querySelector('#entry-title');
    const keysEl = root.querySelector('#entry-keys');
    const contentEl = root.querySelector('#entry-content');
    if (titleEl && keysEl && contentEl) {
      this._custom[this._selectedIndex] = {
        ...this._custom[this._selectedIndex],
        title: titleEl.value.trim(),
        keys: keysEl.value.split(',').map(s => s.trim()).filter(Boolean),
        content: contentEl.value
      };
      this._save();
    }
  }
}

customElements.define('worldbook-editor', WorldbookEditor);


