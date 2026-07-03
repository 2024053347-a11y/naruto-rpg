import { eventBus } from './event-bus.js';

/**
 * AI 客户端 —— 多后端适配层
 *
 * 架构：AIClient(门面) → 适配器注册表(策略模式) → 各后端适配器
 *   - TavernAdapter           酒馆(SillyTavern) iframe 环境，直调 generateRaw
 *   - OpenAICompatibleAdapter OpenAI 兼容接口(openai / custom)
 *   - ClaudeAdapter           Anthropic Messages API
 *   - DeepSeekAdapter         OpenAI 兼容接口的 DeepSeek 预设
 *
 * HTTP 后端的公共机制(SSE 解析、超时/重试/部分响应恢复、错误分类)
 * 统一收敛在 StreamingHTTPAdapter 与模块级辅助函数中，
 * 各适配器只通过模板方法提供协议差异(请求体、响应抽取、请求头)。
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} GenerationOptions
 * @property {number}      [temperature]
 * @property {number}      [max_tokens]
 * @property {number}      [top_p]
 * @property {number}      [frequency_penalty]
 * @property {number}      [maxRetries]  最大重试次数(不含首次请求)
 * @property {number}      [retryDelay]  重试基础退避毫秒数(指数递增)
 * @property {number}      [timeout]     单次请求超时毫秒数
 * @property {AbortSignal} [signal]      外部取消信号(由 AIClient.cancel 触发)
 */

/**
 * @typedef {Object} AIConfig
 * @property {'openai'|'claude'|'deepseek'|'custom'|'tavern'} [backend]
 * @property {string}  [apiUrl]
 * @property {string}  [apiKey]
 * @property {string}  [model]
 * @property {boolean} [useProxy]     true 时所有请求走 /api/ai-proxy 通用转发
 * @property {string}  [proxyPreset]  酒馆代理预设名
 */

/** @typedef {(chunk: string) => void} ChunkCallback */

// ───────────────────────── 环境探测与常量 ─────────────────────────

// 仅生产站点(qiwu.asia)存在同源后端代理；本地/GitHub Pages 等环境需改写为直连，
// 否则请求 /api/ai-proxy 会 404。见 proxyAwareFetch。
const USE_PROXY = typeof location !== 'undefined' && location.hostname.includes('qiwu.asia');

/** 是否运行在酒馆(SillyTavern) iframe 环境中 */
export const isTavernEnv = typeof globalThis !== 'undefined' && typeof globalThis.generate === 'function';

const PROXY_ENDPOINT = '/api/ai-proxy';
const ANTHROPIC_API_VERSION = '2023-06-01';
const SSE_CONTENT_TYPE = 'text/event-stream';

const DEFAULT_API_URLS = Object.freeze({
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com/v1'
});

const DEFAULT_MODELS = Object.freeze({
  openai: 'gpt-4o',
  claude: 'claude-sonnet-4-6',
  deepseek: 'deepseek-chat',
  tavern: 'tavern-default'
});

const GENERATION_DEFAULTS = Object.freeze({
  temperature: 0.9,
  maxTokens: 4096,
  topP: 0.9,
  frequencyPenalty: 0.2
});

const RETRY_DEFAULTS = Object.freeze({
  maxRetries: 2,
  retryDelayMs: 800,
  timeoutMs: 90000,
  // 429 触发的额外退避在普通指数退避基础上放大的倍数
  rateLimitBackoffFactor: 3
});

// ───────────────────────── 模块级辅助函数 ─────────────────────────

/** @param {number} ms @returns {Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 去除 URL 尾部斜杠，避免与端点路径拼接时出现双斜杠 */
const trimTrailingSlashes = (url) => (url || '').replace(/\/+$/, '');

