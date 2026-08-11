import { stateManager as defaultStateManager } from '../../state-manager.js';
import { eventBus as defaultEventBus } from '../../event-bus.js';
import { SettingsConfigGateway } from '../../../ui/settings-config-gateway.js';
import { KNOWLEDGE_BASE as defaultKnowledgeBase } from '../../../data/knowledge-base.js';
import { equipmentSystem as defaultEquipmentSystem } from '../../../systems/equipment-system.js';
import { createOpeningContract as defaultCreateOpeningContract } from '../../../systems/opening-contract.js';
import { timelineSystem as defaultTimelineSystem } from '../../../systems/timeline-system.js';
import {
  START_PRESET_V2_KEY,
  initializeOpeningRuntime,
  normalizeOpeningDraft,
  serializeOpeningPreset
} from '../../../systems/opening-draft.js';
import {
  LingXiActionError,
  canonicalStringify,
  createActionProposal,
  fingerprintValue,
  hashCanonical,
  verifyActionProposal
} from '../action-proposal.js';
import { consumeBrokerApprovedProposal } from '../approval-broker.js';
import { buildExactStateDiff } from './state-adapter.js';

export const LINGXI_SETTINGS_TOOL = 'apply_ui_settings';
export const LINGXI_OPENING_TOOL = 'save_or_start_opening';
export const LINGXI_WORLDBOOK_TOOL = 'upsert_worldbook_entry';
export const LINGXI_STORY_DIRECTION_TOOL = 'apply_story_direction';
export const LINGXI_ACTION_IMPACT_SCHEMA = 'naruto.lingxi-action-impact/v1';

const WORLDBOOK_CUSTOM_KEY = 'naruto_worldbook_custom';
const WORLDBOOK_LEGACY_KEY = 'naruto_worldbook';
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SETTING_RULES = Object.freeze({
  themePreset: { type: 'enum', values: ['konoha', 'anbu', 'akatsuki', 'scroll', 'mist'] },
  fontPreset: { type: 'enum', values: ['system', 'serif', 'kai', 'mono', 'round', 'song', 'fangsong', 'brush', 'custom'] },
  fontFamily: { type: 'text', max: 500 },
  fontSize: { type: 'number', min: 12, max: 24 },
  lineHeight: { type: 'number', min: 1.2, max: 2.4 },
  chatMaxWidth: { type: 'number', min: 560, max: 1400 },
  textColor: { type: 'color' },
  accentColor: { type: 'color' },
  goldColor: { type: 'color' },
  backgroundColor: { type: 'color' },
  backgroundOpacity: { type: 'number', min: 0.2, max: 1 },
  aiCardStyle: { type: 'enum', values: ['line', 'card', 'plain'] },
  paragraphIndent: { type: 'boolean' },
  showVariableSummary: { type: 'boolean' },
  reasoningOpen: { type: 'boolean' },
  musicEnabled: { type: 'boolean' },
  musicVolume: { type: 'number', min: 0, max: 100 },
  musicLoop: { type: 'boolean' },
  musicShuffle: { type: 'boolean' },
  tacticalCombat: { type: 'boolean' },
  autoArchive: { type: 'boolean' }
});

function fail(code, message, details = null) {
  throw new LingXiActionError(code, message, details);
}

function clone(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(value, allowed, code, label) {
  if (!isRecord(value)) fail(code, `${label}必须是对象`);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      fail(code, `${label}包含不支持的字段: ${key}`);
    }
  }
}

function cleanText(value, label, max, { required = true } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    fail('LINGXI_INPUT_INVALID', `${label}必须是文本`);
  }
  const result = String(value || '').replace(/\u0000/g, '').trim();
  if ((required && !result) || result.length > max) {
    fail('LINGXI_INPUT_INVALID', `${label}必须是${required ? '非空' : ''}且不超过 ${max} 个字符的文本`);
  }
  return result;
}

function pointerSegment(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function diffEntry(path, before, after, operation = '') {
  const hasBefore = before !== undefined;
  const hasAfter = after !== undefined;
  const entry = {
    path,
    operation: operation || (!hasBefore ? 'add' : (!hasAfter ? 'remove' : 'replace'))
  };
  if (hasBefore) entry.before = clone(before);
  if (hasAfter) entry.after = clone(after);
  return entry;
}

function sameValue(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return canonicalStringify(left) === canonicalStringify(right);
}

function impact(kind, summary, details) {
  return {
    schema: LINGXI_ACTION_IMPACT_SCHEMA,
    kind,
    summary: cleanText(summary, '影响摘要', 240),
    details: details.map(item => cleanText(item, '影响明细', 500)).slice(0, 20)
  };
}

function receipt(proposal, afterFingerprint, diff) {
  return {
    schema: 'naruto.lingxi-action-receipt/v1',
    proposalId: proposal.id,
    tool: proposal.tool,
    appliedAt: Date.now(),
    beforeFingerprint: proposal.stateFingerprint,
    afterFingerprint,
    diff: clone(diff)
  };
}

async function assertDiffBinding(proposal, diff, label) {
  if (await hashCanonical(diff) !== proposal.diffHash) {
    fail('LINGXI_PROPOSAL_TAMPERED', `${label}的重新计算差异与已批准提案不一致`);
  }
}

class BrokerOnlyAdapter {
  #approvalPermit = null;

  bindApprovalPermit(permit) {
    if (!permit || typeof permit !== 'object') {
      fail('LINGXI_ADAPTER_INVALID', '审批许可必须是不透明对象');
    }
    if (this.#approvalPermit && this.#approvalPermit !== permit) {
      fail('LINGXI_ADAPTER_INVALID', '写入适配器已绑定到另一个审批 Broker');
    }
    this.#approvalPermit = permit;
  }

  async authorize(proposal, approvalPermit) {
    const brokerApproved = consumeBrokerApprovedProposal(proposal);
    const directlyBound = this.#approvalPermit && approvalPermit === this.#approvalPermit;
    if (!brokerApproved || (this.#approvalPermit && !directlyBound)) {
      fail('LINGXI_APPROVAL_REQUIRED', '该操作只能由绑定的审批 Broker 执行');
    }
    await verifyActionProposal(proposal);
    if (proposal.tool !== this.toolName) {
      fail('LINGXI_PROPOSAL_INVALID', `${this.toolName} 适配器不能执行 ${proposal.tool}`);
    }
  }
}

function normalizeSettingValue(key, value) {
  const rule = SETTING_RULES[key];
  if (!rule) fail('LINGXI_SETTING_NOT_WHITELISTED', `设置项不在灵希白名单中: ${key}`);
  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') fail('LINGXI_SETTINGS_INVALID', `${key} 必须是布尔值`);
    return value;
  }
  if (rule.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max) {
      fail('LINGXI_SETTINGS_INVALID', `${key} 必须在 ${rule.min} 到 ${rule.max} 之间`);
    }
    return value;
  }
  if (rule.type === 'enum') {
    if (typeof value !== 'string' || !rule.values.includes(value)) {
      fail('LINGXI_SETTINGS_INVALID', `${key} 不是支持的选项`);
    }
    return value;
  }
  if (rule.type === 'color') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      fail('LINGXI_SETTINGS_INVALID', `${key} 必须是六位十六进制颜色`);
    }
    return value.toLowerCase();
  }
  const result = cleanText(value, key, rule.max);
  if (/[\r\n{};]/.test(result) || /url\s*\(/i.test(result)) {
    fail('LINGXI_SETTINGS_INVALID', `${key} 包含不支持的样式内容`);
  }
  return result;
}

