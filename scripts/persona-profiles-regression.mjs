import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();

const {
  listPersonaProfiles,
  getPersonaProfile,
  savePersonaProfile,
  deletePersonaProfile
} = await import('../js/core/persona-profiles.js');

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

await test('empty storage lists no persona profiles', async () => {
  freshStorage();
  assert.deepEqual(await listPersonaProfiles(), []);
  assert.equal(await getPersonaProfile('anything'), null);
});

await test('saving a persona returns an id and hides the draft from the list', async () => {
  freshStorage();
  const id = await savePersonaProfile({
    name: '雾隐暗部·夜枭',
    draft: { identity: { name: '夜枭', gender: 'female' }, campaign: { timeline: 'konoha_52' } }
  });
  assert.ok(typeof id === 'string' && id.length > 0);

  const list = await listPersonaProfiles();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '雾隐暗部·夜枭');
  assert.equal(list[0].draft, undefined, 'list must not expose the full draft');
});

await test('getPersonaProfile returns the normalized draft', async () => {
  freshStorage();
  const id = await savePersonaProfile({
    name: 'A',
    draft: { identity: { name: '夜枭' } }
  });
  const profile = await getPersonaProfile(id);
  assert.equal(profile.name, 'A');
  assert.ok(profile.draft && typeof profile.draft === 'object', 'draft must be an object');
  assert.equal(profile.draft.identity?.name, '夜枭');
});

await test('updating a persona keeps the id and replaces name/draft', async () => {
  freshStorage();
  const id = await savePersonaProfile({ name: 'A', draft: { identity: { name: '甲' } } });
  await savePersonaProfile({ id, name: 'A-改', draft: { identity: { name: '乙' } } });
  const updated = await getPersonaProfile(id);
  assert.equal(updated.name, 'A-改');
  assert.equal(updated.draft.identity.name, '乙');
  assert.equal((await listPersonaProfiles()).length, 1, 'update must not create a duplicate');
});

await test('updating an unknown id returns null', async () => {
  freshStorage();
  const result = await savePersonaProfile({ id: 'does-not-exist', name: 'X', draft: {} });
  assert.equal(result, null);
});

await test('delete removes the persona', async () => {
  freshStorage();
  const id = await savePersonaProfile({ name: 'A', draft: {} });
  assert.equal(await deletePersonaProfile(id), true);
  assert.deepEqual(await listPersonaProfiles(), []);
  assert.equal(await deletePersonaProfile(id), false, 're-deleting an unknown id is a no-op');
});

await test('corrupted persona JSON degrades to an empty list', async () => {
  freshStorage();
  globalThis.localStorage.setItem('naruto_persona_profiles', '{not-json');
  assert.deepEqual(await listPersonaProfiles(), []);
  assert.equal(await getPersonaProfile('anything'), null);
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nPersona profiles regression: ${passed}/${passed} passed`);
}
