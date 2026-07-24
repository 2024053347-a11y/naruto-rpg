import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_MAIN_PRESET,
  DEFAULT_MAIN_PRESET_VERSION,
  invalidateMainPresetCache,
  getMainPreset,
  migrateMainPreset,
  resolvePresetMacros
} from '../js/data/default-preset.js';
import {
  DEFAULT_VARIABLE_UPDATER_PRESET,
  DEFAULT_VARIABLE_UPDATER_PRESET_VERSION,
  migrateVariableUpdaterPreset,
  saveVariableUpdaterPreset
} from '../js/data/variable-updater-preset.js';
import {
  assertNarrativeReviewEvidenceSafe,
  buildNarrativeReviewMessages,
  detectFutureSceneLeakage,
  getNarrativeReviewConfig,
  parseNarrativeReviewPreview,
  validateNarrativeReviewOutput
} from '../js/core/narrative-review.js';
import { MessagePipeline } from '../js/core/pipeline.js';
import {
  sanitizeVariableUpdaterOutput,
  validateVariableUpdaterOutput
} from '../js/core/variable-updater.js';
import { instructionParser } from '../js/core/instruction-parser.js';
import { generateMainVarInstructions } from '../js/data/var-schema.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

function assertVisibleReasoningContract(text, tag, label) {
  assert.match(
    text,
    new RegExp(`(?:必须|务必|请)[^。\\n]{0,120}(?:输出|写入)[^。\\n]{0,40}<${tag}>`, 'i'),
    `${label} must require a visible <${tag}> block`
  );
  assert.match(text, /不得写入受保护未来、NPC未公开秘密、证据编号和审校模型私有记录/);
}

function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(String(key), String(value)),
    removeItem: key => map.delete(key),
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    dump: () => Object.fromEntries(map)
  };
}

test('main preset is evidence-led and contains no unresolved runtime placeholders', () => {
  const text = DEFAULT_MAIN_PRESET.entries.map(entry => entry.content).join('\n');
  assert.match(text, /当前状态、开局契约/);
  assert.match(text, /世界书.*模型预训练/s);
  assert.match(text, /十几年/);
  assert.match(text, /玩家最近相关行动/);
  assert.match(text, /证据、时间线、玩家边界、连续性、因果与变量依据/);
  assertVisibleReasoningContract(text, 'reasoning', 'main preset');
  assert.doesNotMatch(text, /\$\{[^}]+\}/);
  assert.doesNotMatch(text, /SYSTEM INITIALIZATION|50亿美金|mainDatabase/);
});

