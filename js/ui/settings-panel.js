import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { getAgentConfig, saveAgentConfig } from '../data/agent-config.js';
import { settingsStyles } from '../../css/components/settings-panel.css.js';
import { escHtml, escAttr } from '../utils/format.js';
import GameModal from './modal.js';
import { bindCustomSelects } from './custom-select.js';
import { getVariableUpdaterPreset } from '../data/variable-updater-preset.js';
import './memory-panel.js';

const THEME_PRESETS = {
  konoha: { label: '木叶卷轴', textColor: '#e8e4d9', accentColor: '#eb613f', goldColor: '#c69c6d', backgroundColor: '#070a0e' },
  anbu: { label: '暗部夜行', textColor: '#e6edf5', accentColor: '#6aa4ff', goldColor: '#9fb7d9', backgroundColor: '#080d16' },
  akatsuki: { label: '晓之绯云', textColor: '#f1e8e8', accentColor: '#d7263d', goldColor: '#e0b15a', backgroundColor: '#12070a' },
  scroll: { label: '古旧卷轴', textColor: '#3b2a18', accentColor: '#9a4b24', goldColor: '#8a5f2a', backgroundColor: '#ead7a8' },
  mist: { label: '雾隐冷雨', textColor: '#e8f3f5', accentColor: '#6bc7d9', goldColor: '#a8d8df', backgroundColor: '#0b1a1f' }
};

const FONT_PRESETS = {
  system: { label: '系统黑体', family: "'Noto Sans SC','Microsoft YaHei UI','PingFang SC','Segoe UI',system-ui,sans-serif" },
  serif: { label: '宋明体', family: "'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif" },
  kai: { label: '楷体手札', family: "'Kaiti SC','STKaiti','KaiTi',cursive" },
  mono: { label: '等宽字体', family: "'JetBrains Mono','Fira Code','Noto Sans SC',monospace" },
  round: { label: '圆润黑体', family: "'Noto Sans SC','Microsoft YaHei UI','PingFang SC',sans-serif" },
  song: { label: '中文宋体', family: "'Noto Serif SC','SimSun','Songti SC',serif" },
  fangsong: { label: '仿宋卷文', family: "'FangSong','STFangsong','Noto Serif SC',serif" },
  brush: { label: '毛笔手写', family: "'Kaiti SC','STKaiti','KaiTi',cursive" },
  custom: { label: '自定义', family: '' }
};

const DEFAULT_SETTINGS = stateManager.getDefaultState()._ui.settings;
const localAudio = { bgm: null, ambient: null };

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeAudioList(list) {
  return (Array.isArray(list) ? list : []).map(item => {
    if (typeof item === 'string') return { title: '', url: item.trim() };
    return { title: item.title || '', url: String(item.url || '').trim() };
  }).filter(item => item.url);
}

function mergeSettings(settings = {}) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  if (!THEME_PRESETS[next.themePreset]) next.themePreset = DEFAULT_SETTINGS.themePreset;
  if (!FONT_PRESETS[next.fontPreset]) next.fontPreset = DEFAULT_SETTINGS.fontPreset || 'system';
  next.fontSize = clamp(next.fontSize, 12, 24, DEFAULT_SETTINGS.fontSize);
  next.lineHeight = clamp(next.lineHeight, 1.2, 2.4, DEFAULT_SETTINGS.lineHeight);
  next.chatMaxWidth = clamp(next.chatMaxWidth, 560, 1400, DEFAULT_SETTINGS.chatMaxWidth);
  next.backgroundOpacity = clamp(next.backgroundOpacity, 0.2, 1, DEFAULT_SETTINGS.backgroundOpacity);
  next.musicVolume = clamp(next.musicVolume, 0, 100, DEFAULT_SETTINGS.musicVolume);
  return next;
}

function esc(value) {
  return escHtml(value);
}

class SettingsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
  }

  connectedCallback() {
    this._settings = mergeSettings(stateManager.getSub('_ui').settings);
    this._onKeyDown = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._onKeyDown);
    this.render();
    this._hydrate();
    bindCustomSelects(this.shadowRoot);
  }

  render() {
    const s = this._settings;
    const apiConfig = stateManager.getAPIConfig() || {};
    const variablePreset = getVariableUpdaterPreset();
    this.shadowRoot.innerHTML = `
      <style>${settingsStyles}</style>
      <div class="backdrop" data-close="true">
        <div class="panel" role="dialog" aria-modal="true" aria-label="系统设置">
          <div class="inner-bg"></div>
          <div class="head">
            <div class="title"><span>巻</span>设定</div>
            <button class="close" data-action="close">×</button>
          </div>
          <div class="layout">
            <aside class="sidebar">
              <button class="tab-btn active" data-target="tab-visual">视觉与环境</button>
              <button class="tab-btn" data-target="tab-agent">引擎与代理</button>
              <button class="tab-btn" data-target="tab-variable">变量更新</button>
              <button class="tab-btn" data-target="tab-lore">世界书与预设</button>
              <button class="tab-btn" data-target="tab-audio">忍道音律</button>
              <button class="tab-btn" data-target="tab-memory">记忆编年</button>
              <button class="tab-btn" data-target="tab-system">系统与归档</button>
            </aside>
            <main class="content">
              
              <!-- Tab 1: 视觉与环境 -->
              <div class="tab-pane active" id="tab-visual">
                <div class="pane-grid">
                  <section>
                    <h3>排版与视觉</h3>
                    <div class="grid">
                      <label>视觉主题</label>
                      <select name="themePreset">${Object.entries(THEME_PRESETS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
                      <label>字体预设</label>
                      <select name="fontPreset">${Object.entries(FONT_PRESETS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
                      <label>自定义字体</label>
                      <input type="text" name="fontFamily" value="${esc(s.fontFamily)}" placeholder="'Noto Sans SC', sans-serif">
                      <label>阅读字号</label>
                      <input type="number" name="fontSize" min="12" max="24" value="${s.fontSize}">
                      <label>行间距</label>
                      <input type="number" name="lineHeight" min="1.2" max="2.4" step="0.05" value="${s.lineHeight}">
                      <label>正文宽度 (px)</label>
                      <input type="number" name="chatMaxWidth" min="560" max="1400" value="${s.chatMaxWidth}">
                      <label>首行缩进</label>
                      <input type="checkbox" name="paragraphIndent">
                      <label>对话框风格</label>
                      <select name="aiCardStyle">
                        <option value="line">朱印侧线</option>
                        <option value="card">卷轴卡片</option>
                        <option value="plain">极简留白</option>
                      </select>
                    </div>
                  </section>
                  <section>
                    <h3>色彩与环境</h3>
                    <div class="grid">
                      <label>正文颜色</label>
                      <div class="color-picker-wrap"><input type="color" name="textColor" value="${s.textColor}"></div>
                      <label>强调色 (朱)</label>
                      <div class="color-picker-wrap"><input type="color" name="accentColor" value="${s.accentColor}"></div>
                      <label>金印色 (金)</label>
                      <div class="color-picker-wrap"><input type="color" name="goldColor" value="${s.goldColor}"></div>
                      <label>背景底色 (墨)</label>
                      <div class="color-picker-wrap"><input type="color" name="backgroundColor" value="${s.backgroundColor}"></div>
                      <label>背景图链接</label>
                      <input type="text" name="backgroundImage" value="${esc(s.backgroundImage)}" placeholder="https://...">
                      <label>本地背景图</label>
                      <input class="file-input" name="backgroundFile" type="file" accept="image/*">
                      <label>背景昏暗度</label>
                      <input type="number" name="backgroundOpacity" min="0" max="1" step="0.05" value="${s.backgroundOpacity}">
                    </div>
                  </section>
                </div>
              </div>

              <!-- Tab 2: 引擎与代理 -->
              <div class="tab-pane" id="tab-agent">
                <section>
                   <h3>Agent 高质量正文模式</h3>
                   <div style="background:#070a0e; border:1px solid rgba(198,156,109,0.3); border-radius:8px; padding:20px;">
                     <p style="margin-top:0; margin-bottom:14px; font-size:12px; color:#a39f98; line-height:1.6;">
                       开启后每回合由多个AI Agent协作生成：大纲→审查→写作→审查→润色。<br>
                       完整模式增加头脑风暴和角色代理。建议战斗/重要场景开启，日常关闭。
                     </p>
                     <div class="grid" style="grid-template-columns:auto 1fr; gap:10px 16px; align-items:center;">
                       <label style="color:#e8e4d9;">启用 Agent 模式</label>
                       <input type="checkbox" name="agentEnabled" ${getAgentConfig().enabled ? 'checked' : ''}>
                       <label style="color:#e8e4d9;">生成模式</label>
                       <select name="agentMode" style="background:#111; color:#e8e4d9; border:1px solid rgba(198,156,109,0.2); border-radius:4px; padding:4px 8px; font-size:12px;">
                         <option value="standard" ${getAgentConfig().mode === 'standard' ? 'selected' : ''}>标准模式 (+3-4次调用, 约30-60s)</option>
                         <option value="full" ${getAgentConfig().mode === 'full' ? 'selected' : ''}>完整模式 (+8-11次调用, 约90-180s)</option>
                       </select>
                       <label style="color:#e8e4d9;">战斗自动升级完整模式</label>
                       <input type="checkbox" name="agentAutoUpgrade" ${getAgentConfig().autoUpgrade !== false ? 'checked' : ''}>
                       <label style="color:#a39f98; font-size:11px;">Agent 模型 (留空=主模型)</label>
                       <div style="display:flex;gap:8px;">
                         <input type="text" name="agentModel" value="${getAgentConfig().agentModel || ''}" placeholder="留空使用主模型" style="flex:1;background:#111; color:#e8e4d9; border:1px solid rgba(198,156,109,0.15); border-radius:4px; padding:4px 8px; font-size:12px;" list="settings-agent-datalist">
                         <button type="button" class="btn ghost btn-xs" data-action="fetch-models" data-target="agentModel" style="white-space:nowrap;font-size:10px;">读取</button>
                       </div>
                       <datalist id="settings-agent-datalist"></datalist>
                       <label style="color:#a39f98; font-size:11px;">Critic 模型 (建议廉价模型)</label>
                       <div style="display:flex;gap:8px;">
                         <input type="text" name="criticModel" value="${getAgentConfig().criticModel || ''}" placeholder="留空使用主模型" style="flex:1;background:#111; color:#e8e4d9; border:1px solid rgba(198,156,109,0.15); border-radius:4px; padding:4px 8px; font-size:12px;" list="settings-critic-datalist">
                         <button type="button" class="btn ghost btn-xs" data-action="fetch-models" data-target="criticModel" style="white-space:nowrap;font-size:10px;">读取</button>
                       </div>
                       <datalist id="settings-critic-datalist"></datalist>
                     </div>
                   </div>
                </section>
              </div>

              <!-- Tab 3: 变量更新 -->
              <div class="tab-pane" id="tab-variable">
                <div class="pane-grid">
                  <section>
                    <h3>变量更新模型</h3>
                    <p class="setting-note">与主叙事模型完全分离。留空的 API、Key、模型与后端会实时继承主模型配置。</p>
                    <div class="grid variable-grid">
                      <label>启用变量更新</label>
                      <input type="checkbox" name="varUpdaterEnabled" ${apiConfig.variableUpdater?.enabled ? 'checked' : ''}>
                      <label>后端类型</label>
                      <select name="varUpdaterBackend">
                        <option value="inherit">跟随主模型</option>
                        <option value="openai">OpenAI 兼容</option>
                        <option value="claude">Claude / Anthropic</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="custom">自定义兼容</option>
                      </select>
                      <label>API 地址</label>
                      <input type="text" name="varUpdaterApiUrl" value="${escAttr(apiConfig.variableUpdater?.apiUrl || '')}" placeholder="留空继承主 API 地址">
                      <label>API Key</label>
                      <input type="password" name="varUpdaterApiKey" value="${escAttr(apiConfig.variableUpdater?.apiKey || '')}" placeholder="留空继承主 API Key">
                      <label>变量模型</label>
                      <div class="inline-field">
                        <input type="text" name="varUpdaterModel" value="${escAttr(apiConfig.variableUpdater?.model || '')}" placeholder="留空继承主模型">
                        <button type="button" class="btn ghost btn-xs" data-action="fetch-models" data-target="varUpdaterModel">读取</button>
                      </div>
                      <label>Temperature</label>
                      <input type="number" name="varUpdaterTemperature" min="0" max="2" step="0.05" value="${apiConfig.variableUpdater?.temperature ?? 0.9}">
                      <label>Max Tokens</label>
                      <input type="number" name="varUpdaterMaxTokens" min="256" max="32768" step="256" value="${apiConfig.variableUpdater?.maxTokens ?? 8192}">
                      <label>超时（毫秒）</label>
                      <input type="number" name="varUpdaterTimeout" min="0" step="1000" value="${apiConfig.variableUpdater?.timeoutMs ?? 120000}" title="0 表示不限制">
                      <label>流式传输</label>
                      <input type="checkbox" name="varUpdaterStreaming" ${apiConfig.variableUpdater?.streaming !== false ? 'checked' : ''}>
                    </div>
                  </section>
                  <section>
                    <h3>变量更新预设</h3>
                    <div class="prompt-preset-card">
                      <strong id="variable-preset-name">${escHtml(variablePreset.name || '未命名变量更新预设')}</strong>
                      <span id="variable-preset-count">${variablePreset.entries?.length || 0} 个预设条目 · ${variablePreset.entries?.filter(entry => entry.enabled !== false).length || 0} 个已启用</span>
                      <p>可查看并编辑真实 system/user role 链，支持保存、JSON 导入、JSON 导出、增删排序和恢复默认。运行时直接读取此预设，不再使用隐藏硬编码内容。</p>
                      <button class="btn primary" type="button" data-action="open-variable-updater-preset-editor">编辑 / 导入 / 导出</button>
                    </div>
                  </section>
                </div>
              </div>

              <!-- Tab 4: 世界书与预设 -->
              <div class="tab-pane" id="tab-lore">
                <section style="margin-bottom: 32px;">
                   <h3>世界书管理 · 知识库</h3>
                   <div style="background:#070a0e; border:1px solid rgba(198,156,109,0.3); border-radius:8px; padding:20px; text-align:center; color:#e8e4d9;">
                     <p style="margin-top:0; margin-bottom:16px; font-size:13px; color:#a39f98;">使用可视化的编辑器管理、导入和导出游戏内的世界书条目。</p>
                     <button class="btn primary" type="button" data-action="open-worldbook-editor">打开世界书编辑器</button>
                   </div>
                </section>
                <section>
                   <h3>预设管理</h3>
                   <div style="display:flex;flex-direction:column;gap:12px;">
                     <div style="background:#070a0e; border:1px solid rgba(198,156,109,0.3); border-radius:8px; padding:20px;">
                       <p style="margin-top:0; margin-bottom:12px; font-size:13px; color:#e8e4d9; font-weight:700;">主预设 · Narutomech</p>
                       <p style="margin-top:0; margin-bottom:16px; font-size:12px; color:#a39f98; line-height:1.6;">管理文风破限、角色扮演、CoT回映等高级预设条目。支持开关、增删、修改、拖拽排序。</p>
                       <button class="btn primary" type="button" data-action="open-main-preset-editor">打开主预设编辑器</button>
                    </div>
                 </section>
              </div>

              <!-- Tab 4: 忍道音律 -->
              <div class="tab-pane" id="tab-audio">
                <section>
                   <h3>音乐库 · 忍道韵律</h3>
                   <div class="music-panel">
                      <div class="music-player-bar">
                        <div class="music-info">
                          <span class="music-now" id="music-now">尚未选择曲目</span>
                          <span class="music-status" id="music-playing-artist"></span>
                        </div>
                        <div class="music-controls">
                          <label><input type="checkbox" name="musicEnabled"> 启用</label>
                          <label><input type="checkbox" name="musicLoop"> 轮播</label>
                          <label><input type="checkbox" name="musicShuffle"> 随机</label>
                          <label>音量 <input type="range" name="musicVolume" min="0" max="100" value="${s.musicVolume}"></label>
                          <button class="btn ghost" type="button" data-action="toggle-lyrics" style="padding:4px 8px;">歌词</button>
                          <button class="btn ghost" type="button" data-action="sync-favorites-up" style="padding:4px 8px;" title="上传收藏到云端">☁↑</button>
                          <button class="btn ghost" type="button" data-action="sync-favorites-down" style="padding:4px 8px;" title="从云端下载收藏">☁↓</button>
                          <span class="music-sync-status" id="music-sync-status"></span>
                        </div>
                      </div>
                     <div class="music-search-row">
                       <input type="text" name="musicSearch" placeholder="搜索全球音乐库，例如：火影忍者 青鸟">
                       <button class="btn" type="button" data-action="search-music">探索</button>
                     </div>
                     <div class="music-tabs"><button class="music-tab active" data-tab="search">搜索结果</button><button class="music-tab" data-tab="playlist">播放历史</button><button class="music-tab" data-tab="favorites">收藏曲目</button></div>
                     <div class="music-result-list" id="music-result-list">
                        <div class="music-empty-hint">在上方输入歌名或歌手，例如「火影忍者 青鸟」，按下探索</div>
                     </div>
                   </div>
                </section>
              </div>

              <!-- Tab: 记忆编年 -->
              <div class="tab-pane" id="tab-memory">
                <memory-panel></memory-panel>
              </div>

              <!-- Tab 5: 系统与归档 -->
              <div class="tab-pane" id="tab-system">
                <div class="pane-grid">
                  <section>
                     <h3>输出显示</h3>
                     <div class="grid">
                       <label>变量摘要</label>
                       <input type="checkbox" name="showVariableSummary">
                       <label>思维链展开</label>
                       <input type="checkbox" name="reasoningOpen">
                       <label>战术战斗面板</label>
                       <input type="checkbox" name="tacticalCombat">
                     </div>
                  </section>
                  <section>
                     <h3>存档管理 · 时间线归档</h3>
                     <div style="background:#070a0e; border:1px solid rgba(198,156,109,0.3); border-radius:8px; padding:20px;">
                       <div class="grid" style="grid-template-columns:auto 1fr; gap:10px 16px; align-items:center;">
                         <label style="color:#e8e4d9;">自动归档老节点</label>
                         <input type="checkbox" name="autoArchive">
                       </div>
                       <p style="margin:12px 0 0; font-size:11px; color:#a39f98; line-height:1.6;">
                         开启后,当分支节点超过 100 个时,自动归档 20 个最近祖先之外的旧节点(清空快照与对话历史,保留叙事内容)。
                         归档后跳转旧回合会沿祖先链精确重放状态。
                       </p>
                       <div style="display:flex; gap:12px; margin-top:16px; flex-wrap:wrap; align-items:center;">
                         <button class="btn" type="button" data-action="check-storage" style="padding:8px 16px;">查看库体积</button>
                         <button class="btn" type="button" data-action="manual-archive" style="padding:8px 16px;">立即归档</button>
                         <span id="storage-info" style="font-size:11px; color:#a39f98;"></span>
                       </div>
                     </div>
                  </section>
                </div>
              </div>

            </main>
          </div>
          <div class="actions">
            <button class="btn ghost" data-action="reset">重置</button>
            <button class="btn" data-action="api-settings">契约端点</button>
            <button class="btn" data-action="export">导出设置</button>
            <button class="btn" data-action="import">导入设置</button>
            <button class="btn" data-action="close">返回</button>
            <button class="btn primary" data-action="save">封印保存</button>
          </div>
        </div>
      </div>`;
    this._bind();
  }

  _hydrate() {
    const s = this._settings;
    for (const [name, value] of Object.entries(s)) {
      if (name === 'bgmList' || name === 'ambientList' || name === 'backgroundFile' || name === 'musicSearch') continue;
      this._set(name, Array.isArray(value) ? JSON.stringify(value, null, 2) : value);
    }
    this._set('fontPreset', s.fontPreset || this._inferFontPreset(s.fontFamily));
    if (localStorage.getItem('naruto_music_loop') !== null) this._set('musicLoop', this._getLoop());
    if (localStorage.getItem('naruto_music_shuffle') !== null) this._set('musicShuffle', this._getShuffle());
    this._set('varUpdaterBackend', stateManager.getAPIConfig()?.variableUpdater?.backend || 'inherit');
  }

  _set(name, value) {
    const el = this.shadowRoot.querySelector(`[name="${name}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value ?? '';
  }

  _get(name, fallback = '') {
    const el = this.shadowRoot.querySelector(`[name="${name}"]`);
    if (!el) return fallback;
    return el.type === 'checkbox' ? el.checked : el.value;
  }

  _bind() {
    this.shadowRoot.querySelector('.backdrop').addEventListener('click', e => { if (e.target.dataset.close) this.close(); });
    this.shadowRoot.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', (e) => this._handle(btn.dataset.action, e)));
    this.shadowRoot.querySelector('[name="themePreset"]').addEventListener('change', () => this._applyThemeToFields());
    this.shadowRoot.querySelector('[name="fontPreset"]').addEventListener('change', () => this._applyFontPreset());
    this.shadowRoot.querySelector('[name="musicEnabled"]').addEventListener('change', () => this._syncAudio());
    this.shadowRoot.querySelector('[name="musicLoop"]').addEventListener('change', () => { this._setLoop(this._get('musicLoop')); this._syncAudio(); });
    this.shadowRoot.querySelector('[name="musicShuffle"]').addEventListener('change', () => { this._setShuffle(this._get('musicShuffle')); });
    this.shadowRoot.querySelector('[name="musicVolume"]').addEventListener('input', () => this._syncAudio());
    this.shadowRoot.querySelectorAll('.music-tab').forEach(t => t.addEventListener('click', () => this._switchMusicTab(t.dataset.tab)));
    const syncUpBtn = this.shadowRoot.querySelector('[data-action="sync-favorites-up"]');
    if (syncUpBtn) syncUpBtn.addEventListener('click', () => this._syncFavoritesToServer());
    const syncDownBtn = this.shadowRoot.querySelector('[data-action="sync-favorites-down"]');
    if (syncDownBtn) syncDownBtn.addEventListener('click', () => this._syncFavoritesFromServer());
    this.shadowRoot.querySelector('[name="backgroundFile"]')?.addEventListener('change', event => this._importBackgroundFile(event));

    this.shadowRoot.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.shadowRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.shadowRoot.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        this.shadowRoot.getElementById(btn.dataset.target)?.classList.add('active');
        const mp = this.shadowRoot.querySelector('memory-panel');
        if (btn.dataset.target === 'tab-memory' && mp) mp.refreshStats();
      });
    });

  }

  async _handle(action, event) {
    if (action === 'close') return this.close();
    if (action === 'save') return this._save();
    if (action === 'api-settings') { this.close(); return eventBus.emit('app:open-api-settings'); }
    if (action === 'reset') return this._reset();
    if (action === 'export') {
      const json = JSON.stringify(mergeSettings(stateManager.getSub('_ui').settings), null, 2);
      return GameModal.prompt({ title: '复制配置 JSON', message: '选中下方文本框内容，按 Ctrl+C 复制', value: json, multiline: true, rows: 10, okLabel: '关闭', cancelLabel: '取消' });
    }
    if (action === 'import') return this._import();
    if (action === 'search-music') return this._searchMusic();
    if (action === 'toggle-lyrics') return this._toggleLyrics();
    
    if (action === 'open-main-preset-editor') {
      const editor = document.createElement('main-preset-editor');
      (document.getElementById('app') || document.body).appendChild(editor);
      return;
    }

    if (action === 'open-variable-updater-preset-editor') {
      const editor = document.createElement('variable-updater-preset-editor');
      editor.addEventListener('preset-saved', () => this._refreshVariablePresetSummary(), { once: true });
      (document.getElementById('app') || document.body).appendChild(editor);
      return;
    }

    if (action === 'open-worldbook-editor') {
      const editor = document.createElement('worldbook-editor');
      (document.getElementById('app') || document.body).appendChild(editor);
      return;
    }

    if (action === 'check-storage') return this._checkStorage();
    if (action === 'manual-archive') return this._manualArchive();
    if (action === 'fetch-models') return this._fetchModelsFor(event.target);
  }

  async _checkStorage() {
    const info = this.shadowRoot.querySelector('#storage-info');
    if (info) info.textContent = '统计中...';
    try {
      const { timelineSystem } = await import('../systems/timeline-system.js');
      const stats = await timelineSystem.getStorageStats();
      const kb = Math.round(stats.estimatedBytes / 1024);
      const mb = (stats.estimatedBytes / 1024 / 1024).toFixed(2);
      const text = `节点 ${stats.totalNodes} (活跃 ${stats.activeCount} / 归档 ${stats.archivedCount}) · ${kb >= 1024 ? mb + ' MB' : kb + ' KB'}`;
      if (info) info.textContent = text;
    } catch (e) {
      if (info) info.textContent = '查询失败: ' + e.message;
    }
  }

  async _manualArchive() {
    const confirmed = await customElements.get('game-modal').confirm({
      title: '立即归档',
      message: '将归档所有分支中 20 个最近祖先之外的旧节点。归档后跳转旧回合会沿祖先链精确重放状态。继续?',
      okLabel: '确认归档',
      cancelLabel: '取消'
    });
    if (!confirmed) return;
    const { timelineSystem } = await import('../systems/timeline-system.js');
    const result = await timelineSystem.manualArchive();
    if (result.running) {
      this._checkStorage();
      return;
    }
    this._showToast(`已归档 ${result.archived || 0} 个节点`);
    this._checkStorage();
  }

  async _fetchModelsFor(btn) {
    const targetName = btn?.dataset?.target;
    if (!targetName) return;
    const mainConfig = stateManager.getAPIConfig() || {};
    const apiConfig = targetName === 'varUpdaterModel' ? {
      ...mainConfig,
      ...(mainConfig.variableUpdater || {}),
      backend: this._get('varUpdaterBackend') === 'inherit' ? mainConfig.backend : this._get('varUpdaterBackend'),
      apiUrl: this._get('varUpdaterApiUrl') || mainConfig.apiUrl,
      apiKey: this._get('varUpdaterApiKey') || mainConfig.apiKey
    } : mainConfig;
    if (!apiConfig.apiUrl) {
      this._showToast('请先在契约卷轴中配置 API 地址');
      return;
    }
    btn.disabled = true;
    btn.textContent = '读取中...';
    try {
      const { default: aiClient } = await import('../core/ai-client.js');
      const models = await aiClient.listModels(apiConfig);
      if (!models.length) throw new Error('空模型列表');
      const input = this.shadowRoot.querySelector(`[name="${targetName}"]`);
      if (!input) return;
      // Find or create model list container
      let listEl = this.shadowRoot.querySelector(`#list-${targetName}`);
      if (!listEl) {
        listEl = document.createElement('div');
        listEl.id = `list-${targetName}`;
        listEl.style.cssText = 'max-height:180px;overflow-y:auto;margin-top:4px;border:1px solid rgba(198,156,109,0.2);border-radius:6px;background:rgba(7,10,14,0.95);';
        input.parentElement.appendChild(listEl);
      }
      listEl.innerHTML = models.map(id =>
        `<div style="padding:7px 10px;cursor:pointer;font-size:12px;color:#a39f98;border-bottom:1px solid rgba(255,255,255,0.04);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" data-model="${escAttr(id)}">${escHtml(id)}</div>`
      ).join('');
      listEl.querySelectorAll('div').forEach(item => {
        item.addEventListener('click', () => {
          input.value = item.dataset.model;
          listEl.querySelectorAll('div').forEach(i => i.style.cssText = i.style.cssText.replace(/border-left:.*?;/, ''));
          item.style.cssText += ';background:rgba(235,97,63,0.12);color:#ff8a65;border-left:3px solid #eb613f;';
        });
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(198,156,109,0.1)'; item.style.color = '#e8e4d9'; });
        item.addEventListener('mouseleave', () => {
          if (!item.style.cssText.includes('border-left')) { item.style.background = ''; item.style.color = ''; }
        });
      });
      if (!input.value && models[0]) {
        input.value = models[0];
        listEl.querySelector('div')?.setAttribute('style', listEl.querySelector('div')?.getAttribute('style') + ';background:rgba(235,97,63,0.12);color:#ff8a65;border-left:3px solid #eb613f;');
      }
      this._showToast(`已读取 ${models.length} 个模型`);
    } catch (e) {
      this._showToast('模型读取失败: ' + (e.message || '未知错误'));
    } finally {
      btn.disabled = false;
      btn.textContent = '读取';
    }
  }

  _collect() {
    return mergeSettings({
      themePreset: this._get('themePreset'), fontPreset: this._get('fontPreset'), fontFamily: this._resolveFontFamily(), fontSize: this._get('fontSize'), lineHeight: this._get('lineHeight'), chatMaxWidth: this._get('chatMaxWidth'),
      paragraphIndent: this._get('paragraphIndent'), aiCardStyle: this._get('aiCardStyle'), textColor: this._get('textColor'), accentColor: this._get('accentColor'), goldColor: this._get('goldColor'),
      backgroundColor: this._get('backgroundColor'), backgroundImage: this._get('backgroundImage'), backgroundOpacity: this._get('backgroundOpacity'), showVariableSummary: this._get('showVariableSummary'), reasoningOpen: this._get('reasoningOpen'), tacticalCombat: this._get('tacticalCombat'), autoArchive: this._get('autoArchive'),
      musicEnabled: this._get('musicEnabled'), musicVolume: this._get('musicVolume'), musicLoop: this._get('musicLoop'), musicShuffle: this._get('musicShuffle')
    });
  }

  async _save() {
    const settings = this._collect();
    stateManager.update([{ key: '_ui.settings', op: '=', value: settings }]);

    this._saveAgentConfig();
    await this._saveVariableUpdaterConfig();

    try {
      await stateManager.saveUIPrefs();
    } catch (error) {
      try { await stateManager.saveLargeUIPrefs(); } catch { console.warn('saveLargeUIPrefs failed'); }
      GameModal.alert({ title: '提示', message: '设置已应用。背景图过大，刷新后可能丢失。' });
    }

    applyLocalSettings(settings);
    this.close();
    eventBus.emit('settings:changed', settings);
  }

  _saveAgentConfig() {
    const root = this.shadowRoot;
    saveAgentConfig({
      enabled: root.querySelector('[name="agentEnabled"]')?.checked ?? false,
      mode: root.querySelector('[name="agentMode"]')?.value || 'standard',
      autoUpgrade: root.querySelector('[name="agentAutoUpgrade"]')?.checked ?? true,
      agentModel: (root.querySelector('[name="agentModel"]')?.value || '').trim(),
      criticModel: (root.querySelector('[name="criticModel"]')?.value || '').trim()
    });
  }

  async _saveVariableUpdaterConfig() {
    const root = this.shadowRoot;
    const enabled = root.querySelector('[name="varUpdaterEnabled"]')?.checked ?? false;
    const config = stateManager.getAPIConfig() || {};
    const model = (root.querySelector('[name="varUpdaterModel"]')?.value || '').trim();
    const apiUrl = (root.querySelector('[name="varUpdaterApiUrl"]')?.value || '').trim();
    const apiKey = (root.querySelector('[name="varUpdaterApiKey"]')?.value || '').trim();
    const temperature = Number(root.querySelector('[name="varUpdaterTemperature"]')?.value);
    config.variableUpdater = {
      ...config.variableUpdater,
      enabled,
      backend: root.querySelector('[name="varUpdaterBackend"]')?.value || 'inherit',
      apiUrl,
      apiKey,
      model,
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.9,
      maxTokens: Math.max(256, Number(root.querySelector('[name="varUpdaterMaxTokens"]')?.value) || 8192),
      timeoutMs: Math.max(0, Number(root.querySelector('[name="varUpdaterTimeout"]')?.value) || 0),
      streaming: root.querySelector('[name="varUpdaterStreaming"]')?.checked ?? true
    };
    await stateManager.saveAPIConfig(config);
  }

  _refreshVariablePresetSummary() {
    const preset = getVariableUpdaterPreset();
    const name = this.shadowRoot.querySelector('#variable-preset-name');
    const count = this.shadowRoot.querySelector('#variable-preset-count');
    if (name) name.textContent = preset.name || '未命名变量更新预设';
    if (count) count.textContent = `${preset.entries?.length || 0} 个预设条目 · ${preset.entries?.filter(entry => entry.enabled !== false).length || 0} 个已启用`;
  }

  async _reset() {
    const confirmed = await customElements.get('game-modal').confirm({
      title: '恢复默认设置',
      message: '确定恢复所有系统设置到默认值吗？此操作不会影响 API 配置和存档。',
      okLabel: '恢复默认',
      cancelLabel: '取消'
    });
    if (!confirmed) return;
    stateManager.update([{ key: '_ui.settings', op: '=', value: DEFAULT_SETTINGS }]);
    await stateManager.saveUIPrefs?.();
    applyLocalSettings(DEFAULT_SETTINGS);
    this.close();
  }

  async _import() {
    const text = await GameModal.prompt({ title: '粘贴配置 JSON', message: '将配置 JSON 粘贴到下方文本框', placeholder: '{ ... }', multiline: true, rows: 10, okLabel: '导入', cancelLabel: '取消' });
    if (!text) return;
    try {
      const settings = mergeSettings(JSON.parse(text));
    stateManager.update([{ key: '_ui.settings', op: '=', value: settings }]);
      await stateManager.saveUIPrefs?.();
      applyLocalSettings(settings);
      this.close();
    } catch { GameModal.alert({ title: '导入失败', message: '配置 JSON 不合法' }); }
  }

  _applyThemeToFields() {
    const preset = THEME_PRESETS[this._get('themePreset')];
    if (!preset) return;
    this._set('textColor', preset.textColor); this._set('accentColor', preset.accentColor); this._set('goldColor', preset.goldColor); this._set('backgroundColor', preset.backgroundColor);
  }

  _applyFontPreset() {
    const preset = FONT_PRESETS[this._get('fontPreset')];
    if (preset?.family) this._set('fontFamily', preset.family);
  }

  async _importBackgroundFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return GameModal.alert({ title: '文件类型错误', message: '请选择图片文件' });
    const dataUrl = await this._fileToCompressedDataUrl(file);
    this._set('backgroundImage', dataUrl);
    this._preview = dataUrl;
    document.body.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.28),rgba(0,0,0,0.28)),url("${dataUrl}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.dataset.bgMode = 'image';
    GameModal.alert({ title: '背景图已导入', message: '已即时预览。请点击"封印保存"将其持久化。' });
  }

  async _fileToCompressedDataUrl(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });
      const maxSide = 1920;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  _resolveFontFamily() {
    const preset = this._get('fontPreset', 'system');
    if (preset === 'custom') return this._get('fontFamily');
    return FONT_PRESETS[preset]?.family || FONT_PRESETS.system.family;
  }

  _inferFontPreset(fontFamily = '') {
    if (fontFamily.includes('Shippori') || fontFamily.includes('Songti') || fontFamily.includes('SimSun')) return 'serif';
    if (fontFamily.includes('Klee') || fontFamily.includes('Kaiti') || fontFamily.includes('KaiTi')) return 'kai';
    if (fontFamily.includes('JetBrains') || fontFamily.includes('monospace')) return 'mono';
    if (fontFamily.includes('FangSong') || fontFamily.includes('STFangsong')) return 'fangsong';
    if (fontFamily.includes('Ma Shan')) return 'brush';
    if (fontFamily.includes('SimSun')) return 'song';
    return 'system';
  }

  async _searchMusic() {
    const query = this._get('musicSearch').trim();
    if (!query) return GameModal.alert({ title: '提示', message: '请输入搜索关键词' });
    this._activeTab = 'search';
    this.shadowRoot.querySelectorAll('.music-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'search'));
    const list = this.shadowRoot.querySelector('#music-result-list');
    list.innerHTML = '<div class="music-empty-hint">正在结印搜索中...</div>';
    try {
      const url = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      if (!response.ok) { list.innerHTML = `<div class="music-empty-hint">搜索失败: HTTP ${response.status}</div>`; return; }
      const res = await response.json();
      list.innerHTML = '';
      if (!res || res.code !== 200 || !res.data || !res.data.length) {
        list.innerHTML = '<div class="music-empty-hint">未找到相关音乐，换个关键词试试</div>';
        return;
      }
      this._searchCache = res.data.slice(0, 20);
      this._renderMusicList(this._searchCache, 'search');
    } catch (e) { list.innerHTML = `<div class="music-empty-hint">搜索失败: ${esc(e.message)}</div>`; }
  }

  _switchMusicTab(tab) {
    this._activeTab = tab;
    this.shadowRoot.querySelectorAll('.music-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const list = this.shadowRoot.querySelector('#music-result-list');
    if (tab === 'search') this._renderMusicList(this._searchCache || [], 'search');
    else if (tab === 'playlist') this._renderMusicList(this._getPlaylist(), 'playlist');
    else if (tab === 'favorites') {
      this._renderMusicList(this._getFavorites(), 'favorites');
      if (!this._favoritesTabVisited) { this._favoritesTabVisited = true; this._syncFavoritesFromServer(); }
    }
  }

  _getPlaylist() {
    try { return JSON.parse(localStorage.getItem('naruto_music_playlist') || '[]'); } catch { return []; }
  }
  _savePlaylist(songs) { localStorage.setItem('naruto_music_playlist', JSON.stringify(songs.slice(-50))); }

  _getLoop() { return localStorage.getItem('naruto_music_loop') === 'true'; }
  _setLoop(v) { localStorage.setItem('naruto_music_loop', !!v); }
  _getShuffle() { return localStorage.getItem('naruto_music_shuffle') === 'true'; }
  _setShuffle(v) { localStorage.setItem('naruto_music_shuffle', !!v); }

  _getFavorites() {
    try { return JSON.parse(localStorage.getItem('naruto_music_favorites') || '[]'); } catch { return []; }
  }
  _saveFavorites(songs) { localStorage.setItem('naruto_music_favorites', JSON.stringify(songs.slice(-100))); }
  _isFavorited(song) { return this._getFavorites().some(f => (f.url_id || f.mid || f.id) === (song.url_id || song.mid || song.id)); }
  _toggleFavorite(song) {
    const favs = this._getFavorites();
    const sid = song.url_id || song.mid || song.id;
    const idx = favs.findIndex(f => (f.url_id || f.mid || f.id) === sid);
    const wasRemoved = idx >= 0;
    if (wasRemoved) {
      favs.splice(idx, 1);
      this._removeFavoriteFromServer(sid);
    } else {
      favs.push(song);
      this._pushFavoriteToServer(song);
    }
    this._saveFavorites(favs);
    if (this._activeTab === 'favorites') this._renderMusicList(favs, 'favorites');
    else this._renderMusicList(this._activeTab === 'playlist' ? this._getPlaylist() : (this._searchCache || []), this._activeTab || 'search');
  }

  _setSyncStatus(msg, isError) {
    const el = this.shadowRoot?.querySelector('#music-sync-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#f87171' : '#81C784';
    if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; } }, 3000);
  }

  async _fetchWithAuth(url, options = {}) {
    try {
      const res = await fetch(url, { ...options, credentials: 'same-origin' });
      if (res.status === 401) return null;
      if (res.ok) return res;
      return null;
    } catch { return null; }
  }

  async _pushFavoriteToServer(song) {
    const res = await this._fetchWithAuth('/api/music/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song })
    });
    if (res) this._setSyncStatus('已同步');
  }

  async _removeFavoriteFromServer(songId) {
    const res = await this._fetchWithAuth(`/api/music/favorites/${encodeURIComponent(songId)}`, { method: 'DELETE' });
    if (res) this._setSyncStatus('已同步');
  }

  async _syncFavoritesToServer() {
    this._setSyncStatus('上传中...');
    const favs = this._getFavorites();
    if (!favs.length) { this._setSyncStatus('收藏为空', true); return; }
    const res = await this._fetchWithAuth('/api/music/favorites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites: favs })
    });
    if (res) {
      const data = await res.json().catch(() => ({}));
      this._setSyncStatus(`已上传 ${data.count || favs.length} 首`);
    } else {
      this._setSyncStatus('上传失败(未登录或网络错误)', true);
    }
  }

  async _syncFavoritesFromServer() {
    this._setSyncStatus('下载中...');
    const res = await this._fetchWithAuth('/api/music/favorites');
    if (!res) { this._setSyncStatus('下载失败(未登录或网络错误)', true); return; }
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.favorites)) { this._setSyncStatus('数据格式错误', true); return; }
    const serverSongs = data.favorites;
    if (!serverSongs.length) { this._setSyncStatus('云端无收藏', true); return; }
    const local = this._getFavorites();
    const localIds = new Set(local.map(s => s.url_id || s.mid || s.id));
    const merged = [...local];
    let added = 0;
    for (const s of serverSongs) {
      const sid = s.url_id || s.mid || s.id;
      if (!localIds.has(sid)) { merged.push(s); localIds.add(sid); added++; }
    }
    this._saveFavorites(merged.slice(0, 100));
    this._setSyncStatus(`已下载 ${serverSongs.length} 首，新增 ${added} 首`);
    if (this._activeTab === 'favorites') this._renderMusicList(this._getFavorites(), 'favorites');
  }

  _renderMusicList(songs, source) {
    const list = this.shadowRoot.querySelector('#music-result-list');
    if (!songs || !songs.length) { list.innerHTML = '<div class="music-empty-hint">此处空空如也——搜索并播放后，曲目会留在此处</div>'; return; }
    const favs = this._getFavorites();
    list.innerHTML = '';
    songs.forEach(song => {
      const songId = song.url_id || song.mid || song.id || '';
      const isFav = favs.some(f => (f.url_id || f.mid || f.id) === songId);
      const name = song.name || song.title || song.song || '?';
      const artist = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || song.singer || '');
      const item = document.createElement('div');
      item.className = 'music-item';
      item.innerHTML = `<div class="music-item-info"><span class="music-item-name">${esc(name)}</span><span class="music-item-artist">${esc(artist)}</span></div><span class="music-item-fav${isFav?' favorited':''}" data-action="fav" data-song='${esc(JSON.stringify(song))}' style="font-size:15px;cursor:pointer;">★</span><span class="music-play-icon">▶</span>`;
      item.querySelector('.music-play-icon').addEventListener('click', e => { e.stopPropagation(); this._playSong(song); });
      item.querySelector('.music-item-fav').addEventListener('click', e => { e.stopPropagation(); this._toggleFavorite(song); });
      item.addEventListener('click', () => this._playSong(song));
      list.appendChild(item);
    });
  }

  async _playSong(song) {
    if (!this._get('musicEnabled')) return;
    const name = song.name || song.title || song.song || '?';
    const artist = Array.isArray(song.artist) ? song.artist.join(' / ') : (song.artist || song.singer || '');
    this._nowPlayingSong = song;
    this._nowPlaying = name;
    const nowEl = this.shadowRoot.querySelector('#music-now');
    const artistEl = this.shadowRoot.querySelector('#music-playing-artist');
    if (nowEl) nowEl.textContent = '♪ 加载中...';
    if (artistEl) artistEl.textContent = '';

    let playUrl = '';
    let fetchError = '';
    try {
      const key = song.mid || song.url_id || song.id || '';
      if (!key) throw new Error('缺少歌曲标识');
      const urlRes = await fetch(`https://api.vkeys.cn/v2/music/tencent?mid=${key}`);
      if (!urlRes.ok) throw new Error(`API 返回 ${urlRes.status}`);
      const urlJson = await urlRes.json();
      playUrl = (urlJson && urlJson.data && urlJson.data.url) || '';
      if (!playUrl) throw new Error(urlJson?.msg || urlJson?.message || '无播放地址');
    } catch (e) {
      fetchError = e.message || '未知错误';
      if (nowEl) nowEl.textContent = `解析失败: ${fetchError}`;
      if (artistEl) artistEl.textContent = '';
      return;
    }

    localAudio.bgm?.pause();
    const audio = new Audio(playUrl);
    audio.volume = (parseInt(this._get('musicVolume')) || 45) / 100;
    this._lyrics = [];

    audio.addEventListener('canplay', async () => {
      if (nowEl) nowEl.textContent = `♪ ${name}`;
      if (artistEl) artistEl.textContent = artist;
      audio.play().catch(() => {});
      this._syncPlayBtn();
      this._updateLyricsWindow(name, artist);
      await this._fetchMetingLyrics(song);
    });

    audio.addEventListener('timeupdate', () => {
      const idx = this._findLyricIndex(audio.currentTime);
      const active = idx >= 0 ? this._lyrics[idx].txt : '';
      this._updateLyricsWindow(active || name, artist);
    });

    audio.addEventListener('pause', () => this._syncPlayBtn());
    audio.addEventListener('play', () => this._syncPlayBtn());
    audio.addEventListener('ended', () => {
      this._syncPlaylist(song);
      this._syncPlayBtn();
      const loop = this._getLoop();
      const shuffle = this._getShuffle();
      if (loop && !shuffle) audio.play().catch(() => {});
      else { localAudio.bgm = null; this._playNextQueued(); }
    });

    audio.addEventListener('error', () => {
      const codes = { 1: '加载中止', 2: '网络错误', 3: '解码失败', 4: '格式不支持' };
      const errMsg = codes[audio.error?.code] || audio.error?.message || '未知错误';
      if (nowEl) nowEl.textContent = `播放失败: ${errMsg}`;
      this._playNextQueued();
    });

    localAudio.bgm = audio;
    this._syncAudio();
    this._syncPlaylist(song);
  }

  _syncPlaylist(song) {
    if (!song) return;
    const list = this._getPlaylist();
    const id = song.url_id || song.mid || song.id;
    const exists = list.findIndex(item => (item.url_id || item.mid || item.id) === id);
    if (exists >= 0) list.splice(exists, 1);
    list.unshift(song);
    this._savePlaylist(list);
  }

  _playNextQueued() {
    const favs = this._getFavorites();
    if (!favs.length) return;
    const shuffle = this._getShuffle();
    const sid = this._nowPlayingSong?.url_id || this._nowPlayingSong?.mid || this._nowPlayingSong?.id;
    const curIdx = sid ? favs.findIndex(s => (s.url_id || s.mid || s.id) === sid) : -1;
    if (shuffle) {
      let next = favs[Math.floor(Math.random() * favs.length)];
      if (favs.length > 1 && (next.url_id || next.mid || next.id) === sid) {
        const others = favs.filter(s => (s.url_id || s.mid || s.id) !== sid);
        next = others[Math.floor(Math.random() * others.length)];
      }
      if (next) this._playSong(next);
    } else {
      const nextIdx = (curIdx >= 0 && curIdx + 1 < favs.length) ? curIdx + 1 : 0;
      const next = favs[nextIdx];
      if (next && (next.url_id || next.mid || next.id) !== sid) this._playSong(next);
    }
  }

  _syncAudio() {
    const audio = localAudio.bgm;
    if (!audio) return;
    audio.volume = (parseInt(this._get('musicVolume')) || 45) / 100;
    audio.muted = !this._get('musicEnabled');
  }

  async _fetchMetingLyrics(song) {
    try {
      const rawTitle = song.name || song.title || song.song || '';
      const artist = Array.isArray(song.artist) ? song.artist[0] : (song.artist || song.singer || '');
      if (!rawTitle) { this._lyrics = []; return; }

      const cleanTitles = [rawTitle];
      const stripped = rawTitle.replace(/[（(].*?[）)]/g, '').replace(/\s*-\s*(Live|Remix|Cover|Acoustic|Instrumental).*/i, '').trim();
      if (stripped && stripped !== rawTitle) cleanTitles.push(stripped);
      const short = rawTitle.replace(/[（(].*?[）)]/g, '').trim();
      if (short && short !== rawTitle && short !== stripped) cleanTitles.push(short);

      let lrc = '';
      for (const title of cleanTitles) {
        try {
          const r = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist || '')}&track_name=${encodeURIComponent(title)}`);
          if (r.ok) {
            const j = await r.json();
            if (j?.syncedLyrics) { lrc = j.syncedLyrics; break; }
            if (j?.plainLyrics) { lrc = j.plainLyrics; break; }
          }
        } catch { /* next */ }
      }

      if (!lrc) { this._lyrics = []; return; }
      this._lyrics = [];
      for (const line of lrc.split('\n')) {
        const m = line.match(/\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
        if (m) { const t = parseInt(m[1])*60 + parseInt(m[2]) + (parseInt(m[3]||'0')/(m[3]?.length===3?1000:100)); const txt = m[4].trim(); if (txt) this._lyrics.push({ time: t, txt }); }
      }
      this._lyrics.sort((a, b) => a.time - b.time);
    } catch { this._lyrics = []; console.warn('[Settings] Lyrics parse failed for:', song?.name); }
  }

  _fmtTime(s) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; }

  _findLyricIndex(time) {
    const lyrics = this._lyrics;
    if (!lyrics?.length) return -1;
    let lo = 0, hi = lyrics.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (lyrics[mid].time <= time) { idx = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return idx;
  }

  _updateLyricsWindow(text, sub) {
    const el = this._lyricEl;
    if (this._lyricsHidden) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      const div = document.createElement('div');
      div.id = 'naruto-desktop-lyrics'; div.className = 'desktop-lyrics';
      (document.getElementById('app') || document.body).appendChild(div);
      this._buildLyricControls(div); this._makeDraggable(div);
      this._lyricEl = div;
      this._lyricTextEl = div.querySelector('.lyric-text');
      this._lyricSliderEl = div.querySelector('.lyric-slider');
      this._lyricTimeEl = div.querySelector('.lyric-time');
    } else if (el.style.display !== 'block') {
      el.style.display = 'block';
    }

    const textChanged = this._lastLyricLine !== text;
    if (textChanged) {
      this._lastLyricLine = text;
      if (this._lyricTextEl) this._lyricTextEl.textContent = text || '🎵 忍者手记';
    }

    const audio = localAudio.bgm;
    if (audio && isFinite(audio.duration) && !this._lyricSeeking) {
      const dur = audio.duration;
      const cur = audio.currentTime;
      const durFloor = Math.floor(dur);
      if (this._lastDuration !== durFloor && this._lyricSliderEl) {
        this._lastDuration = durFloor;
        this._lyricSliderEl.max = durFloor;
      }
      const now = performance.now();
      if (textChanged || now - this._lastSliderUpdate > 450) {
        this._lastSliderUpdate = now;
        if (this._lyricSliderEl) this._lyricSliderEl.value = Math.floor(cur);
        if (this._lyricTimeEl) this._lyricTimeEl.textContent = `${this._fmtTime(cur)} / ${this._fmtTime(dur)}`;
      }
    }
  }

  _getSvgIcon(name) {
    const icons = {
      shuffle: `<svg viewBox="0 0 24 24"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>`,
      prev: `<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`,
      play: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
      pause: `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
      next: `<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`,
      loop: `<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`,
      minimize: `<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>`,
      close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
    };
    return icons[name] || '';
  }

  _buildLyricControls(el) {
    el.innerHTML = `
    <div class="lyric-header">
      <div class="lyric-drag-handle"></div>
      <div class="lyric-window-controls">
        <button class="lyric-win-btn" data-lyric="minimize" title="最小化/恢复">${this._getSvgIcon('minimize')}</button>
        <button class="lyric-win-btn" data-lyric="close" title="关闭">${this._getSvgIcon('close')}</button>
      </div>
    </div>
    <div class="lyric-body">
      <div class="lyric-text">🎵</div><div class="lyric-slider-wrap"><input type="range" class="lyric-slider" min="0" max="100" value="0" step="1"></div><div class="lyric-time">0:00 / 0:00</div><div class="lyric-controls">
        <button class="lyric-btn" data-lyric="shuffle" title="随机播放">${this._getSvgIcon('shuffle')}</button>
        <button class="lyric-btn" data-lyric="prev" title="上一首">${this._getSvgIcon('prev')}</button>
        <button class="lyric-btn lyric-play-btn" data-lyric="play" title="播放/暂停">${this._getSvgIcon('pause')}</button>
        <button class="lyric-btn" data-lyric="next" title="下一首">${this._getSvgIcon('next')}</button>
        <button class="lyric-btn" data-lyric="loop" title="列表循环">${this._getSvgIcon('loop')}</button>
      </div>
    </div>`;

    el.querySelector('[data-lyric="minimize"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      el.classList.toggle('minimized');
    });
    el.querySelector('[data-lyric="close"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleLyrics();
    });

    if (this._getShuffle()) el.querySelector('[data-lyric="shuffle"]').classList.add('active');
    if (this._getLoop()) el.querySelector('[data-lyric="loop"]').classList.add('active');

    const slider = el.querySelector('.lyric-slider');
    slider.addEventListener('mousedown', e => { e.stopPropagation(); this._lyricSeeking = true; });
    slider.addEventListener('touchstart', e => { e.stopPropagation(); this._lyricSeeking = true; }, { passive: true });

    slider.addEventListener('input', () => {
      const t = Number(slider.value);
      const idx = this._findLyricIndex(t);
      const active = idx >= 0 ? this._lyrics[idx].txt : '';
      const textEl = this._lyricTextEl || el.querySelector('.lyric-text');
      if (textEl) textEl.textContent = active || '🎵';
      if (this._lyricTimeEl) this._lyricTimeEl.textContent = `${this._fmtTime(t)} / ${this._fmtTime(localAudio.bgm?.duration || 0)}`;
    });

    slider.addEventListener('change', () => {
      if (localAudio.bgm) localAudio.bgm.currentTime = Number(slider.value);
      this._lyricSeeking = false;
    });

    slider.addEventListener('pointerup', () => {
      if (localAudio.bgm) localAudio.bgm.currentTime = Number(slider.value);
      this._lyricSeeking = false;
    });
    slider.addEventListener('touchend', () => {
      if (localAudio.bgm) localAudio.bgm.currentTime = Number(slider.value);
      this._lyricSeeking = false;
    });

    el.querySelectorAll('.lyric-btn').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const cmd = b.dataset.lyric;
      if (cmd === 'play') { this._togglePlay(b); }
      if (cmd === 'prev' || cmd === 'next') { const list = this._getFavorites(); const sid = this._nowPlayingSong?.url_id||this._nowPlayingSong?.mid||this._nowPlayingSong?.id; const cur = list.findIndex(s => (s.url_id||s.mid||s.id) === sid); const next = cmd === 'next' ? (cur+1 < list.length ? list[cur+1] : list[0]) : (cur>0 ? list[cur-1] : list[list.length-1]); if (next && (next.url_id||next.mid||next.id) !== sid) this._playSong(next); }
      if (cmd === 'loop') { this._setLoop(!this._getLoop()); this._set('musicLoop', this._getLoop()); this._syncAudio(); b.classList.toggle('active', this._getLoop()); }
      if (cmd === 'shuffle') { this._setShuffle(!this._getShuffle()); this._set('musicShuffle', this._getShuffle()); b.classList.toggle('active', this._getShuffle()); }
    }));

  }

  _togglePlay(btn) {
    if (!localAudio.bgm) return;
    if (localAudio.bgm.paused) { localAudio.bgm.play().catch(() => {}); btn.innerHTML = this._getSvgIcon('pause'); }
    else { localAudio.bgm.pause(); btn.innerHTML = this._getSvgIcon('play'); }
  }

  _syncPlayBtn() {
    const el = this._lyricEl || document.getElementById('naruto-desktop-lyrics');
    if (!el) return;
    const btn = el.querySelector('[data-lyric="play"]');
    if (btn) btn.innerHTML = localAudio.bgm && !localAudio.bgm.paused ? this._getSvgIcon('pause') : this._getSvgIcon('play');
  }

  _toggleLyrics() {
    this._lyricsHidden = !this._lyricsHidden;
    const el = this._lyricEl || document.getElementById('naruto-desktop-lyrics');
    if (el) { el.style.display = this._lyricsHidden ? 'none' : 'block'; this._syncPlayBtn(); }
    if (this._lyricsHidden && localAudio.bgm) {
      localAudio.bgm.pause();
    }
  }

  _play(type) { /* empty: old API */ }
  _pause(type) { /* empty: old API */ }

  close() {
    this.remove();
  }

  _stopAllAudio() {
    if (localAudio.bgm) {
      localAudio.bgm.pause();
      localAudio.bgm.src = '';
      localAudio.bgm.load();
      localAudio.bgm = null;
    }
    if (localAudio.ambient) {
      localAudio.ambient.pause();
      localAudio.ambient.src = '';
      localAudio.ambient.load();
      localAudio.ambient = null;
    }
    const el = this._lyricEl || document.getElementById('naruto-desktop-lyrics');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    this._lyricEl = null;
    this._lyricTextEl = null;
    this._lyricSliderEl = null;
    this._lyricTimeEl = null;
  }

  _cleanupDragHandlers() {
    if (this._dragCleanup) {
      this._dragCleanup.forEach(fn => fn?.());
      this._dragCleanup = null;
    }
  }

  _makeDraggable(el) {
    let dragging = false, sx, sy, dx, dy, raf;
    const onDown = e => {
      if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
      dragging = true;
      const r = el.getBoundingClientRect();
      if (!el.classList.contains('dragging')) {
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.transform = 'none';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.classList.add('dragging');
      }
      const evt = e.touches ? e.touches[0] : e;
      sx = evt.clientX;
      sy = evt.clientY;
      dx = parseFloat(el.style.left) || r.left;
      dy = parseFloat(el.style.top) || r.top;
    };
    const onMove = e => {
      if (!dragging) return;
      e.preventDefault();
      const evt = e.touches ? e.touches[0] : e;
      const nx = dx + evt.clientX - sx;
      const ny = dy + evt.clientY - sy;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
        raf = null;
      });
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
    };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    this._dragCleanup = this._dragCleanup || [];
    this._dragCleanup.push(
      () => el.removeEventListener('mousedown', onDown),
      () => el.removeEventListener('touchstart', onDown),
      () => document.removeEventListener('mousemove', onMove),
      () => document.removeEventListener('touchmove', onMove),
      () => document.removeEventListener('mouseup', onUp),
      () => document.removeEventListener('touchend', onUp)
    );
  }
}

