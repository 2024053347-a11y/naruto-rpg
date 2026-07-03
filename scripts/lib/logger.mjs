/**
 * logger.mjs — 构建脚本共用的轻量日志器
 * 统一时间戳与图标风格，避免每个脚本各写一份 console.log 封装。
 */

const ICONS = Object.freeze({
  info: '📦',
  success: '✅',
  error: '❌',
  warn: '⚠️',
  watch: '👁️',
  sync: '🔄',
});

/**
 * @param {string} message 日志内容
 * @param {'info'|'success'|'error'|'warn'|'watch'|'sync'} [type] 日志级别/类别
 */
export function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const icon = ICONS[type] || '•';
  const line = `[${time}] ${icon} ${message}`;
  // 错误走 stderr，保证被管道/CI 正确捕获
  if (type === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}
