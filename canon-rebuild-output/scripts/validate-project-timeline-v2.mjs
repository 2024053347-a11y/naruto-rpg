#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  PROJECT_TIMELINE_ID_PATTERNS,
  PROJECT_TIMELINE_MANIFEST_BASE,
  PROJECT_TIMELINE_NAMESPACES,
  timelineManifestPayload,
  timelineNamespaceFromId,
  timelineShardPayload
} from './project-timeline-v2/contract.mjs';
import { loadTimelineShardDefinitions, selectTimelineShardDefinitions } from './project-timeline-v2/source-loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'data', 'canon', 'project-timeline');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const partial = args.length > 0;
const allDefinitions = await loadTimelineShardDefinitions();
const definitions = selectTimelineShardDefinitions(
  allDefinitions,
  args,
  'node canon-rebuild-output/scripts/validate-project-timeline-v2.mjs'
);
const expectedManifest = timelineManifestPayload(allDefinitions);
const manifest = readJson(path.join(sourceRoot, 'manifest.json'));
const schema = readJson(path.join(root, 'data', 'canon', 'schemas', 'project-timeline.schema.json'));
const registryRoot = path.join(root, 'data', 'canon', 'registries');
const projectBirths = readJson(path.join(registryRoot, 'project-births.json'));
const earlyHistoryEntityMap = readJson(path.join(registryRoot, 'early-history-entity-map.json'));
const entities = readJson(path.join(registryRoot, 'entities.json'));
const organizations = readJson(path.join(registryRoot, 'organizations.json'));
const locations = readJson(path.join(registryRoot, 'locations.json'));
const yearlyRoot = path.join(root, 'data', 'canon', 'timeline', 'yearly');
const yearlyManifest = readJson(path.join(yearlyRoot, 'manifest.json'));
const yearlyAlmanacByYear = new Map((yearlyManifest.years || []).map(item => {
  const almanac = readJson(path.join(yearlyRoot, item.path));
  return [item.year, almanac];
}));
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const schemaValidator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const datePattern = /^K\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|30)$/;
const validModes = new Set(['interactive', 'offscreen', 'conditional']);
const validStatuses = new Set(['altered', 'skipped', 'postponed']);
const validRoles = new Set(['setup', 'pressure', 'choice', 'turn', 'resolution', 'transition']);
const birthByName = new Map(projectBirths.map(person => [person.name, person]));
const entityIds = new Set(entities.map(entity => entity.id));
const organizationIds = new Set(organizations.map(organization => organization.id));
const locationIds = new Set(locations.map(location => location.id));
const ids = new Set();
const dates = new Set();
const dateOwners = new Map();
const shards = definitions.map(definition => ({
  definition,
  data: readJson(path.join(sourceRoot, 'shards', `${definition.id}.json`))
}));
const days = shards.flatMap(({ data }) => data.days || []);
const genericRequirements = '当前日期已到达，且本场景的核心人物、地点与冲突前置仍然成立。';
const genericBlockers = '玩家已造成死亡、叛逃、阵营、地点或任务归属变化，使基准冲突无法照常成立。';
const genericFallback = '保留本场景承担的冲突功能，依据当前存档重选参与者、手段与局部结果；不得强行恢复基准细节。';

assert(manifest.schema_version === PROJECT_TIMELINE_MANIFEST_BASE.schema_version, 'manifest: wrong schema version');
assert(manifest.continuity === PROJECT_TIMELINE_MANIFEST_BASE.continuity, 'manifest: wrong continuity');
assert(days.length > 0, 'timeline: no days');
if (!partial) {
  assert(JSON.stringify(manifest) === JSON.stringify(expectedManifest), 'manifest: stale or inconsistent with discovered source shards; rerun generate-project-timeline-v2.mjs');
}

