import { eventBus } from '../core/event-bus.js';
import { ImageContractStreamFilter } from '../core/image-studio/contracts.js';

const STAGES = [
  { key: 'state_snap',       kanji: '凝', label: '界域快照' },
  { key: 'brainstorm',       kanji: '灵', label: '意识风暴' },
  { key: 'outline',          kanji: '骨', label: '脉络推演' },
  { key: 'review_outline',   kanji: '明', label: '逻辑洞察' },
  { key: 'character_agents', kanji: '魂', label: '灵魂注入' },
  { key: 'writing',          kanji: '织', label: '查克拉编织' },
  { key: 'review_draft',     kanji: '炼', label: '淬火提纯' },
  { key: 'polish',           kanji: '华', label: '万象升华' },
  { key: 'archive',          kanji: '封', label: '记忆封印' }
];

class AgentProgress extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._currentStage = null;
    this._completedStages = new Set();
    this._detail = '';
    this._streamText = '';
    this._streamAgent = null;
    this._streamFilter = new ImageContractStreamFilter();
    this._unsubs = [];
  }

  connectedCallback() {
    this._render();
    this._unsubs.push(
      eventBus.on('agent:progress', ({ stage, detail }) => this._onProgress(stage, detail)),
      eventBus.on('agent:fallback', ({ reason }) => this._onFallback(reason)),
      eventBus.on('agent:stream', ({ agent, chunk }) => this._onStream(agent, chunk))
    );
  }

  disconnectedCallback() {
    this._unsubs.forEach(fn => fn?.());
    this._unsubs = [];
  }

  _onProgress(stage, detail) {
    if (this._currentStage && this._currentStage !== stage) {
      this._completedStages.add(this._currentStage);
    }
    this._currentStage = stage;
    this._detail = detail || '';
    this._streamText = '';
    this._streamAgent = null;
    this._streamFilter = new ImageContractStreamFilter();
    if (this._streamEl) {
      this._streamEl.textContent = '';
    }
    
    if (stage === 'done') {
      this._completedStages.add('archive');
      setTimeout(() => this.remove(), 2000);
    }
    this._update();
  }

  _onFallback(reason) {
    this._detail = `术式崩溃: ${reason}`;
    this._currentStage = 'fallback';
    this._update();
    setTimeout(() => this.remove(), 3000);
  }

  _onStream(agent, chunk) {
    if (!chunk) return;
    // 公开的规划流可以展示；NPC 私密意图与审校记录不能伪装成正文。
    if (String(agent || '').startsWith('char-') || String(agent || '').startsWith('critic-')) return;
    if (this._streamAgent !== agent) {
      this._streamAgent = agent;
      this._streamText = '';
      this._streamFilter = new ImageContractStreamFilter();
    }

    this._streamText += this._streamFilter.push(chunk);
    if (this._streamEl) {
      const displayLength = 1000;
      this._streamEl.textContent = this._streamText.length > displayLength
        ? `...${this._streamText.slice(-displayLength)}`
        : this._streamText;
      this._streamEl.scrollTop = this._streamEl.scrollHeight;
    }
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          position: relative;
          margin: 32px 16px;
          padding: 32px 40px;
          background: radial-gradient(circle at center, #0f1115 0%, #050608 100%);
          border-radius: 16px;
          border: 1px solid rgba(198,156,109,0.2);
          box-shadow: 0 20px 60px rgba(0,0,0,0.9), inset 0 0 80px rgba(0,0,0,0.8), 0 0 20px rgba(198,156,109,0.05);
          overflow: hidden;
          font-family: var(--font-body, sans-serif);
        }
        
        /* 卷轴边缘装饰 */
        :host::before, :host::after {
          content: '';
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 90%;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(198,156,109,0.8), transparent);
          box-shadow: 0 0 10px rgba(198,156,109,0.4);
        }
        :host::before { top: 0; }
        :host::after { bottom: 0; }

        /* 核心：八卦封印阵复合结构 */
        .bg-seal-container {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 400px; height: 400px;
          pointer-events: none;
          z-index: 0;
          opacity: 0.15; /* 整体透明度，防止喧宾夺主 */
          display: flex;
          justify-content: center;
          align-items: center;
        }

        /* 绝对居中的八卦核心漩涡 */
        .seal-core {
          position: absolute;
          width: 40px; height: 40px;
          background: radial-gradient(circle, var(--c-shuiro, #eb613f) 0%, transparent 70%);
          border-radius: 50%;
          box-shadow: 0 0 30px var(--c-shuiro);
          animation: core-pulse 2s ease-in-out infinite alternate;
        }

        /* 第一层：内圈符文阵列（逆时针快转） */
        .seal-ring-inner {
          position: absolute;
          width: 120px; height: 120px;
          border: 1px solid var(--c-kin, #c69c6d);
          border-radius: 50%;
          animation: spin-reverse 15s linear infinite;
        }
        .seal-ring-inner::before {
          content: '临 兵 斗 者 皆 阵 列 前 行';
          position: absolute;
          top: -8px; left: -8px; right: -8px; bottom: -8px;
          border-radius: 50%;
          font-family: 'Noto Serif SC', serif;
          font-size: 10px;
          color: var(--c-shuiro, #eb613f);
          letter-spacing: 6px;
          text-align: center;
          line-height: 136px;
          transform-origin: center;
          text-shadow: 0 0 5px var(--c-shuiro);
        }

        /* 第二层：八卦交叉结印线（静止/微闪） */
        .seal-lines {
          position: absolute;
          width: 220px; height: 220px;
          border-radius: 50%;
        }
        .seal-lines::before, .seal-lines::after {
          content: '';
          position: absolute;
          top: 0; left: 50%;
          width: 1px; height: 100%;
          background: rgba(198,156,109, 0.4);
        }
        .seal-lines::after {
          transform: rotate(90deg);
        }
        .seal-lines-diag {
          position: absolute;
          width: 220px; height: 220px;
          transform: rotate(45deg);
        }
        .seal-lines-diag::before, .seal-lines-diag::after {
          content: '';
          position: absolute;
          top: 0; left: 50%;
          width: 1px; height: 100%;
          background: rgba(198,156,109, 0.4);
        }
        .seal-lines-diag::after {
          transform: rotate(90deg);
        }

        /* 第三层：外圈古老符咒（顺时针慢转） */
        .seal-ring-outer {
          position: absolute;
          width: 320px; height: 320px;
          border: 2px solid rgba(198,156,109, 0.3);
          border-radius: 50%;
          box-shadow: 0 0 20px rgba(198,156,109, 0.1), inset 0 0 20px rgba(198,156,109, 0.1);
          animation: spin 40s linear infinite;
        }
        /* 利用重复锥形渐变模拟外围密集的符文刻度 */
        .seal-ring-outer::after {
          content: '';
          position: absolute;
          top: -10px; left: -10px; right: -10px; bottom: -10px;
          border-radius: 50%;
          background: repeating-conic-gradient(
            from 0deg,
            transparent 0deg,
            transparent 2deg,
            rgba(198,156,109, 0.5) 2deg,
            rgba(198,156,109, 0.5) 3deg
          );
          -webkit-mask-image: radial-gradient(transparent 68%, black 70%);
          mask-image: radial-gradient(transparent 68%, black 70%);
        }

        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes spin-reverse { 100% { transform: rotate(-360deg); } }
        @keyframes core-pulse { 0% { transform: scale(0.8); opacity: 0.5; } 100% { transform: scale(1.2); opacity: 1; } }

        .header {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 40px;
          padding: 0 10px;
        }
        .title {
          font-size: 16px;
          color: var(--c-kin, #c69c6d);
          letter-spacing: 6px;
          font-weight: 800;
          font-family: var(--font-title, serif);
          text-shadow: 0 0 15px rgba(198,156,109,0.6);
        }
        .status {
          font-size: 12px;
          color: #a39f98;
          display: flex;
          align-items: center;
          gap: 10px;
          letter-spacing: 1px;
          background: rgba(0,0,0,0.4);
          padding: 6px 16px;
          border-radius: 20px;
          border: 1px solid rgba(198,156,109,0.1);
        }
        .status-glow {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--c-shuiro, #eb613f);
          box-shadow: 0 0 12px var(--c-shuiro);
          animation: breath 1.5s ease-in-out infinite;
        }

        /* 经络/查克拉运行轨迹 */
        .meridian-track {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 56px;
          margin: 0 20px 32px 20px;
        }
        .meridian-line-bg {
          position: absolute;
          top: 50%; left: 0; right: 0;
          height: 1px;
          background: rgba(198,156,109,0.2);
          transform: translateY(-50%);
          z-index: 1;
        }
        .meridian-line-fill {
          position: absolute;
          top: 50%; left: 0;
          height: 3px;
          background: var(--c-kin, #c69c6d);
          box-shadow: 0 0 15px var(--c-kin);
          transform: translateY(-50%);
          z-index: 1;
          transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
          width: 0%;
        }

        /* 节点样式 */
        .node {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 56px;
        }
        .node .circle {
          width: 10px; height: 10px;
          background: rgba(198,156,109,0.4);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .node .kanji {
          opacity: 0; font-size: 16px; font-weight: bold;
          font-family: var(--font-title, serif);
          transition: opacity 0.3s;
        }
        .node .label {
          position: absolute; top: 40px;
          font-size: 11px; color: #a39f98; white-space: nowrap;
          opacity: 0; transform: translateY(-5px);
          transition: all 0.3s;
          letter-spacing: 1px;
        }

        /* 激活状态：结印亮起 */
        .node.active .circle {
          width: 40px; height: 40px;
          background: rgba(235,97,63,0.15);
          border: 1px solid var(--c-shuiro, #eb613f);
          box-shadow: 0 0 25px rgba(235,97,63,0.6), inset 0 0 15px rgba(235,97,63,0.4);
          color: var(--c-shuiro);
        }
        .node.active .kanji { opacity: 1; text-shadow: 0 0 10px var(--c-shuiro); }
        .node.active .label { opacity: 1; transform: translateY(0); color: var(--c-shuiro); text-shadow: 0 0 5px rgba(235,97,63,0.5); }

        /* 完成状态：经络打通 */
        .node.completed .circle {
          width: 14px; height: 14px;
          background: var(--c-kin, #c69c6d);
          box-shadow: 0 0 15px var(--c-kin);
          border: none;
        }

        /* 虚空文字流 (Stream Portal) */
        .stream-portal {
          position: relative;
          z-index: 2;
          margin: 10px 20px 0 20px;
          height: 180px;
          background: radial-gradient(ellipse at top, rgba(198,156,109,0.08), transparent 80%);
          border-top: 1px solid rgba(198,156,109,0.2);
          border-radius: 8px;
          padding: 24px 20px 10px 20px;
        }
        .stream-content {
          height: 100%;
          overflow-y: auto;
          font-family: var(--font-title, 'Noto Serif SC', serif);
          font-size: 14px;
          line-height: 2.2;
          color: rgba(232,228,217,0.85);
          text-align: justify;
          text-shadow: 0 0 3px rgba(255,255,255,0.15);
          padding-right: 20px;
          mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
          scrollbar-width: none;
        }
        .stream-content::-webkit-scrollbar { display: none; }

        @keyframes slow-spin { 100% { transform: translate(-50%, -50%) rotate(360deg); } }
        @keyframes slow-spin-reverse { 100% { transform: translate(-50%, -50%) rotate(-360deg); } }
        @keyframes breath { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
      </style>
      
      <div class="bg-seal-container">
        <div class="seal-core"></div>
        <div class="seal-ring-inner"></div>
        <div class="seal-lines"></div>
        <div class="seal-lines-diag"></div>
        <div class="seal-ring-outer"></div>
      </div>
      
      <div class="header">
        <span class="title">秘术 · 天机推演</span>
        <div class="status">
          <div class="status-glow" id="status-glow"></div>
          <span id="status-text">提取查克拉...</span>
        </div>
      </div>

      <div class="meridian-track">
        <div class="meridian-line-bg"></div>
        <div class="meridian-line-fill" id="meridian-fill"></div>
        <div style="display:flex; justify-content:space-between; width:100%; position:absolute; z-index:2;" id="stages">
        </div>
      </div>

      <div class="stream-portal">
        <div class="stream-content" id="stream"></div>
      </div>
    `;
    
    this._stagesEl = this.shadowRoot.getElementById('stages');
    this._streamEl = this.shadowRoot.getElementById('stream');
    this._fillEl = this.shadowRoot.getElementById('meridian-fill');
    this._statusTextEl = this.shadowRoot.getElementById('status-text');
    this._statusGlowEl = this.shadowRoot.getElementById('status-glow');
    this._update();
  }

  _update() {
    if (!this._stagesEl) return;

    let stageIdx = STAGES.findIndex(s => s.key === this._currentStage);
    if (stageIdx === -1 && this._currentStage === 'done') stageIdx = STAGES.length - 1;

    // Calculate fill percentage
    const progressPct = Math.max(0, (stageIdx / (STAGES.length - 1)) * 100);
    this._fillEl.style.width = `${progressPct}%`;

    this._stagesEl.innerHTML = STAGES.map((s, i) => {
      let cls = 'node';
      if (this._completedStages.has(s.key)) cls += ' completed';
      else if (s.key === this._currentStage) cls += ' active';
      
      return `
        <div class="${cls}">
          <div class="circle"><span class="kanji">${s.kanji}</span></div>
          <div class="label">${s.label}</div>
        </div>
      `;
    }).join('');

    if (this._currentStage === 'fallback') {
      this._statusTextEl.textContent = `术式反噬：${this._detail}`;
      this._statusTextEl.style.color = '#e8a44a';
      this._statusGlowEl.style.background = '#e8a44a';
    } else if (this._currentStage === 'done') {
      this._statusTextEl.textContent = '阵法编织完成';
      this._statusTextEl.style.color = 'var(--c-moegi, #6bc775)';
      this._statusGlowEl.style.background = 'var(--c-moegi, #6bc775)';
      this._statusGlowEl.style.animation = 'none';
    } else {
      this._statusTextEl.textContent = this._detail || '正在推演命运走向...';
    }
  }
}

customElements.define('agent-progress', AgentProgress);
export default AgentProgress;
