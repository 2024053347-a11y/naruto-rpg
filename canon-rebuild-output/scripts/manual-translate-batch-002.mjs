import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const file=path.join(root,'data/canon/timeline/shards/plot/TL-NAR-P1-WAVES-AUTO.json');const d=JSON.parse(fs.readFileSync(file,'utf8'));
const zh={
'0011':'逃到附近树林后，鸣人开始尝试从封印之书中学习忍术；他学到的第一个术竟是多重影分身之术，这让曾经连普通分身术都学不好的他十分不满。',
'0012':'木叶派出搜索队寻找鸣人并追回封印之书，伊鲁卡最先找到鸣人，发现他一直在认真修行。',
'0013':'鸣人并不知道自己做了什么，只把水木先前告诉他的话复述给伊鲁卡，使伊鲁卡意识到水木是在利用鸣人盗取封印之书，之后还打算独吞。',
'0014':'就在伊鲁卡察觉真相时，水木出现并向两人发动攻击。',
'0015':'伊鲁卡为替鸣人挡下攻击而受伤后，水木逼鸣人交出封印之书，伊鲁卡则劝鸣人不要把书交给他。',
'0016':'争执中，水木说出了所有人一直对鸣人隐瞒的真相：鸣人是九尾妖狐的人柱力。',
'0017':'鸣人受到惊吓后逃走，留下伊鲁卡和水木彼此战斗。',
'0018':'鸣人在远处观看战斗，最终得知水木真正想要的东西，也看清了伊鲁卡对自己的真心。',
'0019':'水木即将杀死伊鲁卡时，鸣人出手攻击水木，并威胁他再敢伤害自己的老师就要付出代价。',
'0020':'水木自信能一击击败鸣人，却遭到完全相反的结果：鸣人用刚学会的多重影分身之术把水木打得毫无还手之力。',
'0021':'伊鲁卡惊叹鸣人掌握了如此困难的术，最终让鸣人毕业，也讽刺般地兑现了水木最初的承诺。',
'0022':'毕业后，鸣人需要拍摄证件照。',
'0023':'鸣人没有拍普通照片，而是在脸上涂鸦，并用凶狠的姿势指向镜头。',
'0024':'三代火影得知后，要求鸣人重新拍照。',
'0025':'为了表达不满，鸣人试图用色诱术说服三代改变决定。',
'0026':'与此同时，一个小男孩正在旁边观察，并趁机试图袭击火影，却当场摔了个跟头。',
'0027':'男孩的老师惠比寿追进房间，看见鸣人后认出他是九尾妖狐的人柱力。',
'0028':'男孩指责鸣人给自己设下陷阱，鸣人则伸手抓住了他。',
'0029':'惠比寿命令鸣人放开男孩，并告诉他男孩正是三代火影的孙子。',
'0030':'男孩认定鸣人害怕火影震怒，不会真的伤害自己，于是出言挑衅；鸣人因为他不尊重亲属而一拳敲在他头上。',
'0031':'惠比寿跑到男孩身边，并告诉他如果将来想成为火影，就应该远离鸣人这种人。',
'0032':'鸣人对惠比寿施展后宫术。',
'0033':'后来鸣人发现男孩一直跟着自己，却拙劣得完全没有做好伪装。',
'0034':'伪装被识破后，男孩介绍自己名叫猿飞木叶丸，并因色诱术曾“击败”三代火影而请求鸣人教他这个术，希望借此成为火影。',
'0035':'鸣人答应下来，收木叶丸为弟子。'};
let n=0;for(const e of d.records){const k=e.id.slice(-4);if(zh[k]){e.summary=zh[k];e.qa.reviewed_by='manual-translation-batch-002';e.retrieval.tags.push('zh-reviewed');n++}}fs.writeFileSync(file,JSON.stringify(d,null,2)+'\n');const rp=path.join(root,'reports/manual-translation-report.json');const r=JSON.parse(fs.readFileSync(rp,'utf8'));r.batches.push({id:'manual-translation-batch-002',count:n,scope:'NAR-P1-WAVES beats 11-35'});r.translated_event_ids=[...new Set([...r.translated_event_ids,...Object.keys(zh).map(k=>`EV-NAR-P1-WAVES-${k}`)])];r.remaining_source_summaries=4462-r.translated_event_ids.length;fs.writeFileSync(rp,JSON.stringify(r,null,2)+'\n');console.log(`manually translated ${n}; remaining ${r.remaining_source_summaries}`);
