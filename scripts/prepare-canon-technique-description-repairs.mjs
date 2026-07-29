#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonRoot = path.join(root, 'canon-rebuild-output', 'data', 'canon');
const techniqueRoot = path.join(canonRoot, 'techniques');
const outputFile = path.join(root, '.codex-tmp', 'canon-technique-description-repair-candidates.json');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const manifest = readJson(path.join(techniqueRoot, 'manifest.json'));
const records = manifest.shards.flatMap(shard => {
  const body = readJson(path.join(techniqueRoot, shard.path));
  return (body.records || []).map(record => ({ ...record, shard: shard.path }));
});

const numericId = record => Number(record.id.split('-').at(-1));
const needsRepair = record => (
  (record.id.startsWith('JT-OTHER-') && (numericId(record) >= 101 || [23, 71].includes(numericId(record))))
  || (record.id.startsWith('JT-SEN-') && numericId(record) >= 3)
  || (record.id.startsWith('JT-SPACE-') && numericId(record) >= 2)
);
const targets = records.filter(needsRepair);

const canonDatabaseSource = fs.readFileSync(path.join(root, 'js', 'data', 'canon-database.js'), 'utf8');
const displayOverrideBlock = canonDatabaseSource.match(/const TECHNIQUE_DISPLAY_OVERRIDES = Object\.freeze\(\{([^]*?)\n\}\);/)?.[1] || '';
const displayOverrides = new Map();
for (const match of displayOverrideBlock.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) {
  displayOverrides.set(match[1], match[2]);
}

const nameGlossary = {
  'Naruto Uzumaki': '漩涡鸣人',
  'Naruto': '鸣人',
  'Boruto Uzumaki': '漩涡博人',
  'Boruto': '博人',
  'Himawari Uzumaki': '漩涡向日葵',
  'Sasuke Uchiha': '宇智波佐助',
  'Sakura Haruno': '春野樱',
  'Kakashi Hatake': '旗木卡卡西',
  'Obito Uchiha': '宇智波带土',
  'Madara Uchiha': '宇智波斑',
  'Itachi Uchiha': '宇智波鼬',
  'Shisui Uchiha': '宇智波止水',
  'Hashirama Senju': '千手柱间',
  'Hashirama': '柱间',
  'Tobirama Senju': '千手扉间',
  'Minato Namikaze': '波风水门',
  'Minato': '水门',
  'Hiruzen Sarutobi': '猿飞日斩',
  'Konohamaru Sarutobi': '猿飞木叶丸',
  'Asura Ōtsutsuki': '大筒木阿修罗',
  'Indra Ōtsutsuki': '大筒木因陀罗',
  'Hagoromo Ōtsutsuki': '大筒木羽衣',
  'Hamura Ōtsutsuki': '大筒木羽村',
  'Hamura': '羽村',
  'Kaguya Ōtsutsuki': '大筒木辉夜',
  'Momoshiki Ōtsutsuki': '大筒木桃式',
  'Kinshiki Ōtsutsuki': '大筒木金式',
  'Isshiki Ōtsutsuki': '大筒木一式',
  'Shibai Ōtsutsuki': '大筒木芝居',
  'Orochimaru': '大蛇丸',
  'Jiraiya': '自来也',
  'Tsunade': '纲手',
  'Kabuto Yakushi': '药师兜',
  'Kabuto': '兜',
  'Gaara': '我爱罗',
  'Kankurō': '勘九郎',
  'Temari': '手鞠',
  'Shikamaru Nara': '奈良鹿丸',
  'Shikaku Nara': '奈良鹿久',
  'Ino Yamanaka': '山中井野',
  'Inoichi Yamanaka': '山中亥一',
  'Inojin Yamanaka': '山中井阵',
  'Chōji Akimichi': '秋道丁次',
  'Chōza Akimichi': '秋道丁座',
  'Shino Aburame': '油女志乃',
  'Kiba Inuzuka': '犬冢牙',
  'Akamaru': '赤丸',
  'Hinata Hyūga': '日向雏田',
  'Neji Hyūga': '日向宁次',
  'Rock Lee': '洛克李',
  'Might Guy': '迈特凯',
  'Sai': '佐井',
  'Yamato': '大和',
  'Killer B': '奇拉比',
  'Pain': '佩恩',
  'Chiyo': '千代',
  'Saiken': '犀犬',
  'Anko Mitarashi': '御手洗红豆',
  'Shizune': '静音',
  'Dosu Kinuta': '托斯·砧',
  'Kin Tsuchi': '金·土',
  'Nagato': '长门',
  'Konan': '小南',
  'Sasori': '蝎',
  'Deidara': '迪达拉',
  'Kisame Hoshigaki': '干柿鬼鲛',
  'Hidan': '飞段',
  'Kakuzu': '角都',
  'Black Zetsu': '黑绝',
  'White Zetsu': '白绝',
  'Kimimaro': '君麻吕',
  'Jūgo': '重吾',
  'Karin': '香燐',
  'Suigetsu Hōzuki': '鬼灯水月',
  'Kidōmaru': '鬼童丸',
  'Sakon and Ukon': '左近与右近',
  'Sakon': '左近',
  'Ukon': '右近',
  'Tayuya': '多由也',
  'Jirōbō': '次郎坊',
  'Fukasaku': '深作',
  'Shima': '志麻',
  'Gamabunta': '蛤蟆文太',
  'Gamakichi': '蛤蟆吉',
  'Katsuyu': '蛞蝓',
  'Kurama': '九喇嘛',
  'Shukaku': '守鹤',
  'Gyūki': '牛鬼',
  'Ten-Tails': '十尾',
  'Nine-Tails': '九尾',
  'Fourth Hokage': '四代火影',
  'Third Hokage': '三代火影',
  'First Hokage': '初代火影',
  'Second Hokage': '二代火影'
};

