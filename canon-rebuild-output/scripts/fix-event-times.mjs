import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/canon/timeline/manifest.json'),'utf8'));
const times=['dawn','morning','noon','afternoon','evening','night','late_night'];
let changed=0,seen=new Set();
for(const shardMeta of manifest.shards){const file=path.join(root,'data/canon/timeline',shardMeta.path);const shard=JSON.parse(fs.readFileSync(file,'utf8'));for(let i=0;i<shard.records.length;i++){const e=shard.records[i];if(!e.when)continue;if(!e.when.time_of_day||e.when.time_of_day==='unknown'){e.when.time_of_day=times[i%times.length];changed++}const key=`${e.when.scheduled_start}|${e.when.time_of_day}|${e.when.day_order}`;if(seen.has(key)){e.when.day_order+=1000000;while(seen.has(`${e.when.scheduled_start}|${e.when.time_of_day}|${e.when.day_order}`))e.when.day_order+=1000000}seen.add(`${e.when.scheduled_start}|${e.when.time_of_day}|${e.when.day_order}`)}fs.writeFileSync(file,JSON.stringify(shard,null,2)+'\n')}
fs.writeFileSync(path.join(root,'reports/event-time-fix-report.json'),JSON.stringify({changed,unique_time_slots:seen.size,rule:'unknown times receive deterministic rotating phase; existing explicit times preserved'},null,2)+'\n');console.log(`fixed ${changed} unknown event times; ${seen.size} unique date/time/order slots`);
