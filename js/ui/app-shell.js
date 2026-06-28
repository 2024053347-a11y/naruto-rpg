import { eventBus } from '../core/event-bus.js';
import { stateManager } from '../core/state-manager.js';
import { icon } from '../utils/icons.js';
import { escHtml, escAttr, formatGameTime } from '../utils/format.js';
import { getAgentConfig } from '../data/agent-config.js';
import { instructionParser } from '../core/instruction-parser.js';

class AppShell {
  constructor() {
    this.element = null;
    this._streamingEl = null;
    this._isProcessing = false;
    this._recentInputs = [];
    this._recentInputIdx = -1;
  }

  init(container) {
    this.element = document.createElement('div');
    this.element.className = 'app-shell';
    this.element.id = 'app-shell';
    container.appendChild(this.element);
    this._loadRecentInputs();
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
            <div class="recent-inputs" id="recent-inputs"></div>
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
        <span id="status-dice" class="dice-pool" title="本回合卦值" style="display:none;"></span>
        <span class="sep dice-sep" style="display:none;"></span>
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
        return;
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.key === 'ArrowUp') this._cycleRecentInput(-1);
        else this._cycleRecentInput(1);
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
    eventBus.on('panel:close', () => this._closeMobileDrawers());

    this._bindGlobalShortcuts();