test('all main-model rules are visible as editable preset entries', () => {
  const names = DEFAULT_MAIN_PRESET.entries.map(entry => entry.name);
  assert.ok(DEFAULT_MAIN_PRESET.entries.length >= 20, `expected at least 20 editable rules, got ${DEFAULT_MAIN_PRESET.entries.length}`);
  for (const required of [
    '记忆与连续性', '角色知识边界', '物品与忍术存在性', '关系成长与历练',
    '战斗资源与生命', '正文人称与玩家主权', '内部校验：证据与玩家边界',
    '内部校验：因果、角色与连续性', '内部校验：最终提交边界',
    '变量模型开启：正文职责', '变量模型关闭：物品与忍术变更', '变量模型关闭：结构标签'
  ]) {
    assert.ok(names.some(name => name.includes(required)), `missing editable rule entry: ${required}`);
  }
  const allText = DEFAULT_MAIN_PRESET.entries.map(entry => entry.content).join('\n');
  assert.match(allText, /equipment\.consumables[\s\S]*op["=:\s]+remove/);
  assert.match(allText, /skills\.jutsu[\s\S]*op["=:\s]+remove/);
  assert.match(allText, /日常闲聊[\s\S]*不得增加/);
});

test('preset mode entries are visible but only the matching variable mode is sent', () => {
  const on = resolvePresetMacros(DEFAULT_MAIN_PRESET.entries, { variableUpdaterEnabled: true });
  const off = resolvePresetMacros(DEFAULT_MAIN_PRESET.entries, { variableUpdaterEnabled: false });
  assert.ok(on.some(entry => entry.activation === 'variable_updater_enabled'));
  assert.ok(!on.some(entry => entry.activation === 'variable_updater_disabled'));
  assert.ok(off.some(entry => entry.activation === 'variable_updater_disabled'));
  assert.ok(!off.some(entry => entry.activation === 'variable_updater_enabled'));

  const onText = on.map(entry => entry.content).join('\n');
  const offText = off.map(entry => entry.content).join('\n');
  assert.match(onText, /绝对禁止输出任何结构标签/);
  assert.match(offText, /严格只调用一次主模型/);
  assert.match(offText, /始终输出 <memory>|必须输出一条 <memory>/);
  for (const tag of ['variable', 'combat', 'mission', 'relationship', 'memory', 'event']) {
    assert.match(offText, new RegExp(`<${tag}(?:[\\s>])`), `single-model preset missing <${tag}> contract`);
  }
  assertVisibleReasoningContract(onText, 'reasoning', 'main preset with variable updater');
  assertVisibleReasoningContract(offText, 'reasoning', 'single-model main preset');
});

test('main preset editor exposes activation conditions and pipeline no longer injects hidden main rules', () => {
  const editor = readFileSync(new URL('../js/ui/main-preset-editor.js', import.meta.url), 'utf8');
  const pipeline = readFileSync(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
  assert.match(editor, /PRESET_ACTIVATIONS/);
  assert.match(editor, /data-field="activation"/);
  assert.doesNotMatch(pipeline, /generateMainVarInstructions\(updaterEnabled\)/);
  assert.match(pipeline, /variableUpdaterEnabled: updaterEnabled/);
});

test('main preset migration replaces built-ins and preserves custom entries', () => {
  const migrated = migrateMainPreset({
    name: '用户预设',
    entries: [
      { id: 'nm_003', name: '旧内置', enabled: true, role: 'system', content: 'old' },
      { id: 'custom_7', name: '用户规则', enabled: true, role: 'system', content: 'keep me' }
    ]
  });
  assert.equal(migrated._version, DEFAULT_MAIN_PRESET_VERSION);
  assert.ok(migrated.entries.some(entry => entry.id === 'main_builtin_authority'));
  assert.ok(migrated.entries.some(entry => entry.id === 'custom_7' && entry.content === 'keep me'));
  assert.ok(!migrated.entries.some(entry => entry.id === 'nm_003'));
});

test('main preset migration creates a recoverable backup', () => {
  const old = JSON.stringify({ _version: 'old', entries: [{ id: 'nm_003', enabled: true, content: 'old' }] });
  const storage = createStorage({ naruto_main_preset: old });
  globalThis.localStorage = storage;
  invalidateMainPresetCache();
  const migrated = getMainPreset();
  assert.equal(migrated._version, DEFAULT_MAIN_PRESET_VERSION);
  const dump = storage.dump();
  const backupKey = dump.naruto_main_preset_backup_latest;
  assert.ok(backupKey?.startsWith('naruto_main_preset_backup_'));
  assert.equal(dump[backupKey], old);
});

test('variable updater migration replaces built-ins and preserves user entries', () => {
  const migrated = migrateVariableUpdaterPreset({
    name: '旧变量预设',
    version: 1,
    entries: [
      { id: 'variable_updater_system', name: '旧系统', role: 'system', content: 'old' },
      { id: 'custom_variable_rule', name: '用户补充', role: 'system', content: 'keep' }
    ]
  });
  assert.equal(migrated.version, DEFAULT_VARIABLE_UPDATER_PRESET_VERSION);
  assert.equal(migrated.entries.find(entry => entry.id === 'variable_updater_system').content, DEFAULT_VARIABLE_UPDATER_PRESET.entries[0].content);
  assert.ok(migrated.entries.some(entry => entry.id === 'custom_variable_rule' && entry.content === 'keep'));
});

test('variable updater refuses pretrained canon over state and worldbook', () => {
  const text = DEFAULT_VARIABLE_UPDATER_PRESET.entries.map(entry => entry.content).join('\n');
  assert.match(text, /世界书.*模型预训练知识/s);
  assert.match(text, /未来倒灌/);
  assert.match(text, /上一轮相关行动/);
  assert.match(text, /最后一件.*remove/s);
  assert.match(text, /已有战斗卡.*禁止重复生成整张战斗卡/s);
  assert.match(text, /原创忍者.*不得伪造 JT ID/s);
  assert.match(text, /七段自检/);
  assertVisibleReasoningContract(text, 'variable_thinking', 'variable updater preset');
});

test('variable updater sanitizer preserves both supported self-check tags', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '不应保留的普通前言',
    '<var_thinking>旧别名变量自检</var_thinking>',
    '<variable_thinking>七段变量自检</variable_thinking>',
    '<memory>{"summary":"本回合无额外变量变化，但保留连续性。"}</memory>'
  ].join('\n'));
  assert.match(cleaned, /<var_thinking>旧别名变量自检<\/var_thinking>/);
  assert.match(cleaned, /<variable_thinking>七段变量自检<\/variable_thinking>/);
  assert.match(cleaned, /<memory>/);
  assert.doesNotMatch(cleaned, /普通前言/);
});

test('variable updater combat contract matches the parser and settlement fields', () => {
  const presetText = DEFAULT_VARIABLE_UPDATER_PRESET.entries.map(entry => entry.content).join('\n');
  const mainText = DEFAULT_MAIN_PRESET.entries.map(entry => entry.content).join('\n');
  for (const text of [presetText, mainText]) {
    assert.match(text, /<combat state="player_turn">[\s\S]*action_name[\s\S]*damage_to_enemy/);
    assert.match(text, /<combat state="enemy_turn">[\s\S]*action_name[\s\S]*damage_to_player/);
  }

  const output = sanitizeVariableUpdaterOutput([
    '<variable_thinking>七、差异复检：输出清单：variable=0, mission=0, relationship=0, memory=1, combat=1, event=0。</variable_thinking>',
    '<memory>{"summary":"玩家使用分身术牵制敌人。"}</memory>',
    '<combat state="player_turn">{"actor":"player","action_name":"分身术","action_rank":"E","action_type":"忍术","resource_type":"查克拉","damage_to_enemy":0,"log":"牵制成功"}</combat>'
  ].join('\n'));
  const validation = validateVariableUpdaterOutput(output);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  const parsed = instructionParser.parse(output);
  assert.equal(parsed.combats.length, 1);
  assert.equal(parsed.combats[0].state, 'player_turn');
  assert.equal(parsed.combats[0].action_name, '分身术');
});

test('variable updater rejects tags that the instruction parser cannot consume', () => {
  const manifest = '<variable_thinking>七、差异复检：输出清单：variable=0, mission=0, relationship=0, memory=1, combat=0, event=0。</variable_thinking>';
  const invalid = [
    `${manifest}<memory>{"summary":"未闭合"}`,
    `${manifest}<memory kind="turn">{"summary":"含属性"}</memory>`,
    `${manifest}<memory>{bad json}</memory>`,
    `${manifest.replace('combat=0', 'combat=1')}<memory>{"summary":"战斗"}</memory><combat>{"state":"player_turn"}</combat>`,
    `${manifest.replace('combat=0', 'combat=1')}<memory>{"summary":"战斗"}</memory><combat state="player_turn">{bad json}</combat>`
  ];
  for (const output of invalid) {
    const cleaned = sanitizeVariableUpdaterOutput(output);
    assert.equal(validateVariableUpdaterOutput(cleaned).valid, false, output);
  }
});

test('variable updater rejects unknown paths and structurally empty operations', () => {
  const make = variable => sanitizeVariableUpdaterOutput([
    '<variable_thinking>七、差异复检：输出清单：variable=1, mission=0, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<memory>{"summary":"变量检查。"}</memory>',
    `<variable>${JSON.stringify(variable)}</variable>`
  ].join('\n'));
  for (const variable of [
    { path: 'totally.fake.path', op: 'set', value: 123 },
    { path: 'attributes.chakra_current', op: 'subtract', value: 10 },
    {},
    { path: '_meta.current_node_id', op: 'set', value: 'forged' }
  ]) {
    const result = validateVariableUpdaterOutput(make(variable));
    assert.equal(result.valid, false, JSON.stringify(variable));
  }
});

test('variable updater requires executable mission event and npc records', () => {
  const wrap = (manifest, tag) => sanitizeVariableUpdaterOutput([
    `<variable_thinking>七、差异复检：输出清单：${manifest}。</variable_thinking>`,
    '<memory>{"summary":"结构记录检查。"}</memory>',
    tag
  ].join('\n'));
  const state = { _missions: { active: {} }, _relationships: {} };
  const invalid = [
    wrap('variable=0, mission=1, relationship=0, memory=1, combat=0, event=0', '<mission>{"status":"active","title":"护送"}</mission>'),
    wrap('variable=0, mission=1, relationship=0, memory=1, combat=0, event=0', '<mission>{"id":"M1","status":"active","title":"护送"}</mission>'),
    wrap('variable=0, mission=0, relationship=0, memory=1, combat=0, event=1', '<event>{"status":"occurred","description":"事件发生"}</event>'),
    wrap('variable=0, mission=0, relationship=1, memory=1, combat=0, event=0', '<relationship>{"npc":"甲","combatant":true,"combat_stats":{"rank":"下忍","jutsu":[{"name":"分身术"}]}}</relationship>'),
    wrap('variable=0, mission=0, relationship=0, memory=1, combat=1, event=0', '<combat state="teleport">{}</combat>')
  ];
  for (const output of invalid) {
    const result = validateVariableUpdaterOutput(output, { state });
    assert.equal(result.valid, false, output);
  }
});

test('variable updater preset cannot discard the confirmed narrative macro', () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = createStorage();
  try {
    assert.throws(() => saveVariableUpdaterPreset({
      name: '坏预设',
      version: DEFAULT_VARIABLE_UPDATER_PRESET_VERSION,
      entries: [{ id: 'custom', name: '缺少正文', enabled: true, role: 'system', content: '只看状态' }]
    }), /narrative_response|最终正文/);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('variable updater rejects a declared mission when the top-level mission tag is missing', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '<variable_thinking>五、任务成长与地图：本轮已确认接取护送委托，需要新增任务并输出 <mission>。\n七、差异复检：准备写入新任务。</variable_thinking>',
    '<memory>{"summary":"玩家接下护送委托，下一回合应承接任务目标。"}</memory>'
  ].join('\n'));
  const result = validateVariableUpdaterOutput(cleaned);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /mission|任务/i);
});

