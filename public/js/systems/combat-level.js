const ATTRIBUTE_WEIGHTS = Object.freeze({
  chakra: 0.08,
  vitality: 0.08,
  stamina: 0.08,
  spirit: 0.08,
  speed: 0.06,
  luck: 0.02
});

const MASTERY_KEYS = Object.freeze(['ninjutsu', 'taijutsu', 'genjutsu']);
// 基础掌握度已反映在六项属性中，只让超过入门线的实战造诣提供额外战力。
const MASTERY_BASELINE = 20;
const MASTERY_WEIGHT = 0.3;

const COMBAT_LEVEL_THRESHOLDS = Object.freeze([
  { level: '超S级', score: 350 },
  { level: 'S级', score: 250 },
  { level: 'A级', score: 150 },
  { level: 'B级', score: 80 },
  { level: 'C级', score: 50 },
  { level: 'D级', score: 35 },
  { level: 'E级', score: 0 }
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampMastery(value) {
  const number = finiteNumber(value);
  return number === null ? 0 : Math.max(0, Math.min(100, number));
}

function firstNumber(source, keys) {
  if (!source || typeof source !== 'object') return 0;
  for (const key of keys) {
    if (source[key] === undefined || source[key] === null || source[key] === '') continue;
    const value = finiteNumber(source[key]);
    if (value !== null) return value;
  }
  return 0;
}

function combatCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.includes('支援') || raw.includes('辅助') || raw === 'support') return null;
  if (raw.includes('体术') || raw === 'taijutsu') return 'taijutsu';
  if (raw.includes('幻术') || raw === 'genjutsu') return 'genjutsu';
  if (raw.includes('忍术') || raw === 'jutsu' || raw === 'ninjutsu') return 'ninjutsu';
  return null;
}

function mergeMastery(target, category, value) {
  if (!category) return;
  target[category] = Math.max(target[category] || 0, clampMastery(value));
}

export function normalizeCombatMasteries(masteries = {}) {
  return {
    ninjutsu: clampMastery(firstNumber(masteries, ['ninjutsu', 'jutsu', 'ninjutsu_mastery', 'jutsu_mastery', '忍术造诣', '忍术', '进度·忍术熟练度'])),
    taijutsu: clampMastery(firstNumber(masteries, ['taijutsu', 'taijutsu_mastery', '体术造诣', '体术', '进度·体术熟练度'])),
    genjutsu: clampMastery(firstNumber(masteries, ['genjutsu', 'genjutsu_mastery', '幻术造诣', '幻术', '进度·幻术熟练度']))
  };
}

export function combatMasteriesFromAbilities(abilities = []) {
  const masteries = normalizeCombatMasteries();
  for (const ability of Array.isArray(abilities) ? abilities : []) {
    if (!ability || typeof ability !== 'object') continue;
    mergeMastery(masteries, combatCategory(ability.type ?? ability.类型), ability.mastery ?? ability.熟练度);
  }
  return masteries;
}

export function combatMasteriesFromPlayerState(state = {}) {
  const masteries = normalizeCombatMasteries({
    ninjutsu: state['进度·忍术熟练度'] ?? state.progression?.jutsu_mastery,
    taijutsu: state['进度·体术熟练度'] ?? state.progression?.taijutsu_mastery,
    genjutsu: state['进度·幻术熟练度'] ?? state.progression?.genjutsu_mastery
  });

  for (const [key, value] of Object.entries(state || {})) {
    if (!key.startsWith('技能·')) continue;
    const parts = key.split('·');
    const category = combatCategory(parts[1]);
    if (!category) continue;
    if (parts.at(-1) === '熟练度') mergeMastery(masteries, category, value);
    else if (value && typeof value === 'object') mergeMastery(masteries, category, value.mastery ?? value.熟练度);
  }

  const nestedGroups = [
    ['ninjutsu', state.skills?.jutsu],
    ['taijutsu', state.skills?.taijutsu],
    ['genjutsu', state.skills?.genjutsu]
  ];
  for (const [category, group] of nestedGroups) {
    for (const ability of Object.values(group || {})) {
      if (ability && typeof ability === 'object') mergeMastery(masteries, category, ability.mastery ?? ability.熟练度);
    }
  }
  return masteries;
}

export function combatMasteriesFromNpcCard(card = {}) {
  const masteries = normalizeCombatMasteries(card);
  const techniques = [
    ...(Array.isArray(card.忍术) ? card.忍术 : []),
    ...(Array.isArray(card.jutsu) ? card.jutsu : []),
    ...(Array.isArray(card.体术) ? card.体术 : []),
    ...(Array.isArray(card.taijutsu) ? card.taijutsu : []),
    ...(Array.isArray(card.幻术) ? card.幻术 : []),
    ...(Array.isArray(card.genjutsu) ? card.genjutsu : [])
  ];
  for (const technique of techniques) {
    if (!technique || typeof technique !== 'object') continue;
    mergeMastery(masteries, combatCategory(technique.类型 ?? technique.type), technique.熟练度 ?? technique.mastery);
  }
  return masteries;
}

export function combatAttributesFromPlayerState(state = {}) {
  return {
    chakra: state['属性·查克拉'] ?? state.attributes?.chakra,
    vitality: state['属性·生命力'] ?? state.attributes?.vitality,
    stamina: state['属性·体力'] ?? state.attributes?.stamina,
    spirit: state['属性·精神力'] ?? state.attributes?.spirit,
    speed: state['属性·速度'] ?? state.attributes?.speed,
    luck: state['属性·幸运'] ?? state.attributes?.luck
  };
}

export function combatAttributesFromNpcCard(card = {}) {
  return {
    chakra: card.查克拉上限 ?? card.chakra_max ?? card.chakra,
    vitality: card.生命力上限 ?? card.vitality_max ?? card.vitality,
    stamina: card.体力上限 ?? card.stamina_max ?? card.stamina,
    spirit: card.精神力上限 ?? card.spirit_max ?? card.spirit,
    speed: card.速度 ?? card.speed,
    luck: card.幸运 ?? card.luck
  };
}

export function calculateAttributeCombatScore(attributes = {}) {
  return Object.entries(ATTRIBUTE_WEIGHTS).reduce((score, [key, weight]) => {
    const value = Number(attributes[key]);
    return score + (Number.isFinite(value) ? Math.max(0, value) * weight : 0);
  }, 0);
}

export function calculateMasteryCombatBonus(masteries = {}) {
  const normalized = normalizeCombatMasteries(masteries);
  return MASTERY_KEYS.reduce((score, key) => (
    score + Math.max(0, normalized[key] - MASTERY_BASELINE) * MASTERY_WEIGHT
  ), 0);
}

export function calculateCombatScore(attributes = {}, masteries = {}) {
  return calculateAttributeCombatScore(attributes) + calculateMasteryCombatBonus(masteries);
}

export function calculateCombatAssessment(attributes = {}, masteries = {}) {
  const attributeScore = calculateAttributeCombatScore(attributes);
  const masteryBonus = calculateMasteryCombatBonus(masteries);
  const score = attributeScore + masteryBonus;
  const level = COMBAT_LEVEL_THRESHOLDS.find(tier => score >= tier.score)?.level || 'E级';
  return {
    level,
    score,
    roundedScore: Math.round(score),
    attributeScore,
    masteryBonus,
    masteries: normalizeCombatMasteries(masteries)
  };
}

export function calculateCombatLevel(attributes = {}, masteries = {}) {
  const score = calculateCombatScore(attributes, masteries);
  return COMBAT_LEVEL_THRESHOLDS.find(tier => score >= tier.score)?.level || 'E级';
}
