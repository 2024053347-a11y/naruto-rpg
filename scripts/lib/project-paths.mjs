/**
 * project-paths.mjs — 构建工具链的统一路径配置（Single Source of Truth）
 *
 * 项目内路径：由脚本自身位置推导，保证可移植性（Portability）。
 * 项目外路径（酒馆目录、手动导入目录）：一律通过环境变量注入，
 * 禁止在任何脚本中硬编码个人开发机的绝对路径（如 D:/SillyTavern）。
 *
 * 可配置的环境变量（可写入项目根目录 .env）：
 *   TAVERN_DIR         — SillyTavern 安装目录（含 data/ 子目录）
 *   TAVERN_CARD_NAME   — 要同步的角色卡 PNG 文件名
 *   MANUAL_EXPORT_DIR  — 手动导入用 regex JSON 的落盘目录（不存在则跳过同步）
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** 项目根目录（scripts/lib/ 的上两级），与当前工作目录无关 */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

// dotenv 不会覆盖已存在的进程环境变量，因此 CI 注入的值优先于 .env 文件
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

/** 打包产物目录 */
export const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

/** 单文件打包产物 */
export const BUNDLE_HTML = path.join(DIST_DIR, 'naruto-rpg-bundle.html');

/**
 * 酒馆正则 JSON 产物。
 * 文件名是下游（酒馆手动导入、角色卡同步）依赖的既有契约，不可改名。
 */
export const REGEX_TRIGGER_JSON = path.join(
  DIST_DIR,
  'regex-正文-火影忍者-起物单文件版.json'
);
export const REGEX_FULL_JSON = path.join(
  DIST_DIR,
  'regex-正文-火影忍者-单文件版.json'
);

/**
 * SillyTavern 安装目录。
 * 默认值保留原作者开发机的路径，仅作为未配置 .env 时的兜底；
 * 其他环境请务必通过 TAVERN_DIR 覆盖。
 */
export const TAVERN_DIR = process.env.TAVERN_DIR || 'D:/SillyTavern/SillyTavern';

/** 酒馆角色卡目录与世界书目录（由 TAVERN_DIR 推导） */
export const TAVERN_CHARACTERS_DIR = path.join(
  TAVERN_DIR,
  'data',
  'default-user',
  'characters'
);

/** 要同步的角色卡 PNG 文件名 */
export const TAVERN_CARD_NAME = process.env.TAVERN_CARD_NAME || '忍者手记.png';

/** 角色卡 PNG 的完整路径 */
export const TAVERN_CARD_PATH = path.join(TAVERN_CHARACTERS_DIR, TAVERN_CARD_NAME);

/**
 * 手动导入目录：构建后额外落一份 regex JSON，方便在酒馆 UI 里手动导入。
 * 历史上两个脚本对该目录的推导不一致（项目父目录 vs 祖父目录），
 * 现统一为环境变量注入；未配置或目录不存在时跳过该步骤。
 */
export const MANUAL_EXPORT_DIR = process.env.MANUAL_EXPORT_DIR || '';

/** 手动导入目录中的 regex JSON 文件名（既有契约，不可改名） */
export const MANUAL_EXPORT_REGEX_NAME = 'regex-正文-忍者手记.json';
