#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const techniqueRoot = path.join(root, 'canon-rebuild-output', 'data', 'canon', 'techniques');
const runtimeFile = path.join(root, 'js', 'data', 'generated', 'canon-runtime-data.js');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const numericId = id => Number(id.split('-').at(-1));
const shouldBeCorrected = id => (
  (id.startsWith('JT-OTHER-') && (numericId(id) >= 101 || [23, 71].includes(numericId(id))))
  || (id.startsWith('JT-SEN-') && numericId(id) >= 3)
  || (id.startsWith('JT-SPACE-') && numericId(id) >= 2)
);

const manifest = readJson(path.join(techniqueRoot, 'manifest.json'));
const sourceRecords = manifest.shards.flatMap(shard => readJson(path.join(techniqueRoot, shard.path)).records || []);
const sourceById = new Map(sourceRecords.map(record => [record.id, record]));
const correctionData = readJson(path.join(techniqueRoot, 'description-corrections.json'));
const correctionById = new Map(correctionData.corrections.map(correction => [correction.id, correction]));
const corrections = new Map(correctionData.corrections.map(correction => [correction.id, correction.summary]));
const expectedIds = sourceRecords.filter(record => shouldBeCorrected(record.id)).map(record => record.id).sort();

assert.equal(sourceRecords.length, 741, 'canonical technique record count changed unexpectedly');
assert.equal(correctionData.count, 203, 'description correction metadata count drifted');
assert.equal(corrections.size, 203, 'description corrections must have unique IDs');
assert.deepEqual([...corrections.keys()].sort(), expectedIds, 'corrected ID range drifted');

const sourceTitleFor = record => {
  const note = record.source_refs?.find(source => String(source.note || '').includes('/wiki/'))?.note || '';
  const encodedTitle = note.split('/wiki/')[1] || '';
  return decodeURIComponent(encodedTitle).replaceAll('_', ' ');
};

const forbidden = /(?:GLOSSARYTOKEN|\.png|\{\{|\[\[|undefined|unknown|智宇波|觅觅|佐井ken|砂隐傀儡旅|痛苦将)/;
for (const [id, summary] of corrections) {
  const record = sourceById.get(id);
  const correction = correctionById.get(id);
  assert.ok(record, `${id} is missing from canonical shards`);
  assert.equal(correction?.source_title, sourceTitleFor(record), `${id} correction source belongs to a different technique`);
  assert.equal(record.effect?.summary, summary, `${id} source summary differs from correction map`);
  assert.equal(record.qa?.reviewed_by, 'semantic-description-repair-2026-07-26', `${id} lost semantic review provenance`);
  assert.ok(record.retrieval?.tags?.includes('description-source-verified'), `${id} lost source verification tag`);
  assert.ok(summary.length >= 12, `${id} summary is unexpectedly short`);
  assert.ok(/[\u3400-\u9fff]/u.test(summary), `${id} summary is not Chinese`);
  assert.doesNotMatch(summary, forbidden, `${id} contains unresolved import or translation debris`);
  assert.doesNotMatch(summary, /\p{Script=Latin}{2,}/u, `${id} contains an untranslated Latin-script word`);
  assert.doesNotMatch(summary, /(?:玩家|股票|即\s*\.|柔术|隐藏术|求真球|圣人模式|贤者模式|六路痛苦|不净世界|大球螺旋丸|巨大忍者|分身体|分身人|手部密封)/u, `${id} contains a known bad translation`);
}

const summaryFor = id => sourceById.get(id)?.effect?.summary || '';
assert.match(summaryFor('JT-SPACE-0009'), /千手扉间.*时空间忍术.*术式.*瞬间转移/s, 'Flying Thunder God semantics regressed');
assert.doesNotMatch(summaryFor('JT-SPACE-0009'), /大筒木|不同维度|跨维度/, 'Flying Thunder God received dimension-travel text');
assert.match(summaryFor('JT-OTHER-0164'), /变身术.*裸体美女.*注意力/s, 'Sexy Technique semantics regressed');
assert.doesNotMatch(summaryFor('JT-OTHER-0164'), /蝎|傀儡|百机/, 'Sexy Technique received puppet text');
assert.match(summaryFor('JT-SEN-0019'), /自然能量.*仙术查克拉.*强化状态/s, 'Sage Mode semantics regressed');
assert.match(summaryFor('JT-SPACE-0017'), /逆通灵.*通灵兽.*契约.*转移/s, 'Reverse Summoning semantics regressed');
assert.ok(summaryFor('JT-OTHER-0023'), 'Calorie Control must no longer have an empty summary');
assert.ok(summaryFor('JT-OTHER-0071'), 'Double-Headed Wolf must no longer have an empty summary');

const summaries = sourceRecords.map(record => String(record.effect?.summary || '').trim());
assert.equal(summaries.filter(Boolean).length, sourceRecords.length, 'canonical techniques must all have descriptions');
assert.equal(new Set(summaries).size, sourceRecords.length, 'canonical techniques must not share copied descriptions');
assert.ok(!summaries.some(summary => summary.includes('大筒木一族使用时空术在不同维度之间旅行。')), 'known Flying Thunder God wrong text remains');
assert.ok(!summaries.some(summary => summary.startsWith('蝎使用他收集的众多傀儡，数量达到数百具。')), 'known Sexy Technique wrong text remains');

assert.ok(fs.existsSync(runtimeFile), 'generated canon runtime is missing; run npm run build-canon-runtime');
const runtimeUrl = `${pathToFileURL(runtimeFile).href}?description-regression=${Date.now()}`;
const { CANON_TECHNIQUES } = await import(runtimeUrl);
const runtimeById = new Map(CANON_TECHNIQUES.map(record => [record.id, record]));
assert.equal(CANON_TECHNIQUES.length, sourceRecords.length, 'runtime technique count differs from source');
for (const [id, summary] of corrections) {
  assert.equal(runtimeById.get(id)?.summary, summary, `${id} runtime summary is stale`);
}

console.log(`Canon technique description regression passed (${corrections.size} repaired / ${sourceRecords.length} total)`);
