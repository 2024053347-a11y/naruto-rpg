import assert from 'node:assert/strict';

import {
  buildUpdaterObligations,
  projectCharacterMemoryDeltaForUpdater,
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

test('the nearest future plot day becomes ordinary current_plot context on blank days', () => {
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({ state: stateAt('木叶63年1月1日·清晨'), userInput: '我在训练场练习' });
  assert.equal(packet.current_plot?.target_date, 'K064-01-01');
  assert.equal(packet.current_plot?.date_relation, 'nearest_future');
  assert.equal(Object.hasOwn(packet, 'next_anchor'), false);
  assert.equal(Object.hasOwn(packet, 'protected_future'), false);

  const writer = compiler.project(packet, { audience: 'writer' });
  const updater = compiler.project(packet, { audience: 'updater' });
  const rendered = renderEvidenceView(writer);
  assert.equal(Object.hasOwn(writer, 'next_anchor'), false);
  assert.equal(Object.hasOwn(writer, 'protected_future'), false);
  assert.match(rendered, /K064-01-01/);
  assert.match(rendered, new RegExp(packet.current_plot.title));
  assert.ok(writer.current_plot.scenes.length > 0, 'nearest future day must provide usable scene context');
  assert.ok(updater.current_plot.day_id?.startsWith('DAY-'));
  assert.doesNotMatch(rendered, /NEXT_ANCHOR|受保护未来|不得.*提前/);
});

test('nearest future plot is ordinary context for writer, updater and planner', () => {
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({ state: stateAt('木叶52年1月1日·清晨') });
  const writer = compiler.project(packet, { audience: 'writer' });
  const updater = compiler.project(packet, { audience: 'updater' });
  const planner = compiler.project(packet, { audience: 'planner' });
  assert.equal(packet.current_plot?.date_relation, 'nearest_future');
  assert.equal(writer.current_plot?.target_date, packet.current_plot?.target_date);
  assert.equal(updater.current_plot?.day_id, packet.current_plot?.day_id);
  assert.equal(planner.current_plot?.day_id, packet.current_plot?.day_id);
});

test('updater receives bounded relationship history but no private agent memory', () => {
  const history = Array.from({ length: 6 }, (_, index) => ({ turn: 6 - index, summary: `互动${6 - index}` }));
  const thoughts = Array.from({ length: 7 }, (_, index) => ({ turn: 7 - index, summary: `心声${7 - index}` }));
  const updateObligations = {
    present_npcs: [{
      npc: '卡卡西',
      existing: true,
      source: 'relationship',
      agent_inner_thought: '这段 Agent 私密想法不得进入 updater。',
      privateIntentHistory: [{ thought: '这段历史私念同样不得进入 updater。' }]
    }],
    active_missions: [{ id: 'mission-training', title: '基础训练', status: 'active' }]
  };
  const compiler = new TurnEvidenceCompiler({ worldbookResolver: { resolve: () => [] } });
  const packet = compiler.compile({
    state: stateAt('木叶64年1月1日·清晨', {
      _relationships: {
        卡卡西: {
          role: '指导上忍', faction: '木叶', status: 'friendly', location: '第三训练场',
          history, inner_thoughts: thoughts
        }
      },
      _agent_memories: {
        卡卡西: {
          privateIntentHistory: [{ turn: 7, thought: '绝不能让变量模型看见这段伏笔。' }],
          privateGoals: ['隐瞒暗部任务']
        }
      },
      _missions: { active: { 'mission-training': { id: 'mission-training', title: '基础训练', status: 'active' } } }
    }),
    userInput: '卡卡西结束了训练',
    updateObligations
  });
  const updater = compiler.project(packet, { audience: 'updater' });
  const writer = compiler.project(packet, { audience: 'writer' });
  const relationship = updater.current_state.relationships.卡卡西;
  assert.deepEqual(relationship.history.map(item => item.summary), ['互动6', '互动5', '互动4']);
  assert.deepEqual(relationship.inner_thoughts.map(item => item.summary), ['心声7', '心声6', '心声5', '心声4', '心声3']);
  assert.equal(relationship.status, 'friendly');
  assert.equal(relationship.location, '第三训练场');
  assert.deepEqual(updater.update_obligations.present_npcs, [{
    npc: '卡卡西', existing: true, source: 'relationship'
  }]);
  const updaterJson = JSON.stringify(updater);
  assert.doesNotMatch(updaterJson, /agent_inner_thought|privateIntentHistory|privateGoals/);
  assert.doesNotMatch(updaterJson, /绝不能让变量模型看见|这段 Agent 私密想法|这段历史私念/);
  assert.equal(Object.hasOwn(writer, 'update_obligations'), false);
});

test('character memory updater projection keeps observable identity and strips every private thought field', () => {
  const projected = projectCharacterMemoryDeltaForUpdater({
    schema: 'naruto.character-memory-delta/v1',
    turn: 8,
    changes: {
      卡卡西: {
        npcName: '旗木卡卡西',
        aliases: ['卡卡西'],
        currentMood: '放松',
        knownFactsAppend: ['玩家完成了铃铛训练。'],
        recentActionsAppend: [{
          turn: 8,
          action: '收起铃铛',
          dialogue: '今天到此为止。',
          thought: '嵌套私念也不能泄漏。'
        }],
        relationShift: '认可玩家的判断',
        privateIntentAppend: [{ turn: 8, thought: '暂不公开暗部线索。' }],
        privateIntentHistory: [{ turn: 7, thought: '继续秘密观察。' }],
        thought: '顶层私念'
      }
    }
  });

  assert.deepEqual(projected, {
    schema: 'naruto.character-memory-delta/v1',
    turn: 8,
    changes: {
      卡卡西: {
        npcName: '旗木卡卡西',
        aliases: ['卡卡西'],
        currentMood: '放松',
        knownFactsAppend: ['玩家完成了铃铛训练。'],
        recentActionsAppend: [{ turn: 8, action: '收起铃铛', dialogue: '今天到此为止。' }],
        relationShift: '认可玩家的判断'
      }
    }
  });
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /privateIntentAppend|privateIntentHistory|thought/);
  assert.doesNotMatch(serialized, /暂不公开暗部线索|继续秘密观察|嵌套私念|顶层私念/);
});

