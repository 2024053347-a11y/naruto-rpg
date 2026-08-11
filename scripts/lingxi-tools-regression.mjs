import assert from 'node:assert/strict';

import { AgentToolRuntime } from '../js/core/agent-tool-runtime.js';
import { saveApiScheme } from '../js/core/api-schemes.js';
import { LingXiController } from '../js/core/lingxi/lingxi-controller.js';
import { LingXiContextBroker } from '../js/core/lingxi/lingxi-context-broker.js';
import { createLingXiTools, redactLingXiSecrets } from '../js/core/lingxi/lingxi-tools.js';

const API_KEY = 'sk-lingxi-secret-value-123456';
const PRIVATE_THOUGHT = '不可泄露的 NPC 私密想法';
const CHAT_CREDENTIALS = Object.freeze([
  'AIzaSyD-ExampleGeminiCredential123456789',
  'AKIAIOSFODNN7EXAMPLE',
  'xai-ExampleCredential_1234567890',
  'sk-ant-api03-ExampleCredential_1234567890',
  'gsk_ExampleCredential_1234567890',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsaW5neGkifQ.SignatureExample123456',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
]);

function clone(value) {
  return structuredClone(value);
}

function createStateManager() {
  const state = {
    _version: '5.0',
    _meta: { current_node_id: 'node_7', active_branch: 'branch_main' },
    _ui: { settings: { fontSize: 16, musicEnabled: true, backgroundImage: 'data:ignored' } },
    _agent_memories: { 春野樱: { privateIntentHistory: [{ thought: PRIVATE_THOUGHT }] } },
    '系统·回合数': 7,
    '玩家·姓名': '测试玩家',
    '属性·查克拉': 100,
    '属性·当前查克拉': 40,
    '世界·地点': '木叶隐村',
    '世界·时间': '木叶52年1月1日',
    '世界·天气': '晴'
  };
  const config = {
    backend: 'custom',
    apiUrl: 'https://provider.example/v1',
    apiKey: API_KEY,
    model: 'test-model'
  };
  return {
    get(path) { return path ? clone(state[path]) : clone(state); },
    getSub(path) { return clone(state[path]); },
    getAPIConfig() { return clone(config); },
    async getAPIConfigAsync() { return clone(config); }
  };
}

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

