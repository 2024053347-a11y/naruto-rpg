#!/usr/bin/env node
/**
 * sync-to-card.mjs — 将最新的 regex JSON 写入酒馆角色卡 PNG（一次性同步）
 *
 * 前置条件：先运行 `npm run bundle && npm run build-regex` 生成 dist 产物。
 * 行为（与历史 sync-to-card.cjs 保持一致）：
 *   1. 如配置了 MANUAL_EXPORT_DIR，复制一份 regex JSON 供手动导入
 *   2. 用最新 replaceString **整体重建** 角色卡的 regex_scripts 数组
 *      （只保留一条「正文-忍者手记」，会清掉卡上其他正则脚本——这是有意行为）
 *
 * 路径通过环境变量配置（见 scripts/lib/project-paths.mjs / .env.example）。
 * 用法: node scripts/sync-to-card.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  REGEX_TRIGGER_JSON,
  TAVERN_CARD_PATH,
  MANUAL_EXPORT_DIR,
  MANUAL_EXPORT_REGEX_NAME,
} from './lib/project-paths.mjs';
import { readTextChunks, replaceTextChunks, decodeCardPayload, encodeCardPayload } from './lib/png-card.mjs';
import { createRegexScript } from './lib/tavern-regex.mjs';
import { log } from './lib/logger.mjs';

/**
 * 步骤 1：复制 regex JSON 到手动导入目录（目录未配置或不存在则跳过）。
 * @returns {Promise<void>}
 */
async function exportForManualImport() {
  if (!MANUAL_EXPORT_DIR) {
    log('未配置 MANUAL_EXPORT_DIR，跳过手动导入目录同步', 'warn');
    return;
  }
  const dest = path.join(MANUAL_EXPORT_DIR, MANUAL_EXPORT_REGEX_NAME);
  try {
    await fs.copyFile(REGEX_TRIGGER_JSON, dest);
    log(`[1/2] regex JSON 已同步 → ${dest}`, 'sync');
  } catch (err) {
    // 手动导入是辅助功能，失败不应阻断角色卡更新
    log(`[1/2] 手动导入目录同步失败（已跳过）: ${err.message}`, 'warn');
  }
}

/**
 * 步骤 2：整体重建角色卡 ccv3 中的 regex_scripts。
 * @param {{ replaceString: string }} regexJson dist 中的正则产物
 * @returns {Promise<void>}
 */
async function updateCharacterCard(regexJson) {
  const png = await fs.readFile(TAVERN_CARD_PATH);

  const ccv3Value = readTextChunks(png).get('ccv3');
  if (!ccv3Value) {
    throw new Error(`角色卡中未找到 ccv3 数据: ${TAVERN_CARD_PATH}`);
  }

  const card = decodeCardPayload(ccv3Value);
  card.data ??= {};
  card.data.extensions ??= {};
  // 有意整体替换：该卡的正则脚本以 dist 产物为唯一事实来源
  card.data.extensions.regex_scripts = [
    createRegexScript({
      scriptName: '正文-忍者手记',
      findRegex: '起物',
      replaceString: regexJson.replaceString,
      placement: [2],
    }),
  ];

  const { base64 } = encodeCardPayload(card);
  const { png: newPng, replacedKeys } = replaceTextChunks(png, { ccv3: base64 });
  if (!replacedKeys.includes('ccv3')) {
    throw new Error('重建 PNG 时未能写入 ccv3 chunk');
  }

  await fs.writeFile(TAVERN_CARD_PATH, newPng);
  log(`[2/2] 角色卡 PNG 已更新 → ${TAVERN_CARD_PATH}`, 'success');
}

async function main() {
  let regexJson;
  try {
    regexJson = JSON.parse(await fs.readFile(REGEX_TRIGGER_JSON, 'utf-8'));
  } catch (err) {
    throw new Error(`读取 dist 正则产物失败（请先运行 npm run build-regex）: ${err.message}`);
  }

  await exportForManualImport();
  await updateCharacterCard(regexJson);
}

main().catch((err) => {
  log(err.message, 'error');
  process.exitCode = 1;
});
