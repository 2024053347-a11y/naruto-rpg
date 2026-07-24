import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const write = (relative, value) => fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
const prefix = 'CH-NAR-';
const annotation = /-(?:DO-NOT|PLEASE|WARNING|THAT-WAS|IT-WAS|SHE-WAS|EVERYONE-CAN|ONLY-LISTED|WERE-JUST|MISTRANSLATION|SEE-(?:TALKPAGE|TRIVIA))(?:-|$)/;
const nonManga = /-(?:ANIME|GAME|MOVIE|OVA)(?:-|$)/;
const compound = /(?:-WITH-|-AND-|-OR-|-PUPPET-)/;
const isPseudo = id => annotation.test(id) || nonManga.test(id) || compound.test(id);

const registryPath = 'data/canon/registries/entities.json';
const entities = read(registryPath);
const stableIds = entities.map(entity => entity.id).filter(id => id.startsWith(prefix) && !isPseudo(id));
const stableSet = new Set(stableIds);
const stableSuffixes = stableIds
  .map(id => ({ id, suffix: id.slice(prefix.length) }))
  .filter(item => item.suffix.length >= 3)
  .sort((a, b) => b.suffix.length - a.suffix.length);

function boundaryContains(body, suffix) {
  const index = body.indexOf(suffix);
  if (index < 0) return false;
  const before = index === 0 || body[index - 1] === '-';
  const end = index + suffix.length;
  const after = end === body.length || body[end] === '-';
  return before && after;
}

function resolvePseudoId(id) {
  if (!isPseudo(id)) return [id];
  if (nonManga.test(id)) return [];
  const body = id.slice(prefix.length);
  const marker = body.search(annotation);
  if (marker >= 0) {
    const leading = prefix + body.slice(0, marker);
    return stableSet.has(leading) ? [leading] : [];
  }
  const matches = [];
  let remaining = body;
  for (const candidate of stableSuffixes) {
    if (!boundaryContains(remaining, candidate.suffix)) continue;
    matches.push(candidate.id);
    remaining = remaining.replace(candidate.suffix, '-'.repeat(candidate.suffix.length));
  }
  if (body === 'SAKON-AND-UKON' && !matches.includes('CH-NAR-SAKON')) matches.push('CH-NAR-SAKON');
  return matches;
}

const manifest = read('data/canon/techniques/manifest.json');
let replaced = 0;
let removed = 0;
let affectedTechniques = 0;
const referencedIds = new Set();

for (const shardMeta of manifest.shards) {
  const relative = path.join('data/canon/techniques', shardMeta.path).replaceAll('\\', '/');
  const shard = read(relative);
  let touched = false;
  for (const technique of shard.records || []) {
    const users = [];
    const seen = new Set();
    let techniqueTouched = false;
    for (const user of technique.known_users || []) {
      const resolved = resolvePseudoId(user.character_id);
      if (isPseudo(user.character_id)) {
        techniqueTouched = true;
        if (resolved.length) replaced++;
        else removed++;
      }
      for (const id of resolved) {
        if (seen.has(id)) continue;
        seen.add(id);
        users.push({ ...user, character_id: id });
        referencedIds.add(id);
      }
    }
    if (techniqueTouched) {
      technique.known_users = users;
      technique.qa ||= {};
      technique.qa.user_reviewed_by = 'repair-technique-users-v1';
      affectedTechniques++;
      touched = true;
    } else {
      for (const user of users) referencedIds.add(user.character_id);
    }
  }
  if (touched) write(relative, shard);
}

const cleanedEntities = entities.filter(entity => !isPseudo(entity.id));
write(registryPath, cleanedEntities);
console.log(JSON.stringify({
  affectedTechniques,
  replacedEntries: replaced,
  removedEntries: removed,
  removedEntities: entities.length - cleanedEntities.length,
  remainingEntities: cleanedEntities.length
}, null, 2));
