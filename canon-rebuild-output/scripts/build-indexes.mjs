import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const timelineManifest = read('data/canon/timeline/manifest.json');
const techniqueManifest = read('data/canon/techniques/manifest.json');
const timelineSourceRecords = timelineManifest.shards.flatMap(s => read(`data/canon/timeline/${s.path}`).records);
const techniqueSourceRecords = techniqueManifest.shards.flatMap(s => read(`data/canon/techniques/${s.path}`).records);
// 正式运行时索引只接收已经独立审核批准的记录。draft 仍保留在权威源分片中供审核。
const timelines = timelineSourceRecords.filter(record => record.qa?.status === 'approved');
const techniques = techniqueSourceRecords.filter(record => record.qa?.status === 'approved');
const sortObject = value => Array.isArray(value) ? value.map(sortObject) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sortObject(value[k])])) : value;
const stable = value => JSON.stringify(sortObject(value));
const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const push = (map, key, value) => { (map[key] ||= []).push(value); };

const timelineIndex = { byId:{}, byDate:{}, byDateTime:{}, byEntity:{}, byArc:{}, byKey:{} };
for (const e of timelines.sort((a,b) => a.id.localeCompare(b.id))) {
  timelineIndex.byId[e.id] = e;
  push(timelineIndex.byDate, e.when.scheduled_start, e.id);
  push(timelineIndex.byDateTime, `${e.when.scheduled_start}|${e.when.time_of_day}`, e.id);
  push(timelineIndex.byArc, e.arc_id, e.id);
  for (const p of e.participants) push(timelineIndex.byEntity, p.entity_id, e.id);
  for (const k of e.retrieval.keys) push(timelineIndex.byKey, k.normalize('NFKC').toLowerCase(), e.id);
}
const techniqueIndex = { byId:{}, byCanonicalName:{}, byAlias:{}, byClass:{}, byElement:{}, byKnownUser:{}, variants:{} };
for (const t of techniques.sort((a,b) => a.id.localeCompare(b.id))) {
  techniqueIndex.byId[t.id] = t;
  techniqueIndex.byCanonicalName[t.canonical_name] = t.id;
  for (const a of t.aliases) techniqueIndex.byAlias[a.normalize('NFKC').toLowerCase()] = t.id;
  for (const c of t.classes) push(techniqueIndex.byClass, c, t.id);
  for (const e of t.elements) push(techniqueIndex.byElement, e, t.id);
  for (const u of t.known_users) push(techniqueIndex.byKnownUser, u.character_id, t.id);
  if (t.variant_of) push(techniqueIndex.variants, t.variant_of, t.id);
}
fs.mkdirSync(path.join(root, 'js/data/generated'), {recursive:true});
fs.writeFileSync(path.join(root, 'js/data/generated/canon-timeline-index.js'), `export const CANON_TIMELINE_INDEX = ${JSON.stringify(timelineIndex,null,2)};\nexport const CANON_TIMELINE_HASH = '${hash(timelineIndex)}';\n`);
fs.writeFileSync(path.join(root, 'js/data/generated/canon-technique-index.js'), `export const CANON_TECHNIQUE_INDEX = ${JSON.stringify(techniqueIndex,null,2)};\nexport const CANON_TECHNIQUE_HASH = '${hash(techniqueIndex)}';\n`);
console.log(`source: ${timelineSourceRecords.length} events, ${techniqueSourceRecords.length} techniques`);
console.log(`runtime approved: ${timelines.length} events, ${techniques.length} techniques`);
