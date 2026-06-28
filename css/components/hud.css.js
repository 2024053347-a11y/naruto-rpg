export const hudStyles = `
:host { display: block; contain: layout style paint; }
.hud {
  border: 1px solid rgba(232,228,217,0.14);
  background:
    linear-gradient(135deg, rgba(63,215,255,0.075), transparent 34%),
    linear-gradient(315deg, rgba(235,97,63,0.08), transparent 42%),
    var(--surface-1, #111821);
  padding: 16px 18px;
  margin: 20px 0;
  font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
  color: var(--text-primary, #e8e4d9);
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-soft, 0 18px 44px rgba(0,0,0,0.28)), 0 0 0 1px rgba(232,200,122,0.06) inset;
}
.hud-ring {
  position: absolute;
  inset: -36px auto auto 50%;
  width: 180px;
  height: 180px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: repeating-conic-gradient(from 12deg, transparent 0 11deg, rgba(63,215,255,0.12) 11deg 12deg, transparent 12deg 24deg);
  opacity: 0.08;
  pointer-events: none;
}
@keyframes hud-ring { to { transform: translateX(-50%) rotate(360deg); } }
.hud::before { content: '「'; position: absolute; top: 4px; left: 8px; font-size: 18px; color: #eb613f; font-weight: 800; }
.hud::after { content: '」'; position: absolute; bottom: 4px; right: 8px; font-size: 18px; color: #eb613f; font-weight: 800; }

.upd-title { font-size: 13px; font-weight: bold; color: #e8e4d9; margin-bottom: 10px; letter-spacing: 1px; }
.upd-list { display: flex; flex-direction: column; gap: 4px; position: relative; z-index: 1; max-height: 350px; overflow-y: auto; scrollbar-width: thin; }
.upd-list::-webkit-scrollbar { width: 4px; }
.upd-list::-webkit-scrollbar-thumb { background: rgba(198,156,109,0.3); border-radius: 2px; }

.upd-item { 
  display: flex; flex-direction: column; 
  background: rgba(16, 22, 29, 0.7); 
  padding: 8px 12px; border-radius: 6px; 
  border-left: 3px solid rgba(255, 213, 79, 0.4); 
  border-bottom: 1px solid rgba(255,255,255,0.03); 
  transition: background-color 0.3s;
}
.upd-main { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.upd-path { color: #e8e4d9; font-weight: 500; letter-spacing: 0.5px; font-size: 12px; flex: 1; }
.upd-val-container { text-align: right; margin-right: 12px; font-size: 13px; }
.upd-val { font-weight: bold; font-family: 'JetBrains Mono', monospace; }
.upd-plus { color: #81C784; }
.upd-minus { color: #ef5350; }
.upd-neutral { color: #FFB74D; font-size: 12px; }

.edit-btn { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #a39f98; cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: all 0.2s; font-size: 11px; font-family: inherit; }
.edit-btn:hover { color: #e8e4d9; background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); }

.edit-panel { width: 100%; margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.15); padding-top: 10px; animation: slide-down 0.2s ease-out; }
.edit-panel-inner { display: flex; flex-direction: column; gap: 8px; }
.edit-title { font-size: 11px; color: #c69c6d; font-weight: bold; margin-bottom: 4px; }

/* GUI Form Styles */
.obj-editor { display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; }
.obj-field { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.obj-label { flex: 0 0 80px; font-size: 11px; color: #a39f98; padding-top: 6px; text-align: right; }
.obj-val { flex: 1; }

.array-editor { display: flex; flex-direction: column; gap: 4px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; }
.array-item { display: flex; gap: 4px; }
.array-item input { flex: 1; }

.edit-input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.5); border: 1px solid rgba(198,156,109,0.3); color: #e8e4d9; padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 12px; outline: none; transition: border-color 0.2s; }
.edit-input:focus { border-color: #c69c6d; box-shadow: 0 0 8px rgba(198,156,109,0.2); }
textarea.edit-input { resize: vertical; min-height: 40px; line-height: 1.4; }
textarea.edit-input.raw-json { font-family: 'JetBrains Mono', monospace; min-height: 80px; }

.edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.edit-actions button { background: rgba(198,156,109,0.15); border: 1px solid rgba(198,156,109,0.3); color: #c69c6d; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s; font-weight: bold; }
.edit-actions button.save-btn { background: rgba(235,97,63,0.15); border-color: rgba(235,97,63,0.4); color: #eb613f; }
.edit-actions button:hover { filter: brightness(1.2); }

@keyframes slide-down { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .hud-ring, .edit-panel { animation: none; } }

`;

