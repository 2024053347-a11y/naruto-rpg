export const LINGXI_ACTION_PROPOSAL_SCHEMA = 'naruto.lingxi-action-proposal/v1';
export const DEFAULT_ACTION_PROPOSAL_TTL_MS = 90_000;
export const MAX_ACTION_PROPOSAL_TTL_MS = 5 * 60_000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class LingXiActionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'LingXiActionError';
    this.code = code;
    if (details !== null) this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new LingXiActionError(code, message, details);
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeValue(value, seen, depth) {
  if (depth > 64) fail('LINGXI_VALUE_TOO_DEEP', 'Action proposal data is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('LINGXI_VALUE_INVALID', 'Action proposal numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    fail('LINGXI_VALUE_INVALID', `Unsupported action proposal value: ${typeof value}`);
  }
  if (seen.has(value)) fail('LINGXI_VALUE_CYCLIC', 'Action proposal data must not contain cycles');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(item => canonicalizeValue(item, seen, depth + 1));
  } else {
    if (!isRecord(value)) fail('LINGXI_VALUE_INVALID', 'Action proposal objects must be plain records');
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) fail('LINGXI_VALUE_UNSAFE', `Unsafe action proposal key: ${key}`);
      if (value[key] === undefined) fail('LINGXI_VALUE_INVALID', `Undefined action proposal value at ${key}`);
      result[key] = canonicalizeValue(value[key], seen, depth + 1);
    }
  }
  seen.delete(value);
  return result;
}

export function canonicalize(value) {
  return canonicalizeValue(value, new Set(), 0);
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function fallbackHash(source) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return [first, second, first ^ second, Math.imul(first, second)]
    .map(value => (value >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export async function hashCanonical(value) {
  const source = canonicalStringify(value);
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof TextEncoder !== 'undefined') {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(source));
    const hex = [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    return `sha256:${hex}`;
  }
  return `fnv1a128:${fallbackHash(source)}`;
}

export const fingerprintValue = hashCanonical;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function proposalId(now) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `lingxi_action_${uuid}`;
  return `lingxi_action_${now}_${Math.random().toString(36).slice(2, 12)}`;
}

function requiredString(value, label, maxLength = 160) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > maxLength) {
    fail('LINGXI_PROPOSAL_INVALID', `${label} must be a non-empty string up to ${maxLength} characters`);
  }
  return result;
}

export async function createActionProposal({
  id = '',
  tool,
  params,
  stateFingerprint,
  context = {},
  diff,
  ttlMs = DEFAULT_ACTION_PROPOSAL_TTL_MS,
  now = Date.now()
} = {}) {
  const createdAt = Number(now);
  const lifetime = Number(ttlMs);
  if (!Number.isFinite(createdAt)) fail('LINGXI_PROPOSAL_INVALID', 'Proposal timestamp is invalid');
  if (!Number.isFinite(lifetime) || lifetime < 1_000 || lifetime > MAX_ACTION_PROPOSAL_TTL_MS) {
    fail('LINGXI_PROPOSAL_INVALID', `Proposal lifetime must be between 1000 and ${MAX_ACTION_PROPOSAL_TTL_MS} ms`);
  }
  const normalizedTool = requiredString(tool, 'tool');
  const normalizedFingerprint = requiredString(stateFingerprint, 'stateFingerprint', 256);
  if (!Array.isArray(diff) || diff.length === 0) {
    fail('LINGXI_PROPOSAL_INVALID', 'Action proposal must contain an exact non-empty diff');
  }

  const normalized = {
    id: requiredString(id || proposalId(createdAt), 'id', 240),
    tool: normalizedTool,
    params: canonicalize(params),
    stateFingerprint: normalizedFingerprint,
    context: canonicalize(context),
    diff: canonicalize(diff),
    createdAt,
    expiresAt: createdAt + lifetime
  };
  const paramsHash = await hashCanonical(normalized.params);
  const diffHash = await hashCanonical(normalized.diff);
  const bindingHash = await hashCanonical({
    id: normalized.id,
    tool: normalized.tool,
    paramsHash,
    stateFingerprint: normalized.stateFingerprint,
    context: normalized.context,
    diffHash,
    createdAt: normalized.createdAt,
    expiresAt: normalized.expiresAt
  });

  return deepFreeze({
    schema: LINGXI_ACTION_PROPOSAL_SCHEMA,
    ...normalized,
    paramsHash,
    diffHash,
    bindingHash
  });
}

export async function verifyActionProposal(proposal) {
  if (!isRecord(proposal) || proposal.schema !== LINGXI_ACTION_PROPOSAL_SCHEMA) {
    fail('LINGXI_PROPOSAL_INVALID', 'Unsupported Ling Xi action proposal');
  }
  const paramsHash = await hashCanonical(proposal.params);
  const diffHash = await hashCanonical(proposal.diff);
  const bindingHash = await hashCanonical({
    id: proposal.id,
    tool: proposal.tool,
    paramsHash,
    stateFingerprint: proposal.stateFingerprint,
    context: proposal.context,
    diffHash,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt
  });
  if (paramsHash !== proposal.paramsHash || diffHash !== proposal.diffHash || bindingHash !== proposal.bindingHash) {
    fail('LINGXI_PROPOSAL_TAMPERED', 'Action proposal binding no longer matches its contents');
  }
  return true;
}

export function cloneActionProposal(proposal) {
  return canonicalize(proposal);
}
