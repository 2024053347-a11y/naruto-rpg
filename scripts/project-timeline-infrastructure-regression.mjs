import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  PROJECT_TIMELINE_ID_PATTERNS,
  PROJECT_TIMELINE_NAMESPACES,
  timelineManifestPayload,
  timelineShardPayload
} from '../canon-rebuild-output/scripts/project-timeline-v2/contract.mjs';
import { createTimelineHelpers, defineTimelineShard } from '../canon-rebuild-output/scripts/project-timeline-v2/helpers.mjs';
import { loadTimelineShardDefinitions } from '../canon-rebuild-output/scripts/project-timeline-v2/source-loader.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

const fallback = [{
  condition: '基准前置改变。', status: 'altered',
  direction: '按当前分支改写。', preserves: '保留核心因果。'
}];
const definitions = await loadTimelineShardDefinitions();

test('source discovery finds existing shards without a handwritten registry', () => {
  const ids = definitions.map(item => item.id);
  const namespaces = [...new Set(definitions.map(item => item.namespace))];
  assert.ok(ids.length >= PROJECT_TIMELINE_NAMESPACES.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => PROJECT_TIMELINE_ID_PATTERNS.shard.test(id)));
  assert.deepEqual(namespaces.sort(), [...PROJECT_TIMELINE_NAMESPACES].sort());
});

test('every supported namespace produces internally consistent IDs', () => {
  for (const namespace of PROJECT_TIMELINE_NAMESPACES) {
    const helpers = createTimelineHelpers(namespace);
    const scene = helpers.scene(
      'INFRA-SCENE-01', '基础设施测试', 'INFRA', '测试地点', ['玩家角色'], 'interactive',
      '玩家面对一个可验证的测试选择。', [helpers.beat('玩家决定测试分支。', 'choice')],
      ['测试得到明确结果。'], ['测试状态发生变化。'], '选择结算后停止。', '验证时代化 ID。',
      { requirements: ['测试日期已经到达。'], blockers: ['测试前置已失效。'], fallbacks: fallback }
    );
    const day = helpers.day(
      'INFRA-001', 'K067-01-01', '基础设施测试日', 'INFRA', '验证时代命名空间。',
      ['测试开始。'], [scene], ['测试结束。'], '进入下一测试日。'
    );
    assert.match(day.id, PROJECT_TIMELINE_ID_PATTERNS.day);
    assert.match(day.arc_id, PROJECT_TIMELINE_ID_PATTERNS.arc);
    assert.match(scene.id, PROJECT_TIMELINE_ID_PATTERNS.scene);
    assert.match(scene.thread_id, PROJECT_TIMELINE_ID_PATTERNS.thread);
    assert.match(scene.beats[0].id, PROJECT_TIMELINE_ID_PATTERNS.beat);
    assert.ok([day.id, day.arc_id, scene.id, scene.thread_id, scene.beats[0].id]
      .every(id => id.includes(`-${namespace}-`)));
  }
});

test('scene helper rejects split options instead of silently dropping trailing metadata', () => {
  const helpers = createTimelineHelpers('P2');
  assert.throws(() => helpers.scene(
    'INFRA-EXTRA-ARGS-01', '多余参数测试', 'INFRA', '测试地点', ['测试角色'], 'conditional',
    '调用者错误地把 guard 与来源元数据拆成两个配置对象。', [helpers.beat('触发 helper 边界检查。', 'setup')],
    ['测试应在生成数据前失败。'], ['不允许静默丢失来源。'], '检测到多余参数后停止。', '防止来源与事实元数据被吞掉。',
    { requirements: ['测试已启动。'], blockers: ['测试前置失效。'], fallbacks: fallback },
    { sources: [{ kind: 'original', reference: '不应被忽略的来源', contribution: '验证多余参数检查' }] }
  ), /scene accepts exactly one options object/);
});

test('a writer can define and schema-validate a P2 shard with short codes', () => {
  const helpers = createTimelineHelpers('P2');
  const scene = helpers.scene(
    'RETURN-01', '归村登记', 'RETURN', '木叶正门', ['玩家角色', '木叶门卫'], 'interactive',
    '归村人员需要完成身份与任务登记。', [helpers.beat('玩家提交或说明归村凭证。', 'choice')],
    ['归村状态得到裁定。'], ['人员位置进入木叶。'], '门卫完成登记或明确拒绝入村。', '提供可玩的时代入口。',
    { requirements: ['归村人员抵达木叶正门。'], blockers: ['木叶正门无法使用。'], fallbacks: fallback }
  );
  const day = helpers.day(
    'RETURN-001', 'K067-01-01', '修行归来', 'RETURN', '建立疾风传开局状态。',
    ['鸣人尚在村外。'], [scene], ['归村结果已登记。'], '后续任务按实际归村结果启动。'
  );
  const definition = defineTimelineShard({
    namespace: 'P2', code: 'RETURN', arcCodes: ['RETURN'],
    dateStart: day.date, dateEnd: day.date, days: [day]
  });
  const payload = timelineShardPayload(definition);
  const schema = JSON.parse(readFileSync(new URL(
    '../canon-rebuild-output/data/canon/schemas/project-timeline.schema.json', import.meta.url
  ), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(definition.id, 'P2-RETURN');
  assert.deepEqual(definition.arcIds, ['ARC-P2-RETURN']);
  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
});

test('manifest separates supported namespaces from integrated content', () => {
  const manifest = timelineManifestPayload(definitions);
  assert.deepEqual(manifest.supported_namespaces, ['HIST', 'P1', 'P2', 'BOR']);
  assert.deepEqual(manifest.included_namespaces, ['HIST', 'P1', 'P2', 'BOR']);
  assert.equal(manifest.scope, 'multi_era_incremental');
  assert.equal(manifest.shards.length, definitions.length);
});

test('unsupported namespaces and cross-era arc ownership are rejected', () => {
  assert.throws(() => createTimelineHelpers('P3'), /Unsupported project timeline namespace/);
  assert.throws(() => defineTimelineShard({
    namespace: 'P2', code: 'BAD', arcCodes: ['ARC-BOR-BAD'],
    dateStart: 'K067-01-01', dateEnd: 'K067-01-01', days: [{}]
  }), /cannot own arc ID/);
});

console.log(`PASS ${passed} project timeline infrastructure checks.`);
