import { stateManager } from './state-manager.js';
import { AIClient, aiClient } from './ai-client.js';
import { instructionParser } from './instruction-parser.js';
import { eventBus } from './event-bus.js';
import { FEW_SHOT_EXAMPLES } from '../data/prompts.js';
import { getBriefPromptRef, generateMainVarInstructions } from '../data/var-schema.js';
import { getMainPreset, resolvePresetMacros } from '../data/default-preset.js';
import { formatGameTime } from '../utils/format.js';
import { GAME_DATA } from '../data/game-data.js';
import { AgentPipeline } from './agent-pipeline.js';
import { runVariableUpdater } from './variable-updater.js';

class MessagePipeline {
  constructor({ knowledgeBase, timelineSystem, uiRenderer, combatSystem, missionSystem, relationshipSystem, memorySystem, worldStateSystem }) {
    this.knowledgeBase = knowledgeBase;
    this.timelineSystem = timelineSystem;
    this.uiRenderer = uiRenderer;
    this.combatSystem = combatSystem;
    this.missionSystem = missionSystem;
    this.relationshipSystem = relationshipSystem;
    this.memorySystem = memorySystem;
    this.worldStateSystem = worldStateSystem;
    this.chatHistory = [];
    this.isProcessing = false;
    this._cancelled = false;
    this._onPresetEdited = () => { this._staticSystemPrompt = null; };
    eventBus.on('preset:edited', this._onPresetEdited);
  }

  cancel() {
    this._cancelled = true;
    aiClient.cancel();
    if (this._agentPipeline) {
      this._agentPipeline.abort();
      this._agentPipeline = null;
    }
  }

