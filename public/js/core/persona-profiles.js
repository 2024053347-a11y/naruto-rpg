import { normalizeOpeningDraft } from '../systems/opening-draft.js';

/**
 * 人设方案存储：一组可命名的「开局人设」草稿，长期保存在个人中心。
 * 每份方案 = { id, name, savedAt, draft }，draft 用 opening-draft 的 normalize 规范化，
 * 开局向导可据此恢复/切换人设，不必每次重写。
 */

const PROFILES_KEY = 'naruto_persona_profiles';

function readRaw(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('[PersonaProfiles] 持久化失败:', error?.message || error);
    return false;
  }
}

function readProfiles() {
  const raw = readRaw(PROFILES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn('[PersonaProfiles] 人设数据损坏，忽略');
    return [];
  }
}

function writeProfiles(profiles) {
  writeRaw(PROFILES_KEY, JSON.stringify(profiles));
}

function generateProfileId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `persona-${suffix}`;
}

/** 列出人设摘要（不含草稿本体）。 */
export async function listPersonaProfiles() {
  return readProfiles().map(({ id, name, savedAt }) => ({
    id: String(id || ''),
    name: String(name || '未命名人设'),
    savedAt: Number(savedAt) || 0
  }));
}

/** 取完整人设方案（含 draft）。不存在返回 null。 */
export async function getPersonaProfile(id) {
  const profile = readProfiles().find(item => item.id === id);
  return profile ? { ...profile } : null;
}

/**
 * 新建或更新人设方案。
 * @param {{id?:string, name:string, draft:object}} input
 * @returns {Promise<string|null>} 方案 id；未知 id 更新返回 null。
 */
export async function savePersonaProfile({ id, name, draft } = {}) {
  const profiles = readProfiles();
  const cleanDraft = normalizeOpeningDraft(draft || {});
  const normalizedName = String(name || '未命名人设');

  if (id) {
    const index = profiles.findIndex(item => item.id === id);
    if (index === -1) return null;
    profiles[index] = {
      ...profiles[index],
      name: normalizedName,
      draft: cleanDraft,
      savedAt: Date.now()
    };
    writeProfiles(profiles);
    return id;
  }

  const profile = {
    id: generateProfileId(),
    name: normalizedName,
    savedAt: Date.now(),
    draft: cleanDraft
  };
  profiles.push(profile);
  writeProfiles(profiles);
  return profile.id;
}

/** 删除人设方案。 */
export async function deletePersonaProfile(id) {
  const profiles = readProfiles();
  const next = profiles.filter(item => item.id !== id);
  if (next.length === profiles.length) return false;
  writeProfiles(next);
  return true;
}
