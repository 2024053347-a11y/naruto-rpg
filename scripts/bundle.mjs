#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════
 *   忍者手记 — 单文件打包脚本 v2.1
 *   将整个 naruto-rpg 项目打包为单个自包含 HTML：
 *   解析 ES Module 依赖图 → 拓扑排序 → 剥离 import/export →
 *   合并为 IIFE，图片内联为 base64，可独立运行。
 *   用法: node scripts/bundle.mjs  （或 npm run bundle）
 * ═══════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { PROJECT_ROOT as ROOT, DIST_DIR, BUNDLE_HTML } from './lib/project-paths.mjs';

// ── 配置 ──────────────────────────────────
const CONFIG = {
  entryHtml: path.join(ROOT, 'index.html'),
  entryJs: path.join(ROOT, 'js', 'app.js'),
  // 顺序即层叠顺序：tokens（变量）→ layout（骨架）→ components（皮肤）
  cssFiles: [
    path.join(ROOT, 'css', 'tokens.css'),
    path.join(ROOT, 'css', 'layout.css'),
    path.join(ROOT, 'css', 'components.css'),
  ],
  svgIcons: path.join(ROOT, 'img', 'icons.svg'),
  outDir: DIST_DIR,
  outFile: BUNDLE_HTML,
};

/**
 * 走外部图床而非 base64 内联的大图（首页背景等）：
 * 内联会让单文件体积暴涨且这些图对离线运行非必需。
 * 键为源码中引用的相对路径，值为图床 URL。
 */
const EXTERNAL_IMAGE_URLS = new Map([
  ['img/logo-text.png', 'https://i.postimg.cc/HxrmZwpz/file-000000001608720ba6b31150e6493597.png'],
  ['img/bg-home-pc.png', 'https://i.postimg.cc/0j14YDrB/file-00000000d184720bb5b33b578c88aed8.png'], // PC端背景
  ['img/bg-home.png', 'https://i.postimg.cc/FRYvWy9P/ren-zhe-ri-ji.png'], // 移动端背景
]);

/** 必须离线可用、以 base64 内联进单文件的本地资源 */
const INLINE_IMAGE_PATHS = ['assets/map.jpg'];

// ── MIME 类型映射 ──────────────────────────
const MIME_MAP = Object.freeze({
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
});

// ── 工具函数 ──────────────────────────────
/** @param {string} filepath @returns {string} */
function readFile(filepath) {
  return fs.readFileSync(filepath, 'utf-8');
}

/** 统一为正斜杠，保证依赖图的 key 在 Windows/Unix 上一致 @param {string} p */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * 解析相对 import 为绝对文件路径（无扩展名时补 .js）。
 * @param {string} importPath import 语句中的路径
 * @param {string} fromFile 发起 import 的文件
 * @returns {string}
 */
function resolveModulePath(importPath, fromFile) {
  let resolved = path.resolve(path.dirname(fromFile), importPath);
  if (!path.extname(resolved)) {
    resolved += '.js';
  }
  return resolved;
}

/**
 * 将图片文件转为 base64 data URI。
 * @param {string} filePath
 * @returns {string|null} 文件缺失或类型未知时返回 null（打包继续，仅告警）
 */
