export const COMBAT_PLAYER_ACTIONS = Object.freeze({
  taijutsu: Object.freeze({ label: '体术攻击', message: '我使用体术向敌人发起近身攻击！' }),
  ninjutsu: Object.freeze({ label: '忍术攻击', message: '我准备使用忍术攻击敌人。' }),
  item: Object.freeze({ label: '使用道具', message: '我从忍具袋中取出道具。' }),
  defend: Object.freeze({ label: '防御', message: '我摆出防御态势，准备格挡下一次攻击。' }),
  retreat: Object.freeze({ label: '撤退', message: '我决定暂时撤退，寻找有利时机。' })
});

const ACTION_BY_LABEL = new Map(
  Object.entries(COMBAT_PLAYER_ACTIONS).map(([action, definition]) => [definition.label, action])
);

export function normalizeCombatPlayerAction(value) {
  const input = String(value || '').trim();
  if (Object.prototype.hasOwnProperty.call(COMBAT_PLAYER_ACTIONS, input)) return input;
  return ACTION_BY_LABEL.get(input) || '';
}

export function combatPlayerActionDefinition(value) {
  const action = normalizeCombatPlayerAction(value);
  return action ? { action, ...COMBAT_PLAYER_ACTIONS[action] } : null;
}

export function buildCombatPlayerActionMessage(value) {
  return combatPlayerActionDefinition(value)?.message || '';
}
