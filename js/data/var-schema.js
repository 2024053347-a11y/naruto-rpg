export const VAR_SCHEMA = {

  '玩家·姓名':          { type: 'string',  default: '',        desc: '角色名' },
  '玩家·年龄':          { type: 'number',  default: 12,        desc: '身体年龄' },
  '玩家·灵魂年龄':       { type: 'number',  default: 12,        desc: '灵魂年龄' },
  '玩家·性别':          { type: 'string',  default: '',        desc: '性别' },
  '玩家·忍阶':          { type: 'string',  default: '忍校学生', desc: '当前忍阶(下忍/中忍/上忍等)' },
  '玩家·正式忍阶':       { type: 'string',  default: '忍校学生', desc: '官方正式忍阶' },
  '玩家·战力等级':       { type: 'string',  default: 'E级',     desc: '战力评估(E/S/A/B/C/D)' },
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
   '属性·意志力':        { type: 'number',  default: 80,  min: 0, max: 9999, desc: '意志力上限(防御/承受/说服)' },
   '属性·当前意志力':     { type: 'number',  default: 80,  min: 0, max: 9999, desc: '当前意志力' },
   '属性·体力':          { type: 'number',  default: 100, min: 0, max: 9999, desc: '◈生命力上限(HP)——非普通资源，不可随意扣除，归零即死亡' },
   '属性·当前体力':       { type: 'number',  default: 100, min: 0, max: 9999, desc: '◈当前生命力——归零则角色阵亡，游戏终止' },
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
  '进度·金钱':          { type: 'number',  default: 500,  min: 0, max: 999999, desc: '金钱(両)' },
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
  { pattern: /^技能·(?:忍术|体术|幻术|支援)·(.+)·(名称|等级|属性|消耗|威力|熟练度|描述|说明)$/, type: 'mixed', desc: '技能数据(数值字段自动转number)', _nameIdx: 1, _fieldIdx: 2 },
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
  staminaWarning: 30,
  staminaDanger: 10,
};

export const NPC_TEMPLATE_FIELDS = [
  'npc', 'affection', 'trust', 'respect',
  '查克拉', '查克拉上限', '体力', '体力上限',
  '速度', '精神力', '意志力',
  '忍术造诣', '体术造诣', '幻术造诣',
  '忍阶', '查克拉属性', '忍术',
  'affection_change', 'trust_change',
  'inner_thoughts', 'history'
];

// AI模型经常使用非标准变量名，此表将它们映射到正确的v4.0扁平键名
export const VAR_ALIASES = {
  '状态·历练值':       '进度·经验',
  '状态·经验值':       '进度·经验',
  '状态·经验':         '进度·经验',
  '状态·体力':         '属性·当前体力',
  '状态·查克拉':       '属性·当前查克拉',
  '状态·精神力':       '属性·当前精神力',
  '状态·意志力':       '属性·当前意志力',
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
  '体力':               '属性·当前体力',
  '体力上限':           '属性·体力',
  '速度':               '属性·速度',
  '精神力':             '属性·当前精神力',
  '精神力上限':         '属性·精神力',
  '意志力':             '属性·当前意志力',
  '意志力上限':         '属性·意志力',
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
    ['属性·查克拉', '属性·当前查克拉', '属性·精神力', '属性·当前精神力', '属性·意志力', '属性·当前意志力', '属性·体力', '属性·当前体力', '属性·速度', '属性·幸运'],
    ['进度·经验', '进度·下一级经验', '进度·忍术熟练度', '进度·体术熟练度', '进度·幻术熟练度', '进度·防御熟练度', '进度·已完成任务', '进度·突破待处理', '进度·金钱', '进度·称号', '进度·成就'],
    ['世界·地点', '世界·时间', '世界·年代', '世界·月份', '世界·天气', '世界·已探索区域', '世界·活跃事件'],
    ['系统·回合数'],
  ];
  const labels = ['玩家', '属性(数值)', '进度', '世界', '系统'];
  for (let i = 0; i < groups.length; i++) {
    lines.push(`${labels[i]}: ${groups[i].join(', ')}`);
  }
  lines.push('技能: 技能·(忍术|体术|幻术|支援)·技能名·(名称|等级|属性|消耗|威力|熟练度|描述) | 技能·血继限界·血继名·子字段 | 技能·天赋·天赋名·(名称|描述|熟练度)');
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
本回合你**绝对禁止**输出以下任何标签：<var>、<variable>、<var_thinking>、<status_query />。

所有属性变更（包括但不限于：查克拉消耗、体力增减、经验获取、技能熟练度提升、物品获取/消耗、金钱变动、地图位置、关系数值、任务状态）均由后台独立的变量更新模型自动处理，你**完全不需要**、也**不允许**在回复中写入任何数值变更。

