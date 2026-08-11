import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { forwardBoundedResponse, requestUpstreamWithRetry } from '../server/api/ai-proxy.js';
import { imageUploadAdmission } from '../server/api/image-assets.js';
import {
  DISCORD_FETCH_TIMEOUT_MS,
  DISCORD_GUILDS_MAX_BYTES,
  DISCORD_STANDARD_MAX_BYTES,
  fetchDiscordJson,
  readDiscordJsonLimited
} from '../server/auth/discord.js';
import {
  createAdmissionController,
  createAdmissionMiddleware
} from '../server/middleware/admission.js';
import { asyncRoute } from '../server/middleware/async-route.js';

const failures = [];
let passed = 0;

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

async function getFreePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

async function waitForReady(url, child) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode != null) throw new Error(`server exited before readiness with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status === 200) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${url}`);
}

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = new Map();
    this.statusCode = 200;
    this.body = null;
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), String(value));
  }

  status(statusCode) {
    this.statusCode = statusCode;
    return this;
  }

  json(body) {
    this.body = body;
    return this;
  }
}

await test('asyncRoute forwards rejected Express 4 handlers', async () => {
  const expected = new Error('async route failed');
  const forwarded = new Promise(resolve => {
    asyncRoute(async () => { throw expected; })({}, {}, resolve);
  });
  assert.equal(await forwarded, expected);
});

await test('AI admission rejects without queueing and releases exactly once', () => {
  const controller = createAdmissionController({ text: { perUser: 1, global: 1 } });
  const middleware = createAdmissionMiddleware({
    controller,
    selectCategory: () => 'text',
    identify: req => req.user.id
  });

  const firstResponse = new FakeResponse();
  let firstAccepted = false;
  middleware({ user: { id: 'first' } }, firstResponse, () => { firstAccepted = true; });
  assert.equal(firstAccepted, true);

  const sameUser = new FakeResponse();
  middleware({ user: { id: 'first' } }, sameUser, () => assert.fail('same user should be rejected'));
  assert.equal(sameUser.statusCode, 429);
  assert.equal(sameUser.body.code, 'AI_PROXY_USER_BUSY');
  assert.equal(sameUser.headers.get('retry-after'), '5');

  const otherUser = new FakeResponse();
  middleware({ user: { id: 'other' } }, otherUser, () => assert.fail('global overload should be rejected'));
  assert.equal(otherUser.statusCode, 503);
  assert.equal(otherUser.body.code, 'AI_PROXY_BUSY');

  firstResponse.emit('finish');
  firstResponse.emit('close');
  assert.equal(controller.snapshot('text').active, 0);
});

await test('AI admission policies enforce text 10/32 and image 1/4', () => {
  const controller = createAdmissionController({
    text: { perUser: 10, global: 32 },
    image: { perUser: 1, global: 4 }
  });
  const textLeases = Array.from({ length: 10 }, () => controller.tryAcquire('text', 'player'));
  assert.equal(textLeases.every(lease => lease.acquired), true);
  assert.equal(controller.tryAcquire('text', 'player').reason, 'user_limit');
  textLeases.forEach(lease => lease.release());

  const globalText = Array.from({ length: 32 }, (_, index) => controller.tryAcquire('text', `u${index}`));
  assert.equal(globalText.every(lease => lease.acquired), true);
  assert.equal(controller.tryAcquire('text', 'overflow').reason, 'global_limit');
  globalText.forEach(lease => lease.release());

  const image = controller.tryAcquire('image', 'player');
  assert.equal(image.acquired, true);
  assert.equal(controller.tryAcquire('image', 'player').reason, 'user_limit');
  image.release();
});

await test('image staging admission enforces one upload per user and four globally', () => {
  const responses = [];
  for (let index = 0; index < 4; index++) {
    const response = new FakeResponse();
    responses.push(response);
    let accepted = false;
    imageUploadAdmission({
      method: 'POST',
      path: '/',
      user: { id: `image-user-${index}` },
      resume() {}
    }, response, () => { accepted = true; });
    assert.equal(accepted, true);
  }

  const duplicate = new FakeResponse();
  imageUploadAdmission({
    method: 'POST', path: '/', user: { id: 'image-user-0' }, resume() {}
  }, duplicate, () => assert.fail('duplicate image upload should be rejected'));
  assert.equal(duplicate.statusCode, 429);
  assert.equal(duplicate.body.code, 'IMAGE_UPLOAD_IN_PROGRESS');

  const overflow = new FakeResponse();
  imageUploadAdmission({
    method: 'POST', path: '/', user: { id: 'image-user-overflow' }, resume() {}
  }, overflow, () => assert.fail('fifth image upload should be rejected'));
  assert.equal(overflow.statusCode, 503);
  assert.equal(overflow.body.code, 'IMAGE_UPLOAD_BUSY');
  responses.forEach(response => response.emit('finish'));
});