function normalizeSettingsParams(params) {
  assertOnlyKeys(params, new Set(['patch', 'reason']), 'LINGXI_SETTINGS_INVALID', '设置参数');
  assertOnlyKeys(params.patch, new Set(Object.keys(SETTING_RULES)), 'LINGXI_SETTING_NOT_WHITELISTED', '设置补丁');
  const patch = {};
  for (const key of Object.keys(params.patch).sort()) patch[key] = normalizeSettingValue(key, params.patch[key]);
  if (!Object.keys(patch).length) fail('LINGXI_NO_CHANGES', '设置补丁不能为空');
  return { patch, reason: cleanText(params.reason, '修改原因', 500) };
}

function settingsDiff(current, patch) {
  const diff = [];
  for (const key of Object.keys(patch).sort()) {
    if (sameValue(current[key], patch[key])) continue;
    diff.push(diffEntry(`/_ui/settings/${pointerSegment(key)}`, current[key], patch[key]));
  }
  if (!diff.length) fail('LINGXI_NO_CHANGES', '这些设置已经是目标值');
  return diff;
}

export class UISettingsActionAdapter extends BrokerOnlyAdapter {
  constructor({ stateManager = defaultStateManager, settingsGateway = null, applySettings = null } = {}) {
    super();
    if (!stateManager?.getSub) fail('LINGXI_ADAPTER_INVALID', '设置适配器需要 getSub()');
    this.manager = stateManager;
    this.gateway = settingsGateway || new SettingsConfigGateway(stateManager);
    if (typeof this.gateway?.saveUISettings !== 'function') {
      fail('LINGXI_ADAPTER_INVALID', '设置适配器需要 saveUISettings() 网关');
    }
    this.applySettings = applySettings || (async settings => {
      if (typeof document === 'undefined') return;
      const { applyLocalSettings } = await import('../../../ui/settings-panel.js');
      applyLocalSettings(settings);
    });
    if (typeof this.applySettings !== 'function') {
      fail('LINGXI_ADAPTER_INVALID', '设置适配器的 applySettings 必须是函数');
    }
    this.toolName = LINGXI_SETTINGS_TOOL;
  }

  _read() {
    return clone(this.manager.getSub('_ui')?.settings || {});
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const normalized = normalizeSettingsParams(params);
    const current = this._read();
    const stateFingerprint = await fingerprintValue(current);
    const diff = settingsDiff(current, normalized.patch);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint,
      context: {
        actionImpact: impact(
          'settings',
          `保存 ${diff.length} 项界面设置`,
          diff.map(entry => `${entry.path.split('/').at(-1)}: ${String(entry.before ?? '未设置')} -> ${String(entry.after)}`)
        )
      },
      diff,
      ttlMs,
      now
    });
    if (canonicalStringify(this._read()) !== canonicalStringify(current)) {
      fail('LINGXI_PROPOSAL_STALE', '界面设置在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    await this.authorize(proposal, approvalPermit);
    const normalized = normalizeSettingsParams(proposal.params);
    const current = this._read();
    if (await fingerprintValue(current) !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '界面设置在提案后发生了变化，请重新生成提案');
    }
    const diff = settingsDiff(current, normalized.patch);
    await assertDiffBinding(proposal, diff, '界面设置');
    if (canonicalStringify(this._read()) !== canonicalStringify(current)) {
      fail('LINGXI_PROPOSAL_STALE', '界面设置在提交前发生了变化');
    }
    await this.gateway.saveUISettings(normalized.patch);
    const after = this._read();
    for (const [key, value] of Object.entries(normalized.patch)) {
      if (canonicalStringify(after[key]) !== canonicalStringify(value)) {
        fail('LINGXI_APPLY_FAILED', `设置网关没有保存已批准的 ${key}`);
      }
    }
    await this.applySettings(clone(after));
    defaultEventBus.emit('settings:changed', clone(after));
    return {
      ...receipt(proposal, await fingerprintValue(after), diff),
      uiApplied: true
    };
  }
}

function normalizeOpeningStageParams(params, now) {
  assertOnlyKeys(params, new Set(['draft', 'mode', 'startNow', 'reason']), 'LINGXI_OPENING_INVALID', '开局参数');
  const mode = params.mode || (params.startNow === true ? 'start' : 'save');
  if (mode !== 'save' && mode !== 'start') fail('LINGXI_OPENING_INVALID', '开局模式只能是 save 或 start');
  if (!isRecord(params.draft)) fail('LINGXI_OPENING_INVALID', '开局草稿必须是对象');
  const draft = normalizeOpeningDraft(params.draft);
  if (!draft.identity.name) fail('LINGXI_OPENING_INVALID', '开局草稿必须填写忍名');
  return {
    mode,
    draft,
    reason: cleanText(params.reason, '修改原因', 500),
    savedAt: new Date(Number(now)).toISOString()
  };
}

function normalizeStoredOpeningParams(params) {
  assertOnlyKeys(params, new Set(['draft', 'mode', 'reason', 'savedAt']), 'LINGXI_OPENING_INVALID', '已签名开局参数');
  if (params.mode !== 'save' && params.mode !== 'start') fail('LINGXI_OPENING_INVALID', '开局模式无效');
  const savedAt = cleanText(params.savedAt, '保存时间', 80);
  if (!Number.isFinite(Date.parse(savedAt))) fail('LINGXI_OPENING_INVALID', '保存时间无效');
  const draft = normalizeOpeningDraft(params.draft);
  if (!draft.identity.name) fail('LINGXI_OPENING_INVALID', '开局草稿必须填写忍名');
  return {
    mode: params.mode,
    draft,
    reason: cleanText(params.reason, '修改原因', 500),
    savedAt
  };
}

