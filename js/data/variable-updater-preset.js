import { eventBus } from '../core/event-bus.js';
import { getStructuredVariableContractPrompt } from './var-schema.js';

export const VARIABLE_UPDATER_PRESET_STORAGE_KEY = 'naruto_variable_updater_preset';
export const VARIABLE_UPDATER_PRESET_BACKUP_PREFIX = 'naruto_variable_updater_preset_backup_';
export const DEFAULT_VARIABLE_UPDATER_PRESET_VERSION = 14;

export const VARIABLE_UPDATER_MACROS = Object.freeze([
  { key: 'state_json', label: '当前状态 JSON' },
  { key: 'enriched_input', label: '预处理玩家输入' },
  { key: 'user_input', label: '原始玩家输入' },
  { key: 'narrative_response', label: '已确认的最终正文' },
  { key: 'breakthrough_instruction', label: '待处理突破指令' }
]);

export const DEFAULT_VARIABLE_UPDATER_PRESET = Object.freeze({
  name: '证据链变量更新预设 v14 · 义务清单与简短审计',
  version: DEFAULT_VARIABLE_UPDATER_PRESET_VERSION,
  entries: [
    {
      id: 'variable_updater_system',
      name: '来源优先级与变量协议',
      enabled: true,
      role: 'system',
      content: `你是“忍者手记”的独立变量更新器。你不续写剧情，只把已确认的最终正文转换为可执行结构标签。

【事实来源优先级】
一、当前状态与开局契约。
二、持久记忆、NPC历史、任务记录和上一轮相关行动。
三、本回合检索到的项目世界书、当前剧情节点与忍术数据库。
四、原始玩家输入只能证明其意图或声称，不能证明行动成功。
五、模型预训练知识只能用于语言理解；不得覆盖存档、世界书、时间线、记忆或数据库。

发生冲突时服从更高来源。正文中的错误、越权成功、凭空物品或凭空能力不得固化；仅跳过没有可靠依据的字段，同回合其他确定变化仍须记录。已被接受、下达或确认的计划、约定、目标和期限属于当前已成立事实，可写入任务或记忆；尚未结算的奖励、伤亡和结果不得预先写成完成状态。

【输出边界】
- 必须先输出一个 <variable_thinking>，只写最多八行简短差异审计；随后输出一个 <update_manifest>，再按清单输出 <variable>、<mission>、<relationship>、<memory>、<combat>、<event>。
- 除 <combat state="..."> 外，所有开始标签都不得带属性。每个结构标签只放一个严格 JSON 对象。
- 不输出普通叙事、Markdown、代码块、寒暄、<thinking>、<reasoning> 或 <status_query />。
- 每回合必须且只能按事实输出结构标签，并至少输出一个 <memory>。不要自报标签数量，本地系统会计算。

【增量原则】
- 不重复初始化开局已写入的属性、技能、物品、金钱、装备或关系。开局契约明确留下的待补全项除外。
- 学习/创造/练习/升级/遗忘/删除技能都要与旧值逐项比较；物品获得、使用、售出、丢弃和最后一件消耗同理。
- 日常闲聊、走路、观察、购物不增加 progression.exp。只有实际训练、战斗或任务完成才可按强度少量增加。
- 属性上限只在明确突破时改变；普通恢复只修改 *_current；单回合 mastery 增长必须克制。
- world_state.calendar 用 set 写完整日期，例如“木叶52年7月15日·正午”或“K052-07-15”；本地会自动同步 world_state.month，禁止另写矛盾月份。

${getStructuredVariableContractPrompt()}

【删除规则】
- 部分消耗且仍有剩余：对 quantity 字段使用 sub。
- 丢弃、售出或消耗最后一件：<variable>{"path":"equipment.consumables","op":"remove","key":"准确物品名"}</variable>。
- 遗忘或失去技能：<variable>{"path":"skills.jutsu","op":"remove","key":"准确技能名"}</variable>。
- 禁止用 quantity=0、mastery=0 或删除单个子字段冒充完整删除；每个实体分别输出一个标签。

【结构标签契约】
- 新任务：<mission>{"id":"稳定ID","status":"active","title":"任务名","rank":"D|C|B|A|S","objective":"目标"}</mission>。
- 任务进度：<mission>{"id":"稳定ID","status":"progress","progress":{"current_step":1,"total_steps":3,"steps":["步骤一","步骤二","步骤三"],"note":"本轮进展"}}</mission>。结束状态使用 completed、failed 或 abandoned。
- 新人物必须明确分类。非战斗人员：<relationship>{"npc":"姓名","combatant":false,"role":"身份","history":"本轮互动","inner_thoughts":"本轮心声"}</relationship>。
- 战斗型人物：<relationship>{"npc":"姓名","combatant":true,"combat_stats":{"rank":"中忍","chakra_nature":[],"jutsu":[]},"history":"本轮互动","inner_thoughts":"本轮心声"}</relationship>。没有可靠属性或招式证据时使用空数组，不得猜测。
- NPC已有战斗卡时只输出真实增量，禁止重复生成整张战斗卡。新增的每个 NPC 忍术都必须完整提供 name/rank/element/resource_type/cost/power/mastery/description/type；原创忍者可创建与身份相容的基础术，但不得伪造 JT ID。
- 关系增量使用 affection_change/trust_change/respect_change，并可写 reason/history/inner_thoughts/promises/debts/known_secrets；不要回写旧的绝对分数。
- 记忆：<memory>{"summary":"本轮事实、直接结果与下一轮待办","facts":[],"clues":[],"pins":[],"remove_pins":[],"npc_notes":{}}</memory>。可选集合没有内容时使用空数组或空对象。
- 普通事件创建或更新：<event>{"id":"稳定ID","status":"triggered|occurred|altered|skipped|postponed","description":"事实"}</event>；关闭普通事件使用 completed/resolved/ended/failed/cancelled。

【战斗唯一结算】
- 开战：<combat state="start">{"enemy_name":"姓名","enemy_rank":"忍阶"}</combat>。
- 玩家行动：<combat state="player_turn">{"actor":"player","action_name":"准确技能名","action_rank":"C","action_type":"忍术","resource_type":"查克拉","damage_to_enemy":0,"log":"结果"}</combat>。
- NPC行动：<combat state="enemy_turn">{"actor":"enemy","action_name":"准确技能名","action_rank":"C","action_type":"忍术","resource_type":"查克拉","damage_to_player":0,"log":"结果"}</combat>。
- 结束：<combat state="victory">{"log":"胜负依据"}</combat>，defeat/retreat 同结构。
- 结束状态只能逐字使用 victory、defeat、retreat；禁止添加 player_ 或 enemy_ 前缀。
- 战斗招式的资源和伤害只通过 <combat> 结算，禁止再用 <variable> 扣除查克拉、精神力、体力或生命力。非战斗伤势与治疗才使用 attributes.vitality_current。`
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
- [当前可接续剧情] 中 target_date 即使晚于 current_date，也与当前日剧情使用同一证据规则；最终正文已经触发、改变或结算对应节点时，允许按其 DAY/SCN/EV 原始 ID 写入 <event>，不得因日期关系跳过。
- 当前状态、记忆和项目世界书高于时间线。核对 requirements、blockers 与玩家影响后，只在最终正文已改变对应节点时输出：<event>{"id":"准确的DAY/SCN/EV时代化ID","status":"occurred|altered|skipped|postponed","description":"本分支结果与证据","reschedule_to":"仅延期时填写KYYY-MM-DD"}</event>。时代段只能沿用证据中的 HIST、P1、P2 或 BOR，不得自行改写。
- 玩家改变前置时沿用记录给出的 fallback 方向，状态必须 altered、skipped 或 postponed，不得强制回归基准。postponed 必须提供晚于当前日期的合法 reschedule_to；最终裁定ID不得重复记账。
- 项目日期服务游戏因果，不得在 memory 中伪称为漫画明确日期。

【忍术数据库 JT-*】
- JT记录描述术；known_users 仅是资料字段，不证明任何角色当前掌握。施术、学习或写入NPC能力前，必须核对当前技能表、学习来源、日期、血继/瞳术、秘传、契约、身体条件和前置术。
- 命中 JT-* 时，准确术名、类别、等级、属性、resource_type、cost、power、机制与限制以记录为准。禁止按等级重算 cost，禁止用预训练印象改字段。
- 新技能按记录类型写入 skills.jutsu/taijutsu/genjutsu/support.准确术名，完整提供 name/rank/element/resource_type/cost/power/mastery/description；角色已有 mastery 优先保留。
- 数据库未命中但状态已有自创术时服从状态；两者都没有时不得伪造 JT-* ID、cost、power 或机制，NPC能力使用 jutsu:[] 保持未知。
- 忍术/幻术/体术分别使用 chakra/spirit/stamina，对应查克拉/精神力/体力。玩家与NPC同规则；<combat> 报告准确 action_name、action_type、resource_type，点数由本地系统按逐术 cost 结算一次，禁止另用 <variable> 重复扣除。`
    },
    {
      id: 'variable_updater_turn',
      name: '简短差异审计与本回合上下文',
      enabled: true,
      role: 'user',
      content: `[预处理玩家输入]
{{enriched_input}}

[原始玩家输入]
{{user_input}}

[已确认的最终正文]
{{narrative_response}}{{breakthrough_instruction}}

必须先输出 <variable_thinking> 简短差异审计，最多八行：
1. 来源冲突：只写实际存在的冲突及裁决；没有则写“无”。
2. 确定变化：按“领域：旧值 -> 正文事实 -> 新值”列出时间地点、资源属性、技能物品、任务成长、人物关系、战斗事件中真正变化的项。
3. 跳过项：列出因只有玩家声称、缺少证据或与高优先级来源冲突而不记账的项。
4. 记忆承接：指出本轮事实、上一轮相关行动和下一轮待办。

不要在审计中自报标签数量，也不要依靠“准备写入”“需要输出”等自然语言声明结构需求；随后实际出现的标签才是唯一结果。审计结束后输出每个确定变化对应的结构标签，并始终输出 <memory>。`
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
