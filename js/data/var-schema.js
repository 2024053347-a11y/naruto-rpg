export const VAR_SCHEMA = {

  '玩家·姓名':          { type: 'string',  default: '',        desc: '角色名' },
  '玩家·年龄':          { type: 'number',  default: 12,        desc: '身体年龄' },
  '玩家·灵魂年龄':       { type: 'number',  default: 12,        desc: '灵魂年龄' },
  '玩家·性别':          { type: 'string',  default: '',        desc: '性别' },
  '玩家·忍阶':          { type: 'string',  default: '忍校学生', desc: '当前忍阶(下忍/中忍/上忍等)' },
  '玩家·正式忍阶':       { type: 'string',  default: '忍校学生', desc: '官方正式忍阶' },
  '玩家·战力等级':       { type: 'string',  default: 'E级',     desc: '六项属性与忍术/体术/幻术造诣的综合战力评估' },
  '玩家·所属村':        { type: 'string',  default: '木叶隐村', desc: '所属忍村' },
  '玩家·出身':          { type: 'string',  default: '',        desc: '出身背景' },
  '玩家·查克拉属性':     { type: 'string',  default: '',        desc: '查克拉属性(，分隔)' },
  '玩家·难度':          { type: 'string',  default: '下忍',    desc: '游戏难度' },
  '玩家·个性':          { type: 'string',  default: '',        desc: '个性标签(，分隔)' },
  '玩家·公开身份':       { type: 'string',  default: '忍校学生', desc: '对外公开身份' },
  '玩家·当前目标':       { type: 'string',  default: '',        desc: '当前任务/目标' },
  '玩家·声望标签':       { type: 'string',  default: '',        desc: '声望标签(，分隔)' },
  '玩家·标志':          { type: 'string',  default: '',        desc: '状态标志(，分隔)' },
  '玩家·存活':          { type: 'string',  default: '是',      desc: '存活状态(是/否)', allowed: ['是', '否'] },
  '玩家·死因':          { type: 'string',  default: '',        desc: '死亡原因' },

   '属性·查克拉':        { type: 'number',  default: 10,  min: 0, max: 9999, desc: '查克拉上限(能量资源，可频繁消耗)' },
   '属性·当前查克拉':     { type: 'number',  default: 10,  min: 0, max: 9999, desc: '当前查克拉' },
   '属性·精神力':        { type: 'number',  default: 10,  min: 0, max: 9999, desc: '精神力上限(能量资源，可消耗)' },
   '属性·当前精神力':     { type: 'number',  default: 10,  min: 0, max: 9999, desc: '当前精神力' },
   '属性·生命力':        { type: 'number',  default: 100, min: 0, max: 9999, desc: '生命力上限(HP)，只因伤害、治疗和生命成长改变' },
   '属性·当前生命力':     { type: 'number',  default: 100, min: 0, max: 9999, desc: '当前生命力，归零则角色阵亡' },
   '属性·体力':          { type: 'number',  default: 80,  min: 0, max: 9999, desc: '体力上限，体术与高强度身体行动的资源' },
   '属性·当前体力':       { type: 'number',  default: 80,  min: 0, max: 9999, desc: '当前体力，体术按各招式数据库cost消耗' },
   '属性·速度':          { type: 'number',  default: 5,   min: 0, max: 9999, desc: '速度(影响先手/闪避)' },
   '属性·幸运':          { type: 'number',  default: 10,  min: 0, max: 9999, desc: '幸运(影响暴击/掉落)' },

  '进度·经验':          { type: 'number',  default: 0,    min: 0,           desc: '经验值' },
  '进度·下一级经验':     { type: 'number',  default: 100,  min: 1,           desc: '升级所需经验' },
  '进度·忍术熟练度':     { type: 'number',  default: 0,    min: 0, max: 100, desc: '忍术总熟练度' },
  '进度·体术熟练度':     { type: 'number',  default: 0,    min: 0, max: 100, desc: '体术总熟练度' },
  '进度·幻术熟练度':     { type: 'number',  default: 0,    min: 0, max: 100, desc: '幻术总熟练度' },
  '进度·防御熟练度':     { type: 'number',  default: 0,    min: 0, max: 100, desc: '防御总熟练度' },
  '进度·已完成任务':     { type: 'number',  default: 0,    min: 0,           desc: '已完成任务数' },
   '进度·突破待处理':     { type: 'number',  default: 0,    min: 0,           desc: '待突破次数(等级突破)' },
  '进度·金钱':          { type: 'number',  default: 500,  min: 0, desc: '金钱(両)' },
  '进度·称号':          { type: 'string',  default: '',        desc: '称号(，分隔)' },
  '进度·成就':          { type: 'string',  default: '',        desc: '成就(，分隔)' },

  '世界·地点':          { type: 'string',  default: '木叶隐村',                desc: '当前地点' },
  '世界·时间':          { type: 'string',  default: '木叶48年1月1日·清晨',      desc: '游戏时间' },
  '世界·年代':          { type: 'string',  default: '木叶48年',                desc: '当前年代' },
  '世界·月份':          { type: 'number',  default: 1,    min: 1, max: 12,    desc: '当前月份' },
  '世界·天气':          { type: 'string',  default: '晴',                      desc: '当前天气' },
  '世界·已探索区域':     { type: 'string',  default: '火之国,木叶隐村',        desc: '已探索区域(，分隔)' },
  '世界·活跃事件':       { type: 'string',  default: '',                       desc: '活跃事件(\\n分隔)' },

  '系统·回合数':        { type: 'number',  default: 0,    min: 0,             desc: '回合数' },

};

