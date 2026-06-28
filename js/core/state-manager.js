import { deepClone, getValueByPath, setValueByPath, generateId } from '../utils/format.js';
import { eventBus } from './event-bus.js';

const DB_NAME = 'naruto_rpg';
const DB_VERSION = 1;
const STORE_NODES = 'timeline_nodes';
const STORE_BRANCHES = 'timeline_branches';
const STORE_META = 'timeline_meta';

class StateManager {
  constructor() {
    this.state = this.getDefaultState();
    this._listeners = new Map();
    this._db = null;
  }

  getDefaultState() {
    return {
      _version: '3.0',
      _meta: {
        current_node_id: null,
        active_branch: 'branch_main',
        turn_count: 0
      },
      player: {
        name: '',
        age: 12,
        soul_age: 12,
        gender: '',
        rank: '忍校学生',
        village: '木叶隐村',
        background: '',
        chakra_nature: [],
        difficulty: '下忍',
        personality: [],
        public_identity: '忍校学生',
        current_goal: '',
        reputation_tags: [],
        flags: {},
        alive: true,
        death_cause: ''
      },
      attributes: {
        chakra: 10, chakra_current: 10,
        spirit: 10, spirit_current: 10,
        willpower: 80, willpower_current: 80,
        speed: 5,
        luck: 10,
        stamina: 100, stamina_current: 100
      },
      skills: {
        jutsu: {},
        taijutsu: {},
        genjutsu: {},
        support: {},
        kekkei_genkai: null,
        talents: {}
      },
      equipment: {
        weapons: {},
        armor: {},
        tools: { '苦无': { quantity: 5, quality: '普通' } },
        consumables: {},
        ryo: 500,
        equipped: {
          weapon: null,
          armor: null,
          accessory1: null,
          accessory2: null
        }
      },
      progression: {
        exp: 0,
        exp_to_next: 100,
        jutsu_mastery_total: 0,
        jutsu_mastery: 0,
        taijutsu_mastery: 0,
        genjutsu_mastery: 0,
        defense_mastery: 0,
        missions_done: 0,
        promotion: {
          track: 'balanced',
          field_exam_ready: false,
          last_evaluation: '忍校学生阶段，尚未形成明确战斗风格',
          strengths: [],
          bottlenecks: []
        },
        reputation: { '木叶隐村': 0 },
        titles: [],
        achievements: []
      },
      combat: null,
      missions: {
        active: [],
        available: [],
        completed: [],
        failed: [],
        log: [],
        stats: {
          total_done: 0,
          total_completed: 0,
          total_failed: 0,
          total_abandoned: 0,
          d_rank: 0,
          c_rank: 0,
          b_rank: 0,
          a_rank: 0,
          s_rank: 0
        }
      },
      relationships: {},
      agent_memories: {},
      memory: {
        pins: [],
        facts: [],
        clues: [],
        long_term: [],
        archived_facts: [],
        recent_summary: '',
        turn_summaries: [],
        compressed_summary: '',
        compression_count: 0,
        important_events: [],
        npc_notes: {},
        meta: { updated_at: null, sources: {} }
      },
      world_state: {
        timeline: '木叶48年',
        calendar: '木叶48年1月1日·清晨',
        current_location: '木叶隐村',
        month: 1,
        weather: '晴',
        active_events: [],
        event_log: [],
        map: {
          explored_regions: ['火之国', '木叶隐村'],
          known_locations: {},
          active_pins: []
        }
      },
      timeline: null,
      ui_prefs: {
        theme: 'dark',
        timeline_visible: true,
        panel_tab: 'attributes',
        settings: {
          themePreset: 'konoha',
          fontPreset: 'system',
          fontFamily: "'Noto Sans SC','Microsoft YaHei UI','PingFang SC','Segoe UI',system-ui,sans-serif",
          fontSize: 16,
          lineHeight: 1.85,
          chatMaxWidth: 800,
          textColor: '#e8e4d9',
          accentColor: '#eb613f',
          goldColor: '#c69c6d',
          backgroundColor: '#070a0e',
          backgroundImage: '',
          backgroundOpacity: 0.72,
          aiCardStyle: 'line',
          paragraphIndent: false,
          showVariableSummary: true,
          reasoningOpen: true,  /* 思维链默认展开，避免在酒馆环境下默认折叠导致内心想法文字不可见 */
          musicEnabled: true,
          musicVolume: 45,
          musicLoop: true,
          musicShuffle: false,
          bgmList: [],
          favorites: [],
          ambientList: [],
          presetCore: true,
          presetNumbers: true,
          presetOutput: true,
          presetStyle: true,
          presetWorld: true,
          presetAdapt: true,
          tacticalCombat: false,
          autoArchive: true
        }
      }
    };
  }

