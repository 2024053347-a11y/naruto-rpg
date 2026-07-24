import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PROMPT_TRACE_STORAGE_KEYS,
  clearPromptTraces,
  publishPromptTrace,
  readPromptTraceBundle
} from '../js/core/prompt-trace.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

function createStorage({ failWrites = false } = {}) {
  const map = new Map();
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => {
      if (failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      map.set(String(key), String(value));
    },
    removeItem: key => map.delete(key),
    dump: () => Object.fromEntries(map)
  };
}

function createBus() {
  const events = [];
  return {
    emit: (name, payload) => events.push({ name, payload }),
    events
  };
}

test('main prompt trace preserves the exact sent role chain and excludes credentials', () => {
  const storage = createStorage();
  const bus = createBus();
  const messages = [
    { role: 'system', content: '世界书事实' },
    { role: 'user', content: '玩家行动' }
  ];
  publishPromptTrace({
    kind: 'main',
    title: '主叙事模型请求',
    messages,
    messageSources: [
      { source: '世界书', label: '正史上下文' },
      { source: '本回合', label: '玩家操作' }
    ],
    model: 'test-model',
    apiKey: 'must-not-be-stored',
    headers: { Authorization: 'Bearer must-not-be-stored' },
    generationOptions: { temperature: 0.4, apiKey: 'also-secret' }
  }, { storage, bus });

  const bundle = readPromptTraceBundle({ storage });
  assert.deepEqual(bundle.main.messages.map(({ role, content }) => ({ role, content })), messages);
  assert.equal(bundle.main.messages[0].source, '世界书');
  assert.equal(bundle.main.model, 'test-model');
  const serialized = JSON.stringify(storage.dump());
  assert.doesNotMatch(serialized, /must-not-be-stored|also-secret|Authorization/);
  assert.equal(bus.events.at(-1)?.name, 'debug:prompt-trace');
});

test('all current request stages are independently readable and clearable', () => {
  const storage = createStorage();
  const bus = createBus();
  for (const kind of ['main', 'agent', 'narrative-review', 'variable-updater', 'npc-summary']) {
    publishPromptTrace({ kind, messages: [{ role: 'user', content: kind }] }, { storage, bus });
  }
  const bundle = readPromptTraceBundle({ storage });
  assert.equal(bundle.main.kind, 'main');
  assert.equal(bundle.agents.length, 1);
  assert.equal(bundle.narrativeReview.kind, 'narrative-review');
  assert.equal(bundle.variableUpdater.kind, 'variable-updater');
  assert.equal(bundle.auxiliary.length, 1);

  clearPromptTraces({ storage });
  assert.deepEqual(readPromptTraceBundle({ storage }), {
    main: null,
    agents: [],
    narrativeReview: null,
    variableUpdater: null,
    auxiliary: []
  });
  assert.deepEqual(Object.keys(storage.dump()), []);
});

test('latest trace remains available in memory when localStorage quota is exceeded', () => {
  const storage = createStorage({ failWrites: true });
  publishPromptTrace({
    kind: 'main',
    messages: [{ role: 'system', content: 'x'.repeat(20_000) }]
  }, { storage, bus: createBus() });
  const bundle = readPromptTraceBundle({ storage });
  assert.equal(bundle.main.messages[0].content.length, 20_000);
});

test('trace storage keys cover every viewer section', () => {
  assert.deepEqual(Object.keys(PROMPT_TRACE_STORAGE_KEYS).sort(), [
    'agents', 'auxiliary', 'main', 'narrativeReview', 'variableUpdater'
  ]);
});

test('runtime producers and viewer are wired to the shared trace module', () => {
  const pipeline = readFileSync(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
  const agentRunner = readFileSync(new URL('../js/core/agent-runner.js', import.meta.url), 'utf8');
  const narrativeReview = readFileSync(new URL('../js/core/narrative-review.js', import.meta.url), 'utf8');
  const variableUpdater = readFileSync(new URL('../js/core/variable-updater.js', import.meta.url), 'utf8');
  const npcSummary = readFileSync(new URL('../js/core/npc-summary.js', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../js/ui/developer-panel.js', import.meta.url), 'utf8');

  assert.match(pipeline, /publishPromptTrace\([\s\S]*kind:\s*'main'/);
  assert.match(agentRunner, /publishPromptTrace\([\s\S]*kind:\s*'agent'/);
  assert.match(narrativeReview, /publishPromptTrace\([\s\S]*kind:\s*'narrative-review'/);
  assert.match(variableUpdater, /publishPromptTrace\([\s\S]*kind:\s*'variable-updater'/);
  assert.match(npcSummary, /publishPromptTrace\([\s\S]*kind:\s*'npc-summary'/);
  assert.match(viewer, /debug:narrative-review-prompt-trace/);
  assert.match(viewer, /debug:npc-summary-prompt-trace/);
  assert.match(viewer, /readPromptTraceBundle/);
  assert.match(viewer, /clearPromptTraces/);
});

test('viewer mounts large prompt bodies lazily instead of duplicating hidden text in the DOM', () => {
  const viewer = readFileSync(new URL('../js/ui/developer-panel.js', import.meta.url), 'utf8');
  assert.match(viewer, /data-lazy-message/);
  assert.match(viewer, /data-lazy-full/);
  assert.match(viewer, /data-lazy-injection/);
  assert.match(viewer, /textContent\s*=/);
  assert.match(viewer, /const isPending\s*=/);
  assert.match(viewer, /if \(!isPending\) return/);
  assert.doesNotMatch(viewer, /<pre>\$\{this\._esc\(msg\.content/);
  assert.doesNotMatch(viewer, /<pre>\$\{this\._esc\(fullPrompt/);
});

console.log(`PASS ${passed} prompt-preview regression checks.`);
