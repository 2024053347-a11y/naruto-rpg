#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const techniqueRoot = path.join(root, 'canon-rebuild-output', 'data', 'canon', 'techniques');
const candidateFile = path.join(root, '.codex-tmp', 'canon-technique-description-repair-candidates.json');
const correctionFile = path.join(techniqueRoot, 'description-corrections.json');
const fromCandidates = process.argv.includes('--from-candidates');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const manualSummaryOverrides = {
  'JT-OTHER-0023': '卡路里控制能把秋道一族体内储存的热量转化为查克拉，并配合倍化之术强化身体。熟练者可自行控制转化比例，经验不足者则需要三色药丸辅助。',
  'JT-OTHER-0071': '犬冢一族成员与忍犬共同施展组合变身，化作双头巨狼。变身后体型、爪牙和力量都会大幅提升，并可施展破坏力更强的牙通牙系招式。',
  'JT-OTHER-0104': '心转身之术是山中一族的秘传忍术。施术者将精神投射到目标体内并控制其行动；施术期间本体会失去意识，若未命中，精神返回也需要时间。',
  'JT-OTHER-0112': '多重影分身之术是影分身之术的大规模版本，可一次制造大量具有实体的分身。每个分身都会分得本体的查克拉，因此数量越多，消耗和风险越高。',
  'JT-OTHER-0119': '己生转生是千代开发的禁术，可把施术者的生命力转移给他人，既能治疗重伤，也能令死者复生；若救治对象已经死亡，施术者通常会付出生命。',
  'JT-OTHER-0120': '大蛇丸流替身术会让使用者从旧身体的口中吐出一具完整的新身体，以摆脱重伤和束缚；恢复效果强，但会消耗大量查克拉。',
  'JT-OTHER-0129': '亲子螺旋丸由父母与孩子共同注入查克拉，将两人的螺旋丸融合成威力更大的螺旋丸，是需要双方协调的合作忍术。',
  'JT-OTHER-0131': '惑星螺旋丸以一颗大玉螺旋丸为核心，外侧环绕三颗普通螺旋丸；不同方向的旋转在命中后相互作用，形成破坏力极强的乱流。',
  'JT-OTHER-0138': '螺旋丸·涡彦是博人开发的螺旋丸变体，借用行星自转产生的力量持续影响目标，使其失去平衡并承受难以消退的旋转冲击。',
  'JT-OTHER-0140': '再生能力源自千手柱间异乎常人的生命力，可在不结印的情况下快速修复自身伤势；移植柱间细胞者也可能获得不同程度的恢复能力。',
  'JT-OTHER-0156': '灼遁·过蒸杀会制造并操纵高温球体。球体穿过目标时会瞬间蒸发其体内水分，使身体干枯，是叶仓使用的致命灼遁忍术。',
  'JT-OTHER-0161': '感知之术让感知型忍者把查克拉转化为感知能力，用于探测、辨认并追踪周围的查克拉特征；有效范围取决于施术者水平。',
  'JT-OTHER-0163': '鸣人制造多个影分身并同时变成数名裸体男性，以强烈的视觉冲击扰乱或制服目标；这是后宫术的反向变体。',
  'JT-OTHER-0164': '使用者以变身术化为裸体美女，用诱惑、惊吓或视觉冲击分散目标注意力；鸣人常用它恶作剧，也能借此在战斗中制造破绽。',
  'JT-OTHER-0165': '使用者与分身变成两名裸体男性，以迎合女性目标的偏好并造成强烈精神冲击；人物组合和姿势会影响效果。',
  'JT-OTHER-0166': '使用者与分身变成两名不同的裸体女性，以诱惑或扰乱目标；选择符合目标偏好的形象可提高成功率。',
  'JT-OTHER-0173': '使用者同时投出带铃和不带铃的千本，以铃声诱导对手误判攻击位置，再让无声千本从盲区命中目标。',
  'JT-OTHER-0176': '影首缚术是影子模仿术的攻击型变化。影子沿目标身体向上延伸并化作手掌，最终扼住颈部；距离越近，束缚力越强。',
  'JT-OTHER-0181': '六道阳之力是大筒木羽衣授予鸣人的力量，以右手掌上的太阳状印记为标志，并与佐助的六道阴之力共同用于六道·地爆天星。',
  'JT-OTHER-0182': '六道阴之力是大筒木羽衣授予佐助的力量，以左手掌上的新月状印记为标志，并与鸣人的六道阳之力共同用于六道·地爆天星。',
  'JT-OTHER-0191': '蜘蛛巢域会在区域内铺设大量蛛丝感知线。鬼童丸持续向蛛丝输送查克拉，借由细微振动察觉任何接触者和空气扰动。',
  'JT-OTHER-0207': '尾兽玉是尾兽与完全尾兽化人柱力的代表性奥义。使用者按比例凝聚阴、阳查克拉并压缩成球，随后吞入口中引爆或直接发射。',
  'JT-OTHER-0208': '尾兽重炮会在口中形成尾兽玉并把它转化为持续的高密度查克拉光束，用直线贯穿和扫荡大范围目标。',
  'JT-OTHER-0209': '尾兽螺旋丸是鸣人尝试以螺旋丸原理模拟尾兽玉的未完成术，需要同时平衡阴、阳查克拉；它后来成为开发相关奥义的基础。',
  'JT-OTHER-0216': '千手操武让第三代风影人傀儡展开左臂的机关，释放出大量傀儡手臂追击和捕捉目标；手臂中还暗藏毒雾、苦无与钢索等机关。',
  'JT-OTHER-0230': '最硬绝对防御·守鹤之盾会从地下提取高密度矿物并与沙混合，塑成守鹤外形的坚固盾牌，用于正面抵挡高威力攻击。',
  'JT-OTHER-0248': '木遁·枷会生成木桩或木质拘束具限制目标，同时压制目标的查克拉，使被俘者更难挣脱或施术反击。',
  'JT-OTHER-0249': '木遁·木龙之术会创造巨大的木龙，用于缠绕、压制或攻击目标；木龙还能吸收接触对象的查克拉，足以束缚尾兽。',
  'JT-SEN-0004': '地之咒印是大蛇丸最强的咒印之一，与天之咒印对应。解放后会持续侵蚀并改变宿主身体，以换取大幅强化的查克拉和战斗能力。',
  'JT-SEN-0005': '天之咒印是大蛇丸最强的咒印之一，与地之咒印对应。解放后会持续侵蚀并改变宿主身体，以换取大幅强化的查克拉和战斗能力。',
  'JT-SEN-0006': '舌战缚将仙术查克拉集中到志麻的舌头，使其伸长并追踪气味，随后卷住目标进行束缚。',
  'JT-SEN-0007': '舌战斩将仙术查克拉集中到深作的舌头，使其变得坚硬锋利，并以高速伸出切开岩石、金属或敌人。',
  'JT-SEN-0008': '大蛇突是在仙人模式下把查克拉蛇向前刺出，以伸长的蛇形肢体突袭并贯穿对手。',
  'JT-SEN-0009': '多莲不自连炮让仙人化第二状态的使用者长出多组喷射器般的附肢，快速吸收自然能量后释放大范围查克拉爆炸。',
  'JT-SEN-0012': '仙法·两生之术由深作和志麻与自来也融合，帮助他持续收集自然能量、维持仙人模式，并让三者能够协同施术。',
  'JT-SEN-0013': '仙法·蛙鸣由深作与志麻把仙术查克拉集中在喉部，再同时发出强烈蛙鸣；声波可干扰并暂时麻痹范围内的目标。',
  'JT-SEN-0016': '仙法·岚遁光牙把仙术查克拉注入岚遁，从口中射出高速细光束；光束切割力极强，甚至能够斩断求道玉。',
  'JT-SEN-0017': '仙法·白激之术是龙地洞仙术。使用者吐出龙形能量体，使其环绕光球高速旋转，产生强光与剧烈声振，扰乱对手的视觉、听觉和身体平衡。',
  'JT-SEN-0019': '仙人模式是将自然能量与自身查克拉平衡融合、生成仙术查克拉的强化状态，可提升感知与身体能力，并强化原有忍术。',
  'JT-SEN-0020': '仙人化会让使用者吸收自然能量并改变身体形态，可生成武器般的肢体，同时提升力量、速度、感知和耐久力；过度使用也可能增强攻击性并导致失控。',
  'JT-SEN-0021': '六道仙人模式是羽衣授予鸣人的特殊强化形态，使他能够运用六道仙术，显著提升感知、飞行、体术与忍术能力。',
  'JT-SEN-0022': '六道仙术是融合六道之力的特殊仙术体系，由大筒木羽衣等人使用；其使用者能操纵求道玉，并以仙术力量强化攻防。',
  'JT-SEN-0023': '六道·国津守会形成巨大的多臂查克拉化身，能够与完全体须佐能乎抗衡，并可借助求道玉进行攻击或防御。',
  'JT-SEN-0024': '传异远影让兜借助左近的血继限界，从身体上复制出已吸收细胞来源者的上半身，并让分身施展对应的血继限界、秘术或忍术。',
  'JT-SPACE-0002': '天手力是佐助借助轮回眼施展的时空间忍术，可在有效范围内瞬间与人或物交换位置，也能让两个目标彼此换位。',
  'JT-SPACE-0003': '增幅通灵之术会在通灵兽遭受攻击时触发，使其分裂并增殖出更多个体；持续攻击反而会增加其数量和包围能力。',
  'JT-SPACE-0005': '飞雷阵之术由三名火影护卫队成员共同施展。三人同步集中查克拉后，可把自己或接触到的目标传送到预定地点，但准备速度慢于飞雷神之术。',
  'JT-SPACE-0007': '飞雷神互瞬回之术需要两名飞雷神使用者预先在彼此身上留下术式，再同时交换双方位置，用于救援、转移目标或扰乱敌人。',
  'JT-SPACE-0008': '飞雷神斩将飞雷神术式与刀术结合：使用者瞬移至已标记目标的死角，并在出现的瞬间完成高速斩击。',
  'JT-SPACE-0009': '飞雷神之术是千手扉间开发的S级时空间忍术。使用者先在目标或地点留下术式，之后便可无视常规移动距离，瞬间转移到任一有效标记处。',
  'JT-SPACE-0014': '神威手里剑由卡卡西的须佐能乎投掷。手里剑命中或掠过目标时会发动神威，把接触到的部分扭曲并转移到神威空间。',
  'JT-SPACE-0017': '逆通灵之术与常规通灵方向相反，可由通灵兽把与其签订契约的忍者召唤到自身所在位置，也可借助预先布置的通灵式把目标转移到指定地点。',
  'JT-SPACE-0018': '螺旋闪光超轮舞吼三式由水门设计，先在周围散布多枚飞雷神苦无，再连续瞬移，从多个死角高速攻击目标。',
  'JT-SPACE-0019': '通灵轮回眼让轮回眼的畜生道召唤人或动物，并在召唤物眼中复制轮回眼；双方共享视野，施术者还能通过黑棒远程控制召唤物。',
  'JT-SPACE-0020': '通灵之术通过契约和血作为媒介，把动物、物品或其他目标从远处瞬间召唤到施术者所在位置；大型目标通常需要更多查克拉。',
  'JT-SPACE-0021': '通灵·外道魔像是轮回眼使用者召唤并操纵外道魔像的术，可用于拘束尾兽、抽取查克拉或作为十尾复活的容器。',
  'JT-SPACE-0024': '通灵·五重罗生门会连续召唤五座罗生门，以多层偏转和削弱来袭攻击；使用者无需让五扇门保持同一朝向。',
  'JT-SPACE-0025': '通灵·罗生门会召唤刻有鬼面的巨大门扉作为防御壁，用厚重门体正面阻挡或削弱强力攻击。',
  'JT-SPACE-0026': '通灵·蛤蟆口缚不会召唤整只蛤蟆，而是把妙木山巨岩宿蛤蟆的食道召唤到目标周围，以坚韧肉壁困住并消化敌人。',
  'JT-SPACE-0027': '通灵·蛤蟆见世之术召唤能伪装成建筑物的妙木山蛤蟆，用作隐蔽据点或诱捕设施；进入建筑的目标会落入蛤蟆体内。'
};