await test('tool registry exposes reads and proposal staging but no direct write tool', () => {
  const stage = async value => value;
  const tools = createLingXiTools({
    stateManager: createStateManager(),
    stageVariableChange: stage,
    stageSettingsChange: stage,
    stageOpeningChange: stage,
    stageWorldbookChange: stage,
    stageStoryDirectionChange: stage,
    stageEquipmentAction: stage,
    stageMissionAction: stage,
    stagePlayerAction: stage,
    stageImageLibraryAction: stage,
    stageCombatAction: stage,
    stageTimelineAction: stage
  });
  assert.deepEqual(Object.keys(tools).sort(), [
    'control_music',
    'inspect_cloud_saves',
    'inspect_current_state',
    'inspect_image_gallery',
    'inspect_image_settings',
    'inspect_image_target',
    'inspect_music_player',
    'inspect_opening_draft',
    'inspect_project_state',
    'inspect_settings',
    'inspect_story_plan',
    'inspect_variable',
    'inspect_worldbook_entries',
    'open_image_studio',
    'open_music',
    'open_profile',
    'open_settings',
    'open_workspace',
    'search_canon_database',
    'search_music',
    'search_project_guide',
    'search_worldbook',
    'stage_cloud_save_action',
    'stage_combat_action',
    'stage_equipment_action',
    'stage_image_generation',
    'stage_image_library_action',
    'stage_mission_action',
    'stage_opening_draft',
    'stage_player_action',
    'stage_settings_change',
    'stage_story_direction',
    'stage_timeline_action',
    'stage_variable_change'
    ,'stage_worldbook_action'
    ,'stage_worldbook_entry'
  ]);
  assert.ok(Object.values(tools).every(tool => ['read', 'ui-action', 'propose-write'].includes(tool.effect)));
  assert.equal(Object.values(tools).some(tool => tool.effect === 'write'), false);
  assert.deepEqual(
    [...new Set(Object.values(tools).map(tool => tool.effect))].sort(),
    ['propose-write', 'read', 'ui-action']
  );
  assert.equal(Object.keys(tools).some(name => /^(?:apply|delete|save|navigate)/i.test(name)), false);
  assert.match(tools.stage_opening_draft.description, /必须先 search_project_guide.*opening.*inspect_opening_draft.*search_worldbook.*search_canon_database/);
  assert.match(tools.stage_worldbook_entry.description, /必须先 search_project_guide.*worldbook.*search_worldbook.*search_canon_database/);
  assert.match(tools.inspect_worldbook_entries.description, /停用条目.*内容指纹.*内置条目只读/);
  assert.match(tools.stage_worldbook_action.description, /启用、停用、删除.*inspect_worldbook_entries.*不可撤销/s);
  assert.match(tools.stage_story_direction.description, /必须先 search_project_guide.*story.*inspect_current_state、inspect_story_plan、inspect_project_state.*timeline.*search_worldbook.*search_canon_database/);
  assert.equal(tools.search_canon_database.effect, 'read');
  assert.match(tools.search_canon_database.description, /剧情日、场景、原子事件与忍术记录/);
  assert.match(tools.stage_equipment_action.description, /inspect_current_state\(section=inventory\).*EquipmentSystem/);
  assert.match(tools.stage_mission_action.description, /inspect_project_state\(section=missions\).*MissionSystem/);
  assert.match(tools.stage_player_action.description, /普通玩家行动.*主生成管线.*API 费用/s);
  assert.match(tools.stage_combat_action.description, /inspect_project_state\(section=combat\).*主生成管线/s);
  assert.match(tools.stage_timeline_action.description, /inspect_project_state\(section=timeline\).*重推衍.*API 费用/s);
  assert.match(tools.stage_image_generation.description, /必须先 inspect_image_settings 和 inspect_image_target/);
  assert.match(tools.stage_image_library_action.description, /inspect_image_target 或 inspect_image_gallery.*小范围.*后台执行.*重试.*按钮确认/s);
  assert.match(tools.inspect_cloud_saves.description, /不返回存档正文、用户标识、校验值或下载地址/);
  assert.match(tools.stage_cloud_save_action.description, /上传、覆盖、删除或恢复提案.*必须先 inspect_cloud_saves/s);
});

await test('music tools search first and expose only bounded UI actions', async () => {
  const calls = [];
  const musicAdapter = {
    async search(input) {
      calls.push({ name: 'search', input: clone(input) });
      return { query: input.query, tracks: [{ id: 'track-1', name: '青鸟', artist: '生物股长' }] };
    },
    async open(input) {
      calls.push({ name: 'open', input: clone(input) });
      return { opened: true, player: { status: 'loading' } };
    },
    async control(input) {
      calls.push({ name: 'control', input: clone(input) });
      return { action: input.action, player: { status: 'paused' } };
    }
  };
  const tools = createLingXiTools({
    stateManager: createStateManager(),
    stageVariableChange: async value => value,
    musicAdapter
  });

  const search = await tools.search_music.execute({ query: '  火影 青鸟  ', limit: 100 });
  const opened = await tools.open_music.execute({ trackId: 'track-1', autoplay: true });
  const controlled = await tools.control_music.execute({ action: 'pause' });

  assert.equal(search.tracks[0].id, 'track-1');
  assert.equal(opened.player.status, 'loading');
  assert.equal(controlled.player.status, 'paused');
  assert.deepEqual(calls, [
    { name: 'search', input: { query: '火影 青鸟', limit: 20 } },
    { name: 'open', input: { trackId: 'track-1', autoplay: true } },
    { name: 'control', input: { action: 'pause' } }
  ]);
  assert.equal(tools.search_music.effect, 'read');
  assert.equal(tools.open_music.effect, 'ui-action');
  assert.equal(tools.control_music.effect, 'ui-action');
  assert.match(tools.open_music.description, /先调用 search_music/);
});

