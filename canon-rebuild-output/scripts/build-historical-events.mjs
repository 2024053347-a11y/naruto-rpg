import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const yearlyDir=path.join(root,'data/canon/timeline/yearly');
const yearly=JSON.parse(fs.readFileSync(path.join(yearlyDir,'manifest.json'),'utf8'));
const records=[];
for(const meta of yearly.years){
  const annual=JSON.parse(fs.readFileSync(path.join(yearlyDir,meta.path),'utf8'));
  annual.annual_events.forEach((summary,index)=>{
    const birth=/^(K\d{3}-\d{2}-\d{2})：(.+)出生。$/.exec(summary);
    const date=birth?.[1]||`${annual.year}-01-01`;
    const id=`EV-YEAR-${annual.year.slice(1)}-${String(index+1).padStart(4,'0')}`;
    records.push({id,title:birth?`${birth[2]}出生`:`${annual.year}年度状态边界${String(index+1).padStart(2,'0')}`,aliases:[annual.era],continuity:annual.continuity,arc_id:'ARC-YEARLY-ALMANAC',parent_event_id:null,when:{scheduled_start:date,scheduled_end:date,time_of_day:birth?'morning':'dawn',day_order:9000000+Number(annual.year.slice(1))*10000+(index+1)*10,basis:'allocated',source_precision:birth?'month_day':'year_only',canon_window:{earliest:`${annual.year}-01-01`,latest:`${annual.year}-12-30`},confidence:'low',anchor_event_ids:[],rationale:'依据项目年度纪年与人物生日资料分配；原著未必明确木叶绝对年份。'},summary,facts:[summary],participants:[],location_ids:[],depends_on:[],applicability:{required:[],blockers:[],ai_instruction:'年度边界用于年龄和时代状态校验；具体剧情仍按当前分支裁定。'},canonical_outcomes:[],knowledge:{public_at_time:[],restricted_at_time:[],hidden_truth:[]},retrieval:{keys:[annual.year,annual.era,birth?.[2]].filter(Boolean),tags:['yearly-almanac',annual.continuity],spoiler_level:annual.continuity==='boruto_manga'?4:2},source_refs:[{type:'project_chronology',work:'K001-K086年度总表',entry:annual.year,pages:null,supports:['project_date','age_boundary','summary']}],qa:{status:'draft',generated_batch:'TL-YEARLY-ALMANAC-AUTO',reviewed_by:null}})
  })
}
const shardId='TL-YEARLY-ALMANAC-AUTO';const file='shards/TL-YEARLY-ALMANAC-AUTO.json';
const shard={$schema:'../../schemas/timeline-event.schema.json',schema_version:'naruto.timeline.v1',dataset:'project-chronology-with-manga-anchors',calendar:{id:'konoha-360-v1',months_per_year:12,days_per_month:30},shard:{id:shardId,arc_id:'ARC-YEARLY-ALMANAC',part:1,id_start:1,id_end:records.length,date_start:'K001-01-01',date_end:'K086-12-30',source_coverage:[{type:'project_chronology',work:'用户纪年、项目世界书、漫画与公式书锚点'}]},records,unresolved:[]};
fs.writeFileSync(path.join(root,'data/canon/timeline',file),JSON.stringify(shard,null,2)+'\n');
const manifestPath=path.join(root,'data/canon/timeline/manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));manifest.shards=manifest.shards.filter(s=>s.id!==shardId);manifest.shards.unshift({id:shardId,path:file,id_range:[1,records.length],continuity:'mixed_project_boundaries'});fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const arcsPath=path.join(root,'data/canon/registries/arcs.json');const arcs=JSON.parse(fs.readFileSync(arcsPath,'utf8'));if(!arcs.some(x=>x.id==='ARC-YEARLY-ALMANAC'))arcs.push({id:'ARC-YEARLY-ALMANAC',name:'K001-K086年度状态边界',continuity:'mixed_project_boundaries'});fs.writeFileSync(arcsPath,JSON.stringify(arcs,null,2)+'\n');
fs.writeFileSync(path.join(root,'data/canon/timeline/reviews/TL-YEARLY-ALMANAC-AUTO.review.json'),JSON.stringify({batch_id:shardId,replacements:[],deletions:[],unresolved:[],review_notes:[`从86个年度文件生成${records.length}条可检索事件。`,`生日事件精确到项目月日并分配为morning；其他年度状态默认安排在当年第一日dawn。`,`用户提供但原著未明确的年份保持allocated/draft。`]},null,2)+'\n');
console.log(`built ${records.length} yearly boundary events`);