function openingPreset(params) {
  return { ...serializeOpeningPreset(params.draft), saved_at: params.savedAt };
}

const OPENING_EQUIPPED_SLOT = Object.freeze({
  weapon: '物品·已装备·武器',
  armor: '物品·已装备·防具',
  accessory1: '物品·已装备·饰品1',
  accessory2: '物品·已装备·饰品2'
});
const OPENING_ITEM_CATEGORY = Object.freeze({
  weapons: '武器', armor: '防具', tools: '道具', consumables: '消耗品'
});
const OPENING_QUALITY_BONUS = Object.freeze({
  '破烂': { power: 0, defense: 0, attr: 0 },
  '普通': { power: 3, defense: 1, attr: 0 },
  '精良': { power: 8, defense: 3, attr: 1 },
  '优秀': { power: 15, defense: 6, attr: 2 },
  '史诗': { power: 25, defense: 10, attr: 4 },
  '传说': { power: 40, defense: 18, attr: 7 }
});

function createOpeningShadowManager(manager) {
  if (typeof manager?.getDefaultState !== 'function' || typeof manager?.prepareRestore !== 'function') {
    fail('LINGXI_ADAPTER_INVALID', '开局精确预演需要 getDefaultState() 和 prepareRestore()');
  }
  let state = null;
  const prepare = snapshot => {
    const prepared = manager.prepareRestore(clone(snapshot));
    if (!prepared?.state || typeof prepared.state !== 'object' || Array.isArray(prepared.state)) {
      fail('LINGXI_ADAPTER_INVALID', '开局预演得到无效状态');
    }
    return clone(prepared.state);
  };
  return {
    get state() { return state; },
    getDefaultState: () => clone(manager.getDefaultState()),
    restore(snapshot) { state = prepare(snapshot); },
    snapshot() { return clone(state); },
    get(key) {
      if (key === undefined) return clone(state);
      return clone(state?.[key]);
    },
    update(updates) {
      const next = clone(state);
      for (const update of updates || []) {
        const key = String(update?.key || '');
        if (!key) continue;
        if (update.op === '=') next[key] = clone(update.value);
        else if (update.op === '+' || update.op === '-') {
          const current = Number(next[key]);
          const amount = Number(update.value);
          if (!Number.isFinite(current) || !Number.isFinite(amount)) continue;
          next[key] = update.op === '+' ? current + amount : Math.max(0, current - amount);
        }
      }
      state = prepare(next);
    },
    setSub(key, value) {
      const next = clone(state);
      next[key] = clone(value);
      state = prepare(next);
    }
  };
}

function createOpeningShadowEquipment(manager) {
  const itemCategory = name => {
    const state = manager.snapshot();
    for (const [category, label] of Object.entries(OPENING_ITEM_CATEGORY)) {
      if (Object.keys(state).some(key => key.startsWith(`物品·${label}·${name}·`))) return category;
    }
    return null;
  };
  const applyBonus = (name, category, direction) => {
    const label = OPENING_ITEM_CATEGORY[category] || '道具';
    const quality = manager.get(`物品·${label}·${name}·品质`) || '普通';
    const bonus = OPENING_QUALITY_BONUS[quality] || OPENING_QUALITY_BONUS['普通'];
    const operation = direction > 0 ? '+' : '-';
    const updates = [];
    if (category === 'weapons') {
      updates.push({ key: '属性·速度', op: operation, value: Math.floor(bonus.power * 0.3) });
    } else if (category === 'armor') {
      updates.push({ key: '属性·生命力', op: operation, value: bonus.defense });
      updates.push({ key: '属性·当前生命力', op: operation, value: bonus.defense });
    } else if (category === 'tools' && bonus.attr > 0) {
      updates.push({ key: '属性·幸运', op: operation, value: bonus.attr });
    }
    if (updates.length) manager.update(updates);
  };
  const unequip = slot => {
    const slotKey = OPENING_EQUIPPED_SLOT[slot];
    const previous = slotKey ? manager.get(slotKey) : '';
    if (!previous) return;
    const category = itemCategory(previous);
    if (category) applyBonus(previous, category, -1);
    manager.update([{ key: slotKey, op: '=', value: '' }]);
  };
  return {
    equip(slot, name, category) {
      const slotKey = OPENING_EQUIPPED_SLOT[slot];
      if (!slotKey) return false;
      if (manager.get(slotKey)) unequip(slot);
      const label = OPENING_ITEM_CATEGORY[category] || '道具';
      const quantityKey = `物品·${label}·${name}·数量`;
      const quantity = Number(manager.get(quantityKey));
      const hasItem = Number.isFinite(quantity) && quantity > 0;
      if (category !== 'consumables' && !hasItem) return false;
      const updates = [{ key: slotKey, op: '=', value: name }];
      if (category === 'consumables' && quantity > 0) {
        updates.push({ key: quantityKey, op: '-', value: 1 });
      }
      manager.update(updates);
      applyBonus(name, category, 1);
      return true;
    }
  };
}

function previewDefaultOpeningRuntime(draft, manager, createOpeningContract, savedAt) {
  const shadowManager = createOpeningShadowManager(manager);
  const shadowEquipment = createOpeningShadowEquipment(shadowManager);
  initializeOpeningRuntime(draft, {
    stateManager: shadowManager,
    equipmentSystem: shadowEquipment,
    createOpeningContract: args => ({
      ...createOpeningContract(args),
      created_at: savedAt
    })
  });
  return shadowManager.snapshot();
}

function safeJson(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try { return JSON.parse(raw); } catch { return String(raw); }
}

function gameEvidence(state, nodes) {
  const meta = state?._meta || {};
  return {
    nodeId: meta.current_node_id || state?.['系统·当前节点'] || null,
    branchId: meta.active_branch || state?.['系统·当前分支'] || 'branch_main',
    turn: Number(state?.['系统·回合数']) || 0,
    playerName: String(state?.['玩家·姓名'] || ''),
    hasOpeningContract: Boolean(state?._opening_contract),
    timelineNodes: nodes.map(node => String(node?.id || '')).filter(Boolean).sort()
  };
}