const literalReplacements = [
  ['Boruto Uzumaki', '漩涡博人'], ['Boruto', '博人'], ['Minato', '水门'],
  ['Kabuto', '兜'], ['Hamura', '羽村'], ['Akatsuki', '晓'], ['Hijutsu', '秘术'],
  ['Samehada', '鲛肌'], ['Susanoo', '须佐能乎'], ['Kyodaigumo', '巨大蜘蛛'],
  ['jinchūriki', '人柱力'], ['Rinnegan', '轮回眼'], ['senbon', '千本'],
  ['kikaichū', '寄坏虫'], ['genin', '下忍'], ['Big Ball', '大玉'],
  ['九尾チャクラモード', '九尾查克拉模式'],
  ['大蛇丸流の変わり身之术', '大蛇丸流替身术'],
  ['砂の盾', '砂之盾'],
  ['黄泉比良坂ヨモツヒラサカ', '黄泉比良坂'],
  ['意身转换术', '心转身之术'],
  ['身体替换术', '替身术'],
  ['大球螺旋丸', '大玉螺旋丸'],
  ['大尾兽球', '尾兽玉'], ['尾兽球', '尾兽玉'], ['尾獣玉', '尾兽玉'],
  ['尾獣螺旋丸', '尾兽螺旋丸'], ['超獣伪画', '超兽伪画'],
  ['手部密封', '手印'], ['分身体', '分身'], ['分身人', '分身'],
  ['柔术', '忍术'], ['仙本', '千本'], ['金术', '禁术'], ['忍者狗', '忍犬'],
  ['技术', '术'], ['克隆', '分身'], ['影子分身', '影分身'], ['创建', '创造'],
  ['氏族', '一族'], ['授权状态', '强化状态'], ['耐用性', '耐久力'], ['运输到', '转移到']
];

