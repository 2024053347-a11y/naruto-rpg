import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { stateManager } from '../js/core/state-manager.js';
import { buildVariableUpdaterMessages } from '../js/core/variable-updater.js';
import { DEFAULT_VARIABLE_UPDATER_PRESET } from '../js/data/variable-updater-preset.js';
import { CANON_DATABASE } from '../js/data/canon-database.js';
import { attributeSystem } from '../js/systems/attribute-system.js';
import { equipmentSystem } from '../js/systems/equipment-system.js';
import {
  CUSTOM_TALENT_PLACEHOLDER,
  START_PRESET_V1_KEY,
  START_PRESET_V2_KEY,
  applyOpeningTemplate,
  buildOpeningState,
  calculateCombatLevel,
  collectOpeningStateRepairs,
  createOpeningDraft,
  initializeOpeningRuntime,
  loadOpeningPreset,
  migrateStartPresetV1,
  normalizeOpeningDraft,
  serializeOpeningPreset
} from '../js/systems/opening-draft.js';
import {
  createOpeningContract,
  deriveOpeningState,
  formatOpeningContractPrompt,
  resolveOpeningContract,
  validateOpeningContractWrite
} from '../js/systems/opening-contract.js';
import { buildOpeningPrompt } from '../js/systems/opening-prompt.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

const legacyPreset = {
  version: 1,
  choices: {
    name: '风间澪',
    persona: '沉着谨慎，左眼有旧伤。',
    difficulty: '中忍',
    gender: '假小子',
    background: '__custom_background__',
    customBackground: { name: '砂隐移民', description: '来自砂隐的傀儡师家庭。', location: '木叶西门' },
    talent: '__custom_talent__',
    customTalent: { description: '傀儡心算：能同时控制多条查克拉线。' },
    customSkill: { description: '风刃与傀儡线组合，但近身时难以展开。' },
    chakraNature: ['风', '土'],
    timeline: 'konoha_64'
  },
  attrs: { chakra: 9, spirit: 8, willpower: 10, speed: 11, luck: 7 },
  points: 0
};

test('v1 preset migrates non-destructively into structured v3', () => {
  const migrated = migrateStartPresetV1(legacyPreset);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.identity.name, '风间澪');
  assert.equal(migrated.identity.bodySetting, '女性身体');
  assert.equal(migrated.identity.presentation, '男性化');
  assert.equal(migrated.identity.background, '砂隐移民');
  assert.equal(migrated.campaign.difficulty, 'hard');
  assert.equal(migrated.campaign.timeline, 'konoha_64');
  assert.deepEqual(migrated.power.chakraNatures, ['风', '土']);
  assert.equal(migrated.talents.length, 1);
  assert.equal(migrated.talents[0].name, '傀儡心算');
  assert.equal(migrated.abilities.length, 1);
  assert.match(migrated.abilities[0].description, /傀儡线/);

  const fakeStorage = storage({ [START_PRESET_V1_KEY]: JSON.stringify(legacyPreset) });
  const loaded = loadOpeningPreset(fakeStorage);
  assert.equal(loaded.migrated, true);
  assert.ok(fakeStorage.getItem(START_PRESET_V1_KEY), 'v1 key must remain available for rollback');
});

test('ice release bloodline-heir defaults to the Mist Yuki clan while explicit origins win', () => {
  const inferred = createOpeningDraft('bloodline_heir', { identity: { name: '水无月澪' } });
  assert.equal(inferred.identity.background, '水无月一族（雪之一族）');
  assert.equal(inferred.campaign.affiliation, '雾隐村');
  assert.equal(inferred.campaign.location, '水之国·水无月一族隐居地');
  assert.ok(inferred.talents.some(item => item.type === 'kekkei_genkai' && item.name === '冰遁'));

  const explicit = createOpeningDraft('bloodline_heir', {
    identity: { name: '冰川澪', background: '木叶冰遁旁支' },
    campaign: { affiliation: '木叶隐村', location: '木叶北部族地' }
  });
  assert.equal(explicit.identity.background, '木叶冰遁旁支');
  assert.equal(explicit.campaign.affiliation, '木叶隐村');
  assert.equal(explicit.campaign.location, '木叶北部族地');
});