/**
 * 代理感知 fetch：
 * 请求头中的 x-target-url / x-user-api-key 是与后端 /api/ai-proxy 的转发协议；
 * 在没有同源代理的环境(本地开发、GitHub Pages)下，把这类请求改写为
 * 直连目标 API —— 将用户密钥放回 Authorization 头，其余转发头全部剥除。
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
function proxyAwareFetch(url, init) {
  if (!USE_PROXY && init && init.headers) {
    const headers = init.headers;
    const targetUrl = headers['x-target-url'];
    if (targetUrl) {
      const directHeaders = { 'Content-Type': 'application/json' };
      if (headers['x-user-api-key']) directHeaders['Authorization'] = 'Bearer ' + headers['x-user-api-key'];
      return fetch(targetUrl, { ...init, headers: directHeaders });
    }
  }
  return fetch(url, init);
}

/**
 * 构造带分类标志的 HTTP 状态错误，调用方(重试引擎/管线)依赖这些标志决策：
 * isAuthError 立即终止重试；isRateLimited 追加退避；isOverloaded 供上层提示。
 * @param {string} label 错误前缀(如 'API' / 'Claude API')
 * @param {Response} response
 * @param {string} bodyText
 * @returns {Error & {statusCode: number, isRateLimited: boolean, isAuthError: boolean, isOverloaded: boolean}}
 */
function buildStatusError(label, response, bodyText) {
  const error = new Error(`${label} ${response.status}: ${bodyText.slice(0, 200)}`);
  error.statusCode = response.status;
  error.isRateLimited = response.status === 429;
  error.isAuthError = response.status === 401 || response.status === 403;
  error.isOverloaded = response.status >= 500;
  return error;
}

/**
 * 逐条产出 SSE 流中 `data: ` 行的负载字符串(含 '[DONE]' 哨兵，由调用方处理)。
 * 按空行切分事件、余量回填 buffer，可正确处理跨 chunk 截断的事件。
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<string>}
 */
async function* readSSEPayloads(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    // 流结束时最后一个事件可能没有结尾空行，也要处理
    if (done && buffer.trim()) { events.push(buffer); buffer = ''; }
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (line.startsWith('data: ')) yield line.slice(6).trim();
      }
    }
    if (done) return;
  }
}

/**
 * 流式请求重试引擎(供所有 HTTP 适配器复用)。
 *
 * 语义约定(与既有管线约定保持一致，勿轻易改动)：
 *  - 第 n 次重试前等待 retryDelay * 2^(n-1)，并广播 pipeline:retrying；
 *  - 429 在此基础上追加 retryDelay * 3 * 2^attempt 的退避；
 *  - 401/403 不重试，立即抛出；
 *  - 中断(AbortError)时：最后一次尝试且已有部分内容 → 直接返回部分内容；
 *    否则在错误上标记 isTimeout / partialResponse 供管线做"截断恢复"展示；
 *  - 存在 onChunk 且捕获到部分内容时，抛出的错误替换为用户可读的截断提示，
 *    并携带 partialResponse(管线依赖该字段渲染已收到的文本)。
 *
 * 遗留语义(刻意保留，详见优化文档"遗留疑问")：外部 options.signal 存在时
 * fetch 只监听外部信号，内部超时控制器无法真正中断请求。
 *
 * @param {{label: string, options: GenerationOptions, onChunk?: ChunkCallback}} ctx
 * @param {(attempt: {signal: AbortSignal, clearTimer: () => void, partial: {text: string}}) => Promise<string|null>} attemptFn
 * @returns {Promise<string|null>}
 */
