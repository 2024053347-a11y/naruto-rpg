#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, mkdir } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'js', 'vendor');
const outputFile = path.join(outputDirectory, 'agent-sdk.js');

let build;
try {
  ({ build } = await import('esbuild'));
} catch (error) {
  try {
    await access(outputFile);
    console.warn('esbuild is unavailable; using the committed browser Agent SDK bundle.');
    process.exit(0);
  } catch {
    throw new Error('Cannot build browser Agent SDK: install development dependencies first.', {
      cause: error
    });
  }
}

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(root, 'scripts', 'vendor', 'agent-sdk-entry.js')],
  outfile: outputFile,
  bundle: true,
  format: 'iife',
  globalName: 'NarutoAgentSDK',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  treeShaking: true,
  legalComments: 'none',
  footer: { js: 'globalThis.NarutoAgentSDK = NarutoAgentSDK;' }
});

console.log(`Built browser Agent SDK: ${path.relative(root, outputFile)}`);
