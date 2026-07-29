import { CANON_RUNTIME_META } from './generated/canon-runtime-data.js';
import {
  clearCanonOverrides,
  getCanonDatabaseRevision,
  getCanonDatabaseStats,
  getCanonOverrideStore,
  getCanonRecord,
  getCanonRecords,
  replaceCanonOverrideStore,
  resetCanonRecord,
  saveCanonRecord,
  setCanonRecordEnabled
} from './canon-database-overrides.js';
import {
  isProjectTimelineEventId,
  PROJECT_TIMELINE_EVENT_STATUSES
} from './instruction-contract.js';

const RESOURCE_LABELS = Object.freeze({ chakra: '查克拉', spirit: '精神力', stamina: '体力' });
const TYPE_LABELS = Object.freeze({ jutsu: '忍术', genjutsu: '幻术', taijutsu: '体术', support: '支援' });
const PROJECT_TIMELINE_STATUSES = new Set(PROJECT_TIMELINE_EVENT_STATUSES);
const ELEMENT_LABELS = Object.freeze({
  none: '\u65e0', fire: '\u706b', wind: '\u98ce', lightning: '\u96f7', earth: '\u571f', water: '\u6c34',
  yin: '\u9634', yang: '\u9633', 'yin-yang': '\u9634\u9633'
});
const JAPANESE_TO_CHINESE = Object.freeze([
  ['インドラ', '因陀罗'], ['チャクラ', '查克拉'], ['ハーレム', '后宫'], ['モード', '模式'],
  ['レイザーサーカス', '镭射圆舞'], ['ビブラート', '颤音'], ['タコ足', '章鱼足'], ['サイレントキリング', '无声杀人术'],
  ['ノ', '之'], ['の', '之'], ['之术', '术'], ['しばり', '缚'], ['縛り', '缚'], ['隠れ', '隐'], ['隠し', '隐'],
  ['返し', '返'], ['崩し', '崩'], ['斩り', '斩'], ['斬り', '斩'], ['流し', '流'], ['突き', '突'], ['舞', '舞'],
  ['業', '术'], ['修業', '修行'], ['変わり身', '替身'], ['成りかわり', '变身'], ['おいろけ', '色诱惑'], ['男の子どうし', '男女'],
  ['女の子どうし', '女女'], ['気蒸', '蒸气'], ['円舞', '圆舞'], ['黒い', '黑色']
]);