function imageToDataURI(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ 图片不存在: ${filePath}`);
    return null;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) {
    console.warn(`  ⚠ 未知图片类型: ${ext} (${filePath})`);
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  console.log(`     📎 ${normalizePath(path.relative(ROOT, filePath))} (${(buffer.length / 1024).toFixed(0)} KB → ${(base64.length / 1024).toFixed(0)} KB base64)`);
  return `data:${mime};base64,${base64}`;
}

/**
 * 构建资源路径 → URI 映射表（外部图床链接 + base64 内联）。
 * @returns {Map<string, string>}
 */
function buildAssetMap() {
  const assetMap = new Map(EXTERNAL_IMAGE_URLS);

  for (const relPath of INLINE_IMAGE_PATHS) {
    const dataURI = imageToDataURI(path.join(ROOT, relPath));
    if (dataURI) {
      assetMap.set(relPath, dataURI);
    }
  }

  return assetMap;
}

// ── 第一步：解析所有 JS 模块的依赖图 ──────
/**
 * 提取单个文件的相对 import 依赖（绝对路径列表）。
 * @param {string} filePath
 * @returns {string[]}
 */
function parseImports(filePath) {
  const content = readFile(filePath);
  const imports = [];
  const importRegex = /^\s*import\s+(?:(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // 仅处理项目内相对/绝对路径导入；裸模块名（npm 包）不参与打包
    if (importPath.startsWith('.') || importPath.startsWith('/')) {
      const resolvedPath = resolveModulePath(importPath, filePath);
      if (fs.existsSync(resolvedPath)) {
        imports.push(resolvedPath);
      } else {
        console.warn(`  ⚠ 警告: 找不到模块 "${importPath}" (从 ${path.relative(ROOT, filePath)})`);
      }
    }
  }

  return imports;
}

/**
 * 从入口出发 BFS 收集完整依赖图。
 * @param {string} entryFile
 * @returns {Map<string, string[]>} 文件（normalized）→ 依赖列表
 */
function buildDependencyGraph(entryFile) {
  const graph = new Map();
  const visited = new Set();
  const queue = [entryFile];

  while (queue.length > 0) {
    const file = queue.shift();
    const normalized = normalizePath(file);

    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const deps = parseImports(file);
    graph.set(normalized, deps.map(normalizePath));

    for (const dep of deps) {
      if (!visited.has(normalizePath(dep))) {
        queue.push(dep);
      }
    }
  }

  return graph;
}

// ── 第二步：拓扑排序 ──────────────────────
/**
 * DFS 后序拓扑排序：被依赖者排在前，保证合并后先定义再使用。
 * 循环依赖不致命（函数提升可救），仅告警并按已访问处理。
 * @param {Map<string, string[]>} graph
 * @returns {string[]}
 */
function topologicalSort(graph) {
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function dfs(node) {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      console.warn(`  ⚠ 检测到循环依赖: ${path.relative(ROOT, node)}`);
      return;
    }

    visiting.add(node);
    for (const dep of graph.get(node) || []) {
      dfs(dep);
    }
    visiting.delete(node);
    visited.add(node);
    sorted.push(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  return sorted;
}

// ── 第三步：清除 import/export 语句 ──────
/**
 * 剥离 ES Module 语法，使各模块能在同一个 IIFE 作用域内直接拼接。
 * @param {string} code
 * @param {string} filePath 用于解析 CSS import 的相对路径
 * @returns {string}
 */
function stripImportsExports(code, filePath) {
  let result = code;

  // CSS import 拦截：转为内联字符串常量（当前 js/ 下暂无此用法，
  // 保留以兼容未来的 `import styles from './x.css'` 组件样式写法）
  result = result.replace(/^\s*import\s+(\w+)\s+from\s+['"]([^'"]+\.css)['"]\s*;?\s*$/gm, (match, varName, cssPath) => {
    try {
      const fullPath = path.resolve(path.dirname(filePath), cssPath);
      let cssContent = fs.readFileSync(fullPath, 'utf-8');
      // 简易压缩：先折叠空白使注释变为单行，再移除注释（顺序不可颠倒）
      cssContent = cssContent.replace(/\s+/g, ' ').replace(/\/\*.*?\*\//g, '').trim();
      return `const ${varName} = \`${cssContent}\`;`;
    } catch(e) {
      console.warn(`  ⚠ Failed to inline CSS module: ${cssPath} at ${filePath}`);
      return match;
    }
  });

  // 移除 import 语句
  result = result.replace(/^\s*import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  result = result.replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');

  // 处理 export：保留声明本体，仅剥掉 export 关键字
  result = result.replace(/^\s*export\s+default\s+(class|function)\s/gm, '$1 ');
  result = result.replace(/^\s*export\s+default\s+/gm, '/* export default */ ');
  result = result.replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '');
  result = result.replace(/^\s*export\s+(const|let|var|function|class)\s/gm, '$1 ');
  result = result.replace(/^\s*export\s+(async\s+function)\s/gm, '$1 ');

  return result;
}

// ── 第 3.5 步：将图片路径替换为 base64 data URI ──
/**
 * 替换 JS 源码中的图片引用（src 属性、转义引号、url(...)）。
 * @param {string} code
 * @param {Map<string, string>} assetMap
 * @returns {string}
 */
function inlineAssetsInJS(code, assetMap) {
  let result = code;

  for (const [relPath, dataURI] of assetMap) {
    const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. 替换 HTML 模板中的 src="img/xxx" 或 src='img/xxx'
    const srcRegex = new RegExp(`(src\\s*=\\s*)(["'\`])${escaped}\\2`, 'g');
    result = result.replace(srcRegex, `$1$2${dataURI}$2`);

    // 2. 替换转义引号中的 src: src=\"img/xxx\"  (模板字面量中常见)
    const srcEscRegex = new RegExp(`(src\\s*=\\s*)(\\\\["'])${escaped}(\\\\["'])`, 'g');
    result = result.replace(srcEscRegex, `$1$2${dataURI}$3`);

    // 3. 替换 url("img/xxx") 形式（JS 中动态设置 CSS 背景等）
    const urlRegex = new RegExp(`url\\(\\s*["']?${escaped}["']?\\s*\\)`, 'g');
    result = result.replace(urlRegex, `url("${dataURI}")`);
  }

  return result;
}

