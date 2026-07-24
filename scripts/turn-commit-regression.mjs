import assert from 'node:assert/strict';
import { TurnCommitGuard } from '../js/core/turn-commit.js';

if (!globalThis.localStorage) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(key)
  };
}

const { MessagePipeline } = await import('../js/core/pipeline.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  const manager = {
    state: { turn: 7, item: '苦无', memory: ['约定'] },
    snapshot() { return clone(this.state); },
    restore(value) { this.state = clone(value); }
  };
  const history = [{ role: 'assistant', content: '上一回合' }];
  return { manager, history };
}

{
  const { manager, history } = fixture();
  const guard = new TurnCommitGuard({ stateManager: manager, chatHistory: history });
  manager.state.turn = 8;
  manager.state.item = null;
  manager.state.memory.push('未提交内容');
  history.push({ role: 'user', content: '丢弃苦无' });
  assert.equal(guard.rollback(), true);
  assert.deepEqual(manager.state, { turn: 7, item: '苦无', memory: ['约定'] });
  assert.deepEqual(history, [{ role: 'assistant', content: '上一回合' }]);
  assert.equal(guard.rollback(), false, 'rollback must be idempotent');
}

{
  const { manager, history } = fixture();
  const guard = new TurnCommitGuard({ stateManager: manager, chatHistory: history });
  manager.state.turn = 8;
  history.push({ role: 'assistant', content: '已确认正文' });
  assert.equal(guard.commit(), true);
  assert.equal(guard.commit(), false, 'commit must be idempotent');
  assert.equal(guard.rollback(), false, 'durable commit must never roll back');
  assert.equal(manager.state.turn, 8);
  assert.equal(history.at(-1).content, '已确认正文');
}

{
  const { manager, history } = fixture();
  assert.throws(
    () => new TurnCommitGuard({ stateManager: {}, chatHistory: history }),
    /snapshot\/restore/
  );
  assert.throws(
    () => new TurnCommitGuard({ stateManager: manager, chatHistory: {} }),
    /chat history/
  );
}

{
  const { manager } = fixture();
  const pipeline = new MessagePipeline({});
  pipeline.chatHistory = Array.from({ length: 34 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `已提交历史-${index + 1}`
  }));
  const liveHistory = pipeline.chatHistory;
  const committedHistory = clone(liveHistory);
  const guard = new TurnCommitGuard({ stateManager: manager, chatHistory: liveHistory });

  manager.state.turn = 8;
  pipeline.chatHistory.push(
    { role: 'user', content: '本回合尚未提交的操作' },
    { role: 'assistant', content: '本回合尚未提交的正文' }
  );
  pipeline._trimHistory();

  assert.equal(pipeline.chatHistory, liveHistory, 'history trimming must preserve the guarded array identity');
  assert.notDeepEqual(pipeline.chatHistory, committedHistory);
  assert.equal(guard.rollback(), true);
  assert.deepEqual(pipeline.chatHistory, committedHistory,
    'timeline failure must restore history even after the trim threshold is crossed');
}

console.log('turn commit regression: 4 passed');
