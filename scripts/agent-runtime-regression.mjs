import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.customElements ||= { get: () => null };

const [
  { AgentRunner },
  { AgentPipeline },
  agentManifestModule,
  { MessagePipeline },
  { aiClient },
  { stateManager }
] = await Promise.all([
  import('../js/core/agent-runner.js'),
  import('../js/core/agent-pipeline.js'),
  import('../js/core/agent-manifests.js'),
  import('../js/core/pipeline.js'),
  import('../js/core/ai-client.js'),
  import('../js/core/state-manager.js')
]);

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function after(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

await test('agent stages run without an internal deadline', async () => {
  assert.equal('AGENT_TIMEOUTS' in agentManifestModule, false, 'legacy stage deadlines must be removed');
  let cancelCalls = 0;
  let receivedOptions = null;
  const runner = new AgentRunner({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) }
  });
  runner._models = { main: 'test-agent', critic: 'test-agent' };
  runner._mainClient = {
    isConfigured: () => true,
    async chatStream(_messages, options, onChunk) {
      receivedOptions = options;
      await after(40);
      onChunk?.('{"beats":[]}');
      return '{"beats":[]}';
    },
    cancel: () => { cancelCalls++; }
  };
  const result = await runner.run('outliner', {
    state: {}, userInput: '继续', taskPrompt: '生成大纲', onChunk: () => {}
  });
  assert.deepEqual(result, { beats: [] });
  assert.equal(receivedOptions.timeout, 0, '0 is the explicit no-timeout contract');
  assert.equal(receivedOptions.max_tokens, 0, '0 tells compatible providers to omit an Agent output cap');
  assert.equal(cancelCalls, 0);
});

await test('manual cancellation still aborts an unbounded agent stage', async () => {
  let cancelCalls = 0;
  const runner = new AgentRunner({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) }
  });
  runner._models = { main: 'test-agent', critic: 'test-agent' };
  runner._mainClient = {
    isConfigured: () => true,
    chatStream: () => new Promise(() => {}),
    cancel: () => { cancelCalls++; }
  };
  const pending = runner.run('outliner', {
    state: {}, userInput: '继续', taskPrompt: '生成大纲', onChunk: () => {}
  }).then(() => 'resolved', error => error);
  await after(0);
  runner.abort(new Error('manual cancel'));
  const outcome = await Promise.race([pending, after(120, 'still-pending')]);
  assert.ok(outcome instanceof Error, 'manual cancellation must reject the stage');
  assert.match(outcome.message, /manual cancel/);
  assert.equal(cancelCalls, 1);
});

await test('parallel agent batches default to one in-flight model call and preserve result order', async () => {
  const runner = new AgentRunner({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) }
  });
  let active = 0;
  let peak = 0;
  runner.run = async (_type, params) => {
    active++;
    peak = Math.max(peak, active);
    await after(params.delay);
    active--;
    return params.value;
  };

  const results = await runner.runParallel([
    { type: 'critic-realism', key: 'first', params: { delay: 30, value: 'A' } },
    { type: 'critic-character', key: 'second', params: { delay: 5, value: 'B' } },
    { type: 'critic-style', key: 'third', params: { delay: 1, value: 'C' } }
  ]);

  assert.equal(peak, 1, 'default Agent model concurrency must be one');
  assert.deepEqual([...results.keys()], ['first', 'second', 'third']);
  assert.deepEqual([...results.values()].map(result => result.data), ['A', 'B', 'C']);
});

await test('parallel agent batches honor an explicit bounded concurrency', async () => {
  const runner = new AgentRunner({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    maxConcurrency: 2
  });
  let active = 0;
  let peak = 0;
  runner.run = async (_type, params) => {
    active++;
    peak = Math.max(peak, active);
    await after(params.delay);
    active--;
    return params.value;
  };

  const results = await runner.runParallel([
    { type: 'critic-realism', key: 'slow', params: { delay: 30, value: 1 } },
    { type: 'critic-character', key: 'fast', params: { delay: 1, value: 2 } },
    { type: 'critic-style', key: 'last', params: { delay: 1, value: 3 } }
  ]);

  assert.equal(peak, 2);
  assert.deepEqual([...results.keys()], ['slow', 'fast', 'last']);
});

