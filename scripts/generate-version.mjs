#!/usr/bin/env node

/**
 * generate-version.mjs
 * 生成 version.json 版本信息文件
 *
 * 用法:
 *   node scripts/generate-version.mjs              # 输出到 stdout
 *   node scripts/generate-version.mjs --out <path>  # 写入文件
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 读取 package.json 版本号
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;

// 构建时间戳 (UTC)
const now = new Date();
const buildId = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

const manifest = {
  version,
  build: `v${version}-${buildId}`,
  deployed_at: now.toISOString(),
  environment: process.env.DEPLOY_ENV || 'production'
};

const json = JSON.stringify(manifest, null, 2);

// --out 参数: 写入文件; 否则输出到 stdout
const outIdx = process.argv.indexOf('--out');
if (outIdx !== -1 && process.argv[outIdx + 1]) {
  const outPath = resolve(ROOT, process.argv[outIdx + 1]);
  writeFileSync(outPath, json, 'utf-8');
  console.log(`version.json -> ${outPath}`);
  console.log(json);
} else {
  process.stdout.write(json + '\n');
}
