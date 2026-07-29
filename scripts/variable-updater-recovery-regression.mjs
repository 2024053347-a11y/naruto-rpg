import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as variableUpdater from '../js/core/variable-updater.js';
import { instructionParser } from '../js/core/instruction-parser.js';
import { SHINOBI_DAILY_EXAMPLE } from '../js/core/shinobi-daily.js';
import { buildCurrentStateEvidence } from '../js/core/turn-evidence.js';
import { DEFAULT_VARIABLE_UPDATER_PRESET } from '../js/data/variable-updater-preset.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.customElements ||= { get: () => null };

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function manifest(overrides = '') {
  return `<variable_thinking>七、差异复检：输出清单：variable=1, mission=0, relationship=0, memory=1, combat=0, event=0。${overrides}</variable_thinking>`;
}

function obligationManifest({ domainUpdates = [], npcs = {}, missions = {} } = {}) {
  const domains = Object.fromEntries(variableUpdater.VARIABLE_UPDATE_DOMAINS.map(({ id }) => [
    id,
    domainUpdates.includes(id) ? 'updated' : 'unchanged'
  ]));
  return `<update_manifest>${JSON.stringify({ domains, present_npcs: npcs, active_missions: missions })}</update_manifest>`;
}

async function prepareRecoveryPipeline(playerName) {
  globalThis.generateRaw = async () => '训练结束后，玩家收好忍具，准备离开第三训练场。';
  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern', model: 'recovery-main', disableStreaming: false,
    aiCallPolicy: { strictSingleCall: false },
    variableUpdater: { enabled: true, backend: 'inherit', model: 'recovery-updater' },
    narrativeReview: { enabled: false }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: false, mode: 'off' }));
  localStorage.setItem('naruto_memory_config', JSON.stringify({
    aiCompressionEnabled: false, deepEnabled: false, npcSummaryEnabled: false, recallEnabled: false
  }));
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({ enabled: false }));
  const [{ MessagePipeline }, { aiClient }, { stateManager }, { eventBus }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js'),
    import('../js/core/event-bus.js')
  ]);
  const state = stateManager.getDefaultState();
  state['玩家·姓名'] = playerName;
  state['玩家·存活'] = '是';
  state['世界·时间'] = 'K052-01-01';
  state['世界·年代'] = 'K052';
  state['世界·地点'] = '木叶第三训练场';
  state['系统·回合数'] = 7;
  state['进度·经验'] = 10;
  state._missions = { active: {}, completed: {}, failed: {} };
  state._relationships = {};
  stateManager.state = state;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;
  aiClient.configure({ backend: 'tavern', model: 'recovery-main' });
  return { MessagePipeline, state, stateManager, eventBus };
}

