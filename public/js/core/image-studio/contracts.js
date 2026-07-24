export const IMAGE_CONTRACT_SCHEMA = 'naruto.visual-contract/v1';
export const IMAGE_CONTRACT_TAG = 'image_contract';

const BARE_SCHEMA_PATTERN = /"schema"\s*:\s*"naruto\.visual-contract\/v1"/g;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateImageContract(value) {
  const errors = [];
  if (!isObject(value)) return { valid: false, errors: ['Contract must be an object'], value: null };
  if (value.schema !== IMAGE_CONTRACT_SCHEMA) errors.push(`schema must be ${IMAGE_CONTRACT_SCHEMA}`);
  if (!['turn_illustration', 'portrait'].includes(value.purpose)) {
    errors.push('purpose must be turn_illustration or portrait');
  }
  if (!isObject(value.scene) || !text(value.scene.summary)) errors.push('scene.summary is required');
  if (!isObject(value.shot)) errors.push('shot must be an object');
  if (!Array.isArray(value.subjects)) errors.push('subjects must be an array');
  else value.subjects.forEach((subject, index) => {
    if (!isObject(subject)) errors.push(`subjects[${index}] must be an object`);
    else if (!text(subject.name) && !text(subject.id)) errors.push(`subjects[${index}] requires name or id`);
  });
  if (!(isObject(value.style) || text(value.style))) errors.push('style must be a non-empty string or object');
  if (!isObject(value.continuity)) errors.push('continuity must be an object');
  return { valid: errors.length === 0, errors, value: errors.length ? null : value };
}

function findTaggedContractRange(source, includeIncomplete = false) {
  const openPattern = /<image_contract\b[^>]*>/i;
  const open = openPattern.exec(source);
  if (!open) return null;
  const bodyStart = open.index + open[0].length;
  const closePattern = /<\/image_contract\s*>/ig;
  closePattern.lastIndex = bodyStart;
  const close = closePattern.exec(source);
  if (!close) return includeIncomplete
    ? { start: open.index, end: source.length, body: source.slice(bodyStart), complete: false, format: 'tagged' }
    : null;
  return {
    start: open.index,
    end: close.index + close[0].length,
    body: source.slice(bodyStart, close.index),
    complete: true,
    format: 'tagged'
  };
}

function findEnclosingObjectStart(source, targetIndex) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < targetIndex; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') stack.push({ char, index });
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.at(-1)?.char === expected) stack.pop();
    }
  }

  if (inString) return -1;
  for (let index = stack.length - 1; index >= 0; index--) {
    if (stack[index].char === '{') return stack[index].index;
  }
  return -1;
}

