import { resolveContinuityEvents } from './continuity-ledger.js';

const TRACKED_FLAT_PREFIXES = Object.freeze([
  '玩家·', '属性·', '进度·', '技能·', '物品·', '世界·'
]);

const RELATIONSHIP_FIELDS = Object.freeze([
  'role', 'affection', 'trust', 'respect', 'last_interaction',
  'promises', 'debts', 'known_secrets', 'grand_summary'
]);

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function compact(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
  if (typeof value === 'string') return value.slice(0, 800);
  if (depth >= 3) return '[复杂数据已省略]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => compact(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, item]) => [
      String(key).slice(0, 120), compact(item, depth + 1)
    ]));
  }
  return String(value).slice(0, 800);
}

function activeByFact(ledger) {
  const map = new Map();
  for (const event of resolveContinuityEvents(ledger || undefined)) {
    if (event.status !== 'active') continue;
    map.set(`${event.subject_id}\u0000${event.predicate}`, event.event_id);
  }
  return map;
}

function makeEvent({ type, subject, predicate, before, after, importance = 2, evidenceRefs = [] }, priorFacts) {
  const previousId = priorFacts.get(`${subject}\u0000${predicate}`);
  return {
    type,
    subject_id: subject,
    predicate,
    value: {
      operation: after === undefined ? 'remove' : (before === undefined ? 'add' : 'replace'),
      before: compact(before),
      after: after === undefined ? null : compact(after)
    },
    truth: 'confirmed',
    visibility: 'narrator',
    known_by: ['narrator', 'writer', 'updater', 'reviewer'],
    importance,
    evidence: [
      { kind: 'accepted_turn', ref: 'display_text' },
      ...evidenceRefs.slice(0, 12).map(ref => ({ kind: 'evidence_ref', ref }))
    ],
    ...(previousId ? { supersedes: [previousId] } : {})
  };
}

function flatType(key) {
  if (key.startsWith('物品·')) return { type: 'inventory', subject: 'player', importance: 4 };
  if (key.startsWith('技能·')) return { type: 'technique', subject: 'player', importance: 4 };
  if (key.startsWith('世界·')) return { type: 'state_change', subject: 'world', importance: 3 };
  if (key.startsWith('进度·')) return { type: 'progression', subject: 'player', importance: 3 };
  if (key.startsWith('玩家·')) return { type: 'identity', subject: 'player', importance: 3 };
  return { type: 'state_change', subject: 'player', importance: 2 };
}

function missionRecords(state) {
  const result = new Map();
  for (const status of ['active', 'completed', 'failed']) {
    for (const [id, mission] of Object.entries(state?._missions?.[status] || {})) {
      const key = String(id || mission?.id || mission?.title || 'unknown');
      result.set(key, {
        status,
        id: mission?.id || id,
        title: mission?.title || mission?.name || id,
        rank: mission?.rank || '',
        progress: mission?.progress ?? null,
        result: mission?.result || mission?.rating || ''
      });
    }
  }
  return result;
}

function summaryEvent({ displayText, memorySummary, turn, evidenceRefs }) {
  const summary = String(memorySummary || displayText || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!summary) return null;
  return {
    type: 'summary',
    subject_id: `turn:${Math.max(0, Number(turn) || 0)}`,
    predicate: '已确认回合摘要',
    value: summary,
    truth: 'confirmed',
    visibility: 'narrator',
    known_by: ['narrator', 'writer', 'updater', 'reviewer'],
    importance: memorySummary ? 3 : 2,
    evidence: [
      { kind: 'accepted_turn', ref: 'display_text' },
      ...evidenceRefs.slice(0, 12).map(ref => ({ kind: 'evidence_ref', ref }))
    ]
  };
}

/**
 * Derive continuity only from accepted display text and mutations that
 * survived state validation. Rejected model instructions never enter it.
 */
export function buildContinuityDelta({
  beforeState = {}, afterState = {}, displayText = '', memorySummary = '', turn = 0, evidenceRefs = []
} = {}) {
  const priorFacts = activeByFact(beforeState?._continuity);
  const refs = [...new Set((Array.isArray(evidenceRefs) ? evidenceRefs : []).map(String).filter(Boolean))];
  const events = [];
  const keys = new Set([...Object.keys(beforeState || {}), ...Object.keys(afterState || {})]);
  for (const key of [...keys].sort()) {
    if (!TRACKED_FLAT_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
    const before = beforeState[key];
    const after = afterState[key];
    if (equal(before, after)) continue;
    const meta = flatType(key);
    events.push(makeEvent({ ...meta, predicate: key, before, after, evidenceRefs: refs }, priorFacts));
  }

  const beforeRelationships = beforeState?._relationships || {};
  const afterRelationships = afterState?._relationships || {};
  const relationshipNames = new Set([...Object.keys(beforeRelationships), ...Object.keys(afterRelationships)]);
  for (const name of [...relationshipNames].sort()) {
    for (const field of RELATIONSHIP_FIELDS) {
      const before = beforeRelationships[name]?.[field];
      const after = afterRelationships[name]?.[field];
      if (equal(before, after)) continue;
      events.push(makeEvent({
        type: 'relationship', subject: `npc:${name}`, predicate: `关系.${field}`,
        before, after, importance: ['promises', 'debts', 'known_secrets'].includes(field) ? 4 : 3,
        evidenceRefs: refs
      }, priorFacts));
    }
  }

  const beforeMissions = missionRecords(beforeState);
  const afterMissions = missionRecords(afterState);
  const missionIds = new Set([...beforeMissions.keys(), ...afterMissions.keys()]);
  for (const id of [...missionIds].sort()) {
    const before = beforeMissions.get(id);
    const after = afterMissions.get(id);
    if (equal(before, after)) continue;
    events.push(makeEvent({
      type: 'mission', subject: `mission:${id}`, predicate: '任务状态',
      before, after, importance: 4, evidenceRefs: refs
    }, priorFacts));
  }

  const beforeCombat = beforeState?._combat;
  const afterCombat = afterState?._combat;
  if (!equal(Boolean(beforeCombat?.is_active), Boolean(afterCombat?.is_active))) {
    events.push(makeEvent({
      type: 'combat', subject: `combat:${afterCombat?.enemy_name || beforeCombat?.enemy_name || 'unknown'}`,
      predicate: '战斗状态',
      before: beforeCombat ? { is_active: beforeCombat.is_active, enemy_name: beforeCombat.enemy_name } : null,
      after: afterCombat ? { is_active: afterCombat.is_active, enemy_name: afterCombat.enemy_name, result: afterCombat.result } : null,
      importance: 3, evidenceRefs: refs
    }, priorFacts));
  }

  const summary = summaryEvent({ displayText, memorySummary, turn, evidenceRefs: refs });
  if (summary) events.push(summary);
  return clone(events.slice(0, 96));
}

export default buildContinuityDelta;