async function streamWithRetries({ label, options, onChunk }, attemptFn) {
  const maxRetries = options.maxRetries ?? RETRY_DEFAULTS.maxRetries;
  const retryDelay = options.retryDelay ?? RETRY_DEFAULTS.retryDelayMs;
  const timeoutMs = options.timeout ?? RETRY_DEFAULTS.timeoutMs;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelay * Math.pow(2, attempt - 1));
      eventBus.emit('pipeline:retrying', { attempt, maxRetries });
    }

    const internalController = new AbortController();
    const timer = setTimeout(() => internalController.abort(), timeoutMs);
    const signal = options.signal || internalController.signal;
    const onExternalAbort = () => internalController.abort();
    if (options.signal) options.signal.addEventListener('abort', onExternalAbort);

    // partial 由 attemptFn 边流边累积，中断时用于"截断恢复"
    const partial = { text: '' };
    try {
      return await attemptFn({ signal, clearTimer: () => clearTimeout(timer), partial });
    } catch (err) {
      clearTimeout(timer);

      if (err.name === 'AbortError') {
        const partialText = partial.text || null;
        if (partialText && attempt === maxRetries) return partialText;
        err.isTimeout = true;
        err.partialResponse = partialText;
      }
      if (err.statusCode === 429 && attempt < maxRetries) {
        await sleep(retryDelay * RETRY_DEFAULTS.rateLimitBackoffFactor * Math.pow(2, attempt));
      }

      if (onChunk && err.partialResponse) {
        lastError = new Error(`生成被截断，已收到 ${err.partialResponse.length} 字。${attempt < maxRetries ? '正在重试...' : '可点击重试。'}`);
        lastError.partialResponse = err.partialResponse;
      } else {
        lastError = err;
      }
      if (err.isAuthError || attempt >= maxRetries) throw lastError;
    } finally {
      if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
  throw lastError || new Error(`${label}生成失败`);
}

/**
 * 拉取并归一化模型列表(OpenAI 兼容与 Anthropic 通用)。
 * 兼容 {data:[]} / {models:[]} / 裸数组三种返回结构。
 * @param {Record<string, string>} headers 含 x-target-url 转发协议头
 * @returns {Promise<string[]>} 按字典序排序的模型 ID 列表
 */