test('first-turn opening contract repairs restore missing explicit talents bloodlines and abilities only', () => {
  const draft = createOpeningDraft('custom', {
    identity: { name: '契约修复测试者' },
    talents: [
      { type: 'talent', name: '冰镜心算', rank: '先天', mastery: 30, description: '快速计算冰镜折射。', limitations: '精神疲劳时失效。' },
      { type: 'kekkei_genkai', name: '冰遁', rank: '初醒', mastery: 42, description: '融合水与风制造冰。', limitations: '高温环境消耗增加。' }
    ],
    abilities: [{
      type: 'jutsu', name: '冰遁·薄冰刃', rank: 'C', element: '冰', cost: 18,
      resourceType: '查克拉', power: 34, mastery: 26, description: '凝成薄刃。', limitations: '近身使用。'
    }]
  });
  const state = buildOpeningState(draft, stateManager.getDefaultState());
  state._opening_contract = createOpeningContract({ choices: draft, state });
  const removedKeys = [
    '技能·天赋·冰镜心算·名称',
    '技能·天赋·冰镜心算·等级',
    '技能·血继限界·冰遁·名称',
    '技能·血继限界·冰遁·描述',
    '技能·忍术·冰遁·薄冰刃·名称',
    '技能·忍术·冰遁·薄冰刃·消耗',
    '技能·忍术·冰遁·薄冰刃·描述'
  ];
  for (const key of removedKeys) delete state[key];
  state['技能·血继限界·冰遁·描述'] = '';
  state['技能·天赋·冰镜心算·熟练度'] = 77;

  const repairs = collectOpeningStateRepairs(state);
  const byKey = Object.fromEntries(repairs.map(update => [update.key, update]));
  for (const key of removedKeys) assert.ok(byKey[key], `missing repair for ${key}`);
  assert.equal(byKey['技能·天赋·冰镜心算·名称'].value, '冰镜心算');
  assert.match(byKey['技能·血继限界·冰遁·描述'].value, /限制：高温环境消耗增加/);
  assert.equal(byKey['技能·忍术·冰遁·薄冰刃·消耗'].value, 18);
  assert.match(byKey['技能·忍术·冰遁·薄冰刃·描述'].value, /限制：近身使用/);
  assert.equal(byKey['技能·天赋·冰镜心算·熟练度'], undefined, 'existing values must not be overwritten');
  assert.ok(repairs.every(update => update.op === '='));

  const laterState = { ...state, '系统·回合数': 2 };
  assert.deepEqual(collectOpeningStateRepairs(laterState), []);
});

test('legacy custom talent placeholder does not block AI-generated concrete talents', () => {
  const pendingPreset = JSON.parse(JSON.stringify(legacyPreset));
  pendingPreset.choices.customTalent.description = '请由AI根据角色经历生成适合的具体天赋';
  const migrated = migrateStartPresetV1(pendingPreset);
  assert.equal(migrated.talents[0].name, CUSTOM_TALENT_PLACEHOLDER);
  const state = buildOpeningState(migrated, stateManager.getDefaultState());
  const contract = createOpeningContract({ choices: migrated, state });
  const check = validateOpeningContractWrite(contract, 'skills.talents.傀儡心算', {
    name: '傀儡心算', rank: '先天', description: '同时控制多条查克拉线。'
  }, { turn: 1, op: 'set' });
  assert.equal(check.allowed, true);
  assert.match(buildOpeningPrompt({ state, contract, updaterEnabled: true }), /生成后必须替换该占位项/);
});

