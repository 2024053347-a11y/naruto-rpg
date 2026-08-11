import { eventBus } from '../core/event-bus.js';
import { stateManager } from '../core/state-manager.js';
import {
  listPersonaProfiles,
  getPersonaProfile,
  savePersonaProfile,
  deletePersonaProfile
} from '../core/persona-profiles.js';
import { GAME_DATA } from '../data/game-data.js';
import { CANON_DATABASE, displayCanonTechniqueName } from '../data/canon-database.js';
import { equipmentSystem } from '../systems/equipment-system.js';
import { createOpeningContract } from '../systems/opening-contract.js';
import {
  AI_COMPLETION_MODES,
  OPENING_DIFFICULTIES,
  OPENING_TEMPLATES,
  OFFICIAL_RANKS,
  START_PRESET_V2_KEY,
  applyOpeningTemplate,
  calculateCombatLevel,
  combatMasteriesFromAbilities,
  createOpeningDraft,
  initializeOpeningRuntime,
  loadOpeningPreset,
  normalizeOpeningDraft,
  serializeOpeningPreset
} from '../systems/opening-draft.js';
import { icon } from '../utils/icons.js';
import { escAttr, escHtml } from '../utils/format.js';
import { TIMELINE_FILE_ACCEPT } from '../core/timeline-file-codec.js';

const STAGES = [
  { id: 'campaign', label: '开局舞台', short: '舞台', mark: '壹' },
  { id: 'identity', label: '身份档案', short: '身份', mark: '贰' },
  { id: 'power', label: '实力配置', short: '实力', mark: '叁' },
  { id: 'assets', label: '资产与羁绊', short: '资产', mark: '肆' },
  { id: 'review', label: '核对开局', short: '核对', mark: '伍' }
];

const VARIANT_NAMES = {
  A: '档案工作台',
  B: '忍者登记卷',
  C: '开场编排台'
};

const ABILITY_TYPES = [
  ['jutsu', '忍术'], ['taijutsu', '体术'], ['genjutsu', '幻术'], ['support', '支援']
];
const ITEM_TYPES = [
  ['weapons', '武器'], ['armor', '防具'], ['tools', '忍具'], ['consumables', '消耗品']
];
const EQUIP_SLOTS = [
  ['', '不装备'], ['weapon', '武器位'], ['armor', '防具位'], ['accessory1', '饰品位一'], ['accessory2', '饰品位二']
];
const CHAKRA_NATURES = Object.keys(GAME_DATA.chakraNatures);
const OFFICIAL_RANK_OPTIONS = OFFICIAL_RANKS.map(rank => [rank, rank]);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => [index + 1, `${index + 1}月`]);
const DAY_OPTIONS = Array.from({ length: 30 }, (_, index) => [index + 1, `${index + 1}日`]);
const TECHNIQUE_TYPE_LABELS = { jutsu: '忍术', taijutsu: '体术', genjutsu: '幻术', support: '支援' };
const TECHNIQUE_RANKS = ['E', 'D', 'C', 'B', 'A', 'S', '特'];
const TECHNIQUE_ELEMENTS = ['无', '火', '风', '雷', '土', '水', '阴', '阳', '阴阳'];
const TECHNIQUE_ROLES = [['攻击', '攻击'], ['防御', '防御'], ['辅助', '辅助']];
const TECHNIQUE_RESOURCES = [['chakra', '查克拉'], ['stamina', '体力'], ['spirit', '精神力']];
const TECHNIQUE_CLASSES = [
  ['血继限界', '血继限界'], ['秘传', '秘传术'], ['瞳术', '瞳术'], ['医疗忍术', '医疗忍术'],
  ['封印术', '封印术'], ['时空间忍术', '时空间忍术'], ['仙术', '仙术'], ['分身术', '分身术'],
  ['结界忍术', '结界忍术'], ['禁术', '禁术'], ['剑术', '剑术'], ['手里剑术', '手里剑术'],
  ['武器术', '武器术'], ['忍体术', '忍体术'], ['咒印术', '咒印术']
];
const TECHNIQUE_PAGE_SIZES = [12, 24, 48];