await test('validator accepts consecutive JSON objects that the instruction parser can execute', () => {
  const output = variableUpdater.sanitizeVariableUpdaterOutput([
    manifest(),
    '<variable>{"key":"进度·经验","op":"+","value":3}{"key":"进度·金钱","op":"+","value":2}</variable>',
    '<memory>{"summary":"完成训练并获得少量经验与报酬。"}</memory>'
  ].join('\n'));
  const parsed = instructionParser.parse(output);
  assert.equal(parsed.variables.length, 2, 'fixture must exercise parser multi-object recovery');
  const validation = variableUpdater.validateVariableUpdaterOutput(output);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

await test('existing non-combat NPC stays classified when a later relationship delta omits combat fields', () => {
  const output = variableUpdater.sanitizeVariableUpdaterOutput([
    manifest().replace('variable=1', 'variable=0').replace('relationship=0', 'relationship=1'),
    '<relationship>{"npc":"茶店老板","affection_change":2,"interaction":"玩家归还了借用的茶具。"}</relationship>',
    '<memory>{"summary":"玩家归还茶具，茶店老板的态度更友善。"}</memory>'
  ].join('\n'));
  const validation = variableUpdater.validateVariableUpdaterOutput(output, {
    state: { _relationships: { 茶店老板: { combatant: false, role: '商人', affection: 4 } } }
  });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

await test('relationship aliases and numeric strings validate, while non-finite deltas are rejected', () => {
  const valid = [
    manifest().replace('variable=1', 'variable=0').replace('relationship=0', 'relationship=1'),
    '<relationship>{"name":"春野樱","affection_delta":"5","combatant":false}</relationship>',
    '<memory>{"summary":"春野樱对玩家的态度发生变化。"}</memory>'
  ].join('\n');
  assert.equal(variableUpdater.validateVariableUpdaterOutput(valid).valid, true);

  const invalid = valid.replace('"5"', '"NaN"');
  const validation = variableUpdater.validateVariableUpdaterOutput(invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('\n'), /affection_delta.*有限数值/);
});

await test('updater evidence preserves the explicit non-combat classification', () => {
  const evidence = buildCurrentStateEvidence({
    _relationships: {
      茶店老板: { entity_id: 'NPC-TEA', role: '商人', combatant: false, affection: 4 }
    }
  });
  assert.equal(evidence.relationships.茶店老板.combatant, false);
});

await test('structured obligations require exact manifest coverage and executable NPC/task tags', () => {
  const updateObligations = {
    present_npcs: [{ npc: '春野樱', source: 'final_narrative', agent_inner_thought: '这次配合比预想中顺利。' }],
    active_missions: [{ id: 'escort_existing', title: '护送委托' }]
  };
  const valid = variableUpdater.sanitizeVariableUpdaterOutput([
    '<variable_thinking>关系与任务已逐项核对。</variable_thinking>',
    obligationManifest({
      domainUpdates: ['relationships'],
      npcs: { 春野樱: 'updated' },
      missions: { escort_existing: 'unchanged' }
    }),
    '<relationship>{"npc":"春野樱","combatant":false,"history":"共同完成训练。","inner_thoughts":"这次配合比预想中顺利。"}</relationship>',
    '<memory>{"summary":"玩家与春野樱完成训练；护送委托本轮没有进展。"}</memory>'
  ].join('\n'));
  const options = {
    state: {
      _relationships: { 春野樱: { combatant: false } },
      _missions: { active: { escort_existing: { id: 'escort_existing', title: '护送委托' } } }
    },
    updateObligations
  };
  assert.equal(variableUpdater.validateVariableUpdaterOutput(valid, options).valid, true);

  for (const [label, output, pattern] of [
    ['missing relationship', valid.replace(/<relationship>[\s\S]*?<\/relationship>\n?/, ''), /春野樱.*relationship/i],
    ['missing thought', valid.replace(',"inner_thoughts":"这次配合比预想中顺利。"', ''), /春野樱.*inner_thoughts/i],
    ['non-string history', valid.replace('"history":"共同完成训练。"', '"history":123'), /春野樱.*history/i],
    ['non-string thought', valid.replace('"inner_thoughts":"这次配合比预想中顺利。"', '"inner_thoughts":456'), /春野樱.*inner_thoughts/i],
    ['object history', valid.replace('"history":"共同完成训练。"', '"history":{"summary":"错误结构"}'), /春野樱.*history/i],
    ['array thought', valid.replace('"inner_thoughts":"这次配合比预想中顺利。"', '"inner_thoughts":["错误结构"]'), /春野樱.*inner_thoughts/i],
    ['missing mission tag', valid
      .replace('"escort_existing":"unchanged"', '"escort_existing":"updated"'), /escort_existing.*mission/i],
    ['progress without note', valid
      .replace('"escort_existing":"unchanged"', '"escort_existing":"updated"')
      .replace('<memory>', '<mission>{"id":"escort_existing","status":"progress","progress":{"current_step":2}}</mission>\n<memory>'), /escort_existing.*progress\.note/i]
  ]) {
    const result = variableUpdater.validateVariableUpdaterOutput(output, options);
    assert.equal(result.valid, false, label);
    assert.match(result.errors.join('\n'), pattern, label);
  }
});

await test('runtime prompt serializes update obligations and the machine-checkable manifest contract', () => {
  const messages = variableUpdater.buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    state: { '系统·回合数': 8, _relationships: {}, _missions: { active: {} } },
    compactState: { turn: 8 }, userInput: '与樱交谈', enrichedInput: '与樱交谈',
    narrativeResponse: '春野樱回应了玩家。',
    updateObligations: {
      present_npcs: [{ npc: '春野樱', source: 'final_narrative', agent_inner_thought: '我会再观察一下。' }],
      active_missions: [{ id: 'training', title: '基础训练' }]
    }
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /系统强制更新义务协议/);
  assert.match(prompt, /<update_manifest>/);
  assert.match(prompt, /"fixed_domains"/);
  assert.match(prompt, /"npc":"春野樱"/);
  assert.match(prompt, /"agent_inner_thought":"我会再观察一下。"/);
  assert.match(prompt, /"id":"training"/);
});

await test('safe recovery reports unmet structured obligations without discarding unrelated valid updates', () => {
  const updateObligations = {
    present_npcs: [{ npc: '春野樱' }],
    active_missions: [{ id: 'escort_existing', title: '护送委托' }]
  };
  const output = [
    '<variable_thinking>训练带来少量历练，任务未推进。</variable_thinking>',
    obligationManifest({
      domainUpdates: ['attributes'],
      npcs: { 春野樱: 'updated' },
      missions: { escort_existing: 'unchanged' }
    }),
    '<variable>{"path":"progression.exp","op":"add","value":3}</variable>',
    '<memory>{"summary":"玩家完成训练。"}</memory>'
  ].join('\n');
  const recovery = variableUpdater.filterSafeVariableUpdaterOutput(output, {
    state: {
      _relationships: { 春野樱: { combatant: false } },
      _missions: { active: { escort_existing: { id: 'escort_existing' } } }
    },
    updateObligations
  });
  assert.equal(instructionParser.parse(recovery.output).variables.length, 1);
  assert.equal(instructionParser.parse(recovery.output).memories.length, 1);
  assert.ok(recovery.appliedCount >= 2);
  assert.match(recovery.unmetObligations.join('\n'), /春野樱/);
});

await test('safe recovery drops non-executable NPC interaction fields', () => {
  const updateObligations = { present_npcs: [{ npc: '春野樱' }], active_missions: [] };
  const output = [
    '<variable_thinking>训练与互动均已核对。</variable_thinking>',
    obligationManifest({ domainUpdates: ['attributes', 'relationships'], npcs: { 春野樱: 'updated' } }),
    '<variable>{"path":"progression.exp","op":"add","value":2}</variable>',
    '<relationship>{"npc":"春野樱","history":{"summary":"错误结构"},"inner_thoughts":["错误结构"]}</relationship>',
    '<memory>{"summary":"玩家完成训练并与春野樱交谈。"}</memory>'
  ].join('\n');
  const recovery = variableUpdater.filterSafeVariableUpdaterOutput(output, {
    state: { _relationships: { 春野樱: { combatant: false } } },
    updateObligations
  });
  const parsed = instructionParser.parse(recovery.output);
  assert.equal(parsed.variables.length, 1);
  assert.equal(parsed.memories.length, 1);
  assert.equal(parsed.relationships.length, 0);
  assert.match(recovery.errors.join('\n'), /春野樱.*history/i);
  assert.match(recovery.unmetObligations.join('\n'), /春野樱/);
});

await test('safe recovery drops a nameless mission but keeps executable variables and memory', () => {
  assert.equal(typeof variableUpdater.filterSafeVariableUpdaterOutput, 'function');
  const output = variableUpdater.sanitizeVariableUpdaterOutput([
    manifest().replace('mission=0', 'mission=1'),
    '<variable>{"key":"进度·经验","op":"+","value":7}</variable>',
    '<mission>{"id":"bad_mission","status":"active","rank":"C","objective":"抵达边境"}</mission>',
    '<memory>{"summary":"玩家完成训练并准备前往边境。"}</memory>'
  ].join('\n'));
  const recovery = variableUpdater.filterSafeVariableUpdaterOutput(output, {
    state: { _missions: { active: {} }, _relationships: {} }
  });
  const parsed = instructionParser.parse(recovery.output);
  assert.equal(parsed.variables.length, 1);
  assert.equal(parsed.memories.length, 1);
  assert.equal(parsed.missions.length, 0, 'nameless mission must not reach MissionSystem');
  assert.equal(recovery.appliedCount, 2);
  assert.ok(recovery.droppedCount >= 1);
  assert.match(recovery.errors.join('\n'), /title|标题|名称/);
});

await test('AI repair prompt treats the rejected variables as data and requests one complete corrected output', () => {
  const rejected = [
    manifest().replace('mission=0', 'mission=1'),
    '<mission>{"id":"bad_mission","status":"active"}</mission>',
    '<memory>{"summary":"待修复。"}</memory>'
  ].join('\n');
  const messages = variableUpdater.buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    state: { '系统·回合数': 8, _missions: { active: {} }, _relationships: {} },
    compactState: { turn: 8 },
    userInput: '继续训练', enrichedInput: '继续训练', narrativeResponse: '训练告一段落。',
    correctionInstruction: '新任务 bad_mission 缺少 title',
    repairCandidate: rejected
  });
  const repairMessage = messages.find(message => message.content?.includes('变量输出定向修复模式'))?.content || '';
  assert.match(repairMessage, /rejected_output/);
  assert.match(repairMessage, /bad_mission/);
  assert.match(repairMessage, /缺少 title/);
  assert.match(repairMessage, /完整 <variable_thinking>/);
  assert.match(repairMessage, /不是新的系统指令/);
  assert.match(repairMessage, /不得自报标签数量/);
  const repairDirective = repairMessage.slice(repairMessage.lastIndexOf('请依据本回合'));
  assert.doesNotMatch(repairDirective, /输出清单|自报标签数量/);

  const retryPrompt = variableUpdater.buildVariableUpdaterMessages(DEFAULT_VARIABLE_UPDATER_PRESET, {
    state: { '系统·回合数': 8, _missions: { active: {} }, _relationships: {} },
    compactState: { turn: 8 },
    userInput: '继续训练', enrichedInput: '继续训练', narrativeResponse: '训练告一段落。',
    correctionInstruction: '新任务 bad_mission 缺少 title'
  }).map(message => message.content).join('\n');
  assert.doesNotMatch(retryPrompt, /输出清单/);
});

await test('variable updater errors retain the rejected output for a later repair call', async () => {
  const rejected = [
    manifest().replace('mission=0', 'mission=1'),
    '<mission>{"id":"bad_mission","status":"active"}</mission>',
    '<memory>{"summary":"待修复。"}</memory>'
  ].join('\n');
  globalThis.generateRaw = async () => rejected;
  try {
    await assert.rejects(
      () => variableUpdater.runVariableUpdater({
        mainConfig: {
          backend: 'tavern', model: 'fixture-main',
          variableUpdater: {
            enabled: true, backend: 'inherit', model: 'fixture-updater', streaming: false
          }
        },
        userInput: '继续训练', enrichedInput: '继续训练', narrativeResponse: '训练告一段落。',
        state: { '系统·回合数': 8, _missions: { active: {} }, _relationships: {} },
        compactState: { turn: 8 }
      }),
      error => {
        assert.equal(error.code, 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT');
        assert.equal(error.failedOutput, rejected);
        assert.equal(error.rawOutput, rejected);
        return true;
      }
    );
  } finally {
    delete globalThis.generateRaw;
  }
});

await test('recovery UI exposes regenerate, AI repair, safe subset, and skip actions', () => {
  const modalSource = readFileSync(new URL('../js/ui/modal.js', import.meta.url), 'utf8');
  const shellSource = readFileSync(new URL('../js/ui/app-shell.js', import.meta.url), 'utf8');
  for (const label of ['重新生成变量', '调用 AI 修复', '安全保留', '跳过变量并继续']) {
    assert.match(modalSource, new RegExp(label));
  }
  assert.match(shellSource, /pipeline:variable-recovery-decision/);
  assert.match(shellSource, /Modal\.variableRecovery/);
});

await test('secondary structured generation defaults to low temperature everywhere it is presented', () => {
  assert.equal(variableUpdater.VARIABLE_UPDATER_DEFAULT_TEMPERATURE, 0.2);
  const settingsSource = readFileSync(new URL('../js/ui/settings-panel.js', import.meta.url), 'utf8');
  assert.match(settingsSource, /varUpdaterTemperature[\s\S]{0,180}\?\?\s*VARIABLE_UPDATER_DEFAULT_TEMPERATURE/);
  assert.match(settingsSource, /Number\.isFinite\(temperature\)[\s\S]{0,180}:\s*VARIABLE_UPDATER_DEFAULT_TEMPERATURE/);
});

await test('pipeline keeps distinct relationship deltas for the same NPC while deduplicating aliases', async () => {
  const { MessagePipeline } = await import('../js/core/pipeline.js');
  const routed = [];
  const pipeline = new MessagePipeline({
    relationshipSystem: { processInstruction: relationship => routed.push(relationship) }
  });
  const affection = { npc: '茶店老板', affection_change: 2, interaction: '归还茶具' };
  const trust = { npc: '茶店老板', trust_change: 1, interaction: '守住约定' };
  pipeline._applyInstructions({
    variables: [], combats: [], missions: [], events: [], memories: [],
    relationships: [affection, trust],
    relationship: affection
  }, true);
  assert.deepEqual(routed, [affection, trust]);
});

await test('secondary updates keep current changes while recording a later plot plan', async () => {
  const { MessagePipeline, stateManager } = await prepareRecoveryPipeline('未来约定测试者');
  const futurePlan = '三日后在火影楼接受边境护送任务';
  const response = [
    manifest(' 当前训练收获已经发生；未来约定只作为待办写入记忆。'),
    '<variable>{"key":"进度·经验","op":"+","value":5}</variable>',
    `<memory>{"summary":"玩家完成本轮训练并获得经验；${futurePlan}，该约定尚未执行。"}</memory>`
  ].join('\n');
  const pipeline = new MessagePipeline({});
  pipeline._runSecondaryVariableUpdate = async () => {
    pipeline._lastTurnEvidencePacket = {
      current_plot: {
        date_relation: 'nearest_future',
        scenes: [{ id: 'SCN-BORDER-ESCORT', outcomes: [futurePlan] }]
      }
    };
    return response;
  };

  try {
    await pipeline.process('结束训练并记下约定');
    assert.equal(stateManager.get('进度·经验'), 15,
      'future-text detection must not reject unrelated current-turn state changes');
  } finally {
    delete globalThis.generateRaw;
  }
});

await test('runtime prompt forces a domain-by-domain diff even for legacy custom presets', () => {
  const messages = variableUpdater.buildVariableUpdaterMessages({
    name: '旧自定义预设',
    version: 1,
    entries: [{
      id: 'legacy_turn',
      name: '旧条目',
      enabled: true,
      role: 'user',
      content: '[已确认的最终正文]\n{{narrative_response}}'
    }]
  }, {
    state: { '系统·回合数': 8, _missions: { active: {} }, _relationships: {} },
    compactState: { turn: 8 },
    userInput: '结束训练',
    enrichedInput: '结束训练',
    narrativeResponse: '训练结束，玩家获得经验，并约定三日后领取任务。'
  });
  const prompt = messages.map(message => message.content).join('\n');
  assert.match(prompt, /系统强制反漏更协议/);
  assert.match(prompt, /领域：旧值 -> 最终正文事实 -> 新值/);
  assert.match(prompt, /已被接受、下达或确认的计划、约定、目标和期限[\s\S]*任务或 memory 待办/);
  assert.match(prompt, /<memory> 不能代替其他可执行标签/);
  assert.doesNotMatch(prompt, /输出清单：\s*variable=/);
});

await test('pipeline retries strict validation, then applies the safe subset and reports degradation', async () => {
  globalThis.generateRaw = async () => '训练结束后，玩家收好忍具，准备离开第三训练场。';
  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern', model: 'safe-fallback-main', disableStreaming: false,
    aiCallPolicy: { strictSingleCall: false },
    variableUpdater: { enabled: true, backend: 'inherit', model: 'safe-fallback-updater' },
    narrativeReview: { enabled: false }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: false, mode: 'off' }));
  localStorage.setItem('naruto_memory_config', JSON.stringify({
    aiCompressionEnabled: false, deepEnabled: false, npcSummaryEnabled: false, recallEnabled: false
  }));
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({ enabled: false }));

  const [{ MessagePipeline }, { aiClient }, { stateManager }, { eventBus }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js'),
    import('../js/core/event-bus.js')
  ]);
  const state = stateManager.getDefaultState();
  state['玩家·姓名'] = '降级恢复测试者';
  state['玩家·存活'] = '是';
  state['世界·时间'] = 'K052-01-01';
  state['世界·年代'] = 'K052';
  state['世界·地点'] = '木叶第三训练场';
  state['系统·回合数'] = 7;
  state['进度·经验'] = 10;
  state._missions = { active: {}, completed: {}, failed: {} };
  state._relationships = {};
  stateManager.state = state;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;
  aiClient.configure({ backend: 'tavern', model: 'safe-fallback-main' });

  const malformed = variableUpdater.sanitizeVariableUpdaterOutput([
    manifest(' 严格校验会因无名任务失败。').replace('mission=0', 'mission=1'),
    '<variable>{"key":"进度·经验","op":"+","value":7}</variable>',
    '<mission>{"id":"bad_mission","status":"active","rank":"C","objective":"抵达边境"}</mission>',
    '<memory>{"summary":"玩家完成训练，经验有所增长。"}</memory>'
  ].join('\n'));
  const recovery = variableUpdater.filterSafeVariableUpdaterOutput(malformed, { state });
  const routedMissions = [];
  const warnings = [];
  let completePayload = null;
  let updaterCalls = 0;
  const unsubscribeWarning = eventBus.on('pipeline:warning', ({ warning }) => warnings.push(warning));
  const unsubscribeComplete = eventBus.on('pipeline:complete', payload => { completePayload = payload; });
  const pipeline = new MessagePipeline({
    missionSystem: { processInstruction: mission => routedMissions.push(mission) }
  });
  pipeline._runSecondaryVariableUpdate = async () => {
    updaterCalls++;
    const error = new Error('变量自检与结构标签不一致：新任务 bad_mission 缺少 title');
    error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
    error.recovery = recovery;
    error.safeOutput = recovery.output;
    throw error;
  };

  try {
    await pipeline.process('结束训练');
    assert.equal(updaterCalls, 2, 'strict consistency retry must be retained');
    assert.equal(stateManager.get('进度·经验'), 17, 'valid subset must apply exactly once');
    assert.equal(routedMissions.length, 0, 'invalid task must never be routed');
    assert.match(warnings.join('\n'), /安全应用|安全保留|降级/);
    assert.match(completePayload?.thinkContent || '', /降级/);
    assert.match(completePayload?.thinkContent || '', /丢弃|舍弃/);
  } finally {
    unsubscribeWarning();
    unsubscribeComplete();
    delete globalThis.generateRaw;
  }
});