await test('manual cancellation rejects a parallel batch before queued agents start', async () => {
  const runner = new AgentRunner({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) }
  });
  runner._models = { main: 'test-agent', critic: 'test-agent' };
  let started = 0;
  runner._criticClient = {
    isConfigured: () => true,
    chat: () => {
      started++;
      return new Promise(() => {});
    },
    cancel() {}
  };

  const pending = runner.runParallel([
    { type: 'critic-realism', key: 'first', params: { state: {}, taskPrompt: '一' } },
    { type: 'critic-character', key: 'queued', params: { state: {}, taskPrompt: '二' } }
  ]).then(() => 'resolved', error => error);
  await after(0);
  runner.abort(new Error('stop queued batch'));
  const outcome = await Promise.race([pending, after(120, 'still-pending')]);

  assert.ok(outcome instanceof Error, 'batch cancellation must reject promptly');
  assert.match(outcome.message, /stop queued batch/);
  assert.equal(started, 1, 'queued model calls must not start after cancellation');
});

await test('agent pipeline has no total deadline and waits for completion', async () => {
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: true, mode: 'standard' }));
  let abortCalls = 0;
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline.runner = {
    configure() {},
    abort() { abortCalls++; }
  };
  pipeline._run = async () => {
    await after(40);
    return '完整正文';
  };
  const pending = pipeline.execute({ '玩家·姓名': '测试忍者' }, '继续');
  await after(0);
  assert.equal('_totalTimer' in pipeline, false, 'pipeline must not own a deadline timer');
  assert.equal(await pending, '完整正文');
  assert.equal(abortCalls, 0);
});

await test('message pipeline never calls direct generation for an empty agent result', async () => {
  const previousAgentConfig = localStorage.getItem('naruto_agent_config');
  const previousApiConfig = localStorage.getItem('naruto_api_config');
  const originalExecute = AgentPipeline.prototype.execute;
  const originalChat = aiClient.chat;
  const originalChatStream = aiClient.chatStream;
  let directCalls = 0;
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: true, mode: 'standard' }));
  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'openai',
    model: 'test-model',
    aiCallPolicy: { strictSingleCall: false }
  }));
  stateManager._apiConfigCache = null;
  stateManager.reset();
  stateManager.update([{ key: '玩家·姓名', op: '=', value: '测试忍者' }]);
  AgentPipeline.prototype.execute = async () => null;
  aiClient.chat = async () => { directCalls++; throw new Error('DIRECT_FALLBACK_CALLED'); };
  aiClient.chatStream = async () => { directCalls++; throw new Error('DIRECT_FALLBACK_CALLED'); };

  const host = new MessagePipeline({
    knowledgeBase: { invalidateCache() {} },
    timelineSystem: null,
    uiRenderer: null,
    combatSystem: null,
    missionSystem: null,
    relationshipSystem: null,
    memorySystem: null,
    worldStateSystem: null
  });
  host._rollDice = () => ({ d20: 10 });
  host._preprocessInput = input => input;
  host._formatDiceBlock = () => '';
  host._buildPrompt = () => [{ role: 'user', content: '继续' }];
  host._getGenerationOptions = () => ({});

  try {
    const outcome = await host.process('继续').then(() => 'resolved', error => error);
    assert.ok(outcome instanceof Error, 'empty agent result must reject the turn');
    assert.equal(outcome.code, 'AGENT_PIPELINE_EMPTY_RESULT');
    assert.equal(directCalls, 0, 'main model must not replace a failed agent turn');
    assert.equal(host._agentPipeline, null, 'failed agent instance must be released');
  } finally {
    AgentPipeline.prototype.execute = originalExecute;
    aiClient.chat = originalChat;
    aiClient.chatStream = originalChatStream;
    stateManager.reset();
    stateManager._apiConfigCache = null;
    if (previousAgentConfig === null) localStorage.removeItem('naruto_agent_config');
    else localStorage.setItem('naruto_agent_config', previousAgentConfig);
    if (previousApiConfig === null) localStorage.removeItem('naruto_api_config');
    else localStorage.setItem('naruto_api_config', previousApiConfig);
  }
});