  get(path) {
    if (!path) return deepClone(this.state);
    return deepClone(getValueByPath(this.state, path));
  }

  update(updates) {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const oldState = this.state;
    const oldValues = {};
    for (const update of updates) {
      if (update && update.path) {
        oldValues[update.path] = deepClone(getValueByPath(this.state, update.path));
      }
    }
    const applied = [];
    for (const update of updates) {
      if (!update || typeof update.path !== 'string' || !update.path) {
        if (update) console.warn('[StateManager] Skipped invalid update (missing path):', update);
        continue;
      }
      switch (update.op) {
        case 'set': {
          let value = update.value;
          const current = getValueByPath(this.state, update.path);
          if (update.path.startsWith('skills.') && current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object' && !Array.isArray(value)) {
            value = { ...current, ...value };
          }
          setValueByPath(this.state, update.path, value);
          applied.push(update);
          break;
        }
        case 'add': {
          const existing = getValueByPath(this.state, update.path);
          if (existing !== undefined && typeof existing !== 'number') {
            console.warn('[StateManager] add on non-numeric path:', update.path, 'value:', existing);
          }
          const val = Number(existing) || 0;
          const delta = Number(update.value) || 0;
          setValueByPath(this.state, update.path, val + delta);
          applied.push(update);
          break;
        }
        case 'sub': {
          const existing = getValueByPath(this.state, update.path);
          if (existing !== undefined && typeof existing !== 'number') {
            console.warn('[StateManager] sub on non-numeric path:', update.path, 'value:', existing);
          }
          const val = Number(existing) || 0;
          const delta = Number(update.value) || 0;
          setValueByPath(this.state, update.path, Math.max(0, val - delta));
          applied.push(update);
          break;
        }
        case 'assign': {
          const current = getValueByPath(this.state, update.path);
          const obj = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
          if (update.key != null) {
            obj[update.key] = update.value;
            setValueByPath(this.state, update.path, obj);
            applied.push(update);
          } else {
            console.warn('[StateManager] assign skipped: missing key', update.path);
          }
          break;
        }
        case 'push': {
          const existing = getValueByPath(this.state, update.path);
          const arr = Array.isArray(existing) ? existing : [];
          if (!Array.isArray(existing) && existing !== undefined) {
            console.warn('[StateManager] push on non-array path:', update.path, 'replaced with empty array');
          }
          arr.push(update.value);
          setValueByPath(this.state, update.path, arr);
          applied.push(update);
          break;
        }
        case 'remove': {
          const target = getValueByPath(this.state, update.path);
          if (target === undefined) {
            console.warn('[StateManager] remove on non-existent path:', update.path);
            continue;
          }
          if (Array.isArray(target)) {
            if (update.index != null) target.splice(update.index, 1);
            else if (update.value !== undefined) {
              const idx = target.findIndex(item => item === update.value || item?.id === update.value);
              if (idx !== -1) target.splice(idx, 1);
            }
            setValueByPath(this.state, update.path, target);
            applied.push(update);
          } else if (target && typeof target === 'object') {
            const key = update.key ?? update.value;
            if (key != null && Object.prototype.hasOwnProperty.call(target, key)) {
              delete target[key];
              setValueByPath(this.state, update.path, target);
              applied.push(update);
            } else {
              console.warn('[StateManager] remove key not found:', update.path, key);
            }
          } else {
            console.warn('[StateManager] remove on non-array/non-object path:', update.path);
          }
          break;
        }
        default:
          console.warn('[StateManager] Unknown op:', update.op, 'path:', update.path);
      }
    }
    this._enforceStateBounds();
    for (const update of applied) {
      update.oldValue = oldValues[update.path];
      update.finalValue = getValueByPath(this.state, update.path);
      eventBus.emit('state:changed', {
        path: update.path,
        value: update.finalValue,
        oldValue: update.oldValue
      });
    }
    this._notifySubscribers(applied);
    eventBus.emit('state:batch-changed', { updates: applied });
  }

  batchUpdate(updates) {
    this.update(updates);
  }

  snapshot() {
    return deepClone(this.state);
  }

  restore(snapshot) {
    const validated = this._validateSnapshot(snapshot);
    if (!validated) {
      console.error('[StateManager] Restore aborted: snapshot validation failed');
      return;
    }
    this.state = this._normalizeState(deepClone(snapshot));
    this._enforceStateBounds();
    eventBus.emit('state:restored', this.state);
  }

