import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatAICallEstimate,
  resolveAICallPolicy
} from '../js/core/ai-call-policy.js';
import {
  DEFAULT_MAIN_PRESET,
  DEFAULT_MAIN_PRESET_VERSION,
  MAIN_PRESET_STORAGE_KEY,
  invalidateMainPresetCache
} from '../js/data/default-preset.js';
import { MEMORY_CONFIG_DEFAULTS } from '../js/data/memory-config.js';
import { MessagePipeline } from '../js/core/pipeline.js';
import { AIClient } from '../js/core/ai-client.js';

if (!globalThis.localStorage) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log('AI call policy regression');

test('all optional AI features off infer strict single-call mode', () => {
  const policy = resolveAICallPolicy();
  assert.equal(policy.mode, 'single');
  assert.equal(policy.strictSingleCall, true);
  assert.equal(policy.inferred, true);
  assert.deepEqual(policy.estimate, { minimum: 1, maximum: 1, conditional: [] });
  assert.deepEqual(policy.mainGenerationOptions, { maxRetries: 0, strictSingleRequest: true });
});

test('legacy optional feature remains enabled unless strict mode was explicitly selected', () => {
  const policy = resolveAICallPolicy({
    apiConfig: { variableUpdater: { enabled: true } }
  });
  assert.equal(policy.strictSingleCall, false);
  assert.equal(policy.mode, 'enhanced');
  assert.equal(policy.features.variableUpdater, true);
  assert.equal(policy.estimate.minimum, 2);
});

test('explicit strict mode pauses every executable auxiliary call and ignores removed planner config', () => {
  const input = {
    apiConfig: {
      aiCallPolicy: { strictSingleCall: true },
      variableUpdater: { enabled: true },
      narrativeReview: { enabled: true },
      futurePlanner: { enabled: true }
    },
    agentConfig: { enabled: true, mode: 'full' },
    memoryConfig: { aiCompressionEnabled: true, deepEnabled: true, npcSummaryEnabled: true },
    imageSettings: { enabled: true, promptMode: 'separate-model', turnMode: 'auto' }
  };
  const policy = resolveAICallPolicy(input);
  assert.equal(policy.strictSingleCall, true);
  assert.equal('futurePlanner' in policy.requestedFeatures, false);
  assert.ok(Object.values(policy.requestedFeatures).every(value => value === true));
  assert.ok(Object.values(policy.features).every(value => value === false));
  assert.equal(policy.blockedFeatures.length, 8);
  assert.equal(policy.allowBackgroundMemoryAI, false);
  assert.equal(policy.allowAuxiliaryAI, false);
  assert.equal(formatAICallEstimate(policy), '严格单调用：每回合固定 1 次 API');
});

test('enhanced combinations keep updater, review and conditional memory calls', () => {
  const policy = resolveAICallPolicy({
    apiConfig: {
      aiCallPolicy: { strictSingleCall: false },
      variableUpdater: { enabled: true },
      narrativeReview: { enabled: true }
    },
    memoryConfig: { deepEnabled: true }
  });
  assert.equal(policy.features.variableUpdater, true);
  assert.equal(policy.features.narrativeReview, true);
  assert.equal(policy.estimate.minimum, 3);
  assert.deepEqual(policy.estimate.conditional, ['请求失败时可能透明重试', '记忆深度整理']);
});

test('AI-backed memory jobs are opt-in by default', () => {
  assert.equal(MEMORY_CONFIG_DEFAULTS.aiCompressionEnabled, false);
  assert.equal(MEMORY_CONFIG_DEFAULTS.deepEnabled, false);
  assert.equal(MEMORY_CONFIG_DEFAULTS.npcSummaryEnabled, false);
  assert.equal(MEMORY_CONFIG_DEFAULTS.recallEnabled, true, 'local recall remains available');
});

test('single-call main prompt still owns state and memory XML tags', () => {
  const pipeline = new MessagePipeline({});
  const messages = pipeline._buildPrompt('继续', {}, '继续', { updaterEnabled: false });
  const prompt = messages.map(message => String(message.content || '')).join('\n');
  assert.match(prompt, /后台变量模型未启用/);
  assert.match(prompt, /<memory>/);
  assert.match(prompt, /<variable>/);
});