/**
 * 替换 CSS 中的图片引用。CSS 文件位于 css/ 目录，
 * 引用项目根资源时带 ../ 前缀，故匹配时需补上。
 * @param {string} code
 * @param {Map<string, string>} assetMap
 * @returns {string}
 */
function inlineAssetsInCSS(code, assetMap) {
  let result = code;

  for (const [relPath, dataURI] of assetMap) {
    const cssPath = '../' + relPath;
    const escaped = cssPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`url\\(["']?${escaped}["']?\\)`, 'g');
    result = result.replace(regex, `url("${dataURI}")`);
  }

  return result;
}

// ── 第四步：合并所有 JS 为一个 IIFE ──────
/**
 * @param {string[]} sortedFiles 拓扑序模块列表
 * @param {Map<string, string>} assetMap
 * @returns {string}
 */
function bundleJS(sortedFiles, assetMap) {
  const parts = [];

  for (const file of sortedFiles) {
    const relPath = normalizePath(path.relative(ROOT, file));
    const raw = readFile(file);
    let stripped = stripImportsExports(raw, file);
    stripped = inlineAssetsInJS(stripped, assetMap);

    parts.push(`
// ═══════════════════════════════════════
// ${relPath}
// ═══════════════════════════════════════
${stripped}`);
  }

  return `(function() {
"use strict";
${parts.join('\n')}
})();`;
}

// ── 第五步：合并所有 CSS ──────────────────
/**
 * @param {string[]} cssFiles
 * @param {Map<string, string>} assetMap
 * @returns {string}
 */
function bundleCSS(cssFiles, assetMap) {
  return cssFiles
    .filter(f => fs.existsSync(f))
    .map(f => {
      const relPath = normalizePath(path.relative(ROOT, f));
      const content = inlineAssetsInCSS(readFile(f), assetMap);
      return `/* ── ${relPath} ── */\n${content}`;
    })
    .join('\n\n');
}

// ── 第六步：读取 SVG icons ──────────────────
/** @param {string} svgPath @returns {string} */
function getSvgIcons(svgPath) {
  if (!fs.existsSync(svgPath)) return '';
  return readFile(svgPath);
}

// ── 第七步：生成最终 HTML ─────────────────
/**
 * 生成自包含单文件 HTML。模板中的 iframe 高度同步脚本
 * 服务于酒馆嵌入场景，postMessage 发送三种消息格式以兼容不同宿主。
 * @param {{ css: string, js: string, svgIcons: string }} parts
 * @returns {string}
 */