for (const { definition, data } of shards) {
  if (!schemaValidator(data)) {
    for (const error of schemaValidator.errors || []) {
      errors.push(`${definition.id}${error.instancePath || '/'}: schema ${error.message}`);
    }
  }
  assert(data.schema_version === PROJECT_TIMELINE_MANIFEST_BASE.schema_version, `${definition.id}: schema version mismatch`);
  assert(data.dataset === PROJECT_TIMELINE_MANIFEST_BASE.dataset, `${definition.id}: dataset mismatch`);
  assert(data.continuity === PROJECT_TIMELINE_MANIFEST_BASE.continuity, `${definition.id}: continuity mismatch`);
  assert(data.shard?.id === definition.id, `${definition.id}: shard id mismatch`);
  assert(data.shard?.namespace === definition.namespace, `${definition.id}: shard namespace mismatch`);
  assert(data.shard?.date_start === definition.dateStart && data.shard?.date_end === definition.dateEnd, `${definition.id}: date boundary mismatch`);
  assert((data.shard?.arc_ids || []).every(id => timelineNamespaceFromId(id) === definition.namespace), `${definition.id}: arc namespace mismatch`);
  const shardDays = data.days || [];
  assert(shardDays.length > 0, `${definition.id}: empty shard`);
  assert(shardDays.every(day => day.date >= definition.dateStart && day.date <= definition.dateEnd), `${definition.id}: day outside shard range`);
  assert(shardDays[0]?.date === definition.dateStart && shardDays.at(-1)?.date === definition.dateEnd, `${definition.id}: first/last day does not match shard boundary`);
  assert(shardDays.every((day, index) => index === 0 || day.date > shardDays[index - 1].date), `${definition.id}: days must be strictly chronological`);
  assert(shardDays.every(day => data.shard?.arc_ids?.includes(day.arc_id)), `${definition.id}: day uses arc outside shard arc_ids`);
  assert(JSON.stringify(data) === JSON.stringify(timelineShardPayload(definition)), `${definition.id}: generated JSON is stale; rerun generate-project-timeline-v2.mjs --shard ${definition.id}`);
}