function assertEmptyGame(evidence) {
  if (evidence.nodeId || evidence.turn !== 0 || evidence.playerName
    || evidence.hasOpeningContract || evidence.timelineNodes.length !== 0) {
    fail('LINGXI_OPENING_NOT_EMPTY', '当前已有开局或时间线，灵希不会覆盖现有游戏');
  }
}

function openingDiff(target, params, initializedState = null) {
  const preset = openingPreset(params);
  const diff = [diffEntry(`/localStorage/${START_PRESET_V2_KEY}`, safeJson(target.presetRaw), preset)];
  if (params.mode === 'start') {
    if (!initializedState || typeof initializedState !== 'object' || Array.isArray(initializedState)) {
      fail('LINGXI_ADAPTER_INVALID', '开局 start 模式缺少精确预演状态');
    }
    diff.push(...buildExactStateDiff(target.state, initializedState));
  }
  return diff;
}

export class OpeningActionAdapter extends BrokerOnlyAdapter {
  constructor({
    stateManager = defaultStateManager,
    storage = globalThis.localStorage,
    readTimelineNodes = null,
    initializeOpening = null,
    previewOpening = null,
    createOpeningContract = defaultCreateOpeningContract,
    emitCharacterCreated = null,
    restoreOpeningState = null
  } = {}) {
    super();
    if (!storage?.getItem || !storage?.setItem || !stateManager?.snapshot) {
      fail('LINGXI_ADAPTER_INVALID', '开局适配器需要存储和 snapshot()');
    }
    this.manager = stateManager;
    this.storage = storage;
    this.readTimelineNodes = readTimelineNodes || (() => stateManager.dbGetAll?.('timeline_nodes') || []);
    this.initializeOpening = initializeOpening || ((draft, { savedAt } = {}) => initializeOpeningRuntime(draft, {
      stateManager,
      equipmentSystem: defaultEquipmentSystem,
      createOpeningContract: args => ({
        ...createOpeningContract(args),
        created_at: savedAt
      })
    }));
    this.previewOpening = previewOpening || ((draft, _before, { savedAt } = {}) => (
      previewDefaultOpeningRuntime(draft, stateManager, createOpeningContract, savedAt)
    ));
    this.emitCharacterCreated = emitCharacterCreated || (payload => defaultEventBus.emit('character:created', payload));
    this.restoreOpeningState = restoreOpeningState || (snapshot => stateManager.restore?.(snapshot));
    this.toolName = LINGXI_OPENING_TOOL;
  }

  _previewInitializedState(params, beforeState) {
    const liveBefore = canonicalStringify(this.manager.snapshot());
    const preview = this.previewOpening(clone(params.draft), clone(beforeState), {
      savedAt: params.savedAt
    });
    if (preview && typeof preview.then === 'function') {
      fail('LINGXI_ADAPTER_INVALID', '开局预演函数必须同步完成');
    }
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
      fail('LINGXI_ADAPTER_INVALID', '开局预演函数必须返回完整状态对象');
    }
    if (canonicalStringify(this.manager.snapshot()) !== liveBefore) {
      fail('LINGXI_STAGE_SIDE_EFFECT', '开局预演修改了真实游戏状态，提案已拒绝');
    }
    return clone(preview);
  }

  _restorePreset(raw) {
    const current = this.storage.getItem(START_PRESET_V2_KEY);
    if (current === raw) return;
    if (raw === null) {
      if (typeof this.storage.removeItem !== 'function') {
        fail('LINGXI_OPENING_ROLLBACK_FAILED', '无法移除失败提交写入的新开局预设');
      }
      this.storage.removeItem(START_PRESET_V2_KEY);
    } else {
      this.storage.setItem(START_PRESET_V2_KEY, raw);
    }
    if (this.storage.getItem(START_PRESET_V2_KEY) !== raw) {
      fail('LINGXI_OPENING_ROLLBACK_FAILED', '失败提交后未能恢复原开局预设');
    }
  }

  _rollbackFailedCommit(target, cause, { restoreState }) {
    const errors = [];
    if (restoreState) {
      try {
        if (typeof this.restoreOpeningState !== 'function') {
          throw new Error('缺少 restoreOpeningState()');
        }
        const result = this.restoreOpeningState(clone(target.state));
        if (result && typeof result.then === 'function') {
          throw new Error('restoreOpeningState() 必须同步完成');
        }
        if (canonicalStringify(this.manager.snapshot()) !== canonicalStringify(target.state)) {
          throw new Error('游戏状态回滚后与原状态不一致');
        }
      } catch (error) {
        errors.push(`state: ${error?.message || error}`);
      }
    }
    try {
      this._restorePreset(target.presetRaw);
    } catch (error) {
      errors.push(`preset: ${error?.message || error}`);
    }
    if (errors.length) {
      fail('LINGXI_OPENING_ROLLBACK_FAILED', '开局提交失败，且未能精确恢复原数据', {
        cause: cause?.code || cause?.message || String(cause),
        rollbackErrors: errors
      });
    }
    throw cause;
  }

  _storePreset(params) {
    const serialized = JSON.stringify(openingPreset(params));
    this.storage.setItem(START_PRESET_V2_KEY, serialized);
    if (this.storage.getItem(START_PRESET_V2_KEY) !== serialized) {
      fail('LINGXI_APPLY_FAILED', '开局预设存储没有保留已批准的精确内容');
    }
  }

  async _read(mode) {
    const target = { presetRaw: this.storage.getItem(START_PRESET_V2_KEY) };
    if (mode === 'start') {
      const state = this.manager.snapshot();
      const nodes = await this.readTimelineNodes();
      if (!Array.isArray(nodes)) fail('LINGXI_ADAPTER_INVALID', '时间线读取结果必须是数组');
      target.state = state;
      target.game = gameEvidence(state, nodes);
    }
    return target;
  }

  _fingerprintTarget(target) {
    return target.state
      ? { presetRaw: target.presetRaw, state: target.state, game: target.game }
      : { presetRaw: target.presetRaw };
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const normalized = normalizeOpeningStageParams(params, now);
    const target = await this._read(normalized.mode);
    if (normalized.mode === 'start') assertEmptyGame(target.game);
    const initializedState = normalized.mode === 'start'
      ? this._previewInitializedState(normalized, target.state)
      : null;
    const diff = openingDiff(target, normalized, initializedState);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint: await fingerprintValue(this._fingerprintTarget(target)),
      context: {
        actionImpact: impact(
          'opening',
          normalized.mode === 'start' ? `初始化并开始「${normalized.draft.identity.name}」的开局` : `保存「${normalized.draft.identity.name}」的开局草稿`,
          [
            `模式: ${normalized.mode}`,
            `忍名: ${normalized.draft.identity.name}`,
            normalized.mode === 'start'
              ? `批准后将写入 ${diff.length - 1} 项游戏状态变化，并触发一次开场事件`
              : '批准后只保存草稿，不开始游戏'
          ]
        )
      },
      diff,
      ttlMs,
      now
    });
    const finalTarget = await this._read(normalized.mode);
    if (canonicalStringify(this._fingerprintTarget(finalTarget)) !== canonicalStringify(this._fingerprintTarget(target))) {
      fail('LINGXI_PROPOSAL_STALE', '开局目标在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    await this.authorize(proposal, approvalPermit);
    const normalized = normalizeStoredOpeningParams(proposal.params);
    const target = await this._read(normalized.mode);
    if (normalized.mode === 'start') assertEmptyGame(target.game);
    if (await fingerprintValue(this._fingerprintTarget(target)) !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '开局草稿或当前游戏在提案后发生了变化');
    }
    const expectedInitializedState = normalized.mode === 'start'
      ? this._previewInitializedState(normalized, target.state)
      : null;
    const diff = openingDiff(target, normalized, expectedInitializedState);
    await assertDiffBinding(proposal, diff, '开局');

    const finalTarget = await this._read(normalized.mode);
    if (canonicalStringify(this._fingerprintTarget(finalTarget)) !== canonicalStringify(this._fingerprintTarget(target))) {
      fail('LINGXI_PROPOSAL_STALE', '开局目标在提交前发生了变化');
    }
    if (normalized.mode === 'start') assertEmptyGame(finalTarget.game);

    let initialized = null;
    try {
      if (normalized.mode === 'start') {
        initialized = this.initializeOpening(clone(normalized.draft), { savedAt: normalized.savedAt });
        if (initialized && typeof initialized.then === 'function') {
          fail('LINGXI_ADAPTER_INVALID', '开局初始化函数必须同步完成，才能保证一次性提交');
        }
      }
      this._storePreset(normalized);
      if (normalized.mode === 'start') {
        const actualState = this.manager.snapshot();
        const actualDiff = openingDiff(finalTarget, normalized, actualState);
        if (canonicalStringify(actualDiff) !== canonicalStringify(diff)) {
          fail('LINGXI_OPENING_DIFF_MISMATCH', '真实开局写入与已批准的精确差异不一致');
        }
      }
    } catch (error) {
      this._rollbackFailedCommit(finalTarget, error, { restoreState: normalized.mode === 'start' });
    }
    const afterTarget = await this._read(normalized.mode);
    const afterReceipt = receipt(
      proposal,
      await fingerprintValue(this._fingerprintTarget(afterTarget)),
      diff
    );
    if (normalized.mode === 'start') {
      if (canonicalStringify(this.manager.snapshot()) !== canonicalStringify(expectedInitializedState)
        || this.storage.getItem(START_PRESET_V2_KEY) !== JSON.stringify(openingPreset(normalized))) {
        fail('LINGXI_ROLLBACK_CONFLICT', '开场事件触发前检测到新的状态提交，请检查当前存档');
      }
      this.emitCharacterCreated({
        name: normalized.draft.identity.name,
        contract: this.manager.snapshot()._opening_contract || initialized?._opening_contract || null,
        draftVersion: normalized.draft.version
      });
    }
    return afterReceipt;
  }
}

