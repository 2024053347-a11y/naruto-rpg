// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './json-store.js';

/**
 * @typedef {Object} SaveMeta
 * @property {string} id 存档 ID（UUID）
 * @property {string} user_id 所属用户的 Discord ID
 * @property {string} slot_name 存档槽位名称
 * @property {Record<string, any>} preview_data 前端展示用的预览元数据
 * @property {number} size_bytes 压缩前的原始 JSON 字节数
 * @property {string} created_at ISO 8601 时间戳
 * @property {string} updated_at ISO 8601 时间戳
 */

/**
 * @typedef {SaveMeta & { save_data: Buffer }} SaveRecord
 */

/**
 * SaveRepository —— 云存档仓储。
 *
 * 存储模型（沿用旧版磁盘布局，保证平滑升级）：
 * - saves_index.json：{ [saveId]: SaveMeta }，仅存元数据；
 * - saves/<id>.bin：gzip 压缩后的存档二进制正文。
 *
 * 一致性约定：新增/更新时「先写 .bin、后写索引」，
 * 保证索引里出现的存档一定有对应的二进制文件。
 */
export class SaveRepository {
  /** @type {JsonStore} */
  #index;
  /** @type {string} */
  #savesDir;

  /**
   * @param {string} indexFilePath saves_index.json 的绝对路径
   * @param {string} savesDir 二进制存档目录的绝对路径
   */
  constructor(indexFilePath, savesDir) {
    this.#index = new JsonStore(indexFilePath, {});
    this.#savesDir = savesDir;
  }

  /** @returns {Promise<void>} */
  async init() {
    await fs.mkdir(this.#savesDir, { recursive: true });
    await this.#index.ensureExists();
  }

  /**
   * 计算存档二进制文件路径，并防御路径穿越
   * （API 层已校验 ID 格式，这里是纵深防御）。
   * @param {string} id
   * @returns {string}
   */
  #binPath(id) {
    const resolved = path.resolve(this.#savesDir, `${id}.bin`);
    if (!resolved.startsWith(this.#savesDir + path.sep)) {
      throw new Error(`[DB] Illegal save id (path traversal blocked): ${id}`);
    }
    return resolved;
  }

  /**
   * 某用户的全部存档元数据，按 updated_at 降序。
   * @param {string} userId
   * @returns {Promise<SaveMeta[]>}
   */
  async listByUser(userId) {
    const index = await this.#index.read();
    return Object.values(index)
      .filter((save) => save.user_id === userId)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }

  /**
   * @param {string} userId
   * @returns {Promise<number>}
   */
  async countByUser(userId) {
    const index = await this.#index.read();
    return Object.values(index).filter((save) => save.user_id === userId).length;
  }

  async countAll() {
    const index = await this.#index.read();
    return Object.keys(index).length;
  }

  /**
   * 仅读取元数据（不加载二进制正文），用于权限校验等轻量场景。
   * 与旧版 getSaveById 语义对齐：索引存在但 .bin 文件缺失时视为存档不存在。
   * @param {string} id
   * @returns {Promise<SaveMeta | null>}
   */
  async findMetaById(id) {
    const index = await this.#index.read();
    const meta = index[id];
    if (!meta) return null;
    try {
      await fs.access(this.#binPath(id));
    } catch {
      return null;
    }
    return meta;
  }

  /**
   * 读取完整存档（元数据 + 二进制正文）。
   * @param {string} id
   * @returns {Promise<SaveRecord | null>}
   */
  async findById(id) {
    const index = await this.#index.read();
    const meta = index[id];
    if (!meta) return null;
    try {
      const save_data = await fs.readFile(this.#binPath(id));
      return { ...meta, save_data };
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        console.error(`[DB] Error reading save bin file ${id}:`, err);
      }
      return null;
    }
  }

  /**
   * 新增存档。二进制写入失败时异常向上传播，索引不会被污染。
   * @param {{ id: string, user_id: string, slot_name: string, preview_data: Record<string, any>, save_data: Buffer, size_bytes: number }} save
   * @returns {Promise<void>}
   */
  async insert({ id, user_id, slot_name, preview_data, save_data, size_bytes }) {
    await this.#index.update(async (index) => {
      await fs.writeFile(this.#binPath(id), save_data);
      const now = new Date().toISOString();
      index[id] = { id, user_id, slot_name, preview_data, size_bytes, created_at: now, updated_at: now };
      return { persist: true };
    });
  }

  /**
   * 局部更新存档。ID 不存在时静默 no-op（沿用旧版语义）。
   * 只要存档存在，updated_at 一律刷新——即便本次没有任何字段变化。
   * @param {string} id
   * @param {{ slot_name?: string, preview_data?: Record<string, any>, save_data?: Buffer, size_bytes?: number }} changes
   * @returns {Promise<void>}
   */
  async update(id, { slot_name, preview_data, save_data, size_bytes }) {
    await this.#index.update(async (index) => {
      const meta = index[id];
      if (!meta) return { persist: false };

      if (save_data !== undefined) {
        await fs.writeFile(this.#binPath(id), save_data);
        meta.size_bytes = size_bytes;
      }
      if (slot_name !== undefined) meta.slot_name = slot_name;
      if (preview_data !== undefined) meta.preview_data = preview_data;

      meta.updated_at = new Date().toISOString();
      return { persist: true };
    });
  }

  /**
   * 删除存档：先移除索引，再清理二进制文件。
   * .bin 缺失或删除失败不影响索引删除结果（沿用旧版语义）。
   * @param {string} id
   * @returns {Promise<void>}
   */
  async remove(id) {
    await this.#index.update((index) => {
      if (!index[id]) return { persist: false };
      delete index[id];
      return { persist: true };
    });

    try {
      await fs.unlink(this.#binPath(id));
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        console.error(`[DB] Error deleting save file ${id}:`, err);
      }
    }
  }
}
