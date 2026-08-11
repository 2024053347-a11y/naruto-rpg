import assert from 'node:assert/strict';

import { ToolApprovalBroker } from '../js/core/lingxi/approval-broker.js';
import {
  LINGXI_ACTION_IMPACT_SCHEMA,
  LINGXI_OPENING_TOOL,
  LINGXI_SETTINGS_TOOL,
  LINGXI_STORY_DIRECTION_TOOL,
  LINGXI_WORLDBOOK_TOOL,
  OpeningActionAdapter,
  StoryDirectionActionAdapter,
  UISettingsActionAdapter,
  WorldbookActionAdapter
} from '../js/core/lingxi/adapters/project-write-adapters.js';
import { START_PRESET_V2_KEY } from '../js/systems/opening-draft.js';
import { stateManager as realStateManager } from '../js/core/state-manager.js';
import { hashCanonical } from '../js/core/lingxi/action-proposal.js';

function clone(value) {
  return structuredClone(value);
}

function baseState(overrides = {}) {
  return {
    _meta: { current_node_id: null, active_branch: 'branch_main' },
    _opening_contract: null,
    _story_direction: null,
    _agent_story_plan: null,
    _agent_story_plan_invalidated: false,
    _ui: {
      settings: {
        themePreset: 'konoha',
        fontPreset: 'system',
        fontSize: 16,
        lineHeight: 1.85,
        chatMaxWidth: 800,
        musicVolume: 45,
        reasoningOpen: true
      }
    },
    '系统·回合数': 0,
    '系统·当前节点': null,
    '系统·当前分支': 'branch_main',
    '玩家·姓名': '',
    ...overrides
  };
}

function storyState(overrides = {}) {
  return baseState({
    _meta: { current_node_id: 'node_story_current', active_branch: 'branch_main' },
    '系统·当前节点': 'node_story_current',
    ...overrides
  });
}

function previewOpening(mutator) {
  return (draft, before) => {
    const next = clone(before);
    mutator(next, draft);
    return next;
  };
}

function storyTimeline(manager, { error = null, hook = null } = {}) {
  let persistedSnapshot = manager.snapshot();
  const calls = [];
  return {
    calls,
    async persistCurrentStoryState(payload) {
      calls.push(clone(payload));
      hook?.({ manager, payload: clone(payload) });
      if (error) throw error;
      assert.equal(payload.expectedNodeId, persistedSnapshot._meta.current_node_id);
      assert.equal(payload.expectedBranchId, persistedSnapshot._meta.active_branch);
      assert.deepEqual({
        direction: persistedSnapshot._story_direction,
        plan: persistedSnapshot._agent_story_plan,
        invalidated: persistedSnapshot._agent_story_plan_invalidated === true
      }, payload.before);
      persistedSnapshot._story_direction = clone(payload.after.direction);
      persistedSnapshot._agent_story_plan = clone(payload.after.plan);
      persistedSnapshot._agent_story_plan_invalidated = payload.after.invalidated === true;
      return { status: 'updated', nodeId: payload.expectedNodeId };
    },
    restorePersistedState() {
      manager.restore(persistedSnapshot);
    }
  };
}

class MemoryManager {
  constructor(state = baseState()) {
    this.state = clone(state);
    this.nodes = [];
    this.updateCalls = 0;
    this.prefSaveCalls = 0;
    this.subWrites = [];
    this.restoreCalls = 0;
  }

