import assert from 'node:assert/strict';

import { AIClient } from '../js/core/ai-client.js';
import { MessagePipeline } from '../js/core/pipeline.js';
import { stateManager } from '../js/core/state-manager.js';
import {
  NPC_SUMMARY_POLICIES,
  findRecoverableNpcSummary,
  inspectNpcSummaryCompletion,
  requestCompleteNpcSummary
} from '../js/core/npc-summary.js';

let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

const completeStageSummary = `${'晴炎与香燐共同经历追捕与突围，双方的戒备逐渐转化为信任。'.repeat(3)}他们约定抵达安全地点后交换情报。`;
const completeGrandSummary = `${'晴炎与香燐从互相试探开始，在多次追捕、谈判与救援中建立了稳定信任。'.repeat(6)}尚未解决的矛盾，是双方仍各自保留着有关木叶高层的秘密。`;

await test('summary policies leave enough room for reasoning models', () => {
  assert.equal(NPC_SUMMARY_POLICIES.stage.maxTokens, 4096);
  assert.equal(NPC_SUMMARY_POLICIES.stage.retryMaxTokens, 8192);
  assert.equal(NPC_SUMMARY_POLICIES.grand.maxTokens, 8192);
  assert.equal(NPC_SUMMARY_POLICIES.grand.retryMaxTokens, 12288);
});

await test('truncated completion is retried with a larger budget', async () => {
  const calls = [];
  const client = {
    chatDetailed: async (messages, options) => {
      calls.push({ messages, options });
      if (calls.length === 1) {
        return { text: '木叶64年初冬，香燐与晴炎在', finishReason: 'length' };
      }
      return { text: completeStageSummary, finishReason: 'stop' };
    }
  };

  const result = await requestCompleteNpcSummary(
    client,
    [{ role: 'user', content: '生成阶段摘要。' }],
    NPC_SUMMARY_POLICIES.stage
  );

  assert.equal(result.text, completeStageSummary);
  assert.equal(result.attempts, 2);
  assert.deepEqual(calls.map(call => call.options.max_tokens), [4096, 8192]);
  assert.match(calls[1].messages.at(-1).content, /上次输出不完整/);
  assert.match(calls[1].messages.at(-1).content, /生成阶段摘要/);
});

await test('short unfinished text is rejected even without finish metadata', async () => {
  const client = { chat: async () => '自木叶高层谈判一役，晴炎为' };
  const result = await requestCompleteNpcSummary(
    client,
    [{ role: 'user', content: '生成阶段摘要。' }],
    NPC_SUMMARY_POLICIES.stage
  );

  assert.equal(result.text, null);
  assert.equal(result.attempts, 2);
  assert.equal(result.reason, 'too-short');
});

await test('complete summaries pass text validation', () => {
  assert.equal(inspectNpcSummaryCompletion(completeStageSummary, NPC_SUMMARY_POLICIES.stage).complete, true);
  assert.equal(inspectNpcSummaryCompletion(completeGrandSummary, NPC_SUMMARY_POLICIES.grand).complete, true);
});

await test('only incomplete summaries backed by raw history are recoverable', () => {
  const summaries = [
    { content: '香燐与晴炎在', covered_turns: [1, 2] },
    { content: completeStageSummary, covered_turns: [3, 4] },
    { content: '无法恢复的旧摘要', covered_turns: [99] }
  ];
  const history = [
    { turn: 2, summary: '第二次互动' },
    { turn: 1, summary: '第一次互动' }
  ];

  const repair = findRecoverableNpcSummary(summaries, history);
  assert.equal(repair.index, 0);
  assert.deepEqual(repair.historyEntries.map(entry => entry.turn), [2, 1]);
});