    this._renderRecentInputs();
    this.element.querySelector('#recent-inputs')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.recent-chip');
      if (chip) {
        const textarea = this.element.querySelector('#chat-input');
        if (textarea) {
          textarea.value = chip.dataset.text || '';
          textarea.focus();
          this._resizeInput();
        }
      }
    });

    this._syncResponsiveState();
    this._updateBranchIndicator();
    window.addEventListener('resize', () => this._debouncedResponsiveSync(), { passive: true });

    // 监听浏览器全屏状态变化（用户按 ESC 退出时自动同步按钮状态）
    const onFsChange = () => this._syncFullscreenState();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    const onPageShow = (event) => {
      if (event.persisted) this._syncFullscreenState();
    };
    window.addEventListener('pageshow', onPageShow);

    const onVisibilityChange = () => {
      if (!document.hidden) this._syncFullscreenState();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
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
          const input = this.element.querySelector('#chat-input');
          if (input) {
            input.value = action;
            input.focus();
          }
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
      // this._updateTurn(turnCount); removed
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

    eventBus.on('pipeline:error', ({ error, isTruncated, partialResponse, lastUserInput }) => {
      this._setProcessing(false);
      if (this._streamingEl) {
        const cursor = this._streamingEl.querySelector('.typing-cursor');
        if (cursor) cursor.remove();
        this._streamingEl = null;
      }
      const container = this.element?.querySelector('#chat-messages') || this.element;
      if (!container) return;

      const safeInput = lastUserInput ? this._escAttr(lastUserInput) : '';
      const rawErr = String(error || '');
      let errTitle, errDetail, errHint;

      if (rawErr.includes('Failed to fetch') || rawErr.includes('NetworkError')) {
        errTitle = '【连接中断】';
        errDetail = '感知的查克拉连接已断开，请检查网络或 API 地址是否可达。';
        errHint = '常见原因：API 地址填写错误、后端未启动、浏览器 CORS 限制。';
      } else if (rawErr.includes('429') || rawErr.includes('rate')) {
        errTitle = '【请求限流】';
        errDetail = '短时间内请求过多，API 限流中，请稍等片刻后重试。';
        errHint = '等待 1-2 分钟后重试，或切换到更大的模型限额。';
      } else if (rawErr.includes('401') || rawErr.includes('403') || rawErr.includes('Auth')) {
        errTitle = '【鉴权失败】';
        errDetail = 'API Key 无效或已过期，请检查密钥是否正确。';
        errHint = '前往设置面板确认 API Key，或更换有效的密钥。';
      } else if (rawErr.includes('timeout') || rawErr.includes('超时') || rawErr.includes('AbortError')) {
        errTitle = '【生成超时】';
        errDetail = 'AI 响应时间过长，可能是模型负载过高或生成量过大。';
        errHint = '可尝试：1. 减少 max_tokens  2. 换用更快的模型  3. 稍后重试';
      } else if (isTruncated) {
        errTitle = '【生成截断】';
        errDetail = `已收到 ${partialResponse?.length || 0} 字后中断，回复不完整。`;
        errHint = '已保存部分内容到界面，变量可能未完全更新。可继续游戏或重试。';
      } else if (rawErr.includes('500') || rawErr.includes('502') || rawErr.includes('503')) {
        errTitle = '【服务器异常】';
        errDetail = 'API 服务端暂时不可用，请稍后重试。';
        errHint = '服务端临时故障，等待几分钟后再试。';
      } else {
        errTitle = '【系统异常】';
        errDetail = rawErr || '时空乱流干扰了感知...';
        errHint = '请检查控制台日志获取更多信息。';
      }

      const errDiv = document.createElement('div');
      errDiv.className = 'chat-message chat-message--system chat-message--error';
      errDiv.innerHTML = `<div style="background:rgba(239,83,80,0.06);border:1px solid rgba(239,83,80,0.2);border-radius:10px;padding:14px 18px;margin:8px 0;max-width:85%;box-shadow:inset 0 0 20px rgba(239,83,80,0.03);">
        <div style="color:#ef5350;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ${this._esc(errTitle)}
        </div>
        <div style="font-size:12px;color:#a39f98;line-height:1.6;margin-bottom:4px;">${this._esc(errDetail)}</div>
        <div style="font-size:11px;color:rgba(163,159,152,0.5);line-height:1.5;">${this._esc(errHint)}</div>
        ${safeInput ? `
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:10px;padding-top:8px;border-top:1px dashed rgba(239,83,80,0.12);">
          <button class="retry-btn" data-retry="${safeInput}" style="background:rgba(239,83,80,0.12);border:1px solid rgba(239,83,80,0.35);color:#ef5350;padding:5px 14px;border-radius:5px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.2s;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/></svg>
            重新结印 (重试)
          </button>
        </div>` : `
        <div style="font-size:11px;color:rgba(163,159,152,0.4);margin-top:8px;">请重新输入行动继续。</div>
        `}
      </div>`;
      const retryBtn = errDiv.querySelector('.retry-btn');
      retryBtn?.addEventListener('click', () => {
        const retryText = retryBtn.dataset.retry;
        errDiv.remove();
        if (retryText) eventBus.emit('user:input', retryText);
      });
      container.appendChild(errDiv);
      this._scroll();
    });

    eventBus.on('pipeline:retrying', ({ attempt, maxRetries }) => {
      this._showToast(`AI 请求失败，第 ${attempt}/${maxRetries} 次重试中...`);
    });

    eventBus.on('pipeline:dice', ({ values }) => {
      this._updateDicePool(values);
    });
    eventBus.on('pipeline:processing', () => {
      this._updateDicePool(null);
    });

    eventBus.on('player:died', ({ cause, alreadyDead }) => {
      this._showDeathScreen(cause, alreadyDead);
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
    this._addToRecentInputs(text);
    this._addUserMessage(text);
    eventBus.emit('user:input', text);
    this._recentInputIdx = -1;
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

  _addToRecentInputs(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this._recentInputs[0] === trimmed) return;
    this._recentInputs = [trimmed, ...this._recentInputs.filter(t => t !== trimmed)].slice(0, 2);
    this._saveRecentInputs();
    this._renderRecentInputs();
  }

  _saveRecentInputs() {
    try {
      localStorage.setItem('naruto_recent_inputs', JSON.stringify(this._recentInputs));
    } catch { /* ignore */ }
  }

  _loadRecentInputs() {
    try {
      const raw = localStorage.getItem('naruto_recent_inputs');
      this._recentInputs = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this._recentInputs)) this._recentInputs = [];
      this._recentInputs = [...new Set(this._recentInputs.filter(Boolean))].slice(0, 2);
    } catch { this._recentInputs = []; }
  }

  _cycleRecentInput(direction) {
    const textarea = this.element?.querySelector('#chat-input');
    if (!textarea || !this._recentInputs.length) return;
    if (this._recentInputIdx === -1) {
      this._savedInput = textarea.value;
    }
    const max = this._recentInputs.length - 1;
    this._recentInputIdx += direction;
    if (this._recentInputIdx > max) {
      this._recentInputIdx = -1;
      textarea.value = this._savedInput || '';
    } else if (this._recentInputIdx < 0) {
      this._recentInputIdx = max;
      textarea.value = this._recentInputs[this._recentInputIdx];
    } else {
      textarea.value = this._recentInputs[this._recentInputIdx];
    }
    this._resizeInput();
  }

  _renderRecentInputs() {
    const container = this.element?.querySelector('#recent-inputs');
    if (!container) return;
    if (!this._recentInputs.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = this._recentInputs.map((text, i) => {
      const chipLabel = i === 0 ? '上回' : '上上回';
      const textLabel = text.length > 50 ? text.slice(0, 50) + '…' : text;
      return `<span class="recent-chip" data-text="${this._escAttr(text)}" title="${this._escAttr(text)}">
        <span class="recent-chip-label">${chipLabel}</span>${this._esc(textLabel)}
      </span>`;
    }).join('');
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
        const isOpen = stateManager.get('ui_prefs.settings.reasoningOpen') !== false;
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

  // _updateTurn removed

  _updateStatusBar() {
    const state = stateManager.get();
    const loc = this.element.querySelector('#status-location');
    const time = this.element.querySelector('#status-time');
    const weather = this.element.querySelector('#status-weather');
    if (loc) loc.textContent = state.world_state?.current_location || '木叶隐村';
    if (time) {
      time.textContent = formatGameTime(state.world_state?.calendar) || '';
    }
    if (weather) weather.textContent = state.world_state?.weather || '晴';
  }

  _updateDicePool(values) {
    const diceEl = this.element?.querySelector('#status-dice');
    const sepEl = this.element?.querySelector('.dice-sep');
    if (!diceEl) return;
    if (!values || !values.length) {
      diceEl.style.display = 'none';
      if (sepEl) sepEl.style.display = 'none';
      return;
    }
    const names = ['壹', '贰', '叁', '肆', '伍', '陆'];
    diceEl.style.display = '';
    if (sepEl) sepEl.style.display = '';
    diceEl.innerHTML = names.map((n, i) =>
      `<span style="display:inline-block;padding:0 4px;border-radius:3px;margin:0 1px;background:rgba(198,156,109,0.08);border:1px solid rgba(198,156,109,0.2);font-size:10px;">${n}:${values[i]}</span>`
    ).join('');
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
    html = this._unescapeSafeHtml(html);

    html = html.replace(/(?![^<]*>)【(.+?)】/g, (match, content) => '<span style="color:var(--c-kin);font-size:12px;font-family:var(--font-title);">【' + content + '】</span>');

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

    html = html.replace(/\[行动\]\s*(.*?)(?=<br>|<\/p>|$)/g, (match, option) => {
      const plain = option.replace(/<[^>]+>/g, '');
      return `<button class="action-option" data-action="${this._escAttr(plain.trim())}">
                <span class="action-option__icon">忍</span>
                <span class="action-option__text">${option.trim()}</span>
              </button>`;
    });

    // 兼容旧存档的选项格式，允许末尾句号但防止跨越多重引号匹配
    html = html.replace(/(<br>|<p>)\s*「([^「」]+)」\s*(?=<br>|<\/p>|$)/g, (match, prefix, option) => {
      const plain = option.replace(/<[^>]+>/g, '');
      return `${prefix}<button class="action-option" data-action="${this._escAttr(plain.trim())}">
                <span class="action-option__icon">忍</span>
                <span class="action-option__text">${option.trim()}</span>
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
          document.body.classList.add('immersive-fullscreen');
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
      document.body.classList.remove('immersive-fullscreen');
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
    this._syncFullscreenState();
  }

  _debouncedResponsiveSync() {
    window.clearTimeout(this._resizeTimer);
    this._resizeTimer = window.setTimeout(() => this._syncResponsiveState(), 160);
  }

  _syncFullscreenState() {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    const target = this.element ? (this.element.closest('#app') || document.body) : document.body;
    target.classList.toggle('immersive-fullscreen', !!isFs);
    this.element?.querySelector('#btn-fullscreen')?.setAttribute('aria-pressed', String(!!isFs));
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

  _showDeathScreen(cause, alreadyDead) {
    this._setProcessing(false);
    const inputArea = this.element?.querySelector('#chat-input-area');
    if (inputArea) { inputArea.style.display = 'none'; }
    const sendBtn = this.element?.querySelector('#btn-send');
    if (sendBtn) sendBtn.disabled = true;

    const msgs = this.element?.querySelector('#chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = 'chat-message chat-message--system';
    div.innerHTML = `<div style="text-align:center;padding:40px 20px;margin:20px 0;background:rgba(239,83,80,0.06);border:2px solid rgba(239,83,80,0.3);border-radius:12px;">
      <div style="font-size:48px;margin-bottom:16px;">忍</div>
      <div style="font-size:20px;font-weight:800;color:#ef5350;letter-spacing:4px;margin-bottom:12px;">忍者之道，止于此处</div>
      <div style="font-size:13px;color:#a39f98;margin-bottom:8px;">死因：${this._esc(cause || '不明')}</div>
      <div style="font-size:11px;color:rgba(163,159,152,0.5);margin-bottom:20px;">${alreadyDead ? '你已倒下，无法继续行动。' : '你的查克拉消散，生命之火熄灭。'}</div>
      <button class="restart-btn" style="background:rgba(239,83,80,0.15);border:1px solid rgba(239,83,80,0.5);color:#ef5350;padding:8px 24px;border-radius:6px;font-size:14px;cursor:pointer;letter-spacing:2px;">重新开始</button>
    </div>`;
    div.querySelector('.restart-btn')?.addEventListener('click', () => {
      eventBus.emit('app:reset');
    });
    msgs.appendChild(div);
    this._scroll();
  }
}export const appShell = new AppShell();