#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const htmlFile = path.join(ROOT, 'dist', 'naruto-rpg-bundle.html');
const outFile = path.join(ROOT, 'dist', 'regex-正文-火影忍者-起物单文件版.json');

function main() {
  if (!fs.existsSync(htmlFile)) {
    console.error(`❌ 找不到 HTML 文件: ${htmlFile}`);
    process.exit(1);
  }

  console.log('📦 开始生成酒馆正则 JSON...');
  const htmlContent = fs.readFileSync(htmlFile, 'utf-8');

  // 构建酒馆正则 JSON 结构
  // 触发词：起物
  // 替换内容：Markdown代码块包裹的 HTML
  const regexJson = {
    "id": crypto.randomUUID(),
    "scriptName": "正文-忍者手记-起物单文件版",
    "findRegex": "起物",
    "replaceString": "\n```html\n" + htmlContent + "\n```",
    "trimStrings": [],
    "placement": [
        2
    ],
    "disabled": false,
    "markdownOnly": true,
    "promptOnly": false,
    "runOnEdit": true,
    "substituteRegex": false,
    "minDepth": null,
    "maxDepth": null
  };

  fs.writeFileSync(outFile, JSON.stringify(regexJson, null, 4), 'utf-8');
  const size = fs.statSync(outFile).size;
  console.log(`✅ 正则生成完毕: dist/regex-正文-火影忍者-起物单文件版.json (大小: ${(size/1024/1024).toFixed(2)} MB)`);
}

main();
