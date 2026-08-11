import {
  DEFAULT_ACTION_PROPOSAL_TTL_MS,
  LingXiActionError,
  cloneActionProposal,
  verifyActionProposal
} from './action-proposal.js';
import { classifyProposalApproval } from './proposal-approval-policy.js';

const CONSUMED_RECORD_RETENTION_MS = 5 * 60_000;
const APPROVED_EXECUTIONS = new WeakSet();
const TRUSTED_APPROVAL_SUBMITS = new WeakSet();
const TRUSTED_APPROVAL_ACTIVATIONS = new WeakMap();

export function consumeBrokerApprovedProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || !APPROVED_EXECUTIONS.has(proposal)) return false;
  APPROVED_EXECUTIONS.delete(proposal);
  return true;
}

function fail(code, message, details = null) {
  throw new LingXiActionError(code, message, details);
}

function defaultTrustedEventCheck(event) {
  if (!event || !TRUSTED_APPROVAL_SUBMITS.has(event)) return false;
  TRUSTED_APPROVAL_SUBMITS.delete(event);
  return true;
}

function isTrustedBrowserEvent(event, type) {
  const EventCtor = globalThis.Event;
  return typeof EventCtor === 'function'
    && event instanceof EventCtor
    && event.isTrusted === true
    && event.type === type;
}

function validApprovalForm(form, proposalId) {
  return Boolean(
    proposalId
    && form?.isConnected
    && form.dataset?.lingxiProposalId === proposalId
    && form.getRootNode?.()?.host?.localName === 'lingxi-companion'
  );
}

export function captureTrustedApprovalActivation({
  event,
  form,
  element,
  proposalId
} = {}) {
  const id = String(proposalId || '');
  const click = isTrustedBrowserEvent(event, 'click')
    && event.currentTarget === element
    && element?.type === 'submit'
    && element?.form === form;
  if (!click || !validApprovalForm(form, id)) {
    fail('LINGXI_TRUSTED_UI_REQUIRED', 'Approval requires a trusted confirmation click');
  }
  const evidence = Object.freeze({ kind: 'lingxi-approval-activation' });
  TRUSTED_APPROVAL_ACTIVATIONS.set(evidence, {
    form,
    element,
    proposalId: id
  });
  return evidence;
}

/**
 * Marks one submit event after the component has observed a trusted click on
 * the confirmation button for the same visible proposal.
 */
export function registerTrustedApprovalSubmit({
  submitEvent,
  form,
  activationEvidence,
  proposalId
} = {}) {
  const id = String(proposalId || '');
  const recordedActivation = TRUSTED_APPROVAL_ACTIVATIONS.get(activationEvidence);
  if (activationEvidence) TRUSTED_APPROVAL_ACTIVATIONS.delete(activationEvidence);
  const SubmitEventCtor = globalThis.SubmitEvent;
  const validSubmit = isTrustedBrowserEvent(submitEvent, 'submit')
    && (typeof SubmitEventCtor !== 'function' || submitEvent instanceof SubmitEventCtor)
    && submitEvent.target === form
    && submitEvent.currentTarget === form
    && submitEvent.submitter === recordedActivation?.element;
  const validActivation = Boolean(
    recordedActivation
    && recordedActivation.form === form
    && recordedActivation.proposalId === id
  );
  const validForm = validApprovalForm(form, id);

  if (!validSubmit || !validActivation || !validForm) {
    fail(
      'LINGXI_TRUSTED_UI_REQUIRED',
      'Approval requires a trusted confirmation click in the visible Ling Xi dialog'
    );
  }
  TRUSTED_APPROVAL_SUBMITS.add(submitEvent);
  return submitEvent;
}

function adapterEntries(adapters) {
  if (!adapters) return [];
  if (adapters instanceof Map) return [...adapters.entries()];
  if (Array.isArray(adapters)) return adapters.map(adapter => [adapter?.toolName, adapter]);
  if (typeof adapters === 'object') return Object.entries(adapters);
  fail('LINGXI_BROKER_INVALID', 'Approval broker adapters must be a map, object, or array');
}

export class ToolApprovalBroker {
  #executionPermit = Object.freeze({ kind: 'lingxi-approved-execution' });

  constructor({
    adapters = [],
    now = () => Date.now(),
    proposalTtlMs = DEFAULT_ACTION_PROPOSAL_TTL_MS,
    isTrustedUserEvent = defaultTrustedEventCheck
  } = {}) {
    if (typeof now !== 'function' || typeof isTrustedUserEvent !== 'function') {
      fail('LINGXI_BROKER_INVALID', 'Approval broker clock and trusted-event check must be functions');
    }
    this.now = now;
    this.proposalTtlMs = proposalTtlMs;
    this.isTrustedUserEvent = isTrustedUserEvent;
    this.adapters = new Map();
    this.records = new Map();
    for (const [tool, adapter] of adapterEntries(adapters)) this.register(tool, adapter);
  }

