const CONTRACT_VERSION = 1;

const PROTECTED_PATH_ALIASES = {
  'player.name': '玩家·姓名',
  'player.gender': '玩家·性别',
  'player.background': '玩家·出身'
};

const RANKS = ['精英上忍', '特别上忍', '上忍', '中忍', '下忍', '忍校学生'];
const VILLAGES = ['木叶隐村', '雨隐村', '砂隐村', '雾隐村', '岩隐村', '云隐村', '音隐村', '草隐村', '泷隐村'];
const VILLAGE_ALIASES = {
  木叶: '木叶隐村', 雨隐: '雨隐村', 砂隐: '砂隐村', 雾隐: '雾隐村',
  岩隐: '岩隐村', 云隐: '云隐村', 音隐: '音隐村', 草隐: '草隐村', 泷隐: '泷隐村'
};

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function firstMatch(source, values) {
  return values.find(value => source.includes(value)) || '';
}

function findVillage(source) {
  return firstMatch(source, VILLAGES)
    || Object.entries(VILLAGE_ALIASES).find(([alias]) => source.includes(alias))?.[1]
    || '';
}

function findInitialRank(source) {
  for (const rank of RANKS) {
    let index = source.indexOf(rank);
    while (index >= 0) {
      const prefix = source.slice(Math.max(0, index - 10), index);
      if (!/(?:目标|梦想|希望|立志|想要|成为|晋升)/.test(prefix)) return rank;
      index = source.indexOf(rank, index + rank.length);
    }
  }
  return '';
}

function findRankFromIdentity(persona, backgroundName, backgroundDescription) {
  const nameRank = findInitialRank(backgroundName);
  if (nameRank) return nameRank;
  const identityText = `${backgroundDescription}\n${persona}`;
  for (const rank of RANKS) {
    const escaped = rank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const explicit = new RegExp(`(?:曾是|原为|原是|身为|作为|我是|现为|担任|忍阶|身份|职位|级别|开局)\\s*[^。；;\\n]{0,12}${escaped}`);
    const leading = new RegExp(`^\\s*(?:普通|资深|年轻)?\\s*${escaped}`);
    if (explicit.test(identityText) || leading.test(persona)) return rank;
  }
  return '';
}

function extractGoal(source) {
  const match = source.match(/(?:当前)?(?:目标|目的|愿望|追求)\s*(?:是|为|：|:)?\s*([^。；;\n]{2,80})/);
  return text(match?.[1]).replace(/[，,]?(?:并且|同时)?(?:身份|出身|能力|地点).*$/, '').trim();
}

function extractFact(lines, prefix) {
  const line = lines.find(item => item.startsWith(prefix));
  return line ? text(line.slice(prefix.length)) : '';
}

export function deriveOpeningState(choices = {}, currentState = {}) {
  const customBackground = choices.background === '__custom_background__';
  const background = customBackground ? (choices.customBackground || {}) : {};
  const persona = text(choices.persona);
  const backgroundName = text(background.name);
  const backgroundDescription = text(background.description);
  const identitySource = [persona, backgroundName, backgroundDescription].filter(Boolean).join('\n');
  const overrides = {};

  if (customBackground) {
    if (backgroundName) {
      overrides['玩家·出身'] = backgroundName;
      overrides['玩家·公开身份'] = backgroundName;
      overrides['玩家·声望标签'] = backgroundName;
    }
    if (text(background.location)) overrides['世界·地点'] = text(background.location);
  }

  const rank = findRankFromIdentity(persona, backgroundName, backgroundDescription);
  if (rank) {
    overrides['玩家·忍阶'] = rank;
    overrides['玩家·正式忍阶'] = rank;
  }

  const explicitPower = identitySource.match(/(?:战力|实力|战斗等级)\s*(?:是|为|：|:)?\s*(影级|准影级|S级|A级|B级|C级|D级|E级)/)?.[1]
    || identitySource.match(/(?:身为|已是|拥有)\s*(影级|准影级|S级|A级|B级|C级|D级|E级)(?:实力|战力|忍者|叛忍)?/)?.[1];
  const rankPower = {
    '精英上忍': 'A级', '特别上忍': 'A级', '上忍': 'A级',
    '中忍': 'B级', '下忍': 'C级', '忍校学生': 'E级'
  }[rank];
  const power = explicitPower === '影级' ? 'S级' : explicitPower === '准影级' ? 'A级' : (explicitPower || rankPower);
  if (power) overrides['玩家·战力等级'] = power;

  const backgroundSource = `${text(background.name)}\n${text(background.description)}`;
  const village = findVillage(backgroundSource) || findVillage(identitySource);
  if (village) overrides['玩家·所属村'] = village;
  else if (/(?:无所属|流浪忍者|浪忍)/.test(identitySource)) overrides['玩家·所属村'] = '无所属';

  const goal = extractGoal(identitySource);
  if (goal) overrides['玩家·当前目标'] = goal;

  const ageMatch = identitySource.match(/(?:年龄|年纪)?\s*(\d{1,3})\s*岁/);
  if (ageMatch) overrides['玩家·年龄'] = Number(ageMatch[1]);

  if (!Object.keys(overrides).length && currentState['玩家·姓名']) {
    return {};
  }
  return overrides;
}

