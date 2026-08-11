import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.customElements ||= { get: () => null };

const { AgentPipeline } = await import('../js/core/agent-pipeline.js');
const { commitGeneratedStoryPlan } = await import('../js/core/pipeline.js');

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

function createPipeline() {
  return new AgentPipeline({
    pipeline: {
      getHistory: () => [],
      getTurnEvidenceView: () => ({ current_state: {}, evidence: [] })
    },
    memorySystem: null
  });
}

function direction(overrides = {}) {
  return {
    branchId: 'branch_main',
    direction: '让队伍逐步发现边境村落的失踪线索',
    goals: ['保留调查与交涉两条路线', '让同伴关系自然升温'],
    avoid: ['强制牺牲同伴', '替玩家接受任务'],
    updatedAt: '2026-08-07T12:00:00.000Z',
    ...overrides
  };
}

function stateWithDirection(value = direction(), branchId = 'branch_main') {
  return {
    '世界·时间': 'K052-01-01',
    '系统·回合数': 8,
    _meta: { active_branch: branchId, current_node_id: `node:${branchId}` },
    _story_direction: value
  };
}

function sceneBrief() {
  return {
    id: 'scene:test',
    location: '火之国边境',
    time: 'K052-01-01',
    participants: ['测试忍者'],
    playerIntent: '继续调查',
    facts: ['村口留下未辨明的足迹'],
    constraints: ['角色行动由角色代理决定'],
    tensions: ['失踪者仍未找到'],
    evidenceRefs: ['state:test']
  };
}

function rawStoryPlan() {
  return {
    premise: '围绕边境失踪事件保留开放调查路线',
    days: [0, 1, 2].map(dayOffset => ({
      dayOffset,
      date: `K052-01-0${dayOffset + 1}`,
      pressures: ['若线索中断，幕后势力可能转移活动地点'],
      opportunities: ['若角色选择继续调查，可发现新的分支信息'],
      triggers: ['玩家或相关角色主动接触现有线索时'],
      invalidationConditions: ['关键前提改变或角色选择离开时']
    })),
    refreshTriggers: ['日期变化', '重大分歧', '切换分支']
  };
}

function assertPreferenceGuard(text) {
  assert.match(text, /用户已批准的剧情方向偏好/);
  assert.match(text, /不是已经发生的剧情/);
  assert.match(text, /不得因此强迫玩家或 NPC 行动/);
  assert.match(text, /边境村落的失踪线索/);
  assert.match(text, /强制牺牲同伴/);
}

await test('story direction is visible only on its bound branch and supports branch maps', () => {
  const pipeline = createPipeline();
  const main = pipeline._getStoryDirection(stateWithDirection());
  assert.equal(main.branchId, 'branch_main');
  assert.deepEqual(main.goals, ['保留调查与交涉两条路线', '让同伴关系自然升温']);

  const alt = pipeline._getStoryDirection(stateWithDirection(direction(), 'branch_alt'));
  assert.equal(alt, null, 'a main-branch preference must not leak into an alternate branch');

  const mapped = pipeline._getStoryDirection(stateWithDirection({
    byBranch: {
      branch_alt: direction({ branchId: 'branch_alt', direction: '调查另一处遗迹' })
    }
  }, 'branch_alt'));
  assert.equal(mapped.direction, '调查另一处遗迹');
  assert.equal(mapped.branchId, 'branch_alt');
});

await test('direction fingerprint invalidates stage cache and rolling story plans', () => {
  const pipeline = createPipeline();
  const firstState = stateWithDirection();
  const firstKey = pipeline._stageCacheKey(firstState, '继续调查');
  const firstPlan = pipeline._fallbackStoryPlan(firstState, sceneBrief());

  assert.equal(pipeline._shouldRefreshStoryPlan(firstState, '继续调查', firstPlan), false);
  assert.match(firstPlan.id, /:sd-/);

  const changedState = stateWithDirection(direction({
    direction: '优先寻找能和平交换情报的中立忍者',
    updatedAt: '2026-08-07T12:30:00.000Z'
  }));
  assert.notEqual(pipeline._stageCacheKey(changedState, '继续调查'), firstKey);
  assert.equal(pipeline._shouldRefreshStoryPlan(changedState, '继续调查', firstPlan), true);

  const removedState = stateWithDirection(null);
  assert.equal(pipeline._shouldRefreshStoryPlan(removedState, '继续调查', firstPlan), true);
});

