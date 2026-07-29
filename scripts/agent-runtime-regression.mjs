import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.customElements ||= { get: () => null };

const [{ AgentRunner }, { AgentPipeline }, { AGENT_TIMEOUTS }] = await Promise.all([
  import('../js/core/agent-runner.js'),
  import('../js/core/agent-pipeline.js'),
  import('../js/core/agent-manifests.js')
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

await test('agent stage owns a hard deadline and cancels a non-settling client', async () => {
  const originalTimeout = AGENT_TIMEOUTS.outliner;
  AGENT_TIMEOUTS.outliner = 25;
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
  try {
    const outcome = await Promise.race([
      runner.run('outliner', {
        state: {}, userInput: '继续', taskPrompt: '生成大纲', onChunk: () => {}
      }).then(() => 'resolved', error => error),
      after(120, 'still-pending')
    ]);
    assert.notEqual(outcome, 'still-pending', 'outliner ignored its 25ms stage deadline');
    assert.ok(outcome instanceof Error, 'deadline must reject the stage');
    assert.equal(outcome.isTimeout, true);
    assert.equal(cancelCalls, 1);
  } finally {
    AGENT_TIMEOUTS.outliner = originalTimeout;
  }
});

await test('pipeline total timeout aborts outstanding agents before direct fallback', async () => {
  const originalTimeout = AGENT_TIMEOUTS.pipeline_total;
  AGENT_TIMEOUTS.pipeline_total = 35;
  localStorage.setItem('naruto_agent_config', JSON.stringify({ enabled: true, mode: 'standard' }));
  let abortCalls = 0;
  const pipeline = new AgentPipeline({
    pipeline: { getTurnEvidenceView: () => ({ current_state: {}, evidence: [] }) },
    memorySystem: null
  });
  pipeline.runner = {
    configure() {},
    abort() { abortCalls++; },
    run() { return new Promise(() => {}); }
  };
  try {
    const result = await pipeline.execute({ '玩家·姓名': '测试忍者' }, '继续');
    assert.equal(result, null);
    assert.equal(abortCalls, 1);
  } finally {
    AGENT_TIMEOUTS.pipeline_total = originalTimeout;
  }
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
