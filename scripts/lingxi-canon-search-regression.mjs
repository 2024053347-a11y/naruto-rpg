import assert from 'node:assert/strict';

import {
  LINGXI_CANON_SEARCH_SCHEMA,
  createLingXiTools
} from '../js/core/lingxi/lingxi-tools.js';

function createStateManager() {
  const state = {
    _ui: { settings: {} },
    '世界·时间': 'K001-01-01',
    '世界·地点': '火之国'
  };
  return {
    get(key) { return key ? structuredClone(state[key]) : structuredClone(state); },
    getSub(key) { return structuredClone(state[key]); },
    getAPIConfig() { return {}; }
  };
}

const tools = createLingXiTools({
  stateManager: createStateManager(),
  stageVariableChange: async value => value
});

assert.equal(tools.search_canon_database.effect, 'read');
assert.equal(tools.search_canon_database.inputSchema.additionalProperties, false);
assert.deepEqual(tools.search_canon_database.inputSchema.properties.kind.enum, ['all', 'plot', 'techniques']);

const technique = await tools.search_canon_database.execute({
  query: '万象天引',
  kind: 'techniques',
  limit: 1
});
assert.equal(technique.schema, LINGXI_CANON_SEARCH_SCHEMA);
assert.equal(technique.kind, 'techniques');
assert.equal(technique.plot.length, 0);
assert.equal(technique.techniques.length, 1);
assert.equal(technique.techniques[0].id, 'JT-DOJUTSU-0004');
assert.equal(technique.techniques[0].name, '万象天引');
assert.equal(typeof technique.techniques[0].cost, 'number');
assert.equal(typeof technique.techniques[0].summary, 'string');
assert.ok(technique.techniques[0].summary.length <= 1400);
assert.deepEqual(Object.keys(technique.techniques[0].database).sort(), ['custom', 'overridden']);

const plot = await tools.search_canon_database.execute({
  query: 'DAY-HIST-ANNUAL-001',
  kind: 'plot',
  limit: 1
});
assert.equal(plot.schema, LINGXI_CANON_SEARCH_SCHEMA);
assert.equal(plot.kind, 'plot');
assert.equal(plot.techniques.length, 0);
assert.equal(plot.plot.length, 1);
assert.equal(plot.plot[0].id, 'DAY-HIST-ANNUAL-001');
assert.equal(plot.plot[0].date, 'K001-01-01');
assert.ok(plot.plot[0].scenes.length <= 3);
assert.ok(plot.plot[0].scenes.every(scene => scene.beats.length <= 4));
assert.ok(plot.plot[0].yearSnapshot.characters.length <= 4);
assert.ok(plot.plot[0].yearSnapshot.factions.length <= 4);
assert.equal(plot.currentPlot.currentDate, 'K001-01-01');
assert.equal(plot.yearSnapshot.currentDate, 'K001-01-01');
assert.equal(JSON.stringify(plot).includes('backstage_truths'), false);
assert.equal(JSON.stringify(plot).includes('_database'), false);

const unbornCharacter = await tools.search_canon_database.execute({
  query: '达鲁伊',
  kind: 'plot',
  limit: 1
});
const darui = unbornCharacter.plot[0]?.yearSnapshot?.characters
  ?.find(character => character.name === '达鲁伊');
assert.ok(darui, 'matching annual snapshot should include the searched character');
assert.equal(darui.age.atYearStart, null, 'unknown or unborn ages must not be coerced to zero');
assert.equal(darui.age.afterBirthday, 0, 'a genuine numeric zero must remain distinguishable from null');

const both = await tools.search_canon_database.execute({ query: '轮回眼', limit: 2 });
assert.equal(both.kind, 'all');
assert.ok(both.plot.length <= 2);
assert.ok(both.techniques.length <= 2);
assert.ok(JSON.stringify(both).length < 30_000, 'bounded structured result should fit the assistant context');

await assert.rejects(
  () => tools.search_canon_database.execute({ query: '', kind: 'plot' }),
  /query 不能为空/
);
await assert.rejects(
  () => tools.search_canon_database.execute({ query: '木叶', kind: 'characters' }),
  /不支持的正史数据库类型/
);

console.log('Ling Xi canon database search regression passed.');
