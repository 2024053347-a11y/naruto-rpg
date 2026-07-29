import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { gzipSync, gunzipSync } from 'node:zlib';

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

function timeline(padding = '') {
  return {
    nodes: [{
      id: 'root',
      parent_id: null,
      children_ids: [],
      branch_id: 'main',
      state_snapshot: { _version: '5.0', padding }
    }],
    branches: [{ id: 'main', head_node_id: 'root', diverged_from: null }],
    meta: { root_id: 'root', current_id: 'root', active_branch: 'main' }
  };
}

function encodedTimeline(value) {
  return gzipSync(Buffer.from(JSON.stringify(value)));
}

async function multipartRequest(url, method, metadata, compressed) {
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  form.append('save', new Blob([compressed], { type: 'application/gzip' }), 'save.json.gz');
  return fetch(url, { method, body: form });
}

function slowMultipartBody(boundary, metadata, compressed) {
  const prefix = Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="metadata"\r\n'
    + 'Content-Type: application/json\r\n\r\n'
    + `${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="save"; filename="save.json.gz"\r\n'
    + 'Content-Type: application/gzip\r\n\r\n'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return (async function* body() {
    yield prefix;
    yield compressed.subarray(0, Math.max(1, Math.floor(compressed.length / 2)));
    await new Promise((resolve) => setTimeout(resolve, 350));
    yield compressed.subarray(Math.max(1, Math.floor(compressed.length / 2)));
    yield suffix;
  }());
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naruto-cloud-save-stream-'));
const previousDataDir = process.env.DATA_DIR;
try {
process.env.DATA_DIR = dataDir;
const {
  acquireSaveUpload,
  receiveMultipartSave,
  SaveUploadError
} = await import('../server/save/stream-upload.js');
if (previousDataDir === undefined) delete process.env.DATA_DIR;
else process.env.DATA_DIR = previousDataDir;

const gateA = acquireSaveUpload('gate-a');
assert.throws(
  () => acquireSaveUpload('gate-a'),
  (error) => error instanceof SaveUploadError && error.code === 'SAVE_UPLOAD_IN_PROGRESS'
);
const gateB = acquireSaveUpload('gate-b');
assert.throws(
  () => acquireSaveUpload('gate-c'),
  (error) => error instanceof SaveUploadError && error.code === 'SAVE_UPLOAD_CAPACITY_REACHED'
);
gateB();
gateA();

{
  const boundary = `save-write-failure-${Date.now()}`;
  const prefix = Buffer.from(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="metadata"\r\n\r\n'
    + '{"slot_name":"write-failure"}\r\n'
    + `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="save"; filename="save.json.gz"\r\n'
    + 'Content-Type: application/gzip\r\n\r\n'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const request = Readable.from((async function* slowBody() {
    yield Buffer.concat([prefix, Buffer.from('first chunk')]);
    await new Promise(resolve => setTimeout(resolve, 150));
    yield Buffer.concat([Buffer.from('second chunk'), suffix]);
  }()));
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

  const originalCreateWriteStream = fsSync.createWriteStream;
  let unhandledRejection;
  const captureUnhandled = reason => { unhandledRejection = reason; };
  fsSync.createWriteStream = () => new Writable({
    write(_chunk, _encoding, callback) {
      const error = new Error('simulated staging disk failure');
      error.code = 'ENOSPC';
      callback(error);
    }
  });
  process.on('unhandledRejection', captureUnhandled);
  try {
    await assert.rejects(receiveMultipartSave(request), SaveUploadError);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(
      unhandledRejection,
      undefined,
      `staging write failure escaped as unhandled rejection: ${unhandledRejection?.message}`
    );
  } finally {
    process.off('unhandledRejection', captureUnhandled);
    fsSync.createWriteStream = originalCreateWriteStream;
  }
}

