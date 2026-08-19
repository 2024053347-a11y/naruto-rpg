import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { normalizeRelationshipInstruction, finiteRelationshipNumber } from '../data/var-schema.js';
import { normalizeNpcIdentity } from '../data/npc-identity.js';
import { normalizeNpcCombatStats } from './npc-balance.js';
import {
  calculateCombatLevel,
  combatAttributesFromNpcCard,
  combatMasteriesFromNpcCard
} from './combat-level.js';

const HISTORY_MAX = 30;
const THOUGHTS_MAX = 5;

const COMBAT_KEYS = [
  '查克拉', '查克拉上限', '生命力', '生命力上限', '体力', '体力上限', '速度', '精神力', '精神力上限', '幸运',
  '忍术造诣', '体术造诣', '幻术造诣', '忍阶', '查克拉属性', '忍术',
  'chakra', 'chakra_max', 'vitality', 'vitality_max', 'stamina', 'stamina_max', 'speed', 'spirit', 'spirit_max', 'luck',
  'ninjutsu', 'taijutsu', 'genjutsu', 'rank', 'enemy_rank', 'chakra_nature', 'jutsu'
];

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function combatPayloadFrom(data) {
  const nested = record(data.combat_stats);
  const attributes = {
    ...record(data.attributes),
    ...record(data['属性']),
    ...record(nested.attributes),
    ...record(nested['属性'])
  };
  const masteries = {
    ...record(data.masteries),
    ...record(data['造诣']),
    ...record(nested.masteries),
    ...record(nested['造诣'])
  };
  const structuredAttributes = {};
  const copy = (key, value) => { if (value !== undefined) structuredAttributes[key] = value; };
  copy('chakra_max', attributes.chakra_max ?? attributes.chakra);
  copy('chakra', attributes.chakra_current);
  copy('vitality_max', attributes.vitality_max ?? attributes.vitality);
  copy('vitality', attributes.vitality_current);
  copy('stamina_max', attributes.stamina_max ?? attributes.stamina);
  copy('stamina', attributes.stamina_current);
  copy('spirit_max', attributes.spirit_max ?? attributes.spirit);
  copy('spirit', attributes.spirit_current);
  copy('speed', attributes.speed);
  copy('luck', attributes.luck);
  return { ...data, ...nested, ...attributes, ...structuredAttributes, ...masteries };
}

function hasCombatPayload(data) {
  const nested = record(data.combat_stats);
  return Object.keys(nested).length > 0
    || COMBAT_KEYS.some(key => data[key] !== undefined)
    || Object.keys(record(data.attributes)).length > 0
    || Object.keys(record(data.masteries)).length > 0;
}

function combatantFlag(data) {
  const value = data.combatant ?? data.is_combatant ?? data['战斗型'] ?? data['战斗人员'];
  return typeof value === 'boolean' ? value : null;
}

