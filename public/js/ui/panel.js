import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { formatPercentage, escHtml, escAttr } from '../utils/format.js';
import { equipmentSystem } from '../systems/equipment-system.js';
import { relationshipSystem } from '../systems/relationship-system.js';
import GameModal from './modal.js';
import { panelStyles } from '../../css/components/panel.css.js';

class InfoPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._tab = 'attributes';
    this._renderPending = false;
    this._unsubs = [];
    this._skillSearch = '';
    this._skillTypeFilter = null;
    this._skillSort = 'default';
    this._skillCompact = false;
    this._collapsedSections = {};
  }

  connectedCallback() {
    this.render();
    this._unsubs = [
      eventBus.on('state:changed', () => { if (this.isConnected) this._scheduleRender(); }),
      eventBus.on('state:restored', () => { if (this.isConnected) this._scheduleRender(); })
    ];
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn?.());
    this._unsubs = [];
    this._renderPending = false;
  }

  _scheduleRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      if (this.isConnected) this.render();
    });
  }

  render() {
    // 保存滚动位置，避免展开/收起时跳回顶部
    const contentEl = this.shadowRoot?.querySelector('.content');
    const scrollTop = contentEl ? contentEl.scrollTop : 0;

    const s = stateManager.get();
    const tab = stateManager.getSub('_ui').panel_tab || this._tab;
    const appEl = document.getElementById('app') || document.body;
    const isMobile = (() => {
      try { return parent.window.innerWidth <= 768; } catch(e) { return window.innerWidth <= 768; }
    })() || appEl.classList.contains('is-mobile-forced') || appEl.classList.contains('is-mobile-view');
    this.shadowRoot.innerHTML = `
      <style>${panelStyles}</style>
      <div class="panel">
        ${isMobile ? `
        <div class="panel-header-mobile">
          <span class="panel-title-mobile">角色面板</span>
          <button class="panel-close-btn-mobile" id="panel-close-btn-mobile" title="关闭面板">✕</button>
        </div>
        ` : ''}
        <div class="tabs">
          <button class="tab${tab==='attributes'?' on':''}" data-t="attributes">属性</button>
          <button class="tab${tab==='skills'?' on':''}" data-t="skills">技能</button>
          <button class="tab${tab==='equipment'?' on':''}" data-t="equipment">装备</button>
          <button class="tab${tab==='missions'?' on':''}" data-t="missions">任务</button>
          <button class="tab${tab==='relations'?' on':''}" data-t="relations">关系</button>
        </div>
        <div class="content">${this._renderTab(tab,s)}</div>
      </div>
    `;
    // 恢复滚动位置
    const newContent = this.shadowRoot.querySelector('.content');
    if (newContent && scrollTop > 0) {
      requestAnimationFrame(() => { newContent.scrollTop = scrollTop; });
    }
    const closeBtn = this.shadowRoot.getElementById('panel-close-btn-mobile');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('panel:close', { bubbles: true, composed: true }));
      });
    }

    this.shadowRoot.querySelectorAll('.tab').forEach(t=>{
      t.addEventListener('click',()=>{
        this._tab=t.dataset.t;
        const updatedUi = { ...stateManager.getSub('_ui'), panel_tab: this._tab };
        stateManager.update([{ key: '_ui.panel_tab', op: '=', value: this._tab }]);
        this.render();
      });
    });

    if (this._tab === 'equipment') {
      this.shadowRoot.querySelectorAll('.eq-equip-btn').forEach(b => {
        b.addEventListener('click', () => {
          const name = b.dataset.name;
          const cat = b.dataset.cat;
          let slot = cat === 'weapons' ? 'weapon' : cat === 'armor' ? 'armor' : null;
          if (cat === 'tools') {
            const eq = stateManager.get('物品·已装备·饰品1')
              ? { accessory1: stateManager.get('物品·已装备·饰品1'), accessory2: stateManager.get('物品·已装备·饰品2') }
              : {};
            slot = !eq.accessory1 ? 'accessory1' : (!eq.accessory2 ? 'accessory2' : 'accessory1');
          }
          if (slot) { equipmentSystem.equip(slot, name, cat); this.render(); }
        });
      });
      this.shadowRoot.querySelectorAll('.eq-unequip-btn').forEach(b => {
        b.addEventListener('click', () => {
          let slot = b.dataset.slot;
          if (!slot && b.dataset.name) {
            const weapon = stateManager.get('物品·已装备·武器');
            const armor = stateManager.get('物品·已装备·防具');
            const acc1 = stateManager.get('物品·已装备·饰品1');
            const acc2 = stateManager.get('物品·已装备·饰品2');
            const eq = {};
            if (weapon) eq.weapon = weapon;
            if (armor) eq.armor = armor;
            if (acc1) eq.accessory1 = acc1;
            if (acc2) eq.accessory2 = acc2;
            for (const [k, v] of Object.entries(eq)) {
              if (v === b.dataset.name) slot = k;
            }
          }
          if (slot) { equipmentSystem.unequip(slot); this.render(); }
        });
      });
      this.shadowRoot.querySelectorAll('.eq-use-btn').forEach(b => {
        b.addEventListener('click', () => {
          const name = b.dataset.name;
          equipmentSystem.useItem(name);
          this.render();
        });
      });
    }

    this.shadowRoot.querySelectorAll('[data-rel-name]').forEach(card => {
      card.addEventListener('click', () => {
        this.showRelModal(card.dataset.relName);
      });
    });

    this.shadowRoot.querySelectorAll('.rel-actions [data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const npc = btn.dataset.relNpc;
        if (!npc) return;
        if (btn.dataset.action === 'pin') {
          relationshipSystem.togglePin(npc);
          console.log('[Panel] pin clicked for', npc);
          this.render();
        } else if (btn.dataset.action === 'delete') {
          e.preventDefault();
          const confirmed = await GameModal.confirm({
            title: '解除羁绊',
            message: `确定要断开与「${npc}」的羁绊记录吗？<br><span style="font-size:11px;color:var(--text-tertiary);">此操作不可撤回，所有互动历史与好感度将被清除。</span>`,
            okLabel: '确认解除',
            cancelLabel: '保留羁绊'
          });
          if (!confirmed) return;
          relationshipSystem.deleteRelationship(npc);
          this.render();
        }
      });
    });

    if (this._tab === 'skills') {
      const search = this.shadowRoot.getElementById('skill-search');
      if (search) {
        search.addEventListener('input', () => { this._skillSearch = search.value; this.render(); });
      }
      this.shadowRoot.querySelectorAll('[data-action="skill-type"]').forEach(btn => {
        btn.addEventListener('click', () => { this._skillTypeFilter = btn.dataset.val || null; this.render(); });
      });
      this.shadowRoot.querySelectorAll('[data-action="skill-sort"]').forEach(btn => {
        btn.addEventListener('click', () => { this._skillSort = btn.dataset.val; this.render(); });
      });
      this.shadowRoot.querySelectorAll('[data-action="skill-compact"]').forEach(btn => {
        btn.addEventListener('click', () => { this._skillCompact = !this._skillCompact; this.render(); });
      });
      this.shadowRoot.querySelectorAll('[data-action="toggle-section"]').forEach(el => {
        el.addEventListener('click', () => {
          const key = el.dataset.section;
          this._collapsedSections[key] = !this._collapsedSections[key];
          this.render();
        });
      });
    }
  }

  _renderTab(t,s){
    switch(t){
      case 'attributes': return this._renderAttr(s);
      case 'skills': return this._renderSkills(s);
      case 'equipment': return this._renderEq(s);
      case 'missions': return this._renderMs(s);
      case 'relations': return this._renderRel(s);
      default: return '';
    }
  }

  _renderAttr(s){
    const a = s;
    const p = s;
    const pg = s;
    const threat = this._calcThreat(s);
    const tl = threat.label.split(' ');
    const tNum = tl.length > 1 ? tl[1] : '';
    const tTxt = tl[0];
    
    const chakra = s['属性·查克拉'];
    const chakraCur = s['属性·当前查克拉'];
    const stamina = s['属性·体力'];
    const staminaCur = s['属性·当前体力'];
    const spirit = s['属性·精神力'];
    const spiritCur = s['属性·当前精神力'];
    const willpower = s['属性·意志力'];
    const willpowerCur = s['属性·当前意志力'];
    const exp = s['进度·经验'];
    const expNext = s['进度·下一级经验'];
    const promotion = s['进度·突破待处理'] ? { track: s['进度·突破待处理'] } : {};
    const ryo = s['进度·金钱'] || 0;
    
    return `
      <div class="sec">
        <div class="sec-title">绝密卷宗 (Dossier)</div>
        <div class="attr-bento">
          <div class="attr-card full-span attr-id-badge">
            <div>
              <div class="attr-label">代号 / 姓名</div>
              <div class="attr-id-name">${this._esc(p['玩家·姓名']||'忍者')}</div>
            </div>
            <div style="text-align:right;">
              <div class="attr-label">荣誉忍阶</div>
              <div class="attr-id-rank">${this._esc(p['玩家·忍阶'])}</div>
            </div>
          </div>
          
          <div class="attr-card" style="--threat-color: ${threat.color};">
            <div class="attr-threat"></div>
            <div class="attr-label">综合危险度</div>
            <div class="attr-threat-val">${tTxt} <span style="font-size:12px;opacity:0.6;font-family:var(--font-body); font-weight:normal;">${tNum}</span></div>
          </div>
          
          <div class="attr-card">
            <div class="attr-label">查克拉属性 / 出身</div>
            ${this._renderChakra(p['玩家·查克拉属性'])}
            <div style="font-size:10px; color:var(--text-tertiary); margin-top:auto;">${this._esc(p['玩家·出身']||'流浪')}</div>
          </div>
        </div>
      </div>
      
      <div class="sec">
        <div class="sec-title">能量与潜能 (Vitals)</div>
        <div class="attr-bento">
          <div class="attr-card full-span" style="padding: 24px;">
            ${this._newBar('查克拉', chakraCur, chakra, '#42A5F5')}
            ${this._newBar('生命力', staminaCur, stamina, '#66BB6A')}
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px;">
              ${this._newBar('精神力', spiritCur, spirit, '#CE93D8')}
              ${this._newBar('意志力', willpowerCur, willpower, '#eb613f')}
            </div>
          </div>
        </div>
      </div>
      
      <div class="sec" style="display:grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div>
          <div class="sec-title">实战造诣</div>
          <div class="attr-card" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            ${this._derivedBento(s)}
          </div>
        </div>
        <div>
          <div class="sec-title">考核与资金</div>
          <div class="attr-card" style="display:flex; flex-direction:column; gap:12px; padding: 16px;">
            <div>
              <div class="attr-label">当前历练</div>
              <div class="attr-value" style="color:var(--c-kin-bright); font-family:var(--font-mono);">${exp} <span style="font-size:10px;color:var(--text-tertiary);">/ ${expNext}</span></div>
            </div>
            <div>
              <div class="attr-label">晋升路线</div>
              <div class="attr-value" style="font-size:12px;">${this._track(promotion?.track)}</div>
            </div>
            <div>
              <div class="attr-label">当前资金</div>
              <div class="attr-value" style="color:var(--c-kin-bright); font-family:var(--font-mono); display:flex; align-items:center; gap:6px;">
                ${this._svg('coin', 14, 14)}
                ${ryo}
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  _renderChakra(natures) {
    if (!natures) return '<span style="color:var(--text-tertiary); font-size:12px; margin: 4px 0 8px;">未觉醒</span>';
    const list = Array.isArray(natures) ? natures : [natures];
    if (list.length === 0) return '<span style="color:var(--text-tertiary); font-size:12px; margin: 4px 0 8px;">未觉醒</span>';
    
    const colors = {
      '火': '#ef5350', '水': '#42A5F5', '风': '#81c784', '雷': '#ffd54f', '土': '#c69c6d',
      '阴': '#CE93D8', '阳': '#f4f1ea', '木': '#66BB6A', '冰': '#81d4fa', '熔': '#ff7043', '沸': '#ff8a65', '磁': '#90a4ae', '岚': '#b39ddb'
    };
    
    return `<div class="chakra-badges">` + list.map(n => {
      const c = colors[n] || 'var(--text-secondary)';
      // 如果颜色有透明度需求，可以稍加处理，这里简单处理 box-shadow 采用 currentColor 会自动继承
      return `<span class="chakra-badge" style="color:${c}; border-color: ${c}40;">${this._esc(n)}</span>`;
    }).join('') + `</div>`;
  }

  _calcThreat(s) {
    const a = s;
    const sk = s;
    const normalizeSkillGroup = g => {
      if (!g) return {};
      if (Array.isArray(g)) {
        const obj = {};
        g.forEach(item => { if (item && item.name) obj[item.name] = item; });
        return obj;
      }
      return g;
    };
    const best = g => Math.max(0, ...Object.values(normalizeSkillGroup(g)).map(x => Number(x?.mastery) || 0));
    
    const chakra = s['属性·查克拉'] || 0;
    const spirit = s['属性·精神力'] || 0;
    const stamina = s['属性·体力'] || 0;
    const speed = s['属性·速度'] || 0;
    const willpower = s['属性·意志力'] || 0;
    const luck = s['属性·幸运'] || 0;
    
    const skJutsu = this._scanSkills(s, '忍术');
    const skTaijutsu = this._scanSkills(s, '体术');
    const skGenjutsu = this._scanSkills(s, '幻术');
    
    const nin = Math.round((chakra) * 0.45 + (spirit) * 0.25 + best(skJutsu) * 0.7);
    const tai = Math.round((stamina) * 0.25 + (speed) * 0.9 + (willpower) * 0.2 + best(skTaijutsu) * 0.9);
    const gen = Math.round((spirit) * 0.75 + (chakra) * 0.2 + best(skGenjutsu) * 0.9);
    const def = Math.round((stamina) * 0.18 + (willpower) * 0.25);
    
    const total = Math.round((nin + tai + gen + def) * 0.35 + (speed) * 0.4 + (luck) * 0.3);
    
    const peak = Math.max(chakra, stamina, spirit, willpower, speed);

    const tiers = [
      { maxTotal: 25,  maxPeak: 20,  label: '无害平民', color: '#a39f98' },
      { maxTotal: 55,  maxPeak: 45,  label: 'D级威胁',   color: '#81c784' },
      { maxTotal: 100, maxPeak: 80,  label: 'C级威胁',   color: '#42A5F5' },
      { maxTotal: 170, maxPeak: 130, label: 'B级威胁',   color: '#c69c6d' },
      { maxTotal: 270, maxPeak: 200, label: 'A级威胁',   color: '#eb613f' },
      { maxTotal: 400, maxPeak: 300, label: 'S级威胁',   color: '#ef5350' },
      { maxTotal: Infinity, maxPeak: Infinity, label: '影级/神话', color: '#d50000' }
    ];
    
    let currentTier = tiers[0];
    for (let i = 1; i < tiers.length; i++) {
      const prev = tiers[i-1];
      if (total > prev.maxTotal && peak > prev.maxPeak) {
        currentTier = tiers[i];
      } else {
        break;
      }
    }
    
    return { label: `${currentTier.label} (${total})`, color: currentTier.color };
  }

  _derivedBento(s){
    const chakra = s['属性·查克拉']||0;
    const spirit = s['属性·精神力']||0;
    const stamina = s['属性·体力']||0;
    const speed = s['属性·速度']||0;
    const willpower = s['属性·意志力']||0;
    const skJutsu = this._scanSkills(s, '忍术');
    const skTaijutsu = this._scanSkills(s, '体术');
    const skGenjutsu = this._scanSkills(s, '幻术');
    const best=g=>Math.max(0,...Object.values(g||{}).map(x=>Number(x?.mastery)||0));
    const nin=Math.round((chakra)*0.45+(spirit)*0.25+best(skJutsu)*0.7);
    const tai=Math.round((stamina)*0.25+(speed)*0.9+(willpower)*0.2+best(skTaijutsu)*0.9);
    const gen=Math.round((spirit)*0.75+(chakra)*0.2+best(skGenjutsu)*0.9);
    const def=Math.round((stamina)*0.18+(willpower)*0.25);
    
    const items = [['忍术',nin,'#42A5F5'], ['体术',tai,'#66BB6A'], ['幻术',gen,'#CE93D8'], ['防御',def,'var(--text-secondary)']];
    return items.map(([l,v,c])=>`
      <div>
        <div class="attr-label">${l}</div>
        <div class="attr-value" style="font-family:var(--font-mono); color:${c};">${v}</div>
      </div>`).join('');
  }

  _newBar(l,cur,max,color){
    const p = max>0?formatPercentage(cur,max):0;
    return `
      <div class="attr-bar-wrap">
        <div class="attr-bar-label">
          <span>${l}</span>
          <span style="font-family:var(--font-mono); color:${color};">${cur} <span style="color:var(--text-tertiary);">/ ${max}</span></span>
        </div>
        <div class="attr-bar-track"><div class="attr-bar-fill" style="width:${p}%; background:${color}; color:${color};"></div></div>
      </div>`;
  }

  _normalizeSkillGroup(g) {
    if (!g) return {};
    if (Array.isArray(g)) {
      const obj = {};
      g.forEach(item => {
        if (item && typeof item === 'object' && item.name) {
          obj[item.name] = item;
        }
      });
      return obj;
    }
    return g;
  }

  _scanSkills(s, type) {
    const prefix = `技能·${type}·`;
    const result = {};
    const subFields = { '名称': 'name', '等级': 'rank', '属性': 'element', '消耗': 'cost', '威力': 'power', '熟练度': 'mastery', '描述': 'description' };
    const subFieldKeys = new Set(Object.keys(subFields));
    for (const [k, v] of Object.entries(s)) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      // Check if it's a flat sub-field key like "变身术·消耗"
      const dotIdx = rest.lastIndexOf('·');
      
      let isCorrupted = false;
      if (dotIdx > 0) {
        const parts = rest.split('·');
        for (let i = 0; i < parts.length - 1; i++) {
          if (subFieldKeys.has(parts[i])) {
            isCorrupted = true;
            break;
          }
        }
      }
      if (isCorrupted) continue;

      if (dotIdx > 0) {
        const skillName = rest.slice(0, dotIdx);
        const fieldCN = rest.slice(dotIdx + 1);
        if (subFieldKeys.has(fieldCN)) {
          if (!result[skillName]) result[skillName] = {};
          const fieldEN = subFields[fieldCN];
          
          let finalV = v;
          if (typeof v === 'object' && v !== null) {
            const vals = Object.values(v);
            if (vals.length === 1) finalV = vals[0];
            else if (v[fieldCN] !== undefined) finalV = v[fieldCN];
            else if (v[fieldEN] !== undefined) finalV = v[fieldEN];
          }
          
          result[skillName][fieldEN] = finalV;
          continue;
        }
      }
      // Original logic: direct object or number value
      if (typeof v === 'object' && v !== null) {
        result[rest] = { ...(result[rest] || {}), ...v };
      } else if (typeof v === 'number') {
        if (!result[rest]) result[rest] = { name: rest, mastery: v };
      }
    }
    return result;
  }

  _renderSkills(s){
    const ju = this._scanSkills(s, '忍术');
    const tai = this._scanSkills(s, '体术');
    const gen = this._scanSkills(s, '幻术');
    const support = this._scanSkills(s, '支援');
    const talents = this._scanSkills(s, '天赋');
    const extraNin = {};
    const auxiliary = {};
    const knowledge = {};
    Object.assign(ju, extraNin);
    Object.assign(support, auxiliary, knowledge);

    let kgText = '普通血脉';
    const kg = s['技能·血继限界'];
    if (kg) {
      if (typeof kg === 'string') kgText = kg;
      else if (Array.isArray(kg)) kgText = kg.map(k => typeof k === 'string' ? k : (k.name || '')).filter(Boolean).join('、') || '普通血脉';
      else if (typeof kg === 'object') kgText = kg.name || Object.keys(kg).join('、') || '普通血脉';
    }
    const isNormalBloodline = kgText === '普通血脉';

    const cats = [['秘传忍术', ju, 'element', 'jutsu'], ['体术造诣', tai, null, 'taijutsu'], ['幻术解析', gen, null, 'genjutsu'], ['辅助技能', support, null, 'support']];
    const allSkills = [];
    cats.forEach(([, skills, , type]) => { Object.entries(skills).forEach(([n,d]) => { allSkills.push({ ...d, name: n, _type: type }); }); });

    const bar = `<div class="skill-bar">
      <input class="skill-search" id="skill-search" placeholder="搜索技能..." value="${this._escAttr(this._skillSearch)}" data-action="skill-search">
      <button class="skill-btn ${!this._skillTypeFilter?'active':''}" data-action="skill-type" data-val="">全部</button>
      <button class="skill-btn ${this._skillTypeFilter==='jutsu'?'active':''}" data-action="skill-type" data-val="jutsu">忍</button>
      <button class="skill-btn ${this._skillTypeFilter==='taijutsu'?'active':''}" data-action="skill-type" data-val="taijutsu">体</button>
      <button class="skill-btn ${this._skillTypeFilter==='genjutsu'?'active':''}" data-action="skill-type" data-val="genjutsu">幻</button>
      <button class="skill-btn ${this._skillTypeFilter==='support'?'active':''}" data-action="skill-type" data-val="support">辅</button>
      <button class="skill-btn ${this._skillSort==='mastery'?'active':''}" data-action="skill-sort" data-val="mastery">熟练度↓</button>
      <button class="skill-btn ${this._skillSort==='default'?'active':''}" data-action="skill-sort" data-val="default">默认</button>
      <button class="skill-btn ${this._skillCompact?'active':''}" data-action="skill-compact">紧凑</button>
    </div>`;

    const visible = this._getFilteredSortedSkills(allSkills);
    const totalStr = allSkills.length !== visible.length
      ? `显示 ${visible.length} / 总计 ${allSkills.length} 个技能`
      : `总计 ${allSkills.length} 个技能`;

    return `<div class="sec">
        <div class="sec-title" style="cursor:default;">血继限界</div>
        <div class="skill-card bloodline ${isNormalBloodline ? 'normal' : ''}">
          <div class="skill-title">${this._esc(kgText)}</div>
        </div>
      </div>
      <div class="sec">
        <div class="sec-title" style="cursor:default;">特殊天赋</div>
        <div class="grid-list">
          ${Object.entries(talents).length?Object.entries(talents).map(([n,d])=>`
            <div class="skill-card">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div class="skill-title">${this._esc(n)}</div>
                <span class="glass-pill" style="padding:2px 8px; font-size:9px;">${d.custom?'自创':'先天'}</span>
              </div>
              <div style="font-size:11px; color:var(--text-secondary); line-height:1.5;">${this._esc(d.description||'效果未知')}</div>
            </div>`).join(''):`
            <div class="skill-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="12" r="3"/></svg>
              <span>血继限界尚未显现，<em>结印发起遭遇</em> 或可唤醒沉睡血脉</span>
            </div>`}
        </div>
      </div>`
      + bar + `<div class="skill-summary">${totalStr}</div>`
      + this._skillSection('秘传忍术', ju, 'element', 'jutsu')
      + this._skillSection('体术造诣', tai, null, 'taijutsu')
      + this._skillSection('幻术解析', gen, null, 'genjutsu')
      + this._skillSection('辅助技能', support, null, 'support');
  }

  _getFilteredSortedSkills(all) {
    let list = all;
    if (this._skillSearch) {
      const q = this._skillSearch.toLowerCase();
      list = list.filter(s => (s.name||'').toLowerCase().includes(q));
    }
    if (this._skillTypeFilter) {
      list = list.filter(s => s._type === this._skillTypeFilter);
    }
    if (this._skillSort === 'mastery') {
      list = [...list].sort((a, b) => (b.mastery||0) - (a.mastery||0));
    }
    return list;
  }

  _skillSection(title, skills, metaKey, type) {
    const normalized = this._normalizeSkillGroup(skills);
    const entries = Object.entries(normalized);
    let list = entries.map(([n,d]) => ({ ...d, name: n }));
    if (this._skillSearch) {
      const q = this._skillSearch.toLowerCase();
      list = list.filter(s => (s.name||'').toLowerCase().includes(q));
    }
    if (this._skillTypeFilter && this._skillTypeFilter !== type) list = [];
    if (this._skillSort === 'mastery') list.sort((a, b) => (b.mastery||0) - (a.mastery||0));

    const getThemeColor = (t) => {
      if(t==='jutsu') return '#42A5F5';
      if(t==='taijutsu') return '#66BB6A';
      if(t==='genjutsu') return '#CE93D8';
      return 'var(--text-primary)';
    };
    const color = getThemeColor(type);

    const sectionKey = type;
    const isCollapsed = this._collapsedSections[sectionKey] || false;

    const bodyHtml = !list.length ? `
      <div class="skill-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="14" height="18" x="5" y="3" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>
        <span>尚未习得任何术，<em>修行或拜师</em> 方能掌握</span>
      </div>` : (this._skillCompact
        ? list.map(d => this._compactSkillRow(d, color, metaKey)).join('')
        : `<div class="grid-list">${list.map(d => {
            const mColor = (m) => { if(m>=80) return '#ef5350'; if(m>=60) return '#eb613f'; if(m>=40) return '#c69c6d'; if(m>=20) return '#e8c87a'; return '#a39f98'; };
            return `<div class="skill-card" style="border-left-color: ${color};">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                <div class="skill-title">${this._esc(d.name)}</div>
                <div class="skill-mastery-tag">${this._mt(d?.mastery||0)}</div>
              </div>
              ${d.description ? `<div style="font-size:11px; color:var(--text-secondary); line-height:1.5; margin-bottom:12px;">${this._esc(d.description)}</div>` : ''}
              <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid var(--border-subtle); padding-top: 8px;">
                <div style="font-size:10px; color:var(--text-tertiary); display:flex; gap:8px;">
                  ${d[metaKey] ? `<span style="color:${color}; font-weight:bold;">${this._esc(d[metaKey])}</span>` : ''}
                  <span>${this._esc(d.rank||'E')} 级</span>
                </div>
                <div style="font-size:10px; color:var(--text-secondary); font-family:var(--font-mono);">造诣 ${d.mastery||0}</div>
              </div>
            </div>`;
          }).join('')}</div>`);

    return `
      <div class="sec">
        <div class="sec-title skill-collapse-title" data-action="toggle-section" data-section="${sectionKey}">
          <span class="arrow${isCollapsed?'':' open'}">▶</span>
          ${title}<span class="skill-collapse-badge">(${list.length})</span>
        </div>
        <div class="skill-section-body${isCollapsed?' collapsed':''}" style="max-height:${isCollapsed?'0':'2000px'}">
          ${bodyHtml}
        </div>
      </div>`;
  }

  _compactSkillRow(d, color, metaKey) {
    const el = d[metaKey] ? `<span style="color:${color};font-weight:bold;font-size:10px;">${this._esc(d[metaKey])}</span>` : '';
    const rank = `<span style="font-size:10px;color:var(--text-tertiary);">${this._esc(d.rank||'E')}</span>`;
    return `<div class="skill-compact-row" data-action="expand-skill" data-skill="${this._escAttr(d.name)}" data-type="${this._escAttr(d._type||'')}">
      <span class="skill-name" title="${this._escAttr(d.name)}">${this._esc(d.name)}</span>
      <span class="skill-meta">${el}${rank}<span style="font-size:10px;color:var(--text-secondary);">${this._mt(d.mastery||0)}</span></span>
      <span class="skill-mastery-num">造诣 ${d.mastery||0}</span>
    </div>`;
  }

  _mt(v){ return v>=100?'极意':v>=80?'精纯':v>=60?'老练':v>=40?'熟稔':v>=20?'初成':'入门'; }

  _renderEq(s){
    // Equipped slots store item names as plain strings (e.g. '草薙剑'); _eqSlots/_eqSection handle string-or-object.
    const equipped = {
      weapon: s['物品·已装备·武器'] || null,
      armor: s['物品·已装备·防具'] || null,
      accessory1: s['物品·已装备·饰品1'] || null,
      accessory2: s['物品·已装备·饰品2'] || null
    };
    for (const k of Object.keys(equipped)) { if (!equipped[k]) delete equipped[k]; }

    // Scan flat state keys and reassemble into item objects
    const weapons = {};
    const armor = {};
    const tools = {};
    const consumables = {};
    const catMap = { '武器': weapons, '防具': armor, '道具': tools, '消耗品': consumables };
    const fieldMap = { '数量': 'quantity', '品质': 'quality', '描述': 'description', '说明': 'description', '名称': 'name', '类型': 'type', '威力': 'power', '消耗': 'cost', '属性': 'element' };
    const fieldMapKeys = new Set(Object.keys(fieldMap));
    for (const [k, v] of Object.entries(s)) {
      if (!k.startsWith('物品·')) continue;
      if (k.startsWith('物品·已装备·')) continue;
      // Try matching flat sub-field: 物品·消耗品·兵粮丸·数量
      const parts = k.split('·');
      if (parts.length >= 4) {
        const catCN = parts[1];
        const bucket = catMap[catCN];
        if (!bucket) continue;
        const itemName = parts.slice(2, -1).join('·');
        const fieldCN = parts[parts.length - 1];
        
        // Sanitize: If the itemName contains any known subfield keywords, it's a corrupted key from past bugs
        let isCorrupted = false;
        const itemNameParts = parts.slice(2, -1);
        for (const p of itemNameParts) {
          if (fieldMapKeys.has(p)) {
            isCorrupted = true;
            break;
          }
        }
        if (isCorrupted) continue;

        if (fieldMapKeys.has(fieldCN)) {
          if (!bucket[itemName]) bucket[itemName] = {};
          
          let finalV = v;
          if (typeof v === 'object' && v !== null) {
            const vals = Object.values(v);
            if (vals.length === 1) finalV = vals[0];
            else if (v[fieldCN] !== undefined) finalV = v[fieldCN];
            else if (v[fieldMap[fieldCN]] !== undefined) finalV = v[fieldMap[fieldCN]];
          }
          
          bucket[itemName][fieldMap[fieldCN]] = finalV;
          continue;
        }
      }
      // Direct object: 物品·消耗品·兵粮丸 = {quantity:3, quality:'普通'}
      if (parts.length === 3) {
        const catCN = parts[1];
        const bucket = catMap[catCN];
        if (!bucket) continue;
        const itemName = parts[2];
        if (typeof v === 'object' && v !== null) {
          bucket[itemName] = { ...(bucket[itemName] || {}), ...v };
        }
      }
    }
    // Also merge from nested s.equipment if it exists (legacy support)
    if (s.equipment && typeof s.equipment === 'object') {
      for (const [cat, items] of Object.entries(s.equipment)) {
        const bucket = { weapons, armor, tools, consumables }[cat];
        if (bucket && typeof items === 'object') {
          for (const [n, item] of Object.entries(items)) {
            bucket[n] = { ...(bucket[n] || {}), ...item };
          }
        }
      }
    }
    const ryo = s['进度·金钱'] || 0;
    const bonus = this._equipBonusSummary({ equipped, weapons, armor, tools, consumables });
    return `
      <div class="sec" style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="sec-title" style="margin:0;">忍具与行囊</div>
          <div class="gold" style="font-size:13px; font-weight:bold; letter-spacing:1px; background:rgba(198,156,109,0.1); padding:4px 10px; border-radius:12px; border:1px solid rgba(198,156,109,0.3); display:flex; align-items:center; gap:6px;">
            ${this._svg('coin')} ${ryo} 两
          </div>
        </div>
      </div>
      ${this._eqSlots(equipped, bonus)}
      <div style="margin-top: 24px;">
        ${this._eqSection('兵器', weapons, 'weapons', equipped, 'weapon')}
        ${this._eqSection('防具', armor, 'armor', equipped, 'armor')}
        ${this._eqSection('刃具', tools, 'tools', equipped, 'tools')}
        ${this._eqSection('物资', consumables, 'consumables', equipped, 'consumable')}
      </div>`;
  }

  _equipBonusSummary(equipment) {
    const bonus = {};
    const Q = { '破烂':0,'普通':3,'精良':8,'优秀':15,'史诗':25,'传说':40 };
    const QD = { '破烂':0,'普通':1,'精良':3,'优秀':6,'史诗':10,'传说':18 };
    const QL = { '破烂':0,'普通':0,'精良':1,'优秀':2,'史诗':4,'传说':7 };
    const equipped = equipment.equipped || {};
    for (const [slot, entry] of Object.entries(equipped)) {
      if (!entry) continue;
      let item = equipment.weapons?.[entry.name] || equipment.armor?.[entry.name] || equipment.tools?.[entry.name];
      if (!item) item = stateManager.get(`物品·武器·${entry.name}`) || stateManager.get(`物品·防具·${entry.name}`) || stateManager.get(`物品·道具·${entry.name}`) || { name: entry.name, quality: '普通' };
      if (!item) continue;
      
      if (item.stats && typeof item.stats === 'object') {
        for (const [k, v] of Object.entries(item.stats)) {
          if (typeof v === 'number') {
            bonus[k] = (bonus[k] || 0) + v;
          }
        }
      } else {
        const q = item.quality || '普通';
        if (entry.category === 'weapons') bonus.speed = (bonus.speed || 0) + Math.floor((Q[q]||0) * 0.3);
        if (entry.category === 'armor') bonus.stamina = (bonus.stamina || 0) + (QD[q]||0);
        if (entry.category === 'tools') bonus.luck = (bonus.luck || 0) + (QL[q]||0);
      }
    }
    return bonus;
  }

  _getQualityColor(q) {
    const colors = { '破烂':'#a39f98', '普通':'#e8e4d9', '精良':'#66BB6A', '优秀':'#42A5F5', '史诗':'#c69c6d', '传说':'#ef5350' };
    return colors[q] || '#e8e4d9';
  }

  _svg(type) {
    const paths = {
      'weapon': '<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/>', // Sword/Blade
      'armor': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', // Shield
      'accessory': '<path d="M12 22A10 10 0 0 1 12 2a10 10 0 0 1 0 20z"/><circle cx="12" cy="12" r="3"/><path d="M12 5v2"/><path d="M12 17v2"/>', // Jade Pendant
      'tools': '<path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/>', // Kunai
      'consumable': '<rect width="14" height="14" x="5" y="5" rx="7" ry="7"/><path d="M5 12h14"/>', // Pill
      'coin': '<circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M9.5 9.5h5"/><path d="M9.5 14.5h5"/>' // Coin / Ryo
    };
    return `<svg class="eq-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[type]||paths['weapon']}</svg>`;
  }

  _eqSlots(equipped, bonus) {
    const slots = [
      { key: 'weapon', label: '主武器', type: 'weapon' },
      { key: 'armor', label: '战斗服', type: 'armor' },
      { key: 'accessory1', label: '挂饰一', type: 'accessory' },
      { key: 'accessory2', label: '挂饰二', type: 'accessory' }
    ];
    let html = `<div class="sec" style="background: rgba(255,255,255,0.015); padding: 16px; border-radius: var(--r-md); box-shadow: var(--shadow-inner);">
      <div class="sec-title" style="margin-top:0; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle);">战斗武装</div>`;
    
    const bonusEntries = Object.entries(bonus);
    if (bonusEntries.length > 0) {
      html += `<div class="rel-stats" style="margin-bottom:16px; display:flex; gap:8px; flex-wrap:wrap;">`;
      const lblMap = {'chakra':'查克拉上限','stamina':'体力上限','spirit':'精神上限','willpower':'意志上限','strength':'综合实力','speed':'速度','ninjutsu':'忍术','taijutsu':'体术','genjutsu':'幻术','luck':'气运', 'attack':'攻击力', 'defense':'防御力'};
      for (const [k, v] of bonusEntries) {
        if (v === 0) continue;
        const name = lblMap[k] || k;
        html += `<span class="item-tag" style="background:rgba(235,97,63,0.1); color:#eb613f; border-color:rgba(235,97,63,0.3);">${name} ${v > 0 ? '+'+v : v}</span>`;
      }
      html += `</div>`;
    }
    
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">`;
    for (const slot of slots) {
      const entry = equipped[slot.key];
      if (entry) {
        // entry 在新扁平state中是字符串(物品名)；兼容旧的对象格式 { name, category }
        const itemName = typeof entry === 'string' ? entry : (entry?.name || '');
        const entryCat = typeof entry === 'object' ? entry.category : null;
        let item = null;
        // 尝试从所有可能的分类下查找该物品
        const tryCats = entryCat ? [entryCat] : ['weapons', 'armor', 'tools'];
        const catMap = { weapons: '武器', armor: '防具', tools: '道具' };
        for (const cat of tryCats) {
          const catCN = catMap[cat] || cat;
          const fullKey = `物品·${catCN}·${itemName}`;
          const found = stateManager.get(fullKey);
          if (found) { item = found; break; }
        }
        if (!item) item = { name: itemName, quality: '普通' };
        const q = (item && item.quality) || '普通';
        const qColor = this._getQualityColor(q);
        const wmark = q === '传说' ? '極' : q === '史诗' ? '稀' : '';
        html += `<div class="eq-card" data-quality="${q}" data-slot="${slot.key}" style="display:flex; justify-content:space-between; align-items:center;">
          <div class="eq-watermark">${wmark}</div>
          <div style="display:flex; flex-direction:column; gap:6px; position:relative; z-index:2;">
            <span style="font-size:10px; color:var(--text-tertiary); letter-spacing:1px; display:flex; align-items:center; gap:4px;">${this._svg(slot.type)} ${slot.label}</span>
            <span style="font-size:14px; font-weight:800; color:var(--text-primary); letter-spacing:1px; font-family:var(--font-title);">${this._esc(itemName)}</span>
            <span style="font-size:10px; color:${qColor};">${this._esc(q)}</span>
          </div>
          <button class="btn-sleek eq-unequip-btn" data-slot="${slot.key}" title="卸下" style="width:32px; height:32px; border-radius:10px; position:relative; z-index:2;">✕</button>
        </div>`;
      } else {
        html += `<div class="eq-empty-slot" data-slot="${slot.key}">
          ${this._svg(slot.type)}
          <span>未装备</span>
        </div>`;
      }
    }
    html += `</div></div>`;
    return html;
  }

  _eqSection(title, items, category, equipped, svgType) {
    let list = [];
    if (Array.isArray(items)) {
      list = items.map(i => [i.name || '未知装备', i]);
    } else {
      list = Object.entries(items || {});
    }
    let content = '';
    if (!list.length) {
      content = `
        <div style="padding: 24px; text-align: center; background: rgba(255,255,255,0.015); border: 1px dashed rgba(255,255,255,0.05); border-radius: 8px;">
          <div style="color: rgba(255,255,255,0.1); margin-bottom: 8px;">${this._svg(svgType)}</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">行囊空空如也，尚未获得此类武装</div>
        </div>`;
    } else {
      content = `
        <div style="display:grid; grid-template-columns:1fr; gap:12px;">
          ${list.map(([n,i])=> {
            const isEquipped = Object.values(equipped).some(e => {
              if (!e) return false;
              const nm = typeof e === 'string' ? e : e.name;
              return nm === n;
            });
            const qColor = this._getQualityColor(i.quality || '普通');
            const wmark = i.quality === '传说' ? '極' : i.quality === '史诗' ? '稀' : '';
            return `
            <div class="eq-card" data-quality="${i.quality||'普通'}" style="display:flex; flex-direction:column; padding:12px 16px; gap:8px;">
              <div class="eq-watermark">${wmark}</div>
              <div style="display:flex; justify-content:space-between; align-items:flex-start; position:relative; z-index:2;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <div style="font-size:14px; font-weight:800; font-family:var(--font-title); color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                    ${this._esc(n)} 
                    ${isEquipped ? `<span style="font-size:9px; background:var(--text-primary); color:var(--c-void); padding:2px 6px; border-radius:2px; font-weight:bold;">装备中</span>` : ''}
                  </div>
                  <div style="font-size:11px; color:var(--text-tertiary); display:flex; gap:12px;">
                    <span style="color:${qColor};">${this._esc(i.quality||'普通')}</span>
                    <span>持有: ${typeof i.quantity === 'object' ? (i.quantity?.value || i.quantity?.amount || i.quantity?.count || i.quantity?.quantity || 1) : (i.quantity || 1)}</span>
                  </div>
                </div>
                <div style="display:flex; gap:8px;">
                  ${category === 'weapons' || category === 'armor' || category === 'tools' ? 
                    (isEquipped ? `<button class="btn-sleek active eq-unequip-btn" data-name="${this._escAttr(n)}" data-cat="${category}" style="padding:6px 12px;">卸下</button>`
                    : `<button class="btn-sleek eq-equip-btn" data-name="${this._escAttr(n)}" data-cat="${category}" style="padding:6px 12px;">装备</button>`) : ''}
                  ${category === 'consumables' ? `<button class="btn-sleek eq-use-btn" data-name="${this._escAttr(n)}" style="padding:6px 12px;">使用</button>` : ''}
                </div>
              </div>
              ${i.description ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:4px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.05); position:relative; z-index:2; line-height:1.5;">${this._esc(i.description)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>`;
    }

    return `
      <div class="sec" style="margin-bottom:24px;">
        <div class="sec-title" style="color:var(--text-tertiary); margin-bottom:12px; display:flex; align-items:center;">
          <span style="margin-right:8px; display:inline-flex; align-items:center;">${this._svg(svgType)}</span>
          ${title}
        </div>
        ${content}
      </div>`;
  }

  _renderMs(s){
    const m = stateManager.getSub('_missions') || {};
    const activeList = (m.active && typeof m.active === 'object') ? Object.values(m.active) : [];
    const completedList = (m.completed && typeof m.completed === 'object') ? Object.values(m.completed) : [];
    return `
      <div class="sec">
        <div class="sec-title">悬赏令 (进行中)</div>
        ${activeList.length > 0 ? activeList.map(x=>`
          <div class="item-card mission-seal ${x.rank||'D'}">
            <div class="rank-badge">${x.rank||'D'}</div>
            <div>
              <div class="item-header" style="margin-bottom: 4px;">
                <div class="item-name">${this._esc(x.title||'未知道')}</div>
              </div>
              <div class="item-desc" style="color:var(--text-secondary);">${this._esc(x.objective||'')}</div>
              <div class="rel-stats" style="margin-top:12px; border-top: none; padding-top: 0;">
                <span class="tag">${this._esc(x.location||'?')}</span>
                <span class="tag" style="color:var(--text-primary); border-bottom-color:var(--text-primary);">风险 // ${this._esc(x.risk||'?')}</span>
              </div>
            </div>
          </div>`).join(''):'<div class="empty">尚无委托送达<br><em>前往忍者学校</em>，或可接取任务</div>'}
      </div>
      <div class="sec">
        <div class="sec-title">完成记录</div>
        ${completedList.slice(-3).reverse().map(x=>`
          <div class="row" style="opacity:0.5; padding: 8px 0;">
            <span class="row-l" style="font-size:12px; text-transform:none; letter-spacing:0;">${this._esc(x.title||'?')}</span>
            <span class="row-v" style="font-size:10px;">${x.rank||'?'}</span>
          </div>`).join('') || '<div class="empty" style="opacity:0.4;">暂无记录</div>'}
      </div>`;
  }

  showRelModal(name) {
    const r = stateManager.getSub('_relationships') || {};
    const d = r[name];
    if (!d) return;

    const Modal = customElements.get('game-modal');
    if (!Modal) return;
    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);

    const icons = {
      chakra: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`,
      stamina: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
      speed: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
      spirit: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
      willpower: `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`
    };

    // ── 渲染 NPC 战斗属性卡片 ──
    const cs = d.combat_stats;
    let combatStatsHtml = '';
    if (cs) {
      const statDefs = [
        { key: '查克拉', icon: icons.chakra, color: '#00E5FF', maxKey: '查克拉上限', fmt: (v,mx) => `${v}/${mx}` },
        { key: '体力', icon: icons.stamina, color: '#FF4D4D', maxKey: '体力上限', fmt: (v,mx) => `${v}/${mx}` },
        { key: '速度', icon: icons.speed, color: '#81C784', fmt: (v) => v },
        { key: '精神力', icon: icons.spirit, color: '#CE93D8', fmt: (v) => v },
        { key: '意志力', icon: icons.willpower, color: '#FFB74D', fmt: (v) => v },
      ];
      const masteryDefs = [
        { key: '忍术造诣', color: '#00E5FF' },
        { key: '体术造诣', color: '#81C784' },
        { key: '幻术造诣', color: '#CE93D8' },
      ];
      let statCards = '';
      for (const sd of statDefs) {
        const val = cs[sd.key];
        if (val === undefined) continue;
        const maxV = sd.maxKey ? cs[sd.maxKey] : null;
        const pct = maxV ? Math.min(100, Math.round((val / Math.max(1, maxV)) * 100)) : 50;
        statCards += `<div class="npc-stat-card">
          <div class="npc-stat-head">
            <span class="npc-stat-icon" style="color:${sd.color}">${sd.icon}</span>
            <span class="npc-stat-label">${sd.key}</span>
          </div>
          <div class="npc-stat-val">${sd.fmt(val, maxV)}</div>
          <div class="npc-stat-bar"><div class="npc-stat-fill" style="width:${pct}%;background:${sd.color}"></div></div>
        </div>`;
      }
      let masteryCards = '';
      for (const md of masteryDefs) {
        const val = cs[md.key];
        if (val === undefined) continue;
        masteryCards += `<div class="npc-stat-card npc-mastery">
          <div class="npc-stat-label">${md.key}</div>
          <div class="npc-stat-val">${val}</div>
          <div class="npc-stat-bar"><div class="npc-stat-fill" style="width:${val}%;background:${md.color}"></div></div>
        </div>`;
      }
      const nature = cs.查克拉属性;
      const rank = cs.忍阶;
      let metaRow = '';
      if (nature || rank) {
        metaRow = `<div class="npc-meta-row">${
          rank ? `<span class="npc-rank-badge">${this._esc(rank)}</span>` : ''
        }${
          Array.isArray(nature) ? nature.map(n => `<span class="npc-nature-tag">${this._esc(n)}</span>`).join('') : ''
        }</div>`;
      }
      combatStatsHtml = `
        <div class="npc-section">
          <div class="npc-section-title"><span>战斗图谱</span><div class="line"></div></div>
          ${metaRow}
          <div class="npc-stat-grid">${statCards}</div>
          <div class="npc-mastery-grid">${masteryCards}</div>
        </div>`;
    }

    // ── 渲染忍术列表 ──
    let jutsuHtml = '';
    const jutsus = cs?.忍术;
    if (Array.isArray(jutsus) && jutsus.length > 0) {
      const rankColors = { S:'#FFB74D', A:'#ef5350', B:'#CE93D8', C:'#42A5F5', D:'#81C784', E:'#a39f98' };
      const typeLabels = { '忍术':'NIN', '体术':'TAI', '幻术':'GEN', 'ninjutsu':'NIN', 'taijutsu':'TAI', 'genjutsu':'GEN' };
      const cards = jutsus.map(j => {
        const jName = j.名称 || j.name || '?';
        const jRank = j.等级 || j.rank || 'D';
        const jElem = j.属性 || j.element || '';
        const jCost = j.消耗 ?? j.cost ?? 0;
        const jPower = j.威力 ?? j.power ?? 0;
        const jMast = j.熟练度 ?? j.mastery ?? 0;
        const jDesc = j.描述 || j.description || '';
        const jType = j.类型 || j.type || '忍术';
        const rc = rankColors[jRank] || '#a39f98';
        return `<div class="npc-jutsu-card">
          <div class="jutsu-bg-glow" style="background:${rc}"></div>
          <div class="jutsu-head">
            <span class="jutsu-rank" style="color:${rc}">${jRank}</span>
            <span class="jutsu-type">${typeLabels[jType] || jType}</span>
            ${jElem ? `<span class="jutsu-elem">${this._esc(jElem)}</span>` : ''}
            <span class="jutsu-name">${this._esc(jName)}</span>
          </div>
          ${jDesc ? `<div class="jutsu-desc">${this._esc(jDesc)}</div>` : ''}
          <div class="jutsu-stats">
            <span title="威力"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none"><path d="M14.5 17.5L3 6V3h3l11.5 11.5c.5.5.5 1.5 0 2-.5.5-1.5.5-2 0z"/><path d="M19 14l-4-4"/></svg> ${jPower}</span>
            <span title="消耗"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ${jCost}</span>
            <span title="熟练度"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${jMast}</span>
          </div>
        </div>`;
      }).join('');
      jutsuHtml = `
        <div class="npc-section">
          <div class="npc-section-title"><span>忍术档案 · ${jutsus.length}</span><div class="line"></div></div>
          <div class="npc-jutsu-list">${cards}</div>
        </div>`;
    }

    const css = `
      <style>
      .npc-modal { display: flex; flex-direction: column; gap: 32px; padding: 10px; color: rgba(255,255,255,0.85); }
      .npc-header { display: flex; gap: 20px; align-items: center; position: relative; }
      .npc-avatar-ring { width: 72px; height: 72px; position: relative; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 4px 12px rgba(198,156,109,0.3)); }
      .npc-avatar-ring::before { content: ''; position: absolute; inset: 0; background: conic-gradient(from 0deg, transparent, rgba(198,156,109,0.9), transparent); clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); animation: spin 8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .npc-avatar { width: 66px; height: 66px; background: #0A0A0A; clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); display: flex; align-items: center; justify-content: center; font-family: var(--font-brush, serif); color: #c69c6d; font-size: 32px; font-weight: bold; }
      
      .npc-id { flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .npc-name { font-size: 24px; font-weight: 900; color: #ffffff; letter-spacing: 2px; }
      .npc-sub { font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; display: flex; gap: 8px; }
      
      .npc-social-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .npc-social-item { background: rgba(255,255,255,0.02); padding: 12px; border-radius: 6px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); display: flex; flex-direction: column; gap: 4px; }
      .npc-social-item .social-label { font-size: 10px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 2px; }
      .npc-social-item .social-val { font-size: 18px; font-weight: 700; font-family: monospace; }
      .npc-social-item.affection.pos .social-val { color: #81C784; }
      .npc-social-item.affection.neg .social-val { color: #ef5350; }
      .npc-social-item.trust .social-val { color: #42A5F5; }
      .npc-social-item.respect .social-val { color: #c69c6d; }
      
      .npc-section-title { font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.4); letter-spacing: 4px; display: flex; align-items: center; gap: 16px; margin-bottom: 20px; text-transform: uppercase; }
      .npc-section-title .line { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(255,255,255,0.05), transparent); }
      
      .npc-meta-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
      .npc-rank-badge { background: rgba(198,156,109,0.1); color: #c69c6d; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: bold; letter-spacing: 1px; border: 1px solid rgba(198,156,109,0.2); }
      .npc-nature-tag { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.6); padding: 4px 10px; border-radius: 4px; font-size: 10px; border: 1px solid rgba(255,255,255,0.05); }
      
      .npc-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin-bottom: 12px; }
      .npc-stat-card { background: rgba(255,255,255,0.015); border-radius: 8px; padding: 12px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); display: flex; flex-direction: column; gap: 8px; }
      .npc-stat-head { display: flex; align-items: center; gap: 8px; }
      .npc-stat-label { font-size: 10px; color: rgba(255,255,255,0.3); font-weight: 600; text-transform: uppercase; }
      .npc-stat-val { font-size: 14px; font-weight: 600; color: #fff; font-family: monospace; }
      .npc-stat-bar { width: 100%; height: 2px; background: rgba(0,0,0,0.6); overflow: hidden; border-radius: 1px; }
      .npc-stat-fill { height: 100%; box-shadow: 0 0 8px currentColor; }
      
      .npc-mastery-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .npc-stat-card.npc-mastery { padding: 12px; }
      
      .npc-jutsu-list { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .npc-jutsu-card { background: rgba(255,255,255,0.015); border-radius: 8px; padding: 16px; position: relative; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); transition: background 0.2s; }
      .npc-jutsu-card:hover { background: rgba(255,255,255,0.03); }
      .jutsu-bg-glow { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0.03; filter: blur(20px); pointer-events: none; }
      .jutsu-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .jutsu-rank { font-size: 14px; font-family: var(--font-brush, serif); font-weight: bold; text-shadow: 0 0 8px currentColor; line-height: 1; }
      .jutsu-type { font-size: 9px; border: 1px solid rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; color: rgba(255,255,255,0.4); letter-spacing: 1px; }
      .jutsu-elem { font-size: 9px; background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 3px; color: rgba(255,255,255,0.5); }
      .jutsu-name { font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 1px; flex: 1; text-align: right; }
      .jutsu-desc { font-size: 11px; color: rgba(255,255,255,0.4); line-height: 1.6; margin-bottom: 16px; }
      .jutsu-stats { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.3); font-family: monospace; }
      .jutsu-stats span { display: flex; align-items: center; gap: 6px; }
      
      .npc-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
      .npc-tag { font-size: 10px; color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.03); padding: 4px 10px; border-radius: 4px; letter-spacing: 1px; }
      
      .timeline-wrap { display: flex; flex-direction: column; gap: 16px; }
      .timeline-node { position: relative; padding-left: 16px; border-left: 1px solid rgba(255,255,255,0.05); }
      .timeline-node::before { content: ''; position: absolute; left: -3px; top: 6px; width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.2); }
      .tl-time { font-size: 9px; color: rgba(255,255,255,0.3); margin-bottom: 4px; letter-spacing: 1px; }
      .tl-action { font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.6; margin-bottom: 8px; }
      .tl-thought { font-size: 12px; color: rgba(198,156,109,0.8); line-height: 1.6; font-family: 'Georgia', 'Songti SC', serif; font-style: italic; background: linear-gradient(90deg, rgba(198,156,109,0.05), transparent); padding: 10px 12px; border-left: 2px solid rgba(198,156,109,0.3); border-radius: 0 4px 4px 0; }
      </style>
    `;

    const html = `
      ${css}
      <div class="npc-modal">
        <div class="npc-header">
          <div class="npc-avatar-ring">
            <div class="npc-avatar">${name[0]}</div>
          </div>
          <div class="npc-id">
            <div class="npc-name">${this._esc(name)}</div>
            <div class="npc-sub">
              ${d.faction ? `<span>${this._esc(d.faction)}</span>` : ''}
              ${d.role ? `<span>${this._esc(d.role)}</span>` : ''}
            </div>
          </div>
        </div>

        <div class="npc-social-grid">
          <div class="npc-social-item affection ${(d.affection||0)>=0?'pos':'neg'}">
            <div class="social-label">好感度</div>
            <div class="social-val">${d.affection||0}</div>
          </div>
          <div class="npc-social-item trust">
            <div class="social-label">信任度</div>
            <div class="social-val">${d.trust||0}</div>
          </div>
          <div class="npc-social-item respect">
            <div class="social-label">敬畏度</div>
            <div class="social-val">${d.respect||0}</div>
          </div>
        </div>

        ${combatStatsHtml}
        ${jutsuHtml}
        ${this._renderInteractionLog(d.history)}
        ${(d.tags||[]).length ? `<div class="npc-tags">${d.tags.map(t=>`<span class="npc-tag">${this._esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    `;
    modal.show({ title: '绝密情报档案', content: html, buttons: [{ label: '关闭', primary: true, onClick: () => modal.close() }] });
  }

  _renderInteractionLog(historyArray) {
    if (!Array.isArray(historyArray) || historyArray.length === 0) return '';
    const nodes = historyArray.slice(0, 10).map(e => {
      let summary = e.summary || '';
      let actionHtml = '';
      let thoughtHtml = '';
      
      const tMatch = summary.match(/\[心声\]\s*([^\[]+)/);
      const hMatch = summary.match(/\[历史\]\s*([^\[]+)/);
      
      if (hMatch) actionHtml = `<div class="tl-action">${this._esc(hMatch[1].trim())}</div>`;
      if (tMatch) thoughtHtml = `<div class="tl-thought">" ${this._esc(tMatch[1].trim())} "</div>`;
      
      // Fallback if neither tag is found
      if (!hMatch && !tMatch && summary.trim()) {
        actionHtml = `<div class="tl-action">${this._esc(summary.trim())}</div>`;
      }
      
      return `
        <div class="timeline-node">
          ${e.time ? `<div class="tl-time">${this._esc(e.time)}</div>` : ''}
          ${actionHtml}
          ${thoughtHtml}
        </div>
      `;
    }).join('');
    
    return `
      <div class="npc-section">
        <div class="npc-section-title"><span>羁绊追溯</span><div class="line"></div></div>
        <div class="timeline-wrap">${nodes}</div>
      </div>
    `;
  }

  _renderRel(s){
    const r = stateManager.getSub('_relationships') || {};
    const e=Object.entries(r).sort((a,b) => {
      const p1 = !!a[1]?.pinned;
      const p2 = !!b[1]?.pinned;
      if (p1 !== p2) return p1 ? -1 : 1;
      return (b[1]?.affection||0)-(a[1]?.affection||0);
    });
    return `
      <div class="sec">
        <div class="sec-title">羁绊印记</div>
        <div class="grid-list">
          ${e.length?e.map(([n,d])=>`
            <div class="rel-card-wrap${d.pinned?' rel-pinned':''}" data-rel-name="${escAttr(n)}">
              <div class="rel-actions">
                <button class="rel-action-btn pin-btn ${d.pinned?'pin-active':''}" data-action="pin" data-rel-npc="${escAttr(n)}" title="${d.pinned?'取消置顶':'置顶'}">📌</button>
                <button class="rel-action-btn pin-btn del-hover" data-action="delete" data-rel-npc="${escAttr(n)}" title="删除羁绊">✖</button>
              </div>
              <div class="rel-header">
                <div class="rel-avatar-ring">
                  <div class="rel-avatar">${n[0]}</div>
                </div>
                <div class="rel-info">
                  <div class="rel-info-title">${this._esc(n)}${d.pinned?'<span class="rel-pin-tag">📌</span>':''}</div>
                  <div class="rel-info-sub">
                    ${d.faction ? `<span class="glass-pill" style="padding: 2px 8px; font-size: 9px; background:rgba(198,156,109,0.1); color:var(--c-kin-bright); border-color:rgba(198,156,109,0.2);">${this._esc(d.faction)}</span>` : ''}
                    ${this._esc(d.role || '')}
                  </div>
                </div>
              </div>
              
              <div class="rel-dashboard">
                <div class="dash-stat">
                  <div class="dash-label">好感度</div>
                  <div class="dash-value" style="color:${(d.affection||0)>=0?'var(--c-moegi)':'var(--c-kokihi)'}">${d.affection||0}</div>
                  <div class="dash-bar-bg"><div class="dash-bar-fill" style="width:${Math.min(100, Math.abs(d.affection||0)*2)}%; background:${(d.affection||0)>=0?'var(--c-moegi)':'var(--c-kokihi)'};"></div></div>
                </div>
                <div class="dash-stat">
                  <div class="dash-label">信任度</div>
                  <div class="dash-value">${d.trust||0}</div>
                  <div class="dash-bar-bg"><div class="dash-bar-fill" style="width:${Math.min(100, Math.abs(d.trust||0)*2)}%; background:#42A5F5;"></div></div>
                </div>
                <div class="dash-stat">
                  <div class="dash-label">敬畏度</div>
                  <div class="dash-value">${d.respect||0}</div>
                  <div class="dash-bar-bg"><div class="dash-bar-fill" style="width:${Math.min(100, Math.abs(d.respect||0)*2)}%; background:#c69c6d;"></div></div>
                </div>
              </div>

              <div class="rel-expand-hint">点击查看绝密情报与能力档案 ▾</div>
            </div>`).join(''):'<div class="empty">形单影只<br><em>结印发起遭遇</em>，结识同伴</div>'}
        </div>
      </div>`;
  }

  _track(v){
    return ({balanced:'均衡',ninjutsu:'忍术领域',taijutsu:'体术修行',genjutsu:'幻术造诣',medical:'医疗支援',sensory:'情报感知',command:'指挥调度',infiltration:'潜入暗杀'}[v]) || '未定';
  }

  _esc(value) {
    return escHtml(value);
  }
  _escAttr(value) { return escAttr(value); }

  _renderTimeline(data, title, accentColor) {
    let entries = Array.isArray(data) ? data : (typeof data === 'string' && data.trim() ? [{ turn: 0, time: '', summary: data }] : []);
    // Normalize: if entries are plain strings, wrap them into objects
    entries = entries.map(e => {
      if (typeof e === 'string') return { turn: 0, time: '', summary: e };
      return e;
    }).filter(e => e && (e.summary || '').toString().trim());
    if (!entries.length) return '';
    const html = entries.slice(0, 10).map((e, i) => {
      const isLatest = i === 0;
      const timeStr = e.time ? `<span style="font-size:10px;color:rgba(255,255,255,0.25);margin-right:8px;">${this._esc(e.time)}</span>` : '';
      return `<div style="display:flex;align-items:flex-start;padding:${isLatest ? '10px 0' : '6px 0'};${!isLatest ? 'border-bottom:1px solid rgba(255,255,255,0.03);' : ''}">
        <div style="flex-shrink:0;width:8px;height:8px;border-radius:50%;background:#${accentColor};margin:5px 10px 0 0;opacity:${isLatest ? '1' : '0.4'};${isLatest ? 'box-shadow:0 0 6px #' + accentColor : ''};"></div>
        <div style="flex:1;min-width:0;">
          ${timeStr}
          <span style="font-size:${isLatest ? '13' : '12'}px;color:${isLatest ? '#e8e4d9' : '#a39f98'};line-height:1.6;${isLatest ? 'font-weight:500' : ''};">${this._esc(e.summary)}</span>
        </div>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">${title}</div>
      <div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:8px 16px;border:1px solid rgba(255,255,255,0.04);">${html}</div>
    </div>`;
  }
}

customElements.define('info-panel', InfoPanel);
export default InfoPanel;