class CharacterCreator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const params = new URLSearchParams(globalThis.location?.search || '');
    this._prototype = params.get('creatorPrototype') === '1';
    const requestedVariant = String(params.get('variant') || 'A').toUpperCase();
    this._variant = this._prototype && VARIANT_NAMES[requestedVariant] ? requestedVariant : 'A';
    this._stage = 0;
    this._notice = '';
    this._presetLoaded = false;
    this._presetMigrated = false;
    this._techniqueQuery = '';
    this._techniqueType = '';
    this._techniqueRank = '';
    this._techniqueElement = '';
    this._techniqueRole = '';
    this._techniqueResource = '';
    this._techniqueClass = '';
    this._techniquePage = 1;
    this._techniquePageSize = TECHNIQUE_PAGE_SIZES[0];
    this._selectedPersonaId = '';
    this._draft = createOpeningDraft();
    if (!this._prototype) this._loadPreset();
    this._onPrototypeKey = (event) => this._handlePrototypeKey(event);
  }

  connectedCallback() {
    globalThis.addEventListener?.('keydown', this._onPrototypeKey);
    this._render();
  }

  disconnectedCallback() {
    globalThis.removeEventListener?.('keydown', this._onPrototypeKey);
  }

  _loadPreset() {
    const result = loadOpeningPreset(globalThis.localStorage);
    this._draft = result.draft;
    this._presetLoaded = result.loaded;
    this._presetMigrated = result.migrated;
    if (result.migrated) this._savePreset();
  }

  _savePreset() {
    if (this._prototype) return;
    try {
      globalThis.localStorage?.setItem(START_PRESET_V2_KEY, JSON.stringify(serializeOpeningPreset(this._draft)));
    } catch (error) {
      console.warn('[CharacterCreator] Failed to save v2 opening preset:', error.message);
    }
  }

  _render() {
    this._syncCombatLevel();
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="creator creator--${this._variant.toLowerCase()}${this._prototype ? ' is-prototype' : ''}">
        ${this._header()}
        ${this._personaPanel()}
        ${this._presetBanner()}
        ${this._variant === 'B' ? this._variantB() : this._variant === 'C' ? this._variantC() : this._variantA()}
        ${this._notice ? `<div class="creator-notice" role="status">${icon('check', 15)}<span>${this._esc(this._notice)}</span></div>` : ''}
      </div>
      ${this._prototype ? this._prototypeSwitcher() : ''}
    `;
    this._bindEvents();
    this._loadPersonaProfiles();
  }

  _personaPanel() {
    return `
      <div class="persona-panel">
        <div class="persona-panel-title">${icon('user', 15)} 人设方案</div>
        <div class="persona-row">
          <select class="persona-select" id="persona-select">
            <option value="">— 选择已保存人设 —</option>
          </select>
          <button class="ghost-btn" type="button" data-action="persona-delete">删除</button>
        </div>
        <div class="persona-save-row">
          <input class="persona-name" id="persona-name" placeholder="人设名称，如「雾隐暗部·夜枭」" autocomplete="off" />
          <button class="ghost-btn" type="button" data-action="persona-save">保存当前人设</button>
        </div>
        <div class="persona-hint">人设长期保存在个人中心；开局前在下拉中选中即可切换。</div>
      </div>
    `;
  }

  async _loadPersonaProfiles() {
    const profiles = await listPersonaProfiles();
    const select = this.shadowRoot.querySelector('#persona-select');
    if (!select) return;
    const selectedId = profiles.some(profile => profile.id === this._selectedPersonaId)
      ? this._selectedPersonaId
      : '';
    this._selectedPersonaId = selectedId;
    select.innerHTML = [
      '<option value="">— 选择已保存人设 —</option>',
      ...profiles.map(profile => `<option value="${escAttr(profile.id)}">${escAttr(profile.name)}</option>`)
    ].join('');
    select.value = selectedId;
  }

  async _loadPersona(id) {
    if (!id) {
      this._selectedPersonaId = '';
      return;
    }
    const profile = await getPersonaProfile(id);
    if (!profile) {
      this._selectedPersonaId = '';
      this._loadPersonaProfiles();
      return;
    }
    this._selectedPersonaId = id;
    this._draft = normalizeOpeningDraft(profile.draft || this._draft);
    this._presetLoaded = true;
    this._savePreset();
    this._notice = `已切换人设「${profile.name}」。`;
    this._render();
  }

  async _savePersona() {
    const root = this.shadowRoot;
    const name = root.querySelector('#persona-name')?.value.trim();
    if (!name) { this._notice = '请先填写人设名称'; this._render(); return; }
    const id = await savePersonaProfile({ name, draft: this._draft });
    if (!id) { this._notice = '人设保存失败，请重试'; this._render(); return; }
    this._selectedPersonaId = id;
    this._notice = `已保存人设「${name}」，可在个人中心查看。`;
    this._render();
  }

  async _deletePersona() {
    const select = this.shadowRoot.querySelector('#persona-select');
    const id = select?.value;
    if (!id) { this._notice = '请先选择一个人设再删除'; this._render(); return; }
    const deleted = await deletePersonaProfile(id);
    this._selectedPersonaId = '';
    this._notice = deleted ? '人设已删除。' : '未找到要删除的人设。';
    this._render();
  }

  _header() {
    return `
      <header class="creator-header">
        <div class="creator-brand">
          <span class="creator-seal" aria-hidden="true">始</span>
          <div>
            <div class="creator-kicker">OPENING DOSSIER · V2</div>
            <h1>编写你的忍者开局</h1>
          </div>
        </div>
        <div class="creator-header-actions">
          ${this._prototype ? '<span class="prototype-badge">仅原型 · 不写入存档</span>' : ''}
          <button class="ghost-btn" type="button" data-action="import-timeline">${icon('export', 15)} 导入时间线</button>
          <input id="timeline-import-file" type="file" accept="${TIMELINE_FILE_ACCEPT}" hidden />
        </div>
      </header>
    `;
  }

  _presetBanner() {
    if (!this._presetLoaded || this._prototype) return '';
    return `
      <div class="preset-banner">
        <div>${icon('file-text', 17)}<span><strong>${this._presetMigrated ? '旧版卷轴已安全迁移' : '已载入上次的开局草稿'}</strong><small>v1 仍保留作回退；本次编辑只写入 v2 草稿。</small></span></div>
        <button class="icon-btn" type="button" title="重置开局草稿" aria-label="重置开局草稿" data-action="clear-preset">${icon('close', 16)}</button>
      </div>
    `;
  }

  _variantA() {
    return `
      <div class="workbench">
        <nav class="stage-rail" aria-label="开局配置阶段">
          <div class="rail-heading">档案目录</div>
          ${STAGES.map((stage, index) => this._stageButton(stage, index, 'rail')).join('')}
          <div class="rail-foot"><span>${this._completionCount()}/5</span> 章节已配置</div>
        </nav>
        <main class="editor-panel">
          ${this._stageHeader()}
          ${this._stageContent(this._stage)}
          ${this._stageNavigation()}
        </main>
        <aside class="live-summary" data-live-summary>
          ${this._summaryPanel()}
        </aside>
      </div>
    `;
  }

  _variantB() {
    return `
      <div class="scroll-layout">
        <main class="registration-scroll">
          <div class="scroll-title-row">
            <div><span>火之国忍籍记录 · 自由格式</span><h2>忍者登记卷</h2></div>
            <div class="scroll-stamp">第 ${this._draft.version} 版</div>
          </div>
          ${STAGES.map((stage, index) => `
            <section class="scroll-section" id="creator-section-${stage.id}">
              <header><span>${stage.mark}</span><div><small>SECTION 0${index + 1}</small><h3>${stage.label}</h3></div></header>
              ${this._stageContent(index)}
            </section>
          `).join('')}
          <div class="scroll-final">${this._finishButton(true)}</div>
        </main>
        <aside class="scroll-index">
          <div data-live-summary>${this._summaryPanel()}</div>
          <nav aria-label="登记卷章节">
            ${STAGES.map(stage => `<button type="button" data-action="scroll-section" data-target="${stage.id}">${stage.mark} · ${stage.short}</button>`).join('')}
          </nav>
        </aside>
      </div>
    `;
  }

  _variantC() {
    const current = STAGES[this._stage];
    return `
      <div class="composer">
        <div class="composer-flow" aria-label="开场编排进度">
          ${STAGES.map((stage, index) => this._stageButton(stage, index, 'flow')).join('<span class="flow-line"></span>')}
        </div>
        <div class="composer-grid">
          <aside class="scene-board">
            <div class="scene-board-kicker">SCENE ZERO</div>
            <h2>${this._esc(this._draft.campaign.openingHook || '尚未写下开场钩子')}</h2>
            <dl>
              <div><dt>时代</dt><dd>${this._esc(this._timelineLabel())}</dd></div>
              <div><dt>镜头落点</dt><dd>${this._esc(this._draft.campaign.location || '未定')}</dd></div>
              <div><dt>主角身份</dt><dd>${this._esc(this._draft.identity.publicIdentity || '未公开')}</dd></div>
              <div><dt>故事方向</dt><dd>${this._esc(this._draft.campaign.storyFocus || '自由展开')}</dd></div>
            </dl>
            <div class="scene-cast">
              <small>首幕已知人物</small>
              <div>${this._draft.relationships.length ? this._draft.relationships.map(item => `<span>${this._esc(item.name)}</span>`).join('') : '<em>尚无预设羁绊</em>'}</div>
            </div>
          </aside>
          <main class="composer-editor">
            <div class="composer-stage-title"><span>${current.mark}</span><div><small>COMPOSER STEP 0${this._stage + 1}</small><h2>${current.label}</h2></div></div>
            ${this._stageContent(this._stage)}
            ${this._stageNavigation()}
          </main>
        </div>
      </div>
    `;
  }

  _stageButton(stage, index, mode) {
    const active = index === this._stage;
    const done = index < this._stage;
    if (mode === 'flow') {
      return `<button class="flow-node${active ? ' active' : ''}${done ? ' done' : ''}" type="button" data-action="stage" data-stage="${index}"><span>${done ? icon('check', 13) : stage.mark}</span><small>${stage.short}</small></button>`;
    }
    return `<button class="rail-step${active ? ' active' : ''}${done ? ' done' : ''}" type="button" data-action="stage" data-stage="${index}"><span>${done ? icon('check', 14) : stage.mark}</span><div><small>0${index + 1}</small>${stage.label}</div></button>`;
  }

  _stageHeader() {
    const stage = STAGES[this._stage];
    const descriptions = [
      '先定时代、阵营和故事镜头。模板只负责填充，之后所有字段都能改。',
      '身体、呈现、称呼与公开身份彼此独立，不再被一个性别选项捆绑。',
      '直接填写最终数值；忍阶参考线只是基准，不会限制你的组合。',
      '能力、装备和初始羁绊均可添加任意多条，页面会自然向下延伸。',
      '核对本地将要写入的完整档案，并决定 AI 对空白内容的权限。'
    ];
    return `<header class="stage-header"><div><small>CHAPTER 0${this._stage + 1}</small><h2>${stage.label}</h2></div><p>${descriptions[this._stage]}</p></header>`;
  }

  _stageContent(index) {
    if (index === 0) return this._campaignSection();
    if (index === 1) return this._identitySection();
    if (index === 2) return this._powerSection();
    if (index === 3) return this._assetsSection();
    return this._reviewSection();
  }

  _campaignSection() {
    const campaign = this._draft.campaign;
    return `
      <div class="section-block">
        <div class="block-heading"><div><small>SCENARIO</small><h3>情景模板</h3></div><p>模板之间没有时代、忍村或实力限制。</p></div>
        <div class="template-grid">
          ${OPENING_TEMPLATES.map(template => `
            <button class="template-card${template.id === this._draft.templateId ? ' selected' : ''}" style="--template-accent:${template.accent}" type="button" data-action="apply-template" data-template="${template.id}">
              <span>${template.eyebrow}</span><strong>${template.label}</strong><small>${template.description}</small>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>WORLD</small><h3>时代与落点</h3></div></div>
        <div class="form-grid cols-2">
          ${this._selectField('开局时代', 'campaign.timeline', campaign.timeline, this._timelineOptions())}
          ${campaign.timeline === '__custom_timeline__' ? this._inputField('自定义木叶纪年', 'campaign.customYear', campaign.customYear, 'number') : this._inputField('所属阵营 / 组织', 'campaign.affiliation', campaign.affiliation)}
          ${campaign.timeline === '__custom_timeline__' ? this._inputField('所属阵营 / 组织', 'campaign.affiliation', campaign.affiliation) : ''}
          ${this._inputField('起始地点', 'campaign.location', campaign.location)}
          ${this._selectField('开局月份', 'campaign.month', campaign.month, MONTH_OPTIONS)}
          ${this._selectField('开局日期', 'campaign.day', campaign.day, DAY_OPTIONS)}
        </div>
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>PRESSURE</small><h3>故事压力</h3></div><p>难度不再冒用忍阶名称。</p></div>
        <div class="choice-row five">
          ${OPENING_DIFFICULTIES.map(item => `<button class="choice-chip${campaign.difficulty === item.id ? ' selected' : ''}" type="button" data-action="set-value" data-path="campaign.difficulty" data-value="${item.id}"><strong>${item.label}</strong><span>${item.description}</span></button>`).join('')}
        </div>
      </div>
      <div class="section-block">
        <div class="form-grid cols-2">
          ${this._selectField('原作剧情介入', 'campaign.canonInvolvement', campaign.canonInvolvement, ['完全原创', '边缘交汇', '平行参与', '深度交汇', '改写原作', '自定义'])}
          ${this._inputField('故事基调', 'campaign.storyTone', campaign.storyTone)}
          ${this._inputField('故事重点', 'campaign.storyFocus', campaign.storyFocus)}
          ${this._inputField('当前目标', 'campaign.goal', campaign.goal)}
        </div>
        ${this._textareaField('开场钩子', 'campaign.openingHook', campaign.openingHook, '第一幕从什么异常、命令、相遇或危机开始？')}
      </div>
    `;
  }

  _identitySection() {
    const identity = this._draft.identity;
    return `
      <div class="section-block">
        <div class="block-heading"><div><small>CORE</small><h3>基本身份</h3></div></div>
        <div class="form-grid cols-3">
          ${this._inputField('忍名 *', 'identity.name', identity.name, 'text', '例如：雨宫澪')}
          ${this._inputField('身体年龄', 'identity.physicalAge', identity.physicalAge, 'number')}
          ${this._inputField('灵魂年龄', 'identity.soulAge', identity.soulAge, 'number')}
          ${this._inputField('性别认同', 'identity.gender', identity.gender)}
          ${this._inputField('身体设定', 'identity.bodySetting', identity.bodySetting)}
          ${this._inputField('外在呈现', 'identity.presentation', identity.presentation)}
          ${this._inputField('偏好称呼', 'identity.address', identity.address)}
          ${this._inputField('出身背景', 'identity.background', identity.background)}
          ${this._inputField('公开身份', 'identity.publicIdentity', identity.publicIdentity)}
        </div>
      </div>
      <div class="section-block">
        <div class="form-grid cols-2">
          ${this._textareaField('外貌与可见特征', 'identity.appearance', identity.appearance, '体型、发色、服装、伤痕、气质……')}
          ${this._textareaField('性格与行为倾向', 'identity.personality', identity.personality, '性格、习惯、底线、恐惧与处事方式……')}
        </div>
        ${this._textareaField('秘密与真实身份', 'identity.secrets', identity.secrets, '这些是真实设定，但未获知的 NPC 不会自动知道。')}
      </div>
    `;
  }

  _powerSection() {
    const power = this._draft.power;
    const attrs = [
      ['chakra', '查克拉', 'chakra'], ['vitality', '生命力', 'defense'], ['spirit', '精神力', 'spirit'],
      ['stamina', '体力', 'willpower'], ['speed', '速度', 'speed'], ['luck', '幸运', 'luck']
    ];
    return `
      <div class="section-block">
        <div class="block-heading"><div><small>RANK</small><h3>身份与实战分离</h3></div><p>官方忍阶与实际战力可以完全不同。</p></div>
        <div class="form-grid cols-2">
          ${this._selectField('官方正式忍阶', 'power.officialRank', power.officialRank, OFFICIAL_RANK_OPTIONS)}
          <div class="field derived-power-field"><span>实际战力等级</span><output data-combat-level-output aria-live="polite">${this._esc(power.combatLevel)}</output><small>由六项属性与实战造诣统一评定</small></div>
        </div>
        ${this._rankBenchmark()}
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>ATTRIBUTES</small><h3>六项最终数值</h3></div><p>无点数池，不会自动缩放。</p></div>
        <div class="attribute-grid">
          ${attrs.map(([key, label, iconName]) => `<label class="attribute-field"><span>${icon(iconName, 17)}${label}</span><input data-path="power.attributes.${key}" type="number" min="0" max="9999" value="${this._escAttr(power.attributes[key])}" /></label>`).join('')}
        </div>
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>NATURE</small><h3>查克拉性质</h3></div><p>可多选基础属性与血继性质。</p></div>
        <div class="nature-grid">
          ${CHAKRA_NATURES.map(nature => `<button class="nature-chip${power.chakraNatures.includes(nature) ? ' selected' : ''}" type="button" data-action="toggle-nature" data-nature="${nature}">${icon(GAME_DATA.chakraNatures[nature]?.emoji || 'chakra', 15)} ${nature}</button>`).join('')}
        </div>
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>GIFTS</small><h3>天赋与血继</h3></div><button class="add-btn" type="button" data-action="add-entry" data-list="talents">＋ 添加条目</button></div>
        <div class="entry-list">${this._draft.talents.length ? this._draft.talents.map((entry, index) => this._talentEditor(entry, index)).join('') : this._emptyState('尚未设置天赋或血继；这也是有效开局。')}</div>
      </div>
    `;
  }

  _assetsSection() {
    return `
      <div class="section-block">
        <div class="block-heading"><div><small>TECHNIQUES</small><h3>能力与术式</h3></div><button class="add-btn" type="button" data-action="add-entry" data-list="abilities">＋ 自创忍术 / 能力</button></div>
        ${this._techniquePicker()}
        <div class="entry-list ability-entry-list">${this._draft.abilities.length ? this._draft.abilities.map((entry, index) => this._abilityEditor(entry, index)).join('') : this._emptyState('尚未选择初始忍术；可以从忍术库挑选，也可以自创。')}</div>
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>LOADOUT</small><h3>物品与装备</h3></div><div class="block-actions"><label class="ryo-field">初始両 <input data-path="resources.ryo" type="number" min="0" value="${this._escAttr(this._draft.resources.ryo)}" /></label><button class="add-btn" type="button" data-action="add-entry" data-list="equipment">＋ 添加物品</button></div></div>
        <div class="entry-list">${this._draft.equipment.length ? this._draft.equipment.map((entry, index) => this._equipmentEditor(entry, index)).join('') : this._emptyState('行囊为空。')}</div>
      </div>
      <div class="section-block">
        <div class="block-heading"><div><small>BONDS</small><h3>初始人物羁绊</h3></div><button class="add-btn" type="button" data-action="add-entry" data-list="relationships">＋ 添加人物</button></div>
        <div class="entry-list">${this._draft.relationships.length ? this._draft.relationships.map((entry, index) => this._relationshipEditor(entry, index)).join('') : this._emptyState('没有预设羁绊；开场仍可自然遇到新人物。')}</div>
      </div>
    `;
  }

  _reviewSection() {
    const draft = this._draft;
    return `
      <div class="review-hero">
        <div><small>READY FOR SCENE ONE</small><h2>${this._esc(draft.identity.name || '未命名忍者')}</h2><p>${this._esc(draft.identity.publicIdentity || '身份未公开')} · ${this._esc(draft.power.officialRank || '无正式忍阶')} · ${this._esc(draft.campaign.affiliation || '无所属')}</p></div>
        <span>${this._esc(draft.power.combatLevel || '未评定')}</span>
      </div>
      <div class="review-grid">
        <section><small>开局镜头</small><h3>${this._esc(draft.campaign.location || '未知地点')}</h3><p>${this._esc(draft.campaign.openingHook || '未填写开场钩子')}</p></section>
        <section><small>身份</small><h3>${this._esc(draft.identity.presentation || '未设定呈现')}</h3><p>${this._esc(draft.identity.appearance || draft.identity.personality || '未填写外貌与性格')}</p></section>
        <section><small>实力</small><h3>${draft.abilities.length} 项能力 · ${draft.talents.length} 项天赋/血继</h3><p>${this._esc(draft.power.chakraNatures.join('、') || '无查克拉性质')}</p></section>
        <section><small>随行内容</small><h3>${draft.equipment.length} 件物品 · ${draft.relationships.length} 段羁绊</h3><p>${this._esc(draft.relationships.map(item => item.name).join('、') || '无预设人物')}</p></section>
      </div>
      <div class="section-block completion-block">
        <div class="block-heading"><div><small>AI BOUNDARY</small><h3>AI 补全权限</h3></div><p>无论选择哪项，玩家填写内容都不会被覆盖。</p></div>
        <div class="completion-modes">
          ${AI_COMPLETION_MODES.map(mode => `<button class="completion-card${draft.campaign.aiCompletionMode === mode.id ? ' selected' : ''}" type="button" data-action="set-value" data-path="campaign.aiCompletionMode" data-value="${mode.id}"><span>${draft.campaign.aiCompletionMode === mode.id ? icon('check', 15) : ''}</span><strong>${mode.label}${mode.id === 'fill' ? '<em>默认</em>' : ''}</strong><small>${mode.description}</small></button>`).join('')}
        </div>
      </div>
      ${this._finishButton(false)}
    `;
  }

  _talentEditor(entry, index) {
    return `<article class="entry-card"><header><div><span class="entry-index">${String(index + 1).padStart(2, '0')}</span><strong>${this._esc(entry.name || '新天赋')}</strong></div>${this._removeButton('talents', index)}</header><div class="form-grid cols-3">${this._selectField('类别', `talents.${index}.type`, entry.type, [['talent', '天赋'], ['kekkei_genkai', '血继限界']])}${this._inputField('名称', `talents.${index}.name`, entry.name)}${this._inputField('阶段 / 等级', `talents.${index}.rank`, entry.rank)}${this._inputField('掌握度', `talents.${index}.mastery`, entry.mastery, 'number')}</div><div class="form-grid cols-2">${this._textareaField('能力描述', `talents.${index}.description`, entry.description)}${this._textareaField('限制与代价', `talents.${index}.limitations`, entry.limitations)}</div></article>`;
  }

  _abilityEditor(entry, index) {
    const resourceKey = { 查克拉: 'chakra', 精神力: 'spirit', 体力: 'stamina' }[entry.resourceType] || 'chakra';
    const resourcePool = Math.max(0, Number(this._draft.power.attributes[resourceKey]) || 0);
    const cost = Math.max(0, Number(entry.cost) || 0);
    const uses = cost > 0 ? Math.floor(resourcePool / cost) : '不限';
    const costLabel = `单次消耗（当前约可用${uses}次）`;
    const techniqueAttr = entry.technique_id ? ` data-technique-id="${this._escAttr(entry.technique_id)}"` : '';
    if (entry.source === 'canon' && entry.technique_id) {
      return `<article class="entry-card canon-ability-card" data-ability-entry${techniqueAttr}><header><div><span class="entry-index">${String(index + 1).padStart(2, '0')}</span><strong>${this._esc(entry.name || '正史忍术')}</strong><em class="source-badge">正史忍术库</em></div>${this._removeButton('abilities', index)}</header><div class="canon-ability-facts"><span>${this._esc(TECHNIQUE_TYPE_LABELS[entry.type] || '能力')}</span><span>${this._esc(entry.rank)}级</span><span>${this._esc(entry.element || '无属性')}</span><span>${this._esc(entry.resourceType)} ${this._esc(entry.cost)}</span><span>威力 ${this._esc(entry.power)}</span><span>约可用 ${this._esc(uses)} 次</span></div><p class="canon-ability-description">${this._esc(entry.description || '忍术库暂无描述。')}</p><div class="canon-mastery">${this._inputField('初始掌握度（可调整）', `abilities.${index}.mastery`, entry.mastery, 'number')}</div></article>`;
    }
    const sourceBadge = entry.source === 'custom' ? '<em class="source-badge custom">自创</em>' : '';
    return `<article class="entry-card" data-ability-entry${techniqueAttr}><header><div><span class="entry-index">${String(index + 1).padStart(2, '0')}</span><strong>${this._esc(entry.name || '新能力')}</strong>${sourceBadge}</div>${this._removeButton('abilities', index)}</header><div class="form-grid cols-4">${this._selectField('类别', `abilities.${index}.type`, entry.type, ABILITY_TYPES)}${this._inputField('名称', `abilities.${index}.name`, entry.name)}${this._inputField('等级', `abilities.${index}.rank`, entry.rank)}${this._inputField('属性', `abilities.${index}.element`, entry.element)}${this._selectField('消耗资源', `abilities.${index}.resourceType`, entry.resourceType, [['查克拉','查克拉'],['精神力','精神力'],['体力','体力']])}${this._inputField(costLabel, `abilities.${index}.cost`, entry.cost, 'number')}${this._inputField('威力', `abilities.${index}.power`, entry.power, 'number')}${this._inputField('掌握度', `abilities.${index}.mastery`, entry.mastery, 'number')}</div><div class="form-grid cols-2">${this._textareaField('表现与用途', `abilities.${index}.description`, entry.description)}${this._textareaField('限制与代价', `abilities.${index}.limitations`, entry.limitations)}</div></article>`;
  }

  _rankBenchmark() {
    const rank = this._draft.power.officialRank;
    const benchmark = GAME_DATA.rankBenchmarks[rank];
    if (!benchmark) return '<div class="benchmark muted" data-rank-benchmark><span>当前忍阶没有预设参考线；数值仍可自由填写。</span></div>';
    return `<div class="benchmark" data-rank-benchmark><span>${this._esc(rank)}中性参考线</span>${Object.entries(benchmark).filter(([key]) => key !== 'skillMastery').map(([key, range]) => `<em>${this._attrLabel(key)} ${range[0]}–${range[1]}</em>`).join('')}</div>`;
  }

  _techniquePicker() {
    return `
      <div class="technique-picker" data-technique-picker>
        <div class="technique-picker-heading">
          <div><strong>从正史忍术库选择</strong><span>已接入 ${CANON_DATABASE.getRecords('techniques').length} 条术式；添加后只需调整初始掌握度。</span></div>
        </div>
        <div class="technique-toolbar">
          <label class="technique-search"><span>搜索名称、别名、属性或分类</span><input type="search" data-technique-query value="${this._escAttr(this._techniqueQuery)}" placeholder="例如：豪火球、医疗、幻术、雷遁" /></label>
          <label><span>类型</span><select data-technique-filter="type"><option value="">全部类型</option>${Object.entries(TECHNIQUE_TYPE_LABELS).filter(([key]) => key !== 'support').map(([value, label]) => `<option value="${value}"${this._techniqueType === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>等级</span><select data-technique-filter="rank"><option value="">全部等级</option>${TECHNIQUE_RANKS.map(rank => `<option value="${rank}"${this._techniqueRank === rank ? ' selected' : ''}>${rank === '特' ? '特殊等级' : `${rank}级`}</option>`).join('')}</select></label>
          <label><span>查克拉属性</span><select data-technique-filter="element"><option value="">全部属性</option>${TECHNIQUE_ELEMENTS.map(element => `<option value="${element}"${this._techniqueElement === element ? ' selected' : ''}>${element === '无' ? '无属性' : element}</option>`).join('')}</select></label>
          <label><span>用途</span><select data-technique-filter="role"><option value="">全部用途</option>${TECHNIQUE_ROLES.map(([value, label]) => `<option value="${value}"${this._techniqueRole === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>消耗资源</span><select data-technique-filter="resource"><option value="">全部资源</option>${TECHNIQUE_RESOURCES.map(([value, label]) => `<option value="${value}"${this._techniqueResource === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>术式分类</span><select data-technique-filter="class"><option value="">全部分类</option>${TECHNIQUE_CLASSES.map(([value, label]) => `<option value="${value}"${this._techniqueClass === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        </div>
        <div class="technique-results" data-technique-results>${this._techniqueResults()}</div>
      </div>
    `;
  }

  _techniqueResults() {
    const { records, total, page, pageCount, start, end } = this._filteredTechniques();
    const pageSizeSelect = `<label class="technique-page-size"><span>每页</span><select data-technique-page-size>${TECHNIQUE_PAGE_SIZES.map(size => `<option value="${size}"${this._techniquePageSize === size ? ' selected' : ''}>${size} 条</option>`).join('')}</select></label>`;
    if (!records.length) return `<div class="technique-result-meta"><span>共 0 条</span>${pageSizeSelect}</div><div class="technique-empty">没有匹配的忍术，请换一个名称、别名或筛选条件。</div>`;
    return `
      <div class="technique-result-meta"><span>共 ${total} 条 · 当前 ${start}–${end}</span>${pageSizeSelect}</div>
      ${this._techniquePagination(page, pageCount)}
      <div class="technique-result-grid">
        ${records.map(technique => {
          const name = displayCanonTechniqueName(technique);
          const added = this._isTechniqueAdded(technique);
          const type = TECHNIQUE_TYPE_LABELS[technique.type] || '能力';
          const rank = technique.rank === '特' ? '特殊等级' : `${technique.rank}级`;
          const element = (technique.elements || []).filter(Boolean).join('、') || '无属性';
          return `<article class="technique-result-card${added ? ' added' : ''}" data-technique-result="${this._escAttr(technique.id)}"><header><div><strong>${this._esc(name)}</strong><span>${this._esc(type)} · ${this._esc(rank)} · ${this._esc(element)}</span></div><button type="button" data-add-technique="${this._escAttr(technique.id)}"${added ? ' disabled' : ''}>${added ? '已添加' : '添加'}</button></header><p>${this._esc(this._truncate(technique.summary || '忍术库暂无描述。', 118))}</p><footer><span>消耗 ${this._esc(technique.cost ?? 0)}</span><span>威力 ${this._esc(technique.power ?? 0)}</span><code>${this._esc(technique.id)}</code></footer></article>`;
        }).join('')}
      </div>
    `;
  }

  _filteredTechniques() {
    const terms = String(this._techniqueQuery || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let records = CANON_DATABASE.getRecords('techniques');
    if (this._techniqueType) records = records.filter(item => item.type === this._techniqueType);
    if (this._techniqueRank) records = records.filter(item => item.rank === this._techniqueRank);
    if (this._techniqueElement) records = records.filter(item => (item.elements || []).includes(this._techniqueElement));
    if (this._techniqueResource) records = records.filter(item => item.resource === this._techniqueResource);
    if (this._techniqueRole) records = records.filter(item => this._techniqueClassTags(item).includes(this._techniqueRole));
    if (this._techniqueClass) records = records.filter(item => this._techniqueClassTags(item).some(tag => tag === this._techniqueClass || tag.startsWith(`${this._techniqueClass}~`)));
    if (terms.length) {
      records = records.filter(item => {
        const searchText = [
          displayCanonTechniqueName(item), item.name, item.id,
          ...(item.aliases || []), ...(item.lookup_aliases || []),
          ...(item.classes || []), ...(item.lookup_classes || []),
          ...(item.elements || []), ...(item.lookup_elements || [])
        ].join(' ').toLocaleLowerCase();
        return terms.every(term => searchText.includes(term));
      });
    }
    const total = records.length;
    const pageSize = TECHNIQUE_PAGE_SIZES.includes(Number(this._techniquePageSize)) ? Number(this._techniquePageSize) : TECHNIQUE_PAGE_SIZES[0];
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(pageCount, Number(this._techniquePage) || 1));
    this._techniquePage = page;
    const offset = (page - 1) * pageSize;
    return {
      total,
      page,
      pageCount,
      start: total ? offset + 1 : 0,
      end: Math.min(total, offset + pageSize),
      records: records.slice(offset, offset + pageSize)
    };
  }

  _techniquePagination(page, pageCount) {
    const pageNumbers = new Set([1, pageCount]);
    for (let current = Math.max(1, page - 2); current <= Math.min(pageCount, page + 2); current++) pageNumbers.add(current);
    const ordered = [...pageNumbers].sort((a, b) => a - b);
    let previous = 0;
    const buttons = ordered.map(current => {
      const gap = previous && current - previous > 1 ? '<span class="technique-page-gap">…</span>' : '';
      previous = current;
      return `${gap}<button type="button" data-technique-page="${current}"${current === page ? ' class="active" aria-current="page"' : ''}>${current}</button>`;
    }).join('');
    return `<nav class="technique-pagination" aria-label="忍术库分页"><button type="button" data-technique-page="prev"${page <= 1 ? ' disabled' : ''}>← 上一页</button><div class="technique-page-numbers">${buttons}</div><span data-technique-page-state>第 ${page} / ${pageCount} 页</span><button type="button" data-technique-page="next"${page >= pageCount ? ' disabled' : ''}>下一页 →</button></nav>`;
  }

  _techniqueClassTags(technique) {
    return (technique.classes || []).flatMap(value => String(value).split(',')).map(value => value.trim()).filter(Boolean);
  }

  _isTechniqueAdded(technique) {
    const name = displayCanonTechniqueName(technique);
    return this._draft.abilities.some(item => item.technique_id === technique.id || (item.type === technique.type && item.name === name));
  }

  _truncate(value, maxLength) {
    const source = String(value || '').trim();
    return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
  }

  _equipmentEditor(entry, index) {
    return `<article class="entry-card"><header><div><span class="entry-index">${String(index + 1).padStart(2, '0')}</span><strong>${this._esc(entry.name || '新物品')}</strong></div>${this._removeButton('equipment', index)}</header><div class="form-grid cols-4">${this._selectField('分类', `equipment.${index}.category`, entry.category, ITEM_TYPES)}${this._inputField('名称', `equipment.${index}.name`, entry.name)}${this._inputField('数量', `equipment.${index}.quantity`, entry.quantity, 'number')}${this._inputField('品质', `equipment.${index}.quality`, entry.quality)}${this._selectField('初始装备槽', `equipment.${index}.equippedSlot`, entry.equippedSlot, EQUIP_SLOTS)}</div>${this._textareaField('物品描述', `equipment.${index}.description`, entry.description)}</article>`;
  }

  _relationshipEditor(entry, index) {
    return `<article class="entry-card relation-entry"><header><div><span class="entry-index">${String(index + 1).padStart(2, '0')}</span><strong>${this._esc(entry.name || '新人物')}</strong></div>${this._removeButton('relationships', index)}</header><div class="form-grid cols-2">${this._inputField('人物姓名', `relationships.${index}.name`, entry.name)}${this._inputField('关系定位', `relationships.${index}.relation`, entry.relation, 'text', '导师 / 亲人 / 宿敌 / 债主……')}</div><div class="form-grid cols-2">${this._textareaField('公开经历', `relationships.${index}.publicHistory`, entry.publicHistory, '双方公开承认或可被调查到的历史')}${this._textareaField('私密真相 / 真实心理', `relationships.${index}.secret`, entry.secret, '不会自动透露给其他 NPC')}</div><div class="relation-values">${this._rangeField('好感', `relationships.${index}.affection`, entry.affection)}${this._rangeField('信任', `relationships.${index}.trust`, entry.trust)}${this._rangeField('尊重', `relationships.${index}.respect`, entry.respect)}</div></article>`;
  }

  _inputField(label, path, value, type = 'text', placeholder = '') {
    return `<label class="field"><span>${label}</span><input data-path="${path}" type="${type}" value="${this._escAttr(value)}" ${type === 'number' ? 'min="0" max="9999"' : ''} placeholder="${this._escAttr(placeholder)}" /></label>`;
  }

  _textareaField(label, path, value, placeholder = '') {
    return `<label class="field textarea-field"><span>${label}</span><textarea data-path="${path}" rows="3" placeholder="${this._escAttr(placeholder)}">${this._esc(value)}</textarea></label>`;
  }

  _selectField(label, path, value, options) {
    const normalized = options.map(option => Array.isArray(option) ? option : [option, option]);
    return `<label class="field"><span>${label}</span><select data-path="${path}">${normalized.map(([optionValue, optionLabel]) => `<option value="${this._escAttr(optionValue)}"${String(optionValue) === String(value) ? ' selected' : ''}>${this._esc(optionLabel)}</option>`).join('')}</select></label>`;
  }

  _rangeField(label, path, value) {
    return `<label><span>${label}<output>${this._esc(value)}</output></span><input data-path="${path}" type="range" min="-100" max="100" step="1" value="${this._escAttr(value)}" /></label>`;
  }

  _removeButton(list, index) {
    return `<button class="icon-btn danger" type="button" title="删除此条目" aria-label="删除此条目" data-action="remove-entry" data-list="${list}" data-index="${index}">${icon('close', 15)}</button>`;
  }

  _emptyState(text) {
    return `<div class="empty-state"><span>空</span><p>${text}</p></div>`;
  }

  _stageNavigation() {
    return `<div class="stage-nav"><button class="secondary-btn" type="button" data-action="prev"${this._stage === 0 ? ' disabled' : ''}>← 上一章</button>${this._stage === STAGES.length - 1 ? this._finishButton(true) : `<button class="primary-btn" type="button" data-action="next">下一章 →</button>`}</div>`;
  }

  _finishButton(compact) {
    const label = this._prototype ? '检查原型档案' : '封存档案并生成开场';
    return `<button class="primary-btn finish-btn${compact ? ' compact' : ''}" type="button" data-action="finish">${icon('check', 16)} ${label}</button>`;
  }

  _summaryPanel() {
    const draft = this._draft;
    const attrs = draft.power.attributes;
    return `
      <div class="summary-heading"><small>LIVE DOSSIER</small><h3>${this._esc(draft.identity.name || '未命名忍者')}</h3><span>${this._esc(draft.power.combatLevel || '未评定')}</span></div>
      <div class="summary-identity"><strong>${this._esc(draft.identity.publicIdentity || '身份未公开')}</strong><p>${this._esc(draft.campaign.affiliation || '无所属')} · ${this._esc(draft.power.officialRank || '无正式忍阶')}</p></div>
      <dl class="summary-facts">
        <div><dt>时代</dt><dd>${this._esc(this._timelineLabel())}</dd></div>
        <div><dt>地点</dt><dd>${this._esc(draft.campaign.location || '未定')}</dd></div>
        <div><dt>目标</dt><dd>${this._esc(draft.campaign.goal || '未定')}</dd></div>
      </dl>
      <div class="mini-attrs">${[['查', attrs.chakra], ['生', attrs.vitality], ['精', attrs.spirit], ['体', attrs.stamina], ['速', attrs.speed], ['运', attrs.luck]].map(([label, value]) => `<span><small>${label}</small><strong>${value}</strong></span>`).join('')}</div>
      <div class="summary-counts"><span><strong>${draft.talents.length}</strong> 天赋/血继</span><span><strong>${draft.abilities.length}</strong> 能力</span><span><strong>${draft.equipment.length}</strong> 物品</span><span><strong>${draft.relationships.length}</strong> 羁绊</span></div>
      <div class="summary-mode"><small>AI 权限</small><strong>${this._esc(AI_COMPLETION_MODES.find(mode => mode.id === draft.campaign.aiCompletionMode)?.label || '补全空白')}</strong></div>
    `;
  }

  _timelineOptions() {
    return Object.values(GAME_DATA.timelinePresets).map(item => [item.id, item.label]);
  }

  _timelineLabel() {
    const { month, day } = this._draft.campaign;
    if (this._draft.campaign.timeline === '__custom_timeline__') return `木叶${this._draft.campaign.customYear}年${month}月${day}日 · 自定义`;
    const label = GAME_DATA.timelinePresets[this._draft.campaign.timeline]?.label || this._draft.campaign.timeline;
    return `${label} · ${month}月${day}日`;
  }

  _attrLabel(key) {
    return { chakra: '查', vitality: '生', stamina: '体', spirit: '精', speed: '速', luck: '运' }[key] || key;
  }

  _completionCount() {
    const draft = this._draft;
    return [
      !!(draft.campaign.location && draft.campaign.timeline),
      !!draft.identity.name,
      Object.values(draft.power.attributes).every(value => Number.isFinite(Number(value))),
      !!(draft.abilities.length || draft.equipment.length || draft.relationships.length || draft.resources.ryo >= 0),
      !!draft.campaign.aiCompletionMode
    ].filter(Boolean).length;
  }

  _prototypeSwitcher() {
    return `<div class="prototype-switcher" role="group" aria-label="创建器原型变体"><button type="button" aria-label="上一个原型" data-action="variant-prev">←</button><span><small>CREATOR PROTOTYPE</small><strong>${this._variant} — ${VARIANT_NAMES[this._variant]}</strong></span><button type="button" aria-label="下一个原型" data-action="variant-next">→</button></div>`;
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll('[data-path]').forEach(control => {
      const eventName = control.matches('select,input[type="range"]') ? 'change' : 'input';
      control.addEventListener(eventName, () => {
        const numeric = control.type === 'number' || control.type === 'range' || ['campaign.month', 'campaign.day'].includes(control.dataset.path);
        this._setPath(control.dataset.path, numeric ? Number(control.value) : control.value);
        if (control.dataset.path.startsWith('power.attributes.')) this._syncCombatLevel();
        if (control.dataset.path === 'power.officialRank') this._refreshRankBenchmark();
        if (control.type === 'range') control.closest('label')?.querySelector('output')?.replaceChildren(control.value);
        this._savePreset();
        this._refreshSummary();
        if (control.dataset.path === 'campaign.timeline') this._render();
      });
      if (eventName !== 'change') {
        control.addEventListener('change', () => {
          this._setPath(control.dataset.path, control.type === 'number' ? Number(control.value) : control.value);
          this._draft = normalizeOpeningDraft(this._draft);
          this._savePreset();
          this._refreshSummary();
        });
      }
    });

    this.shadowRoot.querySelectorAll('[data-action]').forEach(control => {
      control.addEventListener('click', event => this._handleAction(event.currentTarget));
    });

    const personaSelect = this.shadowRoot.querySelector('#persona-select');
    personaSelect?.addEventListener('change', () => this._loadPersona(personaSelect.value));

    const techniquePicker = this.shadowRoot.querySelector('[data-technique-picker]');
    techniquePicker?.addEventListener('input', event => {
      const input = event.target.closest?.('[data-technique-query]');
      if (!input) return;
      this._techniqueQuery = input.value;
      this._techniquePage = 1;
      this._refreshTechniqueResults();
    });
    techniquePicker?.addEventListener('change', event => {
      const pageSize = event.target.closest?.('[data-technique-page-size]');
      if (pageSize) {
        this._techniquePageSize = Number(pageSize.value);
        this._techniquePage = 1;
        this._refreshTechniqueResults();
        return;
      }
      const filter = event.target.closest?.('[data-technique-filter]');
      if (!filter) return;
      const stateKey = {
        type: '_techniqueType', rank: '_techniqueRank', element: '_techniqueElement',
        role: '_techniqueRole', resource: '_techniqueResource', class: '_techniqueClass'
      }[filter.dataset.techniqueFilter];
      if (stateKey) this[stateKey] = filter.value;
      this._techniquePage = 1;
      this._refreshTechniqueResults();
    });
    techniquePicker?.addEventListener('click', event => {
      const pageButton = event.target.closest?.('[data-technique-page]');
      if (pageButton && !pageButton.disabled) {
        const { page, pageCount } = this._filteredTechniques();
        const requested = pageButton.dataset.techniquePage;
        this._techniquePage = requested === 'prev' ? Math.max(1, page - 1)
          : requested === 'next' ? Math.min(pageCount, page + 1)
            : Math.max(1, Math.min(pageCount, Number(requested) || 1));
        this._refreshTechniqueResults();
        return;
      }
      const button = event.target.closest?.('[data-add-technique]');
      if (button && !button.disabled) this._addCanonTechnique(button.dataset.addTechnique);
    });

    const fileInput = this.shadowRoot.querySelector('#timeline-import-file');
    fileInput?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) eventBus.emit('app:timeline-import-file', { file });
      event.target.value = '';
    });
  }

  _handleAction(control) {
    const action = control.dataset.action;
    if (!['apply-template', 'finish', 'clear-preset', 'persona-save', 'persona-delete'].includes(action)) this._notice = '';
    if (action === 'persona-save') { this._savePersona(); return; }
    if (action === 'persona-delete') { this._deletePersona(); return; }
    if (action === 'stage') {
      this._stage = Number(control.dataset.stage) || 0;
      this._render();
      this._scrollTop();
      return;
    }
    if (action === 'prev' || action === 'next') {
      this._stage = Math.max(0, Math.min(STAGES.length - 1, this._stage + (action === 'next' ? 1 : -1)));
      this._render();
      this._scrollTop();
      return;
    }
    if (action === 'apply-template') {
      this._draft = applyOpeningTemplate(this._draft, control.dataset.template);
      this._notice = `已应用「${OPENING_TEMPLATES.find(item => item.id === control.dataset.template)?.label || '情景'}」，所有字段仍可修改。`;
      this._savePreset();
      this._render();
      return;
    }
    if (action === 'set-value') {
      this._setPath(control.dataset.path, control.dataset.value);
      this._savePreset();
      this._render();
      return;
    }
    if (action === 'toggle-nature') {
      const nature = control.dataset.nature;
      const list = this._draft.power.chakraNatures;
      this._draft.power.chakraNatures = list.includes(nature) ? list.filter(item => item !== nature) : [...list, nature];
      this._savePreset();
      this._render();
      return;
    }
    if (action === 'add-entry') {
      this._addEntry(control.dataset.list);
      this._savePreset();
      this._renderPreservingScroll();
      return;
    }
    if (action === 'remove-entry') {
      const list = this._draft[control.dataset.list];
      if (Array.isArray(list)) list.splice(Number(control.dataset.index), 1);
      this._savePreset();
      this._renderPreservingScroll();
      return;
    }
    if (action === 'finish') {
      this._finish();
      return;
    }
    if (action === 'clear-preset') {
      this._draft = createOpeningDraft();
      this._presetLoaded = false;
      this._presetMigrated = false;
      this._notice = '已重置为新的 v2 草稿。';
      this._savePreset();
      this._render();
      return;
    }
    if (action === 'import-timeline') {
      this.shadowRoot.querySelector('#timeline-import-file')?.click();
      return;
    }
    if (action === 'scroll-section') {
      this.shadowRoot.querySelector(`#creator-section-${control.dataset.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'variant-prev' || action === 'variant-next') {
      this._cycleVariant(action === 'variant-next' ? 1 : -1);
    }
  }

  _addEntry(listName) {
    const defaults = {
      talents: { type: 'talent', name: '', rank: '未定', mastery: 0, description: '', limitations: '' },
      abilities: { source: 'custom', type: 'jutsu', name: '', rank: 'E', element: '无', cost: 8, resourceType: '查克拉', power: 0, mastery: 0, description: '', limitations: '' },
      equipment: { category: 'tools', name: '', quantity: 1, quality: '普通', description: '', equippedSlot: '' },
      relationships: { name: '', relation: '', publicHistory: '', secret: '', affection: 0, trust: 0, respect: 0 }
    };
    if (defaults[listName]) this._draft[listName].push({ ...defaults[listName] });
  }

  _addCanonTechnique(techniqueId) {
    const technique = CANON_DATABASE.getRecord('techniques', techniqueId);
    const selected = CANON_DATABASE.toStateSkill(technique, { mastery: 0 });
    if (!technique || !selected) {
      this._notice = '未能读取这条忍术，请刷新忍术库后重试。';
      this._renderPreservingScroll();
      return;
    }
    if (this._draft.abilities.some(item => item.technique_id === selected.technique_id || (item.type === selected.type && item.name === selected.name))) {
      this._notice = `「${selected.name}」已经在初始能力中。`;
      this._renderPreservingScroll();
      return;
    }
    this._draft.abilities.push({
      technique_id: selected.technique_id,
      source: selected.source,
      type: selected.type,
      name: selected.name,
      rank: selected.rank,
      element: selected.element,
      resourceType: selected.resource_type,
      cost: selected.cost,
      power: selected.power,
      mastery: selected.mastery,
      description: selected.description,
      limitations: ''
    });
    this._notice = `已从忍术库添加「${selected.name}」，可以继续调整初始掌握度。`;
    this._savePreset();
    this._renderPreservingScroll();
  }

  _setPath(path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    let cursor = this._draft;
    for (let index = 0; index < parts.length - 1; index++) {
      const key = /^\d+$/.test(parts[index]) ? Number(parts[index]) : parts[index];
      if (cursor[key] == null) cursor[key] = /^\d+$/.test(parts[index + 1]) ? [] : {};
      cursor = cursor[key];
    }
    const last = parts.at(-1);
    if (last !== undefined) cursor[/^\d+$/.test(last) ? Number(last) : last] = value;
  }

  _refreshSummary() {
    const combatLevel = this._syncCombatLevel();
    this.shadowRoot.querySelectorAll('[data-combat-level-output]').forEach(node => { node.textContent = combatLevel; });
    this.shadowRoot.querySelectorAll('[data-live-summary]').forEach(node => { node.innerHTML = this._summaryPanel(); });
  }

  _refreshRankBenchmark() {
    this.shadowRoot.querySelectorAll('[data-rank-benchmark]').forEach(node => {
      node.outerHTML = this._rankBenchmark();
    });
  }

  _refreshTechniqueResults() {
    const container = this.shadowRoot.querySelector('[data-technique-results]');
    if (!container) return;
    const scrollContainer = this.closest('.chat-container');
    const scrollTop = scrollContainer?.scrollTop;
    container.innerHTML = this._techniqueResults();
    if (scrollContainer && Number.isFinite(scrollTop)) scrollContainer.scrollTop = scrollTop;
  }

  _renderPreservingScroll() {
    const scrollContainer = this.closest('.chat-container');
    const scrollTop = scrollContainer?.scrollTop;
    this._render();
    if (scrollContainer && Number.isFinite(scrollTop)) scrollContainer.scrollTop = scrollTop;
  }

  _syncCombatLevel() {
    const combatLevel = calculateCombatLevel(
      this._draft.power.attributes,
      combatMasteriesFromAbilities(this._draft.abilities)
    );
    this._draft.power.combatLevel = combatLevel;
    return combatLevel;
  }

  _finish() {
    this._draft = normalizeOpeningDraft(this._draft);
    if (!this._draft.identity.name) {
      this._notice = '请先填写忍名，再封存开局档案。';
      if (this._variant !== 'B') this._stage = 1;
      this._render();
      return;
    }
    if (this._prototype) {
      this._notice = `原型档案检查通过：${this._draft.abilities.length} 项能力、${this._draft.equipment.length} 件物品、${this._draft.relationships.length} 段羁绊；未写入任何真实状态。`;
      this._render();
      return;
    }

    const initialized = initializeOpeningRuntime(this._draft, {
      stateManager,
      equipmentSystem,
      createOpeningContract
    });
    this._savePreset();
    eventBus.emit('character:created', {
      name: initialized['玩家·姓名'],
      contract: initialized._opening_contract,
      draftVersion: this._draft.version
    });
  }

  _handlePrototypeKey(event) {
    if (!this._prototype || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    // Window listeners see the shadow host as event.target; composedPath keeps the real editor control.
    const target = event.composedPath?.()[0] || event.target;
    if (target?.matches?.('input, textarea, select, [contenteditable], [contenteditable] *') || target?.isContentEditable) return;
    event.preventDefault();
    this._cycleVariant(event.key === 'ArrowRight' ? 1 : -1);
  }

  _cycleVariant(direction) {
    const variants = Object.keys(VARIANT_NAMES);
    const index = variants.indexOf(this._variant);
    this._variant = variants[(index + direction + variants.length) % variants.length];
    const url = new URL(globalThis.location.href);
    url.searchParams.set('creatorPrototype', '1');
    url.searchParams.set('variant', this._variant);
    globalThis.history?.replaceState({}, '', url);
    this._render();
    this._scrollTop();
  }

  _scrollTop() {
    this.closest('.chat-container')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  _esc(value) { return escHtml(String(value ?? '')); }
  _escAttr(value) { return escAttr(String(value ?? '')); }

  _styles() {
    return `
      :host { display:block; min-height:100%; color:var(--text-primary,#ebe7de); font-family:var(--font-body,'Noto Sans SC',sans-serif); }
      * { box-sizing:border-box; }
      button,input,textarea,select { font:inherit; }
      button { color:inherit; }
      .creator { width:min(1460px,100%); margin:0 auto; padding:34px 28px 120px; }
      .creator-header { display:flex; align-items:center; justify-content:space-between; gap:24px; margin-bottom:22px; }
      .creator-brand { display:flex; align-items:center; gap:14px; }
      .creator-seal { display:grid; place-items:center; width:44px; height:44px; border:1px solid rgba(226,88,58,.8); color:#ee6b4b; font:800 20px var(--font-title,serif); transform:rotate(-2deg); }
      .creator-kicker,.stage-header small,.block-heading small,.summary-heading small,.composer-stage-title small,.scene-board-kicker,.scroll-section header small,.review-hero small,.review-grid small { color:#8e8980; font:600 10px/1.4 var(--font-mono,monospace); letter-spacing:2px; }
      h1,h2,h3,p { margin:0; }
      h1 { margin-top:3px; font:700 clamp(22px,3vw,34px)/1.2 var(--font-title,serif); letter-spacing:2px; }
      .creator-header-actions { display:flex; align-items:center; gap:10px; }
      .prototype-badge { border:1px solid rgba(76,159,182,.38); color:#78b9c9; background:rgba(76,159,182,.08); padding:7px 10px; font-size:11px; letter-spacing:1px; }
      .ghost-btn,.secondary-btn,.primary-btn,.add-btn,.icon-btn,.choice-chip,.nature-chip,.completion-card,.rail-step,.flow-node,.template-card,.scroll-index button { border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.025); cursor:pointer; transition:border-color .18s,background .18s,color .18s,transform .18s; }
      .ghost-btn,.secondary-btn,.primary-btn,.add-btn { min-height:38px; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:8px 14px; border-radius:6px; }
      .ghost-btn { color:#b4aea4; }
      .ghost-btn:hover,.secondary-btn:hover,.add-btn:hover { border-color:rgba(226,88,58,.5); color:#f0ebe2; background:rgba(226,88,58,.06); }
      .primary-btn { border-color:#df603f; background:#d95335; color:#fff; font-weight:700; box-shadow:0 8px 26px rgba(170,50,27,.18); }
      .primary-btn:hover { background:#eb6948; transform:translateY(-1px); }
      .secondary-btn:disabled { opacity:.3; cursor:not-allowed; }
      .preset-banner { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:12px 14px; margin-bottom:18px; border-left:2px solid #c39552; background:rgba(195,149,82,.07); color:#c7b89f; }
      .preset-banner>div { display:flex; align-items:center; gap:10px; }
      .preset-banner span { display:grid; gap:2px; }
      .preset-banner strong { color:#e6dfd3; font-size:13px; }
      .preset-banner small { color:#8e8980; font-size:11px; }
      .persona-panel { display:grid; gap:10px; padding:12px 14px; margin-bottom:14px; border:1px solid rgba(195,149,82,.28); border-radius:8px; background:rgba(195,149,82,.06); }
      .persona-panel-title { display:flex; align-items:center; gap:8px; color:#d9b97e; font:700 12px var(--font-title,serif); letter-spacing:2px; }
      .persona-row { display:flex; gap:8px; align-items:center; }
      .persona-row .persona-select { flex:1; }
      .persona-save-row { display:flex; gap:8px; align-items:center; }
      .persona-save-row .persona-name { flex:1; }
      .persona-hint { color:#8e8980; font-size:11px; }
      .icon-btn { width:32px; height:32px; display:grid; place-items:center; padding:0; border-radius:5px; color:#aaa39a; }
      .icon-btn:hover { border-color:rgba(255,255,255,.28); color:#fff; }
      .icon-btn.danger:hover { border-color:rgba(214,72,72,.55); color:#ee7777; background:rgba(214,72,72,.08); }
      .workbench { display:grid; grid-template-columns:190px minmax(0,1fr) 260px; gap:18px; align-items:start; }
      .stage-rail,.live-summary,.editor-panel,.registration-scroll,.scroll-index>div,.scene-board,.composer-editor { border:1px solid rgba(255,255,255,.075); background:rgba(12,15,20,.78); backdrop-filter:blur(16px); }
      .stage-rail { position:sticky; top:22px; padding:15px 10px; }
      .rail-heading { padding:5px 9px 13px; color:#716d67; font:600 10px var(--font-mono,monospace); letter-spacing:2px; }
      .rail-step { width:100%; display:flex; align-items:center; gap:10px; padding:10px 9px; margin:2px 0; text-align:left; border-color:transparent; border-radius:5px; color:#85817a; }
      .rail-step>span { width:27px; height:27px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.09); color:#756f68; font:700 11px var(--font-title,serif); }
      .rail-step div { display:grid; gap:1px; font-size:13px; }
      .rail-step small { font:500 9px var(--font-mono,monospace); color:#5f5b56; }
      .rail-step:hover { color:#ddd7cd; background:rgba(255,255,255,.025); }
      .rail-step.active { color:#fff; border-color:rgba(226,88,58,.3); background:rgba(226,88,58,.08); }
      .rail-step.active>span { border-color:#dd6042; color:#ee7659; }
      .rail-step.done>span { color:#58ad8b; border-color:rgba(88,173,139,.4); }
      .rail-foot { margin:14px 9px 3px; padding-top:12px; border-top:1px solid rgba(255,255,255,.06); color:#6d6963; font-size:10px; }
      .rail-foot span { color:#c6a16b; font:700 12px var(--font-mono,monospace); }
      .editor-panel { min-width:0; padding:28px; }
      .stage-header { display:grid; grid-template-columns:minmax(0,1fr) minmax(220px,42%); gap:20px; padding-bottom:22px; border-bottom:1px solid rgba(255,255,255,.07); }
      .stage-header h2 { margin-top:4px; font:700 25px var(--font-title,serif); letter-spacing:1px; }
      .stage-header p { align-self:end; color:#8f8a82; font-size:12px; line-height:1.8; }
      .section-block { padding:24px 0; border-bottom:1px solid rgba(255,255,255,.065); }
      .section-block:last-of-type { border-bottom:0; }
      .block-heading { display:flex; justify-content:space-between; align-items:flex-end; gap:18px; margin-bottom:14px; }
      .block-heading h3 { margin-top:3px; font:650 16px var(--font-title,serif); }
      .block-heading p { max-width:420px; color:#77736d; font-size:11px; text-align:right; }
      .block-actions { display:flex; align-items:center; gap:9px; }
      .add-btn { min-height:32px; padding:5px 10px; color:#c7b89f; font-size:11px; }
      .template-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .template-card { position:relative; display:grid; gap:5px; min-height:112px; padding:14px; text-align:left; border-radius:5px; overflow:hidden; }
      .template-card::before { content:''; position:absolute; inset:0 auto 0 0; width:2px; background:var(--template-accent); opacity:.55; }
      .template-card span { color:var(--template-accent); font-size:9px; letter-spacing:1px; }
      .template-card strong { font:650 14px var(--font-title,serif); }
      .template-card small { color:#77736d; font-size:10px; line-height:1.55; }
      .template-card:hover { border-color:color-mix(in srgb,var(--template-accent) 55%,transparent); background:rgba(255,255,255,.04); }
      .template-card.selected { border-color:var(--template-accent); background:color-mix(in srgb,var(--template-accent) 9%,transparent); }
      .form-grid { display:grid; gap:11px; }
      .form-grid+.form-grid,.form-grid+.field,.field+.field { margin-top:11px; }
      .cols-2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .cols-3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
      .cols-4 { grid-template-columns:repeat(4,minmax(0,1fr)); }
      .field { display:grid; gap:6px; min-width:0; }
      .field>span,.attribute-field>span { color:#969087; font-size:10px; letter-spacing:.5px; }
      .derived-power-field output { display:flex; align-items:center; min-height:38px; padding:9px 10px; border:1px solid rgba(226,88,58,.35); border-radius:5px; background:rgba(226,88,58,.065); color:#ef8065; font:700 14px var(--font-mono,monospace); }
      .derived-power-field small { color:#716d67; font-size:9px; line-height:1.45; }
      input,textarea,select { width:100%; border:1px solid rgba(255,255,255,.095); border-radius:5px; outline:0; background:rgba(0,0,0,.22); color:#e8e2d8; padding:9px 10px; }
      input,select { min-height:38px; }
      textarea { min-height:82px; resize:vertical; line-height:1.65; }
      input:focus,textarea:focus,select:focus { border-color:rgba(226,88,58,.68); box-shadow:0 0 0 2px rgba(226,88,58,.08); }
      select option { background:#151920; color:#eee8dd; }
      .choice-row { display:grid; gap:7px; }
      .choice-row.five { grid-template-columns:repeat(5,minmax(0,1fr)); }
      .choice-chip { display:grid; gap:4px; min-height:82px; padding:11px; text-align:left; border-radius:5px; }
      .choice-chip strong { font-size:12px; }
      .choice-chip span { color:#6e6a64; font-size:9px; line-height:1.5; }
      .choice-chip.selected { border-color:#c39552; background:rgba(195,149,82,.08); }
      .choice-chip.selected strong { color:#e0bb7c; }
      .benchmark { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:13px; padding:9px 10px; border-left:2px solid #4c9fb6; background:rgba(76,159,182,.055); }
      .benchmark span { color:#8cb8c3; font-size:10px; margin-right:4px; }
      .benchmark em { color:#8e8980; font:normal 10px var(--font-mono,monospace); }
      .benchmark.muted { border-left-color:#777; }
      .attribute-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; }
      .attribute-field { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 11px; border:1px solid rgba(255,255,255,.075); background:rgba(255,255,255,.018); }
      .attribute-field span { display:flex; align-items:center; gap:7px; color:#aaa49a; }
      .attribute-field input { width:88px; min-height:34px; text-align:right; color:#dbb777; font:700 14px var(--font-mono,monospace); }
      .nature-grid { display:flex; flex-wrap:wrap; gap:7px; }
      .nature-chip { display:flex; align-items:center; gap:6px; min-height:34px; padding:6px 10px; border-radius:5px; color:#918b83; font-size:11px; }
      .nature-chip.selected { border-color:rgba(76,159,182,.6); color:#9bd1de; background:rgba(76,159,182,.09); }
      .entry-list { display:grid; gap:11px; }
      .entry-card { padding:14px; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.018); }
      .entry-card>header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
      .entry-card>header>div { display:flex; align-items:center; gap:9px; }
      .entry-card>header strong { font:650 13px var(--font-title,serif); }
      .entry-index { color:#c39552; font:600 9px var(--font-mono,monospace); }
      .source-badge { padding:2px 5px; border:1px solid rgba(76,159,182,.4); border-radius:999px; color:#91c8d5; background:rgba(76,159,182,.08); font:normal 8px var(--font-mono,monospace); letter-spacing:.5px; }
      .source-badge.custom { border-color:rgba(195,149,82,.35); color:#c8a66e; background:rgba(195,149,82,.06); }
      .technique-picker { display:grid; gap:12px; padding:14px; margin-bottom:14px; border:1px solid rgba(76,159,182,.2); background:rgba(76,159,182,.035); }
      .technique-picker-heading>div { display:grid; gap:3px; }
      .technique-picker-heading strong { color:#d9e4e5; font-size:12px; }
      .technique-picker-heading span { color:#77888b; font-size:10px; line-height:1.5; }
      .technique-toolbar { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:9px; align-items:end; }
      .technique-search { grid-column:span 2; }
      .technique-toolbar label { display:grid; gap:5px; }
      .technique-toolbar label>span { color:#829093; font-size:9px; }
      .technique-result-meta { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px; color:#849397; font-size:9px; }
      .technique-page-size { display:flex; align-items:center; gap:6px; color:#6f7e81; }
      .technique-page-size select { width:auto; min-height:30px; padding:4px 24px 4px 8px; font-size:9px; }
      .technique-pagination { position:sticky; top:8px; z-index:3; display:flex; align-items:center; gap:7px; padding:7px; margin-bottom:8px; border:1px solid rgba(76,159,182,.18); background:rgba(8,15,19,.96); box-shadow:0 7px 18px rgba(0,0,0,.2); }
      .technique-pagination button { min-height:29px; padding:4px 8px; border:1px solid rgba(255,255,255,.09); border-radius:4px; background:rgba(255,255,255,.025); color:#859396; cursor:pointer; font-size:9px; }
      .technique-pagination button:hover:not(:disabled),.technique-pagination button.active { border-color:rgba(76,159,182,.52); color:#b9e0e7; background:rgba(76,159,182,.09); }
      .technique-pagination button:disabled { opacity:.32; cursor:default; }
      .technique-page-numbers { display:flex; flex:1; justify-content:center; align-items:center; gap:4px; }
      .technique-page-numbers button { min-width:29px; padding-inline:6px; }
      .technique-page-gap { color:#586568; font-size:9px; }
      .technique-pagination>[data-technique-page-state] { color:#788689; white-space:nowrap; font-size:9px; }
      .technique-result-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      .technique-result-card { display:grid; gap:8px; min-width:0; padding:11px; border:1px solid rgba(255,255,255,.075); background:rgba(4,10,13,.35); }
      .technique-result-card.added { border-color:rgba(88,173,139,.28); background:rgba(88,173,139,.035); }
      .technique-result-card>header { display:flex; justify-content:space-between; align-items:flex-start; gap:9px; }
      .technique-result-card>header>div { display:grid; gap:3px; min-width:0; }
      .technique-result-card strong { color:#cfd8d8; font-size:11px; overflow-wrap:anywhere; }
      .technique-result-card header span { color:#718084; font-size:8px; }
      .technique-result-card button { flex:0 0 auto; min-height:28px; padding:4px 9px; border:1px solid rgba(76,159,182,.42); border-radius:5px; background:rgba(76,159,182,.08); color:#9ccbd5; cursor:pointer; font-size:9px; }
      .technique-result-card button:hover { border-color:#62b2c4; color:#d9f2f6; }
      .technique-result-card button:disabled { border-color:rgba(88,173,139,.26); color:#6b9d89; background:rgba(88,173,139,.05); cursor:default; }
      .technique-result-card p { color:#747d7d; font-size:9px; line-height:1.6; }
      .technique-result-card footer { display:flex; flex-wrap:wrap; gap:5px 9px; color:#627174; font-size:8px; }
      .technique-result-card code { margin-left:auto; color:#4f5c5f; font:inherit; }
      .technique-empty { padding:18px; border:1px dashed rgba(255,255,255,.09); color:#737d7f; text-align:center; font-size:10px; }
      .canon-ability-card { border-color:rgba(76,159,182,.22); background:rgba(76,159,182,.025); }
      .canon-ability-facts { display:flex; flex-wrap:wrap; gap:6px; }
      .canon-ability-facts span { padding:4px 7px; border:1px solid rgba(255,255,255,.07); color:#8e9b9d; background:rgba(0,0,0,.16); font-size:9px; }
      .canon-ability-description { margin:10px 0; color:#898f8e; font-size:10px; line-height:1.7; white-space:pre-wrap; }
      .canon-mastery { max-width:280px; }
      .empty-state { display:flex; align-items:center; gap:12px; padding:17px; border:1px dashed rgba(255,255,255,.09); color:#6e6a64; }
      .empty-state>span { display:grid; place-items:center; width:30px; height:30px; border:1px solid rgba(255,255,255,.1); font:700 11px var(--font-title,serif); }
      .empty-state p { font-size:11px; }
      .ryo-field { display:flex; align-items:center; gap:7px; color:#8e8980; font-size:10px; }
      .ryo-field input { width:100px; min-height:32px; padding:5px 8px; }
      .relation-values { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:13px; }
      .relation-values label { display:grid; gap:6px; }
      .relation-values span { display:flex; justify-content:space-between; color:#8f8982; font-size:10px; }
      .relation-values output { color:#d0a969; font:600 10px var(--font-mono,monospace); }
      .relation-values input { min-height:auto; padding:0; accent-color:#d65b3d; }
      .stage-nav { display:flex; justify-content:space-between; gap:12px; padding-top:24px; }
      .finish-btn { min-height:44px; }
      .finish-btn:not(.compact) { width:100%; margin-top:18px; }
      .live-summary { position:sticky; top:22px; padding:18px; }
      .summary-heading { position:relative; padding-bottom:14px; border-bottom:1px solid rgba(255,255,255,.07); }
      .summary-heading h3 { margin-top:6px; padding-right:48px; font:700 19px var(--font-title,serif); }
      .summary-heading>span { position:absolute; right:0; bottom:15px; color:#e16649; font:700 13px var(--font-mono,monospace); }
      .summary-identity { padding:14px 0; }
      .summary-identity strong { color:#c9bda9; font-size:12px; }
      .summary-identity p { margin-top:4px; color:#716d67; font-size:10px; }
      .summary-facts { display:grid; gap:8px; margin:0; }
      .summary-facts div { display:grid; grid-template-columns:36px 1fr; gap:7px; }
      .summary-facts dt { color:#67635e; font-size:9px; }
      .summary-facts dd { margin:0; color:#a19b92; font-size:10px; line-height:1.55; }
      .mini-attrs { display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin:15px 0; }
      .mini-attrs span { display:grid; gap:2px; padding:7px; border:1px solid rgba(255,255,255,.06); text-align:center; }
      .mini-attrs small { color:#615e59; font-size:8px; }
      .mini-attrs strong { color:#c5a46d; font:650 11px var(--font-mono,monospace); }
      .summary-counts { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      .summary-counts span { color:#77726b; font-size:9px; }
      .summary-counts strong { color:#b9b1a6; font:650 11px var(--font-mono,monospace); }
      .summary-mode { display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.065); }
      .summary-mode small { color:#68645e; font-size:9px; }
      .summary-mode strong { color:#62a98d; font-size:10px; }
      .review-hero { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:22px; margin-top:22px; border-left:3px solid #d75b3d; background:rgba(215,91,61,.06); }
      .review-hero h2 { margin:5px 0 3px; font:700 26px var(--font-title,serif); }
      .review-hero p { color:#8d877f; font-size:11px; }
      .review-hero>span { color:#e36b4f; font:800 22px var(--font-mono,monospace); }
      .review-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:12px 0; }
      .review-grid section { min-height:112px; padding:14px; border:1px solid rgba(255,255,255,.075); background:rgba(255,255,255,.018); }
      .review-grid h3 { margin:6px 0; font:650 13px var(--font-title,serif); }
      .review-grid p { color:#77726b; font-size:10px; line-height:1.6; }
      .completion-modes { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .completion-card { position:relative; display:grid; gap:5px; min-height:104px; padding:13px; text-align:left; border-radius:5px; }
      .completion-card>span { position:absolute; right:10px; top:10px; color:#65b391; }
      .completion-card strong { display:flex; align-items:center; gap:6px; font-size:12px; }
      .completion-card em { padding:2px 4px; color:#d5ad6c; border:1px solid rgba(213,173,108,.3); font:normal 8px var(--font-mono,monospace); }
      .completion-card small { color:#77716a; font-size:9px; line-height:1.6; }
      .completion-card.selected { border-color:rgba(88,173,139,.55); background:rgba(88,173,139,.07); }
      .creator-notice { position:fixed; right:84px; bottom:24px; z-index:10001; display:flex; align-items:center; gap:8px; max-width:420px; padding:11px 14px; border:1px solid rgba(88,173,139,.42); background:#111b18; color:#a9d9c5; box-shadow:0 12px 36px rgba(0,0,0,.45); font-size:11px; }
      .scroll-layout { display:grid; grid-template-columns:minmax(0,1fr) 260px; gap:18px; align-items:start; max-width:1160px; margin:0 auto; }
      .registration-scroll { padding:34px 40px; }
      .scroll-title-row { display:flex; justify-content:space-between; align-items:center; padding-bottom:28px; border-bottom:2px solid rgba(195,149,82,.4); }
      .scroll-title-row span { color:#8b847b; font-size:10px; letter-spacing:2px; }
      .scroll-title-row h2 { margin-top:6px; font:700 31px var(--font-title,serif); letter-spacing:4px; }
      .scroll-stamp { display:grid; place-items:center; width:64px; height:64px; border:2px solid rgba(222,86,57,.65); color:#df684b; font:700 12px var(--font-title,serif); transform:rotate(4deg); }
      .scroll-section { padding:30px 0; border-bottom:1px solid rgba(255,255,255,.08); scroll-margin-top:24px; }
      .scroll-section>header { display:flex; align-items:center; gap:12px; margin-bottom:5px; }
      .scroll-section>header>span { color:#d65b3d; font:700 24px var(--font-title,serif); }
      .scroll-section>header h3 { margin-top:2px; font:700 19px var(--font-title,serif); }
      .scroll-section .stage-nav,.scroll-section .finish-btn:not(.compact) { display:none; }
      .scroll-index { position:sticky; top:22px; display:grid; gap:10px; }
      .scroll-index>div { padding:18px; }
      .scroll-index nav { display:grid; padding:7px; border:1px solid rgba(255,255,255,.075); background:rgba(12,15,20,.78); }
      .scroll-index button { padding:9px 10px; border-color:transparent; text-align:left; color:#817c75; font-size:11px; }
      .scroll-index button:hover { color:#fff; background:rgba(226,88,58,.07); }
      .scroll-final { display:flex; justify-content:flex-end; padding-top:28px; }
      .composer { max-width:1240px; margin:0 auto; }
      .composer-flow { display:flex; align-items:flex-start; justify-content:center; padding:16px 20px; margin-bottom:14px; border:1px solid rgba(255,255,255,.07); background:rgba(12,15,20,.62); }
      .flow-node { display:grid; justify-items:center; gap:5px; width:78px; border:0; background:transparent; color:#706c66; }
      .flow-node>span { display:grid; place-items:center; width:30px; height:30px; border:1px solid rgba(255,255,255,.1); font:700 10px var(--font-title,serif); }
      .flow-node small { font-size:9px; }
      .flow-node.active { color:#e7dfd3; }
      .flow-node.active>span { color:#e46a4d; border-color:#d65b3d; background:rgba(214,91,61,.1); }
      .flow-node.done>span { color:#5aae8c; border-color:rgba(90,174,140,.5); }
      .flow-line { width:52px; height:1px; margin-top:15px; background:rgba(255,255,255,.1); }
      .composer-grid { display:grid; grid-template-columns:310px minmax(0,1fr); gap:14px; align-items:start; }
      .scene-board { position:sticky; top:22px; padding:24px; border-top:2px solid #4c9fb6; }
      .scene-board h2 { margin:12px 0 22px; color:#d9d3c9; font:650 20px/1.55 var(--font-title,serif); }
      .scene-board dl { display:grid; gap:11px; margin:0; }
      .scene-board dl div { padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,.06); }
      .scene-board dt { color:#68645f; font-size:9px; }
      .scene-board dd { margin:4px 0 0; color:#aaa49b; font-size:11px; line-height:1.55; }
      .scene-cast { margin-top:20px; }
      .scene-cast small { color:#68645f; font-size:9px; }
      .scene-cast>div { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
      .scene-cast span { padding:4px 7px; border:1px solid rgba(195,149,82,.25); color:#bea577; font-size:9px; }
      .scene-cast em { color:#68645f; font-size:10px; }
      .composer-editor { padding:28px; }
      .composer-stage-title { display:flex; align-items:center; gap:13px; padding-bottom:20px; border-bottom:1px solid rgba(255,255,255,.07); }
      .composer-stage-title>span { color:#dc6548; font:700 28px var(--font-title,serif); }
      .composer-stage-title h2 { margin-top:3px; font:700 23px var(--font-title,serif); }
      .prototype-switcher { position:fixed; left:50%; bottom:18px; z-index:10001; transform:translateX(-50%); display:flex; align-items:center; gap:4px; padding:5px; border:1px solid rgba(255,255,255,.16); background:#080b0f; box-shadow:0 12px 36px rgba(0,0,0,.55); }
      .prototype-switcher button { width:38px; height:38px; border:0; background:rgba(255,255,255,.05); color:#e8e1d7; cursor:pointer; }
      .prototype-switcher button:hover { background:#d95b3d; }
      .prototype-switcher span { display:grid; min-width:190px; padding:0 12px; text-align:center; }
      .prototype-switcher small { color:#69655f; font:500 8px var(--font-mono,monospace); letter-spacing:1.5px; }
      .prototype-switcher strong { margin-top:2px; font-size:11px; }
      @media (max-width:1100px) {
        .workbench { grid-template-columns:170px minmax(0,1fr); }
        .live-summary { display:none; }
        .template-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .choice-row.five { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .scroll-layout { grid-template-columns:minmax(0,1fr); }
        .scroll-index { display:none; }
      }
      @media (max-width:800px) {
        .creator { padding:22px 14px 115px; }
        .creator-header { align-items:flex-start; }
        .creator-header-actions { flex-direction:column; align-items:flex-end; }
        .prototype-badge { display:none; }
        .workbench { display:block; }
        .stage-rail { position:static; display:flex; overflow-x:auto; gap:5px; margin-bottom:10px; padding:8px; }
        .rail-heading,.rail-foot { display:none; }
        .rail-step { flex:0 0 auto; width:auto; margin:0; }
        .rail-step div { display:none; }
        .editor-panel,.composer-editor { padding:20px 15px; }
        .stage-header { grid-template-columns:1fr; gap:8px; }
        .stage-header p { align-self:auto; }
        .cols-3,.cols-4 { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .attribute-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .choice-row.five { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .technique-toolbar { grid-template-columns:1fr 1fr; }
        .technique-search { grid-column:1 / -1; }
        .technique-result-grid { grid-template-columns:1fr; }
        .technique-pagination { flex-wrap:wrap; }
        .technique-page-numbers { order:3; flex-basis:100%; }
        .composer-grid { grid-template-columns:1fr; }
        .scene-board { position:static; }
        .composer-flow { overflow-x:auto; justify-content:flex-start; }
        .flow-line { min-width:22px; width:22px; }
        .registration-scroll { padding:24px 18px; }
      }
      @media (max-width:560px) {
        .creator-header { display:grid; }
        .creator-header-actions { align-items:stretch; }
        h1 { font-size:23px; }
        .creator-seal { width:38px; height:38px; }
        .template-grid,.cols-2,.cols-3,.cols-4,.attribute-grid,.review-grid,.completion-modes,.relation-values { grid-template-columns:1fr; }
        .choice-row.five { grid-template-columns:1fr 1fr; }
        .technique-toolbar { grid-template-columns:1fr; }
        .technique-search { grid-column:auto; }
        .technique-result-meta { align-items:flex-start; }
        .technique-pagination>[data-technique-page-state] { margin-left:auto; }
        .block-heading { align-items:flex-start; }
        .block-heading p { display:none; }
        .block-actions { align-items:flex-end; flex-direction:column; }
        .attribute-field input { width:110px; }
        input,textarea,select { font-size:16px; }
        .scroll-title-row h2 { font-size:25px; }
        .scroll-stamp { width:52px; height:52px; }
        .prototype-switcher { left:12px; bottom:calc(var(--statusbar-h,30px) + 14px); width:calc(100% - 88px); transform:none; justify-content:space-between; }
        .prototype-switcher span { min-width:0; }
        .creator-notice { left:12px; right:88px; bottom:calc(var(--statusbar-h,30px) + 74px); }
      }
    `;
  }
}

if (!customElements.get('character-creator')) customElements.define('character-creator', CharacterCreator);
export default CharacterCreator;
