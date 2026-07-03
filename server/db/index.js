/**
 * 文件型数据库模块（File-based Database）
 *
 * 以 JSON 文件持久化用户 / 存档索引 / 音乐收藏三类数据，
 * 存档正文以 gzip 二进制（`saves/<id>.bin`）单独落盘。
 *
 * 架构约束（重要，维护前必读）：
 * - 本模块假设 **当前 Node 进程是这些数据文件的唯一写入者**（单进程部署）。
 *   基于该前提，每个 JSON 文件在首次访问时加载进内存，之后读操作走内存缓存，
 *   写操作同步落盘（write-through）。若未来改为多进程/集群部署，
 *   必须先替换为真正的数据库（如 SQLite），而不是继续在此叠加文件锁。
 * - 对外 API 保持同步语义（历史契约，被 auth 中间件、saves / music 路由直接
 *   同步调用）。所有写入均为「临时文件 + rename」的原子写，进程崩溃时
 *   磁盘上不会出现半截文件。
 * - 读操作返回缓存数据的深拷贝，调用方对返回值的任何修改都不会污染缓存。
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @typedef {Object} DiscordProfile
 *  @property {string} id
 *  @property {string} username
 *  @property {string} [discriminator]
 *  @property {string} [avatar]
 *  @property {string} [global_name]
 */

/** @typedef {DiscordProfile & { created_at: string, last_login: string }} UserRecord */

/** @typedef {Object} SaveMetadata
 *  @property {string} id
 *  @property {string} user_id
 *  @property {string} slot_name
 *  @property {Object} preview_data
 *  @property {number} size_bytes
 *  @property {string} created_at ISO 8601
 *  @property {string} updated_at ISO 8601
 */

/** @typedef {SaveMetadata & { save_data: Buffer }} SaveRecord */

/** @typedef {{ url_id?: string, mid?: string, id?: string }} Song */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = __dirname;
const savesDir = path.join(dbDir, 'saves');

/** 每个用户最多保留的收藏歌曲数，防止单用户无限膨胀撑爆 JSON 文件 */
const MAX_FAVORITES_PER_USER = 100;

// 存档二进制目录必须先于任何写入存在；recursive 模式天然幂等
fs.mkdirSync(savesDir, { recursive: true });

