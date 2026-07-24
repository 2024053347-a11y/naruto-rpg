import { AIClient } from './ai-client.js';
import { stateManager } from './state-manager.js';
import { eventBus } from './event-bus.js';
import { AGENT_MANIFESTS, AGENT_TIMEOUTS } from './agent-manifests.js';
import { AGENT_PROMPTS } from './agent-prompts.js';
import { getAgentConfig } from '../data/agent-config.js';
import { getMainPreset, resolvePresetMacros } from '../data/default-preset.js';
import { generateMainVarInstructions } from '../data/var-schema.js';
import { formatOpeningContractPrompt, resolveOpeningContract } from '../systems/opening-contract.js';
import { publishPromptTrace } from './prompt-trace.js';
import { TurnEvidenceCompiler, renderEvidenceView } from './turn-evidence.js';

export function evidenceAudienceForAgent(agentType) {
  if (agentType === 'character') return 'npc';
  if (agentType === 'future-guardian') return 'planner';
  if (agentType.startsWith('critic-')) return 'reviewer';
  return 'writer';
}

function formatConstraintItem(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatConstraintItem).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const preferred = [
      'location', 'beatId', 'npc', 'severity', 'rule', 'type', 'description',
      'suggestion', 'current', 'improved', 'summary', 'text'
    ];
    const keys = [...preferred.filter(key => value[key] != null), ...Object.keys(value).filter(key => !preferred.includes(key))];
    return keys.map(key => `${key}: ${formatConstraintItem(value[key])}`).filter(line => !line.endsWith(': ')).join('；');
  }
  return String(value);
}

class AgentRunner {
  constructor({ pipeline = null } = {}) {
    this._pipeline = pipeline;
    this._fallbackEvidenceCompiler = null;
    this._mainClient = null;
    this._criticClient = null;
    this._models = { main: '', critic: '' };
    this._aborted = false;
  }

  configure() {
    const baseConfig = stateManager.getAPIConfig() || {};
    const agentCfg = getAgentConfig();
    this._models = {
      main: agentCfg.agentModel || baseConfig.model || '',
      critic: agentCfg.criticModel || agentCfg.agentModel || baseConfig.model || ''
    };

    this._mainClient = new AIClient();
    this._mainClient.configure({
      ...baseConfig,
      model: this._models.main
    });

    this._criticClient = new AIClient();
    this._criticClient.configure({
      ...baseConfig,
      model: this._models.critic
    });

    this._aborted = false;
  }

  abort() {
    this._aborted = true;
    this._mainClient?.cancel();
    this._criticClient?.cancel();
  }

