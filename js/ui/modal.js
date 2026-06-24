class GameModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  show({ title, content, buttons = [] }) {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; color: var(--text-primary, #e8e4d9); font-family: 'Noto Sans SC', 'Microsoft YaHei UI', 'PingFang SC', system-ui, sans-serif; }
        .overlay {
          position: fixed; inset: 0; z-index: 400;
          display: flex; align-items: center; justify-content: center;
          background: rgba(7,10,14,0.72);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: fi 0.16s ease;
          padding: 18px;
        }
        .modal {
          width: min(92vw, 480px);
          max-height: 88vh; overflow: auto;
          background:
            linear-gradient(180deg, rgba(232,228,217,0.035), transparent 118px),
            var(--surface-1, #10161d);
          border: 1px solid rgba(232,228,217,0.14);
          border-radius: 10px;
          padding: 0;
          box-shadow: 0 28px 80px rgba(0,0,0,0.52), 0 0 0 1px rgba(255,255,255,0.025) inset;
          animation: si 0.20s cubic-bezier(0.16,1,0.3,1);
          position: relative;
        }
        .modal::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
          border-radius: 10px 10px 0 0;
          background: linear-gradient(90deg, transparent, rgba(232,200,122,0.58), transparent);
        }
        @keyframes fi { from{opacity:0} to{opacity:1} }
        @keyframes si { from{opacity:0;transform:translateY(10px) scale(.985)} to{opacity:1;transform:translateY(0) scale(1)} }
        .title {
          padding: 22px 24px 14px;
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary, #e8e4d9);
          font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif;
          letter-spacing:1px;
        }
        .body {
          padding: 0 24px 22px;
          font-size: 13px;
          color: var(--text-secondary, #a39f98);
          line-height: 1.75;
        }
        .body p { margin: 0; }
        .btns {
          display: flex; gap: 10px; justify-content: flex-end;
          padding: 16px 24px;
          border-top: 1px solid rgba(232,228,217,0.08);
          background: rgba(7,10,14,0.22);
        }
        .btn {
          min-height: 36px;
          padding: 8px 16px; font-size: 13px; border-radius: 6px; cursor: pointer;
          border: 1px solid rgba(232,228,217,0.14);
          background: rgba(232,228,217,0.035);
          color: var(--text-primary, #e8e4d9);
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
          font-family:'Noto Sans SC','Microsoft YaHei UI','PingFang SC',system-ui,sans-serif; letter-spacing:0;
        }
        .btn:hover { border-color: rgba(232,228,217,0.24); background: rgba(232,228,217,0.065); }
        .btn:active { transform: translateY(1px); }
        .btn-p {
          background: linear-gradient(180deg, #f07452, #eb613f);
          border-color: rgba(235,97,63,0.68);
          color: #fff; font-weight: 700;
          box-shadow: 0 8px 20px rgba(0,0,0,0.22);
        }
        .btn-p:hover { background: linear-gradient(180deg, #eb613f, #c9171e); border-color:#c9171e; }
        @media (max-width: 480px) {
          .modal { width: 100%; }
          .title { padding: 20px 18px 12px; }
          .body { padding: 0 18px 20px; }
          .btns { padding: 14px 18px; flex-direction: column-reverse; }
          .btn { width: 100%; }
        }
      </style>
      <div class="overlay" id="mo">
        <div class="modal">
          <div class="title">${title||''}</div>
          <div class="body">${content||''}</div>
          <div class="btns">${buttons.map((b,i)=>`<button class="btn${b.primary?' btn-p':''}" data-idx="${i}">${b.label}</button>`).join('')}</div>
        </div>
      </div>
    `;
    this.shadowRoot.querySelector('#mo').addEventListener('click', (e) => { if (e.target.id === 'mo') this.close(); });
    this.shadowRoot.querySelectorAll('.btn').forEach(b => {
      b.addEventListener('click', () => {
        const idx = parseInt(b.dataset.idx);
        buttons[idx]?.onClick?.();
        if (buttons[idx]?.close !== false) this.close();
      });
    });
  }

  close() {
    this.shadowRoot.innerHTML = '';
    this.remove();
  }

  static confirm({ title, message, okLabel = '确定', cancelLabel = '取消' }) {
    return new Promise(resolve => {
      const m = new GameModal();
      (document.getElementById('app') || document.body).appendChild(m);
      m.show({
        title, content: `<p>${message}</p>`,
        buttons: [
          { label: cancelLabel, onClick: () => resolve(false) },
          { label: okLabel, primary: true, onClick: () => resolve(true) }
        ]
      });
    });
  }

  static alert({ title, message, okLabel = '确定' }) {
    return new Promise(resolve => {
      const m = new GameModal();
      (document.getElementById('app') || document.body).appendChild(m);
      m.show({
        title, content: `<p>${message}</p>`,
        buttons: [
          { label: okLabel, primary: true, onClick: () => resolve(true) }
        ]
      });
    });
  }

  static prompt({ title, message = '', value = '', placeholder = '', okLabel = '确定', cancelLabel = '取消', multiline = false, rows = 6 }) {
    return new Promise(resolve => {
      const m = new GameModal();
      (document.getElementById('app') || document.body).appendChild(m);
      const inputId = 'gm-input';
      const inputHtml = multiline
        ? `<textarea id="${inputId}" rows="${rows}" placeholder="${placeholder}" style="width:100%;min-height:120px;resize:vertical;padding:10px 12px;background:rgba(7,10,14,0.6);border:1px solid rgba(232,228,217,0.18);border-radius:6px;color:var(--text-primary,#e8e4d9);font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;line-height:1.6;outline:none;">${value}</textarea>`
        : `<input id="${inputId}" type="text" value="${value}" placeholder="${placeholder}" style="width:100%;padding:10px 12px;background:rgba(7,10,14,0.6);border:1px solid rgba(232,228,217,0.18);border-radius:6px;color:var(--text-primary,#e8e4d9);font-family:inherit;font-size:13px;outline:none;" />`;
      m.show({
        title,
        content: `<p style="margin:0 0 10px;">${message}</p>${inputHtml}`,
        buttons: [
          { label: cancelLabel, onClick: () => resolve(null) },
          { label: okLabel, primary: true, onClick: () => resolve(m.shadowRoot.getElementById(inputId)?.value ?? null) }
        ]
      });
      requestAnimationFrame(() => {
        const el = m.shadowRoot.getElementById(inputId);
        if (el) { el.focus(); el.select?.(); }
      });
    });
  }
}

customElements.define('game-modal', GameModal);
export default GameModal;
