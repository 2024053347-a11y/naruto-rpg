import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { truncate, escHtml } from '../utils/format.js';
import { icon } from '../utils/icons.js';

class TimelineNavigator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._selectedId = null;
    this._unsubs = [];
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

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; overflow: hidden; position: relative; }
        .tl {
          display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding: 24px 16px;
          box-sizing: border-box;
          padding-bottom: calc(24px + var(--statusbar-h, 30px));
          background: transparent;
          scrollbar-width: none;
        }
        .tl::-webkit-scrollbar { display: none; }
        
        .tl-title {
          font-size: 18px; text-align: center; margin-bottom: 32px; letter-spacing: 10px; 
          font-family: var(--font-brush); font-weight: normal; 
          background: linear-gradient(135deg, #e8e4d9 0%, #c69c6d 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          display: flex; align-items: center; justify-content: center; gap: 12px;
          text-shadow: 0 2px 10px rgba(198,156,109,0.1);
        }
        .tl-title::before, .tl-title::after {
          content: ''; height: 1px; width: 40px; 
          background: linear-gradient(90deg, transparent, rgba(198,156,109,0.5), transparent);
        }

        .branch {
          font-size: 12px; color: var(--text-secondary); padding: 0 0 8px 0; font-weight: normal; 
          font-family: var(--font-title); margin-top: 24px; margin-bottom: 16px;
          letter-spacing: 4px; border-bottom: 1px solid rgba(255,255,255,0.03);
          display: flex; align-items: center; gap: 10px; position: relative;
        }
        .branch::before {
          content: ''; width: 12px; height: 1px; background: var(--c-shuiro);
          box-shadow: 0 0 8px var(--c-shuiro);
        }
        
        .list { display: flex; flex-direction: column; gap: 4px; position: relative; padding-left: 20px; margin-bottom: 32px; }
        .list::before {
          content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
          background: linear-gradient(to bottom, rgba(198,156,109,0.4) 0%, rgba(255,255,255,0.05) 100%);
        }
        
        .node {
          display: flex; flex-direction: column; gap: 6px; padding: 12px 16px;
          cursor: pointer; border-radius: 4px;
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); font-family: var(--font-title);
          position: relative; background: transparent; margin-left: 8px;
        }
        
        .node::before {
          content: ''; position: absolute; left: -20px; top: 18px;
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--surface-0); border: 1.5px solid rgba(198,156,109,0.3);
          box-shadow: 0 0 8px rgba(198,156,109,0.1);
          z-index: 2; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-sizing: border-box;
        }
        
        .node:hover { 
          background: linear-gradient(90deg, rgba(198,156,109,0.05) 0%, transparent 100%); 
          transform: translateX(4px);
        }
        .node:hover::before { 
          border-color: var(--c-shuiro); background: var(--c-shuiro);
          box-shadow: 0 0 12px var(--c-shuiro); transform: scale(1.2);
        }
        
        .node.cur { 
          background: linear-gradient(90deg, rgba(235,97,63,0.05) 0%, transparent 100%); 
        }
        .node.cur::before {
          border-color: var(--c-shuiro); background: var(--c-shuiro);
          box-shadow: 0 0 16px var(--c-shuiro); transform: scale(1.3);
        }
        
        .node.sel { background: linear-gradient(90deg, rgba(255,255,255,0.03) 0%, transparent 100%); }
        
        .node-chapter { 
          font-size: 13px; font-weight: normal; color: var(--text-secondary); letter-spacing: 2px; 
          font-family: var(--font-title); transition: color 0.3s;
        }
        .node:hover .node-chapter { color: var(--text-primary); }
        .node.cur .node-chapter { color: var(--c-shuiro); text-shadow: 0 0 8px rgba(235,97,63,0.3); }
        .node.sel .node-chapter { color: var(--text-primary); }
        
        .node-summary { 
          font-size: 12px; color: var(--text-tertiary); font-family: var(--font-body);
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
          line-height: 1.6;
        }
        .node.sel .node-summary { display: none; } /* Hide summary when expanded */

        .node-details { margin-top: 8px; animation: fade-down 0.2s ease-out; }

        .node-full-summary {
          font-size: 13px; color: var(--text-primary); line-height: 1.8;
          margin-bottom: 16px; font-family: var(--font-body); opacity: 0.85;
        }

        .node-actions { display: flex; gap: 8px; align-items: center; }
        .jump-btn, .reroll-btn {
          flex: 1; padding: 10px; background: transparent;
          border: 1px solid rgba(255,255,255,0.15); border-radius: 2px;
          font-family: var(--font-title); font-weight: normal; letter-spacing: 2px;
          cursor: pointer; transition: all 0.2s;
        }
        .jump-btn { color: var(--text-secondary); }
        .reroll-btn { color: var(--c-shuiro); border-color: rgba(235,97,63,0.3); }
        .jump-btn:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .reroll-btn:hover { background: rgba(235,97,63,0.1); color: var(--text-primary); }
        
        .cur-text {
          color: var(--c-shuiro); font-size: 11px; font-family: var(--font-title); letter-spacing: 2px;
          display: flex; align-items: center; gap: 8px; opacity: 0.8;
        }
        .cur-text::before, .cur-text::after { content: ''; flex: 1; height: 1px; background: rgba(235,97,63,0.2); }

        .empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 64px 24px; text-align: center; gap: 16px; margin: 32px 16px;
          background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%);
          border-radius: var(--r-md); border: 1px dashed rgba(255,255,255,0.08);
          position: relative; overflow: hidden;
        }
        .empty::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(198,156,109,0.4), transparent);
        }
        .empty-icon {
          width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
          border-radius: 50%; background: rgba(198,156,109,0.05);
          color: var(--c-shuiro); font-size: 20px; font-family: var(--font-brush);
          box-shadow: 0 0 24px rgba(235,97,63,0.1), inset 0 0 12px rgba(198,156,109,0.1);
          margin-bottom: 8px; border: 1px solid rgba(198,156,109,0.15);
        }
        .empty-title {
          font-size: 16px; font-family: var(--font-brush); letter-spacing: 6px;
          color: var(--text-primary); text-shadow: 0 0 12px rgba(255,255,255,0.1);
        }
        .empty-desc {
          font-size: 12px; font-family: var(--font-body); letter-spacing: 2px;
          color: var(--text-tertiary); line-height: 1.8;
        }
        .empty-desc em {
          font-style: normal; color: var(--c-shuiro); opacity: 0.8;
        }

        .control-bento {
          margin-top: 48px; display: flex; flex-direction: column; gap: 8px;
          padding: 0;
        }
        .btn-ghost {
          padding: 12px 16px; font-size: 13px; color: var(--text-secondary); text-align: center;
          border: 1px solid rgba(255,255,255,0.05); border-radius: 2px;
          background: rgba(255,255,255,0.01); font-family: var(--font-title); font-weight: normal; letter-spacing: 4px;
          cursor: pointer; transition: all 0.2s;
        }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.2); color: var(--text-primary); background: rgba(255,255,255,0.05); }
        
        .btn-ghost.danger { color: var(--c-kokihi); border-color: rgba(201,23,30,0.15); background: rgba(201,23,30,0.02); }
        .btn-ghost.danger:hover { border-color: rgba(201,23,30,0.4); background: rgba(201,23,30,0.08); }

        .modal-overlay {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(3,4,6,0.8); backdrop-filter: var(--blur-lg); z-index: 100;
          display: none; flex-direction: column; align-items: center; justify-content: center; padding: 24px;
        }
        .modal-overlay.active { display: flex; animation: modal-fade-in 0.2s ease-out; }
        @keyframes modal-fade-in { from{opacity:0; backdrop-filter:blur(0);} to{opacity:1; backdrop-filter:var(--blur-lg);} }
        
        .modal-content {
          background: rgba(15, 18, 24, 0.95); border: 1px solid rgba(255,255,255,0.1);
          width: 100%; max-width: 320px; padding: 32px 24px; border-radius: var(--r-md);
          display: flex; flex-direction: column; gap: 16px;
          box-shadow: 0 24px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
          position: relative;
        }
        .modal-content::before {
          content: ''; position: absolute; top: 0; left: 24px; right: 24px; height: 1px;
          background: linear-gradient(90deg, transparent, var(--c-shuiro), transparent); opacity: 0.5;
        }
        
        .modal-title { font-size: 16px; color: var(--text-primary); text-align: center; font-weight: 900; letter-spacing: 2px; font-family: var(--font-title); margin-bottom: 8px;}
        .branch-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid rgba(255,255,255,0.05); border-radius: var(--r-sm); background: rgba(255,255,255,0.02); }
        .branch-name { font-size: 12px; color: var(--text-primary); font-weight: 800; }
        .branch-actions { display: flex; gap: 8px; }
        .promote-branch-btn { padding: 4px 10px; font-size: 10px; background: rgba(255,255,255,0.05); border: none; color: var(--text-primary); cursor: pointer; border-radius: 2px;}
        .promote-branch-btn:hover { background: rgba(255,255,255,0.15); }
        .del-branch-btn { padding: 4px 10px; font-size: 10px; background: rgba(201,23,30,0.1); border: none; color: var(--c-kokihi); cursor: pointer; border-radius: 2px;}
        .del-branch-btn:hover { background: rgba(201,23,30,0.25); }
        .modal-close { margin-top: 16px; padding: 12px; text-align: center; font-size: 11px; font-weight: 800; cursor: pointer; background: rgba(255,255,255,0.05); border: none; color: var(--text-secondary); border-radius: var(--r-sm); transition: 0.2s; letter-spacing: 2px; }
        .modal-close:hover { color: var(--text-primary); background: rgba(255,255,255,0.1); }
      </style>
      
      <div class="tl">
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
                    <button class="reroll-btn" data-id="${n.id}">平行推衍本回</button>
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
                    <button class="reroll-btn" data-id="${n.id}">平行推衍本回</button>
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
  }

  _esc(str) {
    return escHtml(str);
  }
}

customElements.define('timeline-navigator', TimelineNavigator);
export default TimelineNavigator;