const termGlossary = {
  'Sage of Six Paths': '六道仙人',
  'Shadow Clone Technique': '影分身之术',
  'Multiple Shadow Clone Technique': '多重影分身之术',
  'Transformation Technique': '变身术',
  'Summoning Technique': '通灵之术',
  'Reverse Summoning Technique': '逆通灵之术',
  'Flying Thunder God Technique': '飞雷神之术',
  'Big Ball Rasengan': '大玉螺旋丸',
  'Tailed Beast Ball': '尾兽玉',
  'Nine-Tails Chakra Mode': '九尾查克拉模式',
  'Six Paths Senjutsu': '六道仙术',
  'Sage Mode': '仙人模式',
  'Sage Transformation': '仙人化',
  'Truth-Seeking Balls': '求道玉',
  'Truth-Seeking Ball': '求道玉',
  'Impure World Reincarnation': '秽土转生',
  'Body Replacement Technique': '替身术',
  'Shadow Imitation Technique': '影子模仿术',
  'Mind Body Switch Technique': '心转身之术',
  'Multi-Size Technique': '倍化之术',
  'Kamui': '神威',
  'Susanoo': '须佐能乎',
  'Samehada': '鲛肌',
  'Akatsuki': '晓',
  'White Zetsu': '白绝',
  'Black Zetsu': '黑绝',
  'Sunagakure': '砂隐村',
  'Konohagakure': '木叶隐村',
  'Konoha': '木叶',
  'Third Kazekage': '三代风影',
  'Wood Release': '木遁',
  'Lava Release': '熔遁',
  'Storm Release': '岚遁',
  'Rinne Sharingan': '轮回写轮眼',
  'Sharingan': '写轮眼',
  'Rinnegan': '轮回眼',
  'Byakugan': '白眼',
  'Rasengan': '螺旋丸',
  'senjutsu': '仙术',
  'ninjutsu': '忍术',
  'taijutsu': '体术',
  'genjutsu': '幻术',
  'dōjutsu': '瞳术',
  'dojutsu': '瞳术',
  'kekkei mōra': '血继网罗',
  'kekkei genkai': '血继限界',
  'kinjutsu': '禁术',
  'ninken': '忍犬',
  'kikaichū': '寄坏虫',
  'senbon': '千本',
  'genin': '下忍',
  'Hokage': '火影'
};

