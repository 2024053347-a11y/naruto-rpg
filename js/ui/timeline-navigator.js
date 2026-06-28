import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { truncate, escHtml } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import { timelineStyles } from '../../css/components/timeline-navigator.css.js';

class TimelineNavigator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._selectedId = null;
    this._unsubs = [];
    this._tlStyle = '';
  }

  connectedCallback() {
    this._load();
    this._unsubs = [
      eventBus.on('timeline:node-created', () => this._load(true)),
      eventBus.on('timeline:branch-created', () => this._load()),
      eventBus.on('timeline:branch-switched', () => this._load()),
      eventBus.on('timeline:jumped', () => this._load()),
      eventBus.on('timeline:branch-promoted', () => this._load()),
      eventBus.on('timeline:branch-deleted', () => this._load()),
      eventBus.on('timeline:imported', () => this._load(true)),
      eventBus.on('state:restored', () => this._load())
    ];
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn?.());
    this._unsubs = [];
  }

  async _load(scrollToEnd = false) {
    try {
      this._nodes = await stateManager.dbGetAll('timeline_nodes') || [];
      this._branches = await stateManager.dbGetAll('timeline_branches') || [];
    } catch { this._nodes = []; this._branches = []; }
    if (scrollToEnd) {
      const curId = stateManager.get('_meta.current_node_id');
      this._selectedId = curId;
    }
    this._render();
    if (scrollToEnd) {
      requestAnimationFrame(() => {
        const list = this.shadowRoot?.querySelector('.tl');
        if (list) list.scrollTop = list.scrollHeight;
      });
    }
  }

  _render() {
    const curId = stateManager.get('_meta.current_node_id');
    const activeBranchId = stateManager.get('_meta.active_branch') || 'branch_main';
    const activeBranch = this._branches.find(b => b.id === activeBranchId);
    const branchHeadId = activeBranch?.head_node_id || curId;
    const nodes = [...this._nodes].sort((a,b)=>(a.turn_number||0)-(b.turn_number||0));
    const branchMain = nodes.filter(n=>n.branch_id==='branch_main');
    const altBranches = this._branches.filter(b=>b.id!=='branch_main');
    const altNodes = nodes.filter(n=>n.branch_id!=='branch_main');
    const selected = nodes.find(n => n.id === (this._selectedId));

    const tl = this.shadowRoot?.querySelector('.tl');
    const savedScrollTop = tl ? tl.scrollTop : 0;

    this.shadowRoot.innerHTML = `
      <style>${timelineStyles}</style>
      <div class="tl" ${this._tlStyle ? `style="${this._tlStyle}"` : ''}>
        <div class="tl-title">时之卷</div>
        ${branchMain.length>0?`
          <div class="branch">主线编年</div>
          <div class="list">${branchMain.slice(-80).map(n=>`
            <div class="node${n.id===branchHeadId?' cur':''}${n.id===this._selectedId?' sel':''}" data-id="${n.id}">
              <div class="node-chapter">第 ${n.turn_number} 回</div>
              <div class="node-summary">${this._esc(n.summary||n.player_input||'尚无记载')}</div>
              ${this._selectedId === n.id ? `
                <div class="node-details">
                  <div class="node-full-summary">${this._esc(n.summary || n.player_input || '这段记忆已经模糊不清...')}</div>
                  <div class="node-actions">
                    ${n.id !== branchHeadId ? `<button class="jump-btn" data-id="${n.id}">逆转时间至此</button>` : `<div class="cur-text">此乃当下此时</div>`}
                    <button class="reroll-btn" data-id="${n.id}">快速重Roll</button>
                  </div>
                </div>
              ` : ''}
            </div>`).join('')}</div>
        `:'<div class="empty"><div class="empty-icon">結</div><div class="empty-title">卷轴虚位以待</div><div class="empty-desc">尚未落笔<br><em>结印写下决断</em>，开启你的忍道</div></div>'}
        ${altBranches.map(b=>{
          const bn = altNodes.filter(n=>n.branch_id===b.id);
          return `
            <div class="branch" style="color:${b.color}; border-left-color:${b.color}">异世分支·${this._esc(b.name)}</div>
            <div class="list">${bn.slice(-30).map(n=>`
              <div class="node${n.id===branchHeadId?' cur':''}${n.id===this._selectedId?' sel':''}" data-id="${n.id}">
                <div class="node-chapter" style="color:${b.color}">第 ${n.turn_number} 回</div>
                <div class="node-summary">${this._esc(n.summary||n.player_input||'尚无记载')}</div>
                ${this._selectedId === n.id ? `
                  <div class="node-details">
                  <div class="node-full-summary">${this._esc(n.clean_response || n.ai_response_summary || n.summary || '这段记忆已经模糊不清...')}</div>
                  <div class="node-actions">
                    ${n.id !== branchHeadId ? `<button class="jump-btn" data-id="${n.id}">逆转时间至此</button>` : `<div class="cur-text">此乃当下此时</div>`}
                    <button class="reroll-btn" data-id="${n.id}">快速重Roll</button>
                  </div>
                  </div>
                ` : ''}
              </div>`).join('')}</div>
          `;
        }).join('')}
        ${this._nodes.length>0?`
          <div class="control-bento">
            <button class="btn-ghost" id="manage-btn">管理卷宗</button>
            <button class="btn-ghost" id="export-btn">导出情报</button>
            <button class="btn-ghost danger" id="restart-btn">轮回转生 · 重置</button>
          </div>
        `:`
          <div class="control-bento">
            <button class="btn-ghost" id="manage-btn">管理卷宗</button>
            <button class="btn-ghost" id="export-btn">导出情报</button>
          </div>
        `}
      </div>

      <div class="modal-overlay" id="manage-modal">
        <div class="modal-content">
          <div class="modal-title">时间线管理</div>
          ${altBranches.length > 0 ? altBranches.map(b => `
            <div class="branch-item">
              <span class="branch-name" style="color:${b.color}">${this._esc(b.name)}</span>
              <div class="branch-actions">
                <button class="promote-branch-btn" data-id="${b.id}">升格为主线</button>
                <button class="del-branch-btn" data-id="${b.id}">剪除</button>
              </div>
            </div>
          `).join('') : '<div style="text-align:center;font-size:11px;color:var(--text-tertiary);padding:10px;">暂无分支IF线</div>'}
          <button class="modal-close" id="manage-close">返回</button>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('.node').forEach(n=>{
      n.addEventListener('click', (e) => { 
        // Prevent click if we clicked the jump or reroll button inside
        if (e.target.closest('button')) return;
        this._selectedId = n.dataset.id;
        const nodeData = this._nodes.find(nd => nd.id === this._selectedId);
        if (nodeData) {
          eventBus.emit('timeline:view-node', { node: nodeData });
        }
        this._render(); 
      });
    });

    this.shadowRoot.querySelectorAll('.jump-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        eventBus.emit('timeline:jump-request', { nodeId: btn.dataset.id });
        this._selectedId = null;
      });
    });

    this.shadowRoot.querySelectorAll('.reroll-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        eventBus.emit('timeline:reroll-request', { nodeId: btn.dataset.id });
        this._selectedId = null;
      });
    });
    
    const eb = this.shadowRoot.querySelector('#export-btn');
    if(eb) eb.addEventListener('click',()=> eventBus.emit('timeline:export-request'));

    const mb = this.shadowRoot.querySelector('#manage-btn');
    const modal = this.shadowRoot.querySelector('#manage-modal');
    if(mb) mb.addEventListener('click', () => modal.classList.add('active'));

    const closeBtn = this.shadowRoot.querySelector('#manage-close');
    if(closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('active'));

    const restartBtn = this.shadowRoot.querySelector('#restart-btn');
    if(restartBtn) restartBtn.addEventListener('click', () => eventBus.emit('game:restart'));

    this.shadowRoot.querySelectorAll('.promote-branch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        eventBus.emit('timeline:promote-branch', { branchId: btn.dataset.id });
        modal.classList.remove('active');
      });
    });

    this.shadowRoot.querySelectorAll('.del-branch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        eventBus.emit('timeline:delete-branch', { branchId: btn.dataset.id });
        modal.classList.remove('active');
      });
    });

    const newTl = this.shadowRoot?.querySelector('.tl');
    if (newTl) {
      newTl.scrollTop = savedScrollTop;
      this._makeDraggable(newTl);
    }
  }

  _makeDraggable(el) {
    let dragging = false, sx, sy, dx, dy, raf;
    const onDown = e => {
      if (e.target.closest('button') || e.target.closest('.node') || e.target.closest('.branch-item') || e.target.closest('.control-bento')) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      if (st.position === 'fixed' && st.transform !== 'none') {
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.transform = 'none';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        this._tlStyle = `left: ${r.left}px; top: ${r.top}px; transform: none; transition: none; bottom: auto; right: auto;`;
      }
      const evt = e.touches ? e.touches[0] : e;
      sx = evt.clientX;
      sy = evt.clientY;
      dx = parseFloat(el.style.left) || r.left;
      dy = parseFloat(el.style.top) || r.top;
      el.style.transition = 'none';
    };
    
    const onMove = e => {
      if (!dragging) return;
      e.preventDefault();
      const evt = e.touches ? e.touches[0] : e;
      const nx = dx + evt.clientX - sx;
      const ny = dy + evt.clientY - sy;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
        this._tlStyle = `left: ${nx}px; top: ${ny}px; transform: none; transition: none; bottom: auto; right: auto;`;
        raf = null;
      });
    };
    
    const onUp = () => { dragging = false; };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    
    if (this._dragCleanup) this._dragCleanup();
    this._dragCleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchend', onUp);
    };
  }

  _esc(str) {
    return escHtml(str);
  }
}

customElements.define('timeline-navigator', TimelineNavigator);
export default TimelineNavigator;