export const VAR_PATTERNS = [
  // 技能: 名称可含 · (如 火遁·豪火球)，字段必须是已知后缀
  { pattern: /^技能·(?:忍术|体术|幻术|支援)·(.+)·(名称|等级|属性|消耗|消耗资源|威力|熟练度|描述|说明|类型|数据库ID|来源)$/, type: 'mixed', desc: '技能数据(数值字段自动转number)', _nameIdx: 1, _fieldIdx: 2 },
  { pattern: /^技能·血继限界$/,                                                             type: 'mixed', desc: '旧版血继限界整值' },
  { pattern: /^技能·血继限界·(.+)·(.+)$/,                                                    type: 'mixed', desc: '血继限界子字段', _nameIdx: 1, _fieldIdx: 2 },
  { pattern: /^技能·天赋·(.+)·(名称|等级|描述|说明|熟练度)$/,                                      type: 'mixed', desc: '天赋数据', _nameIdx: 1, _fieldIdx: 2 },
  { pattern: /^物品·(?:道具|消耗品|武器|防具|装备|关键|忍具|素材|食物|卷轴|其他)·(.+)·(数量|品质|描述|说明)$/, type: 'mixed', desc: '物品数据(数量转number)', _nameIdx: 1, _fieldIdx: 2 },
  { pattern: /^(?:装备|物品)·(?:道具|消耗品|武器|防具|装备|关键|忍具|素材|食物|卷轴|其他)·(.+)$/,       type: 'mixed', desc: '物品/装备数据(兼容AI别名)', _nameIdx: 1 },
  { pattern: /^物品·已装备·(?:武器|防具|饰品[12])$/,                                           type: 'string', desc: '已装备栏' },
  { pattern: /^进度·声望·(.+)$/,                                                              type: 'number', desc: '村落声望值', _nameIdx: 1 },
  { pattern: /^系统·(?:当前节点|当前分支)$/,                                                   type: 'string', desc: '系统元数据' },
  { pattern: /^状态·(.+)$/,                                                                   type: 'mixed',  desc: 'AI别名状态变量', _nameIdx: 1 },
  { pattern: /^角色·(.+)$/,                                                                   type: 'mixed',  desc: 'AI别名角色变量', _nameIdx: 1 },
];

// ── 共享常量：单一来源，其余文件引用此处 ──

export const ALLOWED_TAGS = ['var', 'variable', 'var_thinking', 'variable_thinking', 'combat', 'mission', 'relationship', 'memory', 'event'];

export const VAR_OPERATIONS = {
  set: '覆盖整个节点',
  add: '数值增加',
  sub: '数值扣除',
  assign: '修改对象中的单个key（只改指定字段不覆盖其他）',
  push: '追加到数组',
  remove: '删除对象键或数组项（需加"key"字段指定键名）'
};

export const GROWTH_RULES = {
  expPerTurn: [10, 30],
  masteryCapPerTurn: 8,
  attrCapPerTurn: 6,
  attrCapBreakthrough: 15,
  restRecovery: [5, 15],
  medicalRecovery: [15, 40],
  vitalityWarning: 30,
  vitalityDanger: 10,
};

export const NPC_TEMPLATE_FIELDS = [
  'npc', 'name', '姓名', 'affection', 'trust', 'respect',
  '查克拉', '查克拉上限', '生命力', '生命力上限',
  '体力', '体力上限', '速度', '精神力', '精神力上限',
  '忍术造诣', '体术造诣', '幻术造诣',
  '忍阶', '查克拉属性', '忍术',
  'affection_change', 'trust_change', 'respect_change',
  'affection_delta', 'trust_delta', 'respect_delta',
  'inner_thoughts', 'history'
];

const RELATIONSHIP_DELTA_ALIASES = {
  affection_change: 'affection_delta',
  trust_change: 'trust_delta',
  respect_change: 'respect_delta'
};
const RELATIONSHIP_SCORE_FIELDS = ['affection', 'trust', 'respect'];

export function finiteRelationshipNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Normalize relationship aliases commonly emitted by AI models. Invalid identities
 * reject the instruction; invalid optional deltas are omitted instead of poisoning state.
 */
export function normalizeRelationshipInstruction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const npc = [value.npc, value.name, value['姓名']]
    .find(candidate => typeof candidate === 'string' && candidate.trim());
  if (!npc) return null;

  const normalized = { ...value, npc: npc.trim() };
  delete normalized.name;
  delete normalized['姓名'];

  for (const field of RELATIONSHIP_SCORE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const score = finiteRelationshipNumber(value[field]);
    if (score === undefined) delete normalized[field];
    else normalized[field] = score;
  }

  for (const [canonical, alias] of Object.entries(RELATIONSHIP_DELTA_ALIASES)) {
    const delta = finiteRelationshipNumber(value[canonical] ?? value[alias]);
    delete normalized[alias];
    if (delta === undefined) delete normalized[canonical];
    else normalized[canonical] = delta;
  }

  return normalized;
}

// AI模型经常使用非标准变量名，此表将它们映射到正确的v4.0扁平键名
export const VAR_ALIASES = {
  '状态·历练值':       '进度·经验',
  '状态·经验值':       '进度·经验',
  '状态·经验':         '进度·经验',
  '状态·生命力':       '属性·当前生命力',
  '状态·体力':         '属性·当前体力',
  '状态·查克拉':       '属性·当前查克拉',
  '状态·精神力':       '属性·当前精神力',
  '状态·金钱':         '进度·金钱',
  '状态·位置':         '世界·地点',
  '状态·地点':         '世界·地点',
  '状态·时间':         '世界·时间',
  '状态·天气':         '世界·天气',
  '角色·姓名':         '玩家·姓名',
  '角色·名字':         '玩家·姓名',
  '角色·年龄':         '玩家·年龄',
  '角色·性别':         '玩家·性别',
  '角色·背景':         '玩家·出身',
  '角色·出身':         '玩家·出身',
  '角色·忍阶':         '玩家·忍阶',
  '角色·目标':         '玩家·当前目标',
  '角色·当前目标':     '玩家·当前目标',
  '经验·历练值':       '进度·经验',
  '经验·经验值':       '进度·经验',

  // 兼容AI直接输出的无前缀变量名
  '查克拉':             '属性·当前查克拉',
  '查克拉上限':         '属性·查克拉',
  '生命力':             '属性·当前生命力',
  '生命力上限':         '属性·生命力',
  '体力':               '属性·当前体力',
  '体力上限':           '属性·体力',
  '速度':               '属性·速度',
  '精神力':             '属性·当前精神力',
  '精神力上限':         '属性·精神力',
  '忍术造诣':           '进度·忍术熟练度',
  '体术造诣':           '进度·体术熟练度',
  '幻术造诣':           '进度·幻术熟练度',
  '忍阶':               '玩家·忍阶',
  '声望标签':           '玩家·声望标签',
  '金钱':               '进度·金钱',
};

