// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './json-store.js';

/**
 * @typedef {Object} SaveMeta
 * @property {string} id
 * @property {string} user_id
 * @property {string} slot_name
 * @property {Record<string, any>} preview_data
 * @property {number} size_bytes
 * @property {number} [revision]
 * @property {string} [blob_name]
 * @property {number} [compressed_size_bytes]
 * @property {string} [content_sha256]
 * @property {string} created_at
 * @property {string} updated_at
 */

/** @typedef {SaveMeta & { save_data: Buffer }} SaveRecord */
/** @typedef {SaveMeta & { file_path: string }} SaveContent */

export class SaveRepository {
  /** @type {JsonStore} */
  #index;
  /** @type {string} */
  #savesDir;

  constructor(indexFilePath, savesDir) {
    this.#index = new JsonStore(indexFilePath, {});
    this.#savesDir = path.resolve(savesDir);
  }

  async init() {
    await fs.mkdir(this.#savesDir, { recursive: true });
    await this.#index.ensureExists();
    await this.#cleanupInterruptedWrites();
  }

  #legacyBlobName(id) {
    return `${id}.bin`;
  }

  #blobPath(blobName) {
    if (typeof blobName !== 'string'
        || blobName.length > 180
        || !/^[a-zA-Z0-9._-]+\.bin$/.test(blobName)) {
      throw new Error(`[DB] Illegal save blob name: ${blobName}`);
    }
    const resolved = path.resolve(this.#savesDir, blobName);
    if (!resolved.startsWith(`${this.#savesDir}${path.sep}`)) {
      throw new Error(`[DB] Save blob path traversal blocked: ${blobName}`);
    }
    return resolved;
  }

