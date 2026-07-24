import {
  createNarrativeArtifact,
  isNarrativeArtifact,
  renderNarrativeInstructions,
  toPersistedNarrative
} from './narrative-artifact.js';

export const NARRATIVE_REVIEW_TRANSACTION_KIND = 'NarrativeReviewTransaction';
export const NARRATIVE_REVIEW_TRANSACTION_VERSION = 1;

export const NARRATIVE_REVIEW_STATES = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting',
  PREVIEW: 'preview',
  FAILED: 'failed',
  APPLIED: 'applied',
  DISCARDED: 'discarded'
});

const TERMINAL_STATES = new Set([
  NARRATIVE_REVIEW_STATES.APPLIED,
  NARRATIVE_REVIEW_STATES.DISCARDED
]);

function freezeAttempts(attempts) {
  return Object.freeze(attempts.map(attempt => Object.freeze({ ...attempt })));
}

function freezeTransaction(transaction) {
  return Object.freeze({
    ...transaction,
    attempts: freezeAttempts(transaction.attempts || [])
  });
}

function normaliseError(error) {
  if (error == null) return '未知审查错误';
  if (typeof error === 'string') return error;
  return String(error.message || error);
}

function ensureTransaction(transaction) {
  if (!isNarrativeReviewTransaction(transaction)) {
    throw new TypeError('Expected a NarrativeReviewTransaction');
  }
  return transaction;
}

function ensureActiveAttempt(transaction, attemptNumber) {
  const expected = transaction.activeAttempt;
  const received = attemptNumber == null ? expected : Number(attemptNumber);
  if (!Number.isInteger(received) || received !== expected) {
    throw new Error(`Stale narrative review result (expected attempt ${expected}, received ${received})`);
  }
}

export function isNarrativeReviewTransaction(value) {
  return Boolean(
    value
    && value.kind === NARRATIVE_REVIEW_TRANSACTION_KIND
    && value.version === NARRATIVE_REVIEW_TRANSACTION_VERSION
    && Object.values(NARRATIVE_REVIEW_STATES).includes(value.state)
    && isNarrativeArtifact(value.baseArtifact)
    && Array.isArray(value.attempts)
  );
}

export function createNarrativeReviewTransaction({
  id = null,
  baseArtifact,
  candidateResponse = '',
  evidenceRefs = []
} = {}) {
  const base = isNarrativeArtifact(baseArtifact)
    ? baseArtifact
    : createNarrativeArtifact(baseArtifact ?? candidateResponse, { evidenceRefs });
  return freezeTransaction({
    kind: NARRATIVE_REVIEW_TRANSACTION_KIND,
    version: NARRATIVE_REVIEW_TRANSACTION_VERSION,
    id: id == null ? null : String(id),
    state: NARRATIVE_REVIEW_STATES.IDLE,
    baseArtifact: base,
    requestArtifact: base,
    previewArtifact: null,
    acceptedArtifact: null,
    activeAttempt: 0,
    attempts: [],
    decision: null
  });
}

/** Start the first request or an unlimited user-directed retry. */
export function beginNarrativeReview(transaction, { feedback = '' } = {}) {
  const current = ensureTransaction(transaction);
  if (TERMINAL_STATES.has(current.state)) {
    throw new Error(`Cannot retry a ${current.state} narrative review transaction`);
  }
  if (current.state === NARRATIVE_REVIEW_STATES.REQUESTING) {
    throw new Error('Narrative review request is already in progress');
  }

  const attemptNumber = current.activeAttempt + 1;
  const requestArtifact = current.previewArtifact || current.requestArtifact || current.baseArtifact;
  const attempt = {
    number: attemptNumber,
    feedback: String(feedback || '').trim(),
    status: NARRATIVE_REVIEW_STATES.REQUESTING,
    error: null
  };
  return freezeTransaction({
    ...current,
    state: NARRATIVE_REVIEW_STATES.REQUESTING,
    requestArtifact,
    previewArtifact: null,
    acceptedArtifact: null,
    activeAttempt: attemptNumber,
    attempts: [...current.attempts, attempt],
    decision: null
  });
}

