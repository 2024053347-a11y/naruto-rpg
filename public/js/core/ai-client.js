import { eventBus } from './event-bus.js';

// 检测是否在酒馆 iframe 环境中
const USE_PROXY = typeof location !== 'undefined' && location.hostname.includes('qiwu.asia');
export const isTavernEnv = typeof globalThis !== 'undefined' && typeof globalThis.generate === 'function';

export class AIAdapter {
  _fetch(url, init) {
    if (!USE_PROXY && init && init.headers) {
      const h = init.headers;
      const realUrl = h['x-target-url'];
      if (realUrl) {
        const nh = { 'Content-Type': 'application/json' };
        if (h['x-user-api-key']) nh['Authorization'] = 'Bearer ' + h['x-user-api-key'];
        return fetch(realUrl, { ...init, headers: nh });
      }
    }
    return fetch(url, init);
  }
  async chat(messages, options) { throw new Error('Not implemented'); }
  async chatStream(messages, options, onChunk) { throw new Error('Not implemented'); }
  getModelInfo() { return { name: 'unknown', contextWindow: 4096 }; }
  validateConfig(config) { return true; }
}

// ── 酒馆适配器：用 generateRaw 直调 API，完全绕过酒馆预设和世界书 ──
class TavernAdapter extends AIAdapter {
  constructor(config) {
    super();
    this.model = config.model || 'tavern-default';
    this.proxyPreset = config.proxyPreset || null;
  }

  getModelInfo() { return { name: this.model, contextWindow: 128000 }; }
  validateConfig() { return true; }

  _buildOptions(userInput, combinedSystem, stream) {
    const opts = {
      user_input: userInput,
      should_stream: stream,
      ordered_prompts: [
        { role: 'system', content: combinedSystem },
        'world_info_before',
      ],
    };
    if (this.proxyPreset) {
      opts.custom_api = { proxy_preset: this.proxyPreset, model: this.model };
    } else if (this.model && this.model !== 'tavern-default') {
      opts.custom_api = { model: this.model };
    }
    return opts;
  }

  async chat(messages, options = {}) {
    const userMsg = [...messages].reverse().find(m => m.role === 'user');
    const userInput = userMsg?.content || '';
    const combinedSystem = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const opts = this._buildOptions(userInput, combinedSystem, false);
    try {
      const result = await globalThis.generateRaw(opts);
      return typeof result === 'string' ? result : (result?.content || result?.text || JSON.stringify(result));
    } catch (e) {
      throw new Error(`酒馆生成失败: ${e.message}`);
    }
  }

  async chatStream(messages, options = {}, onChunk) {
    const userMsg = [...messages].reverse().find(m => m.role === 'user');
    const userInput = userMsg?.content || '';
    const combinedSystem = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');

    const EV = 'iframe_events.STREAM_TOKEN_RECEIVED_FULLY';
    const h = (t) => { if (onChunk) onChunk(t); };
    const eo = globalThis.eventOn;
    if (eo) eo(EV, h);

    const opts = this._buildOptions(userInput, combinedSystem, true);
    try {
      const result = await globalThis.generateRaw(opts);
      if (eo) eo(EV, h);
      return typeof result === 'string' ? result : (result?.content || result?.text || JSON.stringify(result));
    } catch (e) {
      if (eo) eo(EV, h);
      throw new Error(`酒馆流式生成失败: ${e.message}`);
    }
  }
}