function validStoryPlan() {
  return {
    schema: 'naruto.story-arc-plan/v1',
    id: 'story-plan:test',
    branchId: 'branch_main',
    basedOnNodeId: 'node:test',
    startDate: 'K048-01-01',
    premise: '当前局势保持开放推进',
    days: [0, 1, 2].map(dayOffset => ({
      dayOffset,
      date: dayOffset === 0 ? 'K048-01-01' : `K048-01-0${dayOffset + 1}`,
      pressures: ['当前矛盾可能升级'],
      opportunities: ['玩家可继续调查'],
      triggers: ['玩家主动推进'],
      invalidationConditions: ['关键前提改变']
    })),
    refreshTriggers: ['日期变化']
  };
}

function validSceneBrief(participants = ['测试忍者']) {
  return {
    schema: 'naruto.scene-brief/v1',
    id: 'scene:test',
    location: '木叶隐村',
    time: 'K048-01-01',
    participants,
    playerIntent: '继续',
    facts: ['当前场景安静'],
    constraints: ['NPC 行动由角色代理决定'],
    tensions: [],
    evidenceRefs: ['state:test']
  };
}

await test('final output is reviewed even when the draft is not polished', async () => {
  const hostPipeline = { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) };
  const pipeline = new AgentPipeline({ pipeline: hostPipeline, memorySystem: null });
  const plan = validStoryPlan();
  let finalReviewCalls = 0;
  pipeline.contextBroker.preflight = async () => ({
    domains: { dialogue: { items: [] }, world: { items: [] } },
    sources: [],
    cache: {},
    durationMs: 0
  });
  pipeline._generateOutline = async () => ({ beats: [{ id: 1, scene: '空旷的街道', participants: [] }] });
  pipeline._reviewOutline = async () => new Map();
  pipeline._writeDraft = async () => '测试正文';
  pipeline._reviewDraft = async () => new Map();
  pipeline._reviewFinalOutput = async () => {
    finalReviewCalls++;
    return new Map();
  };
  pipeline._auditFinalOutput = () => ({
    schema: 'naruto.agent-audit/v1',
    valid: true,
    errors: [],
    warnings: [],
    checks: {},
    auditedAt: Date.now(),
    evidenceRefs: []
  });

  const output = await pipeline._run({
    '玩家·姓名': '测试忍者',
    '世界·地点': '木叶隐村',
    '世界·时间': 'K048-01-01',
    '系统·回合数': 1,
    _meta: { active_branch: 'branch_main', current_node_id: 'node:test' },
    _agent_story_plan: plan,
    _relationships: {}
  }, '继续', () => {}, false, false, []);
  assert.equal(output, '测试正文');
  assert.equal(finalReviewCalls, 1);
});