const manualSummaryOverrides = {
  'JT-OTHER-0163': '鸣人制造多个影分身并同时变成数名裸体男性，以强烈的视觉冲击扰乱或制服目标；这是后宫术的反向变体。',
  'JT-OTHER-0164': '使用者以变身术化为裸体美女，用诱惑、惊吓或视觉冲击分散目标注意力；鸣人常用它恶作剧，也能借此在战斗中制造破绽。',
  'JT-OTHER-0165': '使用者与分身变成两名裸体男性，以迎合女性目标的偏好并造成强烈精神冲击；人物组合和姿势会影响效果。',
  'JT-OTHER-0166': '使用者与分身变成两名不同的裸体女性，以诱惑或扰乱目标；选择符合目标偏好的形象可提高成功率。',
  'JT-SEN-0019': '仙人模式是将自然能量与自身查克拉平衡融合、生成仙术查克拉的强化状态，可提升感知与身体能力，并强化原有忍术。',
  'JT-SEN-0020': '仙人化会让使用者吸收自然能量并改变身体形态，可生成武器般的肢体，同时提升力量、速度、感知和耐久力；过度使用也可能增强攻击性并导致失控。',
  'JT-SPACE-0002': '天手力是佐助借助轮回眼施展的时空间忍术，可在有效范围内瞬间与人或物交换位置，也能让两个目标彼此换位。',
  'JT-SPACE-0008': '飞雷神斩将飞雷神术式与刀术结合：使用者瞬移至已标记目标的死角，并在出现的瞬间完成高速斩击。',
  'JT-SPACE-0009': '飞雷神之术是千手扉间开发的S级时空间忍术。使用者先在目标或地点留下术式，之后便可无视常规移动距离，瞬间转移到任一有效标记处。',
  'JT-SPACE-0017': '逆通灵之术与常规通灵方向相反，可由通灵兽把与其签订契约的忍者召唤到自身所在位置，也可借助预先布置的通灵式把目标转移到指定地点。'
};

const sourceTitle = record => {
  const note = record.source_refs?.find(ref => String(ref.note || '').includes('/wiki/'))?.note || '';
  const slug = note.split('/wiki/')[1];
  if (slug) return decodeURIComponent(slug).replaceAll('_', ' ');
  return record.lookup_aliases?.[0] || record.aliases?.[0] || record.canonical_name;
};

async function fetchJson(url, label) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'naruto-rpg-technique-repair/1.0' } });
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

const wikitextByTitle = new Map();
for (let index = 0; index < targets.length; index += 40) {
  const batch = targets.slice(index, index + 40);
  const requested = batch.map(sourceTitle);
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    titles: requested.join('|'),
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    format: 'json',
    formatversion: '2',
    origin: '*'
  });
  const body = await fetchJson(`https://naruto.fandom.com/api.php?${params}`, 'Narutopedia');
  const aliases = new Map();
  for (const entry of body.query?.normalized || []) aliases.set(entry.from, entry.to);
  for (const entry of body.query?.redirects || []) aliases.set(entry.from, entry.to);
  const pages = new Map((body.query?.pages || []).map(page => [page.title, page]));
  const resolve = title => {
    let resolved = title;
    for (let step = 0; step < 4 && aliases.has(resolved); step += 1) resolved = aliases.get(resolved);
    return resolved;
  };
  for (const title of requested) {
    const page = pages.get(resolve(title)) || pages.get(title);
    wikitextByTitle.set(title, page?.revisions?.[0]?.slots?.main?.content || '');
  }
  process.stdout.write(`\rFetched ${Math.min(index + batch.length, targets.length)}/${targets.length}`);
}
process.stdout.write('\n');