function normalizeWorldbookEntry(value) {
  assertOnlyKeys(value, new Set(['title', 'keys', 'content', 'category', 'enabled']), 'LINGXI_WORLDBOOK_INVALID', '世界书条目');
  const title = cleanText(value.title, '世界书标题', 160);
  if (!Array.isArray(value.keys)) fail('LINGXI_WORLDBOOK_INVALID', '世界书关键词必须是数组');
  const keys = [...new Set(value.keys.map(item => cleanText(item, '世界书关键词', 100)).filter(Boolean))].slice(0, 32);
  if (!keys.length) fail('LINGXI_WORLDBOOK_INVALID', '世界书至少需要一个关键词');
  const content = cleanText(value.content, '世界书正文', 100_000);
  const category = cleanText(value.category ?? 'custom', '世界书分类', 80);
  if (!/^[\p{L}\p{N}_\- ·]+$/u.test(category)) fail('LINGXI_WORLDBOOK_INVALID', '世界书分类包含不支持的字符');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    fail('LINGXI_WORLDBOOK_INVALID', '世界书 enabled 必须是布尔值');
  }
  return { title, keys, content, category, enabled: value.enabled !== false };
}

function normalizeWorldbookParams(params) {
  assertOnlyKeys(params, new Set(['entry', 'action', 'target', 'reason']), 'LINGXI_WORLDBOOK_INVALID', '世界书参数');
  const reason = cleanText(params.reason, '修改原因', 500);
  if (params.entry !== undefined) {
    if ((params.action !== undefined && params.action !== 'upsert') || params.target !== undefined) {
      fail('LINGXI_WORLDBOOK_INVALID', '世界书新增/更新不能同时包含 action 或 target');
    }
    return { action: 'upsert', entry: normalizeWorldbookEntry(params.entry), reason };
  }

  const action = cleanText(params.action, '世界书操作', 40);
  const allowed = new Set(['enable', 'disable', 'delete', 'enable_all', 'disable_all', 'delete_all']);
  if (!allowed.has(action)) fail('LINGXI_WORLDBOOK_INVALID', `不支持的世界书操作: ${action}`);
  const needsTarget = action === 'enable' || action === 'disable' || action === 'delete';
  if (!needsTarget) {
    if (params.target !== undefined) fail('LINGXI_WORLDBOOK_INVALID', `${action} 不接受单条 target`);
    return { action, reason };
  }

  assertOnlyKeys(params.target, new Set(['index', 'title', 'fingerprint']), 'LINGXI_WORLDBOOK_INVALID', '世界书目标');
  const index = params.target.index;
  if (!Number.isInteger(index) || index < 0 || index > 100_000) {
    fail('LINGXI_WORLDBOOK_INVALID', '世界书目标 index 必须是非负整数');
  }
  const fingerprint = cleanText(params.target.fingerprint, '世界书目标指纹', 128);
  if (!/^(?:sha256:[a-f0-9]{64}|fnv1a128:[a-f0-9]{32})$/i.test(fingerprint)) {
    fail('LINGXI_WORLDBOOK_INVALID', '世界书目标指纹格式无效');
  }
  return {
    action,
    target: {
      index,
      title: cleanText(params.target.title, '世界书目标标题', 160),
      fingerprint: fingerprint.toLowerCase()
    },
    reason
  };
}

