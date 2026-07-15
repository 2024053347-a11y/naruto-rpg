import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

const port = await getFreePort();
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naruto-server-regression-'));
const syntheticJwt = 'SYNTHETIC_JWT_SHOULD_NOT_BE_LOGGED';
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    AUTH_BYPASS: 'true',
    ADMIN_KEY: 'server-regression-admin-key',
    MAX_SAVE_SLOTS: '999',
    DATA_DIR: dataDir
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.resume();

const failures = [];
let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error.message}`));
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

try {
  await waitForServer(`http://127.0.0.1:${port}/login.html`);

  await check('legacy music favorites route remains compatible', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/music/favorites`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).favorites));
  });

  await check('malformed JSON returns 400', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    assert.equal(response.status, 400);
  });

  await check('invalid save slot name returns 400', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/saves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_name: 123, save_data: {} })
    });
    assert.equal(response.status, 400);
  });

  await check('admin stats work without a login log file', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/stats`, {
      headers: { 'x-admin-key': 'server-regression-admin-key' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.last7Days));
    assert.ok(Array.isArray(body.recentLogins));
  });

  await check('OAuth state mismatch redirects safely', async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/auth/discord/callback?state=bad&code=fake`,
      {
        redirect: 'manual',
        headers: {
          Cookie: `naruto_token=${syntheticJwt}; discord_oauth_state=expected`
        }
      }
    );
    assert.equal(response.status, 302);
  });
} finally {
  child.kill();
  if (child.exitCode == null) await once(child, 'exit');
  await fs.rm(dataDir, { recursive: true, force: true });
}

await check('OAuth diagnostics never log JWT cookies', () => {
  assert.equal(stderr.includes(syntheticJwt), false);
});

if (failures.length) {
  throw new AggregateError(failures, `${failures.length} server regression test(s) failed`);
}

console.log(`\n${passed} server regression tests passed.`);
