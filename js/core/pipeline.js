import { stateManager } from './state-manager.js';
import { AIClient, aiClient } from './ai-client.js';
import { instructionParser } from './instruction-parser.js';
import { eventBus } from './event-bus.js';
import { PROMPTS } from '../data/prompts.js';
import { getMainPreset, resolvePresetMacros } from '../data/default-preset.js';
import { formatGameTime } from '../utils/format.js';
import { GAME_DATA } from '../data/game-data.js';
import { AgentPipeline } from './agent-pipeline.js';

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
    this.knowledgeBase?.invalidateCache?.();
    eventBus.emit('pipeline:processing', { userInput });

    try {
      const state = stateManager.get();

      if (state.player?.alive === false) {
        this.isProcessing = false;
        eventBus.emit('player:died', { cause: state.player.death_cause || '不明原因', alreadyDead: true });
        return null;
      }

      const dice = this._rollDice();
      const enrichedInput = this._preprocessInput(userInput, state) + this._formatDiceBlock(dice);

      const messages = this._buildPrompt(enrichedInput, state, userInput);

      let fullResponse = '';

      if (AgentPipeline.isEnabled() && state.player?.name) {
        this._agentPipeline = new AgentPipeline({
          pipeline: this,
          memorySystem: this.memorySystem
        });

        const onProgress = (stage, detail) => {
          eventBus.emit('agent:progress', { stage, detail });
        };

        const agentResult = await this._agentPipeline.execute(state, userInput, onProgress);
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

      this._runSecondaryVariableUpdate({
        userInput,
        enrichedInput,
        state,
        narrativeResponse: fullResponse
      }).then(additionalResponse => {
        if (additionalResponse) {
          const extra = instructionParser.parse(additionalResponse);
          this._applyInstructions(extra, true);
          eventBus.emit('pipeline:vars-updated');
        }
      }).catch(err => {
        console.warn('[Pipeline] Background variable updater failed:', err.message);
      });

      const hasHUD = instructionParser.hasStatusQuery(displayResponse);
      const cleanResponse = instructionParser.cleanupResponse(displayResponse);
      let thinkContent = instructionParser.extractThinkContent(displayResponse);
      const varThinkContent = instructionParser.extractVarThinkContent(displayResponse);
      if (varThinkContent) {
        thinkContent = (thinkContent ? thinkContent + '\n\n' : '') + '### 变量自检\n' + varThinkContent;
      }

      this.chatHistory.push({ role: 'user', content: this._lastFullUserContent });
      this.chatHistory.push({ role: 'assistant', content: displayResponse });
      this._trimHistory();

      const currentTurn = stateManager.get('_meta.turn_count');
      stateManager.update([
        { path: '_meta.turn_count', op: 'set', value: currentTurn + 1 }
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
      turnCount: stateManager.get('_meta.turn_count'),
      isPartial: true
    });
  }

  async _runSecondaryVariableUpdate({ userInput, enrichedInput, state, narrativeResponse }) {
    const config = stateManager.getAPIConfig()?.variableUpdater;
    if (!config?.enabled) return narrativeResponse;

    const mainConfig = stateManager.getAPIConfig() || {};
    const updaterConfig = {
      ...mainConfig,
      ...config,
      backend: config.backend && config.backend !== 'inherit' ? config.backend : mainConfig.backend,
      apiUrl: config.apiUrl || mainConfig.apiUrl,
      apiKey: config.apiKey || mainConfig.apiKey,
      model: config.model || mainConfig.model
    };
    if (!updaterConfig.apiUrl || !updaterConfig.apiKey || !updaterConfig.model) return narrativeResponse;

    try {
      const client = new AIClient();
      client.configure(updaterConfig);
      const variableTags = await client.chat(this._buildVariableUpdaterMessages({ userInput, enrichedInput, state, narrativeResponse }), {
        temperature: 0.1,
        max_tokens: 2048
      });
      const cleaned = this._sanitizeVariableUpdaterOutput(variableTags);
      if (!cleaned) return null;
      return cleaned;
    } catch (error) {
      console.warn('[Pipeline] Secondary variable updater failed:', error.message);
      eventBus.emit('pipeline:warning', { warning: `二次变量更新失败: ${error.message}` });
      return narrativeResponse;
    }
  }

  _buildVariableUpdaterMessages({ userInput, enrichedInput, state, narrativeResponse }) {
    return [
      {
        role: 'system',
        content: `你是“忍者手记”的二次变量更新器。只输出XML标签，不写叙事、不解释、不寒暄。

你的任务:
1. 阅读玩家输入、当前状态、主模型叙事回复。
2. 首先必须输出 `<variable_thinking>` 标签，严格按照【变量自检协议】进行四步检查。
3. 根据自检结果，补充主模型遗漏的 `<variable>`、`<mission>`、`<relationship>`、`<memory>` 标签。
4. 每回合必须输出一个 `<memory>` 标签，其中 summary 是约300字的本回合详细小结。

严格限制:
- 只能输出以下标签: <variable_thinking>...</variable_thinking> <variable>...</variable> <mission>...</mission> <relationship>...</relationship> <memory>...</memory>
- 不要输出 <status_query />、普通文本、Markdown、代码块。
- 不要改写叙事，不要重复主模型已经写过的等价变量。
- 只记录本回合实际发生的变化。
- 遵守成长封顶: 只在专门的修炼、战斗、完成任务时使用 op="add" 增加 progression.exp（历练值），每次 +10~+30。闲聊、赶路、观察等非成长行为【绝对禁止】增加历练值。严禁直接提升属性上限（如 chakra, stamina, spirit 等），只有当 exp >= 100 触发系统突破时才允许！单回合 mastery 提升不超过 +8。
- 不要直接覆盖 missions.active；任务变化使用 <mission>。
- memory.summary 必须只总结本回合关键事实，约250-400个中文字符，包含: 玩家具体行动、所在场景、参与NPC与态度变化、发现的线索、任务/战斗/关系结果、资源或伤势变化、下回合必须承接的待办。不要只写一句话。
- memory.facts/clues/pins/npc_notes 只在确有长期价值时填写，不要堆砌普通景色。

可用变量协议摘要:
- 变量格式: <variable>{"updates":[{"path":"路径","op":"操作","value":值}]}</variable>
  op: set(覆盖整个节点) | add(数值增加) | sub(数值扣除) | assign(修改对象中的单个key) | push(追加到数组) | remove(删除对象键或数组项)
  提示: op="assign" 只改单个字段不会覆盖其他字段；op="set" 必须提供完整对象。op="remove" 需加 "key" 字段指定要删除的键名。
- 属性消耗: attributes.chakra_current/stamina_current/spirit_current/willpower_current 用 sub。
  【生命警戒】stamina_current 是角色的生命值，不是普通消耗品。严禁无充分战斗/重伤剧情就随意扣减。30以下为濒死，10以下为垂危禁止再扣，0为死亡。
- 属性恢复: 只恢复 *_current，不增加上限。休息可恢复5~15体力，医疗忍术15~40。
- 属性上限: attributes.chakra/stamina/spirit/willpower/speed 用 add 提升，单回合总和 <= 6（重大突破 <= 15）。
- 时间流逝: world_state.calendar 用 op="set" 写入完整时间字符串（如"木叶48年7月15日·正午"）。本回合时间有推进时才输出。
- 历练值: progression.exp 用 add。【严禁日常闲聊/走路/观察环境增加历练值】。仅以下情况: 训练+10~20，战斗+15~25，完成任务+10~30。无上述事件则【禁止】输出。
- 突破标记: progression.pending_breakthrough 用 add(触发) 或 sub(完成)。
- 声望: progression.reputation.木叶隐村 用 add 或 sub。
- 任务完成数: progression.missions_done 用 add。
- 技能熟练度: skills.jutsu/taijutsu/genjutsu/support.{名称}.mastery 用 add，小幅+3到+8。
- 忍术新建: {"path":"skills.jutsu.火遁·豪火球","op":"set","value":{"name":"火遁·豪火球","rank":"C","element":"火","cost":25,"power":40,"mastery":0,"description":"从口中喷出巨大火球"}}
  op="set" 在 skills.* 路径下会自动合并(保留已有字段)，但建议提供完整对象。
- 忍术升阶: {"path":"skills.jutsu.火遁·豪火球","op":"assign","key":"rank","value":"B"}
- 忍术删除: {"path":"skills.jutsu","op":"remove","key":"火遁·豪火球"}
- 血继限界: {"path":"skills.kekkei_genkai","op":"set","value":"写轮眼·单勾玉"}
- 天赋: skills.talents.{天赋名} 同上
- 物品获取: {"path":"equipment.consumables.绷带","op":"set","value":{"quantity":2,"quality":"普通"}}
- 物品消耗: {"path":"equipment.consumables.绷带.quantity","op":"sub","value":1}
- 物品删除: {"path":"equipment.consumables","op":"remove","key":"绷带"}
- 金钱: equipment.ryo 用 add 或 sub
- 人物目标/位置: player.current_goal、world_state.current_location。
- 地图探索: world_state.map.explored_regions（首次进入用push）；world_state.map.known_locations（用assign添加地标key和description）
- 删除任何对象键: {"path":"父级路径","op":"remove","key":"要删除的键名"}
- 任务: <mission>{"id":"任务唯一ID","status":"active|progress|completed|failed","rank":"D","title":"任务名称","description":"任务描述","objective":"目标","location":"地点","client":"委托人","type":"任务类型","risk":"低|中|高","reward_ryo":500,"reward_exp":10}</mission>
  新建任务必须包含 id/title/rank/objective 全部字段；更新已有任务只需 id + 变更字段。
- 关系: <relationship>{"npc":"...","affection_change":0,"trust_change":0,"respect_change":0,"reason":"...","inner_thoughts":"该NPC对主角当前的真实内心想法（仅写本回合，系统自动累积历史）","history":"本回合互动摘要（仅写当前回合，系统自动按时间轴累积，【禁止】重复拼接旧历史）"}</relationship>
- 记忆: <memory>{"summary":"本回合玩家在...采取...行动；现场...NPC表现出...态度；直接结果是...；发现/确认的线索包括...；任务、关系、资源或伤势变化为...；下回合必须承接...，不要遗忘...。","facts":[],"clues":[],"pins":[],"npc_notes":{}}</memory>`
      },
      {
        role: 'user',
        content: `[当前状态JSON]\n${JSON.stringify(this._compactStateForVariableUpdater(state)).slice(0, 6000)}\n\n[预处理玩家输入]\n${enrichedInput}\n\n[原始玩家输入]\n${userInput}\n\n[主模型回复]\n${narrativeResponse}\n\n【强制要求】：请首先输出 <variable_thinking> 标签，严格执行以下7段自检（必须逐段回答，不可省略任何一段）：\n1. 人物与关系：本回合涉及的NPC？主模型是否已输出 <relationship> 标签？若遗漏则补充。\n2. 技能变动：本回合是否学习/创造/练习/升级了忍术/体术/幻术/血继/天赋？主模型的 <variable> 是否已包含？若遗漏则补充。\n3. 物品与装备：本回合是否获得/消耗/使用/丢弃了物品/武器/防具/忍具/金钱？遗漏则补充。\n4. 任务与历练：本回合是否推进了任务？是否应有 exp/突破/声望变化？遗漏则补充。\n5. 地图与探索：本回合是否移动到了新场景/新区域/新地标？遗漏则补充。\n6. 状态与位置：时间流逝？查克拉/体力/精神/意志力消耗或恢复？异常状态变化？遗漏则补充。\n7. 战斗状态：是否触发/进行/结束了战斗？（仅战斗回合）\n完成自检后，输出实际变动的XML变量标签。无论有无数值变化，都必须输出 <memory> 标签。`
      }
    ];
  }

  _compactStateForVariableUpdater(state) {
    return {
      player: state.player,
      attributes: state.attributes,
      skills: state.skills,
      progression: state.progression,
      equipment: state.equipment,
      missions: state.missions,
      relationships: state.relationships,
      memory: state.memory,
      world_state: state.world_state,
      combat: state.combat
    };
  }

  _applyInstructions(instructions, silent = false) {
    if (instructions.variables.length > 0) {
      const applied = [];
      const seenHashes = new Set();
      for (const v of instructions.variables) {
        if (v && typeof v.path === 'string' && v.path.trim() && ['set','add','sub','assign','push','remove'].includes(v.op)) {
          const hash = `${v.path}|${v.op}|${JSON.stringify(v.value)}`;
          if (seenHashes.has(hash)) {
            console.warn('[Pipeline] Ignored duplicate variable instruction:', v);
            continue;
          }
          seenHashes.add(hash);
          applied.push(v);
        }
      }
      if (applied.length) stateManager.batchUpdate(applied);
      if (!silent && applied.length < instructions.variables.length) {
        console.warn(`[Pipeline] ${instructions.variables.length - applied.length} variables invalid`);
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

  _sanitizeVariableUpdaterOutput(text) {
    if (!text) return '';
    const tags = [];
    const allowed = ['variable', 'combat', 'mission', 'relationship', 'event', 'memory'];
    for (const tag of allowed) {
      const regex = new RegExp(`<${tag}(?:\\s+[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'g');
      const matches = text.match(regex);
      if (matches) tags.push(...matches);
    }
    return tags.join('\n').trim();
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
    if (state.player.name) {
      summaries.push(`角色: ${state.player.name} | ${state.player.rank} | ${state.player.chakra_nature?.join('/') || '未选择'}`);
      summaries.push(`查克拉${state.attributes.chakra_current}/${state.attributes.chakra} | 体力${state.attributes.stamina_current}/${state.attributes.stamina}`);
      const exp = (state.progression && state.progression.exp) || 0;
      const track = state.progression?.promotion?.track || '均衡';
      summaries.push(`历练值: ${exp}/100 | 晋升路线: ${track} | 精神力${state.attributes.spirit || 0} | 意志力${state.attributes.willpower || 0} | 速度${state.attributes.speed || 0}`);
      summaries.push(`位置: ${state.world_state.current_location || '木叶隐村'} | ${formatGameTime(state.world_state.calendar)}`);
    }
    if (state.missions?.active?.length > 0) {
      summaries.push(`任务: ${state.missions.active.map(m => m.title).join(', ')}`);
    }
    if (state.combat?.is_active) {
      summaries.push(`战斗中: ${state.combat.enemy_name}`);
    }
    return summaries.join('\n');
  }

  _rollDice() {
    const values = Array.from({ length: 6 }, () => Math.floor(Math.random() * 100) + 1);
    window.__naruto_last_dice = values;
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
      this._staticSystemPrompt = PROMPTS.DEFAULT_PROMPT + '\n\n' + this._formatFewShot();
      console.log('[Cache] Static prompt built:', this._staticSystemPrompt.length, 'chars');
    }

    messages.push({ role: 'system', content: this._staticSystemPrompt });

    // Split preset into top (before chat), bottom (after chat), and prefill (last assistant msg)
    const { top, bottom, prefill } = this._buildMainPresetMessages(state, userInput);
    if (top.length > 0) {
      messages.push(...top);
    }

    messages.push(...this.chatHistory);

    const ctxParts = [enrichedInput];

    if (this.knowledgeBase) {
      const kbContent = this.knowledgeBase.buildContext?.({
        query: userInput, state, memory: state.memory,
        maxEntries: 9, budget: 6200
      }) || this.knowledgeBase.matchAndGetContent(userInput, 4);
      if (kbContent) ctxParts.push(kbContent);
    }

    ctxParts.push(this._buildDynamicContext(state));

    const memCtx = this._buildMemoryContext(state.memory);
    if (memCtx) ctxParts.push(memCtx);

    const finalUserContent = `${ctxParts.join('\n\n')}\n\n[玩家操作]\n${userInput}`;
    this._lastFullUserContent = finalUserContent;
    messages.push({ role: 'user', content: finalUserContent });

    const progression = state.progression || {};
    if (progression.pending_breakthrough > 0) {
      messages.push({ 
        role: 'system', 
        content: `【系统强制指令：历练突破】：玩家积累的历练值已满！请必须在本回合的正文中触发“实力突破/感悟”剧情。根据玩家这次选择的“晋升路线”或近期的历练侧重点，使其对应的核心基础变量上限（如chakra, stamina, spirit, willpower, speed等）获得一次稳步提升。
严厉要求：
1. 提升必须有侧重点（比如幻术路线重点加spirit和幻术造诣），绝不能所有属性平庸地平均加一点。如果不专精拔高至少一项能力，其战力评级将永远卡在低段位！
2. 提升幅度要克制，需多次突破才能跨阶。
3. 在底部的 <variable> 标签中，必须将对应的能力上限（或mastery）用 op="add" 增加！
4. 【非常重要】必须在 <variable> 标签中，将 progression.pending_breakthrough 用 op="sub" 扣除 1 ！` 
      });
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

  _buildMainPresetMessages(state, userInput) {
    try {
      const preset = getMainPreset();
      if (!preset || !Array.isArray(preset.entries) || preset.entries.length === 0) {
        return { top: [], bottom: [], prefill: null };
      }

      const context = {
        playerName: state.player?.name || '玩家',
        charName: state.player?.name || '',
        // 【已修复】强制冻结此处注入的动态文本。
        // 由于设定集中的 nm_041 包含 {{lastUserMessage}}，且 API 服务商会将设定集强制提升至请求的最顶部。
        // 如果这里使用 userInput，最顶部的 System Prompt 会每一回合都发生变动，导致整个长达万字的前缀缓存彻底失效。
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

      // Collect IDs of entries that belong to the "bottom" group
      const bottomIds = new Set();
      if (splitIndex >= 0) {
        for (let i = splitIndex + 1; i < preset.entries.length; i++) {
          bottomIds.add(preset.entries[i].id);
        }
      }

      // Resolve all entries together so {{setvar}}/{{getvar}} work across groups
      const allResolved = resolvePresetMacros(preset.entries, context);
      
      const enableCoT = stateManager.getAPIConfig()?.enableVariableCoT !== false;

      const top = [];
      const bottomRaw = [];

      for (const entry of allResolved) {
        const role = entry.role === 'assistant' ? 'assistant' : (entry.role === 'user' ? 'user' : 'system');
        let content = entry.content;
        
        if (!enableCoT) {
           content = content.replace(/<variable_thinking>[\s\S]*?<\/variable_thinking>\s*/g, '');
        }

        const msg = { role, content };

        if (bottomIds.has(entry.id)) {
          bottomRaw.push(msg);
        } else {
          top.push(msg);
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

      console.log(`[Preset] Split: ${top.length} top, ${bottomRaw.length} bottom, prefill=${!!prefill}`);
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
    if (!state.player.name) {
      return `\n[游戏阶段: 角色尚未创建。请引导玩家完成角色创建，使用<variable>标签记录创建完成状态。]\n`;
    }

    const timelineContext = this._buildTimelineContext(state);

    return `
[动态游戏状态]
## 时代约束
${timelineContext}
- 核心规则: 不要默认玩家处于疾风传开始时间。必须按当前时间线判断人物年龄、组织公开程度、事件是否已发生、忍术/科技/称号是否可用。
- 年代事实: “已灭亡、已死亡、已叛逃、已加入组织、事件已发生”等结论必须按当前年份判断，禁止把疾风传/未来结果倒灌到早期时间线。

## 玩家角色
- 姓名: ${state.player.name}
- 性别: ${state.player.gender === '男性' ? '男' : '女'}
- 忍阶: ${state.player.rank}
- 公开身份: ${state.player.public_identity || state.player.rank}
- 出身: ${state.player.background}
- 查克拉属性: ${Array.isArray(state.player.chakra_nature) ? state.player.chakra_nature.map(n => typeof n === 'string' ? n : n.name).join(', ') : state.player.chakra_nature}
- 当前目标: ${state.player.current_goal || '未设定'}
- 声望标签: ${(state.player.reputation_tags || []).join('、') || '无'}

## 当前属性
- 查克拉: ${state.attributes.chakra_current}/${state.attributes.chakra}
- 精神力: ${state.attributes.spirit_current}/${state.attributes.spirit}
- 意志: ${state.attributes.willpower_current}/${state.attributes.willpower}
- 体力: ${state.attributes.stamina_current}/${state.attributes.stamina}
- 速度: ${state.attributes.speed}
- 幸运: ${state.attributes.luck}

## 派生战力参考
${this._summarizeDerivedStats(state)}

## 成长与晋升评估
${this._summarizePromotion(state)}

## 技能摘要
${this._summarizeSkills(state.skills)}

## 装备摘要
- 武器: ${this._summarizeEquipment(state.equipment.weapons)}
- 忍具: ${this._summarizeEquipment(state.equipment.tools)}
- 消耗品: ${this._summarizeEquipment(state.equipment.consumables)}
- 金钱: ${state.equipment.ryo || 0}两

## 任务进度
${this._summarizeMissions(state.missions)}

## 人际关系
${this._summarizeRelationships(state.relationships)}

## 世界状态
- 时间: ${formatGameTime(state.world_state.calendar)}
- 位置: ${state.world_state.current_location || '木叶隐村'}
- 天气: ${state.world_state.weather || '晴'}
- 进行中的世界事件: ${this._summarizeEvents(state.world_state.active_events)}
- 已探索区域: ${(state.world_state.map?.explored_regions || []).join('、') || '无'}
- 已知地标: ${Object.keys(state.world_state.map?.known_locations || {}).join('、') || '无'}

## 战斗状态
${state.combat?.is_active ? `【战斗中】对手: ${state.combat.enemy_name} | 查克拉: ${state.combat.enemy_chakra}/${state.combat.enemy_chakra_max}` : '无战斗'}
`;
  }

  _buildTimelineContext(state) {
    const world = state.world_state || {};
    const calendar = world.calendar || '';
    const timeline = world.timeline || '木叶48年';
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
    const calendar = state.world_state?.calendar || {};
    const values = [
      calendar.year,
      state.world_state?.timeline,
      state.memory?.recent_summary,
      state.memory?.compressed_summary
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

  _summarizeMissions(missions) {
    if (!missions?.active?.length) return '无进行中的任务';
    return missions.active.map(m => {
      const progress = typeof m.progress === 'object'
        ? `${m.progress.current_step || 0}/${m.progress.total_steps || m.progress.steps?.length || 0}`
        : (m.progress || '进行中');
      return `[${m.rank || 'D'}] ${m.title} | ${progress}${m.location ? ' | ' + m.location : ''}`;
    }).join('\n');
  }

  _summarizePromotion(state) {
    const pg = state.progression || {};
    const promo = pg.promotion || {};
    const stats = state.missions?.stats || {};
    const parts = [
      `- 经验: ${pg.exp || 0}/${pg.exp_to_next || 0}`,
      `- 成长路线: ${this._trackLabel(promo.track || 'balanced')}`,
      `- 晋升考核资格: ${promo.field_exam_ready ? '是' : '否'}`,
      `- 最近评价: ${promo.last_evaluation || '暂无'}`,
      `- 任务履历: D${stats.d_rank || 0} / C${stats.c_rank || 0} / B${stats.b_rank || 0} / A${stats.a_rank || 0} / S${stats.s_rank || 0}`
    ];
    if (promo.strengths?.length) parts.push(`- 优势: ${promo.strengths.join('、')}`);
    if (promo.bottlenecks?.length) parts.push(`- 短板: ${promo.bottlenecks.join('、')}`);
    return parts.join('\n');
  }

  _summarizeDerivedStats(state) {
    const a = state.attributes || {};
    const best = (group) => Math.max(0, ...Object.values(group || {}).map(item => Number(item?.mastery) || 0));
    const jutsu = best(state.skills?.jutsu);
    const taijutsu = best(state.skills?.taijutsu);
    const genjutsu = best(state.skills?.genjutsu);
    const derived = {
      ninjutsu: Math.round((a.chakra || 0) * 0.45 + (a.spirit || 0) * 0.25 + jutsu * 0.7),
      taijutsu: Math.round((a.stamina || 0) * 0.25 + (a.speed || 0) * 0.9 + (a.willpower || 0) * 0.2 + taijutsu * 0.9),
      genjutsu: Math.round((a.spirit || 0) * 0.75 + (a.chakra || 0) * 0.2 + genjutsu * 0.9),
      defense: Math.round((a.stamina || 0) * 0.18 + (a.willpower || 0) * 0.25),
      initiative: Math.round((a.speed || 0) * 0.8 + (a.spirit || 0) * 0.15 + (a.luck || 0) * 0.5)
    };
    const rank = state.player?.rank || '下忍';
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
    const shots = PROMPTS.FEW_SHOT_EXAMPLES;
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
      this.chatHistory = this.chatHistory.slice(-30);
      console.log('[Cache] Epoch trimmed. Archived memory will bridge the gap.');
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
