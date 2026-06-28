export function formatPercentage(value, total) {
  if (!total || total === 0) return 0;
  return Math.round((value / total) * 100);
}

export function formatGameTime(calendar) {
  if (!calendar) return '未知时间';
  if (typeof calendar === 'string') return calendar;
  const parts = [];
  if (calendar.year) parts.push(calendar.year);
  if (calendar.month) parts.push(`${calendar.month}月${calendar.day || 1}日`);
  else if (calendar.day) parts.push(`第${calendar.day}天`);
  if (calendar.time_of_day && !calendar.month) parts.push(calendar.time_of_day);
  if (calendar.time_of_day && calendar.month) parts.push('·' + calendar.time_of_day);
  return parts.join('') || parts.join('·') || '未知时间';
}

export function truncate(str, maxLen = 30) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#' + '39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateNodeId(turnNumber) {
  const hash = Math.random().toString(36).slice(2, 6);
  return `node_${String(turnNumber).padStart(4, '0')}_${hash}`;
}

export function deepClone(obj) {
  return structuredClone(obj);
}

export function getValueByPath(obj, path) {
  const keys = path.replace(/\[(\d+)\]/g, '.' + '$' + '1').split('.');
  let result = obj;
  for (const key of keys) {
    if (result == null) return undefined;
    result = result[key];
  }
  return result;
}

export function setValueByPath(obj, path, value) {
  const keys = path.replace(/\[(\d+)\]/g, '.' + '$' + '1').split('.');
  const lastKey = keys.pop();
  let target = obj;
  for (const key of keys) {
    if (!(key in target) || target[key] == null) {
      target[key] = {};
    }
    target = target[key];
  }
  target[lastKey] = value;
  return obj;
}

export function getElementMultiplier(atkElement, defElement) {
  const chart = {
    '火': { '风': 1.5, '水': 0.5 },
    '风': { '雷': 1.5, '火': 0.5 },
    '雷': { '土': 1.5, '风': 0.5 },
    '土': { '水': 1.5, '雷': 0.5 },
    '水': { '火': 1.5, '土': 0.5 }
  };
  return chart[atkElement]?.[defElement] || 1.0;
}

export const BRANCH_COLORS = [
  '#eb613f', '#42A5F5', '#66BB6A', '#CE93D8',
  '#c69c6d', '#ef5350', '#1e50a2', '#8b6c9c'
];

let branchColorIndex = 0;
export function getNextBranchColor() {
  const color = BRANCH_COLORS[branchColorIndex % BRANCH_COLORS.length];
  branchColorIndex++;
  return color;
}