async function fetchModelList(headers) {
  const response = await proxyAwareFetch(PROXY_ENDPOINT, { method: 'GET', headers });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`模型列表读取失败 ${response.status}: ${err}`);
  }
  const data = await response.json();
  const rawList = Array.isArray(data?.data) ? data.data
    : Array.isArray(data?.models) ? data.models
    : Array.isArray(data) ? data
    : [];
  return rawList
    .map((item) => (typeof item === 'string' ? item : item?.id || item?.name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// ───────────────────────── 适配器基类 ─────────────────────────

/** 适配器抽象接口(公开导出，供外部自定义后端时继承) */
export class AIAdapter {
  /**
   * @param {ChatMessage[]} messages
   * @param {GenerationOptions} [options]
   * @returns {Promise<string>}
   */
  async chat(messages, options) { throw new Error('Not implemented'); }

  /**
   * @param {ChatMessage[]} messages
   * @param {GenerationOptions} [options]
   * @param {ChunkCallback} [onChunk]
   * @returns {Promise<string|null>}
   */
  async chatStream(messages, options, onChunk) { throw new Error('Not implemented'); }

  /** @returns {{name: string, contextWindow: number}} */
  getModelInfo() { return { name: 'unknown', contextWindow: 4096 }; }

  /** @param {AIConfig} config @returns {boolean} */
  validateConfig(config) { return true; }
}

/**
 * HTTP 流式适配器基类(模板方法模式)。
 * 子类只需实现协议差异钩子：
 *   _buildRequestBody / _buildHeaders / _extractFullText / _extractStreamDelta / _extractUsage
 */
class StreamingHTTPAdapter extends AIAdapter {
  /**
   * @param {AIConfig} config
   * @param {{backend: string, contextWindow: number, errorLabel: string, emptyReplyLabel: string, failureLabel: string}} meta
   */
  constructor(config, meta) {
    super();
    this.apiKey = config.apiKey || '';
    this.apiUrl = trimTrailingSlashes(config.apiUrl || DEFAULT_API_URLS[meta.backend]);
    this.model = config.model || DEFAULT_MODELS[meta.backend];
    this._meta = meta;
  }

  getModelInfo() {
    return { name: this.model, contextWindow: this._meta.contextWindow };
  }

  // ── 协议差异钩子(子类必须实现) ──

  /** @abstract @returns {Record<string, string>} 含转发协议头的请求头 */
  _buildHeaders() { throw new Error('Not implemented'); }

  /** @abstract @returns {Object} 目标 API 请求体 */
  _buildRequestBody(messages, options, stream) { throw new Error('Not implemented'); }

  /** @abstract 非流式响应 → 正文文本 */
  _extractFullText(data) { throw new Error('Not implemented'); }

  /** @abstract 流式增量事件 → 文本片段('' 表示无内容) */
  _extractStreamDelta(data) { throw new Error('Not implemented'); }

  /** 流式增量事件 → usage 统计(默认不支持，返回 null) */
  _extractUsage(data) { return null; }

  // ── 公共实现 ──

  /** @override 非流式对话(带超时保护) */
  async chat(messages, options = {}) {
    const timeoutMs = options.timeout ?? RETRY_DEFAULTS.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await proxyAwareFetch(PROXY_ENDPOINT, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(this._buildRequestBody(messages, options, false)),
        signal: controller.signal
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`${this._meta.errorLabel} Error ${response.status}: ${err}`);
      }
      const data = await response.json();
      return this._extractFullText(data);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`${this._meta.errorLabel} 请求超时`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @override 流式对话(SSE + 超时/重试/截断恢复) */
  async chatStream(messages, options = {}, onChunk) {
    const { errorLabel, emptyReplyLabel, failureLabel } = this._meta;
    return streamWithRetries({ label: failureLabel, options, onChunk }, async ({ signal, clearTimer, partial }) => {
      const response = await proxyAwareFetch(PROXY_ENDPOINT, {
        method: 'POST',
        headers: this._buildHeaders(),
        body: JSON.stringify(this._buildRequestBody(messages, options, true)),
        signal
      });
      clearTimer();

      if (!response.ok) {
        const errText = await response.text();
        throw buildStatusError(errorLabel, response, errText);
      }

      // 某些网关不返回可读流：退回非流式请求兜底
      if (!response.body) return this.chat(messages, options);

      // 请求了流式但对方按 JSON 整体返回(常见于代理层报错或不支持 SSE)
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes(SSE_CONTENT_TYPE)) {
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        const content = this._extractFullText(data);
        if (content) {
          onChunk?.(content);
          return content;
        }
        throw new Error(`${emptyReplyLabel}: ${JSON.stringify(data)}`);
      }

      let usage = null;
      for await (const payload of readSSEPayloads(response.body)) {
        if (payload.startsWith('[DONE]')) continue;
        try {
          const data = JSON.parse(payload);
          usage = this._extractUsage(data) ?? usage;
          const delta = this._extractStreamDelta(data);
          if (delta) {
            partial.text += delta;
            onChunk?.(delta);
          }
        } catch { /* 跳过畸形 SSE 块 */ }
      }
      if (usage) eventBus.emit('ai:usage', usage);
      return partial.text || null;
    });
  }
}

// ───────────────────────── 具体适配器 ─────────────────────────

/**
 * 酒馆适配器：用 generateRaw 直调宿主 API，完全绕过酒馆预设和世界书。
 */
class TavernAdapter extends AIAdapter {
  /** 酒馆宿主流式 token 事件名 */
  static STREAM_EVENT = 'iframe_events.STREAM_TOKEN_RECEIVED_FULLY';

  /** @param {AIConfig} config */
  constructor(config) {
    super();
    this.model = config.model || DEFAULT_MODELS.tavern;
    this.proxyPreset = config.proxyPreset || null;
  }

  getModelInfo() { return { name: this.model, contextWindow: 128000 }; }
  validateConfig() { return true; }

  /** 从消息数组拆出酒馆需要的 user_input 与合并后的 system 提示 */
  _splitPrompt(messages) {
    const userMsg = [...messages].reverse().find((m) => m.role === 'user');
    return {
      userInput: userMsg?.content || '',
      combinedSystem: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    };
  }

  _buildOptions(userInput, combinedSystem, stream) {
    const opts = {
      user_input: userInput,
      should_stream: stream,
      ordered_prompts: [
        { role: 'system', content: combinedSystem },
        'world_info_before'
      ]
    };
    if (this.proxyPreset) {
      opts.custom_api = { proxy_preset: this.proxyPreset, model: this.model };
    } else if (this.model && this.model !== DEFAULT_MODELS.tavern) {
      opts.custom_api = { model: this.model };
    }
    return opts;
  }

  /** generateRaw 的返回值形态不稳定(字符串/对象)，统一归一为字符串 */
  _normalizeResult(result) {
    return typeof result === 'string' ? result : (result?.content || result?.text || JSON.stringify(result));
  }

  /** @override */
  async chat(messages, options = {}) {
    const { userInput, combinedSystem } = this._splitPrompt(messages);
    try {
      const result = await globalThis.generateRaw(this._buildOptions(userInput, combinedSystem, false));
      return this._normalizeResult(result);
    } catch (e) {
      throw new Error(`酒馆生成失败: ${e.message}`);
    }
  }

  /** @override */
  async chatStream(messages, options = {}, onChunk) {
    const { userInput, combinedSystem } = this._splitPrompt(messages);
    const handler = (token) => { onChunk?.(token); };
    const subscribe = globalThis.eventOn;
    // 宿主可能暴露 eventRemoveListener 或 eventOff 之一；都不存在时只能放弃注销
    const unsubscribe = globalThis.eventRemoveListener || globalThis.eventOff || null;
    if (subscribe) subscribe(TavernAdapter.STREAM_EVENT, handler);
    try {
      const result = await globalThis.generateRaw(this._buildOptions(userInput, combinedSystem, true));
      return this._normalizeResult(result);
    } catch (e) {
      throw new Error(`酒馆流式生成失败: ${e.message}`);
    } finally {
      if (subscribe && unsubscribe) unsubscribe(TavernAdapter.STREAM_EVENT, handler);
    }
  }
}

/** OpenAI 兼容适配器(backend: openai / custom) */
class OpenAICompatibleAdapter extends StreamingHTTPAdapter {
  /** @param {AIConfig} config */
  constructor(config) {
    super(config, {
      backend: 'openai',
      contextWindow: 128000,
      errorLabel: 'API',
      emptyReplyLabel: 'AI 未返回有效回复',
      failureLabel: 'AI '
    });
  }

  _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-target-url': `${this.apiUrl}/chat/completions`,
      'x-user-api-key': this.apiKey,
      'x-api-key-header': 'Authorization'
    };
  }

  _buildRequestBody(messages, options, stream) {
    const body = {
      model: this.model,
      messages,
      temperature: options.temperature ?? GENERATION_DEFAULTS.temperature,
      max_tokens: options.max_tokens ?? GENERATION_DEFAULTS.maxTokens,
      top_p: options.top_p ?? GENERATION_DEFAULTS.topP,
      frequency_penalty: options.frequency_penalty ?? GENERATION_DEFAULTS.frequencyPenalty,
      stream
    };
    if (stream) body.stream_options = { include_usage: true };
    return body;
  }

  _extractFullText(data) {
    return data.choices?.[0]?.message?.content || '';
  }

  _extractStreamDelta(data) {
    return data.choices?.[0]?.delta?.content || '';
  }

  _extractUsage(data) {
    return data.usage?.total_tokens ? data.usage : null;
  }

  /**
   * @param {AIConfig} config
   * @returns {Promise<string[]>}
   */
  static async listModels(config) {
    const apiUrl = trimTrailingSlashes(config.apiUrl || DEFAULT_API_URLS.openai);
    return fetchModelList({
      'x-target-url': `${apiUrl}/models`,
      'x-user-api-key': config.apiKey || '',
      'x-api-key-header': 'Authorization'
    });
  }

  validateConfig(config) {
    return !!(config.apiUrl && config.model);
  }
}

