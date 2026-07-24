import assert from 'node:assert/strict';

import {
  TurnEvidenceCompiler,
  renderEvidenceView
} from '../js/core/turn-evidence.js';
import { appendMemoryEvents, createContinuityLedger } from '../js/core/continuity-ledger.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

function stateAt(time, extra = {}) {
  return {
    _version: '5.0',
    _meta: { current_node_id: 'node_test', active_branch: 'branch_main' },
    _relationships: {},
    _missions: { active: {}, completed: {} },
    '系统·回合数': 7,
    '世界·时间': time,
    '世界·年代': String(time).match(/木叶\d+年/)?.[0] || '',
    '世界·地点': '木叶隐村',
    '玩家·姓名': '测试忍者',
    '玩家·公开身份': '木叶下忍',
    ...extra
  };
}

test('writer only receives a spoiler-free next anchor on blank days', () => {
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({ state: stateAt('木叶63年1月1日·清晨'), userInput: '我在训练场练习' });
  assert.equal(packet.next_anchor.date, 'K064-01-01');
  assert.ok(packet.protected_future?.title, 'test fixture should contain a protected future day');

  const writer = compiler.project(packet, { audience: 'writer' });
  const rendered = renderEvidenceView(writer);
  assert.equal(writer.protected_future, null);
  assert.match(rendered, /K064-01-01/);
  assert.doesNotMatch(rendered, new RegExp(packet.protected_future.title));
  assert.doesNotMatch(rendered, /DAY-P1-|SCN-P1-|EV-P1-/);
});

test('only the planner view can receive protected future data', () => {
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({ state: stateAt('木叶52年1月1日·清晨') });
  const writer = compiler.project(packet, { audience: 'writer' });
  const updater = compiler.project(packet, { audience: 'updater' });
  const planner = compiler.project(packet, { audience: 'planner' });
  assert.equal(writer.protected_future, null);
  assert.equal(updater.protected_future, null);
  assert.equal(planner.protected_future?.id, packet.protected_future?.id);
});

test('current plot projection selects the observable scene and keeps IDs updater-only', () => {
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({
    state: stateAt('木叶64年1月1日·清晨', { '世界·地点': '木叶忍者学校' }),
    userInput: '查看毕业日的情况'
  });
  assert.ok(packet.current_plot);
  const writer = compiler.project(packet, { audience: 'writer' });
  const singleModelWriter = compiler.project(packet, { audience: 'writer', includeOperationalIds: true });
  const updater = compiler.project(packet, { audience: 'updater' });
  assert.equal(writer.current_plot.day_id, undefined);
  assert.ok(writer.current_plot.scenes.every(scene => scene.id === undefined));
  assert.ok(singleModelWriter.current_plot.day_id?.startsWith('DAY-'));
  assert.ok(singleModelWriter.current_plot.scenes.some(scene => scene.id?.startsWith('SCN-')));
  assert.ok(updater.current_plot.day_id?.startsWith('DAY-'));
  assert.ok(updater.current_plot.scenes.some(scene => scene.id?.startsWith('SCN-')));
});

test('NPC state projection hides player secrets, inventory and unrelated relationships', () => {
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({
    state: stateAt('木叶64年1月1日·清晨', {
      '玩家·出身': '秘密实验体',
      '物品·武器·苦无·数量': 3,
      _relationships: {
        卡卡西: { entity_id: 'CH-NAR-KAKASHI', affection: 10, trust: 4 },
        佐助: { entity_id: 'CH-NAR-SASUKE', affection: -3, known_secrets: ['秘密实验体'] }
      }
    }),
    userInput: '卡卡西观察训练'
  });
  const view = compiler.project(packet, {
    audience: 'npc',
    entityId: 'CH-NAR-KAKASHI',
    npcName: '卡卡西'
  });
  const text = JSON.stringify(view.current_state);
  assert.doesNotMatch(text, /秘密实验体|苦无|佐助/);
  assert.match(text, /卡卡西/);
});

test('worldbook visibility is enforced by audience projection', () => {
  const compiler = new TurnEvidenceCompiler({
    worldbookResolver: {
      resolve: () => [
        { id: 'WB-PUBLIC', title: '公开', knowledge: { visibility: 'public' } },
        { id: 'WB-SECRET', title: '秘密', knowledge: { visibility: 'secret' } },
        { id: 'WB-RESTRICTED', title: '本人可知', knowledge: { visibility: 'restricted', audience: { entity_ids: ['NPC-A'] } } }
      ]
    }
  });
  const packet = compiler.compile({ state: stateAt('木叶64年1月1日·清晨') });
  assert.deepEqual(
    compiler.project(packet, { audience: 'writer' }).worldbook_entries.map(entry => entry.id),
    ['WB-PUBLIC']
  );
  assert.deepEqual(
    compiler.project(packet, { audience: 'npc', entityId: 'NPC-A' }).worldbook_entries.map(entry => entry.id),
    ['WB-PUBLIC', 'WB-RESTRICTED']
  );
  assert.equal(compiler.project(packet, { audience: 'planner' }).worldbook_entries.length, 3);
});

test('continuity anchors are recompiled for NPC-A, writer and planner audiences', () => {
  const ledger = appendMemoryEvents(createContinuityLedger(), [
    { event_id: 'memory-public', type: 'fact', subject_id: 'world', predicate: '公开事实', value: '训练场今天开放', visibility: 'public', known_by: ['*'] },
    { event_id: 'memory-npc-b-private', type: 'private_intent', subject_id: 'NPC-B', predicate: '私下计划', value: 'NPC-B准备隐瞒真实目的', visibility: 'private', known_by: ['NPC-B'] },
    { event_id: 'memory-backstage', type: 'backstage', subject_id: 'world', predicate: '幕后真相', value: '只有规划器可用的幕后因果', visibility: 'backstage', known_by: ['narrator'] }
  ], {
    nodeId: 'node_test', branchId: 'branch_main', turn: 7, gameTime: 'K064-01-01'
  }).ledger;
  const compiler = new TurnEvidenceCompiler({ worldbookResolver: { resolve: () => [] } });
  const packet = compiler.compile({
    state: stateAt('木叶64年1月1日·清晨', { _continuity: ledger }),
    userInput: '查看训练场'
  });
  const eventIds = view => (view.continuity_anchors?.events || []).map(event => event.event_id).sort();
  const npcA = compiler.project(packet, { audience: 'npc', entityId: 'NPC-A', npcName: 'NPC-A' });
  const writer = compiler.project(packet, { audience: 'writer' });
  const planner = compiler.project(packet, { audience: 'planner' });
  assert.deepEqual(eventIds(npcA), ['memory-public']);
  assert.deepEqual(eventIds(writer), ['memory-public']);
  assert.ok(eventIds(planner).includes('memory-backstage'));
  assert.ok(eventIds(planner).includes('memory-npc-b-private'));
});

console.log(`\n${passed} turn evidence regression tests passed.`);
