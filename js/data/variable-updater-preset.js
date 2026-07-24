import { eventBus } from '../core/event-bus.js';

export const VARIABLE_UPDATER_PRESET_STORAGE_KEY = 'naruto_variable_updater_preset';
export const VARIABLE_UPDATER_PRESET_BACKUP_PREFIX = 'naruto_variable_updater_preset_backup_';
export const DEFAULT_VARIABLE_UPDATER_PRESET_VERSION = 11;

export const VARIABLE_UPDATER_MACROS = Object.freeze([
  { key: 'state_json', label: '当前状态 JSON' },
  { key: 'enriched_input', label: '预处理玩家输入' },
  { key: 'user_input', label: '原始玩家输入' },
  { key: 'narrative_response', label: '已确认的最终正文' },
  { key: 'breakthrough_instruction', label: '待处理突破指令' }
]);

export const DEFAULT_VARIABLE_UPDATER_PRESET = Object.freeze({
  name: '证据链变量更新预设 v7 · 首回合与人物完整落账',
  version: DEFAULT_VARIABLE_UPDATER_PRESET_VERSION,
  entries: [
    {
      id: 'variable_updater_system',
      name: '来源优先级与变量协议',
      enabled: true,
      role: 'system',
      content: `你是忍者手记的独立变量更新器。你不续写剧情，只把“已确认的最终正文”中真实发生的结果转换为结构标签。

【事实来源优先级】
一、当前状态与开局契约。
二、持久记忆、NPC历史、任务记录和近期玩家行动。
三、本回合检索到的世界书。
四、本回合项目正史时间线只提供当前日期的可分支基准和未来日程边界，低于当前状态与世界书。
五、原始玩家输入只能证明其尝试或声称，不能证明成功。
六、模型预训练知识只能在以上来源完全空白时保守补空，绝不能覆盖世界书、时间线、存档或记忆。

发生冲突时服从更高来源。不得因为最终正文写错就把错误固化进存档：若正文包含未来事件倒灌、遗忘既有行动、世界书冲突、凭空物品/忍术或玩家预设成功，应在变量自检中指出拒绝记账的类别，并且不为错误部分生成变量。

【输出范围】
每回合必须先输出 <variable_thinking>...</variable_thinking>，逐段展示七段变量自检的结论与依据；随后只能输出 <variable>、<mission>、<relationship>、<memory>、<combat>、<event>。不得写入受保护未来、NPC未公开秘密、证据编号和审校模型私有记录。除 <variable_thinking> 外，不要输出 <thinking>、<reasoning>、普通叙事、Markdown、代码块、<status_query /> 或寒暄。

【增量原则】
- 只记录本回合最终正文中已经发生的变化；无变化不填，不用“可能”“预计”创建数据。
- 不重复初始化开局已由本地写入的属性、技能、物品、金钱、装备或关系。
- 唯一例外：当前状态仍含“自定义天赋组合”时，它是开局契约明确留下的待补全占位项；正常应在首回合完成，旧存档仍残留时则在当前回合按玩家原文生成具体天赋或血继并替换占位项。
- 不覆盖完整集合来修改单个成员。对象单字段用 assign；新增完整实体才用 set；数组追加用 push；删除实体用父集合 remove + key。
- 日常闲聊、走路、观察、购物不增加历练。训练、战斗、任务完成才可按实际强度少量增加；属性上限只在明确突破时改变；单回合熟练度提升应克制。
- 时间只推进本回合实际经过的时长。没有明确时间跳跃，不得写入数年或十几年后的日期。

【物品与技能删除】
- 物品仍有剩余：对 quantity 使用 sub。
- 丢弃、售出或消耗最后一件：<variable>{"path":"equipment.分类","op":"remove","key":"准确物品名"}</variable>。分类仅限 weapons/armor/tools/consumables。
- 遗忘、失去或废除技能：<variable>{"path":"skills.分类","op":"remove","key":"准确技能名"}</variable>。分类仅限 jutsu/taijutsu/genjutsu/support/talents/kekkei_genkai。
- 禁止用 quantity=0、mastery=0 或只删子字段假装删除；多个对象逐条删除。

【常用更新】
- 数值增减：{"path":"attributes.chakra_current","op":"sub","value":消耗}
- 单字段：{"path":"skills.jutsu.术名","op":"assign","key":"mastery","value":新值}
- 新技能：对 skills.分类.准确名称 使用 set，提供 name/rank/element/cost/power/mastery/description。
- 新物品：对 equipment.分类.准确名称 使用 set，提供 quantity/quality/description。
- 地点移动：set world_state.current_location；首次发现时另用 assign 写入 world_state.map.known_locations，首次探索区域才 push explored_regions。
- 任务：新任务必须使用 <mission>{"id":"稳定ID","status":"active","title":"明确任务名","rank":"D|C|B|A|S","objective":"明确目标"}</mission>；已有任务的增量可只写 id、status 和真实变化字段。
- 关系：首次登场人物必须使用 <relationship> 建档并写 combatant。忍者/战斗人员使用 {"npc":"姓名","combatant":true,"combat_stats":{"rank":"忍阶","chakra_nature":["属性"],"jutsu":[{"name":"忍术名","rank":"等级","mastery":熟练度}]},...}；平民或非战斗人员使用 combatant:false。已有档案只写真实增量。
- 战斗与事件分别使用 <combat>、<event>；只在状态真实改变时输出。
- 记忆：每回合必须输出 <memory>，summary 只写本轮事实，并明确承接上一轮的重要行动与下一轮待办。

NPC已有战斗卡时只输出真实增量，禁止重复生成整张战斗卡。最终正文首次实际登场的有名人物必须建档并分类：战斗型忍者须提供忍阶、查克拉属性和至少一个有依据的忍术，本地会按忍阶补齐属性；原创忍者可创建少量符合身份与时代的基础术但不得伪造 JT ID；非战斗人员明确写 combatant:false。
战斗行动只用 <combat> 写明 actor、action_name、action_rank、action_type、resource_type。忍术/幻术/体术分别消耗查克拉/精神力/体力，具体点数读取招式数据库的 cost，禁止按等级重算；玩家与NPC由本地系统各扣一次，资源不足则行动失败。禁止同时用 <variable> 重复扣资源；伤害只扣 attributes.vitality_current。
- 战斗标签示例：<combat state="player_turn">{"actor":"player","action_name":"准确技能名","action_rank":"C","action_type":"忍术","resource_type":"查克拉","damage_to_enemy":数值,"log":"结果"}</combat>；NPC行动使用 <combat state="enemy_turn">{"actor":"enemy","action_name":"准确技能名","action_rank":"C","action_type":"忍术","resource_type":"查克拉","damage_to_player":数值,"log":"结果"}</combat>。`
    },
    {
      id: 'variable_updater_canon_database',
      name: '项目正史与忍术数据库记账规则',
      enabled: true,
      role: 'system',
      content: `【项目正史时间线 DAY/SCN/EV】
- 运行时一次提供当前日全部独立场景。DAY-{HIST|P1|P2|BOR}-* 表示剧情日，SCN-{HIST|P1|P2|BOR}-* 表示一个地点与冲突线程，EV-{HIST|P1|P2|BOR}-* 表示场景内原子节拍；花括号中的时代段以运行时实际 ID 为准，完整日载荷不代表本回合已经演完所有场景。
- 只给正文中真实结算的层级记账：单个节拍用 EV，完整场景用 SCN；只有当天所有独立场景都得到明确结果时才可用 DAY。禁止用 DAY 一次吞掉正文没有发生的并行场景。
- reference_facts 是背景或回顾，永远不能作为当前新事件写入。不同地点、视角与线程也不能因同日载荷而合并记账。
- 变量更新器不会收到未来剧情正文；NEXT_ANCHOR 只含最近未来剧情日的日期与 days_until。不得猜测或补写该日 DAY/SCN/EV、场景结果、人物行动或状态，应用层会拒绝未来ID。
- 当前日期无剧情时禁止凭预训练知识补演基准桥段。NEXT_ANCHOR 只证明日程边界，不证明事件必然发生。
- 当前状态、记忆和项目世界书高于时间线。核对 requirements、blockers 与玩家影响后，只在最终正文已改变对应节点时输出：<event>{"id":"准确的DAY/SCN/EV时代化ID","status":"occurred|altered|skipped|postponed","description":"本分支结果与证据","reschedule_to":"仅延期时填写KYYY-MM-DD"}</event>。时代段只能沿用检索结果中的 HIST、P1、P2 或 BOR，不得自行改写。
- 玩家改变前置时沿用记录给出的 fallback 方向，状态必须 altered、skipped 或 postponed，不得强制回归基准。postponed 必须提供晚于当前日期的合法 reschedule_to；最终裁定ID不得重复记账。
- 项目日期服务游戏因果，不得在 memory 中伪称为漫画明确日期。

【忍术数据库 JT-*】
- JT记录描述术；known_users 仅是资料字段，不证明任何角色当前掌握。施术、学习或写入NPC能力前，必须核对当前技能表、学习来源、日期、血继/瞳术、秘传、契约、身体条件和前置术。
- 命中 JT-* 时，准确术名、类别、等级、属性、resource_type、cost、power、机制与限制以记录为准。禁止按等级重算 cost，禁止用预训练印象改字段。
- 新技能按记录类型写入 skills.jutsu/taijutsu/genjutsu/support.准确术名，完整提供 name/rank/element/resource_type/cost/power/mastery/description；角色已有 mastery 优先保留。
- 数据库未命中但状态已有自创术时服从状态；两者都没有时不得伪造 JT-* ID、cost、power 或机制。
- 忍术/幻术/体术分别使用 chakra/spirit/stamina，对应查克拉/精神力/体力。玩家与NPC同规则；<combat> 报告准确 action_name、action_type、resource_type，点数由本地系统按逐术 cost 结算一次，禁止另用 <variable> 重复扣除。`
    },
    {
      id: 'variable_updater_turn',
      name: '七段证据自检与本回合上下文',
      enabled: true,
      role: 'user',
      content: `[当前状态 JSON]
{{state_json}}

[预处理玩家输入]
{{enriched_input}}

[原始玩家输入]
{{user_input}}

[已确认的最终正文]
{{narrative_response}}{{breakthrough_instruction}}

必须将以下七段自检逐段输出到 <variable_thinking> 中，每段写明核对结论、正文依据和是否需要更新；不得省略编号：
一、来源账本：列出当前时间、地点、上一轮相关行动、世界书相关事实；指出任何来源冲突，并按优先级裁决。
二、事件边界：逐项区分玩家尝试、正文确认结果与未发生内容；检查是否有未来倒灌、玩家越权、预设成功或关系速成。错误内容不得入账。
三、人物关系：列出本轮实际互动及最终正文中新登场的有名NPC，对照既有关系历史，只计算本轮增量；已有战斗卡不重复初始化。首次人物必须写 combatant 分类，战斗型人物必须落账忍阶、查克拉属性和至少一个有依据的忍术，非战斗人员写 false。
四、技能物品：逐个核对技能的学习/创造/练习/升级/遗忘/删除，以及物品的获得、使用、售出、丢弃与装备变化；用准确名称检查库存/技能表。物品最后一件或技能彻底失去必须使用 op="remove"。
五、任务成长与地图：核对任务、历练、突破、声望、位置、探索和战斗状态；无明确因果则不更新，时间推进不得超过正文实际跨度。
六、记忆承接：summary 必须记录玩家本轮具体行动、直接结果、NPC态度、线索、资源/伤势变化、未解决事项，并承接而非抹除此前事实。
七、差异复检：列出准备输出的每条标签及其正文证据；删除重复项、推测项、与高优先级来源冲突项，确认主模型未提前写入同一变量。最后必须另起一行写“输出清单：variable=N, mission=N, relationship=N, memory=N, combat=N, event=N”，数量必须与随后实际顶层标签完全一致；若本段判定应新增、推进、完成或失败任务，清单和正文都必须包含对应 mission。

七段自检结束后关闭 </variable_thinking>，再从第一个实际需要的结构标签开始输出。即使没有变量变化，也必须输出 <memory>。`
    }
  ]
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRole(role) {
  return role === 'assistant' || role === 'user' ? role : 'system';
}

function normalizeDisplayName(value, fallback) {
  return String(value || fallback).replace(/\bprompt\b/gi, '').replace(/\s+/g, ' ').trim() || fallback;
}

function sourceEntries(raw) {
  if (Array.isArray(raw?.entries)) return raw.entries;
  if (Array.isArray(raw?.prompts)) return raw.prompts.map((entry, index) => ({
    id: entry.identifier || entry.id || `imported_${index + 1}`,
    name: entry.name || `条目 ${index + 1}`,
    enabled: entry.enabled !== false,
    role: entry.role || 'system',
    content: entry.content || ''
  }));
  if (Array.isArray(raw?.messages)) return raw.messages.map((entry, index) => ({
    id: entry.id || `imported_${index + 1}`,
    name: entry.name || `消息 ${index + 1}`,
    enabled: entry.enabled !== false,
    role: entry.role || 'system',
    content: entry.content || ''
  }));
  return null;
}

export function normalizeVariableUpdaterPreset(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('预设必须是 JSON 对象');
  const entries = sourceEntries(raw);
  if (!entries) throw new Error('预设缺少可识别的条目数组');
  return {
    name: normalizeDisplayName(raw.name || raw.presetName, '导入的变量更新预设'),
    version: Number(raw.version) || DEFAULT_VARIABLE_UPDATER_PRESET_VERSION,
    entries: entries.map((entry, index) => ({
      id: String(entry?.id || entry?.identifier || `entry_${Date.now()}_${index}`),
      name: normalizeDisplayName(entry?.name, `条目 ${index + 1}`),
      enabled: entry?.enabled !== false && entry?.disabled !== true,
      role: normalizeRole(entry?.role),
      content: String(entry?.content || '')
    }))
  };
}

function isBuiltInEntry(entry) {
  return ['variable_updater_system', 'variable_updater_canon_database', 'variable_updater_turn'].includes(entry?.id);
}

function backupPreset(raw) {
  try {
    const key = `${VARIABLE_UPDATER_PRESET_BACKUP_PREFIX}${Date.now()}`;
    localStorage.setItem(key, raw);
    localStorage.setItem(`${VARIABLE_UPDATER_PRESET_BACKUP_PREFIX}latest`, key);
  } catch (error) {
    console.warn('[VariableUpdaterPreset] 旧预设备份失败:', error.message);
  }
}

export function migrateVariableUpdaterPreset(raw) {
  const normalized = normalizeVariableUpdaterPreset(raw);
  const customEntries = normalized.entries.filter(entry => !isBuiltInEntry(entry));
  return normalizeVariableUpdaterPreset({
    ...clone(DEFAULT_VARIABLE_UPDATER_PRESET),
    name: normalized.name || DEFAULT_VARIABLE_UPDATER_PRESET.name,
    entries: [...clone(DEFAULT_VARIABLE_UPDATER_PRESET.entries), ...customEntries],
    version: DEFAULT_VARIABLE_UPDATER_PRESET_VERSION
  });
}

export function getVariableUpdaterPreset() {
  try {
    const saved = localStorage.getItem(VARIABLE_UPDATER_PRESET_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const normalized = normalizeVariableUpdaterPreset(parsed);
      if (Number(parsed.version) !== DEFAULT_VARIABLE_UPDATER_PRESET_VERSION) {
        backupPreset(saved);
        const migrated = migrateVariableUpdaterPreset(parsed);
        localStorage.setItem(VARIABLE_UPDATER_PRESET_STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return normalized;
    }
  } catch (error) {
    console.warn('[VariableUpdaterPreset] 读取失败，使用默认预设:', error.message);
  }
  return clone(DEFAULT_VARIABLE_UPDATER_PRESET);
}

export function saveVariableUpdaterPreset(preset) {
  const normalized = normalizeVariableUpdaterPreset(preset);
  const enabledContent = normalized.entries
    .filter(entry => entry.enabled !== false)
    .map(entry => entry.content)
    .join('\n');
  if (!enabledContent.includes('{{narrative_response}}')) {
    throw new Error('变量更新预设必须保留 {{narrative_response}}（已确认的最终正文）宏');
  }
  localStorage.setItem(VARIABLE_UPDATER_PRESET_STORAGE_KEY, JSON.stringify(normalized));
  eventBus.emit('variable-updater-preset:edited', clone(normalized));
  return normalized;
}

export function resetVariableUpdaterPreset() {
  const preset = clone(DEFAULT_VARIABLE_UPDATER_PRESET);
  localStorage.removeItem(VARIABLE_UPDATER_PRESET_STORAGE_KEY);
  eventBus.emit('variable-updater-preset:edited', clone(preset));
  return preset;
}

export function resolveVariableUpdaterPreset(preset, context = {}) {
  const values = {
    state_json: JSON.stringify(context.compactState || {}, null, 2),
    enriched_input: String(context.enrichedInput || ''),
    user_input: String(context.userInput || ''),
    narrative_response: String(context.narrativeResponse || ''),
    breakthrough_instruction: String(context.breakthroughInstruction || '')
  };
  return normalizeVariableUpdaterPreset(preset).entries
    .filter(entry => entry.enabled !== false && entry.content.trim())
    .map(entry => {
      let content = entry.content;
      for (const [key, value] of Object.entries(values)) content = content.split(`{{${key}}}`).join(value);
      return { role: normalizeRole(entry.role), content };
    });
}
