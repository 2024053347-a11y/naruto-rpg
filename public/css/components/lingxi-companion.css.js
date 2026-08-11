export const lingXiCompanionStyles = `
  :host {
    --lx-moon: #f2f4ee;
    --lx-cyan: #b9d9d2;
    --lx-teal: #245b56;
    --lx-leaf: #50866f;
    --lx-gold: #d4b56f;
    --lx-vermillion: #cf5c48;
    --lx-ink: #111820;
    position: fixed;
    display: block;
    right: calc(var(--panel-w, 320px) + 18px);
    bottom: calc(var(--statusbar-h, 36px) + 12px);
    z-index: 350;
    width: 96px;
    height: 122px;
    pointer-events: none;
    color: var(--text-primary, #f4f1ea);
    font-family: var(--font-body, system-ui, sans-serif);
    letter-spacing: 0;
  }

  *, *::before, *::after { box-sizing: border-box; }
  button, textarea, input { font: inherit; letter-spacing: 0; }
  button { color: inherit; }
  [hidden] { display: none !important; }

  .dock { width: 100%; height: 100%; pointer-events: none; }
  .pet-button {
    position: absolute;
    inset: 0;
    width: 96px;
    height: 122px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
    touch-action: none;
    pointer-events: auto;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, .48));
    transition: transform 180ms ease, filter 180ms ease;
  }
  .pet-button.dragging { cursor: grabbing; transform: none; transition: none; }
  .pet-button:hover { transform: translateY(-3px); filter: drop-shadow(0 12px 22px rgba(0, 0, 0, .58)); }
  .pet-button:focus-visible { outline: 2px solid var(--lx-gold); outline-offset: 3px; border-radius: 8px; }
  .pet-image {
    display: block;
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: 50%;
    border: 1px solid rgba(242, 244, 238, .58);
    background: #f4f0e8;
    user-select: none;
    -webkit-user-drag: none;
  }
  .pet-name {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    min-width: 66px;
    padding: 4px 7px;
    border-radius: 6px;
    border: 1px solid rgba(212, 181, 111, .5);
    background: rgba(17, 24, 32, .92);
    color: var(--lx-moon);
    font: 700 12px/1.2 var(--font-title, serif);
    text-align: center;
    white-space: nowrap;
  }
  .pet-signal {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 12px;
    height: 12px;
    border: 2px solid var(--lx-ink);
    border-radius: 50%;
    background: var(--lx-leaf);
  }
  .pet-button[data-state="thinking"] .pet-signal { background: var(--lx-gold); animation: lx-pulse 1.2s ease-in-out infinite; }
  .pet-button[data-state="working"] .pet-signal { background: var(--lx-vermillion); animation: lx-pulse .8s ease-in-out infinite; }
  .pet-button[data-state="error"] .pet-signal { background: #dc6262; }

  .panel {
    position: fixed;
    right: 0;
    bottom: calc(var(--statusbar-h, 36px) + 150px);
    width: min(390px, calc(100vw - 36px));
    height: min(610px, calc(100vh - 242px));
    min-height: min(390px, calc(100vh - 242px));
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    overflow: hidden;
    pointer-events: auto;
    border: 1px solid rgba(185, 217, 210, .28);
    border-radius: 8px;
    background: rgba(13, 21, 27, .97);
    box-shadow: 0 24px 58px rgba(0, 0, 0, .62), inset 0 1px rgba(242, 244, 238, .04);
    backdrop-filter: blur(22px) saturate(125%);
    -webkit-backdrop-filter: blur(22px) saturate(125%);
    transform-origin: bottom right;
    animation: lx-open 180ms ease-out both;
  }
  .panel-header {
    min-height: 64px;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 10px 12px;
    border-bottom: 1px solid rgba(185, 217, 210, .14);
    background: rgba(36, 91, 86, .12);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .panel-header.dragging { cursor: grabbing; }
  .panel-header button { cursor: pointer; touch-action: auto; }
  .profile-button {
    width: 42px;
    height: 42px;
    padding: 0;
    overflow: hidden;
    border: 1px solid rgba(212, 181, 111, .48);
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }
  .profile-button img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .identity { min-width: 0; }
  .identity strong { display: block; color: var(--lx-moon); font: 700 15px/1.3 var(--font-title, serif); }
  .identity span { display: block; margin-top: 3px; color: var(--lx-cyan); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .header-actions { display: flex; align-items: center; gap: 4px; }
  .api-choice {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    padding: 7px 12px;
    border-bottom: 1px solid rgba(185, 217, 210, .12);
    background: rgba(7, 12, 16, .42);
  }
  .api-choice span { color: rgba(242, 244, 238, .54); font-size: 10px; white-space: nowrap; }
  .api-choice-select {
    min-width: 0;
    width: 100%;
    height: 30px;
    padding: 0 28px 0 9px;
    border: 1px solid rgba(185, 217, 210, .18);
    border-radius: 5px;
    outline: 0;
    background: #111b21;
    color: var(--lx-cyan);
    font-size: 11px;
    text-overflow: ellipsis;
  }
  .api-choice-select:focus-visible { outline: 2px solid var(--lx-gold); outline-offset: 1px; }
  .api-choice-select:disabled { opacity: .5; cursor: wait; }
  .icon-button {
    width: 36px;
    height: 36px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: rgba(242, 244, 238, .7);
    cursor: pointer;
  }
  .icon-button:hover { color: var(--lx-moon); border-color: rgba(185, 217, 210, .2); background: rgba(185, 217, 210, .07); }
  .icon-button:focus-visible, .profile-button:focus-visible, .quick-action:focus-visible,
  .proposal-review:focus-visible, .approval-button:focus-visible,
  .composer textarea:focus-visible, .new-chat-dialog:focus-visible { outline: 2px solid var(--lx-gold); outline-offset: 1px; }

  .messages {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 14px 12px;
    scrollbar-width: thin;
    scrollbar-color: rgba(185, 217, 210, .28) transparent;
  }
  .message { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 8px; margin: 0 0 15px; align-items: start; }
  .message.user { grid-template-columns: minmax(0, 1fr); padding-left: 42px; }
  .message-avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(212, 181, 111, .36); }
  .bubble {
    min-width: 0;
    padding: 9px 11px;
    border-radius: 7px;
    color: rgba(242, 244, 238, .9);
    background: rgba(242, 244, 238, .055);
    border-left: 2px solid var(--lx-teal);
    font-size: 13px;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  .bubble p { margin: 0 0 7px; white-space: pre-wrap; }
  .bubble p:last-child { margin-bottom: 0; }
  .bubble h3 { margin: 2px 0 8px; color: var(--lx-moon); font: 700 14px/1.4 var(--font-title, serif); }
  .bubble ul, .bubble ol { margin: 5px 0 8px; padding-left: 20px; }
  .bubble li + li { margin-top: 3px; }
  .bubble blockquote { margin: 5px 0; padding-left: 9px; border-left: 2px solid var(--lx-gold); color: var(--lx-cyan); }
  .bubble code { padding: 1px 4px; border-radius: 3px; background: rgba(0, 0, 0, .3); color: var(--lx-gold); font-family: var(--font-mono, monospace); }
  .bubble pre { margin: 7px 0; padding: 8px; overflow: auto; border-radius: 5px; background: rgba(0, 0, 0, .32); white-space: pre-wrap; }
  .bubble pre code { padding: 0; background: transparent; color: rgba(242, 244, 238, .78); }
  .message.user .bubble { justify-self: end; border-left: 0; border-right: 2px solid var(--lx-vermillion); background: rgba(207, 92, 72, .1); }
  .typing { color: var(--lx-cyan); font-size: 12px; padding: 0 0 12px 38px; }
  .streaming-bubble::after { content: ''; display: inline-block; width: 5px; height: 1em; margin-left: 3px; vertical-align: -2px; background: var(--lx-cyan); animation: lx-caret .8s steps(1) infinite; }

  .activity-trace {
    margin: -7px 14px 12px 38px;
    border: 1px solid rgba(185, 217, 210, .14);
    border-radius: 6px;
    background: rgba(7, 12, 16, .46);
    color: rgba(242, 244, 238, .68);
    font-size: 10px;
  }
  .activity-trace summary { padding: 7px 9px; color: var(--lx-cyan); cursor: pointer; user-select: none; }
  .activity-list { display: grid; gap: 0; padding: 0 9px 8px; }
  .activity-item { min-width: 0; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 7px; min-height: 23px; }
  .activity-item small { color: rgba(242, 244, 238, .36); font-size: 9px; }
  .activity-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lx-leaf); }
  .activity-item[data-status="running"] .activity-dot { background: var(--lx-gold); animation: lx-pulse 1s ease-in-out infinite; }
  .activity-item[data-status="failed"] .activity-dot { background: #dc6262; }
  .live-activity { margin-top: 0; }

  .quick-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 0 12px 10px; }
  .quick-action {
    min-width: 0;
    min-height: 42px;
    padding: 5px 9px;
    border: 1px solid rgba(185, 217, 210, .2);
    border-radius: 6px;
    background: rgba(36, 91, 86, .12);
    color: var(--lx-cyan);
    font-size: 11px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .quick-action:hover { border-color: rgba(212, 181, 111, .5); color: var(--lx-moon); }

  .proposal-band {
    margin: 0;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    border-top: 1px solid rgba(212, 181, 111, .28);
    background: rgba(212, 181, 111, .09);
  }
  .proposal-copy { min-width: 0; }
  .proposal-copy strong { display: block; color: var(--lx-gold); font-size: 12px; }
  .proposal-copy span { display: block; margin-top: 2px; color: rgba(242, 244, 238, .6); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .proposal-review, .approval-button {
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid rgba(212, 181, 111, .48);
    border-radius: 6px;
    background: rgba(212, 181, 111, .12);
    color: var(--lx-moon);
    font-weight: 700;
    font-size: 11px;
    cursor: pointer;
  }

  .composer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 42px;
    gap: 7px;
    padding: 10px 11px 11px;
    border-top: 1px solid rgba(185, 217, 210, .14);
    background: rgba(7, 12, 16, .72);
  }
  .composer textarea {
    width: 100%;
    min-height: 42px;
    max-height: 120px;
    resize: none;
    padding: 10px 11px;
    border: 1px solid rgba(185, 217, 210, .18);
    border-radius: 6px;
    outline: 0;
    background: rgba(242, 244, 238, .045);
    color: var(--lx-moon);
    line-height: 1.45;
    font-size: 13px;
  }
  .composer textarea::placeholder { color: rgba(242, 244, 238, .38); }
  .composer-send { width: 42px; height: 42px; color: var(--lx-ink); background: var(--lx-cyan); border-color: transparent; }
  .composer-send:hover { color: var(--lx-ink); background: var(--lx-gold); }
  .composer-send:disabled, .quick-action:disabled, .clear-button:disabled { opacity: .42; cursor: not-allowed; }

  .approval-overlay, .profile-overlay, .new-chat-overlay {
    position: fixed;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 18px;
    pointer-events: auto;
    background: rgba(3, 7, 9, .82);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .approval-dialog, .profile-dialog, .new-chat-dialog {
    width: min(520px, calc(100vw - 28px));
    max-height: min(720px, calc(100vh - 28px));
    overflow: auto;
    border: 1px solid rgba(212, 181, 111, .34);
    border-radius: 8px;
    background: #111820;
    box-shadow: 0 30px 80px rgba(0, 0, 0, .68);
  }
  .approval-dialog:focus-within, .profile-dialog:focus-within, .new-chat-dialog:focus-within { border-color: rgba(212, 181, 111, .58); }
  .approval-head, .profile-head, .new-chat-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border-bottom: 1px solid rgba(185, 217, 210, .14); }
  .approval-head strong, .profile-head strong, .new-chat-head strong { color: var(--lx-moon); font: 700 14px/1.3 var(--font-title, serif); }
  .approval-body { padding: 14px; }
  .approval-note { margin: 0 0 12px; color: rgba(242, 244, 238, .66); font-size: 12px; line-height: 1.6; }
  .approval-impact { margin: 0 0 12px; padding: 9px 10px; border-left: 2px solid var(--lx-gold); background: rgba(212, 181, 111, .07); }
  .approval-impact strong { display: block; color: var(--lx-gold); font-size: 11px; }
  .approval-impact p { margin: 4px 0 0; color: rgba(242, 244, 238, .76); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
  .diff-list { margin: 0 0 14px; border-top: 1px solid rgba(185, 217, 210, .14); }
  .diff-entry { padding: 10px 0; border-bottom: 1px solid rgba(185, 217, 210, .12); }
  .diff-path { color: var(--lx-cyan); font: 700 11px/1.45 var(--font-mono, monospace); overflow-wrap: anywhere; }
  .diff-values { display: grid; grid-template-columns: 1fr 16px 1fr; align-items: start; gap: 5px; margin-top: 7px; }
  .diff-value { min-width: 0; padding: 7px; border-radius: 4px; background: rgba(242, 244, 238, .04); color: rgba(242, 244, 238, .75); font: 11px/1.5 var(--font-mono, monospace); overflow-wrap: anywhere; white-space: pre-wrap; }
  .diff-arrow { padding-top: 7px; color: var(--lx-gold); text-align: center; }
  .approval-error { min-height: 18px; margin: 7px 0 0; color: #ee8878; font-size: 11px; }
  .approval-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 14px 14px; }
  .approval-cancel { border-color: rgba(242, 244, 238, .18); background: transparent; color: rgba(242, 244, 238, .7); }
  .approval-confirm { background: var(--lx-vermillion); border-color: transparent; }
  .approval-confirm:disabled { opacity: .5; cursor: wait; }

  .new-chat-dialog { width: min(440px, calc(100vw - 28px)); }
  .new-chat-body { padding: 14px; }
  .new-chat-note { margin: 0; color: rgba(242, 244, 238, .78); font-size: 12px; line-height: 1.65; }
  .new-chat-pending { margin: 12px 0 0; padding: 9px 10px; border-left: 2px solid var(--lx-gold); background: rgba(212, 181, 111, .08); color: rgba(242, 244, 238, .72); font-size: 11px; line-height: 1.55; }
  .new-chat-error { min-height: 18px; margin: 9px 0 0; color: #ee8878; font-size: 11px; line-height: 1.45; }
  .new-chat-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 12px 14px 14px; border-top: 1px solid rgba(185, 217, 210, .14); }
  .new-chat-cancel { border-color: rgba(242, 244, 238, .18); background: transparent; color: rgba(242, 244, 238, .7); }
  .new-chat-cancel:hover { border-color: rgba(185, 217, 210, .38); background: rgba(185, 217, 210, .07); color: var(--lx-moon); }
  .new-chat-confirm { background: var(--lx-vermillion); border-color: transparent; }
  .new-chat-confirm:hover { background: #df6c58; }
  .new-chat-cancel:focus-visible, .new-chat-confirm:focus-visible { outline: 2px solid var(--lx-gold); outline-offset: 1px; }
  .new-chat-cancel:disabled, .new-chat-confirm:disabled { opacity: .5; cursor: not-allowed; }

  .profile-dialog { width: min(760px, calc(100vw - 28px)); }
  .profile-image { display: block; width: 100%; height: auto; max-height: calc(100vh - 100px); object-fit: contain; background: #f3efe7; }

  .receipt {
    margin: 0 14px 12px 38px;
    padding: 8px 10px;
    border-left: 2px solid var(--lx-leaf);
    background: rgba(80, 134, 111, .09);
    color: var(--lx-cyan);
    font-size: 11px;
    line-height: 1.55;
  }

  @keyframes lx-open { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
  @keyframes lx-pulse { 50% { transform: scale(.7); opacity: .55; } }
  @keyframes lx-caret { 50% { opacity: 0; } }

  @media (max-width: 1180px) and (min-width: 769px) {
    :host { right: 18px; }
    .panel { width: min(370px, calc(100vw - 36px)); }
  }

  @media (max-width: 768px) {
    :host {
      right: 12px;
      bottom: calc(var(--statusbar-h, 30px) + env(safe-area-inset-bottom, 0px) + 8px);
      width: 62px;
      height: 70px;
    }
    .pet-button { width: 62px; height: 70px; }
    .pet-image { width: 60px; height: 60px; }
    .pet-name { display: none; }
    .panel {
      position: fixed;
      right: 8px;
      bottom: calc(var(--statusbar-h, 30px) + env(safe-area-inset-bottom, 0px) + 7px);
      left: 8px;
      width: auto;
      height: calc(100dvh - var(--topbar-h, 56px) - var(--statusbar-h, 30px) - env(safe-area-inset-bottom, 0px) - 16px);
      min-height: 0;
      max-height: 720px;
      border-radius: 8px;
      transform-origin: bottom center;
    }
    .dock.open .pet-button { visibility: hidden; }
    .panel-header { min-height: 58px; cursor: default; touch-action: auto; }
    .messages { padding: 13px 11px 8px; }
    .message.user { padding-left: 30px; }
    .quick-actions { padding-inline: 10px; }
    .approval-overlay, .profile-overlay, .new-chat-overlay { padding: 8px; }
    .approval-dialog, .profile-dialog, .new-chat-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
    .new-chat-body { padding: 12px; }
    .new-chat-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); display: grid; gap: 6px; padding: 10px 12px 12px; }
    .new-chat-actions .approval-button { min-width: 0; min-height: 40px; padding-inline: 8px; }
  }

  @media (max-height: 520px) and (min-width: 769px) {
    .panel {
      height: calc(100dvh - var(--topbar-h, 56px) - var(--statusbar-h, 30px) - 16px);
      min-height: 0;
      max-height: none;
    }
    .panel-header {
      min-height: 48px;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      padding: 5px 8px;
    }
    .profile-button { width: 36px; height: 36px; }
    .api-choice { padding-block: 4px; }
    .messages { padding: 8px 11px 5px; }
    .quick-actions { display: none; }
    .composer { padding: 6px 8px 7px; }
    .composer textarea, .composer-send { min-height: 36px; height: 36px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
`;

export default lingXiCompanionStyles;