  _getClient(agentType) {
    const critics = ['critic-realism', 'critic-character', 'critic-detail', 'critic-style', 'brainstormer', 'future-guardian'];
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

    const isCritic = ['critic-realism', 'critic-character', 'critic-detail', 'critic-style', 'brainstormer', 'future-guardian'].includes(agentType);
    publishPromptTrace({
      kind: 'agent',
      title: `Agent 模型请求：${agentType}`,
      agentType,
      userInput,
      model: isCritic ? this._models.critic : this._models.main,
      generationOptions: genOptions,
      messages,
      messageSources: messages.map((_, index) => ({
        source: index === messages.length - 1 ? 'Agent 动态任务' : 'Agent 上下文',
        label: `${agentType}#${index + 1}`
      }))
    });

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
    // ══ Writer/Polish 继承主 Pipeline 模式 ══
    if ((agentType === 'writer' || agentType === 'writer-polish') && extraContext._inheritFromMainPipeline && extraContext._mainMessages) {
      const baseMessages = extraContext._mainMessages;
      const constraint = this._buildWriterConstraint(extraContext, state);
      return [...baseMessages, { role: 'system', content: constraint }];
    }

    // ══ 标准 Agent 模式 ══
    const messages = [];

    // 1. Static System Prompt (Highly cacheable)
    let systemPrompt = AGENT_PROMPTS[manifest.systemPromptKey];
    try {
      const override = localStorage.getItem(`naruto_preset_${manifest.systemPromptKey}`);
      if (override !== null) systemPrompt = override;
    } catch (e) {}

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const evidenceAudience = evidenceAudienceForAgent(agentType);
    const npcName = evidenceAudience === 'npc' ? String(extraContext.npcName || '') : '';
    const relationship = npcName ? state?._relationships?.[npcName] : null;
    const entityId = relationship?.entity_id || relationship?.npc_id || null;
    let evidenceView = extraContext.evidenceView || null;
    if (!evidenceView && this._pipeline?.getTurnEvidenceView) {
      evidenceView = this._pipeline.getTurnEvidenceView(evidenceAudience, {
        state,
        userInput,
        entityId,
        npcName
      });
    }
    if (!evidenceView) {
      this._fallbackEvidenceCompiler ||= new TurnEvidenceCompiler();
      const packet = this._fallbackEvidenceCompiler.compile({ state, userInput });
      evidenceView = this._fallbackEvidenceCompiler.project(packet, {
        audience: evidenceAudience,
        entityId,
        npcName
      });
    }
    if (evidenceView) {
      messages.push({
        role: 'system',
        content: renderEvidenceView(evidenceView, { stage: `agent-${agentType}` })
      });
    } else {
      const openingContract = formatOpeningContractPrompt(resolveOpeningContract(state), {
        compact: true,
        audience: agentType === 'character' ? 'npc' : 'narrator'
      });
      if (openingContract) messages.push({ role: 'system', content: openingContract });
    }

    // 2. Preset Context (Mostly static, highly cacheable)
    if (manifest.includePreset) {
      const presetMsgs = this._buildPresetMessages(state, userInput);
      if (presetMsgs && presetMsgs.length > 0) {
        messages.push(...presetMsgs);
      }
    }

    // 3. Conversation History (Growing prefix, cacheable up to the last turn)
    if (manifest.includeHistory && manifest.historyTurns > 0 && extraContext._pipeline) {
      const history = extraContext._pipeline.getHistory();
      const recent = history.slice(-(manifest.historyTurns * 2));

      // 智能裁剪：压缩过长的 AI 回复
      const compressed = recent.map(msg => {
        if (msg.role === 'assistant' && msg.content.length > 800) {
          return {
            role: msg.role,
            content: msg.content.slice(0, 400) + '\n[...已省略中间部分...]\n' + msg.content.slice(-400)
          };
        }
        return msg;
      });

      if (compressed.length > 0) messages.push(...compressed);
    }

    // 4. Dynamic Task Content & State (Volatile, appended at the end to maximize cache hit rate)
    let userContent = '';

    const stateSlice = evidenceView ? {} : this._extractStateSlice(state, manifest.stateFields);
    if (Object.keys(stateSlice).length > 0) {
      const stateText = this._formatStateCompact(stateSlice, manifest.maxContextChars || 8000);
      userContent += `[当前游戏状态]\n${stateText}\n\n`;
    }

    if (extraContext.outline) userContent += `[叙事大纲]\n${JSON.stringify(extraContext.outline)}\n\n`;
    if (extraContext.guardianCandidates?.length) {
      userContent += `[待判定安全候选 · 本地整数ID]\n${JSON.stringify(extraContext.guardianCandidates)}\n\n`;
    }
    if (extraContext.guardianOutline) {
      userContent += `[待判定安全大纲 · 本地整数ID]\n${JSON.stringify(extraContext.guardianOutline)}\n\n`;
    }
    if (extraContext.reviews) userContent += `[审查建议]\n${JSON.stringify(extraContext.reviews)}\n\n`;
    if (extraContext.draft) userContent += `[初稿正文]\n${extraContext.draft}\n\n`;
    if (extraContext.characterInputs?.length) userContent += `[角色代理素材]\n${JSON.stringify(extraContext.characterInputs)}\n\n`;
    if (extraContext.suggestions?.length) userContent += `[修改建议]\n${JSON.stringify(extraContext.suggestions)}\n\n`;

    if (userInput) userContent += `[玩家输入] ${userInput}\n\n`;
    userContent += `[任务指令] ${taskPrompt || ''}`;

    messages.push({ role: 'user', content: userContent.trim() });

    return messages;
  }

