// @ts-check
import { JsonStore } from './json-store.js';

/**
 * @typedef {Object} DiscordProfile
 * @property {string} id Discord 用户 ID（雪花 ID 字符串）
 * @property {string} username
 * @property {string} discriminator
 * @property {string} avatar
 * @property {string} global_name
 */

/**
 * @typedef {DiscordProfile & { created_at: string, last_login: string }} UserRecord
 */

/**
 * UserRepository —— 用户账户的持久化仓储。
 * 文档结构：{ [userId]: UserRecord }
 */
export class UserRepository {
  /** @type {JsonStore} */
  #store;

  /** @param {string} filePath users.json 的绝对路径 */
  constructor(filePath) {
    this.#store = new JsonStore(filePath, {});
  }

  /** @returns {Promise<void>} */
  async init() {
    await this.#store.ensureExists();
  }

  /**
   * 插入或更新用户：已存在时保留 created_at，仅刷新资料与 last_login。
   * @param {DiscordProfile} profile
   * @returns {Promise<void>}
   */
  async upsert({ id, username, discriminator, avatar, global_name }) {
    await this.#store.update((users) => {
      const now = new Date().toISOString();
      const existing = users[id];
      users[id] = existing
        ? { ...existing, username, discriminator, avatar, global_name, last_login: now }
        : { id, username, discriminator, avatar, global_name, created_at: now, last_login: now };
      return { persist: true };
    });
  }

  /**
   * @param {string} id
   * @returns {Promise<UserRecord | null>}
   */
  async findById(id) {
    const users = await this.#store.read();
    return users[id] ?? null;
  }
}
