import { stateManager as defaultStateManager } from '../../state-manager.js';
import {
  STRUCTURED_SCALAR_PATH_MAP,
  VAR_SCHEMA,
  calendarMonthFromValue,
  coerceValue,
  isKnownKey,
  isNumeric,
  normalizeStructuredVariableUpdate,
  resolveAlias,
  validateStructuredVariableUpdate
} from '../../../data/var-schema.js';
import { validateOpeningContractWrite } from '../../../systems/opening-contract.js';
import { normalizeNpcIdentity } from '../../../data/npc-identity.js';
import {
  calculateCombatLevel,
  combatAttributesFromNpcCard,
  combatAttributesFromPlayerState,
  combatMasteriesFromNpcCard,
  combatMasteriesFromPlayerState
} from '../../../systems/combat-level.js';
import {
  LingXiActionError,
  canonicalStringify,
  createActionProposal,
  fingerprintValue,
  hashCanonical,
  verifyActionProposal
} from '../action-proposal.js';
import { consumeBrokerApprovedProposal } from '../approval-broker.js';

export const LINGXI_VARIABLE_PATCH_TOOL = 'apply_variable_patch';

const MAX_UPDATES = 50;
const MAX_UPDATE_CHARS = 50_000;
const MAX_PARAMS_CHARS = 200_000;
const MAX_DIFF_ENTRIES = 500;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PARAM_KEYS = new Set(['updates', 'reason']);
const UPDATE_KEYS = new Set(['path', 'key', 'op', 'value']);
const RESERVED_CONTEXT_KEYS = new Set(['nodeId', 'branchId', 'stateRevision']);
const SKILL_FIELDS = new Set([
  'name', 'rank', 'element', 'cost', 'resource', 'resource_type', 'power', 'mastery',
  'description', 'type', 'technique_id', 'source'
]);
const ITEM_FIELDS = new Set(['quantity', 'quality', 'description', 'name', 'type', 'power', 'cost', 'element']);
const LOCATION_FIELDS = new Set(['x', 'y', 'desc', 'tier']);
const SKILL_CATEGORY = Object.freeze({
  jutsu: '忍术',
  taijutsu: '体术',
  genjutsu: '幻术',
  support: '支援',
  talents: '天赋',
  kekkei_genkai: '血继限界'
});
const SKILL_FIELD = Object.freeze({
  name: '名称',
  rank: '等级',
  element: '属性',
  cost: '消耗',
  resource: '消耗资源',
  resource_type: '消耗资源',
  power: '威力',
  mastery: '熟练度',
  description: '描述',
  type: '类型',
  technique_id: '数据库ID',
  source: '来源'
});
const ITEM_CATEGORY = Object.freeze({
  weapons: '武器',
  armor: '防具',
  tools: '道具',
  consumables: '消耗品'
});
const ITEM_FIELD = Object.freeze({
  quantity: '数量',
  quality: '品质',
  description: '描述',
  name: '名称',
  type: '类型',
  power: '威力',
  cost: '消耗',
  element: '属性'
});
const EQUIPPED_SLOT = Object.freeze({
  weapon: '武器',
  armor: '防具',
  accessory1: '饰品1',
  accessory2: '饰品2'
});

function fail(code, message, details = null) {
  throw new LingXiActionError(code, message, details);
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      fail('LINGXI_VARIABLE_PATCH_INVALID', `${label} contains unsupported key: ${key}`);
    }
  }
}

function assertFieldKeys(value, allowed, label) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) {
      fail('LINGXI_VARIABLE_NOT_WHITELISTED', `${label} field is not schema-whitelisted: ${key}`);
    }
  }
}

function assertSafeObjectKey(value, label) {
  if (FORBIDDEN_KEYS.has(String(value || ''))) {
    fail('LINGXI_VARIABLE_NOT_WHITELISTED', `${label} uses an unsafe object key`);
  }
}

function isAllowedFlatKey(key) {
  if (key === '系统·回合数' || key === '系统·当前节点' || key === '系统·当前分支') return false;
  // Inventory mutations have domain side effects (equipped bonuses, item use,
  // automatic unequip) and must go through EquipmentActionAdapter.
  if (key.startsWith('物品·')) return false;
  if (Object.prototype.hasOwnProperty.call(VAR_SCHEMA, key)) return true;
  if (!isKnownKey(key)) return false;
  return key.startsWith('技能·')
    || key.startsWith('进度·声望·');
}

