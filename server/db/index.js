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
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { UserRepository } from './user-repository.js';
import { SaveRepository } from './save-repository.js';
import { FavoritesRepository } from './favorites-repository.js';
import { LoginLogRepository } from './login-log-repository.js';
import { ImageAssetRepository } from './image-asset-repository.js';

const legacyDbDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = config.storage.dataDir;

const users = new UserRepository(path.join(dataDir, 'users.json'));
const saves = new SaveRepository(path.join(dataDir, 'saves_index.json'), path.join(dataDir, 'saves'));
const favorites = new FavoritesRepository(path.join(dataDir, 'favorites.json'));
const loginLog = new LoginLogRepository(path.join(dataDir, 'login_log.json'));
const imageAssets = new ImageAssetRepository(path.join(dataDir, 'image-assets'), config.imageAssets);

async function migrateLegacyData() {
  if (path.resolve(dataDir) === path.resolve(legacyDbDir)) return;
  await fs.mkdir(dataDir, { recursive: true });
  for (const name of ['users.json', 'saves_index.json', 'favorites.json', 'login_log.json']) {
    const source = path.join(legacyDbDir, name);
    const target = path.join(dataDir, name);
    try {
      await fs.access(target);
      continue;
    } catch {}
    try {
      await fs.copyFile(source, target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  try {
    await fs.access(path.join(dataDir, 'saves'));
  } catch {
    try {
      await fs.cp(path.join(legacyDbDir, 'saves'), path.join(dataDir, 'saves'), { recursive: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

/**
 * 初始化持久层：确保数据目录与三个 JSON 文档存在。
 * @returns {Promise<boolean>}
 */
export async function initDb() {
  await migrateLegacyData();
  console.log(`[DB] File-based Database initialized at ${dataDir}`);
  await Promise.all([users.init(), saves.init(), favorites.init(), loginLog.init(), imageAssets.init()]);
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

/** @type {UserRepository['getAll']} */
export const getAllUsers = () => users.getAll();

/** @type {UserRepository['banUser']} */
export const banUser = (id, reason) => users.banUser(id, reason);

/** @type {UserRepository['unbanUser']} */
export const unbanUser = (id) => users.unbanUser(id);

// --- 存档数据库操作 ---

/** @type {SaveRepository['listByUser']} */
export const getUserSaves = (userId) => saves.listByUser(userId);

/** @type {SaveRepository['countByUser']} */
export const getUserSaveCount = (userId) => saves.countByUser(userId);

export const getTotalSaveCount = () => saves.countAll();

/** @type {SaveRepository['findById']} */
export const getSaveById = (id) => saves.findById(id);

/** @type {SaveRepository['findContentById']} */
export const getSaveContentById = (id) => saves.findContentById(id);

/**
 * 仅读取存档元数据（不加载可达数百 MB 的二进制正文），
 * 供权限校验等轻量场景使用。
 * @type {SaveRepository['findMetaById']}
 */
export const getSaveMetaById = (id) => saves.findMetaById(id);

/** @type {SaveRepository['insert']} */
export const insertSave = (save) => saves.insert(save);

/** @type {SaveRepository['insertWithinUserLimit']} */
export const insertSaveWithinUserLimit = (save, maxSlots) => saves.insertWithinUserLimit(save, maxSlots);

/** @type {SaveRepository['insertFileWithinUserLimit']} */
export const insertSaveFileWithinUserLimit = (save, maxSlots) => saves.insertFileWithinUserLimit(save, maxSlots);

/** @type {SaveRepository['update']} */
export const updateSave = (id, changes) => saves.update(id, changes);

/** @type {SaveRepository['updateFile']} */
export const updateSaveFile = (id, changes) => saves.updateFile(id, changes);

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

export const recordLogin = (user) => loginLog.record(user);

export const getLoginLog = () => loginLog.list();

export const getDataDir = () => dataDir;

// --- 私有图片图库操作 ---

export const createImageAssetStaging = (userId) => imageAssets.createStagingArea(userId);

export const cleanupImageAssetStaging = (userId, token) => imageAssets.cleanupStagingArea(userId, token);

export const commitImageAssetUpload = (userId, input) => imageAssets.commitUpload(userId, input);

export const listImageAssets = (userId, filters) => imageAssets.list(userId, filters);

export const getImageAssetQuota = (userId) => imageAssets.quota(userId);

export const resolveImageAssets = (userId, ids) => imageAssets.resolve(userId, ids);

export const getImageAssetBinary = (userId, id, variant) => imageAssets.getBinary(userId, id, variant);

export const setImageAssetSelection = (userId, input) => imageAssets.setSelection(userId, input);

export const reconcileImageAssetSelections = (userId, items) => imageAssets.reconcileSelections(userId, items);

export const patchImageAsset = (userId, id, changes) => imageAssets.patch(userId, id, changes);

export const deleteImageAsset = (userId, id) => imageAssets.remove(userId, id);
