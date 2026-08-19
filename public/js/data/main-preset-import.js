import { DEFAULT_MAIN_PRESET_VERSION } from './default-preset.js';

export const MAIN_PRESET_SOURCE_SILLY_TAVERN = 'sillytavern';
export const MAIN_PRESET_SOURCE_NATIVE = 'naruto-main-preset';

const GENERATION_SETTING_KEYS = Object.freeze([
  'temperature',
  'frequency_penalty',
  'presence_penalty',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'repetition_penalty',
  'openai_max_context',
  'openai_max_tokens',
  'seed'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeIdentifier(value, prefix, index) {
  const text = String(value || '').trim();
  return text || `${prefix}_${index + 1}`;
}

function normalizePlacement(value) {
  if (Array.isArray(value) && value.length === 0) return [];
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item >= 0 && item <= 9);
  return normalized.length ? [...new Set(normalized)] : [2];
}

function normalizeDepth(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= -1 ? number : null;
}

export function normalizePresetRegexScript(input, index = 0) {
  const raw = record(input) ? input : {};
  const name = String(raw.scriptName || raw.name || `正则 ${index + 1}`);
  return {
    id: safeIdentifier(raw.id, 'regex', index),
    name,
    scriptName: name,
    enabled: raw.enabled === false ? false : raw.disabled !== true,
    disabled: raw.enabled === false || raw.disabled === true,
    findRegex: typeof raw.findRegex === 'string' ? raw.findRegex : '',
    replaceString: typeof raw.replaceString === 'string' ? raw.replaceString : '',
    placement: normalizePlacement(raw.placement),
    substituteRegex: [0, 1, 2].includes(Number(raw.substituteRegex)) ? Number(raw.substituteRegex) : 0,
    markdownOnly: Boolean(raw.markdownOnly),
    promptOnly: Boolean(raw.promptOnly),
    runOnEdit: raw.runOnEdit !== false,
    minDepth: normalizeDepth(raw.minDepth),
    maxDepth: normalizeDepth(raw.maxDepth),
    trimStrings: Array.isArray(raw.trimStrings)
      ? raw.trimStrings.filter(item => typeof item === 'string')
      : []
  };
}

export function extractPresetRegexScripts(raw) {
  if (!record(raw)) return [];
  // A preset may expose the same collection under different schema aliases.
  // Pick the first populated collection instead of merging them. Intentional
  // duplicate rows inside that collection are significant because Tavern runs
  // scripts strictly in array order.
  const collections = [
    raw.regexScripts,
    raw.regex_scripts,
    raw.extensions?.regex_scripts,
    raw.data?.extensions?.regex_scripts
  ].filter(Array.isArray);
  const candidates = collections.find(items => items.length > 0) || collections[0] || [];
  return candidates.map((candidate, index) => normalizePresetRegexScript(candidate, index));
}

function selectPromptOrder(raw) {
  const groups = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
  return groups.find(group => Array.isArray(group?.order))?.order || [];
}

function normalizeRole(value) {
  return value === 'assistant' || value === 'user' ? value : 'system';
}

function generationSettings(raw) {
  const settings = {};
  for (const key of GENERATION_SETTING_KEYS) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) settings[key] = raw[key];
  }
  return settings;
}

function toTavernEntry(prompt, orderItem, index, chatHistoryIndex) {
  const identifier = safeIdentifier(prompt?.identifier, 'entry', index);
  const marker = prompt?.marker === true;
  const ordered = Boolean(orderItem);
  const enabled = ordered
    ? (typeof orderItem.enabled === 'boolean' ? orderItem.enabled : prompt?.enabled !== false)
    : false;
  return {
    id: identifier,
    name: String(prompt?.name || `条目 ${index + 1}`),
    enabled,
    role: normalizeRole(prompt?.role),
    activation: 'always',
    content: typeof prompt?.content === 'string' ? prompt.content : '',
    isMarker: marker,
    tavernPosition: index > chatHistoryIndex ? 'bottom' : 'top',
    sourceOrder: index,
    sourceMeta: {
      marker,
      systemPrompt: Boolean(prompt?.system_prompt),
      injectionPosition: prompt?.injection_position ?? null,
      injectionDepth: normalizeDepth(prompt?.injection_depth),
      injectionOrder: Number.isFinite(Number(prompt?.injection_order))
        ? Number(prompt.injection_order)
        : null,
      forbidOverrides: Boolean(prompt?.forbid_overrides),
      presentInPromptOrder: ordered
    }
  };
}