function normalizeFlatUpdate(update) {
  if (update.path) fail('LINGXI_VARIABLE_PATCH_INVALID', 'A flat variable update cannot also contain path');
  const key = resolveAlias(String(update.key || '').trim());
  const normalized = { key, op: String(update.op || '').trim() };
  if (Object.prototype.hasOwnProperty.call(update, 'value')) normalized.value = clone(update.value);
  if (!isAllowedFlatKey(key)) {
    fail('LINGXI_VARIABLE_NOT_WHITELISTED', `Flat variable is not writable by Ling Xi: ${key || '(empty)'}`);
  }
  const validation = validateStructuredVariableUpdate(normalized);
  if (!validation.valid) {
    fail('LINGXI_VARIABLE_NOT_WHITELISTED', validation.reason, { update: normalized });
  }
  return normalized;
}

function normalizePathUpdate(update) {
  const path = String(update.path || '').trim();
  if (path === 'equipment' || path.startsWith('equipment.')) {
    fail(
      'LINGXI_VARIABLE_NOT_WHITELISTED',
      'Equipment and inventory writes must use the dedicated equipment action tool'
    );
  }
  if (update.path === 'skills.kekkei_genkai' && update.op === 'set') {
    fail('LINGXI_VARIABLE_NOT_WHITELISTED', 'Legacy whole bloodline collection writes are not exposed to Ling Xi');
  }
  if (update.path === 'world_state.map.known_locations') {
    assertSafeObjectKey(update.key, 'Map location');
    if (update.op === 'assign') assertFieldKeys(update.value, LOCATION_FIELDS, 'Map location');
  }
  const skillObject = String(update.path || '').match(
    /^skills\.(jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai)\.[^.]+$/
  );
  if (skillObject && update.op === 'set') assertFieldKeys(update.value, SKILL_FIELDS, 'Skill');
  const itemObject = String(update.path || '').match(/^equipment\.(weapons|armor|tools|consumables)\.[^.]+$/);
  if (itemObject && update.op === 'set') assertFieldKeys(update.value, ITEM_FIELDS, 'Item');

  const normalized = {
    path: String(update.path || '').trim(),
    op: String(update.op || '').trim().toLowerCase()
  };
  if (Object.prototype.hasOwnProperty.call(update, 'key')) normalized.key = String(update.key || '').trim();
  if (normalized.op !== 'remove' && Object.prototype.hasOwnProperty.call(update, 'value')) {
    normalized.value = clone(update.value);
  }
  const validation = validateStructuredVariableUpdate(normalized);
  if (!validation.valid) {
    fail('LINGXI_VARIABLE_NOT_WHITELISTED', validation.reason, { update: normalized });
  }
  return normalized;
}

export function normalizeLingXiVariableParams(params = {}) {
  if (!isRecord(params)) fail('LINGXI_VARIABLE_PATCH_INVALID', 'Variable patch params must be an object');
  assertOnlyKeys(params, PARAM_KEYS, 'Variable patch params');
  if (!Array.isArray(params.updates) || params.updates.length === 0 || params.updates.length > MAX_UPDATES) {
    fail('LINGXI_VARIABLE_PATCH_INVALID', `Variable patch requires 1-${MAX_UPDATES} updates`);
  }
  const reason = params.reason == null ? '' : String(params.reason).trim();
  if (reason.length > 1_000) fail('LINGXI_VARIABLE_PATCH_INVALID', 'Variable patch reason is too long');

  const updates = params.updates.map((raw, index) => {
    if (!isRecord(raw)) fail('LINGXI_VARIABLE_PATCH_INVALID', `Variable update ${index + 1} must be an object`);
    assertOnlyKeys(raw, UPDATE_KEYS, `Variable update ${index + 1}`);
    if (canonicalStringify(raw).length > MAX_UPDATE_CHARS) {
      fail('LINGXI_VARIABLE_PATCH_INVALID', `Variable update ${index + 1} is too large`);
    }
    const normalized = normalizeStructuredVariableUpdate(clone(raw));
    if (normalized?.key && ['=', '+', '-'].includes(normalized.op)) return normalizeFlatUpdate(normalized);
    return normalizePathUpdate(normalized || {});
  });
  const result = reason ? { updates, reason } : { updates };
  if (canonicalStringify(result).length > MAX_PARAMS_CHARS) {
    fail('LINGXI_VARIABLE_PATCH_INVALID', 'Variable patch is too large');
  }
  return result;
}