  _formatStateCompact(stateSlice, maxChars) {
    const lines = [];
    for (const [key, value] of Object.entries(stateSlice)) {
      if (key.startsWith('_') || typeof value === 'object') {
        // 复杂对象保留 JSON
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        // 简单值直接拼接
        lines.push(`${key}: ${value}`);
      }
    }
    const result = lines.join('\n');
    return result.slice(0, maxChars);
  }

  _buildWriterConstraint(extraContext, state) {
    let constraint = '\n\n【Agent 写作约束】\n\n';
    
    // 1. 大纲结构化展示（不用裸JSON）
    if (extraContext.outline?.beats) {
      constraint += '## 叙事大纲\n';
      for (const beat of extraContext.outline.beats) {
        constraint += `\n### Beat ${beat.id}: ${beat.summary || ''}\n`;
        if (beat.scene) constraint += `场景: ${beat.scene}\n`;
        if (beat.tension) constraint += `张力: ${beat.tension}\n`;
        const beatActions = Array.isArray(beat.actions)
          ? beat.actions
          : (beat.action ? [beat.action] : []);
        if (beatActions.length) {
          constraint += '行动:\n' + beatActions.map(action => `- ${formatConstraintItem(action)}`).join('\n') + '\n';
        }
        if (beat.dialogue?.length) {
          constraint += '对话:\n' + beat.dialogue.map(d => `- ${d}`).join('\n') + '\n';
        }
        if (beat._reviews?.length) {
          constraint += '⚠️ 必须修正:\n' + beat._reviews.map(review => `- ${formatConstraintItem(review)}`).join('\n') + '\n';
        }
      }
      constraint += '\n';
    }

    // 2. 审查建议（结构化列出）
    if (extraContext.reviews?.length) {
      constraint += '## 审查建议\n';
      for (const review of extraContext.reviews) {
        constraint += `\n### ${review.agent}\n`;

        // 硬约束（必须修正的问题）
        if (review.agent === 'hard-constraints' && review.constraints?.length) {
          constraint += '⚠️ 必须修正的问题:\n';
          for (const c of review.constraints) {
            constraint += `- ${c}\n`;
          }
          continue;
        }

        if (review.score != null) constraint += `评分: ${review.score}/10\n`;
        if (review.suggestions?.length) {
          constraint += '建议:\n' + review.suggestions.map(suggestion => `- ${formatConstraintItem(suggestion)}`).join('\n') + '\n';
        }
        if (review.issues?.length) {
          constraint += '问题:\n' + review.issues.map(issue => `- ${formatConstraintItem(issue)}`).join('\n') + '\n';
        }
      }
      constraint += '\n';
    }

    // 3. 角色档案（结构化注入，不是JSON）
    if (extraContext.characterInputs?.length) {
      constraint += '## 角色档案（必须在正文中体现）\n';
      for (const char of extraContext.characterInputs) {
        const name = char.npcName || '未知';
        constraint += `\n### ${name}\n`;
        if (char.action) constraint += `- 行为: ${char.action}\n`;
        if (char.dialogue) constraint += `- 对话: "${char.dialogue}"\n`;
        if (char.moodShift) constraint += `- 情绪变化: ${char.moodShift}\n`;
        if (char.towardsPlayer) constraint += `- 可观察态度变化: ${char.towardsPlayer}\n`;
      }
      constraint += '\n';
    }

    // 4. 润色建议（writer-polish 专用）
    if (extraContext.suggestions?.length) {
      constraint += '## 润色建议\n';
      for (const sug of extraContext.suggestions) {
        constraint += `- ${sug.from || ''}: ${formatConstraintItem(sug.text || sug)}\n`;
      }
      constraint += '\n保持原有结构和变量标签不变，只改进文字表达。\n\n';
    }

    // 5. 初稿（polish 模式下展示）
    if (extraContext.draft) {
      constraint += '## 初稿正文\n```\n' + extraContext.draft.slice(0, 6000) + '\n```\n\n';
    }

    // 6. 变量标签策略（根据二次模型配置）
    const updaterEnabled = stateManager.getAPIConfig?.()?.variableUpdater?.enabled === true;
    if (updaterEnabled) {
      constraint += generateMainVarInstructions(true) + '\n\n';
    } else {
      constraint += '【变量标签输出】正文末尾必须附上 <var>、<relationship>、<memory> 等标签。\n\n';
    }

    constraint += '【任务】基于以上约束，输出高质量叙事正文。';
    return constraint;
  }