function createSubjectId() {
  if (globalThis.crypto?.randomUUID) return `subject-${globalThis.crypto.randomUUID()}`;
  return `subject-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function seedFrom(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function finiteNumberOr(value, fallback = 0) {
  return finiteRelationshipNumber(value) ?? fallback;
}

function requireNpcIdentity(value) {
  const npc = normalizeNpcIdentity(value);
  if (!npc) throw new TypeError('人物名称无效或不安全');
  return npc;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter(value => {
    let key;
    try { key = JSON.stringify(value); } catch { key = String(value); }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeScopedValue(existing, incoming) {
  if (existing === undefined) return incoming;
  if (incoming === undefined) return existing;
  if (typeof existing === 'string' && typeof incoming === 'string') {
    if (!existing) return incoming;
    if (!incoming || existing === incoming) return existing;
    return `${existing}\n${incoming}`;
  }
  if (Array.isArray(existing) || Array.isArray(incoming)) {
    const left = Array.isArray(existing) ? existing : [existing];
    const right = Array.isArray(incoming) ? incoming : [incoming];
    return uniqueValues([...left, ...right]);
  }
  if (record(existing) === existing && record(incoming) === incoming) {
    return { ...existing, ...incoming };
  }
  return incoming;
}

function moveScopedKeys(value, renameMap, merge = mergeScopedValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = { ...value };
  for (const [oldNpc, newNpc] of renameMap) {
    if (!hasOwn(next, oldNpc)) continue;
    const source = next[oldNpc];
    const target = next[newNpc];
    delete next[oldNpc];
    next[newNpc] = merge(target, source, newNpc);
  }
  return next;
}

function renameNpcNotePrefixes(value, renameMap) {
  if (typeof value !== 'string' || !value || !renameMap.size) return value;
  return value.split(/(\r?\n)/).map(part => {
    if (/^\r?\n$/.test(part)) return part;
    const separator = part.match(/^([^:\uff1a]+?)(\s*[:\uff1a]\s*)/u);
    if (!separator) return part;
    const replacement = renameMap.get(separator[1]);
    return replacement ? replacement + part.slice(separator[1].length) : part;
  }).join('');
}

function migrateMemoryNpcNames(value, renameMap) {
  const memory = record(value) === value ? { ...value } : {};
  if (typeof memory.npc_notes === 'string') {
    memory.npc_notes = renameNpcNotePrefixes(memory.npc_notes, renameMap);
  } else if (memory.npc_notes && typeof memory.npc_notes === 'object' && !Array.isArray(memory.npc_notes)) {
    memory.npc_notes = moveScopedKeys(memory.npc_notes, renameMap);
  }

  const history = memory.relationship_history;
  if (typeof history === 'string' && history.trim()) {
    try {
      const parsed = JSON.parse(history);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        memory.relationship_history = JSON.stringify(moveScopedKeys(parsed, renameMap));
      }
    } catch {
      console.warn('[RelationshipSystem] relationship_history is not valid JSON; kept unchanged during NPC rename');
    }
  } else if (history && typeof history === 'object' && !Array.isArray(history)) {
    memory.relationship_history = moveScopedKeys(history, renameMap);
  }
  return memory;
}

function mergeAgentMemory(existing, incoming, newNpc) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  const target = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const next = { ...target, ...incoming, npcName: newNpc };
  for (const field of ['privateGoals', 'knownFacts', 'recentActions', 'privateIntentHistory']) {
    const left = Array.isArray(target[field]) ? target[field] : [];
    const right = Array.isArray(incoming[field]) ? incoming[field] : [];
    if (left.length || right.length) next[field] = uniqueValues([...left, ...right]);
  }
  if (target.relationToPlayer || incoming.relationToPlayer) {
    next.relationToPlayer = {
      ...record(target.relationToPlayer),
      ...record(incoming.relationToPlayer)
    };
  }
  return next;
}

function migrateCombatNpcNames(value, renameMap) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const combat = { ...value };
  for (const field of ['enemy_name', 'enemyName']) {
    if (renameMap.has(combat[field])) combat[field] = renameMap.get(combat[field]);
  }
  if (Array.isArray(combat.enemies)) {
    combat.enemies = combat.enemies.map(enemy => {
      if (typeof enemy === 'string') return renameMap.get(enemy) || enemy;
      if (!enemy || typeof enemy !== 'object' || Array.isArray(enemy)) return enemy;
      const next = { ...enemy };
      for (const field of ['name', 'npcName', 'enemy_name', 'enemyName']) {
        if (renameMap.has(next[field])) next[field] = renameMap.get(next[field]);
      }
      return next;
    });
  }
  return combat;
}

class RelationshipSystem {
  refreshCombatLevels() {
    const relationships = stateManager.getSub('_relationships') || {};
    let changed = 0;
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
      changed++;
    }
    if (changed) stateManager.setSub('_relationships', relationships);
    return changed;
  }

  processInstruction(data) {
    return this.processInstructions([data])[0];
  }

  processInstructions(items) {
    const normalized = [];
    for (const item of Array.isArray(items) ? items : [items]) {
      const data = normalizeRelationshipInstruction(item);
      if (!data) {
        console.warn('[RelationshipSystem] Invalid relationship instruction:', typeof item);
        continue;
      }
      normalized.push(data);
    }
    if (!normalized.length) return [];

    const all = stateManager.getSub('_relationships') || {};
    const renameMap = new Map();
    const renameEndpoints = new Map();
    const preflightErrors = [];
    for (const data of normalized) {
      if (data.op !== undefined && !['rename', 'delete'].includes(data.op)) {
        preflightErrors.push(`人物 ${data.npc} 的关系操作 ${data.op} 不受支持`);
      }
      if (hasOwn(data, 'new_npc') && data.op !== 'rename') {
        preflightErrors.push(`人物 ${data.npc} 只有在 rename 时才能提供 new_npc`);
      }
      if (data.op !== 'rename') continue;

      const oldNpc = data.npc;
      const newNpc = normalizeNpcIdentity(data.new_npc);
      if (!newNpc) {
        preflightErrors.push(`人物 ${oldNpc} 的 rename 缺少有效 new_npc`);
        continue;
      }
      if (newNpc === oldNpc) preflightErrors.push(`人物 ${oldNpc} 的新旧姓名不能相同`);
      if (!hasOwn(all, oldNpc)) preflightErrors.push(`改名源人物不存在: ${oldNpc}`);
      if (newNpc !== oldNpc && hasOwn(all, newNpc)) preflightErrors.push(`改名目标已存在: ${newNpc}`);
      for (const [existingName, relationship] of Object.entries(all)) {
        if (existingName === oldNpc) continue;
        if ((Array.isArray(relationship?.aliases) ? relationship.aliases : [])
          .some(alias => normalizeNpcIdentity(alias) === newNpc)) {
          preflightErrors.push(`改名目标 ${newNpc} 已被 ${existingName} 用作别名`);
          break;
        }
      }
      for (const endpoint of [oldNpc, newNpc]) {
        if (renameEndpoints.has(endpoint)) {
          preflightErrors.push(`改名端点冲突: ${endpoint}`);
        } else {
          renameEndpoints.set(endpoint, `${oldNpc}->${newNpc}`);
        }
      }
      renameMap.set(oldNpc, newNpc);
    }
    for (const data of normalized) {
      if (data.op !== 'rename' && renameEndpoints.has(data.npc)) {
        preflightErrors.push(`人物 ${data.npc} 参与改名时不得另行输出关系指令`);
      }
    }
    if (preflightErrors.length) {
      console.warn('[RelationshipSystem] Relationship batch rejected:', [...new Set(preflightErrors)].join('; '));
      return [];
    }

    const turn = stateManager.get('系统·回合数') || 0;
    const calStr = stateManager.get('世界·时间');
    const now = typeof calStr === 'string' ? calStr : this._formatCalendar(calStr);
    const results = [];
    const eventActions = [];

    for (const originalData of normalized) {
      if (originalData.op === 'delete') {
        const subjectId = all[originalData.npc]?.visual_subject_id || null;
        delete all[originalData.npc];
        results.push(undefined);
        eventActions.push({ type: 'delete', npc: originalData.npc, subjectId });
        continue;
      }

      let data = originalData;
      let npc = data.npc;
      let isNewNpc = !hasOwn(all, npc);
      let renamedFrom = null;
      if (data.op === 'rename') {
        renamedFrom = npc;
        npc = data.new_npc;
        const source = this._normalizeRelationship(all[renamedFrom]);
        delete all[renamedFrom];

        const aliases = Array.isArray(source.aliases) ? source.aliases : [];
        source.aliases = [...new Set([
          ...aliases.map(normalizeNpcIdentity).filter(Boolean).filter(alias => alias !== npc),
          renamedFrom
        ])];
        // These are structured identity mirrors used by older saves/importers,
        // not historical prose. Keep them aligned with the canonical map key.
        for (const field of ['name', 'npc', '姓名', 'display_name']) {
          if (hasOwn(source, field)) source[field] = npc;
        }
        if (source.visual_profile && typeof source.visual_profile === 'object' && !Array.isArray(source.visual_profile)) {
          source.visual_profile = { ...source.visual_profile, display_name: npc };
        }
        all[npc] = source;
        data = { ...data, npc };
        delete data.op;
        delete data.new_npc;
        isNewNpc = false;
      }

      const current = this._applyRelationshipData(data, all, { npc, isNewNpc, turn, now });
      results.push(current);
      if (renamedFrom) {
        eventActions.push({ type: 'rename', oldNpc: renamedFrom, newNpc: npc });
      } else {
        eventActions.push({ type: 'change', npc });
      }
    }

    const changes = { _relationships: all };
    if (renameMap.size) {
      changes._memory = migrateMemoryNpcNames(stateManager.getSub('_memory'), renameMap);
      changes._agent_memories = moveScopedKeys(
        stateManager.getSub('_agent_memories') || {},
        renameMap,
        mergeAgentMemory
      );
      changes._combat = migrateCombatNpcNames(stateManager.getSub('_combat'), renameMap);
    }
    stateManager.setSubBatch(changes);

    for (const action of eventActions) {
      if (action.type === 'rename') {
        const relationship = all[action.newNpc];
        eventBus.emit('relationship:renamed', {
          oldNpc: action.oldNpc,
          newNpc: action.newNpc,
          npc: action.newNpc,
          relationship
        });
        eventBus.emit('relationship:changed', {
          npc: action.newNpc,
          relationship,
          renamedFrom: action.oldNpc
        });
      } else if (action.type === 'delete') {
        if (action.subjectId) {
          eventBus.emit('relationship:visual-deleted', { npc: action.npc, subjectId: action.subjectId });
        }
        eventBus.emit('relationship:changed', { npc: action.npc, relationship: null, deleted: true });
      } else {
        eventBus.emit('relationship:changed', { npc: action.npc, relationship: all[action.npc] });
      }
    }
    return results;
  }

  _applyRelationshipData(data, all, { npc = data.npc, isNewNpc = !hasOwn(all, npc), turn, now } = {}) {
    const current = this._normalizeRelationship(all[npc]);

    // A delta is authoritative when both forms are present. An absolute score
    // only initializes a brand-new NPC: models frequently echo the relationship
    // card with stale absolute numbers, which must never stomp accumulated scores.
    for (const field of ['affection', 'trust', 'respect']) {
      const changeField = `${field}_change`;
      if (Object.prototype.hasOwnProperty.call(data, changeField)) {
        current[field] += data[changeField];
      } else if (isNewNpc && Object.prototype.hasOwnProperty.call(data, field)) {
        current[field] = data[field];
      }
    }
    if (data.reason) {
      current.last_interaction = data.reason;
      current.last_interaction_at = Date.now();
    }
    if (data.info) current.info = data.info;
    if (data.role) current.role = data.role;
    if (data.faction) current.faction = data.faction;
    if (data.status) current.status = data.status;
    if (data.location) current.location = data.location;

    let recordedInteraction = false;
    let legacyThought = '';
    if (typeof data.history === 'string' && data.history.trim()) {
      const rawHistory = data.history.trim();
      legacyThought = rawHistory.match(/\[心声\]\s*([\s\S]+)$/)?.[1]?.trim() || '';
      const summary = rawHistory
        .replace(/^\[历史\]\s*/, '')
        .replace(/\s*\[心声\][\s\S]*$/, '')
        .trim();
      if (summary && (!current.history.length || current.history[0].summary !== summary || current.history[0].turn !== turn)) {
        current.history = [{ turn, time: now, summary }, ...current.history].slice(0, HISTORY_MAX);
      }
      recordedInteraction = Boolean(summary);
    }
    const thoughtSource = typeof data.inner_thoughts === 'string' && data.inner_thoughts.trim()
      ? data.inner_thoughts
      : legacyThought;
    if (thoughtSource) {
      const summary = thoughtSource.trim().replace(/^\[心声\]\s*/, '');
      if (!current.inner_thoughts.length || current.inner_thoughts[0].summary !== summary || current.inner_thoughts[0].turn !== turn) {
        current.inner_thoughts = [{ turn, time: now, summary }, ...current.inner_thoughts].slice(0, THOUGHTS_MAX);
      }
      recordedInteraction = true;
    }

    if (recordedInteraction) {
      // 置顶角色互动计数
      if (current.pinned) {
        current.summary_turn_counter = (current.summary_turn_counter || 0) + 1;
      }
    }

    if (Array.isArray(data.tags)) current.tags = [...new Set([...(current.tags || []), ...data.tags])].slice(-12);
    if (Array.isArray(data.known_secrets)) current.known_secrets = [...new Set([...(current.known_secrets || []), ...data.known_secrets])].slice(-12);
    if (Array.isArray(data.promises)) current.promises = [...(current.promises || []), ...data.promises].slice(-12);
    if (Array.isArray(data.debts)) current.debts = [...(current.debts || []), ...data.debts].slice(-12);

    const hasCombat = hasCombatPayload(data);
    const explicitCombatant = combatantFlag(data);
    if (hasCombat) {
      current.combatant = true;
      current.combat_stats = normalizeNpcCombatStats(combatPayloadFrom(data), current.combat_stats, {
        fallbackRank: stateManager.get('玩家·忍阶') || '下忍',
        difficulty: stateManager.get('玩家·难度')
      });
    } else if (explicitCombatant !== null && !current.combat_stats) {
      current.combatant = explicitCombatant;
    }

    current.affection = Math.max(-100, Math.min(100, current.affection || 0));
    current.trust = Math.max(-100, Math.min(100, current.trust || 0));
    current.respect = Math.max(-100, Math.min(100, current.respect || 0));

    all[npc] = current;
    return current;
  }

  _formatCalendar(cal) {
    if (!cal || typeof cal !== 'object') return '';
    const year = cal.year || '木叶48年';
    const month = cal.month || 1;
    const day = cal.day || 1;
    const tod = cal.time_of_day || '清晨';
    return `${year}${month}月${day}日·${tod}`;
  }

  getRelationship(npc) {
    npc = normalizeNpcIdentity(npc);
    const all = stateManager.getSub('_relationships') || {};
    return this._normalizeRelationship(npc && Object.prototype.hasOwnProperty.call(all, npc) ? all[npc] : null);
  }

  ensureVisualProfile(npc) {
    npc = requireNpcIdentity(npc);
    const all = stateManager.getSub('_relationships') || {};
    if (!Object.prototype.hasOwnProperty.call(all, npc)) throw new Error(`关系人物不存在: ${npc}`);
    const current = this._normalizeRelationship(all[npc]);
    const subjectId = current.visual_subject_id || createSubjectId();
    const profile = {
      subject_id: subjectId,
      display_name: npc,
      canonical_description: current.visual_profile?.canonical_description
        || [current.info, current.role, current.faction, ...(current.tags || [])].filter(Boolean).join('；'),
      locked_traits: Array.isArray(current.visual_profile?.locked_traits)
        ? current.visual_profile.locked_traits : [],
      current_appearance: current.visual_profile?.current_appearance || '',
      identity_seed: Number.isInteger(current.visual_profile?.identity_seed)
        ? current.visual_profile.identity_seed : seedFrom(subjectId),
      seed_by_renderer: current.visual_profile?.seed_by_renderer && typeof current.visual_profile.seed_by_renderer === 'object'
        ? current.visual_profile.seed_by_renderer : {},
      revision: Number(current.visual_profile?.revision) || 0
    };
    const portraitBinding = {
      selected_asset_id: current.portrait_binding?.selected_asset_id || null,
      version_group_id: current.portrait_binding?.version_group_id || `portrait:${subjectId}`,
      binding_revision: Number(current.portrait_binding?.binding_revision) || 0,
      updated_at: Number(current.portrait_binding?.updated_at) || Date.now()
    };
    const changed = !current.visual_subject_id || !current.visual_profile || !current.portrait_binding;
    const next = {
      ...current,
      visual_subject_id: subjectId,
      visual_profile: profile,
      portrait_binding: portraitBinding
    };
    if (changed) {
      all[npc] = next;
      stateManager.setSub('_relationships', all);
      eventBus.emit('relationship:visual-changed', { npc, relationship: next, subjectId });
    }
    return next;
  }

  getRelationshipBySubjectId(subjectId) {
    for (const [npc, value] of Object.entries(stateManager.getSub('_relationships') || {})) {
      const relationship = this._normalizeRelationship(value);
      if (relationship.visual_subject_id === subjectId) return { npc, relationship };
    }
    return null;
  }

  updateVisualProfile(npc, patch = {}, { expectedRevision = null } = {}) {
    const current = this.ensureVisualProfile(npc);
    const all = stateManager.getSub('_relationships') || {};
    const revision = Number(current.visual_profile.revision) || 0;
    if (expectedRevision !== null && Number(expectedRevision) !== revision) {
      return { status: 'stale', revision, profile: current.visual_profile };
    }
    const profile = {
      ...current.visual_profile,
      ...patch,
      subject_id: current.visual_subject_id,
      display_name: npc,
      locked_traits: Array.isArray(patch.locked_traits)
        ? [...new Set(patch.locked_traits.map(String).map(value => value.trim()).filter(Boolean))]
        : current.visual_profile.locked_traits,
      revision: revision + 1
    };
    const next = { ...current, visual_profile: profile };
    all[npc] = next;
    stateManager.setSub('_relationships', all);
    eventBus.emit('relationship:visual-changed', { npc, relationship: next, subjectId: current.visual_subject_id });
    return { status: 'updated', profile };
  }

  bindPortrait(subjectId, {
    assetId = null,
    expectedRevision = null,
    authoritativeRevision = null,
    versionGroupId = null,
    jobId = null
  } = {}) {
    const found = this.getRelationshipBySubjectId(subjectId);
    if (!found) return { status: 'missing', subjectId };
    const current = this.ensureVisualProfile(found.npc);
    const all = stateManager.getSub('_relationships') || {};
    const revision = Number(current.portrait_binding.binding_revision) || 0;
    const hasAuthoritativeRevision = authoritativeRevision !== null
      && Number.isSafeInteger(Number(authoritativeRevision))
      && Number(authoritativeRevision) >= 0;
    const remoteRevision = hasAuthoritativeRevision ? Number(authoritativeRevision) : null;
    if (hasAuthoritativeRevision && remoteRevision < revision) {
      return { status: 'stale', revision, selectedAssetId: current.portrait_binding.selected_asset_id || null };
    }
    if (!hasAuthoritativeRevision && expectedRevision !== null && Number(expectedRevision) !== revision) {
      return { status: 'stale', revision, selectedAssetId: current.portrait_binding.selected_asset_id || null };
    }
    if (hasAuthoritativeRevision
      && remoteRevision === revision
      && (current.portrait_binding.selected_asset_id || null) === (assetId || null)) {
      return { status: 'unchanged', ...current.portrait_binding };
    }
    const portraitBinding = {
      ...current.portrait_binding,
      selected_asset_id: assetId || null,
      version_group_id: versionGroupId || current.portrait_binding.version_group_id || `portrait:${subjectId}`,
      binding_revision: hasAuthoritativeRevision ? remoteRevision : revision + 1,
      last_job_id: jobId || current.portrait_binding.last_job_id || null,
      updated_at: Date.now()
    };
    const next = { ...current, portrait_binding: portraitBinding };
    all[found.npc] = next;
    stateManager.setSub('_relationships', all);
    eventBus.emit('relationship:visual-changed', { npc: found.npc, relationship: next, subjectId });
    return { status: 'updated', ...portraitBinding };
  }

  getAllRelationships() {
    return stateManager.getSub('_relationships') || {};
  }

  getSortedRelationships() {
    const all = this.getAllRelationships();
    return Object.entries(all)
      .map(([name, data]) => ({ name, ...this._normalizeRelationship(data) }))
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.affection || 0) - (a.affection || 0);
      });
  }

  togglePin(npc) {
    npc = requireNpcIdentity(npc);
    const all = stateManager.getSub('_relationships') || {};
    const current = this._normalizeRelationship(all[npc]);
    current.pinned = !current.pinned;
    all[npc] = current;
    stateManager.setSub('_relationships', all);
    eventBus.emit('relationship:changed', { npc, relationship: current });
    return current;
  }

  deleteRelationship(npc) {
    npc = normalizeNpcIdentity(npc);
    if (!npc) return false;
    const all = stateManager.getSub('_relationships') || {};
    const subjectId = all[npc]?.visual_subject_id || null;
    delete all[npc];
    stateManager.setSub('_relationships', all);
    if (subjectId) eventBus.emit('relationship:visual-deleted', { npc, subjectId });
    eventBus.emit('relationship:changed', { npc, relationship: null, deleted: true });
    return true;
  }

  getAffectionLevel(value) {
    if (value >= 80) return '挚友';
    if (value >= 60) return '好友';
    if (value >= 30) return '友好';
    if (value >= 0) return '中立';
    if (value >= -30) return '冷淡';
    if (value >= -60) return '敌意';
    return '仇恨';
  }

  getTrustLevel(value) {
    if (value >= 80) return '完全信任';
    if (value >= 50) return '信任';
    if (value >= 20) return '基本信任';
    if (value >= -20) return '观望';
    if (value >= -50) return '怀疑';
    return '不信任';
  }

  addRelationship(npc, initialData = {}) {
    npc = requireNpcIdentity(npc);
    const all = stateManager.getSub('_relationships') || {};
    const data = {
      ...this._normalizeRelationship(initialData),
      first_met: Date.now()
    };
    all[npc] = data;
    stateManager.setSub('_relationships', all);
    return data;
  }

  _normalizeRelationship(value) {
    if (typeof value === 'number') {
      return { affection: finiteNumberOr(value), trust: 0, respect: 0, info: '', history: [], inner_thoughts: [] };
    }
    if (!value || typeof value !== 'object') {
      return { affection: 0, trust: 0, respect: 0, info: '', history: [], inner_thoughts: [] };
    }
    const upgradeField = (v, limit) => {
      const values = typeof v === 'string' && v.trim()
        ? [{ turn: 0, time: '', summary: v.trim() }]
        : Array.isArray(v) ? v : [];
      return values.map(entry => {
        if (typeof entry === 'string') return { turn: 0, time: '', summary: entry.trim() };
        if (!entry || typeof entry !== 'object') return null;
        const summary = String(entry.summary ?? entry.content ?? '').trim();
        return summary ? { ...entry, summary } : null;
      }).filter(Boolean).slice(0, limit);
    };
    const history = upgradeField(value.history, HISTORY_MAX);
    const innerThoughts = upgradeField(value.inner_thoughts, THOUGHTS_MAX);
    // Older saves embedded private thoughts in history. Keep those entries for
    // display compatibility while also hydrating the dedicated thought queue.
    for (const entry of history) {
      const match = entry.summary.match(/\[心声\]\s*([^\[]+)/);
      const summary = match?.[1]?.trim();
      if (!summary || innerThoughts.some(item => item.summary === summary && item.turn === entry.turn)) continue;
      innerThoughts.push({ turn: entry.turn ?? 0, time: entry.time || '', summary });
    }
    const normalized = {
      ...value,
      affection: finiteNumberOr(value.affection),
      trust: finiteNumberOr(value.trust),
      respect: finiteNumberOr(value.respect),
      info: value.info || '',
      pinned: value.pinned ?? false,
      history: history.slice(0, HISTORY_MAX),
      inner_thoughts: innerThoughts.slice(0, THOUGHTS_MAX),
      role: value.role || '',
      faction: value.faction || '',
      status: value.status || 'neutral',
      tags: Array.isArray(value.tags) ? value.tags : [],
      known_secrets: Array.isArray(value.known_secrets) ? value.known_secrets : [],
      promises: Array.isArray(value.promises) ? value.promises : [],
      debts: Array.isArray(value.debts) ? value.debts : [],
      summary_turn_counter: finiteNumberOr(value.summary_turn_counter),
      summaries: Array.isArray(value.summaries) ? value.summaries : [],
      grand_summary: value.grand_summary || ''
    };
    if (value.combat_stats && typeof value.combat_stats === 'object') {
      normalized.combat_stats = normalizeNpcCombatStats({}, value.combat_stats, {
        fallbackRank: stateManager.get('玩家·忍阶') || '下忍',
        difficulty: stateManager.get('玩家·难度')
      });
    }
    return normalized;
  }
}

export const relationshipSystem = new RelationshipSystem();
eventBus.on('state:restored', () => relationshipSystem.refreshCombatLevels());
export default relationshipSystem;
