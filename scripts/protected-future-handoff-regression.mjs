import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.customElements ||= { get: () => null };

const [
  { TurnEvidenceCompiler, renderEvidenceView },
  { AgentPipeline },
  {
    assertNoProtectedFutureLeak,
    captureProtectedFutureGuardContext,
    collectProtectedFutureMarkers
  },
  { instructionParser }
] = await Promise.all([
  import('../js/core/turn-evidence.js'),
  import('../js/core/agent-pipeline.js'),
  import('../js/core/protected-future-guard.js'),
  import('../js/core/instruction-parser.js')
]);

function stateAtK052() {
  return {
    _version: '5.0',
    _meta: { current_node_id: 'node_guard_parent', active_branch: 'branch_main' },
    _relationships: {},
    _missions: { active: {}, completed: {}, failed: {} },
    '系统·回合数': 7,
    '世界·时间': 'K052-01-01',
    '世界·年代': 'K052',
    '世界·地点': '木叶隐村',
    '玩家·姓名': '隔离测试忍者',
    '玩家·存活': '是',
    '玩家·公开身份': '木叶忍者'
  };
}

const compiler = new TurnEvidenceCompiler();
const packet = compiler.compile({ state: stateAtK052(), userInput: '观察当前村内局势' });
assert.ok(packet.protected_future?.id, 'fixture must expose a real protected future to Planner');

const future = packet.protected_future;
const futureScene = future.scenes[1];
const futureBeat = futureScene.beats.at(-1);
const futureOutcome = futureScene.outcomes[0];
const futureStateChange = futureScene.state_changes[0];
const futureStopCondition = futureScene.stop_condition;
const writerAllowedEvidence = compiler.project(packet, {
  audience: 'writer',
  includeOperationalIds: true
});
const futureGuard = captureProtectedFutureGuardContext({
  protectedFuture: future,
  allowedEvidence: writerAllowedEvidence
});

{
  const mutableFuture = structuredClone(future);
  const captured = captureProtectedFutureGuardContext({
    protectedFuture: mutableFuture,
    allowedEvidence: writerAllowedEvidence
  });
  mutableFuture.scenes[1].outcomes[0] = '另一个回合已经替换证据包';
  assert.equal(captured.protectedFuture.scenes[1].outcomes[0], futureOutcome,
    'auxiliary guard must freeze the scheduling turn instead of retaining a live packet');
  assert.ok(Object.isFrozen(captured.protectedFuture.scenes[1].outcomes));
}

{
  const planner = compiler.project(packet, { audience: 'planner' });
  assert.equal(planner.protected_future.id, future.id, 'Planner must retain protected future access');
  for (const audience of ['writer', 'updater', 'reviewer', 'npc']) {
    const view = compiler.project(packet, {
      audience,
      entityId: audience === 'npc' ? 'NPC-GUARD' : null,
      npcName: audience === 'npc' ? '测试上忍' : ''
    });
    const rendered = renderEvidenceView(view, { stage: audience });
    assert.equal(view.protected_future, null, `${audience} received protected_future`);
    for (const marker of [future.id, future.title, futureBeat.id, futureBeat.summary, futureOutcome, futureStateChange]) {
      assert.equal(rendered.includes(marker), false, `${audience} evidence leaked: ${marker}`);
    }
  }
}

{
  const markers = collectProtectedFutureMarkers(future).map(marker => marker.value);
  for (const expected of [
    future.id,
    future.title,
    futureScene.id,
    futureBeat.id,
    futureBeat.summary,
    futureOutcome,
    futureStateChange,
    futureStopCondition,
    future.end_state[0],
    future.reference_facts[0],
    futureScene.source_material[0].reference,
    futureScene.source_material[0].contribution
  ]) {
    assert.ok(markers.includes(expected), `missing protected marker: ${expected}`);
  }
  assert.equal(markers.includes(future.arc_id), false, 'shared ARC ids must not be hard blockers');
  assert.equal(markers.includes(futureScene.thread_id), false, 'shared THR ids must not be hard blockers');
}