test('pending AI talent requirements override fill-mode category blocking on the opening turn', () => {
  const draft = createOpeningDraft('custom', {
    identity: { name: '待补全测试者' },
    campaign: { aiCompletionMode: 'fill' },
    talents: [
      { type: 'talent', name: '既有天赋', rank: '基础', mastery: 10, description: '玩家明确填写。' },
      { type: 'talent', name: CUSTOM_TALENT_PLACEHOLDER, rank: '待生成', mastery: 0, description: '请由AI再生成一个具体天赋和一个血继限界。' }
    ]
  });
  const state = buildOpeningState(draft, stateManager.getDefaultState());
  const contract = createOpeningContract({ choices: draft, state });
  assert.equal(validateOpeningContractWrite(contract, 'skills.talents.新生天赋', {}, { turn: 1, op: 'set' }).allowed, true);
  assert.equal(validateOpeningContractWrite(contract, 'skills.kekkei_genkai.新生血继', {}, { turn: 1, op: 'set' }).allowed, true);

  const messages = buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    compactState: state,
    userInput: buildOpeningPrompt({ state, contract, updaterEnabled: true }),
    narrativeResponse: '开场剧情已经开始。',
    openingContract: formatOpeningContractPrompt(contract)
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /系统强制开局待补全协议/);
  assert.match(prompt, /首回合必须[\s\S]*具体天赋或血继[\s\S]*替换/);
});

test('first-turn fill mode sends explicit talent and ability completion requirements', () => {
  const draft = createOpeningDraft('custom', {
    identity: { name: '空白补全测试者', background: '没落忍族' },
    campaign: { aiCompletionMode: 'fill' },
    power: { chakraNatures: ['水', '风'] },
    talents: [],
    abilities: []
  });
  const state = buildOpeningState(draft, stateManager.getDefaultState());
  const contract = createOpeningContract({ choices: draft, state });
  state._opening_contract = contract;
  const messages = buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    state,
    compactState: state,
    userInput: buildOpeningPrompt({ state, contract, updaterEnabled: true }),
    narrativeResponse: '开场剧情已经开始。',
    openingContract: formatOpeningContractPrompt(contract)
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /系统强制首回合补全协议/);
  assert.match(prompt, /必须写入至少一个完整的具体天赋或血继变量/);
  assert.match(prompt, /必须写入至少一个完整的具体初始能力变量/);
});

test('numbered custom talent combination expands into concrete talent entries', () => {
  const draft = normalizeOpeningDraft({
    talents: [{
      type: 'talent', name: CUSTOM_TALENT_PLACEHOLDER, rank: '自定义', mastery: 0,
      description: '1. 森罗万象眼：双眼融合写轮眼与白眼。 2. 仙人之躯：拥有强大生命力。 3. 金刚神躯：灵魂坚韧。 4. 天才武感：擅长体术。'
    }]
  });
  assert.deepEqual(draft.talents.map(item => item.name), ['森罗万象眼', '仙人之躯', '金刚神躯', '天才武感']);
  assert.equal(draft.talents.some(item => item.name === CUSTOM_TALENT_PLACEHOLDER), false);
});

test('v2 preset wins over v1 and normalization supplies stable defaults', () => {
  const v2 = createOpeningDraft('scientific', { identity: { name: '新卷' } });
  const fakeStorage = storage({
    [START_PRESET_V1_KEY]: JSON.stringify(legacyPreset),
    [START_PRESET_V2_KEY]: JSON.stringify(serializeOpeningPreset(v2))
  });
  const loaded = loadOpeningPreset(fakeStorage);
  assert.equal(loaded.migrated, false);
  assert.equal(loaded.draft.identity.name, '新卷');
  const normalized = normalizeOpeningDraft({ version: 2, identity: { name: '空白测试' }, campaign: { difficulty: 'unknown' } });
  assert.equal(normalized.campaign.difficulty, 'standard');
  assert.equal(normalized.campaign.aiCompletionMode, 'fill');
  assert.deepEqual(Object.keys(normalized.power.attributes), ['chakra', 'vitality', 'spirit', 'stamina', 'speed', 'luck']);
});

