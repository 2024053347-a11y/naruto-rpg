export const MISSION_STATUSES = Object.freeze([
  'active', 'progress', 'completed', 'failed', 'abandoned'
]);

export function normalizeMissionStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'accepted' || value === 'in_progress') return 'active';
  return value;
}

export const PROJECT_TIMELINE_EVENT_STATUSES = Object.freeze([
  'occurred', 'altered', 'skipped', 'postponed'
]);

export const ORDINARY_EVENT_STATUSES = Object.freeze([
  'triggered', 'occurred', 'altered', 'skipped', 'postponed',
  'completed', 'resolved', 'ended', 'failed', 'cancelled'
]);

export const FINAL_EVENT_STATUSES = Object.freeze([
  'completed', 'resolved', 'ended', 'failed', 'cancelled'
]);

const PROJECT_TIMELINE_ID_PATTERN = /^(?:DAY|SCN|EV)-(?:HIST|P1|P2|BOR)-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function isProjectTimelineEventId(id) {
  return PROJECT_TIMELINE_ID_PATTERN.test(String(id || '').trim());
}

export function eventStatusIsAllowed(id, status) {
  const normalized = String(status || '').trim().toLowerCase();
  const allowed = isProjectTimelineEventId(id)
    ? PROJECT_TIMELINE_EVENT_STATUSES
    : ORDINARY_EVENT_STATUSES;
  return allowed.includes(normalized);
}

export const COMBAT_STATES = Object.freeze([
  'start', 'round_start', 'player_turn', 'enemy_turn',
  'in_progress', 'victory', 'defeat', 'retreat'
]);

export const COMBAT_ACTION_STATES = Object.freeze([
  'round_start', 'player_turn', 'enemy_turn'
]);

export const COMBAT_END_STATES = Object.freeze([
  'victory', 'defeat', 'retreat'
]);

const COMBAT_STATE_ALIASES = Object.freeze({
  player_retreat: 'retreat'
});

/**
 * Normalize only aliases whose meaning is unambiguous. Unknown values are
 * returned unchanged so validation can reject them instead of guessing.
 */
export function normalizeCombatState(state) {
  const value = String(state || '').trim().toLowerCase();
  return COMBAT_STATE_ALIASES[value] || value;
}
