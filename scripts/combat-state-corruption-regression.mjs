// Repro: _combat 被污染成 true 后,战斗指令不再抛
// "Cannot create property 'state' on boolean 'true'",且存档恢复会消毒。
import assert from 'node:assert/strict';
import { stateManager } from '../js/core/state-manager.js';
import { combatSystem } from '../js/systems/combat-system.js';
import { instructionParser } from '../js/core/instruction-parser.js';
import {
  filterSafeVariableUpdaterOutput,
  sanitizeVariableUpdaterOutput,
  validateVariableUpdaterOutput
} from '../js/core/variable-updater.js';
import { normalizeCombatState } from '../js/data/instruction-contract.js';
import { setValueByPath } from '../js/utils/format.js';

// 1. 直接污染运行时 _combat 为 true(历史上由 AI path 直写造成)
stateManager.reset();
stateManager.state._combat = true;
assert.doesNotThrow(() => combatSystem.processInstruction({ state: 'victory', exp_reward: 10 }));
const healed = stateManager.getSub('_combat');
assert.equal(healed.state, 'peace');
assert.equal(healed.is_active, false);
console.log('PASS victory over corrupted _combat=true heals into peace object');

stateManager.reset();
stateManager.state._combat = true;
assert.doesNotThrow(() => combatSystem.processInstruction({ state: 'player_turn', action_name: '攻击', log: 'x' }));
assert.doesNotThrow(() => combatSystem.processInstruction({ state: 'enemy_turn', action_name: '攻击', log: 'x' }));
console.log('PASS turn instructions over corrupted _combat=true no longer throw');

// 2. batchUpdate 拒绝 AI 对内部键的路径直写
stateManager.reset();
stateManager.batchUpdate([{ path: '_combat', op: 'set', value: true }]);
assert.equal(stateManager.state._combat, null, 'internal path write must be rejected');
stateManager.batchUpdate([{ path: '_relationships', op: 'set', value: 'oops' }]);
assert.equal(typeof stateManager.state._relationships, 'object');
console.log('PASS batchUpdate rejects internal _ path writes');

// 3. setValueByPath 穿过标量中间节点不抛(严格模式下曾抛 TypeError)
const target = { a: true };
assert.doesNotThrow(() => setValueByPath(target, 'a.b', 1));
assert.equal(target.a.b, 1);
console.log('PASS setValueByPath replaces scalar intermediate nodes');

// 4. 存档恢复消毒被污染的内部键
stateManager.reset();
const snapshot = stateManager.snapshot();
snapshot._combat = true;
snapshot._relationships = 'broken';
snapshot._missions = 42;
assert.doesNotThrow(() => stateManager.restore(snapshot));
assert.equal(stateManager.state._combat, null);
assert.equal(typeof stateManager.state._relationships, 'object');
assert.equal(typeof stateManager.state._missions, 'object');
assert.doesNotThrow(() => combatSystem.processInstruction({ state: 'victory' }));
console.log('PASS restore sanitizes corrupted internal keys');

// 5. 模型常见别名在校验、恢复与执行前统一为唯一合法状态。
assert.equal(normalizeCombatState('player_retreat'), 'retreat');
assert.equal(normalizeCombatState('player_victory'), 'player_victory', 'only the explicit retreat alias may be healed');
const aliasedRetreat = [
  '<variable_thinking>玩家已脱离战斗。</variable_thinking>',
  '<memory>{"summary":"玩家成功撤退。"}</memory>',
  '<combat state="player_retreat">{"log":"玩家脱离交战范围。"}</combat>'
].join('\n');
const canonicalRetreat = sanitizeVariableUpdaterOutput(aliasedRetreat);
assert.match(canonicalRetreat, /<combat state="retreat">/);
assert.doesNotMatch(canonicalRetreat, /player_retreat/);
assert.equal(validateVariableUpdaterOutput(canonicalRetreat).valid, true);
assert.equal(instructionParser.parse(canonicalRetreat).combat.state, 'retreat');
const recoveredRetreat = filterSafeVariableUpdaterOutput(aliasedRetreat);
assert.match(recoveredRetreat.output, /<combat state="retreat">/);
assert.equal(instructionParser.parse(recoveredRetreat.output).combat.state, 'retreat');
stateManager.reset();
stateManager.state._combat = { state: 'player_turn', is_active: true };
combatSystem.processInstruction({ state: 'player_retreat', log: '玩家脱离交战范围。' });
assert.equal(stateManager.getSub('_combat').result, 'retreat', 'execution boundary must normalize the alias too');
console.log('PASS player_retreat is canonicalized before validation, recovery, and execution');

console.log('\n6 combat corruption regression tests passed.');