// Canon records retain source spelling for lookup; UI names use simplified Chinese.
const TRADITIONAL_TO_SIMPLIFIED = Object.freeze({
  竜:'龙',獣:'兽',鉄:'铁',剣:'剑',隠:'隐',髪:'发',巻:'卷',戦:'战',線:'线',雲:'云',機:'机',時:'时',頭:'头',総:'总',結:'结',間:'间',裏:'里',術:'术',飴:'饴',炮:'炮',聖:'圣',黒:'黑',円:'圆',変:'变',続:'续',壊:'坏',塵:'尘',剛:'刚',弾:'弹',辺:'边',転:'转',闘:'斗',髭:'须',陸:'陆',閣:'阁',獄:'狱',紙:'纸',鱗:'鳞',伝:'传',呪:'咒',網:'网',縄:'绳',蟲:'虫',蝦:'虾',蟇:'蟆',絶:'绝',軟:'软',嵐:'岚',廻:'回',増:'增',挿:'插',黙:'默',鳴:'鸣',羅:'罗',門:'门',鎌:'镰',歩:'步',張:'张',愛:'爱',撫:'抚',槍:'枪',鋭:'锐',鎧:'铠',鮫:'鲨',踊:'踊',掛:'挂',斎:'斋',塗:'涂',祕:'秘',倉:'仓',仕:'侍',込:'入',歩:'步',獨:'独',絶:'绝',滝:'泷',渦:'涡',濃:'浓',潰:'溃',漢:'汉',剤:'剂',穢:'秽',變:'变',巖:'岩',鐵:'铁',寫:'写',賢:'贤',靈:'灵',顯:'显',順:'顺',顔:'颜',須:'须',風:'风',飛:'飞',餌:'饵',餓:'饿',騒:'骚',髙:'高',鴨:'鸭',鯉:'鲤',鯨:'鲸',鱒:'鳟',黒:'黑',黙:'默'
});
const TECHNIQUE_DISPLAY_OVERRIDES = Object.freeze({
  'JT-DOJUTSU-0002': '修罗之攻',
  'JT-DOJUTSU-0010': '神·树界降诞',
  'JT-DOJUTSU-0017': '外道·轮回天生之术',
  'JT-EARTH-0001': '起爆黏土·零号自爆',
  'JT-EARTH-0002': '起爆黏土·一号蜘蛛',
  'JT-EARTH-0003': '起爆黏土·二号巨龙',
  'JT-EARTH-0004': '起爆黏土·三号十八番',
  'JT-EARTH-0005': '起爆黏土·四号迦楼罗',
  'JT-EARTH-0006': '黏土分身',
  'JT-EARTH-0014': '土遁·土陆归来',
  'JT-EARTH-0021': '土遁·大地动核',
  'JT-EARTH-0022': '土遁·土龙隐身之术',
  'JT-EARTH-0023': '土遁·轻重岩之术',
  'JT-EARTH-0024': '土遁·地动核',
  'JT-EARTH-0025': '土遁·开土升掘',
  'JT-EARTH-0035': '土遁·超轻重岩之术',
  'JT-EARTH-0036': '土遁·土中映鱼之术',
  'JT-EARTH-0037': '起爆黏土',
  'JT-EARTH-0041': '通灵·土遁·追牙之术',
  'JT-FIRE-0002': '忍者联军之术',
  'JT-FIRE-0008': '炎遁·八坂之勾玉',
  'JT-FIRE-0011': '膨胀求道玉',
  'JT-FIRE-0012': '火遁·灰积烧',
  'JT-FIRE-0029': '火遁·凤仙花爪红',
  'JT-FIRE-0030': '火遁·蛤蟆油炎弹',
  'JT-FIRE-0032': '幻术·磷火',
  'JT-FIRE-0035': '仙法·五右卫门',
  'JT-FIRE-0038': '奇面之爆炎',
  'JT-FIRE-0041': '求道伞',
  'JT-GEN-0002': '威压写轮眼',
  'JT-GEN-0004': '魔幻·此处非之术',
  'JT-GEN-0005': '魔幻·奈落见之术',
  'JT-GEN-0009': '魔幻·气蒸楼阁',
  'JT-GEN-0010': '魔幻·蛤蟆临唱',
  'JT-GEN-0015': '无限月读',
  'JT-GEN-0019': '别天神',
  'JT-GEN-0020': '霞从者之术',
  'JT-GEN-0022': '涅槃精舍之术',
  'JT-GEN-0023': '月读',
  'JT-LIGHTNING-0001': '黑雷',
  'JT-LIGHTNING-0010': '地狱突刺',
  'JT-LIGHTNING-0011': '因陀罗之矢',
  'JT-LIGHTNING-0023': '雷遁·四柱束缚',
  'JT-LIGHTNING-0031': '超振动雷遁刀',
  'JT-LIGHTNING-0033': '草薙剑·千鸟刀',
  'JT-MED-0002': '创造再生',
  'JT-MED-0008': '忍法·创造再生·百豪之术',
  'JT-MED-0010': '阴愈伤灭',
  'JT-OTHER-0006': '砂之铠',
  'JT-OTHER-0007': '粘金之铠',
  'JT-OTHER-0009': '双魔之攻',
  'JT-OTHER-0013': '大玉螺旋带连丸',
  'JT-OTHER-0014': '黑秘技·机机三发',
  'JT-OTHER-0015': '黑秘技·机机一发',
  'JT-OTHER-0016': '黑秘技·山椒鱼',
  'JT-OTHER-0020': '沸遁·蒸气爆发',
  'JT-OTHER-0026': '攀崖修行',
  'JT-OTHER-0031': '潜砂绘猫',
  'JT-OTHER-0033': '协力尾兽玉',
  'JT-OTHER-0034': '万物创造之术',
  'JT-OTHER-0035': '乌鸦分身术',
  'JT-OTHER-0037': '咒术·死司凭血',
  'JT-OTHER-0038': '三日月之舞',
  'JT-OTHER-0039': '早蕨之舞',
  'JT-OTHER-0040': '式纸之舞',
  'JT-OTHER-0041': '刃镰之舞·落降之刃',
  'JT-OTHER-0042': '舞刃险袭',
  'JT-OTHER-0045': '魔镜冰晶',
  'JT-OTHER-0046': '沙漠浮游',
  'JT-OTHER-0047': '沙漠波',
  'JT-OTHER-0048': '沙漠·巨手',
  'JT-OTHER-0050': '尘遁·原界剥离之术',
  'JT-OTHER-0055': '假寐之术',
  'JT-OTHER-0063': '炎之手',
  'JT-OTHER-0065': '胧分身术',
  'JT-OTHER-0066': '天诛',
  'JT-OTHER-0070': '火影式耳顺术·廓庵入鄽垂手',
  'JT-OTHER-0073': '日向宗家咒印术',
  'JT-OTHER-0076': '冰遁·冰岩堂无',
  'JT-OTHER-0080': '虫干扰术',
  'JT-OTHER-0082': '砂铁结袭',
  'JT-OTHER-0083': '砂铁结袭·落',
  'JT-OTHER-0085': '砂铁·黑铁之翼',
  'JT-OTHER-0086': '观世音莲华王',
  'JT-OTHER-0089': '熔遁·橡胶球',
  'JT-OTHER-0090': '熔遁·橡胶绳',
  'JT-OTHER-0091': '熔遁·橡胶壁',
  'JT-OTHER-0095': '磁遁·省蜂双刃',
  'JT-OTHER-0098': '操袭刃',
  'JT-OTHER-0099': '操风车三大刀',
  'JT-OTHER-0102': '潜脑操砂之术',
  'JT-OTHER-0109': '镜面袭者之术',
  'JT-OTHER-0110': '砂之怪腕',
  'JT-OTHER-0114': '互乘起爆符',
  'JT-OTHER-0115': '针地藏',
  'JT-OTHER-0123': '神之纸者术',
  'JT-OTHER-0126': '寄生鬼破坏术',
  'JT-OTHER-0128': '寄大虫·虫食',
  'JT-OTHER-0129': '亲子螺旋丸',
  'JT-OTHER-0133': '装填针弹',
  'JT-OTHER-0135': '催户传心',
  'JT-OTHER-0142': '响鸣穿',
  'JT-OTHER-0143': '魔境之乱',
  'JT-OTHER-0144': '绳脱术',
  'JT-OTHER-0150': '砂冰雹',
  'JT-OTHER-0155': '散千乌之术',
  'JT-OTHER-0156': '灼遁·过蒸杀',
  'JT-OTHER-0162': '感知传递',
  'JT-OTHER-0163': '色诱术·逆后宫之术',
  'JT-OTHER-0164': '色诱术',
  'JT-OTHER-0165': '色诱术·男男之术',
  'JT-OTHER-0166': '色诱术·女女之术',
  'JT-OTHER-0168': '影抓术',
  'JT-OTHER-0169': '影聚集术',
  'JT-OTHER-0170': '影子模仿·影缚术',
  'JT-OTHER-0171': '影子模仿手里剑术',
  'JT-OTHER-0172': '影子模仿术',
  'JT-OTHER-0174': '影缝术',
  'JT-OTHER-0180': '无声杀人术',
  'JT-OTHER-0181': '六道阳之力',
  'JT-OTHER-0182': '六道阴之力',
  'JT-OTHER-0185': '软体改造',
  'JT-OTHER-0187': '蜘蛛茧',
  'JT-OTHER-0191': '蜘蛛巢域',
  'JT-OTHER-0192': '蜘蛛巢花',
  'JT-OTHER-0193': '蜘蛛巢开',
  'JT-OTHER-0199': '岚遁·镭射马戏团',
  'JT-OTHER-0200': '替代术',
  'JT-OTHER-0204': '超迷你尾兽玉',
  'JT-OTHER-0206': '草薙剑·空之太刀',
  'JT-OTHER-0211': '望远镜之术',
  'JT-OTHER-0214': '天变地异',
  'JT-OTHER-0215': '第三只眼',
  'JT-OTHER-0217': '蛤蟆平影操纵术',
  'JT-OTHER-0218': '蛤蟆油弹',
  'JT-OTHER-0219': '舌齿黏酸',
  'JT-OTHER-0220': '顶上化佛',
  'JT-OTHER-0222': '变化·金刚如意棒',
  'JT-OTHER-0223': '传信木',
  'JT-OTHER-0224': '爬树修行',
  'JT-OTHER-0225': '变蛙术',
  'JT-OTHER-0228': '宇智波流剑术·刃衣',
  'JT-OTHER-0229': '宇智波流剑术',
  'JT-OTHER-0230': '最硬绝对防御·守鹤之盾',
  'JT-OTHER-0234': '水面行走修行',
  'JT-OTHER-0238': '木遁秘术·树界降诞',
  'JT-OTHER-0239': '木遁·花树界降临',
  'JT-OTHER-0246': '木遁·树海降诞',
  'JT-OTHER-0251': '木遁·木锭壁',
  'JT-PUPPET-0002': '机关傀儡·针针八波',
  'JT-PUPPET-0003': '操演·人身妙功',
  'JT-PUPPET-0005': '傀儡之术·义手千本',
  'JT-PUPPET-0007': '赤秘技·百机操演',
  'JT-PUPPET-0008': '白秘技·十机近松之集',
  'JT-PUPPET-0009': '白秘技·十机近松之集·天之攻',
  'JT-SEAL-0004': '结界·天盖法阵',
  'JT-SEAL-0005': '结界·蛤蟆瓢牢',
  'JT-SEAL-0010': '契约封印',
  'JT-SEAL-0011': '舌祸根绝之印',
  'JT-SEAL-0014': '魔像之锁',
  'JT-SEAL-0015': '沙漠层大葬封印',
  'JT-SEAL-0016': '八卦封印式',
  'JT-SEAL-0025': '飞雷神·导雷',
  'JT-SEAL-0026': '禁个咒之札',
  'JT-SEAL-0031': '蛤蟆隐之术',
  'JT-SEAL-0039': '封印术·狮子闭哮',
  'JT-SEAL-0042': '封印术·虎视眈弹',
  'JT-SEAL-0043': '自业咒缚之印',
  'JT-SEAL-0049': '百豪之印',
  'JT-SEAL-0050': '一丝灯阵',
  'JT-SEAL-0051': '通灵·雷光剑化',
  'JT-SEAL-0055': '紧缚金锁之术',
  'JT-SEN-0004': '地之咒印',
  'JT-SEN-0005': '天之咒印',
  'JT-SEN-0009': '多莲不自连炮',
  'JT-SEN-0010': '大蛇丸之咒印术',
  'JT-SEN-0012': '仙法·两生之术',
  'JT-SEN-0024': '传异远影',
  'JT-SPACE-0003': '增幅通灵之术',
  'JT-SPACE-0006': '飞雷神·二段',
  'JT-SPACE-0007': '飞雷神互瞬回之术',
  'JT-SPACE-0010': '万蛇罗之阵',
  'JT-SPACE-0012': '神威奔袭',
  'JT-SPACE-0013': '神威奔袭·惨',
  'JT-SPACE-0017': '逆通灵之术',
  'JT-SPACE-0019': '通灵轮回眼',
  'JT-SPACE-0021': '通灵·外道魔像',
  'JT-SPACE-0022': '通灵·屋台崩之术',
  'JT-SPACE-0023': '通灵·秽土转生',
  'JT-SPACE-0024': '通灵·五重罗生门',
  'JT-SPACE-0025': '通灵·罗生门',
  'JT-SPACE-0026': '通灵·蛤蟆口缚',
  'JT-SPACE-0027': '通灵·蛤蟆见世之术',
  'JT-SPACE-0028': '通灵·三重罗生门',
  'JT-SUMMON-0002': '通灵·伊布濑毒雾',
  'JT-TAI-0001': '荒缲鹭伐刀',
  'JT-TAI-0005': '虫咬',
  'JT-TAI-0006': '蝶弹爆击',
  'JT-TAI-0009': '分身体撞击',
  'JT-TAI-0013': '缠绕',
  'JT-TAI-0021': '扰乱体术',
  'JT-TAI-0023': '醉拳',
  'JT-TAI-0024': '动力前奏曲',
  'JT-TAI-0025': '动力标记',
  'JT-TAI-0032': '八十神空击',
  'JT-TAI-0033': '喷推拳',
  'JT-TAI-0034': '喷刚脚',
  'JT-TAI-0044': '蛙组手',
  'JT-TAI-0045': '蛙击',
  'JT-TAI-0046': '表莲华',
  'JT-TAI-0048': '柔拳法·一击身',
  'JT-TAI-0050': '大猫爪击',
  'JT-TAI-0056': '肉弹悠悠球',
  'JT-TAI-0060': '木叶回旋旋风',
  'JT-TAI-0064': '木叶升风',
  'JT-TAI-0067': '木叶旋风',
  'JT-TAI-0068': '跳弹甲橹',
  'JT-TAI-0071': '小指攻击',
  'JT-TAI-0083': '降落伞',
  'JT-TAI-0088': '兔毛针',
  'JT-TAI-0089': '里莲华',
  'JT-TAI-0092': '双袭牙',
  'JT-TAI-0093': '戟讨耀角',
  'JT-TAI-0100': '尾兽总进击',
  'JT-TAI-0103': '蛤蟆短刀斩',
  'JT-WATER-0003': '雾隐之术',
  'JT-WATER-0009': '肥皂泡忍术',
  'JT-WATER-0014': '飓风水涡之术',
  'JT-WATER-0017': '水铁炮·二丁',
  'JT-WATER-0018': '水牢鲛舞之术',
  'JT-WATER-0020': '水遁·千食鲛',
  'JT-WATER-0023': '水遁·五食鲛',
  'JT-WATER-0025': '水遁·大鲛弹之术',
  'JT-WATER-0030': '水遁·盾乌帽子',
  'JT-WATER-0039': '水遁·水鲛弹之术',
  'JT-WIND-0012': '通灵·斩斩舞',
  'JT-WIND-0015': '风遁·气流乱舞',
  'JT-WIND-0017': '风遁·练空弹',
  'JT-WIND-0022': '风遁·大镰鼬之术',
  'JT-WIND-0024': '风遁·压害'
});