await test('character batch failure aborts before the writer stage', async () => {
  const hostPipeline = { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) };
  const pipeline = new AgentPipeline({ pipeline: hostPipeline, memorySystem: null });
  let writerCalls = 0;
  pipeline.contextBroker.preflight = async () => ({
    domains: { dialogue: { items: [] }, world: { items: [] } },
    sources: [],
    cache: {},
    durationMs: 0
  });
  pipeline._generateOutline = async () => ({
    beats: [{ id: 1, scene: '木叶街道', participants: ['旗木卡卡西'] }]
  });
  pipeline._reviewOutline = async () => new Map();
  pipeline._runCharacterAgents = async () => { throw new Error('character batch failed'); };
  pipeline._writeDraft = async () => {
    writerCalls++;
    return '不应生成的正文';
  };
  pipeline._reviewDraft = async () => new Map();
  pipeline._reviewFinalOutput = async () => new Map();
  pipeline._auditFinalOutput = () => ({
    schema: 'naruto.agent-audit/v1',
    valid: true,
    errors: [],
    warnings: [],
    checks: {},
    auditedAt: Date.now(),
    evidenceRefs: []
  });

  const outcome = await pipeline._run({
    '玩家·姓名': '测试忍者',
    '世界·地点': '木叶隐村',
    '世界·时间': 'K048-01-01',
    '系统·回合数': 1,
    _meta: { active_branch: 'branch_main', current_node_id: 'node:test' },
    _agent_story_plan: validStoryPlan(),
    _relationships: { '旗木卡卡西': { location: '木叶隐村' } }
  }, '继续', () => {}, false, false, []).then(() => 'resolved', error => error);

  assert.ok(outcome instanceof Error, 'character batch failure must reject the turn');
  assert.match(outcome.message, /character batch failed/);
  assert.equal(writerCalls, 0, 'writer must not run without complete character decisions');
});

await test('character agents use bounded concurrency and preserve NPC order', async () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  let active = 0;
  let peak = 0;
  pipeline._runOneCharacterAgent = async ({ npcName }) => {
    active++;
    peak = Math.max(peak, active);
    await after(npcName === '旗木卡卡西' ? 20 : 1);
    active--;
    return {
      id: `decision:${npcName}`,
      npc: npcName,
      provenance: { source: 'test' },
      observable: { action: `${npcName}行动` }
    };
  };

  const decisions = await pipeline._runCharacterAgents(
    {},
    '继续',
    ['旗木卡卡西', '宇智波佐助', '春野樱'],
    { id: 'scene:test' },
    { beats: [] },
    validStoryPlan()
  );

  assert.equal(peak, 1, 'character sub-agents must default to one model call at a time');
  assert.deepEqual(decisions.map(decision => decision.npc), ['旗木卡卡西', '宇智波佐助', '春野樱']);
  assert.deepEqual(pipeline._characterDecisions.map(decision => decision.npc), [
    '旗木卡卡西', '宇智波佐助', '春野樱'
  ]);
});

await test('character batch stops queued agents after the first failure', async () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline.runner.setMaxConcurrency(2);
  const started = [];
  pipeline._runOneCharacterAgent = async ({ npcName }) => {
    started.push(npcName);
    if (npcName === '旗木卡卡西') throw new Error('character batch failure');
    await after(5);
    return {
      id: `decision:${npcName}`,
      npc: npcName,
      provenance: { source: 'test' },
      observable: { action: `${npcName}行动` }
    };
  };
  const names = ['旗木卡卡西', '宇智波佐助', '春野樱', '日向雏田'];
  await assert.rejects(
    pipeline._runCharacterAgents({}, '继续', names, { id: 'scene:test' }, { beats: [] }, validStoryPlan()),
    /character batch failure/
  );
  // 并发 2：仅点起卡卡西与佐助；失败后排队任务（春野樱、日向雏田）不得启动。
  assert.ok(started.length < names.length, `queued agents must not start after a failure (started=${started.length})`);
  assert.equal(started.includes('春野樱'), false, 'agent queued after the failure must not start');
  assert.equal(started.includes('日向雏田'), false, 'agent queued after the failure must not start');
});

await test('character batch cancellation stops queued agents immediately', async () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline.runner.setMaxConcurrency(3);
  const started = [];
  pipeline._runOneCharacterAgent = async ({ npcName }) => {
    started.push(npcName);
    if (npcName === '旗木卡卡西') {
      pipeline.abort(new Error('cancel character batch'));
      throw new Error('cancel character batch');
    }
    await after(3);
    return {
      id: `decision:${npcName}`,
      npc: npcName,
      provenance: { source: 'test' },
      observable: { action: `${npcName}行动` }
    };
  };
  const names = ['旗木卡卡西', '宇智波佐助', '春野樱', '日向雏田', '秋道丁次', '山中井野'];
  await assert.rejects(
    pipeline._runCharacterAgents({}, '继续', names, { id: 'scene:test' }, { beats: [] }, validStoryPlan()),
    /cancel character batch/
  );
  // 取消后：只允许已在途的子代理完成，排队中的角色子代理必须立即停止。
  assert.ok(started.length < names.length, `queued agents must stop after cancellation (started=${started.length})`);
  assert.equal(started.includes('山中井野'), false, 'agent queued before cancellation must not start');
});