export function createOpeningContract({ choices = {}, state = {} } = {}) {
  const customTalent = choices.talent === '__custom_talent__';
  const customBackground = choices.background === '__custom_background__';
  const rawBackground = customBackground ? (choices.customBackground || {}) : {};
  const persona = text(choices.persona || state['玩家·个性']);
  const talent = customTalent ? text(choices.customTalent?.description) : '';
  const backgroundName = text(rawBackground.name || state['玩家·出身']);
  const backgroundDescription = text(rawBackground.description);
  const backgroundLocation = text(rawBackground.location || state['世界·地点']);
  const skill = text(choices.customSkill?.description);
  const source = [persona, talent, backgroundName, backgroundDescription, skill].filter(Boolean).join('\n');
  const goal = text(state['玩家·当前目标']) || extractGoal(source);
  const secrets = unique(source.split(/[。；;\n]/).filter(line => /秘密|真实身份|隐瞒|不能被|不可让|不为人知/.test(line)));

  const protectedFields = {};
  for (const key of ['玩家·姓名', '玩家·出身']) {
    if (state[key] !== undefined && state[key] !== null && text(state[key])) protectedFields[key] = state[key];
  }

  return {
    version: CONTRACT_VERSION,
    revision: 1,
    created_at: new Date().toISOString(),
    raw: {
      persona,
      talent,
      background: {
        name: backgroundName,
        description: backgroundDescription,
        location: backgroundLocation
      },
      skill,
      timeline: text(state['世界·年代'] || state['世界·时间'])
    },
    invariants: unique([
      persona ? `核心人设: ${persona}` : '',
      talent ? `自定义天赋及限制: ${talent}` : '',
      backgroundDescription ? `出身真相: ${backgroundName} - ${backgroundDescription}` : (backgroundName ? `出身: ${backgroundName}` : ''),
      skill ? `初始能力及限制: ${skill}` : ''
    ]),
    initial_conditions: {
      gender: text(state['玩家·性别']),
      rank: text(state['玩家·忍阶']),
      official_rank: text(state['玩家·正式忍阶']),
      power_level: text(state['玩家·战力等级']),
      affiliation: text(state['玩家·所属村']),
      public_identity: text(state['玩家·公开身份']),
      location: backgroundLocation,
      timeline: text(state['世界·年代'] || state['世界·时间']),
      goal
    },
    goals: unique([goal]),
    secrets,
    mutable_fields: ['玩家·性别'],
    protected_fields: protectedFields
  };
}

export function resolveOpeningContract(state = {}) {
  const existing = state._opening_contract;
  if (existing && typeof existing === 'object' && Number(existing.version) >= 1) {
    const protectedFields = { ...(existing.protected_fields || {}) };
    // 性别是火影世界中可被术、身体变化或剧情事件改变的当前状态。
    delete protectedFields['玩家·性别'];
    return {
      ...existing,
      raw: { ...(existing.raw || {}), background: { ...(existing.raw?.background || {}) } },
      invariants: Array.isArray(existing.invariants) ? existing.invariants : [],
      goals: Array.isArray(existing.goals) ? existing.goals : [],
      secrets: Array.isArray(existing.secrets) ? existing.secrets : [],
      mutable_fields: unique([...(existing.mutable_fields || []), '玩家·性别']),
      protected_fields: protectedFields
    };
  }
  if (!text(state['玩家·姓名'])) return null;

  const facts = String(state._memory?.facts || '').split('\n').map(text).filter(Boolean);
  const persona = text(state['玩家·个性']);
  const talent = extractFact(facts, '自定义天赋:');
  const backgroundFact = extractFact(facts, '自定义出身:');
  const skill = extractFact(facts, '自定义初始技能:');
  const customSkill = Object.entries(state)
    .filter(([key, value]) => key.startsWith('技能·') && value?.custom)
    .map(([, value]) => text(value.description)).filter(Boolean).join('\n');
  const hasCustom = !!(persona || talent || backgroundFact || skill || customSkill);
  if (!hasCustom) return null;

  return createOpeningContract({
    state,
    choices: {
      persona,
      talent: '__custom_talent__',
      customTalent: { description: talent },
      background: '__custom_background__',
      customBackground: {
        name: state['玩家·出身'],
        description: backgroundFact,
        location: state['世界·地点']
      },
      customSkill: { description: skill || customSkill }
    }
  });
}

