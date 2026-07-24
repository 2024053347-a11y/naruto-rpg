import assert from 'node:assert/strict';

import {
  AgentPipeline,
  CHARACTER_MEMORY_DELTA_SCHEMA,
  buildCharacterMemoryDelta,
  mergeCharacterMemoryDelta
} from '../js/core/agent-pipeline.js';
import { AgentRunner } from '../js/core/agent-runner.js';

const inputs = [{
  npc: '卡卡西',
  action: '卡卡西合上任务册。',
  dialogue: '先核对情报。',
  innerThought: '暂时不向玩家透露暗部线索。',
  moodShift: '由放松转为警惕',
  towardsPlayer: '认可其谨慎'
}];
const inputSnapshot = JSON.stringify(inputs);
const delta = buildCharacterMemoryDelta(inputs, { turn: 12 });

assert.equal(delta.schema, CHARACTER_MEMORY_DELTA_SCHEMA);
assert.equal(delta.changes.卡卡西.privateIntentAppend[0].thought, '暂时不向玩家透露暗部线索。');
assert.equal(JSON.stringify(inputs), inputSnapshot, 'building a delta must not mutate Agent output');

const base = {
  卡卡西: {
    npcName: '卡卡西',
    personality: '谨慎',
    currentMood: '平静',
    privateGoals: ['保护村子'],
    knownFacts: ['旧事实'],
    relationToPlayer: { trust: 3 },
    recentActions: [],
    privateIntentHistory: []
  }
};
const baseSnapshot = JSON.stringify(base);
const merged = mergeCharacterMemoryDelta(base, delta);

assert.equal(JSON.stringify(base), baseSnapshot, 'merge must be pure');
assert.equal(merged.卡卡西.currentMood, '由放松转为警惕');
assert.deepEqual(merged.卡卡西.knownFacts, ['旧事实', '卡卡西合上任务册。']);
assert.equal(merged.卡卡西.relationToPlayer.trust, 3);
assert.equal(merged.卡卡西.relationToPlayer.lastShift, '认可其谨慎');
assert.equal(merged.卡卡西.privateIntentHistory[0].thought, '暂时不向玩家透露暗部线索。');

const agentPipeline = new AgentPipeline({ pipeline: null, memorySystem: null });
agentPipeline._pendingCharacterMemoryDelta = delta;
assert.deepEqual(agentPipeline.peekPendingCharacterMemoryDelta(), delta);
assert.deepEqual(agentPipeline.consumePendingCharacterMemoryDelta(), delta);
assert.equal(agentPipeline.peekPendingCharacterMemoryDelta(), null);
agentPipeline._pendingCharacterMemoryDelta = delta;
agentPipeline.discardPendingCharacterMemoryDelta();
assert.equal(agentPipeline.peekPendingCharacterMemoryDelta(), null);

const writerConstraint = new AgentRunner()._buildWriterConstraint({
  outline: { beats: [{ id: 1, scene: '办公室', action: '卡卡西合上任务册。' }] },
  characterInputs: inputs
}, {});
assert.doesNotMatch(writerConstraint, /暂时不向玩家透露暗部线索/);
assert.doesNotMatch(writerConstraint, /\[object Object\]/);
assert.match(writerConstraint, /卡卡西合上任务册/);

console.log('agent-memory-delta-regression: OK');
