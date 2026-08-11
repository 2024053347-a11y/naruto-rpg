const NARRATIVE_REQUIREMENTS = Object.freeze({
  opening: Object.freeze([
    'project-guide:opening',
    'inspect_opening_draft',
    'search_worldbook',
    'search_canon_database'
  ]),
  worldbook: Object.freeze([
    'project-guide:worldbook',
    'search_worldbook',
    'search_canon_database'
  ]),
  story: Object.freeze([
    'project-guide:story',
    'inspect_current_state',
    'inspect_story_plan',
    'inspect_project_state:timeline',
    'search_worldbook',
    'search_canon_database'
  ])
});

const REQUIREMENT_LABELS = Object.freeze({
  'project-guide:opening': 'search_project_guide(category=opening)',
  'project-guide:worldbook': 'search_project_guide(category=worldbook)',
  'project-guide:story': 'search_project_guide(category=story)',
  inspect_opening_draft: 'inspect_opening_draft',
  inspect_current_state: 'inspect_current_state',
  inspect_story_plan: 'inspect_story_plan',
  'inspect_project_state:timeline': 'inspect_project_state(section=timeline)',
  'inspect_project_state:missions': 'inspect_project_state(section=missions)',
  'inspect_project_state:relationships': 'inspect_project_state(section=relationships)',
  'inspect_project_state:combat': 'inspect_project_state(section=combat)',
  'inspect_project_state:memory': 'inspect_project_state(section=memory)',
  search_worldbook: 'search_worldbook',
  search_canon_database: 'search_canon_database'
});

const COMPOSITION_INTENT = /(写|编|拟|续|讲|描述|演|加|新增|添加|生成|创建|制作|创作|起草|设计|改写|重写|续写|补写|补全|完善|润色|准备|规划|构思|制定|安排|展开|推进|给我|来一段|来一个|来点|做一个|帮我)/;

function evidenceText(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value ?? ''); }
}

function normalizedEvidence(value) {
  return evidenceText(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function evidenceTokens(value) {
  const normalized = normalizedEvidence(value);
  const tokens = new Set(normalized.split(' ').filter(token => token.length >= 2));
  const compact = normalized.replace(/\s+/g, '');
  for (let index = 0; index + 1 < compact.length; index++) tokens.add(compact.slice(index, index + 2));
  return [...tokens];
}

export function inferNarrativeResearchKinds(input = '') {
  const text = String(input || '').replace(/\u0000/g, '').trim();
  if (!text || !COMPOSITION_INTENT.test(text)) return [];
  const kinds = [];
  if (/(开局|开场|开篇|初始人设|开场情境)/.test(text)) kinds.push('opening');
  if (/(世界书|设定条目|百科条目)/.test(text)) kinds.push('worldbook');
  if (/(剧情|情节|故事|章节|场景|伏笔|分支|剧情方向|对白|后续|下一幕|角色弧|任务线|中忍考试|事件|遭遇|桥段|冲突)/.test(text)) kinds.push('story');
  return kinds;
}

export function inferNarrativeResearchKind(input = '') {
  return inferNarrativeResearchKinds(input)[0] || '';
}

export class LingXiResearchGate {
  constructor() {
    this.begin();
  }

  begin(query = '') {
    this.query = String(query || '').replace(/\u0000/g, '').trim().slice(0, 2000);
    this.completed = new Set();
    this.evidence = '';
    return this;
  }

  recordProjectGuide(category = '') {
    const normalized = String(category || '').trim().toLowerCase();
    if (normalized) this.completed.add(`project-guide:${normalized}`);
  }

  record(toolName = '', detail = '') {
    const tool = String(toolName || '').trim();
    if (!tool) return;
    const detailText = evidenceText(detail).slice(0, 12000);
    if (tool === 'search_worldbook' || tool === 'search_canon_database') {
      if (!detailText.trim()) return;
      const allowedEvidence = normalizedEvidence(`${this.query}\n${this.evidence}`);
      if (allowedEvidence && !evidenceTokens(detailText).some(token => allowedEvidence.includes(token))) return;
    }
    this.completed.add(tool);
    if (tool !== 'search_worldbook' && tool !== 'search_canon_database' && detailText) {
      this.evidence = `${this.evidence}\n${detailText}`.slice(-24000);
    }
  }

  missing(kind = '') {
    const normalizedKind = String(kind || '').trim();
    const requirements = [...(NARRATIVE_REQUIREMENTS[normalizedKind] || [])];
    if (normalizedKind === 'story') {
      if (/任务/.test(this.query)) requirements.push('inspect_project_state:missions');
      if (/(关系|羁绊|好感)/.test(this.query)) requirements.push('inspect_project_state:relationships');
      if (/(战斗|交战|对决|敌人)/.test(this.query)) requirements.push('inspect_project_state:combat');
      if (/(记忆|回忆|往事|过往)/.test(this.query)) requirements.push('inspect_project_state:memory');
    }
    return requirements.filter(requirement => !this.completed.has(requirement));
  }

  assert(kind = '') {
    const missing = this.missing(kind);
    if (!missing.length) return true;
    const labels = missing.map(requirement => REQUIREMENT_LABELS[requirement] || requirement);
    const error = new Error(`生成相关内容前必须在本轮完成项目检索：${labels.join('、')}`);
    error.code = 'LINGXI_RESEARCH_REQUIRED';
    error.details = { kind, missing: [...missing], query: this.query };
    throw error;
  }
}

export function createLingXiResearchGate() {
  return new LingXiResearchGate();
}

export default LingXiResearchGate;
