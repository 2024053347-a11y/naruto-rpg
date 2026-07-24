import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const errors=[]; const assert=(ok,msg)=>{if(!ok)errors.push(msg)};
const pseudoEntityId=id=>/(?:-(?:DO-NOT|PLEASE|WARNING|THAT-WAS|IT-WAS|SHE-WAS|EVERYONE-CAN|ONLY-LISTED|WERE-JUST|MISTRANSLATION|SEE-(?:TALKPAGE|TRIVIA))|-ANIME(?:-|$)|-GAME(?:-|$)|-MOVIE(?:-|$)|-OVA(?:-|$)|-WITH-|-AND-|-OR-|-PUPPET-)/.test(id);
const dateRe=/^K\d{3}-(0[1-9]|1[0-2])-([0-2][1-9]|10|20|30)$/;
const arcs=new Set(read('data/canon/registries/arcs.json').map(x=>x.id));
const entityRecords=read('data/canon/registries/entities.json');
const entities=new Set(entityRecords.map(x=>x.id));
assert(entities.size===entityRecords.length,'duplicate entity id');
for(const id of entities) assert(!pseudoEntityId(id),`pseudo entity leaked into registry: ${id}`);
const earlyHistoryEntityMap=read('data/canon/registries/early-history-entity-map.json');
const earlyHistoryEntityEntries=Object.entries(earlyHistoryEntityMap);
const earlyHistoryEntityIds=earlyHistoryEntityEntries.map(([,id])=>id);
assert(earlyHistoryEntityEntries.length===64,'early-history entity map must contain exactly 64 people');
assert(new Set(earlyHistoryEntityIds).size===earlyHistoryEntityIds.length,'early-history entity map reuses a canonical id');
for(const [name,id] of earlyHistoryEntityEntries){
  assert(typeof name==='string'&&name.trim(),`early-history entity map contains an empty name`);
  assert(typeof id==='string'&&id.trim(),`${name}: early-history entity id must be non-empty`);
  assert(entities.has(id),`${name}: early-history entity id does not exist: ${id}`);
}
const projectBirths=read('data/canon/registries/project-births.json');
const birthByName=new Map(projectBirths.map(person=>[person.name,person]));
assert(birthByName.size===projectBirths.length,'duplicate project birth name');
const nonEmptyBirthEntityIds=[];
for(const person of projectBirths){
  const expectedEntityId=earlyHistoryEntityMap[person.name]??null;
  assert(person.entity_id===expectedEntityId,`${person.name}: project birth entity_id does not match early-history mapping`);
  if(person.entity_id!==null&&person.entity_id!==''){
    assert(typeof person.entity_id==='string',`${person.name}: project birth entity_id must be a string or null`);
    assert(entities.has(person.entity_id),`${person.name}: project birth entity_id does not exist: ${person.entity_id}`);
    nonEmptyBirthEntityIds.push(person.entity_id);
  }
}
assert(new Set(nonEmptyBirthEntityIds).size===nonEmptyBirthEntityIds.length,'project births reuse a non-empty canonical entity_id');
const locations=new Set(read('data/canon/registries/locations.json').map(x=>x.id));
const tm=read('data/canon/timeline/manifest.json'); const jm=read('data/canon/techniques/manifest.json');
const timelineShards=tm.shards.map(s=>read(`data/canon/timeline/${s.path}`));
const techniqueShards=jm.shards.map(s=>read(`data/canon/techniques/${s.path}`));
const events=timelineShards.flatMap(s=>s.records); const techniques=techniqueShards.flatMap(s=>s.records);
const runtimePlotIds=new Set(tm.shards.filter(s=>s.path.startsWith('shards/plot/')).flatMap(s=>read(`data/canon/timeline/${s.path}`).records||[]).map(e=>e.id));
const eventIds=new Set(events.map(x=>x.id)); const techniqueIds=new Set(techniques.map(x=>x.id));
const eventById=new Map(events.map(x=>[x.id,x]));
assert(eventIds.size===events.length,'duplicate event id'); assert(techniqueIds.size===techniques.length,'duplicate technique id');
const titles=new Set(), dayOrders=new Set(), playableSummaries=new Map();
for(const e of events){
  assert(dateRe.test(e.when.scheduled_start),`${e.id}: invalid start date`); assert(dateRe.test(e.when.scheduled_end),`${e.id}: invalid end date`); assert(e.when.scheduled_end>=e.when.scheduled_start,`${e.id}: end date precedes start date`); assert(['dawn','morning','noon','afternoon','evening','night','late_night'].includes(e.when.time_of_day),`${e.id}: missing complete time_of_day`);
  assert(arcs.has(e.arc_id),`${e.id}: unknown arc`); assert(e.source_refs.length>0,`${e.id}: missing source`);
  assert(typeof e.summary==='string'&&e.summary.trim(),`${e.id}: missing summary`);
  assert(!/[\uFFFDぁ-ゖァ-ヺ]/.test(JSON.stringify([e.summary,e.facts])),`${e.id}: plot body contains replacement or Japanese kana`);
  assert(!/待中文精校|TODO|TBD|\?\?\?/.test(JSON.stringify([e.summary,e.facts])),`${e.id}: unreviewed placeholder text`);
  const runtimeRole=e.qa?.runtime_role||'plot'; assert(['plot','recap','metadata'].includes(runtimeRole),`${e.id}: invalid runtime_role`);
  if(runtimePlotIds.has(e.id)&&runtimeRole==='plot'){
    const summary=e.summary.trim(); const prior=playableSummaries.get(summary);
    assert(!prior,`${e.id}: duplicate playable summary also used by ${prior}`); playableSummaries.set(summary,e.id);
  }
  assert(!titles.has(e.title),`${e.id}: duplicate title`); titles.add(e.title);
  const dk=`${e.when.scheduled_start}|${e.when.day_order}`; assert(!dayOrders.has(dk),`${e.id}: duplicate day_order`); dayOrders.add(dk);
  if(e.when.basis==='allocated'){assert(e.when.rationale&&e.when.anchor_event_ids,`${e.id}: incomplete allocated basis`); const w=e.when.canon_window; if(w.earliest)assert(e.when.scheduled_start>=w.earliest&&e.when.scheduled_start<=w.latest,`${e.id}: outside canon window`)}
  for(const d of e.depends_on){assert(eventIds.has(d),`${e.id}: unknown dependency ${d}`); const dep=eventById.get(d); if(dep){assert(dep.when.scheduled_start<=e.when.scheduled_start,`${e.id}: dependency ${d} occurs later`); if(dep.when.scheduled_start===e.when.scheduled_start)assert(dep.when.day_order<e.when.day_order,`${e.id}: same-day dependency ${d} is not earlier`)}}
  for(const p of e.participants) assert(entities.has(p.entity_id),`${e.id}: unknown participant ${p.entity_id}`);
  for(const l of e.location_ids) assert(locations.has(l),`${e.id}: unknown location ${l}`);
}
const powers=new Set([0,10,35,70,120,200,300]), names=new Set();
for(const t of techniques){
  assert(!names.has(t.canonical_name),`${t.id}: duplicate name`); names.add(t.canonical_name);
  assert(Number.isInteger(t.cost)&&t.cost>=1&&t.cost<=300,`${t.id}: invalid cost`); assert(powers.has(t.power),`${t.id}: invalid power`); assert(t.value_basis==='project_balance_v2',`${t.id}: invalid balance basis`); assert(['chakra','spirit','stamina'].includes(t.resource_type),`${t.id}: invalid resource_type`); assert(t.cost_design&&t.cost_design.pressure&&Array.isArray(t.cost_design.expected_uses),`${t.id}: incomplete cost_design`); assert(t.source_refs.length>0,`${t.id}: missing source`);
  if(t.variant_of) assert(techniqueIds.has(t.variant_of),`${t.id}: unknown variant_of`);
  for(const d of t.derived_from) assert(techniqueIds.has(d),`${t.id}: unknown derived_from`);
  for(const d of t.access.required_techniques) assert(techniqueIds.has(d),`${t.id}: unknown required technique`);
  assert(!/[\uFFFDぁ-ゖァ-ヺ]/.test(JSON.stringify([t.effect?.summary,t.limitations])),`${t.id}: technique body contains replacement or Japanese kana`);
  const userIds=new Set();
  for(const u of t.known_users){assert(!pseudoEntityId(u.character_id),`${t.id}: pseudo user ${u.character_id}`); assert(!userIds.has(u.character_id),`${t.id}: duplicate user ${u.character_id}`); userIds.add(u.character_id); assert(entities.has(u.character_id),`${t.id}: unknown user`); if(u.confirmed_from_event_id)assert(eventIds.has(u.confirmed_from_event_id),`${t.id}: unknown event`)}
}
const report={generated_at:new Date().toISOString(),events:events.length,techniques:techniques.length,shards:timelineShards.length+techniqueShards.length,errors,status:errors.length?'failed':'passed'};
const yearlyManifest=read('data/canon/timeline/yearly/manifest.json');
assert(yearlyManifest.years.length===86,'yearly almanac must contain K001-K086');
for(let year=1;year<=86;year++){
  const expected=`K${String(year).padStart(3,'0')}`;
  const meta=yearlyManifest.years[year-1];
  assert(meta?.year===expected,`${expected}: yearly manifest gap or order error`);
  if(!meta)continue;
  const annual=read(`data/canon/timeline/yearly/${meta.path}`);
  assert(annual.year===expected,`${expected}: file year mismatch`);
  assert(annual.annual_events.length>0,`${expected}: must contain at least one annual event/state boundary`);
  for(const p of annual.character_ages){
    const birth=birthByName.get(p.name);
    assert(Boolean(birth),`${expected}/${p.name}: character age has no project birth record`);
    if(birth)assert(p.entity_id===birth.entity_id,`${expected}/${p.name}: character age entity_id differs from project birth`);
    assert(p.age_at_year_start===(p.birth_year===year?null:year-p.birth_year-1),`${expected}/${p.name}: invalid age_at_year_start`);
    assert(p.age_after_birthday===year-p.birth_year,`${expected}/${p.name}: invalid age_after_birthday`);
  }
  for(const p of annual.birthdays){
    const birth=birthByName.get(p.name);
    assert(Boolean(birth),`${expected}/${p.name}: birthday has no project birth record`);
    if(birth)assert(p.entity_id===birth.entity_id,`${expected}/${p.name}: birthday entity_id differs from project birth`);
  }
}
report.yearly_files=yearlyManifest.years.length;
report.year_start=yearlyManifest.year_start;
report.year_end=yearlyManifest.year_end;
report.errors=errors;
report.status=errors.length?'failed':'passed';
fs.mkdirSync(path.join(root,'reports'),{recursive:true}); fs.writeFileSync(path.join(root,'reports/validation-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2)); if(errors.length)process.exit(1);