/** Anthropic Messages API 适配器 */
class ClaudeAdapter extends StreamingHTTPAdapter {
  /** @param {AIConfig} config */
  constructor(config) {
    super(config, {
      backend: 'claude',
      contextWindow: 200000,
      errorLabel: 'Claude API',
      emptyReplyLabel: 'Claude AI 未返回有效回复',
      failureLabel: 'Claude API '
    });
  }

  /**
   * Anthropic 协议中 system 是独立字段而非 messages 成员，需要拆分。
   * @param {ChatMessage[]} messages
   * @returns {{system: string, messages: ChatMessage[]}}
   */
  _convertMessages(messages) {
    const systemMessages = [];
    const chatMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') systemMessages.push(msg.content);
      else chatMessages.push(msg);
    }
    return { system: systemMessages.join('\n\n'), messages: chatMessages };
  }

  _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-target-url': `${this.apiUrl}/messages`,
      'x-user-api-key': this.apiKey,
      'x-api-key-header': 'x-api-key',
      'anthropic-version': ANTHROPIC_API_VERSION
    };
  }

  _buildRequestBody(messages, options, stream) {
    const { system, messages: chatMsgs } = this._convertMessages(messages);
    const body = {
      model: this.model,
      max_tokens: options.max_tokens ?? GENERATION_DEFAULTS.maxTokens,
      temperature: options.temperature ?? GENERATION_DEFAULTS.temperature,
      messages: chatMsgs
    };
    if (stream) body.stream = true;
    if (system) body.system = system;
    return body;
  }

  _extractFullText(data) {
    return data.content?.[0]?.text || '';
  }

  _extractStreamDelta(data) {
    return data.type === 'content_block_delta' ? (data.delta?.text || '') : '';
  }

  /**
   * @param {AIConfig} config
   * @returns {Promise<string[]>}
   */
  static async listModels(config) {
    const apiUrl = trimTrailingSlashes(config.apiUrl || DEFAULT_API_URLS.claude);
    return fetchModelList({
      'x-target-url': `${apiUrl}/models`,
      'x-user-api-key': config.apiKey || '',
      'x-api-key-header': 'x-api-key',
      'anthropic-version': ANTHROPIC_API_VERSION
    });
  }

  validateConfig(config) {
    return !!(config.model);
  }
}

