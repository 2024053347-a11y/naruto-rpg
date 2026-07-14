import { deepClone, generateId, getValueByPath, setValueByPath, isSafePath, isSafePathKey } from '../utils/format.js';
import { eventBus } from './event-bus.js';
import { getDefaults, isKnownKey, coerceValue, isNumeric, VAR_SCHEMA, validate } from '../data/var-schema.js';

const DB_NAME = 'naruto_rpg';
const DB_VERSION = 1;
const STORE_NODES = 'timeline_nodes';
const STORE_BRANCHES = 'timeline_branches';
const STORE_META = 'timeline_meta';

class StateManager {
  constructor() {
    this.state = this._buildDefaultState();
    this._listeners = new Map();
    this._db = null;
    this._levelUpNotified = false;
    this._stateVersion = 0;
    this._getCache = { version: -1, state: null };
  }

  getDefaultState() {
    return this._buildDefaultState();
  }

  _buildDefaultState() {
    const flat = getDefaults();
    return {
      ...flat,
      _version: '4.0',
      _meta: {
        current_node_id: null,
        active_branch: 'branch_main'
      },
      _agent_memories: {},
      _opening_contract: null,
      _combat: null,
      _missions: {
        active: {}, available: {}, completed: {}, failed: {},
        log: {}, stats: { total_done: 0, d_rank: 0, c_rank: 0, b_rank: 0, a_rank: 0, s_rank: 0 }
      },
      _relationships: {},
      _memory: {
        pins: '', facts: '', clues: '', long_term: '', archived: '',
        recent_summary: '', turn_summaries: '', compressed_summary: '', compression_count: 0,
        important_events: '', npc_notes: '',
        meta: { updated_at: null, sources: {} }
      },
      _map: {
        known_locations: {},
        active_pins: ''
      },
      _ui: {
        theme: 'dark', timeline_visible: true, panel_tab: 'attributes',
        settings: {
          themePreset: 'konoha', fontPreset: 'system',
          fontFamily: "'Noto Sans SC','Microsoft YaHei UI','PingFang SC','Segoe UI',system-ui,sans-serif",
          fontSize: 16, lineHeight: 1.85, chatMaxWidth: 800,
          textColor: '#e8e4d9', accentColor: '#eb613f', goldColor: '#c69c6d',
          backgroundColor: '#070a0e', backgroundImage: '', backgroundOpacity: 0.72,
          aiCardStyle: 'line', paragraphIndent: false, showVariableSummary: true,
          reasoningOpen: true, musicEnabled: true, musicVolume: 45, musicLoop: true,
          musicShuffle: false, bgmList: '', favorites: '', ambientList: '',
          presetCore: true, presetNumbers: true, presetOutput: true,
          presetStyle: true, presetWorld: true, presetAdapt: true,
          tacticalCombat: false, autoArchive: true
        }
      }
    };
  }

  get(path) {
    if (!path) {
      if (this._getCache.version === this._stateVersion) {
        return deepClone(this._getCache.state);
      }
      const state = deepClone(this.state);
      this._injectCompatProps(state);
      this._getCache = { version: this._stateVersion, state };
      return deepClone(state);
    }
    let val = getValueByPath(this.state, path);
    if (val === undefined) {
      if (this._getCache.version !== this._stateVersion) {
        const compat = deepClone(this.state);
        this._injectCompatProps(compat);
        this._getCache = { version: this._stateVersion, state: compat };
      }
      val = getValueByPath(this._getCache.state, path);
    }
    return deepClone(val);
  }

