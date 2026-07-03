#!/usr/bin/env node
// @ts-check
/**
 * 忍者手记 — 一次性同步脚本
 * 将 dist 中最新的 regex JSON：
 *   1. 复制到手动导入目录（供酒馆手动导入）
 *   2. 写入 SillyTavern 角色卡 PNG 的 ccv3 元数据（整体覆盖 regex_scripts）
 *
 * 用法: node scripts/sync-to-card.mjs
 * 路径通过环境变量配置（TAVERN_DIR / TAVERN_USER / TAVERN_CARD_NAME /
 * MANUAL_EXPORT_DIR，见 .env.example），未配置时回退到历史默认路径。
 *
 * 本文件取代旧的 sync-to-card.cjs（CommonJS），行为保持一致，
 * 差异仅在：路径可配置、缺失目录时优雅跳过而非崩溃、错误信息更明确。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIST_FILES } from './lib/paths.mjs';
import { resolveSyncConfig } from './lib/sync-config.mjs';
import { writeRegexToCard } from './lib/card-sync.mjs';
import { createRegexScript } from './lib/tavern-regex.mjs';
import { log } from './lib/logger.mjs';

/**
 * 执行一次完整同步。
 * @returns {void}
 */
export function syncToCard() {
  if (!fs.existsSync(DIST_FILES.regexQiwuTrigger)) {
    throw new Error(
      `找不到 regex JSON: ${DIST_FILES.regexQiwuTrigger}\n` +
      '请先运行: npm run bundle && npm run build-regex'
    );
  }
  const distRegex = JSON.parse(fs.readFileSync(DIST_FILES.regexQiwuTrigger, 'utf-8'));
  const config = resolveSyncConfig();

  // 1. 复制 regex JSON 到手动导入目录
  if (config.manualExportFile && fs.existsSync(/** @type {string} */ (config.manualExportDir))) {
    fs.copyFileSync(DIST_FILES.regexQiwuTrigger, config.manualExportFile);
    log(`[1/2] regex JSON 已同步 → ${config.manualExportFile}`, 'sync');
  } else {
    log('[1/2] 未配置手动导入目录（MANUAL_EXPORT_DIR），跳过副本导出', 'warn');
  }

  // 2. 写入角色卡 PNG（整体覆盖 regex_scripts，与旧 sync-to-card.cjs 行为一致）
  const script = createRegexScript({
    scriptName: '正文-忍者手记',
    findRegex: '起物',
    replaceString: distRegex.replaceString,
    placement: [2],
  });
  writeRegexToCard(config.cardPath, script, { mode: 'replace-all' });
  log(`[2/2] 角色卡 PNG 已更新 → ${config.cardPath}`, 'success');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    syncToCard();
  } catch (err) {
    log(`同步失败: ${err instanceof Error ? err.message : err}`, 'error');
    process.exitCode = 1;
  }
}
