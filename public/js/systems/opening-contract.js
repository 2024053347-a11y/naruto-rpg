import { CUSTOM_TALENT_PLACEHOLDER, isCustomTalentPlaceholder, normalizeOpeningDraft } from './opening-draft.js';

const CONTRACT_VERSION = 3;

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
  if (Number(choices?.version) >= 2) {
    const draft = normalizeOpeningDraft(choices);
    const attrs = draft.power.attributes;
    return {
      '玩家·姓名': draft.identity.name,
      '玩家·年龄': draft.identity.physicalAge,
      '玩家·灵魂年龄': draft.identity.soulAge,
      '玩家·性别': draft.identity.gender,
      '玩家·忍阶': draft.power.officialRank,
      '玩家·正式忍阶': draft.power.officialRank,
      '玩家·战力等级': draft.power.combatLevel,
      '玩家·所属村': draft.campaign.affiliation,
      '玩家·出身': draft.identity.background,
      '玩家·查克拉属性': draft.power.chakraNatures,
      '玩家·个性': draft.identity.personality,
      '玩家·公开身份': draft.identity.publicIdentity,
      '玩家·当前目标': draft.campaign.goal,
      '世界·地点': draft.campaign.location,
      '属性·查克拉': attrs.chakra,
      '属性·当前查克拉': attrs.chakra,
      '属性·生命力': attrs.vitality,
      '属性·当前生命力': attrs.vitality,
      '属性·精神力': attrs.spirit,
      '属性·当前精神力': attrs.spirit,
      '属性·体力': attrs.stamina,
      '属性·当前体力': attrs.stamina,
      '属性·速度': attrs.speed,
      '属性·幸运': attrs.luck
    };
  }

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
  if (Number(choices?.version) >= 2) return createOpeningContractV2(choices, state);

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
    version: 1,
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
      timeline: text(state['世界·时间'] || state['世界·年代'])
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
      timeline: text(state['世界·时间'] || state['世界·年代']),
      goal
    },
    goals: unique([goal]),
    secrets,
    mutable_fields: ['玩家·性别'],
    protected_fields: protectedFields
  };
}

