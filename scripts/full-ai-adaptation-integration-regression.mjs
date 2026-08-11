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

function gameStateAt(date, queryName = '') {
  return {
    _version: '5.0',
    _meta: { current_node_id: 'node_integration', active_branch: 'branch_main' },
    _relationships: {},
    _missions: { active: {}, completed: {} },
    '系统·回合数': 7,
    '世界·时间': date,
    '世界·年代': date.slice(0, 4),
    '世界·地点': '',
    '玩家·姓名': '集成测试忍者',
    '玩家·公开身份': '木叶忍者',
    _test_query_name: queryName
  };
}

await test('main reasoning and secondary variable self-check are visible only in the reasoning panel', async () => {
  const mainReasoning = '主模型推演：当前仍在木叶第三训练场，玩家只是尝试稳定磁遁，因此先核对能力、消耗与直接结果。';
  const variableReasoning = '二次变量七段自检：已核对来源、事件边界、人物关系、技能物品、任务地图、记忆承接与最终差异。';
  const mainResponse = [
    `<reasoning>${mainReasoning}</reasoning>`,
    '训练场边缘的铁砂轻轻震颤，磁遁测试者收束查克拉后重新站稳。'
  ].join('\n');
  globalThis.generateRaw = async () => mainResponse;

  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern',
    model: 'reasoning-visibility-model',
    disableStreaming: false,
    aiCallPolicy: { strictSingleCall: false },
    variableUpdater: { enabled: true, backend: 'inherit', model: 'variable-reasoning-model' },
    narrativeReview: { enabled: false }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: false, mode: 'off' }));
  localStorage.setItem('naruto_memory_config', JSON.stringify({
    aiCompressionEnabled: false,
    deepEnabled: false,
    npcSummaryEnabled: false,
    recallEnabled: false
  }));
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({ enabled: false }));

  const [
    { MessagePipeline },
    { aiClient },
    { stateManager },
    { eventBus }
  ] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js'),
    import('../js/core/event-bus.js')
  ]);

  const state = stateManager.getDefaultState();
  state['玩家·姓名'] = '磁遁测试者';
  state['玩家·存活'] = '是';
  state['世界·时间'] = 'K052-01-01';
  state['世界·年代'] = 'K052';
  state['世界·地点'] = '木叶第三训练场';
  state['系统·回合数'] = 7;
  stateManager.state = state;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;
  aiClient.configure({ backend: 'tavern', model: 'reasoning-visibility-model' });

  let completePayload = null;
  let timelinePayload = null;
  const unsubscribe = eventBus.on('pipeline:complete', payload => { completePayload = payload; });
  const pipeline = new MessagePipeline({
    knowledgeBase: null,
    timelineSystem: {
      createNode: async payload => {
        timelinePayload = payload;
        return { id: 'node_reasoning_visibility' };
      }
    },
    uiRenderer: null,
    combatSystem: null,
    missionSystem: null,
    relationshipSystem: null,
    memorySystem: null,
    worldStateSystem: null
  });
  pipeline._runSecondaryVariableUpdate = async () => [
    `<variable_thinking>${variableReasoning}</variable_thinking>`,
    '<memory>{"summary":"磁遁测试者在第三训练场尝试稳定磁遁，铁砂短暂震颤后被重新收束；下一回合继续承接训练结果。","facts":[],"clues":[],"pins":[],"npc_notes":{}}</memory>'
  ].join('\n');

  try {
    const result = await pipeline.process('尝试稳定磁遁');
    assert.match(completePayload?.thinkContent || '', /主模型推演/);
    assert.match(completePayload?.thinkContent || '', new RegExp(mainReasoning));
    assert.match(completePayload?.thinkContent || '', /二次变量自检/);
    assert.match(completePayload?.thinkContent || '', new RegExp(variableReasoning));
    assert.match(completePayload?.thinkContent || '', /本回合核对摘要/);
    for (const hiddenText of [mainReasoning, variableReasoning, '本回合核对摘要']) {
      assert.doesNotMatch(result.cleanResponse, new RegExp(hiddenText));
      assert.doesNotMatch(JSON.stringify(pipeline.chatHistory), new RegExp(hiddenText));
      assert.doesNotMatch(JSON.stringify(timelinePayload), new RegExp(hiddenText));
    }
  } finally {
    unsubscribe();
    delete globalThis.generateRaw;
  }
});

