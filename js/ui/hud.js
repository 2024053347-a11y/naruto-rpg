import { stateManager } from '../core/state-manager.js';

class StatusHUD extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() { this.render(); }

  render() {
    const s = stateManager.get();
    const a = s.attributes, p = s.player;
    const chP = a.chakra>0?Math.round((a.chakra_current/a.chakra)*100):0;
    const spP = a.spirit>0?Math.round((a.spirit_current/a.spirit)*100):0;
    const wP = a.willpower>0?Math.round((a.willpower_current/a.willpower)*100):0;
    const stP = a.stamina>0?Math.round((a.stamina_current/a.stamina)*100):0;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; contain: layout style paint; }
        .hud {
          border: 1px solid rgba(232,228,217,0.14);
          background:
            linear-gradient(135deg, rgba(63,215,255,0.075), transparent 34%),
            linear-gradient(315deg, rgba(235,97,63,0.08), transparent 42%),
            var(--surface-1, #111821);
          padding: 16px 18px;
          margin: 20px 0;
          font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
          color: var(--text-primary, #e8e4d9);
          position: relative;
          overflow: hidden;
          box-shadow: var(--shadow-soft, 0 18px 44px rgba(0,0,0,0.28)), 0 0 0 1px rgba(232,200,122,0.06) inset;
        }
        .hud-ring {
          position: absolute;
          inset: -36px auto auto 50%;
          width: 180px;
          height: 180px;
          transform: translateX(-50%);
          border-radius: 50%;
          background: repeating-conic-gradient(from 12deg, transparent 0 11deg, rgba(63,215,255,0.12) 11deg 12deg, transparent 12deg 24deg);
          opacity: 0.08;
          pointer-events: none;
        }
        @keyframes hud-ring { to { transform: translateX(-50%) rotate(360deg); } }
        .hud::before { content: '「'; position: absolute; top: 4px; left: 8px; font-size: 18px; color: #eb613f; font-weight: 800; }
        .hud::after { content: '」'; position: absolute; bottom: 4px; right: 8px; font-size: 18px; color: #eb613f; font-weight: 800; }
        
        .upd-title { font-size: 13px; font-weight: bold; color: #e8e4d9; margin-bottom: 10px; letter-spacing: 1px; }
        .upd-list { display: flex; flex-direction: column; gap: 4px; position: relative; z-index: 1; }
        .upd-item { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-family: 'Noto Sans SC', sans-serif; background: rgba(16, 22, 29, 0.6); padding: 8px 12px; border-radius: 6px; border-left: 3px solid rgba(255, 213, 79, 0.4); border-bottom: 1px solid rgba(255,255,255,0.03); }
        .upd-path { color: #e8e4d9; font-weight: 500; letter-spacing: 0.5px; }
        .upd-val { font-weight: bold; font-family: 'JetBrains Mono', monospace; }
        .upd-plus { color: #81C784; }
        .upd-minus { color: #ef5350; }
        .upd-neutral { color: #FFB74D; font-size: 12px; }
        
        @media (prefers-reduced-motion: reduce) { .hud-ring { animation: none; } }
      </style>
      <div class="hud">
        <div class="hud-ring"></div>
        ${this._renderUpdates()}
      </div>
    `;
  }

  _renderUpdates() {
    let updates = this.updates || [];
    
    const ignorePaths = ['turn_count', 'current_node_id', 'active_branch', 'ai_response_summary', 'timeline_nodes', 'panel_tab', 'memory', 'memory.recent_summary', 'skills', 'consumables', 'equipment', 'map.active_pins', 'world_state.timeline_nodes'];
    updates = updates.filter(u => 
      !ignorePaths.includes(u.path) && 
      !u.path.endsWith('.inner_thoughts') && 
      !u.path.endsWith('.history') &&
      !u.path.includes('timeline') && 
      !u.path.includes('node_id')
    );

    if (updates.length === 0) {
      return `<div class="upd-list"><div class="upd-item" style="justify-content: center; color: #a39f98; border-left: none; background: transparent;">本回合无数值变更</div></div>`;
    }

    const translateDict = {
      'attributes.chakra_current': '当前查克拉',
      'attributes.chakra': '查克拉上限',
      'attributes.stamina_current': '当前体力',
      'attributes.stamina': '体力上限',
      'attributes.spirit_current': '当前精神力',
      'attributes.spirit': '精神力上限',
      'attributes.willpower_current': '当前意志',
      'attributes.willpower': '意志上限',
      'attributes.strength': '综合实力',
      'attributes.speed': '速度',
      'attributes.ninjutsu': '忍术',
      'attributes.taijutsu': '体术',
      'attributes.genjutsu': '幻术',
      'attributes.luck': '运气',
      'progression.exp': '历练值',
      'world_state.current_location': '当前所在地',
      'world_state.time': '当前时间',
      'map.explored_regions': '新探索区域',
      'map.known_locations': '新获地标情报',
      'player.level': '等级'
    };

    const friendlyName = (path) => {
      if (translateDict[path]) return translateDict[path];
      if (path.startsWith('relationship.')) {
        const parts = path.split('.');
        if (parts.length >= 3) {
          const char = parts[1];
          const attr = parts[2];
          const attrDict = { 'affection': '好感度', 'trust': '信任度', 'respect': '敬畏度', 'chakra':'查克拉', 'strength':'综合实力', 'speed':'速度', 'ninjutsu':'忍术', 'taijutsu':'体术', 'genjutsu':'幻术' };
          return `羁绊·${char} [${attrDict[attr] || attr}]`;
        }
        return `羁绊·${parts[1]}`;
      }
      if (path.startsWith('inventory.consumables.')) return '获得物品';
      if (path.startsWith('skills.')) return `新技能 [${path.split('.').pop()}]`;
      if (path.startsWith('world_state.')) return path.replace('world_state.', '');
      return path.split('.').pop();
    };

    let html = '<div class="upd-title">状态数值变更</div><div class="upd-list" style="max-height: 250px; overflow-y: auto;">';
    
    const renderedPaths = new Set();

    for (const u of updates) {
      const name = friendlyName(u.path);
      let valHtml = '';

      if (typeof u.value === 'number' && typeof u.oldValue === 'number') {
        const diff = u.value - u.oldValue;
        if (diff === 0) continue; 
        if (diff > 0) valHtml = `<span class="upd-val upd-plus">+${diff}</span>`;
        else valHtml = `<span class="upd-val upd-minus">${diff}</span>`;
      } else if (u.op === 'push' || u.op === 'add') {
        valHtml = `<span class="upd-val upd-plus">+ ${typeof u.value === 'object' ? (u.value.name || '新内容') : u.value}</span>`;
      } else if (u.op === 'remove' || u.op === 'sub') {
        valHtml = `<span class="upd-val upd-minus">- ${typeof u.value === 'object' ? (u.value.name || '内容') : u.value}</span>`;
      } else {
        if (renderedPaths.has(name)) continue;
        if (typeof u.value === 'string' && typeof u.oldValue === 'string' && u.value.length < 15 && u.oldValue.length < 15) {
          valHtml = `<span class="upd-val upd-neutral">${u.oldValue} ➔ ${u.value}</span>`;
        } else {
          valHtml = `<span class="upd-val upd-neutral">发生变更</span>`;
        }
      }
      
      renderedPaths.add(name);
      html += `<div class="upd-item"><span class="upd-path">${name}</span> ${valHtml}</div>`;
    }
    
    if (renderedPaths.size === 0) {
      return `<div class="upd-list"><div class="upd-item" style="justify-content: center; color: #a39f98;">本回合无重要数值变更</div></div>`;
    }

    html += '</div>';
    return html;
  }
}

customElements.define('status-hud', StatusHUD);
export default StatusHUD;
