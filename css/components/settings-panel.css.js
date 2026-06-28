export const settingsStyles = `
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

`;

