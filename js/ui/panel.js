import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { formatPercentage, escHtml, escAttr } from '../utils/format.js';
import { equipmentSystem } from '../systems/equipment-system.js';

class InfoPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._tab = 'attributes';
    this._renderPending = false;
    this._unsubs = [];
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
    const s = stateManager.get();
    const tab = s.ui_prefs?.panel_tab || this._tab;
    const appEl = document.getElementById('app') || document.body;
    const isMobile = window.matchMedia('(max-width: 768px)').matches || appEl.classList.contains('is-mobile-forced') || appEl.classList.contains('is-mobile-view');
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        .panel {
          display: flex; flex-direction: column; height: 100%; overflow: hidden;
          background: transparent;
          color: var(--text-primary);
          position: relative;
        }

        /* ── Mobile Panel Header ──── */
        .panel-header-mobile {
          display: flex; justify-content: space-between; align-items: center;
          padding: 14px 16px 12px 20px; border-bottom: 1px solid var(--border-hairline);
          background: rgba(255,255,255,0.02);
        }
        .panel-title-mobile {
          font-family: var(--font-title); font-size: 13px; font-weight: 800;
          color: var(--text-primary); letter-spacing: 2px;
        }
        .panel-close-btn-mobile {
          background: transparent; border: none; color: var(--text-secondary);
          font-size: 18px; cursor: pointer; padding: 4px; display: flex;
          align-items: center; justify-content: center; transition: all 0.2s;
          line-height: 1;
        }
        .panel-close-btn-mobile:hover {
          color: var(--text-primary); transform: scale(1.1);
        }

        /* ── 标签页 (Shinobi Tanzaku) ──── */
        .tabs {
          display: flex; gap: 8px; padding: 0 16px;
          border-bottom: 1px solid var(--border-hairline);
          z-index: 5;
        }
        .tab {
          flex: 1; padding: 16px 2px 12px; font-size: 11px; text-align: center; color: var(--text-tertiary);
          cursor: pointer; border: none; background: transparent; border-bottom: 2px solid transparent;
          transition: all 0.2s; letter-spacing: 2px;
          font-family: var(--font-title); margin-bottom: -1px;
        }
        .tab:hover { color: var(--text-secondary); }
        .tab.on { 
          color: var(--text-primary); font-weight: 800; border-bottom-color: var(--text-primary);
        }

        @keyframes content-enter {
          from { opacity: 0; transform: translateY(16px) scale(0.98); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .content { 
          flex: 1; overflow-y: auto; padding: 24px 20px; 
          scrollbar-width: none; -ms-overflow-style: none;
          mask-image: linear-gradient(to bottom, transparent, #000 24px, #000 calc(100% - 24px), transparent);
          -webkit-mask-image: linear-gradient(to bottom, transparent, #000 24px, #000 calc(100% - 24px), transparent);
          animation: content-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .content::-webkit-scrollbar { display: none; }

        /* ── 章节容器 (Scroll Section) ──── */
        .sec {
          margin-bottom: 40px; position: relative;
        }
        
        .sec-title {
          font-size: 10px; font-weight: 800; color: var(--text-tertiary); text-transform: uppercase;
          letter-spacing: 4px; margin-bottom: 24px; font-family: var(--font-title);
          display: flex; align-items: center; gap: 12px;
        }
        .sec-title::after {
          content: ''; flex: 1; height: 1px; 
          background: var(--border-hairline);
        }

        /* ── 数据行 (Shinobi Stats) ──── */
        .row { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--border-hairline); position: relative; }
        .row-l { 
          font-size: 11px; color: var(--text-tertiary); font-family: var(--font-title); 
          letter-spacing: 2px; text-transform: uppercase;
        }
        .row-v {
          font-size: 13px; color: var(--text-primary); font-family: var(--font-body); font-weight: 500; letter-spacing: 1px;
        }

        /* ── 属性面板 (Attribute Bento) ──── */
        .chakra-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; margin-bottom: 8px; }
        .chakra-badge { 
          display: inline-flex; align-items: center; justify-content: center;
          padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 800; letter-spacing: 2px;
          border: 1px solid currentColor; background: rgba(0,0,0,0.2);
          box-shadow: inset 0 0 8px currentColor;
        }

        .attr-bento { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
        .attr-card {
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          border-radius: var(--r-md); padding: 16px; position: relative; overflow: hidden;
          display: flex; flex-direction: column; justify-content: center;
        }
        .attr-card.full-span { grid-column: 1 / -1; }
        .attr-card:hover { background: var(--surface-bento-hover); }
        .attr-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
        .attr-value { font-family: var(--font-title); font-size: 16px; font-weight: 800; color: var(--text-primary); letter-spacing: 1px; }
        
        .attr-id-badge {
          display: flex; justify-content: space-between; align-items: center; flex-direction: row;
          padding: 24px; background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 100%);
          border-left: 2px solid var(--c-kin-bright);
        }
        .attr-id-name { 
          font-family: var(--font-brush); font-size: 32px; color: var(--c-kin-bright); line-height: 1; margin-top: 4px; 
          background: linear-gradient(90deg, var(--c-kin-bright) 0%, #fff 50%, var(--c-kin-bright) 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shine-name 4s linear infinite;
        }
        @keyframes shine-name { to { background-position: 200% center; } }
        
        .attr-id-rank { font-size: 12px; font-weight: 800; letter-spacing: 4px; color: var(--text-secondary); opacity: 0.8; }
        
        .attr-threat { 
          position: absolute; inset: 0; background: radial-gradient(circle at right bottom, var(--threat-color, rgba(255,255,255,0.1)) 0%, transparent 70%); 
          opacity: 0.1; pointer-events: none; 
          animation: pulse-threat-bg 4s ease-in-out infinite alternate;
        }
        @keyframes pulse-threat-bg { from { opacity: 0.1; } to { opacity: 0.25; } }
        
        .attr-threat-val { 
          font-family: var(--font-mono); font-size: 24px; font-weight: 900; color: var(--threat-color, var(--text-primary)); 
          text-shadow: 0 0 16px var(--threat-color, transparent); display: flex; align-items: baseline; gap: 4px; 
          white-space: nowrap;
          animation: pulse-threat 3s ease-in-out infinite alternate;
        }
        @keyframes pulse-threat {
          from { text-shadow: 0 0 8px var(--threat-color, transparent); }
          to { text-shadow: 0 0 24px var(--threat-color, transparent), 0 0 40px var(--threat-color, transparent); transform: scale(1.02) translateX(1%); }
        }
        .attr-bar-wrap { margin-bottom: 16px; }
        .attr-bar-label { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px; color: var(--text-secondary); letter-spacing: 1px; }
        .attr-bar-track { height: 2px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; }
        .attr-bar-fill { height: 100%; box-shadow: 0 0 8px currentColor; transition: width 1s var(--ease-out); }

        /* ── 查克拉条 (Liquid Chakra Bars - Old fallback) ──── */
        .bar-wrap { margin: 12px 0 20px; position: relative; }
        .bar { 
          height: 2px; background: rgba(255,255,255,0.05);
          overflow: hidden; 
        }
        .bar-fill { 
          height: 100%; border-radius: 0; 
          transition: width 1s var(--ease-out); 
        }

        /* ── 技能与装备卡片 (Bento Grid Items) ──── */
        .grid-list { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .item-card {
          padding: 16px; border-radius: var(--r-md);
          box-shadow: var(--shadow-inner); background: var(--surface-bento);
          transition: all 0.3s var(--ease-out); position: relative; overflow: hidden;
        }
        .item-card:hover { 
          background: var(--surface-bento-hover); box-shadow: var(--shadow-inner-hover);
          transform: translateY(-1px);
        }
        /* 法阵边缘装饰 */
        .item-card::before {
          content: ''; position: absolute; top: 0; left: 0; width: 12px; height: 12px;
          border-top: 1.5px solid var(--c-shuiro); border-left: 1.5px solid var(--c-shuiro);
          border-top-left-radius: var(--r-md); opacity: 0; transition: opacity 0.3s; pointer-events: none;
        }
        .item-card:hover::before { opacity: 0.8; }
        .item-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .item-name { font-family: var(--font-title); font-size: 16px; font-weight: 800; color: var(--text-primary); letter-spacing: 1px; }
        .item-tag { font-size: 9px; color: var(--text-secondary); padding: 2px 6px; border: 1px solid var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; }
        .item-desc { font-size: 12px; color: var(--text-tertiary); line-height: 1.6; font-family: var(--font-body); max-width: 90%; }

        /* ── 任务勋章 (Mission Seals) ──── */
        .mission-seal {
          padding: 16px; margin-bottom: 0; display: grid; grid-template-columns: 32px 1fr; gap: 16px; align-items: start;
          box-shadow: var(--shadow-inner); background: var(--surface-bento); border-radius: var(--r-md); transition: all 0.2s;
        }
        .mission-seal:hover { background: var(--surface-bento-hover); box-shadow: var(--shadow-inner-hover); transform: translateY(-1px); }
        .mission-seal .rank-badge {
          font-family: var(--font-title); font-size: 20px; font-weight: 800; opacity: 0.8;
          text-align: center; border-bottom: 2px solid currentColor; padding-bottom: 4px;
        }
        /* ── 技能与天赋 (Skills) ──── */
        .skill-card {
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          border-radius: var(--r-md); padding: 16px; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative; overflow: hidden; border-left: 2px solid var(--border-subtle);
        }
        .skill-card:hover { transform: translateY(-2px); background: var(--surface-bento-hover); border-left-color: var(--text-primary); }
        .skill-card.bloodline {
          text-align: center; border-left: none; padding: 24px;
          background: radial-gradient(circle at center, rgba(239,83,80,0.1) 0%, var(--surface-bento) 100%);
          box-shadow: inset 0 0 0 1px rgba(239,83,80,0.2), var(--shadow-inner);
        }
        .skill-card.bloodline.normal { background: var(--surface-bento); box-shadow: var(--shadow-inner); }
        .skill-title { font-family: var(--font-title); font-size: 16px; font-weight: 800; letter-spacing: 1px; color: var(--text-primary); }
        .bloodline .skill-title { font-size: 20px; color: #ef5350; text-shadow: 0 0 10px rgba(239,83,80,0.5); letter-spacing: 4px; }
        .bloodline.normal .skill-title { color: var(--text-secondary); text-shadow: none; letter-spacing: 2px; }
        
        .skill-mastery-tag {
          font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; letter-spacing: 1px;
          background: rgba(198,156,109,0.1); color: var(--c-kin-bright); border: 1px solid rgba(198,156,109,0.3);
        }
        
        .skill-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; padding: 32px 16px; min-height: 100px;
          background: rgba(0,0,0,0.2); border-radius: var(--r-md); box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
          color: var(--text-tertiary); font-size: 11px; letter-spacing: 1px;
        }
        .skill-empty svg { width: 32px; height: 32px; opacity: 0.15; color: var(--text-primary); }
        .skill-empty em { font-style: normal; color: var(--text-secondary); font-weight: bold; }

        .mission-seal { border-left: 4px solid var(--border-subtle); padding-left: 12px; }
        .mission-seal.S .rank-badge { color: #ef5350; }
        .mission-seal.A .rank-badge { color: #eb613f; }
        .mission-seal.B .rank-badge { color: #c69c6d; }
        .mission-seal.C .rank-badge { color: #42A5F5; }
        .mission-seal.D .rank-badge { color: #81c784; }

        /* ── 关系印记 (Fate Link) ──── */
        .rel-card-wrap {
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          border-radius: var(--r-md); padding: 16px; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative; overflow: hidden; cursor: pointer;
        }
        .rel-card-wrap:hover { transform: translateY(-2px); background: var(--surface-bento-hover); }
        .rel-expand-hint { text-align: center; font-size: 10px; color: var(--text-tertiary); margin-top: 12px; opacity: 0.5; transition: opacity 0.2s; }
        .rel-card-wrap:hover .rel-expand-hint { opacity: 0.8; }
        
        .rel-header {
          display: flex; gap: 16px; align-items: center; margin-bottom: 16px;
        }
        
        /* Hexagon Avatar */
        .rel-avatar-ring {
          position: relative; width: 56px; height: 56px;
          display: flex; align-items: center; justify-content: center;
          filter: drop-shadow(0 0 8px rgba(198,156,109,0.2));
        }
        .rel-avatar-ring::before {
          content: ''; position: absolute; inset: 0;
          background: conic-gradient(from 0deg, transparent, rgba(198,156,109,0.8), transparent);
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
          padding: 1px; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
          animation: spin 6s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .rel-avatar {
          width: 50px; height: 50px; background: var(--surface-0);
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-brush); color: var(--c-kin-bright); font-size: 24px; font-weight: bold;
        }
        
        .rel-info { min-width: 0; flex: 1; }
        .rel-info-title { font-size: 16px; font-family: var(--font-title); font-weight: 800; color: var(--text-primary); letter-spacing: 1px; }
        .rel-info-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; display: flex; gap: 8px; align-items: center; }
        
        /* Dashboard Stats */
        .rel-dashboard {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
          background: rgba(0,0,0,0.2); padding: 12px; border-radius: var(--r-sm);
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.02);
        }
        .dash-stat { display: flex; flex-direction: column; gap: 6px; }
        .dash-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 1px; }
        .dash-value { font-size: 16px; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary); display: flex; align-items: baseline; gap: 4px; }
        .dash-bar-bg { height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
        .dash-bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease-out; }
        
        /* Glass Pill Tags */
        .rel-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
        .glass-pill {
          padding: 4px 10px; font-size: 10px; font-weight: 600; letter-spacing: 1px;
          background: rgba(255,255,255,0.05); color: var(--text-secondary);
          border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
          backdrop-filter: blur(4px); display: inline-flex; align-items: center;
        }

        .tag {
          display: inline-block; padding: 2px 0; font-size: 10px; border-radius: 0; border-bottom: 1px solid var(--border-subtle);
          background: transparent; color: var(--text-secondary);
          font-family: var(--font-title); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-right: 8px;
        }
        .gold { color: var(--c-kin-bright); }
        .empty { padding: 40px 20px; text-align: center; color: var(--text-tertiary); font-family: var(--font-body); font-size: 12px; line-height: 1.8; opacity: 0.8; }
        .empty em { font-style: normal; color: var(--text-primary); font-family: var(--font-title); }

        /* ── 装备栏阶梯视觉系统 ──── */
        .eq-svg { width: 1.2em; height: 1.2em; display: inline-block; vertical-align: middle; }
        
        .eq-empty-slot {
          background: rgba(0, 0, 0, 0.4);
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.02);
          border-radius: var(--r-md); padding: 12px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 8px; min-height: 80px; transition: all 0.2s;
        }
        .eq-empty-slot svg {
          width: 28px; height: 28px; opacity: 0.15; color: var(--text-primary);
        }
        .eq-empty-slot span { font-size: 10px; color: var(--text-tertiary); letter-spacing: 2px; opacity: 0.5; }
        
        .eq-card {
          padding: 12px; border-radius: var(--r-md); position: relative; overflow: hidden;
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .eq-card:hover { transform: translateY(-2px); }
        
        /* 阶梯化品质特质 */
        /* 普通: --surface-bento 默认无光效 */
        /* 精良 */
        .eq-card[data-quality="精良"] { border-left: 2px solid #66BB6A; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), -4px 0 15px -2px rgba(102,187,106,0.15); }
        /* 优秀 */
        .eq-card[data-quality="优秀"] { border-left: 2px solid #42A5F5; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), -4px 0 15px -2px rgba(66,165,245,0.2); }
        /* 史诗 */
        .eq-card[data-quality="史诗"] { 
          border-left: 2px solid #c69c6d;
          background: radial-gradient(circle at right bottom, rgba(198,156,109,0.1) 0%, var(--surface-bento) 70%);
          box-shadow: inset 0 0 0 1px rgba(198,156,109,0.2), -4px 0 20px -2px rgba(198,156,109,0.25);
        }
        /* 传说 */
        @keyframes legendaryPulse { 0% { box-shadow: inset 0 0 0 1px rgba(239,83,80,0.3), 0 0 15px rgba(239,83,80,0.2); } 50% { box-shadow: inset 0 0 0 1px rgba(239,83,80,0.5), 0 0 25px rgba(239,83,80,0.4); } 100% { box-shadow: inset 0 0 0 1px rgba(239,83,80,0.3), 0 0 15px rgba(239,83,80,0.2); } }
        .eq-card[data-quality="传说"] {
          border-left: 2px solid #ef5350;
          background: radial-gradient(circle at right bottom, rgba(239,83,80,0.15) 0%, rgba(14,18,24,0.9) 80%);
          animation: legendaryPulse 3s infinite;
        }
        
        .eq-watermark {
          position: absolute; right: -10%; bottom: -20%; font-family: var(--font-brush);
          font-size: 64px; color: currentColor; opacity: 0.04; pointer-events: none;
          transform: rotate(-15deg); font-weight: 900;
        }
        .eq-card[data-quality="史诗"] .eq-watermark { opacity: 0.08; color: #c69c6d; }
        .eq-card[data-quality="传说"] .eq-watermark { opacity: 0.12; color: #ef5350; font-size: 80px; }
        
        .btn-sleek {
          background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle);
          color: var(--text-secondary); border-radius: var(--r-md);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s; font-size: 11px; font-weight: 700;
        }
        .btn-sleek:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); border-color: rgba(255,255,255,0.2); }
        .btn-sleek.active { background: rgba(255,255,255,0.1); border-color: var(--text-primary); color: var(--c-void); background: var(--text-primary); }
      </style>
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
    const closeBtn = this.shadowRoot.getElementById('panel-close-btn-mobile');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('panel:close', { bubbles: true, composed: true }));
      });
    }

    this.shadowRoot.querySelectorAll('.tab').forEach(t=>{
      t.addEventListener('click',()=>{
        this._tab=t.dataset.t;
        stateManager.update([{path:'ui_prefs.panel_tab',op:'set',value:this._tab}]);
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
            const eq = stateManager.get('equipment.equipped') || {};
            slot = !eq.accessory1 ? 'accessory1' : (!eq.accessory2 ? 'accessory2' : 'accessory1');
          }
          if (slot) { equipmentSystem.equip(slot, name, cat); this.render(); }
        });
      });
      this.shadowRoot.querySelectorAll('.eq-unequip-btn').forEach(b => {
        b.addEventListener('click', () => {
          let slot = b.dataset.slot;
          if (!slot && b.dataset.name) {
             const eq = stateManager.get('equipment.equipped') || {};
             for (const [k, v] of Object.entries(eq)) {
               if (v && v.name === b.dataset.name) slot = k;
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
    const a=s.attributes, p=s.player, pg=s.progression;
    const threat = this._calcThreat(s);
    const tl = threat.label.split(' ');
    const tNum = tl.length > 1 ? tl[1] : '';
    const tTxt = tl[0];
    
    return `
      <div class="sec">
        <div class="sec-title">绝密卷宗 (Dossier)</div>
        <div class="attr-bento">
          <div class="attr-card full-span attr-id-badge">
            <div>
              <div class="attr-label">代号 / 姓名</div>
              <div class="attr-id-name">${this._esc(p.name||'忍者')}</div>
            </div>
            <div style="text-align:right;">
              <div class="attr-label">荣誉忍阶</div>
              <div class="attr-id-rank">${this._esc(p.rank)}</div>
            </div>
          </div>
          
          <div class="attr-card" style="--threat-color: ${threat.color};">
            <div class="attr-threat"></div>
            <div class="attr-label">综合危险度</div>
            <div class="attr-threat-val">${tTxt} <span style="font-size:12px;opacity:0.6;font-family:var(--font-body); font-weight:normal;">${tNum}</span></div>
          </div>
          
          <div class="attr-card">
            <div class="attr-label">查克拉属性 / 出身</div>
            ${this._renderChakra(p.chakra_nature)}
            <div style="font-size:10px; color:var(--text-tertiary); margin-top:auto;">${this._esc(p.background||'流浪')}</div>
          </div>
        </div>
      </div>
      
      <div class="sec">
        <div class="sec-title">能量与潜能 (Vitals)</div>
        <div class="attr-bento">
          <div class="attr-card full-span" style="padding: 24px;">
            ${this._newBar('查克拉',a.chakra_current,a.chakra,'#42A5F5')}
            ${this._newBar('生命力',a.stamina_current,a.stamina,'#66BB6A')}
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px;">
              ${this._newBar('精神力',a.spirit_current,a.spirit,'#CE93D8')}
              ${this._newBar('意志力',a.willpower_current,a.willpower,'#eb613f')}
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
              <div class="attr-value" style="color:var(--c-kin-bright); font-family:var(--font-mono);">${pg.exp} <span style="font-size:10px;color:var(--text-tertiary);">/ ${pg.exp_to_next}</span></div>
            </div>
            <div>
              <div class="attr-label">晋升路线</div>
              <div class="attr-value" style="font-size:12px;">${this._track(pg.promotion?.track)}</div>
            </div>
            <div>
              <div class="attr-label">当前资金</div>
              <div class="attr-value" style="color:var(--c-kin-bright); font-family:var(--font-mono); display:flex; align-items:center; gap:6px;">
                ${this._svg('coin', 14, 14)}
                ${s.equipment.ryo||0}
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
    const a = s.attributes || {}, sk = s.skills || {};
    const best = g => Math.max(0, ...Object.values(g || {}).map(x => Number(x?.mastery) || 0));
    
    const nin = Math.round((a.chakra || 0) * 0.45 + (a.spirit || 0) * 0.25 + best(sk.jutsu) * 0.7);
    const tai = Math.round((a.stamina || 0) * 0.25 + (a.speed || 0) * 0.9 + (a.willpower || 0) * 0.2 + best(sk.taijutsu) * 0.9);
    const gen = Math.round((a.spirit || 0) * 0.75 + (a.chakra || 0) * 0.2 + best(sk.genjutsu) * 0.9);
    const def = Math.round((a.stamina || 0) * 0.18 + (a.willpower || 0) * 0.25);
    
    // 派生战力要大幅衰减（x0.35），防止 mastery 虚高导致评分膨胀
    const total = Math.round((nin + tai + gen + def) * 0.35 + (a.speed || 0) * 0.4 + (a.luck || 0) * 0.3);
    
    // 峰值只看"原始属性"，不看派生值，防止 AI 随机给高 mastery 就虚高评级
    const peak = Math.max(a.chakra || 0, a.stamina || 0, a.spirit || 0, a.willpower || 0, a.speed || 0);

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
    const a=s.attributes||{}, sk=s.skills||{};
    const best=g=>Math.max(0,...Object.values(g||{}).map(x=>Number(x?.mastery)||0));
    const nin=Math.round((a.chakra||0)*0.45+(a.spirit||0)*0.25+best(sk.jutsu)*0.7);
    const tai=Math.round((a.stamina||0)*0.25+(a.speed||0)*0.9+(a.willpower||0)*0.2+best(sk.taijutsu)*0.9);
    const gen=Math.round((a.spirit||0)*0.75+(a.chakra||0)*0.2+best(sk.genjutsu)*0.9);
    const def=Math.round((a.stamina||0)*0.18+(a.willpower||0)*0.25);
    
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

  _renderSkills(s){
    const sk=s.skills, ju=sk?.jutsu||{}, tai=sk?.taijutsu||{}, gen=sk?.genjutsu||{}, support=sk?.support||{}, talents=sk?.talents||{};
    let kgText = '普通血脉';
    if (sk?.kekkei_genkai) {
      if (typeof sk.kekkei_genkai === 'string') kgText = sk.kekkei_genkai;
      else if (Array.isArray(sk.kekkei_genkai)) kgText = sk.kekkei_genkai.map(k => typeof k === 'string' ? k : (k.name || '')).filter(Boolean).join('、') || '普通血脉';
      else if (typeof sk.kekkei_genkai === 'object') kgText = sk.kekkei_genkai.name || Object.keys(sk.kekkei_genkai).join('、') || '普通血脉';
    }
    const isNormalBloodline = kgText === '普通血脉';
    
    return `
      <div class="sec">
        <div class="sec-title">血继限界</div>
        <div class="skill-card bloodline ${isNormalBloodline ? 'normal' : ''}">
          <div class="skill-title">${this._esc(kgText)}</div>
        </div>
      </div>
      <div class="sec">
        <div class="sec-title">特殊天赋</div>
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
      </div>
      ${this._skillSection('秘传忍术', ju, 'element', 'jutsu')}
      ${this._skillSection('体术造诣', tai, null, 'taijutsu')}
      ${this._skillSection('幻术解析', gen, null, 'genjutsu')}
      ${this._skillSection('辅助技能', support, null, 'support')}`;
  }

  _skillSection(title, skills, metaKey, type) {
    const list = Object.entries(skills);
    const getThemeColor = (t) => {
      if(t==='jutsu') return '#42A5F5';
      if(t==='taijutsu') return '#66BB6A';
      if(t==='genjutsu') return '#CE93D8';
      return 'var(--text-primary)';
    };
    const color = getThemeColor(type);
    
    return `
      <div class="sec">
        <div class="sec-title">${title}</div>
        <div class="grid-list">
          ${list.length?list.map(([n,d])=>`
            <div class="skill-card" style="border-left-color: ${color};">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                <div class="skill-title">${this._esc(n)}</div>
                <div class="skill-mastery-tag">${this._mt(d?.mastery||0)}</div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid var(--border-subtle); padding-top: 8px;">
                <div style="font-size:10px; color:var(--text-tertiary); display:flex; gap:8px;">
                  ${d[metaKey] ? `<span style="color:${color}; font-weight:bold;">${this._esc(d[metaKey])}</span>` : ''}
                  <span>${this._esc(d.rank||'E')} 级</span>
                </div>
                <div style="font-size:10px; color:var(--text-secondary); font-family:var(--font-mono);">造诣 ${d.mastery||0}</div>
              </div>
            </div>`).join(''):`
            <div class="skill-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="14" height="18" x="5" y="3" rx="2"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/></svg>
              <span>尚未习得任何术，<em>修行或拜师</em> 方能掌握</span>
            </div>`}
        </div>
      </div>`;
  }

  _mt(v){ return v>=100?'极意':v>=80?'精纯':v>=60?'老练':v>=40?'熟稔':v>=20?'初成':'入门'; }

  _renderEq(s){
    const e=s.equipment;
    const equipped = e.equipped || {};
    const bonus = this._equipBonusSummary(e);
    return `
      <div class="sec" style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="sec-title" style="margin:0;">忍具与行囊</div>
          <div class="gold" style="font-size:13px; font-weight:bold; letter-spacing:1px; background:rgba(198,156,109,0.1); padding:4px 10px; border-radius:12px; border:1px solid rgba(198,156,109,0.3); display:flex; align-items:center; gap:6px;">
            ${this._svg('coin')} ${e.ryo||0} 两
          </div>
        </div>
      </div>
      ${this._eqSlots(equipped, bonus)}
      <div style="margin-top: 24px;">
        ${this._eqSection('兵器', e.weapons, 'weapons', equipped, 'weapon')}
        ${this._eqSection('防具', e.armor||{}, 'armor', equipped, 'armor')}
        ${this._eqSection('刃具', e.tools, 'tools', equipped, 'tools')}
        ${this._eqSection('物资', e.consumables, 'consumables', equipped, 'consumable')}
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
      const catItems = equipment[entry.category];
      let item = null;
      if (Array.isArray(catItems)) {
        item = (catItems || []).find(i => i.name === entry.name);
      } else {
        item = (catItems || {})[entry.name];
      }
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
        const catItems = stateManager.get(`equipment.${entry.category}`);
        let item = null;
        if (Array.isArray(catItems)) {
          item = catItems.find(i => i.name === entry.name);
        } else if (catItems) {
          item = catItems[entry.name];
        }
        const q = (item && item.quality) || '普通';
        const qColor = this._getQualityColor(q);
        const wmark = q === '传说' ? '極' : q === '史诗' ? '稀' : '';
        html += `<div class="eq-card" data-quality="${q}" data-slot="${slot.key}" style="display:flex; justify-content:space-between; align-items:center;">
          <div class="eq-watermark">${wmark}</div>
          <div style="display:flex; flex-direction:column; gap:6px; position:relative; z-index:2;">
            <span style="font-size:10px; color:var(--text-tertiary); letter-spacing:1px; display:flex; align-items:center; gap:4px;">${this._svg(slot.type)} ${slot.label}</span>
            <span style="font-size:14px; font-weight:800; color:var(--text-primary); letter-spacing:1px; font-family:var(--font-title);">${this._esc(entry.name)}</span>
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
            const isEquipped = Object.values(equipped).some(e => e && e.name === n);
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
                    <span>持有: ${i.quantity||1}</span>
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
    const m=s.missions;
    return `
      <div class="sec">
        <div class="sec-title">悬赏令 (进行中)</div>
        ${(m?.active||[]).length?m.active.map(x=>`
          <div class="item-card mission-seal ${x.rank||'D'}">
            <div class="rank-badge">${x.rank||'D'}</div>
            <div>
              <div class="item-header" style="margin-bottom: 4px;">
                <div class="item-name">${this._esc(x.title)}</div>
              </div>
              <div class="item-desc" style="color:var(--text-secondary);">${this._esc(x.objective)}</div>
              <div class="rel-stats" style="margin-top:12px; border-top: none; padding-top: 0;">
                <span class="tag">${this._esc(x.location)}</span>
                <span class="tag" style="color:var(--text-primary); border-bottom-color:var(--text-primary);">风险 // ${this._esc(x.risk)}</span>
              </div>
            </div>
          </div>`).join(''):'<div class="empty">尚无委托送达<br><em>前往忍者学校</em>，或可接取任务</div>'}
      </div>
      <div class="sec">
        <div class="sec-title">完成记录</div>
        ${(m?.completed||[]).slice(-3).reverse().map(x=>`
          <div class="row" style="opacity:0.5; padding: 8px 0;">
            <span class="row-l" style="font-size:12px; text-transform:none; letter-spacing:0;">${this._esc(x.title)}</span>
            <span class="row-v" style="font-size:10px;">${x.rank}</span>
          </div>`).join('')}
      </div>`;
  }

  showRelModal(name) {
    const s = stateManager.get();
    const r = s.relationships || {};
    const d = r[name];
    if (!d) return;

    const Modal = customElements.get('game-modal');
    if (!Modal) return;
    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);

    const coreKeys = ['affection','trust','respect','info','history','inner_thoughts','role','faction','status','tags','known_secrets','promises','debts', 'last_interaction', 'last_interaction_at'];
    let extraStatsHtml = '';
    let extraSkillsHtml = '';
    
    Object.entries(d).forEach(([k,v]) => {
      if (coreKeys.includes(k)) return;
      const lbl = ({'chakra':'查克拉','strength':'综合实力','speed':'速度','ninjutsu':'忍术','taijutsu':'体术','genjutsu':'幻术','luck':'运气'})[k.toLowerCase()] || k;
      
      if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)))) {
        const numV = Number(v);
        extraStatsHtml += `
          <div style="background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);">
            <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 6px; letter-spacing: 0.5px;">${lbl}</div>
            <div style="font-size: 18px; font-weight: 600; color: #A5D6A7; font-family: 'JetBrains Mono', monospace; text-shadow: 0 2px 8px rgba(165,214,167,0.2);">${numV}</div>
            <div style="position: absolute; bottom: 0; left: 0; height: 2px; width: ${Math.min(100, Math.max(0, numV))}%; background: linear-gradient(90deg, transparent, #A5D6A7);"></div>
          </div>
        `;
      } else {
        const valStr = Array.isArray(v) ? v.join(', ') : String(v);
        extraSkillsHtml += `
          <div style="margin-bottom: 8px; display: flex; align-items: flex-start; gap: 12px; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.03);">
            <span style="color: rgba(255,255,255,0.3); font-size: 11px; min-width: 50px; padding-top: 3px; text-transform: uppercase; letter-spacing: 0.5px;">${lbl}</span>
            <span style="color: #d1d0c5; font-size: 13px; line-height: 1.5; flex: 1;">${this._esc(valStr)}</span>
          </div>
        `;
      }
    });

    let tagsHtml = '';
    if ((d.tags || []).length) {
      tagsHtml = `<div style="margin-top:20px; display:flex; gap:8px; flex-wrap:wrap;">
        ${d.tags.map(t=>`<span style="background:rgba(235,97,63,0.08); border:1px solid rgba(235,97,63,0.2); color:#eb613f; padding:4px 12px; border-radius:100px; font-size:11px; font-weight: 500; box-shadow: 0 2px 8px rgba(235,97,63,0.1);">${this._esc(t)}</span>`).join('')}
      </div>`;
    }

    const html = `
      <div style="display:flex; gap:20px; align-items:center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.06); position: relative;">
        <div style="width:64px; height:64px; background:linear-gradient(135deg, rgba(235,97,63,0.2), rgba(198,156,109,0.1)); border:1px solid rgba(235,97,63,0.4); border-radius:50%; display:flex; align-items:center; justify-content:center; color:#eb613f; font-size:32px; font-weight:700; box-shadow: 0 0 20px rgba(235,97,63,0.15), inset 0 2px 10px rgba(255,255,255,0.1); text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${name[0]}</div>
        <div>
          <div style="font-size:20px; font-weight:700; color:#fff; margin-bottom:8px; letter-spacing:1px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${this._esc(name)}</div>
          <div style="font-size:12px; color:rgba(255,255,255,0.6); display: flex; align-items: center; gap: 8px;">
            <span style="background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.8); padding:3px 8px; border-radius:4px; border: 1px solid rgba(255,255,255,0.1);">${this._esc(d.faction||'未知阵营')}</span>
            <span>${this._esc(d.role||'未知身份')}</span>
          </div>
        </div>
        <div style="position: absolute; right: 0; top: 0; width: 100px; height: 100px; background: radial-gradient(circle, rgba(235,97,63,0.1) 0%, transparent 70%); pointer-events: none;"></div>
      </div>
      
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom:24px;">
        <div style="background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); padding:16px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); text-align:center; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
          <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-bottom:6px; letter-spacing: 0.5px;">好感度</div>
          <div style="font-size:20px; font-weight:700; color:${(d.affection||0)>=0?'#81C784':'#ef5350'}; text-shadow: 0 2px 8px ${(d.affection||0)>=0?'rgba(129,199,132,0.2)':'rgba(239,83,80,0.2)'};">${d.affection||0}</div>
        </div>
        <div style="background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); padding:16px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); text-align:center; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
          <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-bottom:6px; letter-spacing: 0.5px;">信任度</div>
          <div style="font-size:20px; font-weight:700; color:#42A5F5; text-shadow: 0 2px 8px rgba(66,165,245,0.2);">${d.trust||0}</div>
        </div>
        <div style="background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); padding:16px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); text-align:center; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
          <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-bottom:6px; letter-spacing: 0.5px;">敬畏度</div>
          <div style="font-size:20px; font-weight:700; color:#c69c6d; text-shadow: 0 2px 8px rgba(198,156,109,0.2);">${d.respect||0}</div>
        </div>
      </div>

      ${(extraStatsHtml || extraSkillsHtml) ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:11px; font-weight:700; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px;">能力与忍术档案</div>
        ${extraStatsHtml ? `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap:10px; margin-bottom: 12px;">${extraStatsHtml}</div>` : ''}
        ${extraSkillsHtml ? `<div>${extraSkillsHtml}</div>` : ''}
      </div>` : ''}

      ${d.inner_thoughts ? `
      <div style="margin-bottom:24px;">
        <div style="font-size:11px; font-weight:700; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px;">实时心理剖析</div>
        <div style="padding: 16px; background: linear-gradient(90deg, rgba(198,156,109,0.08), transparent); border-left: 3px solid #c69c6d; font-size: 13px; color: #d4b48f; font-style: italic; line-height: 1.7; border-radius: 0 8px 8px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          「${this._esc(d.inner_thoughts)}」
        </div>
      </div>` : ''}
      
      ${d.history ? `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px; font-weight:700; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px;">羁绊历史记录</div>
        <div style="font-size:13px; color:#a39f98; line-height:1.7; background: rgba(0,0,0,0.3); padding:16px; border-radius:8px; border: 1px solid rgba(255,255,255,0.04); box-shadow: inset 0 2px 10px rgba(0,0,0,0.2);">
          ${this._esc(d.history)}
        </div>
      </div>` : ''}
      
      ${tagsHtml}
    `;

    modal.show({
      title: '绝密情报卷轴',
      content: html,
      buttons: [{ label: '关闭卷轴', primary: true, onClick: () => modal.close() }]
    });
  }

  _renderRel(s){
    const r=s.relationships||{}, e=Object.entries(r).sort((a,b)=>(b[1]?.affection||0)-(a[1]?.affection||0));
    return `
      <div class="sec">
        <div class="sec-title">羁绊印记</div>
        <div class="grid-list">
          ${e.length?e.map(([n,d])=>`
            <div class="rel-card-wrap" data-rel-name="${escAttr(n)}">
              <div class="rel-header">
                <div class="rel-avatar-ring">
                  <div class="rel-avatar">${n[0]}</div>
                </div>
                <div class="rel-info">
                  <div class="rel-info-title">${this._esc(n)}</div>
                  <div class="rel-info-sub">
                    <span class="glass-pill" style="padding: 2px 8px; font-size: 9px; background:rgba(198,156,109,0.1); color:var(--c-kin-bright); border-color:rgba(198,156,109,0.2);">${this._esc(d.faction)}</span>
                    ${this._esc(d.role)}
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
}

customElements.define('info-panel', InfoPanel);
export default InfoPanel;
