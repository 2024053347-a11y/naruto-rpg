import fs from 'node:fs';

import { beat, createTimelineHelpers, defineTimelineShard } from './helpers.mjs';

const { day, scene } = createTimelineHelpers('HIST', {
  defaultSourceReference: 'NARUTO 早期历史、角色生日资料与 Naruto RPG 项目纪年'
});

const projectBirths = JSON.parse(fs.readFileSync(
  new URL('../../data/canon/registries/project-births.json', import.meta.url),
  'utf8'
));
const birthByName = new Map(projectBirths.map(person => [person.name, person]));
const entityIdByName = new Map(Object.entries(JSON.parse(fs.readFileSync(
  new URL('../../data/canon/registries/early-history-entity-map.json', import.meta.url),
  'utf8'
))));
const organizations = JSON.parse(fs.readFileSync(
  new URL('../../data/canon/registries/organizations.json', import.meta.url),
  'utf8'
));
const locations = JSON.parse(fs.readFileSync(
  new URL('../../data/canon/registries/locations.json', import.meta.url),
  'utf8'
));
const yearlyManifest = JSON.parse(fs.readFileSync(
  new URL('../../data/canon/timeline/yearly/manifest.json', import.meta.url),
  'utf8'
));
const yearlyAlmanacs = (yearlyManifest.years || []).map(item => {
  const almanac = JSON.parse(fs.readFileSync(
    new URL(`../../data/canon/timeline/yearly/${item.path}`, import.meta.url),
    'utf8'
  ));
  if (almanac.year !== item.year) throw new Error(`${item.path}: 年度源文件 year 与 manifest 不一致`);
  if (!Array.isArray(almanac.character_ages) || !almanac.character_ages.length) {
    throw new Error(`${item.path}: 年度源文件缺少 character_ages`);
  }
  if (!Array.isArray(almanac.annual_events) || !almanac.annual_events.length) {
    throw new Error(`${item.path}: 年度源文件缺少 annual_events`);
  }
  return almanac;
});
const expectedYearKeys = Array.from({ length: 86 }, (_, index) => `K${String(index + 1).padStart(3, '0')}`);
if (JSON.stringify(yearlyAlmanacs.map(item => item.year)) !== JSON.stringify(expectedYearKeys)) {
  throw new Error('年度源清单必须连续覆盖 K001-K086，且严格按年份排序');
}
const organizationById = new Map(organizations.map(organization => [organization.id, organization]));
const locationById = new Map(locations.map(location => [location.id, location]));

// 这里保存的是可玩的项目纪年，不声称是原著明示的绝对年份。
// 柱间 K017 去世让纲手拥有幼年相处期，也让扉间在 K020 牺牲前有完整任期。
// 弥彦 K048 去世让初代晓有数年发展期，并使他达到约十五岁。
const lifecycleOverrides = new Map([
  ['千手柱间', { deathYear: 17, note: 'K017 本年去世（项目分配）' }],
  ['宇智波斑', { deathYear: null, note: 'K003 后公开推定死亡、真实仍存活' }],
  ['千手扉间', { deathYear: 20, note: 'K020 本年牺牲' }],
  ['金角', { deathYear: 20, note: 'K020 本年死亡' }],
  ['银角', { deathYear: 20, note: 'K020 本年死亡' }],
  ['绳树', { deathYear: 36, note: 'K036 本年死亡' }],
  ['加藤断', { deathYear: 40, note: 'K040 本年死亡' }],
  ['旗木朔茂', { deathYear: 45, note: 'K045 本年死亡' }],
  ['弥彦', { deathYear: 48, note: 'K048 本年死亡（项目分配）' }],
  ['迈特戴', { deathYear: 49, note: 'K049 本年死亡' }]
]);

const unknownAgePeople = new Set(['漩涡水户', '山椒鱼半藏', '第三代风影', '三代雷影']);
const lastYearAtStart = new Map([
  ['第三代风影', 47]
]);

