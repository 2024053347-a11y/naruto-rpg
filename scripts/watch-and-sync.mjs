#!/usr/bin/env node
/**
 * watch-and-sync.mjs — 忍者手记 · 酒馆实时映射
 * 监听项目源码变化，自动打包并同步到酒馆。
 *
 * 用法: node scripts/watch-and-sync.mjs  （或 npm run watch）
 *
 * 流程：
 *   1. 监听 js/css/img/index.html 变化（防抖合并连续保存）
 *   2. 自动执行 bundle + build-regex
 *   3. 将生成的 regex JSON 同步到酒馆角色卡 PNG（更新已有脚本或追加）
 *   4. 如配置了 MANUAL_EXPORT_DIR，另存一份 JSON 供手动导入
 *
 * 酒馆目录等外部路径通过环境变量配置（见 .env.example）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import {
  PROJECT_ROOT,
  TAVERN_DIR,
  TAVERN_CARD_PATH,
  TAVERN_CARD_NAME,
  REGEX_TRIGGER_JSON,
  MANUAL_EXPORT_DIR,
  MANUAL_EXPORT_REGEX_NAME,
} from './lib/project-paths.mjs';
import { readTextChunks, replaceTextChunks, decodeCardPayload, encodeCardPayload } from './lib/png-card.mjs';
import { log } from './lib/logger.mjs';

// ═══════════════════════════════════
// 配置
// ═══════════════════════════════════
const CONFIG = {
  /** 监听的文件/目录（相对项目根目录） */
  watchTargets: ['js', 'css', 'img', 'index.html'],
  /** 忽略的文件模式 */
  ignorePatterns: [/node_modules/, /\.git/, /dist/, /test\.html/, /test\.js/, /\.bak$/],
  /** 防抖延迟（毫秒）— 文件变更后等待此时间再打包，合并编辑器的连续保存 */
  debounceMs: 800,
  /** 是否同步到角色卡 PNG */
  syncToPNG: process.env.SYNC_TO_PNG !== 'false',
  /** 是否显示详细日志 */
  verbose: true,
  /** 单步构建超时（毫秒） */
  bundleTimeoutMs: 30_000,
  regexTimeoutMs: 10_000,
};

const BUILD_STEPS = [
  { name: 'bundle', script: path.join(PROJECT_ROOT, 'scripts', 'bundle.mjs'), timeout: CONFIG.bundleTimeoutMs },
  { name: 'build-regex', script: path.join(PROJECT_ROOT, 'scripts', 'build-regex.mjs'), timeout: CONFIG.regexTimeoutMs },
];

// ═══════════════════════════════════
// 打包
// ═══════════════════════════════════
/** @returns {boolean} 全部构建步骤是否成功 */
function runBuild() {
  log('开始打包...', 'info');
  const start = Date.now();

  for (const step of BUILD_STEPS) {
    try {
      // execFileSync 传参数组，路径含空格/特殊字符时不会被 shell 二次解释
      execFileSync(process.execPath, [step.script], {
        cwd: PROJECT_ROOT,
        stdio: CONFIG.verbose ? 'pipe' : 'ignore',
        timeout: step.timeout,
      });
    } catch (err) {
      log(`打包失败（${step.name}）: ${err.message}`, 'error');
      if (CONFIG.verbose && err.stderr) console.error(err.stderr.toString());
      return false;
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`打包完成 (${elapsed}s)`, 'success');
  return true;
}

// ═══════════════════════════════════
// 同步到酒馆
// ═══════════════════════════════════
/** @returns {boolean} 同步是否成功 */
function syncToTavern() {
  if (!fs.existsSync(REGEX_TRIGGER_JSON)) {
    log('dist regex 文件不存在，跳过同步', 'error');
    return false;
  }

  try {
    const regexJson = JSON.parse(fs.readFileSync(REGEX_TRIGGER_JSON, 'utf-8'));

    if (CONFIG.syncToPNG) {
      syncToCharCard(regexJson);
    }

    // 另存一份独立 JSON 到手动导入目录（未配置或不存在则静默跳过）
    if (MANUAL_EXPORT_DIR && fs.existsSync(MANUAL_EXPORT_DIR)) {
      const dest = path.join(MANUAL_EXPORT_DIR, MANUAL_EXPORT_REGEX_NAME);
      fs.copyFileSync(REGEX_TRIGGER_JSON, dest);
      log(`已同步: regex JSON → ${dest}`, 'sync');
    }

    return true;
  } catch (err) {
    log(`同步失败: ${err.message}`, 'error');
    return false;
  }
}

/**
 * 更新角色卡 PNG 中的正则脚本：
 * 已存在「忍者手记」脚本则原地更新 findRegex/replaceString，否则追加一条。
 * （与 sync-to-card.mjs 的“整体重建”不同，watch 模式保留卡上其他正则脚本。）
 * @param {{ findRegex: string, replaceString: string }} regexJson
 */
function syncToCharCard(regexJson) {
  if (!fs.existsSync(TAVERN_CARD_PATH)) {
    log(`角色卡不存在: ${TAVERN_CARD_PATH}（可通过 TAVERN_DIR/TAVERN_CARD_NAME 环境变量配置）`, 'error');
    return;
  }

  const pngData = fs.readFileSync(TAVERN_CARD_PATH);
  const ccv3Value = readTextChunks(pngData).get('ccv3');
  if (!ccv3Value) {
    log('角色卡中未找到 ccv3 数据', 'error');
    return;
  }

  const card = decodeCardPayload(ccv3Value);
  card.data ??= {};
  card.data.extensions ??= {};
  card.data.extensions.regex_scripts ??= [];

  const existing = card.data.extensions.regex_scripts.find(
    (script) => script.scriptName && script.scriptName.includes('忍者手记')
  );
  if (existing) {
    existing.findRegex = regexJson.findRegex;
    existing.replaceString = regexJson.replaceString;
  } else {
    card.data.extensions.regex_scripts.push({
      ...regexJson,
      scriptName: '正文-忍者手记',
    });
  }

  const { json, base64 } = encodeCardPayload(card);
  // 历史行为：ccv3 写 base64，chara 写明文 JSON（如卡上存在 chara chunk）
  const { png: newPNG } = replaceTextChunks(pngData, {
    ccv3: base64,
    chara: Buffer.from(json, 'utf-8'),
  });
  fs.writeFileSync(TAVERN_CARD_PATH, newPNG);

  log(`已同步: 角色卡 PNG → ${TAVERN_CARD_NAME}`, 'sync');
}

// ═══════════════════════════════════
// 文件监听（防抖 + 构建期间变更重新排队，保证不丢失任何一次变更）
// ═══════════════════════════════════
let debounceTimer = null;
let isBuilding = false;
let rebuildQueued = false;

function scheduleBuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runBuildCycle, CONFIG.debounceMs);
}