await test('inconsistent secondary task output is retried once and the repaired mission is routed', async () => {
  globalThis.generateRaw = async () => '任务集会所的中忍把委托书推到玩家面前，确认玩家已经接下护送任务。';
  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern', model: 'mission-retry-main', disableStreaming: false,
    aiCallPolicy: { strictSingleCall: false },
    variableUpdater: { enabled: true, backend: 'inherit', model: 'mission-retry-updater' },
    narrativeReview: { enabled: false }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: false, mode: 'off' }));
  localStorage.setItem('naruto_memory_config', JSON.stringify({
    aiCompressionEnabled: false, deepEnabled: false, npcSummaryEnabled: false, recallEnabled: false
  }));
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({ enabled: false }));

  const [{ MessagePipeline }, { aiClient }, { stateManager }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js')
  ]);
  const state = stateManager.getDefaultState();
  state['玩家·姓名'] = '任务重试测试者';
  state['玩家·存活'] = '是';
  state['世界·时间'] = 'K052-01-01';
  state['世界·年代'] = 'K052';
  state['世界·地点'] = '木叶任务集会所';
  state['系统·回合数'] = 3;
  stateManager.state = state;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;
  aiClient.configure({ backend: 'tavern', model: 'mission-retry-main' });

  const routedMissions = [];
  const pipeline = new MessagePipeline({
    timelineSystem: { createNode: async () => ({ id: 'node_mission_retry' }) },
    missionSystem: { processInstruction: mission => routedMissions.push(mission) }
  });
  const corrections = [];
  let updaterCalls = 0;
  pipeline._runSecondaryVariableUpdate = async ({ correctionInstruction }) => {
    updaterCalls++;
    corrections.push(correctionInstruction);
    if (updaterCalls === 1) {
      const error = new Error('变量自检已声明需要新增任务，但缺少顶层 <mission> 标签');
      error.code = 'VARIABLE_UPDATER_OUTPUT_INCONSISTENT';
      throw error;
    }
    return [
      '<variable_thinking>五、任务成长与地图：已确认接取护送任务。七、差异复检：输出清单：variable=0, mission=1, relationship=0, memory=1, combat=0, event=0。</variable_thinking>',
      '<mission>{"id":"escort_retry","status":"active","rank":"C","title":"护送任务","objective":"护送委托人抵达边境"}</mission>',
      '<memory>{"summary":"玩家在任务集会所确认接下护送任务，下一回合需要承接护送目标。"}</memory>'
    ].join('\n');
  };

  try {
    await pipeline.process('接下这份护送任务');
    assert.equal(updaterCalls, 2);
    assert.equal(corrections[0], '');
    assert.match(corrections[1], /缺少顶层 <mission>/);
    assert.equal(routedMissions.length, 1);
    assert.equal(routedMissions[0].id, 'escort_retry');
  } finally {
    delete globalThis.generateRaw;
  }
});

await test('secondary updater recompiles evidence with names introduced by the final narrative', async () => {
  const { MessagePipeline } = await import('../js/core/pipeline.js');
  const pipeline = new MessagePipeline({});
  let compiledQuery = '';
  pipeline._turnEvidenceCompiler = {
    compile: ({ state, userInput }) => {
      compiledQuery = userInput;
      return { current_state: state };
    },
    project: (packet, { audience }) => ({
      audience,
      current_state: packet.current_state,
      opening_contract: '',
      worldbook_entries: compiledQuery.includes('旗木卡卡西') ? [{ title: '旗木卡卡西人物档案' }] : []
    })
  };

  const evidence = pipeline._compileUpdaterEvidence({
    state: gameStateAt('K052-01-01'),
    userInput: '推开训练场的门',
    narrativeResponse: '旗木卡卡西从树梢落下，向玩家打了个招呼。'
  });

  assert.match(compiledQuery, /推开训练场的门/);
  assert.match(compiledQuery, /旗木卡卡西/);
  assert.equal(evidence.worldbook_entries[0].title, '旗木卡卡西人物档案');
});

