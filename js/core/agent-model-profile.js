const STABLE_DEEPSEEK_V4_FLASH = 'deepseek-v4-flash';
const UNSUPPORTED_RELEASE_TAG = /(?:^|[-_.:])(free|preview|beta|experimental)(?:$|[-_.:])/i;

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function modelName(model) {
  const segments = normalizeText(model).split('/').filter(Boolean);
  return segments.at(-1) || '';
}

function compareText(a, b) {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);
  if (normalizedA < normalizedB) return -1;
  if (normalizedA > normalizedB) return 1;

  const originalA = String(a ?? '');
  const originalB = String(b ?? '');
  if (originalA < originalB) return -1;
  if (originalA > originalB) return 1;
  return 0;
}

export function isStableDeepSeekV4Flash(model) {
  const name = modelName(model);
  if (!name || UNSUPPORTED_RELEASE_TAG.test(name)) return false;
  return name === STABLE_DEEPSEEK_V4_FLASH;
}

export function compareAgentModelsByPreference(a, b, backend = '') {
  void backend;
  const preferredA = isStableDeepSeekV4Flash(a);
  const preferredB = isStableDeepSeekV4Flash(b);
  if (preferredA !== preferredB) return preferredA ? -1 : 1;
  return compareText(a, b);
}

export function resolveAgentConcurrency({ configured } = {}) {
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(10, Math.max(1, Math.trunc(parsed)));
}
