// @ts-check
import { Router, json } from 'express';
import { config } from '../config.js';
import * as db from '../db/index.js';
import { isImageAssetId, ImageAssetRepositoryError } from '../db/image-asset-repository.js';
import { requireAuth } from '../middleware/auth.js';
import { inspectImageFile, ImageValidationError } from '../image/image-validation.js';
import { parseImageAssetMultipart, MultipartUploadError } from '../image/multipart-image-upload.js';

const router = Router();
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function apiError(message, status = 400, code = 'INVALID_REQUEST', details = undefined) {
  return new ImageAssetRepositoryError(message, status, code, details);
}

function requireSameOriginMutation(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    return res.status(403).json({ error: '拒绝跨站图片图库请求', code: 'CSRF_REJECTED' });
  }

  const origin = req.get('origin');
  if (origin) {
    try {
      const expectedOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;
      if (new URL(origin).origin !== expectedOrigin) {
        return res.status(403).json({ error: '请求来源与当前站点不一致', code: 'CSRF_REJECTED' });
      }
    } catch {
      return res.status(403).json({ error: '请求来源无效', code: 'CSRF_REJECTED' });
    }
  } else if (req.authSource === 'cookie' && fetchSite !== 'same-origin') {
    return res.status(403).json({ error: '缺少同源请求证明', code: 'CSRF_REJECTED' });
  }
  next();
}

function parseMetadata(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw apiError('metadata 不是有效的 JSON', 400, 'INVALID_METADATA');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw apiError('metadata 必须是 JSON 对象', 400, 'INVALID_METADATA');
  }

  const stack = [{ value, depth: 0 }];
  let keyCount = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > 12) throw apiError('metadata 嵌套层级过深', 400, 'INVALID_METADATA');
    if (Array.isArray(current.value)) {
      if (current.value.length > 256) throw apiError('metadata 数组过长', 400, 'INVALID_METADATA');
      for (const child of current.value) {
        if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
        else if (typeof child === 'string' && child.length > 16384) throw apiError('metadata 文本字段过长', 400, 'INVALID_METADATA');
        else if (typeof child === 'number' && !Number.isFinite(child)) throw apiError('metadata 数字无效', 400, 'INVALID_METADATA');
      }
      continue;
    }
    for (const [key, child] of Object.entries(current.value)) {
      keyCount++;
      if (keyCount > 512 || key.length > 128 || /[\x00-\x1f]/.test(key) || DANGEROUS_METADATA_KEYS.has(key)) {
        throw apiError('metadata 包含不安全或过多的字段', 400, 'INVALID_METADATA');
      }
      if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
      else if (typeof child === 'string' && child.length > 16384) throw apiError('metadata 文本字段过长', 400, 'INVALID_METADATA');
      else if (typeof child === 'number' && !Number.isFinite(child)) throw apiError('metadata 数字无效', 400, 'INVALID_METADATA');
    }
  }

  if (value.active_job_referenced !== undefined && typeof value.active_job_referenced !== 'boolean') {
    throw apiError('metadata.active_job_referenced 必须是布尔值', 400, 'INVALID_METADATA');
  }
  return value;
}

function validateTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw apiError('target 无效');
  }
  const id = target.kind === 'turn' ? target.nodeId : target.kind === 'portrait' ? target.subjectId : null;
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || /[\x00-\x1f]/.test(id)) {
    throw apiError('target 必须是有效的 turn/nodeId 或 portrait/subjectId');
  }
  return target.kind === 'turn'
    ? { kind: 'turn', nodeId: id }
    : { kind: 'portrait', subjectId: id };
}

function validateRevision(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw apiError('expected_revision 必须是非负整数');
  return value;
}

function validateAssetId(value, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (!isImageAssetId(value)) throw apiError('图片资产 ID 无效');
  return value;
}

function queryText(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 128 || /[\x00-\x1f]/.test(value)) {
    throw apiError(`${field} 查询参数无效`);
  }
  return value;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.use(requireAuth);
router.use(requireSameOriginMutation);
// Authentication and CSRF checks happen before any request body is parsed.
router.use(json({ limit: '256kb' }));

router.get('/quota', asyncRoute(async (req, res) => {
  res.json(await db.getImageAssetQuota(req.user.id));
}));

router.post('/resolve', asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.ids) || req.body.ids.length > 500) {
    throw apiError('ids 必须是最多 500 项的数组');
  }
  const ids = req.body.ids.map((id) => validateAssetId(id));
  res.json(await db.resolveImageAssets(req.user.id, [...new Set(ids)]));
}));

router.put('/selection', asyncRoute(async (req, res) => {
  const assetId = validateAssetId(req.body?.asset_id ?? req.body?.assetId ?? null, { nullable: true });
  const selection = await db.setImageAssetSelection(req.user.id, {
    target: validateTarget(req.body?.target),
    assetId,
    expectedRevision: validateRevision(req.body?.expected_revision ?? req.body?.expectedRevision)
  });
  res.json({ selection });
}));