  register(tool, adapter) {
    const name = typeof tool === 'string' ? tool.trim() : '';
    if (!name || !adapter || typeof adapter.stage !== 'function' || typeof adapter.apply !== 'function') {
      fail('LINGXI_BROKER_INVALID', 'Each approval adapter requires a tool name plus stage() and apply()');
    }
    if (adapter.toolName && adapter.toolName !== name) {
      fail('LINGXI_BROKER_INVALID', `Adapter tool mismatch: ${adapter.toolName} != ${name}`);
    }
    adapter.bindApprovalPermit?.(this.#executionPermit);
    this.adapters.set(name, adapter);
    return this;
  }

  async stageAction(tool, params) {
    this._prune();
    const adapter = this.adapters.get(tool);
    if (!adapter) fail('LINGXI_TOOL_UNAVAILABLE', `No approval adapter is registered for ${tool}`);
    const proposal = await adapter.stage(params, {
      now: Number(this.now()),
      ttlMs: this.proposalTtlMs
    });
    await verifyActionProposal(proposal);
    if (proposal.tool !== tool) {
      fail('LINGXI_PROPOSAL_INVALID', `Adapter returned a proposal for ${proposal.tool}, expected ${tool}`);
    }
    if (this.records.has(proposal.id)) {
      fail('LINGXI_PROPOSAL_COLLISION', `Duplicate action proposal id: ${proposal.id}`);
    }
    this.records.set(proposal.id, {
      proposal,
      adapter,
      status: 'pending',
      settledAt: null,
      errorCode: ''
    });
    return cloneActionProposal(proposal);
  }

  getPendingProposal(proposalId) {
    this._prune();
    const record = this.records.get(String(proposalId || ''));
    if (!record || record.status !== 'pending') return null;
    if (Number(this.now()) >= record.proposal.expiresAt) return null;
    return cloneActionProposal(record.proposal);
  }

  listPendingProposals() {
    this._prune();
    const current = Number(this.now());
    return [...this.records.values()]
      .filter(record => record.status === 'pending' && current < record.proposal.expiresAt)
      .map(record => cloneActionProposal(record.proposal));
  }

  discardProposal(proposalId) {
    const record = this.records.get(String(proposalId || ''));
    if (!record || record.status !== 'pending') return false;
    record.status = 'discarded';
    record.settledAt = Number(this.now());
    return true;
  }

  /**
   * This is deliberately a UI-event API, not a model tool or chat-text API.
   * The caller must pass the browser's trusted submit event registered from the
   * visible confirmation button. Synthetic events and chat messages cannot pass.
   */
  async approveFromUserEvent(userEvent, { proposalId } = {}) {
    let trusted = false;
    try { trusted = this.isTrustedUserEvent(userEvent) === true; } catch { trusted = false; }
    if (!trusted) {
      fail('LINGXI_TRUSTED_UI_REQUIRED', 'A trusted user interface event is required for approval');
    }
    const record = this._pendingRecord(proposalId);
    return this._applyRecord(record);
  }

  async applyLowRiskProposal(proposalId) {
    const record = this._pendingRecord(proposalId);
    const policy = classifyProposalApproval(record.proposal);
    if (policy.mode !== 'automatic') {
      fail(
        'LINGXI_CONFIRMATION_REQUIRED',
        'This proposal requires explicit confirmation in the Ling Xi review dialog',
        policy
      );
    }
    return this._applyRecord(record);
  }

  _pendingRecord(proposalId) {
    this._prune();
    const id = String(proposalId || '');
    const record = this.records.get(id);
    if (!record) fail('LINGXI_PROPOSAL_UNKNOWN', 'Action proposal was not found');
    if (record.status === 'expired') {
      fail('LINGXI_PROPOSAL_EXPIRED', 'Action proposal has expired');
    }
    if (record.status !== 'pending') {
      fail('LINGXI_PROPOSAL_REPLAYED', `Action proposal is already ${record.status}`);
    }
    const current = Number(this.now());
    if (current >= record.proposal.expiresAt) {
      record.status = 'expired';
      record.settledAt = current;
      fail('LINGXI_PROPOSAL_EXPIRED', 'Action proposal has expired');
    }
    return record;
  }

  async _applyRecord(record) {
    const current = Number(this.now());
    // Consume before the first await so two simultaneous UI submissions cannot both apply.
    record.status = 'applying';
    record.settledAt = current;
    try {
      await verifyActionProposal(record.proposal);
      APPROVED_EXECUTIONS.add(record.proposal);
      const receipt = await record.adapter.apply(record.proposal, this.#executionPermit);
      record.status = 'applied';
      record.settledAt = Number(this.now());
      return receipt;
    } catch (error) {
      record.status = 'failed';
      record.settledAt = Number(this.now());
      record.errorCode = String(error?.code || 'LINGXI_APPLY_FAILED');
      throw error;
    } finally {
      APPROVED_EXECUTIONS.delete(record.proposal);
    }
  }

  _prune() {
    const current = Number(this.now());
    for (const [id, record] of this.records) {
      if (record.status === 'pending' && current >= record.proposal.expiresAt) {
        record.status = 'expired';
        record.settledAt = current;
      }
      if (record.status !== 'pending'
        && record.status !== 'applying'
        && current - Number(record.settledAt || record.proposal.expiresAt) > CONSUMED_RECORD_RETENTION_MS) {
        this.records.delete(id);
      }
    }
  }
}

export function createToolApprovalBroker(options) {
  return new ToolApprovalBroker(options);
}

export default ToolApprovalBroker;
