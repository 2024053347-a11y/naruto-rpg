import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/canon/timeline/shards/plot');
const fixes = {
  'EV-NAR-P1-SASUKE-0095':'鸣人与佐助在终结之谷展开第一次决战。',
  'EV-NAR-P1-TSUNADE-0151':'大蛇丸无法再使用巨蛇后冲向自来也，伸长脖子试图咬中自来也。',
  'EV-NAR-P1-TSUNADE-0152':'自来也将头发伸长并化为尖刺进行防御，双方一时陷入僵持。',
  'EV-NAR-P1-TSUNADE-0153':'静音与兜交战，却被兜躲过攻击并潜入地下；兜割断她脚踝的肌肉，使她倒地。',
  'EV-NAR-P1-TSUNADE-0154':'与此同时，鸣人与兜的蛇搏斗；他刚从蛇口逃出，蛇便压住他的腿，使他无法动弹。',
  'EV-NAR-P1-TSUNADE-0155':'纲手恢复意识后，发现静音和鸣人都已倒地败北。',
  'EV-NAR-P1-TSUNADE-0156':'想起绳树和断的死，纲手试图抵挡逼近的兜，却很快被兜压制。',
  'EV-NAR-P1-TSUNADE-0157':'兜正要给予致命一击时，鸣人挡在纲手面前，用护额挡住了兜的拳头。',
  'EV-NAR-P1-TSUNADE-0158':'鸣人对兜使用完成的螺旋丸。',
  'EV-NAR-P1-TSUNADE-0159':'兜对鸣人的突然介入感到惊讶，一时陷入僵直。',
  'EV-NAR-P1-TSUNADE-0160':'鸣人趁机试图用螺旋丸攻击兜，但动作缓慢而笨拙，兜轻易躲开。',
  'EV-NAR-P1-TSUNADE-0161':'鸣人因速度不足倒在地上，兜嘲讽他毫无才能、梦想也注定无法实现。',
  'EV-NAR-P1-TSUNADE-0162':'兜的侮辱让纲手联想到绳树和断，也想起自己此前对鸣人说过的类似话语。',
  'EV-NAR-P1-TSUNADE-0163':'鸣人反驳兜，提醒纲手两人的赌约，随后制造出一个影分身。',
  'EV-NAR-P1-TSUNADE-0164':'兜持苦无冲向鸣人，纲手请求鸣人逃走以实现梦想，但鸣人选择站在原地。',
  'EV-NAR-P1-TSUNADE-0165':'鸣人任由兜发动攻击，并用手抓住苦无，挡下最危险的一击。',
  'EV-NAR-P1-TSUNADE-0166':'鸣人抓住兜的手，用空出的手制造螺旋丸，并让影分身协助完成术式。',
  'EV-NAR-P1-TSUNADE-0167':'螺旋丸完成后，鸣人将球体压入兜的腹部，兜无法躲避。',
  'EV-NAR-P1-TSUNADE-0168':'兜只来得及抓住鸣人的胸口，便被螺旋丸击飞并撞上岩石。',
  'EV-NAR-P1-TSUNADE-0169':'尘埃散去后，兜腹部出现深重伤口；他在攻击前聚集于腹部的查克拉立即开始修复伤势。',
  'EV-NAR-P1-TSUNADE-0170':'外部伤势几乎愈合，但兜因内部损伤倒下；查克拉储备不足使他无法完全恢复。',
  'EV-NAR-P1-TSUNADE-0171':'兜最后一次试图击败鸣人，这次攻击使鸣人昏倒。',
  'EV-NAR-P1-TSUNADE-0172':'纲手赶来查看，发现兜削弱了鸣人的心肌，导致他的心跳紊乱。',
  'EV-NAR-P1-TSUNADE-0173':'纲手拼命治疗鸣人，不仅要救他，也想挽救绳树和断的梦想。',
  'EV-NAR-P1-TSUNADE-0174':'治疗期间，鸣人体内的九尾察觉宿主生命力正在消退，便贡献力量以拯救鸣人和自己。',
  'EV-NAR-P1-TSUNADE-0175':'纲手继续治疗时，疲惫的鸣人醒来，抓住她的项链并宣称那是自己的。',
  'EV-NAR-P1-TSUNADE-0176':'鸣人疲惫睡去后，纲手将项链戴在他脖子上，希望它的新主人终有一天成为火影。',
  'EV-NAR-P1-TSUNADE-0177':'大蛇丸目睹鸣人的潜力后，担心他落入晓之手，决定趁鸣人虚弱时杀死他。',
  'EV-NAR-P1-TSUNADE-0178':'大蛇丸将自来也摔倒后，口中叼着草薙剑扑向鸣人。',
  'EV-NAR-P1-TSUNADE-0179':'纲手看穿大蛇丸的目标，跃到鸣人面前充当肉盾，草薙剑贯穿了她的心脏。',
  'EV-NAR-P1-TSUNADE-0180':'大蛇丸说自己本无意杀死纲手，纲手则回应说绝不会让鸣人受到伤害。',
  'EV-NAR-P1-TSUNADE-0181':'大蛇丸拔出长剑后质问纲手为何要救鸣人；纲手回答，她保护鸣人就是在保护木叶，因为鸣人将成为未来的火影。',
  'EV-NAR-P1-TSUNADE-0182':'大蛇丸嘲讽火影继承人为木叶繁荣牺牲生命，纲手表示自己也愿为此牺牲。',
  'EV-NAR-P1-TSUNADE-0183':'大蛇丸认为纲手是在白白送命，便横斩她的胸口，使她倒地。',
  'EV-NAR-P1-TSUNADE-0184':'大蛇丸以为纲手至少已无法战斗，准备对鸣人下杀手，却再次被纲手挡住。',
  'EV-NAR-P1-TSUNADE-0185':'纲手因疲惫倒地后，身体不再颤抖，对鲜血的恐惧终于克服。',
  'EV-NAR-P1-TSUNADE-0186':'纲手起身将大蛇丸击退，说明自己保护鸣人的决心源于一个身份：她将成为第五代火影。',
  'EV-NAR-P1-TSUNADE-0187':'三忍展开对决。',
  'EV-NAR-P1-TSUNADE-0188':'纲手首先启动额头的封印，彻底再生大蛇丸造成的伤势。',
  'EV-NAR-P1-TSUNADE-0189':'大蛇丸意识到纲手已恢复最佳状态，便退到兜身边寻求协助。',
  'EV-NAR-P1-TSUNADE-0190':'大蛇丸、纲手和自来也同时施展通灵术，分别召唤万蛇、蛞蝓和蛤蟆文太。',
  'EV-NAR-P1-TSUNADE-0191':'蛤蟆文太为终于有机会杀死万蛇而兴奋，万蛇却责备大蛇丸没有准备人类祭品。',
  'EV-NAR-P1-TSUNADE-0192':'自来也和纲手宣布大蛇丸不再是同伴，并发誓将其杀死，最终战随即开始。',
  'EV-NAR-P1-TSUNADE-0193':'蛞蝓率先向万蛇喷出酸液，万蛇迅速躲开。',
  'EV-NAR-P1-TSUNADE-0194':'万蛇利用蛞蝓攻击间隙的破绽缠住她，准备咬下这只巨型蛞蝓。',
  'EV-NAR-P1-TSUNADE-0195':'蛤蟆文太及时将刀插入万蛇口中，阻止它咬伤蛞蝓。',
  'EV-NAR-P1-TSUNADE-0196':'万蛇仍紧紧缠住蛞蝓并试图将她勒死，蛞蝓于是分裂成许多小蛞蝓逃脱。',
  'EV-NAR-P1-TSUNADE-0197':'蛞蝓恢复期间，万蛇将蛤蟆文太甩开；自来也协助蛤蟆文太喷出巨大的火焰云吞没万蛇。',
  'EV-NAR-P1-TSUNADE-0198':'烟雾散去后只剩万蛇蜕下的皮，真正的万蛇正从蛤蟆文太下方掘地靠近。',
  'EV-NAR-P1-TSUNADE-0199':'蛤蟆文太抓住万蛇的尾巴，但万蛇绕到巨蛤蟆身后，准备咬它。',
  'EV-NAR-P1-TSUNADE-0200':'纲手及时赶到，带着蛤蟆文太的长刀将其插入万蛇口中，使它无法闭嘴。',
  'EV-NAR-P2-ITACHI-0030':'他们最终发现他住在村子东南方的一座城堡里。',
  'EV-NAR-P2-ITACHI-0124':'队友看到爆炸后找到了他；他随队休息，并解释了事情经过。',
  'EV-NAR-P2-JINCHURIKI-0054':'五影分散到战场各处，以鼓舞各自村子的忍者。',
  'EV-NAR-P2-JINCHURIKI-0096':'那位传说中的忍者毫不在意，直接吸收了这道术。',
  'EV-NAR-P2-JINCHURIKI-0117':'他取下克隆体的眼睛和右臂并安装到自己身上，宣称真正的“乐趣”现在才开始。',
  'EV-NAR-P2-JINCHURIKI-0131':'他随后从外道魔像射出锁链，缠住尾兽并将它们拖向魔像。',
  'EV-NAR-P2-JINCHURIKI-0219':'他成功击中这位传奇忍者，将其轰入地面并制造出极深的陨坑。',
  'EV-NAR-P2-JIRAIYA-0008':'她随后变成多张折纸，在村中搜寻入侵者。',
  'EV-NAR-P2-KAGE-0018':'五影因理念不同很快发生争执。',
  'EV-NAR-P2-KAGE-0067':'失去查克拉并窒息后，奇拉比昏迷过去。',
  'EV-NAR-P2-KAGUYA-0069':'他们逐渐失去对传送门的控制，传送门最终关闭。',
  'EV-NAR-P2-PAIN-0043':'因此，制造世界和平的唯一方法就是依靠武力与恐惧。',
  'EV-NAR-P2-PAIN-0062':'这导致封印发生扭曲。',
  'EV-NAR-P2-PAIN-0063':'尽管微型月亮力量强大，扭曲的封印仍让八尾逐渐长大，并从球体中挣脱了一部分。',
  'EV-NAR-P2-PAIN-0077':'他随后遇到一只同样孤独的狗，并将它命名为小不点。',
  'EV-NAR-P2-TENCHI-0040':'两兄弟原定会面的中心页尚未完成。'
};
let changed=0;
for (const file of fs.readdirSync(dir).filter(f=>f.startsWith('TL-')&&f.endsWith('.json'))) {
  const full=path.join(dir,file); const data=JSON.parse(fs.readFileSync(full,'utf8'));
  let fileChanged=false;
  for (const rec of data.records||[]) if (fixes[rec.id]) {
    rec.summary=fixes[rec.id]; rec.facts=[fixes[rec.id]]; rec.retrieval.tags=[...new Set([...(rec.retrieval.tags||[]),'zh-reviewed'])];
    rec.qa.status='draft'; rec.qa.reviewed_by='manual-proofread-fix-001'; changed++;
    fileChanged=true;
  }
  if(fileChanged)fs.writeFileSync(full,JSON.stringify(data,null,2)+'\n');
}
console.log(`fixed ${changed}`);