test('combat level is derived from final attributes and combat mastery', () => {
  const forged = createOpeningDraft('academy', { power: { combatLevel: '超S级' } });
  assert.equal(forged.power.combatLevel, 'E级', 'player-entered combat level must not override attributes');

  for (const [templateId, expected] of [
    ['academy', 'E级'], ['genin_team', 'C级'], ['chunin', 'B级'], ['anbu', 'A级']
  ]) {
    const draft = createOpeningDraft(templateId);
    const masteries = {
      ninjutsu: Math.max(0, ...draft.abilities.filter(item => item.type === 'jutsu').map(item => item.mastery)),
      taijutsu: Math.max(0, ...draft.abilities.filter(item => item.type === 'taijutsu').map(item => item.mastery)),
      genjutsu: Math.max(0, ...draft.abilities.filter(item => item.type === 'genjutsu').map(item => item.mastery))
    };
    assert.equal(draft.power.combatLevel, expected, `${templateId} should use the shared combat calculation`);
    assert.equal(draft.power.combatLevel, calculateCombatLevel(draft.power.attributes, masteries));
  }

  const trained = createOpeningDraft('custom', {
    power: {
      attributes: { chakra: 400, vitality: 400, spirit: 400, stamina: 400, speed: 100, luck: 20 }
    },
    abilities: [
      { type: 'jutsu', name: '高阶忍术', rank: 'A', mastery: 90, cost: 40, power: 100 }
    ]
  });
  assert.equal(calculateCombatLevel(trained.power.attributes), 'B级');
  assert.equal(trained.power.combatLevel, 'A级', 'high combat mastery should raise the shared rating');
});

test('scenario templates fill fields and explicit overrides remain authoritative', () => {
  const draft = createOpeningDraft('anbu', {
    identity: { name: '砂砾', publicIdentity: '砂隐药商' },
    campaign: { affiliation: '砂隐村', location: '风之国国境', month: 9, day: 17 }
  });
  assert.equal(draft.power.officialRank, '上忍');
  assert.equal(draft.campaign.affiliation, '砂隐村');
  assert.equal(draft.campaign.location, '风之国国境');
  const switched = applyOpeningTemplate(draft, 'missing_nin');
  assert.equal(switched.identity.name, '砂砾');
  assert.equal(switched.identity.publicIdentity, '流浪商旅');
  assert.equal(switched.campaign.aiCompletionMode, 'fill');
  assert.equal(switched.campaign.month, 9);
  assert.equal(switched.campaign.day, 17);
});

