import assert from 'node:assert/strict';

import { LingXiController } from '../js/core/lingxi/lingxi-controller.js';
import { createLingXiTools } from '../js/core/lingxi/lingxi-tools.js';
import {
  LingXiResearchGate,
  inferNarrativeResearchKinds
} from '../js/core/lingxi/research-gate.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createStateManager() {
  const state = {
    _meta: { current_node_id: 'node_7', active_branch: 'branch_main' },
    _agent_story_plan: { branchId: 'branch_main', summary: '调查失踪商队' },
    _story_direction: null,
    _ui: { settings: {} },
    '系统·回合数': 7,
    '玩家·姓名': '测试玩家',
    '世界·地点': '木叶隐村',
    '世界·时间': '木叶52年1月1日'
  };
  const config = {
    backend: 'custom',
    apiUrl: 'https://provider.example/v1',
    apiKey: 'transport-only-secret',
    model: 'test-model'
  };
  return {
    get(path) { return path === undefined ? clone(state) : clone(state[path]); },
    getSub(path) { return clone(state[path]); },
    getAPIConfig() { return clone(config); },
    async getAPIConfigAsync() { return clone(config); }
  };
}

function createTools(gate, calls = []) {
  const stage = name => async value => {
    calls.push({ name, value: clone(value) });
    return { id: `proposal-${name}`, tool: name, params: clone(value) };
  };
  return createLingXiTools({
    stateManager: createStateManager(),
    researchGate: gate,
    projectStateAdapter: {
      async inspect(section) { return { section, nodeId: 'node_7', branchId: 'branch_main', nodes: [] }; }
    },
    stageVariableChange: stage('state_variable_patch'),
    stageOpeningChange: stage('opening'),
    stageWorldbookChange: stage('worldbook'),
    stageStoryDirectionChange: stage('story')
  });
}

function approvalBrokerStub() {
  return {
    listPendingProposals: () => [],
    stageAction: async () => { throw new Error('not used'); },
    approveFromUserEvent: async () => { throw new Error('not used'); },
    discardProposal: () => false
  };
}

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

await test('narrative intent detection returns every requested research category', () => {
  assert.deepEqual(
    inferNarrativeResearchKinds('写一个开局、配套世界书条目和后续剧情'),
    ['opening', 'worldbook', 'story']
  );
  assert.deepEqual(inferNarrativeResearchKinds('润色这段剧情'), ['story']);
  assert.deepEqual(inferNarrativeResearchKinds('编一个卡卡西的故事'), ['story']);
  assert.deepEqual(inferNarrativeResearchKinds('讲一个卡卡西的故事'), ['story']);
  assert.deepEqual(inferNarrativeResearchKinds('描述一段中忍考试场景'), ['story']);
  assert.deepEqual(inferNarrativeResearchKinds('世界书加一条设定'), ['worldbook']);
  assert.deepEqual(inferNarrativeResearchKinds('解释一下世界书是什么'), []);
});

await test('opening, worldbook, and story proposal tools enforce same-turn research prerequisites', async () => {
  const gate = new LingXiResearchGate();
  const calls = [];
  const tools = createTools(gate, calls);

  gate.begin('写一个木叶开局');
  await assert.rejects(
    () => tools.stage_opening_draft.execute({ draft: { player: { name: '风见' } }, startNow: false, reason: '新开局' }),
    error => error?.code === 'LINGXI_RESEARCH_REQUIRED'
  );
  const openingGuide = await tools.search_project_guide.execute({ query: '完全不命中的查询词', category: 'opening' });
  assert.ok(openingGuide.items.length > 0, 'an explicit category falls back to its shipped project rules');
  await tools.inspect_opening_draft.execute({});
  const openingWorldbook = await tools.search_worldbook.execute({ query: '木叶 开局' });
  assert.equal(typeof openingWorldbook.projectContext, 'string');
  await tools.search_canon_database.execute({ query: '木叶 开局', kind: 'all' });
  await tools.stage_opening_draft.execute({ draft: { player: { name: '风见' } }, startNow: false, reason: '新开局' });

  gate.begin('新增一个木叶医院世界书条目');
  await tools.search_project_guide.execute({ query: '世界书规则', category: 'worldbook' });
  await tools.search_worldbook.execute({ query: '木叶医院 医疗忍者' });
  await tools.search_canon_database.execute({ query: '木叶医院 医疗忍者', kind: 'all' });
  await tools.stage_worldbook_entry.execute({
    entry: { title: '木叶医院值班制度', keys: ['木叶医院'], content: '医疗忍者轮班值守。' },
    reason: '补充设定'
  });

  gate.begin('安排下一段调查剧情');
  await tools.search_project_guide.execute({ query: '剧情规则', category: 'story' });
  await tools.inspect_current_state.execute({ section: 'world' });
  await tools.inspect_story_plan.execute({});
  await tools.search_worldbook.execute({ query: '木叶 失踪商队' });
  await tools.search_canon_database.execute({ query: '木叶 失踪商队', kind: 'all' });
  await assert.rejects(
    () => tools.stage_story_direction.execute({ direction: '调查商队失踪地点', reason: '推进调查线' }),
    error => error?.code === 'LINGXI_RESEARCH_REQUIRED'
      && error.details?.missing?.includes('inspect_project_state:timeline')
  );
  await tools.inspect_project_state.execute({ section: 'timeline' });
  await tools.stage_story_direction.execute({ direction: '调查商队失踪地点', reason: '推进调查线' });

  assert.deepEqual(calls.map(call => call.name), ['opening', 'worldbook', 'story']);
});

