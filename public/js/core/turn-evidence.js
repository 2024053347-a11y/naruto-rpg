import {
  CANON_DATABASE,
  formatCanonDate,
  normalizeCanonDate
} from '../data/canon-database.js';
import {
  formatOpeningContractPrompt,
  resolveOpeningContract
} from '../systems/opening-contract.js';
import { compileContinuityAnchors } from './continuity-ledger.js';
import { worldbookV2Resolver } from '../data/worldbook/runtime-resolver.js';

export const EVIDENCE_AUDIENCES = Object.freeze([
  'narrator',
  'writer',
  'updater',
  'reviewer',
  'planner',
  'npc'
]);

const PLAYER_FIELDS = Object.freeze([
  '玩家·姓名', '玩家·年龄', '玩家·性别', '玩家·忍阶', '玩家·正式忍阶',
  '玩家·战力等级', '玩家·所属村', '玩家·出身', '玩家·查克拉属性',
  '玩家·难度', '玩家·个性', '玩家·公开身份', '玩家·当前目标',
  '玩家·声望标签', '玩家·存活', '玩家·死因'
]);

const WORLD_FIELDS = Object.freeze([
  '世界·地点', '世界·时间', '世界·年代', '世界·月份', '世界·天气',
  '世界·已探索区域', '世界·活跃事件'
]);

const ATTRIBUTE_PREFIXES = Object.freeze(['属性·', '进度·']);
const ENTITY_PREFIXES = Object.freeze(['技能·', '物品·']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function compileContinuitySafely(ledger, options) {
  if (!ledger) return null;
  try {
    return compileContinuityAnchors(ledger, { minImportance: 0, limit: 64, ...options });
  } catch (error) {
    console.warn('[TurnEvidence] 连续性账本无效，本回合按空锚点降级:', error.message);
    return null;
  }
}

function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== '') result[key] = clone(source[key]);
  }
  return result;
}

