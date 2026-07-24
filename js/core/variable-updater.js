import { AIClient } from './ai-client.js';
import { eventBus } from './event-bus.js';
import { publishPromptTrace } from './prompt-trace.js';
import { getVariableUpdaterPreset, resolveVariableUpdaterPreset } from '../data/variable-updater-preset.js';
import { validateStructuredVariableUpdate } from '../data/var-schema.js';

export const VARIABLE_UPDATER_TRACE_STORAGE_KEY = 'naruto_variable_updater_prompt_trace';
const ALLOWED_TAGS = [
  'var_thinking', 'variable_thinking',
  'var', 'variable', 'combat', 'mission', 'relationship', 'memory', 'event'
];
const CUSTOM_TALENT_PLACEHOLDER = '自定义天赋组合';

export const VARIABLE_UPDATER_CONSISTENCY_PROTOCOL = `【系统强制输出一致性协议 · 不受自定义预设覆盖】
- <variable_thinking> 的第七段必须写一行“输出清单：variable=N, mission=N, relationship=N, memory=N, combat=N, event=N”，N 是随后实际输出的顶层标签数量。
- 自检一旦判定需要新增、推进、完成或失败任务，必须输出对应 <mission>；判定新人物需要建档时，必须输出对应 <relationship>。不得只在思维链里说要更新却不落账。
- 输出清单与实际顶层标签必须完全一致。每回合至少包含一个 <variable_thinking> 和一个 <memory>。`;

export const VARIABLE_UPDATER_OPENING_COMPLETION_PROTOCOL = `【系统强制开局待补全协议 · 不受自定义预设覆盖】
- 当前状态中的“自定义天赋组合”不是已完成的天赋，而是开局契约留下的结构化待办。
- 正常情况下首回合必须完成该待办；若旧存档或异常回合仍保留占位项，则当前回合必须依据玩家原文生成一个或多个具体天赋或血继。这是契约明确授权的初始化补全，不受“不得重复初始化”限制，也不要求正文再次获得该能力。
- 天赋使用 skills.talents.准确名称，血继使用 skills.kekkei_genkai.准确名称；用 set 写入完整对象，至少包含 name、rank、mastery、description，并忠实保留玩家写明的限制与代价。
- 成功输出任一具体天赋或血继后，本地系统会替换并删除“自定义天赋组合”占位项；禁止继续保留占位项充当实际能力。`;

export const VARIABLE_UPDATER_DELETION_PROTOCOL = `【系统强制删除协议 · 不受自定义预设覆盖】
- 部分消耗且仍有剩余：对 quantity 使用 sub。
- 丢弃、售出或消耗最后一件物品：必须输出 {"path":"equipment.分类","op":"remove","key":"准确物品名"}，禁止把 quantity 设为0或只删除数量字段。分类只能是 weapons、armor、tools、consumables。
- 遗忘或失去技能：必须输出 {"path":"skills.分类","op":"remove","key":"准确技能名"}，禁止把 mastery 设为0。分类只能是 jutsu、taijutsu、genjutsu、support、talents、kekkei_genkai。
- 同回合删除多个物品或技能时，每个对象分别输出一个 <variable>，不得合并或遗漏。`;

export const VARIABLE_UPDATER_COMBAT_PROTOCOL = `【系统强制战斗结算协议 · 不受自定义预设覆盖】
- 已有NPC战斗卡必须复用，只输出有明确证据的增量；禁止重复生成整张卡片或凭模型记忆补写招牌忍术。
- 最终正文中首次实际登场的有名人物必须建关系档案，并明确给出 combatant:true 或 combatant:false。平民、纯文职与无战斗能力者使用 false，不得伪造战斗卡。
- 首次初始化战斗型NPC时必须在 combat_stats 中提供忍阶、查克拉属性和至少一个符合时代、身份与证据的忍术；原创忍者可创建少量相容的基础术，但不得伪造 JT 数据库ID。六项属性与三系造诣可提供，本地系统会按忍阶基准自动补齐并限制数值。
- 忍术、幻术、体术分别消耗查克拉、精神力、体力；具体点数读取招式数据库的 cost，玩家与NPC统一结算，禁止按等级重算。
- 战斗行动不得另行输出 attributes.chakra_current/stamina_current/spirit_current 的 sub/set；否则会造成重复扣除。伤害只修改 vitality_current。`;