export function getDefaults() {
  const defaults = {};
  for (const [key, schema] of Object.entries(VAR_SCHEMA)) {
    defaults[key] = schema.default;
  }
  return defaults;
}

export function resolveAlias(key) {
  if (typeof key === 'string') {
    // Dynamic suffix mappings
    if (key.endsWith('·说明')) {
      return key.slice(0, -2) + '描述';
    }
    // Map non-standard item categories to standard ones
    // 物品·装备·X → 物品·武器·X, 物品·关键·X → 物品·道具·X, 物品·忍具·X → 物品·道具·X
    const itemCatMap = { '装备': '武器', '关键': '道具', '忍具': '道具', '素材': '道具', '食物': '消耗品', '卷轴': '道具', '其他': '道具' };
    const itemMatch = key.match(/^物品·(装备|关键|忍具|素材|食物|卷轴|其他)·(.+)$/);
    if (itemMatch) {
      const mapped = itemCatMap[itemMatch[1]] || '道具';
      return '物品·' + mapped + '·' + itemMatch[2];
    }
  }
  return VAR_ALIASES[key] || key;
}

// 已知的后缀字段名——若名称末段是这些词，说明正则 .+ 多吃了段
const KNOWN_FIELDS = ['名称', '等级', '属性', '消耗', '威力', '熟练度', '描述', '说明', '数量', '品质'];

export function isKnownKey(key) {
  const resolved = resolveAlias(key);
  if (VAR_SCHEMA[resolved]) return true;
  for (const p of VAR_PATTERNS) {
    const m = resolved.match(p.pattern);
    if (!m) continue;
    // 若名称捕获组中最后一个 ·段 是已知字段后缀 → 正则多吃了，拒绝
    if (p._nameIdx && p._fieldIdx) {
      const namePart = m[p._nameIdx];
      const lastSeg = namePart.split('·').pop();
      if (KNOWN_FIELDS.includes(lastSeg)) return false;
    }
    return true;
  }
  return false;
}

export const STRUCTURED_SCALAR_PATH_MAP = Object.freeze({
  'player.name': '玩家·姓名',
  'player.age': '玩家·年龄',
  'player.soul_age': '玩家·灵魂年龄',
  'player.gender': '玩家·性别',
  'player.rank': '玩家·忍阶',
  'player.official_rank': '玩家·正式忍阶',
  'player.background': '玩家·出身',
  'player.chakra_nature': '玩家·查克拉属性',
  'player.difficulty': '玩家·难度',
  'player.personality': '玩家·个性',
  'player.public_identity': '玩家·公开身份',
  'player.current_goal': '玩家·当前目标',
  'player.reputation_tags': '玩家·声望标签',
  'player.flags': '玩家·标志',
  'player.alive': '玩家·存活',
  'player.death_cause': '玩家·死因',
  'attributes.chakra': '属性·查克拉',
  'attributes.chakra_current': '属性·当前查克拉',
  'attributes.spirit': '属性·精神力',
  'attributes.spirit_current': '属性·当前精神力',
  'attributes.vitality': '属性·生命力',
  'attributes.vitality_current': '属性·当前生命力',
  'attributes.stamina': '属性·体力',
  'attributes.stamina_current': '属性·当前体力',
  'attributes.willpower': '属性·体力',
  'attributes.willpower_current': '属性·当前体力',
  'attributes.speed': '属性·速度',
  'attributes.luck': '属性·幸运',
  'progression.exp': '进度·经验',
  'progression.exp_to_next': '进度·下一级经验',
  'progression.jutsu_mastery': '进度·忍术熟练度',
  'progression.taijutsu_mastery': '进度·体术熟练度',
  'progression.genjutsu_mastery': '进度·幻术熟练度',
  'progression.defense_mastery': '进度·防御熟练度',
  'progression.missions_done': '进度·已完成任务',
  'progression.pending_breakthrough': '进度·突破待处理',
  'progression.ryo': '进度·金钱',
  'progression.titles': '进度·称号',
  'progression.achievements': '进度·成就',
  'equipment.ryo': '进度·金钱',
  'world_state.current_location': '世界·地点',
  'world_state.calendar': '世界·时间',
  'world_state.timeline': '世界·年代',
  'world_state.month': '世界·月份',
  'world_state.weather': '世界·天气',
  'world_state.explored_regions': '世界·已探索区域',
  'world_state.active_events': '世界·活跃事件'
});
const STRUCTURED_SCALAR_PATHS = new Set(Object.keys(STRUCTURED_SCALAR_PATH_MAP));
const STRUCTURED_LEGACY_SCALAR_PATHS = new Set([
  'attributes.willpower',
  'attributes.willpower_current',
  'progression.ryo',
  'world_state.explored_regions'
]);
const STRUCTURED_OPS = new Set(['set', 'add', 'sub', 'assign', 'push', 'remove']);
const STRUCTURED_SKILL_FIELDS = new Set([
  'name', 'rank', 'element', 'cost', 'resource', 'resource_type', 'power', 'mastery',
  'description', 'type', 'technique_id', 'source'
]);
const STRUCTURED_ITEM_FIELDS = new Set([
  'quantity', 'quality', 'description', 'name', 'type', 'power', 'cost', 'element'
]);
const STRUCTURED_SKILL_CATEGORIES = 'jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai';
const STRUCTURED_ITEM_CATEGORIES = 'weapons|armor|tools|consumables';
const STRUCTURED_FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function structuredPathIsSafe(path) {
  return typeof path === 'string'
    && path.length > 0
    && path.length <= 240
    && path.split('.').every(segment => segment && !STRUCTURED_FORBIDDEN_SEGMENTS.has(segment));
}

function hasUpdateValue(update) {
  return Object.prototype.hasOwnProperty.call(update, 'value') && update.value !== undefined;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function recordValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function normalizeStructuredVariableUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;
  const normalized = { ...update };
  if (typeof normalized.path === 'string') normalized.path = normalized.path.trim();
  if (typeof normalized.op === 'string') normalized.op = normalized.op.trim().toLowerCase();
  if (typeof normalized.key === 'string') normalized.key = normalized.key.trim();
  return normalized;
}