  snapshot() { return clone(this.state); }
  get(key) { return key === undefined ? clone(this.state) : clone(this.state[key]); }
  getSub(key) { return clone(this.state[key]); }
  getAPIConfig() { return {}; }
  async saveAPIConfig() {}
  update(updates) {
    this.updateCalls += 1;
    for (const update of updates) {
      if (update.key === '_ui.settings') this.state._ui.settings = clone(update.value);
      else this.state[update.key] = clone(update.value);
    }
  }
  async saveUIPrefs() { this.prefSaveCalls += 1; }
  setSub(key, value) {
    this.subWrites.push({ key, value: clone(value) });
    this.state[key] = clone(value);
  }
  restore(snapshot) {
    this.restoreCalls += 1;
    this.state = clone(snapshot);
  }
  async dbGetAll(store) {
    assert.equal(store, 'timeline_nodes');
    return clone(this.nodes);
  }
}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.writeCalls = [];
    this.removeCalls = [];
    this.throwAfterNextSet = false;
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    this.writeCalls.push({ key, value: String(value) });
    this.values.set(key, String(value));
    if (this.throwAfterNextSet) {
      this.throwAfterNextSet = false;
      throw new Error('simulated storage failure');
    }
  }
  removeItem(key) { this.removeCalls.push(key); this.values.delete(key); }
  seed(key, value) { this.values.set(key, String(value)); }
}

const trustedEvent = Object.freeze({ test: 'trusted-approval-ui' });

function brokerFor(adapter) {
  return new ToolApprovalBroker({
    adapters: [adapter],
    now: () => 1_780_000_000_000,
    isTrustedUserEvent: event => event === trustedEvent
  });
}

function errorCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

function assertImpact(proposal, kind) {
  assert.deepEqual(Object.keys(proposal.context), ['actionImpact']);
  assert.deepEqual(Object.keys(proposal.context.actionImpact), ['details', 'kind', 'schema', 'summary']);
  assert.equal(proposal.context.actionImpact.schema, LINGXI_ACTION_IMPACT_SCHEMA);
  assert.equal(proposal.context.actionImpact.kind, kind);
  assert.equal(typeof proposal.context.actionImpact.summary, 'string');
  assert.ok(proposal.context.actionImpact.summary.length > 0);
  assert.ok(Array.isArray(proposal.context.actionImpact.details));
}

let passed = 0;
const failures = [];

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

await test('all four adapters expose the dedicated approval tool names', () => {
  const manager = new MemoryManager();
  const storage = new MemoryStorage();
  const entries = [];
  const knowledgeBase = {
    saveCustomEntries(next) { entries.splice(0, entries.length, ...clone(next)); },
    invalidateCache() {}
  };
  const adapters = [
    new UISettingsActionAdapter({ stateManager: manager }),
    new OpeningActionAdapter({
      stateManager: manager,
      storage,
      readTimelineNodes: () => manager.nodes,
      initializeOpening: () => ({}),
      emitCharacterCreated: () => {}
    }),
    new WorldbookActionAdapter({ knowledgeBase, readCustomEntries: () => entries }),
    new StoryDirectionActionAdapter({ stateManager: manager })
  ];
  assert.deepEqual(adapters.map(adapter => adapter.toolName), [
    LINGXI_SETTINGS_TOOL,
    LINGXI_OPENING_TOOL,
    LINGXI_WORLDBOOK_TOOL,
    LINGXI_STORY_DIRECTION_TOOL
  ]);
});