function parseArray(raw, label) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { fail('LINGXI_STORED_DATA_INVALID', `${label}不是有效 JSON`); }
  if (!Array.isArray(value)) fail('LINGXI_STORED_DATA_INVALID', `${label}必须是数组`);
  return value;
}

function pureWorldbookSnapshot(storage, knowledgeBase) {
  const customRaw = storage?.getItem?.(WORLDBOOK_CUSTOM_KEY) || null;
  const legacyRaw = storage?.getItem?.(WORLDBOOK_LEGACY_KEY) || null;
  if (customRaw) return { entries: parseArray(customRaw, '自定义世界书'), fingerprintSource: { customRaw, legacyRaw } };
  if (!legacyRaw) return { entries: [], fingerprintSource: { customRaw, legacyRaw } };
  const builtin = new Map((knowledgeBase.getDefaultEntries?.() || []).map(entry => [entry.title, entry]));
  const entries = parseArray(legacyRaw, '旧版世界书').filter(entry => {
    const original = builtin.get(entry?.title);
    return !original || JSON.stringify(entry?.keys) !== JSON.stringify(original.keys)
      || entry?.content !== original.content;
  }).map(entry => ({ ...entry, source: 'custom', enabled: entry.enabled !== false }));
  return { entries, fingerprintSource: { customRaw, legacyRaw } };
}

function assertSafeStoredEntries(entries) {
  if (!Array.isArray(entries)) fail('LINGXI_STORED_DATA_INVALID', '自定义世界书必须是数组');
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) fail('LINGXI_STORED_DATA_INVALID', `世界书第 ${index + 1} 项必须是对象`);
    for (const key of Object.keys(entry)) {
      if (FORBIDDEN_KEYS.has(key)) fail('LINGXI_STORED_DATA_INVALID', `世界书第 ${index + 1} 项含不安全字段`);
    }
  }
}

function upsertWorldbook(entries, approvedEntry) {
  const next = clone(entries);
  const index = next.findIndex(entry => String(entry?.title || '').trim() === approvedEntry.title);
  const before = index >= 0 ? clone(next[index]) : undefined;
  const after = { ...(before || {}), ...clone(approvedEntry), source: 'custom' };
  if (index >= 0) next[index] = after;
  else next.push(after);
  return {
    entries: next,
    diff: [diffEntry(`/worldbook/custom/${pointerSegment(approvedEntry.title)}`, before, after)]
  };
}

async function resolveWorldbookTarget(entries, target) {
  const entry = entries[target.index];
  if (!entry
    || String(entry.title || '').trim() !== target.title
    || await hashCanonical(entry) !== target.fingerprint) {
    fail('LINGXI_WORLDBOOK_TARGET_STALE', '世界书目标已变化，请重新读取条目后再创建提案');
  }
  return entry;
}

async function mutateWorldbook(entries, normalized) {
  if (normalized.action === 'upsert') return upsertWorldbook(entries, normalized.entry);

  const next = clone(entries);
  if (normalized.target) await resolveWorldbookTarget(next, normalized.target);
  if (normalized.action === 'delete') {
    const before = clone(next[normalized.target.index]);
    next.splice(normalized.target.index, 1);
    return {
      entries: next,
      diff: [diffEntry(`/worldbook/custom/${normalized.target.index}`, before, undefined)]
    };
  }
  if (normalized.action === 'enable' || normalized.action === 'disable') {
    const enabled = normalized.action === 'enable';
    const index = normalized.target.index;
    const before = next[index].enabled !== false;
    if (before === enabled) fail('LINGXI_NO_CHANGES', `世界书条目已经${enabled ? '启用' : '停用'}`);
    next[index] = { ...next[index], enabled };
    return {
      entries: next,
      diff: [diffEntry(`/worldbook/custom/${index}/enabled`, before, enabled)]
    };
  }
  if (normalized.action === 'delete_all') {
    if (!next.length) fail('LINGXI_NO_CHANGES', '当前没有可删除的自定义世界书条目');
    return {
      entries: [],
      diff: next.map((entry, index) => diffEntry(`/worldbook/custom/${index}`, entry, undefined))
    };
  }

  const enabled = normalized.action === 'enable_all';
  const diff = [];
  for (let index = 0; index < next.length; index += 1) {
    const before = next[index].enabled !== false;
    if (before === enabled) continue;
    next[index] = { ...next[index], enabled };
    diff.push(diffEntry(`/worldbook/custom/${index}/enabled`, before, enabled));
  }
  if (!diff.length) fail('LINGXI_NO_CHANGES', `全部自定义世界书条目已经${enabled ? '启用' : '停用'}`);
  return { entries: next, diff };
}

function worldbookImpact(normalized, entries, diff) {
  if (normalized.action === 'upsert') {
    const existed = diff[0].before !== undefined;
    return impact(
      'worldbook',
      `${existed ? '更新' : '新增'}世界书条目「${normalized.entry.title}」`,
      [`标题: ${normalized.entry.title}`, `关键词: ${normalized.entry.keys.join('、')}`, `分类: ${normalized.entry.category}`]
    );
  }
  const labels = {
    enable: '启用',
    disable: '停用',
    delete: '删除',
    enable_all: '启用全部',
    disable_all: '停用全部',
    delete_all: '删除全部'
  };
  const destructive = normalized.action === 'delete' || normalized.action === 'delete_all';
  const targetTitle = normalized.target?.title;
  const summary = targetTitle
    ? `${labels[normalized.action]}自定义世界书条目「${targetTitle}」`
    : `${labels[normalized.action]}自定义世界书条目（${diff.length} 项变化）`;
  const details = [
    `操作: ${normalized.action}`,
    `变化数量: ${diff.length}`,
    ...(targetTitle ? [`目标: ${targetTitle}`, `目标索引: ${normalized.target.index}`] : []),
    ...(destructive ? ['删除不可撤销；恢复默认会清空全部自定义条目'] : []),
    ...entries.slice(0, 12).map(entry => `影响条目: ${String(entry?.title || '无标题').slice(0, 160)}`)
  ];
  return impact('worldbook', summary, details);
}

