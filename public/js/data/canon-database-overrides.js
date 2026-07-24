import { CANON_PLOT_DAYS, CANON_TECHNIQUES } from './generated/canon-runtime-data.js';

export const CANON_DATABASE_KINDS = Object.freeze({ plot: 'plot', techniques: 'techniques' });
export const CANON_OVERRIDE_STORAGE_KEYS = Object.freeze({
  plot: 'naruto_project_timeline_overrides_v2',
  techniques: 'naruto_canon_technique_overrides_v1'
});

const STORE_VERSIONS = Object.freeze({ plot: 2, techniques: 1 });
const BASE_RECORDS = Object.freeze({ plot: CANON_PLOT_DAYS, techniques: CANON_TECHNIQUES });
const cache = {
  plot: { raw: null, store: null, records: null, allRecords: null },
  techniques: { raw: null, store: null, records: null, allRecords: null }
};
let revision = 0;

function assertKind(kind) {
  if (!CANON_OVERRIDE_STORAGE_KEYS[kind]) throw new Error(`未知数据库类型: ${kind}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readRaw(kind) {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(CANON_OVERRIDE_STORAGE_KEYS[kind]) || '';
  } catch {
    return '';
  }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    disabled: entry.disabled === true,
    custom: entry.custom === true,
    value: entry.value && typeof entry.value === 'object' ? clone(entry.value) : null
  };
}

function normalizeStore(kind, raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const records = {};
  for (const [id, entry] of Object.entries(source.records || {})) {
    const normalized = normalizeEntry(entry);
    if (id && normalized) records[id] = normalized;
  }
  return { version: STORE_VERSIONS[kind], records };
}

function loadStore(kind) {
  assertKind(kind);
  const raw = readRaw(kind);
  if (cache[kind].raw === raw && cache[kind].store) return cache[kind].store;
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
  const store = normalizeStore(kind, parsed);
  cache[kind] = { raw, store, records: null, allRecords: null };
  return store;
}

function mergeRecord(base, override) {
  const value = override?.value || {};
  return {
    ...base,
    ...value,
    access: { ...(base?.access || {}), ...(value.access || {}) },
    availability: { ...(base?.availability || {}), ...(value.availability || {}) },
    _database: {
      custom: override?.custom === true,
      overridden: Boolean(override?.value),
      disabled: override?.disabled === true
    }
  };
}

function writeStore(kind, store) {
  assertKind(kind);
  const normalized = normalizeStore(kind, store);
  try {
    if (typeof localStorage === 'undefined') throw new Error('当前环境不支持本地存储');
    localStorage.setItem(CANON_OVERRIDE_STORAGE_KEYS[kind], JSON.stringify(normalized));
  } catch (error) {
    throw new Error(`数据库修改保存失败: ${error.message}`);
  }
  revision++;
  cache[kind] = { raw: null, store: null, records: null, allRecords: null };
  return clone(normalized);
}

export function getCanonBaseRecords(kind) {
  assertKind(kind);
  return BASE_RECORDS[kind];
}

export function getCanonOverrideStore(kind) {
  return clone(loadStore(kind));
}

export function getCanonRecords(kind, { includeDisabled = false } = {}) {
  assertKind(kind);
  const store = loadStore(kind);
  if (!cache[kind].allRecords) {
    const base = BASE_RECORDS[kind];
    const baseIds = new Set(base.map(record => record.id));
    const allRecords = base.map(record => mergeRecord(record, store.records[record.id]));
    for (const [id, override] of Object.entries(store.records)) {
      if (baseIds.has(id) || !override.custom || !override.value) continue;
      allRecords.push(mergeRecord({ id }, override));
    }
    cache[kind].allRecords = allRecords;
  }
  if (includeDisabled) return cache[kind].allRecords;
  cache[kind].records ||= cache[kind].allRecords.filter(record => !record._database.disabled);
  return cache[kind].records;
}

export function getCanonRecord(kind, id, { includeDisabled = true } = {}) {
  return getCanonRecords(kind, { includeDisabled }).find(record => record.id === id) || null;
}

export function saveCanonRecord(kind, record) {
  assertKind(kind);
  if (!record?.id) throw new Error('记录缺少稳定 ID');
  const store = getCanonOverrideStore(kind);
  const isCustom = !BASE_RECORDS[kind].some(item => item.id === record.id);
  const previous = store.records[record.id] || {};
  store.records[record.id] = {
    disabled: previous.disabled === true,
    custom: isCustom,
    value: clone(record)
  };
  delete store.records[record.id].value._database;
  return writeStore(kind, store);
}

export function setCanonRecordEnabled(kind, id, enabled) {
  assertKind(kind);
  const store = getCanonOverrideStore(kind);
  const isCustom = !BASE_RECORDS[kind].some(item => item.id === id);
  const previous = store.records[id] || { custom: isCustom, value: isCustom ? getCanonRecord(kind, id) : null };
  previous.disabled = enabled !== true;
  previous.custom = isCustom;
  if (enabled && !previous.value && !isCustom) delete store.records[id];
  else store.records[id] = previous;
  return writeStore(kind, store);
}

export function resetCanonRecord(kind, id) {
  const store = getCanonOverrideStore(kind);
  delete store.records[id];
  return writeStore(kind, store);
}

export function replaceCanonOverrideStore(kind, payload) {
  return writeStore(kind, payload);
}

export function clearCanonOverrides(kind) {
  return writeStore(kind, { version: STORE_VERSIONS[kind], records: {} });
}

export function getCanonDatabaseStats(kind) {
  assertKind(kind);
  const store = loadStore(kind);
  const entries = Object.values(store.records);
  return {
    base: BASE_RECORDS[kind].length,
    effective: getCanonRecords(kind).length,
    modified: entries.filter(entry => entry.value && !entry.custom).length,
    custom: entries.filter(entry => entry.custom && entry.value).length,
    disabled: entries.filter(entry => entry.disabled).length
  };
}

export function getCanonDatabaseRevision() {
  return revision;
}