test('strict mode keeps the effective prompt identical when the paused updater setting differs', () => {
  const enabledPolicy = resolveAICallPolicy({
    apiConfig: { aiCallPolicy: { strictSingleCall: true }, variableUpdater: { enabled: true } }
  });
  const disabledPolicy = resolveAICallPolicy({
    apiConfig: { aiCallPolicy: { strictSingleCall: true }, variableUpdater: { enabled: false } }
  });
  assert.equal(enabledPolicy.features.variableUpdater, false);
  assert.equal(disabledPolicy.features.variableUpdater, false);

  const enabledPipeline = new MessagePipeline({});
  const disabledPipeline = new MessagePipeline({});
  const enabledMessages = enabledPipeline._buildPrompt('继续', {}, '继续', {
    updaterEnabled: enabledPolicy.features.variableUpdater
  });
  const disabledMessages = disabledPipeline._buildPrompt('继续', {}, '继续', {
    updaterEnabled: disabledPolicy.features.variableUpdater
  });
  assert.deepEqual(enabledMessages, disabledMessages);
});

test('single-call prompt has no contradictory updater branch', () => {
  const pipeline = new MessagePipeline({});
  const messages = pipeline._buildPrompt('继续', {}, '继续', { updaterEnabled: false });
  const prompt = messages.map(message => String(message.content || '')).join('\n');
  assert.doesNotMatch(prompt, /后台独立变量更新模型已启用/);
  assert.doesNotMatch(prompt, /变量模型开启时不输出任何变量结构标签或日报/);
  assert.doesNotMatch(prompt, /主模型不得输出任何结构标签/);
  assert.match(prompt, /本回合没有后台变量模型补写/);
  assert.equal(
    (prompt.match(/【主模型请求复述与构思核对表】/g) || []).length,
    1,
    'the immutable reasoning checklist must only be injected once'
  );
  for (const marker of [
    '1. 本轮请求原文：',
    '2. 任务拆解与硬约束：',
    '3. 权威证据与不确定项：',
    '4. 时间线、地点与场景：',
    '5. 玩家意图、行动边界与判定：',
    '6. NPC动机、知识边界与关系：',
    '7. 连续性状态：',
    '8. 因果、结果、记账与停止点：'
  ]) assert.equal(prompt.split(marker).length - 1, 1, `duplicate reasoning checklist marker: ${marker}`);
});

test('unknown preset activation cannot bypass strict ownership isolation', () => {
  const preset = structuredClone(DEFAULT_MAIN_PRESET);
  preset._version = DEFAULT_MAIN_PRESET_VERSION;
  preset.entries.push({
    id: 'custom_unknown_activation',
    name: '未知生效模式的旧职责规则',
    enabled: true,
    role: 'system',
    activation: 'variable_updater_on',
    content: '变量模型开启时主模型不得输出结构标签；变量模型关闭时主模型必须输出 <memory> 和 <shinobi_daily>。'
  });
  localStorage.setItem(MAIN_PRESET_STORAGE_KEY, JSON.stringify(preset));
  invalidateMainPresetCache();
  try {
    const prompt = new MessagePipeline({})._buildPrompt('继续', {}, '继续', { updaterEnabled: false })
      .map(message => String(message.content || '')).join('\n');
    assert.doesNotMatch(prompt, /未知生效模式的旧职责规则/);
  } finally {
    localStorage.removeItem(MAIN_PRESET_STORAGE_KEY);
    localStorage.removeItem('naruto_main_preset_version');
    invalidateMainPresetCache();
  }
});

