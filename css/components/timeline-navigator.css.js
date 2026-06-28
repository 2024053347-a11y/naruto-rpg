export const timelineStyles = `
        :host { display: block; height: 100%; overflow: hidden; position: relative; }
        .tl {
          display: flex; flex-direction: column; height: 100%; overflow-y: auto; padding: 24px 16px;
          box-sizing: border-box;
          padding-bottom: calc(24px + var(--statusbar-h, 30px));
          background: transparent;
          scrollbar-width: none;
        }
        .tl::-webkit-scrollbar { display: none; }
        
        .tl-title {
          font-size: 18px; text-align: center; margin-bottom: 32px; letter-spacing: 10px; 
          font-family: var(--font-brush); font-weight: normal; 
          background: linear-gradient(135deg, #e8e4d9 0%, #c69c6d 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          display: flex; align-items: center; justify-content: center; gap: 12px;
          text-shadow: 0 2px 10px rgba(198,156,109,0.1);
        }
        .tl-title::before, .tl-title::after {
          content: ''; height: 1px; width: 40px; 
          background: linear-gradient(90deg, transparent, rgba(198,156,109,0.5), transparent);
        }

        .branch {
          font-size: 12px; color: var(--text-secondary); padding: 0 0 8px 0; font-weight: normal; 
          font-family: var(--font-title); margin-top: 24px; margin-bottom: 16px;
          letter-spacing: 4px; border-bottom: 1px solid rgba(255,255,255,0.03);
          display: flex; align-items: center; gap: 10px; position: relative;
        }
        .branch::before {
          content: ''; width: 12px; height: 1px; background: var(--c-shuiro);
          box-shadow: 0 0 8px var(--c-shuiro);
        }
        
        .list { display: flex; flex-direction: column; gap: 4px; position: relative; padding-left: 20px; margin-bottom: 32px; }
        .list::before {
          content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
          background: linear-gradient(to bottom, rgba(198,156,109,0.4) 0%, rgba(255,255,255,0.05) 100%);
        }
        
        .node {
          display: flex; flex-direction: column; gap: 6px; padding: 12px 16px;
          cursor: pointer; border-radius: 4px;
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); font-family: var(--font-title);
          position: relative; background: transparent; margin-left: 8px;
        }
        
        .node::before {
          content: ''; position: absolute; left: -20px; top: 18px;
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--surface-0); border: 1.5px solid rgba(198,156,109,0.3);
          box-shadow: 0 0 8px rgba(198,156,109,0.1);
          z-index: 2; transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); box-sizing: border-box;
        }
        
        .node:hover { 
          background: linear-gradient(90deg, rgba(198,156,109,0.05) 0%, transparent 100%); 
          transform: translateX(4px);
        }
        .node:hover::before { 
          border-color: var(--c-shuiro); background: var(--c-shuiro);
          box-shadow: 0 0 12px var(--c-shuiro); transform: scale(1.2);
        }
        
        .node.cur { 
          background: linear-gradient(90deg, rgba(235,97,63,0.05) 0%, transparent 100%); 
        }
        .node.cur::before {
          border-color: var(--c-shuiro); background: var(--c-shuiro);
          box-shadow: 0 0 16px var(--c-shuiro); transform: scale(1.3);
        }
        
        .node.sel { background: linear-gradient(90deg, rgba(255,255,255,0.03) 0%, transparent 100%); }
        
        .node-chapter { 
          font-size: 13px; font-weight: normal; color: var(--text-secondary); letter-spacing: 2px; 
          font-family: var(--font-title); transition: color 0.3s;
        }
        .node:hover .node-chapter { color: var(--text-primary); }
        .node.cur .node-chapter { color: var(--c-shuiro); text-shadow: 0 0 8px rgba(235,97,63,0.3); }
        .node.sel .node-chapter { color: var(--text-primary); }
        
        .node-summary { 
          font-size: 12px; color: var(--text-tertiary); font-family: var(--font-body);
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
          line-height: 1.6;
        }
        .node.sel .node-summary { display: none; } /* Hide summary when expanded */

        .node-details { margin-top: 8px; animation: fade-down 0.2s ease-out; }

        .node-full-summary {
          font-size: 13px; color: var(--text-primary); line-height: 1.8;
          margin-bottom: 16px; font-family: var(--font-body); opacity: 0.85;
        }

        .node-actions { display: flex; gap: 8px; align-items: center; }
        .jump-btn, .reroll-btn {
          flex: 1; padding: 10px; background: transparent;
          border: 1px solid rgba(255,255,255,0.15); border-radius: 2px;
          font-family: var(--font-title); font-weight: normal; letter-spacing: 2px;
          cursor: pointer; transition: all 0.2s;
        }
        .jump-btn { color: var(--text-secondary); }
        .reroll-btn { color: var(--c-shuiro); border-color: rgba(235,97,63,0.3); }
        .jump-btn:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .reroll-btn:hover { background: rgba(235,97,63,0.1); color: var(--text-primary); }
        
        .cur-text {
          color: var(--c-shuiro); font-size: 11px; font-family: var(--font-title); letter-spacing: 2px;
          display: flex; align-items: center; gap: 8px; opacity: 0.8;
        }
        .cur-text::before, .cur-text::after { content: ''; flex: 1; height: 1px; background: rgba(235,97,63,0.2); }

        .empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 64px 24px; text-align: center; gap: 16px; margin: 32px 16px;
          background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%);
          border-radius: var(--r-md); border: 1px dashed rgba(255,255,255,0.08);
          position: relative; overflow: hidden;
        }
        .empty::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(198,156,109,0.4), transparent);
        }
        .empty-icon {
          width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
          border-radius: 50%; background: rgba(198,156,109,0.05);
          color: var(--c-shuiro); font-size: 20px; font-family: var(--font-brush);
          box-shadow: 0 0 24px rgba(235,97,63,0.1), inset 0 0 12px rgba(198,156,109,0.1);
          margin-bottom: 8px; border: 1px solid rgba(198,156,109,0.15);
        }
        .empty-title {
          font-size: 16px; font-family: var(--font-brush); letter-spacing: 6px;
          color: var(--text-primary); text-shadow: 0 0 12px rgba(255,255,255,0.1);
        }
        .empty-desc {
          font-size: 12px; font-family: var(--font-body); letter-spacing: 2px;
          color: var(--text-tertiary); line-height: 1.8;
        }
        .empty-desc em {
          font-style: normal; color: var(--c-shuiro); opacity: 0.8;
        }

        .control-bento {
          margin-top: 48px; display: flex; flex-direction: column; gap: 8px;
          padding: 0;
        }
        .btn-ghost {
          padding: 12px 16px; font-size: 13px; color: var(--text-secondary); text-align: center;
          border: 1px solid rgba(255,255,255,0.05); border-radius: 2px;
          background: rgba(255,255,255,0.01); font-family: var(--font-title); font-weight: normal; letter-spacing: 4px;
          cursor: pointer; transition: all 0.2s;
        }
        .btn-ghost:hover { border-color: rgba(255,255,255,0.2); color: var(--text-primary); background: rgba(255,255,255,0.05); }
        
        .btn-ghost.danger { color: var(--c-kokihi); border-color: rgba(201,23,30,0.15); background: rgba(201,23,30,0.02); }
        .btn-ghost.danger:hover { border-color: rgba(201,23,30,0.4); background: rgba(201,23,30,0.08); }

        .modal-overlay {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(3,4,6,0.8); backdrop-filter: var(--blur-lg); z-index: 100;
          display: none; flex-direction: column; align-items: center; justify-content: center; padding: 24px;
        }
        .modal-overlay.active { display: flex; animation: modal-fade-in 0.2s ease-out; }
        @keyframes modal-fade-in { from{opacity:0; backdrop-filter:blur(0);} to{opacity:1; backdrop-filter:var(--blur-lg);} }
        
        .modal-content {
          background: rgba(15, 18, 24, 0.95); border: 1px solid rgba(255,255,255,0.1);
          width: 100%; max-width: 320px; padding: 32px 24px; border-radius: var(--r-md);
          display: flex; flex-direction: column; gap: 16px;
          box-shadow: 0 24px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
          position: relative;
        }
        .modal-content::before {
          content: ''; position: absolute; top: 0; left: 24px; right: 24px; height: 1px;
          background: linear-gradient(90deg, transparent, var(--c-shuiro), transparent); opacity: 0.5;
        }
        
        .modal-title { font-size: 16px; color: var(--text-primary); text-align: center; font-weight: 900; letter-spacing: 2px; font-family: var(--font-title); margin-bottom: 8px;}
        .branch-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid rgba(255,255,255,0.05); border-radius: var(--r-sm); background: rgba(255,255,255,0.02); }
        .branch-name { font-size: 12px; color: var(--text-primary); font-weight: 800; }
        .branch-actions { display: flex; gap: 8px; }
        .promote-branch-btn { padding: 4px 10px; font-size: 10px; background: rgba(255,255,255,0.05); border: none; color: var(--text-primary); cursor: pointer; border-radius: 2px;}
        .promote-branch-btn:hover { background: rgba(255,255,255,0.15); }
        .del-branch-btn { padding: 4px 10px; font-size: 10px; background: rgba(201,23,30,0.1); border: none; color: var(--c-kokihi); cursor: pointer; border-radius: 2px;}
        .del-branch-btn:hover { background: rgba(201,23,30,0.25); }
        .modal-close { margin-top: 16px; padding: 12px; text-align: center; font-size: 11px; font-weight: 800; cursor: pointer; background: rgba(255,255,255,0.05); border: none; color: var(--text-secondary); border-radius: var(--r-sm); transition: 0.2s; letter-spacing: 2px; }
        .modal-close:hover { color: var(--text-primary); background: rgba(255,255,255,0.1); }
      </style>

`;