const phaseRosters = [
  {
    start: 1, end: 10,
    names: ['千手柱间', '宇智波斑', '千手扉间', '漩涡水户', '猿飞日斩', '志村团藏', '水户门炎', '转寝小春', '宇智波镜', '秋道取风', '大野木', '千代', '角都']
  },
  {
    start: 11, end: 20,
    names: ['千手柱间', '宇智波斑', '千手扉间', '漩涡水户', '猿飞日斩', '志村团藏', '水户门炎', '转寝小春', '宇智波镜', '秋道取风', '金角', '银角', '大野木', '千代', '海老藏', '角都', '加藤断', '纲手', '旗木朔茂', '大蛇丸', '自来也', '迈特戴', '宇智波富岳']
  },
  {
    start: 21, end: 35,
    names: ['宇智波斑', '猿飞日斩', '志村团藏', '水户门炎', '转寝小春', '大野木', '千代', '海老藏', '角都', '山椒鱼半藏', '第三代风影', '纲手', '旗木朔茂', '大蛇丸', '自来也', '迈特戴', '宇智波富岳', '四代雷影艾', '日向日足', '日向日差', '罗砂', '宇智波美琴', '加瑠罗', '山中亥一', '秋道丁座', '奈良鹿久', '波风水门', '漩涡玖辛奈', '药师野乃宇', '弥彦', '长门', '小南', '奇拉比', '蝎']
  },
  {
    start: 36, end: 42,
    names: ['宇智波斑', '猿飞日斩', '志村团藏', '大野木', '千代', '山椒鱼半藏', '第三代风影', '三代雷影', '纲手', '旗木朔茂', '大蛇丸', '自来也', '迈特戴', '宇智波富岳', '四代雷影艾', '罗砂', '宇智波美琴', '加瑠罗', '山中亥一', '秋道丁座', '奈良鹿久', '波风水门', '漩涡玖辛奈', '药师野乃宇', '弥彦', '长门', '小南', '奇拉比', '蝎', '绳树', '加藤断', '夕日红', '猿飞阿斯玛', '静音', '迈特凯', '宇智波带土', '旗木卡卡西', '野原琳']
  },
  {
    start: 43, end: 49,
    names: ['宇智波斑', '猿飞日斩', '志村团藏', '大野木', '千代', '山椒鱼半藏', '第三代风影', '三代雷影', '纲手', '大蛇丸', '自来也', '迈特戴', '宇智波富岳', '四代雷影艾', '罗砂', '宇智波美琴', '山中亥一', '秋道丁座', '奈良鹿久', '波风水门', '漩涡玖辛奈', '药师野乃宇', '弥彦', '长门', '小南', '奇拉比', '蝎', '夕日红', '猿飞阿斯玛', '静音', '迈特凯', '宇智波带土', '旗木卡卡西', '野原琳', '照美冥', '桃地再不斩', '大和', '宇智波止水', '药师兜', '宇智波鼬', '手鞠', '迪达拉', '长十郎', '白', '堪九郎', '君麻吕', '重吾']
  }
];

const projectTransitions = new Map([
  [1, '木叶隐村在火之国成立；四大国忍族军事集团仍在筹建忍村，不能提前写成成熟四村。'],
  [2, '宇智波斑在本年离开木叶；砂、雾、岩、云在本项目中完成建村分配；年末至 K003 年初边界发生终结之谷决战（均为低置信项目纪年）。'],
  [3, 'K003 年初状态已经承接终结之谷决战结果：斑公开推定死亡、真实转入隐秘地下活动；泷隐在本年完成从形成期到活跃忍村的过渡。'],
  [11, '木叶学堂、暗部与宇智波警务部队开始形成；雨隐、草隐开始作为村级势力存在。'],
  [15, '木叶学堂发展为正式忍者学校。'],
  [17, '柱间于本年去世，扉间继任第二代火影；这是项目分配，不得在转折实际发生前用于 K017 年初状态。'],
  [18, '第一次忍界大战全面爆发，金角部队进入战时活动期。'],
  [20, '扉间在云隐追击战中牺牲，金角与银角死亡，金角部队终止；日斩随后继任第三代火影。'],
  [21, '根在本项目中开始作为木叶秘密组织活动；普通角色不自动知道其成员、据点或命令。'],
  [36, '绳树于本年死亡，五大村对雨之国及周边的军事压力升级。'],
  [37, '第二次忍界大战全面爆发，雨之国成为主要战区。'],
  [38, '涡潮隐村于本年遭毁灭（低置信项目分配）；转折前仍是活跃村，转折后只保留遗址与流亡者。'],
  [39, '半藏授予纲手、自来也、大蛇丸“木叶三忍”称号；自来也留在雨之国照顾三名孤儿。'],
  [40, '加藤断于本年死亡；纲手开始退出固定前线与村内岗位。'],
  [41, '玖辛奈绑架事件失败，水门将其救回；第二次忍界大战进入余波期。'],
  [42, '自来也结束约三年教导；弥彦、长门、小南开始筹建以和平为目标的初代晓。'],
  [43, '卡卡西从忍者学校毕业；初代晓进入雨之国和平组织阶段。'],
  [44, '卡卡西晋升中忍，迈特凯毕业；初代晓继续在雨之国扩展联络。'],
  [45, '旗木朔茂于本年死亡；团藏开始介入雨之国暗线，但弥彦仍在世，初代晓尚未瓦解。'],
  [46, '宇智波鼬于本年出生；雾隐忍刀七人众明确处于活动期。'],
  [47, '第三代风影公开失踪、真实已被蝎杀害并制成人傀儡；第三次忍界大战爆发。'],
  [48, '弥彦于本年遭半藏与团藏暗线围杀；初代晓瓦解，长门与小南转入地下。'],
  [49, '桔梗山相关战斗持续；迈特戴于本年开启八门掩护凯小队并死亡，当代忍刀七人众遭重创但组织未灭亡。']
]);

