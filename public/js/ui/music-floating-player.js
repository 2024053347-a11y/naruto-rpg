import { eventBus } from '../core/event-bus.js';
import { icon } from '../utils/icons.js';

const PLAYER_ID = 'naruto-desktop-lyrics';
const POSITION_STORAGE_KEY = 'naruto_music_player_position_v1';

function playerDocument() {
  return globalThis.document || null;
}

function statusLabel(status) {
  return {
    resolving: '正在检查音源',
    loading: '正在加载',
    blocked: '等待页面播放手势',
    paused: '已暂停',
    ready: '已准备',
    unplayable: '当前候选不可播放',
    error: '播放失败',
    disabled: '音乐已停用'
  }[status] || '';
}

function restorePosition(element) {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem?.(POSITION_STORAGE_KEY) || 'null');
    if (!Number.isFinite(saved?.left) || !Number.isFinite(saved?.top)) return;
    element.style.left = `${Math.max(8, Math.min(saved.left, globalThis.innerWidth - 80))}px`;
    element.style.top = `${Math.max(8, Math.min(saved.top, globalThis.innerHeight - 50))}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.transform = 'none';
  } catch { /* storage is optional */ }
}

function persistPosition(element) {
  try {
    const bounds = element.getBoundingClientRect();
    globalThis.localStorage?.setItem?.(POSITION_STORAGE_KEY, JSON.stringify({
      left: Math.round(bounds.left),
      top: Math.round(bounds.top)
    }));
  } catch { /* storage is optional */ }
}

function makeDraggable(element) {
  let drag = null;
  const onPointerDown = event => {
    if (event.button !== 0 || event.target.closest('button, input')) return;
    const bounds = element.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    element.classList.add('dragging');
    element.style.left = `${bounds.left}px`;
    element.style.top = `${bounds.top}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.transform = 'none';
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(8, Math.min(event.clientX - drag.x, globalThis.innerWidth - width - 8));
    const top = Math.max(8, Math.min(event.clientY - drag.y, globalThis.innerHeight - height - 8));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  };
  const onPointerUp = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    element.classList.remove('dragging');
    element.releasePointerCapture?.(event.pointerId);
    persistPosition(element);
  };
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
}

function renderState(element, state = {}) {
  const track = state.track || state.preparedTrack || null;
  const title = String(track?.name || '音乐播放器');
  const artist = String(track?.artist || '');
  const status = statusLabel(String(state.status || ''));
  const titleElement = element.querySelector('.lyric-text');
  const artistElement = element.querySelector('.music-floating-artist');
  if (titleElement) titleElement.textContent = track ? `♪ ${title}` : title;
  if (artistElement) artistElement.textContent = [artist, status].filter(Boolean).join(' · ');
  element.dataset.status = String(state.status || 'idle');

  const toggle = element.querySelector('[data-music-control="toggle"]');
  if (toggle) {
    const playing = state.status === 'playing' && state.paused !== true;
    toggle.innerHTML = icon(playing ? 'pause' : 'play', 22);
    toggle.title = playing ? '暂停' : '播放';
    toggle.setAttribute('aria-label', playing ? '暂停' : '播放');
  }
}

function buildPlayer(documentRef) {
  const element = documentRef.createElement('section');
  element.id = PLAYER_ID;
  element.className = 'desktop-lyrics music-floating-player minimized';
  element.hidden = true;
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', '音乐悬浮播放器');
  element.innerHTML = `
    <div class="lyric-header">
      <div class="lyric-drag-handle"></div>
      <div class="lyric-window-controls">
        <button class="lyric-win-btn" type="button" data-music-window="minimize" title="最小化/恢复" aria-label="最小化或恢复音乐悬浮窗">${icon('minus', 18)}</button>
        <button class="lyric-win-btn" type="button" data-music-window="close" title="关闭悬浮窗" aria-label="关闭音乐悬浮窗">${icon('close', 18)}</button>
      </div>
    </div>
    <div class="lyric-body">
      <div class="lyric-text" aria-live="polite">音乐播放器</div>
      <div class="music-floating-artist"></div>
      <div class="lyric-controls">
        <button class="lyric-btn" type="button" data-music-control="previous" title="上一首" aria-label="上一首">${icon('skip-back', 22)}</button>
        <button class="lyric-btn lyric-play-btn" type="button" data-music-control="toggle" title="播放" aria-label="播放">${icon('play', 22)}</button>
        <button class="lyric-btn" type="button" data-music-control="next" title="下一首" aria-label="下一首">${icon('skip-forward', 22)}</button>
      </div>
    </div>`;

  element.querySelector('[data-music-window="minimize"]')?.addEventListener('click', event => {
    event.stopPropagation();
    element.classList.toggle('minimized');
  });
  element.querySelector('[data-music-window="close"]')?.addEventListener('click', event => {
    event.stopPropagation();
    element.hidden = true;
    element.style.display = 'none';
  });
  element.querySelectorAll('[data-music-control]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const action = button.dataset.musicControl;
      try {
        const state = await eventBus.request('app:music-control', { action });
        renderState(element, state);
      } catch { /* the host reports command failures to Ling Xi */ }
    });
  });
  makeDraggable(element);
  restorePosition(element);
  return element;
}

function ensurePlayer({ mount } = {}) {
  const documentRef = playerDocument();
  if (!documentRef) return null;
  const existing = documentRef.getElementById(PLAYER_ID);
  if (existing) return existing;
  const element = buildPlayer(documentRef);
  const target = mount || documentRef.getElementById('app') || documentRef.body;
  target?.appendChild(element);
  return element;
}

export function updateMusicFloatingPlayer(state, { reveal = false, minimized = false, mount } = {}) {
  const documentRef = playerDocument();
  const element = reveal ? ensurePlayer({ mount }) : documentRef?.getElementById(PLAYER_ID);
  if (!element) return { visible: false, minimized: false };
  renderState(element, state);
  if (minimized) element.classList.add('minimized');
  if (reveal) {
    element.hidden = false;
    element.style.display = 'block';
  }
  return {
    visible: !element.hidden && element.style.display !== 'none',
    minimized: element.classList.contains('minimized')
  };
}

export function showCompactMusicPlayer(state, options = {}) {
  return updateMusicFloatingPlayer(state, { ...options, reveal: true, minimized: true });
}

export async function openMusicWithFloatingPlayer(options, { playback, reveal = showCompactMusicPlayer } = {}) {
  if (typeof playback?.open !== 'function') throw new TypeError('音乐播放器不可用');
  const state = await playback.open(options);
  const floatingWindow = state?.track || state?.preparedTrack
    ? reveal(state, { minimized: true })
    : { visible: false, minimized: false };
  return { ...state, floatingWindow };
}

export async function controlMusicWithFloatingPlayer(action, { playback } = {}) {
  if (typeof playback?.control !== 'function') throw new TypeError('音乐播放器不可用');
  const state = await playback.control(action);
  updateMusicFloatingPlayer(state);
  return state;
}

export function bindMusicFloatingPlayer(playback) {
  return typeof playback?.subscribe === 'function'
    ? playback.subscribe(state => updateMusicFloatingPlayer(state))
    : () => {};
}
