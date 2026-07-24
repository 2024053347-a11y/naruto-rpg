import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
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

class RelationshipSystem {
  refreshCombatLevels() {
    const relationships = stateManager.getSub('_relationships') || {};
    let changed = 0;
    for (const [name, relationship] of Object.entries(relationships)) {
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
    if (!data || typeof data !== 'object') {
      console.warn('[RelationshipSystem] Invalid relationship instruction:', typeof data);
      return;
    }
    if (data.op === 'delete') {
      this.deleteRelationship(data.npc);
      return;
    }
    if (!data.npc) {
      console.warn('[RelationshipSystem] Relationship instruction missing npc:', data);
      return;
    }

    const all = stateManager.getSub('_relationships') || {};
    const current = this._normalizeRelationship(all[data.npc]);
    const turn = stateManager.get('系统·回合数') || 0;
    const calStr = stateManager.get('世界·时间');
    const now = typeof calStr === 'string' ? calStr : this._formatCalendar(calStr);

    const affectionChange = data.affection_change ?? data.affection_delta ?? 0;
    const trustChange = data.trust_change ?? data.trust_delta ?? 0;
    const respectChange = data.respect_change ?? data.respect_delta ?? 0;
    if (affectionChange) current.affection = (current.affection || 0) + affectionChange;
    if (trustChange) current.trust = (current.trust || 0) + trustChange;
    if (respectChange) current.respect = (current.respect || 0) + respectChange;
    if (data.reason) {
      current.last_interaction = data.reason;
      current.last_interaction_at = Date.now();
    }
    if (data.info) current.info = data.info;
    if (data.role) current.role = data.role;
    if (data.faction) current.faction = data.faction;
    if (data.status) current.status = data.status;
    if (data.location) current.location = data.location;

    let combinedEntry = [];
    if (typeof data.history === 'string' && data.history.trim()) {
      combinedEntry.push(`[历史] ${data.history.trim()}`);
    }
    if (typeof data.inner_thoughts === 'string' && data.inner_thoughts.trim()) {
      combinedEntry.push(`[心声] ${data.inner_thoughts.trim()}`);
    }
    
    if (combinedEntry.length > 0) {
      const summaryStr = combinedEntry.join(' ');
      if (!current.history.length || current.history[0].summary !== summaryStr) {
        const entry = { turn, time: now, summary: summaryStr };
        current.history = [entry, ...current.history].slice(0, HISTORY_MAX);
      }
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

    all[data.npc] = current;
    stateManager.setSub('_relationships', all);
    eventBus.emit('relationship:changed', { npc: data.npc, relationship: current });
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
    const all = stateManager.getSub('_relationships') || {};
    return this._normalizeRelationship(all[npc]);
  }

  ensureVisualProfile(npc) {
    if (!npc) throw new TypeError('人物名称不能为空');
    const all = stateManager.getSub('_relationships') || {};
    if (!(npc in all)) throw new Error(`关系人物不存在: ${npc}`);
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
    const all = stateManager.getSub('_relationships') || {};
    const current = this._normalizeRelationship(all[npc]);
    current.pinned = !current.pinned;
    all[npc] = current;
    stateManager.setSub('_relationships', all);
    eventBus.emit('relationship:changed', { npc, relationship: current });
    return current;
  }

  deleteRelationship(npc) {
    const all = stateManager.getSub('_relationships') || {};
    const subjectId = all[npc]?.visual_subject_id || null;
    delete all[npc];
    stateManager.setSub('_relationships', all);
    if (subjectId) eventBus.emit('relationship:visual-deleted', { npc, subjectId });
    eventBus.emit('relationship:changed', { npc, relationship: null, deleted: true });
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
      return { affection: value, trust: 0, respect: 0, info: '', history: [], inner_thoughts: [] };
    }
    if (!value || typeof value !== 'object') {
      return { affection: 0, trust: 0, respect: 0, info: '', history: [], inner_thoughts: [] };
    }
    const upgradeField = (v) => {
      if (typeof v === 'string' && v.trim()) return [{ turn: 0, time: '', summary: v.trim() }];
      if (Array.isArray(v)) return v;
      return [];
    };
    const normalized = {
      ...value,
      affection: Number(value.affection) || 0,
      trust: Number(value.trust) || 0,
      respect: Number(value.respect) || 0,
      info: value.info || '',
      pinned: value.pinned ?? false,
      history: upgradeField(value.history),
      inner_thoughts: upgradeField(value.inner_thoughts),
      role: value.role || '',
      faction: value.faction || '',
      status: value.status || 'neutral',
      tags: Array.isArray(value.tags) ? value.tags : [],
      known_secrets: Array.isArray(value.known_secrets) ? value.known_secrets : [],
      promises: Array.isArray(value.promises) ? value.promises : [],
      debts: Array.isArray(value.debts) ? value.debts : [],
      summary_turn_counter: Number(value.summary_turn_counter) || 0,
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