{
  const agentPipeline = new AgentPipeline({
    pipeline: { _lastTurnEvidencePacket: packet },
    memorySystem: null
  });
  const leaks = [
    { beats: [{ id: 1, title: future.title }] },
    { beats: [{ id: 1, action: futureOutcome }] },
    { beats: [{ id: 1, result: futureStateChange }] },
    { beats: [{ id: 1, stopCondition: futureStopCondition }] },
    { beats: [{ id: 1, action: futureStopCondition.split('，')[0] }] },
    { beats: [{ id: futureBeat.id, summary: '看似无害的替代文字' }] }
  ];
  for (const value of leaks) {
    assert.throws(
      () => agentPipeline._assertPlannerOutputSafe(value, 'outliner'),
      error => error?.code === 'PROTECTED_FUTURE_LEAK'
    );
  }
  assert.doesNotThrow(() => agentPipeline._assertPlannerOutputSafe({
    arc: future.arc_id,
    thread: futureScene.thread_id,
    beats: [{ id: 1, action: '玩家留在当前训练场观察风向。', result: '当前没有发生时间跳跃。' }]
  }, 'outliner'));

  agentPipeline.runner.runParallel = async () => new Map([[
    'char-0-测试上忍',
    { success: true, data: { action: futureOutcome, dialogue: '按未来结果行动。', innerThought: '保密' } }
  ]]);
  const npcInputs = await agentPipeline._runCharacterAgents(
    stateAtK052(),
    '观察测试上忍',
    ['测试上忍'],
    { beats: [] }
  );
  assert.deepEqual(npcInputs, [], 'future-contaminated NPC output must not become observable input or memory');

  let writerReviews = null;
  agentPipeline.runner.run = async (_type, params) => {
    writerReviews = params.extraContext.reviews;
    return { _raw: '当前训练场一切平静。' };
  };
  await agentPipeline._writeDraft(
    stateAtK052(),
    '继续观察',
    { beats: [{ id: 1, action: '观察当前训练场' }] },
    new Map([
      ['safe', { success: true, data: { suggestions: ['保持当前时态'] } }],
      ['leaked', { success: true, data: { suggestions: [futureOutcome] } }]
    ]),
    [],
    []
  );
  assert.equal(JSON.stringify(writerReviews).includes(futureOutcome), false,
    'critic future detail must not cross the Writer handoff');
}

{
  const updaterInstructions = instructionParser.parse(
    `<memory>{"summary":"${futureOutcome}","facts":[],"clues":[]}</memory>`
  );
  assert.throws(
    () => assertNoProtectedFutureLeak(updaterInstructions, future, { stage: 'variable-updater' }),
    error => error?.code === 'PROTECTED_FUTURE_LEAK'
  );
  assert.throws(
    () => assertNoProtectedFutureLeak(`正文引用 ${futureBeat.id}`, future, { stage: 'writer-final' }),
    error => error?.code === 'PROTECTED_FUTURE_LEAK'
  );
}

{
  const [{ memorySystem }, { stateManager }] = await Promise.all([
    import('../js/systems/memory-system.js'),
    import('../js/core/state-manager.js')
  ]);
  stateManager.reset();
  const pending = `#1 当前训练场只发生了基础练习。\n${'已确认的当前互动。'.repeat(80)}`;
  stateManager.setSub('_memory', {
    _pendingCompressionText: pending,
    compressed_summary: '原有安全摘要',
    meta: { updated_at: null, sources: {} }
  });
  const contaminated = `${'模型自行补写了未到日期的结果，'.repeat(8)}${futureOutcome}。`;
  const client = { chat: async () => contaminated };

  assert.equal(await memorySystem.aiCompress(client, { futureGuard }), false,
    'future-contaminated compression must be rejected');
  const memory = stateManager.getSub('_memory');
  assert.equal(memory._pendingCompressionText, pending,
    'rejected compression must retain raw source for a later retry');
  assert.equal(memory.compressed_summary, '原有安全摘要');
}

{
  const [{ memorySystem }, { stateManager }] = await Promise.all([
    import('../js/systems/memory-system.js'),
    import('../js/core/state-manager.js')
  ]);
  stateManager.reset();
  stateManager.update([{ key: '系统·回合数', op: '=', value: 50 }]);
  const facts = Array.from({ length: 20 }, (_, index) => `#${index + 1} 当前已确认事实${index}`).join('\n');
  stateManager.setSub('_memory', {
    facts,
    compressed_summary: '整理前的安全摘要',
    meta: { updated_at: null, sources: {}, last_deep_turn: 0 }
  });
  const client = {
    chat: async () => JSON.stringify({
      facts: ['#1 当前已确认事实'],
      npc_digest: {},
      resolved_clues: [],
      pins: [],
      era_note: futureOutcome
    })
  };

  assert.equal(await memorySystem.deepConsolidate(client, { force: true, futureGuard }), false,
    'future-contaminated deep consolidation must be rejected');
  const memory = stateManager.getSub('_memory');
  assert.equal(memory.facts, facts, 'rejected deep consolidation must retain original facts');
  assert.equal(memory.compressed_summary, '整理前的安全摘要');
  assert.equal(memory.meta.last_deep_turn, 0, 'rejected deep consolidation must remain due for retry');
}