  async process(userInput) {
    if (this.isProcessing) return null;
    this.isProcessing = true;
    this._cancelled = false;
    this._lastUserInput = userInput;
    stateManager.resetLevelUpGuard();
    this.knowledgeBase?.invalidateCache?.();
    eventBus.emit('pipeline:processing', { userInput });

    try {
      const state = stateManager.get();

      if (state['玩家·存活'] === '否') {
        this.isProcessing = false;
        const cause = state['玩家·死因'] || '不明原因';
        eventBus.emit('player:died', { cause, alreadyDead: true });
        return null;
      }

      const dice = this._rollDice();
      const enrichedInput = this._preprocessInput(userInput, state) + this._formatDiceBlock(dice);

      const messages = this._buildPrompt(enrichedInput, state, userInput);

      let fullResponse = '';

      if (AgentPipeline.isEnabled() && state['玩家·姓名']) {
        this._agentPipeline = new AgentPipeline({
          pipeline: this,
          memorySystem: this.memorySystem
        });

        const onProgress = (stage, detail) => {
          eventBus.emit('agent:progress', { stage, detail });
        };

        const agentResult = await this._agentPipeline.execute(state, userInput, onProgress, messages);
        this._agentPipeline = null;

        if (agentResult) {
          fullResponse = agentResult;
          eventBus.emit('pipeline:chunk', { chunk: fullResponse, response: fullResponse });
        } else {
          const config = stateManager.getAPIConfig?.() || {};
          if (config.disableStreaming) {
            fullResponse = await aiClient.chat(messages, this._getGenerationOptions());
            eventBus.emit('pipeline:chunk', { chunk: fullResponse, response: fullResponse });
          } else {
            const onChunk = (chunk) => {
              fullResponse += chunk;
              eventBus.emit('pipeline:chunk', { chunk, response: fullResponse });
            };
            fullResponse = await aiClient.chatStream(messages, this._getGenerationOptions(), onChunk);
          }
        }
      } else {
        const config = stateManager.getAPIConfig?.() || {};
        if (config.disableStreaming) {
          fullResponse = await aiClient.chat(messages, this._getGenerationOptions());
          eventBus.emit('pipeline:chunk', { chunk: fullResponse, response: fullResponse });
        } else {
          const onChunk = (chunk) => {
            fullResponse += chunk;
            eventBus.emit('pipeline:chunk', { chunk, response: fullResponse });
          };
          fullResponse = await aiClient.chatStream(messages, this._getGenerationOptions(), onChunk);
        }
      }

      if (!fullResponse) {
        this.isProcessing = false;
        throw new Error('AI 未返回有效回复');
      }

      if (this._cancelled) {
        this.isProcessing = false;
        eventBus.emit('pipeline:cancelled', { partialResponse: fullResponse });
        return { cancelled: true, partialResponse: fullResponse };
      }

      const displayResponse = fullResponse.replace(/极其|共犯/g, '');

      const instructions = instructionParser.parse(fullResponse);
      this._applyInstructions(instructions);

      const memories = this._instructionList(instructions.memories, instructions.memory);
      if (memories.length) {
        this._applyMemoryUpdate(this._mergeMemoryUpdates(memories), userInput, displayResponse);
      } else {
        this._rememberRecentTurn(userInput, displayResponse);
      }

      const hasHUD = instructionParser.hasStatusQuery(displayResponse);
      const cleanResponse = instructionParser.cleanupResponse(displayResponse);
      let thinkContent = instructionParser.extractThinkContent(displayResponse);
      const varThinkContent = instructionParser.extractVarThinkContent(displayResponse);
      if (varThinkContent) {
        thinkContent = (thinkContent ? thinkContent + '\n\n' : '') + '### 变量自检\n' + varThinkContent;
      }

      this.chatHistory.push({ role: 'user', content: `[玩家操作]\n${userInput}` });
      this.chatHistory.push({ role: 'assistant', content: displayResponse });
      this._trimHistory();

      // B-13: 等待 secondary updater 完成后再创建 timeline 节点
      let secondarySuccess = false;
      let shouldRunSecondary = stateManager.getAPIConfig()?.variableUpdater?.enabled === true;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (shouldRunSecondary && !secondarySuccess) {
        const configuredTimeout = stateManager.getAPIConfig()?.variableUpdater?.timeoutMs;
        const secondaryTimeoutMs = configuredTimeout === 0 ? 999999999 : (configuredTimeout || 120000);
        
        const secondaryPromise = this._runSecondaryVariableUpdate({
          userInput,
          enrichedInput,
          state,
          narrativeResponse: fullResponse
        });
        
        const secondaryWithTimeout = configuredTimeout === 0
          ? secondaryPromise
          : Promise.race([
              secondaryPromise,
              new Promise((resolve) => setTimeout(() => resolve('__SECONDARY_TIMEOUT__'), secondaryTimeoutMs))
            ]);
            
        try {
          const additionalResponse = await secondaryWithTimeout;
          if (additionalResponse === '__SECONDARY_TIMEOUT__') {
            console.warn('[Pipeline] Secondary variable updater timed out after', secondaryTimeoutMs, 'ms');
            retryCount++;
            if (retryCount >= maxRetries) {
              console.warn('[Pipeline] Secondary updater max retries reached, skipping');
              secondarySuccess = true;
              continue;
            }
            const Modal = customElements.get('game-modal');
            if (Modal) {
              const retry = await Modal.confirm({
                title: '⚠️ 变量演算超时',
                message: '后台数据演算超时。强行跳过可能会导致部分状态（好感、属性、物品等）遗漏。\\n是否重新尝试演算？',
                okLabel: '重试演算',
                cancelLabel: '跳过并继续'
              });
              if (!retry) secondarySuccess = true;
            } else {
              secondarySuccess = true;
            }
          } else if (additionalResponse) {
            const extra = instructionParser.parse(additionalResponse);
            this._applyInstructions(extra, true);
            eventBus.emit('pipeline:vars-updated');
            secondarySuccess = true;
          } else {
            secondarySuccess = true; // Disabled or missing config
          }
        } catch (err) {
          console.warn('[Pipeline] Background variable updater failed:', err?.message);
          retryCount++;
          if (retryCount >= maxRetries) {
            console.warn('[Pipeline] Secondary updater max retries reached, skipping');
            secondarySuccess = true;
            continue;
          }
          const Modal = customElements.get('game-modal');
          if (Modal) {
            const retry = await Modal.confirm({
              title: '⚠️ 变量演算异常',
              message: `后台数据演算发生错误：${err.message}\\n强行跳过可能会导致本回合状态更新丢失。\\n是否重新尝试演算？`,
              okLabel: '重试演算',
              cancelLabel: '跳过并继续'
            });
            if (!retry) secondarySuccess = true;
          } else {
            secondarySuccess = true;
          }
        }
      }

      const currentTurn = stateManager.get('系统·回合数') || 1;
      stateManager.update([
        { key: '系统·回合数', op: '+', value: 1 }
      ]);
      if (this.timelineSystem) {
        try {
          await this.timelineSystem.createNode({
            turnNumber: currentTurn,
            playerInput: userInput,
            aiResponse: displayResponse,
            cleanResponse,
            stateSnapshot: stateManager.snapshot(),
            chatHistory: this.chatHistory
          });
        } catch (timelineErr) {
          console.error('[Pipeline] Timeline node creation failed:', timelineErr.message);
          this._lastTimelineError = timelineErr.message;
        }
      }

      // 记忆压缩: 二次模型 > 主模型 > 截断降级
      if (this.memorySystem) {
        const mainCfg = stateManager.getAPIConfig() || {};
        const updaterCfg = mainCfg.variableUpdater;
        const compressCfg = (updaterCfg?.enabled && updaterCfg.apiKey && updaterCfg.model)
          ? {
              backend: (updaterCfg.backend && updaterCfg.backend !== 'inherit') ? updaterCfg.backend : mainCfg.backend,
              apiUrl: updaterCfg.apiUrl || mainCfg.apiUrl,
              apiKey: updaterCfg.apiKey || mainCfg.apiKey,
              model: updaterCfg.model || mainCfg.model
            }
          : mainCfg;
        if (compressCfg.apiKey && compressCfg.model) {
          const compressClient = new AIClient();
          compressClient.configure(compressCfg);
          this.memorySystem.aiCompress(compressClient).catch(() => {});
        }
      }

      eventBus.emit('pipeline:complete', {
        rawResponse: displayResponse,
        cleanResponse,
        thinkContent,
        hasHUD,
        instructions,
        turnCount: currentTurn,
        timelineError: this._lastTimelineError || null
      });

      this.isProcessing = false;
      return { cleanResponse, rawResponse: displayResponse, hasHUD, instructions };

    } catch (error) {
      this.isProcessing = false;

      const partial = error?.partialResponse || null;
      const isTruncated = Boolean(partial);
      const errorMessage = isTruncated
        ? `生成被截断（已收到 ${partial.length} 字），请检查网络后重试。`
        : (error.message || 'AI 生成失败');

      console.warn('[Pipeline] Error:', error.message, { partialLength: partial?.length, isTruncated });

      const hasPartialContent = partial && partial.trim().length > 50;
      if (hasPartialContent) {
        this._lastStreamedContent = partial;
        this._displayPartialResponse(partial);
      }

      eventBus.emit('pipeline:error', {
        error: errorMessage,
        isTruncated,
        partialResponse: partial,
        lastUserInput: this._lastUserInput
      });

      if (hasPartialContent && isTruncated) return { partialResponse: partial };
      throw new Error(errorMessage);
    }
  }