await test('UI navigation tools only emit allowlisted reversible routes', async () => {
  const actions = [];
  const bus = {
    async request(event, route) {
      actions.push({ event, route: clone(route) });
      return { opened: true };
    }
  };
  const tools = createLingXiTools({
    stateManager: createStateManager(),
    stageVariableChange: async value => value,
    eventBus: bus
  });

  const settingsResult = await tools.open_settings.execute({ section: 'media', anchor: 'music-library' });
  await tools.open_image_studio.execute({});
  await tools.open_profile.execute({});
  await tools.open_workspace.execute({ target: 'timeline' });
  await tools.open_workspace.execute({ target: 'missions' });
  await tools.open_workspace.execute({ target: 'canon_plot' });
  await tools.open_workspace.execute({ target: 'map' });

  assert.deepEqual(actions, [
    { event: 'app:open-settings', route: { section: 'media', anchor: 'music-library' } },
    { event: 'app:open-creator-workbench', route: { tool: 'image' } },
    { event: 'app:open-profile', route: { loadRemote: false } },
    { event: 'app:open-timeline', route: {} },
    { event: 'app:open-info-panel', route: { tab: 'missions' } },
    { event: 'app:open-creator-workbench', route: { tool: 'canon', resourceId: 'plot' } },
    { event: 'app:open-map', route: {} }
  ]);
  assert.equal(tools.open_settings.effect, 'ui-action');
  assert.equal(tools.open_image_studio.effect, 'ui-action');
  assert.equal(tools.open_profile.effect, 'ui-action');
  assert.equal(tools.open_workspace.effect, 'ui-action');
  assert.deepEqual(settingsResult, {
    requested: true,
    opened: true,
    event: 'app:open-settings',
    route: { section: 'media', anchor: 'music-library' }
  });
  await assert.rejects(
    () => tools.open_settings.execute({ section: 'admin' }),
    /不支持的设置分区/
  );
  await assert.rejects(
    () => tools.open_workspace.execute({ target: 'external_url' }),
    /不支持的工作区目标/
  );

  const closedTools = createLingXiTools({
    stateManager: createStateManager(),
    stageVariableChange: async value => value,
    eventBus: {
      async request() { return { opened: false }; }
    }
  });
  assert.equal((await closedTools.open_workspace.execute({ target: 'timeline' })).opened, false);
});

await test('settings and redaction helpers never expose API credentials', async () => {
  const tools = createLingXiTools({ stateManager: createStateManager(), stageVariableChange: async value => value });
  const result = await tools.inspect_settings.execute({});
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(result.aiConnection.credentialConfigured, true);
  assert.equal(result.aiConnection.endpoint, 'https://provider.example');
  const redacted = redactLingXiSecrets({ apiKey: API_KEY, note: `Bearer ${API_KEY}`, inner_thought: PRIVATE_THOUGHT });
  assert.equal(JSON.stringify(redacted).includes(API_KEY), false);
  assert.equal(JSON.stringify(redacted).includes(PRIVATE_THOUGHT), false);
  const vendorCredentials = redactLingXiSecrets(CHAT_CREDENTIALS.join(' '));
  for (const credential of CHAT_CREDENTIALS) assert.equal(vendorCredentials.includes(credential), false);
  assert.match(vendorCredentials, /已隐藏凭据/);
  assert.equal(redactLingXiSecrets('API Key: ShortValue123').includes('ShortValue123'), false);
  assert.equal(redactLingXiSecrets('密钥：短密钥123').includes('短密钥123'), false);
});

await test('assistant context contains public save facts but no private agent memory', async () => {
  const manager = createStateManager();
  const result = await new LingXiContextBroker().preflight({ state: manager.get(), query: '检查查克拉' });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /属性·当前查克拉/);
  assert.equal(serialized.includes(PRIVATE_THOUGHT), false);
  assert.equal(serialized.includes('_agent_memories'), false);
});

