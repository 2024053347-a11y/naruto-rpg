import assert from 'node:assert/strict';

import {
  appendMemoryEvents,
  commitContinuityProjectionCas,
  compileContinuityAnchors,
  createContinuityCasToken,
  createContinuityLedger,
  diffContinuityLedgers,
  inspectContinuityLedger,
  migrateLegacyMemory,
  queryContinuity,
  rebuildContinuityFromAncestry,
  remapContinuityLedger,
  retractMemoryEvent,
  supersedeMemoryEvent
} from '../js/core/continuity-ledger.js';
import { stateManager } from '../js/core/state-manager.js';
import { inspectTimelineSave } from '../js/core/timeline-save-schema.js';
import { timelineSystem } from '../js/systems/timeline-system.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}

function event(id, value, extra = {}) {
  return {
    event_id: id,
    type: 'fact',
    subject_id: 'player',
    predicate: 'continuity_test',
    value,
    ...extra
  };
}

function append(ledger, item, context = {}) {
  return appendMemoryEvents(ledger, item, {
    nodeId: 'node_1', branchId: 'branch_main', turn: 1,
    gameTime: 'K052-01-01', recordedAt: 1, ...context
  }).ledger;
}

await test('append is immutable and duplicate IDs cannot overwrite history', () => {
  const original = createContinuityLedger();
  const next = append(original, event('event_1', 'remembered'));
  assert.equal(original.events.length, 0);
  assert.equal(original.revision, 0);
  assert.equal(next.events.length, 1);
  assert.equal(next.revision, 1);
  assert.throws(() => append(next, event('event_1', 'changed')), /不能覆盖/);
  assert.deepEqual(inspectContinuityLedger(next), { valid: true, errors: [] });
});

await test('supersede and retract preserve immutable history and resolve active truth', () => {
  let ledger = append(createContinuityLedger(), event('promise_old', '明日会合', { type: 'promise' }));
  ledger = supersedeMemoryEvent(ledger, 'promise_old', event('promise_new', '三日后会合', {
    type: 'promise'
  }), { nodeId: 'node_2', branchId: 'branch_main', turn: 2, recordedAt: 2 }).ledger;
  assert.deepEqual(queryContinuity(ledger).map(item => item.event_id), ['promise_new']);

  ledger = retractMemoryEvent(ledger, 'promise_new', '消息来源有误', {
    nodeId: 'node_3', branchId: 'branch_main', turn: 3, recordedAt: 3
  }).ledger;
  assert.deepEqual(queryContinuity(ledger).map(item => item.event_id), ['promise_old']);
  assert.equal(queryContinuity(ledger, { includeInactive: true }).length, 2);
});

await test('legacy prose memory migrates once as legacy_unverified without data loss', () => {
  const legacy = {
    pins: '必须记住的约定',
    facts: '鸣人送给玩家一枚护符\n护符后来遗失',
    important_events: '完成第一场任务',
    npc_notes: 'npc:naruto: 仍不完全信任玩家'
  };
  const migrated = migrateLegacyMemory(createContinuityLedger(), legacy, {
    nodeId: 'legacy_node', branchId: 'branch_main', turn: 8, recordedAt: 0
  });
  assert.equal(migrated.appended.length, 5);
  assert.ok(migrated.appended.every(item => item.truth === 'legacy_unverified'));
  const repeated = migrateLegacyMemory(migrated.ledger, legacy, {
    nodeId: 'legacy_node', branchId: 'branch_main', turn: 8, recordedAt: 0
  });
  assert.equal(repeated.migrated, false);
  assert.equal(repeated.ledger.events.length, 5);
});

await test('state restore migrates existing _memory into the continuity ledger', () => {
  const snapshot = stateManager.getDefaultState();
  delete snapshot._continuity;
  snapshot._meta.current_node_id = 'legacy_restore_node';
  snapshot._memory.facts = '旧存档中的确定文本';
  const prepared = stateManager.prepareRestore(snapshot);
  assert.equal(prepared.state._continuity.legacy_migration_version, 1);
  assert.equal(prepared.state._continuity.events.length, 1);
  assert.equal(prepared.state._continuity.events[0].truth, 'legacy_unverified');
});

await test('timeline commit derives an auditable delta and keeps sibling branches isolated', () => {
  let rootLedger = migrateLegacyMemory(createContinuityLedger(), null, {
    nodeId: 'root', branchId: 'branch_main', recordedAt: 0
  }).ledger;
  rootLedger = append(rootLedger, event('root_fact', 'root'), {
    nodeId: 'root', branchId: 'branch_main', turn: 1
  });
  const rootSnapshot = stateManager.getDefaultState();
  rootSnapshot._continuity = rootLedger;
  rootSnapshot._meta = { current_node_id: 'root', active_branch: 'branch_main' };
  const rootNode = {
    id: 'root', parent_id: null, branch_id: 'branch_main', turn_number: 1,
    state_snapshot: rootSnapshot
  };

  const mainPrepared = timelineSystem._prepareContinuitySnapshot(structuredClone(rootSnapshot), {
    parentNode: rootNode,
    nodeId: 'main_child', branchId: 'branch_main', turnNumber: 2,
    continuityDelta: [event('main_fact', 'main')], recordedAt: 2
  });
  const altPrepared = timelineSystem._prepareContinuitySnapshot(structuredClone(rootSnapshot), {
    parentNode: rootNode,
    nodeId: 'alt_child', branchId: 'branch_alt', turnNumber: 2,
    continuityDelta: [event('alt_fact', 'alt')], recordedAt: 2
  });
  assert.deepEqual(mainPrepared.delta.map(item => item.event_id), ['main_fact']);
  assert.deepEqual(altPrepared.delta.map(item => item.event_id), ['alt_fact']);
  assert.deepEqual(queryContinuity(mainPrepared.snapshot._continuity).map(item => item.event_id), ['main_fact', 'root_fact']);
  assert.deepEqual(queryContinuity(altPrepared.snapshot._continuity).map(item => item.event_id), ['alt_fact', 'root_fact']);
  assert.equal(queryContinuity(mainPrepared.snapshot._continuity).some(item => item.event_id === 'alt_fact'), false);
  assert.equal(diffContinuityLedgers(rootLedger, mainPrepared.snapshot._continuity).length, 1);
});