await test('non-stream AI responses use a bounded backpressure-aware pipeline', async () => {
  const chunks = [];
  const destination = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      setImmediate(callback);
    }
  });
  await forwardBoundedResponse(Readable.from(['one', 'two']), destination, { maxResponseBytes: 6 });
  assert.equal(chunks.join(''), 'onetwo');

  const rejected = forwardBoundedResponse(
    Readable.from(['1234']),
    new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    { maxResponseBytes: 3 }
  );
  await assert.rejects(rejected, error => error.code === 'ERR_AI_STREAM_TOO_LARGE');

  const source = await fs.readFile(new URL('../server/api/ai-proxy.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Buffer\.concat\(chunks\)/);
});

await test('AI proxy upstream retry recovers from 429 using Retry-After', async () => {
  let calls = 0;
  const timestamps = [];
  const doRequest = async () => {
    calls++;
    timestamps.push(Date.now());
    if (calls === 1) {
      return { statusCode: 429, headers: { 'retry-after': '1' }, destroy() {} };
    }
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, destroy() {} };
  };

  const response = await requestUpstreamWithRetry(doRequest, {
    maxAttempts: 2, maxPerRetryMs: 20000, maxTotalRetryMs: 45000
  });

  assert.equal(calls, 2);
  assert.equal(response.statusCode, 200);
  // 允许 850ms 而非 900ms：繁忙 CI 上 setTimeout 有抖动
  const elapsed = timestamps[1] - timestamps[0];
  assert.ok(elapsed >= 850, `expected >= 850ms wait (Retry-After: 1s), got ${elapsed}`);
});

await test('AI proxy upstream retry exhausts and forwards final 429', async () => {
  let calls = 0;
  const doRequest = async () => {
    calls++;
    return {
      statusCode: 429,
      headers: { 'retry-after': '60', 'content-type': 'application/json' },
      destroy() {}
    };
  };

  const response = await requestUpstreamWithRetry(doRequest, {
    maxAttempts: 2, maxPerRetryMs: 100, maxTotalRetryMs: 500
  });

  assert.equal(calls, 3); // 1 首次 + 2 重试 = 耗尽
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['retry-after'], '60');
});

await test('AI proxy upstream retry stops when total budget is exhausted', async () => {
  let calls = 0;
  const doRequest = async () => {
    calls++;
    return {
      statusCode: 429,
      headers: { 'retry-after': '10' },
      destroy() {}
    };
  };

  const response = await requestUpstreamWithRetry(doRequest, {
    // 允许 2 次额外重试，但预算只够一次 10s 等待
    maxAttempts: 2, maxPerRetryMs: 20000, maxTotalRetryMs: 5000
  });

  // 首次 429：wait=10s 截断到 per-retry=20s，但累计预算 5s < 10s → 停止
  assert.equal(calls, 1);
  assert.equal(response.statusCode, 429);
});

await test('AI proxy upstream retry aborts wait on client disconnect', async () => {
  const controller = new AbortController();
  let calls = 0;
  const doRequest = async () => {
    calls++;
    return {
      statusCode: 429,
      headers: { 'retry-after': '30' },
      destroy() {}
    };
  };

  // 首次等待期间中止
  setTimeout(() => controller.abort(), 100);
  const start = Date.now();

  await assert.rejects(
    requestUpstreamWithRetry(doRequest, {
      signal: controller.signal,
      maxAttempts: 2, maxPerRetryMs: 20000, maxTotalRetryMs: 45000
    }),
    error => error.name === 'AbortError'
  );

  assert.equal(calls, 1);
  assert.ok(Date.now() - start < 2000, 'should abort quickly, not wait for Retry-After');
});

await test('AI proxy upstream retry honours Retry-After as HTTP-date', async () => {
  let calls = 0;
  const timestamps = [];
  const doRequest = async () => {
    calls++;
    timestamps.push(Date.now());
    if (calls === 1) {
      // Retry-After 用 HTTP-date：从现在起 1 秒
      const future = new Date(Date.now() + 1000).toUTCString();
      return { statusCode: 429, headers: { 'retry-after': future }, destroy() {} };
    }
    return { statusCode: 200, headers: {}, destroy() {} };
  };

  const response = await requestUpstreamWithRetry(doRequest, {
    maxAttempts: 2, maxPerRetryMs: 20000, maxTotalRetryMs: 45000
  });

  assert.equal(calls, 2);
  assert.equal(response.statusCode, 200);
  const elapsed = timestamps[1] - timestamps[0];
  assert.ok(elapsed >= 700, `expected >= 700ms wait (HTTP-date ~1s), got ${elapsed}`);
});