export function calendarMonthFromValue(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const canonical = text.match(/^K\d{3,4}-(\d{2})-\d{2}(?:[T·\s].*)?$/i);
  const localized = text.match(/^木叶\s*\d+\s*年\s*(\d{1,2})\s*月\s*\d{1,2}\s*日(?:[·\s].*)?$/);
  const month = Number(canonical?.[1] ?? localized?.[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function validateNumericValue(path, op, value, { min = null, max = null } = {}) {
  if (!finiteNumber(value)) return { valid: false, reason: `数值路径 ${path} 的 value 必须是有限数字` };
  if (['add', 'sub'].includes(op) && value < 0) {
    return { valid: false, reason: `数值路径 ${path} 的 ${op} value 不能为负数` };
  }
  if (op === 'set' && min != null && value < min) return { valid: false, reason: `路径 ${path} 最小值为 ${min}` };
  if (op === 'set' && max != null && value > max) return { valid: false, reason: `路径 ${path} 最大值为 ${max}` };
  return { valid: true };
}

function validateScalarUpdate(path, op, value) {
  const flatKey = STRUCTURED_SCALAR_PATH_MAP[path];
  const schema = VAR_SCHEMA[flatKey];
  if (!schema) return { valid: false, reason: `标量路径 ${path} 缺少状态映射` };
  if (schema.type === 'number') {
    if (!['set', 'add', 'sub'].includes(op)) return { valid: false, reason: `数值路径 ${path} 只支持 set/add/sub` };
    const numeric = validateNumericValue(path, op, value, schema);
    if (!numeric.valid) return numeric;
  } else {
    if (op !== 'set') return { valid: false, reason: `文本路径 ${path} 只支持 set` };
    if (typeof value !== 'string') return { valid: false, reason: `文本路径 ${path} 的 value 必须是字符串` };
  }
  const validation = validate(flatKey, value);
  return validation.valid ? { valid: true, kind: 'scalar' } : { valid: false, reason: validation.reason };
}

const REQUIRED_ABILITY_FIELDS = ['name', 'rank', 'element', 'resource_type', 'cost', 'power', 'mastery', 'description'];
const REQUIRED_TALENT_FIELDS = ['name', 'rank', 'mastery', 'description'];
const REQUIRED_ITEM_FIELDS = ['quantity', 'quality', 'description'];
const NUMERIC_SKILL_FIELDS = new Set(['cost', 'power', 'mastery']);
const NUMERIC_ITEM_FIELDS = new Set(['quantity', 'power', 'cost']);

function missingObjectFields(value, fields) {
  return fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field)
    || value[field] === undefined
    || (typeof value[field] === 'string' && !value[field].trim()));
}

function validateSkillField(path, field, op, value) {
  if (NUMERIC_SKILL_FIELDS.has(field)) {
    if (!['set', 'add', 'sub', 'assign'].includes(op)) return { valid: false, reason: `技能数值字段 ${field} 不支持 ${op}` };
    const bounds = field === 'mastery' ? { min: 0, max: 100 } : { min: 0 };
    return validateNumericValue(path, op === 'assign' ? 'set' : op, value, bounds);
  }
  if (!['set', 'assign'].includes(op)) return { valid: false, reason: `技能文本字段 ${field} 只支持 set/assign` };
  return nonEmptyString(value)
    ? { valid: true }
    : { valid: false, reason: `技能字段 ${field} 的 value 必须是非空字符串` };
}

function validateItemField(path, field, op, value) {
  if (NUMERIC_ITEM_FIELDS.has(field)) {
    if (!['set', 'add', 'sub'].includes(op)) return { valid: false, reason: `物品数值字段 ${field} 只支持 set/add/sub` };
    return validateNumericValue(path, op, value, { min: 0 });
  }
  if (op !== 'set') return { valid: false, reason: `物品文本字段 ${field} 只支持 set` };
  return nonEmptyString(value)
    ? { valid: true }
    : { valid: false, reason: `物品字段 ${field} 的 value 必须是非空字符串` };
}

/**
 * Shared allow-list for AI-authored structured variable writes. Keeping this at the schema layer
 * prevents the validator, parser and state manager from accepting different path protocols.
 */
export function validateStructuredVariableUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return { valid: false, reason: '变量更新必须是JSON对象' };
  }

  update = normalizeStructuredVariableUpdate(update);

  if (update.key && ['=', '+', '-'].includes(update.op)) {
    if (!isKnownKey(update.key)) return { valid: false, reason: `未知平铺变量: ${update.key}` };
    if (!hasUpdateValue(update)) return { valid: false, reason: `变量 ${update.key} 缺少 value` };
    if (update.op === '+' || update.op === '-') {
      if (!isNumeric(update.key)) {
        return { valid: false, reason: `文本平铺变量 ${update.key} 不支持 ${update.op}` };
      }
      const delta = Number(update.value);
      if (!Number.isFinite(delta) || delta < 0) {
        return { valid: false, reason: `数值平铺变量 ${update.key} 的增减值必须是非负有限数字` };
      }
      return { valid: true, kind: 'flat' };
    }
    const coerced = coerceValue(update.key, update.value);
    if (coerced === undefined || (isNumeric(update.key) && !Number.isFinite(coerced))) {
      return { valid: false, reason: `平铺变量 ${update.key} 的 value 类型无效` };
    }
    const validation = validate(update.key, coerced);
    return validation.valid ? { valid: true, kind: 'flat' } : { valid: false, reason: validation.reason };
  }

  const path = typeof update.path === 'string' ? update.path : '';
  const op = String(update.op || '');
  if (!structuredPathIsSafe(path)) return { valid: false, reason: `无效或不安全的变量路径: ${path || '(空)'}` };
  if (!STRUCTURED_OPS.has(op)) return { valid: false, reason: `路径 ${path} 使用了不支持的操作: ${op || '(空)'}` };
  if (op !== 'remove' && !hasUpdateValue(update)) return { valid: false, reason: `路径 ${path} 的 ${op} 操作缺少 value` };
  if (op === 'assign' && !String(update.key || '').trim()) return { valid: false, reason: `路径 ${path} 的 assign 操作缺少 key` };

  if (STRUCTURED_SCALAR_PATHS.has(path)) {
    if (path === 'world_state.calendar' && op === 'set' && calendarMonthFromValue(update.value) == null) {
      return { valid: false, reason: 'world_state.calendar 必须使用完整日期，如“木叶52年7月15日·正午”或“K052-07-15”' };
    }
    return validateScalarUpdate(path, op, update.value);
  }

  if (path === 'world_state.map.known_locations') {
    if (!['assign', 'remove'].includes(op) || !nonEmptyString(update.key)) {
      return { valid: false, reason: `${path} 只支持带非空 key 的 assign/remove` };
    }
    if (op === 'assign') {
      const location = recordValue(update.value);
      if (!location || !finiteNumber(location.x) || !finiteNumber(location.y)
        || !nonEmptyString(location.desc) || !nonEmptyString(location.tier)) {
        return { valid: false, reason: `${path} assign 的 value 必须包含数字 x/y、非空 desc 和 tier` };
      }
    }
    return { valid: true, kind: 'map' };
  }
  if (path === 'world_state.map.explored_regions') {
    if (op === 'push' && nonEmptyString(update.value)) return { valid: true, kind: 'map' };
    if (op === 'set' && Array.isArray(update.value) && update.value.every(nonEmptyString)) return { valid: true, kind: 'map' };
    return { valid: false, reason: `${path} 只支持 push 非空字符串或 set 字符串数组` };
  }
  if (path === 'progression.reputation') {
    return op === 'remove' && String(update.key || '').trim()
      ? { valid: true, kind: 'reputation' }
      : { valid: false, reason: `${path} 只支持带 key 的 remove` };
  }
  if (/^progression\.reputation\.[^.]+$/.test(path)) {
    if (!['set', 'add', 'sub'].includes(op)) return { valid: false, reason: `声望路径 ${path} 不支持 ${op}` };
    const numeric = validateNumericValue(path, op, update.value);
    return numeric.valid ? { valid: true, kind: 'reputation' } : numeric;
  }
  if (/^equipment\.equipped\.(weapon|armor|accessory1|accessory2)$/.test(path)) {
    if (op === 'remove') return { valid: true, kind: 'equipped' };
    return op === 'set' && nonEmptyString(update.value)
      ? { valid: true, kind: 'equipped' }
      : { valid: false, reason: `装备槽路径 ${path} 只支持 set 非空字符串或 remove` };
  }

  const skillCollection = path.match(new RegExp(`^skills\.(${STRUCTURED_SKILL_CATEGORIES})$`));
  if (skillCollection) {
    if (op === 'remove' && String(update.key || '').trim()) return { valid: true, kind: 'skill-collection' };
    if (skillCollection[1] === 'kekkei_genkai' && op === 'set') return { valid: true, kind: 'skill-collection' };
    return { valid: false, reason: `技能集合 ${path} 只支持带 key 的 remove` };
  }
  const skill = path.match(new RegExp(`^skills\.(${STRUCTURED_SKILL_CATEGORIES})\.([^.]+)(?:\.([^.]+))?$`));
  if (skill) {
    const category = skill[1];
    const field = skill[3];
    if (field && !STRUCTURED_SKILL_FIELDS.has(field)) return { valid: false, reason: `技能字段不受支持: ${field}` };
    if (op === 'assign' && field) return { valid: false, reason: '技能 assign 应指向技能对象并用 key 指定字段' };
    if (op === 'remove' && field) return { valid: false, reason: '删除技能必须删除完整技能对象' };
    if (op === 'push') return { valid: false, reason: '技能路径不支持 push' };
    if (field) {
      const fieldValidation = validateSkillField(path, field, op, update.value);
      return fieldValidation.valid ? { valid: true, kind: 'skill' } : fieldValidation;
    }
    if (op === 'remove') return { valid: true, kind: 'skill' };
    if (op === 'assign') {
      const key = String(update.key || '');
      if (!STRUCTURED_SKILL_FIELDS.has(key)) return { valid: false, reason: `技能字段不受支持: ${key || '(空)'}` };
      const fieldValidation = validateSkillField(path, key, op, update.value);
      return fieldValidation.valid ? { valid: true, kind: 'skill' } : fieldValidation;
    }
    if (op !== 'set') return { valid: false, reason: `技能对象 ${path} 只支持 set/assign/remove` };
    const value = recordValue(update.value);
    if (!value) return { valid: false, reason: `技能对象 ${path} 的 set value 必须是对象` };
    const required = ['talents', 'kekkei_genkai'].includes(category) ? REQUIRED_TALENT_FIELDS : REQUIRED_ABILITY_FIELDS;
    const missing = missingObjectFields(value, required);
    if (missing.length) return { valid: false, reason: `新技能 ${path} 缺少完整字段: ${missing.join(', ')}` };
    for (const fieldName of required) {
      const fieldValidation = validateSkillField(path, fieldName, 'set', value[fieldName]);
      if (!fieldValidation.valid) return fieldValidation;
    }
    return { valid: true, kind: 'skill' };
  }

  const itemCollection = path.match(new RegExp(`^equipment\.(${STRUCTURED_ITEM_CATEGORIES})$`));
  if (itemCollection) {
    return op === 'remove' && String(update.key || '').trim()
      ? { valid: true, kind: 'item-collection' }
      : { valid: false, reason: `物品集合 ${path} 只支持带 key 的 remove` };
  }
  const item = path.match(new RegExp(`^equipment\.(${STRUCTURED_ITEM_CATEGORIES})\.([^.]+)(?:\.([^.]+))?$`));
  if (item) {
    const field = item[3];
    if (field && !STRUCTURED_ITEM_FIELDS.has(field)) return { valid: false, reason: `物品字段不受支持: ${field}` };
    if (op === 'assign' || op === 'push') return { valid: false, reason: `物品路径不支持 ${op}` };
    if (op === 'remove' && field) return { valid: false, reason: '删除物品必须删除完整物品对象' };
    if (field) {
      const fieldValidation = validateItemField(path, field, op, update.value);
      return fieldValidation.valid ? { valid: true, kind: 'item' } : fieldValidation;
    }
    if (op === 'remove') return { valid: true, kind: 'item' };
    if (op !== 'set') return { valid: false, reason: `物品对象 ${path} 只支持 set/remove` };
    const value = recordValue(update.value);
    if (!value) return { valid: false, reason: `物品对象 ${path} 的 set value 必须是对象` };
    const missing = missingObjectFields(value, REQUIRED_ITEM_FIELDS);
    if (missing.length) return { valid: false, reason: `新物品 ${path} 缺少完整字段: ${missing.join(', ')}` };
    for (const fieldName of REQUIRED_ITEM_FIELDS) {
      const fieldValidation = validateItemField(path, fieldName, 'set', value[fieldName]);
      if (!fieldValidation.valid) return fieldValidation;
    }
    return { valid: true, kind: 'item' };
  }

  return { valid: false, reason: `变量路径不在允许清单中: ${path}` };
}

