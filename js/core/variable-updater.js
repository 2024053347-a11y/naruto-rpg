import { AIClient } from './ai-client.js';
import { eventBus } from './event-bus.js';
import { getVariableUpdaterPreset, resolveVariableUpdaterPreset } from '../data/variable-updater-preset.js';

export const VARIABLE_UPDATER_TRACE_STORAGE_KEY = 'naruto_variable_updater_prompt_trace';
const ALLOWED_TAGS = ['var', 'variable', 'var_thinking', 'variable_thinking', 'combat', 'mission', 'relationship', 'memory', 'event'];

function buildBreakthroughInstruction(state) {
  const pending = Number(state?.['进度·突破待处理']) || 0;
  if (pending <= 0) return '';
  return `

【⚠️突破指令——本回合必须执行！】
当前突破待处理 = ${pending}。本回合必须完成实力突破！严格按以下步骤操作：
1. 按角色发展方向提升属性上限（chakra/stamina/spirit/willpower/speed 用 add），单回合总量 <= 15（重大突破）
2. 同步提升相关技能熟练度
3. 完成突破后，输出 <variable>{"path":"progression.pending_breakthrough","op":"sub","value":${pending}}，将突破标记清零
4. 在 <memory> 中详细记录本次突破的属性和技能成长内容`;
}

function resolveConfig(mainConfig = {}) {
  const config = mainConfig.variableUpdater || {};
  return {
    ...mainConfig,
    ...config,
    backend: config.backend && config.backend !== 'inherit' ? config.backend : mainConfig.backend,
    apiUrl: config.apiUrl || mainConfig.apiUrl,
    apiKey: config.apiKey || mainConfig.apiKey,
    model: config.model || mainConfig.model
  };
}

export function sanitizeVariableUpdaterOutput(text) {
  if (!text) return '';
  const tags = [];
  for (const tag of ALLOWED_TAGS) {
    const regex = new RegExp(`<${tag}(?:\\s+[^>]*)?>[\\s\\S]*?(?:<\\/${tag}>|$)`, 'gi');
    const matches = text.match(regex);
    if (matches) tags.push(...matches);
  }
  return tags.join('\n').trim();
}

function publishTrace(messages, { userInput, presetName, generationOptions }) {
  const trace = {
    id: `variable-updater-${Date.now()}`,
    kind: 'variable-updater',
    title: '变量更新模型预设链条',
    createdAt: new Date().toISOString(),
    userInput,
    presetName,
    generationOptions,
    roleChain: messages.map((message, index) => ({
      index,
      role: message.role,
      source: '变量更新预设',
      label: `${presetName}#${index + 1}`,
      length: String(message.content || '').length
    })),
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      source: '变量更新预设',
      label: `${presetName}#${index + 1}`,
      length: String(message.content || '').length,
      content: message.content || ''
    }))
  };
  try {
    localStorage.setItem(VARIABLE_UPDATER_TRACE_STORAGE_KEY, JSON.stringify(trace));
  } catch (error) {
    console.warn('[VariableUpdater] 预设链路保存失败:', error.message);
  }
  eventBus.emit('debug:variable-updater-prompt-trace', trace);
}

export async function runVariableUpdater({
  mainConfig,
  userInput,
  enrichedInput,
  state,
  narrativeResponse,
  compactState,
  openingContract = '',
  memoryContext = '',
  knowledgeContext = '',
  onClient
}) {
  const variableConfig = mainConfig?.variableUpdater;
  if (!variableConfig?.enabled) return null;

  const updaterConfig = resolveConfig(mainConfig);
  if (!updaterConfig.model || (updaterConfig.backend !== 'tavern' && !updaterConfig.apiUrl)) {
    eventBus.emit('pipeline:warning', { warning: '变量更新模型配置不完整，已跳过本回合变量更新。请在“变量更新”选项卡中配置。' });
    return null;
  }

  const preset = getVariableUpdaterPreset();
  const messages = resolveVariableUpdaterPreset(preset, {
    compactState,
    userInput,
    enrichedInput,
    narrativeResponse,
    breakthroughInstruction: buildBreakthroughInstruction(state),
    memoryContext,
    knowledgeContext
  });
  if (!messages.length) throw new Error('变量更新预设没有启用的有效条目');
  const runtimeContext = [
    openingContract,
    memoryContext ? `[记忆摘要]\n${memoryContext}` : '',
    knowledgeContext
  ].filter(Boolean).join('\n\n');
  if (runtimeContext) messages.unshift({ role: 'system', content: runtimeContext });

  const generationOptions = {
    temperature: Number.isFinite(Number(variableConfig.temperature)) ? Number(variableConfig.temperature) : 0.9,
    max_tokens: Math.max(256, Number(variableConfig.maxTokens) || 8192)
  };
  publishTrace(messages, { userInput, presetName: preset.name || '未命名预设', generationOptions });

  try {
    const client = new AIClient();
    onClient?.(client);
    client.configure(updaterConfig);
    const variableTags = variableConfig.streaming !== false
      ? await client.chatStream(messages, generationOptions, () => {})
      : await client.chat(messages, generationOptions);
    if (!variableTags || variableTags.trim().length < 20) {
      throw new Error(`变量更新模型返回内容过短（${variableTags?.length || 0}字符），疑似空回或截断`);
    }
    const cleaned = sanitizeVariableUpdaterOutput(variableTags);
    if (!cleaned || cleaned.trim().length < 10) {
      throw new Error(`未检测到有效的 XML 变量标签（原始长度 ${variableTags?.length || 0} 字符）`);
    }
    return cleaned;
  } catch (error) {
    console.warn('[VariableUpdater] 更新失败:', error.message);
    eventBus.emit('pipeline:warning', { warning: `变量更新失败: ${error.message}` });
    throw error;
  } finally {
    onClient?.(null);
  }
}
