export class DisplayConfigForm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    try {
      this._config = JSON.parse(this.getAttribute('config') || '{}');
    } catch {
      this._config = {};
    }
    this._render();
    this._bindEvents();
  }

  _render() {
    const config = this._config;
    // Default colors
    const dialogueColor = config.dialogueColor || '#bae6fd';
    const thoughtColor = config.thoughtColor || '#c4b5fd';
    
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; }
        .settings-form { display: grid; gap: 24px; text-align: left; }
        .settings-row { display: grid; gap: 8px; }
        .settings-row label { color: #c69c6d; font-size: 12px; letter-spacing: .08em; font-weight: 500; text-transform: uppercase; }
        .settings-hint { color: rgba(232,228,217,0.4); font-size: 12px; line-height: 1.6; margin-top: 4px; }
        
        .color-picker-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        input[type="color"] {
          -webkit-appearance: none;
          border: 1px solid rgba(255, 255, 255, 0.1);
          width: 44px;
          height: 44px;
          border-radius: 8px;
          padding: 0;
          background: none;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        input[type="color"]::-webkit-color-swatch-wrapper {
          padding: 2px;
        }
        input[type="color"]::-webkit-color-swatch {
          border: none;
          border-radius: 5px;
        }
        input[type="color"]:hover {
          border-color: rgba(198,156,109,0.8);
        }

        .preview-box {
          flex: 1;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255,255,255,0.05);
          padding: 10px 16px;
          border-radius: 6px;
          font-size: 14px;
        }

        .btn-reset {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.2);
          color: #a39f98;
          padding: 4px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          margin-top: 16px;
          transition: all 0.2s;
        }
        .btn-reset:hover {
          color: #e8e4d9;
          border-color: rgba(255,255,255,0.4);
        }
      </style>
      <div class="settings-form" id="settings-form">
        <div class="settings-row">
          <label>对话文字颜色</label>
          <div class="color-picker-wrap">
            <input type="color" id="dialogue-color" value="${dialogueColor}">
            <div class="preview-box">
              <span id="preview-dialogue" style="color: ${dialogueColor}; font-weight: 500; text-shadow: 0 0 10px ${this._hexToRgbA(dialogueColor, 0.3)};">「这是对话文字的预览效果」</span>
            </div>
          </div>
          <div class="settings-hint">用于显示角色说出的话语，建议使用明亮的冷色调。</div>
        </div>

        <div class="settings-row">
          <label>内心想法颜色</label>
          <div class="color-picker-wrap">
            <input type="color" id="thought-color" value="${thoughtColor}">
            <div class="preview-box">
              <span id="preview-thought" style="color: ${thoughtColor}; font-style: italic; text-shadow: 0 0 10px ${this._hexToRgbA(thoughtColor, 0.2)};">（这是内心想法的预览效果）</span>
            </div>
          </div>
          <div class="settings-hint">用于显示角色未说出口的心理活动，建议使用柔和的暗色调。</div>
        </div>

        <div>
          <button type="button" class="btn-reset" id="btn-reset">恢复默认颜色</button>
        </div>
      </div>
    `;
  }

  _hexToRgbA(hex, alpha){
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
  }

  _bindEvents() {
    const dInput = this.shadowRoot.getElementById('dialogue-color');
    const tInput = this.shadowRoot.getElementById('thought-color');
    const dPreview = this.shadowRoot.getElementById('preview-dialogue');
    const tPreview = this.shadowRoot.getElementById('preview-thought');
    const btnReset = this.shadowRoot.getElementById('btn-reset');

    dInput.addEventListener('input', (e) => {
      const val = e.target.value;
      dPreview.style.color = val;
      dPreview.style.textShadow = `0 0 10px ${this._hexToRgbA(val, 0.3)}`;
    });

    tInput.addEventListener('input', (e) => {
      const val = e.target.value;
      tPreview.style.color = val;
      tPreview.style.textShadow = `0 0 10px ${this._hexToRgbA(val, 0.2)}`;
    });

    btnReset.addEventListener('click', () => {
      dInput.value = '#bae6fd';
      tInput.value = '#c4b5fd';
      dInput.dispatchEvent(new Event('input'));
      tInput.dispatchEvent(new Event('input'));
    });
  }

  getConfig() {
    return {
      dialogueColor: this.shadowRoot.getElementById('dialogue-color').value,
      thoughtColor: this.shadowRoot.getElementById('thought-color').value
    };
  }
}

customElements.define('display-config-form', DisplayConfigForm);