function simplifyChinese(value) {
  const fixes = {
    車:'车',倉:'仓',鶴:'鹤',個:'个',對:'对',絶:'绝',獣:'兽',竜:'龙',隠:'隐',風:'风',雲:'云',機:'机',戦:'战',線:'线',鉄:'铁',鎧:'铠',髪:'发',術:'术',間:'间',頭:'头',総:'总',結:'结',陸:'陆',閣:'阁',紙:'纸',鱗:'鳞',呪:'咒',網:'网',縄:'绳',蟲:'虫',蝦:'虾',蟇:'蟆',軟:'软',嵐:'岚',廻:'回',増:'增',挿:'插',黙:'默',鳴:'鸣',羅:'罗',門:'门',掛:'挂',歩:'步',撫:'抚',鎌:'镰',鮫:'鲨',獄:'狱',変:'变',続:'续',壊:'坏',塵:'尘',巻:'卷',弾:'弹',辺:'边',転:'转',闘:'斗',髭:'须',対:'对',団:'团',呪:'咒',絶:'绝',愛:'爱',張:'张',霧:'雾',霊:'灵',顕:'显',須:'须',顔:'颜',価:'价',発:'发',楽:'乐',桜:'樱',楼:'楼',剣:'剑',裏:'里',獣:'兽',伝:'传',権:'权',壺:'壶',殻:'壳',獅:'狮',獨:'独',個:'个',仕:'仕'
  };
  return [...String(value || '')].map(char => fixes[char] || TRADITIONAL_TO_SIMPLIFIED[char] || char).join('')
    .replace(/C0/g, '零级').replace(/C1/g, '一级').replace(/C2/g, '二级').replace(/C3/g, '三级').replace(/C4/g, '四级')
    .replace(/(.)々/g, '$1$1');
}