/** DeepSeek：即 OpenAI 兼容接口 + DeepSeek 默认地址/模型 */
class DeepSeekAdapter extends OpenAICompatibleAdapter {
  /** @param {AIConfig} config */
  constructor(config) {
    super({
      ...config,
      apiUrl: config.apiUrl || DEFAULT_API_URLS.deepseek,
      model: config.model || DEFAULT_MODELS.deepseek
    });
  }
}

/** backend 值 → 适配器类(未命中一律回退 OpenAI 兼容) */
const ADAPTER_REGISTRY = Object.freeze({
  tavern: TavernAdapter,
  claude: ClaudeAdapter,
  deepseek: DeepSeekAdapter,
  openai: OpenAICompatibleAdapter,
  custom: OpenAICompatibleAdapter
});

// ───────────────────────── 客户端门面 ─────────────────────────

export class AIClient {
  constructor() {
    /** @type {AIAdapter|null} */
    this.adapter = null;
    /** @type {AIConfig|null} */
    this._config = null;
    /** @type {AbortController|null} */
    this._abortController = null;
    this._useProxy = false;
  }

  /** @param {AIConfig} config */
  configure(config) {
    this._config = config;
    this._useProxy = config.useProxy === true;
    const AdapterClass = ADAPTER_REGISTRY[config.backend] || OpenAICompatibleAdapter;
    this.adapter = new AdapterClass(config);
  }

  getModelInfo() {
    return this.adapter ? this.adapter.getModelInfo() : { name: '未配置', contextWindow: 0 };
  }

  /**
   * @param {ChatMessage[]} messages
   * @param {GenerationOptions} [options]
   * @returns {Promise<string>}
   */
  async chat(messages, options = {}) {
    if (!this.adapter) throw new Error('AI client not configured');
    if (this._useProxy) return this._proxyChat(messages, options, false);
    return this.adapter.chat(messages, options);
  }

  /**
   * @param {ChatMessage[]} messages
   * @param {GenerationOptions} [options]
   * @param {ChunkCallback} [onChunk]
   * @returns {Promise<string|null>}
   */
  async chatStream(messages, options = {}, onChunk) {
    if (!this.adapter) throw new Error('AI client not configured');
    this._abortController = new AbortController();
    const streamOptions = { ...options, signal: this._abortController.signal };
    if (this._useProxy) return this._proxyChat(messages, streamOptions, true, onChunk);
    return this.adapter.chatStream(messages, streamOptions, onChunk);
  }

