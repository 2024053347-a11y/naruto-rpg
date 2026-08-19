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

const priorRelationshipLedger = appendMemoryEvents(createContinuityLedger(), {
  event_id: 'relationship_old_trust',
  type: 'relationship',
  subject_id: 'npc:无名暗部',
  predicate: '关系.trust',
  value: { operation: 'replace', before: 8, after: 10 }
}, {
  nodeId: 'node-9', branchId: 'branch_main', turn: 9, gameTime: 'K052-01-04', recordedAt: 9
}).ledger;
const renameBefore = {
  _continuity: priorRelationshipLedger,
  _relationships: {
    无名暗部: {
      role: '暗部忍者', affection: 12, trust: 10, respect: 16,
      last_interaction: '在任务大厅完成交接。',
      promises: ['继续隐瞒真实身份'], debts: [], known_secrets: ['暗号甲'],
      grand_summary: '曾以代号与玩家共同执行任务。', aliases: ['暗部甲']
    }
  }
};
const renameAfter = JSON.parse(JSON.stringify(renameBefore));
renameAfter._relationships = {
  天藏: {
    ...renameBefore._relationships.无名暗部,
    trust: 14,
    aliases: ['暗部甲', '无名暗部']
  }
};
const continuitySnapshot = JSON.parse(JSON.stringify(priorRelationshipLedger));
const renameDelta = buildContinuityDelta({
  beforeState: renameBefore,
  afterState: renameAfter,
  displayText: '',
  turn: 10
});
const renameRelationshipEvents = renameDelta.filter(event => event.type === 'relationship');
const renameEvent = renameRelationshipEvents.find(event => event.predicate === '关系.姓名');
assert.deepEqual(renameEvent?.value, {
  operation: 'rename', before: '无名暗部', after: '天藏'
});
assert.equal(renameEvent?.subject_id, 'npc:天藏');
const renamedTrust = renameRelationshipEvents.find(event => event.predicate === '关系.trust');
assert.deepEqual(renamedTrust?.value, {
  operation: 'replace', before: 10, after: 14
});
assert.equal(renamedTrust?.subject_id, 'npc:天藏');
assert.deepEqual(renamedTrust?.supersedes, ['relationship_old_trust']);
assert.equal(renameRelationshipEvents.length, 2, 'unchanged card fields must not become remove/add events');
assert.equal(renameRelationshipEvents.some(event => ['add', 'remove'].includes(event.value.operation)), false);
assert.deepEqual(renameBefore._continuity, continuitySnapshot, 'delta derivation must not rewrite prior continuity events');
assert.deepEqual(renameAfter._continuity, continuitySnapshot, 'renamed state must retain prior continuity events verbatim');

const unlinkedAfter = JSON.parse(JSON.stringify(renameAfter));
unlinkedAfter._relationships.天藏.aliases = ['暗部甲'];
const unlinkedDelta = buildContinuityDelta({
  beforeState: renameBefore,
  afterState: unlinkedAfter,
  displayText: '',
  turn: 10
});
assert.equal(unlinkedDelta.some(event => event.predicate === '关系.姓名'), false,
  'a removed and added card without the old-name alias must not be inferred as a rename');
assert.equal(unlinkedDelta.some(event => event.type === 'relationship' && event.value.operation === 'remove'), true);
assert.equal(unlinkedDelta.some(event => event.type === 'relationship' && event.value.operation === 'add'), true);

console.log('continuity delta regression: 4 passed');