const targetedReplacements = {
  'JT-OTHER-0119': [['砂隐傀儡旅', '砂隐傀儡师千代']],
  'JT-OTHER-0170': [['Hijutsu', '秘术']],
  'JT-OTHER-0177': [['痛苦将', '佩恩将']],
  'JT-OTHER-0182': [['Hamura', '羽村']],
  'JT-OTHER-0236': [['佐井ken', '犀犬']],
  'JT-SEN-0024': [['Kabuto', '兜']],
  'JT-SPACE-0014': [['Susanoo', '须佐能乎']],
  'JT-SPACE-0016': [['Kyodaigumo', '巨大蜘蛛'], ['京大云', '巨大蜘蛛']]
};

function polishSummary(id, value) {
  if (manualSummaryOverrides[id]) return manualSummaryOverrides[id];
  let summary = String(value || '').trim();
  for (const [before, after] of literalReplacements) summary = summary.replaceAll(before, after);
  for (const [before, after] of targetedReplacements[id] || []) summary = summary.replaceAll(before, after);
  summary = summary
    .replaceAll('这种术', '此术')
    .replaceAll('该术术', '该术')
    .replaceAll('分身体', '分身')
    .replaceAll('分身人', '分身')
    .replace(/\s+/g, ' ')
    .trim();
  for (let pass = 0; pass < 3; pass += 1) {
    summary = summary
      .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '$1')
      .replace(/\s+([，。；：！？、）])/g, '$1')
      .replace(/([（])\s+/g, '$1');
  }
  return summary
    .replaceAll('大球螺旋丸', '大玉螺旋丸')
    .replaceAll('大尾兽球', '尾兽玉')
    .replaceAll('尾兽球', '尾兽玉')
    .replaceAll('手部密封', '手印');
}