await test('controller suppresses ungrounded compound and continuation outputs', async () => {
  const generated = '这是未经检索生成的剧情正文。';
  const streamed = [];
  const runtime = {
    configure() {},
    abort() {},
    async runAgent({ onEvent }) {
      onEvent?.({ type: 'text-delta', delta: generated });
      return { text: generated, mode: 'native-tools', trace: [], usage: null };
    }
  };
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime,
    approvalBroker: approvalBrokerStub(),
    storage: { getItem: () => null, setItem() {} }
  });
  const compound = await controller.send('写一个开局、配套世界书和后续剧情', {
    onEvent: event => streamed.push(clone(event))
  });
  assert.equal(compound.mode, 'research-required');
  assert.equal(compound.message.content.includes(generated), false);
  assert.match(compound.message.content, /没有完成项目规定的检索/);
  assert.equal(streamed.some(event => event.type === 'text-delta'), false, 'ungrounded narrative deltas stay hidden');

  const stored = new Map([['naruto_lingxi_session_v1', JSON.stringify([
    { role: 'user', content: '编一个卡卡西执行暗部任务的故事' },
    { role: 'assistant', content: '上一段' }
  ])]]);
  const continuationController = new LingXiController({
    stateManager: createStateManager(),
    runtime,
    approvalBroker: approvalBrokerStub(),
    storage: {
      getItem: key => stored.get(String(key)) || null,
      setItem: (key, value) => stored.set(String(key), String(value))
    }
  });
  const continuation = await continuationController.send('继续');
  assert.equal(continuation.mode, 'research-required');
  assert.equal(continuation.message.content.includes(generated), false);

  const continuedWriting = await continuationController.send('接着写吧');
  assert.equal(continuedWriting.mode, 'research-required');
});

await test('controller rejects a turn that streamed narrative before completing every required lookup', async () => {
  const generated = '卡卡西踏进考场，四周的视线同时转向他。';
  const streamed = [];
  const runtime = {
    configure() {},
    abort() {},
    async runAgent({ tools, onEvent }) {
      onEvent?.({ type: 'text-delta', delta: generated });
      await tools.search_project_guide.execute({ query: '剧情规则', category: 'story' });
      await tools.inspect_current_state.execute({ section: 'world' });
      await tools.inspect_story_plan.execute({});
      await tools.inspect_project_state.execute({ section: 'timeline' });
      await tools.search_worldbook.execute({ query: '卡卡西 中忍考试' });
      return { text: generated, mode: 'native-tools', trace: [], usage: null };
    }
  };
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime,
    approvalBroker: approvalBrokerStub(),
    storage: { getItem: () => null, setItem() {} }
  });

  const result = await controller.send('写一段卡卡西参加中忍考试的剧情', {
    onEvent: event => streamed.push(clone(event))
  });
  assert.equal(result.mode, 'research-required');
  assert.equal(result.message.content.includes(generated), false);
  assert.match(result.message.content, /完成本轮项目检索前就开始生成/);
  assert.equal(streamed.some(event => event.type === 'text-delta'), false);
});

await test('continuation requests inherit the previous narrative topic for relevance checks', async () => {
  const stored = new Map([['naruto_lingxi_session_v1', JSON.stringify([
    { role: 'user', content: '编一个卡卡西参加中忍考试的故事' },
    { role: 'assistant', content: '上一段已经写到考场门口。' }
  ])]]);
  const runtime = {
    configure() {},
    abort() {},
    async runAgent({ tools, onEvent }) {
      await tools.search_project_guide.execute({ query: '剧情规则', category: 'story' });
      await tools.inspect_current_state.execute({ section: 'world' });
      await tools.inspect_story_plan.execute({});
      await tools.inspect_project_state.execute({ section: 'timeline' });
      await tools.search_worldbook.execute({ query: '卡卡西 中忍考试' });
      await tools.search_canon_database.execute({ query: '卡卡西 中忍考试', kind: 'all' });
      onEvent?.({ type: 'text-delta', delta: '续写内容' });
      return { text: '续写内容', mode: 'native-tools', trace: [], usage: null };
    }
  };
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime,
    approvalBroker: approvalBrokerStub(),
    storage: {
      getItem: key => stored.get(String(key)) || null,
      setItem: (key, value) => stored.set(String(key), String(value))
    }
  });

  const result = await controller.send('继续');
  assert.equal(result.mode, 'native-tools');
  assert.equal(result.message.content, '续写内容');
});