function looksChinese(value) {
  const text = String(value || '').trim();
  return /[\u4e00-\u9fff]/.test(text) && !/[A-Za-zぁ-ゖァ-ヺ]/.test(text);
}

function fallbackChineseName(value) {
  let text = String(value || '').trim();
  text = text.replace(/男の子どうし/g, '男女').replace(/女の子どうし/g, '女女')
    .replace(/木ノ叶/g, '木叶').replace(/草薙の剣/g, '草薙剑')
    .replace(/蝦蟇/g, '蛤蟆').replace(/口寄せ/g, '召唤').replace(/寄せ/g, '召唤')
    .replace(/穢土転生/g, '秽土转生').replace(/手裏剣/g, '手里剑').replace(/手裏/g, '手里')
    .replace(/秘伝/g, '秘传').replace(/式紙/g, '式纸').replace(/紙者/g, '纸者')
    .replace(/仕込/g, '装填').replace(/風車/g, '风车').replace(/最硬絶対防御/g, '最硬绝对防御')
    .replace(/羅生門/g, '罗生门').replace(/万蛇羅/g, '万蛇罗').replace(/見世/g, '见世');
  for (const [from, to] of JAPANESE_TO_CHINESE) text = text.split(from).join(to);
  text = text.replace(/剣/g, '剑');
  text = text.replace(/[ぁ-んァ-ヺー]/g, '');
  return text.replace(/·+/g, '·').replace(/^·|·$/g, '') || String(value || '').trim();
}

export function displayCanonTechniqueName(techniqueOrName) {
  const technique = typeof techniqueOrName === 'string' ? resolveCanonTechnique(techniqueOrName).technique : techniqueOrName;
  if (!technique) return simplifyChinese(fallbackChineseName(techniqueOrName));
  if (TECHNIQUE_DISPLAY_OVERRIDES[technique.id]) return TECHNIQUE_DISPLAY_OVERRIDES[technique.id];
  const candidates = [technique.display_name, ...(technique.aliases || []), technique.name];
  return simplifyChinese(candidates.find(looksChinese) || fallbackChineseName(technique.name));
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·:：,，。!！?？()（）\-—_]/g, '');
}

let techniqueIndex = { revision: -1, canonical: new Map(), aliases: new Map() };
function getTechniqueIndex() {
  const revision = getCanonDatabaseRevision();
  if (techniqueIndex.revision === revision) return techniqueIndex;
  const canonical = new Map();
  const aliases = new Map();
  for (const technique of getCanonRecords('techniques')) {
    const canonicalKey = normalizeText(technique.name);
    if (canonicalKey) canonical.set(canonicalKey, technique);
    const displayName = displayCanonTechniqueName(technique);
    for (const alias of [displayName, ...(technique.aliases || []), ...(technique.lookup_aliases || [])]) {
      const aliasKey = normalizeText(alias);
      if (!aliasKey) continue;
      const candidates = aliases.get(aliasKey) || [];
      if (!candidates.some(candidate => candidate.id === technique.id)) candidates.push(technique);
      aliases.set(aliasKey, candidates);
    }
  }
  techniqueIndex = { revision, canonical, aliases };
  return techniqueIndex;
}

function clampMastery(value) {
  const number = Number(value);
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(number) ? number : 0)));
}

function techniqueElement(technique) {
  const elements = (technique?.elements || []).map(element => ELEMENT_LABELS[element] || element).filter(Boolean);
  return [...new Set(elements)].join('\u3001') || '\u65e0';
}

export function resolveCanonTechnique(nameOrAlias) {
  const normalized = normalizeText(nameOrAlias);
  if (!normalized) return { status: 'unmatched', normalized, technique: null, candidates: [] };
  const index = getTechniqueIndex();
  const canonical = index.canonical.get(normalized);
  if (canonical) return { status: 'matched', normalized, technique: canonical, candidates: [canonical] };
  const candidates = index.aliases.get(normalized) || [];
  if (candidates.length === 1) return { status: 'matched', normalized, technique: candidates[0], candidates };
  if (candidates.length > 1) return { status: 'ambiguous', normalized, technique: null, candidates };
  return { status: 'unmatched', normalized, technique: null, candidates: [] };
}

export function toCanonicalStateSkill(techniqueOrName, { mastery = 0 } = {}) {
  const technique = typeof techniqueOrName === 'string'
    ? resolveCanonTechnique(techniqueOrName).technique
    : techniqueOrName;
  if (!technique) return null;
  const limitations = Array.isArray(technique.limitations) ? technique.limitations.filter(Boolean) : [];
  const description = [String(technique.summary || '').trim(), ...limitations.map(String)]
    .filter(Boolean).join('\uFF1B');
  return {
    technique_id: technique.id,
    source: 'canon',
    type: technique.type,
    name: displayCanonTechniqueName(technique),
    rank: technique.rank,
    element: techniqueElement(technique),
    resource_type: RESOURCE_LABELS[technique.resource] || technique.resource,
    cost: Math.max(0, Math.round(Number(technique.cost) || 0)),
    power: Math.max(0, Math.round(Number(technique.power) || 0)),
    mastery: clampMastery(mastery),
    description
  };
}