function applyFlat(state, update) {
  const key = update.key;
  if (update.op === '=') {
    const value = coerceValue(key, update.value);
    if (value === undefined) fail('LINGXI_VARIABLE_PATCH_INVALID', `Variable value is invalid: ${key}`);
    state[key] = value;
    if (key === '世界·时间') {
      const month = calendarMonthFromValue(value);
      if (month != null) state['世界·月份'] = month;
    }
    return;
  }
  if (!isNumeric(key)) fail('LINGXI_VARIABLE_PATCH_INVALID', `Variable is not numeric: ${key}`);
  let current = Number(state[key]);
  if (!Number.isFinite(current) && Object.prototype.hasOwnProperty.call(VAR_SCHEMA, key)) {
    current = Number(VAR_SCHEMA[key].default ?? 0);
  }
  if (!Number.isFinite(current)) fail('LINGXI_VARIABLE_PATCH_INVALID', `Variable has no numeric current value: ${key}`);
  const delta = Number(update.value);
  state[key] = update.op === '-' ? Math.max(0, current - delta) : current + delta;
}

function removeFlatEntity(state, prefix) {
  for (const key of Object.keys(state)) {
    if (key === prefix || key.startsWith(`${prefix}·`)) delete state[key];
  }
}

function applySkillUpdate(state, update, match) {
  const [, categoryId, name, field] = match;
  const category = SKILL_CATEGORY[categoryId];
  const base = `技能·${category}·${name}`;
  if (update.op === 'remove' && !field) {
    removeFlatEntity(state, base);
    return;
  }
  if (update.op === 'set' && !field) {
    for (const [sourceField, value] of Object.entries(update.value)) {
      applyFlat(state, { key: `${base}·${SKILL_FIELD[sourceField]}`, op: '=', value });
    }
    return;
  }
  if (update.op === 'assign') {
    applyFlat(state, { key: `${base}·${SKILL_FIELD[update.key]}`, op: '=', value: update.value });
    return;
  }
  applyFlat(state, {
    key: `${base}·${SKILL_FIELD[field]}`,
    op: update.op === 'set' ? '=' : update.op === 'add' ? '+' : '-',
    value: update.value
  });
}

function applyItemUpdate(state, update, match) {
  const [, categoryId, name, field] = match;
  const base = `物品·${ITEM_CATEGORY[categoryId]}·${name}`;
  if (update.op === 'remove' && !field) {
    removeFlatEntity(state, base);
    return;
  }
  if (update.op === 'set' && !field) {
    for (const [sourceField, value] of Object.entries(update.value)) {
      applyFlat(state, { key: `${base}·${ITEM_FIELD[sourceField]}`, op: '=', value });
    }
    return;
  }
  applyFlat(state, {
    key: `${base}·${ITEM_FIELD[field]}`,
    op: update.op === 'set' ? '=' : update.op === 'add' ? '+' : '-',
    value: update.value
  });
}

