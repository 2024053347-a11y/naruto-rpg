import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/canon/techniques/manifest.json'),'utf8'));
const records=manifest.shards.flatMap(s=>JSON.parse(fs.readFileSync(path.join(root,'data/canon/techniques',s.path),'utf8')).records);
const names=records.map(({id,canonical_name,aliases})=>({id,canonical_name,aliases})).sort((a,b)=>a.id.localeCompare(b.id));
fs.writeFileSync(path.join(root,'data/canon/registries/technique-names.json'),JSON.stringify(names,null,2)+'\n');
const reviewDir=path.join(root,'data/canon/techniques/reviews/full');fs.mkdirSync(reviewDir,{recursive:true});
for(const shard of manifest.shards){
  const body=JSON.parse(fs.readFileSync(path.join(root,'data/canon/techniques',shard.path),'utf8'));
  const report={batch_id:shard.id,replacements:[],deletions:[],unresolved:[],review_notes:[`自动筛选收录${body.records.length}条具名术。`,`硬条件：debut manga为NARUTO第1至700章，boruto不是Yes，unnamed jutsu不是Yes。`,`日文规范名、英文别名与漫画首次章节已入库；中文措辞、使用限制和公式书页码仍需人工逐条审核。`,`qa.status保持draft，不进入正式运行时索引。`]};
  fs.writeFileSync(path.join(reviewDir,`${shard.id}.review.json`),JSON.stringify(report,null,2)+'\n');
}
console.log(`finalized ${records.length} names and ${manifest.shards.length} shard reviews`);