export function getStructuredVariableContractPrompt() {
  const numeric = [];
  const text = [];
  for (const [path, flatKey] of Object.entries(STRUCTURED_SCALAR_PATH_MAP)) {
    if (STRUCTURED_LEGACY_SCALAR_PATHS.has(path)) continue;
    (VAR_SCHEMA[flatKey]?.type === 'number' ? numeric : text).push(path);
  }
  return `【结构化变量 DSL · 唯一写入契约】
- <variable> 内必须是严格 JSON 对象：双引号、无注释、无尾逗号。
- op 只能使用精确小写：set, add, sub, assign, push, remove。
- 文本标量只允许 set：${text.join(', ')}。
- 数值标量允许 set/add/sub，value 必须是非负有限数字：${numeric.join(', ')}。
- 声望：progression.reputation.* 允许 set/add/sub；删除某村声望使用 progression.reputation + remove + key。
- 装备槽：equipment.equipped.weapon、equipment.equipped.armor、equipment.equipped.accessory1、equipment.equipped.accessory2，只允许 set 字符串或 remove。
- 地图地点：world_state.map.known_locations 只允许 assign/remove + key；assign value 必须含 x、y、desc、tier。探索区域 world_state.map.explored_regions 使用 push 字符串，或 set 字符串数组。
- 技能：skills.(jutsu|taijutsu|genjutsu|support).准确名称。新建用 set 完整对象，必须含 name/rank/element/resource_type/cost/power/mastery/description；单字段使用对象路径 assign + key，或字段路径 set/add/sub。天赋与血继 skills.(talents|kekkei_genkai).准确名称 新建必须含 name/rank/mastery/description。
- 物品：equipment.(weapons|armor|tools|consumables).准确名称。新建用 set 完整对象，必须含 quantity/quality/description；quantity 用 set/add/sub，其他字段用字段路径 set。物品对象不支持 assign。
- 删除完整技能或物品必须对父集合使用 remove + key。`;
}