  _displayPartialResponse(partial) {
    const cleanResponse = instructionParser.cleanupResponse(partial.replace(/极其|共犯/g, ''));
    let thinkContent = instructionParser.extractThinkContent(partial);
    const varThinkContent = instructionParser.extractVarThinkContent(partial);
    if (varThinkContent) {
      thinkContent = (thinkContent ? thinkContent + '\n\n' : '') + '### 变量自检\n' + varThinkContent;
    }
    eventBus.emit('pipeline:complete', {
      rawResponse: partial.replace(/极其|共犯/g, ''),
      cleanResponse,
      thinkContent,
      hasHUD: instructionParser.hasStatusQuery(partial),
      instructions: instructionParser.parse(partial),
      turnCount: stateManager.get('系统·回合数') || 1,
      isPartial: true
    });
  }

  async _runSecondaryVariableUpdate({ userInput, enrichedInput, state, narrativeResponse }) {
    return runVariableUpdater({
      mainConfig: stateManager.getAPIConfig() || {},
      userInput,
      enrichedInput,
      state,
      narrativeResponse,
      compactState: this._compactStateForVariableUpdater(state)
    });
  }

  _compactStateForVariableUpdater(state) {
    const skills = this._scanFlatSkills(state);
    const items = this._scanFlatItems(state);
    return {
      '玩家·姓名': state['玩家·姓名'] || '',
      '玩家·忍阶': state['玩家·忍阶'] || '',
      '玩家·查克拉属性': state['玩家·查克拉属性'] || '',
      '玩家·性别': state['玩家·性别'] || '',
      '玩家·出身': state['玩家·出身'] || '',
      '玩家·年龄': state['玩家·年龄'] ?? 0,
      '玩家·战力等级': state['玩家·战力等级'] || '',
      '玩家·个性': state['玩家·个性'] || '',
      '玩家·当前目标': state['玩家·当前目标'] || '',
      '玩家·公开身份': state['玩家·公开身份'] || '',
      '玩家·声望标签': state['玩家·声望标签'] || '',
      '玩家·标志': state['玩家·标志'] || '',
      '玩家·难度': state['玩家·难度'] || '',
      '玩家·存活': state['玩家·存活'] || '是',
      '玩家·死因': state['玩家·死因'] || '',
      '属性·查克拉': state['属性·查克拉'] ?? 0,
      '属性·当前查克拉': state['属性·当前查克拉'] ?? 0,
      '属性·体力': state['属性·体力'] ?? 0,
      '属性·当前体力': state['属性·当前体力'] ?? 0,
      '属性·精神力': state['属性·精神力'] ?? 0,
      '属性·意志力': state['属性·意志力'] ?? 0,
      '属性·速度': state['属性·速度'] ?? 0,
      '属性·幸运': state['属性·幸运'] ?? 0,
      '进度·经验': state['进度·经验'] ?? 0,
      '进度·金钱': state['进度·金钱'] ?? 0,
      '进度·突破待处理': state['进度·突破待处理'] ?? 0,
      '世界·地点': state['世界·地点'] || '',
      '世界·时间': state['世界·时间'] || '',
      '世界·月份': state['世界·月份'] || '',
      '世界·天气': state['世界·天气'] || '',
      '世界·年代': state['世界·年代'] || '',
      技能: skills, 物品: items,
      _combat: state._combat, _missions: state._missions,
      _relationships: state._relationships, _memory: state._memory,
      _map: state._map
    };
  }

  _applyInstructions(instructions, silent = false) {
    if (instructions.variables.length > 0) {
      const flatVars = [];
      const pathVars = [];
      const seenHashes = new Set();
      for (const v of instructions.variables) {
        if (!v) continue;
        // Flat key format from <var> tags: {key, op: '='|'+'|'-', value}
        if (v.key && ['=', '+', '-'].includes(v.op)) {
          if (v.key === '系统·回合数') continue;
          const hash = 'k:' + v.key + '|' + v.op + '|' + JSON.stringify(v.value);
          if (!seenHashes.has(hash)) { seenHashes.add(hash); flatVars.push(v); }
          continue;
        }
        // Path-based format from <variable> tags: {path, op: 'set'|'add'|..., value}
        if (typeof v.path === 'string' && v.path.trim() && ['set','add','sub','assign','push','remove'].includes(v.op)) {
          if (v.path === '系统·回合数') continue;
          const hash = 'p:' + v.path + '|' + v.op + '|' + JSON.stringify(v.value);
          if (!seenHashes.has(hash)) { seenHashes.add(hash); pathVars.push(v); }
          continue;
        }
      }
      if (flatVars.length) stateManager.update(flatVars);
      if (pathVars.length) stateManager.batchUpdate(pathVars);
      const totalApplied = flatVars.length + pathVars.length;
      if (!silent && totalApplied < instructions.variables.length) {
        console.warn('[Pipeline] ' + (instructions.variables.length - totalApplied) + ' variables invalid');
      }
    }

    const combats = this._instructionList(instructions.combats, instructions.combat);
    for (const combat of combats) this.combatSystem?.processInstruction(combat);

    const missions = this._instructionList(instructions.missions, instructions.mission);
    for (const mission of missions) this.missionSystem?.processInstruction(mission);

    const relationships = this._instructionList(instructions.relationships, instructions.relationship);
    for (const rel of relationships) this.relationshipSystem?.processInstruction(rel);

    const events = this._instructionList(instructions.events, instructions.event);
    for (const event of events) this.worldStateSystem?.triggerEvent(event);

    return instructions;
  }

