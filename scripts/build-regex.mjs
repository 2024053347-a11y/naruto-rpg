#!/usr/bin/env node
/**
 * build-regex.mjs — 将单文件打包产物包装为酒馆正则 JSON
 *
 * 前置条件：先运行 `npm run bundle` 生成 dist/naruto-rpg-bundle.html。
 * 产出两份正则（内容一致，仅触发器与 placement 不同）：
 *   1. 起物单文件版 — 仅由「起物」触发，注入 AI 输出（placement [2]）
 *   2. 单文件全量版 — 捕获组触发，注入用户输入 + AI 输出（placement [1, 2]）
 *
 * 用法: node scripts/build-regex.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { BUNDLE_HTML, REGEX_TRIGGER_JSON, REGEX_FULL_JSON } from './lib/project-paths.mjs';
import { createRegexScript, wrapHtmlAsReplaceString } from './lib/tavern-regex.mjs';
import { log } from './lib/logger.mjs';

/** 两份产物仅在这三个字段上有差异，集中声明便于对照 */
const TARGETS = [
  {
    outFile: REGEX_TRIGGER_JSON,
    scriptName: '正文-忍者手记-起物单文件版',
    findRegex: '起物',
    placement: [2],
  },
  {
    outFile: REGEX_FULL_JSON,
    scriptName: '正文-忍者手记(单文件全量版)',
    findRegex: '(起物)',
    placement: [1, 2],
  },
];

async function main() {
  let htmlContent;
  try {
    htmlContent = await fs.readFile(BUNDLE_HTML, 'utf-8');
  } catch {
    log(`找不到 HTML 文件: ${BUNDLE_HTML}，请先运行 npm run bundle`, 'error');
    process.exitCode = 1;
    return;
  }

  log('开始生成酒馆正则 JSON...');
  const replaceString = wrapHtmlAsReplaceString(htmlContent);

  for (const { outFile, ...scriptFields } of TARGETS) {
    const regexScript = createRegexScript({ ...scriptFields, replaceString });
    // 4 空格缩进为既有产物格式，保持不变
    await fs.writeFile(outFile, JSON.stringify(regexScript, null, 4), 'utf-8');
    const { size } = await fs.stat(outFile);
    log(`正则生成完毕: ${path.basename(outFile)} (大小: ${(size / 1024 / 1024).toFixed(2)} MB)`, 'success');
  }
}

main().catch((err) => {
  log(`生成失败: ${err.message}`, 'error');
  process.exitCode = 1;
});
