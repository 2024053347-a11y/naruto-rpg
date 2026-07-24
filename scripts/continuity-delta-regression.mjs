import assert from 'node:assert/strict';
import { appendMemoryEvents, createContinuityLedger } from '../js/core/continuity-ledger.js';
import { buildContinuityDelta } from '../js/core/continuity-delta.js';

const base = {
  _continuity: createContinuityLedger(),
  '物品·忍具·苦无·数量': 3,
  '技能·忍术·分身术·名称': '分身术',
  '世界·地点': '木叶训练场',
  _relationships: { 卡卡西: { trust: 10, promises: [] } },
  _missions: { active: { escort: { id: 'escort', title: '护送', rank: 'C' } }, completed: {}, failed: {} },
  _combat: null
};

const after = JSON.parse(JSON.stringify(base));
delete after['物品·忍具·苦无·数量'];
after['技能·忍术·影分身术·名称'] = '影分身术';
after['世界·地点'] = '木叶医院';
after._relationships.卡卡西.trust = 18;
after._relationships.卡卡西.promises = ['训练结束后复盘'];
after._missions.completed.escort = { ...after._missions.active.escort, result: '成功' };
delete after._missions.active.escort;
after._combat = { is_active: true, enemy_name: '袭击者' };

const delta = buildContinuityDelta({
  beforeState: base, afterState: after,
  displayText: '苦无耗尽后，卡卡西兑现承诺，带玩家赶往医院。',
  turn: 8, evidenceRefs: ['JT-CLONE-0001']
});

assert.ok(delta.some(event => event.type === 'inventory' && event.value.operation === 'remove'));
assert.ok(delta.some(event => event.type === 'technique' && event.value.operation === 'add'));
assert.ok(delta.some(event => event.type === 'relationship' && event.predicate === '关系.promises'));
assert.ok(delta.some(event => event.type === 'mission' && event.value.after.status === 'completed'));
assert.ok(delta.some(event => event.type === 'combat'));
assert.ok(delta.some(event => event.type === 'summary' && event.subject_id === 'turn:8'));
assert.ok(delta.every(event => event.evidence.some(item => item.ref === 'display_text')));

const committed = appendMemoryEvents(base._continuity, delta, {
  nodeId: 'node-8', branchId: 'branch_main', turn: 8, gameTime: 'K052-01-03'
}).ledger;
const secondBefore = { ...after, _continuity: committed };
const secondAfter = JSON.parse(JSON.stringify(secondBefore));
secondAfter['世界·地点'] = '火影楼';
const second = buildContinuityDelta({ beforeState: secondBefore, afterState: secondAfter, displayText: '抵达火影楼。', turn: 9 });
const location = second.find(event => event.predicate === '世界·地点');
assert.ok(location?.supersedes?.length === 1, 'mutable facts must supersede their previous value');

const unchanged = buildContinuityDelta({ beforeState: after, afterState: after, displayText: '', turn: 9 });
assert.deepEqual(unchanged, []);

console.log('continuity delta regression: 3 passed');