const fmtYear = year => `K${String(year).padStart(3, '0')}`;
const fmtBirthday = person => `${String(person.birth_month).padStart(2, '0')}-${String(person.birth_day).padStart(2, '0')}`;

function deathYearFor(name) {
  if (lifecycleOverrides.has(name)) return lifecycleOverrides.get(name).deathYear;
  return birthByName.get(name)?.death_year ?? null;
}

function isIncludedAtYearStart(name, year) {
  if (lastYearAtStart.has(name) && year > lastYearAtStart.get(name)) return false;
  if (unknownAgePeople.has(name)) return true;
  const person = birthByName.get(name);
  if (!person || person.birth_year > year) return false;
  const deathYear = deathYearFor(name);
  return deathYear === null || deathYear >= year;
}

function rosterFor(year) {
  const phase = phaseRosters.find(item => year >= item.start && year <= item.end);
  const names = (phase?.names || []).filter(name => isIncludedAtYearStart(name, year));
  return [...new Set(names)];
}

function buildSnapshotAge(sourceAge, year) {
  const name = sourceAge?.name || '未命名人物';
  const birthday = sourceAge?.birthday || null;
  if (sourceAge?.status === 'born_this_year') {
    if (sourceAge.age_at_year_start !== null || sourceAge.age_after_birthday !== 0 || !birthday) {
      throw new Error(`${fmtYear(year)}: ${name} 的出生年年龄字段无效`);
    }
    return { status: 'born_this_year', at_year_start: null, after_birthday: 0, birthday };
  }
  if (Number.isInteger(sourceAge?.age_at_year_start) && Number.isInteger(sourceAge?.age_after_birthday)) {
    if (sourceAge.age_after_birthday !== sourceAge.age_at_year_start + 1 || !birthday) {
      throw new Error(`${fmtYear(year)}: ${name} 的年度年龄边界无效`);
    }
    return {
      status: 'exact',
      at_year_start: sourceAge.age_at_year_start,
      after_birthday: sourceAge.age_after_birthday,
      birthday
    };
  }
  return { status: 'unknown', at_year_start: null, after_birthday: null, birthday: null };
}

function formatSnapshotAge(age) {
  if (age.status === 'unknown') return '年龄未冻结（只确认处于对应人物阶段）';
  if (age.status === 'born_this_year') return `年初尚未出生，本年 ${age.birthday} 出生`;
  return `年初${age.at_year_start}岁，本年生日后${age.after_birthday}岁（生日 ${age.birthday}）`;
}

const konohaCore = new Set([
  '千手柱间', '千手扉间', '漩涡水户', '猿飞日斩', '志村团藏', '水户门炎', '转寝小春', '宇智波镜', '秋道取风',
  '加藤断', '纲手', '旗木朔茂', '大蛇丸', '自来也', '迈特戴', '宇智波富岳', '日向日足', '日向日差', '宇智波美琴',
  '山中亥一', '秋道丁座', '奈良鹿久', '波风水门', '漩涡玖辛奈', '药师野乃宇', '夕日红', '猿飞阿斯玛', '静音',
  '迈特凯', '宇智波带土', '旗木卡卡西', '野原琳', '大和', '宇智波止水', '药师兜', '宇智波鼬'
]);
const sunaPeople = new Set(['千代', '海老藏', '第三代风影', '罗砂', '加瑠罗', '蝎', '手鞠', '堪九郎']);
const iwaPeople = new Set(['大野木', '迪达拉']);
const kumoPeople = new Set(['金角', '银角', '三代雷影', '四代雷影艾', '奇拉比']);
const kiriPeople = new Set(['照美冥', '桃地再不斩', '长十郎']);
const amePeople = new Set(['山椒鱼半藏', '弥彦', '长门', '小南']);
const senjuPeople = new Set(['千手柱间', '千手扉间', '纲手', '绳树']);
const uchihaPeople = new Set(['宇智波斑', '宇智波镜', '宇智波富岳', '宇智波美琴', '宇智波带土', '宇智波止水', '宇智波鼬']);
const hyugaPeople = new Set(['日向日足', '日向日差']);
const akatsukiFounders = new Set(['弥彦', '长门', '小南']);