await test('secondary retries retain the last valid daily when a later attempt regresses', async () => {
  const { MessagePipeline, eventBus } = await prepareRecoveryPipeline('日报重试保留测试者');
  let updaterCalls = 0;
  const pipeline = new MessagePipeline({});
  pipeline._runSecondaryVariableUpdate = async () => {
    updaterCalls++;
    const error = new Error(`第 ${updaterCalls} 次变量输出未通过一致性校验`);
    error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
    if (updaterCalls === 1) error.shinobiDaily = SHINOBI_DAILY_EXAMPLE;
    throw error;
  };
  const off = eventBus.on('pipeline:variable-recovery-decision', () => ({ action: 'skip' }));
  try {
    const result = await pipeline.process('结束训练并查看当日报纸');
    assert.equal(updaterCalls, 2);
    assert.deepEqual(result.shinobiDaily, SHINOBI_DAILY_EXAMPLE);
  } finally {
    off();
    delete globalThis.generateRaw;
  }
});

await test('recovery UI keeps the final attempt error, output, counts, and recovery diagnostics together', async () => {
  const { MessagePipeline, eventBus } = await prepareRecoveryPipeline('恢复尝试一致性测试者');
  const attempts = [
    {
      message: '第一次失败：旧任务错误', failedOutput: '<memory>{"summary":"first"}</memory>',
      recovery: {
        output: '<memory>{"summary":"first-safe"}</memory>',
        keptOperationCount: 7, droppedOperationCount: 1,
        errors: ['first recovery error'], unmetObligations: ['first unmet']
      }
    },
    {
      message: '第二次失败：player_retreat 后续错误', failedOutput: '<memory>{"summary":"second"}</memory>',
      recovery: {
        output: '<memory>{"summary":"second-safe"}</memory>',
        keptOperationCount: 2, droppedOperationCount: 4,
        errors: ['second recovery error'], unmetObligations: ['second unmet']
      }
    }
  ];
  let call = 0;
  const pipeline = new MessagePipeline({});
  pipeline._runSecondaryVariableUpdate = async () => {
    const current = attempts[call++];
    const error = new Error(current.message);
    error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
    error.failedOutput = current.failedOutput;
    error.recovery = current.recovery;
    throw error;
  };
  const requests = [];
  const off = eventBus.on('pipeline:variable-recovery-decision', request => {
    requests.push(structuredClone(request));
    return { action: 'skip' };
  });
  try {
    await pipeline.process('继续');
    assert.equal(call, 2);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].attempt, 2);
    assert.match(requests[0].error, /第二次失败/);
    assert.doesNotMatch(requests[0].error, /第一次失败/);
    assert.equal(requests[0].failedOutput, attempts[1].failedOutput);
    assert.equal(requests[0].safeAppliedCount, 2);
    assert.equal(requests[0].safeDroppedCount, 4);
    assert.deepEqual(requests[0].recoveryErrors, ['second recovery error']);
    assert.deepEqual(requests[0].unmetObligations, ['second unmet']);
  } finally {
    off();
    delete globalThis.generateRaw;
  }
});