await test('settings stage is zero-write, signed, whitelisted, and supports low-risk background apply', async () => {
  const manager = new MemoryManager();
  const liveApplications = [];
  const adapter = new UISettingsActionAdapter({
    stateManager: manager,
    applySettings(settings) { liveApplications.push(clone(settings)); }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_SETTINGS_TOOL, {
    patch: { fontSize: 18, reasoningOpen: false },
    reason: '让阅读区域更舒服'
  });

  assert.equal(manager.updateCalls, 0);
  assert.equal(manager.prefSaveCalls, 0);
  assertImpact(proposal, 'settings');
  assert.deepEqual(proposal.diff.map(entry => entry.path), [
    '/_ui/settings/fontSize',
    '/_ui/settings/reasoningOpen'
  ]);
  await assert.rejects(() => adapter.apply(proposal), errorCode('LINGXI_APPROVAL_REQUIRED'));
  assert.equal(manager.updateCalls, 0);

  const receipt = await broker.applyLowRiskProposal(proposal.id);
  assert.equal(manager.state._ui.settings.fontSize, 18);
  assert.equal(manager.state._ui.settings.reasoningOpen, false);
  assert.equal(manager.updateCalls, 1);
  assert.equal(manager.prefSaveCalls, 1);
  assert.equal(liveApplications.length, 1);
  assert.equal(liveApplications[0].fontSize, 18);
  assert.equal(receipt.uiApplied, true);
});

await test('settings reject credentials and reject a stale target without writing', async () => {
  const manager = new MemoryManager();
  const adapter = new UISettingsActionAdapter({ stateManager: manager });
  const broker = brokerFor(adapter);
  await assert.rejects(
    () => broker.stageAction(LINGXI_SETTINGS_TOOL, { patch: { apiKey: 'secret' }, reason: 'bad' }),
    errorCode('LINGXI_SETTING_NOT_WHITELISTED')
  );

  const proposal = await broker.stageAction(LINGXI_SETTINGS_TOOL, {
    patch: { musicVolume: 20 }, reason: '调低声音'
  });
  manager.state._ui.settings.fontSize = 17;
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(manager.state._ui.settings.musicVolume, 45);
  assert.equal(manager.updateCalls, 0);
});

await test('opening save mode stages without writes and stores the normalized v2 preset after approval', async () => {
  const manager = new MemoryManager();
  const storage = new MemoryStorage();
  let initializeCalls = 0;
  let emitted = 0;
  const adapter = new OpeningActionAdapter({
    stateManager: manager,
    storage,
    readTimelineNodes: () => manager.nodes,
    initializeOpening: () => { initializeCalls += 1; return {}; },
    previewOpening: (_draft, before) => clone(before),
    emitCharacterCreated: () => { emitted += 1; }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
    mode: 'save',
    draft: { identity: { name: '青禾' }, campaign: { goal: '成为医疗忍者' } },
    reason: '保存开局草稿'
  });

  assert.equal(storage.writeCalls.length, 0);
  assert.equal(initializeCalls, 0);
  assert.equal(emitted, 0);
  assertImpact(proposal, 'opening');
  assert.equal(proposal.params.mode, 'save');
  assert.equal(proposal.params.draft.version, 3);

  await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' });
  assert.equal(storage.writeCalls.length, 1);
  assert.equal(storage.writeCalls[0].key, START_PRESET_V2_KEY);
  const saved = JSON.parse(storage.getItem(START_PRESET_V2_KEY));
  assert.equal(saved.version, 3);
  assert.equal(saved.draft.identity.name, '青禾');
  assert.equal(initializeCalls, 0);
  assert.equal(emitted, 0);
});

await test('opening start mode refuses existing games and rechecks emptiness before applying', async () => {
  {
    const manager = new MemoryManager(baseState({ '系统·回合数': 2, '玩家·姓名': '已有角色' }));
    const storage = new MemoryStorage();
    const adapter = new OpeningActionAdapter({
      stateManager: manager,
      storage,
      readTimelineNodes: () => manager.nodes,
      initializeOpening: () => ({}),
      emitCharacterCreated: () => {}
    });
    await assert.rejects(
      () => brokerFor(adapter).stageAction(LINGXI_OPENING_TOOL, {
        mode: 'start', draft: { identity: { name: '覆盖尝试' } }, reason: '不应覆盖'
      }),
      errorCode('LINGXI_OPENING_NOT_EMPTY')
    );
    assert.equal(storage.writeCalls.length, 0);
  }

  const manager = new MemoryManager();
  const storage = new MemoryStorage();
  let initializeCalls = 0;
  let emitted = 0;
  const adapter = new OpeningActionAdapter({
    stateManager: manager,
    storage,
    readTimelineNodes: () => manager.nodes,
    initializeOpening: () => { initializeCalls += 1; return {}; },
    previewOpening: (_draft, before) => clone(before),
    emitCharacterCreated: () => { emitted += 1; }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
    mode: 'start', draft: { identity: { name: '青禾' } }, reason: '立即开局'
  });
  manager.nodes.push({ id: 'node_concurrent' });
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_OPENING_NOT_EMPTY')
  );
  assert.equal(storage.writeCalls.length, 0);
  assert.equal(initializeCalls, 0);
  assert.equal(emitted, 0);
});