if (fromCandidates) {
  if (!fs.existsSync(candidateFile)) throw new Error(`Missing repair candidates: ${candidateFile}`);
  const candidateData = readJson(candidateFile);
  const corrections = candidateData.candidates.map(candidate => ({
    id: candidate.id,
    source_title: candidate.source_title,
    summary: polishSummary(candidate.id, candidate.translated)
  }));
  const body = {
    schema_version: 'naruto.technique.description-corrections.v1',
    generated_at: new Date().toISOString(),
    provenance: 'Narutopedia source_ref pages; Chinese summaries terminology-normalized and key records manually reviewed.',
    count: corrections.length,
    corrections
  };
  fs.writeFileSync(correctionFile, `${JSON.stringify(body, null, 2)}\n`);
}

if (!fs.existsSync(correctionFile)) throw new Error(`Missing correction map: ${correctionFile}`);
const correctionData = readJson(correctionFile);
const corrections = new Map(correctionData.corrections.map(correction => [correction.id, correction.summary]));
if (corrections.size !== 203 || correctionData.count !== 203) {
  throw new Error(`Expected 203 description corrections, found ${corrections.size}`);
}

const suspicious = /(?:GLOSSARYTOKEN|\.png|\{\{|\[\[|undefined|unknown|智宇波|觅觅|佐井ken|砂隐傀儡旅|痛苦将|大筒木一族使用时空术在不同维度|蝎使用他收集的众多傀儡)/;
for (const [id, summary] of corrections) {
  if (summary.length < 12) throw new Error(`${id} correction is too short: ${summary}`);
  if (suspicious.test(summary)) throw new Error(`${id} correction contains suspicious text: ${summary}`);
}

const manifest = readJson(path.join(techniqueRoot, 'manifest.json'));
const updated = new Set();
for (const shard of manifest.shards) {
  const shardFile = path.join(techniqueRoot, shard.path);
  const body = readJson(shardFile);
  let changed = false;
  for (const record of body.records || []) {
    const summary = corrections.get(record.id);
    if (!summary) continue;
    record.effect.summary = summary;
    record.qa.reviewed_by = 'semantic-description-repair-2026-07-26';
    if (!record.retrieval.tags.includes('description-source-verified')) {
      record.retrieval.tags.push('description-source-verified');
    }
    changed = true;
    updated.add(record.id);
  }
  if (changed) fs.writeFileSync(shardFile, `${JSON.stringify(body, null, 2)}\n`);
}

if (updated.size !== corrections.size) {
  const missing = [...corrections.keys()].filter(id => !updated.has(id));
  throw new Error(`Applied ${updated.size}/${corrections.size}; missing ${missing.join(', ')}`);
}

console.log(`Applied ${updated.size} canonical technique description repairs`);