  /** 取消当前流式生成(触发 chatStream 传入的 AbortSignal) */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /**
   * 通用代理模式：不经适配器，按统一 OpenAI 形态请求体经 /api/ai-proxy 转发，
   * 响应侧同时兼容 OpenAI 与 Anthropic 的增量/整体格式。
   * @param {ChatMessage[]} messages
   * @param {GenerationOptions} options
   * @param {boolean} stream
   * @param {ChunkCallback} [onChunk]
   * @returns {Promise<string|null>}
   */
  async _proxyChat(messages, options, stream, onChunk) {
    const config = this._config || {};
    const headers = {
      'Content-Type': 'application/json',
      'x-target-url': this._buildApiUrl(),
      'x-user-api-key': config.apiKey || '',
      'x-api-key-header': config.backend === 'claude' ? 'x-api-key' : 'Authorization'
    };

    // 代理只做转发，这里不区分后端拆分 system(与历史行为一致)
    const body = {
      model: config.model,
      messages,
      temperature: options.temperature ?? GENERATION_DEFAULTS.temperature,
      max_tokens: options.max_tokens ?? GENERATION_DEFAULTS.maxTokens,
      stream: stream || false
    };
    if (options.top_p !== undefined) body.top_p = options.top_p;

    try {
      const response = await proxyAwareFetch(PROXY_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal
      });

      if (!response.ok) {
        const err = await response.text().catch(() => '');
        throw new Error(`代理错误 ${response.status}: ${err.slice(0, 200)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (stream && onChunk && contentType.includes(SSE_CONTENT_TYPE)) {
        let fullContent = '';
        for await (const payload of readSSEPayloads(response.body)) {
          if (payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            const text = data.choices?.[0]?.delta?.content || data.delta?.text || '';
            if (text) {
              fullContent += text;
              onChunk(text);
            }
          } catch { /* 跳过畸形 SSE 块 */ }
        }
        return fullContent || null;
      }

      // 非流式，或未按流返回(例如代理层报错提示)
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      return data.choices?.[0]?.message?.content
        || data.content?.[0]?.text
        || data.choices?.[0]?.text
        || '';
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`代理请求失败: ${e.message}`);
    }
  }

  /** 通用代理模式下按后端拼出目标对话端点 */
  _buildApiUrl() {
    const config = this._config || {};
    const backend = config.backend || 'openai';
    const baseUrl = trimTrailingSlashes(config.apiUrl);
    if (backend === 'claude') {
      return `${baseUrl || DEFAULT_API_URLS.claude}/messages`;
    }
    const defaultBase = DEFAULT_API_URLS[backend] || DEFAULT_API_URLS.openai;
    return `${baseUrl || defaultBase}/chat/completions`;
  }

  /**
   * @param {AIConfig} [config] 缺省用当前配置
   * @returns {Promise<string[]>}
   */
  async listModels(config = this._config || {}) {
    const backend = config.backend || 'openai';
    // 仅 deepseek / claude 允许留空地址走官方默认；openai / custom 留空视为未配置
    if (!config.apiUrl && (backend === 'deepseek' || backend === 'claude')) {
      config = { ...config, apiUrl: DEFAULT_API_URLS[backend] };
    }
    if (!config.apiUrl) throw new Error('请先填写 API 地址');
    if (backend === 'claude') return ClaudeAdapter.listModels(config);
    return OpenAICompatibleAdapter.listModels(config);
  }

  /** @returns {AIConfig|null} */
  getConfig() {
    return this._config;
  }

  /** @returns {boolean} */
  isConfigured() {
    if (this.adapter instanceof TavernAdapter) return true;
    return this.adapter?.validateConfig(this._config || {}) ?? false;
  }
}

export const aiClient = new AIClient();
export default aiClient;