await test('strict mode rejects missing contracts and false no-change claims without another API call', async () => {
  let apiCalls = 0;
  let mainResponse = '集成测试忍者离开第三训练场赶到火影楼，连续施术耗去大量查克拉，并接下了一份护送任务。';
  globalThis.generateRaw = async () => {
    apiCalls++;
    return mainResponse;
  };

  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern',
    model: 'strict-incomplete-output-model',
    disableStreaming: false,
    aiCallPolicy: { strictSingleCall: true },
    variableUpdater: { enabled: true, backend: 'inherit', model: 'blocked-updater-model' },
    narrativeReview: { enabled: false }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: false, mode: 'off' }));
  localStorage.setItem('naruto_memory_config', JSON.stringify({
    aiCompressionEnabled: false,
    deepEnabled: false,
    npcSummaryEnabled: false,
    recallEnabled: false
  }));
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({ enabled: false }));

  const [{ MessagePipeline }, { aiClient }, { stateManager }, { eventBus }, { SHINOBI_DAILY_EXAMPLE }] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js'),
    import('../js/core/event-bus.js'),
    import('../js/core/shinobi-daily.js')
  ]);

  const state = stateManager.getDefaultState();
  state['玩家·姓名'] = '集成测试忍者';
  state['玩家·存活'] = '是';
  state['玩家·查克拉'] = 100;
  state['世界·时间'] = 'K052-01-01';
  state['世界·年代'] = 'K052';
  state['世界·地点'] = '木叶第三训练场';
  state['系统·回合数'] = 8;
  stateManager.state = state;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;
  aiClient.configure({ backend: 'tavern', model: 'strict-incomplete-output-model' });

  let timelineCalls = 0;
  let completeCalls = 0;
  let pipelineError = null;
  const pipeline = new MessagePipeline({
    timelineSystem: {
      createNode: async () => {
        timelineCalls++;
        return { id: 'node_strict_incomplete_output' };
      }
    }
  });
  const beforeState = stateManager.snapshot();
  const beforeHistory = structuredClone(pipeline.chatHistory);
  const unsubscribeComplete = eventBus.on('pipeline:complete', () => { completeCalls++; });
  const unsubscribeError = eventBus.on('pipeline:error', payload => { pipelineError = payload; });
  let rejectedError = null;

  try {
    try {
      await pipeline.process('赶往火影楼接取护送任务');
    } catch (error) {
      rejectedError = error;
    }

    assert.equal(apiCalls, 1, `strict incomplete turn emitted ${apiCalls} model requests`);
    assert.equal(rejectedError?.code, 'STRICT_MAIN_OUTPUT_INCOMPLETE');
    assert.match(rejectedError?.message || '', /主模型.*输出不完整/);
    assert.match(rejectedError?.message || '', /变量|记账/);
    assert.match(rejectedError?.message || '', /忍界日报|shinobi_daily/);
    assert.equal(timelineCalls, 0, '不完整回合不得创建时间线节点');
    assert.equal(completeCalls, 0, '不完整回合不得发布完成事件');
    assert.deepEqual(stateManager.snapshot(), beforeState, '不完整回合不得修改游戏状态');
    assert.deepEqual(pipeline.chatHistory, beforeHistory, '不完整回合不得写入聊天历史');
    assert.equal(pipelineError?.code, 'STRICT_MAIN_OUTPUT_INCOMPLETE');
    assert.ok(pipelineError?.missingContracts?.includes('state_update'));
    assert.ok(pipelineError?.missingContracts?.includes('shinobi_daily'));
    assert.match(pipelineError?.draftResponse || '', /火影楼/);
    assert.match(pipelineError?.error || '', /主模型.*输出不完整/);

    const strictDaily = structuredClone(SHINOBI_DAILY_EXAMPLE);
    strictDaily.date = '木叶52年1月1日';
    mainResponse = [
      '集成测试忍者离开第三训练场赶到火影楼，连续施术耗去大量查克拉，并接下了一份护送任务。',
      '<state_update>{"changed":false}</state_update>',
      '<memory>{"summary":"玩家已赶到火影楼并接下护送任务。","facts":[],"clues":[],"pins":[],"npc_notes":{}}</memory>',
      `<shinobi_daily>${JSON.stringify(strictDaily)}</shinobi_daily>`
    ].join('\n');
    rejectedError = null;
    pipelineError = null;
    try {
      await pipeline.process('赶往火影楼接取护送任务');
    } catch (error) {
      rejectedError = error;
    }

    assert.equal(apiCalls, 2, 'each rejected turn must issue exactly one request');
    assert.equal(rejectedError?.code, 'STRICT_MAIN_OUTPUT_INCOMPLETE');
    assert.match(rejectedError?.message || '', /正文已明确发生/);
    assert.ok(rejectedError?.missingContracts?.includes('business_update'));
    assert.equal(pipelineError?.code, 'STRICT_MAIN_OUTPUT_INCOMPLETE');
    assert.equal(timelineCalls, 0, '虚假无变化声明不得创建时间线节点');
    assert.equal(completeCalls, 0, '虚假无变化声明不得发布完成事件');
    assert.deepEqual(stateManager.snapshot(), beforeState, '虚假无变化声明不得修改游戏状态');
    assert.deepEqual(pipeline.chatHistory, beforeHistory, '虚假无变化声明不得写入聊天历史');
  } finally {
    unsubscribeComplete();
    unsubscribeError();
    delete globalThis.generateRaw;
  }
});