{
  const [{ MessagePipeline }, { stateManager }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/state-manager.js')
  ]);
  const originalGenerateRaw = globalThis.generateRaw;
  const contaminatedStage = `${'当前互动本应只归纳已经发生的训练与交谈。'.repeat(7)}${futureOutcome}。`;
  stateManager.reset();
  stateManager.setSub('_relationships', {
    守卫上忍: {
      pinned: true,
      summary_turn_counter: 10,
      summaries: [],
      grand_summary: '原有安全编年史',
      history: Array.from({ length: 10 }, (_, index) => ({
        turn: 10 - index,
        time: `第${10 - index}回合`,
        summary: `当前已发生互动${10 - index}`
      }))
    }
  });
  globalThis.generateRaw = async () => contaminatedStage;

  try {
    const pipeline = new MessagePipeline({});
    await pipeline._checkPinnedNpcSummaries(
      { backend: 'tavern', model: 'future-guard-test' },
      { futureGuard }
    );
    const relationship = stateManager.getSub('_relationships').守卫上忍;
    assert.deepEqual(relationship.summaries, [],
      'future-contaminated NPC stage summary must not be stored');
    assert.equal(relationship.summary_turn_counter, 10,
      'rejected NPC stage source history must remain due for retry');
    assert.equal(relationship.history.length, 10);
  } finally {
    if (originalGenerateRaw === undefined) delete globalThis.generateRaw;
    else globalThis.generateRaw = originalGenerateRaw;
  }
}

{
  const [{ MessagePipeline }, { stateManager }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/state-manager.js')
  ]);
  const originalGenerateRaw = globalThis.generateRaw;
  const safeStage = `${'双方在已经发生的任务中逐步建立信任，并记录了当时的承诺与分歧。'.repeat(4)}。`;
  const contaminatedGrand = `${'编年史正在合并已经发生的关系变化与尚未解决的当前矛盾。'.repeat(7)}${futureOutcome}。`;
  const originalSummaries = Array.from({ length: 10 }, (_, index) => ({
    turn: index + 1,
    time: `第${index + 1}回合`,
    content: safeStage,
    covered_turns: [index + 1]
  }));
  stateManager.reset();
  stateManager.setSub('_relationships', {
    守卫上忍: {
      pinned: true,
      summary_turn_counter: 0,
      summaries: originalSummaries,
      grand_summary: '原有安全编年史',
      history: []
    }
  });
  globalThis.generateRaw = async () => contaminatedGrand;

  try {
    const pipeline = new MessagePipeline({});
    await pipeline._checkPinnedNpcSummaries(
      { backend: 'tavern', model: 'future-guard-test' },
      { futureGuard }
    );
    const relationship = stateManager.getSub('_relationships').守卫上忍;
    assert.deepEqual(relationship.summaries, originalSummaries,
      'rejected NPC grand summary must retain all stage summaries for retry');
    assert.equal(relationship.grand_summary, '原有安全编年史');
  } finally {
    if (originalGenerateRaw === undefined) delete globalThis.generateRaw;
    else globalThis.generateRaw = originalGenerateRaw;
  }
}

{
  const [{ MessagePipeline }, { aiClient }, { stateManager }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js')
  ]);

  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern',
    model: 'future-guard-model',
    disableStreaming: false,
    aiCallPolicy: { strictSingleCall: true },
    variableUpdater: { enabled: false },
    narrativeReview: { enabled: false }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: false, mode: 'standard' }));
  localStorage.setItem('naruto_memory_config', JSON.stringify({
    aiCompressionEnabled: false,
    deepEnabled: false,
    npcSummaryEnabled: false,
    recallEnabled: false
  }));
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({ enabled: false }));

  const runtimeState = stateManager.getDefaultState();
  Object.assign(runtimeState, stateAtK052());
  stateManager.state = runtimeState;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;
  aiClient.configure({ backend: 'tavern', model: 'future-guard-model' });

  let requestCount = 0;
  let timelineWrites = 0;
  globalThis.generateRaw = async () => {
    requestCount++;
    return `训练场上的忍者忽然宣称：${futureOutcome}`;
  };
  const pipeline = new MessagePipeline({
    knowledgeBase: null,
    timelineSystem: { createNode: async () => { timelineWrites++; return { id: 'must-not-exist' }; } },
    uiRenderer: null,
    combatSystem: null,
    missionSystem: null,
    relationshipSystem: null,
    memorySystem: null,
    worldStateSystem: null
  });
  const turnBefore = stateManager.get('系统·回合数');
  try {
    await assert.rejects(
      pipeline.process('只观察当前训练场，不推进时间'),
      /受保护未来隔离失败/
    );
    assert.equal(requestCount, 1, 'future guard must not issue a retry or auxiliary request');
    assert.equal(timelineWrites, 0, 'contaminated final text must not reach timeline');
    assert.deepEqual(pipeline.getHistory(), [], 'contaminated final text must not reach history');
    assert.equal(stateManager.get('系统·回合数'), turnBefore, 'contaminated turn must not advance state');
  } finally {
    delete globalThis.generateRaw;
  }
}

console.log('protected-future-handoff-regression: OK');
