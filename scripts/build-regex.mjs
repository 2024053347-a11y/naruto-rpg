#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const htmlFile = path.join(ROOT, 'dist', 'naruto-rpg-bundle.html');

// 输出两份正则：仅触发器、placement 不同，HTML 内容一致
const TARGETS = [
  {
    outFile: path.join(ROOT, 'dist', 'regex-正文-火影忍者-起物单文件版.json'),
    scriptName: '正文-忍者手记-起物单文件版',
    findRegex: '起物',
    placement: [2],
  },
  {
    outFile: path.join(ROOT, 'dist', 'regex-正文-火影忍者-单文件版.json'),
    scriptName: '正文-忍者手记(单文件全量版)',
    findRegex: '(起物)',
    placement: [1, 2],
  },
];

function main() {
  if (!fs.existsSync(htmlFile)) {
    console.error(`❌ 找不到 HTML 文件: ${htmlFile}`);
    process.exit(1);
  }

  console.log('📦 开始生成酒馆正则 JSON...');
  const htmlContent = fs.readFileSync(htmlFile, 'utf-8');

  for (const target of TARGETS) {
    // 构建酒馆正则 JSON 结构
    // 替换内容：Markdown 代码块包裹的 HTML（酒馆助手据此自动渲染为沙箱 iframe）
    const regexJson = {
      "id": crypto.randomUUID(),
      "scriptName": target.scriptName,
      "findRegex": target.findRegex,
      "replaceString": "\n```\n" + htmlContent + "\n```",
      "trimStrings": [],
      "placement": target.placement,
      "disabled": false,
      "markdownOnly": true,
      "promptOnly": false,
      "runOnEdit": true,
      "substituteRegex": false,
      "minDepth": null,
      "maxDepth": null
    };

    fs.writeFileSync(target.outFile, JSON.stringify(regexJson, null, 4), 'utf-8');
    const size = fs.statSync(target.outFile).size;
    console.log(`✅ 正则生成完毕: ${path.basename(target.outFile)} (大小: ${(size/1024/1024).toFixed(2)} MB)`);
  }
}

main();