export const VARIABLE_UPDATER_OPENING_FILL_PROTOCOL = `【系统强制首回合补全协议 · 不受自定义预设覆盖】
- 仅在开局契约的 AI 补全模式为 fill 或 expand 且当前仍是第一回合时执行。
- “天赋/血继”整体为空时，必须生成至少一个与出身、查克拉性质和时代相容的具体天赋或血继；“初始能力”整体为空时，必须生成至少一个与忍阶相容的具体忍术、体术、幻术或支援术。
- 新实体必须使用 set 写入完整对象。天赋/血继至少含 name、rank、mastery、description；初始能力至少含 name、rank、element、cost、power、mastery、description。
- 这是开局契约授权的空白补全，不是剧情中凭空学会能力；不得覆盖任何已经存在的玩家条目。`;

export const VARIABLE_UPDATER_PENDING_NPC_PROTOCOL = `【系统强制待初始化人物协议 · 不受自定义预设覆盖】
- 下列开局关系尚未完成战斗身份分类。每人必须各输出一个 <relationship>：战斗型忍者写 combatant:true，并在 combat_stats 中提供忍阶、查克拉属性和至少一个合理忍术；非战斗人员写 combatant:false。
- 本地系统会从忍阶补齐并校准六项属性与三系造诣；不得只写社交数值而继续留下未分类档案。`;