  _injectCompatProps(state) {
    if (!state) return;
    
    const splitStr = (v) => {
      if (typeof v === 'string' && v.trim()) return v.split('，');
      if (Array.isArray(v)) return v;
      return [];
    };

    state.player = {
      name: state['玩家·姓名'] || '',
      age: state['玩家·年龄'] || 12,
      soul_age: state['玩家·灵魂年龄'] || 12,
      gender: state['玩家·性别'] || '',
      rank: state['玩家·忍阶'] || '忍校学生',
      official_rank: state['玩家·正式忍阶'] || '忍校学生',
      background: state['玩家·出身'] || '',
      chakra_nature: splitStr(state['玩家·查克拉属性']),
      difficulty: state['玩家·难度'] || '下忍',
      personality: splitStr(state['玩家·个性']),
      public_identity: state['玩家·公开身份'] || '忍校学生',
      current_goal: state['玩家·当前目标'] || '',
      reputation_tags: splitStr(state['玩家·声望标签']),
      alive: state['玩家·存活'] !== '否',
      death_cause: state['玩家·死因'] || ''
    };

    state.attributes = {
      chakra: state['属性·查克拉'] || 10,
      chakra_current: state['属性·当前查克拉'] || 10,
      spirit: state['属性·精神力'] || 10,
      spirit_current: state['属性·当前精神力'] || 10,
      willpower: state['属性·意志力'] || 80,
      willpower_current: state['属性·当前意志力'] || 80,
      stamina: state['属性·体力'] || 100,
      stamina_current: state['属性·当前体力'] || 100,
      speed: state['属性·速度'] || 5,
      luck: state['属性·幸运'] || 10
    };

    state.progression = {
      exp: state['进度·经验'] || 0,
      exp_to_next: state['进度·下一级经验'] || 100,
      jutsu_mastery: state['进度·忍术熟练度'] || 0,
      taijutsu_mastery: state['进度·体术熟练度'] || 0,
      genjutsu_mastery: state['进度·幻术熟练度'] || 0,
      defense_mastery: state['进度·防御熟练度'] || 0,
      missions_done: state['进度·已完成任务'] || 0,
      pending_breakthrough: state['进度·突破待处理'] || 0,
      titles: splitStr(state['进度·称号']),
      achievements: splitStr(state['进度·成就'])
    };

    state.world_state = {
      current_location: state['世界·地点'] || '木叶隐村',
      calendar: state['世界·时间'] || '木叶48年1月1日·清晨',
      timeline: state['世界·年代'] || '木叶48年',
      month: state['世界·月份'] || 1,
      weather: state['世界·天气'] || '晴'
    };

    const skills = { jutsu: {}, taijutsu: {}, genjutsu: {}, support: {}, kekkei_genkai: {}, talents: {} };
    for (const key of Object.keys(state)) {
      if (key.startsWith('技能·')) {
        const parts = key.split('·');
        if (parts[1] === '血继限界') {
          skills.kekkei_genkai = state[key];
        } else if (parts[1] === '天赋' && parts[2]) {
          const talentName = parts[2];
          if (!skills.talents[talentName]) skills.talents[talentName] = {};
          
          if (!parts[3]) {
            // Legacy root object: s['技能·天赋·暗部之姿'] = { ... }
            if (typeof state[key] === 'object' && state[key] !== null) {
              Object.assign(skills.talents[talentName], {
                name: state[key].name || talentName,
                description: state[key].description || '',
                mastery: state[key].mastery || 0,
                custom: state[key].custom || false,
                ...state[key]
              });
            } else {
              skills.talents[talentName].name = state[key];
            }
          } else {
            // Flat key: s['技能·天赋·暗部之姿·描述'] = '...'
            const field = parts[3];
            const fMap = { '名称': 'name', '描述': 'description', '熟练度': 'mastery' };
            const targetField = fMap[field] || field;
            skills.talents[talentName][targetField] = state[key];
          }
        } else if (parts[2]) {
          const typeMap = { '忍术': 'jutsu', '体术': 'taijutsu', '幻术': 'genjutsu', '支援': 'support' };
          const type = typeMap[parts[1]];
          if (type) {
            const jutsuName = parts[2];
            if (!skills[type][jutsuName]) skills[type][jutsuName] = {};
            
            if (!parts[3]) {
              // Legacy root object: s['技能·忍术·豪火球'] = { ... }
              if (typeof state[key] === 'object' && state[key] !== null) {
                Object.assign(skills[type][jutsuName], {
                  name: state[key].name || jutsuName,
                  rank: state[key].rank || 'E',
                  element: state[key].element || '',
                  cost: state[key].cost || 0,
                  power: state[key].power || 0,
                  mastery: state[key].mastery || 0,
                  description: state[key].description || '',
                  ...state[key]
                });
              } else {
                skills[type][jutsuName].name = state[key];
              }
            } else {
              // Flat key: s['技能·忍术·豪火球·等级'] = '...'
              const field = parts[3];
              const fMap = { '名称': 'name', '等级': 'rank', '属性': 'element', '消耗': 'cost', '威力': 'power', '熟练度': 'mastery', '描述': 'description' };
              const targetField = fMap[field] || field;
              skills[type][jutsuName][targetField] = state[key];
            }
          }
        }
      }
    }
    state.skills = skills;

    const equipment = { weapons: {}, armor: {}, tools: {}, consumables: {}, ryo: state['进度·金钱'] || 500, equipped: {} };
    for (const key of Object.keys(state)) {
      if (key.startsWith('物品·')) {
        const parts = key.split('·');
        if (parts[1] === '已装备' && parts[2]) {
          const eqMap = { '武器': 'weapon', '防具': 'armor', '饰品1': 'accessory1', '饰品2': 'accessory2' };
          const slot = eqMap[parts[2]];
          if (slot) equipment.equipped[slot] = state[key];
        } else if (parts[2]) {
          const typeMap = { '道具': 'tools', '消耗品': 'consumables', '武器': 'weapons', '防具': 'armor' };
          const type = typeMap[parts[1]];
          if (type) {
            const itemName = parts[2];
            const field = parts[3] || '数量';
            const fMap = { '数量': 'quantity', '品质': 'quality', '描述': 'description', '名称': 'name', '类型': 'type', '威力': 'power', '消耗': 'cost', '属性': 'element' };
            const targetField = fMap[field] || field;
            if (!equipment[type][itemName]) equipment[type][itemName] = {};
            equipment[type][itemName][targetField] = state[key];
          }
        }
      }
    }
    state.equipment = equipment;

    state.combat = state._combat || null;
    state.missions = this._restoreMissionsCompat(state._missions);
    state.relationships = state._relationships || {};
    state.memory = this._restoreMemoryCompat(state._memory);
  }

  _restoreMissionsCompat(mis) {
    if (!mis) return { active: [], available: [], completed: [], failed: [], log: [], stats: { total_done: 0 } };
    const arrFromObj = (obj) => obj ? Object.values(obj) : [];
    return {
      active: arrFromObj(mis.active),
      available: arrFromObj(mis.available),
      completed: arrFromObj(mis.completed),
      failed: arrFromObj(mis.failed),
      log: arrFromObj(mis.log),
      stats: mis.stats || { total_done: 0 }
    };
  }

  _restoreMemoryCompat(mem) {
    if (!mem) return { pins: '', facts: '', clues: '', long_term: '', archived: '', recent_summary: '', turn_summaries: '', compressed_summary: '', compression_count: 0, important_events: '', npc_notes: '' };
    return JSON.parse(JSON.stringify(mem));
  }