const completeDraft = createOpeningDraft('custom', {
  identity: {
    name: '秋津', physicalAge: 27, soulAge: 42, gender: '非二元', bodySetting: '女性身体',
    presentation: '中性', address: '只称名字', background: '铁之国移民', publicIdentity: '雇佣忍者',
    appearance: '银灰短发与黑色护腕。', personality: '谨慎但重诺。', secrets: '曾为根部外围线人。'
  },
  campaign: {
    timeline: 'konoha_67', affiliation: '无所属', location: '铁之国南关', difficulty: 'hard',
    goal: '护送证人抵达中立城', canonInvolvement: '边缘交汇', storyTone: '谍战', storyFocus: '护送与追踪',
    openingHook: '证人在交接前失踪。', aiCompletionMode: 'fill'
  },
  power: {
    officialRank: '特别上忍', combatLevel: 'A级',
    attributes: { chakra: 321, vitality: 432, spirit: 210, stamina: 345, speed: 120, luck: 33 },
    chakraNatures: ['风', '雷']
  },
  resources: { ryo: 880 },
  talents: [
    { type: 'talent', name: '瞬时测绘', rank: '熟练', mastery: 70, description: '记忆路线。', limitations: '需要亲眼观察。' },
    { type: 'kekkei_genkai', name: '磁遁', rank: '初醒', mastery: 40, description: '操纵细小金属。', limitations: '大质量目标无效。' }
  ],
  abilities: [
    { type: 'jutsu', name: '风遁·薄刃', rank: 'B', element: '风', cost: 30, power: 55, mastery: 72, description: '压缩风刃。', limitations: '狭窄处危险。' },
    { type: 'taijutsu', name: '短打', rank: 'C', element: '无', cost: 8, power: 38, mastery: 66, description: '贴身连击。', limitations: '' },
    { type: 'genjutsu', name: '回声迷途', rank: 'B', element: '阴', cost: 25, power: 30, mastery: 61, description: '扰乱方向感。', limitations: '对聋者无效。' },
    { type: 'support', name: '查克拉缝合', rank: 'C', element: '阳', cost: 20, power: 18, mastery: 58, description: '临时闭合伤口。', limitations: '不能再生组织。' }
  ],
  equipment: [
    { category: 'weapons', name: '查克拉短刀', quantity: 1, quality: '优秀', description: '传导风属性。', equippedSlot: 'weapon' },
    { category: 'armor', name: '轻型锁甲', quantity: 1, quality: '优秀', description: '隐藏在外衣下。', equippedSlot: 'armor' },
    { category: 'tools', name: '磁针匣', quantity: 1, quality: '优秀', description: '磁遁媒介。', equippedSlot: 'accessory1' },
    { category: 'consumables', name: '止血膏', quantity: 3, quality: '精良', description: '处理开放伤。', equippedSlot: '' }
  ],
  relationships: [
    { name: '千鹤', relation: '旧搭档', publicHistory: '曾共同完成三次边境护送。', secret: '千鹤知道根部线人的旧身份。', affection: 34, trust: 62, respect: 45 },
    { name: '灰原', relation: '债主', publicHistory: '提供过一次伪造通行证。', secret: '真正目的尚未公开。', affection: -8, trust: 12, respect: 20 }
  ]
});

test('v3 state mapping writes direct six attributes and every skill/item category as flat v5 keys', () => {
  const state = buildOpeningState(completeDraft, stateManager.getDefaultState());
  assert.deepEqual([
    state['属性·查克拉'], state['属性·生命力'], state['属性·精神力'],
    state['属性·体力'], state['属性·速度'], state['属性·幸运']
  ], [321, 432, 210, 345, 120, 33]);
  assert.equal(state['技能·忍术·风遁·薄刃·等级'], 'B');
  assert.equal(state['技能·忍术·风遁·薄刃·消耗'], 30);
  assert.equal(state['技能·忍术·风遁·薄刃·消耗资源'], '查克拉');
  assert.equal(state['技能·体术·短打·熟练度'], 66);
  assert.equal(state['技能·幻术·回声迷途·属性'], '阴');
  assert.equal(state['技能·支援·查克拉缝合·描述'].includes('限制'), true);
  assert.equal(state['技能·天赋·瞬时测绘·名称'], '瞬时测绘');
  assert.equal(state['技能·血继限界·磁遁·熟练度'], 40);
  assert.equal(state['物品·武器·查克拉短刀·数量'], 1);
  assert.equal(state['物品·防具·轻型锁甲·品质'], '优秀');
  assert.equal(state['物品·道具·磁针匣·描述'], '磁遁媒介。');
  assert.equal(state['物品·消耗品·止血膏·数量'], 3);
  assert.equal(state['技能·忍术·风遁·薄刃'], undefined, 'legacy object-valued skill keys must not be created');
});

