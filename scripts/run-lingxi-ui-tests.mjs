import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const healthUrl = 'http://127.0.0.1:4178/tests/fixtures/editor-harness.html';

function reachable(timeoutMs = 1000) {
  return new Promise(resolve => {
    const request = http.get(healthUrl, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`UI test server did not become ready at ${healthUrl}`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function stopServer(server) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  const stopped = await Promise.race([
    waitForExit(server).then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 2500))
  ]);
  if (!stopped && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
}

let ownedServer = null;
try {
  if (!await reachable()) {
    ownedServer = spawn(process.execPath, ['scripts/ui-test-server.mjs'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    ownedServer.stdout.on('data', chunk => process.stdout.write(chunk));
    ownedServer.stderr.on('data', chunk => process.stderr.write(chunk));
    await waitForServer();
  }

  const playwrightCli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  const runner = spawn(process.execPath, [
    playwrightCli,
    'test',
    'tests/ui/lingxi-companion.spec.mjs',
    'tests/ui/lingxi-navigation.spec.mjs',
    'tests/ui/music-floating-player.spec.mjs'
  ], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  const result = await waitForExit(runner);
  process.exitCode = Number.isInteger(result.code) ? result.code : 1;
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  await stopServer(ownedServer);
}