  update(vars) {
    if (!Array.isArray(vars) || vars.length === 0) return;
    const applied = [];
    const oldValues = {};

    for (const v of vars) {
      if (!v || !v.key) continue;
      const key = v.key;

      // B-01: 拒绝原型污染路径（__proto__/prototype/constructor）
      if (key.includes('.') || key.includes('[')) {
        if (!isSafePath(key)) {
          console.warn('[StateManager] reject forbidden path:', key);
          eventBus.emit('state:invalid-write', { key, reason: 'forbidden-path' });
          continue;
        }
      } else if (!isSafePathKey(key)) {
        console.warn('[StateManager] reject forbidden key:', key);
        eventBus.emit('state:invalid-write', { key, reason: 'forbidden-key' });
        continue;
      }

      // B-05: 未知键直接拒绝（不再静默写入 state）
      if (!(key in this.state) && !isKnownKey(key) && !key.includes('.')) {
        console.warn('[StateManager] reject unknown key:', key);
        eventBus.emit('state:invalid-write', { key, reason: 'unknown-key' });
        continue;
      }

      oldValues[key] = deepClone(this.state[key]);

      const rawVal = v.value;
      const current = this.state[key];

      switch (v.op) {
        case 'del':
        case 'delete':
        case 'remove': {
          if (key.includes('.')) {
            // Not supported for deep path deletion in flat updates right now, but we can do our best
          } else {
            delete this.state[key];
          }
          applied.push(v);
          break;
        }
        case '=': {
          const coerced = coerceValue(key, rawVal);
          // B-03: 类型断言——若 schema 要求 number 但 coerce 后仍非数字，拒绝写入
          const def = VAR_SCHEMA[key];
          if (def && def.type === 'number' && typeof coerced !== 'number') {
            console.warn('[StateManager] reject non-numeric value for number key:', key, rawVal);
            eventBus.emit('state:invalid-write', { key, reason: 'type-mismatch', rawValue: rawVal });
            continue;
          }
          // B-10: 接入 validate()，拒绝违反 allowed 枚举/min/max 的写入
          // path-based 写入（如 _combat.id 等子对象路径）不走 schema 校验
          if (!key.includes('.')) {
            const validation = validate(key, coerced);
            if (!validation.valid) {
              console.warn('[StateManager] validate failed:', key, validation.reason);
              eventBus.emit('state:invalid-write', { key, reason: validation.reason, rawValue: rawVal });
              continue;
            }
          }
          if (key.includes('.')) {
            setValueByPath(this.state, key, coerced);
          } else {
            // Delete skill prefix if setting base skill key to falsy (or 0)
            if (key.startsWith('技能·') && !key.split('·')[3] && (coerced === 0 || coerced === '' || coerced === '0' || coerced === '无' || coerced === false)) {
              for (const k in this.state) {
                if (k.startsWith(key + '·') || k === key) {
                  delete this.state[k];
                }
              }
            } else {
              this.state[key] = coerced;
            }
          }
          applied.push(v);
          break;
        }
        case '+':
        case '-': {
          const delta = Number(rawVal);
          if (!Number.isFinite(delta)) {
            console.warn('[StateManager] reject non-numeric delta:', key, rawVal);
            eventBus.emit('state:invalid-write', { key, reason: 'nan-delta', rawValue: rawVal });
            continue;
          }
          const currentVal = key.includes('.') ? getValueByPath(this.state, key) : current;
          let curNum = Number(currentVal);
          // 兜底: 状态中缺失但从 schema 声明为数字,取默认值或 0
          if (isNaN(curNum) && isKnownKey(key) && key in VAR_SCHEMA && VAR_SCHEMA[key]?.type === 'number') {
            curNum = VAR_SCHEMA[key].default ?? 0;
          }
          if (isNaN(curNum)) {
            console.warn('[StateManager] 非数字变量不支持增减:', key);
            continue;
          }
          const newVal = v.op === '-' ? Math.max(0, curNum - delta) : curNum + delta;
          if (key.includes('.')) {
            setValueByPath(this.state, key, newVal);
          } else {
            this.state[key] = newVal;
          }
          applied.push(v);
          break;
        }
        default:
          console.warn('[StateManager] 未知操作:', v.op);
      }
    }

    this._enforceBounds();
    this._checkAlive();

    for (const v of applied) {
      eventBus.emit('state:changed', {
        key: v.key, value: this.state[v.key], oldValue: oldValues[v.key]
      });
    }
    this._notifySubscribers(applied);
    eventBus.emit('state:batch-changed', { updates: applied });
    this._stateVersion++;
  }

