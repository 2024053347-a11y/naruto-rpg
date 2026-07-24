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
      const key = editBtn.dataset.key;
      this._toggleEditPanel(key);
      return;
    }
    const saveBtn = e.target.closest('.save-btn');
    if (saveBtn) {
      const key = saveBtn.dataset.key;
      this._saveEdit(key);
    }
    const cancelBtn = e.target.closest('.cancel-btn');
    if (cancelBtn) {
      const key = cancelBtn.dataset.key;
      this._toggleEditPanel(key, false);
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

  _toggleEditPanel(key, forceOpen) {
    const panelId = key.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf·_-]/g, '_');
    const panel = this.shadowRoot.getElementById(`edit-panel-${panelId}`);
    if (!panel) return;
    const isOpen = forceOpen !== undefined ? forceOpen : panel.style.display === 'none';
    
    if (isOpen) {
      const s = stateManager.get();
      let val = s[key];
      if (val === undefined) {
        const sub = stateManager.getSub(key);
        if (sub !== undefined) val = sub;
      }
      
      let inputHtml = '';
      if (typeof val !== 'object' || val === null) {
        inputHtml = this._buildInput(val, 'primitive');
      } else if (Array.isArray(val)) {
        inputHtml = `<div class="array-editor" id="arr-editor-${panelId}">`;
        val.forEach((item, idx) => {
          inputHtml += `<div class="array-item">
            ${this._buildInput(item, idx)}
          </div>`;
        });
        if (val.length === 0) inputHtml += `<div style="font-size:11px; color:#a39f98; text-align:center;">空数组</div>`;
        inputHtml += `</div><div style="font-size:10px; color:#a39f98; margin-top:4px;">* 数组元素可直接修改数值或文本</div>`;
      } else {
        inputHtml = `<div class="obj-editor">`;
        for (const [k, v] of Object.entries(val)) {
          const rawLabel = this._translatePath(k);
          const label = rawLabel.replace(/<[^>]+>/g, '');
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
            <button class="cancel-btn" data-key="${this._escapeHtml(key)}">取消</button>
            <button class="save-btn" data-key="${this._escapeHtml(key)}">确认修正</button>
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

  _saveEdit(key) {
    const panelId = key.replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf·_-]/g, '_');
    const panel = this.shadowRoot.getElementById(`edit-panel-${panelId}`);
    if (!panel) return;
    
    let newVal;
    const objEditor = panel.querySelector('.obj-editor');
    const arrEditor = panel.querySelector('.array-editor');
    
    if (objEditor) {
      const s = stateManager.get();
      let originalVal = s[key];
      if (originalVal === undefined) {
        const sub = stateManager.getSub(key);
        if (sub !== undefined) originalVal = sub;
      }
      
      newVal = { ...(originalVal || {}) };
      const inputs = objEditor.querySelectorAll('.obj-input');
      inputs.forEach(input => {
        newVal[input.dataset.key] = this._parseValue(input);
      });
    } else if (arrEditor) {
      const inputs = arrEditor.querySelectorAll('.obj-input');
      newVal = [];
      inputs.forEach(input => {
        newVal.push(this._parseValue(input));
      });
    } else {
      const input = panel.querySelector('.edit-input');
      newVal = this._parseValue(input);
    }

    stateManager.update([{ key: key, op: '=', value: newVal }]);
    this._toggleEditPanel(key, false);
    
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

  _translatePath(key) {
    const dict = {
      '属性': '属性', '当前查克拉': '当前查克拉', '查克拉上限': '查克拉上限',
      '当前生命力': '当前生命力', '生命力上限': '生命力上限',
      '当前体力': '当前体力', '体力上限': '体力上限',
      '当前精神': '当前精神', '精神力上限': '精神力上限',
      '实力': '实力', '速度': '速度', '忍术': '忍术', '体术': '体术', '幻术': '幻术', '幸运': '运气',
      '成长': '成长', '历练值': '历练值',
      '属性·查克拉': '查克拉上限', '属性·当前查克拉': '当前查克拉',
      '属性·生命力': '生命力上限', '属性·当前生命力': '当前生命力',
      '属性·体力': '体力上限', '属性·当前体力': '当前体力',
      '属性·精神力': '精神力上限', '属性·当前精神力': '当前精神',
      '属性·速度': '速度', '属性·幸运': '幸运',
      '进度·经验': '历练值', '进度·下一级经验': '下一级经验',
      '进度·忍术熟练度': '忍术造诣', '进度·体术熟练度': '体术造诣',
      '进度·幻术熟练度': '幻术造诣', '进度·防御熟练度': '防御造诣',
      '进度·已完成任务': '已完成任务', '进度·称号': '头衔',
      '进度·金钱': '两(金钱)',
      '世界·地点': '当前所在地', '世界·时间': '当前时间', '世界·天气': '天气',
      '世界·已探索区域': '探索区域', '世界·年代': '年代',
      '玩家·姓名': '名称', '玩家·忍阶': '等级', '玩家·战力等级': '战力',
      '玩家·所属村': '忍村', '玩家·出身': '出身', '玩家·查克拉属性': '查克拉属性',
      '玩家·公开身份': '公开身份', '玩家·个性': '个性', '玩家·当前目标': '当前目标',
      '玩家·难度': '难度', '玩家·存活': '存活', '玩家·死因': '死因',
      '技能·忍术·': '忍术', '技能·体术·': '体术', '技能·幻术·': '幻术',
      '技能·血继限界': '血继限界', '技能·天赋·': '天赋',
      '系统·回合数': '回合数', '系统·当前分支': '当前分支',
      '物品·已装备·武器': '当前武装·武器', '物品·已装备·防具': '当前武装·防具',
      '物品·已装备·饰品1': '当前武装·饰品1', '物品·已装备·饰品2': '当前武装·饰品2',
      '玩家': '玩家', 'attributes': '属性', 'chakra_current': '当前查克拉', 'chakra': '查克拉上限',
      'vitality_current': '当前生命力', 'vitality': '生命力上限',
      'stamina_current': '当前体力', 'stamina': '体力上限',
      'spirit_current': '当前精神', 'spirit': '精神力上限',
      'strength': '实力', 'speed': '速度', 'ninjutsu': '忍术', 'taijutsu': '体术', 'genjutsu': '幻术', 'luck': '运气',
      'progression': '成长', 'exp': '历练值',
      'world_state': '世界状态', 'current_location': '当前所在地', 'time': '当前时间', 'weather': '天气', 'mood': '心情', 'calendar': '日期',
      'map': '地图', 'explored_regions': '探索区域', 'known_locations': '地标情报',
      'inventory': '物品栏', 'consumables': '消耗品', 'equipment': '装备', 'weapons': '兵器', 'armor': '防具', 'tools': '刃具', 'materials': '材料', 'quest_items': '任务道具', 'ryo': '两(金钱)', 'equipped': '当前武装',
      'skills': '技能', 'jutsu': '忍术', 'kekkei_genkai': '血继限界', 'talents': '天赋',
      'quests': '任务', 'missions': '悬赏令', 'active': '进行中', 'completed': '已完成', 'failed': '已失败',
      'relationships': '羁绊', 'relationship': '羁绊',
      'affection': '好感度', 'trust': '信任度', 'respect': '敬畏度',
      'history': '羁绊历史', 'inner_thoughts': '心理剖析',
      'amount': '数量', 'count': '数量', 'description': '描述', 'status': '状态', 'name': '名称', 'type': '类型',
      '_meta': '系统元数据', 'turn_count': '回合数', 'active_branch': '当前分支'
    };

    const parts = key.split('.');
    
    if ((parts[0] === 'relationship' || parts[0] === 'relationships') && parts.length >= 3) {
      const char = parts[1];
      const attr = dict[parts[2]] || parts[2];
      return `羁绊 ▸ ${char} ▸ ${attr}`;
    }

    if (dict[key]) return dict[key];
    
    const translated = parts.map(p => {
      if (dict[p]) return dict[p];
      if (p.includes('_')) {
        return p.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
      return p.charAt(0).toUpperCase() + p.slice(1);
    });
    
    return key.includes('·') ? key : translated.join(' <span style="color:#c69c6d; margin:0 4px; font-size:10px;">▸</span> ');
  }

  _renderUpdates() {
    let updates = this.updates || [];
    
    const ignoreKeys = ['ai_response_summary', 'timeline_nodes', 'panel_tab', 'memory', 'memory.recent_summary', 'map.active_pins', '世界·活跃事件'];
    updates = updates.filter(u => {
      const k = u.key || u.path || '';
      return !k.startsWith('系统·')
        && !k.includes('turn_count')
        && !k.includes('active_branch')
        && !ignoreKeys.includes(k) 
        && !k.endsWith('.inner_thoughts') 
        && !k.endsWith('.history')
        && !k.includes('timeline') 
        && !k.includes('node_id');
    });

    if (updates.length === 0) {
      return `<div class="upd-list"><div class="upd-item" style="justify-content: center; color: #a39f98; border-left: none; background: transparent;">本回合无数值变更</div></div>`;
    }

    let html = '<div class="upd-title">状态数值变更</div><div class="upd-list">';

    const keyMap = new Map();
    for (const u of updates) {
      const k = u.key || u.path || '';
      const existing = keyMap.get(k);
      if (!existing) {
        keyMap.set(k, u);
      } else if (u.op === '=' || u.op === 'set') {
        keyMap.set(k, u);
      } else if (existing.op === '=' || existing.op === 'set') {
        continue;
      } else {
        const uSign = (u.op === '+' || u.op === 'add') ? 1 : -1;
        const exSign = (existing.op === '+' || existing.op === 'add') ? 1 : -1;
        const net = exSign * (Number(existing.value) || 0) + uSign * (Number(u.value) || 0);
        existing.value = Math.abs(net);
        existing.op = net >= 0 ? '+' : '-';
      }
    }

    if (keyMap.size === 0) {
      return `<div class="upd-list"><div class="upd-item" style="justify-content: center; color: #a39f98; border-left: none; background: transparent;">本回合无重要数值变更</div></div>`;
    }

    for (const u of keyMap.values()) {
      const k = u.key || u.path || '';
      const name = this._translatePath(k);
      let valHtml = '';

      if (u.op === '+' || u.op === 'add') {
        valHtml = `<span class="upd-val upd-plus">+ ${typeof u.value === 'object' ? (u.value.name || '新内容') : u.value}</span>`;
      } else if (u.op === '-' || u.op === 'sub') {
        valHtml = `<span class="upd-val upd-minus">- ${typeof u.value === 'object' ? (u.value.name || '内容') : u.value}</span>`;
      } else {
        valHtml = `<span class="upd-val upd-neutral">发生变更</span>`;
      }
      
      html += `
        <div class="upd-item">
          <div class="upd-main">
            <span class="upd-path">${name}</span>
            <span class="upd-val-container">${valHtml}</span>
            <button class="edit-btn" data-key="${u.key || u.path}" title="手动修改该变量">✎ 修改</button>
          </div>
          <div class="edit-panel" id="edit-panel-${(u.key || u.path || '').replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf·_-]/g, '_')}" style="display: none;"></div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  }
}

customElements.define('status-hud', StatusHUD);
export default StatusHUD;


