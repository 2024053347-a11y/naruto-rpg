// @ts-check
/**
 * 同步工作流的外部路径配置。
 *
 * 历史版本把个人开发机的绝对路径（如 `D:/SillyTavern/SillyTavern`）硬编码在
 * 脚本里，且 sync-to-card 与 watch-and-sync 的假设互相矛盾（前者假设酒馆在
 * 仓库同级目录、后者假设在 D 盘根目录）。现改为环境变量注入，未配置时按
 * “历史候选路径中第一个真实存在的目录”回退，两种旧布局均可继续工作。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

// 加载仓库根目录的 .env（Node >= 20.12 原生支持）。
// 与 dotenv 语义一致：已存在的环境变量优先；文件缺失时静默跳过。
try {
  process.loadEnvFile?.(path.join(ROOT, '.env'));
} catch {
  /* .env 不存在属正常情况 */
}

/**
 * @typedef {object} SyncConfig
 * @property {string} tavernDir SillyTavern 安装目录
 * @property {string} cardName 角色卡文件名
 * @property {string} cardPath 角色卡 PNG 的完整路径
 * @property {string | null} manualExportDir regex JSON 副本导出目录；null 表示未配置且候选目录都不存在（跳过导出）
 * @property {string | null} manualExportFile 副本导出完整路径
 */

/**
 * 返回候选路径中第一个真实存在的目录。
 * @param {string[]} candidates
 * @returns {string | null}
 */
function firstExistingDir(candidates) {
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * 解析同步配置。环境变量优先，其次探测历史默认路径。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SyncConfig}
 */
export function resolveSyncConfig(env = process.env) {
  const tavernDir =
    env.TAVERN_DIR ||
    firstExistingDir([
      path.resolve(ROOT, '..', 'SillyTavern'), // 旧 sync-to-card.cjs 的假设：酒馆与仓库同级
      'D:/SillyTavern/SillyTavern', // 旧 watch-and-sync.mjs 的硬编码默认值
    ]) ||
    'D:/SillyTavern/SillyTavern';

  const tavernUser = env.TAVERN_USER || 'default-user';
  const cardName = env.TAVERN_CARD_NAME || '忍者手记.png';

  const manualExportDir =
    env.MANUAL_EXPORT_DIR ||
    firstExistingDir([
      path.resolve(ROOT, '..', '忍者手记'), // 旧 sync-to-card.cjs 的假设
      path.resolve(ROOT, '..', '..', '忍者手记'), // 旧 watch-and-sync.mjs 的假设
    ]);

  return {
    tavernDir,
    cardName,
    cardPath: path.join(tavernDir, 'data', tavernUser, 'characters', cardName),
    manualExportDir,
    manualExportFile: manualExportDir
      ? path.join(manualExportDir, 'regex-正文-忍者手记.json')
      : null,
  };
}