export function resolveVariableUpdaterTimeout(variableConfig = {}) {
  if (variableConfig.timeoutMs === 0) return 999999999;
  const parsed = Number(variableConfig.timeoutMs);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

function buildBreakthroughInstruction(state) {
  const pending = Number(state?.['进度·突破待处理']) || 0;
  if (pending <= 0) return '';
  return `

【⚠️突破指令——本回合必须执行！】
当前突破待处理 = ${pending}。本回合必须完成实力突破！严格按以下步骤操作：
1. 按角色发展方向提升属性上限（chakra/vitality/stamina/spirit/speed 用 add），单回合总量 <= 15（重大突破）
2. 同步提升相关技能熟练度
3. 完成突破后，输出 <variable>{"path":"progression.pending_breakthrough","op":"sub","value":${pending}}，将突破标记清零
4. 在 <memory> 中详细记录本次突破的属性和技能成长内容`;
}

function resolveConfig(mainConfig = {}) {
  const config = mainConfig.variableUpdater || {};
  return {
    ...mainConfig,
    ...config,
    backend: config.backend && config.backend !== 'inherit' ? config.backend : mainConfig.backend,
    apiUrl: config.apiUrl || mainConfig.apiUrl,
    apiKey: config.apiKey || mainConfig.apiKey,
    model: config.model || mainConfig.model
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTopLevelTags(text) {
  const source = String(text || '');
  const blocks = [];
  const openPattern = new RegExp(`<(${ALLOWED_TAGS.join('|')})(?:\\s+[^>]*)?>`, 'gi');
  let cursor = 0;
  while (cursor < source.length) {
    openPattern.lastIndex = cursor;
    const open = openPattern.exec(source);
    if (!open) break;
    const tag = open[1].toLowerCase();
    const closePattern = new RegExp(`<\\/${escapeRegex(tag)}\\s*>`, 'gi');
    closePattern.lastIndex = openPattern.lastIndex;
    const close = closePattern.exec(source);
    const end = close ? closePattern.lastIndex : source.length;
    blocks.push({ tag, text: source.slice(open.index, end), openTag: open[0], closed: Boolean(close) });
    cursor = Math.max(end, openPattern.lastIndex);
  }
  return blocks;
}

function blockBody(block) {
  return String(block?.text || '')
    .replace(new RegExp(`^<${escapeRegex(block?.tag)}(?:\\s+[^>]*)?>`, 'i'), '')
    .replace(new RegExp(`<\\/${escapeRegex(block?.tag)}\\s*>$`, 'i'), '')
    .trim();
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmptyText(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

const MISSION_TITLE_KEYS = ['title', 'name', 'mission_name', 'missionName', 'task_name', '任务名', '任务名称'];

function missionTitle(data) {
  for (const key of MISSION_TITLE_KEYS) {
    const value = nonEmptyText(data?.[key]);
    if (value && !/^(?:未知任务|未命名任务|未知|unknown(?:\s+(?:mission|task))?)$/i.test(value)) return value;
  }
  return '';
}

function activeMission(state, id) {
  if (!id) return null;
  const direct = state?._missions?.active?.[id];
  if (direct) return direct;
  const active = state?.missions?.active;
  return Array.isArray(active) ? active.find(item => item?.id === id) || null : active?.[id] || null;
}

function relationshipFromState(state, npc) {
  return state?._relationships?.[npc] || state?.relationships?.[npc] || null;
}

function collectionHasConcreteEntries(collection) {
  if (Array.isArray(collection)) return collection.some(item => !String(item?.name || item || '').includes(CUSTOM_TALENT_PLACEHOLDER));
  if (!collection || typeof collection !== 'object') return false;
  return Object.entries(collection).some(([name, value]) => {
    const resolvedName = String(value?.name || name || '');
    return resolvedName && !resolvedName.includes(CUSTOM_TALENT_PLACEHOLDER);
  });
}

function flatStateHasSkill(state, categories) {
  const prefixes = categories.map(category => `技能·${category}·`);
  return Object.keys(state || {}).some(key => prefixes.some(prefix => key.startsWith(prefix))
    && !key.includes(`·${CUSTOM_TALENT_PLACEHOLDER}`));
}

export function getOpeningInitializationRequirements(state) {
  if (!state || typeof state !== 'object') return { talents: false, abilities: false, pendingNpcs: [] };
  const turn = Number(state['系统·回合数'] ?? state?._meta?.turn_count ?? 1);
  const firstTurn = !Number.isFinite(turn) || turn <= 1;
  const contract = state._opening_contract;
  const mode = contract?.completion_policy?.mode || '';
  const structuredSkills = record(state.skills);
  const hasTalents = collectionHasConcreteEntries(structuredSkills.talents)
    || collectionHasConcreteEntries(structuredSkills.kekkei_genkai)
    || flatStateHasSkill(state, ['天赋', '血继限界']);
  const hasAbilities = ['jutsu', 'taijutsu', 'genjutsu', 'support']
    .some(category => collectionHasConcreteEntries(structuredSkills[category]))
    || flatStateHasSkill(state, ['忍术', '体术', '幻术', '辅助']);
  const hasPlaceholder = JSON.stringify({
    talents: structuredSkills.talents,
    kekkei_genkai: structuredSkills.kekkei_genkai,
    rawTalents: contract?.raw?.talents
  }).includes(CUSTOM_TALENT_PLACEHOLDER);
  const fillEnabled = firstTurn && ['fill', 'expand'].includes(mode);
  const relationships = record(state._relationships || state.relationships);
  const pendingNpcs = firstTurn
    ? Object.entries(relationships)
      .filter(([, value]) => !value?.combat_stats && value?.combatant !== false)
      .map(([name]) => name)
    : [];
  return {
    talents: hasPlaceholder || (fillEnabled && !hasTalents),
    abilities: fillEnabled && !hasAbilities,
    pendingNpcs
  };
}

function variableUpdates(blocks, errors) {
  const updates = [];
  for (const block of blocks.filter(item => item.tag === 'var' || item.tag === 'variable')) {
    let data;
    try {
      data = JSON.parse(blockBody(block));
    } catch (error) {
      errors.push(`无法解析 <${block.tag}> JSON：${error.message}`);
      continue;
    }
    if (Array.isArray(data?.updates)) updates.push(...data.updates.filter(Boolean));
    else if (data && typeof data === 'object') updates.push(data);
  }
  return updates;
}

function isCompleteOpeningEntity(update, category) {
  const path = String(update?.path || update?.key || '');
  const op = String(update?.op || 'set').toLowerCase();
  if (!['set', '='].includes(op) || !record(update?.value).name) return false;
  const value = update.value;
  if (!Object.hasOwn(value, 'rank') || !Object.hasOwn(value, 'mastery') || !nonEmptyText(value.description)) return false;
  if (category === 'talents') {
    return /^skills\.(?:talents|kekkei_genkai)\.[^.]+$/.test(path)
      && !path.includes(CUSTOM_TALENT_PLACEHOLDER);
  }
  return /^skills\.(?:jutsu|taijutsu|genjutsu|support)\.[^.]+$/.test(path)
    && Object.hasOwn(value, 'element') && Object.hasOwn(value, 'cost') && Object.hasOwn(value, 'power');
}

function relationshipCombatDetails(data) {
  const nested = record(data?.combat_stats);
  const rank = nonEmptyText(nested.rank ?? nested['忍阶'] ?? data?.rank ?? data?.['忍阶'] ?? data?.enemy_rank);
  const chakraNature = nested.chakra_nature ?? nested['查克拉属性'] ?? data?.chakra_nature ?? data?.['查克拉属性'];
  const jutsu = nested.jutsu ?? nested['忍术'] ?? data?.jutsu ?? data?.['忍术'];
  const hasCard = Object.keys(nested).length > 0 || Boolean(rank) || Array.isArray(jutsu);
  const flag = data?.combatant ?? data?.is_combatant ?? data?.['战斗型'] ?? data?.['战斗人员'];
  const hasChakraNature = Array.isArray(chakraNature)
    ? chakraNature.some(item => nonEmptyText(item))
    : Boolean(nonEmptyText(chakraNature));
  return { rank, jutsu: Array.isArray(jutsu) ? jutsu : [], hasCard, flag, hasChakraNature };
}

function validateBlockStructures(blocks, errors) {
  const jsonTags = new Set(['variable', 'mission', 'relationship', 'memory', 'combat', 'event']);
  const combatStates = new Set(['start', 'round_start', 'player_turn', 'enemy_turn', 'in_progress', 'victory', 'defeat', 'retreat']);
  for (const block of blocks) {
    if (!block.closed) errors.push(`<${block.tag}> 标签未闭合`);
    if (block.tag === 'combat') {
      const state = String(block.openTag || '').match(/^<combat\s+state="([\w-]+)">$/i)?.[1] || '';
      if (!state) errors.push('<combat> 必须在开始标签提供 state 属性');
      else if (!combatStates.has(state)) errors.push(`不支持的 combat state: ${state}`);
    } else if (String(block.openTag || '').toLowerCase() !== `<${block.tag}>`) {
      errors.push(`<${block.tag}> 不支持开始标签属性`);
    }
    if (!jsonTags.has(block.tag)) continue;
    try {
      const data = JSON.parse(blockBody(block));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        errors.push(`<${block.tag}> 内容必须是JSON对象`);
        continue;
      }
      if (block.tag === 'memory' && !nonEmptyText(data.summary)) errors.push('<memory> 缺少 summary');
      if (block.tag === 'event') {
        if (!nonEmptyText(data.id)) errors.push('<event> 缺少 id');
        if (!['triggered', 'occurred', 'altered', 'skipped', 'postponed'].includes(data.status)) {
          errors.push(`<event> 状态无效: ${nonEmptyText(data.status) || '(空)'}`);
        }
        if (!nonEmptyText(data.description ?? data.desc)) errors.push('<event> 缺少 description');
      }
    } catch (error) {
      errors.push(`无法解析 <${block.tag}> JSON：${error.message}`);
    }
  }
}

function validateMissionBlocks(blocks, state, errors) {
  for (const block of blocks.filter(item => item.tag === 'mission')) {
    let data;
    try {
      data = JSON.parse(blockBody(block));
    } catch (error) {
      errors.push(`无法解析 <mission> JSON：${error.message}`);
      continue;
    }
    const id = nonEmptyText(data?.id);
    if (!id) {
      errors.push('任务标签缺少 id');
      continue;
    }
    const status = ['accepted', 'in_progress'].includes(data?.status) ? 'active' : data?.status;
    if (!['active', 'progress', 'completed', 'failed'].includes(status)) {
      errors.push(`任务 ${id} 的状态无效: ${nonEmptyText(status) || '(空)'}`);
      continue;
    }
    if (!['active', 'progress'].includes(status) || activeMission(state, id)) continue;
    if (!missionTitle(data)) errors.push(`新任务 ${id} 缺少 title/任务名称，不能生成“未知任务”`);
    if (!nonEmptyText(data?.rank)) errors.push(`新任务 ${id} 缺少 rank`);
    if (!nonEmptyText(data?.objective)) errors.push(`新任务 ${id} 缺少 objective`);
  }
}

function validateRelationshipBlocks(blocks, state, requirements, errors) {
  const seen = new Set();
  for (const block of blocks.filter(item => item.tag === 'relationship')) {
    let data;
    try {
      data = JSON.parse(blockBody(block));
    } catch (error) {
      errors.push(`无法解析 <relationship> JSON：${error.message}`);
      continue;
    }
    const npc = nonEmptyText(data?.npc ?? data?.name ?? data?.['姓名']);
    if (!npc) {
      errors.push('人物关系标签缺少 npc 姓名');
      continue;
    }
    seen.add(npc);
    const existing = relationshipFromState(state, npc);
    if (existing?.combat_stats) continue;
    const combat = relationshipCombatDetails(data);
    if (combat.flag === false && !combat.hasCard) continue;
    if (combat.flag !== true && !combat.hasCard) {
      errors.push(`人物 ${npc} 尚未分类：必须写 combatant:true 并提供战斗卡，或写 combatant:false`);
      continue;
    }
    if (!combat.rank) errors.push(`战斗型人物 ${npc} 的 combat_stats 缺少忍阶`);
    if (!combat.hasChakraNature) errors.push(`战斗型人物 ${npc} 的 combat_stats 缺少查克拉属性`);
    if (!combat.jutsu.length) errors.push(`战斗型人物 ${npc} 的 combat_stats 缺少至少一个忍术`);
  }
  for (const npc of requirements.pendingNpcs) {
    if (!seen.has(npc)) errors.push(`开局关系 ${npc} 尚未完成 combatant 分类和战斗卡初始化`);
  }
}

export function sanitizeVariableUpdaterOutput(text) {
  return extractTopLevelTags(text).map(block => block.text).join('\n').trim();
}

function declaredOutputCounts(thinking) {
  const aliases = {
    variable: ['variable', '变量'],
    mission: ['mission', '任务'],
    relationship: ['relationship', '关系'],
    memory: ['memory', '记忆'],
    combat: ['combat', '战斗'],
    event: ['event', '事件']
  };
  const manifest = String(thinking || '').match(/输出清单\s*[:：]([^\n。]*)/i)?.[1] || '';
  if (!manifest) return {};
  const counts = {};
  for (const [key, names] of Object.entries(aliases)) {
    const match = manifest.match(new RegExp(`(?:${names.join('|')})\\s*[=:：]\\s*(\\d+)`, 'i'));
    if (match) counts[key] = Number(match[1]);
  }
  return counts;
}

function thinkingDeclaresMissionWrite(thinking) {
  const units = String(thinking || '').split(/[。！？!?；;\n]+/).map(item => item.trim()).filter(Boolean);
  for (const unit of units) {
    if (!/(?:<mission>|任务)/i.test(unit)) continue;
    if (/(?:是否|检查|核对).{0,16}(?:需要|应否).{0,10}(?:新增|创建|接取|写入|输出|更新).{0,10}任务/.test(unit)
      && !/(?:结论|确认|本轮|实际).{0,10}(?:需要|应|必须|将)/.test(unit)) continue;
    if (/(?:无需|无须|不需要|不应|不得|禁止|没有必要|暂无|没有|无).{0,10}(?:新增|创建|接取|生成|写入|输出|更新|推进|完成|失败)?任务|任务.{0,10}(?:无变化|无需更新|不更新|未新增|未创建|未接取|未推进|未完成|未失败)/.test(unit)) continue;
    const hasAction = /(?:新增|创建|建立|接取|接受|生成|写入|输出|记录|更新|推进|完成|失败|放弃)/.test(unit);
    const hasCommitment = /(?:需要|需|应|应该|应当|必须|准备|计划|将|要|确认|已)/.test(unit);
    if (hasAction && (hasCommitment || /(?:新增|创建|接取|推进|完成|失败|放弃)任务/.test(unit))) return true;
  }
  return false;
}

function thinkingDeclaresRelationshipWrite(thinking) {
  const units = String(thinking || '').split(/[。！？!?；;\n]+/).map(item => item.trim()).filter(Boolean);
  for (const unit of units) {
    const hasTarget = /<relationship>|(?:新人物|新角色|新NPC|人物关系|关系档案)/i.test(unit);
    if (!hasTarget) continue;
    if (/(?:是否|检查|核对).{0,16}(?:需要|应否).{0,10}(?:新增|创建|建立|写入|输出|登记)/.test(unit)
      && !/(?:结论|确认|本轮|实际).{0,10}(?:需要|应|必须|将)/.test(unit)) continue;
    if (/(?:无需|无须|不需要|不应|不得|禁止|没有必要|暂无|没有|无).{0,10}(?:新增|创建|建立|写入|输出|登记)?(?:人物关系|关系档案|<relationship>)|(?:人物关系|关系档案).{0,10}(?:无变化|无需更新|不更新|未新增|不建档)/i.test(unit)) continue;
    const hasAction = /(?:新增|创建|建立|生成|写入|输出|记录|登记|建档)/.test(unit);
    const hasCommitment = /(?:需要|需|应|应该|应当|必须|准备|计划|将|要|确认|已)/.test(unit);
    if (hasAction && hasCommitment) return true;
  }
  return false;
}

export function validateVariableUpdaterOutput(text, options = {}) {
  const blocks = extractTopLevelTags(text);
  const counts = {
    variable: blocks.filter(block => block.tag === 'var' || block.tag === 'variable').length,
    mission: blocks.filter(block => block.tag === 'mission').length,
    relationship: blocks.filter(block => block.tag === 'relationship').length,
    memory: blocks.filter(block => block.tag === 'memory').length,
    combat: blocks.filter(block => block.tag === 'combat').length,
    event: blocks.filter(block => block.tag === 'event').length,
    thinking: blocks.filter(block => block.tag === 'var_thinking' || block.tag === 'variable_thinking').length
  };
  const thinking = blocks
    .filter(block => block.tag === 'var_thinking' || block.tag === 'variable_thinking')
    .map(blockBody)
    .join('\n');
  const errors = [];
  validateBlockStructures(blocks, errors);
  if (counts.thinking < 1) errors.push('缺少顶层 <variable_thinking> 变量自检标签');
  if (counts.memory < 1) errors.push('缺少每回合必需的顶层 <memory> 标签');

  const declared = declaredOutputCounts(thinking);
  for (const [tag, expected] of Object.entries(declared)) {
    if (counts[tag] !== expected) errors.push(`输出清单声明 ${tag}=${expected}，实际顶层标签为 ${counts[tag]}`);
  }
  if (thinkingDeclaresMissionWrite(thinking) && counts.mission < 1) {
    errors.push('变量自检已声明需要新增或更新任务，但缺少顶层 <mission> 标签');
  }
  if (thinkingDeclaresRelationshipWrite(thinking) && counts.relationship < 1) {
    errors.push('变量自检已声明需要新增人物关系档案，但缺少顶层 <relationship> 标签');
  }
  const updates = variableUpdates(blocks, errors);
  for (const update of updates) {
    const validation = validateStructuredVariableUpdate(update);
    if (!validation.valid) errors.push(validation.reason);
  }
  const state = options?.state;
  validateMissionBlocks(blocks, state || {}, errors);
  validateRelationshipBlocks(blocks, state || {}, state ? getOpeningInitializationRequirements(state) : { pendingNpcs: [] }, errors);
  if (state && typeof state === 'object') {
    const requirements = getOpeningInitializationRequirements(state);
    if (requirements.talents && !updates.some(update => isCompleteOpeningEntity(update, 'talents'))) {
      errors.push('首回合开局补全尚未写入完整的具体天赋或血继变量');
    }
    if (requirements.abilities && !updates.some(update => isCompleteOpeningEntity(update, 'abilities'))) {
      errors.push('首回合开局补全尚未写入完整的具体初始能力变量');
    }
  }
  return { valid: errors.length === 0, errors, counts, declared, thinking };
}

function publishTrace(messages, { userInput, presetName, generationOptions, model }) {
  publishPromptTrace({
    kind: 'variable-updater',
    title: '变量更新模型请求',
    userInput,
    presetName,
    model,
    generationOptions,
    messages,
    messageSources: messages.map((_, index) => ({
      source: '变量更新预设',
      label: `${presetName}#${index + 1}`
    }))
  });
}

export function buildVariableUpdaterMessages(preset, {
  state,
  compactState,
  userInput,
  enrichedInput,
  narrativeResponse,
  breakthroughInstruction = '',
  openingContract = '',
  memoryContext = '',
  knowledgeContext = '',
  correctionInstruction = ''
} = {}) {
  const messages = resolveVariableUpdaterPreset(preset, {
    compactState,
    userInput,
    enrichedInput,
    narrativeResponse,
    breakthroughInstruction,
    memoryContext,
    knowledgeContext
  });
  if (!messages.length) return messages;

  const runtimeContext = [
    memoryContext ? `[记忆摘要]\n${memoryContext}` : '',
    knowledgeContext
  ].filter(Boolean).join('\n\n');
  if (runtimeContext) messages.unshift({ role: 'system', content: runtimeContext });

  // Saved presets may predate v2 local opening initialization. Re-assert the contract after
  // custom preset entries so an old "initialize everything on opening" rule cannot override it.
  if (openingContract) messages.push({ role: 'system', content: openingContract });
  const compactStateText = JSON.stringify(compactState || {});
  const openingRequirements = getOpeningInitializationRequirements(state);
  if (compactStateText.includes(CUSTOM_TALENT_PLACEHOLDER) || openingRequirements.talents) {
    messages.push({ role: 'system', content: VARIABLE_UPDATER_OPENING_COMPLETION_PROTOCOL });
  }
  if (openingRequirements.talents || openingRequirements.abilities) {
    const required = [
      openingRequirements.talents ? '- 本次必须写入至少一个完整的具体天赋或血继变量。' : '',
      openingRequirements.abilities ? '- 本次必须写入至少一个完整的具体初始能力变量。' : ''
    ].filter(Boolean).join('\n');
    messages.push({ role: 'system', content: `${VARIABLE_UPDATER_OPENING_FILL_PROTOCOL}\n${required}` });
  }
  if (openingRequirements.pendingNpcs.length) {
    messages.push({
      role: 'system',
      content: `${VARIABLE_UPDATER_PENDING_NPC_PROTOCOL}\n待初始化人物：${openingRequirements.pendingNpcs.join('、')}`
    });
  }
  messages.push({ role: 'system', content: VARIABLE_UPDATER_CONSISTENCY_PROTOCOL });
  if (correctionInstruction) {
    messages.push({
      role: 'system',
      content: `【上一次变量输出未通过一致性校验】\n${correctionInstruction}\n请重新生成本回合完整输出，不要只补一个孤立标签；输出清单与实际顶层标签必须一致。`
    });
  }
  // Saved presets may also contain the former rule that regenerated every named NPC card.
  messages.push({ role: 'system', content: VARIABLE_UPDATER_COMBAT_PROTOCOL });
  // Keep the established deletion invariant as the final system instruction.
  messages.push({ role: 'system', content: VARIABLE_UPDATER_DELETION_PROTOCOL });
  return messages;
}

export async function runVariableUpdater({
  mainConfig,
  userInput,
  enrichedInput,
  state,
  narrativeResponse,
  compactState,
  openingContract = '',
  memoryContext = '',
  knowledgeContext = '',
  correctionInstruction = '',
  onClient
}) {
  const variableConfig = mainConfig?.variableUpdater;
  if (!variableConfig?.enabled) return null;

  const updaterConfig = resolveConfig(mainConfig);
  if (!updaterConfig.model || (updaterConfig.backend !== 'tavern' && !updaterConfig.apiUrl)) {
    eventBus.emit('pipeline:warning', { warning: '变量更新模型配置不完整，已跳过本回合变量更新。请在“变量更新”选项卡中配置。' });
    return null;
  }

  const preset = getVariableUpdaterPreset();
  const messages = buildVariableUpdaterMessages(preset, {
    state,
    compactState,
    userInput,
    enrichedInput,
    narrativeResponse,
    breakthroughInstruction: buildBreakthroughInstruction(state),
    openingContract,
    memoryContext,
    knowledgeContext,
    correctionInstruction
  });
  if (!messages.length) throw new Error('变量更新预设没有启用的有效条目');

  const generationOptions = {
    temperature: Number.isFinite(Number(variableConfig.temperature)) ? Number(variableConfig.temperature) : 0.9,
    max_tokens: Math.max(256, Number(variableConfig.maxTokens) || 8192),
    timeout: resolveVariableUpdaterTimeout(variableConfig)
  };
  publishTrace(messages, {
    userInput,
    presetName: preset.name || '未命名预设',
    generationOptions,
    model: updaterConfig.model
  });

  try {
    const client = new AIClient();
    onClient?.(client);
    client.configure(updaterConfig);
    const variableTags = variableConfig.streaming !== false
      ? await client.chatStream(messages, generationOptions, () => {})
      : await client.chat(messages, generationOptions);
    if (!variableTags || variableTags.trim().length < 20) {
      throw new Error(`变量更新模型返回内容过短（${variableTags?.length || 0}字符），疑似空回或截断`);
    }
    const cleaned = sanitizeVariableUpdaterOutput(variableTags);
    if (!cleaned || cleaned.trim().length < 10) {
      throw new Error(`未检测到有效的 XML 变量标签（原始长度 ${variableTags?.length || 0} 字符）`);
    }
    const validation = validateVariableUpdaterOutput(cleaned, { state });
    if (!validation.valid) {
      const error = new Error(`变量自检与结构标签不一致：${validation.errors.join('；')}`);
      error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
      error.validation = validation;
      throw error;
    }
    return cleaned;
  } catch (error) {
    console.warn('[VariableUpdater] 更新失败:', error.message);
    eventBus.emit('pipeline:warning', { warning: `变量更新失败: ${error.message}` });
    throw error;
  } finally {
    onClient?.(null);
  }
}