await test('strict mode stays at one API request at compression, deep-cycle, NPC-summary and image thresholds', async () => {
  const { SHINOBI_DAILY_EXAMPLE } = await import('../js/core/shinobi-daily.js');
  const generated = [];
  const strictDaily = structuredClone(SHINOBI_DAILY_EXAMPLE);
  strictDaily.date = '木叶52年1月1日';
  const mainResponse = [
    '训练场的风掠过木桩，集成测试忍者完成这一轮动作后停下来观察四周。',
    '<state_update>{"changed":false}</state_update>',
    '<memory>{"summary":"玩家完成本回合训练并留在原地观察，现场状态保持连续。","facts":[],"clues":[],"pins":[],"npc_notes":{}}</memory>',
    `<shinobi_daily>${JSON.stringify(strictDaily)}</shinobi_daily>`
  ].join('\n');
  globalThis.generateRaw = async options => {
    generated.push(options);
    return mainResponse;
  };

  localStorage.setItem('naruto_api_config', JSON.stringify({
    backend: 'tavern',
    model: 'strict-integration-model',
    disableStreaming: false,
    aiCallPolicy: { strictSingleCall: true },
    variableUpdater: { enabled: true, backend: 'inherit', model: 'updater-model' },
    narrativeReview: { enabled: true, backend: 'inherit', model: 'review-model' }
  }));
  localStorage.setItem('naruto_agent_config', JSON.stringify({
    enabled: true,
    mode: 'full',
    agentModel: 'agent-model',
    criticModel: 'critic-model'
  }));
  const strictMemoryConfig = {
    aiCompressionEnabled: true,
    deepEnabled: true,
    deepCycle: 12,
    maxTurnSummaries: 4,
    chapterWindow: 10,
    npcSummaryEnabled: true,
    npcSummaryFrequency: 5,
    recallEnabled: true
  };
  localStorage.setItem('naruto_memory_config', JSON.stringify(strictMemoryConfig));
  const { saveMemoryConfig } = await import('../js/data/memory-config.js');
  saveMemoryConfig(strictMemoryConfig);
  localStorage.setItem('naruto_rpg_image_settings_v1', JSON.stringify({
    enabled: true,
    turnMode: 'auto',
    promptMode: 'separate-model',
    providerId: 'openai-compatible',
    providers: {
      'openai-compatible': {
        type: 'openai-compatible',
        apiUrl: 'https://images.invalid/v1',
        apiKey: 'unused',
        model: 'image-model'
      }
    },
    separatePromptModel: { backend: 'inherit', model: 'image-prompt-model' }
  }));

  const [
    { MessagePipeline },
    { aiClient },
    { stateManager },
    { memorySystem },
    { ImageFeatureIntegration }
  ] = await Promise.all([
    import('../js/core/pipeline.js'),
    import('../js/core/ai-client.js'),
    import('../js/core/state-manager.js'),
    import('../js/systems/memory-system.js'),
    import('../js/core/image-studio/integration.js')
  ]);

  const state = stateManager.getDefaultState();
  state['玩家·姓名'] = '集成测试忍者';
  state['玩家·存活'] = '是';
  state['世界·时间'] = 'K052-01-01';
  state['世界·年代'] = 'K052';
  state['世界·地点'] = '木叶第三训练场';
  state['系统·回合数'] = 36;
  state._memory.turn_summaries = [1, 2, 3, 4]
    .map(turn => `#${turn} ${'连续性训练记录'.repeat(18)}-${turn}`)
    .join('\n');
  state._memory.meta = { updated_at: 0, last_deep_turn: 0, sources: {} };
  state._relationships = {
    测试上忍: {
      entity_id: 'NPC-INTEGRATION',
      pinned: true,
      summary_turn_counter: 5,
      history: Array.from({ length: 5 }, (_, index) => ({
        turn: index + 1,
        content: `第${index + 1}次训练互动`
      })),
      summaries: []
    }
  };
  stateManager.state = state;
  stateManager._stateVersion++;
  stateManager._apiConfigCache = null;

  aiClient.configure({ backend: 'tavern', model: 'strict-integration-model' });
  let mainGenerationOptions = null;
  const originalMainChatStream = aiClient.adapter.chatStream.bind(aiClient.adapter);
  aiClient.adapter.chatStream = (messages, options, onChunk) => {
    mainGenerationOptions = { ...options };
    return originalMainChatStream(messages, options, onChunk);
  };

  const imageCalls = { read: 0, execute: 0 };
  const fakeStudio = {
    ready: async () => {},
    subscribe: () => () => {},
    read: async () => {
      imageCalls.read++;
      return { enabled: true, turnMode: 'auto', promptMode: 'separate-model' };
    },
    execute: async () => { imageCalls.execute++; }
  };
  const imageIntegration = new ImageFeatureIntegration({ studio: fakeStudio });
  await imageIntegration.init();

  let secondaryUpdaterCalls = 0;
  let npcSummaryChecks = 0;
  const timelineSystem = {
    createNode: async payload => ({ id: 'node_strict_integration', ...payload })
  };
  const pipeline = new MessagePipeline({
    knowledgeBase: null,
    timelineSystem,
    uiRenderer: null,
    combatSystem: null,
    missionSystem: null,
    relationshipSystem: null,
    memorySystem,
    worldStateSystem: null
  });
  pipeline._runSecondaryVariableUpdate = async () => {
    secondaryUpdaterCalls++;
    return '';
  };
  pipeline._checkPinnedNpcSummaries = async () => { npcSummaryChecks++; };

  try {
    const result = await pipeline.process('继续完成训练并观察指导上忍');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(result.cleanResponse, /训练场/);
    assert.doesNotMatch(result.cleanResponse, /<state_update>|<memory>|<shinobi_daily>/);
    assert.match(result.rawResponse, /<state_update>/);
    assert.match(result.rawResponse, /<memory>/);
    assert.match(result.rawResponse, /<shinobi_daily>/);
    assert.equal(generated.length, 1, `strict turn emitted ${generated.length} model requests`);
    assert.equal(mainGenerationOptions?.max_tokens, 0);
    assert.equal(mainGenerationOptions?.maxRetries, 0);
    assert.equal(mainGenerationOptions?.strictSingleRequest, true);
    assert.equal(secondaryUpdaterCalls, 0, 'secondary updater must stay paused');
    assert.equal(npcSummaryChecks, 0, 'pinned NPC summarizer must stay paused');
    assert.equal(imageCalls.read, 0, 'image integration must stop before reading automatic settings');
    assert.equal(imageCalls.execute, 0, 'automatic image generation must stay paused');

    const memory = stateManager.getSub('_memory');
    assert.ok(memory.compression_count >= 1, 'fixture must cross the local compression threshold');
    assert.ok(String(memory._pendingCompressionText || '').length >= 200,
      'fixture must leave enough pending text to trigger an AI compressor when allowed');
    assert.equal(memorySystem.shouldDeepConsolidate(), true,
      'fixture must be at a due deep-consolidation cycle');
  } finally {
    imageIntegration.dispose();
    delete globalThis.generateRaw;
  }
});

