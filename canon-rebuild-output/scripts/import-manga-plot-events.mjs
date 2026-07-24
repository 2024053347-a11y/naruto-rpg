import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const api='https://naruto.fandom.com/api.php';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wiki(page,redirectDepth=0){const u=new URL(api);for(const [k,v] of Object.entries({action:'parse',page,prop:'wikitext',format:'json',formatversion:'2'}))u.searchParams.set(k,v);for(let n=0;n<4;n++){const r=await fetch(u,{headers:{'User-Agent':'naruto-rpg-plot-import/1.0'}});if(r.ok){const j=await r.json();const w=j.parse?.wikitext||'';const red=/^#REDIRECT\s*\[\[([^\]]+)\]\]/i.exec(w);if(red&&redirectDepth<3)return wiki(red[1],redirectDepth+1);return w}await sleep(500*(n+1))}throw new Error(`fetch failed: ${page}`)}
function clean(s=''){return s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi,'').replace(/<ref[^/>]*\/>/gi,'').replace(/\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}/g,'').replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g,'$1').replace(/\[https?:[^\s\]]+\s*([^\]]*)\]/g,'$1').replace(/'''?/g,'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()}
function summarySentences(w){const heading=/^==\s*(Summary|Synopsis)\s*==\s*$/mi.exec(w);let body='';if(heading){body=w.slice(heading.index+heading[0].length);const stop=body.search(/^==\s*[^=].*==\s*$/mi);if(stop>=0)body=body.slice(0,stop)}const extract=text=>{const normalized=text.replace(/^={3,}[^\n]+={3,}$/gm,'\n').replace(/^\*.*$/gm,'').replace(/^\{\|[\s\S]*?^\|\}/gm,'');const paragraphs=normalized.split(/\n\s*\n/).map(clean).filter(x=>x.length>=35);const sentences=[];for(const p of paragraphs){for(const s of p.split(/(?<=[.!?])\s+(?=[A-Z])/)){const c=clean(s);if(c.length>=30&&c.length<=900&&!/^(Trivia|References|Notes):/i.test(c))sentences.push(c)}}return[...new Set(sentences)]};let result=extract(body);if(!result.length)result=extract(w.split(/^==/m)[0]);return result}
const arcs=[
  ['NAR-P1-WAVES','Prologue — Land of Waves',1,33,'K064-03-01','K064-03-24','manga_canon','NARUTO','波之国篇'],
  ['NAR-P1-CHUNIN','Chūnin Exams (Arc)',34,115,'K064-04-01','K064-05-15','manga_canon','NARUTO','中忍考试篇'],
  ['NAR-P1-CRUSH','Konoha Crush (Arc)',116,138,'K064-05-16','K064-05-18','manga_canon','NARUTO','木叶崩溃篇'],
  ['NAR-P1-TSUNADE','Search for Tsunade',139,171,'K064-06-01','K064-06-20','manga_canon','NARUTO','寻找纲手篇'],
  ['NAR-P1-SASUKE','Sasuke Recovery Mission',172,238,'K065-01-01','K065-01-10','manga_canon','NARUTO','佐助夺还篇'],
  ['NAR-GAIDEN','Kakashi Gaiden',239,244,'K050-06-01','K050-06-05','manga_canon','NARUTO','卡卡西外传'],
  ['NAR-P2-GAARA','Kazekage Rescue Mission',245,281,'K067-01-01','K067-01-20','manga_canon','NARUTO','风影夺还篇'],
  ['NAR-P2-TENCHI','Tenchi Bridge Reconnaissance Mission',282,310,'K067-02-01','K067-02-12','manga_canon','NARUTO','天地桥侦察篇'],
  ['NAR-P2-AKATSUKI','Akatsuki Suppression Mission',311,342,'K067-03-01','K067-03-15','manga_canon','NARUTO','飞段角都篇'],
  ['NAR-P2-ITACHI','Itachi Pursuit Mission',343,367,'K067-04-01','K067-04-15','manga_canon','NARUTO','追踪鼬篇'],
  ['NAR-P2-JIRAIYA','Tale of Jiraiya the Gallant',368,383,'K067-05-01','K067-05-08','manga_canon','NARUTO','自来也豪杰物语'],
  ['NAR-P2-BROTHERS','Fated Battle Between Brothers',384,412,'K067-06-01','K067-06-12','manga_canon','NARUTO','兄弟宿命之战'],
  ['NAR-P2-PAIN','Pain\'s Assault (Arc)',413,453,'K067-08-01','K067-08-20','manga_canon','NARUTO','佩恩袭击篇'],
  ['NAR-P2-KAGE','Five Kage Summit (Arc)',454,483,'K067-09-01','K067-09-15','manga_canon','NARUTO','五影会谈篇'],
  ['NAR-P2-COUNTDOWN','Fourth Shinobi World War: Countdown',484,515,'K067-10-01','K067-12-30','manga_canon','NARUTO','大战倒计时篇'],
  ['NAR-P2-CONFRONT','Fourth Shinobi World War: Confrontation',516,559,'K068-01-01','K068-01-01','manga_canon','NARUTO','第四次忍界大战·交战'],
  ['NAR-P2-CLIMAX','Fourth Shinobi World War: Climax',560,639,'K068-01-02','K068-01-02','manga_canon','NARUTO','第四次忍界大战·高潮'],
  ['NAR-P2-JINCHURIKI','Birth of the Ten-Tails\' Jinchūriki',640,677,'K068-01-03','K068-01-03','manga_canon','NARUTO','十尾人柱力诞生篇'],
  ['NAR-P2-KAGUYA','Kaguya Ōtsutsuki Strikes',678,699,'K068-01-03','K068-02-02','manga_canon','NARUTO','辉夜降临篇'],
  ['BOR-SARADA','Sarada Uchiha Arc',701,710,'K082-08-01','K082-08-10','boruto_manga','NARUTO GAIDEN','佐良娜篇'],
  ['BOR-MOMOSHIKI','Versus Momoshiki Arc',1,10,'K083-03-01','K083-03-15','boruto_manga','BORUTO','桃式篇'],
  ['BOR-MUJINA','Mujina Bandits Arc',11,15,'K083-04-01','K083-04-10','boruto_manga','BORUTO','貉强盗团篇'],
  ['BOR-AO','Ao Arc',16,23,'K083-05-01','K083-05-15','boruto_manga','BORUTO','青篇'],
  ['BOR-KAWAKI','Kawaki Arc',24,55,'K083-06-01','K084-06-30','boruto_manga','BORUTO','川木篇'],
  ['BOR-CODE','Code\'s Assault Arc',56,67,'K085-01-01','K085-03-30','boruto_manga','BORUTO','考德袭击篇'],
  ['BOR-OMNIPOTENCE','Omnipotence Arc',68,80,'K085-04-01','K085-06-30','boruto_manga','BORUTO','全能篇'],
  ['BOR-RETURN','Boruto\'s Return Arc',1,15,'K086-01-01','K086-04-30','boruto_manga','BORUTO TWO BLUE VORTEX','博人归来篇'],
  ['BOR-MATSURI','Matsuri and Ryū Arc',16,25,'K086-05-01','K086-07-30','boruto_manga','BORUTO TWO BLUE VORTEX','祭与龙篇']
];
function dayNumber(date){const m=/^K(\d{3})-(\d{2})-(\d{2})$/.exec(date);return Number(m[1])*360+(Number(m[2])-1)*30+Number(m[3])-1}
function fromDay(n){const y=Math.floor(n/360),r=n-y*360,m=Math.floor(r/30)+1,d=r%30+1;return`K${String(y).padStart(3,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
const outDir=path.join(root,'data/canon/timeline/shards/plot');fs.mkdirSync(outDir,{recursive:true});
const reviewDir=path.join(root,'data/canon/timeline/reviews/plot');fs.mkdirSync(reviewDir,{recursive:true});
const shardMeta=[];const importReport=[];
for(let arcIndex=0;arcIndex<arcs.length;arcIndex++){const [code,page,chStart,chEnd,dateStart,dateEnd,continuity,work,cnArc]=arcs[arcIndex];
  process.stdout.write(`fetching ${page}... `);let w='';try{w=await wiki(page)}catch(e){console.log('FAILED');importReport.push({code,page,error:e.message});continue}const sentences=summarySentences(w);const start=dayNumber(dateStart),end=dayNumber(dateEnd);const records=sentences.map((summary,i)=>{const date=fromDay(start+Math.floor((end-start)*i/Math.max(1,sentences.length-1)));const id=`EV-${code}-${String(i+1).padStart(4,'0')}`;return{id,title:`${cnArc}·剧情节拍${String(i+1).padStart(3,'0')}`,aliases:[page],continuity,arc_id:`ARC-${code}`,parent_event_id:null,when:{scheduled_start:date,scheduled_end:date,time_of_day:'unknown',day_order:(arcIndex+1)*100000+(i+1)*10,basis:'allocated',source_precision:'sequence_only',canon_window:{earliest:dateStart,latest:dateEnd},confidence:'low',anchor_event_ids:i?[`EV-${code}-${String(i).padStart(4,'0')}`]:[],rationale:`依据${work}漫画第${chStart}-${chEnd}章篇章顺序，在项目窗口内均匀分配；具体日不是原著明示。`},summary:`【待中文精校】${summary}`,facts:[summary],participants:[],location_ids:[],depends_on:i?[`EV-${code}-${String(i).padStart(4,'0')}`]:[],applicability:{required:[],blockers:[],ai_instruction:'根据当前存档裁定发生、改写、跳过或延期。'},canonical_outcomes:[],knowledge:{public_at_time:[],restricted_at_time:[],hidden_truth:[]},retrieval:{keys:[cnArc,page],tags:[continuity,code.toLowerCase()],spoiler_level:continuity==='boruto_manga'?4:2},source_refs:[{type:'manga',work,chapter_start:chStart,chapter_end:chEnd,pages:null,supports:['sequence','summary'],note:`资料定位页：https://naruto.fandom.com/wiki/${encodeURIComponent(page.replace(/ /g,'_'))}`}],qa:{status:'draft',generated_batch:`TL-${code}-AUTO`,reviewed_by:null}}});
  const shardId=`TL-${code}-AUTO`,file=`plot/${shardId}.json`;const shard={$schema:'../../../schemas/timeline-event.schema.json',schema_version:'naruto.timeline.v1',dataset:continuity==='boruto_manga'?'boruto-manga':'naruto-manga-databook',calendar:{id:'konoha-360-v1',months_per_year:12,days_per_month:30},shard:{id:shardId,arc_id:`ARC-${code}`,part:1,id_start:1,id_end:records.length,date_start:dateStart,date_end:dateEnd,source_coverage:[{type:'manga',work,chapter_start:chStart,chapter_end:chEnd}]},records,unresolved:sentences.length?[]:[{temporary_key:`${code}-summary-empty`,issue:'在线篇章页未提取到Summary段落。',source_ref:{type:'web_locator',work:page}}]};fs.writeFileSync(path.join(root,'data/canon/timeline/shards',file),JSON.stringify(shard,null,2)+'\n');shardMeta.push({id:shardId,path:`shards/${file}`,id_range:[1,records.length],continuity});const review={batch_id:shardId,replacements:[],deletions:[],unresolved:sentences.length?[]:[{id:`${code}-summary-empty`}],review_notes:[`漫画章节范围：${work} ${chStart}-${chEnd}。`,`自动从篇章Summary拆出${records.length}个顺序节拍。`,`摘要保留英文原文并标记待中文精校；需逐章核实是否混有动画扩写。`,`全部保持draft，不进入正式运行时索引。`]};fs.writeFileSync(path.join(reviewDir,`${shardId}.review.json`),JSON.stringify(review,null,2)+'\n');importReport.push({code,page,work,chapters:[chStart,chEnd],records:records.length,date_window:[dateStart,dateEnd],continuity});console.log(records.length)}
const manifestPath=path.join(root,'data/canon/timeline/manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));manifest.shards=manifest.shards.filter(s=>!s.path.startsWith('shards/plot/')).concat(shardMeta);manifest.continuities={manga_canon:'NARUTO漫画1-700章',boruto_manga:'NARUTO外传与BORUTO漫画独立连续性'};fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const arcsPath=path.join(root,'data/canon/registries/arcs.json');const registry=JSON.parse(fs.readFileSync(arcsPath,'utf8'));const known=new Set(registry.map(x=>x.id));for(const [code,page,chStart,chEnd,,,continuity,work,cnArc] of arcs){const id=`ARC-${code}`;if(!known.has(id)){registry.push({id,name:cnArc,continuity,work,chapter_start:chStart,chapter_end:chEnd,source_page:page});known.add(id)}}fs.writeFileSync(arcsPath,JSON.stringify(registry,null,2)+'\n');
fs.writeFileSync(path.join(root,'reports/plot-event-import-report.json'),JSON.stringify({generated_at:new Date().toISOString(),arcs:importReport,total_records:importReport.reduce((n,x)=>n+(x.records||0),0)},null,2)+'\n');console.log(`imported ${importReport.reduce((n,x)=>n+(x.records||0),0)} plot beats`);
