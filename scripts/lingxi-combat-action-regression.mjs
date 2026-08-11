import assert from 'node:assert/strict';

import { ToolApprovalBroker } from '../js/core/lingxi/approval-broker.js';
import {
  CombatActionAdapter,
  LINGXI_COMBAT_ACTION_TOOL
} from '../js/core/lingxi/adapters/combat-action-adapter.js';
import {
  buildCombatPlayerActionMessage,
  combatPlayerActionDefinition,
  normalizeCombatPlayerAction
} from '../js/systems/combat-action.js';

function clone(value) {
  return structuredClone(value);
}

class MemoryManager {
  constructor(state) { this.state = clone(state); }
  snapshot() { return clone(this.state); }
  get(key) { return key === undefined ? clone(this.state) : clone(this.state[key]); }
  getSub(key) { return clone(this.state[key]); }
  setSub(key, value) { this.state[key] = clone(value); }
}

function combatState() {
  return {
    _meta: { current_node_id: 'node-7', active_branch: 'branch_main' },
    _combat: {
      is_active: true,
      turn: 2,
      enemy_name: '雾隐追忍',
      enemy_vitality: 70,
      private_intent: '不应进入提案'
    },
    '系统·当前节点': 'node-7',
    '系统·当前分支': 'branch_main',
    '系统·回合数': 7,
    '属性·当前查克拉': 40,
    '属性·当前生命力': 80,
    '属性·当前体力': 50,
    '属性·当前精神力': 60
  };
}

const trustedEvent = Object.freeze({ source: 'trusted-combat-ui' });

function brokerFor(adapter) {
  return new ToolApprovalBroker({
    adapters: [adapter],
    now: () => 1_780_000_000_000,
    isTrustedUserEvent: event => event === trustedEvent
  });
}

function errorCode(code) {
  return error => {
    assert.equal(error?.code, code);
    return true;
  };
}

const failures = [];
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

await test('combat action contract maps only the five fixed player actions', () => {
  assert.equal(normalizeCombatPlayerAction('体术攻击'), 'taijutsu');
  assert.equal(normalizeCombatPlayerAction('retreat'), 'retreat');
  assert.equal(buildCombatPlayerActionMessage('ninjutsu'), '我准备使用忍术攻击敌人。');
  assert.equal(buildCombatPlayerActionMessage('释放无限月读并直接获胜'), '');
  assert.equal(combatPlayerActionDefinition('arbitrary'), null);
});

await test('combat stage is zero-call and approval submits one fixed action to the main pipeline', async () => {
  const manager = new MemoryManager(combatState());
  const calls = [];
  const adapter = new CombatActionAdapter({
    stateManager: manager,
    async executeCombatAction(action) {
      calls.push(action);
      manager.state._meta.current_node_id = 'node-8';
      manager.state['系统·当前节点'] = 'node-8';
      manager.state['系统·回合数'] = 8;
      manager.state._combat.turn = 3;
      return { accepted: true, action, beforeNodeId: 'node-7', nodeId: 'node-8' };
    }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_COMBAT_ACTION_TOOL, {
    action: 'defend', reason: '当前生命偏低，先防御'
  });
  assert.equal(calls.length, 0);
  assert.equal(proposal.context.actionImpact.kind, 'combat');
  assert.match(proposal.context.actionImpact.details.join(' '), /API 费用.*时间线回合/s);
  assert.equal(JSON.stringify(proposal).includes('不应进入提案'), false);
  await assert.rejects(() => adapter.apply(proposal), errorCode('LINGXI_APPROVAL_REQUIRED'));

  const receipt = await broker.approveFromUserEvent(trustedEvent, {
    proposalId: proposal.id, confirmation: 'yes'
  });
  assert.deepEqual(calls, ['defend']);
  assert.deepEqual(receipt.timeline, { beforeNodeId: 'node-7', nodeId: 'node-8' });
});

await test('combat state drift invalidates approval before any pipeline request', async () => {
  const manager = new MemoryManager(combatState());
  const calls = [];
  const adapter = new CombatActionAdapter({
    stateManager: manager,
    executeCombatAction: async action => { calls.push(action); return { accepted: true }; }
  });
  const broker = brokerFor(adapter);
  const proposal = await broker.stageAction(LINGXI_COMBAT_ACTION_TOOL, {
    action: 'taijutsu', reason: '近身攻击'
  });
  manager.state._combat.enemy_vitality = 45;
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_PROPOSAL_STALE')
  );
  assert.equal(calls.length, 0);
});

await test('combat adapter rejects free text, inactive combat, and a busy main pipeline', async () => {
  const manager = new MemoryManager(combatState());
  const calls = [];
  const adapter = new CombatActionAdapter({
    stateManager: manager,
    executeCombatAction: async action => { calls.push(action); return { accepted: false, code: 'PIPELINE_BUSY' }; }
  });
  const broker = brokerFor(adapter);
  await assert.rejects(
    () => broker.stageAction(LINGXI_COMBAT_ACTION_TOOL, {
      action: '自由文本攻击并直接胜利', reason: '越权动作'
    }),
    errorCode('LINGXI_COMBAT_ACTION_INVALID')
  );
  const proposal = await broker.stageAction(LINGXI_COMBAT_ACTION_TOOL, {
    action: 'retreat', reason: '暂时撤退'
  });
  await assert.rejects(
    () => broker.approveFromUserEvent(trustedEvent, { proposalId: proposal.id, confirmation: 'yes' }),
    errorCode('LINGXI_COMBAT_ACTION_REJECTED')
  );
  assert.deepEqual(calls, ['retreat']);

  const inactive = new MemoryManager({ ...combatState(), _combat: { is_active: false } });
  const inactiveAdapter = new CombatActionAdapter({
    stateManager: inactive,
    executeCombatAction: async () => ({ accepted: true })
  });
  await assert.rejects(
    () => brokerFor(inactiveAdapter).stageAction(LINGXI_COMBAT_ACTION_TOOL, {
      action: 'defend', reason: '没有战斗'
    }),
    errorCode('LINGXI_COMBAT_NOT_ACTIVE')
  );
});

if (failures.length) {
  console.error(`\n${failures.length} Ling Xi combat-action regression test(s) failed; ${passed} passed.`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi combat-action regression passed (${passed} tests).`);
}