await test('approved opening start initializes exactly once and emits character:created exactly once', async () => {
  const manager = new MemoryManager();
  const storage = new MemoryStorage();
  const initializedDrafts = [];
  const events = [];
  const buildInitialized = previewOpening((state, draft) => {
    state['玩家·姓名'] = draft.identity.name;
    state['系统·回合数'] = 1;
    state._opening_contract = { schema: 'test-opening-contract' };
  });
  const adapter = new OpeningActionAdapter({
    stateManager: manager,
    storage,
    readTimelineNodes: () => manager.nodes,
    initializeOpening(draft) {
      initializedDrafts.push(clone(draft));
      manager.state['玩家·姓名'] = draft.identity.name;
      manager.state['系统·回合数'] = 1;
      manager.state._opening_contract = { schema: 'test-opening-contract' };
      return manager.snapshot();
    },
    previewOpening: buildInitialized,
    emitCharacterCreated(payload) { events.push(clone(payload)); }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
    mode: 'start', draft: { identity: { name: '青禾' } }, reason: '开始游戏'
  });

  assert.equal(proposal.diff.some(entry => entry.path === '/game/opening'), false);
  assert.deepEqual(
    proposal.diff.find(entry => entry.path === '/玩家·姓名'),
    { path: '/玩家·姓名', operation: 'replace', before: '', after: '青禾' }
  );
  assert.equal(proposal.diff.some(entry => entry.path === '/系统·回合数'), true);
  assert.deepEqual(
    proposal.diff.find(entry => entry.path === '/_opening_contract'),
    {
      path: '/_opening_contract',
      operation: 'replace',
      before: null,
      after: { schema: 'test-opening-contract' }
    }
  );

  await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' });
  assert.equal(initializedDrafts.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, '青禾');
  assert.deepEqual(events[0].contract, { schema: 'test-opening-contract' });
  assert.equal(storage.writeCalls.length, 1);
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_REPLAYED')
  );
  assert.equal(initializedDrafts.length, 1);
  assert.equal(events.length, 1);
});

await test('opening start rolls back when the real initializer writes outside the approved exact diff', async () => {
  const manager = new MemoryManager();
  const before = manager.snapshot();
  const storage = new MemoryStorage();
  let emitted = 0;
  const adapter = new OpeningActionAdapter({
    stateManager: manager,
    storage,
    readTimelineNodes: () => manager.nodes,
    previewOpening: previewOpening((state, draft) => {
      state['玩家·姓名'] = draft.identity.name;
      state['系统·回合数'] = 1;
    }),
    initializeOpening(draft) {
      manager.state['玩家·姓名'] = draft.identity.name;
      manager.state['系统·回合数'] = 1;
      manager.state._unexpected_initializer_write = 'not-approved';
      return manager.snapshot();
    },
    emitCharacterCreated() { emitted += 1; }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
    mode: 'start', draft: { identity: { name: '青禾' } }, reason: '差异守卫测试'
  });

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_OPENING_DIFF_MISMATCH')
  );
  assert.deepEqual(manager.snapshot(), before);
  assert.equal(storage.getItem(START_PRESET_V2_KEY), null);
  assert.equal(emitted, 0);
});

await test('opening start restores the exact state when initialization fails partway', async () => {
  const manager = new MemoryManager();
  const before = manager.snapshot();
  const oldPreset = JSON.stringify({ version: 3, draft: { identity: { name: '旧草稿' } } });
  const storage = new MemoryStorage({ [START_PRESET_V2_KEY]: oldPreset });
  let emitted = 0;
  const adapter = new OpeningActionAdapter({
    stateManager: manager,
    storage,
    readTimelineNodes: () => manager.nodes,
    initializeOpening() {
      manager.state['玩家·姓名'] = '半初始化角色';
      manager.state['系统·回合数'] = 1;
      throw new Error('simulated initialize failure');
    },
    previewOpening: previewOpening(state => {
      state['玩家·姓名'] = '半初始化角色';
      state['系统·回合数'] = 1;
    }),
    emitCharacterCreated() { emitted += 1; }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
    mode: 'start', draft: { identity: { name: '青禾' } }, reason: '回滚测试'
  });

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    /simulated initialize failure/
  );
  assert.deepEqual(manager.snapshot(), before);
  assert.equal(manager.restoreCalls, 1);
  assert.equal(storage.getItem(START_PRESET_V2_KEY), oldPreset);
  assert.equal(storage.writeCalls.length, 0);
  assert.equal(emitted, 0);
});

