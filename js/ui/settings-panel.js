import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';
import { PROMPTS } from '../data/prompts.js';
import { getAgentConfig, saveAgentConfig } from '../data/agent-config.js';
import { escHtml, escAttr } from '../utils/format.js';
import GameModal from './modal.js';
import { bindCustomSelects } from './custom-select.js';

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

const DEFAULT_SETTINGS = stateManager.getDefaultState().ui_prefs.settings;
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

  connectedCallback() {
    this._settings = mergeSettings(stateManager.get('ui_prefs.settings'));
    this.render();
    this._hydrate();
    bindCustomSelects(this.shadowRoot);
  }

  disconnectedCallback() {}

  render() {
    const s = this._settings;
    this.shadowRoot.innerHTML = `
      <style>
        :host { position: fixed; inset: 0; z-index: 100000; color: var(--text-primary); font-family: var(--font-body); }
        
        .backdrop {
          position: absolute; inset: 0; background: rgba(3,4,6,0.85);
          display: flex; align-items: center; justify-content: center; padding: 24px;
          backdrop-filter: var(--blur-xl); -webkit-backdrop-filter: var(--blur-xl);
          animation: fade-in 0.3s var(--ease-out);
        }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }

        /* ── 卷轴容器 (Elegant Scroll) ──── */
        .panel {
          width: min(900px, 100%); max-height: 90vh;
          display: flex; flex-direction: column;
          background: rgba(11, 14, 19, 0.6);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-xl);
          box-shadow: var(--shadow-lg);
          position: relative;
          overflow: hidden;
        }

        /* 内部质感纹理 */
        .inner-bg {
          position: absolute; inset: 0; pointer-events: none; opacity: 0.015;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          z-index: 0; mix-blend-mode: overlay;
        }

        /* ── 头部 ──── */
        .head {
          flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center;
          padding: 32px 48px 24px; position: relative; z-index: 2;
        }
        .title { 
          font-family: var(--font-title); font-size: 24px; font-weight: 800;
          color: var(--text-primary); letter-spacing: 4px;
          display: flex; align-items: center; gap: 16px;
        }
        .title span { color: var(--text-secondary); font-family: var(--font-brush); font-size: 28px; font-weight: normal; opacity: 0.5; }
        
        .close { 
          color: var(--text-tertiary); font-size: 28px; border: none; background: transparent; 
          cursor: pointer; width: 40px; height: 40px; transition: color 0.2s;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-body); font-weight: 300; border-radius: 50%;
        }
        .close:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }

        /* ── 侧边与内容区 ──── */
        .layout {
          flex: 1 1 auto; min-height: 0; display: flex; flex-direction: row;
          position: relative; z-index: 1; overflow: hidden;
        }
        .sidebar {
          width: 220px; flex-shrink: 0; display: flex; flex-direction: column;
          border-right: 1px solid rgba(255,255,255,0.05); padding: 24px 0;
          overflow-y: auto; scrollbar-width: none; background: rgba(0,0,0,0.2);
        }
        .sidebar::-webkit-scrollbar { display: none; }
        .tab-btn {
          padding: 16px 32px; text-align: left; background: transparent; border: none;
          color: var(--text-tertiary); font-family: var(--font-title); font-size: 14px;
          cursor: pointer; transition: all 0.2s; position: relative; letter-spacing: 2px;
        }
        .tab-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.02); }
        .tab-btn.active { color: var(--text-primary); font-weight: 800; background: rgba(255,255,255,0.05); }
        .tab-btn.active::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: var(--c-shuiro);
        }
        
        .content {
          flex: 1 1 auto; overflow-y: auto; overflow-x: hidden;
          padding: 32px 48px 40px; scrollbar-width: none;
        }
        .content::-webkit-scrollbar { display: none; }
        
        .tab-pane { display: none; animation: fade-in-up 0.3s var(--ease-out); }
        .tab-pane.active { display: block; }
        @keyframes fade-in-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .pane-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); column-gap: 60px; row-gap: 48px; align-content: start; }


        section { position: relative; }
        
        h3 { 
          margin: 0 0 24px; padding-bottom: 12px;
          color: var(--text-primary); font-size: 14px; font-family: var(--font-title); font-weight: 800;
          letter-spacing: 2px; border-bottom: 1px solid var(--border-subtle);
        }

        .grid { display: grid; grid-template-columns: 120px 1fr; gap: 24px 16px; align-items: center; }
        label { color: var(--text-secondary); font-size: 13px; letter-spacing: 1px; font-family: var(--font-title); }

        /* ── 高级表单控件 (Custom Form Controls) ──── */
        
        /* 文本框 & 下拉框 */
        input[type="text"], input[type="number"], select, textarea {
          width: 100%; box-sizing: border-box; 
          background: rgba(255,255,255,0.02); color: var(--text-primary); 
          border: 1px solid var(--border-subtle); border-radius: var(--r-sm);
          padding: 10px 12px; font: inherit; font-size: 13px;
          outline: none; transition: all 0.2s var(--ease-out);
        }
        input:focus, select:focus, textarea:focus { 
          border-color: var(--text-primary); 
          background: rgba(255,255,255,0.05);
        }
        
        /* 针对 Select 隐藏默认箭头并替换 */
        select {
          appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg width='10' height='6'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23ffffff' stroke-opacity='0.5' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 32px;
          cursor: pointer;
        }
        select option { background: #0b0e13; color: var(--text-primary); }

        /* 颜色选择器 (Ink Swatch) */
        .color-picker-wrap {
          display: flex; align-items: center; gap: 12px;
        }
        input[type="color"] { 
          appearance: none; -webkit-appearance: none; border: none; 
          width: 28px; height: 28px; border-radius: 50%; cursor: pointer; 
          padding: 0; background: transparent;
          box-shadow: 0 0 0 1px var(--border-subtle);
        }
        input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }

        /* 开关切换 (Toggle Switch) */
        input[type="checkbox"] { 
          appearance: none; -webkit-appearance: none; width: 44px; height: 24px; 
          border-radius: 12px; background: rgba(255,255,255,0.1); position: relative; 
          cursor: pointer; border: none;
          transition: 0.2s; margin: 0; justify-self: start;
        }
        input[type="checkbox"]::after {
          content: ''; position: absolute; width: 18px; height: 18px; 
          border-radius: 50%; top: 3px; left: 3px; background: var(--text-secondary); 
          transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        input[type="checkbox"]:checked { background: var(--text-primary); }
        input[type="checkbox"]:checked::after { left: 23px; background: var(--c-void); }

        /* 文件上传 */
        .file-input { padding: 8px 0 !important; font-size: 12px !important; color: var(--text-tertiary) !important; cursor: pointer; border: none !important; background: transparent !important; }
        .file-input::-webkit-file-upload-button {
          background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); color: var(--text-primary);
          padding: 6px 14px; border-radius: var(--r-sm); cursor: pointer; margin-right: 12px;
          font-family: var(--font-title); transition: 0.2s; font-size: 12px;
        }
        .file-input::-webkit-file-upload-button:hover { background: rgba(255,255,255,0.1); border-color: var(--border-strong); }

        textarea { min-height: 80px; resize: vertical; padding: 12px !important; }

        /* ── 音乐播放器专区 (Shinobi Music Player) ──── */
        .music-panel {
          grid-column: 1 / -1;
          display: flex; flex-direction: column; gap: 20px;
          padding-top: 10px;
        }
        
        .music-player-bar {
          display: flex; align-items: center; justify-content: space-between; gap: 24px;
          background: rgba(255,255,255,0.02); padding: 20px 24px; border-radius: var(--r-md);
          border: 1px solid var(--border-subtle);
        }
        
        .music-info {
          display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0;
        }
        .music-now { font-family: var(--font-title); font-size: 15px; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 1px; }
        .music-status { font-size: 11px; color: var(--text-tertiary); letter-spacing: 1px; }

        .music-controls {
          display: flex; align-items: center; gap: 24px; flex-wrap: wrap; justify-content: flex-end;
        }
        
        .music-controls label { display: flex; align-items: center; gap: 10px; cursor: pointer; white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
        
        input[type="range"] {
          -webkit-appearance: none; appearance: none; width: 100px; height: 4px;
          background: rgba(255,255,255,0.1); border-radius: 2px; outline: none; border: none; padding: 0;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
          border-radius: 50%; background: var(--text-primary); cursor: pointer;
        }

        .music-search-row {
          display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
        }
        
        .music-result-list {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;
          min-height: 0; max-height: 240px; overflow-y: auto; padding-right: 8px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.2) transparent;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        .music-empty-hint { text-align: center; color: var(--text-tertiary); padding: 32px 16px; font-family: var(--font-body); font-size: 12px; line-height: 1.7; grid-column: 1/-1; }
        
        .music-item {
          display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
          background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm); transition: all 0.2s var(--ease-out); cursor: pointer;
        }
        .music-item:hover { background: rgba(255,255,255,0.05); border-color: var(--border-strong); transform: translateX(2px); }
        .music-item-info { display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
        .music-item-name { font-family: var(--font-title); font-size: 13px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .music-item-artist { font-size: 11px; color: var(--text-tertiary); }
        .music-play-icon { color: var(--text-primary); font-size: 14px; opacity: 0.3; transition: 0.2s; }
        .music-item:hover .music-play-icon { opacity: 1; transform: scale(1.1); }
        .music-item-fav { color: var(--text-tertiary); font-size: 14px; cursor: pointer; transition: 0.2s; padding: 4px; opacity: 0.3; }
        .music-item:hover .music-item-fav { opacity: 1; }
        .music-item-fav.favorited { color: var(--text-primary); opacity: 1; }
        .music-item-fav:hover { transform: scale(1.2); }

        .music-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-subtle); }
        .music-tab { flex: 1; padding: 12px 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; font-family: var(--font-title); font-size: 12px; letter-spacing: 1px; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: 0.2s; }
        .music-tab:hover { color: var(--text-secondary); }
        .music-tab.active { color: var(--text-primary); border-bottom-color: var(--text-primary); font-weight: bold; }
        


        /* ── 底部操作栏 (Elegant Footer) ──── */
        .actions { 
          flex: 0 0 auto; display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; 
          padding: 24px 48px 32px; background: transparent; 
          border-top: 1px solid var(--border-subtle); position: relative; z-index: 2;
        }
        
        .btn {
          background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle);
          color: var(--text-primary); border-radius: var(--r-md); padding: 10px 28px; cursor: pointer; 
          font-family: var(--font-title); font-size: 13px; font-weight: 600; letter-spacing: 1px; 
          transition: all 0.2s; white-space: nowrap;
        }
        .btn:hover { background: rgba(255,255,255,0.08); border-color: var(--border-strong); }
        
        .btn.primary { 
          background: var(--text-primary); border-color: var(--text-primary); color: var(--c-void); box-shadow: 0 2px 8px rgba(255,255,255,0.15);
        }
        .btn.primary:hover { background: #ffffff; color: var(--c-void); box-shadow: 0 4px 12px rgba(255,255,255,0.25); transform: translateY(-1px); }

        .btn.ghost { border: none; color: var(--text-tertiary); padding: 10px 16px; background: transparent; }
        .btn.ghost:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); border-color: transparent; }
        .btn-xs { padding: 4px 10px !important; font-size: 11px !important; }
        .preset-label { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .preset-editor-overlay {
          position: absolute; inset: 0; z-index: 20;
          background: rgba(7,10,14,0.95); backdrop-filter: var(--blur-lg);
          display: none; flex-direction: column; padding: 40px;
        }
        .preset-editor-overlay.active { display: flex; }
        .preset-editor-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;
        }
        .preset-editor-title { color: var(--text-primary); font-size: 16px; font-family: var(--font-title); letter-spacing: 2px; font-weight: 800; }
        .preset-editor-close { background: transparent; border: none; color: var(--text-tertiary); font-size: 24px; cursor: pointer; transition: 0.2s; }
        .preset-editor-close:hover { color: var(--text-primary); }
        .preset-editor-textarea {
          flex: 1; width: 100%; box-sizing: border-box; resize: none;
          background: rgba(0,0,0,0.2); border: 1px solid var(--border-subtle); border-radius: var(--r-md);
          color: var(--text-primary); font: 14px/1.8 'JetBrains Mono', 'Fira Code', monospace;
          padding: 20px; outline: none; min-height: 300px;
        }
        .preset-editor-textarea:focus { border-color: var(--text-primary); background: rgba(255,255,255,0.02); }
        .preset-editor-actions { display: flex; gap: 16px; justify-content: flex-end; margin-top: 24px; }
        .preset-editor-hint { font-size: 12px; color: var(--text-tertiary); margin-top: 12px; }

        @media(max-width: 768px) {
          .panel { width: 100vw; height: 100vh; max-height: 100vh; border-radius: 0; border: none; }
          .backdrop { padding: 0; }
          .head, .actions { padding-left: 20px; padding-right: 20px; }
          .content { padding: 20px; }
          .layout { flex-direction: column; }
          .sidebar { width: 100%; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.05); flex-direction: row; padding: 0; overflow-x: auto; }
          .tab-btn { white-space: nowrap; padding: 16px; font-size: 13px; }
          .tab-btn.active::before { width: 100%; height: 3px; top: auto; bottom: 0; left: 0; }
          .setting-item { flex-direction: column; align-items: flex-start; gap: 12px; }
          .content { padding: 24px; }
          .pane-grid { grid-template-columns: 1fr; }
          .music-player-bar { flex-direction: column; align-items: stretch; gap: 16px; }
          .music-controls { flex-wrap: wrap; justify-content: space-between; }
          .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
          .btn { padding: 12px; }
          .btn.primary { grid-column: 1 / -1; }
        }
      </style>
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
              <button class="tab-btn" data-target="tab-lore">世界书与预设</button>
              <button class="tab-btn" data-target="tab-audio">忍道音律</button>
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
                       启用后，每回合由多个 AI Agent 协作生成正文（大纲→审查→写作→润色）。<br>
                       质量显著提升，但消耗约 4-10 倍 Token，生成时间约 30-90 秒。
                     </p>
                     <div class="grid" style="grid-template-columns:auto 1fr; gap:10px 16px; align-items:center;">
                       <label style="color:#e8e4d9;">启用 Agent 模式</label>
                       <input type="checkbox" name="agentEnabled" ${getAgentConfig().enabled ? 'checked' : ''}>
                       <label style="color:#e8e4d9;">生成模式</label>
                       <select name="agentMode" style="background:#111; color:#e8e4d9; border:1px solid rgba(198,156,109,0.2); border-radius:4px; padding:4px 8px; font-size:12px;">
                         <option value="standard" ${getAgentConfig().mode === 'standard' ? 'selected' : ''}>标准 (大纲+审查+写作, +4次调用)</option>
                         <option value="full" ${getAgentConfig().mode === 'full' ? 'selected' : ''}>完整 (含头脑风暴+角色代理, +7-10次)</option>
                       </select>
                       <label style="color:#e8e4d9;">战斗自动升级完整模式</label>
                       <input type="checkbox" name="agentAutoUpgrade" ${getAgentConfig().autoUpgrade !== false ? 'checked' : ''}>
                       <label style="color:#a39f98; font-size:11px;">Agent 模型 (留空=主模型)</label>
                       <input type="text" name="agentModel" value="${getAgentConfig().agentModel || ''}" placeholder="留空使用主模型" style="background:#111; color:#e8e4d9; border:1px solid rgba(198,156,109,0.15); border-radius:4px; padding:4px 8px; font-size:12px;">
                       <label style="color:#a39f98; font-size:11px;">Critic 模型 (建议廉价模型)</label>
                       <input type="text" name="criticModel" value="${getAgentConfig().criticModel || ''}" placeholder="留空使用主模型" style="background:#111; color:#e8e4d9; border:1px solid rgba(198,156,109,0.15); border-radius:4px; padding:4px 8px; font-size:12px;">
                     </div>
                   </div>
                </section>
              </div>

              <!-- Tab 3: 世界书与预设 -->
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
                     <div style="background:#070a0e; border:1px solid rgba(198,156,109,0.2); border-radius:8px; padding:16px;">
                       <p style="margin-top:0; margin-bottom:12px; font-size:13px; color:#e8e4d9;">默认叙事预设（内置规则）</p>
                       <div class="grid" style="grid-template-columns:auto 1fr 50px;gap:6px 10px;">
                         <label class="music-chk"><span style="color:#a39f98;">DEFAULT_PROMPT</span></label><span class="preset-label">全局叙事规则</span><button class="btn ghost btn-xs" type="button" data-action="edit-preset" data-preset="default" style="padding:2px 6px;font-size:10px;">编辑</button>
                       </div>
                     </div>
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
          <div class="preset-editor-overlay" id="preset-editor-overlay">
            <div class="preset-editor-header">
              <span class="preset-editor-title" id="preset-editor-title">编辑预设</span>
              <button class="preset-editor-close" id="preset-editor-close">✕</button>
            </div>
            <textarea class="preset-editor-textarea" id="preset-editor-textarea" spellcheck="false"></textarea>
            <div class="preset-editor-hint" id="preset-editor-hint"></div>
            <div class="preset-editor-actions">
              <button class="btn" id="preset-editor-reset">恢复默认</button>
              <button class="btn" id="preset-editor-cancel">取消</button>
              <button class="btn primary" id="preset-editor-save">保存预设</button>
            </div>
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
    this.shadowRoot.querySelector('[name="backgroundFile"]')?.addEventListener('change', event => this._importBackgroundFile(event));

    this.shadowRoot.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.shadowRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.shadowRoot.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        this.shadowRoot.getElementById(btn.dataset.target)?.classList.add('active');
      });
    });

    this.shadowRoot.querySelector('#preset-editor-close')?.addEventListener('click', () => this._closePresetEditor());
    this.shadowRoot.querySelector('#preset-editor-cancel')?.addEventListener('click', () => this._closePresetEditor());
    this.shadowRoot.querySelector('#preset-editor-save')?.addEventListener('click', () => this._savePresetEditor());
    this.shadowRoot.querySelector('#preset-editor-reset')?.addEventListener('click', () => this._resetPresetEditor());
  }

  async _handle(action, event) {
    if (action === 'close') return this.close();
    if (action === 'save') return this._save();
    if (action === 'api-settings') { this.close(); return eventBus.emit('app:open-api-settings'); }
    if (action === 'reset') return this._reset();
    if (action === 'export') {
      const json = JSON.stringify(mergeSettings(stateManager.get('ui_prefs.settings')), null, 2);
      return GameModal.prompt({ title: '复制配置 JSON', message: '选中下方文本框内容，按 Ctrl+C 复制', value: json, multiline: true, rows: 10, okLabel: '关闭', cancelLabel: '取消' });
    }
    if (action === 'import') return this._import();
    if (action === 'search-music') return this._searchMusic();
    if (action === 'toggle-lyrics') return this._toggleLyrics();
    if (action === 'edit-preset') return this._editPreset(event?.target?.dataset?.preset);
    
    if (action === 'open-main-preset-editor') {
      const editor = document.createElement('main-preset-editor');
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
    stateManager.update([{ path: 'ui_prefs.settings', op: 'set', value: settings }]);

    this._saveAgentConfig();

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

  async _reset() {
    const confirmed = await customElements.get('game-modal').confirm({
      title: '恢复默认设置',
      message: '确定恢复所有系统设置到默认值吗？此操作不会影响 API 配置和存档。',
      okLabel: '恢复默认',
      cancelLabel: '取消'
    });
    if (!confirmed) return;
    stateManager.update([{ path: 'ui_prefs.settings', op: 'set', value: DEFAULT_SETTINGS }]);
    await stateManager.saveUIPrefs?.();
    applyLocalSettings(DEFAULT_SETTINGS);
    this.close();
  }

  async _import() {
    const text = await GameModal.prompt({ title: '粘贴配置 JSON', message: '将配置 JSON 粘贴到下方文本框', placeholder: '{ ... }', multiline: true, rows: 10, okLabel: '导入', cancelLabel: '取消' });
    if (!text) return;
    try {
      const settings = mergeSettings(JSON.parse(text));
      stateManager.update([{ path: 'ui_prefs.settings', op: 'set', value: settings }]);
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
    else if (tab === 'favorites') this._renderMusicList(this._getFavorites(), 'favorites');
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
    idx >= 0 ? favs.splice(idx, 1) : favs.push(song);
    this._saveFavorites(favs);
    if (this._activeTab === 'favorites') this._renderMusicList(favs, 'favorites');
    else this._renderMusicList(this._activeTab === 'playlist' ? this._getPlaylist() : (this._searchCache || []), this._activeTab || 'search');
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

  _presetKeys = { default: 'DEFAULT_PROMPT' };

  _editPreset(key) {
    const promptName = this._presetKeys[key];
    if (!promptName) return;
    this._editingPresetKey = key;
    this._editingPresetName = promptName;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`naruto_preset_${promptName}`) || 'null'); } catch { saved = null; }
    const current = saved || PROMPTS[promptName] || '';
    const overlay = this.shadowRoot.querySelector('#preset-editor-overlay');
    const title = this.shadowRoot.querySelector('#preset-editor-title');
    const textarea = this.shadowRoot.querySelector('#preset-editor-textarea');
    const hint = this.shadowRoot.querySelector('#preset-editor-hint');
    if (title) title.textContent = `编辑 · ${promptName}`;
    if (textarea) textarea.value = current;
    if (hint) hint.textContent = saved ? '已使用自定义预设 · 点击"恢复默认"将还原为系统预设' : '当前为系统默认预设';
    if (overlay) overlay.classList.add('active');
    if (textarea) textarea.focus();
  }

  _closePresetEditor() {
    const overlay = this.shadowRoot.querySelector('#preset-editor-overlay');
    if (overlay) overlay.classList.remove('active');
    this._editingPresetKey = null;
    this._editingPresetName = null;
  }

  _savePresetEditor() {
    const textarea = this.shadowRoot.querySelector('#preset-editor-textarea');
    if (!this._editingPresetName || !textarea) return;
    const text = textarea.value.trim();
    if (text === '') {
      localStorage.removeItem(`naruto_preset_${this._editingPresetName}`);
    } else {
      localStorage.setItem(`naruto_preset_${this._editingPresetName}`, text);
    }
    this._closePresetEditor();
    eventBus.emit('app:toast', `${this._editingPresetName} 已保存。应用将在下一次 AI 调用时生效。`);
  }

  _resetPresetEditor() {
    if (!this._editingPresetName) return;
    localStorage.removeItem(`naruto_preset_${this._editingPresetName}`);
    const textarea = this.shadowRoot.querySelector('#preset-editor-textarea');
    const hint = this.shadowRoot.querySelector('#preset-editor-hint');
    if (textarea) textarea.value = PROMPTS[this._editingPresetName] || '';
    if (hint) hint.textContent = '已还原为系统默认预设';
  }

  async _exportPresets() {
    const out = {};
    for (const key of Object.values(this._presetKeys)) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(`naruto_preset_${key}`) || 'null'); } catch { saved = null; }
      if (saved) out[key] = saved;
    }
    const json = JSON.stringify(out, null, 2);
    await GameModal.prompt({ title: '复制预设配置 JSON', message: '选中下方文本框内容，按 Ctrl+C 复制', value: json, multiline: true, rows: 10, okLabel: '关闭', cancelLabel: '取消' });
  }

  async _importPresets() {
    const text = await GameModal.prompt({ title: '粘贴预设配置 JSON', message: '将预设 JSON 粘贴到下方文本框', placeholder: '{ ... }', multiline: true, rows: 10, okLabel: '导入', cancelLabel: '取消' });
    if (!text) return;
    try {
      const data = JSON.parse(text);
      for (const [key, value] of Object.entries(data)) {
        if (Object.values(this._presetKeys).includes(key)) localStorage.setItem(`naruto_preset_${key}`, String(value));
      }
      GameModal.alert({ title: '导入成功', message: '预设已导入。' });
    } catch { GameModal.alert({ title: '导入失败', message: 'JSON 不合法。' }); }
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
      el.classList.add('dragging');
      const r = el.getBoundingClientRect();
      // Pick up current transform offset
      const t = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      dx = t ? parseFloat(t[1]) : 0;
      dy = t ? parseFloat(t[2]) : 0;
      const evt = e.touches ? e.touches[0] : e;
      sx = evt.clientX;
      sy = evt.clientY;
    };
    const onMove = e => {
      if (!dragging) return;
      e.preventDefault();
      const evt = e.touches ? e.touches[0] : e;
      const nx = dx + evt.clientX - sx;
      const ny = dy + evt.clientY - sy;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${nx}px, ${ny}px)`;
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

export function applyLocalSettings(settings = stateManager.get('ui_prefs.settings')) {
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
