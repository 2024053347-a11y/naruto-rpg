// @ts-check
import { JsonStore } from './json-store.js';

/**
 * @typedef {Object} Song
 * @property {string} [url_id]
 * @property {string} [mid]
 * @property {string} [id]
 */

/** 每个用户最多保留的收藏数量 */
const MAX_FAVORITES_PER_USER = 100;

/**
 * 歌曲去重主键：不同音源平台的 ID 字段不统一，按优先级取第一个可用值。
 * @param {Song} song
 * @returns {string | undefined}
 */
function songKey(song) {
  return song.url_id || song.mid || song.id;
}

/**
 * FavoritesRepository —— 音乐收藏仓储。
 * 文档结构：{ [userId]: Song[] }
 */
export class FavoritesRepository {
  /** @type {JsonStore} */
  #store;

  /** @param {string} filePath favorites.json 的绝对路径 */
  constructor(filePath) {
    this.#store = new JsonStore(filePath, {});
  }

  /** @returns {Promise<void>} */
  async init() {
    await this.#store.ensureExists();
  }

  /**
   * @param {string} userId
   * @returns {Promise<Song[]>}
   */
  async listByUser(userId) {
    const favs = await this.#store.read();
    return favs[userId] || [];
  }

  /**
   * 整体替换收藏列表。非数组入参静默忽略（沿用旧版语义）。
   * 与 add() 一致：超过上限时保留最新的 100 条。
   * @param {string} userId
   * @param {Song[]} songs
   * @returns {Promise<void>}
   */
  async replaceAll(userId, songs) {
    if (!Array.isArray(songs)) return;
    await this.#store.update((favs) => {
      favs[userId] = songs.slice(-MAX_FAVORITES_PER_USER);
      return { persist: true };
    });
  }

  /**
   * 追加一首收藏（按 songKey 去重）；溢出时丢弃最早的条目。
   * @param {string} userId
   * @param {Song} song
   * @returns {Promise<Song[]>} 该用户最新的收藏列表
   */
  async add(userId, song) {
    return this.#store.update((favs) => {
      const list = favs[userId] || [];
      const key = songKey(song);
      if (list.some((item) => songKey(item) === key)) {
        return { persist: false, result: list };
      }
      list.push(song);
      favs[userId] = list.slice(-MAX_FAVORITES_PER_USER);
      return { persist: true, result: favs[userId] };
    });
  }

  /**
   * 移除一首收藏。
   * @param {string} userId
   * @param {string} songId
   * @returns {Promise<Song[]>} 该用户最新的收藏列表
   */
  async remove(userId, songId) {
    return this.#store.update((favs) => {
      const list = favs[userId] || [];
      favs[userId] = list.filter((item) => songKey(item) !== songId);
      return { persist: true, result: favs[userId] };
    });
  }
}