  _validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      console.error('[StateManager] Invalid snapshot: not an object');
      return false;
    }
    const criticalPaths = [
      'player', 'attributes', 'skills', 'equipment',
      'progression', 'missions', 'relationships', 'memory', 'world_state'
    ];
    for (const path of criticalPaths) {
      const value = getValueByPath(snapshot, path);
      if (value === undefined || value === null) {
        console.error('[StateManager] Snapshot missing critical path:', path);
        return false;
      } else if (typeof value !== 'object') {
        console.error('[StateManager] Snapshot corrupted: path is not object:', path, typeof value);
        return false;
      }
    }
    if (snapshot.attributes) {
      for (const key of ['chakra', 'spirit', 'willpower', 'stamina']) {
        if (typeof snapshot.attributes[key] !== 'number' && snapshot.attributes[key] !== undefined) {
          console.warn('[StateManager] Snapshot attribute not numeric:', key, snapshot.attributes[key]);
        }
      }
    }
    return true;
  }

  reset() {
    this.state = this.getDefaultState();
    eventBus.emit('state:reset', this.state);
  }

  _normalizeState(state) {
    const defaults = this.getDefaultState();
    const equipment = this._normalizeEquipment({ ...defaults.equipment, ...(state?.equipment || {}) }, state?.equipment || {});
    const missions = this._normalizeMissions({ ...defaults.missions, ...(state?.missions || {}) }, defaults.missions);
    return {
      ...defaults,
      ...state,
      _meta: { ...defaults._meta, ...(state?._meta || {}) },
      player: { ...defaults.player, ...(state?.player || {}) },
      attributes: { ...defaults.attributes, ...(state?.attributes || {}) },
      skills: { ...defaults.skills, ...(state?.skills || {}) },
      equipment,
      progression: {
        ...defaults.progression,
        ...(state?.progression || {}),
        promotion: { ...defaults.progression.promotion, ...(state?.progression?.promotion || {}) }
      },
      missions,
      relationships: this._normalizeRelationships(state?.relationships || defaults.relationships),
      memory: {
        ...defaults.memory,
        ...(state?.memory || {}),
        pins: Array.isArray(state?.memory?.pins) ? state.memory.pins : [],
        facts: Array.isArray(state?.memory?.facts) ? state.memory.facts : [],
        clues: Array.isArray(state?.memory?.clues) ? state.memory.clues : [],
        long_term: Array.isArray(state?.memory?.long_term) ? state.memory.long_term : [],
        turn_summaries: Array.isArray(state?.memory?.turn_summaries) ? state.memory.turn_summaries : [],
        compressed_summary: state?.memory?.compressed_summary || '',
        compression_count: Number(state?.memory?.compression_count) || 0,
        important_events: Array.isArray(state?.memory?.important_events) ? state.memory.important_events : [],
        npc_notes: state?.memory?.npc_notes || {},
        meta: { ...defaults.memory.meta, ...(state?.memory?.meta || {}) }
      },
      world_state: { ...defaults.world_state, ...(state?.world_state || {}) },
      ui_prefs: {
        ...defaults.ui_prefs,
        ...(state?.ui_prefs || {}),
        settings: { ...defaults.ui_prefs.settings, ...(state?.ui_prefs?.settings || {}) }
      }
    };
  }

  _enforceStateBounds() {
    const attrs = this.state.attributes || {};
    const boundedPairs = [
      ['chakra_current', 'chakra'],
      ['spirit_current', 'spirit'],
      ['willpower_current', 'willpower'],
      ['stamina_current', 'stamina']
    ];
    for (const [currentKey, maxKey] of boundedPairs) {
      const max = Math.max(0, Number(attrs[maxKey]) || 0);
      attrs[maxKey] = max;
      attrs[currentKey] = Math.max(0, Math.min(Number(attrs[currentKey]) || 0, max));
    }
    attrs.speed = Math.max(0, Number(attrs.speed) || 0);
    attrs.luck = Math.max(0, Number(attrs.luck) || 0);

    const progression = this.state.progression || {};
    progression.exp = Math.max(0, Number(progression.exp) || 0);
    progression.exp_to_next = Math.max(1, Number(progression.exp_to_next) || 100);
    progression.missions_done = Math.max(0, Math.floor(Number(progression.missions_done) || 0));
    if (progression.exp >= progression.exp_to_next && !this._levelUpNotified) {
      this._levelUpNotified = true;
      const remaining = progression.exp - progression.exp_to_next;
      progression.exp = Math.max(0, remaining);
      progression.exp_to_next = Math.round(progression.exp_to_next * 1.4);
      progression.pending_breakthrough = (progression.pending_breakthrough || 0) + 1;
      eventBus.emit('attribute:level-up', { exp: progression.exp, needed: progression.exp_to_next });
    } else if (progression.exp < progression.exp_to_next) {
      this._levelUpNotified = false;
    }

    const equipment = this.state.equipment || {};
    const prevRyo = equipment.ryo;
    equipment.ryo = Math.max(0, Math.min(999999, Math.floor(Number(equipment.ryo) || 0)));
    if (prevRyo !== equipment.ryo && Number(prevRyo) > 999999) {
      console.warn('[StateManager] ryo capped at 999999, was:', prevRyo);
    }
    for (const category of ['weapons', 'armor', 'tools', 'consumables']) {
      // If AI returned an array, convert to object first
      if (Array.isArray(equipment[category])) {
        equipment[category] = this._normalizeItemMap(equipment[category]);
      }
      const items = equipment[category] || {};
      for (const [name, item] of Object.entries(items)) {
        if (!item || typeof item !== 'object') {
          delete items[name];
          continue;
        }
        const quantity = Math.min(99, Math.floor(Number(item.quantity)));
        if (!Number.isFinite(quantity) || quantity <= 0) {
          delete items[name];
          continue;
        }
        item.quantity = quantity;
        item.quality = item.quality || '普通';
      }
    }

    const skills = this.state.skills || {};
    for (const category of ['jutsu', 'taijutsu', 'genjutsu']) {
      const group = skills[category] || {};
      for (const [name, skill] of Object.entries(group)) {
        if (!skill || typeof skill !== 'object') {
          delete group[name];
          continue;
        }
        const raw = Number(skill.mastery);
        if (Number.isNaN(raw)) {
          skill.mastery = 0;
        } else if (raw > 100) {
          console.warn('[StateManager] mastery capped at 100:', `${category}.${name}`, 'was:', raw);
          skill.mastery = 100;
        } else if (raw < 0) {
          skill.mastery = 0;
        }
      }
    }

    for (const rel of Object.values(this.state.relationships || {})) {
      if (!rel || typeof rel !== 'object') continue;
      rel.affection = Math.max(-100, Math.min(100, Number(rel.affection) || 0));
      rel.trust = Math.max(-100, Math.min(100, Number(rel.trust) || 0));
      rel.respect = Math.max(0, Math.min(100, Number(rel.respect) || 0));
    }

    const player = this.state.player || {};
    if (player.alive !== false && this.state.attributes?.stamina_current <= 0) {
      player.alive = false;
      player.death_cause = player.death_cause || '体力耗尽';
      console.warn('[StateManager] Player died:', player.death_cause);
      eventBus.emit('player:died', { cause: player.death_cause });
    }
  }

  _normalizeEquipment(equipment, source = {}) {
    const normalized = { ...equipment };
    if (source.currency?.ryo != null && source.ryo == null) {
      normalized.ryo = Number(normalized.currency.ryo) || 0;
    }
    normalized.ryo = Number(normalized.ryo) || 0;
    for (const category of ['weapons', 'armor', 'tools', 'consumables']) {
      normalized[category] = this._normalizeItemMap(normalized[category]);
    }
    delete normalized.currency;
    return normalized;
  }

  _normalizeItemMap(items) {
    const result = {};
    if (!items || typeof items !== 'object') return result;
    // If AI returned an array like [{name:"苦无", quantity:3}, ...], convert to object keyed by name
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const name = item.name || '未知装备';
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        // If duplicate name, merge quantities
        if (result[name]) {
          result[name].quantity += quantity;
        } else {
          result[name] = { ...item, quantity, quality: item.quality || '普通' };
        }
      }
      return result;
    }
    for (const [name, item] of Object.entries(items)) {
      if (!item || typeof item !== 'object') continue;
      if (item.quantity == null) continue;
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      // If AI used numeric keys but items have a .name property, prefer the .name
      const realName = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : name;
      if (result[realName]) {
        result[realName].quantity += quantity;
      } else {
        result[realName] = { ...item, name: realName, quantity, quality: item.quality || '普通' };
      }
    }
    return result;
  }

  _normalizeMissions(missions, defaults) {
    return {
      ...defaults,
      ...missions,
      active: Array.isArray(missions.active) ? missions.active : [],
      available: Array.isArray(missions.available) ? missions.available : [],
      completed: Array.isArray(missions.completed) ? missions.completed : [],
      failed: Array.isArray(missions.failed) ? missions.failed : [],
      log: Array.isArray(missions.log) ? missions.log : [],
      stats: { ...defaults.stats, ...(missions.stats || {}) }
    };
  }

  _normalizeRelationships(relationships) {
    const result = {};
    if (!relationships || typeof relationships !== 'object') return result;
    const toArray = v => {
      if (typeof v === 'string' && v.trim()) return [{ turn: 0, time: '', summary: v.trim() }];
      if (Array.isArray(v)) return v;
      return [];
    };
    for (const [name, value] of Object.entries(relationships)) {
      if (typeof value === 'number') {
        result[name] = { affection: value, trust: 0, respect: 0, info: '', history: [], inner_thoughts: [] };
      } else if (value && typeof value === 'object') {
        result[name] = {
          ...value,
          affection: Number(value.affection) || 0,
          trust: Number(value.trust) || 0,
          respect: Number(value.respect) || 0,
          info: value.info || '',
          pinned: value.pinned ?? false,
          history: toArray(value.history),
          inner_thoughts: toArray(value.inner_thoughts)
        };
      }
    }
    return result;
  }

  subscribe(path, callback) {
    const key = typeof path === 'string' ? path : '*';
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);
    return () => {
      this._listeners.get(key)?.delete(callback);
    };
  }

  _notifySubscribers(updates) {
    for (const update of updates) {
      const listeners = this._listeners.get(update.path);
      if (listeners) {
        for (const cb of listeners) {
          try { cb(getValueByPath(this.state, update.path)); } catch (e) { console.warn('[StateManager] Listener error:', e.message); }
        }
      }
      const wildcards = this._listeners.get('*');
      if (wildcards) {
        for (const cb of wildcards) {
          try { cb(update.path, getValueByPath(this.state, update.path)); } catch (e) { console.warn('[StateManager] Wildcard listener error:', e.message); }
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
      request.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };
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

  async saveAPIConfig(config) {
    try {
      localStorage.setItem('naruto_api_config', JSON.stringify(config));
    } catch (e) {
      console.warn('[StateManager] Failed to save API config to localStorage:', e.message);
    }
  }

  getAPIConfig() {
    try {
      return JSON.parse(localStorage.getItem('naruto_api_config') || 'null');
    } catch (e) {
      console.warn('[StateManager] Failed to parse API config from localStorage:', e.message);
      return null;
    }
  }

  async loadUIPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem('naruto_ui_prefs') || 'null');
      if (!saved) return;
      this.state.ui_prefs = this._normalizeState({ ui_prefs: saved }).ui_prefs;
      eventBus.emit('state:changed', { path: 'ui_prefs', value: this.get('ui_prefs'), oldValue: null });

      if (!this.state.ui_prefs?.settings?.backgroundImage) {
        // First try to migrate from localStorage if exists
        const legacyBg = localStorage.getItem('naruto_bg_image');
        if (legacyBg) {
          try {
            const decoded = JSON.parse(legacyBg);
            if (decoded && this.state.ui_prefs?.settings) {
              this.state.ui_prefs.settings.backgroundImage = decoded;
              // Migrate to IDB and clear from LS
              await this.dbPut(STORE_META, { key: 'naruto_bg_image', value: decoded });
              localStorage.removeItem('naruto_bg_image');
            }
          } catch { }
        } else {
          // Load from IndexedDB
          try {
            const meta = await this.dbGet(STORE_META, 'naruto_bg_image');
            if (meta && meta.value && this.state.ui_prefs?.settings) {
              this.state.ui_prefs.settings.backgroundImage = meta.value;
            }
          } catch { }
        }
      }
    } catch (e) {
      console.warn('[StateManager] Failed to load UI prefs from localStorage:', e.message);
    }
  }

  async saveUIPrefs() {
    try {
      const uiPrefs = this.state.ui_prefs || {};
      const bg = uiPrefs.settings?.backgroundImage;

      if (bg && bg.length > 50000) {
        const small = { ...uiPrefs, settings: { ...uiPrefs.settings, backgroundImage: '' } };
        localStorage.setItem('naruto_ui_prefs', JSON.stringify(small));
        await this.dbPut(STORE_META, { key: 'naruto_bg_image', value: bg });
      } else {
        localStorage.setItem('naruto_ui_prefs', JSON.stringify(uiPrefs));
        await this.dbPut(STORE_META, { key: 'naruto_bg_image', value: null });
      }
    } catch (e) {
      console.warn('[StateManager] Failed to save UI prefs:', e.message);
    }
  }

  async saveLargeUIPrefs() {
    await this.saveUIPrefs();
  }

  getDB() {
    return this._db;
  }
}

export const stateManager = new StateManager();
export default stateManager;