export function validate(key, value) {
  if (!isKnownKey(key)) return { valid: false, reason: `未知变量: ${key}` };

  const staticDef = VAR_SCHEMA[key];
  if (staticDef) {
    if (staticDef.allowed && !staticDef.allowed.includes(String(value))) {
      return { valid: false, reason: `${key} 仅允许: ${staticDef.allowed.join('/')}` };
    }
    if (staticDef.type === 'number') {
      const n = Number(value);
      if (isNaN(n)) return { valid: false, reason: `${key} 需要数字` };
      if (staticDef.min != null && n < staticDef.min) return { valid: false, reason: `${key} 最小值 ${staticDef.min}` };
      if (staticDef.max != null && n > staticDef.max) return { valid: false, reason: `${key} 最大值 ${staticDef.max}` };
    }
    return { valid: true };
  }

  for (const p of VAR_PATTERNS) {
    if (p.pattern.test(key)) {
      if (p.type === 'number') {
        const n = Number(value);
        if (isNaN(n)) return { valid: false, reason: `${key} 需要数字` };
      }
      return { valid: true };
    }
  }

  return { valid: false, reason: `未知变量: ${key}` };
}

// B-03: NaN 拒绝写入 —— 返回 undefined 标记"不可强转"，调用方据此跳过赋值。
//        旧行为是返回原始字符串，会让 number 字段被字符串污染。
export function coerceValue(key, rawValue) {
  const staticDef = VAR_SCHEMA[key];
  if (staticDef) {
    if (staticDef.type === 'number') {
      const n = Number(rawValue);
      if (isNaN(n)) {
        console.warn('[coerceValue] NaN rejected for number key', key, '=', rawValue);
        return undefined;
      }
      if (staticDef.min != null && n < staticDef.min) return staticDef.min;
      if (staticDef.max != null && n > staticDef.max) return staticDef.max;
      return n;
    }
    // allowed 枚举校验（B-10 的一半）
    if (staticDef.allowed && !staticDef.allowed.includes(String(rawValue))) {
      console.warn('[coerceValue] disallowed value for', key, '=', rawValue, 'allowed:', staticDef.allowed);
      return undefined;
    }
    return String(rawValue);
  }

  for (const p of VAR_PATTERNS) {
    if (!p.pattern.test(key)) continue;
    if (p.type === 'number') {
      const n = Number(rawValue);
      if (isNaN(n)) {
        console.warn('[coerceValue] NaN rejected for pattern number key', key, '=', rawValue);
        return undefined;
      }
      return n;
    }
    if (p.type === 'string') return String(rawValue);
    if (isNumeric(key)) {
      const n = Number(rawValue);
      if (isNaN(n)) return undefined;
      return n;
    }
    return String(rawValue);
  }

  return rawValue;
}

const NUMERIC_FIELDS = ['数量', '好感', '信任', '敬畏', '熟练度', '消耗', '威力', '防御', '情报'];

export function isNumeric(key) {
  const staticDef = VAR_SCHEMA[key];
  if (staticDef) return staticDef.type === 'number';
  for (const p of VAR_PATTERNS) {
    if (p.pattern.test(key)) {
      if (p.type === 'number') return true;
      if (p.type === 'mixed') {
        const lastField = key.split('·').pop();
        return NUMERIC_FIELDS.includes(lastField);
      }
    }
  }
  return false;
}

export function getDesc(key) {
  const staticDef = VAR_SCHEMA[key];
  if (staticDef) return staticDef.desc || key;
  for (const p of VAR_PATTERNS) {
    if (p.pattern.test(key)) return p.desc || key;
  }
  return key;
}

