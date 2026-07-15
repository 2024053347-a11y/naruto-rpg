import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { eventBus } from '../js/core/event-bus.js';
import { FavoritesRepository } from '../server/db/favorites-repository.js';
import { JsonStore } from '../server/db/json-store.js';

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`));
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

await test('JsonStore refuses to overwrite a corrupt document', async () => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'naruto-jsonstore-regression-'));
  const file = path.join(directory, 'data.json');
  const corruptPayload = '{broken';
  try {
    await fsPromises.writeFile(file, corruptPayload, 'utf8');
    const store = new JsonStore(file, {});
    await assert.rejects(
      () => store.update((document) => {
        document.newValue = true;
        return { persist: true };
      }),
      /corrupt|损坏|read/i
    );
    assert.equal(await fsPromises.readFile(file, 'utf8'), corruptPayload);
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

await test('production refuses to start with AUTH_BYPASS enabled', () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    'await import("./server/config.js")'
  ], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AUTH_BYPASS: 'true',
      JWT_SECRET: 'architecture-regression-production-secret'
    },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.notEqual(result.status, 0, 'production config accepted AUTH_BYPASS=true');
  assert.match(`${result.stdout}\n${result.stderr}`, /AUTH_BYPASS/);
});

await test('auth and admin modules use the persistence seam', () => {
  const authSource = fs.readFileSync(new URL('../server/auth/discord.js', import.meta.url), 'utf8');
  const adminSource = fs.readFileSync(new URL('../server/api/admin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(authSource, /readFileSync|writeFileSync/);
  assert.doesNotMatch(adminSource, /readFileSync|writeFileSync/);
  assert.match(authSource, /recordLogin/);
  assert.match(adminSource, /getLoginLog/);
});

await test('runtime data directory is configurable and ignored', () => {
  const configSource = fs.readFileSync(new URL('../server/config.js', import.meta.url), 'utf8');
  const ignoreSource = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(configSource, /DATA_DIR/);
  assert.match(ignoreSource, /server\/data/);
});

await test('storage migration preserves user preferences', async () => {
  const { migrateStorage } = await import('../js/core/storage-migrations.js');
  const values = new Map([
    ['naruto_agent_config', '{"enabled":true}'],
    ['naruto_ui_prefs', '{"fontSize":18}'],
    ['naruto_music_playlist', '[{"id":1}]'],
    ['naruto_music_favorites', '[{"id":2}]'],
    ['naruto_worldbook', 'rebuild-me'],
    ['naruto_timeline_summary', 'rebuild-me-too']
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  migrateStorage(storage);
  assert.equal(values.get('naruto_agent_config'), '{"enabled":true}');
  assert.equal(values.get('naruto_ui_prefs'), '{"fontSize":18}');
  assert.equal(values.get('naruto_music_playlist'), '[{"id":1}]');
  assert.equal(values.get('naruto_music_favorites'), '[{"id":2}]');
  assert.equal(values.has('naruto_worldbook'), false);
  assert.equal(values.has('naruto_timeline_summary'), false);
});

await test('variable updater timeout reaches the real AI request', () => {
  const updaterSource = fs.readFileSync(new URL('../js/core/variable-updater.js', import.meta.url), 'utf8');
  const pipelineSource = fs.readFileSync(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
  assert.match(updaterSource, /timeout:\s*resolveVariableUpdaterTimeout/);
  assert.doesNotMatch(pipelineSource, /secondaryWithTimeout|__SECONDARY_TIMEOUT__/);
});

await test('EventBus has an awaited single-handler command seam', async () => {
  eventBus.clear();
  eventBus.on('test:request', async ({ value }) => value * 2);
  assert.equal(await eventBus.request('test:request', { value: 4 }), 8);
  eventBus.clear();
});

await test('player submissions use the awaited command seam', () => {
  const shellSource = fs.readFileSync(new URL('../js/ui/app-shell.js', import.meta.url), 'utf8');
  const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(shellSource, /eventBus\.request\('user:submit'/);
  assert.doesNotMatch(shellSource, /eventBus\.emit\('user:input', finalText\)/);
  assert.match(appSource, /eventBus\.on\('user:submit'/);
});

await test('help modal removes its document key listener on every close path', () => {
  const source = fs.readFileSync(new URL('../js/utils/help-guide.js', import.meta.url), 'utf8');
  assert.match(source, /this\._modalEscHandler/);
  assert.match(source, /removeEventListener\('keydown', this\._modalEscHandler\)/);
});

await test('favorites replacement keeps the newest 100 entries', async () => {
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'naruto-favorites-regression-'));
  try {
    const repository = new FavoritesRepository(path.join(directory, 'favorites.json'));
    await repository.init();
    const songs = Array.from({ length: 105 }, (_, id) => ({ id: String(id) }));
    await repository.replaceAll('user', songs);
    const saved = await repository.listByUser('user');
    assert.equal(saved.length, 100);
    assert.equal(saved[0].id, '5');
    assert.equal(saved.at(-1).id, '104');
  } finally {
    await fsPromises.rm(directory, { recursive: true, force: true });
  }
});

await test('expanded skill sections are not clipped and the panel exposes scrolling', () => {
  const panelSource = fs.readFileSync(new URL('../js/ui/panel.js', import.meta.url), 'utf8');
  const panelStyles = fs.readFileSync(new URL('../css/components/panel.css.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    panelSource,
    /max-height:\$\{isCollapsed\?'0':'\d+px'\}/,
    'expanded skill sections still use a fixed pixel height'
  );
  assert.match(panelStyles, /\.content\s*\{[^}]*scrollbar-width:\s*thin/s);
  assert.match(panelStyles, /\.content::-webkit-scrollbar\s*\{[^}]*width:/s);
  assert.match(panelStyles, /\.skill-section-body\s*\{[^}]*overflow:\s*visible/s);
  assert.match(panelStyles, /\.skill-section-body\.collapsed\s*\{[^}]*overflow:\s*hidden/s);
});

if (failures.length) {
  throw new AggregateError(failures, `${failures.length} architecture regression test(s) failed`);
}

console.log(`\n${passed} architecture regression tests passed.`);