function compileTavernEntries(raw) {
  const prompts = Array.isArray(raw.prompts) ? raw.prompts : [];
  const byIdentifier = new Map();
  prompts.forEach((prompt, index) => {
    const identifier = safeIdentifier(prompt?.identifier, 'entry', index);
    if (!byIdentifier.has(identifier)) byIdentifier.set(identifier, { prompt, originalIndex: index });
  });

  const orderedRows = selectPromptOrder(raw);
  const ordered = [];
  const seen = new Set();
  for (const row of orderedRows) {
    const identifier = String(row?.identifier || '').trim();
    const match = byIdentifier.get(identifier);
    if (!identifier || !match || seen.has(identifier)) continue;
    seen.add(identifier);
    ordered.push({ ...match, orderItem: row });
  }
  for (const [identifier, match] of byIdentifier) {
    if (seen.has(identifier)) continue;
    ordered.push({ ...match, orderItem: null });
  }

  const chatHistoryIndex = ordered.findIndex(item => (
    String(item.prompt?.identifier || '') === 'chatHistory'
  ));
  const splitIndex = chatHistoryIndex >= 0 ? chatHistoryIndex : Number.POSITIVE_INFINITY;
  return ordered.map((item, index) => toTavernEntry(
    item.prompt,
    item.orderItem,
    index,
    splitIndex
  ));
}

function normalizeNativeEntry(entry, index) {
  const raw = record(entry) ? entry : {};
  return {
    ...clone(raw),
    id: safeIdentifier(raw.id, 'entry', index),
    name: String(raw.name || `条目 ${index + 1}`),
    enabled: raw.enabled !== false,
    role: normalizeRole(raw.role),
    activation: String(raw.activation || 'always'),
    content: typeof raw.content === 'string' ? raw.content : ''
  };
}

export function isSillyTavernPreset(raw) {
  return Boolean(
    record(raw)
    && Array.isArray(raw.prompts)
    && (Array.isArray(raw.prompt_order) || record(raw.extensions) || 'assistant_prefill' in raw)
  );
}

export function compileMainPresetImport(raw, {
  fileName = '未命名预设.json',
  version = DEFAULT_MAIN_PRESET_VERSION
} = {}) {
  if (!record(raw)) throw new TypeError('预设 JSON 顶层必须是对象');

  if (isSillyTavernPreset(raw)) {
    const entries = compileTavernEntries(raw);
    if (!entries.length) throw new TypeError('SillyTavern 预设没有可导入的 prompts');
    return {
      name: String(raw.presetName || fileName.replace(/\.json$/i, '') || '未命名预设'),
      entries,
      regexScripts: extractPresetRegexScripts(raw),
      assistantPrefill: typeof raw.assistant_prefill === 'string' ? raw.assistant_prefill : '',
      generationSettings: generationSettings(raw),
      _version: version,
      _sourceFormat: MAIN_PRESET_SOURCE_SILLY_TAVERN,
      _importMode: 'replace',
      _importedAt: Date.now()
    };
  }

  if (Array.isArray(raw.entries)) {
    if (!raw.entries.length) throw new TypeError('主预设 entries 不能为空');
    return {
      ...clone(raw),
      name: String(raw.name || fileName.replace(/\.json$/i, '') || '未命名预设'),
      entries: raw.entries.map(normalizeNativeEntry),
      regexScripts: extractPresetRegexScripts(raw),
      _version: version,
      _sourceFormat: String(raw._sourceFormat || MAIN_PRESET_SOURCE_NATIVE),
      _importMode: 'replace',
      _importedAt: Date.now()
    };
  }

  throw new TypeError('无法识别该主预设格式：需要 prompts 或 entries 数组');
}

export function summarizeMainPresetImport(preset) {
  const entries = Array.isArray(preset?.entries) ? preset.entries : [];
  const regexScripts = Array.isArray(preset?.regexScripts) ? preset.regexScripts : [];
  return Object.freeze({
    promptCount: entries.length,
    enabledPromptCount: entries.filter(entry => entry.enabled !== false && !entry.isMarker).length,
    markerCount: entries.filter(entry => entry.isMarker).length,
    regexCount: regexScripts.length,
    enabledRegexCount: regexScripts.filter(script => script.enabled !== false && script.disabled !== true).length
  });
}
