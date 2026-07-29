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
import { authClient } from './core/auth-client.js';
import { worldStateSystem } from './systems/world-state-system.js';
import { errorHandler } from './utils/error-handler.js';
import { loadingIndicator } from './utils/loading-indicator.js';
import { swNotifier } from './utils/sw-notifier.js';
import { helpGuide } from './utils/help-guide.js';
import { resolveOpeningContract } from './systems/opening-contract.js';
import { buildOpeningPrompt } from './systems/opening-prompt.js';
import { migrateStorage } from './core/storage-migrations.js';
import { imageFeatureIntegration } from './core/image-studio/integration.js';
import { resolveAICallPolicy } from './core/ai-call-policy.js';
import { TIMELINE_FILE_ACCEPT, decodeTimelineSaveFile } from './core/timeline-file-codec.js';

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
import './ui/image-studio.js';
import SettingsPanel, { applyLocalSettings } from './ui/settings-panel.js';

class NarutoRPGApp {
  constructor() {
    this.pipeline = null;
    this._state = 'init';
    this._settingsTransition = Promise.resolve();
  }

  async init() {
    migrateStorage();

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

    try {
      await imageFeatureIntegration.init();
    } catch (error) {
      console.warn('[NarutoRPG] Image Studio init failed; narrative remains available:', error.message);
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
        const data = await decodeTimelineSaveFile(file);

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
          appShell.restoreChatHistory(
            history,
            node?.clean_response || node?.ai_response_summary || '存档已导入。',
            { timelineNodeId: node?.id || null }
          );
          this._sendSystemMessage('时间线存档导入成功(覆盖模式)。');
        }
      } catch (error) {
        this._sendSystemMessage(`导入失败: ${error.message}`);
      }
    });

    eventBus.on('character:created', async (payload = {}) => {
      appShell.showGame();
      this._sendSystemMessage('角色创建完成！正在生成开场剧情...');

      try {
        const state = stateManager.get();
        const contract = state._opening_contract || payload.contract || resolveOpeningContract(state);
        stateManager.update([{ key: '系统·回合数', op: '=', value: 1 }]);
        const apiCfg = stateManager.getAPIConfig() || {};
        const updaterEnabled = resolveAICallPolicy({ apiConfig: apiCfg }).features.variableUpdater;
        const startPrompt = buildOpeningPrompt({ state, contract, updaterEnabled });
        this._pendingStartPrompt = startPrompt;
        await this.pipeline.process(startPrompt);
        this._pendingStartPrompt = null;
      } catch (error) {
        this._showStartupErrorModal(error);
      }
    });

    eventBus.on('user:submit', ({ text, accept }) => this._handleUserInput(text, accept));
    eventBus.on('user:input', (text) => this._handleUserInput(text));

    eventBus.on('combat:player-action', ({ action }) => {
      if (this.pipeline?.isProcessing) return;
      const msg = this._buildCombatActionMessage(action);
      if (msg) eventBus.emit('user:input', msg);
    });

    eventBus.on('pipeline:cancel', () => {
      this.pipeline?.cancel();
    });

    eventBus.on('image:binding-changed', () => {
      if (localStorage.getItem('naruto_auto_cloud_sync') !== 'true') return;
      clearTimeout(this._imageCloudSyncTimer);
      this._imageCloudSyncTimer = setTimeout(() => {
        void this._syncCloudSaveAfterImage().catch(error => {
          console.warn('[CloudSave] 图片绑定后的二次同步失败:', error.message);
        });
      }, 800);
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
          appShell.renderSinglePage(node?.clean_response || node?.ai_response_summary || '时间线已逆转，后续记录已被清除。', { timelineNodeId: node?.id });
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
        appShell.renderSinglePage(node.clean_response || node.ai_response_summary || '此处记忆残缺...', { timelineNodeId: node.id });
      }
    });

    eventBus.on('timeline:export-request', async ({ compression = 'auto' } = {}) => {
      try {
        const result = await timelineSystem.exportTimeline({ compression });
        this._sendSystemMessage(result.fallbackReason
          ? `浏览器未能创建 gzip，已改为导出普通 JSON：${result.fallbackReason}`
          : `本地存档已导出（${result.format === 'gzip' ? 'gzip 压缩' : '普通 JSON'}）。`);
      } catch (e) {
        this._sendSystemMessage(`导出失败: ${e.message}`);
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

    eventBus.on('app:open-settings', (options = {}) => {
      const route = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
      return this._openSettings({
        mode: 'player',
        section: typeof route.section === 'string' && route.section ? route.section : 'appearance',
        anchor: typeof route.anchor === 'string' ? route.anchor : ''
      });
    });

    eventBus.on('app:open-creator-workbench', (options = {}) => {
      const route = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
      return this._openSettings({
        mode: 'creator',
        tool: typeof route.tool === 'string' ? route.tool : '',
        resourceId: typeof route.resourceId === 'string' ? route.resourceId : ''
      });
    });

    eventBus.on('app:open-profile', () => {
      this._openProfilePanel();
    });

    eventBus.on('app:open-api-settings', () => this._openSettings({ mode: 'player', section: 'connection' }));
  }

  async _handleUserInput(text, accept = null) {
    if (!this.pipeline || !aiClient.isConfigured()) {
      this._sendSystemMessage('请先配置 API 连接。');
      return false;
    }
    if (this.pipeline.isProcessing) {
      this._sendSystemMessage('上一道结印尚未完成，请稍候。');
      return false;
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
          appShell.renderSinglePage(node?.clean_response || node?.ai_response_summary || '时间线已逆转。', { timelineNodeId: node?.id });
        } else {
          return false;
        }
      }
    }

    accept?.();
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
          await this._queueCloudSave();
          console.log('[CloudSave] 自动同步成功');
        } catch (err) {
          console.error('[CloudSave] 自动同步失败', err);
        }
      }
    } catch (error) {
      if (this._pendingStartPrompt) this._showStartupErrorModal(error);
      else console.error('[App] Pipeline process failed:', error);
    }
    return true;
  }

  async _syncCloudSaveAfterImage() {
    return this._queueCloudSave();
  }

  async _queueCloudSave() {
    return cloudSave.scheduleQuickSave('默认云存档', async () => {
      const data = await timelineSystem.getExportData({ includeArchive: false });
      const state = stateManager.get();
      return {
        saveData: data,
        previewData: {
          name: state.player?.name || stateManager.get('玩家·姓名') || '未知',
          location: state.world_state?.current_location || stateManager.get('世界·地点') || '未知',
          time: Date.now()
        }
      };
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
            appShell.renderSinglePage(currentNode.clean_response, { timelineNodeId: currentNode.id });
          }
          this._sendSystemMessage('欢迎回来！已恢复上次冒险。');
          return;
        } catch (err) {
          console.error('[NarutoRPG] Restore saved game failed:', err);
          // 恢复过程出错，但仍然显示游戏界面，让用户能看到存档内容
          // 而不是悄无声息地回退到角色创建界面
          appShell.showGame();
          appShell.renderSinglePage(currentNode.clean_response || currentNode.ai_response_summary || '存档数据存在但恢复过程遇到问题。\n\n请尝试：\n1. 刷新页面重试\n2. 从时间线中选择其他节点\n3. 导出存档后重新导入', { timelineNodeId: currentNode.id });
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
            if (!fallbackNode.state_snapshot) throw new Error('备用节点缺少完整状态快照');
            stateManager.restore(fallbackNode.state_snapshot);
            const history = await timelineSystem._reconstructChatHistory(fallbackNode);
            this.pipeline?.setHistory(history);
            const mObj = stateManager.getSub('_meta');
            mObj.current_node_id = fallbackNode.id;
            stateManager.setSub('_meta', mObj);
            // 更新 meta 以指向这个恢复节点
            meta.value.current_id = fallbackNode.id;
            await stateManager.dbPut('timeline_meta', meta);
            appShell.showGame();
            appShell.renderSinglePage(fallbackNode.clean_response || fallbackNode.ai_response_summary || '已恢复到最近的存档节点。', { timelineNodeId: fallbackNode.id });
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

    // 四维百分比（纯展示计算）
    const pctOf = (cur, max) => {
      const c = Number(cur) || 0;
      const m = Number(max) || 0;
      return m > 0 ? Math.min(100, Math.round((c / m) * 100)) : 0;
    };
    const chakraPct = pctOf(attrs.chakra_current, attrs.chakra);
    const vitalityPct = pctOf(attrs.vitality_current, attrs.vitality);
    const staminaPct = pctOf(attrs.stamina_current, attrs.stamina);
    const spiritPct = pctOf(attrs.spirit_current, attrs.spirit);

    const modal = new Modal();
    (document.getElementById('app') || document.body).appendChild(modal);
    modal.show({
      title: '个人中心 · 忍道卷轴',
      content: `
        <style>
          /* ── 忍道卷轴 · 作用域样式（Shadow DOM 内生效；全部 token 化，随主题切换） ── */
          .pf { display: flex; flex-direction: column; gap: 22px; padding: 4px 0 2px; }
          .pf-sec { animation: pf-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
          @keyframes pf-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

          /* 节标题：金色小字 + 右侧渐隐线（面板 sec-title 语言） */
          .pf-sec-title {
            display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
            font-size: 10px; font-weight: 700; letter-spacing: 4px;
            font-family: var(--font-title, serif); color: var(--c-kin);
          }
          .pf-sec-title::after {
            content: ''; flex: 1; height: 1px;
            background: linear-gradient(to right, rgba(var(--paper-rgb), 0.08), transparent);
          }

          /* ── 卷首 · 身份 ── */
          .pf-hero {
            text-align: center; padding: 22px 18px 18px; position: relative; overflow: hidden;
            background: radial-gradient(circle at 50% 0%, rgba(198,156,109,0.09), transparent 60%), rgba(var(--paper-rgb), 0.02);
            background: radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--c-kin) 10%, transparent), transparent 60%), rgba(var(--paper-rgb), 0.02);
            border: 1px solid rgba(var(--paper-rgb), 0.06);
            border-radius: 14px;
          }
          .pf-hero::before {
            content: ''; position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
            background: linear-gradient(to right, transparent, rgba(var(--paper-rgb), 0.15), transparent);
          }
          .pf-avatar-ring { position: relative; width: 72px; height: 72px; margin: 0 auto 14px; }
          .pf-avatar-ring::before {
            content: ''; position: absolute; inset: -4px; border-radius: 50%;
            background: conic-gradient(from 0deg,
              transparent 0%, var(--c-shuiro) 14%, transparent 30%,
              transparent 55%, var(--c-kin) 70%, transparent 86%);
            animation: pf-spin 8s linear infinite;
          }
          .pf-avatar-ring::after {
            content: ''; position: absolute; inset: -1px; border-radius: 50%;
            border: 1px solid rgba(var(--paper-rgb), 0.1); pointer-events: none;
          }
          @keyframes pf-spin { to { transform: rotate(360deg); } }
          .pf-avatar {
            position: absolute; inset: 2px; border-radius: 50%; overflow: hidden;
            background: rgba(var(--ink-deep-rgb), 0.85);
            display: flex; align-items: center; justify-content: center;
          }
          .pf-avatar-char { font-family: var(--font-brush, cursive); font-size: 28px; color: var(--c-shuiro); }
          .pf-avatar-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
          .pf-name {
            font-family: var(--font-brush, cursive); font-size: 26px; letter-spacing: 3px; line-height: 1.25;
            background: linear-gradient(90deg, var(--c-kin-bright) 0%, #fff 50%, var(--c-kin-bright) 100%);
            background-size: 200% auto;
            -webkit-background-clip: text; background-clip: text;
            color: transparent; -webkit-text-fill-color: transparent;
            animation: pf-shine 5s linear infinite;
          }
          @keyframes pf-shine { to { background-position: 200% center; } }
          .pf-rank { margin-top: 7px; font-size: 12px; color: var(--text-secondary); letter-spacing: 2px; font-family: var(--font-title, serif); }
          .pf-loc { margin-top: 5px; font-size: 11px; letter-spacing: 1px; color: rgba(198,156,109,0.7); color: color-mix(in srgb, var(--c-kin) 70%, transparent); }

          /* ── 卷身 · 四维 ── */
          .pf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .pf-stat {
            position: relative; overflow: hidden; padding: 12px 14px;
            background: rgba(var(--paper-rgb), 0.02);
            border: 1px solid rgba(var(--paper-rgb), 0.06);
            border-radius: 10px;
            transition: background 0.2s ease;
          }
          .pf-stat::before {
            content: ''; position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
            background: linear-gradient(to right, transparent, rgba(var(--paper-rgb), 0.12), transparent);
          }
          .pf-stat:hover { background: rgba(var(--paper-rgb), 0.045); }
          .pf-stat-label { font-size: 10px; letter-spacing: 2px; margin-bottom: 5px; font-family: var(--font-title, serif); }
          .pf-stat-val { font-family: var(--font-mono, monospace); font-size: 16px; font-weight: 700; color: var(--text-primary); }
          .pf-stat-bar { margin-top: 8px; height: 2px; border-radius: 1px; background: rgba(var(--paper-rgb), 0.08); overflow: hidden; }
          .pf-stat-fill { height: 100%; border-radius: 1px; position: relative; box-shadow: 0 0 6px currentColor; transition: width 0.6s ease; }
          .pf-stat-fill::after {
            content: ''; position: absolute; inset: 0; pointer-events: none;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
            background-size: 200% 100%; background-repeat: no-repeat;
            animation: pf-sheen 3.2s linear infinite;
          }
          @keyframes pf-sheen { from { background-position: 150% 0; } to { background-position: -150% 0; } }

          /* ── 卷尾 · 云存档与本地管理 ── */
          .pf-cloud {
            padding: 14px; border-radius: 10px;
            background: rgba(var(--paper-rgb), 0.02);
            border: 1px solid rgba(var(--paper-rgb), 0.05);
          }
          .pf-cloud-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
          .pf-cloud-title { font-size: 12px; font-weight: 600; letter-spacing: 1px; color: var(--text-primary); font-family: var(--font-title, serif); }
          .pf-sync { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px; color: var(--text-secondary); }
          .pf-sync input { accent-color: var(--c-shuiro); }
          .pf-meter-text { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 5px; color: var(--text-secondary); }
          .pf-meter { height: 5px; border-radius: 3px; background: rgba(var(--paper-rgb), 0.08); overflow: hidden; }
          .pf-meter-fill { width: 0%; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--c-kin), var(--c-kin-bright)); transition: width 0.4s ease; }
          .pf-meter-warning { font-size: 10px; color: var(--c-quality-legendary); margin-top: 5px; display: none; }
          .pf-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px; }
          .pf-btn {
            padding: 7px 10px; font-size: 11px; border-radius: 6px; cursor: pointer; letter-spacing: 1px;
            border: 1px solid rgba(var(--paper-rgb), 0.12); background: rgba(var(--paper-rgb), 0.04);
            color: var(--text-primary); transition: all 0.15s ease; font-family: var(--font-title, serif);
          }
          .pf-btn:hover { border-color: rgba(var(--paper-rgb), 0.25); background: rgba(var(--paper-rgb), 0.08); }
          .pf-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .pf-btn-gold { border-color: rgba(198,156,109,0.35); background: rgba(198,156,109,0.12); color: var(--c-kin); }
          .pf-btn-gold:hover { border-color: rgba(198,156,109,0.6); background: rgba(198,156,109,0.18); }
          .pf-btn-danger { color: var(--c-quality-legendary); }
          .pf-btn-danger:hover { border-color: rgba(239,83,80,0.4); background: rgba(239,83,80,0.08); }
          .pf-divider { height: 1px; margin: 12px 0; background: rgba(var(--paper-rgb), 0.05); }
          .pf-local { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
          .pf-local-label { font-size: 10px; color: var(--text-tertiary); letter-spacing: 1px; }
          .pf-btn-sm { padding: 4px 10px; font-size: 10px; }
          .pf-local-right { margin-left: auto; display: flex; gap: 6px; }
          .pf-api-status { margin-top: 12px; font-size: 10px; color: var(--text-tertiary); display: flex; align-items: center; gap: 6px; letter-spacing: 0.5px; }
          .pf-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(var(--paper-rgb), 0.25); flex-shrink: 0; }
          .pf-dot.on { background: var(--c-moegi); box-shadow: 0 0 6px var(--c-moegi); }

          @media (prefers-reduced-motion: reduce), (max-width: 768px) {
            .pf-stat-fill::after, .pf-avatar-ring::before { animation: none; }
            .pf-name { animation: none; }
          }
        </style>

        <div class="pf">
          <!-- 卷首 · 身份 -->
          <section class="pf-hero pf-sec" style="animation-delay: 0ms;">
            <div class="pf-avatar-ring">
              <div class="pf-avatar" id="pf-avatar"><span class="pf-avatar-char">忍</span></div>
            </div>
            <div class="pf-name">${this._escAttr(player.name || '未创建角色')}</div>
            <div class="pf-rank">${this._escAttr(player.rank || '-')} · ${this._escAttr(player.official_rank || '-')}</div>
            <div class="pf-loc">${this._escAttr(world.current_location || '-')} · ${this._escAttr(world.calendar || '-')}</div>
          </section>

          <!-- 卷身 · 核心状态 -->
          <section class="pf-sec" style="animation-delay: 70ms;">
            <div class="pf-sec-title"><span>核心状态</span></div>
            <div class="pf-grid">
              <div class="pf-stat">
                <div class="pf-stat-label" style="color: var(--c-ruri);">查克拉</div>
                <div class="pf-stat-val">${attrs.chakra_current || 0}/${attrs.chakra || 0}</div>
                <div class="pf-stat-bar"><div class="pf-stat-fill" style="width: ${chakraPct}%; background: var(--c-ruri); color: var(--c-ruri);"></div></div>
              </div>
              <div class="pf-stat">
                <div class="pf-stat-label" style="color: #66BB6A;">生命力</div>
                <div class="pf-stat-val">${attrs.vitality_current || 0}/${attrs.vitality || 0}</div>
                <div class="pf-stat-bar"><div class="pf-stat-fill" style="width: ${vitalityPct}%; background: #66BB6A; color: #66BB6A;"></div></div>
              </div>
              <div class="pf-stat">
                <div class="pf-stat-label" style="color: var(--c-quality-legendary);">体力</div>
                <div class="pf-stat-val">${attrs.stamina_current || 0}/${attrs.stamina || 0}</div>
                <div class="pf-stat-bar"><div class="pf-stat-fill" style="width: ${staminaPct}%; background: var(--c-quality-legendary); color: var(--c-quality-legendary);"></div></div>
              </div>
              <div class="pf-stat">
                <div class="pf-stat-label" style="color: var(--c-spirit);">精神力</div>
                <div class="pf-stat-val">${attrs.spirit_current || 0}/${attrs.spirit || 0}</div>
                <div class="pf-stat-bar"><div class="pf-stat-fill" style="width: ${spiritPct}%; background: var(--c-spirit); color: var(--c-spirit);"></div></div>
              </div>
              <div class="pf-stat">
                <div class="pf-stat-label" style="color: var(--c-kin-bright);">金钱</div>
                <div class="pf-stat-val">${prog.ryo || state['进度·金钱'] || 0}両</div>
              </div>
            </div>
          </section>

          <!-- 卷尾 · 云存档与本地管理 -->
          <section class="pf-sec" style="animation-delay: 140ms;">
            <div class="pf-sec-title"><span>云存档与同步</span></div>
            <div class="pf-cloud">
              <div class="pf-cloud-head">
                <div class="pf-cloud-title">云端存档</div>
                <label class="pf-sync">
                  <input type="checkbox" id="cb-auto-sync" ${autoSync ? 'checked' : ''}>
                  <span>自动云同步</span>
                </label>
              </div>

              <div>
                <div class="pf-meter-text" id="cloud-size-text">
                  <span>云端容量 (最高 200MB)</span>
                  <span>加载中...</span>
                </div>
                <div class="pf-meter"><div class="pf-meter-fill" id="cloud-size-bar"></div></div>
                <div class="pf-meter-warning" id="cloud-size-warning">容量即将耗尽，请及时清理或精简冗余记忆。</div>
              </div>

              <div class="pf-actions">
                <button class="pf-btn pf-btn-gold" id="btn-cloud-upload" type="button">↑ 上传/覆盖</button>
                <button class="pf-btn" id="btn-cloud-download" type="button">↓ 恢复</button>
                <button class="pf-btn pf-btn-danger" id="btn-cloud-delete" type="button" style="display:none;">× 删除</button>
              </div>

              <div class="pf-divider"></div>

              <div class="pf-local">
                <span class="pf-local-label">游戏存档</span>
                <button class="pf-btn pf-btn-sm" id="btn-export-save" type="button">导出游戏存档</button>
                <button class="pf-btn pf-btn-sm" id="btn-import-cloud" type="button">导入游戏存档</button>
              </div>

              <div class="pf-api-status">
                <span class="pf-dot${apiConfig.model ? ' on' : ''}"></span>
                <span>${apiConfig.model ? '已连接 · ' + this._escAttr(apiConfig.model) : '未配置 API 连接'}</span>
              </div>
            </div>
          </section>
        </div>
      `,
      buttons: [
        { label: '关闭', primary: true, close: true }
      ]
    });

    setTimeout(() => {
      // Discord 头像异步填充（加载失败自动回退为「忍」字印）
      authClient.checkAuth().then(user => {
        const url = authClient.getAvatarUrl(user, 128);
        const av = modal.shadowRoot?.querySelector('#pf-avatar');
        if (url && av) {
          const img = document.createElement('img');
          img.className = 'pf-avatar-img';
          img.alt = '';
          img.decoding = 'async';
          img.onerror = () => img.remove();
          img.src = url;
          av.appendChild(img);
        }
      }).catch(() => {});

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
          await this._queueCloudSave();
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
          const file = await cloudSave.downloadSave(saves[0].id);
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
        try {
          const result = await timelineSystem.exportTimeline();
          this._sendSystemMessage(result.fallbackReason
            ? `浏览器未能创建 gzip，已改为导出普通 JSON：${result.fallbackReason}`
            : '本地压缩存档已导出。');
        }
        catch(e) { this._sendSystemMessage('导出失败: ' + e.message); }
      });
      modal.shadowRoot?.querySelector('#btn-import-cloud')?.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = TIMELINE_FILE_ACCEPT;
        fileInput.onchange = (e) => {
          const file = e.target.files?.[0];
          if (file) eventBus.emit('app:timeline-import-file', { file });
        };
        fileInput.click();
      });
    }, 150);
  }

  _openSettings(options = {}) {
    const request = options && typeof options === 'object' && !Array.isArray(options)
      ? { ...options }
      : {};
    request.mode = request.mode === 'creator' ? 'creator' : 'player';

    const transition = this._settingsTransition.then(() => this._performSettingsTransition(request));
    this._settingsTransition = transition.catch(() => null);
    return transition;
  }

  async _performSettingsTransition(options) {
    const mode = options.mode;
    const mount = document.getElementById('app') || document.body;

    while (true) {
      const current = mount.querySelector('settings-panel');
      if (!current) break;

      const currentMode = current.getAttribute('mode') === 'creator' ? 'creator' : 'player';
      if (currentMode === mode) {
        current.open(options);
        return current;
      }

      const closed = await current.close();
      if (!closed) return null;
      if (current.isConnected) current.remove();
    }

    const panel = new SettingsPanel();
    if (mode === 'creator') panel.setAttribute('mode', 'creator');
    mount.appendChild(panel);
    panel.open(options);
    return panel;
  }

  _openDisplaySettings() {
    return this._openSettings({ mode: 'player', section: 'appearance' });
  }

  _applyDisplayConfig(config) {
    let style = document.getElementById('dynamic-display-colors');
    const dHex = config?.dialogueColor;
    const tHex = config?.thoughtColor;
    // 用户未自定义时：移除注入，回退到主题预设注入的 --chat-dialogue-color / --chat-thought-color
    if (!dHex && !tHex) {
      if (style) style.remove();
      return;
    }
    if (!config) return;
    if (!style) {
      style = document.createElement('style');
      style.id = 'dynamic-display-colors';
      document.head.appendChild(style);
    }
    const dVal = dHex || '#bae6fd';
    const tVal = tHex || '#c4b5fd';
    
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
      --color-dialogue: ${dVal};
      --color-dialogue-shadow: ${hexToRgba(dVal, 0.3)};
      --color-thought: ${tVal};
      --color-thought-shadow: ${hexToRgba(tVal, 0.2)};
    }`;
  }

  _openApiSettings() {
    return this._openSettings({ mode: 'player', section: 'connection' });
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