function pickPrefixes(source, prefixes) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (prefixes.some(prefix => key.startsWith(prefix))) result[key] = clone(value);
  }
  return result;
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function textOverlaps(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function currentDateOf(state) {
  return normalizeCanonDate(state?.['世界·时间'] || state?.['世界·年代']);
}

function stateSkillNames(state) {
  const names = new Set();
  for (const key of Object.keys(state || {})) {
    const match = key.match(/^技能·[^·]+·(.+?)·名称$/);
    if (match && state[key]) names.add(String(state[key]));
    const pathMatch = key.match(/^技能·[^·]+·(.+?)·/);
    if (pathMatch) names.add(pathMatch[1]);
  }
  return names;
}

function relationshipNames(state) {
  return Object.keys(state?._relationships || {});
}

function sceneMatches(scene, { location, query, names, activeSceneIds }) {
  if (activeSceneIds.has(scene?.id)) return true;
  if (location && textOverlaps(scene?.location, location)) return true;
  const queryText = String(query || '');
  for (const participant of scene?.participants || []) {
    if (queryText.includes(participant) || names.has(participant)) return true;
  }
  return false;
}

function observableScene(scene, { includeIds = false } = {}) {
  if (!scene) return null;
  const value = {
    title: scene.title,
    thread: scene.thread_id || scene.thread,
    location: scene.location,
    participants: clone(scene.participants || []),
    resolution_mode: scene.resolution_mode,
    requirements: clone(scene.requirements || []),
    blockers: clone(scene.blockers || []),
    setup: scene.setup,
    beats: (scene.beats || []).map(beat => ({
      ...(includeIds ? { id: beat.id } : {}),
      order: beat.order,
      summary: beat.summary,
      causal_role: beat.causal_role
    })),
    stop_condition: scene.stop_condition,
    fallbacks: clone(scene.fallbacks || []),
    reference_facts: clone(scene.reference_facts || [])
  };
  if (includeIds && scene.id) value.id = scene.id;
  return value;
}

function compileCurrentPlot(plotContext, state, userInput) {
  if (!plotContext?.day || plotContext.is_future) return null;
  const location = state?.['世界·地点'] || '';
  const names = new Set(relationshipNames(state));
  if (state?._combat?.enemy_name) names.add(state._combat.enemy_name);
  const activeSceneIds = new Set([
    ...(state?._canon?.active_scene_ids || []),
    ...(state?._timeline?.active_scene_ids || [])
  ]);
  const allScenes = plotContext.day.scenes || [];
  let selected = allScenes.filter(scene => sceneMatches(scene, {
    location,
    query: userInput,
    names,
    activeSceneIds
  }));
  if (!selected.length && allScenes.length === 1) selected = allScenes;
  return {
    date: plotContext.current_date,
    day_id: plotContext.day.id,
    title: plotContext.day.title,
    day_goal: plotContext.day.day_goal,
    start_state: clone(plotContext.day.start_state || []),
    reference_facts: clone(plotContext.day.reference_facts || []),
    matched_scene_count: selected.length,
    total_scene_count: allScenes.length,
    scenes: selected.map(scene => observableScene(scene, { includeIds: true }))
  };
}

function compileNextAnchor(plotContext) {
  if (!plotContext?.day || !plotContext.is_future) return null;
  return {
    date: plotContext.target_date || plotContext.day.date,
    days_until: Number(plotContext.days_until) || 0,
    rule: '这是未来日期边界，不是跳转指令；不得透露或提前执行该日人物、场景、节拍与结果。'
  };
}

function relevantSnapshot(snapshotContext, state, userInput) {
  if (!snapshotContext?.snapshot) return null;
  const query = String(userInput || '');
  const location = state?.['世界·地点'] || '';
  const names = new Set(relationshipNames(state));
  if (state?._combat?.enemy_name) names.add(state._combat.enemy_name);
  const characters = (snapshotContext.snapshot.characters || []).filter(character => (
    names.has(character.name)
    || query.includes(character.name)
    || textOverlaps(character.public_state?.location, location)
  )).slice(0, 16);
  const factions = (snapshotContext.snapshot.factions || []).filter(faction => (
    query.includes(faction.name)
    || textOverlaps(faction.location, location)
    || faction.visibility === 'public'
  )).slice(0, 16);
  return {
    as_of: snapshotContext.snapshot_date,
    current_date: snapshotContext.current_date,
    public_characters: characters.map(character => ({
      entity_id: character.entity_id,
      name: character.name,
      age: clone(character.age),
      public_state: clone(character.public_state)
    })),
    public_factions: factions.filter(faction => faction.visibility === 'public').map(clone),
    restricted_factions: factions.filter(faction => faction.visibility !== 'public').map(clone),
    backstage_truth: characters.filter(character => character.actual_state).map(character => ({
      entity_id: character.entity_id,
      name: character.name,
      actual_state: clone(character.actual_state)
    }))
  };
}

function techniqueIsAvailable(technique, currentDate, learnedNames) {
  const displayNames = [technique.name, ...(technique.aliases || []), ...(technique.lookup_aliases || [])]
    .filter(Boolean).map(String);
  if (displayNames.some(name => learnedNames.has(name))) return true;
  const earliest = normalizeCanonDate(technique.availability?.earliest_confirmed_date);
  if (!earliest || !currentDate) return true;
  return earliest.localeCompare(currentDate) <= 0;
}

function compactTechnique(technique, learnedNames) {
  const names = [technique.name, ...(technique.aliases || []), ...(technique.lookup_aliases || [])]
    .filter(Boolean).map(String);
  return {
    id: technique.id,
    name: technique.name,
    aliases: clone(technique.aliases || []),
    type: technique.type,
    rank: technique.rank,
    element: clone(technique.element || technique.elements || null),
    resource: technique.resource,
    cost: technique.cost,
    power: technique.power,
    summary: technique.summary,
    access: clone(technique.access || {}),
    availability: clone(technique.availability || {}),
    mastered_in_state: names.some(name => learnedNames.has(name)),
    known_users_are_reference_only: true
  };
}

function compactRelationships(state) {
  const result = {};
  for (const [name, relationship] of Object.entries(state?._relationships || {})) {
    result[name] = {
      entity_id: relationship.entity_id || relationship.npc_id || null,
      role: relationship.role || '',
      affection: Number(relationship.affection) || 0,
      trust: Number(relationship.trust) || 0,
      respect: Number(relationship.respect) || 0,
      last_interaction: relationship.last_interaction || '',
      promises: clone(relationship.promises || []),
      debts: clone(relationship.debts || []),
      known_secrets: clone(relationship.known_secrets || []),
      grand_summary: relationship.grand_summary || '',
      combat_stats: clone(relationship.combat_stats || null)
    };
  }
  return result;
}

export function buildCurrentStateEvidence(state = {}) {
  return {
    version: state._version || null,
    branch_id: state?._meta?.active_branch || state['系统·当前分支'] || 'branch_main',
    node_id: state?._meta?.current_node_id || state['系统·当前节点'] || null,
    turn: Number(state['系统·回合数']) || 0,
    player: pick(state, PLAYER_FIELDS),
    world: pick(state, WORLD_FIELDS),
    attributes_and_progression: pickPrefixes(state, ATTRIBUTE_PREFIXES),
    skills_and_equipment: pickPrefixes(state, ENTITY_PREFIXES),
    missions: clone(state._missions || {}),
    relationships: compactRelationships(state),
    combat: clone(state._combat || null),
    map: {
      known_locations: clone(state?._map?.known_locations || {}),
      active_pins: clone(state?._map?.active_pins || '')
    }
  };
}

function normalizeWorldbookResult(value) {
  if (!value) return [];
  if (Array.isArray(value)) return clone(value);
  if (Array.isArray(value.entries)) return clone(value.entries);
  return [];
}

function worldbookVisibility(entry) {
  return entry?.knowledge?.visibility || entry?.visibility || 'public';
}

function projectWorldbook(entries, audience, entityId, npcName = '') {
  if (audience === 'planner') return clone(entries);
  return entries.filter(entry => {
    const systemAudiences = entry?.knowledge?.audience;
    if (Array.isArray(systemAudiences) && !systemAudiences.includes(audience)) return false;
    const visibility = worldbookVisibility(entry);
    if (visibility === 'backstage' || visibility === 'secret') return false;
    if (audience === 'npc' && entry?.character_profile) {
      const profileNames = [
        ...(entry.character_profile.names || []),
        ...(entry.character_profile.aliases || [])
      ];
      const isOwnProfile = Boolean(entityId) && (entry.entity_ids || []).includes(entityId)
        || Boolean(npcName) && profileNames.includes(npcName);
      if (!isOwnProfile) return false;
    }
    if (visibility === 'public') return true;
    const allowed = entry?.knowledge?.audience?.entity_ids || entry?.audience?.entity_ids || [];
    return Boolean(entityId) && allowed.includes(entityId);
  }).map(clone);
}

function redactStateForNpc(currentState, entityId, npcName) {
  const ownRelationship = Object.entries(currentState.relationships || {}).find(([name, relationship]) => (
    relationship.entity_id === entityId || name === npcName
  ));
  return {
    branch_id: currentState.branch_id,
    node_id: currentState.node_id,
    turn: currentState.turn,
    player: {
      '玩家·姓名': currentState.player?.['玩家·姓名'],
      '玩家·性别': currentState.player?.['玩家·性别'],
      '玩家·忍阶': currentState.player?.['玩家·忍阶'],
      '玩家·所属村': currentState.player?.['玩家·所属村'],
      '玩家·公开身份': currentState.player?.['玩家·公开身份']
    },
    world: currentState.world,
    relationship_to_player: ownRelationship ? { name: ownRelationship[0], ...ownRelationship[1] } : null,
    combat: currentState.combat
  };
}

export class TurnEvidenceCompiler {
  constructor({
    canonDatabase = CANON_DATABASE,
    worldbookResolver = worldbookV2Resolver,
    continuityLedger = null
  } = {}) {
    this.canonDatabase = canonDatabase;
    this.worldbookResolver = worldbookResolver;
    this.continuityLedger = continuityLedger;
  }

  compile({ state = {}, userInput = '', nodeId = null, branchId = null } = {}) {
    const currentDate = currentDateOf(state);
    const plotContext = currentDate ? this.canonDatabase.getPlotDayContext({ state }) : null;
    const snapshotContext = currentDate ? this.canonDatabase.getYearSnapshotContext({ state }) : null;
    const learnedNames = stateSkillNames(state);
    const techniques = this.canonDatabase.searchTechniques({ query: userInput, state, limit: 10 })
      .filter(technique => techniqueIsAvailable(technique, currentDate, learnedNames))
      .map(technique => compactTechnique(technique, learnedNames));

    let worldbookEntries = [];
    if (this.worldbookResolver?.resolve) {
      worldbookEntries = normalizeWorldbookResult(this.worldbookResolver.resolve({
        query: userInput,
        state,
        currentDate,
        audience: 'planner'
      }));
    } else if (this.worldbookResolver?.search) {
      worldbookEntries = normalizeWorldbookResult(this.worldbookResolver.search(userInput, { state, memory: state._memory || {} }));
    }

    const resolvedNodeId = nodeId || state?._meta?.current_node_id || null;
    const resolvedBranchId = branchId || state?._meta?.active_branch || 'branch_main';
    const continuitySource = state?._continuity || null;
    const continuity = this.continuityLedger?.compileAnchors?.({
      state,
      nodeId: resolvedNodeId,
      branchId: resolvedBranchId,
      gameTime: currentDate,
      query: userInput,
      audienceId: 'writer'
    }) || compileContinuitySafely(continuitySource, {
      nodeId: resolvedNodeId,
      branchId: resolvedBranchId,
      gameTime: currentDate,
      audienceId: 'writer'
    });

    const openingContract = resolveOpeningContract(state);
    return {
      schema: 'naruto.turn-evidence/v1',
      compiled_at: Date.now(),
      node_id: resolvedNodeId,
      branch_id: resolvedBranchId,
      current_date: currentDate,
      user_input: String(userInput || ''),
      current_state: buildCurrentStateEvidence(state),
      opening_contract: clone(openingContract),
      continuity_anchors: clone(continuity),
      _continuity_ledger: clone(continuitySource),
      worldbook_entries: worldbookEntries,
      year_snapshot: relevantSnapshot(snapshotContext, state, userInput),
      current_plot: compileCurrentPlot(plotContext, state, userInput),
      next_anchor: compileNextAnchor(plotContext),
      protected_future: plotContext?.is_future ? clone(plotContext.day) : null,
      technique_definitions: techniques,
      conflicts: [],
      provenance: {
        state: 'runtime-state',
        opening: openingContract ? 'opening-contract' : null,
        worldbook: worldbookEntries.map(entry => entry.id || entry.title).filter(Boolean),
        plot: plotContext?.day?.id || null,
        techniques: techniques.map(item => item.id),
        continuity: continuity?.event_ids || []
      }
    };
  }

  project(packet, {
    audience = 'writer', entityId = null, npcName = '', includeOperationalIds = false
  } = {}) {
    if (!EVIDENCE_AUDIENCES.includes(audience)) throw new Error(`未知证据受众: ${audience}`);
    const isNpc = audience === 'npc';
    const isPlanner = audience === 'planner';
    const includeIds = audience === 'updater' || isPlanner
      || (audience === 'writer' && includeOperationalIds === true);
    const currentPlot = packet.current_plot ? clone(packet.current_plot) : null;
    if (currentPlot && !includeIds) {
      delete currentPlot.day_id;
      currentPlot.scenes = currentPlot.scenes.map(scene => observableScene(scene, { includeIds: false }));
    }
    const yearSnapshot = packet.year_snapshot ? clone(packet.year_snapshot) : null;
    if (yearSnapshot && !isPlanner) {
      delete yearSnapshot.backstage_truth;
      delete yearSnapshot.restricted_factions;
    }
    const openingPrompt = formatOpeningContractPrompt(packet.opening_contract, {
      compact: audience !== 'narrator',
      audience: isNpc ? 'npc' : 'narrator'
    });
    let continuityAnchors = clone(packet.continuity_anchors);
    if (packet._continuity_ledger) {
      const audienceId = isPlanner
        ? 'narrator'
        : (isNpc ? (entityId || `npc:${npcName || 'unknown'}`) : audience);
      continuityAnchors = compileContinuitySafely(packet._continuity_ledger, {
        nodeId: packet.node_id,
        branchId: packet.branch_id,
        gameTime: packet.current_date,
        audienceId,
        includeBackstage: isPlanner
      });
    }
    const worldbookEntries = projectWorldbook(packet.worldbook_entries || [], audience, entityId, npcName);
    const provenance = clone(packet.provenance || {});
    provenance.worldbook = worldbookEntries.map(entry => entry.id || entry.title).filter(Boolean);
    if (audience !== 'updater' && !isPlanner) provenance.plot = null;
    return {
      schema: 'naruto.evidence-view/v1',
      audience,
      entity_id: entityId,
      node_id: packet.node_id,
      branch_id: packet.branch_id,
      current_date: packet.current_date,
      authority_policy: {
        current_branch_facts: 'current_state + confirmed_continuity',
        player_identity_and_agency: 'opening_contract',
        personality_and_world_lore: 'worldbook',
        date_age_faction_and_plot: 'project_timeline',
        technique_definition: 'JT database',
        player_input: 'intent_or_claim_only',
        pretrained_knowledge: 'style_only; unknown facts stay unknown'
      },
      current_state: isNpc
        ? redactStateForNpc(packet.current_state, entityId, npcName)
        : clone(packet.current_state),
      opening_contract: openingPrompt || '',
      continuity_anchors: continuityAnchors,
      worldbook_entries: worldbookEntries,
      year_snapshot: yearSnapshot,
      current_plot: isNpc ? null : currentPlot,
      next_anchor: isPlanner || !packet.current_plot ? clone(packet.next_anchor) : null,
      technique_definitions: clone(packet.technique_definitions || []),
      protected_future: isPlanner ? clone(packet.protected_future) : null,
      conflicts: clone(packet.conflicts || []),
      provenance
    };
  }
}

function jsonBlock(label, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  return `[${label}]\n${typeof value === 'string' ? value : JSON.stringify(value)}`;
}

export function renderEvidenceView(view, { stage = 'main' } = {}) {
  const blocks = [
    `[可信回合证据 · ${stage} · audience=${view.audience}]`,
    jsonBlock('字段权威', view.authority_policy),
    jsonBlock('开局契约', view.opening_contract),
    jsonBlock('当前状态', view.current_state),
    jsonBlock('连续性锚点', view.continuity_anchors),
    jsonBlock('当前日期年度公开状态', view.year_snapshot),
    jsonBlock('相关世界书', view.worldbook_entries),
    jsonBlock('当前可接续剧情', view.current_plot),
    jsonBlock('下一剧情日期边界', view.next_anchor),
    jsonBlock('受保护未来 · 仅规划器', view.protected_future),
    jsonBlock('相关忍术定义', view.technique_definitions),
    jsonBlock('待裁决冲突', view.conflicts)
  ].filter(Boolean);
  if (view.current_date) blocks.splice(1, 0, `当前项目日期: ${formatCanonDate(view.current_date)}`);
  blocks.push(`[使用约束]\n只使用本证据视图允许的事实。未提供的设定保持未知；不得从预训练知识补成确定事实。NEXT_ANCHOR 只限制时间，不得主动跳转或暗示其内容。${view.audience === 'planner' ? '受保护未来只供内部维护因果；任何下游候选、大纲、审查意见和正文都不得引用、复述、暗示或提前执行其标题、ID、人物行动与结果。' : '本视图不含受保护未来细节；不得猜测或补全。'}`);
  return blocks.join('\n\n');
}

export const turnEvidenceCompiler = new TurnEvidenceCompiler();

export default turnEvidenceCompiler;
