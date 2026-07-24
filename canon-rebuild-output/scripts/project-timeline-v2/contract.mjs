export const PROJECT_TIMELINE_SCHEMA_VERSION = 'project.timeline.v2';
export const PROJECT_TIMELINE_NAMESPACES = Object.freeze(['HIST', 'P1', 'P2', 'BOR']);

const namespaceSource = PROJECT_TIMELINE_NAMESPACES.join('|');
const codeSource = '[A-Z0-9]+(?:-[A-Z0-9]+)*';
const tokenPattern = new RegExp(`^${codeSource}$`);

export const PROJECT_TIMELINE_ID_PATTERNS = Object.freeze({
  shard: new RegExp(`^(?:${namespaceSource})-${codeSource}$`),
  day: new RegExp(`^DAY-(?:${namespaceSource})-${codeSource}$`),
  scene: new RegExp(`^SCN-(?:${namespaceSource})-${codeSource}$`),
  beat: new RegExp(`^EV-(?:${namespaceSource})-${codeSource}$`),
  thread: new RegExp(`^THR-(?:${namespaceSource})-${codeSource}$`),
  arc: new RegExp(`^ARC-(?:${namespaceSource})-${codeSource}$`)
});

export const PROJECT_TIMELINE_MANIFEST_BASE = Object.freeze({
  schema_version: PROJECT_TIMELINE_SCHEMA_VERSION,
  dataset: 'naruto-rpg-project-canon',
  continuity: 'curated_game_canon',
  scope: 'multi_era_incremental',
  authority: 'gameplay_coherence_then_source_material',
  calendar: Object.freeze({ id: 'konoha-360-v1', months_per_year: 12, days_per_month: 30 }),
  id_policy: 'era_namespaced_v2',
  date_version: 'project_multi_era_playable_v1'
});

export function normalizeTimelineNamespace(value) {
  const namespace = String(value || '').trim().toUpperCase();
  if (!PROJECT_TIMELINE_NAMESPACES.includes(namespace)) {
    throw new Error(`Unsupported project timeline namespace: ${value}. Expected ${PROJECT_TIMELINE_NAMESPACES.join(', ')}`);
  }
  return namespace;
}

function normalizeCode(value, label) {
  const code = String(value || '').trim().toUpperCase();
  if (!tokenPattern.test(code)) throw new Error(`Invalid ${label}: ${value}`);
  return code;
}

export function makeTimelineId(kind, namespace, code) {
  const prefixes = { day: 'DAY', scene: 'SCN', beat: 'EV', thread: 'THR', arc: 'ARC' };
  const prefix = prefixes[kind];
  if (!prefix) throw new Error(`Unknown project timeline ID kind: ${kind}`);
  return `${prefix}-${normalizeTimelineNamespace(namespace)}-${normalizeCode(code, `${kind} code`)}`;
}

export function makeTimelineShardId(namespace, code) {
  return `${normalizeTimelineNamespace(namespace)}-${normalizeCode(code, 'shard code')}`;
}

export function timelineNamespaceFromId(value) {
  const parts = String(value || '').split('-');
  const candidate = parts[0] === 'DAY' || parts[0] === 'SCN' || parts[0] === 'EV'
    || parts[0] === 'THR' || parts[0] === 'ARC' ? parts[1] : parts[0];
  return PROJECT_TIMELINE_NAMESPACES.includes(candidate) ? candidate : null;
}

function normalizeArcId(value, namespace) {
  const raw = String(value || '').trim().toUpperCase();
  const id = raw.startsWith('ARC-') ? raw : makeTimelineId('arc', namespace, raw);
  if (!PROJECT_TIMELINE_ID_PATTERNS.arc.test(id) || timelineNamespaceFromId(id) !== namespace) {
    throw new Error(`Shard ${namespace} cannot own arc ID: ${value}`);
  }
  return id;
}

export function normalizeTimelineShardDefinition(rawDefinition, sourceFile = '') {
  const raw = Array.isArray(rawDefinition)
    ? {
        id: rawDefinition[0],
        arcIds: rawDefinition[1],
        dateStart: rawDefinition[2],
        dateEnd: rawDefinition[3],
        days: rawDefinition[4]
      }
    : { ...(rawDefinition || {}) };
  const namespace = normalizeTimelineNamespace(raw.namespace || timelineNamespaceFromId(raw.id));
  const id = raw.id || makeTimelineShardId(namespace, raw.code);
  if (!PROJECT_TIMELINE_ID_PATTERNS.shard.test(id) || timelineNamespaceFromId(id) !== namespace) {
    throw new Error(`Invalid shard ID for ${namespace}: ${id}`);
  }
  const arcValues = raw.arcIds || raw.arc_ids || raw.arcCodes || raw.arc_codes;
  if (!Array.isArray(arcValues) || arcValues.length === 0) throw new Error(`${id}: arcIds/arcCodes must be non-empty`);
  if (!Array.isArray(raw.days) || raw.days.length === 0) throw new Error(`${id}: days must be non-empty`);
  const dateStart = raw.dateStart || raw.date_start;
  const dateEnd = raw.dateEnd || raw.date_end;
  return {
    id,
    namespace,
    arcIds: [...new Set(arcValues.map(value => normalizeArcId(value, namespace)))],
    dateStart,
    dateEnd,
    days: raw.days,
    sourceFile
  };
}

export function defineTimelineShard({ namespace, code, arcCodes, dateStart, dateEnd, days }) {
  return normalizeTimelineShardDefinition({ namespace, code, arcCodes, dateStart, dateEnd, days });
}

export function timelineShardPayload(rawDefinition) {
  const definition = normalizeTimelineShardDefinition(rawDefinition, rawDefinition?.sourceFile);
  return {
    $schema: '../../schemas/project-timeline.schema.json',
    schema_version: PROJECT_TIMELINE_MANIFEST_BASE.schema_version,
    dataset: PROJECT_TIMELINE_MANIFEST_BASE.dataset,
    continuity: PROJECT_TIMELINE_MANIFEST_BASE.continuity,
    calendar: { ...PROJECT_TIMELINE_MANIFEST_BASE.calendar },
    shard: {
      id: definition.id,
      namespace: definition.namespace,
      arc_ids: definition.arcIds,
      date_start: definition.dateStart,
      date_end: definition.dateEnd
    },
    days: definition.days
  };
}

export function timelineManifestPayload(rawDefinitions) {
  const definitions = rawDefinitions
    .map(definition => normalizeTimelineShardDefinition(definition, definition?.sourceFile))
    .sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)) || a.id.localeCompare(b.id));
  const includedNamespaces = PROJECT_TIMELINE_NAMESPACES.filter(namespace => definitions.some(item => item.namespace === namespace));
  const dates = definitions.flatMap(definition => definition.days.map(day => day.date)).filter(Boolean).sort();
  return {
    ...PROJECT_TIMELINE_MANIFEST_BASE,
    calendar: { ...PROJECT_TIMELINE_MANIFEST_BASE.calendar },
    supported_namespaces: [...PROJECT_TIMELINE_NAMESPACES],
    included_namespaces: includedNamespaces,
    coverage: {
      date_start: dates[0] || null,
      date_end: dates.at(-1) || null
    },
    shards: definitions.map(definition => ({
      id: definition.id,
      namespace: definition.namespace,
      path: `shards/${definition.id}.json`,
      date_start: definition.dateStart,
      date_end: definition.dateEnd
    }))
  };
}