export function getBriefPromptRef() {
  const lines = [];
  const groups = [
    ['玩家·姓名', '玩家·年龄', '玩家·灵魂年龄', '玩家·性别', '玩家·忍阶', '玩家·正式忍阶', '玩家·战力等级', '玩家·所属村', '玩家·查克拉属性', '玩家·出身', '玩家·难度', '玩家·个性', '玩家·公开身份', '玩家·当前目标', '玩家·声望标签', '玩家·标志', '玩家·存活', '玩家·死因'],
    ['属性·查克拉', '属性·当前查克拉', '属性·生命力', '属性·当前生命力', '属性·精神力', '属性·当前精神力', '属性·体力', '属性·当前体力', '属性·速度', '属性·幸运'],
    ['进度·经验', '进度·下一级经验', '进度·忍术熟练度', '进度·体术熟练度', '进度·幻术熟练度', '进度·防御熟练度', '进度·已完成任务', '进度·突破待处理', '进度·金钱', '进度·称号', '进度·成就'],
    ['世界·地点', '世界·时间', '世界·年代', '世界·月份', '世界·天气', '世界·已探索区域', '世界·活跃事件'],
    ['系统·回合数'],
  ];
  const labels = ['玩家', '属性(数值)', '进度', '世界', '系统'];
  for (let i = 0; i < groups.length; i++) {
    lines.push(`${labels[i]}: ${groups[i].join(', ')}`);
  }
  lines.push('技能: 技能·(忍术|体术|幻术|支援)·技能名·(名称|等级|属性|消耗|消耗资源|威力|熟练度|描述|类型|数据库ID|来源) | 技能·血继限界·血继名·子字段 | 技能·天赋·天赋名·(名称|描述|熟练度)');
  lines.push('物品: 物品·(道具|消耗品|武器|防具)·物品名·(数量|品质|描述) | 物品·已装备·(武器|防具|饰品1|饰品2)');
  lines.push('声望: 进度·声望·村名');
  lines.push('系统元数据: 系统·(当前节点|当前分支)');
  lines.push('');
  lines.push('【重要】以下数据使用 JSON 标签，禁止使用 <var> 平键：');
  lines.push('  关系 → 使用 <relationship> 标签');
  lines.push('  记忆 → 使用 <memory> 标签');
  lines.push('  任务 → 使用 <mission> 标签');
  lines.push('  战斗 → 使用 <combat> 标签');
  return lines.join('\n');
}

