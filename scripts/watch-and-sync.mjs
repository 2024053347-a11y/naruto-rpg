#!/usr/bin/env node
// @ts-check
/**
 * 忍者手记 — 酒馆实时映射脚本
 * 监听项目源码变化，自动打包并同步到酒馆
 *
 * 用法: node scripts/watch-and-sync.mjs
 *
 * 功能：
 *   1. 监听 js/css/img/index.html 文件变化
 *   2. 自动执行 bundle + build-regex（子进程隔离：构建崩溃不影响监听进程，
 *      且对构建脚本自身的修改在下次构建即生效，无 ESM 模块缓存问题）
 *   3. 将生成的 regex JSON 同步到酒馆目录
 *   4. 可选：自动更新角色卡 PNG
 *
 * 酒馆路径通过环境变量配置（TAVERN_DIR 等，见 .env.example）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT, DIST_FILES } from './lib/paths.mjs';
import { resolveSyncConfig } from './lib/sync-config.mjs';
import { writeRegexToCard } from './lib/card-sync.mjs';
import { log } from './lib/logger.mjs';

// ═══════════════════════════════════
// 配置
// ═══════════════════════════════════
const SYNC = resolveSyncConfig();

const CONFIG = Object.freeze({
  /** 监听的文件/目录（相对于项目根目录） */
  watchDirs: ['js', 'css', 'img', 'index.html'],

  /** 忽略的文件模式 */
  ignorePatterns: [/node_modules/, /\.git/, /dist/, /test\.html/, /test\.js/, /\.bak$/],

  /** 防抖延迟（毫秒）— 文件变更后等待此时间再打包 */
  debounceMs: 800,

  /** 是否同步到角色卡 PNG */
  syncToPNG: true,

  /** 是否显示详细日志 */
  verbose: true,
});

const BUILD_SCRIPTS = Object.freeze([
  { file: path.join(ROOT, 'scripts', 'bundle.mjs'), timeout: 30_000 },
  { file: path.join(ROOT, 'scripts', 'build-regex.mjs'), timeout: 10_000 },
]);

// ═══════════════════════════════════
// 工具函数
// ═══════════════════════════════════
/** @param {string} filePath */
function shouldIgnore(filePath) {
  const rel = path.relative(ROOT, filePath);
  return CONFIG.ignorePatterns.some((p) => p.test(rel));
}

// ═══════════════════════════════════
// 打包
// ═══════════════════════════════════
/**
 * 依次运行 bundle 与 build-regex。
 * @returns {boolean} 是否全部成功
 */
function runBuild() {
  log('开始打包...', 'info');
  const start = Date.now();

  try {
    for (const { file, timeout } of BUILD_SCRIPTS) {
      // execFileSync + process.execPath：不经过 shell（路径含中文/空格也安全），
      // 并复用当前 Node 可执行文件，不依赖 PATH 里的 node
      execFileSync(process.execPath, [file], {
        cwd: ROOT,
        stdio: CONFIG.verbose ? 'pipe' : 'ignore',
        timeout,
      });
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`打包完成 (${elapsed}s)`, 'success');
    return true;
  } catch (err) {
    log(`打包失败: ${err instanceof Error ? err.message : err}`, 'error');
    if (CONFIG.verbose && err && typeof err === 'object' && 'stderr' in err) {
      console.error(/** @type {any} */ (err).stderr?.toString() || '');
    }
    return false;
  }
}

// ═══════════════════════════════════
// 同步到酒馆
// ═══════════════════════════════════
/**
 * 将最新 regex JSON 同步到角色卡与手动导入目录。
 * @returns {boolean} 是否成功
 */
function syncToTavern() {
  if (!fs.existsSync(DIST_FILES.regexQiwuTrigger)) {
    log('dist regex 文件不存在，跳过同步', 'error');
    return false;
  }

  try {
    const regexJson = JSON.parse(fs.readFileSync(DIST_FILES.regexQiwuTrigger, 'utf-8'));

    // 1. 同步到角色卡 PNG（按脚本名 upsert；同时回写 chara 块，历史行为，见 card-sync.mjs）
    if (CONFIG.syncToPNG) {
      writeRegexToCard(
        SYNC.cardPath,
        { ...regexJson, scriptName: '正文-忍者手记' },
        { mode: 'upsert', updateCharaChunk: true }
      );
      log(`已同步: 角色卡 PNG → ${SYNC.cardName}`, 'sync');
    }

    // 2. 保存一份独立的 regex JSON 到手动导入目录，方便手动导入
    if (SYNC.manualExportDir && SYNC.manualExportFile && fs.existsSync(SYNC.manualExportDir)) {
      fs.copyFileSync(DIST_FILES.regexQiwuTrigger, SYNC.manualExportFile);
      log(`已同步: regex JSON → ${SYNC.manualExportFile}`, 'sync');
    }

    return true;
  } catch (err) {
    log(`同步失败: ${err instanceof Error ? err.message : err}`, 'error');
    return false;
  }
}

// ═══════════════════════════════════
// 文件监听
// ═══════════════════════════════════
/** @type {NodeJS.Timeout | null} */
let debounceTimer = null;
let isBuilding = false;
let rebuildQueued = false;

function scheduleBuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (isBuilding) {
      // 构建期间到达的变更不丢弃，构建结束后补一轮（旧版直接丢弃）
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
  }, CONFIG.debounceMs);
}

/** @type {fs.FSWatcher[]} */
const watchers = [];

function startWatching() {
  for (const dir of CONFIG.watchDirs) {
    const fullPath = path.resolve(ROOT, dir);
    if (!fs.existsSync(fullPath)) {
      log(`目录不存在: ${fullPath}`, 'error');
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      watchDir(fullPath);
    } else if (stat.isFile()) {
      watchFile(fullPath);
    }
  }

  log('开始监听项目文件变化...', 'watch');
  log('按 Ctrl+C 退出', 'info');
}

/** @param {string} dirPath */
function watchDir(dirPath) {
  const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(dirPath, filename);
    if (shouldIgnore(fullPath)) return;

    if (CONFIG.verbose) {
      log(`${eventType}: ${path.relative(ROOT, fullPath)}`, 'watch');
    }
    scheduleBuild();
  });
  watchers.push(watcher);
}

/** @param {string} filePath */
function watchFile(filePath) {
  const watcher = fs.watch(filePath, (eventType) => {
    if (CONFIG.verbose) {
      log(`${eventType}: ${path.relative(ROOT, filePath)}`, 'watch');
    }
    scheduleBuild();
  });
  watchers.push(watcher);
}

/** Ctrl+C 时释放监听句柄后干净退出 */
function setupGracefulShutdown() {
  process.on('SIGINT', () => {
    log('收到退出信号，停止监听', 'info');
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const watcher of watchers) watcher.close();
    process.exit(0);
  });
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
  console.log(`  项目目录: ${ROOT}`);
  console.log(`  酒馆目录: ${SYNC.tavernDir}`);
  console.log(`  防抖延迟: ${CONFIG.debounceMs}ms`);
  console.log(`  同步角色卡: ${CONFIG.syncToPNG ? '是' : '否'}`);
  console.log('');

  setupGracefulShutdown();

  // 首次打包
  const ok = runBuild();
  if (ok) syncToTavern();

  // 开始监听
  startWatching();
}

main();
