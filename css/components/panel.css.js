export const panelStyles = `
        :host { display: block; height: 100%; }
        .panel {
          display: flex; flex-direction: column; height: 100%; overflow: hidden;
          background: transparent;
          color: var(--text-primary);
          position: relative;
        }

        /* ── Mobile Panel Header ──── */
        .panel-header-mobile {
          display: flex; justify-content: space-between; align-items: center;
          padding: 14px 16px 12px 20px; border-bottom: 1px solid var(--border-hairline);
          background: rgba(255,255,255,0.02);
        }
        .panel-title-mobile {
          font-family: var(--font-title); font-size: 13px; font-weight: 800;
          color: var(--text-primary); letter-spacing: 2px;
        }
        .panel-close-btn-mobile {
          background: transparent; border: none; color: var(--text-secondary);
          font-size: 18px; cursor: pointer; padding: 4px; display: flex;
          align-items: center; justify-content: center; transition: all 0.2s;
          line-height: 1;
        }
        .panel-close-btn-mobile:hover {
          color: var(--text-primary); transform: scale(1.1);
        }

        /* ── 标签页 (Shinobi Tanzaku) ──── */
        .tabs {
          display: flex; gap: 8px; padding: 0 16px;
          border-bottom: 1px solid var(--border-hairline);
          z-index: 5;
        }
        .tab {
          flex: 1; padding: 16px 2px 12px; font-size: 11px; text-align: center; color: var(--text-tertiary);
          cursor: pointer; border: none; background: transparent; border-bottom: 2px solid transparent;
          transition: all 0.2s; letter-spacing: 2px;
          font-family: var(--font-title); margin-bottom: -1px;
        }
        .tab:hover { color: var(--text-secondary); }
        .tab.on { 
          color: var(--text-primary); font-weight: 800; border-bottom-color: var(--text-primary);
        }

        @keyframes content-enter {
          from { opacity: 0; transform: translateY(16px) scale(0.98); filter: blur(4px); }
          to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .content { 
          flex: 1; overflow-y: auto; padding: 24px 20px; 
          scrollbar-width: none; -ms-overflow-style: none;
          mask-image: linear-gradient(to bottom, transparent, #000 24px, #000 calc(100% - 24px), transparent);
          -webkit-mask-image: linear-gradient(to bottom, transparent, #000 24px, #000 calc(100% - 24px), transparent);
          animation: content-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .content::-webkit-scrollbar { display: none; }

        /* ── 章节容器 (Scroll Section) ──── */
        .sec {
          margin-bottom: 40px; position: relative;
        }
        
        .sec-title {
          font-size: 10px; font-weight: 800; color: var(--text-tertiary); text-transform: uppercase;
          letter-spacing: 4px; margin-bottom: 24px; font-family: var(--font-title);
          display: flex; align-items: center; gap: 12px;
        }
        .sec-title::after {
          content: ''; flex: 1; height: 1px; 
          background: var(--border-hairline);
        }

        /* ── 数据行 (Shinobi Stats) ──── */
        .row { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--border-hairline); position: relative; }
        .row-l { 
          font-size: 11px; color: var(--text-tertiary); font-family: var(--font-title); 
          letter-spacing: 2px; text-transform: uppercase;
        }
        .row-v {
          font-size: 13px; color: var(--text-primary); font-family: var(--font-body); font-weight: 500; letter-spacing: 1px;
        }

        /* ── 属性面板 (Attribute Bento) ──── */
        .chakra-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; margin-bottom: 8px; }
        .chakra-badge { 
          display: inline-flex; align-items: center; justify-content: center;
          padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 800; letter-spacing: 2px;
          border: 1px solid currentColor; background: rgba(0,0,0,0.2);
          box-shadow: inset 0 0 8px currentColor;
        }

        .attr-bento { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
        .attr-card {
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          border-radius: var(--r-md); padding: 16px; position: relative; overflow: hidden;
          display: flex; flex-direction: column; justify-content: center;
        }
        .attr-card.full-span { grid-column: 1 / -1; }
        .attr-card:hover { background: var(--surface-bento-hover); }
        .attr-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 6px; }
        .attr-value { font-family: var(--font-title); font-size: 16px; font-weight: 800; color: var(--text-primary); letter-spacing: 1px; }
        
        .attr-id-badge {
          display: flex; justify-content: space-between; align-items: center; flex-direction: row;
          padding: 24px; background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 100%);
          border-left: 2px solid var(--c-kin-bright);
        }
        .attr-id-name { 
          font-family: var(--font-brush); font-size: 32px; color: var(--c-kin-bright); line-height: 1; margin-top: 4px; 
          background: linear-gradient(90deg, var(--c-kin-bright) 0%, #fff 50%, var(--c-kin-bright) 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shine-name 4s linear infinite;
        }
        @keyframes shine-name { to { background-position: 200% center; } }
        
        .attr-id-rank { font-size: 12px; font-weight: 800; letter-spacing: 4px; color: var(--text-secondary); opacity: 0.8; }
        
        .attr-threat { 
          position: absolute; inset: 0; background: radial-gradient(circle at right bottom, var(--threat-color, rgba(255,255,255,0.1)) 0%, transparent 70%); 
          opacity: 0.1; pointer-events: none; 
          animation: pulse-threat-bg 4s ease-in-out infinite alternate;
        }
        @keyframes pulse-threat-bg { from { opacity: 0.1; } to { opacity: 0.25; } }
        
        .attr-threat-val { 
          font-family: var(--font-mono); font-size: 24px; font-weight: 900; color: var(--threat-color, var(--text-primary)); 
          text-shadow: 0 0 16px var(--threat-color, transparent); display: flex; align-items: baseline; gap: 4px; 
          white-space: nowrap;
          animation: pulse-threat 3s ease-in-out infinite alternate;
        }
        @keyframes pulse-threat {
          from { text-shadow: 0 0 8px var(--threat-color, transparent); }
          to { text-shadow: 0 0 24px var(--threat-color, transparent), 0 0 40px var(--threat-color, transparent); transform: scale(1.02) translateX(1%); }
        }
        .attr-bar-wrap { margin-bottom: 16px; }
        .attr-bar-label { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 8px; color: var(--text-secondary); letter-spacing: 1px; }
        .attr-bar-track { height: 2px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; }
        .attr-bar-fill { height: 100%; box-shadow: 0 0 8px currentColor; transition: width 1s var(--ease-out); }

        /* ── 查克拉条 (Liquid Chakra Bars - Old fallback) ──── */
        .bar-wrap { margin: 12px 0 20px; position: relative; }
        .bar { 
          height: 2px; background: rgba(255,255,255,0.05);
          overflow: hidden; 
        }
        .bar-fill { 
          height: 100%; border-radius: 0; 
          transition: width 1s var(--ease-out); 
        }

        /* ── 技能与装备卡片 (Bento Grid Items) ──── */
        .grid-list { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .item-card {
          padding: 16px; border-radius: var(--r-md);
          box-shadow: var(--shadow-inner); background: var(--surface-bento);
          transition: all 0.3s var(--ease-out); position: relative; overflow: hidden;
        }
        .item-card:hover { 
          background: var(--surface-bento-hover); box-shadow: var(--shadow-inner-hover);
          transform: translateY(-1px);
        }
        /* 法阵边缘装饰 */
        .item-card::before {
          content: ''; position: absolute; top: 0; left: 0; width: 12px; height: 12px;
          border-top: 1.5px solid var(--c-shuiro); border-left: 1.5px solid var(--c-shuiro);
          border-top-left-radius: var(--r-md); opacity: 0; transition: opacity 0.3s; pointer-events: none;
        }
        .item-card:hover::before { opacity: 0.8; }
        .item-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
        .item-name { font-family: var(--font-title); font-size: 16px; font-weight: 800; color: var(--text-primary); letter-spacing: 1px; }
        .item-tag { font-size: 9px; color: var(--text-secondary); padding: 2px 6px; border: 1px solid var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; }
        .item-desc { font-size: 12px; color: var(--text-tertiary); line-height: 1.6; font-family: var(--font-body); max-width: 90%; }

        /* ── 任务勋章 (Mission Seals) ──── */
        .mission-seal {
          padding: 16px; margin-bottom: 0; display: grid; grid-template-columns: 32px 1fr; gap: 16px; align-items: start;
          box-shadow: var(--shadow-inner); background: var(--surface-bento); border-radius: var(--r-md); transition: all 0.2s;
        }
        .mission-seal:hover { background: var(--surface-bento-hover); box-shadow: var(--shadow-inner-hover); transform: translateY(-1px); }
        .mission-seal .rank-badge {
          font-family: var(--font-title); font-size: 20px; font-weight: 800; opacity: 0.8;
          text-align: center; border-bottom: 2px solid currentColor; padding-bottom: 4px;
        }
        /* ── 技能与天赋 (Skills) ──── */
        .skill-card {
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          border-radius: var(--r-md); padding: 16px; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative; overflow: hidden; border-left: 2px solid var(--border-subtle);
        }
        .skill-card:hover { transform: translateY(-2px); background: var(--surface-bento-hover); border-left-color: var(--text-primary); }
        .skill-card.bloodline {
          text-align: center; border-left: none; padding: 24px;
          background: radial-gradient(circle at center, rgba(239,83,80,0.1) 0%, var(--surface-bento) 100%);
          box-shadow: inset 0 0 0 1px rgba(239,83,80,0.2), var(--shadow-inner);
        }
        .skill-card.bloodline.normal { background: var(--surface-bento); box-shadow: var(--shadow-inner); }
        .skill-title { font-family: var(--font-title); font-size: 16px; font-weight: 800; letter-spacing: 1px; color: var(--text-primary); }
        .bloodline .skill-title { font-size: 20px; color: #ef5350; text-shadow: 0 0 10px rgba(239,83,80,0.5); letter-spacing: 4px; }
        .bloodline.normal .skill-title { color: var(--text-secondary); text-shadow: none; letter-spacing: 2px; }
        
        .skill-mastery-tag {
          font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; letter-spacing: 1px;
          background: rgba(198,156,109,0.1); color: var(--c-kin-bright); border: 1px solid rgba(198,156,109,0.3);
        }
        
        .skill-empty {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; padding: 32px 16px; min-height: 100px;
          background: rgba(0,0,0,0.2); border-radius: var(--r-md); box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
          color: var(--text-tertiary); font-size: 11px; letter-spacing: 1px;
        }
        .skill-empty svg { width: 32px; height: 32px; opacity: 0.15; color: var(--text-primary); }
        .skill-empty em { font-style: normal; color: var(--text-secondary); font-weight: bold; }

        .skill-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
        .skill-search { flex: 1; min-width: 120px; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); color: var(--text-primary); font-size: 12px; outline: none; }
        .skill-search:focus { border-color: rgba(198,156,109,0.5); }
        .skill-btn { padding: 4px 10px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); background: transparent; color: var(--text-tertiary); font-size: 10px; cursor: pointer; transition: all 0.15s; white-space: nowrap; letter-spacing: 1px; }
        .skill-btn:hover { border-color: rgba(255,255,255,0.2); color: var(--text-secondary); }
        .skill-btn.active { border-color: var(--c-kin-bright); color: var(--c-kin-bright); background: rgba(198,156,109,0.08); }
        .skill-summary { font-size: 10px; color: var(--text-tertiary); margin-bottom: 12px; padding-left: 4px; }

        .skill-collapse-title { cursor: pointer; display: flex; align-items: center; gap: 8px; user-select: none; }
        .skill-collapse-title .arrow { transition: transform 0.2s; font-size: 10px; color: var(--text-tertiary); }
        .skill-collapse-title .arrow.open { transform: rotate(90deg); }
        .skill-collapse-badge { font-size: 10px; color: var(--text-tertiary); font-weight: normal; margin-left: 4px; }
        .skill-section-body { overflow: hidden; transition: max-height 0.35s var(--ease-out); }
        .skill-section-body.collapsed { max-height: 0 !important; opacity: 0; }

        .skill-compact-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); cursor: pointer; transition: all 0.15s; font-size: 12px; }
        .skill-compact-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.06); }
        .skill-compact-row .skill-name { font-weight: 600; color: var(--text-primary); flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
        .skill-compact-row .skill-meta { font-size: 10px; color: var(--text-secondary); display: flex; gap: 8px; align-items: center; }
        .skill-compact-row .skill-mastery-num { margin-left: auto; font-size: 11px; color: var(--text-tertiary); white-space: nowrap; }

        .skill-detail { display: none; padding: 10px 0 2px; }
        .skill-card.expanded .skill-detail { display: block; }
        .skill-detail-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 8px; }
        .skill-detail-mastery { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.05); margin: 8px 0; overflow: hidden; }
        .skill-detail-mastery div { height: 100%; border-radius: 2px; background: var(--c-kin-bright); transition: width 0.4s; }

        .mission-seal { border-left: 4px solid var(--border-subtle); padding-left: 12px; }
        .mission-seal.S .rank-badge { color: #ef5350; }
        .mission-seal.A .rank-badge { color: #eb613f; }
        .mission-seal.B .rank-badge { color: #c69c6d; }
        .mission-seal.C .rank-badge { color: #42A5F5; }
        .mission-seal.D .rank-badge { color: #81c784; }

        /* ── 关系印记 (Fate Link) ──── */
        .rel-card-wrap {
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          border-radius: var(--r-md); padding: 16px; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative; overflow: hidden; cursor: pointer;
        }
        .rel-card-wrap:hover { transform: translateY(-2px); background: var(--surface-bento-hover); }
        .rel-card-wrap.rel-pinned {
          border-left: 3px solid #c69c6d;
          background: linear-gradient(135deg, rgba(198,156,109,0.06), var(--surface-bento));
        }
        .rel-card-wrap.rel-pinned:hover { background: linear-gradient(135deg, rgba(198,156,109,0.1), var(--surface-bento-hover)); }
        .rel-pin-tag {
          font-size: 13px; margin-left: 6px; filter: none; line-height: 1;
        }
        .rel-expand-hint { text-align: center; font-size: 10px; color: var(--text-tertiary); margin-top: 12px; opacity: 0.5; transition: opacity 0.2s; }
        .rel-card-wrap:hover .rel-expand-hint { opacity: 0.8; }
        
        .rel-actions {
          position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; opacity: 0; transition: opacity 0.2s;
        }
        .rel-card-wrap:hover .rel-actions { opacity: 1; }
        @media (hover: none) { .rel-actions { opacity: 1; } }
        .rel-action-btn {
          width: 26px; height: 26px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.35); font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;
        }
        .rel-action-btn:hover { background: rgba(255,255,255,0.1); color: #fff; border-color: rgba(255,255,255,0.15); }
        .rel-action-btn.pin-active { color: #c69c6d; border-color: rgba(198,156,109,0.3); }
        .rel-action-btn.del-hover:hover { background: rgba(239,83,80,0.15); color: #ef5350; border-color: rgba(239,83,80,0.3); }
        
        .rel-header {
          display: flex; gap: 16px; align-items: center; margin-bottom: 16px;
        }
        
        /* Hexagon Avatar */
        .rel-avatar-ring {
          position: relative; width: 56px; height: 56px;
          display: flex; align-items: center; justify-content: center;
          filter: drop-shadow(0 0 8px rgba(198,156,109,0.2));
        }
        .rel-avatar-ring::before {
          content: ''; position: absolute; inset: 0;
          background: conic-gradient(from 0deg, transparent, rgba(198,156,109,0.8), transparent);
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
          padding: 1px; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
          animation: spin 6s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .rel-avatar {
          width: 50px; height: 50px; background: var(--surface-0);
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-brush); color: var(--c-kin-bright); font-size: 24px; font-weight: bold;
        }
        
        .rel-info { min-width: 0; flex: 1; }
        .rel-info-title { font-size: 16px; font-family: var(--font-title); font-weight: 800; color: var(--text-primary); letter-spacing: 1px; }
        .rel-info-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 4px; display: flex; gap: 8px; align-items: center; }
        
        /* Dashboard Stats */
        .rel-dashboard {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
          background: rgba(0,0,0,0.2); padding: 12px; border-radius: var(--r-sm);
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.02);
        }
        .dash-stat { display: flex; flex-direction: column; gap: 6px; }
        .dash-label { font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 1px; }
        .dash-value { font-size: 16px; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary); display: flex; align-items: baseline; gap: 4px; }
        .dash-bar-bg { height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
        .dash-bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease-out; }
        
        /* Glass Pill Tags */
        .rel-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
        .glass-pill {
          padding: 4px 10px; font-size: 10px; font-weight: 600; letter-spacing: 1px;
          background: rgba(255,255,255,0.05); color: var(--text-secondary);
          border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
          backdrop-filter: blur(4px); display: inline-flex; align-items: center;
        }

        .tag {
          display: inline-block; padding: 2px 0; font-size: 10px; border-radius: 0; border-bottom: 1px solid var(--border-subtle);
          background: transparent; color: var(--text-secondary);
          font-family: var(--font-title); font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-right: 8px;
        }
        .gold { color: var(--c-kin-bright); }
        .empty { padding: 40px 20px; text-align: center; color: var(--text-tertiary); font-family: var(--font-body); font-size: 12px; line-height: 1.8; opacity: 0.8; }
        .empty em { font-style: normal; color: var(--text-primary); font-family: var(--font-title); }

        /* ── 装备栏阶梯视觉系统 ──── */
        .eq-svg { width: 1.2em; height: 1.2em; display: inline-block; vertical-align: middle; }
        
        .eq-empty-slot {
          background: rgba(0, 0, 0, 0.4);
          box-shadow: inset 0 2px 10px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.02);
          border-radius: var(--r-md); padding: 12px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 8px; min-height: 80px; transition: all 0.2s;
        }
        .eq-empty-slot svg {
          width: 28px; height: 28px; opacity: 0.15; color: var(--text-primary);
        }
        .eq-empty-slot span { font-size: 10px; color: var(--text-tertiary); letter-spacing: 2px; opacity: 0.5; }
        
        .eq-card {
          padding: 12px; border-radius: var(--r-md); position: relative; overflow: hidden;
          background: var(--surface-bento); box-shadow: var(--shadow-inner);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .eq-card:hover { transform: translateY(-2px); }
        
        /* 阶梯化品质特质 */
        /* 普通: --surface-bento 默认无光效 */
        /* 精良 */
        .eq-card[data-quality="精良"] { border-left: 2px solid #66BB6A; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), -4px 0 15px -2px rgba(102,187,106,0.15); }
        /* 优秀 */
        .eq-card[data-quality="优秀"] { border-left: 2px solid #42A5F5; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05), -4px 0 15px -2px rgba(66,165,245,0.2); }
        /* 史诗 */
        .eq-card[data-quality="史诗"] { 
          border-left: 2px solid #c69c6d;
          background: radial-gradient(circle at right bottom, rgba(198,156,109,0.1) 0%, var(--surface-bento) 70%);
          box-shadow: inset 0 0 0 1px rgba(198,156,109,0.2), -4px 0 20px -2px rgba(198,156,109,0.25);
        }
        /* 传说 */
        @keyframes legendaryPulse { 0% { box-shadow: inset 0 0 0 1px rgba(239,83,80,0.3), 0 0 15px rgba(239,83,80,0.2); } 50% { box-shadow: inset 0 0 0 1px rgba(239,83,80,0.5), 0 0 25px rgba(239,83,80,0.4); } 100% { box-shadow: inset 0 0 0 1px rgba(239,83,80,0.3), 0 0 15px rgba(239,83,80,0.2); } }
        .eq-card[data-quality="传说"] {
          border-left: 2px solid #ef5350;
          background: radial-gradient(circle at right bottom, rgba(239,83,80,0.15) 0%, rgba(14,18,24,0.9) 80%);
          animation: legendaryPulse 3s infinite;
        }
        
        .eq-watermark {
          position: absolute; right: -10%; bottom: -20%; font-family: var(--font-brush);
          font-size: 64px; color: currentColor; opacity: 0.04; pointer-events: none;
          transform: rotate(-15deg); font-weight: 900;
        }
        .eq-card[data-quality="史诗"] .eq-watermark { opacity: 0.08; color: #c69c6d; }
        .eq-card[data-quality="传说"] .eq-watermark { opacity: 0.12; color: #ef5350; font-size: 80px; }
        
        .btn-sleek {
          background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle);
          color: var(--text-secondary); border-radius: var(--r-md);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s; font-size: 11px; font-weight: 700;
        }
        .btn-sleek:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); border-color: rgba(255,255,255,0.2); }
        .btn-sleek.active { background: rgba(255,255,255,0.1); border-color: var(--text-primary); color: var(--c-void); background: var(--text-primary); }

`;