export class WorldbookActionAdapter extends BrokerOnlyAdapter {
  constructor({
    storage = globalThis.localStorage,
    knowledgeBase = defaultKnowledgeBase,
    readCustomEntries = null
  } = {}) {
    super();
    if (!knowledgeBase?.saveCustomEntries || !knowledgeBase?.invalidateCache) {
      fail('LINGXI_ADAPTER_INVALID', '世界书适配器需要保存和缓存失效接口');
    }
    this.storage = storage;
    this.knowledgeBase = knowledgeBase;
    this.readCustomEntries = readCustomEntries || (() => pureWorldbookSnapshot(storage, knowledgeBase));
    this.toolName = LINGXI_WORLDBOOK_TOOL;
  }

  async _read() {
    const result = await this.readCustomEntries();
    const snapshot = Array.isArray(result)
      ? { entries: result, fingerprintSource: result }
      : result;
    assertSafeStoredEntries(snapshot?.entries);
    return { entries: clone(snapshot.entries), fingerprintSource: clone(snapshot.fingerprintSource ?? snapshot.entries) };
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const normalized = normalizeWorldbookParams(params);
    const target = await this._read();
    const { entries, diff } = await mutateWorldbook(target.entries, normalized);
    if (normalized.action === 'upsert'
      && diff[0].before
      && canonicalStringify(diff[0].before) === canonicalStringify(diff[0].after)) {
      fail('LINGXI_NO_CHANGES', '世界书条目已经是目标内容');
    }
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint: await fingerprintValue(target.fingerprintSource),
      context: {
        actionImpact: worldbookImpact(normalized, normalized.target ? [target.entries[normalized.target.index]] : target.entries, diff)
      },
      diff,
      ttlMs,
      now
    });
    const finalTarget = await this._read();
    if (canonicalStringify(finalTarget.fingerprintSource) !== canonicalStringify(target.fingerprintSource)) {
      fail('LINGXI_PROPOSAL_STALE', '自定义世界书在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    await this.authorize(proposal, approvalPermit);
    const normalized = normalizeWorldbookParams(proposal.params);
    const target = await this._read();
    if (await fingerprintValue(target.fingerprintSource) !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '自定义世界书在提案后发生了变化');
    }
    const { entries, diff } = await mutateWorldbook(target.entries, normalized);
    await assertDiffBinding(proposal, diff, '世界书');
    const finalTarget = await this._read();
    if (canonicalStringify(finalTarget.fingerprintSource) !== canonicalStringify(target.fingerprintSource)) {
      fail('LINGXI_PROPOSAL_STALE', '自定义世界书在提交前发生了变化');
    }
    const saveResult = this.knowledgeBase.saveCustomEntries(clone(entries));
    if (saveResult && typeof saveResult.then === 'function') {
      fail('LINGXI_ADAPTER_INVALID', '世界书保存接口必须同步完成');
    }
    this.knowledgeBase.invalidateCache();
    const after = await this._read();
    if (canonicalStringify(after.entries) !== canonicalStringify(entries)) {
      fail('LINGXI_APPLY_FAILED', '世界书保存接口没有保留已批准的精确条目列表');
    }
    return receipt(proposal, await fingerprintValue(after.fingerprintSource), diff);
  }
}

function normalizeStoryList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('LINGXI_STORY_INVALID', `${label}必须是数组`);
  return [...new Set(value.map(item => cleanText(item, label, 300)).filter(Boolean))].slice(0, 12);
}

function normalizeStoryStageParams(params, branchId, now) {
  assertOnlyKeys(params, new Set(['direction', 'goals', 'avoid', 'reason']), 'LINGXI_STORY_INVALID', '剧情方向参数');
  return {
    branchId,
    direction: cleanText(params.direction, '剧情方向', 1200),
    goals: normalizeStoryList(params.goals, '剧情目标'),
    avoid: normalizeStoryList(params.avoid, '避开事项'),
    reason: cleanText(params.reason, '修改原因', 500),
    updatedAt: new Date(Number(now)).toISOString()
  };
}

function normalizeStoredStoryParams(params) {
  assertOnlyKeys(params, new Set(['branchId', 'direction', 'goals', 'avoid', 'reason', 'updatedAt']), 'LINGXI_STORY_INVALID', '已签名剧情方向参数');
  const updatedAt = cleanText(params.updatedAt, '更新时间', 80);
  if (!Number.isFinite(Date.parse(updatedAt))) fail('LINGXI_STORY_INVALID', '剧情方向更新时间无效');
  return {
    branchId: cleanText(params.branchId, '分支 ID', 160),
    direction: cleanText(params.direction, '剧情方向', 1200),
    goals: normalizeStoryList(params.goals, '剧情目标'),
    avoid: normalizeStoryList(params.avoid, '避开事项'),
    reason: cleanText(params.reason, '修改原因', 500),
    updatedAt
  };
}

function activeBranch(state) {
  return cleanText(state?._meta?.active_branch || state?.['系统·当前分支'] || 'branch_main', '当前分支', 160);
}

function storyTarget(state) {
  return {
    nodeId: String(state?._meta?.current_node_id || state?.['系统·当前节点'] || '').trim(),
    branchId: activeBranch(state),
    direction: clone(state?._story_direction ?? null),
    plan: clone(state?._agent_story_plan ?? null),
    invalidated: state?._agent_story_plan_invalidated === true
  };
}

function storyDiff(target, params) {
  const nextDirection = {
    branchId: params.branchId,
    direction: params.direction,
    goals: params.goals,
    avoid: params.avoid,
    updatedAt: params.updatedAt
  };
  const diff = [diffEntry('/_story_direction', target.direction, nextDirection)];
  if (target.plan !== undefined && target.plan !== null) diff.push(diffEntry('/_agent_story_plan', target.plan, null));
  if (!target.invalidated) diff.push(diffEntry('/_agent_story_plan_invalidated', target.invalidated, true));
  return { diff, nextDirection };
}