function runBuildCycle() {
  if (isBuilding) {
    // 构建期间又有变更：排队待本轮结束后再跑一轮，而不是直接丢弃
    rebuildQueued = true;
    return;
  }
  isBuilding = true;
  try {
    const ok = runBuild();
    if (ok) syncToTavern();
  } finally {
    isBuilding = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      scheduleBuild();
    }
  }
}

function shouldIgnore(filePath) {
  const rel = path.relative(PROJECT_ROOT, filePath);
  return CONFIG.ignorePatterns.some((pattern) => pattern.test(rel));
}

/** @returns {fs.FSWatcher[]} 已启动的 watcher 列表（用于退出时清理） */
function startWatching() {
  const watchers = [];

  for (const target of CONFIG.watchTargets) {
    const fullPath = path.resolve(PROJECT_ROOT, target);
    if (!fs.existsSync(fullPath)) {
      log(`目录不存在: ${fullPath}`, 'error');
      continue;
    }

    const isDirectory = fs.statSync(fullPath).isDirectory();
    const watcher = fs.watch(
      fullPath,
      isDirectory ? { recursive: true } : undefined,
      (eventType, filename) => {
        const changedPath = filename ? path.join(fullPath, filename) : fullPath;
        if (isDirectory && shouldIgnore(changedPath)) return;
        if (CONFIG.verbose) {
          log(`${eventType}: ${path.relative(PROJECT_ROOT, changedPath)}`, 'watch');
        }
        scheduleBuild();
      }
    );
    watchers.push(watcher);
  }

  log('开始监听项目文件变化...', 'watch');
  log('按 Ctrl+C 退出', 'info');
  return watchers;
}

// ═══════════════════════════════════
// 主入口
// ═══════════════════════════════════
function main() {
  console.log('');
  console.log('  ═══════════════════════════════════════');
  console.log('  忍者手记 — 酒馆实时映射');
  console.log('  ═══════════════════════════════════════');
  console.log('');
  console.log(`  项目目录: ${PROJECT_ROOT}`);
  console.log(`  酒馆目录: ${TAVERN_DIR}`);
  console.log(`  防抖延迟: ${CONFIG.debounceMs}ms`);
  console.log(`  同步角色卡: ${CONFIG.syncToPNG ? '是' : '否'}`);
  console.log('');

  // 首次全量打包
  const ok = runBuild();
  if (ok) syncToTavern();

  const watchers = startWatching();

  process.on('SIGINT', () => {
    log('收到退出信号，停止监听', 'info');
    clearTimeout(debounceTimer);
    for (const watcher of watchers) watcher.close();
    process.exit(0);
  });
}

main();