await test('agent messages keep a stable prefix before volatile evidence', async () => {
  const runner = new AgentRunner({
    pipeline: {
      getTurnEvidenceView: () => ({
        audience: 'planner',
        current_state: { '系统·回合数': 5 },
        evidence: [{ kind: 'plot', id: 'P1', summary: '缓存顺序验证' }]
      }),
      getHistory: () => [
        { role: 'user', content: '历史用户消息' },
        { role: 'assistant', content: '历史助手消息' }
      ]
    }
  });
  const manifest = agentManifestModule.AGENT_MANIFESTS.outliner;
  const messages = runner._buildMessages('outliner', manifest, {
    state: { '玩家·姓名': '测试忍者' },
    userInput: '继续',
    taskPrompt: '生成大纲',
    extraContext: { _pipeline: runner._pipeline }
  });
  const roles = messages.map(message => message.role);
  // 稳定前缀在前：人设(system) → 历史(user/assistant) → 易变证据(system) → 任务(user)。
  // 证据必须位于历史之后，否则会打断 DeepSeek 的自动前缀缓存。
  const firstHistory = roles.findIndex((role, index) => role === 'user' && index !== roles.length - 1);
  assert.ok(firstHistory > 0, 'history must follow the persona system prompt');
  const evidenceIdx = messages.findIndex(message => message.role === 'system' && message !== messages[0]);
  assert.ok(evidenceIdx > firstHistory, 'volatile evidence must come after history');
  assert.equal(roles[roles.length - 1], 'user', 'task prompt must remain last');
});

await test('agent writer defers variable tags to the secondary updater', () => {
  const runner = new AgentRunner();
  const constraint = runner._buildWriterConstraint({}, {});
  assert.doesNotMatch(constraint, /正文末尾必须附上/,
    'writer must not be told to emit variable/memory tags itself');
  assert.match(constraint, /禁止输出任何结构标签/,
    'writer must receive the defer-to-secondary instruction');
});

await test('critic-search error findings fail the final audit', () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  const report = pipeline._auditFinalOutput({
    state: { '玩家·姓名': '测试忍者', _meta: { active_branch: 'branch_main' } },
    finalText: '测试正文',
    sceneBrief: validSceneBrief(),
    storyPlan: validStoryPlan(),
    involvedNPCs: [],
    reviews: new Map([
      ['final-preset-and-character', { success: true, data: { approved: true, issues: [], suggestions: [] } }],
      ['critic-search', {
        success: true,
        data: {
          approved: false,
          issues: [{ severity: 'error', dimension: '时间', description: '时间线冲突', suggestion: '修正日期' }],
          suggestions: []
        }
      }]
    ])
  });
  assert.ok(
    report.errors.some(error => /critic-search.*时间线冲突/.test(error)),
    JSON.stringify(report.errors)
  );
});

await test('continuity updater tags are appended and mark agent-self-update', async () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline._runContinuityUpdater = async () => (
    '<relationship>{"npc":"旗木卡卡西","affection_change":1,"trust_change":2,"inner_thoughts":"认可","history":"愿意多指导一招。"}</relationship>\n<memory>回合小结。</memory>'
  );
  const text = await pipeline._appendContinuityUpdates({}, '继续', '正文内容', ['旗木卡卡西'], { participants: ['旗木卡卡西'] });
  assert.ok(text.includes('<relationship>'), 'relationship tag must be appended');
  assert.ok(text.includes('inner_thoughts'), 'relationship must carry psychology');
  assert.ok(text.includes('回合小结'), 'memory tag must be appended');
  assert.equal(pipeline.didAgentProduceUpdaterTags(), true, 'agent self-updater flag must be set');
});

