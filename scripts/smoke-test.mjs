import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const requiredFiles = [
  'index.html',
  'manifest.json',
  'sw.js',
  'css/tokens.css',
  'css/layout.css',
  'css/components.css',
  'js/app.js',
  'js/core/ai-client.js',
  'js/core/pipeline.js',
  'js/core/state-manager.js',
  'js/systems/timeline-system.js',
  'js/ui/app-shell.js',
  'js/ui/character-creator.js'
];

const failures = [];
const pass = message => console.log(`PASS ${message}`);
const fail = message => failures.push(message);

for (const file of requiredFiles) {
  const path = join(root, file);
  existsSync(path) ? pass(`exists ${file}`) : fail(`missing ${file}`);
}

const index = readText('index.html');
if (index) {
  assertIncludes(index, 'type="module"', 'index loads ES module entry');
  assertIncludes(index, 'manifest.json', 'index links manifest');
  assertIncludes(index, '<div id="app"', 'index has app mount');
}

const sw = readText('sw.js');
if (sw) {
  assertIncludes(sw, '/v1/chat/completions', 'service worker bypasses chat API');
  assertIncludes(sw, '/api/ai-proxy', 'service worker bypasses AI proxy API');
  assertIncludes(sw, 'cache.put(event.request', 'service worker caches successful app requests');
  if (sw.includes("'/index.html'")) fail('service worker should not cache root-absolute index path');
}

const manifest = readText('manifest.json');
if (manifest) {
  const data = JSON.parse(manifest);
  data.start_url === './' ? pass('manifest uses relative start_url') : fail('manifest start_url should be ./');
  data.scope === './' ? pass('manifest uses relative scope') : fail('manifest scope should be ./');
}

const pipeline = readText('js/core/pipeline.js');
if (pipeline) {
  assertIncludes(pipeline, "['辅助', skills.support]", 'prompt summary includes support skills');
  assertIncludes(pipeline, 'worldStateSystem?.triggerEvent', 'pipeline applies event tags to world state');
  assertIncludes(pipeline, '_mergeMemoryUpdates', 'pipeline merges multiple memory tags');
  assertIncludes(pipeline, '_formatFewShot', 'pipeline formats few-shot examples');
  assertIncludes(pipeline, '_buildTimelineContext', 'pipeline injects current timeline context');
}

const prompts = readText('js/data/prompts.js');
if (prompts) {
  assertIncludes(prompts, 'export const FEW_SHOT_EXAMPLES', 'few-shot prompt examples exist');
  assertIncludes(prompts, '<think>', 'few-shot prompts include reasoning examples');
}

const worldbookIndex = readText('js/data/worldbook/index.js');
if (worldbookIndex) {
  assertIncludes(worldbookIndex, 'ERA_CONSISTENCY_ENTRIES', 'worldbook includes era consistency entries');
  assertIncludes(worldbookIndex, 'WORLD_EXPANSION_ENTRIES', 'worldbook includes expansion entries');
  assertIncludes(worldbookIndex, "version: '1.8'", 'worldbook meta version is 1.8');
}

const settingsPanel = readText('js/ui/settings-panel.js');
if (settingsPanel) {
  assertIncludes(settingsPanel, 'FONT_PRESETS[preset]?.family', 'font resolver uses complete preset map');
}

for (const file of listFiles(join(root, 'js')).filter(path => extname(path) === '.js')) {
  const result = spawnSync('node', ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) pass(`syntax ${relative(file)}`);
  else fail(`syntax ${relative(file)}\n${result.stderr || result.stdout}`);
}

const { instructionParser } = await import('../js/core/instruction-parser.js');
const parsed = instructionParser.parse([
  '<mission>{"id":"a","status":"active"}</mission>',
  '<mission>{"id":"b","status":"progress"}</mission>',
  '<relationship>{"npc":"卡卡西","trust_change":1}</relationship>',
  '<relationship>{"npc":"伊鲁卡","trust_change":2}</relationship>',
  '<event>{"id":"e1","status":"active"}</event>',
  '<event>{"id":"e2","status":"completed"}</event>',
  '<memory>{"summary":"one"}</memory>',
  '<memory>{"facts":["two"]}</memory>'
].join('\n'));
parsed.missions?.length === 2 ? pass('parser keeps multiple mission tags') : fail('parser should keep multiple mission tags');
parsed.relationships?.length === 2 ? pass('parser keeps multiple relationship tags') : fail('parser should keep multiple relationship tags');
parsed.events?.length === 2 ? pass('parser keeps multiple event tags') : fail('parser should keep multiple event tags');
parsed.memories?.length === 2 ? pass('parser keeps multiple memory tags') : fail('parser should keep multiple memory tags');