export function sanitizeGeneratedStateSkill(input = {}, { typeHint = 'jutsu' } = {}) {
  const first = (...keys) => {
    for (const key of keys) if (input?.[key] !== undefined && input[key] !== null && input[key] !== '') return input[key];
    return undefined;
  };
  const rawType = String(first('type', '\u7c7b\u578b') || typeHint).trim().toLowerCase();
  const type = rawType.includes('gen') || rawType.includes('\u5e7b') ? 'genjutsu'
    : rawType.includes('tai') || rawType.includes('\u4f53') ? 'taijutsu'
      : rawType.includes('support') || rawType.includes('\u652f') || rawType.includes('\u8f85') ? 'support' : 'jutsu';
  const resourceFallback = type === 'genjutsu' ? '\u7cbe\u795e\u529b' : type === 'taijutsu' ? '\u4f53\u529b' : '\u67e5\u514b\u62c9';
  const rawResource = String(first('resource_type', 'resource', '\u6d88\u8017\u8d44\u6e90') || resourceFallback).trim().toLowerCase();
  const resource = rawResource.includes('spirit') || rawResource.includes('\u7cbe\u795e') ? '\u7cbe\u795e\u529b'
    : rawResource.includes('stamina') || rawResource.includes('\u4f53\u529b') ? '\u4f53\u529b' : '\u67e5\u514b\u62c9';
  const rankMatch = String(first('rank', '\u7b49\u7ea7') || 'D').toUpperCase().match(/[EDCBAS]/);
  const rank = String(first('rank', '\u7b49\u7ea7') || '').includes('\u7279') ? '\u7279' : rankMatch?.[0] || 'D';
  const minCost = type === 'support' ? 0 : 1;
  const numeric = (value, fallback, min, max) => {
    const number = Number(value);
    return Math.max(min, Math.min(max, Math.round(Number.isFinite(number) ? number : fallback)));
  };
  return {
    source: 'ai_original',
    type,
    name: String(first('name', '\u540d\u79f0') || '\u672a\u547d\u540d\u62db\u5f0f').trim(),
    rank,
    element: String(first('element', '\u5c5e\u6027') || '\u65e0').trim(),
    resource_type: resource,
    cost: numeric(first('cost', '\u6d88\u8017'), minCost, minCost, 300),
    power: numeric(first('power', '\u5a01\u529b'), 0, 0, 300),
    mastery: numeric(first('mastery', '\u719f\u7ec3\u5ea6'), 0, 0, 100),
    description: String(first('description', '\u63cf\u8ff0') || '').trim()
  };
}

function tokenize(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase();
  const terms = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 2));
  for (const run of text.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    terms.add(run);
    for (let size = 2; size <= Math.min(4, run.length); size++) {
      for (let index = 0; index <= run.length - size; index++) terms.add(run.slice(index, index + size));
    }
  }
  return [...terms];
}

