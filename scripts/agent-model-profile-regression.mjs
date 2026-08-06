import assert from 'node:assert/strict';

import {
  compareAgentModelsByPreference,
  isStableDeepSeekV4Flash,
  resolveAgentConcurrency
} from '../js/core/agent-model-profile.js';

const failures = [];
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

test('recognizes stable DeepSeek V4 Flash through arbitrary channel prefixes', () => {
  for (const model of [
    'deepseek-v4-flash',
    'd/deepseek-v4-flash',
    'go/deepseek-v4-flash',
    'relay/production/deepseek-v4-flash',
    '  D/DeepSeek-V4-Flash  '
  ]) {
    assert.equal(isStableDeepSeekV4Flash(model), true, model);
  }
});

test('rejects free, preview, beta, experimental, and non-Flash model variants', () => {
  for (const model of [
    '',
    null,
    'deepseek-v4-flash-free',
    'd/deepseek-v4-flash-preview',
    'go/deepseek-v4-flash-beta',
    'relay/deepseek-v4-flash-experimental',
    'deepseek-v4-flash:free',
    'deepseek-v4-pro',
    'my-deepseek-v4-flash'
  ]) {
    assert.equal(isStableDeepSeekV4Flash(model), false, String(model));
  }
});

test('sorts stable V4 Flash models first and all groups alphabetically', () => {
  const models = [
    'zeta-model',
    'deepseek-v4-flash-preview',
    'go/deepseek-v4-flash',
    'alpha-model',
    'deepseek-v4-flash-free',
    'd/deepseek-v4-flash'
  ];

  assert.deepEqual(models.sort((a, b) => compareAgentModelsByPreference(a, b, 'custom')), [
    'd/deepseek-v4-flash',
    'go/deepseek-v4-flash',
    'alpha-model',
    'deepseek-v4-flash-free',
    'deepseek-v4-flash-preview',
    'zeta-model'
  ]);
});

test('normalizes configured Agent concurrency to the supported 1-10 range', () => {
  assert.equal(resolveAgentConcurrency({}), 1);
  assert.equal(resolveAgentConcurrency({ configured: '3' }), 3);
  assert.equal(resolveAgentConcurrency({ configured: 0 }), 1);
  assert.equal(resolveAgentConcurrency({ configured: 99 }), 10);
  assert.equal(resolveAgentConcurrency({ configured: 'invalid' }), 1);
});

test('model profiles honor the configured concurrency cap without forced serial', () => {
  assert.equal(resolveAgentConcurrency({ backend: ' DeepSeek ', configured: 4 }), 4);
  assert.equal(resolveAgentConcurrency({ backend: 'custom', agentModel: 'd/deepseek-v4-flash', configured: 4 }), 4);
  assert.equal(resolveAgentConcurrency({ backend: 'openai', criticModel: 'go/deepseek-v4-flash', configured: 3 }), 3);
  assert.equal(resolveAgentConcurrency({ backend: 'openai', agentModel: 'deepseek-v4-flash-free', configured: 4 }), 4);
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nAgent model profile regression: ${passed}/${passed} passed`);
}
