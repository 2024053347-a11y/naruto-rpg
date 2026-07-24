import { eventBus } from './event-bus.js';

export const PROMPT_TRACE_STORAGE_KEYS = Object.freeze({
  main: 'naruto_prompt_trace',
  agents: 'naruto_agent_prompt_traces',
  narrativeReview: 'naruto_narrative_review_prompt_trace',
  variableUpdater: 'naruto_variable_updater_prompt_trace',
  auxiliary: 'naruto_auxiliary_prompt_traces'
});

const CHANNELS = Object.freeze({
  main: Object.freeze({ bundleKey: 'main', eventName: 'debug:prompt-trace', collection: false, maxEntries: 1 }),
  agent: Object.freeze({ bundleKey: 'agents', eventName: 'debug:agent-prompt-trace', collection: true, maxEntries: 16 }),
  'narrative-review': Object.freeze({ bundleKey: 'narrativeReview', eventName: 'debug:narrative-review-prompt-trace', collection: false, maxEntries: 1 }),
  'variable-updater': Object.freeze({ bundleKey: 'variableUpdater', eventName: 'debug:variable-updater-prompt-trace', collection: false, maxEntries: 1 }),
  'npc-summary': Object.freeze({ bundleKey: 'auxiliary', eventName: 'debug:npc-summary-prompt-trace', collection: true, maxEntries: 8 })
});

const memoryTraces = new Map();
const SENSITIVE_META_KEY = /api.?key|authorization|auth.?header|access.?token|bearer|secret|password|cookie/i;

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage || null; } catch { return null; }
}

function stringifyContent(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try { return JSON.stringify(content); } catch { return String(content); }
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4 || value == null) return value == null ? null : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeMetadata(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_META_KEY.test(key)) continue;
    result[key] = sanitizeMetadata(item, depth + 1);
  }
  return result;
}

function normalizeMessages(messages = [], messageSources = []) {
  return (Array.isArray(messages) ? messages : []).map((message, index) => {
    const sourceMeta = messageSources[index] || {};
    const content = stringifyContent(message?.content);
    return {
      index,
      role: String(message?.role || 'system'),
      source: String(sourceMeta.source || message?.source || ''),
      label: String(sourceMeta.label || message?.label || ''),
      length: content.length,
      content
    };
  });
}

function normalizeInjections(injections = []) {
  return (Array.isArray(injections) ? injections : []).map(item => {
    const content = stringifyContent(item?.content);
    return {
      name: String(item?.name || item?.source || '注入项'),
      source: String(item?.source || ''),
      length: content.length,
      content
    };
  });
}

function readStored(bundleKey, storage) {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(PROMPT_TRACE_STORAGE_KEYS[bundleKey]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readChannel(bundleKey, storage) {
  if (memoryTraces.has(bundleKey)) return memoryTraces.get(bundleKey);
  return readStored(bundleKey, storage);
}

function persist(bundleKey, value, { storage, collection }) {
  const target = resolveStorage(storage);
  if (!target) return false;
  const key = PROMPT_TRACE_STORAGE_KEYS[bundleKey];
  try {
    target.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    if (collection && Array.isArray(value)) {
      for (let start = 1; start < value.length; start++) {
        try {
          target.setItem(key, JSON.stringify(value.slice(start)));
          return true;
        } catch {}
      }
    }
    console.warn(`[PromptTrace] ${bundleKey} 持久化失败，本次会话仍可查看:`, error?.message || error);
    return false;
  }
}

export function createPromptTrace(input = {}) {
  const kind = String(input.kind || 'main');
  const channel = CHANNELS[kind];
  if (!channel) throw new Error(`不支持的提示词追踪类型: ${kind}`);
  return {
    id: String(input.id || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    kind,
    title: String(input.title || kind),
    createdAt: input.createdAt || new Date().toISOString(),
    userInput: String(input.userInput || ''),
    model: String(input.model || ''),
    agentType: input.agentType ? String(input.agentType) : '',
    presetName: input.presetName ? String(input.presetName) : '',
    updaterEnabled: typeof input.updaterEnabled === 'boolean' ? input.updaterEnabled : undefined,
    generationOptions: sanitizeMetadata(input.generationOptions || {}),
    details: sanitizeMetadata(input.details || {}),
    messages: normalizeMessages(input.messages, input.messageSources),
    injections: normalizeInjections(input.injections)
  };
}

export function publishPromptTrace(input = {}, { storage, bus = eventBus } = {}) {
  const trace = createPromptTrace(input);
  const channel = CHANNELS[trace.kind];
  const { bundleKey } = channel;

  if (channel.collection) {
    const previous = readChannel(bundleKey, storage);
    const list = Array.isArray(previous) ? previous : [];
    const next = [...list, trace].slice(-channel.maxEntries);
    memoryTraces.set(bundleKey, next);
    persist(bundleKey, next, { storage, collection: true });
  } else {
    memoryTraces.set(bundleKey, trace);
    persist(bundleKey, trace, { storage, collection: false });
  }

  bus?.emit?.(channel.eventName, trace);
  return trace;
}

export function readPromptTraceBundle({ storage } = {}) {
  const main = readChannel('main', storage);
  const agents = readChannel('agents', storage);
  const narrativeReview = readChannel('narrativeReview', storage);
  const variableUpdater = readChannel('variableUpdater', storage);
  const auxiliary = readChannel('auxiliary', storage);
  return {
    main: main && !Array.isArray(main) ? main : null,
    agents: Array.isArray(agents) ? agents : [],
    narrativeReview: narrativeReview && !Array.isArray(narrativeReview) ? narrativeReview : null,
    variableUpdater: variableUpdater && !Array.isArray(variableUpdater) ? variableUpdater : null,
    auxiliary: Array.isArray(auxiliary) ? auxiliary : []
  };
}

export function clearPromptTraces({ storage } = {}) {
  memoryTraces.clear();
  const target = resolveStorage(storage);
  if (!target) return;
  for (const key of Object.values(PROMPT_TRACE_STORAGE_KEYS)) {
    try { target.removeItem(key); } catch {}
  }
}