export function normalizeCanonDate(value) {
  if (typeof value === 'object' && value) {
    const yearValue = value.konoha_year ?? value.year;
    const yearMatch = String(yearValue ?? '').match(/(?:K|木叶\s*)(\d{1,3})/i);
    const year = Number.isFinite(Number(yearValue)) ? Number(yearValue) : Number(yearMatch?.[1]);
    const month = Number(value.month ?? 1);
    const day = Number(value.day ?? value.date ?? 1);
    if (Number.isInteger(year) && year >= 0 && year <= 999
      && Number.isInteger(month) && month >= 1 && month <= 12
      && Number.isInteger(day) && day >= 1 && day <= 30) {
      return `K${String(year).padStart(3, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }
  const raw = String(value || '');
  const canonical = raw.match(/K(\d{1,3})-(\d{1,2})-(\d{1,2})/i);
  if (canonical) {
    const [, year, month, day] = canonical;
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 30) return null;
    return `K${year.padStart(3, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const chinese = raw.match(/木叶\s*(\d+)\s*年(?:[^\d]*(\d+)\s*月)?(?:[^\d]*(\d+)\s*(?:日|天))?/);
  if (!chinese) return null;
  if (Number(chinese[2] || 1) < 1 || Number(chinese[2] || 1) > 12
    || Number(chinese[3] || 1) < 1 || Number(chinese[3] || 1) > 30) return null;
  return `K${chinese[1].padStart(3, '0')}-${String(chinese[2] || 1).padStart(2, '0')}-${String(chinese[3] || 1).padStart(2, '0')}`;
}

function canonDateParts(value) {
  const normalized = normalizeCanonDate(value);
  const match = normalized?.match(/^K(\d{3})-(\d{2})-(\d{2})$/);
  return match ? { normalized, year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

export function formatCanonDate(value) {
  const parts = canonDateParts(value);
  return parts ? `木叶${parts.year}年${parts.month}月${parts.day}日（${parts.normalized}）` : String(value || '未知日期');
}

export function canonDateDistance(from, to) {
  const start = canonDateParts(from);
  const end = canonDateParts(to);
  if (!start || !end) return null;
  return (end.year * 360 + (end.month - 1) * 30 + end.day)
    - (start.year * 360 + (start.month - 1) * 30 + start.day);
}

function isYearSnapshotDay(day) {
  return Boolean(day?.year_snapshot && typeof day.year_snapshot === 'object');
}

function snapshotValue(value, fallback = '未记录') {
  if (Array.isArray(value)) return value.filter(Boolean).join('、') || fallback;
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatSnapshotAge(age = {}) {
  const birthday = age.birthday ? `（生日 ${age.birthday}）` : '';
  if (age.status === 'born_this_year') {
    return `年初尚未出生${age.birthday ? `；本年 ${age.birthday} 出生` : ''}`;
  }
  if (age.status === 'unknown') return `年龄未冻结${birthday}`;
  const atYearStart = Number(age.at_year_start);
  const afterBirthday = Number(age.after_birthday);
  if (Number.isInteger(atYearStart) && atYearStart >= 0) {
    return Number.isInteger(afterBirthday) && afterBirthday >= 0
      ? `年初 ${atYearStart} 岁；生日后 ${afterBirthday} 岁${birthday}`
      : `年初 ${atYearStart} 岁${birthday}`;
  }
  return `年龄未冻结${birthday}`;
}

function formatSnapshotState(state = {}) {
  return [
    `状态=${snapshotValue(state.status)}`,
    `势力=${snapshotValue(state.affiliation)}`,
    `位置=${snapshotValue(state.location)}`
  ].join(' | ');
}

function stateSkillNames(state) {
  const names = [];
  for (const key of Object.keys(state || {})) {
    const match = key.match(/^技能·(?:忍术|体术|幻术|支援)·(.+)·名称$/);
    if (match) names.push(String(state[key] || match[1]));
  }
  for (const item of state?._combat?.enemy_jutsu || []) names.push(item?.名称 || item?.name || '');
  return names.filter(Boolean);
}

function timelineDecisions(state) {
  const decisions = new Map();
  for (const line of String(state?.['世界·活跃事件'] || '').split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const status = String(event.status || '').toLowerCase();
      if (isProjectTimelineEventId(event.id) && PROJECT_TIMELINE_STATUSES.has(status)) {
        decisions.set(event.id, { ...event, status });
      }
    } catch {}
  }
  return decisions;
}

function scoreText(haystack, terms) {
  const lower = String(haystack || '').toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? Math.min(12, term.length + 2) : 0), 0);
}

function getPlotIndex({ includeDisabled = false } = {}) {
  const days = [...getCanonRecords('plot', { includeDisabled })]
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.id.localeCompare(b.id));
  const nodes = new Map();
  for (const day of days) {
    const referenceOnly = isYearSnapshotDay(day);
    nodes.set(day.id, { id: day.id, type: 'day', date: day.date, day, reference_only: referenceOnly });
    for (const scene of day.scenes || []) {
      nodes.set(scene.id, { id: scene.id, type: 'scene', date: day.date, day, scene, reference_only: referenceOnly });
      for (const beatItem of scene.beats || []) {
        nodes.set(beatItem.id, {
          id: beatItem.id,
          type: 'beat',
          date: day.date,
          day,
          scene,
          beat: beatItem,
          reference_only: referenceOnly
        });
      }
    }
  }
  return { days, nodes };
}

function decisionIsSettled(decision, currentDate) {
  if (!decision) return false;
  if (decision.status !== 'postponed') return true;
  const rescheduleTo = normalizeCanonDate(decision.reschedule_to || decision.rescheduled_to);
  return !rescheduleTo || rescheduleTo.localeCompare(currentDate) > 0;
}

function dayIsSettled(day, decisions, currentDate) {
  if (decisionIsSettled(decisions.get(day.id), currentDate)) return true;
  const scenes = day.scenes || [];
  if (scenes.length && scenes.every(scene => decisionIsSettled(decisions.get(scene.id), currentDate))) return true;
  const beats = scenes.flatMap(scene => scene.beats || []);
  return beats.length > 0 && beats.every(item => decisionIsSettled(decisions.get(item.id), currentDate));
}

function nodeStatus(id, decisions, currentDate) {
  const decision = decisions.get(id);
  if (!decision) return 'pending';
  if (decision.status === 'postponed' && !decisionIsSettled(decision, currentDate)) return 'rescheduled-due';
  return decision.status;
}

function sourceLabel(sourceItem) {
  const kind = { manga: '漫画', anime: '动画', databook: '公式书', game: '游戏', original: '项目原创连接' }[sourceItem?.kind] || sourceItem?.kind || '来源';
  return `${kind}:${sourceItem?.reference || '未注明'}（${sourceItem?.contribution || '未注明作用'}）`;
}

function listLines(label, values, indent = '  ') {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return `${indent}${label}: 无`;
  return [`${indent}${label}:`, ...list.map(value => `${indent}- ${value}`)].join('\n');
}

function formatPlotScene(scene, index, decisions, currentDate) {
  const lines = [
    `=== SCENE_START ${index + 1} id=${scene.id} status=${nodeStatus(scene.id, decisions, currentDate)} ===`,
    `场景标题: ${scene.title}`,
    `线程: ${scene.thread_id}`,
    `地点: ${scene.location}`,
    `参与者: ${(scene.participants || []).join('、')}`,
    `结算方式: ${scene.resolution_mode}`,
    listLines('前置条件', scene.requirements),
    listLines('阻断条件', scene.blockers),
    `  开场态势: ${scene.setup}`,
    '  有序原子节拍:'
  ];
  for (const beatItem of scene.beats || []) {
    lines.push(`  - [${beatItem.id}] order=${beatItem.order} role=${beatItem.causal_role} status=${nodeStatus(beatItem.id, decisions, currentDate)} | ${beatItem.summary}`);
  }
  lines.push(
    listLines('基准结果', scene.outcomes),
    listLines('状态变化', scene.state_changes),
    `  停止条件: ${scene.stop_condition}`,
    '  分支回退方向:'
  );
  for (const fallback of scene.fallbacks || []) {
    lines.push(`  - 条件=${fallback.condition} | 建议状态=${fallback.status} | 方向=${fallback.direction} | 必须保留=${fallback.preserves}`);
  }
  lines.push(
    listLines('参考事实（只作背景，不得当作本日节拍执行）', scene.reference_facts),
    `  来源材料: ${(scene.source_material || []).map(sourceLabel).join('；')}`,
    `  设计理由: ${scene.design_rationale}`,
    `=== SCENE_END id=${scene.id} ===`
  );
  return lines.join('\n');
}

function formatPlotDayContext(context) {
  if (!context?.day) return '';
  const {
    day,
    current_date: currentDate,
    target_date: targetDate,
    date_relation: dateRelation,
    days_until: daysUntil,
    decisions
  } = context;
  const lines = [
    `<<< CURRENT_PLOT_START current=${currentDate} target=${targetDate} days_until=${daysUntil} date_relation=${dateRelation} >>>`,
    `【当前可用完整剧情日】当前日期 ${formatCanonDate(currentDate)}；剧情日 ${formatCanonDate(day.date)}；日期关系=${dateRelation}，相距 ${daysUntil} 天。该剧情日可作为当前分支的普通剧情上下文引用、推进和改写；使用其中事件不会自动改变游戏日期。以下列出全部 ${day.scenes?.length || 0} 个独立场景，按地点、线程和停止条件分别推进。`,
    `DAY: ${day.id} | status=${nodeStatus(day.id, decisions, currentDate)} | arc=${day.arc_id}`,
    `标题: ${day.title}`,
    `当日目标: ${day.day_goal}`,
    listLines('日初世界状态', day.start_state),
    listLines('参考事实（背景/回顾，禁止作为本日新事件执行）', day.reference_facts),
    ...((day.scenes || []).map((scene, index) => formatPlotScene(scene, index, decisions, currentDate))),
    listLines('日终基准状态', day.end_state),
    `后续转场: ${day.transition}`,
    '<<< CURRENT_PLOT_END >>>'
  ];
  return lines.join('\n');
}

function formatYearSnapshotContext(context) {
  if (!context?.snapshot) return '';
  const { snapshot, current_date: currentDate, snapshot_date: snapshotDate } = context;
  const publicCharacters = [];
  const backstageTruths = [];
  for (const character of snapshot.characters || []) {
    const identity = character.entity_id
      ? `[${character.entity_id}] ${snapshotValue(character.name, character.entity_id)}`
      : snapshotValue(character.name);
    publicCharacters.push(`- ${identity} | 年龄=${formatSnapshotAge(character.age)} | ${formatSnapshotState(character.public_state)}`);
    if (character.actual_state && typeof character.actual_state === 'object') {
      const actual = character.actual_state;
      const fields = [];
      if (actual.status !== undefined) fields.push(`状态=${snapshotValue(actual.status)}`);
      if (actual.affiliation !== undefined) fields.push(`势力=${snapshotValue(actual.affiliation)}`);
      if (actual.location !== undefined) fields.push(`位置=${snapshotValue(actual.location)}`);
      backstageTruths.push(`- ${identity} | visibility=${snapshotValue(actual.visibility, 'secret')} | ${fields.join(' | ') || '存在未公开真实状态'}`);
    }
  }

  const publicFactions = [];
  for (const faction of snapshot.factions || []) {
    const identity = faction.organization_id
      ? `[${faction.organization_id}] ${snapshotValue(faction.name, faction.organization_id)}`
      : snapshotValue(faction.name);
    const line = `- ${identity} | 存续=${snapshotValue(faction.lifecycle)} | 位置=${snapshotValue(faction.location)}`;
    if (faction.visibility === 'restricted' || faction.visibility === 'secret') {
      backstageTruths.push(`${line} | visibility=${faction.visibility}`);
    } else {
      publicFactions.push(line);
    }
  }

  return [
    `<<< YEAR_SNAPSHOT_START current=${currentDate} as_of=${snapshotDate} >>>`,
    `【年度年初状态基线，不是剧情事件】本快照只描述 ${formatCanonDate(snapshotDate)} 已成立的年龄、状态、势力与宽粒度位置；当前日期为 ${formatCanonDate(currentDate)}。`,
    '当前存档、开局契约和已发生记忆高于本基线；本快照不推进日期，不得生成 occurred/altered/skipped/postponed 或任何 DAY/SCN/EV 记账。',
    '[PUBLIC_STATE — 可作为公开世界状态使用，但仍须服从角色个人知识边界]',
    '重要人物:',
    ...(publicCharacters.length ? publicCharacters : ['- 无结构化人物记录']),
    '仍存在或正在形成的势力:',
    ...(publicFactions.length ? publicFactions : ['- 无公开势力记录']),
    '[BACKSTAGE_TRUTH — 仅供叙事后台保持一致，绝不能自动转化为玩家或NPC知识]',
    ...(backstageTruths.length ? backstageTruths : ['- 无额外隐藏真实状态']),
    '<<< YEAR_SNAPSHOT_END >>>'
  ].join('\n');
}

export const CANON_DATABASE = {
  meta: CANON_RUNTIME_META,
  get revision() { return getCanonDatabaseRevision(); },

  getRecords(kind, options = {}) { return getCanonRecords(kind, options); },

  getRecord(kind, id, options = {}) { return getCanonRecord(kind, id, options); },

  getStats(kind) { return getCanonDatabaseStats(kind); },

  getOverrideStore(kind) { return getCanonOverrideStore(kind); },

  saveRecord(kind, record) { return saveCanonRecord(kind, record); },

  setRecordEnabled(kind, id, enabled) { return setCanonRecordEnabled(kind, id, enabled); },

  resetRecord(kind, id) { return resetCanonRecord(kind, id); },

  replaceOverrideStore(kind, payload) { return replaceCanonOverrideStore(kind, payload); },

  clearOverrides(kind) { return clearCanonOverrides(kind); },

  getRecordStatus(kind, id) {
    const entry = getCanonOverrideStore(kind).records[id];
    return {
      custom: entry?.custom === true,
      overridden: Boolean(entry?.value),
      disabled: entry?.disabled === true
    };
  },

  getYearSnapshotContext({ state = {} } = {}) {
    const currentDate = normalizeCanonDate(state['世界·时间'] || state['世界·年代']);
    if (!currentDate) return null;
    const currentYear = currentDate.slice(0, 4);
    const candidates = getCanonRecords('plot')
      .filter(isYearSnapshotDay)
      .map(day => ({
        day,
        snapshot: day.year_snapshot,
        snapshot_date: normalizeCanonDate(day.year_snapshot?.as_of)
      }))
      .filter(item => item.snapshot_date
        && item.snapshot_date.slice(0, 4) === currentYear
        && item.snapshot_date.localeCompare(currentDate) <= 0)
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || a.day.id.localeCompare(b.day.id));
    const match = candidates.at(-1);
    if (!match) return null;
    return {
      current_date: currentDate,
      snapshot_date: match.snapshot_date,
      days_since: canonDateDistance(match.snapshot_date, currentDate),
      reference_only: true,
      day: match.day,
      snapshot: match.snapshot
    };
  },


  getPlotDayContext({ state = {} } = {}) {
    const currentDate = normalizeCanonDate(state['世界·时间'] || state['世界·年代']);
    if (!currentDate) return null;
    const { days, nodes } = getPlotIndex();
    const narrativeDays = days.filter(day => !isYearSnapshotDay(day));
    const decisions = timelineDecisions(state);
    const exact = narrativeDays.find(day => day.date === currentDate && !dayIsSettled(day, decisions, currentDate));
    if (exact) {
      return { current_date: currentDate, target_date: exact.date, date_relation: 'current', is_future: false, days_until: 0, day: exact, decisions, nodes };
    }

    const postponedDue = [...decisions.entries()]
      .filter(([, decision]) => decision.status === 'postponed'
        && normalizeCanonDate(decision.reschedule_to || decision.rescheduled_to) === currentDate)
      .map(([id]) => nodes.get(id))
      .filter(node => node && !node.reference_only)
      .map(node => node.day)
      .find(Boolean);
    if (postponedDue) {
      return { current_date: currentDate, target_date: currentDate, original_date: postponedDue.date, date_relation: 'rescheduled', is_future: false, is_rescheduled: true, days_until: 0, day: postponedDue, decisions, nodes };
    }

    const future = narrativeDays.find(day => day.date.localeCompare(currentDate) > 0 && !dayIsSettled(day, decisions, currentDate));
    if (!future) return null;
    return {
      current_date: currentDate,
      target_date: future.date,
      date_relation: 'future',
      is_future: true,
      days_until: canonDateDistance(currentDate, future.date),
      day: future,
      decisions,
      nodes
    };
  },

  getPlotNode(id, options = {}) {
    return getPlotIndex(options).nodes.get(id) || null;
  },

  validateTimelineEventUpdate(eventData, { state = {} } = {}) {
    const id = String(eventData?.id || '');
    if (!isProjectTimelineEventId(id)) return { allowed: true, timeline: false };
    const currentDate = normalizeCanonDate(state['世界·时间'] || state['世界·年代']);
    if (!currentDate) return { allowed: false, timeline: true, id, reason: '当前存档没有合法完整日期，拒绝写入项目正史状态。' };
    const node = this.getPlotNode(id);
    if (!node) return { allowed: false, timeline: true, id, currentDate, reason: '项目正史运行时不存在该 DAY/SCN/EV ID。' };
    if (node.reference_only) {
      return {
        allowed: false,
        timeline: true,
        referenceOnly: true,
        id,
        nodeDate: node.date,
        currentDate,
        reason: '年度快照是只读参考基线，不是可写入 occurred/altered/skipped/postponed 的剧情事件。'
      };
    }
    const status = String(eventData?.status || '').toLowerCase();
    if (!PROJECT_TIMELINE_STATUSES.has(status)) {
      return { allowed: false, timeline: true, id, nodeDate: node.date, currentDate, reason: '项目正史状态只允许 occurred/altered/skipped/postponed。' };
    }
    if (status === 'postponed') {
      const target = normalizeCanonDate(eventData.reschedule_to || eventData.rescheduled_to);
      if (!target || target.localeCompare(currentDate) <= 0) {
        return { allowed: false, timeline: true, id, nodeDate: node.date, currentDate, reason: 'postponed 必须提供晚于当前日期的合法 reschedule_to。' };
      }
    }
    return { allowed: true, timeline: true, id, status, nodeType: node.type, nodeDate: node.date, currentDate };
  },

  resolveTechnique(nameOrAlias) {
    return resolveCanonTechnique(nameOrAlias).technique;
  },

  resolveTechniqueResult(nameOrAlias) {
    return resolveCanonTechnique(nameOrAlias);
  },

  toStateSkill(techniqueOrName, options = {}) {
    return toCanonicalStateSkill(techniqueOrName, options);
  },

  sanitizeGeneratedSkill(input, options = {}) {
    return sanitizeGeneratedStateSkill(input, options);
  },

  searchTechniques({ query = '', state = {}, limit = 6 } = {}) {
    const explicitNames = stateSkillNames(state);
    const searchText = `${query}\n${explicitNames.join('\n')}`;
    const normalizedQuery = normalizeText(searchText);
    const terms = tokenize(searchText);
    if (!normalizedQuery && !terms.length) return [];
    return getCanonRecords('techniques').map(technique => {
      const names = [displayCanonTechniqueName(technique), technique.name, ...(technique.aliases || []), ...(technique.lookup_aliases || [])];
      let relevance = 0;
      for (const name of names) {
        const normalizedName = normalizeText(name);
        if (normalizedName && normalizedQuery.includes(normalizedName)) relevance += 100 + normalizedName.length;
      }
      relevance += scoreText(names.join(' ') + '\n' + (technique.classes || []).join(' ') + '\n' + (technique.lookup_classes || []).join(' '), terms);
      return { ...technique, relevance };
    }).filter(technique => technique.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, limit));
  },

  buildContext({ query = '', state = {}, maxTechniques = 6, budget = 4200 } = {}) {
    const yearSnapshotContext = this.getYearSnapshotContext({ state });
    const plotContext = this.getPlotDayContext({ state });
    const techniques = this.searchTechniques({ query, state, limit: maxTechniques });
    if (!yearSnapshotContext && !plotContext && !techniques.length) return '';

    const blocks = [
      '[项目正史时间线 V2 与忍术数据库检索结果]',
      '[数据库使用边界]',
      '- 权威顺序固定为：当前存档/开局契约/已发生记忆 > 项目世界书 > 项目正史时间线 > 忍术数据库资料 > 模型预训练知识。',
      '- DAY/SCN/EV 是日、场景和原子节拍三个层级。当前日内容是可分支基准，不是强制剧本；核对 requirements 与 blockers 后裁定 occurred/altered/skipped/postponed。',
      '- 当天全部场景会完整提供。每个 SCENE_START/SCENE_END 都是独立地点与冲突线程；只推进当前视角能够接续的场景，禁止把并行地点强行缝成连续一幕。',
      '- reference_facts 只用于校验背景和回顾，绝不能作为当前日期新事件执行或记账。',
      '- 当前日期没有未结算剧情日时，只提供最近一个后续剧情日；它是普通分支素材，可在当前回合引用、推进、改写并写入 <event>，且不会自动修改游戏日期。',
      '- 玩家改变前置后必须使用场景预设的 fallback 方向，再由AI补充分支细节；不得为了回归基准抹除玩家影响。',
      '- YEAR_SNAPSHOT 是当前年份的年初只读基线，不是剧情节点；PUBLIC_STATE 仍受角色知识边界约束，BACKSTAGE_TRUTH 只能由叙事后台使用，绝不能自动变成玩家或NPC知识。',
      '- JT记录说明术本身，不证明当前角色已经掌握；施展前仍须核对角色技能表、资格、当前日期和学习来源。',
      '- 术名、类型、资源、cost、威力和机制以命中的JT记录为准，禁止按印象改名、改消耗或补招牌术。',
      '- 时间线日期是为最佳游玩性冻结的项目日期，不是对漫画绝对日期的声明。'
    ];
    if (yearSnapshotContext) blocks.push(formatYearSnapshotContext(yearSnapshotContext));
    if (plotContext) blocks.push(formatPlotDayContext(plotContext));
    if (techniques.length) {
      blocks.push('[忍术目录命中]');
      let techniqueUsed = 0;
      for (const technique of techniques) {
        const access = [
          technique.access?.restriction,
          ...(technique.access?.required_bloodlines || []),
          ...(technique.access?.required_techniques || []),
          ...(technique.access?.required_contracts || [])
        ].filter(value => value && value !== 'unknown').join('、');
        const techniqueBlock = (
          `- ${technique.id} | ${displayCanonTechniqueName(technique)} | ${TYPE_LABELS[technique.type] || technique.type}/${technique.rank} | ${RESOURCE_LABELS[technique.resource] || technique.resource} cost=${technique.cost} power=${technique.power}`
          + `\n  机制: ${String(technique.summary || '数据库未填写').slice(0, 360)}`
          + (access ? `\n  资格/前置: ${access}` : '')
          + ((technique.users || []).length ? `\n  已确认使用者ID: ${technique.users.slice(0, 8).join('、')}` : '')
          + (technique.availability?.earliest_confirmed_date ? `\n  最早确认日期: ${technique.availability.earliest_confirmed_date}` : '')
          + (technique.availability?.first_confirmed_event_id ? `\n  首次确认事件: ${technique.availability.first_confirmed_event_id}` : '')
        );
        if (techniqueUsed && techniqueUsed + techniqueBlock.length > Math.max(0, Number(budget) || 0)) break;
        blocks.push(techniqueBlock);
        techniqueUsed += techniqueBlock.length;
      }
    }
    return blocks.join('\n');
  }
};

export default CANON_DATABASE;
