import { eventBus } from '../core/event-bus.js';
import { stateManager } from '../core/state-manager.js';
import { GAME_DATA } from '../data/game-data.js';
import { icon } from '../utils/icons.js';
import { escAttr, escHtml } from '../utils/format.js';
import { bindCustomSelects } from './custom-select.js';
import { createOpeningContract, deriveOpeningState } from '../systems/opening-contract.js';

const START_PRESET_KEY = 'naruto_start_preset_v1';

class CharacterCreator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._step = 0;
    this._choices = {};
    this._points = 0;
    this._attrs = { chakra: 5, spirit: 5, willpower: 5, speed: 5, luck: 5 };
    this._presetLoaded = false;
    this._loadStartPreset();
  }

  connectedCallback() { this._render(); }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap { max-width: 680px; margin: 0 auto; padding: 32px 20px; }
        .card {
          background: rgba(16,16,32,0.82);
          backdrop-filter: blur(24px) saturate(1.3);
          -webkit-backdrop-filter: blur(24px) saturate(1.3);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 20px;
          padding: 40px 32px;
          box-shadow: 0 0 80px rgba(235,97,63,0.06), 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04);
          position: relative;
          overflow: hidden;
        }
        .card::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 21px;
          padding: 1px;
          background: linear-gradient(135deg, rgba(235,97,63,0.2) 0%, transparent 30%, rgba(198,156,109,0.15) 70%, transparent 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
        .steps { display: flex; justify-content: center; gap: 6px; margin-bottom: 32px; flex-wrap: wrap; }
        .step-dot {
          width: 36px; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.08); transition: all 0.3s cubic-bezier(0.8,0,0.2,1);
        }
        .step-dot.done { background: var(--c-moegi, #16a06d); box-shadow: 0 0 6px rgba(22,160,109,0.4); }
        .step-dot.active { background: var(--c-shuiro, #eb613f); box-shadow: 0 0 10px rgba(235,97,63,0.5); }
        .title {
          text-align: center; font-size: 18px; font-weight: 700; color: var(--text-primary, #e8e4d9); margin-bottom: 24px;
          font-family: var(--font-title, 'Noto Serif SC', serif); letter-spacing: 2px;
        }
        .options { display: grid; gap: 10px; }
        .opt {
          padding: 16px 18px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          border-radius: 10px; cursor: pointer; transition: all 0.2s cubic-bezier(0.22,1,0.36,1); text-align: left; color: var(--text-primary, #e8e4d9);
          position: relative;
        }
        .opt:hover { border-color: rgba(235,97,63,0.4); background: rgba(235,97,63,0.06); transform: translateX(3px); }
        .opt.sel {
          border-color: var(--c-shuiro, #eb613f);
          background: rgba(235,97,63,0.08);
          box-shadow: 0 0 20px rgba(235,97,63,0.12), inset 0 0 0 1px rgba(235,97,63,0.15);
        }
        .opt.sel::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--c-shuiro, #eb613f), var(--c-kin, #c69c6d)); border-radius: 2px 2px 0 0; }
        .opt-name { font-weight: 700; font-size: 14px; font-family: var(--font-title, 'Noto Serif SC', serif); }
        .opt-desc { font-size: 12px; color: var(--text-tertiary, #6e6a65); margin-top: 4px; line-height: 1.5; }
        .attr-r { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
        .attr-icon { width: 36px; text-align: center; font-size: 20px; }
        .attr-n { width: 80px; font-size: 14px; color: var(--text-primary, #e8e4d9); font-family: var(--font-title, 'Noto Serif SC', serif); font-weight: 600; }
        .attr-v { width: 36px; text-align: center; font-size: 18px; font-weight: 700; font-family: var(--font-mono, 'JetBrains Mono', monospace); color: var(--c-kin, #c69c6d); }
        .attr-input {
          width: 48px; text-align: center; font-size: 16px; font-weight: 700;
          font-family: var(--font-mono, 'JetBrains Mono', monospace); color: var(--c-kin, #c69c6d);
          background: rgba(0,0,0,0.3); border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          border-radius: 6px; padding: 4px 2px; outline: none; -moz-appearance: textfield;
        }
        .attr-input::-webkit-outer-spin-button, .attr-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .attr-input:focus { border-color: var(--c-shuiro, #eb613f); box-shadow: 0 0 12px rgba(235,97,63,0.2); }
        .attr-input.over { border-color: #ef5350; color: #ef5350; }
        .attr-b {
          width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
          background: rgba(255,255,255,0.03); color: var(--text-primary, #e8e4d9); font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center; transition: all 0.15s;
          font-family: var(--font-title, 'Noto Serif SC', serif);
        }
        .attr-b:hover { border-color: var(--c-shuiro, #eb613f); background: rgba(235,97,63,0.12); transform: scale(1.05); }
        .attr-b:disabled { opacity: 0.2; cursor: not-allowed; }
        .attr-b:disabled:hover { border-color: var(--border-subtle, rgba(255,255,255,0.1)); background: rgba(255,255,255,0.03); transform: none; }
        .points { text-align: center; font-size: 15px; color: var(--c-kin, #c69c6d); margin-bottom: 20px; font-weight: 700; font-family: var(--font-title, 'Noto Serif SC', serif); }
        .nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 32px; }
        .btn {
          padding: 10px 24px; border-radius: 10px; cursor: pointer; font-size: 14px;
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); background: rgba(255,255,255,0.03);
          color: var(--text-primary, #e8e4d9); transition: all 0.2s cubic-bezier(0.22,1,0.36,1);
          font-family: var(--font-title, 'Noto Serif SC', serif); font-weight: 600; letter-spacing: 1px;
        }
        .btn:hover { border-color: var(--border-strong, rgba(255,255,255,0.3)); background: rgba(255,255,255,0.06); transform: translateY(-1px); }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .btn-p {
          background: linear-gradient(135deg, #FF512F 0%, #F09819 100%); border: none; color: #fff;
          font-weight: 700; box-shadow: 0 4px 14px rgba(255,81,47,0.39);
        }
        .btn-p:hover { background: linear-gradient(135deg, #FF6A4D 0%, #F5AB3A 100%); border-color: transparent; box-shadow: 0 6px 20px rgba(255,81,47,0.6); }
        .btn-sm { padding: 6px 14px; font-size: 12px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .hint { text-align: center; font-size: 13px; color: var(--text-tertiary, rgba(244,241,234,0.45)); margin-bottom: 16px; font-family: var(--font-brush, 'Kaiti SC', cursive); }
        .selected-info { text-align: center; font-size: 14px; color: var(--c-kin, #c69c6d); margin-bottom: 16px; font-weight: 600; }
        .name-input {
          width: 100%; box-sizing: border-box; padding: 14px 16px; border-radius: 10px;
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
          background: rgba(0,0,0,0.2); color: var(--text-primary, #e8e4d9);
          font-size: 16px; font-family: var(--font-title, 'Noto Serif SC', serif); outline: none;
          transition: all 0.2s;
        }
        .name-input:focus { border-color: var(--c-shuiro, #eb613f); box-shadow: 0 0 20px rgba(235,97,63,0.15); background: rgba(0,0,0,0.4); }
        .custom-box {
          margin-top: 14px; padding: 16px; border: 1px dashed rgba(198,156,109,.36);
          border-radius: 12px; background: rgba(198,156,109,.04);
        }
        .custom-title { color: var(--c-kin, #c69c6d); font: 700 13px/1.4 var(--font-title, 'Noto Serif SC', serif); letter-spacing: 1px; margin-bottom: 10px; }
        .preset-card, .creator-import-card {
          display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
          margin-bottom: 18px; padding: 14px 18px; border-radius: 12px;
          border: 1px solid rgba(198,156,109,.22); background: rgba(198,156,109,.06);
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        }
        .creator-import-card { border-color: rgba(235,97,63,.22); background: rgba(235,97,63,.055); }
        .preset-card strong, .creator-import-card strong { display:block; color: var(--text-primary, #e8e4d9); font:700 13px/1.4 var(--font-title, 'Noto Serif SC', serif); letter-spacing:1px; }
        .preset-card span, .creator-import-card span { display:block; color: var(--text-tertiary, #6e6a65); font-size:12px; margin-top:3px; line-height:1.55; }
        .preset-actions { display:flex; gap:8px; }
        .field { display: grid; gap: 6px; margin-top: 10px; }
        .field label { color: var(--text-secondary, #a39f98); font-size: 12px; font-weight: 500; }
        .text-input, .text-area, .select-input {
          width: 100%; box-sizing: border-box; padding: 11px 14px; border-radius: 8px;
          border: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); background: rgba(0,0,0,0.2);
          color: var(--text-primary, #e8e4d9);
          font-size: 14px; font-family: var(--font-brush, 'Kaiti SC', cursive); outline: none;
          transition: all 0.2s;
        }
        .text-area { min-height: 76px; resize: vertical; line-height: 1.65; }
        .text-input:focus, .text-area:focus, .select-input:focus { border-color: var(--c-shuiro, #eb613f); box-shadow: 0 0 16px rgba(235,97,63,0.15); background: rgba(0,0,0,0.4); }
        @media (max-width: 520px) {
          .wrap { padding: 18px 12px; }
          .card { padding: 24px 16px; border-radius: 14px; }
          .steps { gap: 4px; margin-bottom: 22px; }
          .step-dot { width: 24px; }
          .title { font-size: 16px; letter-spacing: 1px; }
          .grid-2 { grid-template-columns: 1fr; }
          .attr-r { gap: 8px; }
          .attr-icon { width: 28px; }
          .attr-n { width: 72px; font-size: 13px; }
          .attr-b { width: 34px; height: 34px; }
          .nav { gap: 12px; }
          .btn { flex: 1; min-height: 42px; padding: 10px 12px; }
          .preset-card, .creator-import-card { grid-template-columns: 1fr; text-align: center; }
          .preset-actions { justify-content: center; }
          .name-input, .text-input, .text-area, .select-input { font-size: 16px; }
        }
      </style>
      <div class="wrap">
        <div class="card">
          ${this._progress()}
          ${this._presetBanner()}
          ${this._importBanner()}
          <div class="title">${this._stepTitle()}</div>
          ${this._content()}
          ${this._navButtons()}
        </div>
      </div>
    `;
    this._bindEventsAfterRender();
    bindCustomSelects(this.shadowRoot);
  }

  _progress() {
    const labels = ['姓名', '难度', '属性', '天赋', '性别', '出身', '技能', '查克拉', '时代'];
    return `<div class="steps">${labels.map((l,i)=>{
      let cls='';
      if(i<this._step) cls='done';
      else if(i===this._step) cls='active';
      return `<div class="step-dot ${cls}" title="${l}"></div>`;
    }).join('')}</div>`;
  }

  _presetBanner() {
    if (!this._presetLoaded) return '';
    const name = this._choices.name || '未命名忍者';
    const bg = this._getBackgroundName();
    const talent = this._getTalentName();
    return `
      <div class="preset-card">
        <div>
          <strong>已载入上次开局卷轴</strong>
          <span>${this._esc(name)} · ${this._esc(bg)} · ${this._esc(talent)}。你可以直接开局，也可以继续调整。</span>
        </div>
        <div class="preset-actions">
          <button class="btn btn-p" id="btn-quick-start" type="button">直接开局</button>
          <button class="btn" id="btn-clear-preset" type="button">清除</button>
        </div>
      </div>
    `;
  }

  _importBanner() {
    if (this._step !== 0) return '';
    return `
      <div class="creator-import-card">
        <div>
          <strong>从异地存档继续</strong>
          <span>如果你在其他设备导出了时间线 JSON，可以直接导入恢复角色、分支和对话。</span>
        </div>
        <div class="preset-actions">
          <button class="btn" id="btn-import-timeline" type="button">导入存档</button>
          <input type="file" id="timeline-import-file" accept="application/json,.json" hidden />
        </div>
      </div>
    `;
  }

  _stepTitle() {
    const t = ['第一步：留下你的忍名','第二步：选择游戏难度','第三步：分配基础属性','第四步：选择天赋','第五步：选择性别','第六步：选择出身背景','第七步：设定初始技能','第八步：选择查克拉属性','第九步：选择开局时代'];
    return t[this._step]||'';
  }

  _content() {
    switch(this._step){
      case 0: return this._renderName();
      case 1: return this._renderDiff();
      case 2: return this._renderAttrs();
      case 3: return this._renderTalent();
      case 4: return this._renderGender();
      case 5: return this._renderBg();
      case 6: return this._renderSkill();
      case 7: return this._renderNature();
      case 8: return this._renderTimeline();
      default: return '';
    }
  }

  _renderName() {
    return `
      <div class="hint">这个名字会用于剧情、存档摘要和角色面板</div>
      <input class="name-input" id="player-name" maxlength="16" placeholder="例如：漩涡岚" value="${this._escAttr(this._choices.name || '')}" autofocus />
      <div class="hint" style="margin-top:20px;">自定义角色人设（外貌、性格、过往等，将写入世界书防止AI遗忘）</div>
      <textarea class="text-area" id="player-persona" maxlength="500" placeholder="例如：一头红发，性格开朗，左眼有一道伤疤。喜欢吃拉面，梦想是成为像四代火影一样的人...">${this._esc(this._choices.persona || '')}</textarea>
    `;
  }

  _renderDiff() {
    const diffs = GAME_DATA.difficulties;
    const sel = this._choices.difficulty || '下忍';
    return `<div class="options">${Object.values(diffs).map(d=>`
      <div class="opt${d.id===sel?' sel':''}" data-val="${d.id}">
        <div class="opt-name">${d.id} (${d.label})</div>
        <div class="opt-desc">初始${d.points}点 | 经验×${d.exp_multiplier} | 敌人${Math.round(d.enemy_modifier*100)}% — ${d.description}</div>
      </div>`).join('')}</div>`;
  }

  _renderAttrs() {
    if(!this._choices.difficulty) this._choices.difficulty='下忍';
    if(!this._points && Object.values(this._attrs).every(v=>v===5))
      this._points = GAME_DATA.getDifficulty(this._choices.difficulty).points;
    const list = [
      {k:'chakra',n:'查克拉量',iconName:'chakra',c:'#42A5F5'},
      {k:'spirit',n:'精神力',iconName:'spirit',c:'#CE93D8'},
      {k:'willpower',n:'意志力',iconName:'willpower',c:'#eb613f'},
      {k:'speed',n:'速度',iconName:'speed',c:'#81C784'},
      {k:'luck',n:'幸运',iconName:'luck',c:'#ef5350'}
    ];
    return `
      <div class="points">剩余点数: <strong id="remaining-points">${this._points}</strong></div>
      ${list.map(a=>`
        <div class="attr-r">
          <span class="attr-icon" style="color:${a.c}">${icon(a.iconName, 20)}</span>
          <span class="attr-n" style="color:${a.c}">${a.n}</span>
          <button class="attr-b" data-a="${a.k}" data-d="-1" ${(this._attrs[a.k]||5)<=5?'disabled':''}>−</button>
          <input class="attr-input" id="attr-${a.k}" data-a="${a.k}" type="number" min="5" max="20" value="${this._attrs[a.k]||5}" style="width:48px;text-align:center;" />
          <button class="attr-b" data-a="${a.k}" data-d="1" ${this._points<=0||(this._attrs[a.k]||5)>=20?'disabled':''}>+</button>
        </div>`).join('')}`;
  }

  _renderTalent() {
    const talents = GAME_DATA.talents;
    const sel = this._choices.talent;
    const custom = this._choices.customTalent || {};
    const customSelected = sel === '__custom_talent__';
    const noTalentSelected = sel === '__no_talent__';
    return `<div class="options">
      <div class="opt${noTalentSelected?' sel':''}" data-val="__no_talent__">
        <div class="opt-name">普通人 (无特殊天赋)</div>
        <div class="opt-desc">没有任何特殊的血脉或与生俱来的天赋，仅凭毅力与汗水。</div>
      </div>
      ${Object.values(talents).map(t=>`
      <div class="opt${t.id===sel?' sel':''}" data-val="${t.id}">
        <div class="opt-name">${t.id}</div>
        <div class="opt-desc">${t.description}</div>
      </div>`).join('')}
      <div class="opt${customSelected?' sel':''}" data-val="__custom_talent__">
        <div class="opt-name">自定义天赋组合</div>
        <div class="opt-desc">支持自由设定一个或多个天赋特征</div>
      </div>
    </div>
    ${customSelected ? `
      <div class="custom-card" style="margin-top: 15px;">
        <div class="custom-title">自定义天赋详情</div>
        <div class="field">
          <label>天赋设定 (支持填写多个)</label>
          <textarea class="text-area custom-field" data-key="customTalent.description" maxlength="300" style="height:100px;" placeholder="例如：\n1. 漩涡体质：查克拉庞大且恢复极快。\n2. 纸鹤记忆：过目不忘。\n写清能力表现与限制，AI 会自动读取并适配。">${this._esc(custom.description || '')}</textarea>
        </div>
      </div>` : ''}
    `;
  }

  _renderGender() {
    const sel = this._choices.gender;
    const custom = this._choices.customGender || '';
    const customSelected = sel === '__custom_gender__';
    return `<div class="options grid-2">
      <div class="opt${sel==='男性'?' sel':''}" data-val="男性"><div class="opt-name">${icon('male', 14)} 男性</div><div class="opt-desc">称呼: 少年/君</div></div>
      <div class="opt${sel==='女性'?' sel':''}" data-val="女性"><div class="opt-name">${icon('female', 14)} 女性</div><div class="opt-desc">称呼: 少女/酱</div></div>
      <div class="opt${sel==='伪娘'?' sel':''}" data-val="伪娘"><div class="opt-name">${icon('male', 14)} 伪娘</div><div class="opt-desc">外表柔美，生理为男</div></div>
      <div class="opt${sel==='扶她'?' sel':''}" data-val="扶她"><div class="opt-name">${icon('star', 14)} 扶她</div><div class="opt-desc">同时具备双性特征</div></div>
      <div class="opt${sel==='假小子'?' sel':''}" data-val="假小子"><div class="opt-name">${icon('female', 14)} 假小子</div><div class="opt-desc">英气俊朗，生理为女</div></div>
      <div class="opt${customSelected?' sel':''}" data-val="__custom_gender__">
        <div class="opt-name">${icon('edit', 14)} 自定义性别</div>
        <div class="opt-desc">手动输入期望的性别设定</div>
      </div>
    </div>
    ${customSelected ? `
      <div class="custom-card" style="margin-top: 15px;">
        <div class="custom-title">自定义性别输入</div>
        <div class="field">
          <label>输入性别</label>
          <input class="text-input custom-field" data-key="customGender" maxlength="12" placeholder="例如：无性别 / 雌雄同体" value="${this._escAttr(custom)}" />
        </div>
      </div>` : ''}`;
  }

  _renderBg() {
    const bgs = GAME_DATA.backgrounds;
    const sel = this._choices.background;
    const custom = this._choices.customBackground || {};
    const customSelected = sel === '__custom_background__';
    return `<div class="options">${Object.values(bgs).map(bg=>`
      <div class="opt${bg.id===sel?' sel':''}" data-val="${bg.id}">
        <div class="opt-name">${bg.id}</div>
        <div class="opt-desc">${bg.description} · 初始地点: ${bg.location}</div>
      </div>`).join('')}
      <div class="opt${customSelected?' sel':''}" data-val="__custom_background__">
        <div class="opt-name">自定义出身背景</div>
        <div class="opt-desc">自行设定家族、故乡、身份秘密、重要关系和起始地点</div>
      </div>
      </div>
      <div class="custom-box">
        <div class="custom-title">自定义出身卷轴</div>
        <div class="grid-2">
          <div class="field">
            <label>出身名称</label>
            <input class="text-input custom-field" data-key="customBackground.name" maxlength="24" placeholder="例如：雨隐遗民 / 漩涡旁支 / 根部观察对象" value="${this._escAttr(custom.name || '')}" />
          </div>
          <div class="field">
            <label>起始地点</label>
            <input class="text-input custom-field" data-key="customBackground.location" maxlength="24" placeholder="例如：木叶旧街 / 忍校后山" value="${this._escAttr(custom.location || '')}" />
          </div>
        </div>
        <div class="field">
          <label>背景描述</label>
          <textarea class="text-area custom-field" data-key="customBackground.description" maxlength="220" placeholder="写下家庭、过去、秘密、目标或与木叶的关系。填写后会自动选中自定义出身。">${this._esc(custom.description || '')}</textarea>
        </div>
      </div>`;
  }

  _renderSkill() {
    const skill = this._choices.customSkill || {};
    return `
      <div class="hint">可选择留白以普通人开局，也可以自由填入初始掌握的技能、专长或携带的特殊忍具。</div>
      <div class="custom-card" style="margin-top:10px;">
        <div class="custom-title">自定义初始能力组合 (支持填写多项)</div>
        <div class="field">
          <textarea class="text-area custom-field" data-key="customSkill.description" maxlength="600" style="height: 140px;" placeholder="例如：\n【影分身之术】B级忍术，目前只能分出两个，消耗极大。\n【祖传查克拉短刀】能够传导查克拉的武器，非常锋利。\n写清各项能力的表现与限制，AI 会在后续剧情中自动识别。">${this._esc(skill.description || '')}</textarea>
        </div>
      </div>
    `;
  }

  _skillTypeOption(value, label, selected) {
    return `<option value="${value}"${(selected || 'jutsu') === value ? ' selected' : ''}>${label}</option>`;
  }

  _renderNature() {
    const natures = GAME_DATA.chakraNatures;
    const sel = this._choices.chakraNature || [];
    const avail = Object.values(natures);
    return `
      <div class="hint">可以自由选择你所拥有的查克拉属性或血继限界，没有数量限制。</div>
      <div class="selected-info">已选: ${sel.map(s=>typeof s==='string'?s:s.name||s).join(', ')||'尚未选择'}</div>
      <div class="options grid-2">${avail.map(n=>{
        const s=sel.includes(n.id);
        return `<div class="opt${s?' sel':''}" data-val="${n.id}">
          <div class="opt-name">${icon(n.emoji||n.id, 14)} ${n.name}</div><div class="opt-desc">${n.isKekkeiGenkai?'血继限界':'基础属性'}</div>
        </div>`;
      }).join('')}</div>`;
  }

  _renderTimeline() {
    const presets = GAME_DATA.timelinePresets;
    const sel = this._choices.timeline;
    const customYear = this._choices.customTimelineYear || '52';
    const isCustom = sel === '__custom_timeline__';
    const presetEntries = Object.values(presets).filter(p => p.id !== '__custom_timeline__');
    return `
      <div class="hint">选择你的忍者故事从哪个时代开始。AI 会根据所选年代自动判断人物年龄、组织状态与事件进度</div>
      <div class="selected-info">${sel && sel !== '__custom_timeline__' ? `已选: ${presets[sel]?.label || '木叶52年'}` : isCustom ? `已选: 木叶${this._esc(customYear)}年` : '默认木叶52年'}</div>
      <div class="options">${presetEntries.map(p=>`
        <div class="opt${p.id===sel?' sel':''}" data-val="${p.id}">
          <div class="opt-name">${this._esc(p.label)}</div>
          <div class="opt-desc">${this._esc(p.era_summary.slice(0, 120))}...</div>
        </div>`).join('')}
        <div class="opt${isCustom?' sel':''}" data-val="__custom_timeline__">
          <div class="opt-name">自定义年代</div>
          <div class="opt-desc">由你输入任意木叶纪年，AI 会根据所选年代自动判断合理性</div>
        </div>
      </div>
      <div class="custom-box">
        <div class="custom-title">自定义年代卷轴</div>
        <div class="field">
          <label>木叶纪年 (1~100)</label>
          <input class="text-input custom-field" data-key="customTimeline.year" maxlength="3" placeholder="输入数字，例如：52" value="${this._escAttr(customYear)}" type="number" min="1" max="100" />
        </div>
      </div>`;
  }

  _navButtons() {
    const canNext = this._canGoNext();
    return `<div class="nav">
      <button class="btn" id="btn-prev" ${this._step===0?'disabled':''}>← 上一步</button>
      <button class="btn btn-p" id="btn-next" ${canNext?'':'disabled'}>${this._step===8?'完成创建 →':'下一步 →'}</button>
    </div>`;
  }

  _canGoNext() {
    if (this._step === 0) return !!String(this._choices.name || '').trim();
    if (this._step === 3) return this._choices.talent === '__custom_talent__' ? this._hasMeaningfulCustom(this._choices.customTalent) : !!this._choices.talent;
    if (this._step === 4) return !!this._choices.gender;
    if (this._step === 5) return this._choices.background === '__custom_background__' ? this._hasMeaningfulCustom(this._choices.customBackground) : !!this._choices.background;
    if (this._step === 7) return (this._choices.chakraNature || []).length > 0;
    if (this._step === 8) {
      if (this._choices.timeline === '__custom_timeline__') {
        const yr = Number(this._choices.customTimelineYear);
        return Number.isFinite(yr) && yr >= 1 && yr <= 100;
      }
      return true;
    }
    return true;
  }

  _bindEventsAfterRender() {
    this.shadowRoot.querySelectorAll('.opt').forEach(o=>{
      o.addEventListener('click',()=>{
        const v = o.dataset.val;
        if(this._step===2) return;
        if(this._step===7){
          const sel = this._choices.chakraNature||[];
          const idx = sel.indexOf(v);
          if(idx>=0){ sel.splice(idx,1); }
          else { sel.push(v); }
          this._choices.chakraNature = sel;
        } else {
          if(this._step===1 && this._choices.difficulty !== v) {
            this._choices.difficulty = v;
            this._attrs = { chakra: 5, spirit: 5, willpower: 5, speed: 5, luck: 5 };
            this._points = GAME_DATA.getDifficulty(v).points;
            delete this._choices.attributes;
          }
          if(this._step===3) this._choices.talent = v;
          if(this._step===4) this._choices.gender = v;
          if(this._step===5) this._choices.background = v;
          if(this._step===8) this._choices.timeline = v;
        }
        this._saveStartPreset();
        this._render();
      });
    });

    if(this._step===0){
      const nameInput = this.shadowRoot.querySelector('#player-name');
      const personaInput = this.shadowRoot.querySelector('#player-persona');
      nameInput?.addEventListener('input',()=>{
        this._choices.name = nameInput.value.trim();
        this._saveStartPreset();
        this.shadowRoot.querySelector('#btn-next')?.toggleAttribute('disabled', !this._canGoNext());
      });
      personaInput?.addEventListener('input',()=>{
        this._choices.persona = personaInput.value.trim();
        this._saveStartPreset();
      });
    }

    if(this._step===2){
      this.shadowRoot.querySelectorAll('.attr-b').forEach(b=>{
        b.addEventListener('click',()=>{
          const a=b.dataset.a, d=parseInt(b.dataset.d);
          const nv = (this._attrs[a]||5)+d;
          if(nv<5||nv>20||(d>0&&this._points<=0)) return;
          this._attrs[a]=nv; this._points-=d;
          this._choices.attributes = { ...this._attrs };
          this._saveStartPreset();
          this._render();
        });
      });

      this.shadowRoot.querySelectorAll('.attr-input').forEach(input=>{
        input.addEventListener('input',()=>{
          const a = input.dataset.a;
          const newVal = parseInt(input.value) || 5;
          const clamped = Math.max(5, Math.min(20, newVal));
          if (newVal !== clamped) input.value = clamped;
        });
        input.addEventListener('change',()=>{
          const a = input.dataset.a;
          const newVal = Math.max(5, Math.min(20, parseInt(input.value) || 5));
          input.value = newVal;
          const oldVal = this._attrs[a] || 5;
          const diff = newVal - oldVal;
          if (diff > 0 && this._points < diff) {
            const maxAllowed = oldVal + this._points;
            this._attrs[a] = maxAllowed;
            this._points = 0;
            input.value = maxAllowed;
          } else {
            this._attrs[a] = newVal;
            this._points -= diff;
          }
          this._choices.attributes = { ...this._attrs };
          this._saveStartPreset();
          this._render();
        });
      });
    }

    if(this._step===3 || this._step===5 || this._step===6 || this._step===8){
      this.shadowRoot.querySelectorAll('.custom-field').forEach(input=>{
        input.addEventListener('input',()=>this._handleCustomField(input));
        input.addEventListener('change',()=>this._handleCustomField(input));
      });
    }

    this.shadowRoot.querySelector('#btn-prev')?.addEventListener('click',()=>{
      if(this._step>0){ this._step--; this._render(); }
    });

    this.shadowRoot.querySelector('#btn-clear-preset')?.addEventListener('click',()=>{
      localStorage.removeItem(START_PRESET_KEY);
      this._presetLoaded = false;
      this._choices = {};
      this._points = 0;
      this._attrs = { chakra: 5, spirit: 5, willpower: 5, speed: 5, luck: 5 };
      this._render();
    });

    this.shadowRoot.querySelector('#btn-quick-start')?.addEventListener('click',()=>{
      this._finish();
    });

    this.shadowRoot.querySelector('#btn-import-timeline')?.addEventListener('click',()=>{
      this.shadowRoot.querySelector('#timeline-import-file')?.click();
    });
    this.shadowRoot.querySelector('#timeline-import-file')?.addEventListener('change',(e)=>{
      const file = e.target.files?.[0];
      if (file) eventBus.emit('app:timeline-import-file', { file });
      e.target.value = '';
    });

    this.shadowRoot.querySelector('#btn-next')?.addEventListener('click',()=>{
      if (!this._canGoNext()) return;
      if(this._step===1 && !this._choices.difficulty) this._choices.difficulty='下忍';
      if(this._step===2) this._choices.attributes={...this._attrs};
      if(this._step===3 && !this._choices.talent) return;
      if(this._step===4 && !this._choices.gender) return;
      if(this._step===5 && !this._choices.background) this._choices.background='平民出身';
      if(this._step===7){
        if(!this._choices.chakraNature||this._choices.chakraNature.length===0) this._choices.chakraNature=['火'];
        this._saveStartPreset();
        this._step++; this._render();
        return;
      }
      if(this._step===8){
        this._finish(); return;
      }
      this._saveStartPreset();
      this._step++; this._render();
    });
  }

  _handleCustomField(input) {
    const key = input.dataset.key;
    if (!key) return;
    const [group, field] = key.split('.');
    if (!group || !field) return;
    this._choices[group] = this._choices[group] || {};
    this._choices[group][field] = input.value.trim();
    if (group === 'customTalent' && this._hasMeaningfulCustom(this._choices.customTalent)) {
      this._choices.talent = '__custom_talent__';
    }
    if (group === 'customBackground' && this._hasMeaningfulCustom(this._choices.customBackground)) {
      this._choices.background = '__custom_background__';
    }
    if (group === 'customTimeline' && field === 'year') {
      this._choices.customTimelineYear = input.value.trim();
      this._choices.timeline = '__custom_timeline__';
    }
    this._saveStartPreset();
    this.shadowRoot.querySelector('#btn-next')?.toggleAttribute('disabled', !this._canGoNext());
  }

  _loadStartPreset() {
    try {
      const saved = JSON.parse(localStorage.getItem(START_PRESET_KEY) || 'null');
      if (!saved?.choices) return;
      this._choices = saved.choices || {};
      this._attrs = saved.attrs || this._choices.attributes || this._attrs;
      this._points = Number(saved.points) || 0;
      this._presetLoaded = true;
    } catch { console.warn('[CharacterCreator] Failed to load saved preset'); }
  }

  _saveStartPreset() {
    try {
      localStorage.setItem(START_PRESET_KEY, JSON.stringify({
        version: 1,
        saved_at: new Date().toISOString(),
        choices: this._choices,
        attrs: this._attrs,
        points: this._points
      }));
    } catch { /* localStorage may be unavailable */ }
  }

  _hasMeaningfulCustom(value) {
    return !!String(value?.name || value?.description || '').trim();
  }

  _hasKekkeiPotential() {
    const talentName = this._getTalentName();
    const bgName = this._getBackgroundName();
    const customTalentDesc = `${this._choices.customTalent?.description || ''}`;
    const customBgDesc = `${this._choices.customBackground?.name || ''} ${this._choices.customBackground?.description || ''}`;
    return talentName === '血继限界继承者' || bgName === '血继家族' || /血继|限界|遁|写轮眼|白眼|漩涡|尸骨脉/.test(`${customTalentDesc} ${customBgDesc}`);
  }

  _getTalentName() {
    if (this._choices.talent === '__custom_talent__') return '自定义天赋组合';
    if (this._choices.talent === '__no_talent__') return '无特殊天赋';
    return this._choices.talent || '努力的天才';
  }

  _getBackgroundName() {
    if (this._choices.background === '__custom_background__') return this._choices.customBackground?.name?.trim() || '自定义出身';
    return this._choices.background || '平民出身';
  }

  _finish() {
    const diff = GAME_DATA.getDifficulty(this._choices.difficulty||'下忍');
    const isCustomTalent = this._choices.talent === '__custom_talent__';
    const isNoTalent = this._choices.talent === '__no_talent__';
    const isCustomBackground = this._choices.background === '__custom_background__';
    const talent = isCustomTalent ? {
      id: '自定义天赋组合',
      description: this._choices.customTalent?.description?.trim() || '玩家自定义天赋',
      statBonus: {},
      effects: { custom: true }
    } : isNoTalent ? null : GAME_DATA.getTalent(this._choices.talent||'努力的天才');
    const bg = isCustomBackground ? {
      id: this._getBackgroundName(),
      description: this._choices.customBackground?.description?.trim() || '玩家自定义出身背景',
      equipment: { tools: { '普通苦无': { quantity: 3, quality: '普通' }, '手里剑': { quantity: 5, quality: '普通' } } },
      location: this._choices.customBackground?.location?.trim() || '木叶隐村',
      relationships: {}
    } : GAME_DATA.getBackground(this._choices.background||'平民出身');
    const av = this._choices.attributes || this._attrs || {chakra:5,spirit:5,willpower:5,speed:5,luck:5};
    const tb = talent?.statBonus||{};
    const s = stateManager.getDefaultState();
    // 直接使用原始性别，防止 AI 遗忘特殊设定（如伪娘、假小子）
    const finalGender = this._choices.gender === '__custom_gender__'
      ? (this._choices.customGender || '未知性别')
      : (this._choices.gender || '男性');

    s['玩家·姓名'] = this._choices.name.trim();
    s['玩家·忍阶'] = '忍校学生';
    s['玩家·正式忍阶'] = '忍校学生';
    s['玩家·战力等级'] = 'E级';
    s['玩家·所属村'] = '木叶隐村';
    s['玩家·出身'] = bg.id;
    s['玩家·查克拉属性'] = this._choices.chakraNature||['火'];
    s['玩家·难度'] = diff.id;
    s['玩家·性别'] = finalGender;
    
    // 公开身份表现，如果是伪娘表现为少女，假小子表现为少年
    s['玩家·公开身份'] = finalGender === '女性' ? '少女'
      : finalGender === '伪娘' ? '少女'
      : finalGender === '假小子' ? '少年'
      : '少年';
    s['玩家·个性'] = this._choices.persona || '';
    s['玩家·当前目标'] = '顺利通过忍校考核';
    s['玩家·存活'] = '是';
    s['玩家·声望标签'] = '忍校学生';
    
    const attr = GAME_DATA.buildInitialAttributes(av, tb);
    s['属性·查克拉'] = attr.chakra || 5;
    s['属性·当前查克拉'] = attr.chakra || 5;
    s['属性·精神力'] = attr.spirit || 5;
    s['属性·当前精神力'] = attr.spirit || 5;
    s['属性·意志力'] = attr.willpower || 5;
    s['属性·当前意志力'] = attr.willpower || 5;
    s['属性·体力'] = attr.stamina || 5;
    s['属性·当前体力'] = attr.stamina || 5;
    s['属性·速度'] = attr.speed || 5;
    s['属性·幸运'] = attr.luck || 5;
    
    if(bg.statBonus) {
      for(const[k,v] of Object.entries(bg.statBonus)){
        const flatMap = {chakra:'属性·查克拉',spirit:'属性·精神力',willpower:'属性·意志力',stamina:'属性·体力',speed:'属性·速度',luck:'属性·幸运'};
        const key = flatMap[k];
        if(key && s[key] != null){
          const scaled = this._scaleBackgroundBonus(k, v);
          s[key] += scaled;
          const curKey = {chakra:'属性·当前查克拉',spirit:'属性·当前精神力',willpower:'属性·当前意志力',stamina:'属性·当前体力',speed:'属性·速度',luck:'属性·幸运'}[k];
          if(curKey && s[curKey] != null) s[curKey] += scaled;
        }
      }
    }
    
    s['进度·经验'] = 0;
    s['进度·下一级经验'] = 100;
    s['进度·忍术熟练度'] = av.spirit || 0;
    s['进度·体术熟练度'] = av.speed || 0;
    s['进度·幻术熟练度'] = av.willpower || 0;
    s['进度·防御熟练度'] = 5;
    s['进度·已完成任务'] = 0;
    s['进度·称号'] = '忍校学生';
    s['进度·突破待处理'] = null;

    if(talent?.effects?.kekkei_genkai) {
      const kg = this._choices.chakraNature?.find(n=>GAME_DATA.getChakraNature(n)?.isKekkeiGenkai)||null;
      if(kg) s['技能·血继限界'] = kg;
    }
    
    s['进度·突破待处理'] = this._initialTrack(talent?.id);
    s['系统·回合数'] = 1;
    s['系统·当前节点'] = null;
    s['系统·当前分支'] = 'branch_main';
    
    s['进度·金钱'] = 500;
    s['物品·道具·苦无'] = { quantity: 5, quality: '普通' };
    if(bg.equipment){
      if(bg.equipment.tools) {
        for(const [name, item] of Object.entries(bg.equipment.tools)) {
          const existing = s['物品·道具·' + name];
          if(existing && existing.name === name) existing.quantity = (existing.quantity || 0) + (item.quantity || 1);
          else s['物品·道具·' + name] = item;
        }
      }
      if(bg.equipment.consumables) {
        for(const [name, item] of Object.entries(bg.equipment.consumables)) {
          s['物品·消耗品·' + name] = item;
        }
      }
    }
    if(bg.ryo) s['进度·金钱'] = bg.ryo;
    
    s['世界·地点'] = bg.location||'木叶隐村';

    const timelinePreset = GAME_DATA.getTimelinePreset(this._choices.timeline || 'konoha_52');
    const customYear = Number(this._choices.customTimelineYear);
    const resolveYear = () => {
      if (this._choices.timeline === '__custom_timeline__' && Number.isFinite(customYear) && customYear >= 1 && customYear <= 100) {
        return customYear;
      }
      return timelinePreset.year || 52;
    };
    const year = resolveYear();
    s['世界·年代'] = `木叶${year}年`;
    s['世界·时间'] = `木叶${year}年${timelinePreset.month || 1}月1日·清晨`;
    s['世界·天气'] = '晴';

    // 明确写在自定义设定里的初始身份优先于通用“忍校学生”模板。
    Object.assign(s, deriveOpeningState(this._choices, s));
    
    if (timelinePreset.era_summary) {
      const memSub = s['_memory'] || {};
      memSub.recent_summary = `[开局时代] ${timelinePreset.era_summary}`;
      s['_memory'] = memSub;
    }
    if (talent) {
      s['技能·天赋·' + talent.id] = {
        name: talent.id,
        description: talent.description || '',
        effects: talent.effects || {},
        custom: isCustomTalent
      };
    }
    const customSkill = this._normalizeCustomSkill();
    if (customSkill) {
      s['技能·忍术·' + customSkill.name] = {
        name: customSkill.name,
        rank: customSkill.rank,
        element: customSkill.element,
        cost: customSkill.cost,
        power: customSkill.power,
        type: customSkill.type,
        mastery: customSkill.mastery,
        description: customSkill.description,
        custom: true
      };
    }
    if (isCustomTalent || isCustomBackground || customSkill) {
      const memSub = s['_memory'] || {};
      const textToAppend = [
        isCustomTalent ? `自定义天赋: ${talent.id} - ${talent.description}` : '',
        isCustomBackground ? `自定义出身: ${bg.id} - ${bg.description}` : '',
        customSkill ? `自定义初始技能: ${customSkill.name} - ${customSkill.description}` : ''
      ].filter(Boolean).join('\n');
      
      if (!memSub.facts) memSub.facts = '';
      else memSub.facts += '\n';
      
      memSub.facts += textToAppend;
      
      s['_memory'] = memSub;
    }
    s['_opening_contract'] = createOpeningContract({ choices: this._choices, state: s });
    if(bg.relationships) {
      const relSub = s['_relationships'] || {};
      for (const [name, value] of Object.entries(bg.relationships)) {
        relSub[name] = typeof value === 'number'
          ? { affection: value, trust: 0, respect: 0, info: '初始背景关系', tags: ['背景'] }
          : { affection: 0, trust: 0, respect: 0, tags: [], ...value };
      }
      s['_relationships'] = relSub;
    }
    s['玩家·存活'] = '是';
    this._choices.attributes = { ...this._attrs };
    this._saveStartPreset();
    stateManager.restore(s);
    eventBus.emit('character:created', {
      name: s['玩家·姓名'],
      contract: s['_opening_contract']
    });
  }

  _normalizeCustomSkill() {
    const text = String(this._choices.customSkill?.description || '').trim();
    if (!text) return null;
    return {
      name: '自定义初始能力组合',
      type: 'jutsu',
      rank: '特',
      element: '无',
      cost: 0,
      power: 0,
      mastery: 100,
      description: text,
      custom: true
    };
  }

  _esc(str) {
    return escHtml(str);
  }

  _escAttr(str) {
    return escAttr(str);
  }

  _initialTrack(talentId) {
    const map = {
      '查克拉天才': 'ninjutsu',
      '努力的天才': 'balanced',
      '血继限界继承者': 'ninjutsu',
      '体术专家': 'taijutsu',
      '幻术天赋': 'genjutsu',
      '医疗忍者': 'medical',
      '暗部之姿': 'infiltration'
    };
    return map[talentId] || 'balanced';
  }

  _scaleBackgroundBonus(key, value) {
    const balance = GAME_DATA.balance;
    if (key === 'chakra') return value * balance.chakraMultiplier;
    if (key === 'spirit') return value * balance.spiritMultiplier;
    if (key === 'willpower') return value * balance.willpowerMultiplier;
    if (key === 'stamina') return value * balance.staminaMultiplier;
    if (key === 'speed') return value * balance.speedMultiplier;
    return value;
  }
}

customElements.define('character-creator', CharacterCreator);
export default CharacterCreator;
