import { AIClient } from './ai-client.js';
import { stateManager } from './state-manager.js';
import { eventBus } from './event-bus.js';
import { AGENT_MANIFESTS, AGENT_TIMEOUTS } from './agent-manifests.js';
import { AGENT_PROMPTS } from './agent-prompts.js';
import { getAgentConfig } from '../data/agent-config.js';
import { getMainPreset, resolvePresetMacros } from '../data/default-preset.js';

class AgentRunner {
  constructor() {
    this._mainClient = null;
    this._criticClient = null;
    this._aborted = false;
  }

  configure() {
    const baseConfig = stateManager.getAPIConfig() || {};
    const agentCfg = getAgentConfig();

    this._mainClient = new AIClient();
    this._mainClient.configure({
      ...baseConfig,
      model: agentCfg.agentModel || baseConfig.model
    });

    this._criticClient = new AIClient();
    this._criticClient.configure({
      ...baseConfig,
      model: agentCfg.criticModel || agentCfg.agentModel || baseConfig.model
    });

    this._aborted = false;
  }

  abort() {
    this._aborted = true;
    this._mainClient?.cancel();
    this._criticClient?.cancel();
  }

  _getClient(agentType) {
    const critics = ['critic-realism', 'critic-character', 'critic-detail', 'critic-style', 'brainstormer'];
    return critics.includes(agentType) ? this._criticClient : this._mainClient;
  }

  async run(agentType, { state, userInput, taskPrompt, extraContext = {}, options = {}, onChunk }) {
    if (this._aborted) throw new AgentAbortError();

    const manifest = AGENT_MANIFESTS[agentType];
    if (!manifest) throw new Error(`Unknown agent type: ${agentType}`);

    const client = this._getClient(agentType);
    if (!client?.isConfigured()) throw new Error('Agent AI client not configured');

    const messages = this._buildMessages(agentType, manifest, { state, userInput, taskPrompt, extraContext });
    const timeout = AGENT_TIMEOUTS[agentType] || 30000;

    const genOptions = {
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 2048,
      top_p: options.top_p ?? 0.9,
      timeout,
      ...options
    };

    eventBus.emit('agent:call-start', { agentType });
    try {
      let response = '';
      if (onChunk) {
        response = await client.chatStream(messages, genOptions, onChunk);
      } else {
        response = await client.chat(messages, genOptions);
      }
      eventBus.emit('agent:call-end', { agentType, success: true });
      return this._parseResponse(response, agentType);
    } catch (err) {
      eventBus.emit('agent:call-end', { agentType, success: false, error: err.message });
      throw err;
    }
  }

  async runParallel(agents) {
    const results = new Map();
    const promises = agents.map(async ({ type, key, params }) => {
      const resultKey = key || type;
      try {
        const result = await this.run(type, params);
        results.set(resultKey, { success: true, data: result });
      } catch (err) {
        if (err instanceof AgentAbortError) throw err;
        console.warn(`[AgentRunner] ${resultKey} failed:`, err.message);
        results.set(resultKey, { success: false, error: err.message });
      }
    });
    await Promise.allSettled(promises);
    return results;
  }

  _buildMessages(agentType, manifest, { state, userInput, taskPrompt, extraContext }) {
    const messages = [];

    // 1. Static System Prompt (Highly cacheable)
    const systemPrompt = AGENT_PROMPTS[manifest.systemPromptKey];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 2. Preset Context (Mostly static, highly cacheable)
    if (manifest.includePreset) {
      const presetContext = this._buildPresetContext(state, userInput);
      if (presetContext) {
        messages.push({ role: 'system', content: presetContext });
      }
    }

    // 3. Conversation History (Growing prefix, cacheable up to the last turn)
    if (manifest.includeHistory && manifest.historyTurns > 0 && extraContext._pipeline) {
      const history = extraContext._pipeline.getHistory();
      const recent = history.slice(-(manifest.historyTurns * 2));
      if (recent.length > 0) messages.push(...recent);
    }

    // 4. Dynamic Task Content & State (Volatile, appended at the end to maximize cache hit rate)
    let userContent = '';

    const stateSlice = this._extractStateSlice(state, manifest.stateFields);
    if (Object.keys(stateSlice).length > 0) {
      const stateText = JSON.stringify(stateSlice, null, 0).slice(0, manifest.maxContextChars || 8000);
      userContent += `[当前游戏状态]\n${stateText}\n\n`;
    }

    if (extraContext.outline) userContent += `[叙事大纲]\n${JSON.stringify(extraContext.outline)}\n\n`;      
    if (extraContext.reviews) userContent += `[审查建议]\n${JSON.stringify(extraContext.reviews)}\n\n`;       
    if (extraContext.draft) userContent += `[初稿正文]\n${extraContext.draft}\n\n`;
    if (extraContext.characterInputs?.length) userContent += `[角色代理素材]\n${JSON.stringify(extraContext.characterInputs)}\n\n`;
    if (extraContext.suggestions?.length) userContent += `[修改建议]\n${JSON.stringify(extraContext.suggestions)}\n\n`;

    if (userInput) userContent += `[玩家输入] ${userInput}\n\n`;
    userContent += `[任务指令] ${taskPrompt || ''}`;

    messages.push({ role: 'user', content: userContent.trim() });

    return messages;
  }

  _buildPresetContext(state, userInput) {
    try {
      const preset = getMainPreset();
      if (!preset?.entries?.length) return null;

      const context = {
        playerName: state.player?.name || '玩家',
        charName: state.player?.name || '',
        lastUserMessage: userInput || '',
        lastChatMessage: ''
      };

      const resolved = resolvePresetMacros(preset.entries, context);
      const systemEntries = resolved.filter(e => e.role === 'system').map(e => e.content);
      if (!systemEntries.length) return null;

      return '[写作风格指令 - 主预设精要]\n' + systemEntries.slice(0, 5).join('\n\n---\n\n').slice(0, 4000);
    } catch {
      return null;
    }
  }

  _extractStateSlice(state, fields) {
    if (!fields?.length) return {};
    const slice = {};
    for (const field of fields) {
      const parts = field.split('.');
      let src = state;
      let dst = slice;
      for (let i = 0; i < parts.length; i++) {
        const k = parts[i];
        if (src == null || src[k] === undefined) break;
        if (i === parts.length - 1) {
          dst[k] = src[k];
        } else {
          if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
          dst = dst[k];
          src = src[k];
        }
      }
    }
    return slice;
  }

  _parseResponse(response, agentType) {
    if (!response) return null;
    const text = response.trim();

    try { return JSON.parse(text); } catch {}

    const jsonBlock = text.match(/\x60\x60\x60json\s*([\s\S]*?)\s*\x60\x60\x60/);
    if (jsonBlock) { try { return JSON.parse(jsonBlock[1]); } catch {} }

    const braceMatch = text.match(/(\{[\s\S]*\})/);
    if (braceMatch) { try { return JSON.parse(braceMatch[1]); } catch {} }

    const writerTypes = ['writer', 'writer-polish'];
    if (writerTypes.includes(agentType)) return { _raw: text };

    console.warn(`[AgentRunner] Failed to parse ${agentType} response as JSON, returning raw`);
    return { _raw: text };
  }
}

class AgentAbortError extends Error {
  constructor() { super('Agent pipeline aborted'); this.name = 'AgentAbortError'; }
}

export { AgentRunner, AgentAbortError };