class OpenAICompatibleAdapter extends AIAdapter {
  constructor(config) {
    super();
    this.apiKey = config.apiKey || '';
    this.apiUrl = (config.apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'gpt-4o';
  }

  getModelInfo() {
    return { name: this.model, contextWindow: 128000 };
  }

  async chat(messages, options = {}) {
    const response = await this._fetch(`/api/ai-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-target-url': `${this.apiUrl}/chat/completions`,
        'x-user-api-key': this.apiKey,
        'x-api-key-header': 'Authorization'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options.temperature ?? 0.9,
        max_tokens: options.max_tokens ?? 4096,
        top_p: options.top_p ?? 0.9,
        frequency_penalty: options.frequency_penalty ?? 0.2,
        stream: false
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API Error ${response.status}: ${err}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async chatStream(messages, options = {}, onChunk) {
    let lastError = null;
    const maxRetries = options.maxRetries ?? 2;
    const retryDelay = options.retryDelay ?? 800;
    const timeoutMs = options.timeout ?? 90000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, retryDelay * Math.pow(2, attempt - 1)));
        eventBus.emit('pipeline:retrying', { attempt, maxRetries });
      }
      try {
        const internalController = new AbortController();
        const timer = setTimeout(() => internalController.abort(), timeoutMs);

        const signal = options.signal || internalController.signal;
        const onExternalAbort = () => internalController.abort();
        if (options.signal) {
          options.signal.addEventListener('abort', onExternalAbort);
        }

        let fullContent = '';
        try {
          const response = await this._fetch(`/api/ai-proxy`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-target-url': `${this.apiUrl}/chat/completions`,
              'x-user-api-key': this.apiKey,
              'x-api-key-header': 'Authorization'
            },
            body: JSON.stringify({
              model: this.model,
              messages,
              temperature: options.temperature ?? 0.9,
              max_tokens: options.max_tokens ?? 4096,
              top_p: options.top_p ?? 0.9,
              frequency_penalty: options.frequency_penalty ?? 0.2,
              stream: true,
              stream_options: { include_usage: true }
            }),
            signal: signal
          });
          clearTimeout(timer);

          if (!response.ok) {
            const err = await response.text();
            const statusErr = new Error(`API ${response.status}: ${err.slice(0, 200)}`);
            statusErr.statusCode = response.status;
            statusErr.isRateLimited = response.status === 429;
            statusErr.isAuthError = response.status === 401 || response.status === 403;
            statusErr.isOverloaded = response.status >= 500;
            throw statusErr;
          }

          if (!response.body) {
            fullContent = await this.chat(messages, options);
            return fullContent;
          }

          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text/event-stream')) {
            const data = await response.json();
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            const content = data.choices?.[0]?.message?.content || '';
            if (content) {
              if (onChunk) onChunk(content);
              return content;
            }
            throw new Error(`AI 未返回有效回复: ${JSON.stringify(data)}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let lastUsage = null;
          while (true) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            if (done && buffer.trim()) { parts.push(buffer); buffer = ''; }
            const lines = parts.flatMap(part => part.split('\n')).filter(line => line.startsWith('data: '));
            for (const line of lines) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr.startsWith('[DONE]')) {
                if (lastUsage) eventBus.emit('ai:usage', lastUsage);
                continue;
              }
              try {
                const data = JSON.parse(jsonStr);
                if (data.usage && data.usage.total_tokens) lastUsage = data.usage;
                const content = data.choices?.[0]?.delta?.content || '';
                if (content) { fullContent += content; onChunk?.(content); }
              } catch { /* skip malformed chunks */ }
            }
            if (done) {
              if (lastUsage) eventBus.emit('ai:usage', lastUsage);
              break;
            }
          }
          return fullContent || null;
        } catch (fetchError) {
          clearTimeout(timer);
          if (fetchError.name === 'AbortError') {
            const partial = fullContent || null;
            if (partial && attempt === maxRetries) return partial;
            fetchError.isTimeout = true;
            fetchError.partialResponse = partial;
          }
          if (fetchError.statusCode === 429 && attempt < maxRetries) {
            await new Promise(r => setTimeout(r, (retryDelay * 3) * Math.pow(2, attempt)));
          }
          if (onChunk && fetchError.partialResponse) {
            lastError = new Error(`生成被截断，已收到 ${fetchError.partialResponse.length} 字。${attempt < maxRetries ? '正在重试...' : '可点击重试。'}`);
            lastError.partialResponse = fetchError.partialResponse;
          } else {
            lastError = fetchError;
          }
          if (fetchError.isAuthError || attempt >= maxRetries) throw lastError;
        } finally {
          if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
        }
      } catch (outerError) {
        lastError = outerError;
        if (outerError.isAuthError) throw outerError;
        if (attempt >= maxRetries) throw outerError;
      }
    }
    throw lastError || new Error('AI 生成失败');
  }

  validateConfig(config) {
    return !!(config.apiUrl && config.model);
  }

  static async listModels(config) {
    const apiUrl = (config.apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const response = await this._fetch(`/api/ai-proxy`, {
      method: 'GET',
      headers: {
        'x-target-url': `${apiUrl}/models`,
        'x-user-api-key': config.apiKey || '',
        'x-api-key-header': 'Authorization'
      }
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`模型列表读取失败 ${response.status}: ${err}`);
    }
    const data = await response.json();
    let models = [];
    if (data && Array.isArray(data.data)) models = data.data;
    else if (data && Array.isArray(data.models)) models = data.models;
    else if (Array.isArray(data)) models = data;
    
    return models
      .map(item => typeof item === 'string' ? item : item?.id || item?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }
}

class ClaudeAdapter extends AIAdapter {
  constructor(config) {
    super();
    this.apiKey = config.apiKey || '';
    this.apiUrl = (config.apiUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.model = config.model || 'claude-sonnet-4-20250514';
  }

  getModelInfo() {
    return { name: this.model, contextWindow: 200000 };
  }

  _convertMessages(messages) {
    const systemMessages = [];
    const chatMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(msg.content);
      } else {
        chatMessages.push(msg);
      }
    }
    return { system: systemMessages.join('\n\n'), messages: chatMessages };
  }

  async chat(messages, options = {}) {
    const timeoutMs = options.timeout ?? 90000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { system, messages: chatMsgs } = this._convertMessages(messages);
      const body = {
        model: this.model,
        max_tokens: options.max_tokens ?? 4096,
        temperature: options.temperature ?? 0.9,
        messages: chatMsgs
      };
      if (system) body.system = system;
      const response = await this._fetch(`/api/ai-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-target-url': `${this.apiUrl}/messages`,
          'x-user-api-key': this.apiKey,
          'x-api-key-header': 'x-api-key',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API Error ${response.status}: ${err}`);
      }
      const data = await response.json();
      return data.content?.[0]?.text || '';
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Claude API 请求超时');
      throw e;
    }
  }

  async chatStream(messages, options = {}, onChunk) {
    let lastError = null;
    const maxRetries = options.maxRetries ?? 2;
    const retryDelay = options.retryDelay ?? 800;
    const timeoutMs = options.timeout ?? 90000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, retryDelay * Math.pow(2, attempt - 1)));
        eventBus.emit('pipeline:retrying', { attempt, maxRetries });
      }
      try {
        const internalController = new AbortController();
        const timer = setTimeout(() => internalController.abort(), timeoutMs);

        const signal = options.signal || internalController.signal;
        const onExternalAbort = () => internalController.abort();
        if (options.signal) {
          options.signal.addEventListener('abort', onExternalAbort);
        }

        let fullContent = '';
        try {
          const { system, messages: chatMsgs } = this._convertMessages(messages);
          const body = {
            model: this.model,
            max_tokens: options.max_tokens ?? 4096,
            temperature: options.temperature ?? 0.9,
            messages: chatMsgs,
            stream: true
          };
          if (system) body.system = system;
          const response = await this._fetch(`/api/ai-proxy`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-target-url': `${this.apiUrl}/messages`,
              'x-user-api-key': this.apiKey,
              'x-api-key-header': 'x-api-key',
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(body),
            signal: signal
          });
          clearTimeout(timer);

          if (!response.ok) {
            const err = await response.text();
            const statusErr = new Error(`Claude API ${response.status}: ${err.slice(0, 200)}`);
            statusErr.statusCode = response.status;
            statusErr.isRateLimited = response.status === 429;
            statusErr.isAuthError = response.status === 401 || response.status === 403;
            statusErr.isOverloaded = response.status >= 500;
            throw statusErr;
          }
          if (!response.body) {
            fullContent = await this.chat(messages, options);
            return fullContent;
          }

          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text/event-stream')) {
            const data = await response.json();
            if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
            const content = data.content?.[0]?.text || '';
            if (content) {
              if (onChunk) onChunk(content);
              return content;
            }
            throw new Error(`Claude AI 未返回有效回复: ${JSON.stringify(data)}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            if (done && buffer.trim()) { parts.push(buffer); buffer = ''; }
            const lines = parts.flatMap(part => part.split('\n')).filter(line => line.startsWith('data: '));
            for (const line of lines) {
              const jsonStr = line.slice(6).trim();
              try {
                const data = JSON.parse(jsonStr);
                if (data.type === 'content_block_delta') {
                  const text = data.delta?.text || '';
                  if (text) {
                    fullContent += text;
                    onChunk?.(text);
                  }
                }
              } catch { /* skip malformed SSE chunks */ }
            }
            if (done) break;
          }
          return fullContent || null;
        } catch (fetchError) {
          clearTimeout(timer);
          if (fetchError.name === 'AbortError') {
            const partial = fullContent || null;
            if (partial && attempt === maxRetries) return partial;
            fetchError.isTimeout = true;
            fetchError.partialResponse = partial;
          }
          if (fetchError.statusCode === 429 && attempt < maxRetries) {
            await new Promise(r => setTimeout(r, (retryDelay * 3) * Math.pow(2, attempt)));
          }
          if (onChunk && fetchError.partialResponse) {
            lastError = new Error(`生成被截断，已收到 ${fetchError.partialResponse.length} 字。${attempt < maxRetries ? '正在重试...' : '可点击重试。'}`);
            lastError.partialResponse = fetchError.partialResponse;
          } else {
            lastError = fetchError;
          }
          if (fetchError.isAuthError || attempt >= maxRetries) throw lastError;
        } finally {
          if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
        }
      } catch (outerError) {
        lastError = outerError;
        if (outerError.isAuthError) throw outerError;
        if (attempt >= maxRetries) throw outerError;
      }
    }
    throw lastError || new Error('Claude API 生成失败');
  }

  validateConfig(config) {
    return !!(config.model);
  }

  static async listModels(config) {
    const apiUrl = (config.apiUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    const response = await this._fetch(`/api/ai-proxy`, {
      method: 'GET',
      headers: {
        'x-target-url': `${apiUrl}/models`,
        'x-user-api-key': config.apiKey || '',
        'x-api-key-header': 'x-api-key',
        'anthropic-version': '2023-06-01'
      }
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`模型列表读取失败 ${response.status}: ${err}`);
    }
    const data = await response.json();
    const models = Array.isArray(data.data) ? data.data : [];
    return models
      .map(item => typeof item === 'string' ? item : item?.id || item?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }
}

class DeepSeekAdapter extends OpenAICompatibleAdapter {
  constructor(config) {
    super({
      ...config,
      apiUrl: config.apiUrl || 'https://api.deepseek.com/v1',
      model: config.model || 'deepseek-chat'
    });
  }
}

export class AIClient {
  constructor() {
    this.adapter = null;
    this._config = null;
    this._abortController = null;
    this._useProxy = false;
  }

  configure(config) {
    this._config = config;
    this._useProxy = config.useProxy === true;

    const backend = config.backend || 'openai';
    switch (backend) {
      case 'tavern':
        this.adapter = new TavernAdapter(config);
        break;
      case 'claude':
        this.adapter = new ClaudeAdapter(config);
        break;
      case 'deepseek':
        this.adapter = new DeepSeekAdapter(config);
        break;
      case 'custom':
      case 'openai':
      default:
        this.adapter = new OpenAICompatibleAdapter(config);
        break;
    }
  }

  getModelInfo() {
    return this.adapter ? this.adapter.getModelInfo() : { name: '未配置', contextWindow: 0 };
  }

  async chat(messages, options = {}) {
    if (!this.adapter) throw new Error('AI client not configured');
    if (this._useProxy) return this._proxyChat(messages, options, false);
    return this.adapter.chat(messages, options);
  }

  async chatStream(messages, options = {}, onChunk) {
    if (!this.adapter) throw new Error('AI client not configured');
    this._abortController = new AbortController();
    if (this._useProxy) {
      options = { ...options, signal: this._abortController.signal };
      return this._proxyChat(messages, options, true, onChunk);
    }
    options = { ...options, signal: this._abortController.signal };
    return this.adapter.chatStream(messages, options, onChunk);
  }

  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  // ── 代理模式：所有请求经 /api/ai-proxy 转发 ──
  async _proxyChat(messages, options, stream, onChunk) {
    const config = this._config || {};
    const targetUrl = this._buildApiUrl();
    const apiKeyHeader = config.backend === 'claude' ? 'x-api-key' : 'Authorization';

    const headers = {
      'Content-Type': 'application/json',
      'x-target-url': targetUrl,
      'x-user-api-key': config.apiKey || '',
      'x-api-key-header': apiKeyHeader,
    };

    // Separate system messages for Claude/anthropic format
    // The proxy just forwards, so we send the messages as-is
    const body = {
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.9,
      max_tokens: options.max_tokens ?? 4096,
      stream: stream || false,
    };
    if (options.top_p !== undefined) body.top_p = options.top_p;

    try {
      const response = await this._fetch('/api/ai-proxy', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const err = await response.text().catch(() => '');
        throw new Error(`代理错误 ${response.status}: ${err.slice(0, 200)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (stream && onChunk && contentType.includes('text/event-stream')) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        while (true) {
          const { done, value } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          if (done && buffer.trim()) { parts.push(buffer); buffer = ''; }
          
          const lines = parts.flatMap(part => part.split('\n')).filter(l => l.startsWith('data: '));
          for (const line of lines) {
            const json = line.slice(6).trim();
            if (json === '[DONE]') continue;
            try {
              const data = JSON.parse(json);
              const text = data.choices?.[0]?.delta?.content || data.delta?.text || '';
              if (text) { fullContent += text; onChunk(text); }
            } catch {}
          }
          if (done) break;
        }
        return fullContent || null;
      }

      // 非流式或未按流返回（例如报错提示）
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      // Try to extract content from various response formats
      return data.choices?.[0]?.message?.content
        || data.content?.[0]?.text
        || data.choices?.[0]?.text
        || '';
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`代理请求失败: ${e.message}`);
    }
  }

  _buildApiUrl() {
    const config = this._config || {};
    const backend = config.backend || 'openai';
    const baseUrl = (config.apiUrl || '').replace(/\/+$/, '');
    switch (backend) {
      case 'claude':
        return `${baseUrl || 'https://api.anthropic.com/v1'}/messages`;
      case 'deepseek':
        return `${baseUrl || 'https://api.deepseek.com/v1'}/chat/completions`;
      case 'openai':
      case 'custom':
      default:
        return `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    }
  }

  async listModels(config = this._config || {}) {
    const backend = config.backend || 'openai';
    if (!config.apiUrl && backend === 'deepseek') config = { ...config, apiUrl: 'https://api.deepseek.com/v1' };
    if (!config.apiUrl && backend === 'claude') config = { ...config, apiUrl: 'https://api.anthropic.com/v1' };
    if (!config.apiUrl) throw new Error('请先填写 API 地址');
    if (backend === 'claude') return ClaudeAdapter.listModels(config);
    return OpenAICompatibleAdapter.listModels(config);
  }

  getConfig() {
    return this._config;
  }

  isConfigured() {
    if (this.adapter instanceof TavernAdapter) return true;
    return this.adapter?.validateConfig(this._config || {}) ?? false;
  }
}

export const aiClient = new AIClient();
export default aiClient;