function generateHTML({ css, js, svgIcons }) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="description" content="火影忍者世界观AI单人文字跑团游戏" />
  <meta name="theme-color" content="#0d0b0a" />
  <title>忍者手记 - 卷之卷</title>

  <script>
    (function() {
      const getParentWidth = () => { try { return parent.window.innerWidth; } catch(e) { return window.innerWidth; } };
      const syncIframeHeight = () => {
        try {
          if (window !== window.parent) {
            try {
              const frames = parent.document.querySelectorAll('iframe');
              for (const f of frames) {
                if (f.contentWindow === window) {
                  const targetHeight = getParentWidth() <= 768 ? '550px' : '680px';
                  if (f.style.height !== targetHeight) {
                    f.style.height = targetHeight;
                  }
                  break;
                }
              }
            } catch (err) {}
            
            const targetHeightNum = getParentWidth() <= 768 ? 550 : 680;
            window.parent.postMessage({ type: 'setHeight', height: targetHeightNum }, '*');
            window.parent.postMessage({ type: 'resize-iframe', height: targetHeightNum }, '*');
            window.parent.postMessage({ action: 'resize', height: targetHeightNum }, '*');
          }
        } catch (e) {
          console.warn('[NarutoRPG] Failed to sync iframe height:', e);
        }
      };
      const sync = () => {
        const isMobile = getParentWidth() <= 768 || document.body.classList.contains('is-mobile-forced');
        document.body.classList.toggle('is-mobile-view', isMobile);
        
        // 检测是否为独立网页运行模式 (非 iframe 嵌入)
        const isStandalone = window === window.parent;
        document.body.classList.toggle('standalone-mode', isStandalone);

        // 动态修正 viewport meta，让 iframe 内 CSS px 与父窗口一致
        const vp = document.querySelector('meta[name="viewport"]');
        if (vp) {
          const pw = getParentWidth();
          vp.setAttribute('content', 'width=' + pw + ', initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
        }
        syncIframeHeight();
      };
      window.addEventListener('resize', sync);
      try { parent.window.addEventListener('resize', sync); } catch(e) {}
      document.addEventListener('DOMContentLoaded', () => {
        sync();
        setInterval(syncIframeHeight, 1000);
      });
    })();
  </script>

  <style>
${css}
  </style>

  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x5370;</text></svg>" />
</head>
<body>
  <div id="app">
    <!-- 背景粒子系统移入 #app 内部，确保在原生全屏模式下仍能被正确渲染且不会超出容器 -->
    <canvas id="chakra-canvas" style="position:absolute;inset:0;pointer-events:none;z-index:0;opacity:0.4;"></canvas>
  </div>

  <!-- SVG 图标集 -->
  ${svgIcons}

  <!-- 滤镜系统 -->
  <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
    <defs>
      <!-- 水墨洇染滤镜 (Ink Bleed) -->
      <filter id="ink-bleed">
        <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation="0.4" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
      <!-- 查克拉流动滤镜 (Chakra Flow) -->
      <filter id="chakra-flow">
        <feTurbulence type="turbulence" baseFrequency="0.02 0.1" numOctaves="2" seed="1">
          <animate attributeName="baseFrequency" dur="10s" values="0.02 0.1;0.03 0.15;0.02 0.1" repeatCount="indefinite" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" scale="5" />
      </filter>
    </defs>
  </svg>

  <script>
${js}
  </script>

  <noscript>
    <div style="padding:40px;text-align:center;color:#e8e4d9;font-family:serif;">
      <h1 style="font-weight:800;letter-spacing:4px;">忍者手记</h1>
      <p>请启用 JavaScript 来运行游戏</p>
    </div>
  </noscript>
</body>
</html>`;

  return html;
}

// ── 主流程 ─────────────────────────────────
function main() {
  console.log('');
  console.log('  ═══════════════════════════════════════');
  console.log('  忍者手记 — 单文件打包器 v2.1');
  console.log('  ═══════════════════════════════════════');
  console.log('');

  // 0. 构建资源映射表（图片 → base64 data URI）
  console.log('  🖼️  内联图片资源...');
  const assetMap = buildAssetMap();
  console.log(`     共 ${assetMap.size} 个图片已转为 base64`);

  // 1. 构建依赖图
  console.log('  📦 分析模块依赖...');
  const graph = buildDependencyGraph(CONFIG.entryJs);
  console.log(`     发现 ${graph.size} 个模块`);

  // 2. 拓扑排序
  console.log('  🔗 拓扑排序...');
  const sorted = topologicalSort(graph);
  console.log('     模块加载顺序:');
  sorted.forEach((f, i) => {
    console.log(`       ${String(i + 1).padStart(2)}. ${normalizePath(path.relative(ROOT, f))}`);
  });

  // 3. 合并 JS（含图片内联）
  console.log('  ⚡ 合并 JavaScript...');
  const bundledJs = bundleJS(sorted, assetMap);
  console.log(`     JS 大小: ${(Buffer.byteLength(bundledJs, 'utf-8') / 1024).toFixed(1)} KB`);

  // 4. 合并 CSS（含图片内联）
  console.log('  🎨 合并 CSS...');
  const bundledCss = bundleCSS(CONFIG.cssFiles, assetMap);
  console.log(`     CSS 大小: ${(Buffer.byteLength(bundledCss, 'utf-8') / 1024).toFixed(1)} KB`);

  // 5. 内联 SVG icons
  console.log('  🔷 内联 SVG 图标...');
  const svgIcons = getSvgIcons(CONFIG.svgIcons);

  // 6. 生成最终 HTML
  console.log('  📄 生成单文件 HTML...');
  const finalHtml = generateHTML({
    css: bundledCss,
    js: bundledJs,
    svgIcons,
  });

  // 7. 写入输出
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  fs.writeFileSync(CONFIG.outFile, finalHtml, 'utf-8');
  const totalSize = Buffer.byteLength(finalHtml, 'utf-8');

  console.log('');
  console.log('  ✅ 打包完成!');
  console.log(`  📁 输出: ${path.relative(ROOT, CONFIG.outFile)}`);
  console.log(`  📊 总大小: ${(totalSize / 1024).toFixed(1)} KB (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
  console.log('');
  console.log('  💡 这是一个完全自包含的单文件，所有图片已内联为 base64。');
  console.log('     可以放到任何位置直接用浏览器打开，无需依赖其他文件。');
  console.log('');
}

try {
  main();
} catch (err) {
  console.error(`\n  ❌ 打包失败: ${err.message}\n`);
  process.exit(1);
}
