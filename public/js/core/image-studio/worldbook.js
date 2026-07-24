export const IMAGE_WORLDBOOK_SCHEMA = 'naruto.image-worldbook/v1';

function slug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

function keys(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

function promptParts(entry) {
  const content = String(entry.content ?? entry.prompt ?? '');
  const explicitNegative = String(entry.negativePrompt ?? entry.negative_prompt ?? '');
  if (explicitNegative) return { content, negativePrompt: explicitNegative };
  const marker = /(?:^|\n)\s*Negative prompt:\s*/i.exec(content);
  if (!marker) return { content, negativePrompt: '' };
  return {
    content: content.slice(0, marker.index).trimEnd(),
    negativePrompt: content.slice(marker.index + marker[0].length).trim()
  };
}

export function normalizeImageWorldbookEntry(entry = {}, fallbackId = '') {
  const id = String(entry.id ?? entry.uid ?? fallbackId ?? '').trim()
    || `entry-${slug(entry.comment || entry.name || keys(entry.key)[0]) || Math.random().toString(36).slice(2)}`;
  const primaryKeys = keys(entry.keys ?? entry.key);
  const secondaryKeys = keys(entry.secondaryKeys ?? entry.keysecondary ?? entry.keySecondary);
  const prompts = promptParts(entry);
  return {
    id,
    name: String(entry.name ?? entry.comment ?? id),
    keys: primaryKeys,
    secondaryKeys,
    content: prompts.content,
    negativePrompt: prompts.negativePrompt,
    enabled: entry.enabled !== false && entry.disable !== true,
    constant: entry.constant === true || entry.alwaysActive === true,
    priority: Number.isFinite(Number(entry.priority ?? entry.order)) ? Number(entry.priority ?? entry.order) : 100,
    deleted: entry.deleted === true
  };
}

export function importImageWorldbook(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  let rawEntries;
  if (Array.isArray(parsed)) rawEntries = parsed;
  else if (Array.isArray(parsed?.entries)) rawEntries = parsed.entries;
  else if (parsed?.entries && typeof parsed.entries === 'object') rawEntries = Object.values(parsed.entries);
  else throw new TypeError('Image worldbook must contain an entries array or object');
  const ids = new Set();
  const entries = rawEntries.map((entry, index) => normalizeImageWorldbookEntry(entry, `entry-${index + 1}`))
    .map(entry => {
      let id = entry.id;
      let suffix = 2;
      while (ids.has(id)) id = `${entry.id}-${suffix++}`;
      ids.add(id);
      return { ...entry, id };
    });
  return { schema: IMAGE_WORLDBOOK_SCHEMA, version: 1, entries };
}

export function normalizeImageWorldbook(input = {}) {
  if (!input || (!Array.isArray(input) && !input.entries)) {
    return { schema: IMAGE_WORLDBOOK_SCHEMA, version: 1, entries: [] };
  }
  return importImageWorldbook(input);
}

export function mergeImageWorldbooks(globalBook, overlayBook) {
  const base = normalizeImageWorldbook(globalBook);
  const overlay = normalizeImageWorldbook(overlayBook);
  const merged = new Map(base.entries.map(entry => [entry.id, entry]));
  for (const entry of overlay.entries) {
    if (entry.deleted) merged.delete(entry.id);
    else merged.set(entry.id, { ...merged.get(entry.id), ...entry });
  }
  return {
    schema: IMAGE_WORLDBOOK_SCHEMA,
    version: 1,
    entries: [...merged.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  };
}

export function matchImageWorldbook(book, context) {
  const haystack = typeof context === 'string' ? context : JSON.stringify(context || {});
  const normalizedHaystack = haystack.toLocaleLowerCase();
  return normalizeImageWorldbook(book).entries
    .filter(entry => {
      if (!entry.enabled || entry.deleted
        || (!entry.content.trim() && !entry.negativePrompt.trim())) return false;
      if (entry.constant) return true;
      if (!entry.keys.length) return false;
      const primary = entry.keys.some(key => normalizedHaystack.includes(key.toLocaleLowerCase()));
      if (!primary) return false;
      return !entry.secondaryKeys.length
        || entry.secondaryKeys.some(key => normalizedHaystack.includes(key.toLocaleLowerCase()));
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function renderImageWorldbook(book, context) {
  return matchImageWorldbook(book, context).map(entry => entry.content.trim()).join('\n');
}

export function renderImageWorldbookPrompts(book, context) {
  const matches = matchImageWorldbook(book, context);
  return {
    prompt: matches.map(entry => entry.content.trim()).filter(Boolean).join('\n'),
    negativePrompt: matches.map(entry => entry.negativePrompt.trim()).filter(Boolean).join(', ')
  };
}

export function exportImageWorldbook(book, format = 'native') {
  const normalized = normalizeImageWorldbook(book);
  if (format === 'native') return normalized;
  if (format !== 'sillytavern') throw new TypeError(`Unsupported image worldbook format: ${format}`);
  return {
    entries: Object.fromEntries(normalized.entries.map((entry, index) => [String(index), {
      uid: index,
      comment: entry.name,
      key: entry.keys,
      keysecondary: entry.secondaryKeys,
      content: entry.negativePrompt
        ? `${entry.content}\n\nNegative prompt: ${entry.negativePrompt}`
        : entry.content,
      disable: !entry.enabled,
      constant: entry.constant,
      order: entry.priority
    }]))
  };
}

export class ImageWorldbookStore {
  constructor({ storage = globalThis.localStorage, key = 'naruto_rpg_image_worldbook_v1' } = {}) {
    this.storage = storage;
    this.key = key;
    this.memoryValue = normalizeImageWorldbook();
  }

  load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) this.memoryValue = normalizeImageWorldbook(JSON.parse(raw));
    } catch { /* memory fallback */ }
    return this.memoryValue;
  }

  save(value) {
    this.memoryValue = normalizeImageWorldbook(value);
    try { this.storage?.setItem(this.key, JSON.stringify(this.memoryValue)); } catch { /* memory fallback */ }
    return this.memoryValue;
  }
}