export function applyLocalSettings(settings = stateManager.getSub('_ui').settings) {
  const s = mergeSettings(settings);
  const root = document.documentElement;
  root.style.setProperty('--font-body', s.fontFamily);
  root.style.setProperty('--text-base', `${s.fontSize}px`);
  root.style.setProperty('--chat-font-size', `${s.fontSize}px`);
  root.style.setProperty('--chat-line-height', String(s.lineHeight));
  root.style.setProperty('--leading-relaxed', String(s.lineHeight));
  root.style.setProperty('--chat-max-w', `${s.chatMaxWidth}px`);
  root.style.setProperty('--text-primary', s.textColor);
  root.style.setProperty('--c-shuiro', s.accentColor);
  root.style.setProperty('--c-kin', s.goldColor);
  document.body.style.backgroundColor = s.backgroundColor;
  document.body.dataset.bgMode = 'image';
  if (s.backgroundImage && s.backgroundImage !== 'img/bg-home.png') {
    document.body.style.setProperty('--custom-bg-image', `url("${s.backgroundImage}")`);
  } else {
    document.body.style.removeProperty('--custom-bg-image');
  }
  document.body.style.setProperty('--custom-bg-opacity', String(s.backgroundOpacity));
  document.body.dataset.aiCardStyle = s.aiCardStyle;
  document.body.dataset.paragraphIndent = String(s.paragraphIndent);
}

customElements.define('settings-panel', SettingsPanel);
export default SettingsPanel;


