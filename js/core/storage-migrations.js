export const STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_SCHEMA_KEY = 'naruto_storage_schema_version';

const REBUILDABLE_CACHE_KEYS = Object.freeze([
  'naruto_worldbook',
  'naruto_timeline_summary'
]);

export function migrateStorage(storage = globalThis.localStorage) {
  if (!storage) return { migrated: false, from: 0, to: STORAGE_SCHEMA_VERSION };
  const from = Number.parseInt(storage.getItem(STORAGE_SCHEMA_KEY) || '0', 10) || 0;
  if (from >= STORAGE_SCHEMA_VERSION) {
    return { migrated: false, from, to: STORAGE_SCHEMA_VERSION };
  }
  for (const key of REBUILDABLE_CACHE_KEYS) storage.removeItem(key);
  storage.setItem(STORAGE_SCHEMA_KEY, String(STORAGE_SCHEMA_VERSION));
  return { migrated: true, from, to: STORAGE_SCHEMA_VERSION };
}