await test('final secondary failure can regenerate from the immutable turn context before commit', async () => {
  const { MessagePipeline, state, stateManager, eventBus } = await prepareRecoveryPipeline('变量重新生成测试者');
  const rejected = variableUpdater.sanitizeVariableUpdaterOutput([
    manifest(' 缺少任务标题。').replace('mission=0', 'mission=1'),
    '<variable>{"key":"进度·经验","op":"+","value":99}</variable>',
    '<mission>{"id":"bad_mission","status":"active","objective":"抵达边境"}</mission>',
    '<memory>{"summary":"错误候选不应落账。"}</memory>'
  ].join('\n'));
  const recovery = variableUpdater.filterSafeVariableUpdaterOutput(rejected, { state });
  const regenerated = [
    manifest(),
    '<variable>{"key":"进度·经验","op":"+","value":4}</variable>',
    '<memory>{"summary":"重新演算后只记录实际训练收获。"}</memory>'
  ].join('\n');
  const calls = [];
  const decisions = [];
  const pipeline = new MessagePipeline({});
  pipeline._runSecondaryVariableUpdate = async options => {
    calls.push(structuredClone(options));
    if (calls.length === 3) return regenerated;
    const error = new Error('变量自检与结构标签不一致：新任务 bad_mission 缺少 title');
    error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
    error.recovery = recovery;
    error.safeOutput = recovery.output;
    error.failedOutput = rejected;
    throw error;
  };
  const off = eventBus.on('pipeline:variable-recovery-decision', request => {
    decisions.push(structuredClone(request));
    return { action: 'regenerate' };
  });
  try {
    await pipeline.process('结束训练');
    assert.equal(decisions.length, 1, 'second failed attempt must ask for a recovery action');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].correctionInstruction, '');
    assert.equal(calls[2].repairCandidate, '');
    assert.equal(stateManager.get('进度·经验'), 14, 'rejected safe subset must not apply before regeneration');
  } finally {
    off();
    delete globalThis.generateRaw;
  }
});

