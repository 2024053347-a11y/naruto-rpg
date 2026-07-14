import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';

const HISTORY_MAX = 30;
const THOUGHTS_MAX = 5;

class RelationshipSystem {
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

    // ── NPC 战斗数值与忍术能力（中文键名） ──
    const combatKeys = ['查克拉', '查克拉上限', '体力', '体力上限', '速度', '精神力', '意志力',
                        '忍术造诣', '体术造诣', '幻术造诣',
                        'chakra', 'chakra_max', 'stamina', 'stamina_max', 'speed', 'spirit',
                        'willpower', 'ninjutsu', 'taijutsu', 'genjutsu'];
    const hasCombatStats = combatKeys.some(k => data[k] !== undefined);

    if (hasCombatStats) {
      current.combat_stats = current.combat_stats || {};
      if (data.查克拉 !== undefined || data.chakra !== undefined)
        current.combat_stats.查克拉 = Number(data.查克拉 ?? data.chakra) || 0;
      if (data.查克拉上限 !== undefined || data.chakra_max !== undefined)
        current.combat_stats.查克拉上限 = Number(data.查克拉上限 ?? data.chakra_max) || 0;
      if (data.体力 !== undefined || data.stamina !== undefined)
        current.combat_stats.体力 = Number(data.体力 ?? data.stamina) || 0;
      if (data.体力上限 !== undefined || data.stamina_max !== undefined)
        current.combat_stats.体力上限 = Number(data.体力上限 ?? data.stamina_max) || 0;
      if (data.速度 !== undefined || data.speed !== undefined)
        current.combat_stats.速度 = Number(data.速度 ?? data.speed) || 0;
      if (data.精神力 !== undefined || data.spirit !== undefined)
        current.combat_stats.精神力 = Number(data.精神力 ?? data.spirit) || 0;
      if (data.意志力 !== undefined || data.willpower !== undefined)
        current.combat_stats.意志力 = Number(data.意志力 ?? data.willpower) || 0;
      if (data.忍术造诣 !== undefined || data.ninjutsu !== undefined)
        current.combat_stats.忍术造诣 = Number(data.忍术造诣 ?? data.ninjutsu) || 0;
      if (data.体术造诣 !== undefined || data.taijutsu !== undefined)
        current.combat_stats.体术造诣 = Number(data.体术造诣 ?? data.taijutsu) || 0;
      if (data.幻术造诣 !== undefined || data.genjutsu !== undefined)
        current.combat_stats.幻术造诣 = Number(data.幻术造诣 ?? data.genjutsu) || 0;
    }
    if (data.忍阶 || data.rank) current.combat_stats = { ...(current.combat_stats || {}), 忍阶: data.忍阶 || data.rank };
    if (data.查克拉属性 || data.chakra_nature) {
      current.combat_stats = current.combat_stats || {};
      const rawNature = data.查克拉属性 || data.chakra_nature;
      current.combat_stats.查克拉属性 = Array.isArray(rawNature)
        ? rawNature : String(rawNature).split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    }
    if (Array.isArray(data.忍术 || data.jutsu) && (data.忍术 || data.jutsu).length > 0) {
      current.combat_stats = current.combat_stats || {};
      const jutsuList = data.忍术 || data.jutsu;
      current.combat_stats.忍术 = jutsuList.map(j => ({
        名称: j.名称 || j.name || '未知道',
        等级: j.等级 || j.rank || 'D',
        属性: j.属性 || j.element || '无',
        消耗: Number(j.消耗 || j.cost) || 10,
        威力: Number(j.威力 || j.power) || 20,
        熟练度: Number(j.熟练度 || j.mastery) || 30,
        描述: j.描述 || j.description || '',
        类型: j.类型 || j.type || '忍术'
      }));
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
    delete all[npc];
    stateManager.setSub('_relationships', all);
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
    return {
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
  }
}

export const relationshipSystem = new RelationshipSystem();
export default relationshipSystem;