function applyPath(state, update) {
  const flatKey = STRUCTURED_SCALAR_PATH_MAP[update.path];
  if (flatKey) {
    applyFlat(state, {
      key: flatKey,
      op: update.op === 'set' ? '=' : update.op === 'add' ? '+' : '-',
      value: update.value
    });
    return;
  }

  if (update.path === 'world_state.map.explored_regions') {
    if (update.op === 'set') {
      state['世界·已探索区域'] = [...update.value].join('，');
    } else {
      const regions = String(state['世界·已探索区域'] || '').split(/[，,]/).map(item => item.trim()).filter(Boolean);
      if (!regions.includes(update.value)) regions.push(update.value);
      state['世界·已探索区域'] = regions.join('，');
    }
    return;
  }
  if (update.path === 'world_state.map.known_locations') {
    if (!isRecord(state._map)) state._map = { known_locations: {}, active_pins: '' };
    if (!isRecord(state._map.known_locations)) state._map.known_locations = {};
    if (update.op === 'remove') delete state._map.known_locations[update.key];
    else state._map.known_locations[update.key] = clone(update.value);
    return;
  }
  if (update.path === 'progression.reputation') {
    delete state[`进度·声望·${update.key}`];
    return;
  }
  const reputation = update.path.match(/^progression\.reputation\.(.+)$/);
  if (reputation) {
    applyFlat(state, {
      key: `进度·声望·${reputation[1]}`,
      op: update.op === 'set' ? '=' : update.op === 'add' ? '+' : '-',
      value: update.value
    });
    return;
  }
  const equipped = update.path.match(/^equipment\.equipped\.(weapon|armor|accessory1|accessory2)$/);
  if (equipped) {
    const key = `物品·已装备·${EQUIPPED_SLOT[equipped[1]]}`;
    if (update.op === 'remove') delete state[key];
    else applyFlat(state, { key, op: '=', value: update.value });
    return;
  }
  const skillCollection = update.path.match(/^skills\.(jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai)$/);
  if (skillCollection && update.op === 'remove') {
    removeFlatEntity(state, `技能·${SKILL_CATEGORY[skillCollection[1]]}·${update.key}`);
    return;
  }
  const skill = update.path.match(
    /^skills\.(jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai)\.([^.]+)(?:\.([^.]+))?$/
  );
  if (skill) {
    applySkillUpdate(state, update, skill);
    return;
  }
  const itemCollection = update.path.match(/^equipment\.(weapons|armor|tools|consumables)$/);
  if (itemCollection && update.op === 'remove') {
    removeFlatEntity(state, `物品·${ITEM_CATEGORY[itemCollection[1]]}·${update.key}`);
    return;
  }
  const item = update.path.match(/^equipment\.(weapons|armor|tools|consumables)\.([^.]+)(?:\.([^.]+))?$/);
  if (item) {
    applyItemUpdate(state, update, item);
    return;
  }
  fail('LINGXI_VARIABLE_NOT_WHITELISTED', `No state adapter exists for variable path: ${update.path}`);
}

export function applyLingXiVariableUpdates(state, updates) {
  const next = clone(state);
  for (const update of updates) {
    if (update.key && ['=', '+', '-'].includes(update.op)) applyFlat(next, update);
    else applyPath(next, update);
  }
  return next;
}

function pointerPart(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function addDiff(diff, path, operation, before, after) {
  if (diff.length >= MAX_DIFF_ENTRIES) {
    fail('LINGXI_DIFF_TOO_LARGE', `Variable patch changes more than ${MAX_DIFF_ENTRIES} values`);
  }
  const entry = { path: path || '/', operation };
  if (operation === 'add') {
    entry.before = null;
    entry.after = clone(after);
  } else if (operation === 'remove') {
    entry.before = clone(before);
    entry.after = null;
  } else {
    entry.before = clone(before);
    entry.after = clone(after);
  }
  diff.push(entry);
}

function diffValue(before, after, path, diff) {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) || Array.isArray(after) || !isRecord(before) || !isRecord(after)) {
    if (canonicalStringify(before) !== canonicalStringify(after)) addDiff(diff, path, 'replace', before, after);
    return;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    const childPath = `${path}/${pointerPart(key)}`;
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
    if (!hasBefore) addDiff(diff, childPath, 'add', null, after[key]);
    else if (!hasAfter) addDiff(diff, childPath, 'remove', before[key], null);
    else diffValue(before[key], after[key], childPath, diff);
  }
}

export function buildExactStateDiff(before, after) {
  const diff = [];
  diffValue(before, after, '', diff);
  return diff;
}