for (const day of days) {
  const namespace = timelineNamespaceFromId(day.id);
  assert(PROJECT_TIMELINE_ID_PATTERNS.day.test(day.id), `${day.id || 'unknown day'}: invalid day id`);
  assert(!ids.has(day.id), `${day.id}: duplicate id`); ids.add(day.id);
  assert(datePattern.test(day.date), `${day.id}: invalid date ${day.date}`);
  const existingDateOwner = dateOwners.get(day.date);
  const allowedReferenceOverlap = existingDateOwner
    && Boolean(existingDateOwner.year_snapshot) !== Boolean(day.year_snapshot);
  assert(!existingDateOwner || allowedReferenceOverlap, `${day.id}: duplicate narrative/reference date ${day.date}`);
  if (!existingDateOwner) dateOwners.set(day.date, day);
  dates.add(day.date);
  assert(PROJECT_TIMELINE_ID_PATTERNS.arc.test(day.arc_id), `${day.id}: invalid arc id`);
  assert(timelineNamespaceFromId(day.arc_id) === namespace, `${day.id}: arc namespace must match day namespace`);
  assert(Boolean(day.day_goal?.trim()), `${day.id}: missing day goal`);
  assert(Array.isArray(day.start_state) && day.start_state.length, `${day.id}: missing start state`);
  assert(Array.isArray(day.end_state) && day.end_state.length, `${day.id}: missing end state`);
  assert(Boolean(day.transition?.trim()), `${day.id}: missing transition`);
  assert(Array.isArray(day.reference_facts), `${day.id}: reference_facts must be separate array`);
  assert(Array.isArray(day.scenes) && day.scenes.length >= 1 && day.scenes.length <= 8, `${day.id}: scene count must be 1-8`);
  for (const scene of day.scenes || []) {
    assert(PROJECT_TIMELINE_ID_PATTERNS.scene.test(scene.id), `${day.id}/${scene.id || 'unknown scene'}: invalid scene id`);
    assert(timelineNamespaceFromId(scene.id) === namespace, `${scene.id}: scene namespace must match day namespace`);
    assert(!ids.has(scene.id), `${scene.id}: duplicate id`); ids.add(scene.id);
    assert(PROJECT_TIMELINE_ID_PATTERNS.thread.test(scene.thread_id), `${scene.id}: invalid thread id`);
    assert(timelineNamespaceFromId(scene.thread_id) === namespace, `${scene.id}: thread namespace must match day namespace`);
    assert(Boolean(scene.location?.trim()), `${scene.id}: missing location`);
    assert(Array.isArray(scene.participants) && scene.participants.length, `${scene.id}: missing participants`);
    assert(validModes.has(scene.resolution_mode), `${scene.id}: invalid resolution mode`);
    for (const key of ['requirements', 'blockers', 'outcomes', 'state_changes']) {
      assert(Array.isArray(scene[key]) && scene[key].length, `${scene.id}: ${key} must be non-empty`);
    }
    assert(Boolean(scene.setup?.trim()), `${scene.id}: missing setup`);
    assert(Boolean(scene.stop_condition?.trim()), `${scene.id}: missing stop condition`);
    assert(Boolean(scene.design_rationale?.trim()), `${scene.id}: missing design rationale`);
    assert(Array.isArray(scene.reference_facts), `${scene.id}: reference_facts must be separate array`);
    assert(Array.isArray(scene.source_material) && scene.source_material.length, `${scene.id}: missing source material`);
    assert(Array.isArray(scene.fallbacks) && scene.fallbacks.length, `${scene.id}: missing fallbacks`);
    assert(!(scene.requirements || []).includes(genericRequirements), `${scene.id}: generic requirements are forbidden`);
    assert(!(scene.blockers || []).includes(genericBlockers), `${scene.id}: generic blockers are forbidden`);
    assert(!(scene.fallbacks || []).some(fallback => fallback.direction === genericFallback), `${scene.id}: generic fallback is forbidden`);
    assert(Array.isArray(scene.beats) && scene.beats.length > 0, `${scene.id}: beats must be non-empty`);
    if (scene.resolution_mode === 'interactive') {
      const interactiveText = JSON.stringify([scene.participants, scene.setup, scene.beats, scene.outcomes, scene.stop_condition]);
      assert(interactiveText.includes('玩家'), `${scene.id}: interactive scene requires an explicit player entry`);
      assert((scene.beats || []).some(beat => beat.causal_role === 'choice'), `${scene.id}: interactive scene requires a choice beat`);
    }
    for (const fallback of scene.fallbacks || []) {
      assert(validStatuses.has(fallback.status), `${scene.id}: invalid fallback status`);
      assert(Boolean(fallback.condition && fallback.direction && fallback.preserves), `${scene.id}: incomplete fallback`);
    }
    let priorOrder = 0;
    for (const beat of scene.beats || []) {
      assert(PROJECT_TIMELINE_ID_PATTERNS.beat.test(beat.id), `${scene.id}/${beat.id || 'unknown beat'}: invalid beat id`);
      assert(timelineNamespaceFromId(beat.id) === namespace, `${beat.id}: beat namespace must match day namespace`);
      assert(!ids.has(beat.id), `${beat.id}: duplicate id`); ids.add(beat.id);
      assert(Number.isInteger(beat.order) && beat.order > priorOrder, `${beat.id}: beat order must strictly increase`);
      priorOrder = beat.order;
      assert(Boolean(beat.summary?.trim()), `${beat.id}: missing summary`);
      assert(validRoles.has(beat.causal_role), `${beat.id}: invalid causal role`);
    }
  }
}

const compactText = value => String(value ?? '').replace(/\s+/g, '');
const textIncludes = (text, expected) => compactText(text).includes(compactText(expected));
const delimitedEntryFor = (text, marker) => {
  const start = String(text ?? '').indexOf(marker);
  if (start < 0) return '';
  const separators = ['；', '\n'].map(separator => String(text).indexOf(separator, start)).filter(index => index >= 0);
  return String(text).slice(start, separators.length ? Math.min(...separators) : undefined);
};
const expectedBirthday = person => `${String(person.birth_month).padStart(2, '0')}-${String(person.birth_day).padStart(2, '0')}`;
const assertLocationForeignKey = (locationId, context) => {
  if (locationId !== null && locationId !== undefined && locationId !== '') {
    assert(locationIds.has(locationId), `${context}: unknown location_id ${locationId}`);
  }
};
const assertOrganizationForeignKeys = (references, context) => {
  for (const organizationId of Array.isArray(references) ? references : []) {
    assert(organizationIds.has(organizationId), `${context}: unknown organization_id ${organizationId}`);
  }
};

