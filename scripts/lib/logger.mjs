// @ts-check
/**
 * 统一的时间戳日志器 — 供 scripts/ 下的工作流脚本共用。
 * 之前 watch-and-sync.mjs 内部私有实现，抽出后 sync-to-card 等脚本可复用同一输出风格。
 */

/** @typedef {'info' | 'success' | 'error' | 'warn' | 'watch' | 'sync'} LogType */

const ICONS = Object.freeze({
  info: '📦',
  success: '✅',
  error: '❌',
  warn: '⚠️',
  watch: '👁️',
  sync: '🔄',
});

/**
 * 输出一条带本地时间戳与图标的日志。
 * @param {string} msg
 * @param {LogType} [type]
 */
export function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${time}] ${ICONS[type] || '•'} ${msg}`);
}