await test('research rejection discards every proposal created in the failed turn but preserves older proposals', async () => {
  const pending = [{ id: 'proposal-existing', tool: 'existing' }];
  const discarded = [];
  let sequence = 0;
  const broker = {
    listPendingProposals: () => clone(pending),
    async stageAction(tool, params) {
      const proposal = { id: `proposal-new-${++sequence}`, tool, params: clone(params), diff: [] };
      pending.push(proposal);
      return clone(proposal);
    },
    approveFromUserEvent: async () => { throw new Error('not used'); },
    discardProposal(id) {
      const index = pending.findIndex(proposal => proposal.id === id);
      if (index < 0) return false;
      pending.splice(index, 1);
      discarded.push(id);
      return true;
    }
  };
  const runtime = {
    configure() {},
    abort() {},
    async runAgent({ tools }) {
      await tools.stage_settings_change.execute({ patch: { fontSize: 18 }, reason: '错误轮次中的设置提案' });
      await tools.stage_variable_change.execute({ key: '属性·当前查克拉', value: 50, reason: '错误轮次中的变量提案' });
      return { text: '未经检索的剧情', mode: 'native-tools', trace: [], usage: null };
    }
  };
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime,
    approvalBroker: broker,
    storage: { getItem: () => null, setItem() {} }
  });

  const result = await controller.send('写一段新的任务剧情');
  assert.equal(result.mode, 'research-required');
  assert.deepEqual(discarded.sort(), ['proposal-new-1', 'proposal-new-2']);
  assert.deepEqual(pending.map(proposal => proposal.id), ['proposal-existing']);
  assert.equal(result.proposal, null);
});

await test('worldbook and canon research must overlap the request or inspected project evidence', async () => {
  const gate = new LingXiResearchGate();
  const tools = createTools(gate);
  gate.begin('写一段木叶任务剧情');
  await tools.search_project_guide.execute({ query: '剧情规则', category: 'story' });
  await tools.inspect_current_state.execute({ section: 'world' });
  await tools.inspect_story_plan.execute({});
  await tools.inspect_project_state.execute({ section: 'timeline' });
  await tools.inspect_project_state.execute({ section: 'missions' });
  await tools.search_worldbook.execute({ query: '深海海盗宝藏' });
  assert.ok(gate.missing('story').includes('search_worldbook'));
  await tools.search_canon_database.execute({ query: '深海海盗宝藏', kind: 'all' });
  assert.ok(gate.missing('story').includes('search_canon_database'));
  await tools.search_worldbook.execute({ query: '木叶 任务' });
  await tools.search_canon_database.execute({ query: '木叶 任务', kind: 'all' });
  assert.equal(gate.missing('story').includes('search_worldbook'), false);
  assert.equal(gate.missing('story').includes('search_canon_database'), false);
});

await test('story requests require the state sections explicitly named by the user', async () => {
  const gate = new LingXiResearchGate();
  const tools = createTools(gate);
  gate.begin('写一段任务、羁绊、战斗和回忆剧情');
  await tools.search_project_guide.execute({ query: '剧情规则', category: 'story' });
  await tools.inspect_current_state.execute({ section: 'world' });
  await tools.inspect_story_plan.execute({});
  await tools.inspect_project_state.execute({ section: 'timeline' });
  await tools.search_worldbook.execute({ query: '剧情 回忆 战斗' });
  await tools.search_canon_database.execute({ query: '剧情 回忆 战斗', kind: 'all' });
  assert.deepEqual(
    gate.missing('story').filter(item => item.startsWith('inspect_project_state:')).sort(),
    [
      'inspect_project_state:combat',
      'inspect_project_state:memory',
      'inspect_project_state:missions',
      'inspect_project_state:relationships'
    ]
  );
  for (const section of ['missions', 'relationships', 'combat', 'memory']) {
    await tools.inspect_project_state.execute({ section });
  }
  assert.deepEqual(gate.missing('story'), []);
});

await test('starting a new research turn clears evidence from the previous turn', () => {
  const gate = new LingXiResearchGate();
  gate.begin('第一轮木叶剧情');
  gate.recordProjectGuide('story');
  gate.record('inspect_current_state', { location: '木叶' });
  gate.record('inspect_story_plan', { summary: '木叶调查' });
  gate.record('inspect_project_state:timeline', { nodeId: 'node_7' });
  gate.record('search_worldbook', '木叶');
  gate.record('search_canon_database', '木叶');
  assert.deepEqual(gate.missing('story'), []);
  gate.begin('第二轮');
  assert.ok(gate.missing('story').length > 0);
});

if (failures.length) {
  console.error(`\n${failures.length} Ling Xi research-gate regression test(s) failed; ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi research-gate regression passed (${passed} tests).`);
}
