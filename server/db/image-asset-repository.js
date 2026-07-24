// @ts-check
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './json-store.js';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_ACTIVE_REFERENCE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_SELECTIONS = 5000;
const MAX_SELECTIONS_PER_RESPONSE = 500;
const MAX_RECONCILE_ITEMS = 500;

export class ImageAssetRepositoryError extends Error {
  /** @param {string} message @param {number} [status] @param {string} [code] @param {any} [details] */
  constructor(message, status = 400, code = 'IMAGE_ASSET_ERROR', details = undefined) {
    super(message);
    this.name = 'ImageAssetRepositoryError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function emptyIndex() {
  return { version: 1, assets: {}, selections: {} };
}

function normalizeIndex(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return emptyIndex();
  if (!doc.assets || typeof doc.assets !== 'object' || Array.isArray(doc.assets)) doc.assets = {};
  if (!doc.selections || typeof doc.selections !== 'object' || Array.isArray(doc.selections)) doc.selections = {};
  doc.version = 1;
  return doc;
}

function targetKey(target) {
  return target.kind === 'turn'
    ? `turn:${encodeURIComponent(target.nodeId)}`
    : `portrait:${encodeURIComponent(target.subjectId)}`;
}

function assertAssetMatchesTarget(asset, target) {
  const metadata = asset.metadata || {};
  const matches = target.kind === 'turn'
    ? metadata.turn_node_id === target.nodeId || metadata.node_id === target.nodeId
    : target.kind === 'portrait' && metadata.subject_id === target.subjectId;
  if (!matches) {
    throw new ImageAssetRepositoryError(
      '图片资产与选择目标不匹配',
      409,
      'ASSET_TARGET_MISMATCH',
      { asset_id: asset.id, target }
    );
  }
}

function isActiveJobReferenced(asset, ttlMs) {
  if (asset.active_job_referenced !== true) return false;
  const referencedAt = Date.parse(asset.active_job_referenced_at || '');
  return Number.isFinite(referencedAt) && referencedAt + ttlMs > Date.now();
}

/** @param {any} asset */
function publicAsset(asset, activeReferenceTtlMs) {
  return {
    id: asset.id,
    mime_type: asset.mime_type,
    width: asset.width,
    height: asset.height,
    size_bytes: asset.size_bytes,
    thumbnail_mime_type: asset.thumbnail_mime_type,
    thumbnail_width: asset.thumbnail_width,
    thumbnail_height: asset.thumbnail_height,
    thumbnail_size_bytes: asset.thumbnail_size_bytes,
    metadata: asset.metadata || {},
    protected: asset.protected === true,
    active_job_referenced: isActiveJobReferenced(asset, activeReferenceTtlMs),
    active_job_referenced_at: asset.active_job_referenced_at || null,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
    content_url: `/api/image-assets/${encodeURIComponent(asset.id)}/content`,
    thumbnail_url: `/api/image-assets/${encodeURIComponent(asset.id)}/thumbnail`
  };
}

/**
 * Per-account image gallery. Raw account IDs never appear in paths or indexes:
 * every account gets an independent SHA-256 directory and JsonStore.
 */
export class ImageAssetRepository {
  #rootDir;
  #usersDir;
  #limits;
  #contexts = new Map();
  #locks = new Map();

  /**
   * @param {string} rootDir
   * @param {{ maxBytes: number, maxAssets: number, maxOriginalBytes: number, maxThumbnailBytes: number, maxMetadataBytes: number, maxPixels: number, maxSide: number, activeReferenceTtlMs?: number, maxSelections?: number, maxSelectionsPerResponse?: number }} limits
   */
  constructor(rootDir, limits) {
    this.#rootDir = path.resolve(rootDir);
    this.#usersDir = path.join(this.#rootDir, 'users');
    const requestedTtl = Number(limits.activeReferenceTtlMs);
    const requestedMaxSelections = Number(limits.maxSelections);
    const requestedResponseLimit = Number(limits.maxSelectionsPerResponse);
    this.#limits = {
      ...limits,
      activeReferenceTtlMs: Number.isFinite(requestedTtl) && requestedTtl > 0
        ? requestedTtl
        : DEFAULT_ACTIVE_REFERENCE_TTL_MS,
      maxSelections: Number.isSafeInteger(requestedMaxSelections) && requestedMaxSelections > 0
        ? requestedMaxSelections
        : DEFAULT_MAX_SELECTIONS,
      maxSelectionsPerResponse: Number.isSafeInteger(requestedResponseLimit) && requestedResponseLimit > 0
        ? Math.min(requestedResponseLimit, MAX_SELECTIONS_PER_RESPONSE)
        : MAX_SELECTIONS_PER_RESPONSE
    };
  }

