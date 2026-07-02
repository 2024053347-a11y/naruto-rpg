import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname);
const savesDir = path.join(dbDir, 'saves');
const usersFilePath = path.join(dbDir, 'users.json');
const indexFilePath = path.join(dbDir, 'saves_index.json');
const favoritesFilePath = path.join(dbDir, 'favorites.json');

// 确保数据库目录和存档目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
if (!fs.existsSync(savesDir)) {
  fs.mkdirSync(savesDir, { recursive: true });
}

// 辅助函数：安全的读取 JSON 文件
function readJsonFile(filePath, defaultVal = {}) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        // 如果文件因为正在被写入而暂时为空，抛出错误以触发重试
        if (!content.trim()) {
          throw new Error('File is empty (possibly being written)');
        }
        return JSON.parse(content);
      }
      return defaultVal;
    } catch (err) {
      lastErr = err;
      // 遇到文件锁定或为空的情况，同步阻塞等待 50ms 后再试
      const start = Date.now();
      while (Date.now() - start < 50) {}
    }
  }
  console.error(`[DB] Error reading JSON file ${filePath} after 5 retries:`, lastErr);
  return defaultVal;
}

// 辅助函数：安全的写入 JSON 文件
function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[DB] Error writing JSON file ${filePath}:`, err);
  }
}

export function initDb() {
  console.log(`[DB] File-based Database initialized at ${dbDir}`);
  // 确保初始文件存在
  if (!fs.existsSync(usersFilePath)) writeJsonFile(usersFilePath, {});
  if (!fs.existsSync(indexFilePath)) writeJsonFile(indexFilePath, {});
  if (!fs.existsSync(favoritesFilePath)) writeJsonFile(favoritesFilePath, {});
  return true;
}

export function getDb() {
  return true;
}

// --- 用户数据库操作 ---

export function upsertUser({ id, username, discriminator, avatar, global_name }) {
  const users = readJsonFile(usersFilePath);
  const now = new Date().toISOString();
  
  if (users[id]) {
    users[id] = {
      ...users[id],
      username,
      discriminator,
      avatar,
      global_name,
      last_login: now
    };
  } else {
    users[id] = {
      id,
      username,
      discriminator,
      avatar,
      global_name,
      created_at: now,
      last_login: now
    };
  }
  writeJsonFile(usersFilePath, users);
}

export function getUser(id) {
  const users = readJsonFile(usersFilePath);
  return users[id] || null;
}

// --- 存档数据库操作 ---

export function getUserSaves(userId) {
  const index = readJsonFile(indexFilePath);
  return Object.values(index)
    .filter(save => save.user_id === userId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

export function getUserSaveCount(userId) {
  const index = readJsonFile(indexFilePath);
  return Object.values(index).filter(save => save.user_id === userId).length;
}

export function getSaveById(id) {
  const index = readJsonFile(indexFilePath);
  const saveMeta = index[id];
  if (!saveMeta) return null;

  const saveFilePath = path.join(savesDir, `${id}.bin`);
  try {
    if (fs.existsSync(saveFilePath)) {
      const save_data = fs.readFileSync(saveFilePath);
      return {
        ...saveMeta,
        save_data
      };
    }
  } catch (err) {
    console.error(`[DB] Error reading save bin file ${id}:`, err);
  }
  return null;
}

export function insertSave({ id, user_id, slot_name, preview_data, save_data, size_bytes }) {
  // 1. 写入二进制存档数据
  const saveFilePath = path.join(savesDir, `${id}.bin`);
  fs.writeFileSync(saveFilePath, save_data);

  // 2. 写入索引元数据
  const index = readJsonFile(indexFilePath);
  const now = new Date().toISOString();
  
  index[id] = {
    id,
    user_id,
    slot_name,
    preview_data,
    size_bytes,
    created_at: now,
    updated_at: now
  };
  
  writeJsonFile(indexFilePath, index);
}

export function updateSave(id, { slot_name, preview_data, save_data, size_bytes }) {
  const index = readJsonFile(indexFilePath);
  if (!index[id]) return;

  // 1. 如果有新的存档数据，更新二进制文件
  if (save_data !== undefined) {
    const saveFilePath = path.join(savesDir, `${id}.bin`);
    fs.writeFileSync(saveFilePath, save_data);
    index[id].size_bytes = size_bytes;
  }

  // 2. 更新元数据
  if (slot_name !== undefined) {
    index[id].slot_name = slot_name;
  }
  if (preview_data !== undefined) {
    index[id].preview_data = preview_data;
  }
  
  index[id].updated_at = new Date().toISOString();
  writeJsonFile(indexFilePath, index);
}

export function deleteSave(id) {
  // 1. 删除索引
  const index = readJsonFile(indexFilePath);
  if (index[id]) {
    delete index[id];
    writeJsonFile(indexFilePath, index);
  }

  // 2. 删除对应的物理二进制存档文件
  const saveFilePath = path.join(savesDir, `${id}.bin`);
  try {
    if (fs.existsSync(saveFilePath)) {
      fs.unlinkSync(saveFilePath);
    }
  } catch (err) {
    console.error(`[DB] Error deleting save file ${id}:`, err);
  }
}

// --- 音乐收藏数据库操作 ---

export function getUserFavorites(userId) {
  const favs = readJsonFile(favoritesFilePath);
  return favs[userId] || [];
}

export function saveUserFavorites(userId, songs) {
  const favs = readJsonFile(favoritesFilePath);
  if (!Array.isArray(songs)) return;
  favs[userId] = songs.slice(0, 100);
  writeJsonFile(favoritesFilePath, favs);
}

export function addUserFavorite(userId, song) {
  const favs = readJsonFile(favoritesFilePath);
  const list = favs[userId] || [];
  const sid = song.url_id || song.mid || song.id;
  const exists = list.some(f => (f.url_id || f.mid || f.id) === sid);
  if (!exists) {
    list.push(song);
    favs[userId] = list.slice(-100);
    writeJsonFile(favoritesFilePath, favs);
  }
  return favs[userId];
}

export function removeUserFavorite(userId, songId) {
  const favs = readJsonFile(favoritesFilePath);
  const list = favs[userId] || [];
  favs[userId] = list.filter(f => (f.url_id || f.mid || f.id) !== songId);
  writeJsonFile(favoritesFilePath, favs);
  return favs[userId];
}