test('variable updater accepts a declared mission when a real top-level mission tag exists', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '<variable_thinking>五、任务成长与地图：本轮已确认接取护送委托，需要新增任务。\n七、差异复检：输出清单：variable=0, mission=1, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<mission>{"id":"escort_tazuna","status":"active","rank":"C","title":"护送委托","objective":"护送委托人抵达目的地"}</mission>',
    '<memory>{"summary":"玩家接下护送委托，下一回合应承接任务目标。"}</memory>'
  ].join('\n'));
  const result = validateVariableUpdaterOutput(cleaned);
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('variable updater rejects a new active mission that omits every usable title field', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '<variable_thinking>五、任务成长与地图：已接取名为护送委托的新任务。\n七、差异复检：输出清单：variable=0, mission=1, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<mission>{"id":"escort_missing_title","status":"active","rank":"C","objective":"护送委托人抵达边境"}</mission>',
    '<memory>{"summary":"玩家接下护送委托。"}</memory>'
  ].join('\n'));
  const result = validateVariableUpdaterOutput(cleaned, { state: { _missions: { active: {} } } });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /标题|title/i);
});

test('variable updater permits a partial update for an already active mission', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '<variable_thinking>五、任务成长与地图：护送任务目标有进展。\n七、差异复检：输出清单：variable=0, mission=1, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<mission>{"id":"escort_existing","status":"active","objective":"抵达边境检查站"}</mission>',
    '<memory>{"summary":"护送队抵达边境检查站。"}</memory>'
  ].join('\n'));
  const result = validateVariableUpdaterOutput(cleaned, {
    state: { _missions: { active: { escort_existing: { id: 'escort_existing', title: '护送委托' } } } }
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('variable updater also rejects a declared new character record without relationship output', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '<variable_thinking>三、人物关系：新人物药师野乃宇已实际登场，需要新增人物关系档案。\n七、差异复检：准备写入人物关系。</variable_thinking>',
    '<memory>{"summary":"药师野乃宇在本轮登场并与玩家交谈。"}</memory>'
  ].join('\n'));
  const result = validateVariableUpdaterOutput(cleaned);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /relationship|人物关系/i);
});