你唯一需要输出的结构标签是：<combat>（战斗状态）、<mission>（任务变更）、<relationship>（关系变化）、<event>（世界事件）。
**<memory>（记忆摘要）由后台二次变量模型自动生成，你绝对禁止输出。**
如果本回合没有上述4种标签对应的内容，则完全不要输出任何XML标签。

【NPC人物卡 — 每回合强制】
每个在本回合登场/互动的**有名字NPC都必须**输出 <relationship> 标签，**无论如何必须包含完整战斗属性**（请使用下方示例中的简化键名，以区别于玩家的严格前缀键名）：
{
  "npc": "NPC名字",
  "查克拉": 当前值, "查克拉上限": 上限值,
  "体力": 当前值, "体力上限": 上限值,
  "速度": 数值, "精神力": 数值, "意志力": 数值,
  "忍术造诣": 数值(0-100), "体术造诣": 数值(0-100), "幻术造诣": 数值(0-100),
  "忍阶": "下忍/中忍/上忍/影级等",
  "查克拉属性": ["火","风"等],
  "忍术": [{"名称":"术名","等级":"S/A/B/C/D/E","属性":"火/风/雷/土/水/阴/阳/无","消耗":查克拉消耗,"威力":威力值,"熟练度":0-100,"描述":"一句话简述","类型":"忍术/体术/幻术"}],
  "affection_change": 好感变化(-100到+100),
  "trust_change": 信任变化(-100到+100),
  "inner_thoughts": "该NPC此刻内心真实想法（一句话）",
  "history": "本回合互动摘要（一句话）"
}
**每个有名字的NPC都必须填完整战斗数值+至少1-3个招牌忍术**，无一例外。无名路人可略。

战力参考：下忍 体力120-260 速度25-75 忍术造诣20-50 / 中忍 体力180-380 速度45-110 忍术造诣40-70 / 上忍 体力280-650 速度85-180 忍术造诣60-90 / 影级 体力650-1400 速度160-320 忍术造诣80-100。
忍术：下忍1-3个D-C级, 中忍3-5个C-B级, 上忍5-10个B-A级+1-2S, 影级8-15个A-S级。消耗E5-10/D10-20/C15-30/B25-50/A40-80/S60-150。必须用火影原作招牌技能名。

请只专注于叙事质量。`;
  }

  return `[系统指令：变量模式]
由于后台变量更新模型未启用，你需要自行输出本回合的数值变更。

使用 <var>...</var> 包裹，每行一个变更：
格式：中文键名 [=/+/-] 值
只输出实际变化的键，无变化则不输出。
（⚠️极其重要：更新玩家自身属性时，必须严格使用前缀系统键名，如"属性·当前查克拉"、"属性·当前体力"、"进度·金钱"。严禁在此使用如"查克拉"等下方NPC专用的简化键名！）

**操作符说明**：
- "=" 表示设置为新值（覆盖旧值）。用于：文本更新、忍阶晋升、地点变更、装备更换。
- "+" 表示增加数值。用于：获得查克拉/体力恢复、经验增长、金钱收入、技能熟练度提升。
- "-" 表示减少数值。用于：查克拉消耗、体力扣除、金钱消费、物品使用。

**重要：当前值 vs 上限值**
- 战斗资源（查克拉/体力/精神力/意志力）有"当前值"和"上限"两个字段：
  · 属性·当前查克拉 — 战斗中实时消耗/恢复的数值
  · 属性·查克拉 — 角色的查克拉上限（突破时才改变）
  · 属性·当前体力 — 生命值（归零即死亡）
  · 属性·体力 — 体力上限（突破时才改变）
- 日常战斗只修改"当前值"，绝不直接改上限。
- 突破系统触发时才同时提升"当前值"和"上限"。

${getBriefPromptRef()}

【物品获取】设数量和品质:
物品·消耗品·绷带·数量 =2
物品·消耗品·绷带·品质 =普通
【物品消耗】减数量: 物品·消耗品·绷带·数量 -1
【物品删除】设0: 物品·消耗品·绷带·数量 =0
【忍术学习】分别设各字段（⚠️绝对禁止自创字段，只能使用：等级、属性、消耗、威力、熟练度、描述）:
技能·忍术·火遁豪火球·等级 =C
技能·忍术·火遁豪火球·属性 =火
技能·忍术·火遁豪火球·消耗 =25
技能·忍术·火遁豪火球·威力 =80
技能·忍术·火遁豪火球·熟练度 =0
技能·忍术·火遁豪火球·描述 =从口中喷出巨大火球
【血继限界】多个血继时用子字段:
技能·血继限界·写轮眼·熟练度 =30
技能·血继限界·写轮眼·描述 =単勾玉
【装备槽】: 物品·已装备·武器 =草薙剑