await test('opening start restores both state and preset when preset storage fails after writing', async () => {
  const manager = new MemoryManager();
  const before = manager.snapshot();
  const oldPreset = JSON.stringify({ version: 3, draft: { identity: { name: '旧草稿' } } });
  const storage = new MemoryStorage({ [START_PRESET_V2_KEY]: oldPreset });
  let initializeCalls = 0;
  let emitted = 0;
  const adapter = new OpeningActionAdapter({
    stateManager: manager,
    storage,
    readTimelineNodes: () => manager.nodes,
    initializeOpening(draft) {
      initializeCalls += 1;
      manager.state['玩家·姓名'] = draft.identity.name;
      manager.state['系统·回合数'] = 1;
      return manager.snapshot();
    },
    previewOpening: previewOpening((state, draft) => {
      state['玩家·姓名'] = draft.identity.name;
      state['系统·回合数'] = 1;
    }),
    emitCharacterCreated() { emitted += 1; }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
    mode: 'start', draft: { identity: { name: '青禾' } }, reason: '存储失败回滚测试'
  });
  storage.throwAfterNextSet = true;

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    /simulated storage failure/
  );
  assert.equal(initializeCalls, 1);
  assert.deepEqual(manager.snapshot(), before);
  assert.equal(manager.restoreCalls, 1);
  assert.equal(storage.getItem(START_PRESET_V2_KEY), oldPreset);
  assert.equal(storage.writeCalls.length, 2);
  assert.equal(emitted, 0);
});

await test('default opening preview exactly matches the real initializer including equipment and contract writes', async () => {
  const originalState = realStateManager.snapshot();
  const originalVersion = realStateManager._stateVersion;
  const storage = new MemoryStorage();
  let emitted = 0;
  try {
    realStateManager.state = realStateManager.getDefaultState();
    realStateManager._stateVersion = originalVersion + 1;
    const before = realStateManager.snapshot();
    const adapter = new OpeningActionAdapter({
      stateManager: realStateManager,
      storage,
      readTimelineNodes: () => [],
      emitCharacterCreated() { emitted += 1; }
    });
    const broker = brokerFor(adapter);
    const proposal = await broker.stageAction(LINGXI_OPENING_TOOL, {
      mode: 'start',
      draft: { identity: { name: '青禾' } },
      reason: '真实初始化精确差异测试'
    });

    assert.deepEqual(realStateManager.snapshot(), before);
    assert.equal(proposal.diff.some(entry => entry.path === '/game/opening'), false);
    assert.equal(proposal.diff.some(entry => entry.path === '/玩家·姓名'), true);
    assert.equal(proposal.diff.some(entry => entry.path === '/_opening_contract'), true);
    const receipt = await broker.approveFromUserEvent(trustedEvent, {
      proposalId: proposal.id,
      confirmation: 'yes'
    });
    assert.deepEqual(receipt.diff, proposal.diff);
    assert.equal(realStateManager.get('玩家·姓名'), '青禾');
    assert.equal(emitted, 1);
  } finally {
    realStateManager.state = originalState;
    realStateManager._stateVersion = originalVersion + 2;
  }
});