await test('K001, K052 and K086 expose the nearest future day as ordinary current plot', async () => {
  const { TurnEvidenceCompiler, renderEvidenceView } = await import('../js/core/turn-evidence.js');
  const compiler = new TurnEvidenceCompiler();
  const cases = [
    { date: 'K001-01-01', query: '千手柱间', expectedDate: 'K050-06-01', expectedDayId: 'DAY-HIST-KAKASHI-001' },
    { date: 'K052-01-01', query: '旗木卡卡西', expectedDate: 'K064-01-01', expectedDayId: 'DAY-P1-START-001' },
    { date: 'K086-01-02', query: '漩涡博人', expectedDate: 'K086-01-03', expectedDayId: 'DAY-BOR-RETURN-103' }
  ];
  for (const fixture of cases) {
    const packet = compiler.compile({
      state: gameStateAt(fixture.date, fixture.query),
      userInput: `观察${fixture.query}与当前局势`
    });
    assert.equal(packet.current_plot?.target_date, fixture.expectedDate, fixture.date);
    assert.equal(packet.current_plot?.date_relation, 'nearest_future', fixture.date);
    assert.equal(packet.current_plot?.day_id, fixture.expectedDayId, fixture.date);
    assert.ok(packet.current_plot?.title, `${fixture.date} must expose the plot title`);
    assert.ok(packet.current_plot?.scenes?.length, `${fixture.date} must expose plot scenes`);

    for (const audience of ['writer', 'updater', 'reviewer', 'planner']) {
      const view = compiler.project(packet, { audience });
      assert.equal(view.current_plot?.target_date, fixture.expectedDate, `${fixture.date}/${audience}`);
      assert.equal(view.current_plot?.date_relation, 'nearest_future', `${fixture.date}/${audience}`);
      assert.equal(view.current_plot?.title, packet.current_plot.title, `${fixture.date}/${audience}`);
      assert.ok(view.current_plot?.scenes?.length, `${fixture.date}/${audience} must receive plot scenes`);

      const keepsOperationalIds = audience === 'updater' || audience === 'planner';
      assert.equal(view.current_plot?.day_id, keepsOperationalIds ? fixture.expectedDayId : undefined,
        `${fixture.date}/${audience} operational day ID projection`);
      if (keepsOperationalIds) {
        assert.ok(view.current_plot.scenes.every(scene => scene.id),
          `${fixture.date}/${audience} must retain scene IDs`);
        assert.ok(view.current_plot.scenes.flatMap(scene => scene.beats || []).every(beat => beat.id),
          `${fixture.date}/${audience} must retain beat IDs`);
      }

      const rendered = renderEvidenceView(view, { stage: audience });
      const firstScene = view.current_plot.scenes[0];
      const firstBeat = firstScene.beats?.[0];
      assert.ok(rendered.includes(fixture.expectedDate), `${fixture.date}/${audience} missing target date`);
      assert.ok(rendered.includes(packet.current_plot.title), `${fixture.date}/${audience} missing plot title`);
      assert.ok(rendered.includes(firstScene.title), `${fixture.date}/${audience} missing scene content`);
      if (firstBeat?.summary) {
        assert.ok(rendered.includes(firstBeat.summary), `${fixture.date}/${audience} missing beat content`);
      }
    }
  }
});

