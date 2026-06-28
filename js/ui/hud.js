import { stateManager } from '../core/state-manager.js';
import { hudStyles } from '../../css/components/hud.css.js';

class StatusHUD extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { 
    this.render(); 
    this.shadowRoot.addEventListener('click', this._onClick.bind(this));
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${hudStyles}</style>
      <div class="hud">
        <div class="hud-ring"></div>
        ${this._renderUpdates()}
      </div>
    `;
  }

  async _onClick(e) {
    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
      const path = editBtn.dataset.path;
      this._toggleEditPanel(path);
      return;
    }
    const saveBtn = e.target.closest('.save-btn');
    if (saveBtn) {
      const path = saveBtn.dataset.path;
      this._saveEdit(path);
    }
    const cancelBtn = e.target.closest('.cancel-btn');
    if (cancelBtn) {
      const path = cancelBtn.dataset.path;
      this._toggleEditPanel(path, false);
    }
  }
  
  _buildInput(val, key) {
    if (typeof val === 'number') {
      return `<input type="number" class="edit-input obj-input obj-val" data-key="${this._escapeHtml(key)}" value="${val}">`;
    } else if (typeof val === 'boolean') {
      return `<select class="edit-input obj-input obj-val" data-key="${this._escapeHtml(key)}">
        <option value="true" ${val ? 'selected' : ''}>True (是)</option>
        <option value="false" ${!val ? 'selected' : ''}>False (否)</option>
      </select>`;
    } else if (typeof val === 'string') {
      if (val.length > 40) {
        return `<textarea class="edit-input obj-input obj-val" data-key="${this._escapeHtml(key)}">${this._escapeHtml(val)}</textarea>`;
      } else {
        return `<input type="text" class="edit-input obj-input obj-val" data-key="${this._escapeHtml(key)}" value="${this._escapeHtml(val)}">`;
      }
    } else {
      // Fallback for deeply nested objects
      return `<textarea class="edit-input raw-json obj-input obj-val" data-key="${this._escapeHtml(key)}">${this._escapeHtml(JSON.stringify(val, null, 2))}</textarea>`;
    }
  }

  _toggleEditPanel(path, forceOpen) {
    const panel = this.shadowRoot.getElementById(`edit-panel-${path}`);
    if (!panel) return;
    const isOpen = forceOpen !== undefined ? forceOpen : panel.style.display === 'none';
    
    if (isOpen) {
      const s = stateManager.get();
      const parts = path.split('.');
      let val = s;
      for (const p of parts) {
        if (val === undefined) break;
        val = val[p];
      }
      
      let inputHtml = '';
      if (typeof val !== 'object' || val === null) {
        // Primitive
        inputHtml = this._buildInput(val, 'primitive');
      } else if (Array.isArray(val)) {
        // Array Editor
        inputHtml = `<div class="array-editor" id="arr-editor-${path}">`;
        val.forEach((item, idx) => {
          inputHtml += `<div class="array-item">
            ${this._buildInput(item, idx)}
          </div>`;
        });
        if (val.length === 0) inputHtml += `<div style="font-size:11px; color:#a39f98; text-align:center;">空数组</div>`;
        inputHtml += `</div><div style="font-size:10px; color:#a39f98; margin-top:4px;">* 数组元素可直接修改数值或文本</div>`;
      } else {
        // Object GUI Editor
        inputHtml = `<div class="obj-editor">`;
        for (const [k, v] of Object.entries(val)) {
          const rawLabel = this._translatePath(k);
          const label = rawLabel.replace(/<[^>]+>/g, ''); // strip html
          inputHtml += `<div class="obj-field">
            <div class="obj-label">${label}</div>
            ${this._buildInput(v, k)}
          </div>`;
        }
        inputHtml += `</div>`;
      }

      panel.innerHTML = `
        <div class="edit-panel-inner">
          <div class="edit-title">修正当前值 (实时同步底层数据)</div>
          ${inputHtml}
          <div class="edit-actions">
            <button class="cancel-btn" data-path="${path}">取消</button>
            <button class="save-btn" data-path="${path}">确认修正</button>
          </div>
        </div>
      `;
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
      panel.innerHTML = '';
    }
  }

  _parseValue(input) {
    let v = input.value;
    if (input.tagName === 'SELECT') return v === 'true';
    if (input.type === 'number') return Number(v);
    if (input.tagName === 'TEXTAREA' && (v.trim().startsWith('{') || v.trim().startsWith('['))) {
      try { return JSON.parse(v); } catch(e) {}
    }
    return v;
  }

  _saveEdit(path) {
    const panel = this.shadowRoot.getElementById(`edit-panel-${path}`);
    if (!panel) return;
    
    let newVal;
    const objEditor = panel.querySelector('.obj-editor');
    const arrEditor = panel.querySelector('.array-editor');
    
    if (objEditor) {
      // Reconstruct Object
      const s = stateManager.get();
      const parts = path.split('.');
      let originalVal = s;
      for (const p of parts) { if (originalVal === undefined) break; originalVal = originalVal[p]; }
      
      newVal = { ...(originalVal || {}) };
      const inputs = objEditor.querySelectorAll('.obj-input');
      inputs.forEach(input => {
        newVal[input.dataset.key] = this._parseValue(input);
      });
    } else if (arrEditor) {
      // Reconstruct Array
      const inputs = arrEditor.querySelectorAll('.obj-input');
      newVal = [];
      inputs.forEach(input => {
        newVal.push(this._parseValue(input));
      });
    } else {
      // Primitive
      const input = panel.querySelector('.edit-input');
      newVal = this._parseValue(input);
    }

    stateManager.update([{ path: path, op: 'set', value: newVal }]);
    this._toggleEditPanel(path, false);
    
    const item = panel.closest('.upd-item');
    if (item) {
      item.style.backgroundColor = 'rgba(107, 199, 117, 0.15)'; 
      setTimeout(() => item.style.backgroundColor = 'rgba(16, 22, 29, 0.7)', 800);
    }
  }

  _escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _translatePath(path) {
    const dict = {
      'attributes': '属性', 'chakra_current': '当前查克拉', 'chakra': '查克拉上限',
      'stamina_current': '当前体力', 'stamina': '体力上限',
      'spirit_current': '当前精神', 'spirit': '精神力上限',
      'willpower_current': '当前意志', 'willpower': '意志上限',
      'strength': '实力', 'speed': '速度', 'ninjutsu': '忍术', 'taijutsu': '体术', 'genjutsu': '幻术', 'luck': '运气',
      'progression': '成长', 'exp': '历练值',
      'world_state': '世界状态', 'current_location': '当前所在地', 'time': '当前时间', 'weather': '天气', 'mood': '心情', 'calendar': '日期',
      'map': '地图', 'explored_regions': '探索区域', 'known_locations': '地标情报',
      'player': '玩家', 'level': '等级',
      'inventory': '物品栏', 'consumables': '消耗品', 'equipment': '装备', 'weapons': '兵器', 'armor': '防具', 'tools': '刃具', 'materials': '材料', 'quest_items': '任务道具', 'ryo': '两(金钱)', 'equipped': '当前武装',
      'skills': '技能', 'jutsu': '忍术', 'kekkei_genkai': '血继限界', 'talents': '天赋',
      'quests': '任务', 'missions': '悬赏令', 'active': '进行中', 'completed': '已完成', 'failed': '已失败',
      'relationships': '羁绊', 'relationship': '羁绊',
      'affection': '好感度', 'trust': '信任度', 'respect': '敬畏度',
      'history': '羁绊历史', 'inner_thoughts': '心理剖析',
      'amount': '数量', 'count': '数量', 'description': '描述', 'status': '状态', 'name': '名称', 'type': '类型',
      '_meta': '系统元数据', 'turn_count': '回合数', 'active_branch': '当前分支'
    };

    const parts = path.split('.');
    
    if ((parts[0] === 'relationship' || parts[0] === 'relationships') && parts.length >= 3) {
      const char = parts[1];
      const attr = dict[parts[2]] || parts[2];
      return `羁绊 ▸ ${char} ▸ ${attr}`;
    }

    const translated = parts.map(p => {
      if (dict[p]) return dict[p];
      if (p.includes('_')) {
        return p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
      return p.charAt(0).toUpperCase() + p.slice(1);
    });
    
    return translated.join(' <span style="color:#c69c6d; margin:0 4px; font-size:10px;">▸</span> ');
  }

  _renderUpdates() {
    let updates = this.updates || [];
    
    const ignorePaths = ['ai_response_summary', 'timeline_nodes', 'panel_tab', 'memory', 'memory.recent_summary', 'map.active_pins', 'world_state.timeline_nodes'];
    updates = updates.filter(u => 
      !u.path.startsWith('_meta') &&
      !u.path.includes('turn_count') &&
      !u.path.includes('active_branch') &&
      !ignorePaths.includes(u.path) && 
      !u.path.endsWith('.inner_thoughts') && 
      !u.path.endsWith('.history') &&
      !u.path.includes('timeline') && 
      !u.path.includes('node_id')
    );

    if (updates.length === 0) {
      return `<div class="upd-list"><div class="upd-item" style="justify-content: center; color: #a39f98; border-left: none; background: transparent;">本回合无数值变更</div></div>`;
    }

    let html = '<div class="upd-title">状态数值变更</div><div class="upd-list">';
    const renderedPaths = new Set();

    // Pre-deduplicate: for same-path numeric updates, keep only the last one to show net diff
    const deduped = [];
    const seenNumericPaths = new Map(); // path -> index in deduped
    for (const u of updates) {
      if (typeof u.finalValue === 'number' && typeof u.oldValue === 'number') {
        if (seenNumericPaths.has(u.path)) {
          const idx = seenNumericPaths.get(u.path);
          deduped[idx] = { ...deduped[idx], finalValue: u.finalValue };
          continue;
        }
        seenNumericPaths.set(u.path, deduped.length);
      }
      deduped.push(u);
    }

    for (const u of deduped) {
      const name = this._translatePath(u.path);
      let valHtml = '';

      if (typeof u.finalValue === 'number' && typeof u.oldValue === 'number') {
        if (renderedPaths.has(u.path)) continue; // Universal dedup ONLY for numeric
        const diff = u.finalValue - u.oldValue;
        if (diff === 0) continue; 
        if (diff > 0) valHtml = `<span class="upd-val upd-plus">+${diff}</span>`;
        else valHtml = `<span class="upd-val upd-minus">${diff}</span>`;
        renderedPaths.add(u.path);
      } else if (u.op === 'push' || u.op === 'add') {
        valHtml = `<span class="upd-val upd-plus">+ ${typeof u.value === 'object' ? (u.value.name || '新内容') : u.value}</span>`;
        // Do NOT add to renderedPaths, allow multiple pushes to show
      } else if (u.op === 'remove' || u.op === 'sub') {
        valHtml = `<span class="upd-val upd-minus">- ${typeof u.value === 'object' ? (u.value.name || '内容') : u.value}</span>`;
        // Do NOT add to renderedPaths, allow multiple removes to show
      } else {
        if (renderedPaths.has(u.path)) continue; // Universal dedup for generic sets
        if (typeof u.finalValue === 'string' && typeof u.oldValue === 'string' && u.finalValue.length < 15 && u.oldValue.length < 15) {
          valHtml = `<span class="upd-val upd-neutral">${u.oldValue} ➔ ${u.finalValue}</span>`;
        } else {
          valHtml = `<span class="upd-val upd-neutral">发生变更</span>`;
        }
        renderedPaths.add(u.path);
      }
      
      html += `
        <div class="upd-item">
          <div class="upd-main">
            <span class="upd-path">${name}</span>
            <span class="upd-val-container">${valHtml}</span>
            <button class="edit-btn" data-path="${u.path}" title="手动修改该变量">✎ 修改</button>
          </div>
          <div class="edit-panel" id="edit-panel-${u.path}" style="display: none;"></div>
        </div>
      `;
    }
    
    if (renderedPaths.size === 0) {
      return `<div class="upd-list"><div class="upd-item" style="justify-content: center; color: #a39f98; border-left: none; background: transparent;">本回合无重要数值变更</div></div>`;
    }

    html += '</div>';
    return html;
  }
}

customElements.define('status-hud', StatusHUD);
export default StatusHUD;