test('runtime applies equipped bonuses through equipmentSystem and initializes detailed bonds before turn one', () => {
  const initialized = initializeOpeningRuntime(completeDraft, { stateManager, equipmentSystem, createOpeningContract });
  assert.equal(initialized['物品·已装备·武器'], '查克拉短刀');
  assert.equal(initialized['物品·已装备·防具'], '轻型锁甲');
  assert.equal(initialized['物品·已装备·饰品1'], '磁针匣');
  assert.equal(initialized['属性·速度'], 124, '优秀武器 applies floor(15 * 0.3) speed');
  assert.equal(initialized['属性·生命力'], 438, '优秀防具 applies +6 vitality');
  assert.equal(initialized['属性·幸运'], 35, '优秀忍具 applies +2 luck');
  const finalAttributes = {
    chakra: initialized['属性·查克拉'], vitality: initialized['属性·生命力'],
    stamina: initialized['属性·体力'], spirit: initialized['属性·精神力'],
    speed: initialized['属性·速度'], luck: initialized['属性·幸运']
  };
  assert.equal(initialized['玩家·战力等级'], calculateCombatLevel(finalAttributes, {
    ninjutsu: 72,
    taijutsu: 66,
    genjutsu: 61
  }));
  assert.equal(initialized._opening_contract.initial_conditions.power_level, initialized['玩家·战力等级']);
  assert.equal(initialized._relationships['千鹤'].role, '旧搭档');
  assert.equal(initialized._relationships['千鹤'].history[0].turn, 0);
  assert.match(initialized._relationships['千鹤'].inner_thoughts[0].summary, /根部线人/);
  assert.equal(initialized._opening_contract.version, 3);
});

test('deriveOpeningState reads v3 directly while legacy v1 contract resolution remains valid', () => {
  const overrides = deriveOpeningState(completeDraft, stateManager.getDefaultState());
  assert.equal(overrides['玩家·年龄'], 27);
  assert.equal(overrides['玩家·灵魂年龄'], 42);
  assert.equal(overrides['玩家·正式忍阶'], '特别上忍');
  assert.equal(overrides['属性·生命力'], 432);
  assert.equal(overrides['属性·体力'], 345);

  const legacy = resolveOpeningContract({
    '玩家·姓名': '旧卷', '玩家·个性': '谨慎', '玩家·出身': '木叶平民', '世界·地点': '木叶',
    _memory: { facts: '自定义初始技能: 旧术 - 只能雨天使用' }
  });
  assert.equal(legacy.version, 1);
  assert.match(legacy.raw.skill, /旧术/);
});

test('runtime power evaluation uses the same attributes and mastery calculation', () => {
  const draft = createOpeningDraft('genin_team');
  const state = buildOpeningState(draft, stateManager.getDefaultState());
  state['玩家·战力等级'] = '超S级';
  state['进度·忍术熟练度'] = 100;
  state['进度·体术熟练度'] = 100;
  state['进度·幻术熟练度'] = 100;
  state['进度·防御熟练度'] = 100;
  stateManager.restore(state);

  assert.equal(stateManager.get('玩家·战力等级'), 'B级', 'restored saves should be upgraded to the shared combat calculation immediately');
  assert.equal(attributeSystem.evaluatePowerLevel(), 'B级');
  assert.equal(stateManager.get('玩家·战力等级'), 'B级');

  stateManager.update([
    { key: '进度·忍术熟练度', op: '=', value: 0 },
    { key: '进度·体术熟练度', op: '=', value: 0 },
    { key: '进度·幻术熟练度', op: '=', value: 0 }
  ]);
  assert.equal(stateManager.get('玩家·战力等级'), 'C级', 'direct mastery changes should immediately refresh combat level');
});

test('strict, fill and expand modes produce distinct completion boundaries', () => {
  for (const mode of ['strict', 'fill', 'expand']) {
    const draft = normalizeOpeningDraft({ ...completeDraft, campaign: { ...completeDraft.campaign, aiCompletionMode: mode } });
    const state = buildOpeningState(draft, stateManager.getDefaultState());
    const contract = createOpeningContract({ choices: draft, state });
    const contractPrompt = formatOpeningContractPrompt(contract, { compact: true });
    const mainPrompt = buildOpeningPrompt({ state, contract, updaterEnabled: true });
    assert.match(contractPrompt, new RegExp(`AI补全模式: ${mode}`));
    assert.match(contractPrompt, /不得重复初始化或重新估值/);
    assert.match(mainPrompt, /六项属性、天赋、血继、能力、物品、装备槽和初始关系已经写入/);
    assert.match(mainPrompt, /后台变量更新模型负责本回合全部结构化记忆、任务与人物档案/);
    assert.match(mainPrompt, /主模型不得输出任何结构标签/);
  }
});