if (definitions.some(definition => definition.id === 'HIST-ANNUAL-FOUNDATIONS')) {
  const annualDays = days.filter(day => day.id.startsWith('DAY-HIST-ANNUAL-'));
  const expectedAnnualDates = (yearlyManifest.years || []).map(item => `${item.year}-01-01`);
  const structuredAnnualDays = annualDays.filter(day => day.year_snapshot);
  assert(annualDays.length === expectedAnnualDates.length, `HIST-ANNUAL-FOUNDATIONS: expected ${expectedAnnualDates.length} annual snapshots`);
  assert(structuredAnnualDays.length === expectedAnnualDates.length, 'HIST-ANNUAL-FOUNDATIONS: every annual DAY record must contain year_snapshot');
  assert(
    JSON.stringify(annualDays.map(day => day.date)) === JSON.stringify(expectedAnnualDates),
    `HIST-ANNUAL-FOUNDATIONS: ${yearlyManifest.year_start}-${yearlyManifest.year_end} annual coverage must be complete and ordered`
  );

  for (const annualDay of annualDays) {
    const annualScene = annualDay.scenes?.[0];
    const snapshot = annualDay.year_snapshot;
    assert(annualDay.scenes?.length === 1, `${annualDay.id}: annual snapshot must contain exactly one scene`);
    assert(annualScene?.resolution_mode === 'offscreen', `${annualDay.id}: annual snapshot must be offscreen reference data`);
    assert(annualScene?.beats?.length === 3, `${annualDay.id}: annual snapshot must contain age/faction/location beats`);
    assert(/人物年龄/.test(annualScene?.beats?.[0]?.summary || ''), `${annualDay.id}: first beat must expose character ages`);
    assert(/势力/.test(annualScene?.beats?.[1]?.summary || ''), `${annualDay.id}: second beat must expose active factions`);
    assert(/位置|驻地/.test(annualScene?.beats?.[2]?.summary || ''), `${annualDay.id}: third beat must expose coarse locations`);
    assert(/年初档案快照/.test(annualScene?.setup || ''), `${annualDay.id}: snapshot must identify itself as year-start reference data`);
    assert(/尚未发生前不得视为既成事实/.test(annualScene?.beats?.[1]?.summary || ''), `${annualDay.id}: annual transitions must not leak into year-start state`);
    if (!snapshot) continue;

    assert(snapshot.as_of === annualDay.date, `${annualDay.id}: year_snapshot.as_of must equal day.date`);
    const year = Number(annualDay.date.slice(1, 4));
    const characters = Array.isArray(snapshot.characters) ? snapshot.characters : [];
    const factions = Array.isArray(snapshot.factions) ? snapshot.factions : [];
    const sourceAlmanac = yearlyAlmanacByYear.get(annualDay.date.slice(0, 4));
    assert(Boolean(sourceAlmanac), `${annualDay.id}: missing yearly source almanac`);
    if (sourceAlmanac) {
      assert(
        JSON.stringify(snapshot.transitions_this_year) === JSON.stringify(sourceAlmanac.annual_events),
        `${annualDay.id}: transitions_this_year must project the yearly source without rewriting`
      );
      assert(
        characters.length === sourceAlmanac.character_ages.length,
        `${annualDay.id}: character projection lost yearly source rows`
      );
      for (const sourceAge of sourceAlmanac.character_ages) {
        const projected = characters.find(character => character.name === sourceAge.name);
        assert(Boolean(projected), `${annualDay.id}: missing yearly character ${sourceAge.name}`);
        if (!projected) continue;
        assert(projected.entity_id === sourceAge.entity_id, `${annualDay.id}/${sourceAge.name}: entity_id differs from yearly source`);
        const expectedAgeStatus = sourceAge.status === 'born_this_year' ? 'born_this_year'
          : (Number.isInteger(sourceAge.age_at_year_start) ? 'exact' : 'unknown');
        assert(projected.age?.status === expectedAgeStatus, `${annualDay.id}/${sourceAge.name}: age status differs from yearly source`);
        assert(projected.age?.at_year_start === sourceAge.age_at_year_start, `${annualDay.id}/${sourceAge.name}: year-start age differs from yearly source`);
        assert(projected.age?.after_birthday === sourceAge.age_after_birthday, `${annualDay.id}/${sourceAge.name}: post-birthday age differs from yearly source`);
        assert(projected.age?.birthday === sourceAge.birthday, `${annualDay.id}/${sourceAge.name}: birthday differs from yearly source`);
      }
    }
    const nonEmptyCharacterIds = characters.map(character => character.entity_id).filter(Boolean);
    const nonEmptyFactionIds = factions.map(faction => faction.organization_id).filter(Boolean);
    assert(
      new Set(nonEmptyCharacterIds).size === nonEmptyCharacterIds.length,
      `${annualDay.id}: character entity_id values must be unique within the snapshot`
    );
    assert(
      new Set(nonEmptyFactionIds).size === nonEmptyFactionIds.length,
      `${annualDay.id}: faction organization_id values must be unique within the snapshot`
    );

    for (const character of characters) {
      const context = `${annualDay.id}/${character.name || character.entity_id || 'unknown character'}`;
      if (character.entity_id) {
        assert(entityIds.has(character.entity_id), `${context}: entity_id ${character.entity_id} is absent from entities.json`);
        assert(
          earlyHistoryEntityMap[character.name] === character.entity_id,
          `${context}: entity_id must match early-history-entity-map.json (${earlyHistoryEntityMap[character.name] || 'unmapped'})`
        );
      }
      assertOrganizationForeignKeys(character.public_state?.organization_ids, `${context}/public_state`);
      assertLocationForeignKey(character.public_state?.location_id, `${context}/public_state`);
      if (character.actual_state) {
        assert(character.actual_state.visibility !== 'public', `${context}: actual_state visibility must not be public`);
        assertOrganizationForeignKeys(character.actual_state.organization_ids, `${context}/actual_state`);
        assertLocationForeignKey(character.actual_state.location_id, `${context}/actual_state`);
      }

      const age = character.age || {};
      const birth = birthByName.get(character.name);
      if (birth?.entity_id && character.entity_id) {
        assert(birth.entity_id === character.entity_id, `${context}: entity_id disagrees with project-births.json`);
      }
      if (age.status === 'exact') {
        assert(Boolean(birth), `${context}: exact age requires a project-births.json record`);
        if (birth) {
          assert(birth.birth_year < year, `${context}: exact age is invalid in or before the birth year`);
          assert(age.at_year_start === year - birth.birth_year - 1, `${context}: wrong exact age at year start`);
          assert(age.after_birthday === year - birth.birth_year, `${context}: wrong exact age after birthday`);
          assert(age.birthday === expectedBirthday(birth), `${context}: birthday disagrees with project-births.json`);
        }
        assert(age.after_birthday === age.at_year_start + 1, `${context}: exact age must increase by one after birthday`);
      } else if (age.status === 'born_this_year') {
        assert(Boolean(birth), `${context}: born_this_year requires a project-births.json record`);
        if (birth) {
          assert(birth.birth_year === year, `${context}: born_this_year disagrees with project birth year`);
          assert(age.birthday === expectedBirthday(birth), `${context}: birthday disagrees with project-births.json`);
        }
        assert(age.at_year_start === null, `${context}: born_this_year must have null at_year_start`);
        assert(age.after_birthday === 0, `${context}: born_this_year must have age 0 after birth`);
      } else if (age.status === 'unknown') {
        assert(age.at_year_start === null, `${context}: unknown age must have null at_year_start`);
        assert(age.after_birthday === null, `${context}: unknown age must have null after_birthday`);
        assert(age.birthday === null, `${context}: unknown age must have null birthday`);
      } else {
        assert(false, `${context}: unsupported age status ${age.status || '(missing)'}`);
      }
    }

    for (const faction of factions) {
      const context = `${annualDay.id}/${faction.name || faction.organization_id || 'unknown faction'}`;
      assert(organizationIds.has(faction.organization_id), `${context}: organization_id ${faction.organization_id} is absent from organizations.json`);
      assertLocationForeignKey(faction.location_id, context);
    }

    // The legacy three-beat scene is a compatibility projection, not a second source of truth.
    // Check the projected keys rather than comparing the full prose, so harmless wording edits remain possible.
    const ageText = annualScene?.beats?.[0]?.summary || '';
    const factionText = annualScene?.beats?.[1]?.summary || '';
    const locationText = annualScene?.beats?.[2]?.summary || '';
    for (const character of characters) {
      const context = `${annualDay.id}/${character.name}/legacy age projection`;
      const characterAgeEntry = delimitedEntryFor(ageText, character.name);
      assert(textIncludes(ageText, character.name), `${context}: character name is missing from the age beat`);
      if (character.age?.status === 'exact') {
        assert(textIncludes(characterAgeEntry, `年初${character.age.at_year_start}岁`), `${context}: year-start age is missing from the character entry`);
        assert(textIncludes(characterAgeEntry, `生日后${character.age.after_birthday}岁`), `${context}: post-birthday age is missing from the character entry`);
        assert(textIncludes(characterAgeEntry, character.age.birthday), `${context}: birthday is missing from the character entry`);
      } else if (character.age?.status === 'born_this_year') {
        assert(textIncludes(characterAgeEntry, '年初尚未出生'), `${context}: birth-year state is missing from the character entry`);
        assert(textIncludes(characterAgeEntry, character.age.birthday), `${context}: birthday is missing from the character entry`);
      } else if (character.age?.status === 'unknown') {
        assert(/年龄.*(未冻结|未知|待补)/.test(characterAgeEntry), `${context}: unknown-age marker is missing from the character entry`);
      }
      assert(textIncludes(locationText, character.name), `${annualDay.id}/${character.name}: character is missing from the location beat`);
      assert(
        textIncludes(locationText, character.public_state?.location),
        `${annualDay.id}/${character.name}: public location is missing from the location beat`
      );
      if (character.actual_state?.location) {
        assert(
          textIncludes(locationText, character.actual_state.location),
          `${annualDay.id}/${character.name}: restricted/secret location is missing from the location beat`
        );
      }
    }
    for (const faction of factions) {
      assert(textIncludes(factionText, faction.name), `${annualDay.id}/${faction.name}: faction is missing from the faction beat`);
      assert(textIncludes(locationText, faction.location), `${annualDay.id}/${faction.name}: faction location is missing from the location beat`);
    }
    for (const transition of snapshot.transitions_this_year || []) {
      assert(textIncludes(factionText, transition), `${annualDay.id}: transition is missing from the faction beat: ${transition}`);
    }
  }

  const byDate = new Map(annualDays.map(day => [day.date, day]));
  const snapshotAt = date => byDate.get(date)?.year_snapshot;
  const beatAt = (date, order) => byDate.get(date)?.scenes?.[0]?.beats?.[order]?.summary || '';
  const characterAt = (date, entityId) => snapshotAt(date)?.characters?.find(character => character.entity_id === entityId);
  const factionAt = (date, organizationId) => snapshotAt(date)?.factions?.find(faction => faction.organization_id === organizationId);
  const transitionTextAt = date => (snapshotAt(date)?.transitions_this_year || []).join('；');

  assert(/千手柱间[^。；\n]*年初32岁/.test(beatAt('K001-01-01', 0)), 'K001: Hashirama year-start age must be 32');
  assert(/泉奈建村前已故/.test(beatAt('K001-01-01', 0)), 'K001: Izuna must be explicitly excluded from the living roster');
  assert(factionAt('K001-01-01', 'ORG-KONOHA')?.lifecycle === 'forming', 'K001: Konoha must still be forming at year start');

  const k003Madara = characterAt('K003-01-01', 'CH-NAR-MADARA-UCHIHA');
  assert(k003Madara?.public_state?.status?.includes('公开推定死亡'), 'K003: Madara public_state must say publicly presumed dead');
  assert(k003Madara?.public_state?.location_id === null, 'K003: Madara public location must remain unknown');
  assert(k003Madara?.actual_state?.visibility === 'secret', 'K003: Madara actual_state must be secret');
  assert(k003Madara?.actual_state?.status === '存活', 'K003: Madara secret actual_state must say alive');
  assert(k003Madara?.actual_state?.location_id === 'LOC-MOUNTAINS-GRAVEYARD', 'K003: Madara secret location must be the mountains graveyard');
  assert(
    !JSON.stringify(k003Madara?.public_state || {}).includes('LOC-MOUNTAINS-GRAVEYARD'),
    'K003: Madara secret location must not leak into public_state'
  );

  const k015Academy = factionAt('K015-01-01', 'ORG-KONOHA-ACADEMY');
  const k016Academy = factionAt('K016-01-01', 'ORG-KONOHA-ACADEMY');
  assert(k015Academy?.lifecycle === 'active' && k015Academy?.name?.includes('木叶学堂'), 'K015: academy must still be the active 木叶学堂 at year start');
  assert(k016Academy?.lifecycle === 'active' && k016Academy?.name?.includes('木叶忍者学校'), 'K016: academy must be the active 木叶忍者学校 at year start');

  assert(/柱间于本年去世，扉间继任第二代火影/.test(transitionTextAt('K017-01-01')), 'K017: Hashirama/Tobirama succession boundary missing');
  assert(/扉间.*牺牲.*日斩.*继任第三代火影/.test(transitionTextAt('K020-01-01')), 'K020: Tobirama/Hiruzen succession boundary missing');

  const k038Uzushio = factionAt('K038-01-01', 'ORG-UZUSHIO');
  assert(k038Uzushio?.lifecycle === 'active', 'K038: Uzushio must still be active at year start');
  assert(/涡潮.*本年.*毁灭|涡潮.*本年.*遭毁/.test(transitionTextAt('K038-01-01')), 'K038: Uzushio destruction transition boundary missing');
  assert(!factionAt('K039-01-01', 'ORG-UZUSHIO'), 'K039: active Uzushio organization must no longer appear');
  assert(factionAt('K039-01-01', 'ORG-UZUMAKI')?.lifecycle === 'diaspora', 'K039: Uzumaki survivors must be represented as a diaspora');

  const k048Akatsuki = factionAt('K048-01-01', 'ORG-AKATSUKI');
  const k049Akatsuki = factionAt('K049-01-01', 'ORG-AKATSUKI');
  assert(k048Akatsuki?.lifecycle === 'active' && k048Akatsuki?.name?.includes('初代晓'), 'K048: the original Akatsuki must still be active at year start');
  assert(/弥彦.*围杀/.test(transitionTextAt('K048-01-01')), 'K048: Yahiko/Akatsuki transition boundary missing');
  assert(k049Akatsuki?.lifecycle === 'underground' && k049Akatsuki?.name?.includes('地下晓'), 'K049: Akatsuki must have transitioned underground');
  assert(k049Akatsuki?.visibility === 'secret', 'K049: underground Akatsuki must be secret');

  assert(/旗木卡卡西[^。；\n]*年初11岁[^。；\n]*生日后12岁/.test(beatAt('K049-01-01', 0)), 'K049: Kakashi age boundary must be 11 to 12');
  assert(!byDate.get('K049-01-01')?.scenes?.[0]?.participants?.includes('第三代风影'), 'K049: missing Third Kazekage must not remain in the living roster');
}