export class StoryDirectionActionAdapter extends BrokerOnlyAdapter {
  constructor({
    stateManager = defaultStateManager,
    timelineSystem = defaultTimelineSystem,
    writeStoryState = null,
    restoreStoryState = null
  } = {}) {
    super();
    if (!stateManager?.snapshot) fail('LINGXI_ADAPTER_INVALID', '剧情方向适配器需要 snapshot()');
    if (typeof timelineSystem?.persistCurrentStoryState !== 'function') {
      fail('LINGXI_ADAPTER_INVALID', '剧情方向适配器需要时间线持久化接口');
    }
    this.manager = stateManager;
    this.timelineSystem = timelineSystem;
    this.writeStoryState = writeStoryState || (({ direction }) => {
      if (typeof stateManager.setSub !== 'function') fail('LINGXI_ADAPTER_INVALID', '剧情方向写入需要 setSub()');
      stateManager.setSub('_story_direction', clone(direction));
      stateManager.setSub('_agent_story_plan', null);
      stateManager.setSub('_agent_story_plan_invalidated', true);
    });
    this.restoreStoryState = restoreStoryState || (snapshot => stateManager.restore?.(snapshot));
    this.toolName = LINGXI_STORY_DIRECTION_TOOL;
  }

  _read() {
    return storyTarget(this.manager.snapshot());
  }

  async stage(params, { now = Date.now(), ttlMs } = {}) {
    const target = this._read();
    if (!target.nodeId) {
      fail('LINGXI_CHECKPOINT_REQUIRED', '当前还没有可持久化剧情方向的时间线节点');
    }
    const normalized = normalizeStoryStageParams(params, target.branchId, now);
    const { diff } = storyDiff(target, normalized);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalized,
      stateFingerprint: await fingerprintValue(target),
      context: {
        actionImpact: impact(
          'story',
          `更新分支「${target.branchId}」的未来剧情方向`,
          [
            `方向: ${normalized.direction}`,
            `持久化节点: ${target.nodeId}`,
            normalized.goals.length ? `目标: ${normalized.goals.join('、')}` : '目标: 未指定',
            normalized.avoid.length ? `避开: ${normalized.avoid.join('、')}` : '避开: 未指定'
          ]
        )
      },
      diff,
      ttlMs,
      now
    });
    if (canonicalStringify(this._read()) !== canonicalStringify(target)) {
      fail('LINGXI_PROPOSAL_STALE', '剧情方向在提案生成期间发生了变化');
    }
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    await this.authorize(proposal, approvalPermit);
    const normalized = normalizeStoredStoryParams(proposal.params);
    const target = this._read();
    if (!target.nodeId
      || target.branchId !== normalized.branchId
      || await fingerprintValue(target) !== proposal.stateFingerprint) {
      fail('LINGXI_PROPOSAL_STALE', '当前分支或剧情规划在提案后发生了变化');
    }
    const { diff, nextDirection } = storyDiff(target, normalized);
    await assertDiffBinding(proposal, diff, '剧情方向');
    if (canonicalStringify(this._read()) !== canonicalStringify(target)) {
      fail('LINGXI_PROPOSAL_STALE', '剧情方向在提交前发生了变化');
    }
    const beforeState = this.manager.snapshot();
    let postWriteCanonical = null;
    try {
      const writeResult = this.writeStoryState({ direction: clone(nextDirection) });
      if (writeResult && typeof writeResult.then === 'function') {
        fail('LINGXI_ADAPTER_INVALID', '剧情方向写入函数必须同步完成');
      }
      const afterWrite = this._read();
      if (canonicalStringify(afterWrite.direction) !== canonicalStringify(nextDirection)
        || afterWrite.plan !== null || afterWrite.invalidated !== true
        || afterWrite.branchId !== normalized.branchId || afterWrite.nodeId !== target.nodeId) {
        fail('LINGXI_APPLY_FAILED', '剧情方向没有按批准内容完整写入');
      }
      postWriteCanonical = canonicalStringify(this.manager.snapshot());
      const persisted = await this.timelineSystem.persistCurrentStoryState({
        expectedNodeId: target.nodeId,
        expectedBranchId: target.branchId,
        before: {
          direction: clone(target.direction),
          plan: clone(target.plan),
          invalidated: target.invalidated
        },
        after: {
          direction: clone(nextDirection),
          plan: null,
          invalidated: true
        }
      });
      if (persisted?.status !== 'updated' || persisted.nodeId !== target.nodeId) {
        fail('LINGXI_PROPOSAL_STALE', '当前时间线节点未接受已批准的剧情方向');
      }
    } catch (error) {
      if (postWriteCanonical === null) {
        const changed = canonicalStringify(this.manager.snapshot()) !== canonicalStringify(beforeState);
        if (!changed) throw error;
        postWriteCanonical = canonicalStringify(this.manager.snapshot());
      }
      if (canonicalStringify(this.manager.snapshot()) !== postWriteCanonical) {
        fail(
          'LINGXI_ROLLBACK_CONFLICT',
          '剧情方向持久化失败后检测到新的状态提交；为避免覆盖并发数据，灵希没有自动回滚。',
          { persistenceError: error?.code || error?.message || 'UNKNOWN_PERSISTENCE_ERROR' }
        );
      }
      try {
        const restoreResult = this.restoreStoryState(clone(beforeState));
        if (restoreResult && typeof restoreResult.then === 'function') {
          throw new Error('restoreStoryState() 必须同步完成');
        }
        if (canonicalStringify(this.manager.snapshot()) !== canonicalStringify(beforeState)) {
          throw new Error('剧情方向回滚后与提交前状态不一致');
        }
      } catch (rollbackError) {
        fail('LINGXI_STORY_ROLLBACK_FAILED', '剧情方向持久化失败，且无法精确恢复提交前状态', {
          cause: error?.code || error?.message || String(error),
          rollbackError: rollbackError?.code || rollbackError?.message || String(rollbackError)
        });
      }
      throw error;
    }
    const after = this._read();
    if (canonicalStringify(this.manager.snapshot()) !== postWriteCanonical) {
      fail(
        'LINGXI_ROLLBACK_CONFLICT',
        '剧情方向持久化完成时检测到新的状态提交；灵希保留了并发现场，请检查当前存档。'
      );
    }
    const afterFingerprint = await fingerprintValue(after);
    if (canonicalStringify(this.manager.snapshot()) !== postWriteCanonical) {
      fail(
        'LINGXI_ROLLBACK_CONFLICT',
        '剧情方向回执生成期间检测到新的状态提交；灵希保留了并发现场，请检查当前存档。'
      );
    }
    return receipt(proposal, afterFingerprint, diff);
  }
}

export function createProjectWriteAdapters(options = {}) {
  return [
    new UISettingsActionAdapter(options),
    new OpeningActionAdapter(options),
    new WorldbookActionAdapter(options),
    new StoryDirectionActionAdapter(options)
  ];
}

export default createProjectWriteAdapters;
