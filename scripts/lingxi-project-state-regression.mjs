import assert from 'node:assert/strict';

import { createLingXiTools } from '../js/core/lingxi/lingxi-tools.js';

const PRIVATE_THOUGHT = '绝不能进入灵希工具结果的心声';
const LEAKED_KEY = 'sk-project-state-secret-1234567890';

function clone(value) {
  return structuredClone(value);
}

function createManager() {
  const state = {
    _meta: { current_node_id: 'node-current', active_branch: 'branch-main' },
    _agent_memories: { 鸣人: { privateIntentHistory: [{ thought: PRIVATE_THOUGHT }] } },
    _missions: {
      active: {
        mission_a: {
          id: 'mission_a', status: 'active', rank: 'C', title: '护送卷轴',
          description: '护送任务', location: '木叶大门', reward_ryo: 800,
          progress: { current_step: 1, total_steps: 3, note: '已整备' }, clues: ['雇主很紧张']
        }
      },
      available: {}, completed: {}, failed: {},
      stats: { total_done: 2, total_failed: 1 }
    },
    _relationships: {
      春野樱: {
        role: '同伴', faction: '木叶', location: '医院', affection: 24, trust: 31,
        pinned: true, tags: ['医疗忍者'], promises: ['训练后见面'],
        history: [{ turn: 8, summary: `共同完成任务 [心声] ${PRIVATE_THOUGHT}` }],
        inner_thoughts: [{ turn: 8, summary: PRIVATE_THOUGHT }],
        privateIntentHistory: [{ thought: PRIVATE_THOUGHT }]
      },
      漩涡鸣人: { role: '朋友', affection: 12, trust: 18 }
    },
    _combat: {
      is_active: true, state: 'player_turn', turn: 2,
      enemy_name: '雾隐追忍', enemy_rank: '中忍', enemy_combat_level: 'C',
      enemy_vitality: 46, enemy_vitality_max: 80, enemy_chakra: 22, enemy_chakra_max: 50,
      enemy_status: ['流血'], environment: { terrain: '林地', secret: PRIVATE_THOUGHT },
      log: [{ turn: 1, actor: 'player', action_name: '苦无投掷', damage: 12 }]
    },
    _memory: {
      pins: '当前任务: 护送卷轴', facts: '在木叶接到任务\n雇主来自波之国',
      clues: '有人跟踪车队', recent_summary: '队伍离开木叶。',
      chapters: JSON.stringify([{ id: 1, title: '启程', from: 1, to: 8, summary: '护送队伍出发。' }]),
      npc_notes: PRIVATE_THOUGHT,
      meta: { updated_at: 1234, last_deep_turn: 6 }
    },
    '系统·回合数': 8,
    '玩家·姓名': '测试忍者',
    '玩家·年龄': 14,
    '玩家·忍阶': '下忍',
    '玩家·所属村': '木叶隐村',
    '玩家·当前目标': '完成护送',
    '属性·生命力': 100,
    '属性·当前生命力': 78,
    '属性·查克拉': 80,
    '属性·当前查克拉': 43,
    '属性·体力': 70,
    '属性·当前体力': 51,
    '进度·经验': 120,
    '进度·金钱': 2400,
    '进度·已完成任务': 2,
    '世界·地点': '火之国森林',
    '世界·时间': 'K052-04-03',
    '世界·年代': '木叶52年',
    '世界·天气': '小雨'
  };
  const stores = {
    timeline_nodes: [
      {
        id: 'node-current', parent_id: 'node-old', branch_id: 'branch-main', turn_number: 8,
        player_input: '继续护送', ai_response_summary: `遭遇追忍 ${LEAKED_KEY}`,
        clean_response: 'x'.repeat(5000), created_at: 200, archived: false
      },
      {
        id: 'node-old', parent_id: null, branch_id: 'branch-main', turn_number: 7,
        player_input: '离开村子', ai_response_summary: '队伍启程', created_at: 100, archived: true
      }
    ],
    timeline_branches: [
      { id: 'branch-main', name: '主线', head_node_id: 'node-current', node_count: 2, is_active: true }
    ]
  };
  return {
    state,
    get(path) { return path ? clone(state[path]) : clone(state); },
    getSub(path) { return clone(state[path]); },
    async dbGetAll(store) { return clone(stores[store] || []); }
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
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function createTools(manager = createManager()) {
  return createLingXiTools({
    stateManager: manager,
    stageVariableChange: async value => value,
    timelineSystem: {
      async getStorageStats() {
        return { totalNodes: 2, activeCount: 1, archivedCount: 1, estimatedBytes: 4096 };
      }
    }
  });
}

await test('overview, missions and combat expose bounded public state', async () => {
  const tools = createTools();
  const overview = await tools.inspect_project_state.execute({ section: 'overview' });
  const missions = await tools.inspect_project_state.execute({ section: 'missions', status: 'active' });
  const combat = await tools.inspect_project_state.execute({ section: 'combat' });

  assert.equal(overview.player.name, '测试忍者');
  assert.equal(overview.counts.activeMissions, 1);
  assert.equal(missions.items[0].title, '护送卷轴');
  assert.equal(missions.items[0].reward.ryo, 800);
  assert.equal(combat.active, true);
  assert.equal(combat.combat.enemy.name, '雾隐追忍');
  assert.deepEqual(combat.combat.environment, { terrain: '林地' });
});

await test('relationship and memory reads exclude NPC private state', async () => {
  const tools = createTools();
  const relationships = await tools.inspect_project_state.execute({ section: 'relationships', query: '春野樱' });
  const memory = await tools.inspect_project_state.execute({ section: 'memory' });
  const serialized = JSON.stringify({ relationships, memory });

  assert.equal(relationships.items.length, 1);
  assert.equal(relationships.items[0].recentHistory[0].summary, '共同完成任务');
  assert.equal(serialized.includes(PRIVATE_THOUGHT), false);
  assert.equal(serialized.includes('inner_thoughts'), false);
  assert.equal(serialized.includes('privateIntentHistory'), false);
  assert.equal(serialized.includes('npc_notes'), false);
  assert.equal(memory.memory.chapters[0].title, '启程');
});

await test('timeline and save reads are filtered, bounded and credential-redacted', async () => {
  const tools = createTools();
  const timeline = await tools.inspect_project_state.execute({ section: 'timeline', limit: 40 });
  const withArchive = await tools.inspect_project_state.execute({ section: 'save', includeArchived: true });

  assert.equal(timeline.available, true);
  assert.equal(timeline.nodes.length, 1);
  assert.equal(timeline.nodes[0].current, true);
  assert.equal(timeline.nodes[0].turn, 8);
  assert.equal(timeline.nodes[0].summary.includes(LEAKED_KEY), false);
  assert.equal(timeline.storage.estimatedBytes, 4096);
  assert.equal(withArchive.section, 'save');
  assert.equal(withArchive.nodes.length, 2);
  assert.equal(JSON.stringify(withArchive).includes(LEAKED_KEY), false);
});

await test('gzip-compressed archived turns remain visible in timeline inspection', async () => {
  const manager = createManager();
  const originalGetAll = manager.dbGetAll.bind(manager);
  manager.dbGetAll = async store => {
    const records = await originalGetAll(store);
    if (store !== 'timeline_nodes') return records;
    return records.map(node => node.id === 'node-old'
      ? { ...node, payload_encoding: 'gzip-json-v1', payload: new Uint8Array([1, 2, 3]) }
      : node);
  };
  const tools = createTools(manager);
  const timeline = await tools.inspect_project_state.execute({ section: 'timeline', limit: 40 });
  assert.equal(timeline.nodes.length, 2);
  const old = timeline.nodes.find(node => node.id === 'node-old');
  assert.equal(old.archived, true);
  assert.equal(old.compressed, true);
  assert.equal(old.summary, '队伍启程');
});

await test('project-state inspection does not mutate the save', async () => {
  const manager = createManager();
  const before = clone(manager.state);
  const tools = createTools(manager);
  for (const section of ['overview', 'missions', 'relationships', 'combat', 'timeline', 'save', 'memory']) {
    await tools.inspect_project_state.execute({ section, includeArchived: true });
  }
  assert.deepEqual(manager.state, before);
});

if (failures.length) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exitCode = 1;
} else {
  console.log(`\nLing Xi project-state regression: ${passed}/${passed} passed`);
}