test('strict single-call skips optional image output contract', () => {
  const pipelineSource = readFileSync(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
  assert.match(
    pipelineSource,
    /if \(!strictSingleCall && imageSettings\.enabled && imageSettings\.promptMode === 'main-contract'\)/,
    'optional image contract must be gated off for strict single-call turns'
  );
});

test('legacy always-on custom ownership rules are isolated by the effective mode', () => {
  const preset = structuredClone(DEFAULT_MAIN_PRESET);
  preset._version = DEFAULT_MAIN_PRESET_VERSION;
  preset.entries.push({
    id: 'custom_legacy_ownership_rule',
    name: '旧双分支职责规则',
    enabled: true,
    role: 'system',
    activation: 'always',
    content: '变量模型开启时主模型不得输出结构标签；变量模型关闭时主模型必须输出 <memory> 和 <shinobi_daily>。'
  });
  localStorage.setItem(MAIN_PRESET_STORAGE_KEY, JSON.stringify(preset));
  invalidateMainPresetCache();
  try {
    const pipeline = new MessagePipeline({});
    const prompt = pipeline._buildPrompt('继续', {}, '继续', { updaterEnabled: false })
      .map(message => String(message.content || '')).join('\n');
    assert.doesNotMatch(prompt, /旧双分支职责规则/);
    assert.doesNotMatch(prompt, /变量模型开启时主模型不得输出结构标签/);
    assert.match(prompt, /本回合没有后台变量模型补写/);
  } finally {
    localStorage.removeItem(MAIN_PRESET_STORAGE_KEY);
    localStorage.removeItem('naruto_main_preset_version');
    invalidateMainPresetCache();
  }
});

test('main generation options omit the provider output cap', () => {
  const pipeline = new MessagePipeline({});
  assert.equal(pipeline._getGenerationOptions().max_tokens, 0);
});

test('pipeline, transport and image integration enforce the strict boundary', () => {
  const pipeline = readFileSync(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../js/core/ai-client.js', import.meta.url), 'utf8');
  const imageIntegration = readFileSync(new URL('../js/core/image-studio/integration.js', import.meta.url), 'utf8');
  assert.match(pipeline, /callPolicy\.features\.agents/);
  assert.match(pipeline, /callPolicy\.features\.variableUpdater/);
  assert.match(pipeline, /callPolicy\.allowBackgroundMemoryAI/);
  assert.match(pipeline, /memoryCfg\.aiCompressionEnabled/);
  assert.match(pipeline, /allowAuxiliaryAI:\s*callPolicy\.allowAuxiliaryAI/);
  assert.match(client, /options\.strictSingleRequest/);
  assert.match(client, /maxRetries\s*=\s*options\.maxRetries\s*\?\?\s*2/);
  assert.match(imageIntegration, /if \(!allowAuxiliaryAI\) return/);
  assert.doesNotMatch(imageIntegration, /禁止加入[^\n]*未来事件/);
});

test('settings persist and explain strict mode while API form preserves it', () => {
  const settings = readFileSync(new URL('../js/ui/settings-panel.js', import.meta.url), 'utf8');
  const apiForm = readFileSync(new URL('../js/ui/api-config-form.js', import.meta.url), 'utf8');
  const stateManager = readFileSync(new URL('../js/core/state-manager.js', import.meta.url), 'utf8');
  assert.match(settings, /name="strictSingleCall"/);
  assert.match(settings, /id="ai-call-estimate"/);
  assert.match(settings, /_saveAICallPolicyConfig/);
  assert.match(settings, /自动图片规划\/生成/);
  assert.doesNotMatch(settings, /未来规划/);
  assert.match(apiForm, /aiCallPolicy:\s*this\._config\.aiCallPolicy/);
  assert.match(stateManager, /aiCallPolicy:\s*persistedConfig\.aiCallPolicy/);
  assert.match(stateManager, /delete persistedConfig\.futurePlanner/);
});

{
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount++;
    return { ok: true, body: null, text: async () => '', json: async () => ({}) };
  };
  try {
    const client = new AIClient();
    client.configure({
      backend: 'openai', apiUrl: 'https://single-call.invalid/v1', model: 'test', useProxy: false
    });
    await assert.rejects(
      client.chatStream([{ role: 'user', content: 'test' }], {
        maxRetries: 0,
        strictSingleRequest: true,
        timeout: 1000
      }, () => {}),
      /严格单调用模式/
    );
    assert.equal(requestCount, 1, 'bodyless streaming must not fall back to a second request');
    passed++;
    console.log('  ✓ strict transport sends exactly one request when a stream is unavailable');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`AI call policy regression: ${passed} passed`);
