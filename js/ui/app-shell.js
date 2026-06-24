import { eventBus } from '../core/event-bus.js';
import { stateManager } from '../core/state-manager.js';
import { icon } from '../utils/icons.js';
import { escHtml, escAttr } from '../utils/format.js';

class AppShell {
  constructor() {
    this.element = null;
    this._streamingEl = null;
    this._isProcessing = false;
  }

  init(container) {
    this.element = document.createElement('div');
    this.element.className = 'app-shell';
    this.element.id = 'app-shell';
    container.appendChild(this.element);
    this._renderShell();
    this._bindEvents();
  }

  _renderShell() {
    this.element.innerHTML = `
      <header class="app-topbar">
        <div class="topbar-left">
          <span class="topbar-logo"><img src="https://i.postimg.cc/HxrmZwpz/file-000000001608720ba6b31150e6493597.png" class="logo-image-small" alt="忍者手记"></span>
        </div>
        <div class="topbar-right" aria-label="界面切换">
          <button class="topbar-btn topbar-btn--panel" id="btn-panel" title="角色面板" aria-pressed="true">${icon('panel')}<span class="topbar-btn-label">面板</span></button>
          <span class="topbar-divider"></span>
          <button class="topbar-btn topbar-btn--timeline" id="btn-timeline" title="时间线" aria-pressed="false">${icon('timeline')}<span class="topbar-btn-label">时间线</span></button>
          <span class="topbar-divider"></span>
          <button class="topbar-btn topbar-btn--mobile" id="btn-mobile" title="手机端预览" aria-pressed="false">${icon('mobile')}<span class="topbar-btn-label">手机</span></button>
          <span class="topbar-divider"></span>
          <button class="topbar-btn topbar-btn--zen" id="btn-zen" title="网页全屏 (隐藏地址栏)">${icon('zen')}<span class="topbar-btn-label">网页全屏</span></button>
          <span class="topbar-divider"></span>
          <button class="topbar-btn topbar-btn--fullscreen" id="btn-fullscreen" title="屏幕全屏 (极致沉浸)">${icon('fullscreen')}<span class="topbar-btn-label">屏幕全屏</span></button>
          <span class="topbar-divider"></span>
          <button class="topbar-btn topbar-btn--map" id="btn-map" title="忍界地图">${icon('map')}<span class="topbar-btn-label">地图</span></button>
          <span class="topbar-divider"></span>
          <button class="topbar-btn topbar-btn--settings" id="btn-settings" title="设置">${icon('settings')}<span class="topbar-btn-label">设置</span></button>
        </div>
      </header>

      <div class="app-main">
        <div class="mobile-scrim" id="mobile-scrim" aria-hidden="true"></div>
        <aside class="app-sidebar app-sidebar--collapsed" id="app-sidebar" aria-hidden="true">
          <timeline-navigator id="timeline-navigator"></timeline-navigator>
        </aside>
        <main class="app-center" id="app-center">
          <div class="chat-container">
            <div class="chat-messages" id="chat-messages"></div>
          </div>
          <div class="chat-input-area" id="chat-input-area" style="display:none;">
            <div class="input-wrapper">
              <textarea id="chat-input" placeholder="提笔写下你的决断..." rows="1" aria-label="输入行动"></textarea>
              <button id="btn-cancel">✕ 解印</button>
              <button id="btn-send">${icon('send', 16)}结印</button>
            </div>
          </div>
        </main>
        <aside class="app-panel" id="app-panel">
          <info-panel id="info-panel"></info-panel>
        </aside>
      </div>

      <footer class="app-statusbar">
        <span id="status-location">木叶隐村</span><span class="sep"></span>
        <span id="status-time">木叶四十八年</span><span class="sep"></span>
        <span id="status-weather">晴</span><span class="sep"></span>
        <span id="status-cache" title="缓存命中率" style="cursor:default;">--</span>
      </footer>
    `;

    const sendBtn = this.element.querySelector('#btn-send');
    sendBtn.addEventListener('click', () => this._sendMessage());

    const cancelBtn = this.element.querySelector('#btn-cancel');
    cancelBtn.addEventListener('click', () => eventBus.emit('pipeline:cancel'));

    const textarea = this.element.querySelector('#chat-input');
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    textarea.addEventListener('input', () => this._resizeInput());

    this.element.querySelector('#btn-panel').addEventListener('click', () => this._togglePanel());
    this.element.querySelector('#btn-timeline').addEventListener('click', () => this._toggleSidebar());
    this.element.querySelector('#btn-mobile').addEventListener('click', () => this._toggleMobileView());
    this.element.querySelector('#btn-zen').addEventListener('click', () => this._toggleZenMode());
    this.element.querySelector('#btn-fullscreen').addEventListener('click', () => this._toggleFullscreen());
    this.element.querySelector('#btn-map').addEventListener('click', () => {
      if (!document.querySelector('map-modal')) {
        (this.element ? (this.element.closest('#app') || document.body) : document.body).appendChild(document.createElement('map-modal'));
      }
    });
    this.element.querySelector('#btn-settings').addEventListener('click', () => {
      eventBus.emit('app:open-settings');
    });
    this.element.querySelector('#mobile-scrim')?.addEventListener('click', () => this._closeMobileDrawers());
    this.element.addEventListener('panel:close', () => this._closeMobileDrawers());

    this._bindGlobalShortcuts();

    this._syncResponsiveState();
    this._updateBranchIndicator();
    window.addEventListener('resize', () => this._debouncedResponsiveSync());

    // 监听浏览器全屏状态变化（用户按 ESC 退出时自动同步按钮状态）
    const onFsChange = () => {
      const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
      if (!isFs) {
        this.element.querySelector('#btn-fullscreen')?.setAttribute('aria-pressed', 'false');
        (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.remove('immersive-fullscreen');
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  _bindGlobalShortcuts() {
    if (this._shortcutsBound) return;
    this._shortcutsBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.isComposing || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const inEditable = tag === 'textarea' || tag === 'input' || e.target?.isContentEditable;
      if (e.key === 'Escape' && this._isProcessing) {
        e.preventDefault();
        eventBus.emit('pipeline:cancel');
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this._sendMessage();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !inEditable) {
        e.preventDefault();
        this._toggleSidebar();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !inEditable) {
        e.preventDefault();
        this._togglePanel();
      }
    });
  }

  _bindEvents() {
    this._turnUpdates = [];
    eventBus.on('state:batch-changed', (e) => {
      if (e.updates && e.updates.length) this._turnUpdates.push(...e.updates);
    });
    eventBus.on('user:input', (action) => {
      this._turnUpdates = [];
    });

    // 监听全局点击，利用事件委托处理行动选项 (Innovation)
    this.element.addEventListener('click', (e) => {
      const btn = e.target.closest('.action-option');
      if (btn && !this._isProcessing) {
        const action = btn.dataset.action;
        if (action) {
          this._addUserMessage(action);
          eventBus.emit('user:input', action);
        }
      }
    });

    eventBus.on('pipeline:processing', () => {
      this._setProcessing(true);
      if (getAgentConfig().enabled) {
        this._showAgentProgress();
      }
    });

    eventBus.on('pipeline:chunk', ({ response }) => {
      this._updateStreaming(instructionParser.cleanupPartialResponse(response));
    });

    eventBus.on('pipeline:cancelled', ({ partialResponse }) => {
      this._setProcessing(false);
      if (this._streamingEl) {
        this._streamingEl.classList.remove('is-streaming');
        const cursor = this._streamingEl.querySelector('.typing-cursor');
        if (cursor) cursor.remove();
        const partial = partialResponse || '';
        if (partial.trim().length > 50) {
          this._streamingEl.querySelector('.chat-content').innerHTML = this._renderMarkdown(partial);
          const note = document.createElement('div');
          note.style.cssText = 'color:#c69c6d;font-size:10px;margin-top:6px;font-style:italic;';
          note.textContent = '⚠ 生成已被取消，以上为已接收的部分内容。';
          this._streamingEl.querySelector('.chat-content').appendChild(note);
        } else {
          this._streamingEl.remove();
          this._streamingEl = null;
          this._addSystemMessage('生成已取消。');
        }
        this._streamingEl = null;
      }
    });

    eventBus.on('pipeline:complete', ({ rawResponse, cleanResponse, thinkContent, turnCount, hasHUD, isPartial, timelineError }) => {
      this._finalizeMessage(cleanResponse, rawResponse, thinkContent, isPartial);
      this._updateTurn(turnCount);
      this._setProcessing(false);
      if (hasHUD) {
        const msgs = this.element.querySelector('#chat-messages');
        if (msgs) {
          const hud = document.createElement('status-hud');
          hud.updates = [...this._turnUpdates];
          msgs.appendChild(hud);
        }
      }
      if (timelineError) {
        this._addSystemMessage(`[系统] 时间线存档写入失败: ${timelineError}。当前进度可能丢失，请稍后导出存档。`);
      }
    });

    eventBus.on('pipeline:error', ({ error, lastUserInput }) => {
      this._setProcessing(false);
      if (this._streamingEl) {
        const cursor = this._streamingEl.querySelector('.typing-cursor');
        if (cursor) cursor.remove();
        this._streamingEl = null;
      }
      const msgs = this.element.querySelector('#chat-messages');
      if (msgs) {
        const errDiv = document.createElement('div');
        errDiv.className = 'chat-message chat-message--system chat-message--error';
        let errorMsg = String(error || '时空乱流干扰了感知...');
        if (errorMsg.includes('Failed to fetch')) {
          errorMsg = '【连接中断】感知的查克拉连接已断开，请检查网络是否稳定。';
        } else if (errorMsg.includes('API')) {
          errorMsg = '【API 异常】异界传送门不稳定，请稍后重试。';
        } else {
          errorMsg = '【系统异常】' + errorMsg;
        }
        
        errDiv.innerHTML = `<div class="chat-bubble" style="background: rgba(239, 83, 80, 0.08); border: 1px solid rgba(239, 83, 80, 0.25); border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; margin: 8px 0; max-width: 85%;">
          <div style="color: #ef5350; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            ${this._esc(errorMsg)}
          </div>
          ${safeInput ? `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 8px; border-top: 1px dashed rgba(239, 83, 80, 0.15);">
            <span style="font-size: 11px; color: rgba(232, 228, 217, 0.4);">您可以重新结印，或使用原本的行动再次尝试突破干扰。</span>
            <button class="retry-btn" data-retry="${safeInput}" style="background: rgba(239, 83, 80, 0.15); border: 1px solid rgba(239, 83, 80, 0.4); color: #ef5350; padding: 4px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.2s;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/></svg>
              重新结印 (重试)
            </button>
          </div>` : `
          <span style="font-size: 11px; color: rgba(232, 228, 217, 0.4);">请输入新的行动以继续。</span>
          `}
        </div>`;
        const retryBtn = errDiv.querySelector('.retry-btn');
        retryBtn?.addEventListener('click', () => {
          const retryText = retryBtn.dataset.retry;
          errDiv.remove();
          if (retryText) eventBus.emit('user:input', retryText);
        });
        msgs.appendChild(errDiv);
        this._scroll();
      }
    });

    eventBus.on('pipeline:retrying', ({ attempt, maxRetries }) => {
      this._showToast(`AI 请求失败，第 ${attempt}/${maxRetries} 次重试中...`);
    });

    eventBus.on('state:changed', ({ path }) => {
      if (path && (path.startsWith('world_state') || path.startsWith('attributes'))) {
        this._updateStatusBar();
      }
    });

    eventBus.on('state:restored', () => {
      this._updateStatusBar();
      this._updateBranchIndicator();
    });

    eventBus.on('timeline:branch-created', () => this._updateBranchIndicator());
    eventBus.on('timeline:branch-switched', () => this._updateBranchIndicator());
    eventBus.on('timeline:jumped', () => {
      this._updateBranchIndicator();
      atmosphereManager.flash('rgba(232, 228, 217, 0.5)', 400);
    });

    eventBus.on('ai:usage', (usage) => {
      if (!usage) return;
      const hit = Number(usage.prompt_cache_hit_tokens) || 0;
      const miss = Number(usage.prompt_cache_miss_tokens) || 0;
      const total = hit + miss;
      const el = this.element?.querySelector('#status-cache');
      if (!el) return;
      if (total > 0) {
        const rate = Math.round((hit / total) * 100);
        const color = rate >= 90 ? '#66BB6A' : rate >= 50 ? '#c69c6d' : '#eb613f';
        el.style.color = color;
        el.textContent = `◉ ${rate}%`;
        el.title = `缓存命中: ${hit} tokens / 未命中: ${miss} tokens`;
      } else if (usage.prompt_tokens) {
        el.style.color = '#a39f98';
        el.textContent = `◉ ---`;
        el.title = `本次输入: ${usage.prompt_tokens} tokens（非DeepSeek或缓存字段缺失）`;
      } else {
        el.style.color = '#6e6a65';
        el.textContent = `◉ ---`;
        el.title = '等待 API 响应...';
      }
    });

    eventBus.on('app:toast', (text) => this._showToast(text));

    eventBus.on('combat:started', (data) => {
      this._showToast(`遭遇战: ${data?.enemy_name || '不明敌人'}`);
    });
    eventBus.on('combat:ended', ({ result }) => {
      const label = result === 'victory' ? '胜利' : result === 'defeat' ? '败北' : result === 'retreat' ? '撤退' : '结束';
      this._showToast(`战斗${label}`);
    });

    eventBus.on('attribute:level-up', ({ exp, needed }) => {
      this._showToast(`历练达成 ${exp}/${needed}，可申请晋升考核`);
    });
    eventBus.on('attribute:power-level-up', ({ level }) => {
      this._showToast(`战力突破: ${level}`);
    });

    eventBus.on('equipment:equipped', ({ slot, name }) => {
      this._showToast(`装备: ${name}`);
    });
    eventBus.on('equipment:unequipped', ({ name }) => {
      this._showToast(`卸下: ${name}`);
    });

    eventBus.on('mission:added', (mission) => {
      this._showToast(`接取任务: [${mission?.rank || 'D'}] ${mission?.title || ''}`);
    });
    eventBus.on('mission:completed', (mission) => {
      this._showToast(`完成任务: ${mission?.title || ''}`);
    });
    eventBus.on('mission:failed', (mission) => {
      this._showToast(`任务失败: ${mission?.title || ''}`);
    });

    eventBus.on('pipeline:warning', ({ warning }) => {
      this._showToast(warning);
    });
  }

  _sendMessage() {
    if (this._isProcessing) return;
    const textarea = this.element.querySelector('#chat-input');
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = '';
    this._resizeInput();
    this._addUserMessage(text);
    eventBus.emit('user:input', text);
  }

  _setProcessing(isProcessing) {
    this._isProcessing = isProcessing;
    this.element?.classList.toggle('is-processing', isProcessing);
    const textarea = this.element?.querySelector('#chat-input');
    const sendBtn = this.element?.querySelector('#btn-send');
    if (textarea) textarea.disabled = isProcessing;
    if (sendBtn) {
      sendBtn.disabled = isProcessing;
      sendBtn.innerHTML = isProcessing ? `${icon('chakra', 16)}结印中` : `${icon('send', 16)}结印`;
    }
    document.querySelectorAll('combat-arena').forEach(arena => {
      arena.toggleAttribute('data-disabled', isProcessing);
      arena.setActionDisabled?.(isProcessing);
      if (!isProcessing) {
        arena.removeAttribute('data-disabled');
        arena.shadowRoot?.querySelectorAll('.act').forEach(btn => { btn.disabled = false; });
      }
    });
    if (!isProcessing) this._removeAgentProgress();
  }

  _showAgentProgress() {
    this._removeAgentProgress();
    const msgs = this.element?.querySelector('#chat-messages');
    if (!msgs) return;
    const el = document.createElement('agent-progress');
    el.id = 'agent-progress-live';
    msgs.appendChild(el);
    el.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }

  _removeAgentProgress() {
    this.element?.querySelector('#agent-progress-live')?.remove();
  }

  _resizeInput() {
    const textarea = this.element?.querySelector('#chat-input');
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  }

  _addUserMessage(text) {
    // Single page paradigm: We do not display user messages in the main view anymore.
    // Instead, we clear the chat to prepare for the AI's response.
    const msgs = this.element.querySelector('#chat-messages');
    if (msgs) {
      msgs.innerHTML = `<div class="chat-message chat-message--system"><div class="chat-bubble">正在结印，请稍候...</div></div>`;
    }
    this._scroll();
  }

  _addSystemMessage(text, type = 'info') {
    const msgs = this.element.querySelector('#chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = `chat-message chat-message--system ${type === 'warning' ? 'chat-message--warning' : ''}`.trim();
    const escaped = this._esc(text)
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>' + '$' + '1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:2px;font-family:var(--font-title);letter-spacing:1px;">' + '$' + '1</code>');
    div.innerHTML = `<div class="chat-bubble">${escaped}</div>`;
    msgs.appendChild(div);
    this._scroll();
  }

  addSystemMessage(text, type = 'info') {
    this._addSystemMessage(text, type);
  }

  renderSinglePage(text) {
    this._showGame();
    const msgs = this.element.querySelector('#chat-messages');
    if (!msgs) return;
    msgs.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'chat-message chat-message--ai';
    div.innerHTML = `<div class="chat-content">${this._renderMarkdown(text)}</div>`;
    msgs.appendChild(div);
    
    // Add combat arena if active and setting is enabled
    const combat = stateManager.get('combat');
    const tacticalCombat = stateManager.get('ui_prefs.settings.tacticalCombat');
    if (combat?.is_active && tacticalCombat) {
      const wrap = document.createElement('div');
      const arena = document.createElement('combat-arena');
      wrap.appendChild(arena);
      msgs.appendChild(wrap);
    }
    this._scroll();
  }

  restoreChatHistory(history = [], fallbackMessage = '') {
    // Single page paradigm: we ignore the array of history and just use the fallbackMessage (which is node.clean_response)
    this.renderSinglePage(fallbackMessage || '本回没有记录任何回忆...');
  }

  _showToast(text) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    (this.element ? (this.element.closest('#app') || document.body) : document.body).appendChild(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  _updateStreaming(text) {
    if (!this._streamingEl) {
      const msgs = this.element.querySelector('#chat-messages');
      // Single page paradigm: Clear the "正在结印..." system message before streaming
      msgs.innerHTML = ''; 
      this._streamingEl = document.createElement('div');
      this._streamingEl.className = 'chat-message chat-message--ai is-streaming';
      this._streamingEl.innerHTML = '<div class="chat-content"></div><span class="typing-cursor"></span>';
      msgs.appendChild(this._streamingEl);
    }
    const content = this._streamingEl.querySelector('.chat-content');
    content.innerHTML = this._renderMarkdown(text);
    this._scroll();
  }

  _finalizeMessage(text, _rawText, thinkContent, isPartial = false) {
    if (!this._streamingEl) {
      this._updateStreaming(text);
    }
    if (this._streamingEl) {
      this._streamingEl.classList.remove('is-streaming');
      const cursor = this._streamingEl.querySelector('.typing-cursor');
      if (cursor) cursor.remove();

      const contentEl = this._streamingEl.querySelector('.chat-content');

      if (thinkContent) {
        const prefs = typeof stateManager.getUIPrefs === 'function' ? stateManager.getUIPrefs() : {};
        const isOpen = prefs?.settings?.reasoningOpen !== false;
        const thinkBlock = document.createElement('div');
        thinkBlock.className = `think-block${isOpen ? '' : ' think-collapsed'}`;
        thinkBlock.innerHTML = `
          <div class="think-toggle" onclick="this.parentElement.classList.toggle('think-collapsed')">
            <span class="think-arrow">▼</span> 思维链
          </div>
          <div class="think-body">${this._renderMarkdown(thinkContent)}</div>`;
        contentEl.parentElement.insertBefore(thinkBlock, contentEl);
      }

      contentEl.innerHTML = this._renderMarkdown(text);

      const editBar = document.createElement('div');
      editBar.style.cssText = 'display:flex;gap:8px;margin-top:10px;padding-top:8px;border-top:1px dashed rgba(198,156,109,0.15);';
      editBar.innerHTML = `<button class="edit-ai-btn" title="查看原文并编辑" style="padding:3px 10px;font-size:11px;color:#a39f98;background:transparent;border:1px solid rgba(232,228,217,0.15);border-radius:3px;cursor:pointer;font-family:var(--font-title);letter-spacing:1px;">✎ 编辑</button>`;
      editBar.querySelector('.edit-ai-btn').addEventListener('click', () => {
        this._editAIResponse(contentEl, text, editBar);
      });
      contentEl.appendChild(editBar);
      if (isPartial) {
        const note = document.createElement('div');
        note.style.cssText = 'color:#c69c6d;font-size:10px;margin-top:6px;font-style:italic;';
        note.textContent = '⚠ 此回复被截断，变量可能未完全更新。可继续游戏。';
        contentEl.appendChild(note);
      }
      this._streamingEl = null;
    }
    const combat = stateManager.get('combat');
    const tacticalCombat = stateManager.get('ui_prefs.settings.tacticalCombat');
    if (combat?.is_active && tacticalCombat) {
      const msgs = this.element.querySelector('#chat-messages');
      if (msgs && !msgs.querySelector('combat-arena')) {
        const wrap = document.createElement('div');
        const arena = document.createElement('combat-arena');
        wrap.appendChild(arena);
        msgs.appendChild(wrap);
      }
    }
  }

  _editAIResponse(contentEl, currentText, editBar) {
    const isEditing = contentEl.querySelector('.edit-textarea');
    if (isEditing) return;

    const originalHtml = contentEl.innerHTML;
    const textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = currentText;
    textarea.style.cssText = 'width:100%;min-height:200px;background:#070a0e;border:1px solid var(--c-shuiro);border-radius:6px;color:#e8e4d9;font:14px/1.7 var(--font-body);padding:14px;resize:vertical;outline:none;box-sizing:border-box;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
    btnRow.innerHTML = `<button class="btn-save-edit" style="padding:6px 16px;background:var(--c-shuiro);color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700;">保存</button>
      <button class="btn-cancel-edit" style="padding:6px 16px;background:transparent;color:#a39f98;border:1px solid rgba(232,228,217,0.2);border-radius:4px;cursor:pointer;">取消</button>`;

    contentEl.innerHTML = '';
    contentEl.appendChild(textarea);
    contentEl.appendChild(btnRow);
    editBar.style.display = 'none';

    btnRow.querySelector('.btn-save-edit').addEventListener('click', () => {
      const newText = textarea.value;
      contentEl.innerHTML = this._renderMarkdown(newText);
      const newBar = document.createElement('div');
      newBar.className = 'edit-bar';
      newBar.innerHTML = `<button class="edit-ai-btn">✎ 编辑</button>`;
      newBar.querySelector('.edit-ai-btn').addEventListener('click', () => {
        this._editAIResponse(contentEl, newText, newBar);
      });
      contentEl.appendChild(newBar);
      this._updateNodeResponse(newText);
    });

    btnRow.querySelector('.btn-cancel-edit').addEventListener('click', () => {
      contentEl.innerHTML = originalHtml;
      editBar.style.display = '';
    });
  }

  async _updateNodeResponse(newText) {
    try {
      const nodeId = stateManager.get('_meta.current_node_id');
      if (!nodeId) return;
      const node = await stateManager.dbGet('timeline_nodes', nodeId);
      if (node) {
        node.clean_response = newText;
        await stateManager.dbPut('timeline_nodes', node);
      }
    } catch { console.warn('[AppShell] Failed to save game state'); }
  }

  _updateTurn(turn) {
    const el = this.element.querySelector('#turn-display');
    if (!el) return;
    if (turn == null) { el.textContent = '序章'; return; }
    const state = stateManager.get();
    const chapter = state.world_state?.chapter;
    const scene = state.world_state?.current_scene;
    const parts = [];
    if (chapter) parts.push(chapter);
    parts.push(`第${turn}回`);
    if (scene) parts.push(scene);
    el.textContent = parts.join(' · ');
  }

  _updateStatusBar() {
    const state = stateManager.get();
    const loc = this.element.querySelector('#status-location');
    const time = this.element.querySelector('#status-time');
    const weather = this.element.querySelector('#status-weather');
    if (loc) loc.textContent = state.world_state?.current_location || '木叶隐村';
    if (time) {
      const cal = state.world_state?.calendar;
      time.textContent = cal ? `${cal.year || ''}·${cal.season || ''}·第${cal.day||1}天·${cal.time_of_day||''}` : '';
    }
    if (weather) weather.textContent = state.world_state?.weather || '晴';
  }

  async _updateBranchIndicator() {
    const el = this.element?.querySelector('#branch-indicator');
    if (!el) return;
    const branchId = stateManager.get('_meta.active_branch') || 'branch_main';
    let branch = null;
    try {
      branch = await stateManager.dbGet?.('timeline_branches', branchId);
    } catch { /* DB may not be ready on first paint */ }
    const name = branch?.name || (branchId === 'branch_main' ? '主线' : branchId.replace(/^branch_/, 'IF·'));
    const color = branch?.color || '#eb613f';
    el.textContent = name;
    el.style.setProperty('--branch-color', color);
    el.hidden = false;
  }

  _renderMarkdown(text) {
    if (!text) return '';

    const styles = [];
    let processed = text.replace(/<style[\s>][\s\S]*?<\/style>/gi, (match) => {
      styles.push(match.replace(/<\/?style[\s>]/gi, ''));
      return '';
    });

    let html = this._esc(processed);
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => this._renderSafeLink(label, href));
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>' + '$' + '1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>' + '$' + '1</em>');
    html = html.replace(/\n\n+/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    html = html.replace(/【(.+?)】/g, '<span style="color:var(--c-kin);font-size:12px;font-family:var(--font-title);">【' + '$' + '1】</span>');

    html = this._unescapeSafeHtml(html);

    if (styles.length) {
      const sanitized = styles.map(s => this._sanitizeStyle(s)).filter(Boolean);
      if (sanitized.length) {
        const styleEl = document.createElement('style');
        styleEl.textContent = sanitized.join('\n');
        styleEl.dataset.dynamicStyle = '';
        html = `<div class="preset-styles" hidden>${styleEl.outerHTML}</div>${html}`;
        queueMicrotask(() => {
          const host = this.element?.querySelector('.preset-styles style');
          if (host) document.head.appendChild(host.cloneNode(true));
        });
      }
    }

    html = html.replace(/\[行动\]\s*([^<]+)/g, (match, option) => {
      return `<button class="action-option" data-action="${this._escAttr(option.trim())}">
                <span class="action-option__icon">忍</span>
                <span class="action-option__text">${this._esc(option.trim())}</span>
              </button>`;
    });

    // 兼容旧存档的选项格式，允许末尾句号但防止跨越多重引号匹配
    html = html.replace(/(<br>|<p>)\s*「([^「」]+)」\s*(?=<br>|<\/p>|$)/g, (match, prefix, option) => {
      return `${prefix}<button class="action-option" data-action="${this._escAttr(option.trim())}">
                <span class="action-option__icon">忍</span>
                <span class="action-option__text">${this._esc(option.trim())}</span>
              </button>`;
    });

    return html;
  }

  _sanitizeStyle(cssText) {
    if (!cssText || typeof cssText !== 'string') return '';
    // 拦截危险 CSS 构造: expression(), javascript:, vbscript:, @import, -moz-binding, behavior
    const dangerous = /expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*javascript:/i;
    if (dangerous.test(cssText)) {
      console.warn('[AppShell] Blocked dangerous CSS, dropping style block');
      return '';
    }
    return cssText;
  }

  _unescapeSafeHtml(html) {
    const safeTags = ['div', 'details', 'summary', 'span'];
    for (const tag of safeTags) {
      const openRe = new RegExp(`&lt;${tag}(\\s[^&]*)?&gt;`, 'gi');
      const closeRe = new RegExp(`&lt;/${tag}&gt;`, 'gi');
      html = html.replace(openRe, (m) => `<${tag}${this._sanitizeAttrs(m.slice(5 + tag.length, -4))}>`);
      html = html.replace(closeRe, `</${tag}>`);
    }
    html = html.replace(/&lt;style[^&]*&gt;[\s\S]*?&lt;\/style&gt;/gi, '');
    return html;
  }

  _sanitizeAttrs(attrString) {
    if (!attrString) return '';
    // 仅保留 class、style、data-* 属性；剔除 on* 事件处理器、src/href/srcdoc、formaction、xlink:href 等
    const allowed = /^([a-zA-Z][\w-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s'">]+))?$/;
    const parts = String(attrString).split(/\s+/).filter(Boolean);
    const out = [];
    for (const part of parts) {
      const m = part.match(allowed);
      if (!m) continue;
      const name = m[1].toLowerCase();
      if (name.startsWith('on')) continue;
      if (name.startsWith('data-')) { out.push(part); continue; }
      if (name === 'class' || name === 'style') {
        // style 内部再做一次危险字符串过滤
        if (name === 'style' && /expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*javascript:/i.test(m[2] || '')) continue;
        out.push(part);
      }
    }
    return out.length ? ' ' + out.join(' ') : '';
  }

  _esc(str) {
    return escHtml(str);
  }

  _renderSafeLink(label, href) {
    const decoded = this._decodeHtml(String(href || '').trim());
    if (!/^(https?:|mailto:)/i.test(decoded)) return label;
    return `<a href="${this._escAttr(decoded)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  _decodeHtml(value) {
    const d = document.createElement('textarea');
    d.innerHTML = value;
    return d.value;
  }

  _escAttr(value) {
    return escAttr(value);
  }

  _scroll() {
    const msgs = this.element.querySelector('#chat-messages');
    if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
  }

  /* 网页全屏：用 CSS 把 #app 撑满视口，隐藏顶栏/状态栏/侧栏（不依赖浏览器 Fullscreen API） */
  _toggleZenMode() {
    const app = this.element.closest('#app') || this.element;
    if (!app) return;
    const isZen = (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.toggle('web-fullscreen');
    this.element.querySelector('#btn-zen')?.setAttribute('aria-pressed', String(isZen));
    if (isZen) {
      // 保存旧样式
      this._savedAppStyle = app.style.cssText;
      app.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;border:none;border-radius:0;';
      this._closeMobileDrawers();
    } else {
      // 恢复旧样式
      app.style.cssText = this._savedAppStyle || '';
    }
  }

  /* 屏幕全屏：调用浏览器原生全屏 API（含 webkit/ms 兼容） + 隐藏游戏顶栏 */
  _toggleFullscreen() {
    const el = document.documentElement;
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;

    if (!isFullscreen) {
      // 如果当前处于网页全屏，先退出
      if ((this.element ? (this.element.closest('#app') || document.body) : document.body).classList.contains('web-fullscreen')) {
        this._toggleZenMode();
      }
      const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (rfs) {
        rfs.call(el).then(() => {
          (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.add('immersive-fullscreen');
          this._closeMobileDrawers();
          
          const sidebar = this.element.querySelector('#app-sidebar');
          if (sidebar && !sidebar.classList.contains('app-sidebar--collapsed')) {
            this._toggleSidebar();
          }
          const panel = this.element.querySelector('#app-panel');
          if (panel && !panel.classList.contains('app-panel--collapsed') && !panel.classList.contains('panel-open')) {
            this._togglePanel();
          }

          this.element.querySelector('#btn-fullscreen')?.setAttribute('aria-pressed', 'true');
        }).catch(err => {
          console.warn('[AppShell] 屏幕全屏失败:', err.message);
          this._showToast('全屏失败，浏览器可能不支持');
        });
      }
    } else {
      (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.remove('immersive-fullscreen');
      const efs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (efs) efs.call(document);
      this.element.querySelector('#btn-fullscreen')?.setAttribute('aria-pressed', 'false');
    }
  }

  _toggleMobileView() {
    const isForced = (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.toggle('is-mobile-forced');
    this.element.querySelector('#btn-mobile')?.setAttribute('aria-pressed', String(isForced));
    this._syncResponsiveState();
  }

  _togglePanel() {
    const panel = this.element.querySelector('#app-panel');
    const btn = this.element.querySelector('#btn-panel');
    const isMobile = window.matchMedia('(max-width: 768px)').matches || (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.contains('is-mobile-forced');
    let isOpen;
    if (isMobile) {
      if (panel.classList.contains('panel-open')) {
        panel.classList.remove('panel-open');
        panel.classList.add('app-panel--collapsed');
        isOpen = false;
      } else {
        panel.classList.remove('app-panel--collapsed');
        panel.classList.add('panel-open');
        isOpen = true;
        const sidebar = this.element.querySelector('#app-sidebar');
        const timelineBtn = this.element.querySelector('#btn-timeline');
        sidebar?.classList.add('app-sidebar--collapsed');
        sidebar?.setAttribute('aria-hidden', 'true');
        timelineBtn?.setAttribute('aria-pressed', 'false');
      }
      this._syncMobileScrim();
    } else {
      isOpen = !panel.classList.toggle('app-panel--collapsed');
    }
    btn?.setAttribute('aria-pressed', String(isOpen));
  }

  _toggleSidebar() {
    const sidebar = this.element.querySelector('#app-sidebar');
    const btn = this.element.querySelector('#btn-timeline');
    const isMobile = window.matchMedia('(max-width: 768px)').matches || (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.contains('is-mobile-forced');
    const isCollapsed = sidebar.classList.toggle('app-sidebar--collapsed');
    sidebar.setAttribute('aria-hidden', String(isCollapsed));
    btn?.setAttribute('aria-pressed', String(!isCollapsed));
    if (isMobile && !isCollapsed) {
      const panel = this.element.querySelector('#app-panel');
      const panelBtn = this.element.querySelector('#btn-panel');
      panel?.classList.remove('panel-open');
      panel?.classList.add('app-panel--collapsed');
      panelBtn?.setAttribute('aria-pressed', 'false');
    }
    this._syncMobileScrim();
  }

  _syncResponsiveState() {
    if (!this.element) return;
    const panel = this.element.querySelector('#app-panel');
    const panelBtn = this.element.querySelector('#btn-panel');
    const sidebar = this.element.querySelector('#app-sidebar');
    const timelineBtn = this.element.querySelector('#btn-timeline');
    const isMobile = window.matchMedia('(max-width: 768px)').matches || (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.contains('is-mobile-forced');
    
    (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.toggle('is-mobile-view', isMobile);

    if (isMobile) {
      if (panel && !panel.classList.contains('app-panel--collapsed')) {
        panel.classList.add('panel-open');
      }
      panelBtn?.setAttribute('aria-pressed', String(panel?.classList.contains('panel-open')));
    } else if (panel) {
      if (panel.classList.contains('panel-open')) {
        panel.classList.remove('app-panel--collapsed');
      }
      panel.classList.remove('panel-open');
      panelBtn?.setAttribute('aria-pressed', String(!panel.classList.contains('app-panel--collapsed')));
    }

    timelineBtn?.setAttribute('aria-pressed', String(!sidebar?.classList.contains('app-sidebar--collapsed')));
    this._syncMobileScrim();
  }

  _debouncedResponsiveSync() {
    window.clearTimeout(this._resizeTimer);
    this._resizeTimer = window.setTimeout(() => this._syncResponsiveState(), 160);
  }

  _closeMobileDrawers() {
    const panel = this.element?.querySelector('#app-panel');
    const sidebar = this.element?.querySelector('#app-sidebar');
    const panelBtn = this.element?.querySelector('#btn-panel');
    const timelineBtn = this.element?.querySelector('#btn-timeline');
    panel?.classList.remove('panel-open');
    panel?.classList.add('app-panel--collapsed');
    sidebar?.classList.add('app-sidebar--collapsed');
    sidebar?.setAttribute('aria-hidden', 'true');
    panelBtn?.setAttribute('aria-pressed', 'false');
    timelineBtn?.setAttribute('aria-pressed', 'false');
    this._syncMobileScrim();
  }

  _syncMobileScrim() {
    const scrim = this.element?.querySelector('#mobile-scrim');
    if (!scrim) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches || (this.element ? (this.element.closest('#app') || document.body) : document.body).classList.contains('is-mobile-forced');
    const panelOpen = this.element?.querySelector('#app-panel')?.classList.contains('panel-open');
    const timelineOpen = !this.element?.querySelector('#app-sidebar')?.classList.contains('app-sidebar--collapsed');
    scrim.classList.toggle('is-visible', Boolean(isMobile && (panelOpen || timelineOpen)));
  }

  showAPIForm({ fromSettings = false } = {}) {
    this.element.classList.add('app-shell--setup');
    const center = this.element.querySelector('#app-center');
    const container = center.querySelector('.chat-container');
    const inputArea = center.querySelector('#chat-input-area');
    center.classList.add('app-center--setup');
    inputArea.style.display = 'none';
    const saved = stateManager.getAPIConfig() || {};

    container.innerHTML = `
      <div class="api-setup">
        <div class="api-layout">
          <section class="api-hero" aria-label="开局引导">
            <div class="api-setup-title"><img src="https://i.postimg.cc/HxrmZwpz/file-000000001608720ba6b31150e6493597.png" class="logo-image-large" alt="忍者手记"></div>
            <div class="api-setup-subtitle">${fromSettings ? '重新校准通灵契约，切换叙事核心与模型' : '从火影之路开始，感受火之意志和爱与羁绊的力量'}</div>
            <div class="api-feature-row">
              <span>自动时间线</span>
              <span>模型自选</span>
              <span>流式叙事</span>
              <span>战斗判定</span>
            </div>
            <div class="api-hero-panel">
              <div class="api-hero-line"><strong>世界状态</strong><span>默认木叶48年 · 可随存档/选择切换</span></div>
              <div class="api-hero-line"><strong>默认预设</strong><span>忍者手记 · 内置默认预设</span></div>
              <div class="api-hero-line"><strong>存档方式</strong><span>IndexedDB 本地时间线</span></div>
              <div class="api-hero-line"><strong>开局流程</strong><span>连接模型 → 创建角色 → 入学试炼</span></div>
            </div>
            <div class="import-card">
              <div>
                <strong>异地续写</strong>
                <span>导入时间线 JSON，直接恢复角色、分支和聊天记录</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-import-save">导入存档</button>
              <input type="file" id="timeline-import-file" accept="application/json,.json" hidden />
            </div>
          </section>

          <form class="api-setup-form" id="api-setup-form">
          <div class="api-form-heading">
            <span>契约卷轴</span>
            <small id="model-status">填写地址后可读取模型</small>
          </div>
          <div class="card">
            <api-config-form config='${this._escAttr(JSON.stringify(saved))}'></api-config-form>
            <div class="api-setup-security" style="margin-top: 20px;">
              ${icon('lock', 14)}
              <span>你的印记仅存储在本地，不会外传</span>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%;letter-spacing:3px;margin-top: 14px;">${fromSettings ? '保存契约' : '缔结契约'}</button>
          </div>
          </form>
        </div>
      </div>
    `;

    const form = container.querySelector('#api-setup-form');
    const importBtn = container.querySelector('#btn-import-save');
    const importFile = container.querySelector('#timeline-import-file');
    const apiConfigForm = container.querySelector('api-config-form');

    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', () => {
      const file = importFile.files?.[0];
      if (!file) return;
      eventBus.emit('app:timeline-import-file', { file });
      importFile.value = '';
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const config = apiConfigForm.getConfig();
      if (!config) {
        this._showToast('请填写完整的 API 信息 (包括模型名称)');
        return;
      }
      eventBus.emit('app:api-config', config);
    });
  }

  showCharacterCreator() {
    this.element.classList.add('app-shell--setup');
    const center = this.element.querySelector('#app-center');
    const container = center.querySelector('.chat-container');
    const inputArea = center.querySelector('#chat-input-area');
    center.classList.add('app-center--setup');
    inputArea.style.display = 'none';
    container.innerHTML = '';
    const creator = document.createElement('character-creator');
    container.appendChild(creator);
  }

  _showGame() {
    this.element.classList.remove('app-shell--setup');
    const center = this.element.querySelector('#app-center');
    const container = center.querySelector('.chat-container');
    center.classList.remove('app-center--setup');
    container.innerHTML = '<div class="chat-messages" id="chat-messages"></div>';
    const inputArea = center.querySelector('#chat-input-area');
    inputArea.style.display = 'flex';
    this._updateStatusBar();
  }

  showGame() {
    this._showGame();
  }

  getShell() { return this.element; }
}export const appShell = new AppShell();