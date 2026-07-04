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
  { pattern: /^技能·(?:忍术|体术|幻术|支援)·(.+?)(?:·(名称|等级|属性|消耗|威力|熟练度|描述|说明))?$/, type: 'mixed', desc: '技能数据(数值字段自动转number)', _nameIdx: 1, _fieldIdx: 2 },
  { pattern: /^技能·血继限界·(.+?)(?:·(.+))?$/,                                                    type: 'mixed', desc: '血继限界子字段', _nameIdx: 1, _fieldIdx: 2 },
  // 物品 (支持层级如 物品·消耗品·兵粮丸·数量)
  { pattern: /^物品·(消耗品|道具|武器|防具|已装备|素材)·(.+?)(?:·(数量|品质|描述|附加属性))?$/, type: 'mixed', desc: '物品数据', _typeIdx: 1, _nameIdx: 2, _fieldIdx: 3 },
  { pattern: /^(?:装备|物品)·(?:道具|消耗品|武器|防具|装备|关键|忍具|素材|食物|卷轴|其他)·(.+)$/,       type: 'mixed', desc: '物品/装备数据(兼容AI别名)', _nameIdx: 1 },
  { pattern: /^物品·已装备·(?:武器|防具|饰品[12])$/,                                           type: 'string', desc: '已装备栏' },
  { pattern: /^进度·声望·(.+)$/,                                                              type: 'number', desc: '村落声望值', _nameIdx: 1 },
  { pattern: /^系统·(?:当前节点|当前分支)$/,                                                   type: 'string', desc: '系统元数据' },
  { pattern: /^状态·(.+)$/,                                                                   type: 'mixed',  desc: 'AI别名状态变量', _nameIdx: 1 },
  { pattern: /^角色·(.+)$/,                                                                   type: 'mixed',  desc: 'AI别名角色变量', _nameIdx: 1 },
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

export default VAR_SCHEMA;