function pointerSegments(path) {
  return String(path || '')
    .split('/')
    .slice(1)
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function enforceOpeningContract(before, diff) {
  const contract = before?._opening_contract;
  if (!contract) return;
  const turn = Number(before['系统·回合数']) || 0;
  for (const entry of diff) {
    const segments = pointerSegments(entry.path);
    if (segments.length !== 1 || segments[0].startsWith('_')) continue;
    const result = validateOpeningContractWrite(
      contract,
      segments[0],
      entry.operation === 'remove' ? undefined : entry.after,
      { turn, op: entry.operation === 'remove' ? 'remove' : 'set' }
    );
    if (!result.allowed) {
      fail('LINGXI_OPENING_CONTRACT_BLOCKED', `Opening contract rejected ${segments[0]}: ${result.reason}`, result);
    }
  }
}

function stateRevision(manager) {
  if (typeof manager.getStateRevision === 'function') {
    const value = manager.getStateRevision();
    return Number.isFinite(value) ? value : null;
  }
  return Number.isFinite(manager._stateVersion) ? manager._stateVersion : null;
}

function assertUnchanged(manager, canonicalSnapshot, revision) {
  if (revision !== null && stateRevision(manager) !== revision) {
    fail('LINGXI_PROPOSAL_STALE', 'Game state revision changed before the action could be committed');
  }
  if (canonicalStringify(manager.snapshot()) !== canonicalSnapshot) {
    fail('LINGXI_PROPOSAL_STALE', 'Game state changed before the action could be committed');
  }
}

function applyAliveInvariant(prepared) {
  const state = prepared.state;
  if (state['玩家·存活'] !== '否'
    && typeof state['属性·当前生命力'] === 'number'
    && state['属性·当前生命力'] <= 0) {
    state['玩家·存活'] = '否';
    state['玩家·死因'] = state['玩家·死因'] || '生命力归零';
  }
}

function applyCombatLevelInvariants(prepared) {
  const state = prepared.state;
  const playerLevel = calculateCombatLevel(
    combatAttributesFromPlayerState(state),
    combatMasteriesFromPlayerState(state)
  );
  if (playerLevel !== (state['玩家·战力等级'] || 'E级')) {
    state['玩家·战力等级'] = playerLevel;
  }

  const relationships = state._relationships;
  if (!relationships || typeof relationships !== 'object' || Array.isArray(relationships)) return;
  for (const [name, relationship] of Object.entries(relationships)) {
    if (normalizeNpcIdentity(name) !== name) continue;
    const card = relationship?.combat_stats;
    if (!card || typeof card !== 'object') continue;
    const level = calculateCombatLevel(
      combatAttributesFromNpcCard(card),
      combatMasteriesFromNpcCard(card)
    );
    if (card.战力等级 === level) continue;
    relationships[name] = {
      ...relationship,
      combat_stats: { ...card, 战力等级: level }
    };
  }
}

export class StateVariableActionAdapter {
  #approvalPermit = null;

  constructor(manager = defaultStateManager) {
    if (!manager?.snapshot || !manager?.prepareRestore || !manager?.commitPreparedRestore) {
      fail(
        'LINGXI_STATE_ADAPTER_INVALID',
        'State adapter requires snapshot(), prepareRestore(), and commitPreparedRestore() for atomic writes'
      );
    }
    this.manager = manager;
    this.toolName = LINGXI_VARIABLE_PATCH_TOOL;
  }

  bindApprovalPermit(permit) {
    if (!permit || typeof permit !== 'object') {
      fail('LINGXI_STATE_ADAPTER_INVALID', 'Approval permit must be an opaque object');
    }
    if (this.#approvalPermit && this.#approvalPermit !== permit) {
      fail('LINGXI_STATE_ADAPTER_INVALID', 'State adapter is already bound to another approval broker');
    }
    this.#approvalPermit = permit;
  }

  _simulate(before, params) {
    const candidate = applyLingXiVariableUpdates(before, params.updates);
    const prepared = this.manager.prepareRestore(candidate);
    if (!prepared?.state || !isRecord(prepared.state)) {
      fail('LINGXI_STATE_ADAPTER_INVALID', 'State manager returned an invalid prepared restore');
    }
    applyAliveInvariant(prepared);
    applyCombatLevelInvariants(prepared);
    const diff = buildExactStateDiff(before, prepared.state);
    if (diff.length === 0) fail('LINGXI_NO_CHANGES', 'Variable patch does not change the current state');
    enforceOpeningContract(before, diff);
    return { prepared, diff };
  }

  async stage(params, { now = Date.now(), ttlMs, context = {} } = {}) {
    if (!isRecord(context)) {
      fail('LINGXI_PROPOSAL_INVALID', 'Proposal context must be a plain record');
    }
    for (const key of RESERVED_CONTEXT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(context, key)) {
        fail('LINGXI_PROPOSAL_INVALID', `Proposal context cannot override reserved field: ${key}`);
      }
    }
    const normalizedParams = normalizeLingXiVariableParams(params);
    const before = this.manager.snapshot();
    const beforeCanonical = canonicalStringify(before);
    const revision = stateRevision(this.manager);
    const stateFingerprint = await fingerprintValue(before);
    assertUnchanged(this.manager, beforeCanonical, revision);
    const { diff } = this._simulate(before, normalizedParams);
    const proposal = await createActionProposal({
      tool: this.toolName,
      params: normalizedParams,
      stateFingerprint,
      context: {
        ...context,
        nodeId: before?._meta?.current_node_id || null,
        branchId: before?._meta?.active_branch || 'branch_main',
        stateRevision: revision
      },
      diff,
      ttlMs,
      now
    });
    assertUnchanged(this.manager, beforeCanonical, revision);
    return proposal;
  }

  async apply(proposal, approvalPermit) {
    const brokerApproved = consumeBrokerApprovedProposal(proposal);
    const directlyBound = this.#approvalPermit && approvalPermit === this.#approvalPermit;
    if (!brokerApproved || (this.#approvalPermit && !directlyBound)) {
      fail('LINGXI_APPROVAL_REQUIRED', 'Variable patches can only be applied by the bound approval broker');
    }
    await verifyActionProposal(proposal);
    if (proposal.tool !== this.toolName) {
      fail('LINGXI_PROPOSAL_INVALID', `State adapter cannot apply tool ${proposal.tool}`);
    }
    const current = this.manager.snapshot();
    const currentCanonical = canonicalStringify(current);
    const revision = stateRevision(this.manager);
    const fingerprint = await fingerprintValue(current);
    if (fingerprint !== proposal.stateFingerprint
      || (proposal.context?.stateRevision !== null && proposal.context?.stateRevision !== revision)) {
      fail('LINGXI_PROPOSAL_STALE', 'Game state changed after the variable patch was proposed');
    }

    const params = normalizeLingXiVariableParams(proposal.params);
    const { prepared, diff } = this._simulate(current, params);
    const diffHash = await hashCanonical(diff);
    if (diffHash !== proposal.diffHash) {
      fail('LINGXI_PROPOSAL_TAMPERED', 'Recomputed variable diff does not match the approved proposal');
    }

    // No await is allowed between this final comparison and the synchronous commit.
    assertUnchanged(this.manager, currentCanonical, revision);
    const expectedCanonical = canonicalStringify(prepared.state);
    this.manager.commitPreparedRestore(prepared);
    const after = this.manager.snapshot();
    if (canonicalStringify(after) !== expectedCanonical) {
      let rollbackError = null;
      try {
        this.manager.restore(current);
      } catch (error) {
        rollbackError = error;
      }
      fail(
        'LINGXI_UNAPPROVED_DERIVED_CHANGE',
        'A synchronous state listener changed values outside the approved diff; the variable patch was rejected',
        {
          rollbackExact: !rollbackError
            && canonicalStringify(this.manager.snapshot()) === currentCanonical,
          rollbackError: rollbackError?.code || rollbackError?.message || null
        }
      );
    }
    const afterFingerprint = await fingerprintValue(after);
    return {
      schema: 'naruto.lingxi-action-receipt/v1',
      proposalId: proposal.id,
      tool: this.toolName,
      appliedAt: Date.now(),
      beforeFingerprint: proposal.stateFingerprint,
      afterFingerprint,
      diff: clone(diff)
    };
  }
}

export function createStateVariableActionAdapter(manager = defaultStateManager) {
  return new StateVariableActionAdapter(manager);
}

export default StateVariableActionAdapter;
