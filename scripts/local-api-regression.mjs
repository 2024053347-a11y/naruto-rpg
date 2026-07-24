import assert from 'node:assert/strict';
import http from 'node:http';

const requests = [];
const server = http.createServer((req, res) => {
  requests.push({ method: req.method, url: req.url });
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.end(JSON.stringify({ data: [{ id: 'local-test-model' }] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    res.end(JSON.stringify({
      choices: [{ message: { content: '本地模型连接成功' }, finish_reason: 'stop' }]
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: `unexpected path: ${req.url}` }));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    requests.length = 0;
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.stack || error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

try {
  globalThis.location = { hostname: 'localhost' };
  const localRuntime = await import('../js/core/ai-client.js?local-api-runtime');

  await test('local OpenAI URL normalization accepts common pasted address forms', async () => {
    assert.equal(localRuntime.normalizeApiBaseUrl(`127.0.0.1:${port}`), `${baseUrl}/v1`);
    assert.equal(localRuntime.normalizeApiBaseUrl(`${baseUrl}/v1/`), `${baseUrl}/v1`);
    assert.equal(localRuntime.normalizeApiBaseUrl(`${baseUrl}/v1/models`), `${baseUrl}/v1`);
    assert.equal(localRuntime.normalizeApiBaseUrl(`${baseUrl}/v1/chat/completions`), `${baseUrl}/v1`);
    assert.equal(localRuntime.normalizeApiBaseUrl('http://192.168.1.50:1234'), 'http://192.168.1.50:1234/v1');
    assert.equal(localRuntime.normalizeApiBaseUrl('https://api.example.com/openai'), 'https://api.example.com/openai');
  });

  await test('local runtime accepts a bare local OpenAI server address as its v1 base', async () => {
    const client = new localRuntime.AIClient();
    const models = await client.listModels({ backend: 'openai', apiUrl: baseUrl, apiKey: '' });
    assert.deepEqual(models, ['local-test-model']);

    client.configure({
      backend: 'openai', apiUrl: baseUrl, apiKey: '', model: models[0], useProxy: true
    });
    assert.equal(client._useProxy, false);
    const response = await client.chat([{ role: 'user', content: '测试' }], { max_tokens: 32 });
    assert.equal(response, '本地模型连接成功');
    let streamed = '';
    const streamResponse = await client.chatStream(
      [{ role: 'user', content: '流式测试' }],
      { max_tokens: 32, maxRetries: 0 },
      chunk => { streamed += chunk; }
    );
    assert.equal(streamResponse, '本地模型连接成功');
    assert.equal(streamed, '本地模型连接成功');
    assert.deepEqual(requests.map(item => item.url), [
      '/v1/models', '/v1/chat/completions', '/v1/chat/completions'
    ]);
  });

  globalThis.location = { hostname: 'www.qiwu.asia' };
  const hostedRuntime = await import('../js/core/ai-client.js?hosted-local-api');

  await test('hosted runtime sends loopback API requests directly to the user local service', async () => {
    const client = new hostedRuntime.AIClient();
    const models = await client.listModels({ backend: 'openai', apiUrl: `${baseUrl}/v1`, apiKey: '' });
    assert.deepEqual(models, ['local-test-model']);

    client.configure({
      backend: 'openai', apiUrl: `${baseUrl}/v1`, apiKey: '', model: models[0], useProxy: true
    });
    assert.equal(client._useProxy, false);
    const response = await client.chat([{ role: 'user', content: '测试' }], { max_tokens: 32 });
    assert.equal(response, '本地模型连接成功');
    assert.deepEqual(requests.map(item => item.url), ['/v1/models', '/v1/chat/completions']);
  });

  await test('hosted runtime still sends public API targets through the server proxy', async () => {
    const originalFetch = globalThis.fetch;
    let observedUrl = '';
    globalThis.fetch = async url => {
      observedUrl = String(url);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    try {
      const adapter = new hostedRuntime.AIAdapter();
      await adapter._fetch('/api/ai-proxy', {
        headers: { 'x-target-url': 'https://api.example.com/v1/models' }
      });
      assert.equal(observedUrl, '/api/ai-proxy');
      const client = new hostedRuntime.AIClient();
      client.configure({
        backend: 'openai', apiUrl: 'https://api.example.com/v1', apiKey: '', model: 'public-model', useProxy: true
      });
      assert.equal(client._useProxy, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test('local browser network failures explain the CORS and local-service requirements', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try {
      const adapter = new localRuntime.AIAdapter();
      await assert.rejects(
        adapter._fetch('/api/ai-proxy', {
          headers: { 'x-target-url': `${baseUrl}/v1/models` }
        }),
        /CORS|跨域/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
} finally {
  delete globalThis.location;
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  throw new Error(`Local API regression failures:\n${failures.join('\n\n')}`);
}
console.log(`PASS ${passed} local API compatibility checks.`);