  _instructionList(list, fallback) {
    if (Array.isArray(list) && list.length) return list;
    return fallback ? [fallback] : [];
  }

  _mergeMemoryUpdates(memories) {
    if (!Array.isArray(memories) || memories.length <= 1) return memories?.[0] || {};
    const merged = {};
    for (const memory of memories) {
      if (!memory || typeof memory !== 'object') continue;
      for (const [key, value] of Object.entries(memory)) {
        if (Array.isArray(value)) {
          merged[key] = [...(Array.isArray(merged[key]) ? merged[key] : []), ...value];
        } else if (value && typeof value === 'object') {
          merged[key] = { ...(merged[key] || {}), ...value };
        } else if (value !== undefined && value !== null && value !== '') {
          merged[key] = merged[key] && key === 'summary' ? `${merged[key]}\n${value}` : value;
        }
      }
    }
    return merged;
  }

  _preprocessInput(userInput, state) {
    const summaries = [];
    const name = state['玩家·姓名'];
    if (name) {
      summaries.push(`角色: ${name} | ${state['玩家·忍阶']} | ${state['玩家·查克拉属性'] || '未选择'}`);
      summaries.push(`查克拉${state['属性·当前查克拉']}/${state['属性·查克拉']} | 体力${state['属性·当前体力']}/${state['属性·体力']}`);
      summaries.push(`历练值: ${state['进度·经验'] || 0}/${state['进度·下一级经验'] || 100} | 精神力${state['属性·精神力'] || 0} | 意志力${state['属性·意志力'] || 0} | 速度${state['属性·速度'] || 0}`);
      summaries.push(`位置: ${state['世界·地点'] || '木叶隐村'} | ${formatGameTime(state['世界·时间'])}`);
    }
    const missions = state._missions;
    if (missions?.active && Object.keys(missions.active).length > 0) {
      summaries.push(`任务: ${Object.values(missions.active).map(m => m.title).join(', ')}`);
    }
    if (state._combat?.is_active) {
      summaries.push(`战斗中: ${state._combat.enemy_name}`);
    }
    return summaries.join('\n');
  }

  _rollDice() {
    const values = Array.from({ length: 6 }, () => Math.floor(Math.random() * 100) + 1);
    this._lastDice = values;
    eventBus.emit('pipeline:dice', { values });
    return values;
  }

  _formatDiceBlock(dice) {
    const names = ['壹', '贰', '叁', '肆', '伍', '陆'];
    return `\n\n〈卦象·本回合命运〉\n${dice.map((v, i) => `${names[i]}:[${v}]`).join('\n')}\n——取用需严格按序，已取之卦不可复用——`;
  }

  _buildPrompt(enrichedInput, state, userInput) {
    const messages = [];

    if (!this._staticSystemPrompt) {
      this._staticSystemPrompt = this._formatFewShot();
      console.log('[Cache] Static prompt built:', this._staticSystemPrompt.length, 'chars');
    }

    messages.push({ role: 'system', content: this._staticSystemPrompt });

    const updaterEnabled = stateManager.getAPIConfig()?.variableUpdater?.enabled === true;
    messages.push({
      role: 'system',
      content: generateMainVarInstructions(updaterEnabled)
    });

    const { top, bottom, prefill } = this._buildMainPresetMessages(state, userInput, updaterEnabled);
    if (top.length > 0) {
      messages.push(...top);
    }

    messages.push(...this.chatHistory);

    const ctxParts = [enrichedInput];

    if (this.knowledgeBase) {
      const kbContent = this.knowledgeBase.buildContext?.({
        query: userInput, state, memory: state._memory,

        maxEntries: 9, budget: 6200
      }) || this.knowledgeBase.matchAndGetContent(userInput, 4);
      if (kbContent) ctxParts.push(kbContent);
    }

    ctxParts.push(this._buildDynamicContext(state));

    const memCtx = this._buildMemoryContext(state._memory);
    if (memCtx) ctxParts.push(memCtx);

    const finalUserContent = `${ctxParts.join('\n\n')}\n\n[玩家操作]\n${userInput}`;
    this._lastFullUserContent = finalUserContent;
    messages.push({ role: 'user', content: finalUserContent });

    if (Number(state['进度·突破待处理']) > 0) {
      const btContent = updaterEnabled
        ? '【系统强制指令：历练突破】玩家历练值已满！请在本回合正文中触发实力突破剧情。提升需有侧重点，幅度克制。（数值由后台自动处理）'
        : '【系统强制指令：历练突破】玩家历练值已满！请在正文触发突破剧情，在 <var> 标签中增加对应属性上限键和技能熟练度，并将 进度·突破待处理 -1。';
      messages.push({ role: 'system', content: btContent });
    }

    // Bottom preset entries go AFTER user input (like SillyTavern depth=0)
    if (bottom.length > 0) {
      messages.push(...bottom);
    }

    // Assistant prefill goes last — forces AI to continue from this format
    if (prefill) {
      messages.push(prefill);
    }

    return messages;
  }