router.put('/selections/reconcile', asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body?.selections) || req.body.selections.length > 500) {
    throw apiError('selections 必须是最多 500 项的数组');
  }
  const items = req.body.selections.map((item) => ({
    target: validateTarget(item?.target),
    assetId: validateAssetId(item?.asset_id ?? item?.assetId ?? null, { nullable: true }),
    expectedRevision: validateRevision(item?.expected_revision ?? item?.expectedRevision)
  }));
  res.json(await db.reconcileImageAssetSelections(req.user.id, items));
}));

router.get('/', asyncRoute(async (req, res) => {
  const parsedLimit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  if (parsedLimit !== undefined && (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500)) {
    throw apiError('limit 查询参数无效');
  }
  const result = await db.listImageAssets(req.user.id, {
    campaignId: queryText(req.query.campaign_id, 'campaign_id'),
    turnNodeId: queryText(req.query.turn_node_id, 'turn_node_id'),
    subjectId: queryText(req.query.subject_id, 'subject_id'),
    purpose: queryText(req.query.purpose, 'purpose'),
    cursor: queryText(req.query.cursor, 'cursor'),
    limit: parsedLimit
  });
  res.json(result);
}));

router.post('/', asyncRoute(async (req, res) => {
  const staging = await db.createImageAssetStaging(req.user.id);
  try {
    const multipart = await parseImageAssetMultipart(req, staging, config.imageAssets);
    const metadata = parseMetadata(multipart.metadataText);
    let autoEvict = metadata.auto_evict === true;
    if (metadata.auto_evict !== undefined && typeof metadata.auto_evict !== 'boolean') {
      throw apiError('metadata.auto_evict 必须是布尔值', 400, 'INVALID_METADATA');
    }
    delete metadata.auto_evict;
    if (multipart.autoEvictText) {
      if (!['true', 'false'].includes(multipart.autoEvictText)) throw apiError('auto_evict 必须是布尔值');
      autoEvict = multipart.autoEvictText === 'true';
    }

    const [original, thumbnail] = await Promise.all([
      inspectImageFile(staging.originalPath, multipart.originalMime, {
        maxBytes: config.imageAssets.maxOriginalBytes,
        maxPixels: config.imageAssets.maxPixels,
        maxSide: config.imageAssets.maxSide
      }),
      inspectImageFile(staging.thumbnailPath, multipart.thumbnailMime, {
        maxBytes: config.imageAssets.maxThumbnailBytes,
        maxPixels: config.imageAssets.maxPixels,
        maxSide: config.imageAssets.maxSide
      })
    ]);
    const result = await db.commitImageAssetUpload(req.user.id, {
      stagingToken: staging.token,
      metadata,
      autoEvict,
      original,
      thumbnail
    });
    res.status(201).json(result);
  } finally {
    await db.cleanupImageAssetStaging(req.user.id, staging.token).catch(() => {});
  }
}));

async function sendBinary(req, res, variant) {
  const id = validateAssetId(req.params.id);
  const binary = await db.getImageAssetBinary(req.user.id, id, variant);
  if (!binary) throw apiError('图片资产不存在', 404, 'ASSET_NOT_FOUND');
  res.set({
    'Content-Type': binary.mimeType,
    'Content-Length': String(binary.sizeBytes),
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Vary': 'Cookie, Authorization'
  });
  await new Promise((resolve, reject) => {
    res.sendFile(binary.filePath, (error) => error ? reject(error) : resolve());
  });
}

router.get('/:id/content', asyncRoute((req, res) => sendBinary(req, res, 'content')));
router.get('/:id/thumbnail', asyncRoute((req, res) => sendBinary(req, res, 'thumbnail')));

router.patch('/:id', asyncRoute(async (req, res) => {
  const id = validateAssetId(req.params.id);
  const hasProtected = req.body?.protected !== undefined;
  const hasActiveReference = req.body?.active_job_referenced !== undefined;
  if (!hasProtected && !hasActiveReference) throw apiError('至少需要提供 protected 或 active_job_referenced');
  if (hasProtected && typeof req.body.protected !== 'boolean') throw apiError('protected 必须是布尔值');
  if (hasActiveReference && typeof req.body.active_job_referenced !== 'boolean') {
    throw apiError('active_job_referenced 必须是布尔值');
  }
  const asset = await db.patchImageAsset(req.user.id, id, {
    protected: hasProtected ? req.body.protected : undefined,
    activeJobReferenced: hasActiveReference ? req.body.active_job_referenced : undefined
  });
  res.json({ asset });
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  const result = await db.deleteImageAsset(req.user.id, validateAssetId(req.params.id));
  res.json(result);
}));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ImageAssetRepositoryError
    || error instanceof MultipartUploadError
    || error instanceof ImageValidationError) {
    const body = { error: error.message, code: error.code };
    if (error.details !== undefined) body.details = error.details;
    return res.status(error.status || 400).json(body);
  }
  console.error('[API IMAGE ASSETS]', error?.stack || error);
  return res.status(500).json({ error: '图片图库操作失败', code: 'IMAGE_ASSET_INTERNAL_ERROR' });
});

export default router;