function recordPeriodAt(record, date) {
  return (record?.periods || []).find(period => period.from <= date && (!period.until || date < period.until)) || null;
}

function organizationLabelAt(id, year) {
  const organization = organizationById.get(id);
  const period = recordPeriodAt(organization, `${fmtYear(year)}-01-01`);
  return period?.label || organization?.name || id;
}

function personLocation(name, year) {
  if (name === '宇智波斑') {
    if (year === 1) return '火之国·木叶筹建联盟驻地';
    if (year === 2) return '木叶隐村／火之国';
    return '公开无可确认位置';
  }
  if (name === '角都') return '泷之国势力圈与地下黑市路线（精确行踪不公开）';
  if (name === '漩涡玖辛奈' && year <= 34) return '涡潮隐村／涡之国';
  if (name === '自来也' && year >= 39 && year <= 42) return '木叶长期外勤（公开精确位置不明）';
  if (name === '自来也' && year >= 43) return '火之国与各国旅行、任务路线';
  if (name === '纲手' && year >= 41) return '火之国及各地医疗、旅行路线';
  if (['纲手', '大蛇丸', '自来也'].includes(name) && year >= 37 && year <= 40) return '雨之国二战前线';
  if (amePeople.has(name)) {
    if (akatsukiFounders.has(name) && year >= 43 && year <= 48) return '雨之国（具体移动据点不公开）';
    if (['长门', '小南'].includes(name) && year >= 49) return '雨之国（公开行踪不明）';
    return name === '山椒鱼半藏' ? '雨隐村／雨之国' : '雨之国民间活动区域';
  }
  if (name === '蝎' && year >= 47) return '风之国以外的叛忍流动路线（具体据点未知）';
  if (sunaPeople.has(name)) return year <= 2 ? '风之国忍族军事集团驻地' : '砂隐村／风之国';
  if (iwaPeople.has(name)) return year <= 2 ? '土之国忍族军事集团驻地' : '岩隐村／土之国';
  if (kumoPeople.has(name)) {
    if (year <= 2) return '雷之国忍族军事集团驻地';
    return year >= 18 && year <= 20 ? '云隐战时部队／一战战线' : '云隐村／雷之国';
  }
  if (kiriPeople.has(name)) {
    if (year <= 2) return '水之国忍族军事集团驻地';
    return year >= 47 ? '雾隐村及三战战线／水之国' : '雾隐村／水之国';
  }
  if (name === '白') return '水之国边境聚落';
  if (name === '君麻吕') return '水之国辉夜一族活动区';
  if (name === '重吾') return '北方边境聚落（精确地点未冻结）';
  if (konohaCore.has(name)) {
    if (year === 1) return '火之国·木叶筹建联盟驻地';
    if (name === '千手扉间' && year >= 18) return '木叶指挥体系及一战前线';
    if (name === '猿飞日斩' && (year >= 18 && year <= 20 || year >= 37)) return '木叶火影体系及战时指挥线';
    if (year >= 47 && ['波风水门', '迈特戴', '迈特凯', '宇智波带土', '旗木卡卡西', '野原琳'].includes(name)) return '木叶隐村及第三次忍界大战前线';
    return '木叶隐村／火之国';
  }
  return '所属势力主要活动区域（精确地点未冻结）';
}