/**
 * 原子写文件：先写入同目录临时文件，再 rename 覆盖目标。
 * rename 在同一文件系统内是原子操作，因此任何时刻的读取方
 * 要么看到旧的完整内容，要么看到新的完整内容，绝不会读到半截文件——
 * 这从根源上消除了旧实现里「文件暂时为空需要自旋重试」的问题。
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 */
function atomicWriteFileSync(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

/**
 * 单个 JSON 文件的内存缓存 + 原子持久化封装。
 *
 * 职责边界：只负责「加载 / 缓存 / 落盘」一个 JSON 文件，
 * 不理解文件内容的业务含义（业务规则全部留在下方导出的仓储函数中）。
 */
class JsonStore {
  /** @type {string} */
  #filePath;
  /** @type {Object} */
  #defaultValue;
  /** @type {Object | null} 首次访问前为 null（懒加载） */
  #cache = null;

  /**
   * @param {string} filePath JSON 文件绝对路径
   * @param {Object} [defaultValue] 文件不存在或损坏时的初始结构
   */
  constructor(filePath, defaultValue = {}) {
    this.#filePath = filePath;
    this.#defaultValue = defaultValue;
  }

  /** 缓存的可变数据引用（模块内部专用；对外必须经深拷贝再暴露）。 */
  get data() {
    if (this.#cache === null) {
      this.#cache = this.#loadFromDisk();
    }
    return this.#cache;
  }

  /** 将当前缓存原子化落盘。写失败时抛出异常，由调用链上的路由层转为 500。 */
  save() {
    atomicWriteFileSync(this.#filePath, JSON.stringify(this.data, null, 2));
  }

  /** 供 initDb 使用：文件不存在时以默认结构建档。 */
  ensureFileExists() {
    if (!fs.existsSync(this.#filePath)) {
      this.save();
    }
  }

  /**
   * @returns {Object} 磁盘内容；文件缺失 / 为空返回默认结构的副本
   */
  #loadFromDisk() {
    if (!fs.existsSync(this.#filePath)) {
      return structuredClone(this.#defaultValue);
    }

    const content = fs.readFileSync(this.#filePath, 'utf8');
    // 空文件视为「尚未写入任何数据」（历史版本非原子写崩溃的残留形态），
    // 不属于用户数据损坏，直接以默认结构接管即可
    if (!content.trim()) {
      return structuredClone(this.#defaultValue);
    }

    try {
      return JSON.parse(content);
    } catch (err) {
      // 解析失败说明文件内容已损坏。旧实现在这里静默返回默认值，
      // 随后的任意一次写操作都会把默认值覆盖回磁盘——等于无声清空全部数据。
      // 现在改为：把损坏文件隔离改名保留现场（可人工修复找回），再以默认结构继续服务。
      const quarantinePath = `${this.#filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.renameSync(this.#filePath, quarantinePath);
      console.error(
        `[DB] ${path.basename(this.#filePath)} 内容损坏，已隔离至 ${quarantinePath}，将以空数据继续运行:`,
        err
      );
      return structuredClone(this.#defaultValue);
    }
  }
}

const usersStore = new JsonStore(path.join(dbDir, 'users.json'));
const savesIndexStore = new JsonStore(path.join(dbDir, 'saves_index.json'));
const favoritesStore = new JsonStore(path.join(dbDir, 'favorites.json'));

/** @param {string} id 存档 ID（路由层已做过字符白名单校验） */
function saveBinPath(id) {
  return path.join(savesDir, `${id}.bin`);
}

export function initDb() {
  console.log(`[DB] File-based Database initialized at ${dbDir}`);
  usersStore.ensureFileExists();
  savesIndexStore.ensureFileExists();
  favoritesStore.ensureFileExists();
  return true;
}

/** 历史遗留的连接句柄占位（早期为对接真数据库预留），保留以兼容既有调用方。 */
export function getDb() {
  return true;
}

// --- 用户数据库操作 ---

/**
 * 新建或更新用户：首次登录写入 created_at，之后每次登录仅刷新资料与 last_login。
 * @param {DiscordProfile} profile
 */
export function upsertUser({ id, username, discriminator, avatar, global_name }) {
  const users = usersStore.data;
  const now = new Date().toISOString();

  if (users[id]) {
    users[id] = { ...users[id], username, discriminator, avatar, global_name, last_login: now };
  } else {
    users[id] = { id, username, discriminator, avatar, global_name, created_at: now, last_login: now };
  }
  usersStore.save();
}

/**
 * @param {string} id
 * @returns {UserRecord | null}
 */
export function getUser(id) {
  const user = usersStore.data[id];
  return user ? structuredClone(user) : null;
}

// --- 存档数据库操作 ---

/**
 * 某用户全部存档元数据，按最近更新时间倒序。
 * @param {string} userId
 * @returns {SaveMetadata[]}
 */
export function getUserSaves(userId) {
  return Object.values(savesIndexStore.data)
    .filter(save => save.user_id === userId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .map(save => structuredClone(save));
}

/**
 * @param {string} userId
 * @returns {number}
 */
export function getUserSaveCount(userId) {
  return Object.values(savesIndexStore.data).filter(save => save.user_id === userId).length;
}

/**
 * 读取存档元数据及其二进制正文。
 * 索引存在但 .bin 文件缺失或读取失败时返回 null（视为存档不完整、不可用），
 * 与元数据不存在的返回值保持一致，调用方无需区分两种缺失。
 * @param {string} id
 * @returns {SaveRecord | null}
 */
export function getSaveById(id) {
  const saveMeta = savesIndexStore.data[id];
  if (!saveMeta) return null;

  try {
    const save_data = fs.readFileSync(saveBinPath(id));
    return { ...structuredClone(saveMeta), save_data };
  } catch (err) {
    // .bin 缺失（孤儿索引）是已知的可恢复形态，无须刷错误日志；其余 IO 错误照常记录
    if (err.code !== 'ENOENT') {
      console.error(`[DB] Error reading save bin file ${id}:`, err);
    }
    return null;
  }
}

/**
 * 新增存档：先落二进制正文，成功后才写索引，
 * 保证索引里的每一条记录都指向一个已完整存在的 .bin 文件。
 * @param {{ id: string, user_id: string, slot_name: string, preview_data: Object,
 *           save_data: Buffer, size_bytes: number }} save
 */
export function insertSave({ id, user_id, slot_name, preview_data, save_data, size_bytes }) {
  atomicWriteFileSync(saveBinPath(id), save_data);

  const now = new Date().toISOString();
  savesIndexStore.data[id] = { id, user_id, slot_name, preview_data, size_bytes, created_at: now, updated_at: now };
  savesIndexStore.save();
}

/**
 * 部分更新存档：仅显式传入（非 undefined）的字段会被覆盖。
 * 存档不存在时静默返回（历史契约——路由层已先用 getSaveById 校验过归属）。
 * @param {string} id
 * @param {{ slot_name?: string, preview_data?: Object, save_data?: Buffer, size_bytes?: number }} updates
 */
export function updateSave(id, { slot_name, preview_data, save_data, size_bytes }) {
  const index = savesIndexStore.data;
  if (!index[id]) return;

  if (save_data !== undefined) {
    atomicWriteFileSync(saveBinPath(id), save_data);
    index[id].size_bytes = size_bytes;
  }
  if (slot_name !== undefined) {
    index[id].slot_name = slot_name;
  }
  if (preview_data !== undefined) {
    index[id].preview_data = preview_data;
  }

  index[id].updated_at = new Date().toISOString();
  savesIndexStore.save();
}

/**
 * 删除存档：先移除索引（对外立即不可见），再清理二进制文件。
 * .bin 删除失败只记录日志不抛出——索引已删，残留文件不影响正确性，
 * 属于可接受的孤儿文件（历史契约，避免让用户的删除操作报错回滚）。
 * @param {string} id
 */
export function deleteSave(id) {
  const index = savesIndexStore.data;
  if (index[id]) {
    delete index[id];
    savesIndexStore.save();
  }

  try {
    fs.rmSync(saveBinPath(id), { force: true });
  } catch (err) {
    console.error(`[DB] Error deleting save file ${id}:`, err);
  }
}

// --- 音乐收藏数据库操作 ---

/**
 * 歌曲去重主键：不同音乐源的 ID 字段不统一，按 url_id → mid → id 优先级取值。
 * @param {Song} song
 * @returns {string | undefined}
 */
function getSongKey(song) {
  return song.url_id || song.mid || song.id;
}

/**
 * @param {string} userId
 * @returns {Song[]}
 */
export function getUserFavorites(userId) {
  return structuredClone(favoritesStore.data[userId] || []);
}

/**
 * 全量覆盖某用户的收藏列表（客户端同步场景），超限时保留前 N 首。
 * @param {string} userId
 * @param {Song[]} songs 非数组时静默忽略（历史契约）
 */
export function saveUserFavorites(userId, songs) {
  if (!Array.isArray(songs)) return;
  favoritesStore.data[userId] = structuredClone(songs).slice(0, MAX_FAVORITES_PER_USER);
  favoritesStore.save();
}

/**
 * 追加一首收藏（按歌曲主键去重），超限时保留最后 N 首（挤掉最旧的）。
 * @param {string} userId
 * @param {Song} song
 * @returns {Song[]} 该用户最新的收藏列表
 */
export function addUserFavorite(userId, song) {
  const favs = favoritesStore.data;
  const list = favs[userId] || [];
  const key = getSongKey(song);
  const exists = list.some(f => getSongKey(f) === key);
  if (!exists) {
    list.push(structuredClone(song));
    favs[userId] = list.slice(-MAX_FAVORITES_PER_USER);
    favoritesStore.save();
  }
  return structuredClone(favs[userId]);
}

/**
 * 按歌曲主键移除一首收藏。
 * @param {string} userId
 * @param {string} songId
 * @returns {Song[]} 该用户最新的收藏列表
 */
export function removeUserFavorite(userId, songId) {
  const favs = favoritesStore.data;
  const list = favs[userId] || [];
  favs[userId] = list.filter(f => getSongKey(f) !== songId);
  favoritesStore.save();
  return structuredClone(favs[userId]);
}