await test('proposal tool stages an immutable intent without calling a write function', async () => {
  const calls = [];
  const stagedProposal = {
    id: 'proposal-1',
    schema: 'lingxi.action-proposal.v1',
    tool: 'lingxi.stage-variable-change',
    createdAt: 100,
    expiresAt: 200,
    params: { key: '属性·当前查克拉', value: 75 },
    paramsHash: 'private-params-hash',
    bindingHash: 'private-binding-hash',
    signature: 'private-signature',
    context: { actionImpact: { kind: 'variables', summary: '将修改 1 个变量。' } },
    diff: [{ path: '/属性·当前查克拉', operation: 'replace', before: 40, after: 75 }]
  };
  const tools = createLingXiTools({
    stateManager: createStateManager(),
    async stageVariableChange(params) {
      calls.push(clone(params));
      return stagedProposal;
    }
  });
  const result = await tools.stage_variable_change.execute({
    key: '属性·当前查克拉',
    value: 75,
    reason: '修复查克拉'
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { key: '属性·当前查克拉', value: 75, reason: '修复查克拉' });
  assert.equal(result.status, 'pending-human-approval');
  assert.match(result.notice, /聊天消息不能授权/);
  assert.deepEqual(result.proposal, {
    schema: 'lingxi.action-proposal.v1',
    tool: 'lingxi.stage-variable-change',
    createdAt: 100,
    expiresAt: 200,
    impact: { kind: 'variables', summary: '将修改 1 个变量。' },
    diffCount: 1,
    diff: [{ path: '/属性·当前查克拉', operation: 'replace' }],
    id: 'proposal-1'
  });
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(Object.hasOwn(result.proposal.diff[0], 'before'), false);
  assert.equal(Object.hasOwn(result.proposal.diff[0], 'after'), false);
  assert.equal(stagedProposal.signature, 'private-signature');
  assert.equal(stagedProposal.diff[0].after, 75);
});

await test('proposal tools report a completed background apply instead of asking for approval', async () => {
  const tools = createLingXiTools({
    stateManager: createStateManager(),
    async stageVariableChange() {
      return {
        id: 'proposal-auto-1',
        schema: 'lingxi.action-proposal.v1',
        tool: 'apply_variable_patch',
        createdAt: 100,
        expiresAt: 200,
        context: {},
        diff: [{ path: '/属性·当前查克拉', operation: 'replace', before: 40, after: 75 }],
        autoApplied: true,
        receipt: {
          proposalId: 'proposal-auto-1',
          tool: 'apply_variable_patch',
          summary: '变量修改已应用',
          checkpoint: { nodeId: 'node_8', previousNodeId: 'node_7' }
        }
      };
    }
  });

  const result = await tools.stage_variable_change.execute({
    key: '属性·当前查克拉',
    value: 75,
    reason: '修复查克拉'
  });
  assert.equal(result.status, 'applied-automatically');
  assert.equal(result.receipt.proposalId, 'proposal-auto-1');
  assert.match(result.notice, /后台自动执行/);
  assert.doesNotMatch(result.notice, /yes/i);
});

await test('API key and private state never enter model messages or Ling Xi session storage', async () => {
  const stateManager = createStateManager();
  const modelCalls = [];
  const client = {
    configure(config) { this.config = clone(config); },
    isConfigured: () => true,
    cancel() {},
    async chat(messages) {
      modelCalls.push(clone(messages));
      return JSON.stringify({ final: '已完成只读检查，没有写入。' });
    }
  };
  const runtime = new AgentToolRuntime({
    contextBroker: new LingXiContextBroker(),
    clientFactory: () => client,
    sdk: {}
  });
  const stored = new Map();
  const controller = new LingXiController({
    stateManager,
    runtime,
    approvalBroker: {
      listPendingProposals: () => [],
      stageAction: async () => { throw new Error('not used'); },
      approveFromUserEvent: async () => { throw new Error('not used'); },
      discardProposal: () => false
    },
    storage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, String(value))
    }
  });
  const result = await controller.send(`请只读检查当前状态。不要记录这些误贴凭据：${CHAT_CREDENTIALS.join(' ')}`);
  assert.equal(result.message.content, '已完成只读检查，没有写入。');
  assert.ok(modelCalls.length >= 1);
  const prompts = JSON.stringify(modelCalls);
  const sessions = JSON.stringify([...stored.values()]);
  assert.equal(prompts.includes(API_KEY), false);
  assert.equal(prompts.includes(PRIVATE_THOUGHT), false);
  assert.equal(sessions.includes(API_KEY), false);
  assert.equal(sessions.includes(PRIVATE_THOUGHT), false);
  for (const credential of CHAT_CREDENTIALS) {
    assert.equal(prompts.includes(credential), false);
    assert.equal(sessions.includes(credential), false);
  }
  assert.equal(client.config.apiKey, API_KEY, 'the credential remains confined to the transport configuration');
});

