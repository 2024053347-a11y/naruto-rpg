import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { icon } from '../utils/icons.js';
import { escHtml } from '../utils/format.js';
import { combatStyles } from '../../css/components/combat-arena.css.js';

class CombatArena extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._renderPending = false;
    this._unsubs = [];
  }

  connectedCallback() {
    this.render();
    this._unsubs = [
      eventBus.on('state:changed', ({ key }) => {
        if (key?.startsWith('_combat')) this._scheduleRender();
      })
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
    const combat = stateManager.getSub('_combat');
    if (!combat?.is_active) { this.shadowRoot.innerHTML = ''; this._prev = null; return; }

    const s = stateManager.get();
    const pcp = s['属性·生命力']>0?Math.round((s['属性·当前生命力']/s['属性·生命力'])*100):0;
    const ecp = combat.enemy_vitality_max>0?Math.round((combat.enemy_vitality/combat.enemy_vitality_max)*100):50;

    // 比对上一次渲染的血量：下降则触发受击闪白；≤25% 加低血脉冲
    const prev = this._prev || {};
    const pHit = prev.pcp != null && pcp < prev.pcp;
    const eHit = prev.ecp != null && ecp < prev.ecp;
    this._prev = { pcp, ecp };
    const pCls = `hp-fill p${pHit ? ' hit' : ''}${pcp <= 25 ? ' low' : ''}`;
    const eCls = `hp-fill e${eHit ? ' hit' : ''}${ecp <= 25 ? ' low' : ''}`;

    this.shadowRoot.innerHTML = `
      <style>${combatStyles}</style>
      <div class="scene">
        <div class="title">${icon('combat', 14)} 第 ${combat.turn||1} 回合</div>
        <div class="ct">
          <div class="name">${this._esc(s['玩家·姓名']||'你')}</div>
          <div class="sub">${this._esc(s['玩家·忍阶'])} · 生命 ${s['属性·当前生命力']}/${s['属性·生命力']} · 查 ${s['属性·当前查克拉']} · 体 ${s['属性·当前体力']} · 精 ${s['属性·当前精神力']}</div>
          <div class="hp-bar"><div class="${pCls}" style="width:${pcp}%"></div></div>
        </div>
        <div class="vs">VS</div>
        <div class="ct">
          <div class="name">${this._esc(combat.enemy_name)}</div>
          <div class="sub">${this._esc(combat.enemy_rank)} · 生命 ${combat.enemy_vitality}/${combat.enemy_vitality_max} · 查 ${combat.enemy_chakra} · 体 ${combat.enemy_stamina} · 精 ${combat.enemy_spirit}</div>
          <div class="hp-bar"><div class="${eCls}" style="width:${ecp}%"></div></div>
        </div>
        <div class="actions">
          <button class="btn act" data-a="体术攻击">${icon('taijutsu', 12)} 体术</button>
          <button class="btn act" data-a="忍术攻击">${icon('ninjutsu', 12)} 忍术</button>
          <button class="btn act" data-a="使用道具">${icon('tool', 12)} 道具</button>
          <button class="btn act" data-a="防御">${icon('defense', 12)} 防御</button>
          <button class="btn d act" data-a="撤退">${icon('retreat', 12)} 撤退</button>
        </div>
        ${(combat.log||[]).slice(-3).map(e=>`<div class="log">T${Number(e.turn)||0}: ${e.actor==='player'?'你':this._esc(combat.enemy_name)} ${this._esc(e.action_name||e.action_type)} → ${this._esc(e.result||'')}</div>`).join('')}
      </div>
    `;

    this.shadowRoot.querySelectorAll('.act').forEach(b=>{
      b.disabled = this.hasAttribute('data-disabled');
      b.addEventListener('click',()=> {
        if (this.hasAttribute('data-disabled')) return;
        this.setAttribute('data-disabled', '');
        this.shadowRoot.querySelectorAll('.act').forEach(btn => { btn.disabled = true; });
        eventBus.emit('combat:player-action',{action:b.dataset.a});
      });
    });
  }

  setActionDisabled(disabled) {
    this.shadowRoot?.querySelectorAll('.act').forEach(btn => {
      btn.disabled = disabled;
    });
  }

  _esc(value) {
    return escHtml(value);
  }
}

customElements.define('combat-arena', CombatArena);
export default CombatArena;