const port = await getFreePort();
const child = spawn(process.execPath, ['--max-old-space-size=96', 'server/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    AUTH_BYPASS: 'true',
    DATA_DIR: dataDir,
    MAX_SAVE_SLOTS: '4',
    MAX_SAVE_SIZE_MB: '200',
    MAX_SAVE_COMPRESSED_SIZE_MB: '64',
    MAX_LEGACY_SAVE_SIZE_MB: '16',
    SAVE_UPLOAD_GLOBAL_CONCURRENCY: '2'
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdout.resume();

const createdIds = [];
try {
  const baseUrl = `http://127.0.0.1:${port}/api/saves`;
  await waitForServer(`${baseUrl}/capabilities`);

  const capabilities = await (await fetch(`${baseUrl}/capabilities`)).json();
  assert.equal(capabilities.preferred_upload_protocol, 'gzip-multipart-v1');
  assert.equal(capabilities.limits.max_uncompressed_bytes, 200 * 1024 * 1024);
  assert.equal(capabilities.limits.max_compressed_bytes, 64 * 1024 * 1024);
  assert.equal(capabilities.limits.max_legacy_json_bytes, 16 * 1024 * 1024);

  const corrupt = await multipartRequest(baseUrl, 'POST', { slot_name: 'corrupt' }, Buffer.from('not-gzip'));
  assert.equal(corrupt.status, 400);
  assert.equal((await corrupt.json()).code, 'INVALID_GZIP');

  const invalidStructure = await multipartRequest(
    baseUrl,
    'POST',
    { slot_name: 'invalid-structure' },
    gzipSync(Buffer.from('{"nodes":[],"branches":[]}'))
  );
  assert.equal(invalidStructure.status, 400);
  assert.equal((await invalidStructure.json()).code, 'INVALID_SAVE_STRUCTURE');

  const unsafe = await multipartRequest(
    baseUrl,
    'POST',
    { slot_name: 'unsafe' },
    gzipSync(Buffer.from('{"nodes":[{}],"branches":[{}],"__proto__":{}}'))
  );
  assert.equal(unsafe.status, 400);
  assert.equal((await unsafe.json()).code, 'UNSAFE_SAVE_KEY');

  const embeddedMedia = timeline('data:image/png;base64,AAAA');
  const embedded = await multipartRequest(baseUrl, 'POST', { slot_name: 'embedded' }, encodedTimeline(embeddedMedia));
  assert.equal(embedded.status, 400);
  assert.equal((await embedded.json()).code, 'EMBEDDED_MEDIA_FORBIDDEN');

  let nested = { leaf: true };
  for (let depth = 0; depth < 260; depth++) nested = { nested };
  const tooDeep = timeline();
  tooDeep.extra = nested;
  const depthResponse = await multipartRequest(baseUrl, 'POST', { slot_name: 'deep' }, encodedTimeline(tooDeep));
  assert.equal(depthResponse.status, 400);
  assert.equal((await depthResponse.json()).code, 'SAVE_JSON_TOO_DEEP');

  const stagingFiles = await fs.readdir(path.join(dataDir, 'save-staging'));
  assert.deepEqual(stagingFiles.filter((name) => name.endsWith('.upload')), []);
  assert.deepEqual(await (await fetch(baseUrl)).json(), []);

  const firstTimeline = timeline('first revision');
  const firstCompressed = encodedTimeline(firstTimeline);
  const created = await multipartRequest(
    baseUrl,
    'POST',
    { slot_name: 'streamed', preview_data: { turn: 1 } },
    firstCompressed
  );
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  createdIds.push(createdBody.id);
  assert.equal(createdBody.revision, 1);

  const content = await fetch(`${baseUrl}/${createdBody.id}/content`);
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('content-type'), 'application/gzip');
  assert.match(content.headers.get('etag') || '', /^"sha256-[a-f0-9]{64}"$/);
  const downloaded = Buffer.from(await content.arrayBuffer());
  assert.deepEqual(JSON.parse(gunzipSync(downloaded).toString('utf8')), firstTimeline);

  const oversizedLegacyDownload = await fetch(`${baseUrl}/${createdBody.id}`);
  assert.equal(oversizedLegacyDownload.status, 200, 'small streamed saves remain readable by legacy clients');

  const secondTimeline = timeline('second revision');
  const updated = await multipartRequest(
    `${baseUrl}/${createdBody.id}`,
    'PUT',
    { slot_name: 'streamed-v2', preview_data: { turn: 2 } },
    encodedTimeline(secondTimeline)
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).revision, 2);
  const indexAfterUpdate = JSON.parse(await fs.readFile(path.join(dataDir, 'saves_index.json'), 'utf8'));
  assert.equal(indexAfterUpdate[createdBody.id].revision, 2);
  assert.match(indexAfterUpdate[createdBody.id].blob_name, /\.r2\./);
  assert.equal(indexAfterUpdate[createdBody.id].content_sha256.length, 64);
  const revisionFiles = (await fs.readdir(path.join(dataDir, 'saves')))
    .filter((name) => name.startsWith(`${createdBody.id}.`) && name.endsWith('.bin'));
  assert.equal(revisionFiles.length, 1, 'obsolete revision was not removed');

  const legacyTimeline = timeline('legacy');
  const legacy = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot_name: 'legacy', save_data: legacyTimeline })
  });
  assert.equal(legacy.status, 201);
  const legacyBody = await legacy.json();
  createdIds.push(legacyBody.id);
  const legacyDownload = await fetch(`${baseUrl}/${legacyBody.id}`);
  assert.equal(legacyDownload.status, 200);
  assert.deepEqual((await legacyDownload.json()).save_data, legacyTimeline);

  const largeTimeline = timeline('x'.repeat(20 * 1024 * 1024));
  const large = await multipartRequest(
    baseUrl,
    'POST',
    { slot_name: 'large-streamed' },
    encodedTimeline(largeTimeline)
  );
  assert.equal(large.status, 201, 'large gzip upload must fit in a constrained server heap');
  const largeBody = await large.json();
  createdIds.push(largeBody.id);
  const largeLegacyDownload = await fetch(`${baseUrl}/${largeBody.id}`);
  assert.equal(largeLegacyDownload.status, 413);
  assert.equal((await largeLegacyDownload.json()).code, 'GZIP_DOWNLOAD_REQUIRED');
  const largeGzipDownload = await fetch(`${baseUrl}/${largeBody.id}/content`);
  assert.equal(largeGzipDownload.status, 200);
  assert.equal(gunzipSync(Buffer.from(await largeGzipDownload.arrayBuffer())).length > 20 * 1024 * 1024, true);

  const slowBoundary = `save-regression-${Date.now()}`;
  const slowRequest = fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${slowBoundary}` },
    body: slowMultipartBody(slowBoundary, { slot_name: 'slow' }, encodedTimeline(timeline('slow'))),
    duplex: 'half'
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const overlapping = await multipartRequest(baseUrl, 'POST', { slot_name: 'overlap' }, encodedTimeline(timeline('overlap')));
  assert.equal(overlapping.status, 429);
  assert.equal((await overlapping.json()).code, 'SAVE_UPLOAD_IN_PROGRESS');
  assert.equal(overlapping.headers.get('retry-after'), '5');
  const overlappingLegacy = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{malformed-json'
  });
  assert.equal(overlappingLegacy.status, 429, 'legacy JSON must be rejected before body parsing');
  assert.equal((await overlappingLegacy.json()).code, 'SAVE_UPLOAD_IN_PROGRESS');
  const slowResponse = await slowRequest;
  assert.equal(slowResponse.status, 201);
  createdIds.push((await slowResponse.json()).id);

  for (const id of createdIds) {
    const deleted = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
  }
  assert.deepEqual(await (await fetch(baseUrl)).json(), []);
  assert.equal((await fs.readdir(path.join(dataDir, 'saves'))).filter((name) => name.endsWith('.bin')).length, 0);
} finally {
  child.kill();
  if (child.exitCode == null) await once(child, 'exit');
}

assert.equal(stderr.includes('UnhandledPromiseRejection'), false);
assert.equal(stderr.includes('uncaughtException'), false);
console.log('cloud save stream regression passed');
} finally {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  await fs.rm(dataDir, { recursive: true, force: true });
}