await test('Ling Xi resolves a selected saved API scheme without exposing its key in the choice list', async () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  const storage = {
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key))
  };
  globalThis.localStorage = storage;
  try {
    const schemeId = await saveApiScheme({
      name: '灵希专用',
      backend: 'custom',
      apiUrl: 'https://lingxi.example/v1',
      apiKey: 'lingxi-transport-secret',
      model: 'lingxi-cute-model',
      disableStreaming: false
    });
    const controller = new LingXiController({
      stateManager: createStateManager(),
      runtime: { configure() {}, abort() {} },
      approvalBroker: {
        listPendingProposals: () => [],
        stageAction: async () => { throw new Error('not used'); },
        approveFromUserEvent: async () => { throw new Error('not used'); },
        discardProposal: () => false
      },
      storage
    });
    const choices = await controller.listApiChoices();
    const serializedChoices = JSON.stringify(choices);
    assert.ok(choices.some(choice => choice.id === schemeId && choice.label === '灵希专用'));
    assert.equal(serializedChoices.includes('lingxi-transport-secret'), false);
    controller.setSelectedApiChoice(schemeId);
    const resolved = await controller._resolveApiConfig();
    assert.equal(resolved.model, 'lingxi-cute-model');
    assert.equal(resolved.apiUrl, 'https://lingxi.example/v1');
    assert.equal(resolved.apiKey, 'lingxi-transport-secret');
    assert.equal(resolved.disableStreaming, false);
    assert.equal(resolved.useProxy, true);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

await test('plain-chat fallback cannot look like a completed project write', async () => {
  const stateManager = createStateManager();
  const controller = new LingXiController({
    stateManager,
    runtime: {
      configure() {},
      abort() {},
      async runAgent() {
        return { text: '已经替你修改并保存好了。', mode: 'plain-chat', usage: null };
      }
    },
    approvalBroker: {
      listPendingProposals: () => [],
      stageAction: async () => { throw new Error('not used'); },
      approveFromUserEvent: async () => { throw new Error('not used'); },
      discardProposal: () => false
    },
    storage: { getItem: () => null, setItem() {} }
  });
  const result = await controller.send('把查克拉改成 80');
  assert.equal(result.mode, 'plain-chat');
  assert.match(result.message.content, /仅为对话建议/);
  assert.match(result.message.content, /没有修改设置或存档/);
});

await test('starting a new conversation clears persisted history and discards pending proposals', () => {
  const values = new Map([
    ['naruto_lingxi_session_v1', JSON.stringify([
      { role: 'assistant', content: '旧回复' },
      { role: 'user', content: '旧问题' }
    ])]
  ]);
  const pending = new Map([
    ['proposal-a', { id: 'proposal-a' }],
    ['proposal-b', { id: 'proposal-b' }]
  ]);
  const discarded = [];
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime: { configure() {}, abort() {} },
    approvalBroker: {
      listPendingProposals: () => [...pending.values()].map(clone),
      stageAction: async () => { throw new Error('not used'); },
      approveFromUserEvent: async () => { throw new Error('not used'); },
      discardProposal(id) {
        discarded.push(id);
        return pending.delete(id);
      }
    },
    storage: {
      getItem: key => values.get(String(key)) || null,
      setItem: (key, value) => values.set(String(key), String(value))
    }
  });
  controller._lastStagedProposal = { id: 'proposal-b' };

  const history = controller.startNewConversation();

  assert.deepEqual(discarded.sort(), ['proposal-a', 'proposal-b']);
  assert.equal(pending.size, 0);
  assert.equal(controller._lastStagedProposal, null);
  assert.equal(history.length, 1);
  assert.equal(history[0].role, 'assistant');
  assert.match(history[0].content, /灵希来啦/);
  assert.deepEqual(JSON.parse(values.get('naruto_lingxi_session_v1')), history);
});