test('variable updater rejects a new ninja relationship without rank and jutsu', () => {
  const cleaned = sanitizeVariableUpdaterOutput([
    '<variable_thinking>三、人物关系：新人物雾隐追忍已登场，需要建立战斗型人物档案。\n七、差异复检：输出清单：variable=0, mission=0, relationship=1, memory=1, combat=0, event=0。</variable_thinking>',
    '<relationship>{"npc":"雾隐追忍","combatant":true,"role":"追忍"}</relationship>',
    '<memory>{"summary":"雾隐追忍拦住了玩家。"}</memory>'
  ].join('\n'));
  const result = validateVariableUpdaterOutput(cleaned, { state: { _relationships: {} } });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /忍阶|忍术|战斗卡/);
});

test('variable updater accepts a nested complete combat card or an explicit civilian classification', () => {
  const ninja = sanitizeVariableUpdaterOutput([
    '<variable_thinking>三、人物关系：新人物雾隐追忍已登场并展示水遁。\n七、差异复检：输出清单：variable=0, mission=0, relationship=1, memory=1, combat=0, event=0。</variable_thinking>',
    '<relationship>{"npc":"雾隐追忍","combatant":true,"combat_stats":{"rank":"中忍","chakra_nature":["水"],"jutsu":[{"name":"水遁·水乱波","rank":"C","mastery":60}]}}</relationship>',
    '<memory>{"summary":"雾隐追忍施展水遁拦截玩家。"}</memory>'
  ].join('\n'));
  const civilian = sanitizeVariableUpdaterOutput([
    '<variable_thinking>三、人物关系：新人物茶店老板已登场，是非战斗人员。\n七、差异复检：输出清单：variable=0, mission=0, relationship=1, memory=1, combat=0, event=0。</variable_thinking>',
    '<relationship>{"npc":"茶店老板","combatant":false,"role":"商人"}</relationship>',
    '<memory>{"summary":"玩家与茶店老板交谈。"}</memory>'
  ].join('\n'));
  assert.equal(validateVariableUpdaterOutput(ninja, { state: { _relationships: {} } }).valid, true);
  assert.equal(validateVariableUpdaterOutput(civilian, { state: { _relationships: {} } }).valid, true);
});

