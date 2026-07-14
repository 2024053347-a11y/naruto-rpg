import { stateManager } from './core/state-manager.js';
import { aiClient, isTavernEnv } from './core/ai-client.js';
import { eventBus } from './core/event-bus.js';
import { MessagePipeline } from './core/pipeline.js';
import { timelineSystem } from './systems/timeline-system.js';
import { combatSystem } from './systems/combat-system.js';
import { missionSystem } from './systems/mission-system.js';
import { relationshipSystem } from './systems/relationship-system.js';
import { memorySystem } from './systems/memory-system.js';
import { cloudSave } from './core/cloud-save.js';
import { worldStateSystem } from './systems/world-state-system.js';
import { errorHandler } from './utils/error-handler.js';
import { loadingIndicator } from './utils/loading-indicator.js';
import { swNotifier } from './utils/sw-notifier.js';
import { helpGuide } from './utils/help-guide.js';

// ═══════════════════════════════════════
// 版本号 — 更新时递增，自动清理旧缓存
// ═══════════════════════════════════════
const APP_VERSION = 20250625;

function checkVersionAndMigrate() {
  const storedVersion = parseInt(localStorage.getItem('naruto_app_version') || '0', 10);
  if (storedVersion >= APP_VERSION) return;

  console.log(`[NarutoRPG] 版本更新 ${storedVersion} → ${APP_VERSION}，清理旧缓存...`);

  // 清除可安全重建的缓存（保留用户数据）
  const keysToClear = [
    'naruto_ui_prefs',           // UI 偏好 — 新版本默认值更优
    'naruto_worldbook',          // 世界书缓存 — 从 JS 重建
    'naruto_agent_config',       // Agent 配置 — 从 JS 重建
    'naruto_timeline_summary',   // 时间线摘要 — 从 DB 重建
    'naruto_bg_image',           // 背景图缓存
    'naruto_music_playlist',     // 播放列表缓存
    'naruto_music_favorites',    // 收藏列表缓存
  ];

  for (const key of keysToClear) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  localStorage.setItem('naruto_app_version', String(APP_VERSION));

  // 显示更新提示
  if (storedVersion > 0 && typeof eventBus !== 'undefined') {
    setTimeout(() => {
      eventBus.emit('app:toast', `已更新至最新版本，缓存已自动清理`);
    }, 2000);
  }
}
import { appShell } from './ui/app-shell.js';
import { atmosphereManager } from './ui/atmosphere-manager.js';
import { escAttr } from './utils/format.js';
import { KNOWLEDGE_BASE } from './data/knowledge-base.js';
import './ui/hud.js';
import './ui/combat-arena.js';
import './ui/character-creator.js';
import './ui/panel.js';
import './ui/modal.js';
import './ui/timeline-navigator.js';
import './ui/api-config-form.js';
import './ui/display-config-form.js';
import './ui/worldbook-editor.js';
import './ui/main-preset-editor.js';
import './ui/variable-updater-preset-editor.js';
import './ui/agent-progress.js';
import './ui/map-modal.js';
import SettingsPanel, { applyLocalSettings } from './ui/settings-panel.js';

class NarutoRPGApp {
  constructor() {
    this.pipeline = null;
    this._state = 'init';
  }

  async init() {
    // 启动时检查版本并清理旧缓存
    checkVersionAndMigrate();

    const container = document.getElementById('app');
    if (!container) {
      console.error('[NarutoRPG] #app element not found');
      return;
    }

    appShell.init(container);
    atmosphereManager.init();
    
    let dbOk = false;
    try {
      await stateManager.initDB();
      dbOk = true;
    } catch(e) {
      console.error('[NarutoRPG] Failed to init DB:', e);
    }

    await stateManager.loadUIPrefs();
    applyLocalSettings();
    this._applyDisplayConfig(stateManager.getDisplayConfig());
    this._bindEvents();

    try {
      await timelineSystem.init();
    } catch (e) {
      console.warn('[NarutoRPG] IndexedDB init failed, running without persistence:', e.message);
    }

    this.pipeline = new MessagePipeline({
      knowledgeBase: KNOWLEDGE_BASE,
      timelineSystem: dbOk ? timelineSystem : null,
      uiRenderer: null,
      combatSystem,
      missionSystem,
      relationshipSystem,
      memorySystem,
      worldStateSystem
    });
    memorySystem.bindEvents();

    // 使用加密加载（解密 API Key + 强制代理模式）
    const apiConfig = await stateManager.getAPIConfigAsync();
    if (apiConfig) {
      aiClient.configure(apiConfig);
    } else if (isTavernEnv) {
      // 酒馆环境自动使用酒馆模型，无需手动配置 API
      const tavernConfig = { backend: 'tavern', model: 'tavern-default', apiUrl: '', apiKey: '' };
      aiClient.configure(tavernConfig);
      console.log('[NarutoRPG] 酒馆环境检测到，自动使用酒馆模型');
    }
    const isConfigured = aiClient.isConfigured();
    if (isConfigured) {
      if (dbOk) {
        try {
          await this._checkSavedGame();
          this._registerServiceWorker();
          this._state = 'ready';
          console.log('[NarutoRPG] App initialized');
          return;
        } catch (e) {
          console.warn('[NarutoRPG] Failed to restore saved game:', e.message);
        }
      }
      appShell.showCharacterCreator();
    } else {
      appShell.showAPIForm();
    }

    this._registerServiceWorker();
    this._state = 'ready';
    console.log('[NarutoRPG] App initialized');
  }

