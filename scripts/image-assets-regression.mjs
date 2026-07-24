import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto, { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import jwt from 'jsonwebtoken';

import {
  ImageAssetRepository,
  ImageAssetRepositoryError,
  isImageAssetId
} from '../server/db/image-asset-repository.js';
import {
  ImageValidationError,
  inspectImageFile
} from '../server/image/image-validation.js';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMAGE_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxAssets: 20,
  maxOriginalBytes: 256 * 1024,
  maxThumbnailBytes: 64 * 1024,
  maxMetadataBytes: 16 * 1024,
  maxPixels: 16_000_000,
  maxSide: 8192,
  activeReferenceTtlMs: 60 * 60 * 1000,
  maxSelections: 5000,
  maxSelectionsPerResponse: 500
});

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(new Error(`${name}: ${error?.message || error}`, { cause: error }));
    console.error(`FAIL ${name}: ${error?.stack || error}`);
  }
}

async function withTempDir(prefix, fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function pngBytes(width = 1, height = 1, padding = 0) {
  const bytes = Buffer.alloc(24 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpegBytes(width = 1, height = 1) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x07,
    0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff
  ]);
}

function jpegWithOversizedHeader(minimumHeaderBytes = 1024 * 1024) {
  const chunks = [Buffer.from([0xff, 0xd8])];
  let size = 2;
  while (size <= minimumHeaderBytes) {
    const segment = Buffer.alloc(2 + 0xffff);
    segment[0] = 0xff;
    segment[1] = 0xe1;
    segment.writeUInt16BE(0xffff, 2);
    chunks.push(segment);
    size += segment.length;
  }
  chunks.push(jpegBytes(16, 9).subarray(2));
  return Buffer.concat(chunks);
}

function webpBytes(width = 1, height = 1) {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(22, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes[24] = encodedWidth & 0xff;
  bytes[25] = (encodedWidth >>> 8) & 0xff;
  bytes[26] = (encodedWidth >>> 16) & 0xff;
  bytes[27] = encodedHeight & 0xff;
  bytes[28] = (encodedHeight >>> 8) & 0xff;
  bytes[29] = (encodedHeight >>> 16) & 0xff;
  return bytes;
}

async function writeAndInspect(directory, name, bytes, mimeType, limits = IMAGE_LIMITS) {
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, bytes);
  return inspectImageFile(filePath, mimeType, {
    maxBytes: limits.maxOriginalBytes,
    maxPixels: limits.maxPixels,
    maxSide: limits.maxSide
  });
}

async function commitFixture(repository, userId, options = {}) {
  const originalBytes = options.originalBytes || pngBytes(4, 3, options.padding || 0);
  const thumbnailBytes = options.thumbnailBytes || pngBytes(2, 2);
  const staging = await repository.createStagingArea(userId);
  await Promise.all([
    fs.writeFile(staging.originalPath, originalBytes),
    fs.writeFile(staging.thumbnailPath, thumbnailBytes)
  ]);

  try {
    return await repository.commitUpload(userId, {
      stagingToken: staging.token,
      metadata: {
        local_asset_id: options.id || randomUUID(),
        purpose: options.purpose || 'turn',
        campaign_id: options.campaignId || 'campaign-regression',
        active_job_referenced: options.activeJobReferenced === true,
        ...(options.turnNodeId ? { turn_node_id: options.turnNodeId } : {}),
        ...(options.nodeId ? { node_id: options.nodeId } : {}),
        ...(options.subjectId ? { subject_id: options.subjectId } : {})
      },
      autoEvict: options.autoEvict === true,
      original: {
        mimeType: 'image/png',
        extension: 'png',
        width: 4,
        height: 3,
        sizeBytes: originalBytes.length
      },
      thumbnail: {
        mimeType: 'image/png',
        extension: 'png',
        width: 2,
        height: 2,
        sizeBytes: thumbnailBytes.length
      }
    });
  } catch (error) {
    await repository.cleanupStagingArea(userId, staging.token);
    throw error;
  }
}

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForApi(baseUrl, token, child, stderr) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode != null) {
      throw new Error(`image asset test server exited early (${child.exitCode}): ${stderr()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/image-assets/quota`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`image asset test server did not become ready: ${stderr()}`);
}

