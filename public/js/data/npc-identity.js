const FORBIDDEN_NPC_IDENTITIES = new Set(['__proto__', 'prototype', 'constructor']);

export const NPC_IDENTITY_MAX_LENGTH = 64;

export function normalizeNpcIdentity(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim();
  const length = [...normalized].length;
  if (!length || length > NPC_IDENTITY_MAX_LENGTH) return '';
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(normalized)) return '';
  if (FORBIDDEN_NPC_IDENTITIES.has(normalized.toLowerCase())) return '';
  return normalized;
}

export function isSafeNpcIdentity(value) {
  return Boolean(normalizeNpcIdentity(value));
}