function personLocationId(name, year) {
  if (name === '宇智波斑') return year <= 2 ? (year === 1 ? 'LOC-LAND-FIRE' : 'LOC-KONOHA-VILLAGE') : null;
  if (name === '角都') return 'LOC-LAND-WATERFALLS';
  if (name === '漩涡玖辛奈' && year <= 34) return 'LOC-UZUSHIO-VILLAGE';
  if ((name === '自来也' && year >= 39) || (name === '纲手' && year >= 41)) return null;
  if (['纲手', '大蛇丸', '自来也'].includes(name) && year >= 37 && year <= 40) return 'LOC-LAND-RAIN';
  if (amePeople.has(name)) return name === '山椒鱼半藏' ? 'LOC-AME-VILLAGE' : 'LOC-LAND-RAIN';
  if (name === '蝎' && year >= 47) return null;
  if (sunaPeople.has(name)) return year <= 2 ? 'LOC-LAND-WIND' : 'LOC-SUNA-VILLAGE';
  if (iwaPeople.has(name)) return year <= 2 ? 'LOC-LAND-EARTH' : 'LOC-IWA-VILLAGE';
  if (kumoPeople.has(name)) return year <= 2 ? 'LOC-LAND-LIGHTNING' : 'LOC-KUMO-VILLAGE';
  if (kiriPeople.has(name)) return year <= 2 ? 'LOC-LAND-WATER' : 'LOC-KIRI-VILLAGE';
  if (['白', '君麻吕'].includes(name)) return 'LOC-LAND-WATER';
  if (name === '重吾') return null;
  if (konohaCore.has(name)) return year === 1 ? 'LOC-LAND-FIRE' : 'LOC-KONOHA-VILLAGE';
  return null;
}

function publicOrganizationIds(name, year) {
  if (name === '宇智波斑' && year >= 3) return [];
  if (name === '漩涡玖辛奈' && year <= 34) return ['ORG-UZUSHIO', 'ORG-UZUMAKI'];
  if (akatsukiFounders.has(name)) return [];
  if (name === '山椒鱼半藏') return ['ORG-AME'];
  if (sunaPeople.has(name)) return name === '蝎' && year >= 47 ? [] : ['ORG-SUNA'];
  if (iwaPeople.has(name)) return ['ORG-IWA'];
  if (kumoPeople.has(name)) return ['ORG-KUMO'];
  if (kiriPeople.has(name)) return ['ORG-KIRI'];
  if (!konohaCore.has(name)) return [];
  const ids = ['ORG-KONOHA'];
  if (senjuPeople.has(name)) ids.push('ORG-SENJU');
  if (uchihaPeople.has(name)) ids.push('ORG-UCHIHA');
  if (hyugaPeople.has(name)) ids.push('ORG-HYUGA');
  if (['漩涡水户', '漩涡玖辛奈'].includes(name)) ids.push('ORG-UZUMAKI');
  return ids;
}

function publicAffiliation(name, year, organizationIds) {
  if (name === '宇智波斑' && year >= 3) return '无公开现役归属';
  if (akatsukiFounders.has(name)) return year >= 42
    ? '雨之国民间和平活动者（具体组织归属不公开）'
    : '雨之国民间孤儿小队';
  if (name === '角都') return '泷隐出身的地下赏金猎人（无冻结现役组织）';
  if (name === '蝎' && year >= 47) return '砂隐叛忍（公开行踪不明）';
  if (name === '白') return '水之国边境平民';
  if (name === '君麻吕') return '辉夜一族活动区居民';
  if (name === '重吾') return '北方边境居民（组织归属未冻结）';
  return organizationIds.map(id => organizationLabelAt(id, year)).join('／') || '无冻结组织归属';
}

function characterActualState(name, year) {
  if (name === '宇智波斑' && year >= 3) {
    return {
      visibility: 'secret',
      status: '存活',
      affiliation: '个人隐秘势力（组织结构未冻结）',
      organization_ids: [],
      location_id: 'LOC-MOUNTAINS-GRAVEYARD',
      location: '山岳墓场一带的隐秘地下据点'
    };
  }
  if (name === '志村团藏' && year >= 21) {
    return {
      visibility: 'secret',
      status: '存活并秘密指挥根',
      affiliation: organizationLabelAt('ORG-ROOT', year),
      organization_ids: ['ORG-KONOHA', 'ORG-ROOT'],
      location_id: 'LOC-KONOHA-VILLAGE',
      location: year >= 45 && year <= 48 ? '木叶根据地与雨之国秘密联络线' : '木叶地下秘密据点（具体坐标未冻结）'
    };
  }
  if (akatsukiFounders.has(name) && year >= 42) {
    return {
      visibility: year >= 49 ? 'secret' : 'restricted',
      status: '存活',
      affiliation: organizationLabelAt('ORG-AKATSUKI', year),
      organization_ids: ['ORG-AKATSUKI'],
      location_id: 'LOC-LAND-RAIN',
      location: year >= 49 ? '雨之国隐秘地下据点' : '雨之国移动／隐蔽据点'
    };
  }
  if (name === '自来也' && year >= 39 && year <= 42) {
    return {
      visibility: 'restricted',
      status: '存活并执行长期外勤',
      affiliation: '木叶隐村',
      organization_ids: ['ORG-KONOHA'],
      location_id: 'LOC-LAND-RAIN',
      location: '雨之国孤儿教导据点'
    };
  }
  if (['金角', '银角'].includes(name) && year >= 18 && year <= 20) {
    return {
      visibility: 'restricted',
      status: '存活并参与一战行动',
      affiliation: organizationLabelAt('ORG-KINKAKU', year),
      organization_ids: ['ORG-KUMO', 'ORG-KINKAKU'],
      location_id: 'LOC-KUMO-VILLAGE',
      location: '云隐战时部队与一战行动线（精确坐标不公开）'
    };
  }
  return undefined;
}

