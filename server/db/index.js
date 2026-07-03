import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, writeFileAtomic, updateJsonFile } from './json-store.js';

/**
 * 数据访问层（仓储模式）：用户 / 云存档 / 音乐收藏 三个领域各自一组函数。
 * 元数据存 JSON 索引文件，存档正文以 gzip 二进制单独落盘（`saves/<id>.bin`）。
 * 所有写操作经由 json-store 的互斥队列 + 原子写入，读操作享受 mtime 缓存。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = __dirname;
const savesDir = path.join(dbDir, 'saves');
const usersFilePath = path.join(dbDir, 'users.json');
const indexFilePath = path.join(dbDir, 'saves_index.json');
const favoritesFilePath = path.join(dbDir, 'favorites.json');

/** 单个用户的音乐收藏上限，防止收藏文件无限膨胀 */
const MAX_FAVORITES_PER_USER = 100;

/**
 * @typedef {object} SaveMeta
 * @property {string} id
 * @property {string} user_id
 * @property {string} slot_name
 * @property {object} preview_data
 * @property {number} size_bytes
 * @property {string} created_at ISO 8601
 * @property {string} updated_at ISO 8601
 */

/**
 * 初始化数据库目录与初始文件。必须在服务开始接受请求前 await 完成。
 * @returns {Promise<void>}
 */
export async function initDb() {
  await fs.mkdir(savesDir, { recursive: true });
  // 仅在文件缺失时创建空结构，绝不覆盖已有数据
  for (const filePath of [usersFilePath, indexFilePath, favoritesFilePath]) {
    try {
      await fs.access(filePath);
    } catch {
      await updateJsonFile(filePath, {}, () => {});
    }
  }
  console.log(`[DB] File-based Database initialized at ${dbDir}`);
}

// --- 用户仓储 ---

/**
 * 新增或更新 Discord 用户档案。
 * 已存在的用户保留 created_at 及其他历史字段，仅刷新档案与 last_login。
 * @param {{id: string, username: string, discriminator?: string, avatar?: string, global_name?: string}} profile
 * @returns {Promise<void>}
 */
export function upsertUser({ id, username, discriminator, avatar, global_name }) {
  return updateJsonFile(usersFilePath, {}, (users) => {
    const now = new Date().toISOString();
    users[id] = {
      ...users[id],
      id,
      username,
      discriminator,
      avatar,
      global_name,
      created_at: users[id]?.created_at ?? now,
      last_login: now
    };
  });
}

/**
 * @param {string} id Discord 用户 ID
 * @returns {Promise<object | null>}
 */
export async function getUser(id) {
  const users = await readJsonFile(usersFilePath, {});
  return users[id] ?? null;
}

// --- 云存档仓储 ---

/**
 * 获取用户全部存档元数据，按更新时间倒序。
 * @param {string} userId
 * @returns {Promise<SaveMeta[]>}
 */