  _buildPresetMessages(state, userInput) {
    try {
      const preset = getMainPreset();
      if (!preset?.entries?.length) return [];

      const context = {
        playerName: state['玩家·姓名'] || '玩家',
        charName: state['玩家·姓名'] || '',
        lastUserMessage: userInput || '',
        lastChatMessage: ''
      };

      const resolved = resolvePresetMacros(preset.entries, context);
      const presetMsgs = [];
      for (const entry of resolved) {
        if (entry.enabled === false) continue;
        if (!entry.content.trim() && !entry.isMarker) continue;
        presetMsgs.push({ role: entry.role, content: entry.content });
      }
      return presetMsgs;
    } catch {
      return [];
    }
  }

  _extractStateSlice(state, fields) {
    if (!fields?.length) return {};
    const slice = {};
    const deepClone = (v) => {
      if (typeof v === 'object' && v !== null) {
        try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
      }
      return v;
    };
    for (const field of fields) {
      if (field.startsWith('$prefix:')) {
        const prefix = field.slice(8);
        for (const key of Object.keys(state)) {
          if (key.startsWith(prefix)) slice[key] = state[key];
        }
        continue;
      }
      if (field in state) {
        slice[field] = deepClone(state[field]);
        continue;
      }
      const parts = field.split('.');
      let src = state;
      let dst = slice;
      for (let i = 0; i < parts.length; i++) {
        const k = parts[i];
        if (src == null || !(k in src)) break;
        if (i === parts.length - 1) {
          dst[k] = deepClone(src[k]);
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

    // 尝试直接解析
    try { return JSON.parse(text); } catch {}

    // 尝试提取 ```json 块
    const jsonBlock = text.match(/\x60\x60\x60json\s*([\s\S]*?)\s*\x60\x60\x60/);
    if (jsonBlock) { try { return JSON.parse(jsonBlock[1]); } catch {} }

    // 尝试提取任何 JSON 对象
    const braceMatch = text.match(/(\{[\s\S]*\})/);
    if (braceMatch) { try { return JSON.parse(braceMatch[1]); } catch {} }

    // Critic Agent 专用：修复常见 JSON 错误
    if (agentType.startsWith('critic-') || agentType === 'brainstormer' || agentType === 'outliner' || agentType === 'future-guardian') {
      try {
        let fixed = text;
        // 去掉尾随逗号
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        // 单引号改双引号
        fixed = fixed.replace(/'/g, '"');
        // 未加引号的键名加引号（简单模式：字母数字下划线开头）
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
        return JSON.parse(fixed);
      } catch (fixErr) {
        console.warn(`[AgentRunner] ${agentType} JSON修复失败:`, fixErr.message);
      }
    }

    // Writer 类型返回原文
    const writerTypes = ['writer', 'writer-polish'];
    if (writerTypes.includes(agentType)) return { _raw: text };

    // Critic/Outliner/Brainstormer 返回安全默认值
    console.warn(`[AgentRunner] ${agentType} 解析失败，返回安全默认值`);
    if (agentType.startsWith('critic-')) {
      return { issues: [], suggestions: [], approved: false, summary: 'JSON解析失败', score: 5 };
    }
    if (agentType === 'brainstormer') {
      return { candidates: [], recommended: null };
    }
    if (agentType === 'outliner') {
      return { beats: [], estimatedLength: 800, variableSummary: 'JSON解析失败' };
    }
    if (agentType === 'future-guardian') {
      return { scope: 'invalid', decision: 'invalid', candidate_ids: [], beat_ids: [] };
    }

    return { _raw: text };
  }
}

class AgentAbortError extends Error {
  constructor() { super('Agent pipeline aborted'); this.name = 'AgentAbortError'; }
}

export { AgentRunner, AgentAbortError };
