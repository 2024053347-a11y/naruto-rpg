import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.customElements ||= { get: () => null };

const [{ MessagePipeline }, { stateManager }] = await Promise.all([
  import('../js/core/pipeline.js'),
  import('../js/core/state-manager.js')
]);

const latest = stateManager.getDefaultState();
latest['玩家·姓名'] = '证据测试者';
latest['世界·时间'] = 'K064-01-01';
latest['世界·地点'] = '木叶第三训练场';
latest._missions = {
  active: {
    training: { id: 'training', title: '铃铛训练', status: 'active', objective: '取得铃铛' }
  },
  completed: {},
  failed: {}
};
latest._relationships = {
  卡卡西: {
    role: '指导上忍',
    history: [{ turn: 7, summary: '开始铃铛训练' }],
    inner_thoughts: [{ turn: 7, summary: '观察团队配合' }]
  }
};
stateManager.state = latest;
stateManager._stateVersion++;

const stale = structuredClone(latest);
stale['世界·地点'] = '旧训练场';
stale._missions = { active: {}, completed: {}, failed: {} };
stale._relationships = {};

const updateObligations = {
  fixed_domains: [{ id: 'missions', label: '任务' }, { id: 'relationships', label: '关系' }],
  present_npcs: [{ npc: '卡卡西', existing: true, source: 'relationship' }],
  active_missions: [{ id: 'training', title: '铃铛训练', status: 'active' }]
};
const pipeline = new MessagePipeline({});
const view = pipeline._compileUpdaterEvidence({
  state: stale,
  userInput: '继续训练',
  narrativeResponse: '卡卡西宣布铃铛训练进入下一阶段。',
  updateObligations,
  useLatestRuntimeState: true
});

assert.equal(view.current_state.world['世界·地点'], '木叶第三训练场');
assert.equal(view.current_state.missions.active.training.title, '铃铛训练');
assert.equal(view.current_state.relationships.卡卡西.history[0].summary, '开始铃铛训练');
assert.deepEqual(view.update_obligations, updateObligations);

console.log('pipeline-updater-evidence-regression: OK');