  batchUpdate(vars) {
    if (!Array.isArray(vars) || vars.length === 0) return;

    // B-30: 改"整批分流"为"逐条分流"——混合格式时 path 项不再被静默丢失。
    // 平键项收集到 flatUpdates 转交给 update()；path 项走下方分支。

    // Path-based protocol from secondary variable updater
    // Maps legacy English paths to v4.0 flat Chinese keys
    const PATH_MAP = {
      'player.name': '玩家·姓名', 'player.age': '玩家·年龄', 'player.soul_age': '玩家·灵魂年龄',
      'player.gender': '玩家·性别', 'player.rank': '玩家·忍阶', 'player.official_rank': '玩家·正式忍阶',
      'player.background': '玩家·出身', 'player.chakra_nature': '玩家·查克拉属性',
      'player.difficulty': '玩家·难度', 'player.personality': '玩家·个性',
      'player.public_identity': '玩家·公开身份', 'player.current_goal': '玩家·当前目标',
      'player.reputation_tags': '玩家·声望标签', 'player.flags': '玩家·标志',
      'player.alive': '玩家·存活', 'player.death_cause': '玩家·死因',
      'attributes.chakra': '属性·查克拉', 'attributes.chakra_current': '属性·当前查克拉',
      'attributes.spirit': '属性·精神力', 'attributes.spirit_current': '属性·当前精神力',
      'attributes.willpower': '属性·意志力', 'attributes.willpower_current': '属性·当前意志力',
      'attributes.stamina': '属性·体力', 'attributes.stamina_current': '属性·当前体力',
      'attributes.speed': '属性·速度', 'attributes.luck': '属性·幸运',
      'progression.exp': '进度·经验', 'progression.exp_to_next': '进度·下一级经验',
      'progression.jutsu_mastery': '进度·忍术熟练度', 'progression.taijutsu_mastery': '进度·体术熟练度',
      'progression.genjutsu_mastery': '进度·幻术熟练度', 'progression.defense_mastery': '进度·防御熟练度',
      'progression.missions_done': '进度·已完成任务', 'progression.pending_breakthrough': '进度·突破待处理',
      'progression.ryo': '进度·金钱', 'equipment.ryo': '进度·金钱',
      'progression.titles': '进度·称号', 'progression.achievements': '进度·成就',
      'world_state.current_location': '世界·地点', 'world_state.calendar': '世界·时间',
      'world_state.timeline': '世界·年代', 'world_state.month': '世界·月份',
      'world_state.weather': '世界·天气', 'world_state.explored_regions': '世界·已探索区域',
      'world_state.active_events': '世界·活跃事件',
      'skills.kekkei_genkai': '技能·血继限界',
      'system.turn_count': '系统·回合数',
    };
    const OP_MAP = { 'set': '=', 'add': '+', 'sub': '-' };

    const flatUpdates = [];

    for (const v of vars) {
      if (!v) continue;

      // Already in flat format
      if (v.key && ['=', '+', '-'].includes(v.op)) {
        flatUpdates.push(v);
        continue;
      }

      if (!v.path || !v.op) continue;
      const path = v.path;
      const op = v.op;
      const value = v.value;

      // Direct path mapping
      if (PATH_MAP[path]) {
        const flatOp = OP_MAP[op] || '=';
        flatUpdates.push({ key: PATH_MAP[path], op: flatOp, value });
        continue;
      }

      // Skills: skills.jutsu.火遁·豪火球 → 技能·忍术·火遁·豪火球·*
      const skillsMatch = path.match(/^skills\.(jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai)\.(.+?)(?:\.(.+))?$/);
      if (skillsMatch) {
        const typeRev = { jutsu: '忍术', taijutsu: '体术', genjutsu: '幻术', support: '支援', talents: '天赋', kekkei_genkai: '血继限界' };
        const fieldRev = { name: '名称', rank: '等级', element: '属性', cost: '消耗', power: '威力', mastery: '熟练度', description: '描述', type: '类型' };
        const type = typeRev[skillsMatch[1]] || skillsMatch[1];
        const skillName = skillsMatch[2];
        const field = skillsMatch[3];

        if (op === 'set' && !field && typeof value === 'object') {
          // Setting entire skill object
          for (const [k, val] of Object.entries(value)) {
            const zhField = fieldRev[k] || k;
            flatUpdates.push({ key: `技能·${type}·${skillName}·${zhField}`, op: '=', value: val });
          }
        } else if (op === 'set' && !field && (typeof value === 'string' || typeof value === 'number')) {
          // 字符串/数字值（如血继限界"写轮眼·二勾玉"）→ 存入 描述
          flatUpdates.push({ key: `技能·${type}·${skillName}·描述`, op: '=', value: String(value) });
        } else if (op === 'assign' && v.key && value !== undefined) {
          const zhField = fieldRev[v.key] || v.key;
          flatUpdates.push({ key: `技能·${type}·${skillName}·${zhField}`, op: '=', value });
        } else if (field) {
          const zhField = fieldRev[field] || field;
          const flatOp = OP_MAP[op] || '=';
          flatUpdates.push({ key: `技能·${type}·${skillName}·${zhField}`, op: flatOp, value });
        } else if (op === 'remove' && v.key) {
          const skillPrefix = `技能·${type}·${v.key}·`;
          const deletedKeys = [];
          for (const stateKey of Object.keys(this.state)) {
            if (stateKey.startsWith(skillPrefix)) deletedKeys.push(stateKey);
          }
          for (const stateKey of deletedKeys) {
            delete this.state[stateKey];
            eventBus.emit('state:changed', { key: stateKey, value: undefined, deleted: true });
          }
        }
        continue;
      }

      // Equipment: equipment.consumables.绷带 → 物品·消耗品·绷带·*
      const eqMatch = path.match(/^equipment\.(weapons|armor|tools|consumables)\.(.+?)(?:\.(.+))?$/);
      if (eqMatch) {
        const typeRev = { weapons: '武器', armor: '防具', tools: '道具', consumables: '消耗品' };
        const fieldRev = { quantity: '数量', quality: '品质', description: '描述', name: '名称', type: '类型', power: '威力', cost: '消耗', element: '属性' };
        const type = typeRev[eqMatch[1]] || eqMatch[1];
        const itemName = eqMatch[2];
        const field = eqMatch[3];

        if (op === 'set' && !field && typeof value === 'object') {
          for (const [k, val] of Object.entries(value)) {
            const zhField = fieldRev[k] || k;
            flatUpdates.push({ key: `物品·${type}·${itemName}·${zhField}`, op: '=', value: val });
          }
        } else if (field) {
          const zhField = fieldRev[field] || field;
          const flatOp = OP_MAP[op] || '=';
          flatUpdates.push({ key: `物品·${type}·${itemName}·${zhField}`, op: flatOp, value });
        } else if (op === 'remove' && v.key) {
          const itemPrefix = `物品·${type}·${v.key}·`;
          const deletedKeys = [];
          for (const stateKey of Object.keys(this.state)) {
            if (stateKey.startsWith(itemPrefix)) deletedKeys.push(stateKey);
          }
          for (const stateKey of deletedKeys) {
            delete this.state[stateKey];
            eventBus.emit('state:changed', { key: stateKey, value: undefined, deleted: true });
          }
        }
        continue;
      }

      // Equipment equipped slots
      const equippedMatch = path.match(/^equipment\.equipped\.(.+)$/);
      if (equippedMatch) {
        const slotRev = { weapon: '武器', armor: '防具', accessory1: '饰品1', accessory2: '饰品2' };
        const slot = slotRev[equippedMatch[1]] || equippedMatch[1];
        if (op === 'remove') {
          const flatKey = `物品·已装备·${slot}`;
          if (flatKey in this.state) {
            delete this.state[flatKey];
            eventBus.emit('state:changed', { key: flatKey, value: undefined, deleted: true });
          }
        } else {
          flatUpdates.push({ key: `物品·已装备·${slot}`, op: '=', value });
        }
        continue;
      }

      // Reputation: progression.reputation.木叶隐村 → 进度·声望·木叶隐村
      if (path === 'progression.reputation' && op === 'remove' && v.key) {
        const repKey = `进度·声望·${v.key}`;
        if (repKey in this.state) {
          delete this.state[repKey];
          eventBus.emit('state:changed', { key: repKey, value: undefined, deleted: true });
        }
        continue;
      }
      const repMatch = path.match(/^progression\.reputation\.(.+)$/);
      if (repMatch) {
        const flatOp = OP_MAP[op] || '=';
        flatUpdates.push({ key: `进度·声望·${repMatch[1]}`, op: flatOp, value });
        continue;
      }

      // Relationship summary UI editing fallback
      const relMatch = (v.key || path).match(/^关系·(.+)·(互动摘要|好感|信任|敬畏)$/);
      if (relMatch && (op === '=' || op === 'set')) {
        const npc = relMatch[1];
        const field = relMatch[2];
        const rels = this.state._relationships || {};
        if (rels[npc]) {
          if (field === '互动摘要' && rels[npc].history && rels[npc].history.length > 0) {
            rels[npc].history[0].summary = value;
          } else if (field === '好感') {
            rels[npc].affection = Number(value) || 0;
          } else if (field === '信任') {
            rels[npc].trust = Number(value) || 0;
          } else if (field === '敬畏') {
            rels[npc].respect = Number(value) || 0;
          }
          this.state._relationships = rels;
          eventBus.emit('state:changed', { key: '_relationships', value: rels });
        }
        flatUpdates.push({ key: v.key || path, op: '=', value });
        continue;
      }

      // World map: world_state.map.explored_regions / known_locations
      if (path === 'world_state.map.explored_regions') {
        if (op === 'push') {
          const current = this.state['世界·已探索区域'] || '';
          const parts = current ? current.split('，').filter(Boolean) : [];
          if (!parts.includes(value)) parts.push(value);
          flatUpdates.push({ key: '世界·已探索区域', op: '=', value: parts.join('，') });
        } else {
          flatUpdates.push({ key: '世界·已探索区域', op: '=', value });
        }
        continue;
      }
      const knownLocMatch = path.match(/^world_state\.map\.known_locations$/);
      if (knownLocMatch && op === 'assign' && v.key) {
        // Store in _map sub-object
        const map = this.state._map || { known_locations: {}, active_pins: '' };
        map.known_locations[v.key] = value;
        this.state._map = map;
        eventBus.emit('state:changed', { key: '_map', value: this.state._map });
        continue;
      }
      if (knownLocMatch && op === 'remove' && v.key) {
        const map = this.state._map || { known_locations: {}, active_pins: '' };
        if (map.known_locations && map.known_locations[v.key]) {
          delete map.known_locations[v.key];
          this.state._map = map;
          eventBus.emit('state:changed', { key: '_map', value: this.state._map });
        }
        continue;
      }

      // Memory sub-object updates (go to _memory)
      if (path.startsWith('memory.') || path === 'memory') {
        // Memory updates handled by memory-system, skip to avoid conflicts
        continue;
      }

      // _meta path
      if (path.startsWith('_meta.')) {
        setValueByPath(this.state, path, value);
        eventBus.emit('state:changed', { key: path, value });
        continue;
      }

      // Fallback: try direct state property
      if (!path.startsWith('skills.') && !path.startsWith('items.')) {
        console.warn('[StateManager] batchUpdate: unrecognized path, attempting direct set:', path);
      }
      setValueByPath(this.state, path, value);
      eventBus.emit('state:changed', { key: path, value });
    }

    if (flatUpdates.length) this.update(flatUpdates);
    // path 项直接改了 this.state（不经 update()），必须失效 get() 缓存
    this._stateVersion++;
  }