test('first-turn fill mode must materialize blank talent and ability categories', () => {
  const state = {
    '系统·回合数': 1,
    skills: { talents: {}, kekkei_genkai: {}, jutsu: {}, taijutsu: {}, genjutsu: {}, support: {} },
    _opening_contract: { version: 3, completion_policy: { mode: 'fill' }, raw: { talents: [], abilities: [] } },
    _relationships: {}
  };
  const missing = sanitizeVariableUpdaterOutput([
    '<variable_thinking>四、技能物品：开局类别仍为空，但本轮不写入。\n七、差异复检：输出清单：variable=0, mission=0, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<memory>{"summary":"开场完成。"}</memory>'
  ].join('\n'));
  assert.equal(validateVariableUpdaterOutput(missing, { state }).valid, false);

  const complete = sanitizeVariableUpdaterOutput([
    '<variable_thinking>四、技能物品：补全开局天赋与初始忍术。\n七、差异复检：输出清单：variable=2, mission=0, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<variable>{"path":"skills.kekkei_genkai.冰遁","op":"set","value":{"name":"冰遁","rank":"初醒","mastery":35,"description":"融合水与风制造冰。"}}</variable>',
    '<variable>{"path":"skills.jutsu.冰遁·冰针","op":"set","value":{"name":"冰遁·冰针","rank":"D","element":"冰","cost":12,"power":22,"mastery":30,"description":"凝结冰针。"}}</variable>',
    '<memory>{"summary":"开局档案补全冰遁与基础冰遁忍术。"}</memory>'
  ].join('\n'));
  assert.equal(validateVariableUpdaterOutput(complete, { state }).valid, true);
});

