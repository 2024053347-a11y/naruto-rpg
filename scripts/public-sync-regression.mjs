import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.svg']);
let checked = 0;

function normalizedText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function compareFile(source, deployed) {
  assert.ok(fs.existsSync(deployed), `Missing public copy: ${path.relative(root, deployed)}`);
  const extension = path.extname(source).toLowerCase();
  if (textExtensions.has(extension)) {
    assert.equal(normalizedText(deployed), normalizedText(source), `Public copy drifted: ${path.relative(root, source)}`);
  } else {
    assert.ok(
      fs.readFileSync(deployed).equals(fs.readFileSync(source)),
      `Public binary drifted: ${path.relative(root, source)}`
    );
  }
  checked++;
}

function compareTree(relativeDir) {
  const sourceDir = path.join(root, relativeDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) compareTree(relative);
    else compareFile(path.join(root, relative), path.join(root, 'public', relative));
  }
}

for (const file of ['index.html', 'manifest.json', 'sw.js']) {
  compareFile(path.join(root, file), path.join(root, 'public', file));
}
for (const directory of ['js', 'css', 'img', 'assets']) compareTree(directory);

console.log(`PASS ${checked} shared source/public files are synchronized.`);