test('fill mode cannot overwrite explicit abilities or append into a nonblank category on opening turn', () => {
  const state = buildOpeningState(completeDraft, stateManager.getDefaultState());
  const contract = createOpeningContract({ choices: completeDraft, state });
  assert.equal(validateOpeningContractWrite(contract, 'skills.jutsu.风遁·薄刃.rank', 'S', { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'skills.jutsu.新生成忍术', {}, { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'player.rank', '忍校学生', { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'world_state.current_location', '木叶村', { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'skills.jutsu.新生成忍术', {}, { turn: 2, op: 'set' }).allowed, true);
  assert.equal(validateOpeningContractWrite(contract, 'world_state.current_location', '木叶村', { turn: 2, op: 'set' }).allowed, true);
  assert.equal(validateOpeningContractWrite(contract, 'skills.support.临时补充', {}, { turn: 1, op: 'set' }).allowed, false, 'support is also nonblank in this draft');

  const jutsuOnly = createOpeningDraft('custom', {
    identity: { name: '补空白测试' },
    campaign: { aiCompletionMode: 'fill' },
    abilities: [{ type: 'jutsu', name: '已有忍术', rank: 'D', element: '火', cost: 1, power: 1, mastery: 1, description: '', limitations: '' }]
  });
  const jutsuContract = createOpeningContract({ choices: jutsuOnly, state: buildOpeningState(jutsuOnly, stateManager.getDefaultState()) });
  assert.equal(validateOpeningContractWrite(jutsuContract, 'skills.genjutsu.空白类别补充', {}, { turn: 1, op: 'set' }).allowed, true);
});

test('opening turn protects bloodline identity but allows event-driven progression fields', () => {
  const state = buildOpeningState(completeDraft, stateManager.getDefaultState());
  const contract = createOpeningContract({ choices: completeDraft, state });

  assert.equal(validateOpeningContractWrite(contract, 'skills.kekkei_genkai.磁遁', {}, { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'skills.kekkei_genkai.磁遁.name', '木遁', { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'skills.kekkei_genkai.磁遁.mastery', 47, { turn: 1, op: 'set' }).allowed, true);
  assert.equal(validateOpeningContractWrite(contract, 'skills.kekkei_genkai.磁遁.description', '磁场控制更加稳定。', { turn: 1, op: 'set' }).allowed, true);
});

test('secondary updater receives the same v2 boundary after custom preset entries', () => {
  const state = buildOpeningState(completeDraft, stateManager.getDefaultState());
  const contract = createOpeningContract({ choices: completeDraft, state });
  const openingContract = formatOpeningContractPrompt(contract);
  const messages = buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    compactState: state,
    userInput: buildOpeningPrompt({ state, contract, updaterEnabled: true }),
    enrichedInput: '', narrativeResponse: '', openingContract
  });
  const contractIndex = messages.findLastIndex(message => message.content?.includes('玩家开局契约·系统级事实'));
  const presetIndex = messages.findIndex(message => message.content?.includes('你是“忍者手记”的二次变量更新器'));
  assert.ok(contractIndex > presetIndex, 'opening contract must be re-asserted after custom updater preset rules');
  assert.match(messages[contractIndex].content, /不得重复初始化或重新估值/);
  assert.match(messages.at(-1).content, /系统强制删除协议/);
});

test('prototype variants are URL-stable, keyboard-switchable and never persist real state', () => {
  const source = readFileSync(new URL('../js/ui/character-creator.js', import.meta.url), 'utf8');
  assert.match(source, /creatorPrototype/);
  assert.match(source, /variant-prev/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /input, textarea, select, \[contenteditable\]/);
  assert.match(source, /if \(this\._prototype\) return;/);
  assert.match(source, /未写入任何真实状态/);
  assert.doesNotMatch(source, /\.entry-list\s*\{[^}]*max-height/s);
  assert.doesNotMatch(source, /data-path=["']power\.combatLevel/);
  assert.match(source, /由六项属性与实战造诣统一评定/);
});

test('official rank is a prescribed select and imported free text is rejected', () => {
  const source = readFileSync(new URL('../js/ui/character-creator.js', import.meta.url), 'utf8');
  assert.match(source, /_selectField\('官方正式忍阶'/);
  assert.doesNotMatch(source, /_inputField\('官方正式忍阶'/);
  const normalized = normalizeOpeningDraft({
    version: 3,
    templateId: 'custom',
    power: { officialRank: '我自己输入的超影级' }
  });
  assert.equal(normalized.power.officialRank, '无正式忍阶');
});

test('opening date keeps a concrete valid month and day in the 12-by-30 world calendar', () => {
  const normalized = normalizeOpeningDraft({
    version: 3,
    templateId: 'custom',
    identity: { name: '日期测试' },
    campaign: { timeline: '__custom_timeline__', customYear: 67, month: 2, day: 31 }
  });
  assert.equal(normalized.campaign.month, 2);
  assert.equal(normalized.campaign.day, 30);

  const state = buildOpeningState(normalized, stateManager.getDefaultState());
  assert.equal(state['世界·年代'], '木叶67年');
  assert.equal(state['世界·时间'], '木叶67年2月30日·清晨');
  assert.equal(state['世界·月份'], 2);
  const contract = createOpeningContract({ choices: normalized, state });
  assert.equal(contract.initial_conditions.timeline, '木叶67年2月30日·清晨');
  assert.match(buildOpeningPrompt({ state, contract }), /时代：木叶67年2月30日·清晨/);
  assert.equal(validateOpeningContractWrite(contract, '世界·时间', '木叶67年3月1日·清晨', { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, 'world_state.calendar', '木叶67年3月1日·清晨', { turn: 1, op: 'set' }).allowed, false);
  assert.equal(validateOpeningContractWrite(contract, '世界·月份', 3, { turn: 1, op: 'set' }).allowed, false);
});

test('canon techniques survive opening normalization with their database identity', () => {
  const technique = CANON_DATABASE.getRecord('techniques', 'JT-DOJUTSU-0001');
  const selected = CANON_DATABASE.toStateSkill(technique, { mastery: 35 });
  const normalized = normalizeOpeningDraft({
    version: 3,
    templateId: 'custom',
    identity: { name: '忍术库测试' },
    abilities: [selected]
  });

  assert.equal(normalized.abilities[0].name, '畜生道');
  assert.equal(normalized.abilities[0].rank, '特');
  assert.equal(normalized.abilities[0].technique_id, 'JT-DOJUTSU-0001');
  assert.equal(normalized.abilities[0].source, 'canon');
  assert.equal(normalized.abilities[0].resourceType, '查克拉');

  const state = buildOpeningState(normalized, stateManager.getDefaultState());
  assert.equal(state['技能·忍术·畜生道·数据库ID'], 'JT-DOJUTSU-0001');
  assert.equal(state['技能·忍术·畜生道·来源'], 'canon');
});

test('all canon techniques keep their identity, type, rank and resource through opening normalization', () => {
  const selected = CANON_DATABASE.getRecords('techniques').map(technique => CANON_DATABASE.toStateSkill(technique, { mastery: 12 }));
  const normalized = normalizeOpeningDraft({ version: 3, templateId: 'custom', abilities: selected });
  const byId = new Map(normalized.abilities.map(ability => [ability.technique_id, ability]));
  assert.equal(byId.size, selected.length);
  for (const ability of selected) {
    const actual = byId.get(ability.technique_id);
    assert.ok(actual, `missing ${ability.technique_id}`);
    assert.equal(actual.source, 'canon');
    assert.equal(actual.type, ability.type);
    assert.equal(actual.rank, ability.rank);
    assert.equal(actual.resourceType, ability.resource_type);
  }
});

console.log(`\n${passed} opening draft regression tests passed.`);
