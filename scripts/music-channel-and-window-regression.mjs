import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const productionFiles = [
  'js/core/music-service.js',
  'js/core/music-playback.js',
  'js/core/lingxi/adapters/music-adapter.js',
  'js/core/lingxi/lingxi-tools.js',
  'js/data/lingxi-persona.js',
  'js/data/product-capability-catalog.js',
  'server/api/music-stream.js'
];

for (const file of productionFiles) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /kuwo|酷我/i, `${file} must not retain the removed music provider`);
}

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('../css/layout.css', import.meta.url), 'utf8');
assert.match(appSource, /openMusicWithFloatingPlayer/, 'Ling Xi music opens through the floating-player wrapper');
assert.doesNotMatch(
  layoutSource,
  /lingxi-companion-open\s+\.desktop-lyrics/,
  'an open Ling Xi panel must not hide or disable the floating music player'
);

console.log('Music channel removal and floating-window regression: passed');