await test('worldbook stage is zero-write and approval upserts one custom title without losing others', async () => {
  const entries = [{ title: '旧条目', keys: ['旧'], content: '保留我', category: 'custom', enabled: true, source: 'custom' }];
  let saveCalls = 0;
  let invalidations = 0;
  const knowledgeBase = {
    saveCustomEntries(next) {
      saveCalls += 1;
      entries.splice(0, entries.length, ...clone(next));
    },
    invalidateCache() { invalidations += 1; }
  };
  const adapter = new WorldbookActionAdapter({
    knowledgeBase,
    readCustomEntries: () => ({ entries, fingerprintSource: entries })
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    entry: {
      title: '听风秘术',
      keys: ['听风', '风铃一族', '听风'],
      content: '通过风声感知附近的生命气息。',
      category: '秘术',
      enabled: true
    },
    reason: '补充自定义设定'
  });

  assert.equal(saveCalls, 0);
  assert.equal(invalidations, 0);
  assertImpact(proposal, 'worldbook');
  assert.deepEqual(proposal.params.entry.keys, ['听风', '风铃一族']);
  await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' });
  assert.equal(saveCalls, 1);
  assert.equal(invalidations, 1);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].content, '保留我');
  assert.equal(entries[1].title, '听风秘术');
  assert.equal(entries[1].source, 'custom');
});

await test('worldbook rejects invalid entries and stale custom data without overwriting user data', async () => {
  const entries = [];
  let saveCalls = 0;
  const knowledgeBase = {
    saveCustomEntries(next) { saveCalls += 1; entries.splice(0, entries.length, ...clone(next)); },
    invalidateCache() {}
  };
  const adapter = new WorldbookActionAdapter({ knowledgeBase, readCustomEntries: () => entries });
  const broker = brokerFor(adapter);
  await assert.rejects(
    () => broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
      entry: { title: '空条目', keys: [], content: '内容' }, reason: '无效'
    }),
    errorCode('LINGXI_WORLDBOOK_INVALID')
  );
  const proposal = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    entry: { title: '目标', keys: ['目标'], content: '批准内容' }, reason: '更新'
  });
  entries.push({ title: '并发新增', keys: ['并发'], content: '必须保留' });
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(saveCalls, 0);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '并发新增');
});

await test('worldbook entry actions require an exact inspected target and can enable, disable, or delete it', async () => {
  const entries = [
    { title: '同名条目', keys: ['甲'], content: '第一条', enabled: true, source: 'custom' },
    { title: '同名条目', keys: ['乙'], content: '第二条', enabled: false, source: 'custom' }
  ];
  let saveCalls = 0;
  const knowledgeBase = {
    saveCustomEntries(next) { saveCalls += 1; entries.splice(0, entries.length, ...clone(next)); },
    invalidateCache() {}
  };
  const adapter = new WorldbookActionAdapter({ knowledgeBase, readCustomEntries: () => entries });
  const broker = brokerFor(adapter);

  const secondTarget = {
    index: 1,
    title: entries[1].title,
    fingerprint: await hashCanonical(entries[1])
  };
  const enableProposal = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    action: 'enable', target: secondTarget, reason: '重新挂载第二条同名设定'
  });
  assert.equal(saveCalls, 0);
  assert.deepEqual(enableProposal.diff, [{
    path: '/worldbook/custom/1/enabled', operation: 'replace', before: false, after: true
  }]);
  await broker.approveFromUserEvent(trustedEvent, { proposalId: enableProposal.id, confirmation: 'yes' });
  assert.equal(entries[0].enabled, true);
  assert.equal(entries[1].enabled, true);

  const firstTarget = {
    index: 0,
    title: entries[0].title,
    fingerprint: await hashCanonical(entries[0])
  };
  const disableProposal = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    action: 'disable', target: firstTarget, reason: '暂时停用第一条同名设定'
  });
  await broker.approveFromUserEvent(trustedEvent, { proposalId: disableProposal.id, confirmation: 'yes' });
  assert.equal(entries[0].enabled, false);
  assert.equal(entries[1].content, '第二条');

  const deleteTarget = {
    index: 0,
    title: entries[0].title,
    fingerprint: await hashCanonical(entries[0])
  };
  const deleteProposal = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    action: 'delete', target: deleteTarget, reason: '删除第一条同名设定'
  });
  assert.match(deleteProposal.context.actionImpact.summary, /删除/);
  await broker.approveFromUserEvent(trustedEvent, { proposalId: deleteProposal.id, confirmation: 'yes' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].content, '第二条');
  assert.equal(saveCalls, 3);
});