await test('committing a replacement story plan clears the invalidation marker', () => {
  const writes = [];
  const manager = {
    setSub(key, value) { writes.push({ key, value: structuredClone(value) }); }
  };
  const plan = { id: 'replacement-plan', branchId: 'branch_main', days: [{}, {}, {}] };

  assert.equal(commitGeneratedStoryPlan(manager, plan), true);
  assert.deepEqual(writes, [
    { key: '_agent_story_plan', value: plan },
    { key: '_agent_story_plan_invalidated', value: false }
  ]);
  assert.equal(commitGeneratedStoryPlan(manager, null), false);
  assert.equal(writes.length, 2);
});

await test('native story planner receives the preference as conditional future context', async () => {
  const pipeline = createPipeline();
  let request = null;
  pipeline._createToolRuntime = () => ({
    runAgent: async params => {
      request = params;
      return { output: rawStoryPlan() };
    },
    abort() {}
  });
  pipeline._releaseToolRuntime = () => {};

  const plan = await pipeline._generateStoryPlan(
    stateWithDirection(),
    '继续调查',
    sceneBrief(),
    { sources: [], cache: {}, items: [] }
  );

  assertPreferenceGuard(request.messages[0].content);
  assert.match(plan.premise, /开放调查路线/);
  assert.equal(pipeline._shouldRefreshStoryPlan(stateWithDirection(), '继续调查', plan), false);
});

await test('compatibility story planner receives the same bounded preference context', async () => {
  const pipeline = createPipeline();
  let params = null;
  pipeline._createToolRuntime = () => ({
    runAgent: async () => { throw new Error('native unavailable'); },
    abort() {}
  });
  pipeline._releaseToolRuntime = () => {};
  pipeline.runner.run = async (type, received) => {
    assert.equal(type, 'story-planner');
    params = received;
    return rawStoryPlan();
  };

  await pipeline._generateStoryPlan(
    stateWithDirection(),
    '继续调查',
    sceneBrief(),
    { sources: [], cache: {}, items: [] }
  );

  assertPreferenceGuard(params.taskPrompt);
  assert.equal(params.extraContext.storyDirection.branchId, 'branch_main');
  assert.deepEqual(params.extraContext.storyDirection.avoid, ['强制牺牲同伴', '替玩家接受任务']);
});

await test('brainstormer and outliner receive the preference without actor authority', async () => {
  const pipeline = createPipeline();
  const calls = new Map();
  pipeline.runner.run = async (type, params) => {
    calls.set(type, params);
    if (type === 'brainstormer') {
      return {
        candidates: [{
          id: 1,
          direction: '从足迹开始调查',
          reason: '保留多种选择',
          risk: 'low'
        }],
        recommended: 1
      };
    }
    if (type === 'outliner') {
      return {
        beats: [{
          id: 1,
          scene: '足迹延伸到两条岔路前',
          tension: '线索可能被风雪掩埋',
          participants: [],
          openQuestion: '玩家会选择哪条路线',
          mood: '紧张',
          variables: ['event']
        }]
      };
    }
    throw new Error(`unexpected agent: ${type}`);
  };

  const state = stateWithDirection();
  const selected = await pipeline._brainstorm(state, '继续调查');
  await pipeline._generateOutline(state, '继续调查', selected, {
    sceneBrief: sceneBrief(),
    storyPlan: pipeline._fallbackStoryPlan(state, sceneBrief()),
    preflight: { sources: [], cache: {} }
  });

  for (const type of ['brainstormer', 'outliner']) {
    const params = calls.get(type);
    assertPreferenceGuard(params.taskPrompt);
    assert.equal(params.extraContext.storyDirection.branchId, 'branch_main');
  }
});

console.log(`\nstory-direction-planning-regression: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  throw new AggregateError(
    failures.map(item => item.error),
    `${failures.length} story direction planning regression test(s) failed`
  );
}