await test('runtime contains all K001-K086 yearly age/OOC snapshots', async () => {
  const { CANON_DATABASE } = await import('../js/data/canon-database.js');
  const snapshots = CANON_DATABASE.getRecords('plot').filter(day => day?.year_snapshot);
  const years = new Set(snapshots.map(day => day.year_snapshot.as_of?.slice(0, 4)));
  assert.equal(snapshots.length, 86, 'one runtime year snapshot is required for each K001-K086 year');
  for (const year of ['K001', 'K052', 'K086']) {
    assert.ok(years.has(year), `runtime missing ${year} snapshot`);
    const context = CANON_DATABASE.getYearSnapshotContext({
      state: { '世界·时间': `${year}-01-01` }
    });
    assert.equal(context?.snapshot_date, `${year}-01-01`);
    assert.ok(context.snapshot.characters.length > 0, `${year} must carry age profiles`);
    assert.ok(context.snapshot.factions.length > 0, `${year} must carry faction profiles`);
  }
});

await test('age-specific worldbook runtime never carries future character phases', async () => {
  const {
    WORLD_BOOK_V2_ENTRIES,
    toRuntimeWorldbookEntry
  } = await import('../js/data/worldbook/index.js');
  const fixtures = [
    { title: '【早期】宇智波佐助', date: 'K052-06-01', forbidden: '灭族之夜' },
    { title: '【游历期】自来也', date: 'K064-06-01', forbidden: '壮烈沉入深海' },
    { title: '【疾风传】日向宁次', date: 'K064-06-01', forbidden: '十尾的扦插之术' }
  ];
  for (const fixture of fixtures) {
    const entry = WORLD_BOOK_V2_ENTRIES.find(item => item.title === fixture.title);
    assert.ok(entry, `missing fixture ${fixture.title}`);
    const runtime = toRuntimeWorldbookEntry(entry, { audience: 'writer', date: fixture.date });
    assert.ok(runtime, `${fixture.title} should be active at ${fixture.date}`);
    const futureStates = runtime.character_profile.era_states.filter(state => (
      state.from && state.from.localeCompare(fixture.date) > 0
    ));
    assert.deepEqual(futureStates, [], `${fixture.title} exposes future era states at ${fixture.date}`);
    assert.equal(JSON.stringify(runtime.character_profile).includes(fixture.forbidden), false,
      `${fixture.title} leaks future outcome: ${fixture.forbidden}`);
  }
});

