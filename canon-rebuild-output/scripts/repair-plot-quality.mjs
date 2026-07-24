import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plotDir = path.join(root, 'data', 'canon', 'timeline', 'shards', 'plot');
const files = fs.readdirSync(plotDir).filter(file => file.startsWith('TL-') && file.endsWith('.json'));
const shards = new Map(files.map(file => [file, JSON.parse(fs.readFileSync(path.join(plotDir, file), 'utf8'))]));
const records = new Map();

for (const [file, shard] of shards) {
  for (const record of shard.records || []) records.set(record.id, { file, record });
}

const touchedFiles = new Set();
let summaryChanges = 0;
let roleChanges = 0;
let dateChanges = 0;

function touch(id) {
  const entry = records.get(id);
  if (!entry) throw new Error(`Unknown plot event: ${id}`);
  touchedFiles.add(entry.file);
  entry.record.qa ||= {};
  return entry.record;
}

function setSummary(id, summary) {
  const record = touch(id);
  if (record.summary !== summary || record.facts?.[0] !== summary) summaryChanges++;
  record.summary = summary;
  record.facts = [summary];
  record.retrieval ||= {};
  record.retrieval.tags = [...new Set([...(record.retrieval.tags || []), 'zh-reviewed'])];
  record.qa.status = 'draft';
  record.qa.reviewed_by = 'manual-plot-quality-002';
}

function setRole(id, role, note) {
  const record = touch(id);
  if (record.qa.runtime_role !== role) roleChanges++;
  record.qa.runtime_role = role;
  record.qa.structure_reviewed_by = 'manual-plot-quality-002';
  record.qa.structure_note = note;
}

function eventId(prefix, number) {
  return `${prefix}-${String(number).padStart(4, '0')}`;
}

function setRoleRange(prefix, start, end, role, note) {
  for (let number = start; number <= end; number++) setRole(eventId(prefix, number), role, note);
}

function setDateRanges(file, prefix, ranges, rationale) {
  const shard = shards.get(file);
  if (!shard) throw new Error(`Unknown shard: ${file}`);
  for (const [start, end, date] of ranges) {
    for (let number = start; number <= end; number++) {
      const record = touch(eventId(prefix, number));
      if (record.when.scheduled_start !== date || record.when.scheduled_end !== date) dateChanges++;
      record.when.scheduled_start = date;
      record.when.scheduled_end = date;
      record.when.canon_window = { earliest: date, latest: date };
      record.when.rationale = `${rationale} 日期为 project_dates_v3 项目分配，不宣称为漫画明示。`;
      record.qa.date_reviewed_by = 'manual-plot-quality-002';
    }
  }
  const dates = (shard.records || []).map(record => record.when.scheduled_start).sort();
  shard.shard.date_start = dates[0];
  shard.shard.date_end = dates.at(-1);
  touchedFiles.add(file);
}

// The first manga synopsis includes the historical Nine-Tails prologue. It is reference material,
// not an event that should fire again on Naruto's graduation day.
setRoleRange('EV-NAR-P1-WAVES', 1, 3, 'recap', '十二年前的九尾之乱是背景回顾，不得在木叶64年的毕业日重新发生。');

setDateRanges('TL-NAR-P1-WAVES-AUTO.json', 'EV-NAR-P1-WAVES', [
  [1, 21, 'K064-01-01'],
  [22, 44, 'K064-01-02'],
  [45, 71, 'K064-01-03'],
  [72, 105, 'K064-01-04'],
  [106, 114, 'K064-01-15'],
  [115, 147, 'K064-01-16'],
  [148, 152, 'K064-01-17'],
  [153, 160, 'K064-01-18'],
  [161, 166, 'K064-01-20'],
  [167, 170, 'K064-01-26'],
  [171, 177, 'K064-01-27'],
  [178, 267, 'K064-01-28'],
  [268, 272, 'K064-02-01']
], '依据毕业、分班、铃铛测试、波之国任务和大桥决战的项目基准锚点重新分配');

setRole('EV-NAR-P1-CHUNIN-0115', 'recap', '该记录概括一个月训练成果，不是单日内可一次演完的当前事件。');
setDateRanges('TL-NAR-P1-CHUNIN-AUTO.json', 'EV-NAR-P1-CHUNIN', [
  [1, 12, 'K064-02-01'],
  [13, 23, 'K064-03-01'],
  [24, 32, 'K064-03-02'],
  [33, 51, 'K064-03-03'],
  [52, 111, 'K064-03-06'],
  [112, 115, 'K064-03-07'],
  [116, 117, 'K064-04-04'],
  [118, 119, 'K064-04-05'],
  [120, 143, 'K064-04-06']
], '依据中忍考试开幕、死亡森林五日上限、一个月备战期和正式赛锚点重新分配');