await test('stage cache persists across pipeline instances and clears on success', () => {
  const mkPipeline = () => new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  const state = { '系统·回合数': 1, _meta: { active_branch: 'branch_main' } };
  const userInput = '继续';

  const p1 = mkPipeline();
  const { entry } = p1._beginStageCache(state, userInput);
  p1._storeStage(entry, 'story_plan', { storyPlan: { days: [{ dayOffset: 0 }, { dayOffset: 1 }, { dayOffset: 2 }] } });
  p1._storeStage(entry, 'writing', { draft: '已写好的正文草稿' });

  // 新实例(模拟重试)能读回同一缓存 → 从失败阶段续跑，复用上方正确环节。
  const p2 = mkPipeline();
  const restored = p2._beginStageCache(state, userInput);
  assert.ok(restored.entry.complete.has('story_plan'), 'story_plan must be cached');
  assert.ok(restored.entry.complete.has('writing'), 'writing must be cached');
  assert.equal(restored.entry.data.draft, '已写好的正文草稿');
  assert.equal(restored.entry.data.storyPlan.days.length, 3);

  // 完整成功 → 清缓存。
  p2._clearStageCache();
  const after = p2._beginStageCache(state, userInput);
  assert.equal(after.entry.complete.size, 0, 'cache must be cleared after success');
});

await test('continuity updater without tags leaves text unchanged and unmarked', async () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline._runContinuityUpdater = async () => '没有任何结构标签的普通文本';
  const text = await pipeline._appendContinuityUpdates({}, '继续', '正文内容', [], null);
  assert.equal(text, '正文内容');
  assert.equal(pipeline.didAgentProduceUpdaterTags(), false);

  const pipeline2 = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline2._runContinuityUpdater = async () => { throw new Error('boom'); };
  const text2 = await pipeline2._appendContinuityUpdates({}, '继续', '正文内容', [], null);
  assert.equal(text2, '正文内容');
  assert.equal(pipeline2.didAgentProduceUpdaterTags(), false);
});

await test('unavailable final preset and character reviewer is an audit error', () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  const report = pipeline._auditFinalOutput({
    state: { '玩家·姓名': '测试忍者', _meta: { active_branch: 'branch_main' } },
    finalText: '测试正文',
    sceneBrief: validSceneBrief(),
    storyPlan: validStoryPlan(),
    involvedNPCs: [],
    reviews: new Map([['final-preset-and-character', { success: false, error: 'reviewer offline' }]])
  });
  assert.ok(
    report.errors.some(error => /final-preset-and-character.*reviewer offline/.test(error)),
    JSON.stringify(report.errors)
  );
});

await test('mandatory final reviewer rejects unusable success payloads', () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  const cases = [
    { label: 'missing data', result: { success: true } },
    { label: 'explicit rejection', result: { success: true, data: { approved: false, issues: [] } } },
    {
      label: 'parser fallback',
      result: {
        success: true,
        data: { approved: false, issues: [], summary: 'JSON解析失败' }
      }
    }
  ];
  for (const fixture of cases) {
    const report = pipeline._auditFinalOutput({
      state: { '玩家·姓名': '测试忍者', _meta: { active_branch: 'branch_main' } },
      finalText: '测试正文',
      sceneBrief: validSceneBrief(),
      storyPlan: validStoryPlan(),
      involvedNPCs: [],
      reviews: new Map([['final-preset-and-character', fixture.result]])
    });
    assert.ok(
      report.errors.some(error => error.includes('final-preset-and-character')),
      `${fixture.label}: ${JSON.stringify(report.errors)}`
    );
  }
});

