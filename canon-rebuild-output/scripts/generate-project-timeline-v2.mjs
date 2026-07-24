#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timelineManifestPayload, timelineShardPayload } from './project-timeline-v2/contract.mjs';
import { loadTimelineShardDefinitions, selectTimelineShardDefinitions } from './project-timeline-v2/source-loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectTimelineRoot = path.join(root, 'data', 'canon', 'project-timeline');
const outputRoot = path.join(projectTimelineRoot, 'shards');
const args = process.argv.slice(2);
const shardDefinitions = await loadTimelineShardDefinitions();
const definitionsToWrite = selectTimelineShardDefinitions(
  shardDefinitions,
  args,
  'node canon-rebuild-output/scripts/generate-project-timeline-v2.mjs'
);
fs.mkdirSync(outputRoot, { recursive: true });
for (const definition of definitionsToWrite) {
  const payload = timelineShardPayload(definition);
  fs.writeFileSync(path.join(outputRoot, `${definition.id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

if (args.length === 0) {
  const manifest = timelineManifestPayload(shardDefinitions);
  fs.writeFileSync(path.join(projectTimelineRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const allDays = definitionsToWrite.flatMap(definition => definition.days);
const sceneCount = allDays.reduce((sum, item) => sum + item.scenes.length, 0);
const beatCount = allDays.reduce((sum, item) => sum + item.scenes.reduce((count, scene) => count + scene.beats.length, 0), 0);
const suffix = args.length ? ' (manifest unchanged; full generation performs integration)' : '';
console.log(`Generated project.timeline.v2: ${allDays.length} days, ${sceneCount} scenes, ${beatCount} beats${suffix}`);