setDateRanges('TL-NAR-P1-CRUSH-AUTO.json', 'EV-NAR-P1-CRUSH', [
  [1, 131, 'K064-04-06'],
  [132, 132, 'K064-04-09']
], '依据木叶崩溃与中忍考试正式赛同日、火影葬礼在数日后举行的锚点重新分配');

setRoleRange('EV-NAR-P1-TSUNADE', 97, 98, 'recap', '这两条概括鸣人一周训练与纲手持续观察，不是单日即时动作。');
setRoleRange('EV-NAR-P1-TSUNADE', 219, 227, 'metadata', '该段是动画版补充和版本说明，不属于漫画主连续性的可播放事件。');
setDateRanges('TL-NAR-P1-TSUNADE-AUTO.json', 'EV-NAR-P1-TSUNADE', [
  [1, 7, 'K064-04-07'],
  [8, 50, 'K064-04-10'],
  [51, 58, 'K064-04-11'],
  [59, 96, 'K064-04-12'],
  [97, 100, 'K064-04-18'],
  [101, 200, 'K064-04-19'],
  [201, 227, 'K064-04-20']
], '依据木叶崩溃善后、纲手的一周约定与五代火影就任锚点重新分配');

setRoleRange('EV-NAR-P1-SASUKE', 1, 3, 'recap', '篇章开头是佐助离村动机概述，不是即时剧情动作。');
setRoleRange('EV-NAR-P1-SASUKE', 10, 14, 'recap', '该段提前概括离村结果并回顾动机，实际离村从后续事件开始。');
setRole('EV-NAR-P1-SASUKE-0121', 'metadata', '动画版时间安排说明，不属于漫画主连续性的当前事件。');
setRole('EV-NAR-P1-SASUKE-0123', 'metadata', '漫画与动画版本差异说明，不属于当前事件。');
setSummary('EV-NAR-P1-SASUKE-0014', '尽管卡卡西告诫他复仇毫无意义，但音忍四人众展示出的力量和又一次惨败，最终让佐助下定了离村的决心。');
setSummary('EV-NAR-P1-SASUKE-0122', '鸣人出院后不久便随自来也离开木叶，开始长期修行。');
setDateRanges('TL-NAR-P1-SASUKE-AUTO.json', 'EV-NAR-P1-SASUKE', [
  [1, 9, 'K064-05-30'],
  [10, 19, 'K064-06-01'],
  [20, 51, 'K064-06-02'],
  [52, 107, 'K064-06-03'],
  [108, 120, 'K064-06-04'],
  [121, 123, 'K064-06-15']
], '依据佐助离村、追击任务和终结之谷第一次决战的项目基准锚点重新分配');