await test('ancestry rebuild and timeline save schema retain continuity_delta', () => {
  let rootLedger = migrateLegacyMemory(createContinuityLedger(), null, {
    nodeId: 'node_root', branchId: 'branch_main', recordedAt: 0
  }).ledger;
  rootLedger = append(rootLedger, event('root_event', 'root'), {
    nodeId: 'node_root', branchId: 'branch_main', turn: 1
  });
  const rootDelta = rootLedger.events.slice();
  const childLedger = append(rootLedger, event('child_event', 'child'), {
    nodeId: 'node_child', branchId: 'branch_main', turn: 2
  });
  const childDelta = diffContinuityLedgers(rootLedger, childLedger);
  const rootSnapshot = stateManager.getDefaultState();
  rootSnapshot._continuity = rootLedger;
  const childSnapshot = stateManager.getDefaultState();
  childSnapshot._continuity = childLedger;
  const nodes = [
    {
      id: 'node_root', parent_id: null, children_ids: ['node_child'], branch_id: 'branch_main',
      turn_number: 1, depth: 0, state_snapshot: rootSnapshot, continuity_delta: rootDelta
    },
    {
      id: 'node_child', parent_id: 'node_root', children_ids: [], branch_id: 'branch_main',
      turn_number: 2, depth: 1, state_snapshot: childSnapshot, continuity_delta: childDelta
    }
  ];
  const rebuilt = rebuildContinuityFromAncestry(nodes, 'node_child', { preferSnapshot: false });
  assert.deepEqual(rebuilt.events.map(item => item.event_id), ['root_event', 'child_event']);
  const save = {
    nodes,
    branches: [{
      id: 'branch_main', color: '#eb613f', head_node_id: 'node_child', diverged_from: null,
      node_count: 2, is_active: true
    }],
    meta: { key: 'root', value: {
      root_id: 'node_root', current_id: 'node_child', active_branch: 'branch_main', total_nodes: 2
    } }
  };
  assert.deepEqual(inspectTimelineSave(save), { valid: true, errors: [] });
});

await test('import remap changes event provenance and all supersede references together', () => {
  let ledger = append(createContinuityLedger(), event('event_old', 'old'));
  ledger = supersedeMemoryEvent(ledger, 'event_old', event('event_new', 'new'), {
    nodeId: 'node_2', branchId: 'branch_old', turn: 2, recordedAt: 2
  }).ledger;
  const remapped = remapContinuityLedger(ledger, {
    nodeIds: new Map([['node_1', 'node_import_1'], ['node_2', 'node_import_2']]),
    branchIds: new Map([['branch_main', 'branch_import'], ['branch_old', 'branch_import']]),
    eventIds: new Map([['event_old', 'import_old'], ['event_new', 'import_new']])
  });
  assert.deepEqual(remapped.events.map(item => item.event_id), ['import_old', 'import_new']);
  assert.deepEqual(remapped.events[1].supersedes, ['import_old']);
  assert.equal(remapped.events[0].node_id, 'node_import_1');
  assert.equal(remapped.events[1].branch_id, 'branch_import');
});

await test('anchor projection respects knowledge audience and backstage isolation', () => {
  let ledger = append(createContinuityLedger(), [
    event('public_fact', 'public', { visibility: 'public', known_by: ['*'], importance: 3 }),
    event('npc_secret', 'secret', { visibility: 'secret', known_by: ['npc:a'], importance: 4 }),
    event('backstage_fact', 'backstage', { visibility: 'backstage', known_by: ['narrator'], importance: 5 })
  ]);
  const npc = compileContinuityAnchors(ledger, { audienceId: 'npc:a', minImportance: 0 });
  assert.deepEqual(npc.events.map(item => item.event_id), ['npc_secret', 'public_fact']);
  const writer = compileContinuityAnchors(ledger, { audienceId: 'writer', minImportance: 0 });
  assert.deepEqual(writer.events.map(item => item.event_id), ['public_fact']);
  const narrator = compileContinuityAnchors(ledger, {
    audienceId: 'narrator', includeBackstage: true, minImportance: 0
  });
  assert.deepEqual(narrator.events.map(item => item.event_id), ['backstage_fact', 'npc_secret', 'public_fact']);
});

await test('async projection CAS rejects node, branch, or ledger revision drift', async () => {
  const ledger = append(createContinuityLedger(), event('cas_fact', 'v1'));
  const token = createContinuityCasToken({ nodeId: 'node_1', branchId: 'branch_main', ledger });
  let commits = 0;
  const applied = await commitContinuityProjectionCas({
    token,
    readCurrent: async () => ({ nodeId: 'node_1', branchId: 'branch_main', ledger }),
    commit: async () => ++commits
  });
  assert.equal(applied.status, 'applied');
  assert.equal(commits, 1);
  const stale = await commitContinuityProjectionCas({
    token,
    readCurrent: async () => ({ nodeId: 'node_other', branchId: 'branch_main', ledger }),
    commit: async () => ++commits
  });
  assert.equal(stale.status, 'stale');
  assert.equal(commits, 1);
});

console.log(`continuity-ledger-regression: ${passed} passed`);
