import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();

const {
  listApiSchemes,
  getApiScheme,
  saveApiScheme,
  deleteApiScheme,
  setActiveApiScheme,
  getActiveApiSchemeId
} = await import('../js/core/api-schemes.js');

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

function freshStorage() {
  globalThis.localStorage = new MemoryStorage();
}

await test('empty storage lists no schemes and has no active marker', async () => {
  freshStorage();
  assert.deepEqual(await listApiSchemes(), []);
  assert.equal(getActiveApiSchemeId(), null);
});

await test('saving a scheme returns an id and hides the plaintext key from the list', async () => {
  freshStorage();
  const id = await saveApiScheme({
    name: 'DeepSeek 主号',
    backend: 'deepseek',
    apiUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-secret-123',
    model: 'deepseek-chat',
    disableStreaming: false
  });
  assert.ok(typeof id === 'string' && id.length > 0);

  const list = await listApiSchemes();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'DeepSeek 主号');
  assert.equal(list[0].backend, 'deepseek');
  assert.equal(list[0].apiUrl, 'https://api.deepseek.com/v1');
  assert.equal(list[0].model, 'deepseek-chat');
  assert.equal(list[0].hasKey, true);
  assert.equal(list[0].apiKey, undefined, 'list must not expose the plaintext key');
});

await test('getApiScheme decrypts the key back to the original', async () => {
  freshStorage();
  const id = await saveApiScheme({ name: 'A', apiUrl: 'https://a.test/v1', apiKey: 'secret-value', model: 'm', backend: 'openai' });
  const scheme = await getApiScheme(id);
  assert.equal(scheme.apiKey, 'secret-value');
  assert.equal(scheme.backend, 'openai');
});

await test('updating a scheme keeps the id and replaces values/key', async () => {
  freshStorage();
  const id = await saveApiScheme({ name: 'A', apiUrl: 'https://a.test/v1', apiKey: 'old-key', model: 'm1', backend: 'openai' });
  await saveApiScheme({ id, name: 'A-改', apiUrl: 'https://b.test/v1', apiKey: 'new-key', model: 'm2', backend: 'claude', disableStreaming: true });

  const updated = await getApiScheme(id);
  assert.equal(updated.name, 'A-改');
  assert.equal(updated.apiUrl, 'https://b.test/v1');
  assert.equal(updated.apiKey, 'new-key');
  assert.equal(updated.model, 'm2');
  assert.equal(updated.backend, 'claude');
  assert.equal(updated.disableStreaming, true);

  const list = await listApiSchemes();
  assert.equal(list.length, 1, 'update must not create a duplicate');
});

await test('updating an unknown id returns null', async () => {
  freshStorage();
  const result = await saveApiScheme({ id: 'does-not-exist', name: 'X', apiUrl: 'https://x/v1', apiKey: '', model: 'm', backend: 'openai' });
  assert.equal(result, null);
});

await test('delete removes the scheme and clears the active marker when it was active', async () => {
  freshStorage();
  const id = await saveApiScheme({ name: 'A', apiUrl: 'https://a/v1', apiKey: 'k', model: 'm', backend: 'openai' });
  setActiveApiScheme(id);
  assert.equal(getActiveApiSchemeId(), id);

  assert.equal(await deleteApiScheme(id), true);
  assert.deepEqual(await listApiSchemes(), []);
  assert.equal(getActiveApiSchemeId(), null, 'deleting the active scheme must clear the marker');

  assert.equal(await deleteApiScheme(id), false, 're-deleting an unknown id is a no-op');
});

await test('active marker survives across list/get round-trips', async () => {
  freshStorage();
  const a = await saveApiScheme({ name: 'A', apiUrl: 'https://a/v1', apiKey: '', model: 'm', backend: 'openai' });
  const b = await saveApiScheme({ name: 'B', apiUrl: 'https://b/v1', apiKey: '', model: 'm', backend: 'openai' });
  setActiveApiScheme(b);
  assert.equal(getActiveApiSchemeId(), b);
  assert.equal((await listApiSchemes()).find(s => s.id === a).hasKey, false, 'empty key -> hasKey false');
});

await test('corrupted scheme JSON degrades to an empty list', async () => {
  freshStorage();
  globalThis.localStorage.setItem('naruto_api_schemes', '{not-json');
  assert.deepEqual(await listApiSchemes(), []);
  assert.equal(await getApiScheme('anything'), null);
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nAPI schemes regression: ${passed}/${passed} passed`);
}