export function generateMainVarInstructions(updaterEnabled) {
  if (updaterEnabled) {
    return `[系统强制指令 · 最高优先级]
后台独立变量更新模型已启用。主模型必须先输出 <reasoning> 结构化推演，再输出最终剧情正文。除 <reasoning> 外，绝对禁止输出任何结构标签，包括 <var>、<variable>、<var_thinking>、<variable_thinking>、<status_query />、<combat>、<mission>、<relationship>、<memory>、<event>。

正文必须把真实发生的结果说清楚，供后台准确记账：
- 物品获得、使用、售出、丢弃或消耗最后一件时，写出准确物品名与明确结果。
- 忍术学习、练习、遗忘或失去时，写出准确技能名与明确结果。
- 任务、关系、战斗、伤势、资源、地点与时间只有实际改变时才在正文中明确表现。
- 不为方便后台而制造变化，不写猜测数值，不从模型预训练知识擅自补全NPC能力。

事实仍按“当前状态/开局契约 → 持久记忆与近期对话 → 本回合世界书 → 玩家声称 → 模型预训练知识”排序。世界书与存档高于模型常识。<reasoning> 只写可见核对结论与依据，不得写入NPC未公开秘密或审校模型私有记录。`;
  }

  return `[系统指令：变量模式]
由于后台变量更新模型未启用，本回合只调用这一次主模型。你需要在同一回复中输出正文与本回合结构化变更，不能等待另一个模型补写。

使用 <var>...</var> 包裹，每行一个变更：
格式：中文键名 [=/+/-] 值
只输出实际变化的键，无变化则不输出。
（⚠️极其重要：更新玩家自身属性时，必须严格使用前缀系统键名，如"属性·当前查克拉"、"属性·当前生命力"、"属性·当前体力"、"进度·金钱"。严禁在此使用NPC专用的简化键名！）

**操作符说明**：
- "=" 表示设置为新值（覆盖旧值）。用于：文本更新、忍阶晋升、地点变更、装备更换。
- "+" 表示增加数值。用于：获得查克拉/体力恢复、经验增长、金钱收入、技能熟练度提升。
- "-" 表示减少数值。用于：查克拉消耗、体力扣除、金钱消费、物品使用。

**重要：当前值 vs 上限值**
- 四项状态均有"当前值"和"上限"：
  · 属性·当前查克拉 — 战斗中实时消耗/恢复的数值
  · 属性·查克拉 — 角色的查克拉上限（突破时才改变）
  · 属性·当前生命力 / 属性·生命力 — 生命值与上限，只有伤害、治疗、生命成长能改变，当前值归零即死亡
  · 属性·当前体力 / 属性·体力 — 体术资源与上限，不是生命值
  · 属性·当前精神力 / 属性·精神力 — 幻术资源与上限
- 日常战斗只修改"当前值"，绝不直接改上限。
- 突破系统触发时才同时提升"当前值"和"上限"。

${getBriefPromptRef()}

【物品获取】设数量和品质:
物品·消耗品·绷带·数量 =2
物品·消耗品·绷带·品质 =普通
【物品消耗（仍有剩余）】减数量: 物品·消耗品·绷带·数量 -1
【物品彻底删除（丢弃/售出/消耗最后一件）】禁止仅把数量设为0，必须用 JSON remove 删除数量、品质、描述等全部字段；已装备物品会自动解除装备:
<variable>{"path":"equipment.consumables","op":"remove","key":"绷带"}</variable>
物品父路径只能使用 equipment.weapons / equipment.armor / equipment.tools / equipment.consumables，key 必须是准确物品名。同回合删除多个物品时，每个物品分别输出一个 <variable>。
【忍术学习】分别设各字段（⚠️绝对禁止自创字段，只能使用：等级、属性、消耗、威力、熟练度、描述）:
技能·忍术·火遁豪火球·等级 =C
技能·忍术·火遁豪火球·属性 =火
技能·忍术·火遁豪火球·消耗 =25
技能·忍术·火遁豪火球·消耗资源 =查克拉
技能·忍术·火遁豪火球·威力 =80
技能·忍术·火遁豪火球·熟练度 =0
技能·忍术·火遁豪火球·描述 =从口中喷出巨大火球
【忍术遗忘/删除】禁止把熟练度设0，必须删除该术的全部字段:
<variable>{"path":"skills.jutsu","op":"remove","key":"火遁·豪火球"}</variable>
技能父路径可使用 skills.jutsu / skills.taijutsu / skills.genjutsu / skills.support / skills.talents / skills.kekkei_genkai，key 必须是准确技能名。同回合遗忘多个技能时，每个技能分别输出一个 <variable>。
【血继限界】多个血继时用子字段:
技能·血继限界·写轮眼·熟练度 =30
技能·血继限界·写轮眼·描述 =単勾玉
【装备槽】: 物品·已装备·武器 =草薙剑

【常见战斗资源操作】:
时间变化必须写入含年月日与时段的完整 世界·时间，本地自动同步数字 世界·月份，禁止另写矛盾月份。
属性·当前查克拉 -30   ← 释放C级忍术消耗30查克拉
属性·当前生命力 -15   ← 被苦无擦伤造成15伤害
属性·当前体力 -15     ← 释放体术消耗15体力
属性·当前精神力 -10   ← 释放幻术消耗精神力
属性·当前生命力 +25   ← 治疗恢复生命力
进度·经验 +20         ← 完成训练获得历练
进度·金钱 +500        ← 任务报酬
进度·金钱 -200        ← 在武器店购物
世界·地点 =木叶·火影办公室  ← 场景切换
世界·时间 =木叶64年3月15日·午后  ← 完整日期示例

【地点变更规则——每次移动必须同步更新坐标】：
仅改 世界·地点 会导致地图无法定位。同时必须用 <variable> 标签更新 known_locations：
<variable>{"updates":[
  {"path":"world_state.current_location","op":"set","value":"新地点名"},
  {"path":"world_state.map.known_locations","op":"assign","key":"新地点名","value":{"x":坐标数字,"y":坐标数字,"desc":"一句话简介","tier":"village|town|landmark|wilderness|hideout|dungeon"}},
  {"path":"world_state.map.explored_regions","op":"push","value":"区域名"}
]}</variable>
（首次探索才 push explored_regions，已知区域只需前两条）

【关系/记忆/任务/战斗】必须使用 JSON 标签，禁止用 <var> 平键：
- 关系变化 → <relationship>{"npc":"...","affection_change":2,"trust_change":3,...}</relationship>
- 记忆摘要 → <memory>{"summary":"...","facts":[],"clues":[],"pins":[],"remove_pins":[],"npc_notes":{}}</memory>
- 任务 status 只允许 active|progress|completed|failed|abandoned；新任务 → <mission>{"id":"稳定ID","status":"active","title":"明确任务名","rank":"D|C|B|A|S","objective":"明确目标"}</mission>；已有任务只写真实变化
- 开战 → <combat state="start">{"enemy_name":"姓名","enemy_rank":"忍阶"}</combat>；行动与结束必须使用对应 state 所需的非空字段
- 普通事件 → <event>{"id":"稳定ID","status":"triggered|occurred|altered|skipped|postponed","description":"事实"}</event>；结束状态使用 completed|resolved|ended|failed|cancelled
- 无论本回合有无其他变更，末尾必须输出一条 <memory>，只记录本回合已发生事实、直接结果和下一轮待承接事项。

【严禁】日常闲聊/赶路/观察不得增加 进度·经验。训练+10~20，战斗+15~25，任务+10~30。
【严禁】直接提升属性上限（属性·查克拉/生命力/体力/精神力/速度），只有触发"突破"系统指令时才允许。
【生命警戒】属性·当前生命力 是HP。非战斗负伤不得随意扣除；归零即角色死亡。属性·当前体力只是体术资源，归零不会死亡。
单回合技能熟练度提升不超过+8。

【NPC战斗卡 — 首次完整建档与增量更新】
- 已有NPC战斗卡：直接复用当前状态提供的数值、战力等级和忍术，只输出本回合真实变化，禁止重新估值、补全或重建整张卡。
- 最终正文首次实际登场的有名人物必须输出 <relationship> 并明确 combatant。平民、纯文职或无战斗能力者写 combatant:false，不生成战斗卡。
- 战斗型忍者写 combatant:true，并提供 {"combat_stats":{"rank":"忍阶","chakra_nature":[],"jutsu":[]}}；没有可靠属性或招式证据时保留空数组，不得猜测。若提供忍术，每条必须完整包含 name/rank/element/resource_type/cost/power/mastery/description/type，且不得伪造 JT 数据库ID。本地按忍阶补齐六项属性与三系造诣。
- 本地系统会将六项最终属性和三系造诣限制在忍阶基准内，并用与玩家相同的综合公式自动计算战力等级。所有当前资源不得超过上限；后续整卡信息不得把受伤或消耗后的当前值恢复到上限。
- 招式记录名称、等级、属性、熟练度、描述、类型、消耗资源与单次消耗。具体点数以数据库中该招式的 cost 为唯一依据，禁止根据等级重算；忍术扣查克拉、幻术扣精神力、体术扣体力，支援术按其消耗资源字段。玩家与NPC完全相同。

【战斗资源唯一结算】
- 开战：<combat state="start">{"enemy_name":"姓名","enemy_rank":"忍阶"}</combat>
- 玩家行动：<combat state="player_turn">{"actor":"player","action_name":"准确技能名","action_rank":"C","action_type":"忍术|幻术|体术|支援","resource_type":"查克拉|精神力|体力","damage_to_enemy":数值,"log":"结果"}</combat>
- NPC行动：<combat state="enemy_turn">{"actor":"enemy","action_name":"准确技能名","action_rank":"C","action_type":"忍术|幻术|体术|支援","resource_type":"查克拉|精神力|体力","damage_to_player":数值,"log":"结果"}</combat>
- 玩家与NPC都由本地战斗系统按已存招式的 resource_type/cost 各结算一次；资源不足则招式失败且不造成伤害。写入 <combat> 后，禁止再用 <var>/<variable> 重复扣除任何施术资源。`;
}

export default VAR_SCHEMA;
