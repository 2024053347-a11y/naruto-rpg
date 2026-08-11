import assert from 'node:assert/strict';

import {
  LINGXI_WORLDBOOK_INSPECTION_SCHEMA,
  createLingXiTools
} from '../js/core/lingxi/lingxi-tools.js';

const builtin = [{
  title: '木叶医院',
  keys: ['医院', '医疗忍者'],
  content: '木叶隐村的医疗设施。',
  category: '地点'
}];
const custom = [
  { title: '夜班制度', keys: ['夜班'], content: '第一条同名设定。', enabled: true, source: 'custom' },
  { title: '夜班制度', keys: ['值守'], content: '第二条同名设定。', enabled: false, source: 'custom' }
];
const staged = [];
const knowledgeBase = {
  getDefaultEntries: () => structuredClone(builtin),
  getCustomEntries: () => structuredClone(custom),
  search: () => [],
  buildContext: () => ''
};
const stateManager = {
  get: () => ({ _ui: { settings: {} }, '世界·时间': 'K052-01-01' }),
  getSub: () => ({ settings: {} }),
  getAPIConfig: () => ({})
};
const tools = createLingXiTools({
  stateManager,
  stageVariableChange: async value => value,
  stageWorldbookChange: async value => {
    staged.push(structuredClone(value));
    return { id: `worldbook-${staged.length}`, tool: 'upsert_worldbook_entry', params: value, diff: [] };
  },
  knowledgeBase
});

assert.equal(tools.inspect_worldbook_entries.effect, 'read');
assert.equal(tools.stage_worldbook_action.effect, 'propose-write');

const disabled = await tools.inspect_worldbook_entries.execute({
  source: 'custom', status: 'disabled', query: '夜班 制度', includeContent: true
});
assert.equal(disabled.schema, LINGXI_WORLDBOOK_INSPECTION_SCHEMA);
assert.equal(disabled.summary.builtinTotal, 1);
assert.equal(disabled.summary.customTotal, 2);
assert.equal(disabled.summary.customEnabled, 1);
assert.equal(disabled.summary.customDisabled, 1);
assert.equal(disabled.entries.length, 1);
assert.equal(disabled.entries[0].index, 1);
assert.equal(disabled.entries[0].content, '第二条同名设定。');
assert.deepEqual(Object.keys(disabled.entries[0].target).sort(), ['fingerprint', 'index', 'title']);
assert.match(disabled.entries[0].target.fingerprint, /^(?:sha256:[a-f0-9]{64}|fnv1a128:[a-f0-9]{32})$/);
assert.equal(JSON.stringify(disabled).includes('[已隐藏凭据]'), false, 'target fingerprints must remain usable');

const all = await tools.inspect_worldbook_entries.execute({ source: 'all', status: 'all' });
assert.equal(all.entries[0].source, 'builtin');
assert.equal(all.entries[0].target, null);
assert.equal(all.entries.filter(entry => entry.source === 'custom').length, 2);

const disableTarget = all.entries.find(entry => entry.source === 'custom' && entry.index === 0).target;
const proposal = await tools.stage_worldbook_action.execute({
  action: 'disable', target: disableTarget, reason: '暂停第一条同名设定'
});
assert.equal(proposal.status, 'pending-human-approval');
assert.deepEqual(staged[0], {
  action: 'disable', target: disableTarget, reason: '暂停第一条同名设定'
});

await tools.stage_worldbook_action.execute({ action: 'delete_all', reason: '恢复默认世界书' });
assert.deepEqual(staged[1], { action: 'delete_all', reason: '恢复默认世界书' });
await assert.rejects(
  () => tools.stage_worldbook_action.execute({ action: 'delete', reason: '缺少目标' }),
  /必须使用 inspect_worldbook_entries 返回的 target/
);
await assert.rejects(
  () => tools.stage_worldbook_action.execute({ action: 'enable_all', target: disableTarget, reason: '批量操作不能夹带目标' }),
  /不接受单条 target/
);

console.log('Ling Xi worldbook management regression passed.');