async function expectJson(response, status, code = undefined) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  if (code !== undefined) assert.equal(body.code, code, JSON.stringify(body));
  return body;
}

async function runAuthenticatedApiProbe() {
  await withTempDir('naruto-image-api-', async (dataDir) => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const jwtSecret = `image-regression-${randomUUID()}`;
    const firstUserId = 'image-owner-a';
    const secondUserId = 'image-owner-b';
    const now = new Date().toISOString();
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify({
      [firstUserId]: {
        id: firstUserId,
        username: 'owner-a',
        discriminator: '0',
        avatar: '',
        global_name: 'Owner A',
        created_at: now,
        last_login: now
      },
      [secondUserId]: {
        id: secondUserId,
        username: 'owner-b',
        discriminator: '0',
        avatar: '',
        global_name: 'Owner B',
        created_at: now,
        last_login: now
      }
    }, null, 2));

    const firstToken = jwt.sign({ id: firstUserId }, jwtSecret, { expiresIn: '5m' });
    const secondToken = jwt.sign({ id: secondUserId }, jwtSecret, { expiresIn: '5m' });
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'development',
        AUTH_BYPASS: 'false',
        JWT_SECRET: jwtSecret,
        TRUST_PROXY: '',
        DATA_DIR: dataDir,
        IMAGE_ASSET_QUOTA_MB: '1',
        IMAGE_ASSET_MAX_COUNT: '20',
        IMAGE_ASSET_MAX_ORIGINAL_MB: '1',
        IMAGE_ASSET_MAX_THUMBNAIL_KB: '64'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.resume();

    try {
      await waitForApi(baseUrl, firstToken, child, () => stderr);

      const unauthenticated = await fetch(`${baseUrl}/api/image-assets/quota`);
      assert.equal(unauthenticated.status, 401);

      const crossOrigin = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firstToken}`,
          'Content-Type': 'application/json',
          Origin: 'https://attacker.invalid'
        },
        body: JSON.stringify({ ids: [] })
      });
      await expectJson(crossOrigin, 403, 'CSRF_REJECTED');

      const sameSite = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firstToken}`,
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'same-site'
        },
        body: JSON.stringify({ ids: [] })
      });
      await expectJson(sameSite, 403, 'CSRF_REJECTED');

      const cookieWithoutOriginProof = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Cookie: `naruto_token=${firstToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [] })
      });
      await expectJson(cookieWithoutOriginProof, 403, 'CSRF_REJECTED');

      const cookieWithDecoyBearer = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Cookie: `naruto_token=${firstToken}`,
          Authorization: 'Bearer decoy-that-is-not-the-authenticated-credential',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [] })
      });
      await expectJson(cookieWithDecoyBearer, 403, 'CSRF_REJECTED');

      const sameOriginCookie = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Cookie: `naruto_token=${firstToken}`,
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'same-origin',
          Origin: baseUrl
        },
        body: JSON.stringify({ ids: [] })
      });
      const sameOriginBody = await expectJson(sameOriginCookie, 200);
      assert.deepEqual(sameOriginBody, { assets: [], missing: [] });

      const assetId = randomUUID();
      const original = pngBytes(7, 5, 19);
      const thumbnail = pngBytes(3, 2);
      const form = new FormData();
      form.append('original', new Blob([original], { type: 'image/png' }), 'original.png');
      form.append('thumbnail', new Blob([thumbnail], { type: 'image/png' }), 'thumbnail.png');
      form.append('metadata', JSON.stringify({
        local_asset_id: assetId,
        campaign_id: 'api-campaign',
        turn_node_id: 'turn-1',
        purpose: 'turn'
      }));

      const upload = await fetch(`${baseUrl}/api/image-assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${firstToken}` },
        body: form
      });
      const uploadBody = await expectJson(upload, 201);
      assert.equal(uploadBody.asset.id, assetId);
      assert.equal(uploadBody.asset.width, 7);
      assert.equal(uploadBody.asset.height, 5);

      const ownerResolve = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${firstToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [assetId, assetId] })
      });
      const ownerResolved = await expectJson(ownerResolve, 200);
      assert.deepEqual(ownerResolved.assets.map((asset) => asset.id), [assetId]);
      assert.deepEqual(ownerResolved.missing, []);

      const mismatchedSelection = await fetch(`${baseUrl}/api/image-assets/selection`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${firstToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: { kind: 'turn', nodeId: 'another-turn' },
          asset_id: assetId,
          expected_revision: 0
        })
      });
      await expectJson(mismatchedSelection, 409, 'ASSET_TARGET_MISMATCH');

      const otherResolve = await fetch(`${baseUrl}/api/image-assets/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secondToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [assetId] })
      });
      const otherResolved = await expectJson(otherResolve, 200);
      assert.deepEqual(otherResolved, { assets: [], missing: [assetId] });

      const ownerContent = await fetch(`${baseUrl}/api/image-assets/${assetId}/content`, {
        headers: { Authorization: `Bearer ${firstToken}` }
      });
      assert.equal(ownerContent.status, 200);
      assert.equal(ownerContent.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await ownerContent.arrayBuffer()), original);

      const otherContent = await fetch(`${baseUrl}/api/image-assets/${assetId}/content`, {
        headers: { Authorization: `Bearer ${secondToken}` }
      });
      await expectJson(otherContent, 404, 'ASSET_NOT_FOUND');

      const traversal = await fetch(`${baseUrl}/api/image-assets/${encodeURIComponent('../../users.json')}/content`, {
        headers: { Authorization: `Bearer ${firstToken}` }
      });
      await expectJson(traversal, 400, 'INVALID_REQUEST');
    } finally {
      child.kill();
      if (child.exitCode == null) await once(child, 'exit');
    }

    assert.doesNotMatch(stderr, new RegExp(firstToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(stderr, new RegExp(secondToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

await check('PNG, JPEG, and WebP magic bytes expose their real MIME and dimensions', async () => {
  await withTempDir('naruto-image-validation-', async (directory) => {
    const [png, jpeg, webp] = await Promise.all([
      writeAndInspect(directory, 'valid.png', pngBytes(320, 180), 'image/png'),
      writeAndInspect(directory, 'valid.jpg', jpegBytes(640, 360), 'image/jpeg'),
      writeAndInspect(directory, 'valid.webp', webpBytes(1024, 512), 'image/webp')
    ]);
    assert.deepEqual({ mime: png.mimeType, width: png.width, height: png.height, ext: png.extension }, {
      mime: 'image/png', width: 320, height: 180, ext: 'png'
    });
    assert.deepEqual({ mime: jpeg.mimeType, width: jpeg.width, height: jpeg.height, ext: jpeg.extension }, {
      mime: 'image/jpeg', width: 640, height: 360, ext: 'jpg'
    });
    assert.deepEqual({ mime: webp.mimeType, width: webp.width, height: webp.height, ext: webp.extension }, {
      mime: 'image/webp', width: 1024, height: 512, ext: 'webp'
    });
  });
});

await check('image validation rejects spoofed MIME, unknown magic, and excessive dimensions', async () => {
  await withTempDir('naruto-image-rejections-', async (directory) => {
    const spoofed = path.join(directory, 'spoofed.jpg');
    const unknown = path.join(directory, 'unknown.png');
    const oversized = path.join(directory, 'oversized.png');
    const oversizedJpegHeader = path.join(directory, 'oversized-header.jpg');
    await Promise.all([
      fs.writeFile(spoofed, pngBytes(1, 1)),
      fs.writeFile(unknown, Buffer.from('not-an-image')),
      fs.writeFile(oversized, pngBytes(11, 2)),
      fs.writeFile(oversizedJpegHeader, jpegWithOversizedHeader())
    ]);

    await assert.rejects(
      inspectImageFile(spoofed, 'image/jpeg', { maxBytes: 100, maxPixels: 100, maxSide: 20 }),
      (error) => error instanceof ImageValidationError && error.code === 'MIME_MISMATCH' && error.status === 415
    );
    await assert.rejects(
      inspectImageFile(unknown, 'image/png', { maxBytes: 100, maxPixels: 100, maxSide: 20 }),
      (error) => error instanceof ImageValidationError && error.code === 'UNSUPPORTED_IMAGE_TYPE' && error.status === 415
    );
    await assert.rejects(
      inspectImageFile(oversized, 'image/png', { maxBytes: 100, maxPixels: 100, maxSide: 10 }),
      (error) => error instanceof ImageValidationError && error.code === 'IMAGE_DIMENSIONS_EXCEEDED'
    );
    await assert.rejects(
      inspectImageFile(oversizedJpegHeader, 'image/jpeg', {
        maxBytes: 2 * 1024 * 1024,
        maxPixels: 1000,
        maxSide: 100
      }),
      (error) => error instanceof ImageValidationError && error.code === 'JPEG_HEADER_TOO_LARGE'
    );
  });
});

await check('concurrent uploads cannot oversubscribe one account quota', async () => {
  await withTempDir('naruto-image-quota-', async (directory) => {
    const repository = new ImageAssetRepository(directory, { ...IMAGE_LIMITS, maxAssets: 1 });
    await repository.init();
    const userId = 'quota-owner';
    const settled = await Promise.allSettled([
      commitFixture(repository, userId, { id: randomUUID() }),
      commitFixture(repository, userId, { id: randomUUID() })
    ]);
    const fulfilled = settled.filter((item) => item.status === 'fulfilled');
    const rejected = settled.filter((item) => item.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof ImageAssetRepositoryError);
    assert.equal(rejected[0].reason.code, 'IMAGE_QUOTA_EXCEEDED');
    const quota = await repository.quota(userId);
    const gallery = await repository.list(userId);
    assert.equal(quota.asset_count, 1);
    assert.equal(gallery.assets.length, 1);
  });
});

await check('automatic eviction preserves selected, protected, and active-job assets', async () => {
  await withTempDir('naruto-image-eviction-', async (directory) => {
    const repository = new ImageAssetRepository(directory, { ...IMAGE_LIMITS, maxAssets: 4 });
    await repository.init();
    const userId = 'eviction-owner';
    const protectedAsset = (await commitFixture(repository, userId, { turnNodeId: 'selected-turn' })).asset;
    await repository.patch(userId, protectedAsset.id, { protected: true });
    const selectedAsset = (await commitFixture(repository, userId, { turnNodeId: 'selected-turn' })).asset;
    await repository.setSelection(userId, {
      target: { kind: 'turn', nodeId: 'selected-turn' },
      assetId: selectedAsset.id,
      expectedRevision: 0
    });
    const initialSelectionGallery = await repository.list(userId);
    assert.deepEqual(initialSelectionGallery.selections.map(({ updated_at, ...selection }) => selection), [{
      target: { kind: 'turn', nodeId: 'selected-turn' },
      asset_id: selectedAsset.id,
      revision: 1
    }]);
    assert.match(initialSelectionGallery.selections[0].updated_at, /^\d{4}-\d{2}-\d{2}T/);
    const activeAsset = (await commitFixture(repository, userId, { activeJobReferenced: true })).asset;
    const evictableAsset = (await commitFixture(repository, userId)).asset;

    const replacement = await commitFixture(repository, userId, { autoEvict: true });
    assert.deepEqual(replacement.evicted_ids, [evictableAsset.id]);
    const resolved = await repository.resolve(userId, [
      protectedAsset.id,
      selectedAsset.id,
      activeAsset.id,
      evictableAsset.id,
      replacement.asset.id
    ]);
    assert.deepEqual(new Set(resolved.assets.map((asset) => asset.id)), new Set([
      protectedAsset.id,
      selectedAsset.id,
      activeAsset.id,
      replacement.asset.id
    ]));
    assert.deepEqual(resolved.missing, [evictableAsset.id]);

    await repository.patch(userId, replacement.asset.id, { protected: true });
    await assert.rejects(
      commitFixture(repository, userId, { autoEvict: true }),
      (error) => error instanceof ImageAssetRepositoryError && error.code === 'NO_EVICTABLE_ASSETS'
    );

    const removedSelection = await repository.remove(userId, selectedAsset.id);
    assert.deepEqual(removedSelection.removed_selections, [{ kind: 'turn', nodeId: 'selected-turn' }]);
    const tombstoneGallery = await repository.list(userId);
    assert.deepEqual(tombstoneGallery.selections.map(({ updated_at, ...selection }) => selection), [{
      target: { kind: 'turn', nodeId: 'selected-turn' },
      asset_id: null,
      revision: 2
    }]);
    assert.match(tombstoneGallery.selections[0].updated_at, /^\d{4}-\d{2}-\d{2}T/);
    await assert.rejects(
      repository.setSelection(userId, {
        target: { kind: 'turn', nodeId: 'selected-turn' },
        assetId: protectedAsset.id,
        expectedRevision: 1
      }),
      (error) => error instanceof ImageAssetRepositoryError
        && error.code === 'SELECTION_CONFLICT'
        && error.details?.revision === 2
        && error.details?.asset_id === null
    );
    const reboundSelection = await repository.setSelection(userId, {
      target: { kind: 'turn', nodeId: 'selected-turn' },
      assetId: protectedAsset.id,
      expectedRevision: 2
    });
    assert.equal(reboundSelection.revision, 3);
    assert.equal(reboundSelection.asset_id, protectedAsset.id);

    await assert.rejects(
      repository.remove(userId, protectedAsset.id),
      (error) => error instanceof ImageAssetRepositoryError && error.code === 'ASSET_PROTECTED'
    );
    await assert.rejects(
      repository.remove(userId, activeAsset.id),
      (error) => error instanceof ImageAssetRepositoryError && error.code === 'ASSET_IN_USE'
    );

    const shortLeaseRepository = new ImageAssetRepository(path.join(directory, 'short-lease'), {
      ...IMAGE_LIMITS,
      maxAssets: 1,
      activeReferenceTtlMs: 25
    });
    await shortLeaseRepository.init();
    const shortLeaseOwner = 'short-lease-owner';
    const expiringDeleteAsset = (await commitFixture(shortLeaseRepository, shortLeaseOwner, {
      activeJobReferenced: true
    })).asset;
    assert.equal(expiringDeleteAsset.active_job_referenced, true);
    assert.match(expiringDeleteAsset.active_job_referenced_at, /^\d{4}-\d{2}-\d{2}T/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const refreshedLease = await shortLeaseRepository.patch(shortLeaseOwner, expiringDeleteAsset.id, {
      activeJobReferenced: true
    });
    assert.equal(refreshedLease.active_job_referenced, true);
    assert.ok(Date.parse(refreshedLease.active_job_referenced_at)
      > Date.parse(expiringDeleteAsset.active_job_referenced_at));
    await assert.rejects(
      shortLeaseRepository.remove(shortLeaseOwner, expiringDeleteAsset.id),
      (error) => error instanceof ImageAssetRepositoryError && error.code === 'ASSET_IN_USE'
    );
    await new Promise((resolve) => setTimeout(resolve, 75));
    const expired = await shortLeaseRepository.resolve(shortLeaseOwner, [expiringDeleteAsset.id]);
    assert.equal(expired.assets[0].active_job_referenced, false);
    assert.equal(expired.assets[0].active_job_referenced_at, refreshedLease.active_job_referenced_at);
    await shortLeaseRepository.remove(shortLeaseOwner, expiringDeleteAsset.id);

    const explicitlyReleasedAsset = (await commitFixture(shortLeaseRepository, shortLeaseOwner, {
      activeJobReferenced: true
    })).asset;
    const releasedLease = await shortLeaseRepository.patch(shortLeaseOwner, explicitlyReleasedAsset.id, {
      activeJobReferenced: false
    });
    assert.equal(releasedLease.active_job_referenced, false);
    assert.equal(releasedLease.active_job_referenced_at, null);
    await shortLeaseRepository.remove(shortLeaseOwner, explicitlyReleasedAsset.id);

    const expiringEvictionAsset = (await commitFixture(shortLeaseRepository, shortLeaseOwner, {
      activeJobReferenced: true
    })).asset;
    await new Promise((resolve) => setTimeout(resolve, 75));
    const leaseReplacement = await commitFixture(shortLeaseRepository, shortLeaseOwner, { autoEvict: true });
    assert.deepEqual(leaseReplacement.evicted_ids, [expiringEvictionAsset.id]);
  });
});

await check('asset resolution and binary paths remain isolated by account', async () => {
  await withTempDir('naruto-image-ownership-', async (directory) => {
    const repository = new ImageAssetRepository(directory, IMAGE_LIMITS);
    await repository.init();
    const ownerId = 'owner/../../private';
    const otherId = 'other-account';
    const asset = (await commitFixture(repository, ownerId, { turnNodeId: 'owned-turn' })).asset;
    const portraitAsset = (await commitFixture(repository, ownerId, {
      purpose: 'portrait',
      subjectId: 'owned-subject'
    })).asset;

    const owner = await repository.resolve(ownerId, [asset.id]);
    const other = await repository.resolve(otherId, [asset.id]);
    assert.deepEqual(owner.assets.map((item) => item.id), [asset.id]);
    assert.deepEqual(owner.missing, []);
    assert.deepEqual(other, { assets: [], missing: [asset.id] });
    assert.ok(await repository.getBinary(ownerId, asset.id, 'content'));
    assert.equal(await repository.getBinary(otherId, asset.id, 'content'), null);
    assert.equal(isImageAssetId('../../users.json'), false);

    await assert.rejects(
      repository.setSelection(ownerId, {
        target: { kind: 'turn', nodeId: 'other-turn' },
        assetId: asset.id,
        expectedRevision: 0
      }),
      (error) => error instanceof ImageAssetRepositoryError
        && error.status === 409
        && error.code === 'ASSET_TARGET_MISMATCH'
    );
    await assert.rejects(
      repository.reconcileSelections(ownerId, [{
        target: { kind: 'portrait', subjectId: 'other-subject' },
        assetId: portraitAsset.id,
        expectedRevision: 0
      }]),
      (error) => error instanceof ImageAssetRepositoryError
        && error.status === 409
        && error.code === 'ASSET_TARGET_MISMATCH'
    );
    const matchingPortrait = await repository.reconcileSelections(ownerId, [{
      target: { kind: 'portrait', subjectId: 'owned-subject' },
      assetId: portraitAsset.id,
      expectedRevision: 0
    }]);
    assert.equal(matchingPortrait.applied[0].asset_id, portraitAsset.id);
    const detached = await repository.reconcileSelections(ownerId, [{
      target: { kind: 'turn', nodeId: 'detached-turn' },
      assetId: null,
      expectedRevision: 0
    }]);
    assert.equal(detached.applied[0].asset_id, null);

    const accountDirectories = await fs.readdir(path.join(directory, 'users'));
    assert.ok(accountDirectories.includes(crypto.createHash('sha256').update(ownerId).digest('hex')));
    assert.ok(accountDirectories.includes(crypto.createHash('sha256').update(otherId).digest('hex')));
    assert.equal(accountDirectories.some((name) => name.includes('owner') || name.includes('other')), false);

    const boundedRepository = new ImageAssetRepository(path.join(directory, 'bounded-selections'), {
      ...IMAGE_LIMITS,
      maxSelections: 2,
      maxSelectionsPerResponse: 1
    });
    await boundedRepository.init();
    for (const nodeId of ['bounded-1', 'bounded-2']) {
      await boundedRepository.setSelection('bounded-owner', {
        target: { kind: 'turn', nodeId }, assetId: null, expectedRevision: 0
      });
    }
    await assert.rejects(
      boundedRepository.setSelection('bounded-owner', {
        target: { kind: 'turn', nodeId: 'bounded-3' }, assetId: null, expectedRevision: 0
      }),
      (error) => error instanceof ImageAssetRepositoryError && error.code === 'SELECTION_LIMIT_EXCEEDED'
    );
    const boundedList = await boundedRepository.list('bounded-owner');
    assert.equal(boundedList.selection_total, 2);
    assert.equal(boundedList.selections.length, 1);
    assert.equal(boundedList.selections_truncated, true);
    const exactSelection = await boundedRepository.list('bounded-owner', { turnNodeId: 'bounded-1' });
    assert.deepEqual(exactSelection.selections.map((selection) => selection.target.nodeId), ['bounded-1']);
    assert.equal(exactSelection.selections_truncated, false);
    await assert.rejects(
      boundedRepository.reconcileSelections('bounded-owner', Array.from({ length: 501 }, (_, index) => ({
        target: { kind: 'turn', nodeId: `batch-${index}` }, assetId: null, expectedRevision: 0
      }))),
      (error) => error instanceof ImageAssetRepositoryError && error.code === 'SELECTION_BATCH_TOO_LARGE'
    );

    const recoveryDirectory = path.join(directory, 'selection-recovery');
    const beforeCrash = new ImageAssetRepository(recoveryDirectory, IMAGE_LIMITS);
    await beforeCrash.init();
    const recoveryAsset = (await commitFixture(beforeCrash, 'recovery-owner', {
      turnNodeId: 'recovery-turn'
    })).asset;
    await beforeCrash.setSelection('recovery-owner', {
      target: { kind: 'turn', nodeId: 'recovery-turn' },
      assetId: recoveryAsset.id,
      expectedRevision: 0
    });
    const recoveryBinary = await beforeCrash.getBinary('recovery-owner', recoveryAsset.id, 'content');
    await fs.rm(path.dirname(recoveryBinary.filePath), { recursive: true, force: true });
    const afterCrash = new ImageAssetRepository(recoveryDirectory, IMAGE_LIMITS);
    await afterCrash.init();
    const recoveredList = await afterCrash.list('recovery-owner', { turnNodeId: 'recovery-turn' });
    assert.equal(recoveredList.selections[0].asset_id, null);
    assert.equal(recoveredList.selections[0].revision, 2);
    await assert.rejects(
      afterCrash.setSelection('recovery-owner', {
        target: { kind: 'turn', nodeId: 'recovery-turn' }, assetId: null, expectedRevision: 1
      }),
      (error) => error instanceof ImageAssetRepositoryError
        && error.code === 'SELECTION_CONFLICT'
        && error.details?.revision === 2
    );
  });
});

await check('authenticated image API enforces CSRF, ownership, and safe asset IDs', runAuthenticatedApiProbe);

if (failures.length) {
  throw new AggregateError(failures, `${failures.length} image asset regression test(s) failed`);
}

console.log(`\n${passed} image asset regression tests passed.`);
