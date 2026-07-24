import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PROJECT_TIMELINE_ID_PATTERNS,
  normalizeTimelineShardDefinition
} from './contract.mjs';

const defaultSourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function loadTimelineShardDefinitions(sourceDirectory = defaultSourceDirectory) {
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  const sourceFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
    .filter(entry => PROJECT_TIMELINE_ID_PATTERNS.shard.test(entry.name.slice(0, -4)))
    .map(entry => entry.name)
    .sort();
  const definitions = [];
  const ids = new Set();
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(sourceDirectory, sourceFile);
    const sourceModule = await import(pathToFileURL(sourcePath).href);
    const definition = normalizeTimelineShardDefinition(sourceModule.default, sourceFile);
    const fileId = sourceFile.slice(0, -4);
    if (definition.id !== fileId) throw new Error(`${sourceFile}: default export ID must be ${fileId}, received ${definition.id}`);
    if (ids.has(definition.id)) throw new Error(`${definition.id}: duplicate source shard ID`);
    ids.add(definition.id);
    definitions.push(definition);
  }
  if (!definitions.length) throw new Error(`No project timeline shard sources found in ${sourceDirectory}`);
  return definitions.sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)) || a.id.localeCompare(b.id));
}

export function selectTimelineShardDefinitions(definitions, args, commandName) {
  if (args.length === 0) return definitions;
  if (args.length !== 2 || args[0] !== '--shard' || !args[1]) {
    throw new Error(`Usage: ${commandName} [--shard <ID>]`);
  }
  const selected = definitions.find(definition => definition.id === args[1]);
  if (!selected) throw new Error(`Unknown shard: ${args[1]}. Expected one of: ${definitions.map(item => item.id).join(', ')}`);
  return [selected];
}
