import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { AIClient } from '../js/core/ai-client.js';

let passed = 0;

async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

await test('dynamic music metadata cannot inject HTML attributes', () => {
  const source = fs.readFileSync(new URL('../js/ui/settings-panel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /data-song='\$\{esc\(JSON\.stringify\(song\)\)\}'/);
  assert.doesNotMatch(source, /value="\$\{esc\(/);
});

await test('character creator uses attribute escaping for dynamic input values', () => {
  const source = fs.readFileSync(new URL('../js/ui/character-creator.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /value="\$\{this\._esc\(/);
});

await test('service worker bypasses API, auth, and non-GET requests', async () => {
  const listeners = {};
  const cached = [];
  const context = {
    URL,
    Response,
    Promise,
    console,
    self: {
      addEventListener: (type, listener) => { listeners[type] = listener; },
      skipWaiting() {},
      clients: { claim() {}, async matchAll() { return []; } }
    },
    caches: {
      async keys() { return []; },
      async delete() { return true; },
      async match() { return null; },
      async open() {
        return { async put(request) { cached.push(new URL(request.url).pathname); } };
      }
    },
    async fetch() {
      return { status: 200, type: 'basic', clone() { return this; } };
    }
  };
  const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);

  function isIntercepted(path, method = 'GET') {
    let responsePromise;
    listeners.fetch({
      request: { url: `https://game.test${path}`, method },
      respondWith(value) { responsePromise = value; }
    });
    return Boolean(responsePromise);
  }

  assert.equal(isIntercepted('/api/music/favorites'), false);
  assert.equal(isIntercepted('/auth/me'), false);
  assert.equal(isIntercepted('/auth/logout', 'POST'), false);
  assert.equal(isIntercepted('/js/app.js'), true);
});

await test('proxy mode enforces the requested timeout', async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal = null;
  globalThis.fetch = (_url, init) => {
    observedSignal = init?.signal ?? null;
    return new Promise((_resolve, reject) => {
      observedSignal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  };

  try {
    const client = new AIClient();
    client.configure({
      backend: 'openai',
      apiUrl: 'https://example.com/v1',
      apiKey: 'probe',
      model: 'probe',
      useProxy: true
    });
    const outcome = await Promise.race([
      client.chat([{ role: 'user', content: 'probe' }], { timeout: 20 })
        .then(() => 'resolved', (error) => `${error.name}:${error.message}`),
      new Promise((resolve) => setTimeout(() => resolve('still-pending'), 250))
    ]);

    assert.ok(observedSignal, 'proxy fetch should receive an AbortSignal');
    assert.notEqual(outcome, 'still-pending', 'proxy request ignored timeout');
    assert.match(String(outcome), /abort|timeout|超时/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('welcome privacy copy accurately describes stateless proxying', () => {
  const source = fs.readFileSync(new URL('../js/utils/help-guide.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /不会上传到任何服务器/);
  assert.match(source, /无状态代理/);
});

console.log(`\n${passed} security regression tests passed.`);
