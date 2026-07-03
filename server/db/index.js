// @ts-check
/**
 * 数据持久层门面 (Facade)。
 *
 * 对外保持与旧版完全一致的具名导出，内部委托给按单一职责拆分的仓储：
 * - UserRepository      —— users.json
 * - SaveRepository      —— saves_index.json + saves/<id>.bin
 * - FavoritesRepository —— favorites.json
 *
 * ⚠️ 自 v2.2 起所有数据操作均为异步（返回 Promise），调用方必须 await。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserRepository } from './user-repository.js';
import { SaveRepository } from './save-repository.js';
import { FavoritesRepository } from './favorites-repository.js';

const dbDir = path.dirname(fileURLToPath(import.meta.url));

const users = new UserRepository(path.join(dbDir, 'users.json'));
const saves = new SaveRepository(path.join(dbDir, 'saves_index.json'), path.join(dbDir, 'saves'));
const favorites = new FavoritesRepository(path.join(dbDir, 'favorites.json'));

/**
 * 初始化持久层：确保数据目录与三个 JSON 文档存在。
 * @returns {Promise<boolean>}
 */
export async function initDb() {
  console.log(`[DB] File-based Database initialized at ${dbDir}`);
  await Promise.all([users.init(), saves.init(), favorites.init()]);
  return true;
}

/**
 * 兼容保留：旧版遗留的连接探针，无实际语义。
 * @returns {boolean}
 */
export function getDb() {
  return true;
}

// --- 用户数据库操作 ---

/** @type {UserRepository['upsert']} */
export const upsertUser = (profile) => users.upsert(profile);

/** @type {UserRepository['findById']} */
export const getUser = (id) => users.findById(id);

// --- 存档数据库操作 ---

/** @type {SaveRepository['listByUser']} */
export const getUserSaves = (userId) => saves.listByUser(userId);

/** @type {SaveRepository['countByUser']} */
export const getUserSaveCount = (userId) => saves.countByUser(userId);

/** @type {SaveRepository['findById']} */
export const getSaveById = (id) => saves.findById(id);

/**
 * 仅读取存档元数据（不加载可达数百 MB 的二进制正文），
 * 供权限校验等轻量场景使用。
 * @type {SaveRepository['findMetaById']}
 */
export const getSaveMetaById = (id) => saves.findMetaById(id);

/** @type {SaveRepository['insert']} */
export const insertSave = (save) => saves.insert(save);

/** @type {SaveRepository['update']} */
export const updateSave = (id, changes) => saves.update(id, changes);

/** @type {SaveRepository['remove']} */
export const deleteSave = (id) => saves.remove(id);

// --- 音乐收藏数据库操作 ---

/** @type {FavoritesRepository['listByUser']} */
export const getUserFavorites = (userId) => favorites.listByUser(userId);

/** @type {FavoritesRepository['replaceAll']} */
export const saveUserFavorites = (userId, songs) => favorites.replaceAll(userId, songs);

/** @type {FavoritesRepository['add']} */
export const addUserFavorite = (userId, song) => favorites.add(userId, song);

/** @type {FavoritesRepository['remove']} */
export const removeUserFavorite = (userId, songId) => favorites.remove(userId, songId);