function characterTransitionThisYear(name, year, age, sourceStatus = 'alive') {
  if (age.status === 'born_this_year') return `本年 ${age.birthday} 出生；年初快照不把其视为已出生人物`;
  if (sourceStatus === 'dies_this_year') return '本年内死亡；年初快照仍按存活状态处理，只有实际剧情推进后才能结算死亡';
  return null;
}

function buildSnapshotCharacter(sourceAge, year) {
  const name = sourceAge.name;
  const entityId = sourceAge.entity_id || null;
  const age = buildSnapshotAge(sourceAge, year);
  const bornThisYear = age.status === 'born_this_year';
  const organizationIds = bornThisYear ? [] : publicOrganizationIds(name, year);
  const publicState = bornThisYear
    ? {
        status: '年初尚未出生',
        affiliation: '无（尚未出生）',
        organization_ids: [],
        location_id: null,
        location: '年初尚未出生；出生地点未冻结'
      }
    : {
        status: name === '宇智波斑' && year >= 3 ? '公开推定死亡' : '存活',
        affiliation: publicAffiliation(name, year, organizationIds),
        organization_ids: organizationIds,
        location_id: personLocationId(name, year),
        location: personLocation(name, year)
      };
  const actualState = bornThisYear ? undefined : characterActualState(name, year);
  return {
    entity_id: entityId,
    name,
    age,
    public_state: publicState,
    ...(actualState ? { actual_state: actualState } : {}),
    transition_this_year: characterTransitionThisYear(name, year, age, sourceAge.status)
  };
}

function groupCharacterLocations(characters, stateKey) {
  const groups = new Map();
  for (const character of characters) {
    const state = character[stateKey];
    if (!state?.location) continue;
    if (!groups.has(state.location)) groups.set(state.location, []);
    groups.get(state.location).push(character.name);
  }
  return [...groups].map(([location, people]) => `${location}：${people.join('、')}`).join('；');
}

const annualFactionIds = [
  'ORG-KONOHA', 'ORG-SUNA', 'ORG-KIRI', 'ORG-IWA', 'ORG-KUMO',
  'ORG-SENJU', 'ORG-UCHIHA', 'ORG-HYUGA', 'ORG-IRON',
  'ORG-UZUSHIO', 'ORG-UZUMAKI', 'ORG-TAKI', 'ORG-AME', 'ORG-KUSA',
  'ORG-KONOHA-ANBU', 'ORG-KONOHA-POLICE', 'ORG-KONOHA-ACADEMY',
  'ORG-ROOT', 'ORG-KINKAKU', 'ORG-AKATSUKI', 'ORG-KIRI-SWORDS'
];

function locationLabelAt(id, date) {
  const location = locationById.get(id);
  return recordPeriodAt(location, date)?.label || location?.name || id;
}

function factionTransitionThisYear(organization, period, year) {
  const nextDate = `${fmtYear(year + 1)}-01-01`;
  if (period.until !== nextDate) return null;
  if (organization.id === 'ORG-UZUSHIO') return '本年内遭毁灭；K039 年初起只保留遗址与分散流亡者，不再作为活跃忍村列入';
  if (organization.id === 'ORG-KINKAKU') return '本年内随金角、银角死亡而终止活动；K021 年初起不再列入';
  const nextPeriod = recordPeriodAt(organization, nextDate);
  if (!nextPeriod) return `本年内结束“${period.label}”阶段；下一年不再作为存续组织列入`;
  return `本年内由“${period.label}”转为“${nextPeriod.label}”；年初快照仍以当前阶段为准`;
}