await test('Worldbook V1 to V2 gives every builtin fragment one stable explicit disposition', async () => {
  const {
    WORLD_BOOK_ENTRIES,
    WORLD_BOOK_V2_ENTRIES,
    WORLD_BOOK_V2_MIGRATION_REPORT
  } = await import('../js/data/worldbook/index.js');
  const { flattenLegacyWorldbookSources } = await import('../js/data/worldbook/migration-v2.js');
  const records = flattenLegacyWorldbookSources();
  assert.equal(records.length, WORLD_BOOK_ENTRIES.length);
  assert.equal(WORLD_BOOK_V2_MIGRATION_REPORT.input_count, records.length);
  assert.equal(WORLD_BOOK_V2_MIGRATION_REPORT.source_fragment_count, records.length);
  assert.equal(WORLD_BOOK_V2_MIGRATION_REPORT.accounted_input_count, records.length);
  assert.equal(
    Object.values(WORLD_BOOK_V2_MIGRATION_REPORT.input_dispositions).reduce((sum, count) => sum + count, 0),
    records.length
  );

  const allowed = new Set([
    'migrated', 'migrated_primary', 'merged_exact_duplicate', 'merged_complementary'
  ]);
  const seen = new Set();
  for (const entry of WORLD_BOOK_V2_ENTRIES) {
    assert.equal(entry.migration.provenance_complete, true, entry.title);
    assert.equal(entry.source_fragments.length, entry.migration.input_fragment_count, entry.title);
    for (const fragment of entry.source_fragments) {
      assert.ok(allowed.has(fragment.disposition), `${entry.title}: ${fragment.disposition}`);
      const key = `${fragment.source.file}|${fragment.source.export_name}|${fragment.source.entry_index}`;
      assert.equal(seen.has(key), false, `duplicate disposition key ${key}`);
      seen.add(key);
    }
  }
  assert.equal(seen.size, records.length);
});

