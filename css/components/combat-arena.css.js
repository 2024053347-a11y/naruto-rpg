export const combatStyles = `
        :host { display: block; contain: layout style paint; }
        .scene {
          display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center;
          padding: 20px; margin: 20px 0;
          background:
            repeating-conic-gradient(from 18deg at 50% 44%, transparent 0 13deg, rgba(63,215,255,0.055) 13deg 14deg, transparent 14deg 26deg),
            linear-gradient(135deg, rgba(201,23,30,0.12), transparent 30%, rgba(63,215,255,0.07)),
            var(--c-sumi, #111821);
          border: 1px solid rgba(232,200,122,0.24);
          border-radius: 4px;
          box-shadow: 6px 6px 0px rgba(0,0,0,0.5), 0 0 28px rgba(63,215,255,0.10);
          animation: scene-in 0.3s cubic-bezier(0.4,0,0.2,1.4);
          position: relative;
          overflow: hidden;
        }
        .scene::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #eb613f, #3fd7ff, #c69c6d, #eb613f); }
        .scene::after {
          content: '';
          position: absolute;
          inset: -30% auto auto 50%;
          width: 240px;
          height: 240px;
          transform: translateX(-50%);
          border-radius: 50%;
          border: 1px solid rgba(63,215,255,0.16);
          background: repeating-conic-gradient(from 0deg, rgba(63,215,255,0.10) 0 1deg, transparent 1deg 16deg);
          opacity: 0.38;
          pointer-events: none;
          animation: combat-seal 18s linear infinite;
        }
        @keyframes combat-seal { to { transform: translateX(-50%) rotate(360deg); } }
        @keyframes scene-in { from{opacity:0;transform:translateY(-8px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        .title { grid-column:1/-1; text-align:center; font-size:14px; color:#c69c6d; font-weight:700; letter-spacing:2px; font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif; }
        .ct {
          text-align:center; padding:14px; background:rgba(7,10,14,0.48); border-radius:4px; border:1px solid rgba(232,228,217,0.10);
          box-shadow: inset 0 1px 0 rgba(232,228,217,0.04);
          position: relative;
          z-index: 1;
        }
        .ct .name { font-size:14px; color:#c69c6d; margin-bottom:5px; font-weight:600; font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif; }
        .ct .sub { font-size:11px; color:#6e6a65; margin-bottom:5px; }
        .hp-bar { height:5px; background:var(--surface-4, #2c3744); margin-top:6px; overflow:hidden; box-shadow: inset 0 0 10px rgba(0,0,0,0.45); }
        .hp-fill { height:100%; transition:width 0.6s cubic-bezier(0.8,0,0.2,1); box-shadow:0 0 16px currentColor; }
        .hp-fill.p { background:linear-gradient(90deg,#1B5E20,#66BB6A); }
        .hp-fill.e { background:linear-gradient(90deg,#B71C1C,#ef5350); }
        .vs { font-size:22px; color:#c9171e; text-shadow:0 0 12px rgba(201,23,30,0.4), 0 0 24px rgba(63,215,255,0.16); text-align:center; font-weight:800; font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif; position:relative; z-index:1; }
        .actions { grid-column:1/-1; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; position:relative; z-index:1; }
        .btn {
          padding:8px 14px; font-size:12px; background:rgba(235,97,63,0.06);
          border:1px solid rgba(235,97,63,0.25); color:#eb613f; border-radius:4px;
          cursor:pointer; transition:transform 0.15s, background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s; font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif;
          font-weight:600; letter-spacing:0.5px;
        }
        .btn:hover { background:rgba(63,215,255,0.10); border-color:#3fd7ff; color:#3fd7ff; transform:translateY(-1px); box-shadow:0 0 16px rgba(63,215,255,0.16); }
        .btn:disabled { opacity:.35; cursor:not-allowed; }
        :host([data-disabled]) .btn { opacity:.35; cursor:not-allowed; }
        .btn.d { border-color:rgba(201,23,30,0.3); color:#ef5350; }
        .btn.d:hover { background:rgba(201,23,30,0.06); }
        .log { grid-column:1/-1; font-size:11px; color:#6e6a65; padding:8px 12px; background:rgba(0,0,0,0.2); border-radius:2px; max-height:60px; overflow-y:auto; font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif; position:relative; z-index:1; }
        @media (prefers-reduced-motion: reduce) { .scene::after { animation: none; } }
      </style>

`;