const sortedDates = [...dates].sort();
const sceneCount = days.reduce((count, day) => count + day.scenes.length, 0);
const beatCount = days.reduce((count, day) => count + day.scenes.reduce((sum, scene) => sum + scene.beats.length, 0), 0);
if (!partial) {
  assert(days.length === 385, 'timeline: expected 385 DAY records including K001-K086 yearly snapshots');
  assert(sceneCount === 786, 'timeline: expected 786 SCENE records');
  assert(beatCount === 2894, 'timeline: expected 2894 beat records');
  assert(sortedDates[0] === manifest.coverage?.date_start, 'timeline: first date does not match manifest coverage');
  assert(sortedDates.at(-1) === manifest.coverage?.date_end, 'timeline: last date does not match manifest coverage');
  const actualNamespaces = PROJECT_TIMELINE_NAMESPACES.filter(namespace => days.some(day => timelineNamespaceFromId(day.id) === namespace));
  assert(JSON.stringify(actualNamespaces) === JSON.stringify(manifest.included_namespaces), 'timeline: included namespaces do not match manifest');
}
const forbiddenLegacy = [...ids].filter(id => /^EV-NAR-/.test(id));
assert(forbiddenLegacy.length === 0, `timeline: legacy IDs found: ${forbiddenLegacy.join(', ')}`);

const report = {
  schema_version: PROJECT_TIMELINE_MANIFEST_BASE.schema_version,
  mode: partial ? 'shard' : 'full',
  namespaces: PROJECT_TIMELINE_NAMESPACES.filter(namespace => days.some(day => timelineNamespaceFromId(day.id) === namespace)),
  shards: definitions.length,
  days: days.length,
  scenes: sceneCount,
  beats: beatCount,
  date_start: sortedDates[0] || null,
  date_end: sortedDates.at(-1) || null,
  errors,
  status: errors.length ? 'failed' : 'passed'
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
