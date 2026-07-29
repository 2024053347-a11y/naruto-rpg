import { validateShinobiDaily } from '../core/shinobi-daily.js';
import { icon } from '../utils/icons.js';

const MODAL_TAG = 'shinobi-daily-modal';
const HTMLElementBase = globalThis.HTMLElement || class {};

const MODAL_STYLES = `
  :host {
    --daily-paper: #f5f0e3;
    --daily-paper-deep: #e8dec3;
    --daily-ink: #2b2a26;
    --daily-ink-soft: #57544b;
    --daily-ink-faint: #7a766c;
    --daily-line: #bdb49d;
    --daily-red: #9e2f24;
    --daily-red-deep: #742018;
    font-family: "Noto Serif SC", "Songti SC", SimSun, serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  dialog {
    inset: 0;
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 20px;
    border: 0;
    background: transparent;
    color: var(--daily-ink);
    overflow: hidden;
  }
  dialog[open] { display: flex; align-items: center; justify-content: center; }
  dialog::backdrop { background: rgba(18, 17, 15, 0.7); backdrop-filter: blur(5px); }
  .paper {
    position: relative;
    width: min(880px, 100%);
    max-height: calc(100dvh - 40px);
    overflow: auto;
    padding: 34px 42px 42px;
    border: 1px solid #a99e80;
    border-radius: 4px;
    background:
      repeating-linear-gradient(0deg, transparent 0 25px, rgba(43, 42, 38, 0.028) 25px 26px),
      linear-gradient(168deg, #fbf7ec 0%, var(--daily-paper) 58%, var(--daily-paper-deep) 100%);
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.48), inset 0 0 52px rgba(43, 42, 38, 0.08);
    scrollbar-width: thin;
    scrollbar-color: var(--daily-ink-soft) var(--daily-paper-deep);
    animation: daily-paper-in 260ms ease-out both;
  }
  .paper::before {
    content: "";
    position: absolute;
    inset: 10px;
    z-index: 0;
    border: 1px solid rgba(43, 42, 38, 0.24);
    pointer-events: none;
  }
  .paper > * { position: relative; z-index: 1; }
  @keyframes daily-paper-in {
    from { opacity: 0; transform: translateY(14px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .close {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 4;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 2px solid var(--daily-ink);
    border-radius: 50%;
    background: var(--daily-paper);
    color: var(--daily-ink);
    cursor: pointer;
    transition: color 160ms ease, background 160ms ease, transform 160ms ease;
  }
  .close:hover, .close:focus-visible {
    background: var(--daily-ink);
    color: var(--daily-paper);
    transform: rotate(90deg);
    outline: 2px solid var(--daily-red);
    outline-offset: 2px;
  }
  .masthead {
    display: grid;
    grid-template-columns: 68px minmax(0, 1fr) 142px;
    align-items: center;
    gap: 18px;
    min-height: 82px;
    padding: 0 50px 17px 0;
    border-bottom: 3px double var(--daily-ink);
  }
  .mast-seal {
    display: grid;
    place-items: center;
    width: 62px;
    height: 62px;
    border: 3px double var(--daily-red);
    border-radius: 4px;
    color: var(--daily-red-deep);
    font: 700 34px/1 "STKaiti", KaiTi, serif;
    transform: rotate(-3deg);
  }
  .mast-title { min-width: 0; text-align: center; }
  .mast-title h1 {
    margin: 0;
    color: var(--daily-ink);
    font: 700 50px/1.08 "STKaiti", KaiTi, serif;
    letter-spacing: 0;
  }
  .mast-title p {
    margin: 6px 0 0;
    color: var(--daily-ink-faint);
    font-size: 12px;
    line-height: 1.45;
    letter-spacing: 0;
  }
  .mast-date {
    min-width: 0;
    padding-right: 12px;
    border-right: 3px solid var(--daily-red);
    color: var(--daily-ink-soft);
    text-align: right;
    font-size: 12px;
    line-height: 1.65;
    overflow-wrap: anywhere;
  }
  .mast-date strong { display: block; color: var(--daily-ink); font-size: 14px; }
  .dateline, .toc, .colophon {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 5px 16px;
    color: var(--daily-ink-faint);
    font-size: 11px;
    line-height: 1.55;
  }
  .dateline { padding: 7px 2px 9px; border-bottom: 1px solid var(--daily-line); }
  .toc {
    justify-content: flex-start;
    padding: 8px 2px 12px;
    border-bottom: 2px solid var(--daily-ink);
    color: var(--daily-ink-soft);
    font-size: 12px;
  }
  .toc b { margin-right: 3px; color: var(--daily-red); }
  .section { margin-top: 24px; }
  .section-head {
    display: grid;
    grid-template-columns: 30px auto minmax(20px, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 13px;
  }
  .section-number {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 3px;
    background: var(--daily-red);
    color: var(--daily-paper);
    font: 700 18px/1 "STKaiti", KaiTi, serif;
    box-shadow: 2px 2px 0 rgba(43, 42, 38, 0.2);
  }
  .section-head h2 {
    margin: 0;
    color: var(--daily-ink);
    font: 700 22px/1.2 "STKaiti", KaiTi, serif;
    letter-spacing: 0;
  }
  .section-line { height: 1px; background: var(--daily-ink); opacity: 0.6; }
  .section-en { color: var(--daily-ink-faint); font-size: 10px; }
  .headline {
    position: relative;
    padding: 22px 24px 18px;
    border: 2px solid var(--daily-ink);
    background: rgba(255, 253, 244, 0.52);
  }
  .headline-kicker {
    position: absolute;
    top: -12px;
    left: 18px;
    padding: 3px 12px;
    background: var(--daily-red);
    color: #fffaf0;
    font-size: 11px;
    font-weight: 700;
  }
  .headline h3 {
    margin: 4px 0 9px;
    color: var(--daily-ink);
    font-size: 26px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .headline p, .news-card p, .flavor-copy p {
    margin: 0;
    color: var(--daily-ink-soft);
    font-size: 13px;
    line-height: 1.9;
    text-align: justify;
    overflow-wrap: anywhere;
  }
  .headline .signature { margin-top: 10px; color: var(--daily-ink-faint); font-size: 11px; text-align: right; }
  .world-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .news-card {
    min-width: 0;
    padding: 13px 15px;
    border: 1px solid var(--daily-line);
    border-radius: 2px;
    background: rgba(255, 253, 244, 0.46);
  }
  .news-tag {
    display: inline-block;
    margin-bottom: 7px;
    padding: 2px 9px;
    background: var(--daily-ink);
    color: var(--daily-paper);
    font-size: 10px;
    font-weight: 700;
  }
  .news-card h3, .flavor-copy h3 {
    margin: 0 0 5px;
    color: var(--daily-ink);
    font-size: 15px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .flavor-list { display: grid; gap: 10px; }
  .flavor-item {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 13px;
    align-items: start;
    padding: 11px 14px;
    border-left: 3px solid var(--daily-ink);
    background: rgba(255, 253, 244, 0.42);
  }
  .flavor-mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 2px solid var(--daily-ink);
    border-radius: 50%;
    color: var(--daily-ink);
    font: 700 21px/1 "STKaiti", KaiTi, serif;
    transform: rotate(-5deg);
  }
  .mission-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
  .mission-table th {
    padding: 8px 9px;
    background: var(--daily-ink);
    color: var(--daily-paper);
    font-weight: 700;
  }
  .mission-table th:nth-child(1) { width: 64px; }
  .mission-table th:nth-child(3) { width: 92px; }
  .mission-table th:nth-child(4) { width: 92px; }
  .mission-table td {
    padding: 9px;
    border: 1px solid var(--daily-line);
    background: rgba(255, 253, 244, 0.42);
    color: var(--daily-ink-soft);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .mission-table tr:nth-child(even) td { background: rgba(43, 42, 38, 0.045); }
  .rank {
    display: inline-grid;
    place-items: center;
    width: 27px;
    height: 27px;
    color: var(--daily-paper);
    font-weight: 900;
  }
  .rank-D { background: #8b877f; }
  .rank-C { background: #5f675a; }
  .rank-B { background: #2b2a26; }
  .rank-A { background: var(--daily-red); }
  .quote {
    position: relative;
    padding: 24px 34px 18px;
    border-top: 3px double var(--daily-ink);
    border-bottom: 3px double var(--daily-ink);
    text-align: center;
  }
  .quote::before, .quote::after {
    position: absolute;
    color: rgba(158, 47, 36, 0.3);
    font: 700 44px/1 "STKaiti", KaiTi, serif;
  }
  .quote::before { content: "「"; top: 3px; left: 7px; }
  .quote::after { content: "」"; right: 7px; bottom: -3px; }
  .quote-text {
    margin: 0;
    color: var(--daily-ink);
    font: 700 22px/1.7 "STKaiti", KaiTi, serif;
    overflow-wrap: anywhere;
  }
  .quote-who { margin-top: 8px; color: var(--daily-ink-faint); font-size: 11px; }
  .colophon {
    align-items: center;
    margin-top: 22px;
    padding-top: 11px;
    border-top: 1px solid var(--daily-line);
  }
  .edition-seal {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    width: 58px;
    height: 58px;
    padding: 6px;
    border-radius: 4px;
    background: var(--daily-red);
    color: #fff8e8;
    font: 700 18px/1 "STKaiti", KaiTi, serif;
    box-shadow: inset 0 0 0 2px #fff8e8, inset 0 0 0 5px var(--daily-red);
    transform: rotate(-5deg);
  }
  .edition-seal span { display: grid; place-items: center; }
  @media (max-width: 680px) {
    dialog { padding: 10px; }
    .paper { max-height: calc(100dvh - 20px); padding: 24px 17px 30px; }
    .close { top: 13px; right: 13px; width: 36px; height: 36px; }
    .masthead { grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 0 42px 13px 0; }
    .mast-seal { width: 46px; height: 46px; font-size: 25px; }
    .mast-title h1 { font-size: 37px; }
    .mast-title p { font-size: 10px; }
    .mast-date { grid-column: 1 / -1; padding: 7px 0 0; border-right: 0; border-top: 1px solid var(--daily-line); text-align: center; }
    .world-grid { grid-template-columns: 1fr; }
    .section-head { grid-template-columns: 30px auto minmax(12px, 1fr); }
    .section-en { display: none; }
    .headline { padding: 21px 15px 15px; }
    .headline h3 { font-size: 21px; }
    .mission-table, .mission-table tbody, .mission-table tr, .mission-table td { display: block; width: 100%; }
    .mission-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .mission-table tbody { display: grid; gap: 8px; }
    .mission-table tr { display: grid; grid-template-columns: 48px minmax(0, 1fr); border: 1px solid var(--daily-line); background: rgba(255, 253, 244, 0.42); }
    .mission-table td { border: 0; background: transparent !important; }
    .mission-table td:nth-child(1) { grid-row: 1 / span 3; display: grid; place-items: center; padding: 9px 4px; border-right: 1px solid var(--daily-line); }
    .mission-table td:nth-child(2) { padding-bottom: 4px; color: var(--daily-ink); font-weight: 700; }
    .mission-table td:nth-child(3), .mission-table td:nth-child(4) { padding-top: 0; padding-bottom: 7px; font-size: 11px; }
    .mission-table td:nth-child(3)::before { content: "报酬："; color: var(--daily-ink-faint); }
    .mission-table td:nth-child(4)::before { content: "状态："; color: var(--daily-ink-faint); }
    .quote { padding-inline: 25px; }
    .quote-text { font-size: 19px; }
    .colophon { align-items: flex-start; padding-right: 66px; }
    .edition-seal { position: absolute; right: 0; bottom: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .paper { animation: none; }
    .close { transition: none; }
  }
`;

