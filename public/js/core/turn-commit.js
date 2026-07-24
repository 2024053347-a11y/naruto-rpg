function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Guards the mutable part of a turn until its timeline node is durable.
 *
 * Model generation and review happen before this boundary. Once active, state
 * updates, memory writes and chat-history appends either all survive together,
 * or the live state/history are restored to their pre-commit snapshots.
 */
export class TurnCommitGuard {
  constructor({ stateManager, chatHistory } = {}) {
    if (!stateManager?.snapshot || !stateManager?.restore) {
      throw new TypeError('TurnCommitGuard requires a snapshot/restore state manager');
    }
    if (!Array.isArray(chatHistory)) {
      throw new TypeError('TurnCommitGuard requires the live chat history array');
    }
    this.stateManager = stateManager;
    this.chatHistory = chatHistory;
    this.stateSnapshot = stateManager.snapshot();
    this.historySnapshot = clone(chatHistory);
    this.status = 'active';
  }

  commit() {
    if (this.status === 'rolled_back') {
      throw new Error('Cannot commit a rolled-back turn');
    }
    if (this.status === 'committed') return false;
    this.status = 'committed';
    this._releaseSnapshots();
    return true;
  }

  rollback() {
    if (this.status === 'committed') return false;
    if (this.status === 'rolled_back') return false;
    this.stateManager.restore(clone(this.stateSnapshot));
    this.chatHistory.splice(0, this.chatHistory.length, ...clone(this.historySnapshot));
    this.status = 'rolled_back';
    this._releaseSnapshots();
    return true;
  }

  get isActive() {
    return this.status === 'active';
  }

  _releaseSnapshots() {
    this.stateSnapshot = null;
    this.historySnapshot = null;
  }
}

export function beginTurnCommit(options) {
  return new TurnCommitGuard(options);
}

export default TurnCommitGuard;