function buildSnapshotFactions(year) {
  const date = `${fmtYear(year)}-01-01`;
  return annualFactionIds.flatMap(id => {
    const organization = organizationById.get(id);
    if (!organization) throw new Error(`${fmtYear(year)}: 缺少组织注册 ${id}`);
    const period = recordPeriodAt(organization, date);
    if (!period) return [];
    const locationId = period.location_ids?.[0] || null;
    const lifecycle = period.state === 'integrated' ? 'active' : period.state;
    const visibility = lifecycle === 'underground' ? 'secret' : organization.visibility;
    return [{
      organization_id: id,
      name: period.label || organization.name,
      lifecycle,
      location_id: locationId,
      location: locationId
        ? locationLabelAt(locationId, date)
        : (id === 'ORG-UZUMAKI' && lifecycle === 'diaspora' ? '各国分散（无统一驻地）' : '无统一固定驻地'),
      visibility,
      transition_this_year: factionTransitionThisYear(organization, period, year)
    }];
  });
}

function formatCharacterProjection(character) {
  let text = `${character.name}：${formatSnapshotAge(character.age)}`;
  if (character.name === '宇智波斑' && character.actual_state) {
    text += `；${character.public_state.status}，真实${character.actual_state.status}，此真相不向普通角色开放`;
  } else if (character.actual_state) {
    text += `；后台状态[${character.actual_state.visibility}]：${character.actual_state.status || '状态受限'}，${character.actual_state.affiliation || '归属受限'}`;
  }
  if (character.transition_this_year) text += `；${character.transition_this_year}`;
  return text;
}

function formatFactionProjection(faction) {
  const visibility = faction.visibility === 'public' ? '' : `，${faction.visibility === 'secret' ? '秘密' : '受限'}知识`;
  return `${faction.name}（${faction.lifecycle}${visibility}）`;
}

function formatFactionBases(factions) {
  return factions.map(faction => `${faction.name}—${faction.location}`).join('；');
}

function arcFor(year) {
  if (year <= 10) return 'FOUNDING-ERA';
  if (year <= 20) return 'FIRST-WAR';
  if (year <= 35) return 'INTERWAR';
  if (year <= 42) return 'SECOND-WAR';
  if (year <= 46) return 'THIRD-WAR-PRELUDE';
  if (year <= 50) return 'THIRD-WAR';
  if (year <= 63) return 'NINE-TAILS-AFTERMATH';
  if (year === 64) return 'PART-ONE';
  if (year <= 68) return 'PART-TWO';
  if (year <= 82) return 'POSTWAR';
  return 'BORUTO-ERA';
}