await test('final secondary failure can send the rejected output and validation error to AI repair', async () => {
  const { MessagePipeline, state, stateManager, eventBus } = await prepareRecoveryPipeline('变量AI修复测试者');
  const rejected = variableUpdater.sanitizeVariableUpdaterOutput([
    manifest(' 清单与错误任务不一致。').replace('mission=0', 'mission=1'),
    '<variable>{"key":"进度·经验","op":"+","value":88}</variable>',
    '<mission>{"id":"bad_mission","status":"active","objective":"抵达边境"}</mission>',
    '<memory>{"summary":"待修复的错误候选。"}</memory>'
  ].join('\n'));
  const recovery = variableUpdater.filterSafeVariableUpdaterOutput(rejected, { state });
  const repaired = [
    manifest(),
    '<variable>{"key":"进度·经验","op":"+","value":6}</variable>',
    '<memory>{"summary":"AI 修复后保留合法的训练收获。"}</memory>'
  ].join('\n');
  const calls = [];
  const decisions = [];
  const pipeline = new MessagePipeline({});
  pipeline._runSecondaryVariableUpdate = async options => {
    calls.push(structuredClone(options));
    if (calls.length === 3) return repaired;
    const error = new Error('变量自检与结构标签不一致：新任务 bad_mission 缺少 title');
    error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
    error.recovery = recovery;
    error.safeOutput = recovery.output;
    error.failedOutput = rejected;
    throw error;
  };
  const off = eventBus.on('pipeline:variable-recovery-decision', request => {
    decisions.push(structuredClone(request));
    return { action: 'repair' };
  });
  try {
    await pipeline.process('结束训练');
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].canRepair, true);
    assert.equal(decisions[0].failedOutput, rejected);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].repairCandidate, rejected);
    assert.match(calls[2].correctionInstruction, /缺少 title/);
    assert.equal(stateManager.get('进度·经验'), 16, 'only repaired output may reach state mutation');
  } finally {
    off();
    delete globalThis.generateRaw;
  }
});

console.log(`\nvariable-updater-recovery-regression: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('Failed checks:');
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.error?.message || failure.error}`);
  process.exitCode = 1;
}