await test('an active reply blocks a new conversation and preserves the in-flight turn', async () => {
  let releaseReply;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const reply = new Promise(resolve => { releaseReply = resolve; });
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime: {
      configure() {},
      abort() {},
      async runAgent() {
        markStarted();
        return reply;
      }
    },
    approvalBroker: {
      listPendingProposals: () => [],
      stageAction: async () => { throw new Error('not used'); },
      approveFromUserEvent: async () => { throw new Error('not used'); },
      discardProposal: () => false
    },
    storage: { getItem: () => null, setItem() {} }
  });

  const sending = controller.send('保留这一轮');
  assert.equal(controller.isActive, true);
  assert.throws(
    () => controller.startNewConversation(),
    error => error?.code === 'LINGXI_BUSY'
  );
  await started;
  assert.equal(controller.isActive, true);
  assert.equal(controller.getHistory().at(-1)?.content, '保留这一轮');

  releaseReply({ text: '这一轮完成了。', mode: 'native-tools', trace: [], usage: null });
  await sending;
  assert.equal(controller.isActive, false);
  assert.equal(controller.getHistory().at(-1)?.content, '这一轮完成了。');
});

await test('an applying approval blocks a new conversation until its receipt is complete', async () => {
  let releaseApproval;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const pendingReceipt = new Promise(resolve => { releaseApproval = resolve; });
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime: { configure() {}, abort() {} },
    approvalBroker: {
      listPendingProposals: () => [],
      stageAction: async () => { throw new Error('not used'); },
      async approveFromUserEvent() {
        markStarted();
        return pendingReceipt;
      },
      discardProposal: () => false
    },
    storage: { getItem: () => null, setItem() {} }
  });

  const approving = controller.approveProposal({}, { proposalId: 'proposal-a', confirmation: 'yes' });
  await started;
  assert.equal(controller.isActive, true);
  assert.throws(
    () => controller.startNewConversation(),
    error => error?.code === 'LINGXI_BUSY'
  );
  releaseApproval({ proposalId: 'proposal-a', summary: '已完成' });
  await approving;
  assert.equal(controller.isActive, false);
});

await test('model context stays within the recent-message and character limits', async () => {
  const seeded = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? 'user' : 'assistant',
    content: `${String(index).padStart(2, '0')}:${'x'.repeat(2997)}`
  }));
  const values = new Map([
    ['naruto_lingxi_session_v1', JSON.stringify(seeded)]
  ]);
  let receivedMessages = null;
  const controller = new LingXiController({
    stateManager: createStateManager(),
    runtime: {
      configure() {},
      abort() {},
      async runAgent({ messages }) {
        receivedMessages = clone(messages);
        return { text: '收到。', mode: 'native-tools', trace: [], usage: null };
      }
    },
    approvalBroker: {
      listPendingProposals: () => [],
      stageAction: async () => { throw new Error('not used'); },
      approveFromUserEvent: async () => { throw new Error('not used'); },
      discardProposal: () => false
    },
    storage: {
      getItem: key => values.get(String(key)) || null,
      setItem: (key, value) => values.set(String(key), String(value))
    }
  });

  await controller.send('最新问题');

  assert.ok(Array.isArray(receivedMessages));
  assert.ok(receivedMessages.length <= 14);
  assert.ok(receivedMessages.reduce((total, message) => total + message.content.length, 0) <= 20_000);
  assert.equal(receivedMessages.at(-1)?.content, '最新问题');
  assert.equal(receivedMessages.some(message => message.content.startsWith('00:')), false);
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi tool security regression: ${passed}/${passed} passed`);
}
