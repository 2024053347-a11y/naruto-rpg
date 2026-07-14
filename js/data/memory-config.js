// 记忆系统参数配置 — 单一来源
// 深度整理/分层窗口/检索参数均从此处读取,设置面板「记忆」板块写入

const STORAGE_KEY = 'naruto_memory_config';

export const MEMORY_CONFIG_DEFAULTS = {
  // 深度整理
  deepEnabled: true,
  deepCycle: 36,              // 每 N 回合整理一次 (12-100)
  deepModel: 'main',          // 'main' | 'updater' — 整理用哪个模型配置
  // 分层窗口
  chapterWindow: 10,          // 每 N 回合固化一章
  maxTurnSummaries: 8,        // 回合小结保留条数
  promptBudget: 7200,         // 注入总预算(字符)
  factsLimit: 90,             // facts 上限
  archivedLimit: 600,         // 归档上限
  // 检索
  recallEnabled: true,        // <recall> 协议
  recallLifetime: 3,          // 召回单有效回合数
  // 置顶角色自动总结
  npcSummaryEnabled: true,
  npcSummaryFrequency: 10,      // 每 N 次互动总结一次 (5-30)
};

const CLAMPS = {
  deepCycle: [12, 100],
  chapterWindow: [5, 30],
  maxTurnSummaries: [4, 20],
  promptBudget: [3000, 20000],
  factsLimit: [30, 300],
  archivedLimit: [100, 2000],
  recallLifetime: [1, 10],
  npcSummaryFrequency: [5, 30]
};

function clampConfig(cfg) {
  const out = { ...MEMORY_CONFIG_DEFAULTS, ...cfg };
  for (const [key, [min, max]] of Object.entries(CLAMPS)) {
    const n = Number(out[key]);
    out[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : MEMORY_CONFIG_DEFAULTS[key];
  }
  out.deepEnabled = out.deepEnabled !== false;
  out.recallEnabled = out.recallEnabled !== false;
  out.npcSummaryEnabled = out.npcSummaryEnabled !== false;
  out.deepModel = out.deepModel === 'updater' ? 'updater' : 'main';
  return out;
}

let _cache = null;

export function getMemoryConfig() {
  if (_cache) return _cache;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { _cache = clampConfig(JSON.parse(raw)); return _cache; }
    }
  } catch { /* corrupted config falls back to defaults */ }
  _cache = { ...MEMORY_CONFIG_DEFAULTS };
  return _cache;
}

export function saveMemoryConfig(partial) {
  const merged = clampConfig({ ...getMemoryConfig(), ...partial });
  _cache = merged;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }
  } catch { /* quota errors are non-fatal for config */ }
  return merged;
}

export function resetMemoryConfig() {
  _cache = { ...MEMORY_CONFIG_DEFAULTS };
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch {}
  return _cache;
}