test('update obligations include only NPCs present in the accepted narrative and every active mission', () => {
  const state = stateAt('木叶64年1月1日·清晨', {
    _relationships: {
      旗木卡卡西: { aliases: ['卡卡西'] },
      佐助: { aliases: ['宇智波佐助'] }
    },
    _combat: { enemy_name: '水木' },
    _missions: {
      active: {
        escort: { id: 'escort', title: '护送卷轴', status: 'active', objective: '送到火影楼' },
        training: { id: 'training', title: '基础训练', status: 'progress', progress: { current_step: 1 } }
      }
    }
  });
  const obligations = buildUpdaterObligations({
    state,
    narrativeResponse: '旗木卡卡西收起铃铛，水木则从训练场边缘现身。另一名队员只存在于任务资料中。',
    evidencePacket: { current_plot: { scenes: [{ participants: ['卡卡西', '佐助', '水木'] }] }, worldbook_entries: [] },
    characterMemoryDelta: {
      changes: {
        卡卡西: { privateIntentAppend: [{ thought: '这次测试达到了目的。' }] },
        伊鲁卡: { privateIntentAppend: [{ thought: '我还没有登场。' }] }
      }
    }
  });
  assert.deepEqual(obligations.present_npcs.map(item => item.npc), ['旗木卡卡西', '水木']);
  const serializedObligations = JSON.stringify(obligations);
  assert.doesNotMatch(serializedObligations, /agent_inner_thought|privateIntentAppend|privateIntentHistory|thought/);
  assert.doesNotMatch(serializedObligations, /这次测试达到了目的|我还没有登场/);
  assert.equal(obligations.present_npcs.some(item => item.npc === '伊鲁卡'), false);
  assert.deepEqual(obligations.active_missions.map(item => item.id), ['escort', 'training']);
  assert.equal(obligations.fixed_domains.length, 8);
});

test('budget-trimmed trusted character mentions still become canonical updater obligations', () => {
  const narrativeResponse = '宇智波佐助、春野樱与旗木卡卡西都在训练场等待。';
  const compiler = new TurnEvidenceCompiler();
  const packet = compiler.compile({
    state: stateAt('木叶52年7月15日·正午'),
    userInput: narrativeResponse
  });
  const updater = compiler.project(packet, { audience: 'updater' });
  const writer = compiler.project(packet, { audience: 'writer' });
  const obligations = buildUpdaterObligations({
    state: stateAt('木叶52年7月15日·正午'),
    narrativeResponse,
    evidencePacket: updater
  });

  assert.deepEqual(
    obligations.present_npcs.map(item => item.npc).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    ['宇智波佐助', '春野樱', '旗木卡卡西'].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  );
  assert.equal(obligations.present_npcs.some(item => item.npc === '训练场'), false);
  assert.equal(Object.hasOwn(updater, 'character_mentions'), true);
  assert.equal(Object.hasOwn(writer, 'character_mentions'), false);
});

test('descriptive worldbook aliases never count as NPC identity mentions', () => {
  const obligations = buildUpdaterObligations({
    state: stateAt('木叶52年7月15日·正午'),
    narrativeResponse: '医疗忍者用怪力拦住了复仇者。',
    evidencePacket: {
      worldbook_entries: [{
        character_profile: {
          names: ['春野樱'],
          aliases: ['医疗忍者', '怪力', '复仇者']
        }
      }]
    }
  });
  assert.deepEqual(obligations.present_npcs, []);
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
