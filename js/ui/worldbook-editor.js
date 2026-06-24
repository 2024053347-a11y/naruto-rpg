import { KNOWLEDGE_BASE } from '../data/knowledge-base.js';
import { eventBus } from '../core/event-bus.js';
import { escHtml, escAttr } from '../utils/format.js';
import GameModal from './modal.js';

export class WorldbookEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._entries = [];
    this._selectedIndex = -1;
    this._searchQuery = '';
  }

  connectedCallback() {
    this._loadEntries();
    if (this._entries.length > 0) this._selectedIndex = 0;
    this._render();
    this._bindEvents();
  }

  _loadEntries() {
    try {
      const saved = localStorage.getItem('naruto_worldbook');
      if (saved) {
        this._entries = JSON.parse(saved);
      } else {
        this._entries = JSON.parse(JSON.stringify(KNOWLEDGE_BASE.allEntries || KNOWLEDGE_BASE.entries || []));
      }
    } catch (e) {
      console.error('Failed to load worldbook:', e);
      this._entries = [];
    }
  }

  _saveEntries() {
    try {
      localStorage.setItem('naruto_worldbook', JSON.stringify(this._entries));
      eventBus.emit('app:toast', `已保存 ${this._entries.length} 条世界书条目 (下次游戏加载生效)`);
    } catch (e) {
      GameModal.alert({ title: '保存失败', message: e.message });
    }
  }

  _exportEntries() {
    const data = JSON.stringify(this._entries, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `worldbook_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _importEntries(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error('无效的 JSON 格式：应为数组');
        this._entries = imported;
        this._selectedIndex = this._entries.length > 0 ? 0 : -1;
        this._saveEntries();
        this._render();
        this._bindEvents();
      } catch (e) {
        GameModal.alert({ title: '导入失败', message: e.message });
      }
    };
    reader.readAsText(file);
  }

  _render() {
    const listEl = this.shadowRoot?.querySelector('#entry-list');
    const scrollTop = listEl ? listEl.scrollTop : 0;

    const filteredEntries = this._entries.map((e, i) => ({ ...e, originalIndex: i })).filter(e => {
      if (!this._searchQuery) return true;
      const q = this._searchQuery.toLowerCase();
      return (e.title || '').toLowerCase().includes(q) || (e.keys || []).some(k => k.toLowerCase().includes(q));
    });

    let currentEntry = null;
    if (this._selectedIndex >= 0 && this._selectedIndex < this._entries.length) {
      currentEntry = this._entries[this._selectedIndex];
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(7, 10, 14, 0.95);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 100002;
          font-family: 'Noto Sans SC', system-ui, sans-serif;
          color: #e8e4d9;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .wb-container {
          width: 100%; max-width: 1100px; height: 100%; max-height: 800px;
          background: #111418; border: 1px solid rgba(198,156,109,0.2);
          border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          display: flex; flex-direction: column; overflow: hidden;
        }
        .wb-header {
          padding: 16px 20px; border-bottom: 1px solid rgba(198,156,109,0.15);
          display: flex; justify-content: space-between; align-items: center;
          background: linear-gradient(180deg, rgba(20,25,30,0.8), rgba(17,20,24,0.8));
        }
        .wb-title { margin: 0; font-size: 18px; font-weight: 700; color: #f4efe4; font-family: 'Noto Serif SC', serif; letter-spacing: 2px; }
        .wb-actions { display: flex; gap: 8px; }
        .btn {
          padding: 6px 14px; background: rgba(232,228,217,0.05); color: #e8e4d9;
          border: 1px solid rgba(232,228,217,0.15); border-radius: 6px; cursor: pointer;
          font-size: 13px; transition: all 0.2s;
        }
        .btn:hover { background: rgba(232,228,217,0.1); border-color: rgba(198,156,109,0.5); }
        .btn.primary { background: #eb613f; border-color: #eb613f; color: #fff; font-weight: bold; }
        .btn.primary:hover { background: #d65130; }
        .btn.danger { background: transparent; border-color: #ef5350; color: #ef5350; }
        .btn.danger:hover { background: rgba(239,83,80,0.1); }
        
        .wb-body {
          display: flex; flex: 1; min-height: 0;
        }
        .wb-sidebar {
          width: 280px; border-right: 1px solid rgba(255,255,255,0.03);
          display: flex; flex-direction: column; background: rgba(0,0,0,0.2);
        }
        .wb-search-bar { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .wb-search-input {
          width: 100%; box-sizing: border-box; padding: 8px 12px;
          background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.1); border-radius: 0;
          color: #e8e4d9; font-size: 13px; outline: none; transition: border-color 0.2s;
        }
        .wb-search-input:focus { border-bottom-color: #eb613f; }
        
        .wb-list { flex: 1; overflow-y: auto; padding: 8px; }
        .wb-list::-webkit-scrollbar { width: 6px; }
        .wb-list::-webkit-scrollbar-thumb { background: rgba(232,228,217,0.2); border-radius: 3px; }
        
        .wb-item {
          padding: 10px 12px; border-radius: 0; cursor: pointer;
          margin-bottom: 2px; transition: background 0.2s;
          display: flex; flex-direction: column; gap: 4px; border-left: 2px solid transparent;
        }
        .wb-item:hover { background: rgba(255,255,255,0.02); }
        .wb-item.active { background: rgba(255,255,255,0.04); border-left-color: #eb613f; }
        .wb-item-title { font-weight: bold; font-size: 14px; color: #f4efe4; display: flex; align-items: center; gap: 6px; }
        .wb-item-keys { font-size: 11px; color: #a39f98; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wb-indicator { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .wb-indicator.blue { background-color: #4fc3f7; box-shadow: 0 0 5px #4fc3f7; }
        .wb-indicator.green { background-color: #81c784; box-shadow: 0 0 5px #81c784; }
        
        .wb-editor { flex: 1; display: flex; flex-direction: column; padding: 24px; overflow-y: auto; background: #070a0e; }
        .wb-editor::-webkit-scrollbar { width: 6px; }
        .wb-editor::-webkit-scrollbar-thumb { background: rgba(232,228,217,0.2); border-radius: 3px; }
        
        .wb-form-group { margin-bottom: 16px; }
        .wb-form-label { display: block; font-size: 12px; font-weight: bold; color: #c69c6d; margin-bottom: 6px; letter-spacing: 1px; }
        .wb-input {
          width: 100%; box-sizing: border-box; padding: 10px 12px;
          background: rgba(0,0,0,0.15); border: none; border-bottom: 1px solid rgba(255,255,255,0.1); border-radius: 4px 4px 0 0;
          color: #e8e4d9; font-size: 14px; outline: none; font-family: inherit; transition: border-color 0.2s;
        }
        .wb-input:focus { border-bottom-color: #eb613f; }
        .wb-textarea { resize: vertical; min-height: 200px; font-family: ui-monospace, Consolas, monospace; line-height: 1.5; font-size: 13px; }
        
        .wb-empty { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; color: #6e6a65; font-size: 14px; }
        
        @media (max-width: 768px) {
          .wb-body { flex-direction: column; }
          .wb-sidebar { width: 100%; height: 200px; border-right: none; border-bottom: 1px solid rgba(198,156,109,0.15); }
          .wb-editor { padding: 16px; }
        }
      </style>
      <div class="wb-container">
        <div class="wb-header">
          <h2 class="wb-title">世界书编辑器</h2>
          <div class="wb-actions">
            <button class="btn" id="btn-restore-default" title="恢复不小心被删除的自带默认世界书">恢复默认</button>
            <button class="btn" id="btn-import">导入</button>
            <button class="btn" id="btn-export">导出</button>
            <button class="btn" id="btn-close">返回</button>
            <button class="btn primary" id="btn-save">保存所有</button>
            <input type="file" id="file-import" accept=".json" hidden />
          </div>
        </div>
        <div class="wb-body">
          <div class="wb-sidebar">
            <div class="wb-search-bar">
              <input type="text" class="wb-search-input" id="search-input" placeholder="搜索条目或关键词..." value="${this._escAttr(this._searchQuery)}">
            </div>
            <div class="wb-list" id="entry-list">
              ${filteredEntries.map(e => `
                <div class="wb-item ${e.originalIndex === this._selectedIndex ? 'active' : ''}" data-index="${e.originalIndex}">
                  <div class="wb-item-title">
                    <span class="wb-indicator ${e.isAlwaysOn ? 'blue' : 'green'}" title="${e.isAlwaysOn ? '蓝灯: 常驻启用' : '绿灯: 按关键词触发'}"></span>
                    ${this._esc(e.title || '无标题')}
                  </div>
                  <div class="wb-item-keys">${this._esc((e.keys || []).join(', '))}</div>
                </div>
              `).join('')}
            </div>
            <div style="padding: 12px; border-top: 1px solid rgba(232,228,217,0.05);">
              <button class="btn" id="btn-add" style="width: 100%;">+ 新增条目</button>
            </div>
          </div>
          <div class="wb-editor" id="editor-pane">
            ${currentEntry ? `
              <div class="wb-form-group">
                <label class="wb-form-label">标题 (Title)</label>
                <input type="text" class="wb-input" id="entry-title" value="${this._escAttr(currentEntry.title || '')}" placeholder="条目的显示名称">
              </div>
              <div class="wb-form-group" style="display: flex; align-items: center; gap: 10px;">
                <label class="wb-form-label" style="margin: 0;">触发模式:</label>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px;">
                  <input type="checkbox" id="entry-always-on" ${currentEntry.isAlwaysOn ? 'checked' : ''}>
                  <span class="wb-indicator blue" style="width: 10px; height: 10px;"></span> 常驻启用 (蓝灯) - 无视关键词，必定发送给 AI
                </label>
              </div>
              <div class="wb-form-group">
                <label class="wb-form-label">触发关键词 (Keys) - 以英文逗号分隔 (绿灯模式下生效)</label>
                <input type="text" class="wb-input" id="entry-keys" value="${this._escAttr((currentEntry.keys || []).join(', '))}" placeholder="关键词1, 关键词2">
              </div>
              <div class="wb-form-group" style="flex: 1; display: flex; flex-direction: column;">
                <label class="wb-form-label">内容 (Content)</label>
                <textarea class="wb-input wb-textarea" id="entry-content" style="flex: 1;" placeholder="当触发关键词时，插入给AI的上下文信息">${this._esc(currentEntry.content || '')}</textarea>
              </div>
              <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button class="btn danger" id="btn-delete">删除此条目</button>
              </div>
            ` : `
              <div class="wb-empty">
                <p>请选择左侧条目进行编辑，或点击新增条目。</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
    const newListEl = this.shadowRoot.querySelector('#entry-list');
    if (newListEl) newListEl.scrollTop = scrollTop;
  }

  _esc(text) {
    return escHtml(text);
  }
  _escAttr(text) { return escAttr(text); }

  _saveCurrentEntry() {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._entries.length) {
      const root = this.shadowRoot;
      const titleEl = root.querySelector('#entry-title');
      const keysEl = root.querySelector('#entry-keys');
      const contentEl = root.querySelector('#entry-content');
      const alwaysOnEl = root.querySelector('#entry-always-on');
      if (titleEl && keysEl && contentEl) {
        this._entries[this._selectedIndex] = {
          title: titleEl.value.trim(),
          keys: keysEl.value.split(',').map(s => s.trim()).filter(Boolean),
          content: contentEl.value,
          isAlwaysOn: alwaysOnEl ? alwaysOnEl.checked : false
        };
      }
    }
  }

  _restoreDefaults() {
    this._saveCurrentEntry();
    const defaults = typeof KNOWLEDGE_BASE.getDefaultEntries === 'function' ? KNOWLEDGE_BASE.getDefaultEntries() : (KNOWLEDGE_BASE.entries || []);
    let restoredCount = 0;
    
    for (const defEntry of defaults) {
      const exists = this._entries.some(e => e.title === defEntry.title);
      if (!exists) {
        this._entries.push(JSON.parse(JSON.stringify(defEntry)));
        restoredCount++;
      }
    }
    
    if (restoredCount > 0) {
      this._searchQuery = '';
      this._selectedIndex = this._entries.length > 0 ? 0 : -1;
      this._saveEntries();
      this._render();
      this._bindEvents();
      customElements.get('game-modal').alert({ title: '恢复成功', message: `成功找回并恢复了 ${restoredCount} 条缺失的默认世界书条目！` });
    } else {
      customElements.get('game-modal').alert({ title: '无需恢复', message: '当前世界书已包含所有默认条目，没有发现被删除的条目。' });
    }
  }

  _bindEvents() {
    const root = this.shadowRoot;
    
    root.querySelector('#btn-close')?.addEventListener('click', () => {
      this._saveCurrentEntry();
      this.remove();
    });
    
    root.querySelector('#btn-save')?.addEventListener('click', () => {
      this._saveCurrentEntry();
      this._saveEntries();
      this.remove();
    });

    root.querySelector('#btn-restore-default')?.addEventListener('click', () => this._restoreDefaults());
    root.querySelector('#btn-export')?.addEventListener('click', () => this._exportEntries());
    
    const fileInput = root.querySelector('#file-import');
    root.querySelector('#btn-import')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this._importEntries(e.target.files[0]);
      }
      e.target.value = '';
    });

    root.querySelector('#search-input')?.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      this._saveCurrentEntry();
      this._render();
      this._bindEvents();
      root.querySelector('#search-input').focus();
    });

    root.querySelector('#btn-add')?.addEventListener('click', () => {
      this._saveCurrentEntry();
      this._entries.push({ title: '新条目', keys: [], content: '' });
      this._selectedIndex = this._entries.length - 1;
      this._searchQuery = '';
      this._render();
      this._bindEvents();
    });

    const listItems = root.querySelectorAll('.wb-item');
    listItems.forEach(item => {
      item.addEventListener('click', () => {
        this._saveCurrentEntry();
        this._selectedIndex = parseInt(item.dataset.index, 10);
        this._render();
        this._bindEvents();
      });
    });

    root.querySelector('#btn-delete')?.addEventListener('click', async () => {
      const confirmed = await customElements.get('game-modal').confirm({
        title: '删除条目',
        message: '确定要删除此世界书条目吗？此操作不可撤销。',
        okLabel: '删除',
        cancelLabel: '取消'
      });
      if (confirmed) {
        this._entries.splice(this._selectedIndex, 1);
        this._selectedIndex = Math.min(this._selectedIndex, this._entries.length - 1);
        this._render();
        this._bindEvents();
      }
    });
    
    // Auto-save entry content on blur/input if needed, but saving before switching is handled above.
  }
}

customElements.define('worldbook-editor', WorldbookEditor);