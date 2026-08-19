export const IMPORTED_PRESET_DEBUG_GLOBAL_KEY = '__NARUTO_PRESET_DEBUG__';

function resolveDebugHost(globalRef = globalThis) {
  return globalRef?.window && typeof globalRef.window === 'object'
    ? globalRef.window
    : globalRef;
}

function normalizedErrors(error, structureErrors) {
  const explicit = Array.isArray(structureErrors) ? structureErrors : [];
  const details = Array.isArray(error?.details?.errors) ? error.details.errors : [];
  return [...new Set([...explicit, ...details].map(value => String(value || '')).filter(Boolean))];
}

/**
 * Remove the latest in-memory imported-preset diagnostic. This deliberately
 * does not touch console history, storage, chat history, timeline data or any
 * remote service.
 */
export function clearImportedPresetDebugLog({ globalRef = globalThis } = {}) {
  const host = resolveDebugHost(globalRef);
  if (!host) return false;
  try {
    return Reflect.deleteProperty(host, IMPORTED_PRESET_DEBUG_GLOBAL_KEY);
  } catch {
    return false;
  }
}

export function readImportedPresetDebugLog({ globalRef = globalThis } = {}) {
  const host = resolveDebugHost(globalRef);
  return host?.[IMPORTED_PRESET_DEBUG_GLOBAL_KEY] || null;
}

/**
 * Publish one failed imported-preset response for local, transient diagnosis.
 * The strings are intentionally kept verbatim and are never persisted.
 */
export function recordImportedPresetDebugFailure({
  build = 'dev',
  latestBuild = '',
  staleBuild = false,
  adapterId = 'fallback',
  presetRevision = '',
  stage = 'envelope-validation',
  error = null,
  structureErrors = [],
  rawResponse = '',
  projectedResponse = '',
  validationResponse = ''
} = {}, {
  globalRef = globalThis,
  consoleRef = globalThis.console
} = {}) {
  const raw = String(rawResponse ?? '');
  const projected = String(projectedResponse ?? '');
  const validation = String(validationResponse ?? '');
  const snapshot = Object.freeze({
    timestamp: new Date().toISOString(),
    build: String(build || 'dev'),
    latestBuild: String(latestBuild || ''),
    staleBuild: Boolean(staleBuild),
    adapterId: String(adapterId || 'fallback'),
    presetRevision: String(presetRevision || ''),
    stage: String(stage || 'envelope-validation'),
    code: String(error?.code || ''),
    error: String(error?.message || error || '导入预设输出校验失败'),
    structureErrors: Object.freeze(normalizedErrors(error, structureErrors)),
    rawResponse: raw,
    projectedResponse: projected,
    validationResponse: validation
  });

  const host = resolveDebugHost(globalRef);
  if (host) {
    try {
      Object.defineProperty(host, IMPORTED_PRESET_DEBUG_GLOBAL_KEY, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: snapshot
      });
    } catch {
      // Console output remains available even if an embedding host prevents
      // defining diagnostic globals.
    }
  }

  const label = `[ImportedPresetDebug] ${snapshot.adapterId} · ${snapshot.stage} · ${snapshot.timestamp}`;
  consoleRef?.warn?.(`${label}\n已截获本回合完整 AI 原始回复；展开下一组日志查看。`);
  consoleRef?.groupCollapsed?.(label);
  consoleRef?.log?.('[ImportedPresetDebug] 元数据', {
    timestamp: snapshot.timestamp,
    build: snapshot.build,
    latestBuild: snapshot.latestBuild,
    staleBuild: snapshot.staleBuild,
    adapterId: snapshot.adapterId,
    presetRevision: snapshot.presetRevision,
    stage: snapshot.stage,
    code: snapshot.code,
    structureErrors: [...snapshot.structureErrors]
  });
  consoleRef?.log?.(`[ImportedPresetDebug] 完整 AI 原始回复（未经清理、修复或正则美化）：\n${raw}`);
  if (projected !== raw) {
    consoleRef?.log?.(`[ImportedPresetDebug] 加入预设 assistant prefill 后：\n${projected}`);
  }
  if (validation !== projected) {
    consoleRef?.log?.(`[ImportedPresetDebug] 实际触发校验的文本：\n${validation}`);
  }
  consoleRef?.error?.(`[ImportedPresetDebug] 校验错误：${snapshot.error}`);
  consoleRef?.info?.('复制模型原文：copy(window.__NARUTO_PRESET_DEBUG__.rawResponse)');
  consoleRef?.groupEnd?.();

  return snapshot;
}