export function receiveNarrativeReviewPreview(transaction, preview, { attemptNumber } = {}) {
  const current = ensureTransaction(transaction);
  if (current.state !== NARRATIVE_REVIEW_STATES.REQUESTING) {
    throw new Error(`Cannot receive a preview while review is ${current.state}`);
  }
  ensureActiveAttempt(current, attemptNumber);
  const artifact = isNarrativeArtifact(preview) ? preview : createNarrativeArtifact(preview);
  if (!artifact.displayText) throw new Error('Narrative review preview has no display text');

  const attempts = current.attempts.map(attempt => attempt.number === current.activeAttempt
    ? { ...attempt, status: NARRATIVE_REVIEW_STATES.PREVIEW, error: null }
    : attempt);
  return freezeTransaction({
    ...current,
    state: NARRATIVE_REVIEW_STATES.PREVIEW,
    previewArtifact: artifact,
    acceptedArtifact: null,
    attempts
  });
}

export function failNarrativeReview(transaction, error, { attemptNumber } = {}) {
  const current = ensureTransaction(transaction);
  if (current.state !== NARRATIVE_REVIEW_STATES.REQUESTING) {
    throw new Error(`Cannot fail a review while it is ${current.state}`);
  }
  ensureActiveAttempt(current, attemptNumber);
  const message = normaliseError(error);
  const attempts = current.attempts.map(attempt => attempt.number === current.activeAttempt
    ? { ...attempt, status: NARRATIVE_REVIEW_STATES.FAILED, error: message }
    : attempt);
  return freezeTransaction({
    ...current,
    state: NARRATIVE_REVIEW_STATES.FAILED,
    previewArtifact: null,
    acceptedArtifact: null,
    attempts
  });
}

export function retryNarrativeReview(transaction, { feedback = '' } = {}) {
  const current = ensureTransaction(transaction);
  if (![NARRATIVE_REVIEW_STATES.PREVIEW, NARRATIVE_REVIEW_STATES.FAILED].includes(current.state)) {
    throw new Error(`Cannot retry a review while it is ${current.state}`);
  }
  return beginNarrativeReview(current, { feedback });
}

/**
 * Applying is the only transition that selects the reviewed artifact.  Merely
 * receiving a preview never changes the commit candidate.
 */
export function applyNarrativeReview(transaction) {
  const current = ensureTransaction(transaction);
  if (current.state !== NARRATIVE_REVIEW_STATES.PREVIEW || !current.previewArtifact) {
    throw new Error(`Cannot apply a review while it is ${current.state}`);
  }
  return freezeTransaction({
    ...current,
    state: NARRATIVE_REVIEW_STATES.APPLIED,
    acceptedArtifact: current.previewArtifact,
    decision: NARRATIVE_REVIEW_STATES.APPLIED
  });
}

/** Discarding the review selects the original candidate, never the preview. */
export function discardNarrativeReview(transaction) {
  const current = ensureTransaction(transaction);
  if (TERMINAL_STATES.has(current.state)) {
    throw new Error(`Narrative review transaction is already ${current.state}`);
  }
  return freezeTransaction({
    ...current,
    state: NARRATIVE_REVIEW_STATES.DISCARDED,
    previewArtifact: null,
    acceptedArtifact: current.baseArtifact,
    decision: NARRATIVE_REVIEW_STATES.DISCARDED
  });
}

export function resolveNarrativeReviewArtifact(transaction) {
  const current = ensureTransaction(transaction);
  return TERMINAL_STATES.has(current.state) ? current.acceptedArtifact : null;
}

export function getNarrativeReviewRequestArtifact(transaction) {
  const current = ensureTransaction(transaction);
  return current.requestArtifact || current.baseArtifact;
}

/** Safe history/timeline projection: only clean visible prose can leave here. */
export function toPersistedReviewNarrative(transaction) {
  const accepted = resolveNarrativeReviewArtifact(transaction);
  return accepted ? toPersistedNarrative(accepted) : null;
}

/**
 * UI projection intentionally omits auditInternal, evidenceRefs and raw
 * instructions.  They remain ephemeral implementation details.
 */
export function toNarrativeReviewPreviewView(transaction) {
  const current = ensureTransaction(transaction);
  const preview = current.previewArtifact;
  return Object.freeze({
    id: current.id,
    state: current.state,
    activeAttempt: current.activeAttempt,
    displayText: preview?.displayText || '',
    hasInstructionChanges: Boolean(preview)
      && renderNarrativeInstructions(preview) !== renderNarrativeInstructions(current.baseArtifact),
    canApply: current.state === NARRATIVE_REVIEW_STATES.PREVIEW,
    canRetry: [NARRATIVE_REVIEW_STATES.PREVIEW, NARRATIVE_REVIEW_STATES.FAILED].includes(current.state),
    canDiscard: !TERMINAL_STATES.has(current.state),
    error: current.state === NARRATIVE_REVIEW_STATES.FAILED
      ? current.attempts.at(-1)?.error || '未知审查错误'
      : null
  });
}