function cleanWikitext(value = '') {
  let text = value
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<ref[^>]*>[^]*?<\/ref>/gi, '')
    .replace(/<ref[^/>]*\/>/gi, '')
    .replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, '');
  for (let pass = 0; pass < 8; pass += 1) text = text.replace(/\{\{[^{}]*\}\}/g, '');
  return text
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<br\s*\/?\s*>/gi, '、')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leadParagraph(wikitext) {
  const withoutInfobox = wikitext.replace(/^\s*\{\{Infobox\/Jutsu[^]*?^\}\}\s*/mi, '');
  const blocks = withoutInfobox.split(/\n\s*\n/);
  for (const block of blocks) {
    const raw = block
      .split(/\r?\n/)
      .filter(line => !/^\s*(?:\[\[(?:[a-z-]+:|Category:)|==|\{|\||!)/i.test(line))
      .join(' ');
    const text = cleanWikitext(raw);
    const words = text.match(/[A-Za-z]{2,}/g) || [];
    if (words.length >= 6 && !/^(?:es|fr|pl|pt-br|ru|de|it):/i.test(text)) {
      const withoutMedia = text
        .replace(/(?:[\w -]+\.png;)+/gi, '')
        .replace(/\s*\*\s*/g, ' ')
        .trim();
      const sentences = withoutMedia.split(/(?<=[.!?])\s+/).filter(Boolean);
      const concise = sentences.slice(0, 2).join(' ');
      return (concise || withoutMedia).slice(0, 520);
    }
  }
  return '';
}

function protectTerms(source, record) {
  let protectedText = source;
  const replacements = new Map([
    [sourceTitle(record), displayOverrides.get(record.id) || record.canonical_name],
    ...Object.entries(nameGlossary),
    ...Object.entries(termGlossary)
  ].filter(([english, chinese]) => english && chinese));
  const restores = [];
  for (const [english, chinese] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    if (!protectedText.includes(english)) continue;
    const token = `GLOSSARYTOKEN${restores.length}END`;
    protectedText = protectedText.replaceAll(english, token);
    restores.push([token, chinese]);
  }
  return {
    text: protectedText,
    restore(value) {
      let restored = value;
      for (const [token, chinese] of restores) restored = restored.replaceAll(token, chinese);
      return restored;
    }
  };
}

async function translateToChinese(source) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'zh-CN', dt: 't', q: source });
  const body = await fetchJson(`https://translate.googleapis.com/translate_a/single?${params}`, 'Google Translate');
  return (body[0] || []).map(part => part?.[0] || '').join('').trim();
}

function polishTranslation(value) {
  let polished = value
    .replaceAll('该技术', '该术')
    .replaceAll('这种技术', '此术')
    .replaceAll('这项技术', '此术')
    .replaceAll('这是一种技术', '这是一种术')
    .replaceAll('用户', '使用者')
    .replaceAll('忍者术', '忍术')
    .replaceAll('忍术技术', '忍术')
    .replaceAll('脉轮', '查克拉')
    .replaceAll('查克拉脉轮', '查克拉')
    .replaceAll('技术', '术')
    .replaceAll('克隆', '分身')
    .replaceAll('影子分身', '影分身')
    .replaceAll('创建', '创造')
    .replaceAll('氏族', '一族')
    .replaceAll('授权状态', '强化状态')
    .replaceAll('耐用性', '耐久力')
    .replaceAll('运输到', '转移到')
    .replace(/\s+/g, ' ')
    .trim();
  for (let pass = 0; pass < 3; pass += 1) {
    polished = polished
      .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '$1')
      .replace(/\s+([，。；：！？、）])/g, '$1')
      .replace(/([（])\s+/g, '$1');
  }
  return polished;
}

const candidates = new Array(targets.length);
let cursor = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < targets.length) {
    const index = cursor;
    cursor += 1;
    const record = targets[index];
    const title = sourceTitle(record);
    const source = leadParagraph(wikitextByTitle.get(title) || '');
    const protectedSource = protectTerms(source, record);
    const translated = manualSummaryOverrides[record.id] || (source
      ? polishTranslation(protectedSource.restore(await translateToChinese(protectedSource.text)))
      : '');
    candidates[index] = {
      id: record.id,
      shard: record.shard,
      canonical_name: record.canonical_name,
      source_title: title,
      source,
      translated,
      previous: record.effect?.summary || ''
    };
    if ((index + 1) % 20 === 0 || index + 1 === targets.length) {
      process.stdout.write(`\rTranslated ${index + 1}/${targets.length}`);
    }
  }
});
await Promise.all(workers);
process.stdout.write('\n');

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify({
  generated_at: new Date().toISOString(),
  count: candidates.length,
  empty_sources: candidates.filter(candidate => !candidate.source).map(candidate => candidate.id),
  candidates
}, null, 2)}\n`);
console.log(`Prepared ${candidates.length} repair candidates at ${path.relative(root, outputFile)}`);
