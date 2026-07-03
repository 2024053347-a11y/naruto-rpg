#!/usr/bin/env node
// @ts-check
/**
 * 忍者手记 — 酒馆正则 JSON 生成脚本
 * 将 bundle.mjs 产出的单文件 HTML 包装为 SillyTavern 可导入的
 * regex 脚本 JSON（两个触发器/placement 变体，HTML 内容一致）。
 * 用法: node scripts/build-regex.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIST_FILES } from './lib/paths.mjs';
import { createRegexScript, wrapHtmlAsCodeBlock } from './lib/tavern-regex.mjs';

/**
 * 输出目标定义 —— 两份正则仅触发器与 placement 不同，HTML 内容一致。
 * @type {ReadonlyArray<{ outFile: string, scriptName: string, findRegex: string, placement: number[] }>}
 */
const TARGETS = Object.freeze([
  {
    outFile: DIST_FILES.regexQiwuTrigger,
    scriptName: '正文-忍者手记-起物单文件版',
    findRegex: '起物',
    placement: [2],
  },
  {
    outFile: DIST_FILES.regexFullCapture,
    scriptName: '正文-忍者手记(单文件全量版)',
    findRegex: '(起物)',
    placement: [1, 2],
  },
]);

/**
 * 生成全部酒馆正则 JSON 产物。
 * @returns {string[]} 生成的文件路径
 */
export function buildRegexArtifacts() {
  if (!fs.existsSync(DIST_FILES.bundleHtml)) {
    throw new Error(`找不到 HTML 文件: ${DIST_FILES.bundleHtml}（请先运行 npm run bundle）`);
  }

  console.log('📦 开始生成酒馆正则 JSON...');
  const htmlContent = fs.readFileSync(DIST_FILES.bundleHtml, 'utf-8');
  const replaceString = wrapHtmlAsCodeBlock(htmlContent);

  const written = [];
  for (const target of TARGETS) {
    const regexJson = createRegexScript({
      scriptName: target.scriptName,
      findRegex: target.findRegex,
      replaceString,
      placement: target.placement,
    });

    fs.writeFileSync(target.outFile, JSON.stringify(regexJson, null, 4), 'utf-8');
    const size = fs.statSync(target.outFile).size;
    console.log(`✅ 正则生成完毕: ${path.basename(target.outFile)} (大小: ${(size / 1024 / 1024).toFixed(2)} MB)`);
    written.push(target.outFile);
  }
  return written;
}

// 直接执行时运行；被 import 时仅导出函数
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildRegexArtifacts();
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