test('first turn requires every unresolved opening relationship to be classified', () => {
  const state = {
    '系统·回合数': 1,
    _opening_contract: { version: 3, completion_policy: { mode: 'strict' }, raw: {} },
    _relationships: { 千鹤: { role: '旧搭档', affection: 10 } },
    skills: { talents: {}, kekkei_genkai: {}, jutsu: {}, taijutsu: {}, genjutsu: {}, support: {} }
  };
  const missing = sanitizeVariableUpdaterOutput([
    '<variable_thinking>三、人物关系：千鹤是开局旧搭档。\n七、差异复检：输出清单：variable=0, mission=0, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
    '<memory>{"summary":"千鹤在开场出现。"}</memory>'
  ].join('\n'));
  const missingResult = validateVariableUpdaterOutput(missing, { state });
  assert.equal(missingResult.valid, false);
  assert.match(missingResult.errors.join('\n'), /千鹤.*(?:初始化|分类)/);

  const classified = sanitizeVariableUpdaterOutput([
    '<variable_thinking>三、人物关系：千鹤是非战斗联络人。\n七、差异复检：输出清单：variable=0, mission=0, relationship=1, memory=1, combat=0, event=0。</variable_thinking>',
    '<relationship>{"npc":"千鹤","combatant":false,"role":"旧搭档"}</relationship>',
    '<memory>{"summary":"千鹤作为联络人在开场出现。"}</memory>'
  ].join('\n'));
  assert.equal(validateVariableUpdaterOutput(classified, { state }).valid, true);
});

test('agent writer prompts preserve the visible main reasoning contract', () => {
  const prompts = readFileSync(new URL('../js/core/agent-prompts.js', import.meta.url), 'utf8');
  assert.match(prompts, /WRITER:[\s\S]*<reasoning>/);
  assert.match(prompts, /WRITER_POLISH:[\s\S]*保留[^\n]*<reasoning>/);
});

test('secondary updater mode gives all structured tags to the updater', () => {
  const instruction = generateMainVarInstructions(true);
  for (const tag of ['var', 'combat', 'mission', 'relationship', 'memory', 'event']) {
    assert.match(instruction, new RegExp(`禁止[^\\n]*结构标签|<${tag}>`));
  }
  assert.match(instruction, /<reasoning>[^\n]*结构化推演|结构化推演[^\n]*<reasoning>/);
  assert.doesNotMatch(instruction, /绝对禁止输出思考过程/);
  assert.match(instruction, /世界书与存档高于模型常识/);
});

test('two-stage review defaults off and inherits the main model', () => {
  const config = getNarrativeReviewConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.backend, 'inherit');
  assert.equal(config.temperature, 0.25);
  assert.equal(config.timeoutMs, 0);
});

test('review prompt contains the actual evidence chain and candidate', () => {
  const messages = buildNarrativeReviewMessages({
    sourceMessages: [{ role: 'system', content: '世界书：甲仍然存活' }, { role: 'user', content: '玩家刚才丢弃苦无' }],
    candidateResponse: '<thinking>草稿</thinking>十几年后，甲使用了苦无。'
  });
  const text = messages.map(message => message.content).join('\n');
  assert.match(text, /E1 · system/);
  assert.match(text, /玩家刚才丢弃苦无/);
  assert.match(text, /十几年后/);
  assert.doesNotMatch(text, /<thinking>草稿<\/thinking>/);
  assert.match(text, /问题位置.*违反证据.*替换文本.*复检结果/s);
  assert.match(text, /<audit_internal>/);
  assert.match(text, /<final>/);
  assert.match(text, /尚未提交|非提交预览/);
});

test('review output becomes a hidden-audit, non-committed narrative preview', () => {
  assert.throws(() => validateNarrativeReviewOutput('只有正文，没有复检。'), /过短|审校记录/);
  const valid = '<audit_internal>引用 E1 检查当前年份；问题位置为首句，已按世界书替换并完成时间、连续性与玩家边界复检。</audit_internal><final>雨声压在木叶屋檐上，值守忍者合上名册。走廊尽头的脚步停在门外，来人没有擅自闯入，只隔着门板等待回应。</final>';
  assert.equal(validateNarrativeReviewOutput(valid), valid);
  const artifact = parseNarrativeReviewPreview(valid);
  assert.match(artifact.auditInternal, /引用 E1/);
  assert.match(artifact.displayText, /雨声压在木叶屋檐上/);
  assert.doesNotMatch(artifact.displayText, /引用 E1|问题位置|audit_internal/);
});

