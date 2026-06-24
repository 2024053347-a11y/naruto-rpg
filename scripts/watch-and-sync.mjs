#!/usr/bin/env node
/**
 * 忍者手记 — 酒馆实时映射脚本
 * 监听项目源码变化，自动打包并同步到酒馆
 *
 * 用法: node scripts/watch-and-sync.mjs
 *
 * 功能：
 *   1. 监听 js/css/img/index.html 文件变化
 *   2. 自动执行 bundle + build-regex
 *   3. 将生成的 regex JSON 同步到酒馆目录
 *   4. 可选：自动更新角色卡 PNG
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ═══════════════════════════════════
// 配置
// ═══════════════════════════════════
const CONFIG = {
  // 监听的文件/目录（相对于项目根目录）
  watchDirs: ['js', 'css', 'img', 'index.html'],

  // 忽略的文件模式
  ignorePatterns: [/node_modules/, /\.git/, /dist/, /test\.html/, /test\.js/, /\.bak$/],

  // 酒馆安装目录（根据实际情况修改）
  tavernDir: 'D:/SillyTavern/SillyTavern',

  // 防抖延迟（毫秒）— 文件变更后等待此时间再打包
  debounceMs: 800,

  // 是否同步到角色卡 PNG
  syncToPNG: true,

  // 角色卡文件名
  charCardName: '忍者手记.png',

  // 是否显示详细日志
  verbose: true,
};

// ═══════════════════════════════════
// 路径
// ═══════════════════════════════════
const PATHS = {
  bundle: path.join(ROOT, 'scripts', 'bundle.mjs'),
  buildRegex: path.join(ROOT, 'scripts', 'build-regex.mjs'),
  distHtml: path.join(ROOT, 'dist', 'naruto-rpg-bundle.html'),
  distRegex: path.join(ROOT, 'dist', 'regex-正文-火影忍者-起物单文件版.json'),
  tavernChars: path.join(CONFIG.tavernDir, 'data', 'default-user', 'characters'),
  tavernWorlds: path.join(CONFIG.tavernDir, 'data', 'default-user', 'worlds'),
};

// ═══════════════════════════════════
// 工具函数
// ═══════════════════════════════════
function log(msg, type = 'info') {
  const icons = { info: '📦', success: '✅', error: '❌', watch: '👁️', sync: '🔄' };
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${time}] ${icons[type] || '•'} ${msg}`);
}

function shouldIgnore(filePath) {
  const rel = path.relative(ROOT, filePath);
  return CONFIG.ignorePatterns.some(p => p.test(rel));
}

// ═══════════════════════════════════
// 打包
// ═══════════════════════════════════
function runBuild() {
  log('开始打包...', 'info');
  const start = Date.now();

  try {
    // 1. Bundle HTML
    execSync(`node "${PATHS.bundle}"`, {
      cwd: ROOT,
      stdio: CONFIG.verbose ? 'pipe' : 'ignore',
      timeout: 30000,
    });

    // 2. Build regex JSON
    execSync(`node "${PATHS.buildRegex}"`, {
      cwd: ROOT,
      stdio: CONFIG.verbose ? 'pipe' : 'ignore',
      timeout: 10000,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`打包完成 (${elapsed}s)`, 'success');
    return true;
  } catch (err) {
    log(`打包失败: ${err.message}`, 'error');
    if (CONFIG.verbose) console.error(err.stderr?.toString() || err.message);
    return false;
  }
}

// ═══════════════════════════════════
// 同步到酒馆
// ═══════════════════════════════════
function syncToTavern() {
  if (!fs.existsSync(PATHS.distRegex)) {
    log('dist regex 文件不存在，跳过同步', 'error');
    return false;
  }

  try {
    // 1. 复制 regex JSON 到酒馆字符目录（作为独立正则文件）
    const regexContent = fs.readFileSync(PATHS.distRegex, 'utf-8');
    const regexJson = JSON.parse(regexContent);

    // 2. 同步到角色卡 PNG
    if (CONFIG.syncToPNG) {
      syncToCharCard(regexJson);
    }

    // 3. 保存一份独立的 regex JSON 到 忍者手记 下载目录方便手动导入
    const manualImportDir = path.join(ROOT, '..', '..', '忍者手记');
    if (fs.existsSync(manualImportDir)) {
      const destRegex = path.join(manualImportDir, 'regex-正文-忍者手记.json');
      fs.copyFileSync(PATHS.distRegex, destRegex);
      log(`已同步: regex JSON → ${path.relative(ROOT, destRegex)}`, 'sync');
    }

    return true;
  } catch (err) {
    log(`同步失败: ${err.message}`, 'error');
    return false;
  }
}

function syncToCharCard(regexJson) {
  const cardPath = path.join(PATHS.tavernChars, CONFIG.charCardName);
  if (!fs.existsSync(cardPath)) {
    log(`角色卡不存在: ${cardPath}`, 'error');
    return;
  }

  // 读取 PNG 中的 ccv3 数据
  const pngData = fs.readFileSync(cardPath);
  const texts = extractPNGTexts(pngData);
  if (!texts.ccv3) {
    log('角色卡中未找到 ccv3 数据', 'error');
    return;
  }

  // 解码 ccv3
  const raw = Buffer.from(texts.ccv3, 'base64').toString('utf-8');
  const card = JSON.parse(raw);

  // 更新 regex_scripts
  if (!card.data) card.data = {};
  if (!card.data.extensions) card.data.extensions = {};
  if (!card.data.extensions.regex_scripts) card.data.extensions.regex_scripts = [];

  // 查找并更新或添加正则脚本
  const existing = card.data.extensions.regex_scripts.find(
    r => r.scriptName && r.scriptName.includes('忍者手记')
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

  // 重新编码
  const newRaw = JSON.stringify(card, null, 2);
  const newCCv3 = Buffer.from(newRaw, 'utf-8').toString('base64');

  // 重建 PNG
  const newPNG = rebuildPNG(pngData, { ccv3: newCCv3, chara: newRaw });
  fs.writeFileSync(cardPath, newPNG);

  log(`已同步: 角色卡 PNG → ${CONFIG.charCardName}`, 'sync');
}

// PNG 工具函数
function extractPNGTexts(buffer) {
  const texts = {};
  let pos = 8; // skip PNG signature
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.slice(pos + 4, pos + 8).toString('ascii');
    const data = buffer.slice(pos + 8, pos + 8 + length);

    if (type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      const key = data.slice(0, nullIdx).toString('latin1');
      const value = data.slice(nullIdx + 1);
      texts[key] = value.toString('latin1');
    }

    pos += 12 + length;
  }
  return texts;
}

function rebuildPNG(original, texts) {
  const signature = original.slice(0, 8);
  const chunks = [];

  let pos = 8;
  while (pos < original.length) {
    const length = original.readUInt32BE(pos);
    const type = original.slice(pos + 4, pos + 8).toString('ascii');
    const data = original.slice(pos + 8, pos + 8 + length);
    const crc = original.slice(pos + 8 + length, pos + 12 + length);
    chunks.push({ type, data, crc });
    pos += 12 + length;
  }

  const result = [signature];
  for (const chunk of chunks) {
    let data = chunk.data;
    if (chunk.type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      const key = data.slice(0, nullIdx).toString('latin1');
      if (texts[key] != null) {
        const newValue = Buffer.from(texts[key], 'utf-8');
        data = Buffer.concat([Buffer.from(key + '\0', 'latin1'), newValue]);
      }
    }
    // Recalculate CRC
    const crcInput = Buffer.concat([Buffer.from(chunk.type, 'ascii'), data]);
    const newCRC = crc32(crcInput);

    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(newCRC);

    result.push(lenBuf, Buffer.from(chunk.type, 'ascii'), data, crcBuf);
  }

  return Buffer.concat(result);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ═══════════════════════════════════
// 文件监听
// ═══════════════════════════════════
let debounceTimer = null;
let isBuilding = false;

function scheduleBuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (isBuilding) return;
    isBuilding = true;
    const ok = runBuild();
    if (ok) syncToTavern();
    isBuilding = false;
  }, CONFIG.debounceMs);
}

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

function watchDir(dirPath) {
  fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(dirPath, filename);
    if (shouldIgnore(fullPath)) return;

    if (CONFIG.verbose) {
      const rel = path.relative(ROOT, fullPath);
      log(`${eventType}: ${rel}`, 'watch');
    }
    scheduleBuild();
  });
}

function watchFile(filePath) {
  fs.watch(filePath, (eventType) => {
    if (CONFIG.verbose) {
      log(`${eventType}: ${path.relative(ROOT, filePath)}`, 'watch');
    }
    scheduleBuild();
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
  console.log(`  酒馆目录: ${CONFIG.tavernDir}`);
  console.log(`  防抖延迟: ${CONFIG.debounceMs}ms`);
  console.log(`  同步角色卡: ${CONFIG.syncToPNG ? '是' : '否'}`);
  console.log('');

  // 首次打包
  const ok = runBuild();
  if (ok) syncToTavern();

  // 开始监听
  startWatching();
}

main();