await test('AI proxy upstream retry uses exponential backoff when Retry-After is absent', async () => {
  let calls = 0;
  const timestamps = [];
  const doRequest = async () => {
    calls++;
    timestamps.push(Date.now());
    if (calls >= 3) {
      return { statusCode: 200, headers: {}, destroy() {} };
    }
    return { statusCode: 429, headers: {}, destroy() {} };
  };

  const response = await requestUpstreamWithRetry(doRequest, {
    maxAttempts: 3, maxPerRetryMs: 20000, maxTotalRetryMs: 45000
  });

  assert.equal(calls, 3);
  assert.equal(response.statusCode, 200);
  // 2^1=2s, 2^2=4s → 共约 6s
  const totalElapsed = timestamps[2] - timestamps[0];
  assert.ok(totalElapsed >= 5500, `expected >= 5500ms total (2s + 4s backoff), got ${totalElapsed}`);
});

await test('Discord JSON limits reject declared and streamed oversized bodies', async () => {
  let declaredCancelled = 0;
  const declaredBody = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array([123])); },
    cancel() { declaredCancelled++; }
  });
  const declared = new Response(declaredBody, { headers: { 'Content-Length': '1025' } });
  await assert.rejects(
    readDiscordJsonLimited(declared, 1024),
    error => error.code === 'DISCORD_RESPONSE_TOO_LARGE'
  );
  assert.equal(declaredCancelled, 1);

  let streamedCancelled = 0;
  const streamed = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"padding":"123456"}')); },
    cancel() { streamedCancelled++; }
  }));
  await assert.rejects(
    readDiscordJsonLimited(streamed, 8),
    error => error.code === 'DISCORD_RESPONSE_TOO_LARGE'
  );
  assert.equal(streamedCancelled, 1);
});

await test('Discord timeout covers response body consumption', async () => {
  const fetchImpl = async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    }
  }));

  await assert.rejects(
    fetchDiscordJson('https://discord.com/api/v10/users/@me', {}, {
      fetchImpl,
      timeoutMs: 20,
      maxBytes: 1024
    }),
    error => error.code === 'DISCORD_REQUEST_TIMEOUT'
  );
  assert.equal(DISCORD_FETCH_TIMEOUT_MS, 15_000);
  assert.equal(DISCORD_STANDARD_MAX_BYTES, 256 * 1024);
  assert.equal(DISCORD_GUILDS_MAX_BYTES, 2 * 1024 * 1024);
});

await test('health endpoints report readiness and unauthenticated AI bodies are not parsed', async () => {
  const port = await getFreePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naruto-reliability-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      AUTH_BYPASS: 'false',
      DATA_DIR: dataDir
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  try {
    const ready = await waitForReady(`http://127.0.0.1:${port}/health/ready`, child);
    assert.deepEqual(await ready.json(), { status: 'ready' });
    assert.match(ready.headers.get('cache-control') || '', /no-store/);

    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/ai-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(3 * 1024 * 1024)
    });
    assert.equal(unauthorized.status, 401);
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    const [exitCode, signal] = child.exitCode == null ? await once(child, 'exit') : [child.exitCode, null];
    if (process.platform === 'win32' && signal === 'SIGTERM') {
      assert.equal(exitCode, null);
    } else {
      assert.equal(exitCode, 0, `graceful shutdown failed: ${stderr}`);
      assert.match(stdout, /"event":"shutdown_started"/);
      assert.match(stdout, /"event":"server_stopped"/);
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

await test('server lifecycle declares explicit timeout and fatal-error policies', async () => {
  const source = await fs.readFile(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(source, /HTTP_HEADERS_TIMEOUT_MS\s*=\s*70_000/);
  assert.match(source, /HTTP_REQUEST_TIMEOUT_MS\s*=\s*360_000/);
  assert.match(source, /HTTP_KEEP_ALIVE_TIMEOUT_MS\s*=\s*65_000/);
  assert.match(source, /SHUTDOWN_DRAIN_TIMEOUT_MS\s*=\s*30_000/);
  assert.match(source, /uncaughtException/);
  assert.match(source, /unhandledRejection/);
  assert.match(source, /if \(res\.headersSent\) return next\(err\)/);
});

if (failures.length) {
  throw new AggregateError(failures, `${failures.length} reliability regression test(s) failed`);
}

console.log(`\n${passed} server reliability regression tests passed.`);