  _bindEvents() {
    eventBus.on('app:api-config', async (config) => {
      await stateManager.saveAPIConfig(config);
      aiClient.configure(config);
      appShell.showCharacterCreator();
    });

    eventBus.on('app:timeline-import-file', async ({ file }) => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // 检查现有库是否非空,决定是否需要询问导入模式
        const existingNodes = await stateManager.dbGetAll('timeline_nodes') || [];
        let mode = 'overwrite';
        if (existingNodes.length > 0) {
          const choice = await this._showImportModeChoice(existingNodes.length);
          if (choice === 'cancel') return;
          mode = choice;
        }

        const node = await timelineSystem.importTimeline(data, { mode });
        if (mode === 'merge') {
          this._sendSystemMessage(`时间线已合并导入:新增 ${(data.nodes || []).length} 个节点到现有库。当前进度保持不变。`);
        } else {
          const history = await timelineSystem._reconstructChatHistory(node);
          this.pipeline?.setHistory(history);
          appShell.restoreChatHistory(history, node?.clean_response || node?.ai_response_summary || '存档已导入。');
          this._sendSystemMessage('时间线存档导入成功(覆盖模式)。');
        }
      } catch (error) {
        this._sendSystemMessage(`导入失败: ${error.message}`);
      }
    });

    eventBus.on('character:created', async (player) => {
      appShell.showGame();
      this._sendSystemMessage('角色创建完成！正在生成开场剧情...');

      if (player.persona) {
        try {
          let customEntries = KNOWLEDGE_BASE.getCustomEntries() || [];
          const personaIndex = customEntries.findIndex(e => e.title === '玩家人设');
          const newContent = `[玩家人设]\n名字：${player.name || '玩家'}\n${player.persona}`;
          
          if (personaIndex >= 0) {
            if (customEntries[personaIndex].content !== newContent || !customEntries[personaIndex].isAlwaysOn) {
               if (confirm('世界书中已存在玩家人设，是否用当前的新人设覆盖？')) {
                 customEntries[personaIndex].content = newContent;
                 customEntries[personaIndex].isAlwaysOn = true;
                 KNOWLEDGE_BASE.saveCustomEntries(customEntries);
                 this._sendSystemMessage('玩家人设已更新至世界书。');
               }
            }
          } else {
             customEntries.push({
               keys: ['玩家人设', player.name || '玩家', '人设', '外貌', '性格'],
               title: '玩家人设',
               content: newContent,
               category: 'character_detail',
               isAlwaysOn: true
             });
             KNOWLEDGE_BASE.saveCustomEntries(customEntries);
             this._sendSystemMessage('玩家人设已写入世界书，防止AI遗忘。');
          }
        } catch(e) {
          console.warn('保存世界书人设失败:', e);
        }
      }

      try {
        const state = stateManager.get();
        stateManager.update([{ key: '系统·回合数', op: '=', value: 1 }]);
        const playerNature = Array.isArray(player.chakra_nature)
          ? player.chakra_nature.join(', ')
          : player.chakra_nature || '未知';
        const customProfile = player.custom_profile || {};
        const customLines = [
          customProfile.talent ? `自定义天赋: ${customProfile.talent.name} - ${customProfile.talent.description}` : '',
          customProfile.background ? `自定义出身: ${customProfile.background.name} - ${customProfile.background.description}; 起始地点: ${customProfile.background.location}` : '',
          customProfile.skill ? `自定义初始技能: ${customProfile.skill.name} (${customProfile.skill.rank}级/${customProfile.skill.type}) - ${customProfile.skill.description}` : '',
          player.persona ? `【玩家核心人设设定】: ${player.persona}` : ''
        ].filter(Boolean).join('\n');
        const timelineLabel = state['世界·时间']?.year || state['世界·年代'] || '木叶48年';
        const memoryEra = state._memory?.recent_summary || '';

        // Check if secondary variable updater is enabled
        const apiCfg = stateManager.getAPIConfig() || {};
        const updaterEnabled = apiCfg.variableUpdater?.enabled === true;

        let startPrompt;
        if (updaterEnabled) {
          // Secondary updater handles variables — main model focuses on narrative only
          startPrompt = `[系统指令] 新角色已创建。角色名: ${player.name || '忍者'}, 性别: ${player.gender}, 荣誉忍阶: ${player.official_rank}, 出身: ${player.background}, 天赋: ${(player.talents || []).join(', ') || '未设定'}, 查克拉属性: ${playerNature}。${customLines ? `\n玩家自定义设定如下，请在后续剧情中尊重这些设定，不要随意否定，但可以根据世界观给出代价和限制:\n${customLines}` : ''}\n[当前时代: ${timelineLabel}]\n${memoryEra ? `[时代背景: ${memoryEra}]\n` : ''}

【对主模型的强制指令】：
请严格遵循【沉浸叙事铁律】，正文中绝对禁止出现任何数字、数值、符号。
后台独立的变量更新模型会自动处理所有属性初始化（查克拉/体力/技能/物品等），你**完全不需要**在回复中使用 <var>、<status_query /> 或任何变量相关的XML标签。
你只需要：
1. 使用 <relationship> 标签为登场的每个NPC建立完整的人物卡（含战斗属性/忍术/内心想法/互动历史）
2. 生成一段完整、有极强镜头感的开场剧情，正文不少于 1200 汉字。描绘木叶村此刻的氛围、玩家目前的处境、内心的独白，并抛出一个互动人物或线索引导玩家行动。
3. 使用 <memory> 标签总结本回合。

【对二次变量更新模型（AI）的特殊指令】：
由于这是开局，这是**唯一一次全量状态与属性初始化**！你作为二次变量更新器，看到这条消息时，必须突破“只记录本回合变化”的限制，进行**深度的初始构建**：
1. **合理化初始变量**：根据玩家分配的点数和上述【自定义设定】，如果玩家明确说明自己是高手（如“精英上忍”、“影级”等），**请务必使用 <variable> 标签大幅拔高对应的核心属性（如查克拉、体力上限、各系造诣）**，让其开局实力完美匹配文字设定。
2. **专属能力与忍术生成**：请仔细阅读玩家的设定，结合其人设，**使用 <variable> 标签为其生成合理的招式库**（利用 path-based format，如 {"path":"skills.jutsu.招式名","op":"set","value":{...}}）。根据其等级自由分配 2~5 个合理的初始招式、天赋或血继限界，让他们在第一回合就有招可用！
完成初始化后，正常输出变动的标签。`;
        } else {
          // No secondary updater — main model must output variables
          startPrompt = `[系统指令] 新角色已创建。角色名: ${player.name || '忍者'}, 性别: ${player.gender}, 荣誉忍阶: ${player.official_rank}, 出身: ${player.background}, 天赋: ${(player.talents || []).join(', ') || '未设定'}, 查克拉属性: ${playerNature}。${customLines ? `\n玩家自定义设定如下，请在后续剧情中尊重这些设定，不要随意否定，但可以根据世界观给出代价和限制:\n${customLines}` : ''}\n[当前时代: ${timelineLabel}]\n${memoryEra ? `[时代背景: ${memoryEra}]\n` : ''}
【最高优先级系统任务：角色深度初始化】
上述属性和选择均为用户选择，请你严格按照上述属性生成变量，另外【绝对不可以】在正文中直接提到这些具体的属性值、选择项或天赋名，应将其化用为具体的行动和剧情细节。
这是开局的唯一一次全量状态与属性初始化。请你作为专业的 DM，使用对应的 XML 标签为该角色进行**深度的初始构建**。
**初始化原则与必填项**：
1. **合理化初始变量**：系统已经根据玩家分配的点数生成了一套”默认基础面板”。如果玩家在【自定义出身】或【玩家核心人设设定】中明确说明了自己是高手（如”精英上忍”、”影级”等），**请务必使用 <var> 标签大幅拔高对应的核心变量**，让其开局实力完美匹配玩家的文字设定。
2. **专属能力与忍术生成**：请仔细阅读玩家设定的【自定义天赋】和【初始技能】，并结合其人设，**使用 <var> 标签为其生成合理的招式库**。
    - 格式要求：使用扁平键名 <var> 块格式 '<var>\n键名 操作符 值\n</var>' 写入忍术（如 技能·忍术·火遁豪火球·等级 =C 技能·忍术·火遁豪火球·熟练度 =50）。
    - 同样，天赋写入 '<variable key=”技能·天赋·天赋名” .../>'，血继限界写入 '技能·血继限界'。
   - 这不仅是对已有设定的扩写，你可以根据其等级自由分配 2~5 个合理的初始招式，让他们在第一回合就有招可用！
3. **构建深层人物关系**：如果开局剧情中生成了特定的互动人物（NPC），或玩家自定义人设中提到了重要的羁绊对象，请务必像后续正常回合那样，使用 <relationship> 标签为他们建立完整的关系档案。
   - 必须在标签的内容中，详细扩写该 NPC 与玩家的【历史渊源】、他此刻对玩家的【真实心理想法】以及【潜在动机】（例如：<relationship name=”某某” affection=”30” trust=”50” respect=”20”>写明该NPC过去的经历，以及他现在内心对玩家的真实看法...</relationship>）。
   - 在开局和今后的所有回合中，只要涉及人物关系，都必须保持这种深度的历史与心理剖析。

在完成上述所有 \`<var>\` 和 \`<relationship>\` 的底层初始化后，请生成一段完整、有极强镜头感的开场剧情，正文不少于 1200 个汉字。描绘木叶村此刻的氛围、玩家目前的处境、内心的独白，并抛出一个互动人物或线索引导玩家行动。最后务必使用 <status_query /> 标签显示初始化后的面板。`;
        }
        this._pendingStartPrompt = startPrompt;
        await this.pipeline.process(startPrompt);
        this._pendingStartPrompt = null;
      } catch (error) {
        this._showStartupErrorModal(error);
      }
    });

    eventBus.on('user:input', async (text) => {
      if (!this.pipeline || !aiClient.isConfigured()) {
        this._sendSystemMessage('请先配置 API 连接。');
        return;
      }
      if (this.pipeline.isProcessing) {
        this._sendSystemMessage('上一道结印尚未完成，请稍候。');
        return;
      }

      const currentId = stateManager.get()['_meta']?.current_node_id;
      if (currentId) {
        const currentNode = await stateManager.dbGet('timeline_nodes', currentId);
        if (currentNode && Array.isArray(currentNode.children_ids) && currentNode.children_ids.length > 0) {
          const choice = await this._showBranchChoice();
          if (choice === 'branch') {
            timelineSystem._pendingBranchFrom = currentId;
          } else if (choice === 'prune') {
            await timelineSystem.pruneForward(currentId);
            const node = await timelineSystem.getCurrentNode();
            const history = await timelineSystem._reconstructChatHistory(node);
            this.pipeline?.setHistory(history);
            appShell.renderSinglePage(node?.clean_response || node?.ai_response_summary || '时间线已逆转。');
          } else {
            return;
          }
        }
      }

      try {
        if (this._pendingStartPrompt) {
          this._sendSystemMessage('正在重试生成开场剧情...');
          await this.pipeline.process(this._pendingStartPrompt);
          this._pendingStartPrompt = null;
        } else {
          await this.pipeline.process(text);
        }

        if (localStorage.getItem('naruto_auto_cloud_sync') === 'true') {
          try {
            const data = await timelineSystem.getExportData({ includeArchive: false });
            const preview = { 
              name: stateManager.get().player?.name || '未知',
              location: stateManager.get().world_state?.current_location || '未知',
              time: Date.now()
            };
            await cloudSave.quickSave('默认云存档', data, preview);
            console.log('[CloudSave] 自动同步成功');
          } catch (err) {
            console.error('[CloudSave] 自动同步失败', err);
          }
        }
      } catch (error) {
        if (this._pendingStartPrompt) {
          this._showStartupErrorModal(error);
        } else {
          console.error('[App] Pipeline process failed:', error);
        }
      }
    });

    eventBus.on('combat:player-action', ({ action }) => {
      if (this.pipeline?.isProcessing) return;
      const msg = this._buildCombatActionMessage(action);
      if (msg) eventBus.emit('user:input', msg);
    });

    eventBus.on('pipeline:cancel', () => {
      this.pipeline?.cancel();
    });

    eventBus.on('timeline:reroll-request', async ({ nodeId }) => {
      try {
        const node = await stateManager.dbGet('timeline_nodes', nodeId);
        if (!node) return;
        const parentId = node.parent_id;
        if (!parentId) {
          this._sendSystemMessage('初始节点无法快速重推衍，如需重新开局请点击底部重置按钮。');
          return;
        }
        if (!node.player_input) {
          this._sendSystemMessage('该节点缺少玩家输入，无法重推衍。');
          return;
        }

        const choice = await this._showRerollChoice();
        if (choice === 'cancel') return;

        await timelineSystem.jumpToNode(parentId);

        if (choice === 'prune') {
          await timelineSystem.pruneForward(parentId);
          timelineSystem._pendingBranchFrom = null;
        } else {
          timelineSystem._pendingBranchFrom = parentId;
        }

        const parentNode = await timelineSystem.getCurrentNode();
        const history = await timelineSystem._reconstructChatHistory(parentNode);
        this.pipeline?.setHistory(history);

        const actionLabel = choice === 'prune' ? '重新推衍' : '平行重推衍';
        this._sendSystemMessage(`正在${actionLabel}：${node.player_input}`);
        await this.pipeline.process(node.player_input);
      } catch (error) {
        console.error('[App] Reroll failed:', error);
        this._sendSystemMessage(`重推衍失败: ${error.message}`);
      }
    });

    eventBus.on('timeline:jump-request', async ({ nodeId }) => {
      const allNodes = await stateManager.dbGetAll('timeline_nodes') || [];
      const countDescendants = (nid) => {
        let count = 0;
        const node = allNodes.find(n => n.id === nid);
        if (node && Array.isArray(node.children_ids)) {
          for (const childId of node.children_ids) {
            count += 1 + countDescendants(childId);
          }
        }
        return count;
      };
      const prunedCount = countDescendants(nodeId);

      let warningMessage = '逆转时间将永久删除此节点之后的所有回合，该操作无法撤销。确定继续？';
      if (prunedCount > 0) {
        const turnLabel = prunedCount === 1 ? '个回合' : '个回合';
        warningMessage = `逆转时间至此将永久删除后续 ${prunedCount} ${turnLabel}的记录。此操作不可撤销，被删除的内容无法恢复。确定继续？`;
      }

      const confirmed = await customElements.get('game-modal').confirm({
        title: '⚠ 逆转时间 · 不可撤销',
        message: warningMessage,
        okLabel: '确认删除',
        cancelLabel: '取消'
      });
      if (confirmed) {
        try {
          const result = await timelineSystem.pruneForward(nodeId);
          const node = await timelineSystem.getCurrentNode();
          const history = await timelineSystem._reconstructChatHistory(node);
          this.pipeline?.setHistory(history);
          const pruned = result?.pruned || 0;
          appShell.renderSinglePage(node?.clean_response || node?.ai_response_summary || '时间线已逆转，后续记录已被清除。');
          this._sendSystemMessage(pruned > 0
            ? `时间线已逆转。已删除 ${pruned} 个后续回合，当前回合计为终末。`
            : '已回到当前回合。');
        } catch (error) {
          this._sendSystemMessage(`逆转失败: ${error.message}`);
        }
      }
    });

    eventBus.on('timeline:view-node', async ({ node }) => {
      if (node) {
        if (node.state_snapshot) {
          stateManager.restore(node.state_snapshot);
        } else {
          try {
            await timelineSystem._replayStateFromAncestor(node);
          } catch (err) {
            this._sendSystemMessage(err.message);
            return;
          }
        }
        const meta = stateManager.getSub('_meta');
        meta.current_node_id = node.id;
        meta.active_branch = node.branch_id || 'branch_main';
        stateManager.setSub('_meta', meta);
        const history = await timelineSystem._reconstructChatHistory(node);
        this.pipeline?.setHistory(history);
        appShell.renderSinglePage(node.clean_response || node.ai_response_summary || '此处记忆残缺...');
      }
    });

    eventBus.on('timeline:export-request', async () => {
      try {
        await timelineSystem.exportTimeline();
      } catch (e) {
        this._sendSystemMessage('导出失败');
      }
    });

    eventBus.on('game:restart', async () => {
      const confirmed = await customElements.get('game-modal').confirm({
        title: '⚠ 重新开始 · 不可撤销',
        message: '确定要放弃当前的忍道并重新开始吗？所有存档和时间线将被永久抹除，此操作无法恢复。',
        okLabel: '确认重置',
        cancelLabel: '取消'
      });
      if (!confirmed) return;
      await timelineSystem.emergencyReset();
      localStorage.removeItem('naruto_ui_prefs');
      localStorage.removeItem('naruto_rpg_state');
      window.location.reload();
    });

    eventBus.on('app:reset', async () => {
      try {
        await timelineSystem.emergencyReset();
        this.pipeline?.clearHistory();
        appShell.element.innerHTML = '';
        appShell.element.classList.add('app-shell--setup');
        const center = appShell.element.querySelector('#app-center');
        if (center) {
          center.classList.add('app-center--setup');
          const inputArea = center.querySelector('#chat-input-area');
          if (inputArea) inputArea.style.display = 'none';
        }
        appShell.showCharacterCreator();
      } catch (err) {
        window.location.reload();
      }
    });

    eventBus.on('timeline:delete-branch', async ({ branchId }) => {
      if(branchId === 'branch_main') {
         await customElements.get('game-modal').alert({ title: '无法斩断', message: '主线不可斩断！' });
         return;
      }
      const confirmed = await customElements.get('game-modal').confirm({
        title: '剪除分支',
        message: '确定要剪除这条时间分支吗？该分支上的所有记忆将不复存在，此操作不可撤销。',
        okLabel: '确认剪除',
        cancelLabel: '取消'
      });
      if (!confirmed) return;
      try {
        await timelineSystem.deleteBranch(branchId);
        appShell.renderSinglePage('时间线剪定完成。');
      } catch(e) {
        this._sendSystemMessage('剪定失败: ' + e.message);
      }
    });

    eventBus.on('timeline:promote-branch', async ({ branchId }) => {
      if(branchId === 'branch_main') return;
      const confirmed = await customElements.get('game-modal').confirm({
        title: '升格为主线',
        message: '确定要将此IF线升格为主线吗？原主线分支将会降格为IF线。',
        okLabel: '确认升格',
        cancelLabel: '取消'
      });
      if (!confirmed) return;
      try {
        await timelineSystem.promoteBranchToMain(branchId);
        appShell.renderSinglePage('时间线收束完成，新的主线已确立。');
      } catch(e) {
        this._sendSystemMessage('收束失败: ' + e.message);
      }
    });

    eventBus.on('app:open-settings', () => {
      const panel = new SettingsPanel();
      (document.getElementById('app') || document.body).appendChild(panel);
    });

    eventBus.on('app:open-profile', () => {
      this._openProfilePanel();
    });

    eventBus.on('app:open-api-settings', () => {
      this._openApiSettings();
    });
  }

  async _checkSavedGame() {
    const meta = await stateManager.dbGet('timeline_meta', 'root');
    if (meta?.value?.current_id) {
      const currentNode = await stateManager.dbGet('timeline_nodes', meta.value.current_id);
      if (currentNode) {
        try {
          if (currentNode.state_snapshot) {
            stateManager.restore(currentNode.state_snapshot);
          } else {
            await timelineSystem._replayStateFromAncestor(currentNode);
          }
          const history = await timelineSystem._reconstructChatHistory(currentNode);
          this.pipeline?.setHistory(history);
          const metaObj = stateManager.getSub('_meta');
          metaObj.current_node_id = meta.value.current_id;
          stateManager.setSub('_meta', metaObj);
          appShell.showGame();
          if (currentNode.clean_response) {
            appShell.renderSinglePage(currentNode.clean_response);
          }
          this._sendSystemMessage('欢迎回来！已恢复上次冒险。');
          return;
        } catch (err) {
          console.error('[NarutoRPG] Restore saved game failed:', err);
          // 恢复过程出错，但仍然显示游戏界面，让用户能看到存档内容
          // 而不是悄无声息地回退到角色创建界面
          appShell.showGame();
          appShell.renderSinglePage(currentNode.clean_response || currentNode.ai_response_summary || '存档数据存在但恢复过程遇到问题。\n\n请尝试：\n1. 刷新页面重试\n2. 从时间线中选择其他节点\n3. 导出存档后重新导入');
          this._sendSystemMessage(`存档恢复异常: ${err.message}。部分状态可能未能完全恢复，建议检查角色面板。`);
          const metaObj = stateManager.getSub('_meta');
          metaObj.current_node_id = meta.value.current_id;
          stateManager.setSub('_meta', metaObj);
          return;
        }
      } else {
        console.warn('[NarutoRPG] Save game node not found in timeline_nodes.');
        // 元数据存在但节点丢失：尝试查找任意可用的节点
        const allNodes = await stateManager.dbGetAll('timeline_nodes');
        if (allNodes && allNodes.length > 0) {
          console.log('[NarutoRPG] Attempting recovery using fallback node...');
          const fallbackNode = allNodes.sort((a, b) => (b.turn_number || 0) - (a.turn_number || 0))[0];
          try {
            if (fallbackNode.state_snapshot) {
              stateManager.restore(fallbackNode.state_snapshot);
            }
            const history = await timelineSystem._reconstructChatHistory(fallbackNode);
            this.pipeline?.setHistory(history);
            const mObj = stateManager.getSub('_meta');
            mObj.current_node_id = fallbackNode.id;
            stateManager.setSub('_meta', mObj);
            // 更新 meta 以指向这个恢复节点
            meta.value.current_id = fallbackNode.id;
            await stateManager.dbPut('timeline_meta', meta);
            appShell.showGame();
            appShell.renderSinglePage(fallbackNode.clean_response || fallbackNode.ai_response_summary || '已恢复到最近的存档节点。');
            this._sendSystemMessage('元数据丢失，已自动恢复到最近的存档节点。');
            return;
          } catch (e) {
            console.error('[NarutoRPG] Fallback recovery also failed:', e.message);
          }
        }
      }
    } else {
      console.log('[NarutoRPG] No saved game metadata found.');
    }
    console.log('[NarutoRPG] Showing character creator.');
    appShell.showCharacterCreator();
  }

  _sendSystemMessage(text) {
    appShell.addSystemMessage?.(text);
  }

  _registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

    navigator.serviceWorker.register('./sw.js').then((registration) => {
      // 检测 SW 更新，发现新版本时立即应用
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 新 SW 已就绪，通知用户刷新
            console.log('[SW] New version available, reloading...');
            window.location.reload();
          }
        });
      });
    }).catch((error) => {
      console.warn('[NarutoRPG] Service worker registration failed:', error.message);
    });
  }

  _showStartupErrorModal(error) {
    const Modal = customElements.get('game-modal');
    if (!Modal) return;
    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);
    modal.show({
      title: '结印失败',
      content: `
        <div style="padding: 16px 24px; color: var(--text-secondary); line-height: 1.8; font-size: 14px; text-align: center;">
          <div style="font-size: 32px; margin-bottom: 16px; opacity: 0.8; filter: grayscale(1);">🥀</div>
          <div style="color: var(--c-kokihi); font-family: var(--font-title); letter-spacing: 2px; margin-bottom: 12px; font-size: 16px;">开场剧情生成失败</div>
          <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; border: 1px dashed rgba(255,255,255,0.08); font-family: monospace; font-size: 12px; margin-bottom: 24px; color: var(--text-tertiary); word-break: break-all;">${String(error?.message || error).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div style="color: var(--text-primary);">请检查 API 节点是否连通，或模型配置是否正确。</div>
        </div>
      `,
      buttons: [
        {
          label: '⚙️ 调整阵眼 (API设置)',
          primary: false,
          close: true,
          onClick: () => {
            setTimeout(() => this._openApiSettings(), 100);
          }
        },
        {
          label: '🗡️ 再次结印 (重试)',
          primary: true,
          close: true,
          onClick: () => {
            setTimeout(() => eventBus.emit('user:input', '重试结印'), 100);
          }
        },
        {
          label: '↻ 轮回转生 (重新开始)',
          primary: false,
          close: true,
          onClick: () => window.location.reload()
        }
      ]
    });
  }

  _openProfilePanel() {
    const Modal = customElements.get('game-modal');
    if (!Modal) return;
    const state = stateManager.get();
    const player = state.player || {};
    const attrs = state.attributes || {};
    const prog = state.progression || {};
    const world = state.world_state || {};
    const apiConfig = stateManager.getAPIConfig() || {};
    let autoSync = localStorage.getItem('naruto_auto_cloud_sync') === 'true';

    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);
    modal.show({
      title: '个人中心 · 忍道卷轴',
      content: `
        <div style="display:flex;flex-direction:column;gap:20px;padding:8px 0;">
          <div style="text-align:center;padding:16px;background:rgba(198,156,109,0.06);border:1px solid rgba(198,156,109,0.15);border-radius:12px;">
            <div style="width:64px;height:64px;border-radius:50%;background:rgba(235,97,63,0.15);border:2px solid rgba(235,97,63,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:24px;color:var(--c-shuiro);">忍</div>
            <div style="font-family:var(--font-title);font-size:18px;font-weight:700;color:#e8e4d9;letter-spacing:2px;">${this._escAttr(player.name || '未创建角色')}</div>
            <div style="font-size:12px;color:#a39f98;margin-top:4px;">${this._escAttr(player.rank || '-')} · ${this._escAttr(player.official_rank || '-')}</div>
            <div style="font-size:11px;color:rgba(198,156,109,0.7);margin-top:6px;">${this._escAttr(world.current_location || '-')} · ${this._escAttr(world.calendar || '-')}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">
              <div style="font-size:10px;color:var(--c-kin);letter-spacing:1px;margin-bottom:6px;">查克拉</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:#e8e4d9;">${attrs.chakra_current || 0}/${attrs.chakra || 0}</div>
            </div>
            <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">
              <div style="font-size:10px;color:#ef5350;letter-spacing:1px;margin-bottom:6px;">体力</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:#e8e4d9;">${attrs.stamina_current || 0}/${attrs.stamina || 0}</div>
            </div>
            <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">
              <div style="font-size:10px;color:#ab47bc;letter-spacing:1px;margin-bottom:6px;">精神力</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:#e8e4d9;">${attrs.spirit_current || 0}/${attrs.spirit || 0}</div>
            </div>
            <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;">
              <div style="font-size:10px;color:var(--c-kin);letter-spacing:1px;margin-bottom:6px;">金钱</div>
              <div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:#e8e4d9;">${prog.ryo || state['进度·金钱'] || 0}両</div>
            </div>
          </div>
          <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div style="font-size:12px;color:#e8e4d9;font-weight:600;letter-spacing:1px;">云存档与同步</div>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" id="cb-auto-sync" ${autoSync ? 'checked' : ''} style="accent-color:var(--c-shuiro);">
                <span style="font-size:11px;color:#a39f98;">开启自动云同步</span>
              </label>
            </div>
            
            <div style="margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:4px;color:#a39f98;" id="cloud-size-text">
                <span>云端容量 (最高 200MB)</span>
                <span>加载中...</span>
              </div>
              <div style="width:100%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
                <div id="cloud-size-bar" style="width:0%;height:100%;background:var(--c-kin);transition:width 0.3s ease;"></div>
              </div>
              <div id="cloud-size-warning" style="font-size:10px;color:#ef5350;margin-top:4px;display:none;">容量即将耗尽，请及时清理或精简冗余记忆。</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
              <button class="btn btn-sm btn-primary" id="btn-cloud-upload" type="button" style="font-size:11px;background:rgba(198,156,109,0.15);border-color:rgba(198,156,109,0.3);color:var(--c-kin);">↑ 上传/覆盖</button>
              <button class="btn btn-sm btn-secondary" id="btn-cloud-download" type="button" style="font-size:11px;">↓ 恢复</button>
              <button class="btn btn-sm btn-secondary" id="btn-cloud-delete" type="button" style="font-size:11px;color:#ef5350;display:none;">× 删除</button>
            </div>

            <div style="height:1px;background:rgba(255,255,255,0.05);margin:12px 0;"></div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <span style="font-size:10px;color:#a39f98;margin-right:4px;">本地管理:</span>
              <button class="btn btn-sm btn-secondary" id="btn-export-save" type="button" style="font-size:10px;padding:4px 8px;">导出</button>
              <button class="btn btn-sm btn-secondary" id="btn-import-cloud" type="button" style="font-size:10px;padding:4px 8px;">导入</button>
              <div style="margin-left:auto; display:flex; gap:6px;">
                <button class="btn btn-sm btn-secondary" id="btn-display-config" type="button" style="font-size:10px;padding:4px 8px;">🎨 视觉</button>
                <button class="btn btn-sm btn-secondary" id="btn-api-config" type="button" style="font-size:10px;padding:4px 8px;">API设置</button>
              </div>
            </div>
            
            <div style="margin-top:10px;font-size:10px;color:rgba(163,159,152,0.5);">
              ${apiConfig.model ? '已连接: ' + this._escAttr(apiConfig.model) : '未配置API连接'}
            </div>
          </div>
        </div>
      `,
      buttons: [
        { label: '关闭', primary: true, close: true }
      ]
    });

    setTimeout(() => {
      // Fetch cloud save size asynchronously
      cloudSave.listSaves().then(saves => {
        let sizeBytes = 0;
        let saveId = null;
        if (saves && saves.length > 0) {
          sizeBytes = saves[0].size_bytes || 0;
          saveId = saves[0].id;
        }
        const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
        const percent = Math.min(100, (sizeBytes / (200 * 1024 * 1024)) * 100);
        const isWarning = percent > 80;
        
        const root = modal.shadowRoot;
        if (!root) return;
        const txt = root.querySelector('#cloud-size-text');
        const bar = root.querySelector('#cloud-size-bar');
        const warn = root.querySelector('#cloud-size-warning');
        const delBtn = root.querySelector('#btn-cloud-delete');
        
        if (txt) {
          txt.children[1].textContent = `${sizeMb} MB / 200 MB`;
          if (isWarning) txt.style.color = '#ef5350';
        }
        if (bar) {
          bar.style.width = `${percent}%`;
          if (isWarning) bar.style.background = '#ef5350';
        }
        if (warn && isWarning) {
          warn.style.display = 'block';
        }
        if (delBtn && saveId) {
          delBtn.dataset.saveId = saveId;
          delBtn.style.display = 'inline-block';
        }
      }).catch(e => {
        const txt = modal.shadowRoot?.querySelector('#cloud-size-text');
        if (txt) txt.children[1].textContent = '获取失败';
      });

      modal.shadowRoot?.querySelector('#cb-auto-sync')?.addEventListener('change', (e) => {
        localStorage.setItem('naruto_auto_cloud_sync', e.target.checked);
        if (e.target.checked) this._sendSystemMessage('已开启自动云同步，将在剧情推进时自动保存。');
        else this._sendSystemMessage('已关闭自动云同步。');
      });

      modal.shadowRoot?.querySelector('#btn-cloud-upload')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try {
          if (btn) {
            btn.textContent = '上传中...';
            btn.disabled = true;
          }
          const data = await timelineSystem.getExportData({ includeArchive: false });
          const preview = { 
            name: stateManager.get().player?.name || '未知',
            location: stateManager.get().world_state?.current_location || '未知',
            time: Date.now()
          };
          await cloudSave.quickSave('默认云存档', data, preview);
          this._sendSystemMessage('云存档上传成功！');
          modal.close();
          this._openProfilePanel(); 
        } catch(err) {
          this._sendSystemMessage('上传失败: ' + err.message);
          if (btn) {
            btn.textContent = '↑ 上传/覆盖';
            btn.disabled = false;
          }
        }
      });

      modal.shadowRoot?.querySelector('#btn-cloud-download')?.addEventListener('click', async (e) => {
        if (!confirm('确定要从云端恢复存档吗？当前未保存的本地进度将会丢失！')) return;
        try {
          const saves = await cloudSave.listSaves();
          if (!saves || saves.length === 0) {
            return this._sendSystemMessage('未找到云端存档。');
          }
          this._sendSystemMessage('正在下载云存档...');
          const fullSave = await cloudSave.downloadSave(saves[0].id);
          const file = new File([JSON.stringify(fullSave.save_data)], 'cloud_save.json', { type: 'application/json' });
          eventBus.emit('app:timeline-import-file', { file });
          modal.close();
        } catch(e) {
          this._sendSystemMessage('恢复失败: ' + e.message);
        }
      });

      modal.shadowRoot?.querySelector('#btn-cloud-delete')?.addEventListener('click', async (e) => {
        const saveId = e.target.dataset.saveId;
        if (!saveId) return;
        if (!confirm('确定要彻底删除该云存档吗？此操作无法撤销。')) return;
        try {
          e.target.textContent = '删除中...';
          e.target.disabled = true;
          await cloudSave.deleteSave(saveId);
          this._sendSystemMessage('云存档已删除。您可以重新上传了。');
          modal.close();
          this._openProfilePanel();
        } catch(err) {
          this._sendSystemMessage('删除失败: ' + err.message);
          e.target.textContent = '× 删除';
          e.target.disabled = false;
        }
      });

      modal.shadowRoot?.querySelector('#btn-export-save')?.addEventListener('click', async () => {
        try { await timelineSystem.exportTimeline(); this._sendSystemMessage('本地存档已导出。'); }
        catch(e) { this._sendSystemMessage('导出失败: ' + e.message); }
      });
      modal.shadowRoot?.querySelector('#btn-import-cloud')?.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (e) => {
          const file = e.target.files?.[0];
          if (file) eventBus.emit('app:timeline-import-file', { file });
        };
        fileInput.click();
      });
      modal.shadowRoot?.querySelector('#btn-api-config')?.addEventListener('click', () => {
        modal.close();
        setTimeout(() => this._openApiSettings(), 100);
      });
      modal.shadowRoot?.querySelector('#btn-display-config')?.addEventListener('click', () => {
        modal.close();
        setTimeout(() => this._openDisplaySettings(), 100);
      });
    }, 150);
  }

  _openDisplaySettings() {
    const Modal = customElements.get('game-modal');
    if (!Modal) return;

    const config = stateManager.getDisplayConfig();
    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);
    modal.show({
      title: '视觉与外观设置',
      content: `
        <display-config-form config='${this._escAttr(JSON.stringify(config))}'></display-config-form>
      `,
      buttons: [
        { label: '取消', close: true },
        {
          label: '保存',
          primary: true,
          close: false,
          onClick: async () => {
            const form = modal.shadowRoot.querySelector('display-config-form');
            if (form) {
              const newConfig = form.getConfig();
              stateManager.saveDisplayConfig(newConfig);
              this._applyDisplayConfig(newConfig);
              this._sendSystemMessage('视觉设置已保存。');
            }
            modal.close();
            this._openProfilePanel();
          }
        }
      ]
    });
  }

  _applyDisplayConfig(config) {
    if (!config) return;
    let style = document.getElementById('dynamic-display-colors');
    if (!style) {
      style = document.createElement('style');
      style.id = 'dynamic-display-colors';
      document.head.appendChild(style);
    }
    const dHex = config.dialogueColor || '#bae6fd';
    const tHex = config.thoughtColor || '#c4b5fd';
    
    const hexToRgba = (hex, alpha) => {
      let c;
      if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
          c= hex.substring(1).split('');
          if(c.length== 3){
              c= [c[0], c[0], c[1], c[1], c[2], c[2]];
          }
          c= '0x'+c.join('');
          return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
      }
      return `rgba(255,255,255,${alpha})`;
    };

    style.textContent = `:root {
      --color-dialogue: ${dHex};
      --color-dialogue-shadow: ${hexToRgba(dHex, 0.3)};
      --color-thought: ${tHex};
      --color-thought-shadow: ${hexToRgba(tHex, 0.2)};
    }`;
  }

  _openApiSettings() {
    const Modal = customElements.get('game-modal');
    if (!Modal) return;

    const config = stateManager.getAPIConfig() || {};
    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);
    modal.show({
      title: 'API 设置',
      content: `
        <api-config-form config='${this._escAttr(JSON.stringify(config))}' show-advanced></api-config-form>
        <div style="color: #6e6a65; font-size: 11px; line-height: 1.6; margin-top: 14px; text-align: left;">API Key 仅保存在本机浏览器 localStorage。导出时间线会下载当前 IndexedDB 存档 JSON。</div>
        <div style="color: #eb613f; font-size: 11px; line-height: 1.6; margin-top: 6px; text-align: left;">重置存档会清空时间线和角色状态，但不会删除 API 配置。</div>
      `,
      buttons: [
        { label: '关闭' },
        {
          label: '导出时间线',
          close: false,
          onClick: async () => {
            try {
              await timelineSystem.exportTimeline();
              this._sendSystemMessage('时间线已导出。');
            } catch (error) {
              this._sendSystemMessage(`导出失败: ${error.message}`);
            }
          }
        },
        {
          label: '重置存档',
          close: false,
          onClick: async () => this._confirmEmergencyReset(modal)
        },
        {
          label: '保存配置',
          primary: true,
          close: false,
          onClick: async () => {
            const form = modal.shadowRoot.querySelector('api-config-form');
            const nextConfig = form ? form.getConfig() : null;
            if (!nextConfig) {
              this._sendSystemMessage('保存失败：请填写完整的 API 地址、Key 和模型名称。');
              return;
            }
            await stateManager.saveAPIConfig(nextConfig);
            aiClient.configure(nextConfig);
            modal.close();
            this._sendSystemMessage('API 配置已更新。');
          }
        }
      ]
    });
  }

  _escAttr(value) {
    return escAttr(value);
  }

  async _confirmEmergencyReset(settingsModal) {
    const confirmed = await customElements.get('game-modal').confirm({
      title: '重置全部存档',
      message: '这会清空当前角色、时间线节点和所有分支。API 配置会保留。确定继续？',
      okLabel: '确认重置',
      cancelLabel: '取消'
    });
    if (!confirmed) return;

    try {
      await timelineSystem.emergencyReset();
      this.pipeline?.clearHistory();
      settingsModal?.close();
      appShell.showCharacterCreator();
      this._sendSystemMessage('存档已重置，请重新创建角色。');
    } catch (error) {
      this._sendSystemMessage(`重置失败: ${error.message}`);
    }
  }

  async _showBranchChoice() {
    return new Promise(resolve => {
      const modal = document.createElement('game-modal');
      (document.getElementById('app') || document.body).appendChild(modal);
      modal.show({
        title: '时间线分叉',
        content: `<p>当前回合已有后续剧情。<br/>请选择你希望如何处理：</p>`,
        buttons: [
          { label: '取消', onClick: () => resolve('cancel') },
          { label: '回退并删除后续', onClick: () => resolve('prune') },
          { label: '创建新的IF线', primary: true, onClick: () => resolve('branch') }
        ]
      });
    });
  }

  async _showRerollChoice() {
    return new Promise(resolve => {
      const modal = document.createElement('game-modal');
      (document.getElementById('app') || document.body).appendChild(modal);
      modal.show({
        title: '平行推衍',
        content: `<p>你选择重新推衍本回合。<br/>请选择如何处理当前回合的剧情：</p>`,
        buttons: [
          { label: '取消', onClick: () => resolve('cancel') },
          { label: '不保存本回', primary: true, onClick: () => resolve('prune') },
          { label: '保存为IF线', onClick: () => resolve('branch') }
        ]
      });
    });
  }

  async _showImportModeChoice(existingCount) {
    return new Promise(resolve => {
      const modal = document.createElement('game-modal');
      (document.getElementById('app') || document.body).appendChild(modal);
      modal.show({
        title: '导入时间线存档',
        content: `<p>当前已有 ${existingCount} 个回合的游戏进度。请选择导入方式:</p>
                  <p style="font-size:11px;color:#a39f98;margin-top:8px;">
                    <strong>覆盖</strong>:清空当前进度,用导入存档完全替换(不可撤销)<br/>
                    <strong>合并</strong>:保留当前进度,把导入的节点作为新分支追加(可在时间线导航器中切换)
                  </p>`,
        buttons: [
          { label: '取消', onClick: () => resolve('cancel') },
          { label: '合并(追加分支)', onClick: () => resolve('merge') },
          { label: '覆盖(替换)', primary: true, onClick: () => resolve('overwrite') }
        ]
      });
    });
  }
  _buildCombatActionMessage(action) {
    switch (action) {
      case '体术攻击': return '我使用体术向敌人发起近身攻击！';
      case '忍术攻击': return '我准备使用忍术攻击敌人。';
      case '使用道具': return '我从忍具袋中取出道具。';
      case '防御': return '我摆出防御态势，准备格挡下一次攻击。';
      case '撤退': return '我决定暂时撤退，寻找有利时机。';
      default: return `我选择: ${action}`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new NarutoRPGApp();
  app.init().catch(err => {
    console.error('[NarutoRPG] Fatal error:', err);
    const container = document.getElementById('app');
    if (container) {
      container.innerHTML = `<div style="padding:40px;color:#e8e4d9;font-family:serif;text-align:center;">
        <h2 style="letter-spacing:4px;">忍者手记</h2>
        <p style="color:#eb613f;margin-top:16px;">初始化失败: ${err.message}</p>
        <p style="color:#a39f98;font-size:12px;margin-top:8px;">请检查浏览器控制台获取详细信息</p>
      </div>`;
    }
  });
});

export { NarutoRPGApp };
export default NarutoRPGApp;