const tenchiSummaries = [
  '风影夺还任务结束后，第七班返回木叶；卡卡西因过度使用神威住院，暂时无法带队。',
  '小樱向纲手报告蝎临死前提供的情报：十天后，他安插在大蛇丸身边的间谍会在天地桥出现。',
  '为执行天地桥侦察任务，纲手决定为第七班补充一名临时队长和一名替代佐助的新队员。',
  '鸣人与鹿丸、丁次同行时遭到陌生忍者以墨兽袭击，对方试探后主动撤离。',
  '袭击者名叫佐井，是团藏派来的“根”成员，也是第七班的新队员。',
  '佐井长期接受“根”抹除情感的训练，只会依靠书本中的方法模仿笑容和人际交往。',
  '木叶顾问担心九尾人柱力再次接近晓，要求由能够压制九尾查克拉的暗部忍者负责带队。',
  '暗部忍者天藏以“大和”为代号接任临时队长；他拥有能够压制九尾的木遁能力。',
  '重组后的第七班受命前往草隐村天地桥，确认并接触蝎留在大蛇丸身边的间谍。',
  '纲手正式将佐井编入第七班；团藏同时向佐井下达了未向纲手公开的秘密命令。',
  '第七班出发后，鸣人、小樱与佐井之间因佐助的话题不断发生冲突。',
  '鸣人无法接受佐井把自己与佐助相提并论，佐井则反复用刻薄言辞刺激他。',
  '小樱试图缓和气氛，却也被不懂正常交往方式的佐井当面冒犯。',
  '佐井侮辱佐助后，鸣人愤怒出手；佐井以短刀和墨遁应对，队伍几乎当场内斗。',
  '大和用木遁制止冲突，警告三人若无法合作，任务尚未开始便会失败。',
  '夜间休整时，大和以木遁建成临时住处，并要求队员在抵达天地桥前建立最低限度的协作。',
  '佐井尝试用书上学来的假笑与队友交流，但围绕佐助的矛盾仍未真正消除。',
  '约定日到来后，大和变身为赤砂之蝎，独自走上天地桥与间谍接头，其余队员在附近埋伏。',
  '药师兜按约来到天地桥，向伪装成蝎的大和报告大蛇丸的近况。',
  '大和试图从兜口中套取佐助和大蛇丸据点的情报，大蛇丸却突然出现在桥边。',
  '兜突然攻击伪装成蝎的大和，表明他早已摆脱蝎的控制并真正效忠于大蛇丸。',
  '伪装暴露后，鸣人、小樱和佐井现身支援大和，与大蛇丸和兜正面对峙。',
  '大蛇丸以佐助刺激鸣人，并故意试探九尾人柱力成长到了何种程度。',
  '鸣人的愤怒令九尾查克拉外衣不断增厚，尾数迅速增加并开始侵蚀他的意识。',
  '小樱试图唤回鸣人，却无法让已经失控的鸣人停止攻击。',
  '进入四尾状态的鸣人发出强烈咆哮并摧毁天地桥周边，大蛇丸将战场引向森林。',
  '大蛇丸召出三重罗生门抵挡四尾鸣人的尾兽玉，防御仍被冲击贯穿。',
  '大蛇丸以草薙剑攻击四尾鸣人，但剑刃无法刺穿九尾查克拉形成的防护。',
  '持续战斗令大蛇丸当前的身体接近极限，他停止纠缠并准备撤往据点。',
  '小樱靠近失控的鸣人时遭到查克拉手臂击伤，大和立即介入保护她。',
  '兜为小樱治疗伤口，并表示让第七班继续消灭晓暂时符合大蛇丸一方的利益。',
  '大和以木遁和初代火影项链压制九尾查克拉，使鸣人恢复原状。',
  '鸣人醒来后询问小樱的伤势；小樱隐瞒真相，谎称伤口由大蛇丸造成。',
  '大和私下告诉鸣人，真正伤害小樱的是失控后的鸣人，并要求他依靠自己的力量保护同伴。',
  '混战期间，佐井依照团藏的密令主动跟随大蛇丸离开，没有随第七班会合。',
  '大和此前已在佐井身上留下木遁种子，队伍据此追踪到大蛇丸的地下据点。',
  '第七班抵达据点附近后隐蔽侦察，确认佐井、大蛇丸和兜都在地下设施内。',
  '佐井向大蛇丸递交团藏准备的资料，表面上代表团藏提出合作。',
  '大和、鸣人与小樱潜入据点并控制佐井，质问他背叛任务的原因。',
  '众人发现佐井一直保存着一本未完成的画册，画中记录了他与已故兄长信的经历。',
  '佐井承认自己曾把信视为兄长，却因“根”的训练无法完成画册最后一页。',
  '佐井进一步坦白，团藏真正交给他的任务是趁大蛇丸夺取身体前刺杀佐助。',
  '鸣人坚持自己即使受伤也不会放弃与佐助的羁绊，这番话唤起了佐井对兄长的记忆。',
  '兜发现入侵者并试图解救佐井，佐井却转而协助第七班制服兜，第一次违抗团藏的命令。',
  '众人分头搜索庞大的地下据点；佐井决定先找到佐助并阻止双方互相残杀。',
  '佐井在房间里找到沉睡的佐助并试图接近，佐助立刻醒来，以查克拉爆发摧毁房间。',
  '鸣人和小樱终于再次见到佐助；佐助以远超从前的速度发动攻击，大和与佐井先后阻挡。',
  '佐助进入鸣人的精神空间看见九尾，并以写轮眼压制了正在外溢的九尾查克拉。',
  '佐助表示自己已经斩断与木叶的羁绊，随后举手准备施展足以波及整支队伍的雷遁术。',
  '大蛇丸和兜阻止佐助继续出手，并带他离开据点；第七班未能带回佐助，但佐井选择作为真正的同伴返回木叶。'
];

