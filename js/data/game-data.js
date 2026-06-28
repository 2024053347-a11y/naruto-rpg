export const GAME_DATA = {
  difficulties: {
    '忍者学校': {
      id: '忍者学校', label: '轻松', points: 60, exp_multiplier: 1.5,
      enemy_modifier: 0.7, description: '轻松的忍者冒险，适合新手'
    },
    '下忍': {
      id: '下忍', label: '普通', points: 50, exp_multiplier: 1.0,
      enemy_modifier: 1.0, description: '均衡的游戏体验 (推荐)'
    },
    '中忍': {
      id: '中忍', label: '困难', points: 40, exp_multiplier: 0.85,
      enemy_modifier: 1.2, description: '具有挑战性的忍者之路'
    },
    '上忍': {
      id: '上忍', label: '极难', points: 30, exp_multiplier: 0.7,
      enemy_modifier: 1.5, description: '残酷的忍者世界，步步为营'
    },
    '影': {
      id: '影', label: '传说', points: 20, exp_multiplier: 0.5,
      enemy_modifier: 2.0, description: '只有最强者才能生存'
    }
  },

  attributes: {
    chakra: { name: '查克拉量', icon: 'chakra', desc: '忍术威力、查克拉上限、学习速度', color: '#42A5F5' },
    spirit: { name: '精神力', icon: 'spirit', desc: '幻术抗性、感知能力、意志检定', color: '#CE93D8' },
    willpower: { name: '意志力', icon: 'willpower', desc: '体术威力、HP上限、异常抵抗', color: '#eb613f' },
    speed: { name: '速度', icon: 'speed', desc: '先手概率、闪避率、行动顺序', color: '#81C784' },
    luck: { name: '幸运', icon: 'luck', desc: '暴击率、掉落品质、随机事件', color: '#ef5350' }
  },

  balance: {
    baseAttributeRange: [5, 20],
    chakraMultiplier: 1,
    spiritMultiplier: 1,
    willpowerMultiplier: 1,
    staminaBase: 20,
    staminaMultiplier: 2,
    speedMultiplier: 1,
    startingLuckMultiplier: 1,
    resourceGrowthStep: 2,
    masteryGrowth: { minor: 3, normal: 5, focused: 8, breakthrough: 12 },
    expReward: { training: [10, 30], d: [30, 80], c: [80, 180], b: [180, 400], a: [400, 900], s: [900, 1800] }
  },

  rankBenchmarks: {
    '忍校学生': { chakra: [20, 80], stamina: [80, 180], speed: [15, 45], skillMastery: [0, 35] },
    '下忍': { chakra: [40, 160], stamina: [120, 260], speed: [25, 75], skillMastery: [20, 60] },
    '中忍': { chakra: [80, 300], stamina: [180, 380], speed: [45, 110], skillMastery: [45, 75] },
    '特别上忍': { chakra: [120, 420], stamina: [220, 480], speed: [65, 140], skillMastery: [70, 90] },
    '上忍': { chakra: [180, 650], stamina: [280, 650], speed: [85, 180], skillMastery: [80, 100] },
    '精英上忍': { chakra: [320, 1000], stamina: [420, 900], speed: [120, 240], skillMastery: [90, 100] },
    '影级': { chakra: [600, 2500], stamina: [650, 1400], speed: [160, 320], skillMastery: [95, 100] }
  },

  talents: {
    '查克拉天才': {
      id: '查克拉天才', description: '查克拉恢复+25%，初始掌握C级忍术',
      statBonus: { chakra: 3 },
      effects: { chakra_regen: 0.25, initial_jutsu_rank: 'C' }
    },
    '努力的天才': {
      id: '努力的天才', description: '经验获取+20%，全属性成长+10%',
      statBonus: { willpower: 3 },
      effects: { exp_boost: 0.2, growth_boost: 0.1 }
    },
    '血继限界继承者': {
      id: '血继限界继承者', description: '初始拥有冰遁/灼遁等血继',
      statBonus: { spirit: 3 },
      effects: { kekkei_genkai: true }
    },
    '体术专家': {
      id: '体术专家', description: '体术伤害+25%，连击概率+15%',
      statBonus: { willpower: 2, speed: 1 },
      effects: { taijutsu_damage: 0.25, combo_chance: 0.15 }
    },
    '幻术天赋': {
      id: '幻术天赋', description: '幻术成功率+30%，抵抗幻术+20%',
      statBonus: { spirit: 2, chakra: 1 },
      effects: { genjutsu_success: 0.3, genjutsu_resist: 0.2 }
    },
    '医疗忍者': {
      id: '医疗忍者', description: '治疗效率+40%，毒素抗性+50%',
      statBonus: { chakra: 2, spirit: 1 },
      effects: { heal_boost: 0.4, poison_resist: 0.5 }
    },
    '暗部之姿': {
      id: '暗部之姿', description: '潜行+30%，先手+20%，暗器伤害+15%',
      statBonus: { speed: 3 },
      effects: { stealth: 0.3, initiative: 0.2, projectile_damage: 0.15 }
    }
  },

  backgrounds: {
    '木叶忍者家族': {
      id: '木叶忍者家族', description: '出身于木叶的忍者家族',
      equipment: { tools: { '家族苦无': { quantity: 1, quality: '精良' } }, consumables: { '兵粮丸': { quantity: 3, quality: '普通' } } },
      location: '家族宅邸',
      relationships: { '木叶隐村': 10 }
    },
    '平民出身': {
      id: '平民出身', description: '普通平民家庭出身',
      equipment: { tools: { '苦无': { quantity: 3, quality: '普通' }, '手里剑': { quantity: 5, quality: '普通' } } },
      location: '木叶公寓',
      relationships: {}
    },
    '孤儿': {
      id: '孤儿', description: '在孤儿院长大',
      equipment: { tools: { '破旧的忍者手册': { quantity: 1, quality: '破旧' } } },
      ryo: 100,
      location: '木叶孤儿院',
      statBonus: { willpower: 2 },
      relationships: {}
    },
    '外村移民': {
      id: '外村移民', description: '从其他忍村迁移而来',
      equipment: { tools: { '异国苦无': { quantity: 2, quality: '精良' } } },
      location: '木叶边境',
      relationships: {}
    },
    '暗部遗孤': {
      id: '暗部遗孤', description: '父母曾是暗部成员',
      equipment: { tools: { '暗部遗物': { quantity: 1, quality: '稀有' } } },
      location: '暗部秘密安全屋',
      relationships: {}
    },
    '血继家族': {
      id: '血继家族', description: '拥有血继限界的家族',
      equipment: { consumables: { '血继觉醒石': { quantity: 1, quality: '传说' } } },
      location: '家族禁地',
      relationships: {}
    },
    '流浪忍者': {
      id: '流浪忍者', description: '四处流浪的忍者',
      equipment: { tools: { '旅行斗笠': { quantity: 1, quality: '普通' }, '苦无': { quantity: 5, quality: '普通' }, '手里剑': { quantity: 8, quality: '普通' } } },
      location: '木叶大门',
      relationships: {}
    }
  },

  chakraNatures: {
    '火': { id: '火', name: '火遁', emoji: 'fire', element: '火' },
    '风': { id: '风', name: '风遁', emoji: 'wind', element: '风' },
    '雷': { id: '雷', name: '雷遁', emoji: 'lightning', element: '雷' },
    '土': { id: '土', name: '土遁', emoji: 'earth', element: '土' },
    '水': { id: '水', name: '水遁', emoji: 'water', element: '水' },
    '阴': { id: '阴', name: '阴遁', emoji: 'yin', element: '阴' },
    '阳': { id: '阳', name: '阳遁', emoji: 'yang', element: '阳' },
    '冰遁': { id: '冰遁', name: '冰遁', emoji: 'ice', element: '水', secondElement: '风', isKekkeiGenkai: true },
    '灼遁': { id: '灼遁', name: '灼遁', emoji: 'fire', element: '火', secondElement: '风', isKekkeiGenkai: true }
  },

    timelinePresets: {
    'konoha_01': {
      id: 'konoha_01',
      label: '木叶1年 · 忍村创立',
      year: 1,
      season: '春',
      description: '千手柱间与宇智波斑联手创立木叶隐村。忍界尚处战国时代尾声，一国一村制度刚刚起步。适合体验初代火影时代、尾兽分配谈判、宇智波一族暗流。',
      era_summary: '木叶隐村刚成立，千手柱间为初代火影。忍界大战尚未爆发，各国效仿火之国建立忍村。尾兽作为"平衡力量"被柱间分配各国。宇智波斑与柱间理念冲突即将公开化。'
    },
    'konoha_20': {
      id: 'konoha_20',
      label: '木叶20年 · 第一次忍界大战',
      year: 20,
      season: '秋',
      description: '初代火影已故，千手扉间继任二代火影。第一次忍界大战爆发，各国间矛盾激化。适合体验战争年代的忍者生活、二代火影时代的禁术研发。',
      era_summary: '千手扉间为二代火影，创立忍者学校、暗部、中忍考试制度。第一次忍界大战中，云隐金角银角袭击火影。扉间在撤退中断后牺牲，临死前任命猿飞日斩为三代火影。'
    },
    'konoha_39': {
      id: 'konoha_39',
      label: '木叶39年 · 第二次忍界大战',
      year: 39,
      season: '夏',
      description: '猿飞日斩正值壮年，三忍尚未成名前。第二次忍界大战主要在雨隐、风之国、铁之国边境展开。适合体验三忍年轻时代、雨隐悲剧序幕。',
      era_summary: '第二次忍界大战期间，木叶三忍（自来也、纲手、大蛇丸）在雨隐战场初露锋芒，被山椒鱼半藏赐予"三忍"称号。自来也收留长门、弥彦、小南。旗木朔茂（白牙）声望渐起。'
    },
    'konoha_45': {
      id: 'konoha_45',
      label: '木叶45年 · 二战末至三战前',
      year: 45,
      season: '春',
      description: '第二次忍界大战结束，五大国进入相对平静期。三忍已成木叶支柱。适合体验战后重建、忍者晋升、暗部任务和家族政治。',
      era_summary: '战争刚结束，木叶尝试恢复元气。三忍声望高涨但纲手因断和绳树之死逐渐消沉。旗木朔茂完成关键任务。波风水门崭露头角。各国暗流涌动，第三次忍界大战的种子已经埋下。'
    },
    'konoha_52': {
      id: 'konoha_52',
      label: '木叶52年 · 九尾之乱后',
      year: 52,
      season: '春',
      description: '第三次忍界大战结束、九尾之乱约一年后。四代火影已牺牲，三代复任。鸣人/佐助约1岁。适合从小忍者开始、见证木叶重建。项目默认开局。',
      era_summary: '第三次忍界大战与九尾之乱后，三代火影复任。四代波风水门与漩涡玖辛奈已牺牲。鸣人作为九尾人柱力被村民忌讳；佐助在宇智波族地成长，灭族仍是未来伏笔。卡卡西在暗部服役。大蛇丸已叛逃。晓在地下活动但未公开捕捉尾兽。'
    },
    'konoha_59': {
      id: 'konoha_59',
      label: '木叶59年 · 灭族前夕',
      year: 59,
      season: '秋',
      description: '鸣人/佐助约8岁，忍校时期。宇智波政变暗流涌动，灭族事件即将发生。适合体验忍校生活、暗部行动、家族政治暗线。',
      era_summary: '鸣人/佐助约8岁，在忍者学校就读。宇智波一族与木叶高层矛盾尖锐，政变准备和监视同步升级.鼬作为暗部成员收集情报。大蛇丸在三忍之战中被击败后转入地下研究。晓缓慢壮大但尚未公开捕捉尾兽。'
    },
    'konoha_64': {
      id: 'konoha_64',
      label: '木叶64年 · 原作第一部',
      year: 64,
      season: '春',
      description: '鸣人/佐助毕业分班，第七班成立。波之国、中忍考试、木叶毁灭计划将依次展开。适合在经典剧情中扮演原创角色。',
      era_summary: '鸣人偷窃封印卷轴后毕业，与佐助、小樱编入第七班，导师为卡卡西。波之国任务、中忍考试、大蛇丸木叶毁灭计划依次发生。三代火影牺牲。鼬和鬼鲛潜入木叶。纲手尚未继任火影。晓开始更公开地活动。'
    },
    'konoha_67': {
      id: 'konoha_67',
      label: '木叶67年 · 疾风传',
      year: 67,
      season: '秋',
      description: '鸣人修行归来，纲手为五代火影。晓开始捕捉尾兽。适合体验忍界大战阴影下的任务和冒险。',
      era_summary: '纲手为五代火影。我爱罗就任五代风影后被晓抽取守鹤。角都、飞段等晓成员活跃。自来也潜入雨隐调查佩恩。鼬与佐助的宿命对决即将到来。五影会谈在即。第四次忍界大战的威胁日益逼近。'
    },
    'konoha_72': {
      id: 'konoha_72',
      label: '木叶72年 · 战后新时代',
      year: 72,
      season: '春',
      description: '第四次忍界大战结束，五影联合执政。科技发展（科学忍具、雷车）、和平时代下的新任务。适合体验战后世界。',
      era_summary: '第四次忍界大战结束数年，卡卡西（或鸣人已接任七代）领导木叶。五影联合执政，科技迅速发展。科学忍具出现。尾兽获得自由。大筒木一族威胁作为远期伏笔。忍者社会面临"和平年代是否还需要忍者"的反思。'
    },
    '__custom_timeline__': {
      id: '__custom_timeline__',
      label: '自定义年代',
      year: null,
      season: '春',
      description: '由你输入任意木叶纪年，AI 会根据所选年代自动判断人物年龄、组织状态和事件进度。',
      era_summary: '玩家自定义年代，AI 会根据输入的年份动态判断人物出生状态、组织公开程度、事件是否已发生。'
    }
  },

  getDifficulty(id) {
    return this.difficulties[id] || this.difficulties['下忍'];
  },

  getTalent(id) {
    return this.talents[id];
  },

  getBackground(id) {
    return this.backgrounds[id] || this.backgrounds['平民出身'];
  },

  getChakraNature(id) {
    return this.chakraNatures[id];
  },

  getTimelinePreset(id) {
    return this.timelinePresets[id] || this.timelinePresets['konoha_48'];
  },

  buildInitialAttributes(baseAttrs = {}, statBonus = {}) {
    const get = (key) => Math.max(5, (baseAttrs[key] || 5) + (statBonus[key] || 0));
    const chakraBase = get('chakra');
    const spiritBase = get('spirit');
    const willBase = get('willpower');
    const speedBase = get('speed');
    const luckBase = get('luck');
    const chakra = chakraBase * this.balance.chakraMultiplier;
    const spirit = spiritBase * this.balance.spiritMultiplier;
    const willpower = willBase * this.balance.willpowerMultiplier;
    const stamina = this.balance.staminaBase + willBase * this.balance.staminaMultiplier;
    return {
      chakra, chakra_current: chakra,
      spirit, spirit_current: spirit,
      willpower, willpower_current: willpower,
      speed: speedBase * this.balance.speedMultiplier,
      luck: luckBase * this.balance.startingLuckMultiplier,
      stamina, stamina_current: stamina
    };
  },

  getRankBenchmark(rank = '下忍') {
    return this.rankBenchmarks[rank] || this.rankBenchmarks['下忍'];
  }

};

export const MASTERY_TIERS = {
  0: { name: '未掌握', power_multiplier: 0.5, cost_multiplier: 2.0 },
  20: { name: '入门', power_multiplier: 0.7, cost_multiplier: 1.5 },
  40: { name: '熟练', power_multiplier: 0.85, cost_multiplier: 1.2 },
  60: { name: '精通', power_multiplier: 1.0, cost_multiplier: 1.0 },
  80: { name: '专家', power_multiplier: 1.15, cost_multiplier: 0.9 },
  100: { name: '大师', power_multiplier: 1.3, cost_multiplier: 0.8 }
};

export function getMasteryTier(mastery) {
  const thresholds = Object.keys(MASTERY_TIERS).map(Number).sort((a, b) => b - a);
  for (const threshold of thresholds) {
    if (mastery >= threshold) return MASTERY_TIERS[threshold];
  }
  return MASTERY_TIERS[0];
}

export { GAME_DATA as default };