await test('worldbook entry actions reject invented or stale targets before staging any write', async () => {
  const entries = [{ title: '目标', keys: ['目标'], content: '旧内容', enabled: true, source: 'custom' }];
  let saveCalls = 0;
  const knowledgeBase = {
    saveCustomEntries(next) { saveCalls += 1; entries.splice(0, entries.length, ...clone(next)); },
    invalidateCache() {}
  };
  const adapter = new WorldbookActionAdapter({ knowledgeBase, readCustomEntries: () => entries });
  const broker = brokerFor(adapter);
  const target = { index: 0, title: '目标', fingerprint: await hashCanonical(entries[0]) };
  entries[0].content = '用户刚刚改过的内容';

  await assert.rejects(
    () => broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
      action: 'delete', target, reason: '不能误删并发修改'
    }),
    errorCode('LINGXI_WORLDBOOK_TARGET_STALE')
  );
  await assert.rejects(
    () => broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
      action: 'disable',
      target: { index: 9, title: '虚构条目', fingerprint: `sha256:${'0'.repeat(64)}` },
      reason: '拒绝虚构目标'
    }),
    errorCode('LINGXI_WORLDBOOK_TARGET_STALE')
  );
  assert.equal(saveCalls, 0);
  assert.equal(entries[0].content, '用户刚刚改过的内容');
});

await test('worldbook bulk actions stage the full exact diff and require separate approvals', async () => {
  const entries = [
    { title: '甲', keys: ['甲'], content: '甲', enabled: true, source: 'custom' },
    { title: '乙', keys: ['乙'], content: '乙', enabled: false, source: 'custom' },
    { title: '丙', keys: ['丙'], content: '丙', enabled: true, source: 'custom' }
  ];
  let saveCalls = 0;
  const knowledgeBase = {
    saveCustomEntries(next) { saveCalls += 1; entries.splice(0, entries.length, ...clone(next)); },
    invalidateCache() {}
  };
  const adapter = new WorldbookActionAdapter({ knowledgeBase, readCustomEntries: () => entries });
  const broker = brokerFor(adapter);

  const disableAll = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    action: 'disable_all', reason: '暂停全部自定义设定'
  });
  assert.equal(disableAll.diff.length, 2);
  assert.equal(saveCalls, 0);
  await broker.approveFromUserEvent(trustedEvent, { proposalId: disableAll.id, confirmation: 'yes' });
  assert.equal(entries.every(entry => entry.enabled === false), true);

  const deleteAll = await broker.stageAction(LINGXI_WORLDBOOK_TOOL, {
    action: 'delete_all', reason: '恢复默认世界书'
  });
  assert.equal(deleteAll.diff.length, 3);
  assert.match(deleteAll.context.actionImpact.summary, /删除全部/);
  assert.equal(entries.length, 3);
  await broker.approveFromUserEvent(trustedEvent, { proposalId: deleteAll.id, confirmation: 'yes' });
  assert.equal(entries.length, 0);
  assert.equal(saveCalls, 2);
});

await test('story direction is branch-bound, persisted to the current node, clears the old plan, and marks planning invalidated', async () => {
  const manager = new MemoryManager(storyState({
    _agent_story_plan: { id: 'old-plan', branchId: 'branch_main' }
  }));
  const timeline = storyTimeline(manager);
  const adapter = new StoryDirectionActionAdapter({ stateManager: manager, timelineSystem: timeline });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_STORY_DIRECTION_TOOL, {
    direction: '先调查风铃一族的失踪案，再决定是否卷入大战',
    goals: ['结识可靠同伴', '查明家族秘密'],
    avoid: ['强制背叛同伴'],
    reason: '让后续剧情贴近玩家期待'
  });

  assert.equal(manager.subWrites.length, 0);
  assertImpact(proposal, 'story');
  assert.equal(proposal.params.branchId, 'branch_main');
  await broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' });
  assert.deepEqual(manager.state._story_direction, {
    branchId: 'branch_main',
    direction: '先调查风铃一族的失踪案，再决定是否卷入大战',
    goals: ['结识可靠同伴', '查明家族秘密'],
    avoid: ['强制背叛同伴'],
    updatedAt: proposal.params.updatedAt
  });
  assert.equal(manager.state._agent_story_plan, null);
  assert.equal(manager.state._agent_story_plan_invalidated, true);
  assert.deepEqual(manager.subWrites.map(write => write.key), [
    '_story_direction', '_agent_story_plan', '_agent_story_plan_invalidated'
  ]);
  assert.equal(timeline.calls.length, 1);
  timeline.restorePersistedState();
  assert.equal(manager.state._story_direction.direction, '先调查风铃一族的失踪案，再决定是否卷入大战');
  assert.equal(manager.state._agent_story_plan, null);
  assert.equal(manager.state._agent_story_plan_invalidated, true);
});