【常见战斗资源操作】:
属性·当前查克拉 -30   ← 释放C级忍术消耗30查克拉
属性·当前体力 -15     ← 被苦无擦伤扣15体力
属性·当前精神力 -10   ← 释放幻术消耗精神力
属性·当前体力 +25     ← 服用兵粮丸恢复体力
进度·经验 +20         ← 完成训练获得历练
进度·金钱 +500        ← 任务报酬
进度·金钱 -200        ← 在武器店购物
世界·地点 =木叶·火影办公室  ← 场景切换
世界·时间 =木叶64年春·午后  ← 时间推进 (文本描述)
世界·月份 =3            ← ⚠️极其重要：月份必须是数字(1-12)，绝对不能写"春/夏"等文字！

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
- 记忆摘要 → <memory>{"summary":"...","facts":[],"clues":[],...}</memory>
- 任务更新 → <mission>{"id":"...","status":"active|progress|completed",...}</mission>
- 战斗状态 → <combat state="start|player_turn|...">{"enemy_name":"...",...}</combat>

【严禁】日常闲聊/赶路/观察不得增加 进度·经验。训练+10~20，战斗+15~25，任务+10~30。
【严禁】直接提升属性上限（属性·查克拉/体力/精神力/意志力/速度），只有触发"突破"系统指令时才允许。
【生命警戒】属性·当前体力 是生命力（HP）。非战斗负伤不得随意扣除。归零即角色死亡、游戏终止。
单回合技能熟练度提升不超过+8。

【NPC人物卡 — 强制要求】
本回合登场的**每一个有名字的NPC**都必须输出 <relationship> 标签，**无论如何必须包含完整战斗属性**（请使用下方示例中的简化键名，以区别于玩家的严格前缀键名）：
{
  "npc": "NPC名字",
  "查克拉": 当前值, "查克拉上限": 上限值,
  "体力": 当前值, "体力上限": 上限值,
  "速度": 数值, "精神力": 数值, "意志力": 数值,
  "忍术造诣": 数值(0-100), "体术造诣": 数值(0-100), "幻术造诣": 数值(0-100),
  "忍阶": "下忍/中忍/上忍/影级等",
  "查克拉属性": ["火","风"等],
  "忍术": [
    {"名称":"术名","等级":"S/A/B/C/D/E","属性":"火/风/雷/土/水/阴/阳/无","消耗":查克拉消耗值,"威力":威力值(0-300),"熟练度":0-100,"描述":"一句话简述效果","类型":"忍术/体术/幻术"}
  ],
  "affection_change": 好感变化(-100到+100),
  "trust_change": 信任变化(-100到+100),
  "inner_thoughts": "该NPC此刻对主角的真实内心想法（一句话）",
  "history": "本回合与该NPC的互动摘要（一句话）"
}
**每个有名字的NPC都必须填写完整战斗数值和至少1-3个招牌忍术**，无一例外。即使只是路过打招呼的角色也要给出基本数值。没有名字的纯路人/群众可以省略战斗属性。

**战力数值参考**（当前值通常为上限的60-100%）：
- 忍校学生：查克拉10-40, 体力60-120, 速度10-25, 精神力10-30, 意志力10-30, 忍术造诣0-20
- 下忍：查克拉上限40-160, 体力上限120-260, 速度25-75, 精神力30-80, 意志力30-80, 忍术造诣20-50, 体术造诣20-50, 幻术造诣10-40
- 中忍：查克拉上限80-300, 体力上限180-380, 速度45-110, 精神力60-150, 意志力60-150, 忍术造诣40-70, 体术造诣40-70, 幻术造诣30-60
- 特别上忍：查克拉上限120-420, 体力上限220-480, 速度65-140, 精神力100-250, 意志力100-280, 忍术造诣55-80, 体术造诣50-80, 幻术造诣40-75
- 上忍：查克拉上限180-650, 体力上限280-650, 速度85-180, 精神力120-300, 意志力120-300, 忍术造诣60-90, 体术造诣60-90, 幻术造诣50-85
- 精英上忍：查克拉上限320-1000, 体力上限420-900, 速度120-240, 精神力200-500, 意志力200-500, 忍术造诣75-95, 体术造诣75-95, 幻术造诣65-90
- 影级：查克拉上限600-2500, 体力上限650-1400, 速度160-320, 精神力250-600, 意志力250-600, 忍术造诣80-100, 体术造诣80-100, 幻术造诣70-100

**忍术配置参考**：
- 数量：忍校学生0-1个, 下忍1-3个, 中忍3-5个, 上忍5-10个, 影级8-15个
- 等级分布：忍校E级, 下忍D-C级, 中忍C-B级, 上忍B-A级+1-2个S级, 影级多个A-S级
- 消耗：E级5-10, D级10-20, C级15-30, B级25-50, A级40-80, S级60-150
- 威力：E级5-25, D级15-40, C级30-70, B级50-120, A级80-200, S级120-300
- 必须使用火影原作中该角色的招牌技能名称`;
}

export default VAR_SCHEMA;