function buildAnnualDay(almanac) {
  const year = Number(String(almanac.year).slice(1));
  const yearCode = String(year).padStart(3, '0');
  const yearLabel = fmtYear(year);
  const characters = almanac.character_ages.map(sourceAge => buildSnapshotCharacter(sourceAge, year));
  const names = characters.map(character => character.name);
  const factions = buildSnapshotFactions(year);
  const transitions = [...almanac.annual_events];
  const transition = transitions.join('；');
  const yearSnapshot = {
    as_of: `${yearLabel}-01-01`,
    kind: 'year_start',
    date_basis: almanac.date_basis,
    confidence: 'mixed',
    characters,
    factions,
    transitions_this_year: transitions
  };
  const ageSummary = characters.map(formatCharacterProjection).join('；');
  const factionSummary = factions.map(formatFactionProjection).join('、');
  const publicLocations = groupCharacterLocations(characters, 'public_state');
  const backstageLocations = groupCharacterLocations(characters, 'actual_state');
  const sceneRecord = scene(
    `ANNUAL-${yearCode}-SNAPSHOT`,
    `${yearLabel} 年初人物、势力与位置档案`,
    'ANNUAL-FOUNDATIONS',
    '多地点年度档案：五大国、小国与隐秘据点',
    names,
    'offscreen',
    `这是 ${yearLabel}-01-01 的年初档案快照，不是当天突然发生的事件。年龄以年初为准；除明确标注“年初已承接”的边界事实外，“本年转折”在实际推进到对应剧情前仍未发生。`,
    [
      beat(`人物年龄（${yearLabel}-01-01 年初）：${ageSummary}。年度人物名单与年龄只投影自 ${almanac.year} 源文件；未列人物不得凭模型常识补年龄。宇智波泉奈建村前已故，不列入 K001-K086 存活人物年龄表。`, 'setup'),
      beat(`势力（${yearLabel} 年初仍存在或正在形成）：${factionSummary}。年度边界与本年计划转折（只有明确写明年初已承接的事实已经成立，其余尚未发生前不得视为既成事实）：${transition}`, 'pressure'),
      beat(`位置/驻地（年度主要据点或活动区域，不是每日固定坐标）：势力驻地：${formatFactionBases(factions)}。人物公开活动区域：${publicLocations}。后台真实位置（只供叙事一致性，普通角色不可知）：${backstageLocations || '无额外记录'}。`, 'resolution')
    ],
    ['AI 可直接用本快照校验人物是否已出生、年初年龄、所属时代势力与大致活动区域。', '未知年龄和精确地点保持未知，不用数据库常识擅自补齐。'],
    ['本档案自身不推进日期、不结算死亡、不迁移人物；只有实际发生的玩家分支或后续剧情节点才能改写状态。'],
    `${yearLabel} 的年龄、势力与位置基准已提供；检索完成后停止，不把年度档案表演成剧情场景。`,
    '先提供稳定、可检索的年度骨架，严格区分年初状态、年内计划转折、公开知识和隐藏真实状态；后续可逐年补充事件而不破坏年龄与势力边界。',
    {
      requirements: [`需要校验 ${yearLabel} 的人物年龄、势力存续或大致位置。`, '存档没有在本年开始前以明确分支记录覆盖对应基准。'],
      blockers: [`存档已在 ${yearLabel}-01-01 前明确记录相关人物死亡、势力解体、阵营变化或长期迁移。`, '查询要求普通角色获得斑、蝎或晓等只属于隐藏档案的真实位置。'],
      fallbacks: [{
        condition: '玩家分支已改变基准状态，或查询者没有权限知道隐藏真实状态。',
        status: 'altered',
        direction: '保留未被改变的年龄与时代边界；人物状态、势力归属和位置改用存档实际记录，隐藏事实只留在叙事后台。',
        preserves: '保留出生顺序、年龄计算、知识隔离与分支优先原则。'
      }],
      sources: [
        { kind: 'databook', reference: 'NARUTO 官方角色生日资料', contribution: '提供已知人物生日的月日边界' },
        { kind: 'original', reference: `Naruto RPG 年度源 canon/timeline/yearly/${almanac.year}.json`, contribution: '作为本年度人物名单、年龄边界与年度事件的唯一来源；势力与宽粒度位置按注册表在同一日期投影' }
      ],
      referenceFacts: [
        '年龄规则：出生当年年初尚未出生；其余年份为当前年减出生年再减一，生日后加一。',
        '年龄未冻结与精确位置未知必须保持未知；不得伪造数字或坐标。',
        '省略某个组织不自动证明其不存在；本快照只列当年最重要且已冻结的势力。'
      ]
    }
  );
  const dayRecord = day(
    `ANNUAL-${yearCode}`,
    `${yearLabel}-01-01`,
    `${yearLabel} 年初档案快照`,
    arcFor(year),
    '向 AI 提供本年关键人物年龄、仍存在的势力及人物与组织的大致位置，不强制触发剧情。',
    [`当前基准时点为 ${yearLabel}-01-01。`, '本年生日、死亡、继任、战争爆发与组织转型尚未因年初档案自动发生。'],
    [sceneRecord],
    ['年度档案已完成检索，存档状态未被自动改写。', '后续剧情必须从实际当前日期、已发生节点和玩家分支继续。'],
    `这是一条年初状态边界，不消耗游戏时间；进入 ${yearLabel} 后的具体日期时，再按已发生事件更新人物、势力与位置。`,
    [`${yearLabel} 采用 project_allocation 项目纪年；原著未明示的绝对年份不伪装成官方日期。`, '本年转折必须在实际剧情发生后才能写入已发生状态。']
  );
  dayRecord.year_snapshot = yearSnapshot;
  return dayRecord;
}

const days = yearlyAlmanacs.map(buildAnnualDay);

export default defineTimelineShard({
  namespace: 'HIST',
  code: 'ANNUAL-FOUNDATIONS',
  arcCodes: [
    'FOUNDING-ERA', 'FIRST-WAR', 'INTERWAR', 'SECOND-WAR', 'THIRD-WAR-PRELUDE', 'THIRD-WAR',
    'NINE-TAILS-AFTERMATH', 'PART-ONE', 'PART-TWO', 'POSTWAR', 'BORUTO-ERA'
  ],
  dateStart: 'K001-01-01',
  dateEnd: 'K086-01-01',
  days
});
