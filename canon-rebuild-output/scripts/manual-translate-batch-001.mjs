import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'data/canon/timeline/shards/plot/TL-NAR-P1-WAVES-AUTO.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const zh={
'EV-NAR-P1-WAVES-0001':'十二年前，曾有一只名为九尾妖狐的邪恶怪物。',
'EV-NAR-P1-WAVES-0002':'某夜，九尾袭击木叶，并在袭击中杀死了许多无辜村民。',
'EV-NAR-P1-WAVES-0003':'木叶忍者无人能够阻止九尾，四代火影以封印术将它封入一个新生男婴体内，并因此付出了生命。',
'EV-NAR-P1-WAVES-0004':'九尾袭击十二年后，漩涡鸣人在忍者学校因顽劣和爱惹麻烦而声名狼藉。',
'EV-NAR-P1-WAVES-0005':'海野伊鲁卡，以及在较小程度上保护着他的三代火影，是鸣人仅有的两位正面影响者。',
'EV-NAR-P1-WAVES-0006':'尽管如此，鸣人仍不断在毕业考试中失败；考试要求学生施展分身术，以证明自己掌握了学校所教的内容。',
'EV-NAR-P1-WAVES-0007':'鸣人大多数基础术都学得不差，却始终无法正确施展分身术，因此未能通过最终毕业考试。',
'EV-NAR-P1-WAVES-0008':'鸣人躲藏起来，试图逃避考试失败带来的压力。',
'EV-NAR-P1-WAVES-0009':'另一名忍校考官水木利用鸣人再次落榜后的消沉，诱骗他盗取封印之书，并谎称只要学会书中的一个术就能自动毕业。',
'EV-NAR-P1-WAVES-0010':'鸣人没有放过这个机会，立即施展色诱术吸引三代火影的注意，趁机带着封印之书逃走。'
};
let changed=0;for(const e of data.records){if(zh[e.id]){e.summary=zh[e.id];e.qa.status='draft';e.qa.reviewed_by='manual-translation-batch-001';e.retrieval.tags.push('zh-reviewed');changed++}}
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');const reportPath=path.join(root,'reports/manual-translation-report.json');let report=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):{batches:[],translated_event_ids:[]};report.batches.push({id:'manual-translation-batch-001',count:changed,scope:'NAR-P1-WAVES first 10 beats'});report.translated_event_ids=[...new Set([...report.translated_event_ids,...Object.keys(zh)])];report.remaining_source_summaries=4462-report.translated_event_ids.length;fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(`manually translated ${changed} events; remaining ${report.remaining_source_summaries}`);