for (let index = 0; index < tenchiSummaries.length; index++) {
  const id = eventId('EV-NAR-P2-TENCHI', index + 1);
  setSummary(id, tenchiSummaries[index]);
  setRole(id, 'plot', '天地桥侦察任务漫画主连续性，经人工重建并核对篇章顺序。');
}
setRoleRange('EV-NAR-P2-TENCHI', 51, 95, 'metadata', '旧自动摘要混入其他篇章、动画补充或错误事件，未经重新核实前不得进入运行时。');
setDateRanges('TL-NAR-P2-TENCHI-AUTO.json', 'EV-NAR-P2-TENCHI', [
  [1, 8, 'K067-02-01'],
  [9, 13, 'K067-02-02'],
  [14, 17, 'K067-02-03'],
  [18, 35, 'K067-02-10'],
  [36, 46, 'K067-02-11'],
  [47, 75, 'K067-02-12'],
  [76, 95, 'K067-02-13']
], '依据十日后天地桥接头、四尾失控、追踪据点与佐助重逢的因果顺序重新分配');

setDateRanges('TL-NAR-P2-AKATSUKI-AUTO.json', 'EV-NAR-P2-AKATSUKI', [
  [46, 53, 'K067-03-05']
], '依据“次日完成瀑布切割训练”的明确跨日叙述重新分配');

setDateRanges('TL-NAR-P2-ITACHI-AUTO.json', 'EV-NAR-P2-ITACHI', [
  [66, 66, 'K067-04-07'],
  [94, 99, 'K067-04-10']
], '依据两处“第二天”转场的明确跨日叙述重新分配');

setDateRanges('TL-NAR-P2-COUNTDOWN-AUTO.json', 'EV-NAR-P2-COUNTDOWN', [
  [57, 65, 'K067-10-24']
], '依据影会谈后三天与抵达龟岛的连续行程重新分配');

setDateRanges('TL-NAR-P2-CONFRONT-AUTO.json', 'EV-NAR-P2-CONFRONT', [
  [120, 192, 'K068-01-02']
], '依据日出标志第四次忍界大战第二天的明确日期边界重新分配');

setDateRanges('TL-BOR-MOMOSHIKI-AUTO.json', 'EV-BOR-MOMOSHIKI', [
  [258, 276, 'K083-03-15']
], '依据决战后“第二天”开始的家庭与善后剧情重新分配');

setSummary('EV-BOR-SARADA-0106', '佐良娜与父母共进第一次全家晚餐。');
setSummary('EV-BOR-SARADA-0107', '次日临行前，佐助注意到佐良娜情绪低落，便拥抱她并轻戳额头安慰，保证很快就会回家。');
setDateRanges('TL-BOR-SARADA-AUTO.json', 'EV-BOR-SARADA', [
  [107, 116, 'K082-08-10']
], '依据全家晚餐后次日佐助启程的明确跨日叙述重新分配');

for (const [id, note] of [
  ['EV-NAR-P2-ITACHI-0028', '动画版武器来源差异说明，不属于漫画主连续性的当前事件。'],
  ['EV-NAR-P2-ITACHI-0152', '动画版回忆补充，不属于漫画主连续性的当前事件。'],
  ['EV-NAR-P2-PAIN-0123', '漫画与动画发生时点比较，不属于当前事件。'],
  ['EV-NAR-P2-COUNTDOWN-0060', '动画版补充场景，不属于漫画主连续性的当前事件。']
]) setRole(id, 'metadata', note);

setSummary('EV-NAR-P2-CONFRONT-0192', '棺盖被强大的力量震飞，棺中出现的秽土转生者正是宇智波斑。');
setSummary('EV-NAR-P2-CLIMAX-0001', '斑从棺中现身，以为长门用外道·轮回天生之术复活了自己；兜借无之口说明，斑实际是被秽土转生召回。');
setSummary('EV-NAR-P2-CLIMAX-0649', '小樱让蛞蝓为忍者联军伤员提供治疗，鸣人和佐助则乘着各自的通灵兽一路攻到十尾面前。');
setSummary('EV-BOR-MUJINA-0004', '在动画版篇章顺序中，本篇前承时光旅行篇，后继壳始动篇。');
setSummary('EV-BOR-MOMOSHIKI-0083', '没有落入墨水的下忍通过第一轮；方助向委托方报告，慕留人尚未使用科学忍具。');

for (const { record } of records.values()) {
  const fixed = String(record.summary || '')
    .replaceAll('自已', '自己')
    .replaceAll('自巳', '自己')
    .replaceAll('卡茹依', '卡鲁伊')
    .replaceAll('光助', '方助');
  if (fixed !== record.summary) setSummary(record.id, fixed);
}

for (const file of touchedFiles) {
  fs.writeFileSync(path.join(plotDir, file), `${JSON.stringify(shards.get(file), null, 2)}\n`);
}

console.log(`repair plot quality: ${summaryChanges} summaries, ${roleChanges} roles, ${dateChanges} dates, ${touchedFiles.size} shards`);