class ShinobiDailyModal extends HTMLElementBase {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>${MODAL_STYLES}</style>
      <dialog aria-labelledby="daily-title">
        <article class="paper">
          <button type="button" class="close" aria-label="合上报纸" title="合上报纸">${icon('close', 19)}</button>
          <header class="masthead">
            <div class="mast-seal" aria-hidden="true">忍</div>
            <div class="mast-title"><h1 id="daily-title">忍界日报</h1><p>忍道相通 · 五国同览</p></div>
            <div class="mast-date"><strong data-date></strong><span data-issue></span></div>
          </header>
          <div class="dateline"><span>忍界联合新闻社 · 发行</span><span>火 · 风 · 水 · 雷 · 土 五国同步发售</span><span>定价：三两</span></div>
          <nav class="toc" aria-label="日报栏目"><span><b>壹</b>头条</span><span><b>贰</b>忍界要闻</span><span><b>叁</b>风物逸闻</span><span><b>肆</b>任务布告</span><span><b>伍</b>忍语</span></nav>
          <section class="section" aria-labelledby="daily-headline-heading">
            <div class="section-head"><span class="section-number">壹</span><h2 id="daily-headline-heading">头条</h2><span class="section-line"></span><span class="section-en">TOP STORY</span></div>
            <article class="headline"><span class="headline-kicker">速报</span><h3 data-headline-title></h3><p data-headline-body></p><div class="signature" data-headline-sig></div></article>
          </section>
          <section class="section" aria-labelledby="daily-world-heading">
            <div class="section-head"><span class="section-number">贰</span><h2 id="daily-world-heading">忍界要闻</h2><span class="section-line"></span><span class="section-en">FIVE NATIONS</span></div>
            <div class="world-grid" data-world></div>
          </section>
          <section class="section" aria-labelledby="daily-flavor-heading">
            <div class="section-head"><span class="section-number">叁</span><h2 id="daily-flavor-heading">风物逸闻</h2><span class="section-line"></span><span class="section-en">STORIES</span></div>
            <div class="flavor-list" data-flavor></div>
          </section>
          <section class="section" aria-labelledby="daily-missions-heading">
            <div class="section-head"><span class="section-number">肆</span><h2 id="daily-missions-heading">任务布告</h2><span class="section-line"></span><span class="section-en">MISSION BOARD</span></div>
            <table class="mission-table"><thead><tr><th>等级</th><th>委托内容</th><th>报酬</th><th>受理状态</th></tr></thead><tbody data-missions></tbody></table>
          </section>
          <section class="section" aria-labelledby="daily-quote-heading">
            <div class="section-head"><span class="section-number">伍</span><h2 id="daily-quote-heading">忍语</h2><span class="section-line"></span><span class="section-en">WORDS OF THE DAY</span></div>
            <div class="quote"><p class="quote-text" data-quote-text></p><div class="quote-who" data-quote-who></div></div>
          </section>
          <footer class="colophon"><span>主编：忍界联合新闻社编辑部</span><span>印制：忍界联合印刷所</span><span>未经许可 · 禁止用影分身传阅</span><span class="edition-seal" aria-hidden="true"><span>日</span><span>忍</span><span>报</span><span>界</span></span></footer>
        </article>
      </dialog>`;
    this._dialog = this.shadowRoot.querySelector('dialog');
    this._paper = this.shadowRoot.querySelector('.paper');
    this.shadowRoot.querySelector('.close').addEventListener('click', () => this.close());
    this._dialog.addEventListener('click', event => {
      if (event.target === this._dialog) this.close();
    });
  }

  openDaily(value) {
    const result = validateShinobiDaily(value);
    if (!result.valid) throw new TypeError(`Invalid shinobi daily: ${result.errors.join('; ')}`);
    this._render(result.daily);
    if (this._dialog.open) this._dialog.close();
    this._dialog.showModal();
    this._paper.scrollTop = 0;
  }

  close() {
    if (this._dialog.open) this._dialog.close();
  }

  _set(selector, value) {
    this.shadowRoot.querySelector(selector).textContent = value;
  }

  _render(daily) {
    this._set('[data-date]', daily.date);
    this._set('[data-issue]', daily.issue);
    this._set('[data-headline-title]', daily.headline.title);
    this._set('[data-headline-body]', daily.headline.body);
    this._set('[data-headline-sig]', daily.headline.sig);
    this._set('[data-quote-text]', daily.quote.text);
    this._set('[data-quote-who]', daily.quote.who);

    const world = this.shadowRoot.querySelector('[data-world]');
    world.replaceChildren(...daily.world.map(item => {
      const article = document.createElement('article');
      article.className = 'news-card';
      const tag = document.createElement('span');
      tag.className = 'news-tag';
      tag.textContent = `【${item.tag}】`;
      const title = document.createElement('h3');
      title.textContent = item.title;
      const text = document.createElement('p');
      text.textContent = item.text;
      article.append(tag, title, text);
      return article;
    }));

    const flavor = this.shadowRoot.querySelector('[data-flavor]');
    flavor.replaceChildren(...daily.flavor.map(item => {
      const article = document.createElement('article');
      article.className = 'flavor-item';
      const mark = document.createElement('span');
      mark.className = 'flavor-mark';
      mark.textContent = item.mark;
      const copy = document.createElement('div');
      copy.className = 'flavor-copy';
      const title = document.createElement('h3');
      title.textContent = item.title;
      const text = document.createElement('p');
      text.textContent = item.text;
      copy.append(title, text);
      article.append(mark, copy);
      return article;
    }));

    const missions = this.shadowRoot.querySelector('[data-missions]');
    missions.replaceChildren(...daily.missions.map(item => {
      const row = document.createElement('tr');
      const rankCell = document.createElement('td');
      const rank = document.createElement('span');
      rank.className = `rank rank-${item.rank}`;
      rank.textContent = item.rank;
      rankCell.append(rank);
      for (const text of [item.task, item.pay, item.status]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      row.prepend(rankCell);
      return row;
    }));
  }
}

function ensureShinobiDailyModalDefined() {
  const registry = globalThis.customElements;
  if (registry && !registry.get(MODAL_TAG)) {
    registry.define(MODAL_TAG, ShinobiDailyModal);
  }
}

ensureShinobiDailyModalDefined();

function getModal() {
  ensureShinobiDailyModalDefined();
  let modal = document.querySelector(MODAL_TAG);
  if (!modal) {
    modal = document.createElement(MODAL_TAG);
    document.body.appendChild(modal);
  }
  return modal;
}

export function createShinobiDailyTrigger(value) {
  const result = validateShinobiDaily(value);
  if (!result.valid) return null;
  const daily = result.daily;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'shinobi-daily-launch';
  button.dataset.shinobiDailyHost = '';
  button.setAttribute('aria-label', `打开忍界日报，${daily.date}，${daily.issue}`);
  button.shinobiDaily = daily;

  const seal = document.createElement('span');
  seal.className = 'shinobi-daily-launch__seal';
  seal.textContent = '报';
  seal.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'shinobi-daily-launch__copy';
  const title = document.createElement('strong');
  title.textContent = '忍界日报';
  const meta = document.createElement('small');
  meta.textContent = `${daily.date} · ${daily.issue}`;
  copy.append(title, meta);
  const action = document.createElement('span');
  action.className = 'shinobi-daily-launch__action';
  action.innerHTML = `${icon('book-open', 17)}<span>展卷阅报</span>`;
  button.append(seal, copy, action);
  button.addEventListener('click', () => getModal().openDaily(daily));
  return button;
}

export { ShinobiDailyModal };