await test('120-turn main line and 130-turn sibling branch rebuild without cross-branch memory', async () => {
  const {
    compileContinuityAnchors,
    rebuildContinuityFromAncestry
  } = await import('../js/core/continuity-ledger.js');

  const nodes = [];
  let parentId = null;
  for (let turn = 1; turn <= 120; turn++) {
    const id = `main_${turn}`;
    nodes.push({
      id,
      parent_id: parentId,
      branch_id: 'branch_main',
      turn_number: turn,
      game_time: `K064-01-${String(((turn - 1) % 30) + 1).padStart(2, '0')}`,
      continuity_delta: [{
        event_id: `event_main_${turn}`,
        type: 'fact',
        subject_id: 'campaign',
        predicate: 'turn_fact',
        value: `main-${turn}`,
        importance: 3,
        visibility: 'narrator',
        known_by: ['narrator']
      }]
    });
    parentId = id;
  }

  parentId = 'main_80';
  for (let turn = 81; turn <= 130; turn++) {
    const id = `alt_${turn}`;
    nodes.push({
      id,
      parent_id: parentId,
      branch_id: 'branch_alt',
      turn_number: turn,
      game_time: `K064-02-${String(((turn - 81) % 30) + 1).padStart(2, '0')}`,
      continuity_delta: [{
        event_id: `event_alt_${turn}`,
        type: 'fact',
        subject_id: 'campaign',
        predicate: 'turn_fact',
        value: `alt-${turn}`,
        importance: 3,
        visibility: 'narrator',
        known_by: ['narrator']
      }]
    });
    parentId = id;
  }

  const main = rebuildContinuityFromAncestry(nodes, 'main_120', { preferSnapshot: false });
  const alt = rebuildContinuityFromAncestry(nodes, 'alt_130', { preferSnapshot: false });
  assert.equal(main.events.length, 120);
  assert.equal(alt.events.length, 130);
  assert.ok(main.events.every(event => !event.event_id.startsWith('event_alt_')));
  assert.ok(alt.events.every(event => (
    event.sequence <= 80 ? event.event_id.startsWith('event_main_') : event.event_id.startsWith('event_alt_')
  )));
  assert.equal(alt.events.some(event => event.event_id === 'event_main_81'), false);

  const mainFingerprint = JSON.stringify(main.events.map(event => event.event_id));
  const altFingerprint = JSON.stringify(alt.events.map(event => event.event_id));
  for (let switchIndex = 0; switchIndex < 20; switchIndex++) {
    const rebuiltMain = rebuildContinuityFromAncestry(nodes, 'main_120', { preferSnapshot: false });
    const rebuiltAlt = rebuildContinuityFromAncestry(nodes, 'alt_130', { preferSnapshot: false });
    assert.equal(JSON.stringify(rebuiltMain.events.map(event => event.event_id)), mainFingerprint);
    assert.equal(JSON.stringify(rebuiltAlt.events.map(event => event.event_id)), altFingerprint);
  }

  const mainAnchors = compileContinuityAnchors(main, {
    audienceId: 'narrator', branchId: 'branch_main', minImportance: 0
  });
  const altAnchors = compileContinuityAnchors(alt, {
    audienceId: 'narrator', branchId: 'branch_alt', minImportance: 0
  });
  assert.equal(mainAnchors.events.length, 120);
  assert.equal(altAnchors.events.length, 130);
  assert.equal(mainAnchors.branch_id, 'branch_main');
  assert.equal(altAnchors.branch_id, 'branch_alt');
});

console.log(`\nfull-ai-adaptation-integration-regression: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('Failed checks:');
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.error?.message || failure.error}`);
  process.exitCode = 1;
}