await test('story direction rejects a branch switch after staging with zero writes', async () => {
  const manager = new MemoryManager(storyState());
  const timeline = storyTimeline(manager);
  const adapter = new StoryDirectionActionAdapter({ stateManager: manager, timelineSystem: timeline });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_STORY_DIRECTION_TOOL, {
    direction: '留在木叶发展医疗忍术', reason: '分支绑定测试'
  });
  manager.state._meta.active_branch = 'branch_alt';
  manager.state['系统·当前分支'] = 'branch_alt';
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(manager.subWrites.length, 0);
  assert.equal(manager.state._story_direction, null);
  assert.equal(timeline.calls.length, 0);
});

await test('story direction rejects a same-branch node switch after staging', async () => {
  const manager = new MemoryManager(storyState());
  const timeline = storyTimeline(manager);
  const adapter = new StoryDirectionActionAdapter({ stateManager: manager, timelineSystem: timeline });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_STORY_DIRECTION_TOOL, {
    direction: '沿当前分支继续调查', reason: '节点绑定测试'
  });
  manager.state._meta.current_node_id = 'node_story_newer';
  manager.state['系统·当前节点'] = 'node_story_newer';

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(manager.state._story_direction, null);
  assert.equal(timeline.calls.length, 0);
});

await test('story direction rolls live state back when timeline persistence fails without concurrency', async () => {
  const manager = new MemoryManager(storyState());
  const before = manager.snapshot();
  const persistenceError = Object.assign(new Error('timeline write failed'), { code: 'TIMELINE_WRITE_FAILED' });
  const timeline = storyTimeline(manager, { error: persistenceError });
  const adapter = new StoryDirectionActionAdapter({ stateManager: manager, timelineSystem: timeline });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_STORY_DIRECTION_TOOL, {
    direction: '保护同伴后再追查线索', reason: '持久化回滚测试'
  });

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('TIMELINE_WRITE_FAILED')
  );
  assert.deepEqual(manager.snapshot(), before);
  assert.equal(manager.restoreCalls, 1);
});

await test('story direction preserves concurrent live commits when persistence fails', async () => {
  const manager = new MemoryManager(storyState());
  const persistenceError = Object.assign(new Error('timeline CAS lost'), { code: 'TIMELINE_CAS_LOST' });
  const timeline = storyTimeline(manager, {
    error: persistenceError,
    hook: ({ manager: currentManager }) => {
      currentManager.state._concurrent_story_commit = 'must-survive';
    }
  });
  const adapter = new StoryDirectionActionAdapter({ stateManager: manager, timelineSystem: timeline });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_STORY_DIRECTION_TOOL, {
    direction: '先稳住队伍再行动', reason: '并发回滚测试'
  });

  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_ROLLBACK_CONFLICT')
  );
  assert.equal(manager.state._story_direction.direction, '先稳住队伍再行动');
  assert.equal(manager.state._concurrent_story_commit, 'must-survive');
  assert.equal(manager.restoreCalls, 0);
});

if (failures.length) {
  console.error(`\n${failures.length} Ling Xi project write adapter regression test(s) failed; ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi project write adapter regression passed (${passed} tests).`);
}