  getSub(key) {
    if (key in this.state) return deepClone(this.state[key]);
    return undefined;
  }

  // 注意：setSub 是"整段覆盖"语义。如果只想改子字段、保留其余，请用 mergeSub。
  setSub(key, value) {
    this.state[key] = value;
    this._stateVersion++;
    eventBus.emit('state:changed', { key, value });
  }

  // B-12: 浅 patch 顶层 sub 对象，避免多写入路径互相覆盖
  mergeSub(key, partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      console.warn('[StateManager] mergeSub: partial must be an object', key);
      return;
    }
    const cur = this.state[key];
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) {
      this.state[key] = { ...partial };
    } else {
      this.state[key] = { ...cur, ...partial };
    }
    this._stateVersion++;
    eventBus.emit('state:changed', { key, value: this.state[key] });
  }

  snapshot() {
    return deepClone(this.state);
  }

  // S-02: 旧存档迁移——把 "物品·已装备·道具1/2" 迁移到 "物品·已装备·饰品1/2"
  _migrateEquipmentSlots(state) {
    if (!state || typeof state !== 'object') return state;
    const legacy = ['道具1', '道具2'];
    const target = ['饰品1', '饰品2'];
    for (let i = 0; i < legacy.length; i++) {
      const oldKey = `物品·已装备·${legacy[i]}`;
      const newKey = `物品·已装备·${target[i]}`;
      if (oldKey in state) {
        if (!state[newKey]) state[newKey] = state[oldKey];
        delete state[oldKey];
      }
    }
    return state;
  }

  // B-06: 深合并——保留 snapshot 中存在的字段，对缺失的嵌套字段用 defaults 补齐
  // 数组/原始值/null 按 snapshot 覆盖；对象递归合并
  _deepMerge(defaults, snapshot) {
    if (snapshot === null || snapshot === undefined) return defaults;
    if (Array.isArray(snapshot)) return snapshot;
    if (typeof snapshot !== 'object') return snapshot;
    if (defaults === null || defaults === undefined || typeof defaults !== 'object' || Array.isArray(defaults)) {
      return snapshot;
    }
    const result = { ...defaults };
    for (const key of Object.keys(snapshot)) {
      if (key in defaults) {
        result[key] = this._deepMerge(defaults[key], snapshot[key]);
      } else {
        result[key] = snapshot[key];
      }
    }
    return result;
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      console.error('[StateManager] 还原失败: 快照非法');
      return;
    }
    if (snapshot._version === '4.0') {
      // B-06: 用深合并替代浅合并，保证 Schema 新增的嵌套字段在旧存档中也有默认值
      this.state = this._deepMerge(this._buildDefaultState(), snapshot);
      // S-02: 装备槽位旧键名"道具1/2"迁移到"饰品1/2"
      this._migrateEquipmentSlots(this.state);
      // B-07: 读档/时间线跳转后强制重置升级守卫
      this._levelUpNotified = false;
      this._enforceBounds();
      this._stateVersion++;
      eventBus.emit('state:restored', this.state);
      return;
    }
    const normalized = this._migrateV3toV4(snapshot);
    this.state = normalized;
    this._levelUpNotified = false;
    this._enforceBounds();
    this._stateVersion++;
    eventBus.emit('state:restored', this.state);
  }

  _migrateV3toV4(old) {
    const base = this._buildDefaultState();
    const p = old.player || {};
    const a = old.attributes || {};
    const pr = old.progression || {};
    const w = old.world_state || {};
    const eq = old.equipment || {};
    const sk = old.skills || {};
    const rel = old.relationships || {};
    const mem = old.memory || {};
    const mis = old.missions || {};

    const mapStr = (v) => {
      if (Array.isArray(v)) return v.join('，');
      if (typeof v === 'string') return v;
      return '';
    };
    const objToLines = (arr) => {
      if (!arr || !Array.isArray(arr)) return '';
      return arr.map(x => typeof x === 'string' ? x : x?.summary || x?.content || JSON.stringify(x)).join('\n');
    };

    return {
      ...base,
      '玩家·姓名': p.name ?? '',
      '玩家·年龄': p.age ?? 12,
      '玩家·灵魂年龄': p.soul_age ?? 12,
      '玩家·性别': p.gender ?? '',
      '玩家·忍阶': p.rank ?? '忍校学生',
      '玩家·正式忍阶': p.official_rank ?? p.rank ?? '忍校学生',
      '玩家·战力等级': p.power_level ?? 'E级',
      '玩家·所属村': p.village ?? '木叶隐村',
      '玩家·出身': p.background ?? '',
      '玩家·查克拉属性': mapStr(p.chakra_nature),
      '玩家·难度': p.difficulty ?? '下忍',
      '玩家·个性': mapStr(p.personality),
      '玩家·公开身份': p.public_identity ?? '忍校学生',
      '玩家·当前目标': p.current_goal ?? '',
      '玩家·声望标签': mapStr(p.reputation_tags),
      '玩家·标志': mapStr(Object.keys(p.flags || {})),
      '玩家·存活': p.alive === false ? '否' : '是',
      '玩家·死因': p.death_cause ?? '',

      '属性·查克拉': a.chakra ?? 10,
      '属性·当前查克拉': a.chakra_current ?? 10,
      '属性·精神力': a.spirit ?? 10,
      '属性·当前精神力': a.spirit_current ?? 10,
      '属性·意志力': a.willpower ?? 80,
      '属性·当前意志力': a.willpower_current ?? 80,
      '属性·体力': a.stamina ?? 100,
      '属性·当前体力': a.stamina_current ?? 100,
      '属性·速度': a.speed ?? 5,
      '属性·幸运': a.luck ?? 10,

      '进度·经验': pr.exp ?? 0,
      '进度·下一级经验': pr.exp_to_next ?? 100,
      '进度·忍术熟练度': pr.jutsu_mastery ?? 0,
      '进度·体术熟练度': pr.taijutsu_mastery ?? 0,
      '进度·幻术熟练度': pr.genjutsu_mastery ?? 0,
      '进度·防御熟练度': pr.defense_mastery ?? 0,
      '进度·已完成任务': pr.missions_done ?? 0,
      '进度·突破待处理': pr.pending_breakthrough ?? 0,
      '进度·金钱': eq.ryo ?? 500,
      '进度·称号': mapStr(pr.titles),
      '进度·成就': mapStr(pr.achievements),

      '世界·地点': w.current_location ?? '木叶隐村',
      '世界·时间': w.calendar ?? '木叶48年1月1日·清晨',
      '世界·年代': w.timeline ?? '木叶48年',
      '世界·月份': w.month ?? 1,
      '世界·天气': w.weather ?? '晴',
      '世界·已探索区域': mapStr(w.map?.explored_regions),
      '世界·活跃事件': objToLines(w.active_events),

      '系统·回合数': old._meta?.turn_count ?? 0,

      _meta: {
        current_node_id: old._meta?.current_node_id ?? null,
        active_branch: old._meta?.active_branch ?? 'branch_main'
      },
      _combat: old.combat ?? null,
      _opening_contract: old.opening_contract ?? null,
      _missions: this._migrateMissions(mis),
      _relationships: rel,
      _memory: {
        pins: objToLines(mem.pins),
        facts: objToLines(mem.facts),
        clues: objToLines(mem.clues),
        long_term: objToLines(mem.long_term),
        archived: objToLines(mem.archived_facts),
        recent_summary: mem.recent_summary ?? '',
        turn_summaries: objToLines(mem.turn_summaries),
        compressed_summary: mem.compressed_summary ?? '',
        compression_count: mem.compression_count ?? 0,
        important_events: objToLines(mem.important_events),
        npc_notes: typeof mem.npc_notes === 'object' ? Object.entries(mem.npc_notes || {}).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
        meta: mem.meta || { updated_at: null, sources: {} }
      },
      _map: {
        known_locations: w.map?.known_locations ?? {},
        active_pins: w.map?.active_pins ?? ''
      },
      _ui: old.ui_prefs || base._ui,
    };
  }

  _migrateMissions(mis) {
    const objFromArr = (arr) => {
      const o = {};
      if (!Array.isArray(arr)) return o;
      for (const m of arr) {
        if (m?.id) o[m.id] = m;
      }
      return o;
    };
    const logFromArr = (arr) => {
      if (!Array.isArray(arr)) return {};
      const o = {};
      arr.forEach((e, i) => { o[`log_${i}`] = e; });
      return o;
    };
    return {
      active: objFromArr(mis?.active),
      available: objFromArr(mis?.available),
      completed: objFromArr(mis?.completed),
      failed: objFromArr(mis?.failed),
      log: logFromArr(mis?.log),
      stats: mis?.stats ?? { total_done: 0, d_rank: 0, c_rank: 0, b_rank: 0, a_rank: 0, s_rank: 0 }
    };
  }

  _enforceBounds() {
    const s = this.state;

    const boundedPairs = [
      ['属性·当前查克拉', '属性·查克拉'],
      ['属性·当前精神力', '属性·精神力'],
      ['属性·当前意志力', '属性·意志力'],
      ['属性·当前体力', '属性·体力']
    ];
    for (const [curKey, maxKey] of boundedPairs) {
      if (typeof s[curKey] !== 'number' || isNaN(s[curKey])) continue;
      const mx = Math.max(0, Number(s[maxKey]) || 0);
      s[curKey] = Math.max(0, Math.min(s[curKey], mx));
    }

    const clamp = (key, min, max) => {
      if (typeof s[key] !== 'number' || isNaN(s[key])) return;
      s[key] = Math.max(min, Math.min(max, s[key]));
    };

    // B-11: 遍历 VAR_SCHEMA，对所有 number 字段统一钳制（不再硬编码字段列表）
    for (const [key, def] of Object.entries(VAR_SCHEMA)) {
      if (def.type !== 'number') continue;
      if (typeof s[key] !== 'number' || isNaN(s[key])) continue;
      const min = def.min != null ? def.min : -Infinity;
      const max = def.max != null ? def.max : Infinity;
      s[key] = Math.max(min, Math.min(max, s[key]));
    }

    // B-04: 单回合多级升级——while 循环消化所有可升级的经验
    let levelGuard = 0;
    while (
      typeof s['进度·经验'] === 'number'
      && typeof s['进度·下一级经验'] === 'number'
      && s['进度·经验'] >= s['进度·下一级经验']
      && levelGuard < 50
    ) {
      const needed = s['进度·下一级经验'];
      s['进度·经验'] = Math.max(0, s['进度·经验'] - needed);
      s['进度·下一级经验'] = Math.max(1, Math.round(needed * 1.4));
      s['进度·突破待处理'] = (s['进度·突破待处理'] || 0) + 1;
      eventBus.emit('attribute:level-up', { exp: s['进度·经验'], needed: s['进度·下一级经验'] });
      levelGuard++;
    }
    // 钳制后若 exp 小于 needed，则清除升级 guard（不再需要，但保持向后兼容）
    if (typeof s['进度·经验'] === 'number'
        && typeof s['进度·下一级经验'] === 'number'
        && s['进度·经验'] < s['进度·下一级经验']) {
      this._levelUpNotified = false;
    }

    for (const key of Object.keys(s)) {
      if (key.startsWith('物品·') && key.endsWith('·数量')) {
        clamp(key, 0, 99);
        if (s[key] <= 0) delete s[key];
      }
      if (key.startsWith('技能·') && key.endsWith('·熟练度')) {
        clamp(key, 0, 100);
      }
    }

    const rel = s._relationships;
    if (rel && typeof rel === 'object') {
      for (const r of Object.values(rel)) {
        if (!r || typeof r !== 'object') continue;
        if (typeof r.affection === 'number') r.affection = Math.max(-100, Math.min(100, r.affection));
        if (typeof r.trust === 'number') r.trust = Math.max(-100, Math.min(100, r.trust));
        if (typeof r.respect === 'number') r.respect = Math.max(-100, Math.min(100, r.respect));
      }
    }
  }

  _checkAlive() {
    const alive = this.state['玩家·存活'];
    const staminaCur = this.state['属性·当前体力'];
    if (alive !== '否' && typeof staminaCur === 'number' && staminaCur <= 0) {
      this.state['玩家·存活'] = '否';
      this.state['玩家·死因'] = this.state['玩家·死因'] || '体力耗尽';
      console.warn('[StateManager] 玩家死亡:', this.state['玩家·死因']);
      eventBus.emit('player:died', { cause: this.state['玩家·死因'] });
    }
  }

  reset() {
    this.state = this._buildDefaultState();
    this._levelUpNotified = false;
    this._stateVersion++;
    eventBus.emit('state:reset', this.state);
  }

  resetLevelUpGuard() {
    this._levelUpNotified = false;
  }

  subscribe(key, callback) {
    const k = typeof key === 'string' ? key : '*';
    if (!this._listeners.has(k)) this._listeners.set(k, new Set());
    this._listeners.get(k).add(callback);
    return () => { this._listeners.get(k)?.delete(callback); };
  }

  _notifySubscribers(applied) {
    for (const v of applied) {
      const listeners = this._listeners.get(v.key);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(this.state[v.key]); } catch (e) { console.warn('[StateManager] 监听器错误:', e.message); }
        }
      }
      const wildcards = this._listeners.get('*');
      if (wildcards) {
        for (const cb of wildcards) {
          try { cb(v.key, this.state[v.key]); } catch (e) { console.warn('[StateManager] 通配监听器错误:', e.message); }
        }
      }
    }
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NODES)) {
          const nodesStore = db.createObjectStore(STORE_NODES, { keyPath: 'id' });
          nodesStore.createIndex('parent_id', 'parent_id', { unique: false });
          nodesStore.createIndex('branch_id', 'branch_id', { unique: false });
          nodesStore.createIndex('turn_number', 'turn_number', { unique: false });
          nodesStore.createIndex('real_timestamp', 'real_timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_BRANCHES)) {
          const branchesStore = db.createObjectStore(STORE_BRANCHES, { keyPath: 'id' });
          branchesStore.createIndex('is_active', 'is_active', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      request.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async dbPut(storeName, data) {
    if (!this._db) await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async dbGet(storeName, key) {
    if (!this._db) await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async dbGetAll(storeName, query) {
    if (!this._db) await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = query ? store.getAll(query) : store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async dbDelete(storeName, key) {
    if (!this._db) await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async dbClear(storeName) {
    if (!this._db) await this.initDB();
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // B-14: localStorage 配额超限时降级到 IndexedDB
  _handleLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.message?.includes('quota')) {
        console.warn(`[StateManager] localStorage quota exceeded for ${key}, falling back to IndexedDB`);
        return false;
      }
      console.warn(`[StateManager] localStorage setItem failed for ${key}:`, e.message);
      return false;
    }

  }

  getDisplayConfig() {
    try {
      const saved = localStorage.getItem('naruto_rpg_display_config');
      if (saved) return JSON.parse(saved);
    } catch(e) {
      console.warn('[StateManager] Failed to parse display config:', e);
    }
    return { dialogueColor: '#bae6fd', thoughtColor: '#c4b5fd' };
  }

  saveDisplayConfig(config) {
    if (!config || typeof config !== 'object') return;
    try {
      localStorage.setItem('naruto_rpg_display_config', JSON.stringify(config));
    } catch(e) {
      console.warn('[StateManager] Failed to save display config:', e);
    }
  }

  async saveAPIConfig(config) {
    if (!config || typeof config !== 'object') {
      console.warn('[StateManager] Invalid API config, not saving');
      return;
    }

    // 强制启用代理模式 + 加密存储
    config.useProxy = true;
    
    // Update in-memory cache with plain config
    this._apiConfigCache = { ...config };

    try {
      const { saveApiConfigSecure } = await import('../utils/api-crypto.js');
      await saveApiConfigSecure(config);
    } catch (e) {
      console.warn('[StateManager] Encrypted API save failed, fallback to plain:', e.message);
      const safeConfig = {
        apiUrl: String(config.apiUrl || ''),
        apiKey: String(config.apiKey || ''),
        model: String(config.model || ''),
        backend: String(config.backend || 'openai'),
        disableStreaming: Boolean(config.disableStreaming),
        promptPreset: config.promptPreset,
        variableUpdater: config.variableUpdater,
        useProxy: true,
      };
      this._handleLocalStorageSet('naruto_api_config', JSON.stringify(safeConfig));
    }
  }

  getAPIConfig() {
    if (this._apiConfigCache) return this._apiConfigCache;
    
    try {
      const local = localStorage.getItem('naruto_api_config');
      if (!local) return null;
      const parsed = JSON.parse(local);
      if (!parsed || typeof parsed !== 'object') return null;
      // 老配置迁移：强制走代理
      if (parsed.apiKey && parsed.useProxy !== false) {
        parsed.useProxy = true;
      }
      return parsed;
    } catch (e) {
      console.warn('[StateManager] API config parse error:', e.message);
      return null;
    }
  }

  async getAPIConfigAsync() {
    try {
      const { loadApiConfigSecure } = await import('../utils/api-crypto.js');
      const secure = await loadApiConfigSecure();
      if (secure) {
        this._apiConfigCache = secure;
        return secure;
      }
    } catch (e) {
      console.warn('[StateManager] Encrypted API load failed:', e.message);
    }
    // Fallback to plain localStorage
    const local = this.getAPIConfig();
    if (local) {
      this._apiConfigCache = local;
      return local;
    }
    try {
      const meta = await this.dbGet(STORE_META, 'naruto_api_config');
      if (meta?.value) {
        const parsed = JSON.parse(meta.value);
        if (parsed.apiKey) parsed.useProxy = true;
        return parsed;
      }
    } catch { }
    return null;
  }

  async loadUIPrefs() {
    try {
      let saved = null;
      try {
        const raw = localStorage.getItem('naruto_ui_prefs');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') saved = parsed;
        }
      } catch (e) {
        console.warn('[StateManager] UI prefs parse error:', e.message);
      }
      // B-14: IndexedDB 降级读取
      if (!saved) {
        try {
          const meta = await this.dbGet(STORE_META, 'naruto_ui_prefs');
          if (meta?.value && typeof meta.value === 'string') {
            const parsed = JSON.parse(meta.value);
            if (parsed && typeof parsed === 'object') saved = parsed;
          }
        } catch (e) {
          console.warn('[StateManager] UI prefs DB read error:', e.message);
        }
      }
      if (!saved) return;
      this.state._ui = { ...this._buildDefaultState()._ui, ...saved };
      eventBus.emit('state:changed', { key: '_ui', value: this.state._ui });

      const settings = this.state._ui?.settings;
      if (!settings?.backgroundImage) {
        const legacyBg = localStorage.getItem('naruto_bg_image');
        if (legacyBg) {
          try {
            const decoded = JSON.parse(legacyBg);
            if (decoded && typeof decoded === 'string' && decoded.startsWith('data:image/') && settings) {
              settings.backgroundImage = decoded;
              await this.dbPut(STORE_META, { key: 'naruto_bg_image', value: decoded });
              localStorage.removeItem('naruto_bg_image');
            }
          } catch (e) {
            console.warn('[StateManager] Legacy bg parse error:', e.message);
          }
        } else {
          try {
            const meta = await this.dbGet(STORE_META, 'naruto_bg_image');
            if (meta?.value && settings) settings.backgroundImage = meta.value;
          } catch { }
        }
      }
    } catch (e) { console.warn('[StateManager] UI偏好加载失败:', e.message); }
  }

  async saveUIPrefs() {
    try {
      const ui = this.state._ui || {};
      const bg = ui.settings?.backgroundImage;
      if (bg && bg.length > 50000) {
        const smallJson = JSON.stringify({ ...ui, settings: { ...ui.settings, backgroundImage: '' } });
        this._handleLocalStorageSet('naruto_ui_prefs', smallJson);
        await this.dbPut(STORE_META, { key: 'naruto_bg_image', value: bg });
      } else {
        const json = JSON.stringify(ui);
        const ok = this._handleLocalStorageSet('naruto_ui_prefs', json);
        if (!ok) {
          await this.dbPut(STORE_META, { key: 'naruto_ui_prefs', value: json });
        }
        await this.dbPut(STORE_META, { key: 'naruto_bg_image', value: null });
      }
    } catch (e) { console.warn('[StateManager] UI偏好保存失败:', e.message); }
  }

  async saveLargeUIPrefs() { await this.saveUIPrefs(); }

  getDB() { return this._db; }
}

export const stateManager = new StateManager();
export default stateManager;
