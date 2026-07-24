import { deepClone, generateId } from '../utils/format.js';

export const MEMORY_EVENT_SCHEMA = 'naruto.memory-event/v1';
export const CONTINUITY_LEDGER_SCHEMA = 'naruto.continuity-ledger/v1';
export const CONTINUITY_ANCHORS_SCHEMA = 'naruto.continuity-anchors/v1';
export const LEGACY_MEMORY_MIGRATION_VERSION = 1;

export const MEMORY_TRUTH_VALUES = Object.freeze([
  'confirmed', 'reported', 'inferred', 'disputed', 'legacy_unverified'
]);

export const MEMORY_VISIBILITY_VALUES = Object.freeze([
  'public', 'narrator', 'private', 'secret', 'backstage'
]);

const TRUTH_SET = new Set(MEMORY_TRUTH_VALUES);
const VISIBILITY_SET = new Set(MEMORY_VISIBILITY_VALUES);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SYSTEM_AUDIENCES = new Set(['narrator', 'writer', 'updater', 'reviewer', 'planner']);
const MAX_EVENT_VALUE_BYTES = 24_000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, fallback = '', max = 320) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}

function stringList(value, { maxItems = 64, maxLength = 160 } = {}) {
  const source = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  return [...new Set(source.map(item => cleanText(item, '', maxLength)).filter(Boolean))].slice(0, maxItems);
}

function assertJsonSafe(value, label = 'value') {
  const seen = new WeakSet();
  const stack = [{ value, path: label, depth: 0 }];
  while (stack.length) {
    const current = stack.pop();
    const item = current.value;
    if (item == null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError(`${current.path} 不能包含非有限数值`);
      continue;
    }
    if (typeof item !== 'object') throw new TypeError(`${current.path} 必须是可序列化 JSON`);
    if (current.depth > 20) throw new TypeError(`${current.path} 嵌套过深`);
    if (seen.has(item)) throw new TypeError(`${current.path} 不能包含循环引用或重复对象引用`);
    seen.add(item);
    for (const key of Object.keys(item)) {
      if (UNSAFE_KEYS.has(key)) throw new TypeError(`${current.path}.${key} 包含不安全键`);
      stack.push({ value: item[key], path: `${current.path}.${key}`, depth: current.depth + 1 });
    }
  }
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new TypeError(`${label} 必须是可序列化 JSON`); }
  if ((serialized?.length || 0) > MAX_EVENT_VALUE_BYTES) {
    throw new TypeError(`${label} 超过 ${MAX_EVENT_VALUE_BYTES} 字符限制`);
  }
}

function cloneJson(value, label = 'value') {
  assertJsonSafe(value, label);
  return deepClone(value);
}

function normalizeSource(source, fallback = 'runtime') {
  if (typeof source === 'string') return { kind: cleanText(source, fallback, 80), ref: '' };
  if (!isRecord(source)) return { kind: fallback, ref: '' };
  return {
    kind: cleanText(source.kind ?? source.type, fallback, 80),
    ref: cleanText(source.ref ?? source.id ?? source.path, '', 240)
  };
}

function normalizeEvidence(evidence) {
  const source = Array.isArray(evidence) ? evidence : (evidence == null ? [] : [evidence]);
  return source.slice(0, 32).map((item, index) => {
    if (typeof item === 'string') return { kind: 'text', ref: cleanText(item, '', 500) };
    if (!isRecord(item)) return { kind: 'text', ref: cleanText(item, '', 500) };
    return {
      kind: cleanText(item.kind ?? item.type, 'evidence', 80),
      ref: cleanText(item.ref ?? item.id ?? item.text ?? `evidence_${index}`, '', 500)
    };
  }).filter(item => item.ref);
}

function normalizeImportance(value, type = '') {
  if (Number.isInteger(value)) return Math.max(0, Math.min(5, value));
  if (['promise', 'injury', 'mission', 'inventory', 'technique', 'relationship'].includes(type)) return 4;
  if (['clue', 'important_event', 'state_change'].includes(type)) return 3;
  if (type.startsWith('legacy_')) return 1;
  return 2;
}