  #pathForMeta(id, meta) {
    return this.#blobPath(meta.blob_name || this.#legacyBlobName(id));
  }

  #revisionBlobName(id, revision) {
    return `${id}.r${revision}.${randomUUID()}.bin`;
  }

  async #cleanupInterruptedWrites() {
    let entries;
    try {
      entries = await fs.readdir(this.#savesDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[DB] Unable to inspect save directory:', error);
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.tmp')) return;
      try {
        await fs.rm(path.join(this.#savesDir, entry.name), { force: true });
      } catch (error) {
        console.warn(`[DB] Unable to clean interrupted save write ${entry.name}:`, error);
      }
    }));
  }

  async #promoteFile(sourcePath, blobName) {
    const finalPath = this.#blobPath(blobName);
    const tempPath = path.join(this.#savesDir, `.${blobName}.${process.pid}.tmp`);
    try {
      try {
        await fs.rename(sourcePath, tempPath);
      } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
        await fs.copyFile(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
        await fs.rm(sourcePath, { force: true });
      }
      const handle = await fs.open(tempPath, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tempPath, finalPath);
      return finalPath;
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async #stageBuffer(id, buffer) {
    const sourcePath = path.join(this.#savesDir, `.${id}.${randomUUID()}.buffer.tmp`);
    await fs.writeFile(sourcePath, buffer, { flag: 'wx' });
    return sourcePath;
  }

  async #removeBlob(filePath) {
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      console.warn(`[DB] Unable to remove obsolete save blob ${path.basename(filePath)}:`, error);
    }
  }

  async listByUser(userId) {
    const index = await this.#index.read();
    return Object.values(index)
      .filter((save) => save.user_id === userId)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }

  async countByUser(userId) {
    const index = await this.#index.read();
    return Object.values(index).filter((save) => save.user_id === userId).length;
  }

  async countAll() {
    const index = await this.#index.read();
    return Object.keys(index).length;
  }

  async findMetaById(id) {
    const index = await this.#index.read();
    const meta = index[id];
    if (!meta) return null;
    try {
      await fs.access(this.#pathForMeta(id, meta));
      return meta;
    } catch {
      return null;
    }
  }

  async findContentById(id) {
    const index = await this.#index.read();
    const meta = index[id];
    if (!meta) return null;
    const file_path = this.#pathForMeta(id, meta);
    try {
      await fs.access(file_path);
      return { ...meta, file_path };
    } catch {
      return null;
    }
  }

  async findById(id) {
    const content = await this.findContentById(id);
    if (!content) return null;
    try {
      const save_data = await fs.readFile(content.file_path);
      const { file_path: _filePath, ...meta } = content;
      return { ...meta, save_data };
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error(`[DB] Error reading save blob ${id}:`, error);
      return null;
    }
  }

  async insertFileWithinUserLimit({
    id,
    user_id,
    slot_name,
    preview_data,
    source_path,
    size_bytes,
    compressed_size_bytes,
    content_sha256
  }, maxSlots) {
    return this.#index.update(async (index) => {
      const currentCount = Object.values(index).filter((save) => save.user_id === user_id).length;
      if (currentCount >= maxSlots) return { persist: false, result: false };

      const revision = 1;
      const blob_name = this.#revisionBlobName(id, revision);
      await this.#promoteFile(source_path, blob_name);
      const now = new Date().toISOString();
      index[id] = {
        id,
        user_id,
        slot_name,
        preview_data,
        size_bytes,
        compressed_size_bytes,
        content_sha256,
        revision,
        blob_name,
        created_at: now,
        updated_at: now
      };
      return { persist: true, result: true };
    });
  }

  async insertFile(save) {
    const inserted = await this.insertFileWithinUserLimit(save, Number.MAX_SAFE_INTEGER);
    if (!inserted) throw new Error('[DB] Unable to insert save');
  }

  async insert(save) {
    const sourcePath = await this.#stageBuffer(save.id, save.save_data);
    try {
      await this.insertFile({
        ...save,
        source_path: sourcePath,
        compressed_size_bytes: save.save_data.length,
        content_sha256: save.content_sha256
      });
    } finally {
      await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
  }

  async insertWithinUserLimit(save, maxSlots) {
    const sourcePath = await this.#stageBuffer(save.id, save.save_data);
    try {
      return await this.insertFileWithinUserLimit({
        ...save,
        source_path: sourcePath,
        compressed_size_bytes: save.save_data.length,
        content_sha256: save.content_sha256
      }, maxSlots);
    } finally {
      await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
  }

  async updateFile(id, {
    slot_name,
    preview_data,
    source_path,
    size_bytes,
    compressed_size_bytes,
    content_sha256
  }) {
    let obsoletePath;
    const updated = await this.#index.update(async (index) => {
      const meta = index[id];
      if (!meta) return { persist: false, result: false };

      if (source_path !== undefined) {
        obsoletePath = this.#pathForMeta(id, meta);
        const revision = (Number.isInteger(meta.revision) ? meta.revision : 0) + 1;
        const blob_name = this.#revisionBlobName(id, revision);
        await this.#promoteFile(source_path, blob_name);
        meta.revision = revision;
        meta.blob_name = blob_name;
        meta.size_bytes = size_bytes;
        meta.compressed_size_bytes = compressed_size_bytes;
        meta.content_sha256 = content_sha256;
      }
      if (slot_name !== undefined) meta.slot_name = slot_name;
      if (preview_data !== undefined) meta.preview_data = preview_data;
      meta.updated_at = new Date().toISOString();
      return { persist: true, result: true };
    });

    if (updated && obsoletePath) await this.#removeBlob(obsoletePath);
    return updated;
  }

  async update(id, { slot_name, preview_data, save_data, size_bytes, content_sha256 }) {
    if (save_data === undefined) {
      await this.updateFile(id, { slot_name, preview_data });
      return;
    }
    const sourcePath = await this.#stageBuffer(id, save_data);
    try {
      await this.updateFile(id, {
        slot_name,
        preview_data,
        source_path: sourcePath,
        size_bytes,
        compressed_size_bytes: save_data.length,
        content_sha256
      });
    } finally {
      await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
  }

  async remove(id) {
    let blobPath;
    await this.#index.update((index) => {
      const meta = index[id];
      if (!meta) return { persist: false };
      blobPath = this.#pathForMeta(id, meta);
      delete index[id];
      return { persist: true };
    });
    if (blobPath) await this.#removeBlob(blobPath);
  }
}