export async function getUserSaves(userId) {
  const index = await readJsonFile(indexFilePath, {});
  return Object.values(index)
    .filter((save) => save.user_id === userId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getUserSaveCount(userId) {
  const saves = await getUserSaves(userId);
  return saves.length;
}

/**
 * 读取存档元数据及其二进制正文。
 * 索引存在但 .bin 文件缺失/损坏时返回 null（与元数据不存在同样处理）。
 * @param {string} id
 * @returns {Promise<(SaveMeta & {save_data: Buffer}) | null>}
 */
export async function getSaveById(id) {
  const index = await readJsonFile(indexFilePath, {});
  const saveMeta = index[id];
  if (!saveMeta) return null;

  try {
    const save_data = await fs.readFile(path.join(savesDir, `${id}.bin`));
    return { ...saveMeta, save_data };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[DB] Error reading save bin file ${id}:`, err);
    }
    return null;
  }
}

/**
 * 新建存档：先原子落盘二进制正文，再写入索引元数据。
 * 顺序保证：索引里出现的存档一定有正文文件；反向的孤儿 .bin 可安全清理。
 * @param {{id: string, user_id: string, slot_name: string, preview_data: object, save_data: Buffer, size_bytes: number}} save
 * @returns {Promise<void>}
 */
export async function insertSave({ id, user_id, slot_name, preview_data, save_data, size_bytes }) {
  await writeFileAtomic(path.join(savesDir, `${id}.bin`), save_data);

  await updateJsonFile(indexFilePath, {}, (index) => {
    const now = new Date().toISOString();
    index[id] = { id, user_id, slot_name, preview_data, size_bytes, created_at: now, updated_at: now };
  });
}

/**
 * 更新存档。只更新传入的字段；save_data 与 size_bytes 成对更新。
 * @param {string} id
 * @param {{slot_name?: string, preview_data?: object, save_data?: Buffer, size_bytes?: number}} updates
 * @returns {Promise<void>}
 */
export async function updateSave(id, { slot_name, preview_data, save_data, size_bytes }) {
  if (save_data !== undefined) {
    await writeFileAtomic(path.join(savesDir, `${id}.bin`), save_data);
  }

  await updateJsonFile(indexFilePath, {}, (index) => {
    const meta = index[id];
    if (!meta) return; // 与旧实现一致：目标不存在时静默跳过（路由层已做 404 校验）

    if (save_data !== undefined) meta.size_bytes = size_bytes;
    if (slot_name !== undefined) meta.slot_name = slot_name;
    if (preview_data !== undefined) meta.preview_data = preview_data;
    meta.updated_at = new Date().toISOString();
  });
}

/**
 * 删除存档：先移除索引，再删除物理 .bin 文件。
 * .bin 删除失败只记录日志——索引已删即视为删除成功，残留文件不影响正确性。
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteSave(id) {
  await updateJsonFile(indexFilePath, {}, (index) => {
    delete index[id];
  });

  try {
    await fs.unlink(path.join(savesDir, `${id}.bin`));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[DB] Error deleting save file ${id}:`, err);
    }
  }
}

// --- 音乐收藏仓储 ---

/**
 * 歌曲去重键：兼容三种历史来源的 ID 字段。
 * @param {{url_id?: string, mid?: string, id?: string}} song
 * @returns {string | undefined}
 */
function getSongKey(song) {
  return song.url_id || song.mid || song.id;
}

/**
 * @param {string} userId
 * @returns {Promise<object[]>}
 */
export async function getUserFavorites(userId) {
  const favorites = await readJsonFile(favoritesFilePath, {});
  return favorites[userId] ?? [];
}

/**
 * 整体覆盖用户收藏列表（保留前 100 首）。
 * @param {string} userId
 * @param {object[]} songs
 * @returns {Promise<void>}
 */
export async function saveUserFavorites(userId, songs) {
  if (!Array.isArray(songs)) return;
  await updateJsonFile(favoritesFilePath, {}, (favorites) => {
    favorites[userId] = songs.slice(0, MAX_FAVORITES_PER_USER);
  });
}

/**
 * 追加一首收藏（按歌曲键去重，超出上限时淘汰最早的）。
 * @param {string} userId
 * @param {object} song
 * @returns {Promise<object[]>} 更新后的收藏列表
 */
export function addUserFavorite(userId, song) {
  return updateJsonFile(favoritesFilePath, {}, (favorites) => {
    const list = favorites[userId] ?? [];
    const songKey = getSongKey(song);
    if (!list.some((item) => getSongKey(item) === songKey)) {
      list.push(song);
    }
    favorites[userId] = list.slice(-MAX_FAVORITES_PER_USER);
    return favorites[userId];
  });
}

/**
 * 移除一首收藏。
 * @param {string} userId
 * @param {string} songId
 * @returns {Promise<object[]>} 更新后的收藏列表
 */
export function removeUserFavorite(userId, songId) {
  return updateJsonFile(favoritesFilePath, {}, (favorites) => {
    favorites[userId] = (favorites[userId] ?? []).filter((item) => getSongKey(item) !== songId);
    return favorites[userId];
  });
}