function defaultPredicateForType(type) {
  const map = {
    promise: '承诺', injury: '伤势', mission: '任务', inventory: '物品状态',
    technique: '技能状态', relationship: '关系', clue: '线索', summary: '剧情摘要',
    retraction: '撤回事实'
  };
  return map[type] || '事实';
}

function defaultVisibilityForTruth(truth) {
  return truth === 'legacy_unverified' ? 'narrator' : 'public';
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function eventFingerprint(event) {
  return JSON.stringify(event);
}

export function createContinuityLedger() {
  return {
    schema: CONTINUITY_LEDGER_SCHEMA,
    revision: 0,
    legacy_migration_version: 0,
    events: []
  };
}

export function normalizeMemoryEvent(input, context = {}) {
  if (!isRecord(input)) throw new TypeError('MemoryEvent 必须是对象');
  const type = cleanText(input.type, 'fact', 64).toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_');
  const truth = cleanText(input.truth, context.truth || 'confirmed', 40);
  const visibility = cleanText(input.visibility, context.visibility || defaultVisibilityForTruth(truth), 40);
  const defaultKnownBy = visibility === 'public' ? ['*'] : ['narrator'];
  const nodeId = cleanText(input.node_id ?? input.nodeId, context.nodeId || 'uncommitted', 160);
  const branchId = cleanText(input.branch_id ?? input.branchId, context.branchId || 'branch_main', 160);
  const sequence = Number.isInteger(input.sequence)
    ? input.sequence
    : (Number.isInteger(context.sequence) ? context.sequence : 0);
  const turn = Number.isInteger(input.turn)
    ? input.turn
    : (Number.isInteger(context.turn) ? context.turn : 0);
  const recordedAt = Number.isFinite(input.recorded_at)
    ? Number(input.recorded_at)
    : (Number.isFinite(context.recordedAt) ? Number(context.recordedAt) : Date.now());
  const rawValue = Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : input.text ?? '';
  const value = rawValue === undefined ? null : rawValue;
  const normalized = {
    schema: MEMORY_EVENT_SCHEMA,
    event_id: cleanText(input.event_id ?? input.eventId ?? input.id, generateId('memory'), 160),
    node_id: nodeId,
    branch_id: branchId,
    sequence,
    turn,
    game_time: cleanText(input.game_time ?? input.gameTime, context.gameTime || '', 160),
    type: type || 'fact',
    subject_id: cleanText(input.subject_id ?? input.subjectId, context.subjectId || 'world', 160),
    predicate: cleanText(input.predicate, defaultPredicateForType(type), 160),
    value: cloneJson(value, 'MemoryEvent.value'),
    truth,
    visibility,
    known_by: stringList(input.known_by ?? input.knownBy ?? context.knownBy ?? defaultKnownBy),
    valid_from: cleanText(input.valid_from ?? input.validFrom, context.validFrom || '', 160) || null,
    valid_to: cleanText(input.valid_to ?? input.validTo, context.validTo || '', 160) || null,
    source: normalizeSource(input.source, context.source || 'runtime'),
    evidence: normalizeEvidence(input.evidence),
    supersedes: stringList(input.supersedes, { maxItems: 32 }),
    retracts: stringList(input.retracts, { maxItems: 32 }),
    importance: normalizeImportance(input.importance, type),
    recorded_at: recordedAt
  };
  const inspection = inspectMemoryEvent(normalized);
  if (!inspection.valid) throw new TypeError(`MemoryEvent 无效: ${inspection.errors.join('; ')}`);
  return normalized;
}

export function inspectMemoryEvent(event) {
  const errors = [];
  if (!isRecord(event)) return { valid: false, errors: ['事件必须是对象'] };
  if (event.schema !== MEMORY_EVENT_SCHEMA) errors.push('schema 不受支持');
  for (const [field, max] of [
    ['event_id', 160], ['node_id', 160], ['branch_id', 160], ['type', 64],
    ['subject_id', 160], ['predicate', 160], ['game_time', 160]
  ]) {
    if (typeof event[field] !== 'string' || !event[field].trim() || event[field].length > max) {
      if (field === 'game_time' && event[field] === '') continue;
      errors.push(`${field} 无效`);
    }
  }
  if (!/^[a-z0-9_.:-]+$/i.test(event.type || '')) errors.push('type 只能使用标识符字符');
  if (!Number.isInteger(event.sequence) || event.sequence < 0) errors.push('sequence 必须是非负整数');
  if (!Number.isInteger(event.turn) || event.turn < 0) errors.push('turn 必须是非负整数');
  if (!Number.isFinite(event.recorded_at) || event.recorded_at < 0) errors.push('recorded_at 无效');
  if (!TRUTH_SET.has(event.truth)) errors.push('truth 无效');
  if (!VISIBILITY_SET.has(event.visibility)) errors.push('visibility 无效');
  if (!Array.isArray(event.known_by) || event.known_by.some(item => typeof item !== 'string' || !item)) {
    errors.push('known_by 必须是非空字符串数组');
  }
  for (const field of ['supersedes', 'retracts']) {
    if (!Array.isArray(event[field]) || event[field].some(item => typeof item !== 'string' || !item)) {
      errors.push(`${field} 必须是字符串数组`);
    } else if (event[field].includes(event.event_id)) {
      errors.push(`${field} 不能引用事件自身`);
    }
  }
  if (!Number.isInteger(event.importance) || event.importance < 0 || event.importance > 5) {
    errors.push('importance 必须是 0..5 的整数');
  }
  if (!isRecord(event.source) || typeof event.source.kind !== 'string') errors.push('source 无效');
  if (!Array.isArray(event.evidence)) errors.push('evidence 必须是数组');
  try { assertJsonSafe(event.value, 'MemoryEvent.value'); } catch (error) { errors.push(error.message); }
  return { valid: errors.length === 0, errors };
}

export function inspectContinuityLedger(ledger) {
  const errors = [];
  if (!isRecord(ledger)) return { valid: false, errors: ['连续性账本必须是对象'] };
  if (ledger.schema !== CONTINUITY_LEDGER_SCHEMA) errors.push('连续性账本 schema 不受支持');
  if (!Number.isInteger(ledger.revision) || ledger.revision < 0) errors.push('账本 revision 必须是非负整数');
  if (!Number.isInteger(ledger.legacy_migration_version) || ledger.legacy_migration_version < 0) {
    errors.push('legacy_migration_version 必须是非负整数');
  }
  if (!Array.isArray(ledger.events)) return { valid: false, errors: [...errors, '账本 events 必须是数组'] };
  const ids = new Set();
  let previousSequence = -1;
  for (let index = 0; index < ledger.events.length; index++) {
    const event = ledger.events[index];
    const result = inspectMemoryEvent(event);
    if (!result.valid) errors.push(`events[${index}]: ${result.errors.join(', ')}`);
    if (ids.has(event?.event_id)) errors.push(`事件 ID 重复: ${event.event_id}`);
    for (const ref of [...(event?.supersedes || []), ...(event?.retracts || [])]) {
      if (!ids.has(ref)) errors.push(`${event?.event_id || index}: 引用了不存在或尚未记录的事件 ${ref}`);
    }
    if (Number.isInteger(event?.sequence) && event.sequence <= previousSequence) {
      errors.push(`${event.event_id || index}: sequence 必须严格递增`);
    }
    if (Number.isInteger(event?.sequence)) previousSequence = event.sequence;
    if (event?.event_id) ids.add(event.event_id);
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeContinuityLedger(input) {
  if (input == null) return createContinuityLedger();
  if (!isRecord(input)) throw new TypeError('连续性账本必须是对象');
  if (input.schema && input.schema !== CONTINUITY_LEDGER_SCHEMA) {
    throw new TypeError(`连续性账本 schema 不受支持: ${input.schema}`);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'events') && !Array.isArray(input.events)) {
    throw new TypeError('连续性账本 events 必须是数组');
  }
  const events = [];
  for (let index = 0; index < (Array.isArray(input.events) ? input.events.length : 0); index++) {
    const raw = input.events[index];
    events.push(normalizeMemoryEvent(raw, { sequence: index + 1 }));
  }
  const ledger = {
    schema: CONTINUITY_LEDGER_SCHEMA,
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    legacy_migration_version: Number.isInteger(input.legacy_migration_version)
      ? Math.max(0, input.legacy_migration_version)
      : 0,
    events
  };
  const inspection = inspectContinuityLedger(ledger);
  if (!inspection.valid) throw new TypeError(`连续性账本无效: ${inspection.errors.join('; ')}`);
  return ledger;
}

export function appendMemoryEvents(inputLedger, eventInputs, context = {}) {
  const ledger = normalizeContinuityLedger(inputLedger);
  const source = Array.isArray(eventInputs) ? eventInputs : (eventInputs == null ? [] : [eventInputs]);
  if (!source.length) return { ledger, appended: [] };
  const events = ledger.events.map(event => deepClone(event));
  const ids = new Set(events.map(event => event.event_id));
  const appended = [];
  for (const input of source) {
    const event = normalizeMemoryEvent(input, {
      ...context,
      sequence: events.length ? events.at(-1).sequence + 1 : 1
    });
    if (ids.has(event.event_id)) throw new Error(`MemoryEvent ID 已存在，不能覆盖: ${event.event_id}`);
    for (const ref of [...event.supersedes, ...event.retracts]) {
      if (!ids.has(ref)) throw new Error(`${event.event_id} 引用了不存在的事件: ${ref}`);
    }
    ids.add(event.event_id);
    events.push(event);
    appended.push(deepClone(event));
  }
  return {
    ledger: {
      ...ledger,
      revision: ledger.revision + 1,
      events
    },
    appended
  };
}

export function supersedeMemoryEvent(inputLedger, targetEventId, replacement, context = {}) {
  const target = cleanText(targetEventId, '', 160);
  if (!target) throw new TypeError('被替代事件 ID 不能为空');
  return appendMemoryEvents(inputLedger, { ...replacement, supersedes: [target, ...(replacement?.supersedes || [])] }, context);
}

export function retractMemoryEvent(inputLedger, targetEventId, reason = '', context = {}) {
  const ledger = normalizeContinuityLedger(inputLedger);
  const target = ledger.events.find(event => event.event_id === targetEventId);
  if (!target) throw new Error(`要撤回的事件不存在: ${targetEventId}`);
  return appendMemoryEvents(ledger, {
    type: 'retraction',
    subject_id: target.subject_id,
    predicate: target.predicate,
    value: cleanText(reason, '该事实已被撤回', 1000),
    truth: 'confirmed',
    visibility: target.visibility,
    known_by: target.known_by,
    retracts: [target.event_id],
    importance: target.importance,
    source: context.source || 'runtime_retraction'
  }, context);
}

export function resolveContinuityEvents(inputLedger) {
  const ledger = normalizeContinuityLedger(inputLedger);
  const statuses = new Map(ledger.events.map(event => [event.event_id, {
    status: 'active', cause_event_id: null
  }]));
  for (let index = ledger.events.length - 1; index >= 0; index--) {
    const controller = ledger.events[index];
    if (statuses.get(controller.event_id)?.status !== 'active') continue;
    for (const targetId of controller.retracts) {
      if (statuses.get(targetId)?.status === 'active') {
        statuses.set(targetId, { status: 'retracted', cause_event_id: controller.event_id });
      }
    }
    for (const targetId of controller.supersedes) {
      if (statuses.get(targetId)?.status === 'active') {
        statuses.set(targetId, { status: 'superseded', cause_event_id: controller.event_id });
      }
    }
  }
  return ledger.events.map(event => ({ ...deepClone(event), ...statuses.get(event.event_id) }));
}

function parseDateOrdinal(value) {
  const text = String(value || '');
  const match = text.match(/(?:K|木叶)\s*(\d{1,4})(?:年|-)(\d{1,2})(?:月|-)(\d{1,2})/i);
  if (!match) return null;
  return Number(match[1]) * 372 + Number(match[2]) * 31 + Number(match[3]);
}

function eventIsValidAt(event, gameTime) {
  const point = parseDateOrdinal(gameTime);
  if (point == null) return true;
  const from = parseDateOrdinal(event.valid_from);
  const to = parseDateOrdinal(event.valid_to);
  if (from != null && point < from) return false;
  return to == null || point < to;
}

function audienceCanSee(event, audienceId, includeBackstage) {
  const audience = cleanText(audienceId, 'narrator', 160);
  if (event.visibility === 'backstage') return includeBackstage && audience === 'narrator';
  if (event.visibility === 'public') return true;
  if (event.known_by.includes('*') || event.known_by.includes(audience)) return true;
  if (event.visibility === 'narrator') return SYSTEM_AUDIENCES.has(audience);
  return audience === 'narrator';
}

export function queryContinuityEvents(inputLedger, options = {}) {
  const events = resolveContinuityEvents(inputLedger);
  const toSet = value => value == null ? null : new Set(Array.isArray(value) ? value : [value]);
  const types = toSet(options.types);
  const subjects = toSet(options.subjectIds ?? options.subject_ids);
  const predicates = toSet(options.predicates);
  const truths = toSet(options.truths ?? options.truth);
  const visibilities = toSet(options.visibilities ?? options.visibility);
  const knownBy = cleanText(options.knownBy ?? options.known_by, '', 160);
  const search = cleanText(options.text, '', 500).toLowerCase();
  const minImportance = Number.isInteger(options.minImportance) ? options.minImportance : 0;
  const limit = Number.isInteger(options.limit) ? Math.max(0, options.limit) : Infinity;
  const filtered = events.filter(event => {
    if (!options.includeInactive && event.status !== 'active') return false;
    if (!options.includeStructural && event.type === 'retraction') return false;
    if (types && !types.has(event.type)) return false;
    if (subjects && !subjects.has(event.subject_id)) return false;
    if (predicates && !predicates.has(event.predicate)) return false;
    if (truths && !truths.has(event.truth)) return false;
    if (visibilities && !visibilities.has(event.visibility)) return false;
    if (event.importance < minImportance) return false;
    if (!eventIsValidAt(event, options.gameTime ?? options.game_time)) return false;
    if (knownBy && event.visibility !== 'public'
        && !event.known_by.includes('*') && !event.known_by.includes(knownBy)) return false;
    if (!audienceCanSee(event, options.audienceId ?? options.audience_id, Boolean(options.includeBackstage))) return false;
    if (search && !`${event.subject_id} ${event.predicate} ${JSON.stringify(event.value)}`.toLowerCase().includes(search)) return false;
    return true;
  });
  filtered.sort((left, right) => right.importance - left.importance || right.sequence - left.sequence);
  return filtered.slice(0, limit).map(event => deepClone(event));
}

export function compileContinuityAnchors(inputLedger, options = {}) {
  const ledger = normalizeContinuityLedger(inputLedger);
  const events = queryContinuityEvents(ledger, {
    truths: options.truths || ['confirmed', 'reported', 'legacy_unverified'],
    minImportance: options.minImportance ?? 2,
    ...options
  });
  const byType = {};
  for (const event of events) {
    if (!byType[event.type]) byType[event.type] = [];
    byType[event.type].push(event.event_id);
  }
  return {
    schema: CONTINUITY_ANCHORS_SCHEMA,
    revision: ledger.revision,
    node_id: cleanText(options.nodeId ?? options.node_id, '', 160) || null,
    branch_id: cleanText(options.branchId ?? options.branch_id, '', 160) || null,
    audience_id: cleanText(options.audienceId ?? options.audience_id, 'narrator', 160),
    events,
    by_type: byType
  };
}

const LEGACY_FIELDS = Object.freeze([
  ['pins', 'legacy_pin', '置顶记忆'],
  ['facts', 'legacy_fact', '旧事实'],
  ['clues', 'legacy_clue', '旧线索'],
  ['long_term', 'legacy_fact', '长期记忆'],
  ['archived', 'legacy_archive', '旧归档'],
  ['recent_summary', 'legacy_summary', '最近剧情摘要'],
  ['turn_summaries', 'legacy_summary', '回合摘要'],
  ['compressed_summary', 'legacy_summary', '压缩摘要'],
  ['important_events', 'legacy_important_event', '重要事件'],
  ['npc_notes', 'legacy_npc_note', 'NPC记录']
]);

function legacyLines(value) {
  if (value == null || value === '') return [];
  if (typeof value === 'string') return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).filter(Boolean);
  if (isRecord(value)) return Object.entries(value).map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`);
  return [String(value)];
}

export function migrateLegacyMemory(inputLedger, legacyMemory, context = {}) {
  let ledger = normalizeContinuityLedger(inputLedger);
  if (ledger.legacy_migration_version >= LEGACY_MEMORY_MIGRATION_VERSION) {
    return { ledger, appended: [], migrated: false };
  }
  const rawEvents = [];
  const scope = `${context.nodeId || 'legacy'}:${context.branchId || 'branch_main'}`;
  if (isRecord(legacyMemory)) {
    for (const [field, type, predicate] of LEGACY_FIELDS) {
      const values = legacyLines(legacyMemory[field]);
      values.forEach((value, index) => rawEvents.push({
        event_id: `legacy_${stableHash(`${scope}|${field}|${index}|${value}`)}`,
        type,
        subject_id: field === 'npc_notes' ? 'legacy_npc_records' : 'legacy_memory',
        predicate,
        value: cleanText(value, '', 2000),
        truth: 'legacy_unverified',
        visibility: 'narrator',
        known_by: ['narrator'],
        importance: field === 'pins' || field === 'important_events' ? 3 : 1,
        source: { kind: 'legacy_memory', ref: field }
      }));
    }
  }
  const appendedResult = appendMemoryEvents(ledger, rawEvents, {
    ...context,
    source: 'legacy_memory',
    truth: 'legacy_unverified',
    visibility: 'narrator',
    recordedAt: context.recordedAt ?? 0
  });
  ledger = {
    ...appendedResult.ledger,
    revision: appendedResult.appended.length ? appendedResult.ledger.revision : ledger.revision + 1,
    legacy_migration_version: LEGACY_MEMORY_MIGRATION_VERSION
  };
  return { ledger, appended: appendedResult.appended, migrated: true };
}

export function prepareContinuityCommit({ ledger, legacyMemory, events = [], context = {} } = {}) {
  const original = normalizeContinuityLedger(ledger);
  const migrated = migrateLegacyMemory(original, legacyMemory, context);
  const appended = appendMemoryEvents(migrated.ledger, events, context);
  const originalIds = new Set(original.events.map(event => event.event_id));
  return {
    ledger: appended.ledger,
    appended: appended.ledger.events.filter(event => !originalIds.has(event.event_id)).map(deepClone),
    migrated: migrated.migrated
  };
}

export function diffContinuityLedgers(baseInput, nextInput) {
  const base = normalizeContinuityLedger(baseInput);
  const next = normalizeContinuityLedger(nextInput);
  const baseById = new Map(base.events.map(event => [event.event_id, event]));
  const appended = [];
  for (const event of next.events) {
    const previous = baseById.get(event.event_id);
    if (!previous) appended.push(deepClone(event));
    else if (eventFingerprint(previous) !== eventFingerprint(event)) {
      throw new Error(`连续性事件不可变约束被破坏: ${event.event_id}`);
    }
  }
  const nextIds = new Set(next.events.map(event => event.event_id));
  for (const event of base.events) {
    if (!nextIds.has(event.event_id)) throw new Error(`连续性事件不能原地删除: ${event.event_id}`);
  }
  return appended;
}

export function rebuildContinuityFromAncestry(nodes, targetNodeId, { preferSnapshot = true } = {}) {
  const nodeById = new Map((nodes || []).filter(node => node?.id).map(node => [node.id, node]));
  const target = nodeById.get(targetNodeId);
  if (!target) throw new Error(`连续性重建失败，节点不存在: ${targetNodeId}`);
  if (preferSnapshot && target.state_snapshot?._continuity) {
    return normalizeContinuityLedger(target.state_snapshot._continuity);
  }
  const chain = [];
  const visited = new Set();
  let cursor = target;
  while (cursor) {
    if (visited.has(cursor.id)) throw new Error('连续性重建失败，时间线父链包含环');
    visited.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parent_id == null ? null : nodeById.get(cursor.parent_id);
    if (cursor == null && chain[0].parent_id != null) throw new Error('连续性重建失败，时间线父节点缺失');
  }
  let ledger = createContinuityLedger();
  ledger.legacy_migration_version = LEGACY_MEMORY_MIGRATION_VERSION;
  for (const node of chain) {
    const result = appendMemoryEvents(ledger, node.continuity_delta || [], {
      nodeId: node.id,
      branchId: node.branch_id,
      turn: node.turn_number,
      gameTime: node.game_time,
      recordedAt: node.created_at || node.real_timestamp || 0,
      source: 'timeline_delta'
    });
    ledger = result.ledger;
    if (Number.isInteger(node.continuity_revision) && node.continuity_revision >= 0) {
      ledger = { ...ledger, revision: node.continuity_revision };
    }
  }
  return ledger;
}

function mappedId(value, mapping) {
  if (!value || !mapping) return value;
  if (typeof mapping === 'function') return mapping(value) ?? value;
  if (mapping instanceof Map) return mapping.get(value) ?? value;
  if (isRecord(mapping)) return mapping[value] ?? value;
  return value;
}

export function remapMemoryEvent(eventInput, {
  nodeIds = null,
  branchIds = null,
  eventIds = null
} = {}) {
  const event = normalizeMemoryEvent(eventInput);
  return normalizeMemoryEvent({
    ...event,
    event_id: mappedId(event.event_id, eventIds),
    node_id: mappedId(event.node_id, nodeIds),
    branch_id: mappedId(event.branch_id, branchIds),
    supersedes: event.supersedes.map(id => mappedId(id, eventIds)),
    retracts: event.retracts.map(id => mappedId(id, eventIds)),
    evidence: event.evidence.map(item => ({
      ...item,
      ref: item.kind === 'memory_event' ? mappedId(item.ref, eventIds) : item.ref
    }))
  });
}

export function remapContinuityDelta(events, mappings = {}) {
  if (!Array.isArray(events)) throw new TypeError('continuity_delta 必须是数组');
  return events.map(event => remapMemoryEvent(event, mappings));
}

export function remapContinuityLedger(inputLedger, mappings = {}) {
  const ledger = normalizeContinuityLedger(inputLedger);
  const remapped = {
    ...ledger,
    events: ledger.events.map(event => remapMemoryEvent(event, mappings))
  };
  const inspection = inspectContinuityLedger(remapped);
  if (!inspection.valid) throw new Error(`连续性账本重映射失败: ${inspection.errors.join('; ')}`);
  return remapped;
}

export function createContinuityCasToken({ nodeId, branchId, ledger, revision } = {}) {
  const normalized = ledger == null ? null : normalizeContinuityLedger(ledger);
  const token = {
    node_id: cleanText(nodeId, '', 160),
    branch_id: cleanText(branchId, '', 160),
    revision: Number.isInteger(revision) ? revision : normalized?.revision
  };
  if (!token.node_id || !token.branch_id || !Number.isInteger(token.revision) || token.revision < 0) {
    throw new TypeError('连续性 CAS token 需要 nodeId、branchId 和非负 revision');
  }
  return Object.freeze(token);
}

export function isContinuityCasCurrent(token, { nodeId, branchId, ledger, revision } = {}) {
  if (!token) return false;
  const currentRevision = Number.isInteger(revision) ? revision : normalizeContinuityLedger(ledger).revision;
  return token.node_id === nodeId && token.branch_id === branchId && token.revision === currentRevision;
}

export async function commitContinuityProjectionCas({ token, readCurrent, commit } = {}) {
  if (typeof readCurrent !== 'function' || typeof commit !== 'function') {
    throw new TypeError('连续性 CAS helper 需要 readCurrent 与 commit 函数');
  }
  const current = await readCurrent();
  if (!isContinuityCasCurrent(token, current || {})) {
    return {
      status: 'stale',
      expected: token,
      current: current ? {
        node_id: current.nodeId || null,
        branch_id: current.branchId || null,
        revision: Number.isInteger(current.revision)
          ? current.revision
          : normalizeContinuityLedger(current.ledger).revision
      } : null
    };
  }
  return { status: 'applied', value: await commit(token, current) };
}

export const queryContinuity = queryContinuityEvents;
export const compileAnchors = compileContinuityAnchors;