  async init() {
    await fs.mkdir(this.#usersDir, { recursive: true });
  }

  #userHash(userId) {
    return crypto.createHash('sha256').update(String(userId), 'utf8').digest('hex');
  }

  #child(base, name) {
    const resolvedBase = path.resolve(base);
    const resolved = path.resolve(resolvedBase, name);
    if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
      throw new ImageAssetRepositoryError('非法图片资产路径', 400, 'INVALID_ASSET_PATH');
    }
    return resolved;
  }

  async #getContext(userId) {
    const userHash = this.#userHash(userId);
    if (!this.#contexts.has(userHash)) {
      this.#contexts.set(userHash, this.#initializeContext(userHash));
    }
    return this.#contexts.get(userHash);
  }

  async #initializeContext(userHash) {
    const userDir = this.#child(this.#usersDir, userHash);
    const assetsDir = this.#child(userDir, 'assets');
    const stagingDir = this.#child(userDir, 'staging');
    const journalPath = this.#child(userDir, 'journal.json');
    await Promise.all([
      fs.mkdir(assetsDir, { recursive: true }),
      fs.mkdir(stagingDir, { recursive: true })
    ]);
    const index = new JsonStore(this.#child(userDir, 'index.json'), emptyIndex());
    await index.ensureExists();
    const context = { userHash, userDir, assetsDir, stagingDir, journalPath, index };
    await this.#recoverContext(context);
    return context;
  }

  async #recoverContext(context) {
    const onDisk = await fs.readdir(context.assetsDir, { withFileTypes: true }).catch(() => []);
    const diskIds = new Set(onDisk.filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name)).map((entry) => entry.name));
    const indexedIds = await context.index.update(async (raw) => {
      const doc = normalizeIndex(raw);
      let changed = false;
      for (const [id, asset] of Object.entries(doc.assets)) {
        const assetDir = this.#child(context.assetsDir, id);
        const originalPath = this.#child(assetDir, asset.original_file || 'missing');
        const thumbnailPath = this.#child(assetDir, asset.thumbnail_file || 'missing');
        const valid = ID_PATTERN.test(id)
          && await fs.access(originalPath).then(() => true, () => false)
          && await fs.access(thumbnailPath).then(() => true, () => false);
        if (!valid) {
          delete doc.assets[id];
          changed = true;
        }
      }
      for (const [key, selection] of Object.entries(doc.selections)) {
        if (selection.asset_id && !doc.assets[selection.asset_id]) {
          doc.selections[key] = {
            target: selection.target,
            asset_id: null,
            revision: Number(selection.revision || 0) + 1,
            updated_at: new Date().toISOString()
          };
          changed = true;
        }
      }
      return { persist: changed, result: new Set(Object.keys(doc.assets)) };
    });

    for (const id of diskIds) {
      if (!indexedIds.has(id)) await fs.rm(this.#child(context.assetsDir, id), { recursive: true, force: true });
    }
    const staged = await fs.readdir(context.stagingDir, { withFileTypes: true }).catch(() => []);
    for (const entry of staged) {
      if (entry.isDirectory() && ID_PATTERN.test(entry.name)) {
        await fs.rm(this.#child(context.stagingDir, entry.name), { recursive: true, force: true });
      }
    }
    await fs.rm(context.journalPath, { force: true });
  }

  async #withLock(userHash, task) {
    const previous = this.#locks.get(userHash) || Promise.resolve();
    const run = previous.then(task, task);
    this.#locks.set(userHash, run.then(() => undefined, () => undefined));
    return run;
  }

  async #writeJournal(context, journal) {
    const temporary = `${context.journalPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(journal), 'utf8');
    await fs.rename(temporary, context.journalPath);
  }

  async createStagingArea(userId) {
    const context = await this.#getContext(userId);
    const token = randomUUID();
    const dir = this.#child(context.stagingDir, token);
    await fs.mkdir(dir);
    return {
      token,
      dir,
      originalPath: this.#child(dir, 'original.upload'),
      thumbnailPath: this.#child(dir, 'thumbnail.upload')
    };
  }

  async cleanupStagingArea(userId, token) {
    if (!ID_PATTERN.test(String(token))) return;
    const context = await this.#getContext(userId);
    await fs.rm(this.#child(context.stagingDir, token), { recursive: true, force: true });
  }

  #quotaFromDoc(doc) {
    const assets = Object.values(doc.assets);
    const usedBytes = assets.reduce((sum, asset) => sum + Number(asset.size_bytes || 0) + Number(asset.thumbnail_size_bytes || 0), 0);
    return {
      used_bytes: usedBytes,
      max_bytes: this.#limits.maxBytes,
      remaining_bytes: Math.max(0, this.#limits.maxBytes - usedBytes),
      asset_count: assets.length,
      max_assets: this.#limits.maxAssets,
      selection_count: Object.keys(doc.selections).length,
      max_selections: this.#limits.maxSelections,
      auto_eviction_supported: true,
      default_auto_evict: false
    };
  }

  #assertSelectionCapacity(doc, key) {
    if (Object.prototype.hasOwnProperty.call(doc.selections, key)) return;
    if (Object.keys(doc.selections).length >= this.#limits.maxSelections) {
      throw new ImageAssetRepositoryError(
        '图片选择记录已达到帐户上限',
        507,
        'SELECTION_LIMIT_EXCEEDED',
        { selection_count: Object.keys(doc.selections).length, max_selections: this.#limits.maxSelections }
      );
    }
  }

  #evictionsFor(doc, addedBytes, autoEvict) {
    const quota = this.#quotaFromDoc(doc);
    let requiredBytes = Math.max(0, quota.used_bytes + addedBytes - quota.max_bytes);
    let requiredCount = Math.max(0, quota.asset_count + 1 - quota.max_assets);
    if (!requiredBytes && !requiredCount) return [];
    if (!autoEvict) {
      throw new ImageAssetRepositoryError('图片图库配额已满', 507, 'IMAGE_QUOTA_EXCEEDED', quota);
    }

    const selected = new Set(Object.values(doc.selections).map((entry) => entry.asset_id).filter(Boolean));
    const candidates = Object.values(doc.assets)
      .filter((asset) => !asset.protected
        && !isActiveJobReferenced(asset, this.#limits.activeReferenceTtlMs)
        && !selected.has(asset.id))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
    const evicted = [];
    for (const asset of candidates) {
      if (!requiredBytes && !requiredCount) break;
      evicted.push(asset);
      requiredBytes = Math.max(0, requiredBytes - Number(asset.size_bytes || 0) - Number(asset.thumbnail_size_bytes || 0));
      requiredCount = Math.max(0, requiredCount - 1);
    }
    if (requiredBytes || requiredCount) {
      throw new ImageAssetRepositoryError('图库配额不足，且没有可安全清理的未选中图片', 507, 'NO_EVICTABLE_ASSETS', quota);
    }
    return evicted;
  }

  /**
   * @param {string} userId
   * @param {{ stagingToken: string, metadata: Record<string, any>, autoEvict: boolean, original: any, thumbnail: any }} input
   */
  async commitUpload(userId, input) {
    const context = await this.#getContext(userId);
    if (!ID_PATTERN.test(input.stagingToken)) throw new ImageAssetRepositoryError('上传 staging 标识无效');
    return this.#withLock(context.userHash, async () => {
      const stagingDir = this.#child(context.stagingDir, input.stagingToken);
      const originalFile = `original.${input.original.extension}`;
      const thumbnailFile = `thumbnail.${input.thumbnail.extension}`;
      await fs.rename(this.#child(stagingDir, 'original.upload'), this.#child(stagingDir, originalFile));
      await fs.rename(this.#child(stagingDir, 'thumbnail.upload'), this.#child(stagingDir, thumbnailFile));

      const requestedId = String(input.metadata?.local_asset_id || '');
      const id = ID_PATTERN.test(requestedId) ? requestedId : randomUUID();
      const finalDir = this.#child(context.assetsDir, id);
      const now = new Date().toISOString();
      const asset = {
        id,
        mime_type: input.original.mimeType,
        width: input.original.width,
        height: input.original.height,
        size_bytes: input.original.sizeBytes,
        original_file: originalFile,
        thumbnail_mime_type: input.thumbnail.mimeType,
        thumbnail_width: input.thumbnail.width,
        thumbnail_height: input.thumbnail.height,
        thumbnail_size_bytes: input.thumbnail.sizeBytes,
        thumbnail_file: thumbnailFile,
        metadata: input.metadata,
        protected: false,
        active_job_referenced: input.metadata.active_job_referenced === true,
        active_job_referenced_at: input.metadata.active_job_referenced === true ? now : null,
        created_at: now,
        updated_at: now
      };
      /** @type {any[]} */
      let evicted = [];
      let moved = false;
      try {
        await context.index.update(async (raw) => {
          const doc = normalizeIndex(raw);
          if (doc.assets[id]) {
            throw new ImageAssetRepositoryError('图片资产 ID 已存在', 409, 'ASSET_ID_CONFLICT');
          }
          evicted = this.#evictionsFor(doc, asset.size_bytes + asset.thumbnail_size_bytes, input.autoEvict);
          await this.#writeJournal(context, { operation: 'upload', id, evicted: evicted.map((item) => item.id), at: now });
          await fs.rename(stagingDir, finalDir);
          moved = true;
          for (const oldAsset of evicted) delete doc.assets[oldAsset.id];
          doc.assets[id] = asset;
          return { persist: true };
        });
      } catch (error) {
        if (moved) {
          const persisted = await context.index.read().then((doc) => Boolean(doc?.assets?.[id]), () => false);
          if (!persisted) await fs.rm(finalDir, { recursive: true, force: true });
        }
        await fs.rm(context.journalPath, { force: true });
        throw error;
      }

      for (const oldAsset of evicted) {
        await fs.rm(this.#child(context.assetsDir, oldAsset.id), { recursive: true, force: true });
      }
      await fs.rm(context.journalPath, { force: true });
      return {
        asset: publicAsset(asset, this.#limits.activeReferenceTtlMs),
        evicted_ids: evicted.map((item) => item.id)
      };
    });
  }

  async list(userId, filters = {}) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => {
      const doc = normalizeIndex(await context.index.read());
      const selectedTargets = new Map();
      for (const selection of Object.values(doc.selections)) {
        if (!selection.asset_id) continue;
        if (!selectedTargets.has(selection.asset_id)) selectedTargets.set(selection.asset_id, []);
        selectedTargets.get(selection.asset_id).push(selection.target);
      }
      const selectionEntries = Object.entries(doc.selections)
        .filter(([, selection]) => (!filters.turnNodeId
          || (selection.target?.kind === 'turn' && selection.target.nodeId === filters.turnNodeId))
          && (!filters.subjectId
            || (selection.target?.kind === 'portrait' && selection.target.subjectId === filters.subjectId)))
        .sort(([leftKey, left], [rightKey, right]) => Date.parse(right.updated_at || '')
          - Date.parse(left.updated_at || '') || leftKey.localeCompare(rightKey));
      const selectionTotal = selectionEntries.length;
      const selections = selectionEntries
        .slice(0, this.#limits.maxSelectionsPerResponse)
        .map(([, selection]) => ({
          target: selection.target,
          asset_id: selection.asset_id ?? null,
          revision: Number(selection.revision || 0),
          updated_at: selection.updated_at
        }));
      let assets = Object.values(doc.assets).filter((asset) => {
        const meta = asset.metadata || {};
        return (!filters.campaignId || meta.campaign_id === filters.campaignId)
          && (!filters.turnNodeId || meta.turn_node_id === filters.turnNodeId || meta.node_id === filters.turnNodeId)
          && (!filters.subjectId || meta.subject_id === filters.subjectId)
          && (!filters.purpose || meta.purpose === filters.purpose);
      }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
      if (filters.cursor) {
        const cursorAt = assets.findIndex((asset) => asset.id === filters.cursor);
        if (cursorAt >= 0) assets = assets.slice(cursorAt + 1);
      }
      const total = assets.length;
      const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
      const page = assets.slice(0, limit);
      return {
        assets: page.map((asset) => ({
          ...publicAsset(asset, this.#limits.activeReferenceTtlMs),
          selected_targets: selectedTargets.get(asset.id) || []
        })),
        selections,
        selection_total: selectionTotal,
        selections_truncated: selectionTotal > selections.length,
        total,
        next_cursor: assets.length > limit ? page.at(-1)?.id || null : null
      };
    });
  }

  async quota(userId) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => this.#quotaFromDoc(normalizeIndex(await context.index.read())));
  }

  async resolve(userId, ids) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => {
      const doc = normalizeIndex(await context.index.read());
      const assets = [];
      const missing = [];
      for (const id of ids) {
        if (doc.assets[id]) assets.push(publicAsset(doc.assets[id], this.#limits.activeReferenceTtlMs));
        else missing.push(id);
      }
      return { assets, missing };
    });
  }

  async getBinary(userId, id, variant) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => {
      const doc = normalizeIndex(await context.index.read());
      const asset = doc.assets[id];
      if (!asset) return null;
      const assetDir = this.#child(context.assetsDir, id);
      const fileName = variant === 'thumbnail' ? asset.thumbnail_file : asset.original_file;
      const filePath = this.#child(assetDir, fileName);
      const exists = await fs.access(filePath).then(() => true, () => false);
      if (!exists) return null;
      return {
        filePath,
        mimeType: variant === 'thumbnail' ? asset.thumbnail_mime_type : asset.mime_type,
        sizeBytes: variant === 'thumbnail' ? asset.thumbnail_size_bytes : asset.size_bytes,
        updatedAt: asset.updated_at
      };
    });
  }

  async setSelection(userId, input) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => context.index.update((raw) => {
      const doc = normalizeIndex(raw);
      if (input.assetId && !doc.assets[input.assetId]) {
        throw new ImageAssetRepositoryError('图片资产不存在', 404, 'ASSET_NOT_FOUND');
      }
      if (input.assetId) assertAssetMatchesTarget(doc.assets[input.assetId], input.target);
      const key = targetKey(input.target);
      this.#assertSelectionCapacity(doc, key);
      const current = doc.selections[key] || null;
      const revision = Number(current?.revision || 0);
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
        throw new ImageAssetRepositoryError('图片选择已被其他操作更新', 409, 'SELECTION_CONFLICT', current);
      }
      const next = {
        target: input.target,
        asset_id: input.assetId || null,
        revision: revision + 1,
        updated_at: new Date().toISOString()
      };
      doc.selections[key] = next;
      return { persist: true, result: next };
    }));
  }

  async reconcileSelections(userId, items) {
    if (!Array.isArray(items) || items.length > MAX_RECONCILE_ITEMS) {
      throw new ImageAssetRepositoryError(
        `图片选择批量同步最多允许 ${MAX_RECONCILE_ITEMS} 项`,
        413,
        'SELECTION_BATCH_TOO_LARGE'
      );
    }
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => context.index.update((raw) => {
      const doc = normalizeIndex(raw);
      const applied = [];
      const conflicts = [];
      const missing = [];
      for (const item of items) {
        const key = targetKey(item.target);
        const current = doc.selections[key] || null;
        const revision = Number(current?.revision || 0);
        if (item.assetId && !doc.assets[item.assetId]) {
          missing.push({ target: item.target, asset_id: item.assetId });
          continue;
        }
        if (item.assetId) assertAssetMatchesTarget(doc.assets[item.assetId], item.target);
        this.#assertSelectionCapacity(doc, key);
        if (item.expectedRevision !== undefined && item.expectedRevision !== revision) {
          conflicts.push({ target: item.target, current });
          continue;
        }
        const next = {
          target: item.target,
          asset_id: item.assetId || null,
          revision: revision + 1,
          updated_at: new Date().toISOString()
        };
        doc.selections[key] = next;
        applied.push(next);
      }
      return { persist: applied.length > 0, result: { applied, conflicts, missing } };
    }));
  }

  async patch(userId, id, changes) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => context.index.update((raw) => {
      const doc = normalizeIndex(raw);
      const asset = doc.assets[id];
      if (!asset) throw new ImageAssetRepositoryError('图片资产不存在', 404, 'ASSET_NOT_FOUND');
      if (changes.protected !== undefined) asset.protected = changes.protected;
      const now = new Date().toISOString();
      if (changes.activeJobReferenced !== undefined) {
        asset.active_job_referenced = changes.activeJobReferenced;
        asset.active_job_referenced_at = changes.activeJobReferenced ? now : null;
      }
      asset.updated_at = now;
      return { persist: true, result: publicAsset(asset, this.#limits.activeReferenceTtlMs) };
    }));
  }

  async remove(userId, id) {
    const context = await this.#getContext(userId);
    return this.#withLock(context.userHash, async () => {
      let asset;
      let removedSelections = [];
      await context.index.update(async (raw) => {
        const doc = normalizeIndex(raw);
        asset = doc.assets[id];
        if (!asset) throw new ImageAssetRepositoryError('图片资产不存在', 404, 'ASSET_NOT_FOUND');
        if (asset.protected) throw new ImageAssetRepositoryError('受保护图片需先取消保护', 409, 'ASSET_PROTECTED');
        if (isActiveJobReferenced(asset, this.#limits.activeReferenceTtlMs)) {
          throw new ImageAssetRepositoryError('图片正被活动任务引用', 409, 'ASSET_IN_USE');
        }
        await this.#writeJournal(context, { operation: 'delete', id, at: new Date().toISOString() });
        delete doc.assets[id];
        for (const [key, selection] of Object.entries(doc.selections)) {
          if (selection.asset_id === id) {
            removedSelections.push(selection.target);
            doc.selections[key] = {
              target: selection.target,
              asset_id: null,
              revision: Number(selection.revision || 0) + 1,
              updated_at: new Date().toISOString()
            };
          }
        }
        return { persist: true };
      });
      await fs.rm(this.#child(context.assetsDir, id), { recursive: true, force: true });
      await fs.rm(context.journalPath, { force: true });
      return { id, removed_selections: removedSelections };
    });
  }
}

export function isImageAssetId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