  _buildMainPresetMessages(state, userInput, updaterEnabled = false) {
    try {
      const preset = getMainPreset();
      if (!preset || !Array.isArray(preset.entries) || preset.entries.length === 0) {
        return { top: [], bottom: [], prefill: null };
      }

      const context = {
        playerName: state['玩家·姓名'] || '玩家',
        charName: state['玩家·姓名'] || '',
        lastUserMessage: '刚才的行动',
        lastChatMessage: '刚才的剧情'
      };

      // Find the split marker: "⬆️回映层⬆️" — everything after it goes to bottom/prefill
      let splitIndex = -1;
      for (let i = 0; i < preset.entries.length; i++) {
        const e = preset.entries[i];
        if (e.isMarker && e.name && e.name.includes('回映层') && e.name.includes('⬆️')) {
          splitIndex = i;
        }
      }

      const bottomIds = new Set();
      if (splitIndex >= 0) {
        for (let i = splitIndex + 1; i < preset.entries.length; i++) {
          bottomIds.add(preset.entries[i].id);
        }
      }

      const allResolved = resolvePresetMacros(preset.entries, context);

      const enableCoT = stateManager.getAPIConfig()?.enableVariableCoT !== false;

      const top = [];
      const bottomRaw = [];

      for (const entry of allResolved) {
        const role = entry.role === 'assistant' ? 'assistant' : (entry.role === 'user' ? 'user' : 'system');
        let content = entry.content;

        // When secondary variable updater is enabled, strip ALL variable-related instructions
        // from preset entries so the main model focuses purely on narrative
        if (updaterEnabled) {
          // Remove <var_thinking> blocks
          content = content.replace(/<var_thinking>[\s\S]*?<\/var_thinking>\s*/g, '');
          // Remove <var> blocks
          content = content.replace(/<var>[\s\S]*?<\/var>/g, '');
          // Remove <status_query /> tags
          content = content.replace(/<status_query\s*\/>/g, '');
          // Remove the output format template that tells AI to output var/status_query
          content = content.replace(/<var>\s*\$\{[^}]*\}\s*<\/var>/g, '');
          content = content.replace(/<var>\s*Handmade[\s\S]*?<\/var>/g, '');
          // Remove 账册核签 section (关四 — this is the variable audit)
          content = content.replace(/【关四：账册核签[\s\S]*?审议结论：\[通过\] \/ \[补充：___\]/g, '');
          // Remove variable-related lines from 议事大纲
          content = content.replace(/• 历练exp[\s\S]*?必须包含[\s\S]*?战斗数值/g, '');
          // Remove <memory> blocks — secondary updater handles memory
          content = content.replace(/<memory>[\s\S]*?<\/memory>/g, '');
        }

        if (!enableCoT) {
           content = content.replace(/<var_thinking>[\s\S]*?<\/var_thinking>\s*/g, '');
        }

        const msg = { role, content };

        if (bottomIds.has(entry.id)) {
          bottomRaw.push(msg);
        } else {
          top.push(msg);
        }
      }

      // When updater is enabled, also strip variable tags from the prefill (assistant prefill)
      // and from bottom entries to prevent the AI from echoing the format
      if (updaterEnabled) {
        for (const msg of bottomRaw) {
          msg.content = msg.content
            .replace(/<var>[\s\S]*?<\/var>/g, '')
            .replace(/<status_query\s*\/>/g, '')
            .replace(/<variable_thinking>[\s\S]*?<\/variable_thinking>/g, '')
            .replace(/<memory>[\s\S]*?<\/memory>/g, '');
        }
      }

      // Extract the last assistant message from bottom as prefill
      let prefill = null;
      for (let i = bottomRaw.length - 1; i >= 0; i--) {
        if (bottomRaw[i].role === 'assistant') {
          prefill = bottomRaw.splice(i, 1)[0];
          break;
        }
      }

      // Strip variable tags from prefill too
      if (prefill && updaterEnabled) {
        prefill.content = prefill.content
          .replace(/<var>[\s\S]*?<\/var>/g, '')
          .replace(/<status_query\s*\/>/g, '')
          .replace(/<variable_thinking>[\s\S]*?<\/variable_thinking>/g, '')
          .replace(/<memory>[\s\S]*?<\/memory>/g, '');
      }

      console.log(`[Preset] Split: ${top.length} top, ${bottomRaw.length} bottom, prefill=${!!prefill}, updater=${updaterEnabled}`);
      return { top, bottom: bottomRaw, prefill };
    } catch (e) {
      console.warn('[Pipeline] Main preset loading failed:', e.message);
      return { top: [], bottom: [], prefill: null };
    }
  }

  _getGenerationOptions() {
    const config = stateManager.getAPIConfig?.() || {};
    return {
      temperature: config.temperature ?? 0.9,
      max_tokens: config.max_tokens ?? 8192,
      top_p: config.top_p ?? 0.9,
      top_k: config.top_k ?? 200,
      frequency_penalty: config.frequency_penalty ?? 0.2,
      presence_penalty: config.presence_penalty ?? 0
    };
  }

  _buildDynamicContext(state) {
    const name = state['玩家·姓名'];
    if (!name) {
      return `\n[游戏阶段: 角色尚未创建。请引导玩家完成角色创建，使用<var>标签记录创建完成状态。]\n`;
    }
    const timelineContext = this._buildTimelineContext(state);
    const skills = this._scanFlatSkills(state);
    const items = this._scanFlatItems(state);
    const missions = state._missions || {};
    const activeMissions = missions.active ? Object.values(missions.active) : [];
    const combat = state._combat;
    const rels = state._relationships || {};
    const eventsStr = state['世界·活跃事件'] || '';
    const events = eventsStr ? eventsStr.split('\n').filter(Boolean) : [];
    const isCombat = !!combat?.is_active;

    const parts = [];

    // ── Tier 1: 始终注入 ──
    parts.push(`[动态游戏状态]
## 时代约束
${timelineContext}
- 核心规则: 不要默认玩家处于疾风传开始时间。必须按当前时间线判断人物年龄、组织公开程度、事件是否已发生、忍术/科技/称号是否可用。
- 年代事实: "已灭亡、已死亡、已叛逃、已加入组织、事件已发生"等结论必须按当前年份判断，禁止把疾风传/未来结果倒灌到早期时间线。

## 玩家角色
- 姓名: ${name}
- 性别: ${state['玩家·性别'] === '男性' ? '男' : state['玩家·性别'] === '女性' ? '女' : state['玩家·性别'] || '未设定'}
- 忍阶: ${state['玩家·忍阶']}
- 公开身份: ${state['玩家·公开身份'] || state['玩家·忍阶']}
- 出身: ${state['玩家·出身']}
- 查克拉属性: ${state['玩家·查克拉属性'] || '未选择'}
- 当前目标: ${state['玩家·当前目标'] || '未设定'}
- 声望标签: ${state['玩家·声望标签'] || '无'}`);

    // ── Tier 2: 属性 + 精简技能/装备 ──
    parts.push(`## 当前属性
- 查克拉: ${state['属性·当前查克拉']}/${state['属性·查克拉']}
- 精神力: ${state['属性·当前精神力']}/${state['属性·精神力']}
- 意志: ${state['属性·当前意志力']}/${state['属性·意志力']}
- 体力: ${state['属性·当前体力']}/${state['属性·体力']}
- 速度: ${state['属性·速度']}
- 幸运: ${state['属性·幸运']}

## 技能摘要
${isCombat ? this._summarizeSkills(skills) : this._summarizeSkillsCompact(skills, 5)}

## 装备
${isCombat ? this._summarizeEquipmentFull(items) : this._summarizeEquipmentCompact(items)}`);

    // ── Tier 3: 仅战斗时注入 ──
    if (isCombat) {
      parts.push(`## 派生战力参考
${this._summarizeDerivedStats(state)}`);
    }

    parts.push(`## 任务进度
${this._summarizeMissionsCompact(activeMissions)}

## 人际关系
${isCombat ? this._summarizeRelationships(rels) : this._summarizeRelationshipsCompact(rels)}

## 世界状态
- 时间: ${formatGameTime(state['世界·时间'])}
- 位置: ${state['世界·地点'] || '木叶隐村'}
- 天气: ${state['世界·天气'] || '晴'}
- 进行中的世界事件: ${this._summarizeEventsStr(events)}
- 已探索区域: ${state['世界·已探索区域'] || '无'}
- 已知地标: ${Object.keys(state._map?.known_locations || {}).join('、') || '无'}

## 战斗状态
${isCombat ? `【战斗中】对手: ${combat.enemy_name} | 查克拉: ${combat.enemy_chakra}/${combat.enemy_chakra_max}` : '无战斗'}`);

    return parts.join('\n');
  }

  _buildTimelineContext(state) {
    const timeline = state['世界·年代'] || '木叶48年';
    const calendar = state['世界·时间'] || '';
    const label = formatGameTime(calendar);
    const year = this._currentKonohaYear(state);
    const eraNote = Number.isFinite(year)
      ? this._eraNoteForYear(year)
      : '年份无法解析时，先询问或按动态状态中最明确的时代信息处理；不要假定疾风传。';
    return [
      `- 当前时代: ${timeline}`,
      `- 当前日历: ${label}`,
      `- 当前木叶纪年判定: ${Number.isFinite(year) ? `木叶${year}年` : '未明确'}`,
      `- 年代合理性摘要: ${eraNote}`,
      `- 时间线优先级: 动态状态/存档 > 玩家本回合明确指定 > 世界书条目 > 默认木叶48年。`
    ].join('\n');
  }

  _currentKonohaYear(state) {
    const values = [
      state['世界·时间'],
      state['世界·年代'],
      state._memory?.recent_summary,
      state._memory?.compressed_summary
    ];
    for (const value of values) {
      const year = this._extractKonohaYear(value);
      if (Number.isFinite(year)) return year;
    }
    return 48;
  }

  _extractKonohaYear(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value || '').match(/木叶\s*(\d+)\s*年/);
    return match ? Number(match[1]) : null;
  }

  _eraNoteForYear(year) {
    if (year < 0) return '远古/忍宗相关时代，现代忍村、五影、晓和原作角色通常不存在。';
    if (year < 20) return '忍村制度早期或第一次忍界大战前后，许多后世组织与角色尚未出现。';
    if (year < 35) return '第二次忍界大战前后，三忍、雨之国创伤和早期晓理念可作为时代重点。';
    if (year < 48) return '第三次忍界大战及战后余波阶段，九尾之乱和鸣人出生可能尚未发生或刚发生。';
    if (year < 55) return '木叶战后重建期，鸣人/佐助幼年，卡卡西暗部期，宇智波灭族尚未发生。';
    if (year < 60) return '原作第一部前后，宇智波灭族可能已发生；晓仍未全面公开捕捉尾兽。';
    if (year < 63) return '疾风传前后，晓公开行动、尾兽捕捉、佩恩袭击和五影会谈需按具体日期判断。';
    return '战后/新时代阶段，需区分六代、七代火影与博人时代科技化进程。';
  }

  _summarizeEquipment(items) {
    if (!items || Object.keys(items).length === 0) return '无';
    return Object.entries(items).map(([name, info]) => {
      if (typeof info === 'object') return `${name}×${info.quantity || 1}(${info.quality || '普通'})`;
      return name;
    }).join(' | ');
  }

  _summarizeEquipmentFull(items) {
    return [
      `- 武器: ${this._summarizeEquipment(items.weapons)}`,
      `- 忍具: ${this._summarizeEquipment(items.tools)}`,
      `- 消耗品: ${this._summarizeEquipment(items.consumables)}`,
      `- 金钱: ${items.ryo || 0}两`
    ].join('\n');
  }

  _summarizeEquipmentCompact(items) {
    const equipped = Object.entries(items.equipped || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    return [
      equipped.length ? `已装备: ${equipped.join(' | ')}` : '已装备: 无',
      `- 金钱: ${items.ryo || 0}两`
    ].join('\n');
  }

  _summarizeMissions(activeMissions) {
    if (!activeMissions || activeMissions.length === 0) return '无进行中的任务';
    return activeMissions.map(m => `[${m.rank || 'D'}] ${m.title}`).join('\n');
  }

  _summarizeMissionsCompact(activeMissions) {
    if (!activeMissions || activeMissions.length === 0) return '无进行中的任务';
    return activeMissions.slice(0, 4).map(m => `[${m.rank || 'D'}] ${m.title}${m.status ? ' ' + m.status : ''}`).join(' | ');
  }

  _summarizePromotion(state) {
    return [
      `- 经验: ${state['进度·经验'] || 0}/${state['进度·下一级经验'] || 100}`,
      `- 已完成任务: ${state['进度·已完成任务'] || 0}`,
      `- 突破待处理: ${state['进度·突破待处理'] || 0}`
    ].join('\n');
  }

  _summarizeDerivedStats(state) {
    const skills = this._scanFlatSkills(state);
    const best = (group) => Math.max(0, ...Object.values(group || {}).map(item => Number(item?.mastery) || 0));
    const jutsu = best(skills.jutsu);
    const taijutsu = best(skills.taijutsu);
    const genjutsu = best(skills.genjutsu);
    const derived = {
      ninjutsu: Math.round((state['属性·查克拉'] || 0) * 0.45 + (state['属性·精神力'] || 0) * 0.25 + jutsu * 0.7),
      taijutsu: Math.round((state['属性·体力'] || 0) * 0.25 + (state['属性·速度'] || 0) * 0.9 + (state['属性·意志力'] || 0) * 0.2 + taijutsu * 0.9),
      genjutsu: Math.round((state['属性·精神力'] || 0) * 0.75 + (state['属性·查克拉'] || 0) * 0.2 + genjutsu * 0.9),
      defense: Math.round((state['属性·体力'] || 0) * 0.18 + (state['属性·意志力'] || 0) * 0.25),
      initiative: Math.round((state['属性·速度'] || 0) * 0.8 + (state['属性·精神力'] || 0) * 0.15 + (state['属性·幸运'] || 0) * 0.5)
    };
    const rank = state['玩家·忍阶'] || '下忍';
    const benchmark = GAME_DATA.getRankBenchmark(rank);
    return [
      `- 忍术战力: ${derived.ninjutsu}`,
      `- 体术战力: ${derived.taijutsu}`,
      `- 幻术战力: ${derived.genjutsu}`,
      `- 防御韧性: ${derived.defense}`,
      `- 先手/反应: ${derived.initiative}`,
      `- 当前忍阶参考区间: 查克拉${benchmark.chakra[0]}-${benchmark.chakra[1]} | 体力${benchmark.stamina[0]}-${benchmark.stamina[1]} | 速度${benchmark.speed[0]}-${benchmark.speed[1]}`
    ].join('\n');
  }

  _summarizeSkills(skills = {}) {
    const sections = [
      ['忍术', skills.jutsu],
      ['体术', skills.taijutsu],
      ['幻术', skills.genjutsu],
      ['辅助', skills.support],
      ['天赋', skills.talents]
    ];
    const lines = [];
    if (skills.kekkei_genkai) lines.push(`- 血继限界: ${skills.kekkei_genkai}`);
    for (const [label, group] of sections) {
      const items = this._topSkillEntries(group);
      lines.push(`- ${label}: ${items.length ? items.join(' | ') : '无'}`);
    }
    return lines.join('\n');
  }

  _topSkillEntries(group) {
    if (!group || typeof group !== 'object') return [];
    return Object.entries(group)
      .map(([name, data]) => `${name}${data.mastery != null ? '(' + data.mastery + ')' : ''}`)
      .slice(0, 8);
  }

  _summarizeSkillsCompact(skills = {}, topN = 5) {
    const allEntries = [];
    const categories = [
      ['忍', skills.jutsu], ['体', skills.taijutsu],
      ['幻', skills.genjutsu], ['辅', skills.support],
      ['天赋', skills.talents]
    ];
    for (const [label, group] of categories) {
      if (!group || typeof group !== 'object') continue;
      for (const [name, data] of Object.entries(group)) {
        allEntries.push({ label, name, mastery: Number(data?.mastery) || 0 });
      }
    }
    allEntries.sort((a, b) => b.mastery - a.mastery);
    const top = allEntries.slice(0, topN);
    let lines = top.map(e => `${e.name}(${e.label}${e.mastery})`).join(' | ');
    if (skills.kekkei_genkai) lines = `血继: ${skills.kekkei_genkai} | ` + lines;
    return lines || '无';
  }

  _trackLabel(track) {
    const labels = {
      balanced: '均衡型',
      ninjutsu: '忍术型',
      taijutsu: '体术型',
      genjutsu: '幻术型',
      medical: '医疗/辅助型',
      sensory: '感知/情报型',
      command: '指挥型',
      infiltration: '潜入/暗杀型'
    };
    return labels[track] || track;
  }

  _summarizeRelationships(relationships) {
    if (!relationships || Object.keys(relationships).length === 0) return '暂无特别关系';
    return Object.entries(relationships)
      .sort((a, b) => (b[1]?.affection || 0) - (a[1]?.affection || 0))
      .map(([name, rel]) => {
        const a = rel.affection || 0, t = rel.trust || 0, r = rel.respect || 0;
        return `${name}: ${a > 30 ? '友好' : a < -30 ? '敌意' : '中立'}(${a}) 信${t} 敬${r}${rel.role ? ' ' + rel.role : ''}`;
      })
      .join(' | ');
  }

  _summarizeRelationshipsCompact(relationships) {
    if (!relationships || Object.keys(relationships).length === 0) return '暂无特别关系';
    return Object.entries(relationships)
      .filter(([, rel]) => Math.abs(rel?.affection || 0) >= 30 || (rel?.role && rel.role !== '路人'))
      .sort((a, b) => Math.abs(b[1]?.affection || 0) - Math.abs(a[1]?.affection || 0))
      .slice(0, 6)
      .map(([name, rel]) => {
        const a = rel.affection || 0;
        return `${name}: ${a > 30 ? '友好' : a < -30 ? '敌意' : '中立'}(${a})`;
      })
      .join(' | ') || '暂无特别关系';
  }

  _summarizeEventsStr(events) {
    if (!Array.isArray(events) || !events.length) return '无';
    return events.filter(Boolean).join('；') || '无';
  }

  _scanFlatSkills(state) {
    const result = { jutsu: {}, taijutsu: {}, genjutsu: {}, support: {}, talents: {}, kekkei_genkai: {} };
    for (const key of Object.keys(state)) {
      const m = key.match(/^技能·(忍术|体术|幻术|支援|天赋|血继限界)·(.+)·(名称|等级|属性|消耗|威力|熟练度|描述)$/);
      if (m) {
        const [, cat, name, field] = m;
        const catKey = cat === '忍术' ? 'jutsu' : cat === '体术' ? 'taijutsu' : cat === '幻术' ? 'genjutsu' : cat === '支援' ? 'support' : cat === '血继限界' ? 'kekkei_genkai' : 'talents';
        if (!result[catKey][name]) result[catKey][name] = { name };
        result[catKey][name][field] = state[key];
      }
    }
    if (state['技能·血继限界'] && Object.keys(result.kekkei_genkai).length === 0) {
      result.kekkei_genkai = state['技能·血继限界'];
    }
    return result;
  }

  _scanFlatItems(state) {
    const result = { weapons: {}, armor: {}, tools: {}, consumables: {}, ryo: state['进度·金钱'] || 0, equipped: {} };
    const catMap = { '道具': 'tools', '消耗品': 'consumables', '武器': 'weapons', '防具': 'armor' };
    for (const key of Object.keys(state)) {
      const m = key.match(/^物品·(道具|消耗品|武器|防具)·(.+)·(数量|品质|描述|说明)$/);
      if (m) {
        const [, cat, name, field] = m;
        const catKey = catMap[cat];
        const fieldRev = { '数量': 'quantity', '品质': 'quality', '描述': 'description', '说明': 'description' };
        if (!result[catKey][name]) result[catKey][name] = {};
        result[catKey][name][fieldRev[field] || field] = state[key];
      }
    }
    for (const slot of ['武器', '防具', '饰品1', '饰品2']) {
      const val = state[`物品·已装备·${slot}`];
      if (val) result.equipped[slot] = val;
    }
    return result;
  }

  _summarizeEvents(events) {
    if (!Array.isArray(events) || !events.length) return '无';
    return events.slice(-6).map(event => {
      if (typeof event === 'string') return event;
      if (!event || typeof event !== 'object') return '';
      const title = event.title || event.name || event.id || '未命名事件';
      const status = event.status ? `(${event.status})` : '';
      const detail = event.description || event.detail || event.location || '';
      return [title + status, detail].filter(Boolean).join(': ');
    }).filter(Boolean).join('；') || '无';
  }

  _buildMemoryContext(memory) {
    if (this.memorySystem) return this.memorySystem.buildPromptContext(memory);
    return '';
  }

  _applyMemoryUpdate(update, userInput, aiResponse) {
    if (this.memorySystem) {
      this.memorySystem.apply(update, { source: 'ai', userInput, aiResponse });
      return;
    }
  }

  _rememberRecentTurn(userInput, aiResponse) {
    if (this.memorySystem) this.memorySystem.rememberRecentTurn(userInput, aiResponse);
  }

  _formatFewShot() {
    const shots = FEW_SHOT_EXAMPLES;
    if (!shots || !shots.length) return '';
    return `[示例对话 - 始终包含以规范格式]
${shots.map((s, i) => {
  const label = s.role === 'user' ? '玩家输入示例' : 'AI回复示例';
  return `### ${label} ${Math.ceil((i + 1) / 2)}
${s.content}`;
}).join('\n\n')}`;
  }

  _trimHistory() {
    if (this.chatHistory.length > 80) {
      const overflow = this.chatHistory.slice(0, -30);
      if (this.memorySystem) {
        this.memorySystem.apply({
          facts: ['历史归档: 早期对话已清理'],
          events: [`${formatGameTime(stateManager.get('世界·时间'))} 历史对话归档 (${overflow.length}条)`]
        }, { source: 'system' });
      }
      this.chatHistory = this.chatHistory.slice(-30);
    }
  }

  clearHistory() {
    this.chatHistory = [];
    this._staticSystemPrompt = null;
    this._mainPresetCache = null;
  }

  setHistory(history) {
    this.chatHistory = history || [];
  }

  getHistory() {
    return [...this.chatHistory];
  }
}

export { MessagePipeline };
export default MessagePipeline;
