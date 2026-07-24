// ARC/THR identifiers intentionally span multiple days. Only concrete future
// day/scene/event IDs are exclusive enough to be hard blockers.
const FUTURE_ID_PATTERN = /\b(?:DAY|SCN|EV)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi;

// Protected-future records evolve over time, so an allowlist is safer than
// enumerating narrative fields. Everything except structural metadata is a
// protected leaf (including participants, locations, reference_facts and
// source-material contribution/reference text). Array items inherit the
// parent field name.
const SAFE_METADATA_FIELDS = new Set([
  'schema', 'version',
  'date', 'current_date', 'target_date', 'from', 'to', 'as_of',
  'arc_id', 'thread_id', 'entity_id', 'location_id', 'organization_id',
  'causal_role', 'resolution_mode', 'kind', 'status', 'visibility', 'order',
  'source'
]);

const SHORT_PROTECTED_FIELDS = new Set(['name', 'participants', 'location']);

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\\"'“”‘’`，。！？；：、,.!?;:—\-（）()\[\]{}]/g, '');
}

function unicodeEscape(value) {
  return [...String(value || '')]
    .map(character => {
      const point = character.codePointAt(0);
      if (point <= 0xffff) return `\\u${point.toString(16).padStart(4, '0')}`;
      const adjusted = point - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      return `\\u${high.toString(16)}\\u${low.toString(16)}`;
    })
    .join('');
}

function outputText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function cloneGuardValue(value) {
  if (value == null) return null;
  if (typeof globalThis.structuredClone === 'function') {
    try { return globalThis.structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

/**
 * Snapshot the current turn's guard inputs before an auxiliary async request.
 * Later turns replace the pipeline evidence packet, so retaining live object
 * references would validate the response against the wrong future boundary.
 */
export function captureProtectedFutureGuardContext({
  protectedFuture = null,
  allowedEvidence = null
} = {}) {
  return deepFreeze({
    protectedFuture: cloneGuardValue(protectedFuture),
    allowedEvidence: cloneGuardValue(allowedEvidence)
  });
}

function addMarker(markers, seen, value, kind, path, minLength = 4) {
  const text = String(value || '').trim();
  const normalized = normalizeComparable(text);
  if (normalized.length < minLength) return;
  const key = `${kind}\u0000${normalized}`;
  if (seen.has(key)) return;
  seen.add(key);
  markers.push({ kind, path, value: text, normalized });
}

/** Collect exact protected-future identifiers and narrative facts. */
export function collectProtectedFutureMarkers(protectedFuture, { allowedEvidence = null } = {}) {
  if (!protectedFuture || typeof protectedFuture !== 'object') return [];
  const markers = [];
  const seen = new Set();
  const visit = (value, field = '', path = 'protected_future') => {
    if (value == null) return;
    if (typeof value === 'string') {
      FUTURE_ID_PATTERN.lastIndex = 0;
      for (const match of value.matchAll(FUTURE_ID_PATTERN)) {
        addMarker(markers, seen, match[0], 'id', path);
      }
      if (field === 'id' || field.endsWith('_id') || SAFE_METADATA_FIELDS.has(field)) return;
      addMarker(
        markers,
        seen,
        value,
        'detail',
        path,
        SHORT_PROTECTED_FIELDS.has(field) ? 2 : 4
      );
      for (const fragment of value.split(/[\n。！？；;，,]+/)) {
        if (normalizeComparable(fragment).length >= 8) {
          addMarker(markers, seen, fragment, 'detail', `${path}#fragment`, 8);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, field, `${path}[${index}]`));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      visit(item, String(key).toLowerCase(), `${path}.${key}`);
    }
  };
  visit(protectedFuture);
  if (allowedEvidence == null) return markers;
  const allowed = normalizeComparable(outputText(allowedEvidence));
  return markers.filter(marker => !allowed.includes(marker.normalized));
}

export function findProtectedFutureLeak(value, protectedFuture, { allowedEvidence = null } = {}) {
  const source = outputText(value);
  if (!source) return null;
  const normalizedSource = normalizeComparable(source);
  const escapedSource = source.toLowerCase();
  for (const marker of collectProtectedFutureMarkers(protectedFuture, { allowedEvidence })) {
    if (normalizedSource.includes(marker.normalized)) return marker;
    const escapedMarker = unicodeEscape(marker.value).toLowerCase();
    if (escapedMarker && escapedSource.includes(escapedMarker)) return marker;
  }
  return null;
}

/**
 * Hard, local guard used at every Planner handoff and final commit boundary.
 * It never calls a model and deliberately omits the leaked future text from
 * the thrown error so error UI/logging cannot become another spoiler channel.
 */
export function assertNoProtectedFutureLeak(value, protectedFuture, {
  stage = 'output', allowedEvidence = null
} = {}) {
  const leak = findProtectedFutureLeak(value, protectedFuture, { allowedEvidence });
  if (!leak) return true;
  const error = new Error(`受保护未来隔离失败：${stage} 含有未来${leak.kind === 'id' ? '事件标识' : '剧情细节'}`);
  error.code = 'PROTECTED_FUTURE_LEAK';
  error.stage = stage;
  error.markerKind = leak.kind;
  error.markerPath = leak.path;
  throw error;
}

export default assertNoProtectedFutureLeak;