await test('final NPC scan uses evidence canonical names but ignores descriptive aliases', () => {
  const pipeline = new AgentPipeline({
    pipeline: {
      getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }),
      _lastTurnEvidencePacket: {
        character_mentions: [{ canonical_name: '月光千夏', names: ['千夏'] }],
        worldbook_entries: [{
          character_profile: {
            names: ['春野樱'],
            aliases: ['医疗忍者', '怪力']
          }
        }]
      }
    },
    memorySystem: null
  });
  const mentions = pipeline._extractKnownNpcMentions(
    { '玩家·姓名': '测试忍者' },
    '千夏从屋顶跃下。医疗忍者还在远处忙碌。',
    validSceneBrief(),
    []
  );
  assert.deepEqual(mentions, ['月光千夏']);
});

await test('NPC provenance matches relationship aliases and excludes the player identity first', () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline._characterDecisions = [{
    id: 'decision:sasuke:test',
    npc: '佐助',
    sceneId: 'scene:test',
    action: '佐助停在门边。',
    dialogue: '走吧。'
  }];
  const relationshipState = {
    '玩家·姓名': '测试忍者',
    _meta: { active_branch: 'branch_main' },
    _relationships: { '宇智波佐助': { aliases: ['佐助'] } }
  };
  const report = pipeline._auditFinalOutput({
    state: relationshipState,
    finalText: '佐助停在门边，低声说：“走吧。”',
    sceneBrief: validSceneBrief(),
    storyPlan: validStoryPlan(),
    involvedNPCs: [],
    reviews: new Map([[
      'final-preset-and-character',
      { success: true, data: { approved: true, issues: [], summary: '审查通过' } }
    ]])
  });
  assert.equal(
    report.errors.some(error => error.includes('character decision missing for')),
    false,
    JSON.stringify(report.errors)
  );

  const playerMentions = pipeline._extractKnownNpcMentions({
    ...relationshipState,
    '玩家·姓名': '佐助'
  }, '佐助走到门边。', validSceneBrief(['佐助']), []);
  assert.deepEqual(playerMentions, [], '玩家的主键与别名都不应进入 NPC 来源审计');
});

await test('writer-introduced known NPC without a character decision fails final audit', () => {
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  const report = pipeline._auditFinalOutput({
    state: {
      '玩家·姓名': '测试忍者',
      _meta: { active_branch: 'branch_main' },
      _relationships: { '旗木卡卡西': { relationship: '陌生' } }
    },
    finalText: '旗木卡卡西推门而入，朝玩家点头后说：“跟我来。”',
    sceneBrief: validSceneBrief(),
    storyPlan: validStoryPlan(),
    involvedNPCs: [],
    reviews: new Map([[
      'final-preset-and-character',
      { success: true, data: { approved: true, issues: [], summary: '审查通过' } }
    ]])
  });
  assert.ok(
    report.errors.some(error => error.includes('character decision missing for 旗木卡卡西')),
    JSON.stringify(report.errors)
  );
});

await test('nearest future plot context does not schedule an extra guardian agent', async () => {
  const hostPipeline = {
    _activeCallPolicy: { strictSingleCall: false, features: { agents: true } },
    _lastTurnEvidencePacket: {
      current_plot: { date_relation: 'nearest_future', scenes: [{ id: 'SCN-P2-RETURN' }] }
    },
    getTurnEvidenceView: () => ({ current_state: {}, evidence: [] })
  };
  const pipeline = new AgentPipeline({ pipeline: hostPipeline, memorySystem: null });
  const calls = [];
  pipeline.runner.run = async type => {
    calls.push(type);
    if (type === 'outliner') return { beats: [{ id: 7, scene: '林间' }] };
    throw new Error(`unexpected agent ${type}`);
  };
  const stages = [];
  const result = await pipeline._generateOutline({}, '继续', null, (stage, detail) => stages.push({ stage, detail }));
  assert.equal(result.beats.length, 1);
  assert.deepEqual(calls, ['outliner']);
  assert.ok(stages.every(item => item.stage !== 'guard_outline'), JSON.stringify(stages));
});

console.log(`\nagent-runtime-regression: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new AggregateError(failures.map(item => item.error), `${failures.length} agent runtime regression test(s) failed`);
}