export function formatOpeningContractPrompt(contract, { compact = false, audience = 'narrator' } = {}) {
  if (!contract) return '';
  const raw = contract.raw || {};
  const background = raw.background || {};
  const initial = contract.initial_conditions || {};
  const redactSecrets = (value) => (contract.secrets || []).reduce(
    (result, secret) => result.replace(secret, '[秘密信息已隐藏]'),
    text(value)
  );
  if (audience === 'npc') {
    const publicFacts = unique([
      redactSecrets(raw.persona) ? `- 玩家可观察人设: ${redactSecrets(raw.persona)}` : '',
      initial.public_identity ? `- 玩家公开身份: ${initial.public_identity}` : ''
    ]);
    return [
      '[玩家开局契约·NPC可知范围]',
      '- 只能依据公开身份、亲历互动和关系历史行动，不得无故知道玩家秘密。',
      '- 不得否定玩家已经公开表现出来的外貌、性格和身份。',
      ...publicFacts
    ].join('\n');
  }
  const rules = [
    '玩家明确填写的开局设定是当前存档的事实，高于世界书与默认开局模板。',
    '不得否定、替换、弱化或遗忘其中的人设、出身真相、能力及其限制。',
    '输出前必须逐项核对契约；发现正文与契约冲突时，先重写冲突内容再输出。',
    '初始条件只解释故事起点；剧情推进后以当前动态状态为准，不得用初始地点重置当前地点。',
    '开局性别只记录故事起点；发生转性术、身体变化或玩家明确要求后，允许更新 玩家·性别，并以更新后的当前状态继续叙事。',
    '秘密只代表客观真相；未被告知的 NPC 不得无故知晓。',
    '允许补充未定义细节，但补充内容不得与原文冲突。'
  ];
  const facts = unique([
    ...((contract.invariants || []).map(item => `- ${item}`)),
    initial.rank ? `- 开局忍阶: ${initial.rank}` : '',
    initial.gender ? `- 开局性别: ${initial.gender}` : '',
    initial.power_level ? `- 开局战力: ${initial.power_level}` : '',
    initial.affiliation ? `- 开局阵营: ${initial.affiliation}` : '',
    initial.public_identity ? `- 公开身份: ${initial.public_identity}` : '',
    initial.location ? `- 开局地点: ${initial.location}` : '',
    initial.goal ? `- 开局目标: ${initial.goal}` : ''
  ]);
  if (compact) {
    return `[玩家开局契约·当前有效条款]\n${rules.slice(0, 5).map(item => `- ${item}`).join('\n')}\n${facts.join('\n')}`;
  }
  const verbatim = unique([
    raw.persona ? `人设原文: ${raw.persona}` : '',
    raw.talent ? `天赋原文: ${raw.talent}` : '',
    background.description ? `背景原文: ${background.name ? `${background.name} - ` : ''}${background.description}` : '',
    raw.skill ? `能力原文: ${raw.skill}` : ''
  ]);
  return [
    '[玩家开局契约·系统级事实]',
    '## 执行规则',
    ...rules.map(item => `- ${item}`),
    facts.length ? `## 当前契约\n${facts.join('\n')}` : '',
    verbatim.length ? `## 玩家原文\n${verbatim.map(item => `- ${item}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

export function validateOpeningContractWrite(contract, path, value) {
  if (!contract) return { allowed: true };
  const canonicalPath = PROTECTED_PATH_ALIASES[path] || path;
  if (canonicalPath === '_opening_contract' || canonicalPath.startsWith('_opening_contract.')) {
    return { allowed: false, path: canonicalPath, attempted: value, reason: 'opening-contract-protected' };
  }
  const expected = contract.protected_fields?.[canonicalPath];
  if (expected === undefined) return { allowed: true };
  const same = JSON.stringify(expected) === JSON.stringify(value);
  return same
    ? { allowed: true }
    : { allowed: false, path: canonicalPath, expected, attempted: value, reason: 'opening-contract-protected' };
}

export { CONTRACT_VERSION };