function findJsonObjectEnd(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function findSchemaFirstObjectStart(source, markerIndex) {
  let index = markerIndex - 1;
  while (index >= 0 && /\s/.test(source[index])) index--;
  return source[index] === '{' ? index : -1;
}

function findBareContractRange(source, includeIncomplete = false) {
  BARE_SCHEMA_PATTERN.lastIndex = 0;
  let marker;
  while ((marker = BARE_SCHEMA_PATTERN.exec(source))) {
    // The public contract format requires schema to be the first key. Locate
    // that common form locally so an unmatched quote in preceding prose cannot
    // poison JSON scanning; retain the structural fallback for reordered keys.
    const schemaFirstStart = findSchemaFirstObjectStart(source, marker.index);
    const start = schemaFirstStart >= 0
      ? schemaFirstStart
      : findEnclosingObjectStart(source, marker.index);
    if (start < 0) continue;
    const end = findJsonObjectEnd(source, start);
    if (end < 0) {
      return includeIncomplete
        ? { start, end: source.length, body: source.slice(start), complete: false, format: 'bare' }
        : null;
    }
    return { start, end, body: source.slice(start, end), complete: true, format: 'bare' };
  }
  return null;
}

function findContractRange(source, includeIncomplete = false) {
  const tagged = findTaggedContractRange(source, includeIncomplete);
  const bare = findBareContractRange(source, includeIncomplete);
  if (!tagged) return bare;
  if (!bare) return tagged;
  return tagged.start <= bare.start ? tagged : bare;
}

function removeAllContracts(source, includeIncomplete) {
  let clean = source;
  while (true) {
    const range = findContractRange(clean, includeIncomplete);
    if (!range) break;
    clean = clean.slice(0, range.start) + clean.slice(range.end);
    if (!range.complete) break;
  }
  return clean;
}

function consumeLiteralPrefix(source, index, literal) {
  for (let offset = 0; offset < literal.length; offset++) {
    if (index + offset >= source.length) return { prefix: true, index: source.length };
    if (source[index + offset] !== literal[offset]) return { prefix: false, index };
  }
  return { prefix: true, index: index + literal.length };
}

function skipWhitespace(source, index) {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
  return cursor;
}

function isBareContractStartPrefix(source) {
  if (!source.startsWith('{')) return false;
  let index = skipWhitespace(source, 1);

  let consumed = consumeLiteralPrefix(source, index, '"schema"');
  if (!consumed.prefix) return false;
  if (consumed.index === source.length) return true;
  index = skipWhitespace(source, consumed.index);
  if (index === source.length) return true;
  if (source[index] !== ':') return false;

  index = skipWhitespace(source, index + 1);
  if (index === source.length) return true;
  consumed = consumeLiteralPrefix(source, index, `"${IMAGE_CONTRACT_SCHEMA}"`);
  return consumed.prefix && consumed.index === source.length;
}

export function stripImageContracts(source, { streaming = false } = {}) {
  const value = String(source ?? '');
  // A recognised but truncated contract is still private machine output and
  // must never become visible, including after a cancelled/failed response.
  let clean = removeAllContracts(value, true);
  if (streaming) {
    // Withhold a split opening tag (for example "<image_con") until it can be
    // proven to be ordinary narrative text.
    const lastOpen = clean.lastIndexOf('<');
    if (lastOpen >= 0) {
      const tail = clean.slice(lastOpen).toLowerCase();
      if ('<image_contract'.startsWith(tail) || /^<image_contract(?:\s[^>]*)?$/.test(tail)) {
        clean = clean.slice(0, lastOpen);
      }
    }

    // Models occasionally omit <image_contract> and append the JSON object
    // directly. Hold a schema-first JSON prefix until it is either proven to
    // be ordinary text or recognised and removed as a visual contract.
    for (let start = clean.lastIndexOf('{'); start >= 0; start = clean.lastIndexOf('{', start - 1)) {
      if (isBareContractStartPrefix(clean.slice(start))) {
        clean = clean.slice(0, start);
        break;
      }
    }
  }
  return clean;
}

export function extractImageContract(source) {
  const raw = String(source ?? '');
  const range = findContractRange(raw, false);
  if (!range) {
    return { cleanText: stripImageContracts(raw, { streaming: true }), contract: null, error: null, rawContract: null };
  }
  let contract = null;
  let error = null;
  try {
    const parsed = JSON.parse(range.body.trim());
    const result = validateImageContract(parsed);
    if (!result.valid) throw new TypeError(result.errors.join('; '));
    contract = result.value;
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
  }
  return {
    cleanText: removeAllContracts(raw, true).trimEnd(),
    contract,
    error,
    rawContract: range.body.trim()
  };
}

export class ImageContractStreamFilter {
  constructor() {
    this.raw = '';
    this.visible = '';
    this.emittedLength = 0;
  }

  push(chunk) {
    this.raw += String(chunk ?? '');
    this.visible = stripImageContracts(this.raw, { streaming: true });
    // Contracts can start after visible content, so only emit an append-only
    // prefix. Once the filter enters a hidden contract it emits nothing.
    if (this.visible.length < this.emittedLength) return '';
    const delta = this.visible.slice(this.emittedLength);
    this.emittedLength = this.visible.length;
    return delta;
  }

  finish() {
    const extracted = extractImageContract(this.raw);
    const delta = extracted.cleanText.length >= this.emittedLength
      ? extracted.cleanText.slice(this.emittedLength)
      : '';
    this.visible = extracted.cleanText;
    this.emittedLength = extracted.cleanText.length;
    return { ...extracted, delta };
  }
}

function flattenText(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (isObject(value)) return Object.values(value).flatMap(flattenText);
  return [String(value)];
}

function flattenTextExcept(value, excludedKeys) {
  if (!isObject(value)) return flattenText(value);
  const excluded = new Set(excludedKeys);
  return Object.entries(value)
    .filter(([key]) => !excluded.has(key))
    .flatMap(([, item]) => flattenText(item));
}

export function contractToPrompt(contract, { worldbookText = '', visualProfiles = {} } = {}) {
  const checked = validateImageContract(contract);
  if (!checked.valid) throw new TypeError(checked.errors.join('; '));
  const subjectLines = contract.subjects.map(subject => {
    const profile = visualProfiles[subject.id] || visualProfiles[subject.name] || null;
    return [subject.name || subject.id, ...flattenText(subject.appearance), ...flattenText(subject.pose),
      ...flattenText(subject.expression), ...flattenText(subject.continuity), ...flattenText(profile)]
      .filter(Boolean).join(', ');
  });
  const prompt = [
    ...flattenText(contract.scene),
    ...flattenText(contract.shot),
    ...subjectLines,
    ...flattenTextExcept(contract.style, ['negative']),
    ...flattenTextExcept(contract.continuity, ['avoid']),
    String(worldbookText || '').trim()
  ].filter(Boolean).join('\n');
  const negativePrompt = [
    ...flattenText(contract.style?.negative),
    ...flattenText(contract.continuity?.avoid)
  ].join(', ');
  return { prompt, negativePrompt };
}