function createOpeningContractV2(choices, state) {
  const draft = normalizeOpeningDraft(choices);
  const identity = draft.identity;
  const campaign = draft.campaign;
  const abilityFacts = draft.abilities.map(item => `${item.name}（${item.rank}，${item.description || '无描述'}${item.limitations ? `；限制：${item.limitations}` : ''}）`);
  const concreteTalents = draft.talents.filter(item => !isCustomTalentPlaceholder(item.name));
  const pendingTalents = draft.talents.filter(item => isCustomTalentPlaceholder(item.name));
  const talentFacts = concreteTalents.map(item => `${item.name}（${item.rank}，${item.description || '无描述'}${item.limitations ? `；限制：${item.limitations}` : ''}）`);
  const itemFacts = draft.equipment.map(item => `${item.name}×${item.quantity}（${item.category}/${item.quality}${item.equippedSlot ? `，已装备${item.equippedSlot}` : ''}）`);
  const relationshipFacts = draft.relationships.map(item => `${item.name}：${item.relation || '关系未定义'}；公开经历：${item.publicHistory || '未填写'}`);
  const secrets = unique([
    identity.secrets,
    ...draft.relationships.map(item => item.secret)
  ]);
  const protectedFields = {};
  for (const key of ['玩家·姓名', '玩家·出身']) {
    if (state[key] !== undefined && state[key] !== null && text(state[key])) protectedFields[key] = state[key];
  }

  return {
    version: CONTRACT_VERSION,
    revision: 1,
    created_at: new Date().toISOString(),
    raw: {
      identity: { ...identity },
      campaign: { ...campaign },
      power: { ...draft.power, attributes: { ...draft.power.attributes }, chakraNatures: [...draft.power.chakraNatures] },
      talents: draft.talents.map(item => ({ ...item })),
      abilities: draft.abilities.map(item => ({ ...item })),
      equipment: draft.equipment.map(item => ({ ...item })),
      relationships: draft.relationships.map(item => ({ ...item })),
      resources: { ...draft.resources },
      timeline: text(state['世界·时间'] || state['世界·年代'])
    },
    invariants: unique([
      identity.appearance ? `固定外貌设定: ${identity.appearance}` : '',
      identity.personality ? `核心性格: ${identity.personality}` : '',
      identity.bodySetting ? `身体设定: ${identity.bodySetting}` : '',
      identity.presentation ? `外在呈现: ${identity.presentation}` : '',
      identity.address ? `偏好称呼: ${identity.address}` : '',
      identity.background ? `出身: ${identity.background}` : '',
      ...talentFacts.map(item => `玩家明确天赋/血继: ${item}`),
      ...pendingTalents.map(item => `待AI结构化的自定义天赋要求: ${item.description || '由AI生成具体天赋'}`),
      ...abilityFacts.map(item => `玩家明确能力: ${item}`),
      ...itemFacts.map(item => `玩家明确资产: ${item}`),
      ...relationshipFacts.map(item => `玩家明确羁绊: ${item}`)
    ]),
    initial_conditions: {
      gender: text(state['玩家·性别']),
      body_setting: identity.bodySetting,
      presentation: identity.presentation,
      address: identity.address,
      physical_age: identity.physicalAge,
      soul_age: identity.soulAge,
      rank: text(state['玩家·忍阶']),
      official_rank: text(state['玩家·正式忍阶']),
      power_level: text(state['玩家·战力等级']),
      affiliation: text(state['玩家·所属村']),
      public_identity: text(state['玩家·公开身份']),
      location: text(state['世界·地点']),
      timeline: text(state['世界·时间'] || state['世界·年代']),
      goal: campaign.goal
    },
    story_preferences: {
      canon_involvement: campaign.canonInvolvement,
      tone: campaign.storyTone,
      focus: campaign.storyFocus,
      opening_hook: campaign.openingHook
    },
    completion_policy: {
      mode: campaign.aiCompletionMode,
      explicit_talents: concreteTalents.map(item => ({ type: item.type === 'kekkei_genkai' ? 'kekkei_genkai' : 'talents', name: item.name })),
      explicit_abilities: draft.abilities.map(item => ({ type: item.type, name: item.name })),
      explicit_equipment: draft.equipment.map(item => ({ category: item.category, name: item.name, equippedSlot: item.equippedSlot })),
      explicit_relationships: draft.relationships.map(item => item.name)
    },
    goals: unique([campaign.goal]),
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
      raw: Number(existing.version) >= 2
        ? {
            ...(existing.raw || {}),
            identity: { ...(existing.raw?.identity || {}) },
            campaign: { ...(existing.raw?.campaign || {}) },
            power: { ...(existing.raw?.power || {}), attributes: { ...(existing.raw?.power?.attributes || {}) } },
            talents: Array.isArray(existing.raw?.talents) ? existing.raw.talents : [],
            abilities: Array.isArray(existing.raw?.abilities) ? existing.raw.abilities : [],
            equipment: Array.isArray(existing.raw?.equipment) ? existing.raw.equipment : [],
            relationships: Array.isArray(existing.raw?.relationships) ? existing.raw.relationships : []
          }
        : { ...(existing.raw || {}), background: { ...(existing.raw?.background || {}) } },
      invariants: (Array.isArray(existing.invariants) ? existing.invariants : []).map(item => (
        String(item).includes(CUSTOM_TALENT_PLACEHOLDER)
          ? String(item).replace('玩家明确天赋/血继:', '待AI结构化的自定义天赋要求:')
          : item
      )),
      goals: Array.isArray(existing.goals) ? existing.goals : [],
      secrets: Array.isArray(existing.secrets) ? existing.secrets : [],
      story_preferences: { ...(existing.story_preferences || {}) },
      completion_policy: {
        ...(existing.completion_policy || {}),
        explicit_talents: (existing.completion_policy?.explicit_talents || []).filter(item => (
          !isCustomTalentPlaceholder(typeof item === 'string' ? item : item?.name)
        ))
      },
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
  const identity = raw.identity || {};
  const story = contract.story_preferences || {};
  const completion = contract.completion_policy || {};
  const initial = contract.initial_conditions || {};
  const redactSecrets = (value) => (contract.secrets || []).reduce(
    (result, secret) => result.replace(secret, '[秘密信息已隐藏]'),
    text(value)
  );
  if (audience === 'npc') {
    const publicFacts = unique([
      redactSecrets(raw.persona || identity.personality) ? `- 玩家可观察性格: ${redactSecrets(raw.persona || identity.personality)}` : '',
      identity.appearance ? `- 玩家可观察外貌: ${redactSecrets(identity.appearance)}` : '',
      identity.presentation ? `- 玩家外在呈现: ${identity.presentation}` : '',
      identity.address ? `- 玩家偏好称呼: ${identity.address}` : '',
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
  if (Number(contract.version) >= 2) {
    const modeRules = {
      strict: '首次开局使用严格档案：不得为玩家新增初始能力、天赋、血继、物品、装备或既有羁绊，也不得替玩家填补未填写的人设。',
      fill: '首次开局只可补全完全空白的类别；任何已有玩家条目的类别均视为已定义，不得新增同类初始条目，更不得覆盖、改名、删除或弱化玩家条目。',
      expand: '首次开局可添加与档案相容的辅助细节和初始条目，但不得覆盖、改名、删除或弱化任何玩家条目。'
    };
    rules.push(modeRules[completion.mode] || modeRules.fill);
    rules.push('上述补全模式只约束首次开局生成；后续剧情中实际发生的学习、消耗、装备、遗忘和关系变化仍按当前事件正常更新。');
    rules.push('六项属性、明确能力、物品、装备和初始关系已由本地系统写入状态；AI 不得重复初始化或重新估值。');
  }
  const facts = unique([
    ...((contract.invariants || []).map(item => `- ${item}`)),
    initial.rank ? `- 开局忍阶: ${initial.rank}` : '',
    initial.gender ? `- 开局性别: ${initial.gender}` : '',
    initial.body_setting ? `- 身体设定: ${initial.body_setting}` : '',
    initial.presentation ? `- 外在呈现: ${initial.presentation}` : '',
    initial.address ? `- 偏好称呼: ${initial.address}` : '',
    initial.power_level ? `- 开局战力: ${initial.power_level}` : '',
    initial.affiliation ? `- 开局阵营: ${initial.affiliation}` : '',
    initial.public_identity ? `- 公开身份: ${initial.public_identity}` : '',
    initial.location ? `- 开局地点: ${initial.location}` : '',
    initial.goal ? `- 开局目标: ${initial.goal}` : '',
    story.canon_involvement ? `- 原作介入: ${story.canon_involvement}` : '',
    story.tone ? `- 故事基调: ${story.tone}` : '',
    story.focus ? `- 故事重点: ${story.focus}` : '',
    story.opening_hook ? `- 开场钩子: ${story.opening_hook}` : '',
    completion.mode ? `- AI补全模式: ${completion.mode}` : ''
  ]);
  if (compact) {
    const compactRules = Number(contract.version) >= 2 ? rules : rules.slice(0, 5);
    return `[玩家开局契约·当前有效条款]\n${compactRules.map(item => `- ${item}`).join('\n')}\n${facts.join('\n')}`;
  }
  const verbatim = unique([
    raw.persona ? `人设原文: ${raw.persona}` : '',
    raw.talent ? `天赋原文: ${raw.talent}` : '',
    background.description ? `背景原文: ${background.name ? `${background.name} - ` : ''}${background.description}` : '',
    raw.skill ? `能力原文: ${raw.skill}` : '',
    identity.appearance ? `外貌原文: ${identity.appearance}` : '',
    identity.personality ? `性格原文: ${identity.personality}` : '',
    identity.secrets ? `秘密原文: ${identity.secrets}` : ''
  ]);
  return [
    '[玩家开局契约·系统级事实]',
    '## 执行规则',
    ...rules.map(item => `- ${item}`),
    facts.length ? `## 当前契约\n${facts.join('\n')}` : '',
    verbatim.length ? `## 玩家原文\n${verbatim.map(item => `- ${item}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

function validateOpeningEntryWrite(contract, path, value, context = {}) {
  if (Number(contract?.version) < 2 || Number(context.turn) > 1) return null;
  const op = context.op || 'set';
  const mode = contract.completion_policy?.mode || 'fill';
  const isReplacement = ['set', '=', 'assign', 'remove', 'delete'].includes(op);
  if (!isReplacement) return null;

  const rawIdentity = contract.raw?.identity || {};
  const rawCampaign = contract.raw?.campaign || {};
  const rawPower = contract.raw?.power || {};
  const explicitScalars = new Set([
    rawIdentity.name ? '玩家·姓名' : '', rawIdentity.name ? 'player.name' : '',
    rawIdentity.physicalAge !== '' ? '玩家·年龄' : '', rawIdentity.physicalAge !== '' ? 'player.age' : '',
    rawIdentity.soulAge !== '' ? '玩家·灵魂年龄' : '', rawIdentity.soulAge !== '' ? 'player.soul_age' : '',
    rawIdentity.gender ? '玩家·性别' : '', rawIdentity.gender ? 'player.gender' : '',
    rawIdentity.background ? '玩家·出身' : '', rawIdentity.background ? 'player.background' : '',
    rawIdentity.personality ? '玩家·个性' : '', rawIdentity.personality ? 'player.personality' : '',
    rawIdentity.publicIdentity ? '玩家·公开身份' : '', rawIdentity.publicIdentity ? 'player.public_identity' : '',
    rawCampaign.affiliation ? '玩家·所属村' : '',
    rawCampaign.location ? '世界·地点' : '', rawCampaign.location ? 'world_state.current_location' : '',
    rawCampaign.goal ? '玩家·当前目标' : '', rawCampaign.goal ? 'player.current_goal' : '',
    rawCampaign.difficulty ? '玩家·难度' : '', rawCampaign.difficulty ? 'player.difficulty' : '',
    rawCampaign.timeline ? '世界·年代' : '', rawCampaign.timeline ? 'world_state.timeline' : '',
    rawCampaign.month && rawCampaign.day ? '世界·时间' : '', rawCampaign.month && rawCampaign.day ? 'world_state.calendar' : '',
    rawCampaign.month ? '世界·月份' : '', rawCampaign.month ? 'world_state.month' : '',
    rawPower.officialRank ? '玩家·忍阶' : '', rawPower.officialRank ? '玩家·正式忍阶' : '',
    rawPower.officialRank ? 'player.rank' : '', rawPower.officialRank ? 'player.official_rank' : '',
    rawPower.combatLevel ? '玩家·战力等级' : '',
    rawPower.chakraNatures?.length ? '玩家·查克拉属性' : '', rawPower.chakraNatures?.length ? 'player.chakra_nature' : '',
    contract.raw?.resources?.ryo !== undefined ? '进度·金钱' : '',
    contract.raw?.resources?.ryo !== undefined ? 'equipment.ryo' : '',
    contract.raw?.resources?.ryo !== undefined ? 'progression.ryo' : ''
  ].filter(Boolean));
  if (explicitScalars.has(path)) {
    return { allowed: false, path, attempted: value, reason: 'opening-explicit-field-protected' };
  }

  const attributes = [
    'attributes.chakra', 'attributes.chakra_current', 'attributes.vitality', 'attributes.vitality_current',
    'attributes.stamina', 'attributes.stamina_current', 'attributes.spirit', 'attributes.spirit_current',
    'attributes.speed', 'attributes.luck',
    '属性·查克拉', '属性·当前查克拉', '属性·生命力', '属性·当前生命力',
    '属性·体力', '属性·当前体力', '属性·精神力', '属性·当前精神力', '属性·速度', '属性·幸运'
  ];
  if (attributes.includes(path)) {
    return { allowed: false, path, attempted: value, reason: 'opening-local-attributes-protected' };
  }

  const explicitSkills = [
    ...(contract.completion_policy?.explicit_abilities || []),
    ...(contract.completion_policy?.explicit_talents || []).map(entry => typeof entry === 'string' ? { type: 'talents', name: entry } : entry)
  ];
  const typeFlat = { jutsu: '忍术', taijutsu: '体术', genjutsu: '幻术', support: '支援', talents: '天赋', kekkei_genkai: '血继限界' };
  const matchesSkill = entry => path === `skills.${entry.type}.${entry.name}`
    || path.startsWith(`skills.${entry.type}.${entry.name}.`)
    || path === `技能·${typeFlat[entry.type]}·${entry.name}`
    || path.startsWith(`技能·${typeFlat[entry.type]}·${entry.name}·`);
  const explicitSkillMatch = explicitSkills.some(matchesSkill);
  const mutableSkillProgress = /\.(mastery|description)$/.test(path) || /·(熟练度|描述)$/.test(path);
  if (explicitSkillMatch && mutableSkillProgress) return { allowed: true };
  if (explicitSkillMatch) {
    return { allowed: false, path, attempted: value, reason: 'opening-explicit-skill-protected' };
  }
  const hasPendingTalentRequirement = (contract.raw?.talents || []).some(item => isCustomTalentPlaceholder(item?.name))
    || (contract.invariants || []).some(item => String(item).includes('待AI结构化的自定义天赋要求'));
  const pendingNested = path.match(/^skills\.(talents|kekkei_genkai)\.([^.]+)/);
  const pendingFlat = path.match(/^技能·(天赋|血继限界)·(.+?)(?:·|$)/);
  const pendingName = pendingNested?.[2] || pendingFlat?.[2] || '';
  if (hasPendingTalentRequirement && pendingName && !isCustomTalentPlaceholder(pendingName)) {
    return { allowed: true, reason: 'opening-pending-talent-completion' };
  }
  if (/^skills\.(jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai)$/.test(path)) {
    const rootCategory = path.slice('skills.'.length);
    if (mode === 'strict' || explicitSkills.some(entry => entry.type === rootCategory)) {
      return { allowed: false, path, attempted: value, reason: 'opening-skill-category-not-blank' };
    }
  }
  const skillCategory = path.match(/^skills\.(jutsu|taijutsu|genjutsu|support|talents|kekkei_genkai)\./)?.[1]
    || Object.entries(typeFlat).find(([, flat]) => path.startsWith(`技能·${flat}·`))?.[0];
  if (skillCategory && (mode === 'strict' || (mode === 'fill' && explicitSkills.some(entry => entry.type === skillCategory)))) {
    return { allowed: false, path, attempted: value, reason: 'opening-skill-category-not-blank' };
  }

  const explicitEquipment = contract.completion_policy?.explicit_equipment || [];
  const itemFlat = { weapons: '武器', armor: '防具', tools: '道具', consumables: '消耗品' };
  const matchesItem = entry => path === `equipment.${entry.category}.${entry.name}`
    || path.startsWith(`equipment.${entry.category}.${entry.name}.`)
    || path === `物品·${itemFlat[entry.category]}·${entry.name}`
    || path.startsWith(`物品·${itemFlat[entry.category]}·${entry.name}·`);
  if (explicitEquipment.some(matchesItem)) {
    return { allowed: false, path, attempted: value, reason: 'opening-explicit-equipment-protected' };
  }
  if (path.startsWith('equipment.equipped.') && explicitEquipment.some(entry => entry.equippedSlot)) {
    return { allowed: false, path, attempted: value, reason: 'opening-equipped-slots-protected' };
  }
  const itemCategory = path.match(/^equipment\.(weapons|armor|tools|consumables)\./)?.[1]
    || Object.entries(itemFlat).find(([, flat]) => path.startsWith(`物品·${flat}·`))?.[0];
  if (itemCategory && (mode === 'strict' || (mode === 'fill' && explicitEquipment.some(entry => entry.category === itemCategory)))) {
    return { allowed: false, path, attempted: value, reason: 'opening-equipment-category-not-blank' };
  }
  return null;
}

export function validateOpeningContractWrite(contract, path, value, context = {}) {
  if (!contract) return { allowed: true };
  const canonicalPath = PROTECTED_PATH_ALIASES[path] || path;
  if (canonicalPath === '_opening_contract' || canonicalPath.startsWith('_opening_contract.')) {
    return { allowed: false, path: canonicalPath, attempted: value, reason: 'opening-contract-protected' };
  }
  const expected = contract.protected_fields?.[canonicalPath];
  if (expected === undefined) {
    return validateOpeningEntryWrite(contract, canonicalPath, value, context) || { allowed: true };
  }
  const same = JSON.stringify(expected) === JSON.stringify(value);
  return same
    ? { allowed: true }
    : { allowed: false, path: canonicalPath, expected, attempted: value, reason: 'opening-contract-protected' };
}

export { CONTRACT_VERSION };