const singleVariable = instructionParser.parse('<variable>{"path":"attributes.chakra_current","op":"sub","value":15}</variable>');
const wrappedVariable = instructionParser.parse('<variable>{"updates":[{"path":"attributes.chakra_current","op":"sub","value":15}]}</variable>');
singleVariable.variables?.[0]?.path === 'attributes.chakra_current' ? pass('parser accepts single variable update object') : fail('parser should accept single variable update object');
wrappedVariable.variables?.[0]?.path === 'attributes.chakra_current' ? pass('parser accepts wrapped variable updates') : fail('parser should accept wrapped variable updates');

const { stateManager } = await import('../js/core/state-manager.js');
stateManager.reset();
stateManager.batchUpdate([
  { path: 'attributes.chakra_current', op: 'sub', value: 999 },
  { path: 'attributes.stamina_current', op: 'add', value: 999 },
  { path: 'progression.exp', op: 'add', value: 25 }
]);
stateManager.setSub('_missions', { active: { smoke_mission: { id: 'smoke_mission', title: '烟测任务' } }, completed: {} });
stateManager.setSub('_relationships', { 旗木卡卡西: { affection: 200, trust: -200, respect: 200 } });
stateManager.update([{ key: '进度·经验', op: '+', value: 0 }]);
stateManager.get('属性·当前查克拉') === 0 ? pass('state sub clamps current chakra at zero') : fail('state sub should clamp current chakra at zero');
stateManager.get('属性·当前体力') === stateManager.get('属性·体力') ? pass('state add clamps current stamina at max') : fail('state add should clamp current stamina at max');
stateManager.get('进度·经验') === 25 ? pass('state add updates progression exp') : fail('state add should update progression exp');
stateManager.getSub('_missions')?.active?.smoke_mission?.id === 'smoke_mission' ? pass('state stores active missions') : fail('state should store active missions');
stateManager.getSub('_relationships')?.旗木卡卡西?.affection === 100 ? pass('state relationship affection is bounded') : fail('state relationship affection should be bounded');
stateManager.getSub('_relationships')?.旗木卡卡西?.trust === -100 ? pass('state relationship trust is bounded') : fail('state relationship trust should be bounded');
stateManager.getSub('_relationships')?.旗木卡卡西?.respect === 100 ? pass('state relationship respect is bounded') : fail('state relationship respect should be bounded');

const snapshot = stateManager.snapshot();
stateManager.batchUpdate([{ path: 'world_state.current_location', op: 'set', value: '死亡森林' }]);
stateManager.restore(snapshot);
stateManager.get('世界·地点') === snapshot['世界·地点'] ? pass('state snapshot restore recovers location') : fail('state snapshot restore should recover location');

const { KNOWLEDGE_BASE } = await import('../js/data/knowledge-base.js');
const { WORLD_BOOK_ENTRIES, WORLD_BOOK_META } = await import('../js/data/worldbook/index.js');
WORLD_BOOK_META.version === '1.8' ? pass('worldbook runtime meta version is 1.8') : fail('worldbook runtime meta version should be 1.8');
WORLD_BOOK_ENTRIES.length >= 300 ? pass(`worldbook has ${WORLD_BOOK_ENTRIES.length} entries`) : fail('worldbook should have at least 300 entries');

const knowledgeQueries = [
  ['木叶 卡卡西 写轮眼', 'knowledge search hits Konoha/Kakashi'],
  ['晓组织 长门 小南', 'knowledge search hits Akatsuki'],
  ['封印术 人柱力 九尾', 'knowledge search hits sealing/jinchuriki'],
  ['当前时间线 疾风传 不要默认', 'knowledge search hits era consistency'],
  ['D级任务模板 木叶日常地点', 'knowledge search hits world expansion'],
  ['冰遁 雪之一族 血继幸存', 'knowledge search hits era-sensitive bloodline facts']
];
for (const [query, message] of knowledgeQueries) {
  KNOWLEDGE_BASE.search(query).length > 0 ? pass(message) : fail(`${message}: ${query}`);
}

const earlyState = {
  world_state: {
    timeline: '木叶48年',
    calendar: { year: '木叶48年', season: '春', day: 1, time_of_day: '清晨' },
    current_location: '木叶隐村',
    active_events: []
  },
  player: {},
  skills: {},
  combat: null,
  missions: { active: [] },
  relationships: {}
};
const eraContext = KNOWLEDGE_BASE.buildContext({
  query: '冰遁 雪之一族 血继幸存',
  state: earlyState,
  memory: {}
});
assertIncludes(eraContext, '世界书检索结果', 'knowledge buildContext emits worldbook block');
assertIncludes(eraContext, '木叶48年', 'knowledge buildContext keeps current early timeline');
assertIncludes(eraContext, '不能默认整个冰遁家族已经完全灭亡', 'knowledge buildContext prevents future bloodline result backfill');

if (failures.length) {
  console.error('\nSmoke test failed:');
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

console.log('\nSmoke test passed.');

function readText(file) {
  const path = join(root, file);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf8');
}

function assertIncludes(text, needle, message) {
  text.includes(needle) ? pass(message) : fail(`missing marker: ${message}`);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

function relative(path) {
  return path.replace(root, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
}