test('review quarantines FUTURE_ONLY scenes and rejects leakage outside reasoning', () => {
  const sourceMessages = [{
    role: 'system',
    content: `<<< FUTURE_ONLY_START current=K066-12-30 target=K067-01-01 days_until=1 >>>
场景标题: 修行归来
  - [EV-P2-RETURN-TEAM-01-01] order=10 role=setup | 归村人员在木叶正门完成登记。
<<< FUTURE_ONLY_END >>>`
  }];
  const safe = '<audit_internal>未来隔离清单包含 SCN 与 EV-P2-RETURN-TEAM-01-01；最终正文不得泄露。</audit_internal><final>清晨的木叶仍在处理昨日留下的文书。值班忍者核对完巡逻表，把尚未盖章的卷宗放回桌角，示意来访者稍后再问。</final>';
  const leaked = '<audit_internal>已检查未来区块，并核对当前日期、角色知识和所有结构标签。</audit_internal><final>清晨的木叶仍在处理文书。修行归来已经成为走廊里公开讨论的安排，值班忍者把归村名单递给来访者查看。</final>';
  assert.throws(
    () => assertNarrativeReviewEvidenceSafe(sourceMessages),
    error => error?.code === 'REVIEW_PROTECTED_FUTURE_EVIDENCE'
  );
  assert.equal(detectFutureSceneLeakage({ sourceMessages, text: safe }).leaked, false);
  assert.equal(detectFutureSceneLeakage({ sourceMessages, text: leaked }).leaked, true);
  assert.equal(validateNarrativeReviewOutput(safe, { sourceMessages }), safe);
  assert.throws(() => validateNarrativeReviewOutput(leaked, { sourceMessages }), /泄露未来场景/);
});

test('updater-owned tags are removed before the final response is applied', () => {
  const pipeline = new MessagePipeline({});
  const cleaned = pipeline._stripUpdaterOwnedTags('正文<memory>{"summary":"草稿"}</memory><variable>{}</variable>');
  assert.match(cleaned, /正文/);
  assert.doesNotMatch(cleaned, /<memory>|<variable>/);
});

test('pipeline uses an explicit manual review-preview transaction before commit', () => {
  const source = readFileSync(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
  assert.match(source, /await runNarrativeReviewPreview\s*\(/);
  assert.match(source, /toNarrativeReviewPreviewView\s*\(/);
  assert.match(source, /applyNarrativeReview\s*\(/);
  assert.match(source, /discardNarrativeReview\s*\(/);
  assert.match(source, /resolveNarrativeReviewArtifact\s*\(/);
  assert.doesNotMatch(source, /fullResponse\s*=\s*await runNarrativeReview\s*\(/);
  const resolveCallAt = source.indexOf('acceptedArtifact = await this._resolveNarrativeReview');
  const instructionAt = source.indexOf('const instructions = instructionParser.parse(instructionText)');
  const timelineAt = source.indexOf('await this.timelineSystem.createNode');
  assert.ok(resolveCallAt >= 0 && resolveCallAt < instructionAt && instructionAt < timelineAt);
  const helperAt = source.indexOf('async _resolveNarrativeReview');
  const previewAt = source.indexOf('await runNarrativeReviewPreview', helperAt);
  const applyAt = source.indexOf('applyNarrativeReview(', previewAt);
  const discardAt = source.indexOf('discardNarrativeReview(', previewAt);
  const acceptedAt = source.indexOf('resolveNarrativeReviewArtifact(', previewAt);
  assert.ok(helperAt >= 0 && helperAt < previewAt && previewAt < applyAt && previewAt < discardAt && applyAt < acceptedAt && discardAt < acceptedAt);
  assert.match(source, /if \(!reviewEnabled\) eventBus\.emit\('pipeline:chunk'/);
});

test('agent draft streaming is hidden while two-stage review is enabled', () => {
  const source = readFileSync(new URL('../js/ui/app-shell.js', import.meta.url), 'utf8');
  assert.match(source, /agent:stream[\s\S]*isNarrativeReviewEnabled[\s\S]*return;/);
});

console.log(`PASS ${passed} preset and narrative-review regression checks.`);
