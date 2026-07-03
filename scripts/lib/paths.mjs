// @ts-check
/**
 * 项目内路径的单一事实来源（Single Source of Truth）。
 * dist 产物文件名曾分散硬编码在 bundle / build-regex / sync-to-card / watch-and-sync
 * 四个脚本中，任何一处改名都会静默破坏下游同步，故集中于此。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 项目根目录（scripts/lib/ 的上两级） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 打包产物输出目录 */
export const DIST_DIR = path.join(ROOT, 'dist');

/** 各脚本共享的 dist 产物路径 */
export const DIST_FILES = Object.freeze({
  /** 单文件全量 HTML（bundle.mjs 输出） */
  bundleHtml: path.join(DIST_DIR, 'naruto-rpg-bundle.html'),
  /** 酒馆正则 JSON — 「起物」触发词版（build-regex.mjs 输出，sync 脚本消费） */
  regexQiwuTrigger: path.join(DIST_DIR, 'regex-正文-火影忍者-起物单文件版.json'),
  /** 酒馆正则 JSON — 全量捕获版（build-regex.mjs 输出） */
  regexFullCapture: path.join(DIST_DIR, 'regex-正文-火影忍者-单文件版.json'),
});
