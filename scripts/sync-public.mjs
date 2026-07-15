#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const sharedFiles = ['index.html', 'manifest.json', 'sw.js'];
const sharedDirectories = ['js', 'css', 'img', 'assets'];

await fs.mkdir(publicDir, { recursive: true });
for (const file of sharedFiles) {
  await fs.copyFile(path.join(root, file), path.join(publicDir, file));
}
for (const directory of sharedDirectories) {
  await fs.cp(path.join(root, directory), path.join(publicDir, directory), {
    recursive: true,
    force: true
  });
}

console.log(`Synchronized shared app sources into ${path.relative(root, publicDir)}/`);