await test('AIClient exposes finish metadata without changing chat string results', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '半句话' }, finish_reason: 'length' }],
      usage: { total_tokens: 4096 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const client = new AIClient();
    client.configure({ backend: 'openai', apiUrl: 'https://example.test/v1', model: 'reasoning-model' });
    const detailed = await client.chatDetailed([{ role: 'user', content: '摘要' }], { max_tokens: 4096 });
    assert.deepEqual(detailed, {
      text: '半句话',
      finishReason: 'length',
      usage: { total_tokens: 4096 }
    });
    assert.equal(await client.chat([{ role: 'user', content: '摘要' }]), '半句话');
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('Claude detailed responses keep stop metadata and ignore reasoning blocks', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    content: [
      { type: 'thinking', thinking: '内部推理' },
      { type: 'text', text: '完整摘要。' }
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const client = new AIClient();
    client.configure({ backend: 'claude', apiUrl: 'https://example.test/v1', model: 'claude-test' });
    assert.deepEqual(await client.chatDetailed([{ role: 'user', content: '摘要' }]), {
      text: '完整摘要。',
      finishReason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 20 }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('proxy mode also exposes completion metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '完整摘要。' }, finish_reason: 'stop' }],
    usage: { total_tokens: 42 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const client = new AIClient();
    client.configure({
      backend: 'openai',
      apiUrl: 'https://example.test/v1',
      model: 'proxy-model',
      useProxy: true
    });
    assert.deepEqual(await client.chatDetailed([{ role: 'user', content: '摘要' }]), {
      text: '完整摘要。',
      finishReason: 'stop',
      usage: { total_tokens: 42 }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('Tavern retries retain the source prompt and use the larger budget', async () => {
  const originalGenerateRaw = globalThis.generateRaw;
  const calls = [];
  globalThis.generateRaw = async options => {
    calls.push(options);
    return calls.length === 1 ? '香燐与晴炎在' : completeStageSummary;
  };

  try {
    const client = new AIClient();
    client.configure({ backend: 'tavern', model: 'tavern-test' });
    const result = await requestCompleteNpcSummary(
      client,
      [{ role: 'user', content: '原始互动记录：共同突围。' }],
      NPC_SUMMARY_POLICIES.stage
    );
    assert.equal(result.text, completeStageSummary);
    assert.deepEqual(calls.map(call => call.max_tokens), [4096, 8192]);
    assert.match(calls[1].user_input, /原始互动记录/);
    assert.match(calls[1].user_input, /上次输出不完整/);
  } finally {
    if (originalGenerateRaw === undefined) delete globalThis.generateRaw;
    else globalThis.generateRaw = originalGenerateRaw;
  }
});

await test('failed grand summary keeps all stage summaries for a later retry', async () => {
  const originalFetch = globalThis.fetch;
  const existingSummaries = Array.from({ length: 10 }, (_, index) => ({
    turn: index + 1,
    time: `第${index + 1}回合`,
    content: completeStageSummary,
    covered_turns: [index + 1]
  }));
  stateManager.reset();
  stateManager.setSub('_relationships', {
    香燐: {
      pinned: true,
      summary_turn_counter: 10,
      summaries: existingSummaries,
      grand_summary: '旧有完整编年史。'.repeat(20),
      history: Array.from({ length: 10 }, (_, index) => ({
        turn: 20 - index,
        time: `第${20 - index}回合`,
        summary: `第${20 - index}次互动记录`
      }))
    }
  });

  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    const payload = requests === 1
      ? { choices: [{ message: { content: completeStageSummary }, finish_reason: 'stop' }] }
      : { choices: [{ message: { content: '关系从最初的戒备发展到' }, finish_reason: 'length' }] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const pipeline = new MessagePipeline({});
    await pipeline._checkPinnedNpcSummaries({
      backend: 'openai',
      apiUrl: 'https://example.test/v1',
      model: 'reasoning-model'
    });
    const relationship = stateManager.getSub('_relationships').香燐;
    assert.equal(requests, 3);
    assert.equal(relationship.summaries.length, 11);
    assert.equal(relationship.summary_turn_counter, 0);
    assert.equal(relationship.grand_summary, '旧有完整编年史。'.repeat(20));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('recoverable legacy summary is rebuilt without changing its metadata', async () => {
  const originalFetch = globalThis.fetch;
  stateManager.reset();
  stateManager.setSub('_relationships', {
    香燐: {
      pinned: true,
      summary_turn_counter: 0,
      grand_summary: '',
      summaries: [{
        turn: 18,
        time: '木叶64年初冬',
        content: '香燐与晴炎在',
        covered_turns: [7, 8]
      }],
      history: [
        { turn: 8, time: '次日', summary: '共同突围' },
        { turn: 7, time: '前夜', summary: '交换情报' }
      ]
    }
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: completeStageSummary }, finish_reason: 'stop' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const pipeline = new MessagePipeline({});
    await pipeline._checkPinnedNpcSummaries({
      backend: 'openai',
      apiUrl: 'https://example.test/v1',
      model: 'reasoning-model'
    });
    const repaired = stateManager.getSub('_relationships').香燐.summaries[0];
    assert.equal(repaired.content, completeStageSummary);
    assert.equal(repaired.turn, 18);
    assert.equal(repaired.time, '木叶64年初冬');
    assert.deepEqual(repaired.covered_turns, [7, 8]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n${passed} NPC summary regression tests passed.`);
