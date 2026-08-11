import { musicService } from './music-service.js';
import { stateManager } from './state-manager.js';

const SILENT_WAV_DATA_URL = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';
const STREAM_PROBE_RANGE = 'bytes=0-1023';
const STREAM_PROBE_TIMEOUT_MS = 6000;

function playFailureStatus(error) {
  return error?.name === 'NotAllowedError' ? 'blocked' : 'error';
}

function savedMusicSettings() {
  const settings = stateManager.getSub?.('_ui')?.settings || {};
  return {
    enabled: settings.musicEnabled !== false,
    volume: Math.min(100, Math.max(0, Number(settings.musicVolume) || 0)),
    loop: settings.musicLoop === true || localStorageValue('naruto_music_loop') === 'true',
    shuffle: settings.musicShuffle === true || localStorageValue('naruto_music_shuffle') === 'true'
  };
}

function localStorageValue(key) {
  try { return globalThis.localStorage?.getItem?.(key) || ''; } catch { return ''; }
}

function trackSummary(track) {
  if (!track) return null;
  return {
    id: String(track.id || track.mid || track.url_id || ''),
    name: String(track.name || track.title || track.song || '未知曲目'),
    artist: Array.isArray(track.artist) ? track.artist.join(' / ') : String(track.artist || track.singer || ''),
    provider: 'tencent'
  };
}

function trackNameKey(track) {
  return String(track?.name || track?.title || track?.song || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isSameOriginMusicStream(url) {
  try {
    const currentOrigin = globalThis.location?.origin || 'http://music.local';
    const parsed = new URL(String(url || ''), currentOrigin);
    return parsed.pathname === '/api/music/stream'
      && (!globalThis.location?.origin || parsed.origin === currentOrigin);
  } catch {
    return false;
  }
}

function looksLikeAudio(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) return false;
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return true;
  if (bytes.length >= 12 && ascii(0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(8, 12))) return true;
  if (bytes.length >= 8 && ascii(4, 8) === 'ftyp') return true;
  if (bytes.length >= 4 && ['fLaC', 'OggS'].includes(ascii(0, 4))) return true;
  if (bytes.length >= 4
      && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (bytes.length >= 3 && ascii(0, 3) === 'ID3') return true;
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0;
}

async function readProbePrefix(response) {
  const reader = response?.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let byteLength = 0;
    try {
      while (byteLength < 16) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = new Uint8Array(value || []);
        if (!chunk.length) continue;
        chunks.push(chunk);
        byteLength += chunk.length;
      }
    } finally {
      try { await reader.cancel(); } catch { /* the range response may already be closed */ }
    }
    const prefix = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      prefix.set(chunk, offset);
      offset += chunk.length;
    }
    return prefix;
  }
  if (typeof response?.arrayBuffer !== 'function') return new Uint8Array();
  return new Uint8Array(await response.arrayBuffer());
}

export class MusicPlaybackController {
  constructor({
    catalog = musicService,
    AudioCtor = globalThis.Audio,
    settingsReader = savedMusicSettings,
    fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
    probeTimeoutMs = STREAM_PROBE_TIMEOUT_MS
  } = {}) {
    this.catalog = catalog;
    this.AudioCtor = AudioCtor;
    this.settingsReader = settingsReader;
    this.fetchImpl = fetchImpl;
    this.probeTimeoutMs = Math.max(1000, Number(probeTimeoutMs) || STREAM_PROBE_TIMEOUT_MS);
    this.bgm = null;
    this.ambient = null;
    this.currentTrack = null;
    this.preparedTrack = null;
    this.queue = [];
    this.status = 'idle';
    this._loadToken = 0;
    this._audioElement = null;
    this._boundAudioElements = new WeakSet();
    this._gestureUnlocked = false;
    this._unlockInFlight = null;
    this._gestureBinding = null;
    this._stateListeners = new Set();
  }

  get audioElement() {
    return this._audioElement || this.bgm || null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this._stateListeners.add(listener);
    this.getState();
    return () => this._stateListeners.delete(listener);
  }

  bindUserGestureUnlock(target = globalThis.document) {
    if (!target?.addEventListener || !target?.removeEventListener) return () => {};
    if (this._gestureBinding?.target === target) return this._gestureBinding.dispose;
    this._gestureBinding?.dispose?.();

    const handler = event => {
      if (event?.isTrusted === false || event?.repeat === true) return;
      void this.unlockFromUserGesture();
    };
    const pointerOptions = { capture: true, passive: true };
    target.addEventListener('pointerdown', handler, pointerOptions);
    target.addEventListener('keydown', handler, true);
    const binding = {
      target,
      dispose: () => {
        target.removeEventListener('pointerdown', handler, pointerOptions);
        target.removeEventListener('keydown', handler, true);
        if (this._gestureBinding === binding) this._gestureBinding = null;
      }
    };
    this._gestureBinding = binding;
    return binding.dispose;
  }

  unlockFromUserGesture() {
    if (this._unlockInFlight) return this._unlockInFlight;
    const attempt = this._unlockDuringGesture();
    this._unlockInFlight = Promise.resolve(attempt).finally(() => {
      this._unlockInFlight = null;
    });
    return this._unlockInFlight;
  }

  async _unlockDuringGesture() {
    if (this.status === 'blocked' && this.bgm) {
      this._audioElement = this.bgm;
      try {
        await this.bgm.play();
        this._gestureUnlocked = true;
        this.status = 'playing';
      } catch (error) {
        this._gestureUnlocked = false;
        this.status = playFailureStatus(error);
      }
      return this.getState();
    }
    if (this._gestureUnlocked) return { ...this.getState(), unlocked: true };

    const audio = this._audioElement || this._createAudio(SILENT_WAV_DATA_URL);
    if (!audio) return { ...this.getState('unavailable'), unlocked: false };
    if (this.bgm === audio && this.currentTrack) return { ...this.getState(), unlocked: false };

    const previousVolume = Number.isFinite(Number(audio.volume)) ? Number(audio.volume) : 1;
    try {
      audio.volume = 0;
      if (!audio.src) audio.src = SILENT_WAV_DATA_URL;
      audio.load?.();
      await audio.play();
      this._gestureUnlocked = true;
      audio.pause?.();
      try { audio.currentTime = 0; } catch { /* media may not be seekable yet */ }
      return { ...this.getState(), unlocked: true };
    } catch {
      this._gestureUnlocked = false;
      return { ...this.getState(), unlocked: false };
    } finally {
      audio.volume = previousVolume;
    }
  }

  _createAudio(source = '') {
    if (typeof this.AudioCtor !== 'function') return null;
    let audio;
    try {
      audio = new this.AudioCtor(source);
    } catch {
      try {
        audio = new this.AudioCtor();
        if (source) audio.src = source;
      } catch {
        return null;
      }
    }
    this._audioElement = audio;
    return audio;
  }

  _bindAudioEvents(audio) {
    if (!audio || this._boundAudioElements.has(audio)) return;
    this._boundAudioElements.add(audio);
    audio.addEventListener?.('play', () => {
      if (this.bgm === audio) {
        this.status = 'playing';
        this.getState();
      }
    });
    audio.addEventListener?.('pause', () => {
      if (this.bgm === audio && this.status !== 'blocked') {
        this.status = 'paused';
        this.getState();
      }
    });
    audio.addEventListener?.('error', () => {
      if (this.bgm === audio) {
        this.status = 'error';
        this.getState();
      }
    });
    audio.addEventListener?.('ended', () => {
      if (this.bgm !== audio) return;
      const selected = this.currentTrack;
      this.status = 'ended';
      this.getState();
      if (selected && this._settings().loop) void this.playTrack(selected);
      else {
        const next = this._adjacentTrack('next');
        if (next && next.id !== selected?.id) void this.playTrack(next);
      }
    });
  }

  _prepareTrackAudio(url) {
    const audio = this._audioElement || this._createAudio(url);
    if (!audio) return null;
    this.bgm?.pause?.();
    try { audio.currentTime = 0; } catch { /* ignore an unloaded media element */ }
    audio.src = url;
    audio.load?.();
    this._audioElement = audio;
    this.bgm = audio;
    this._bindAudioEvents(audio);
    return audio;
  }

  _settings() {
    const value = this.settingsReader?.() || {};
    return {
      enabled: value.enabled !== false,
      volume: Math.min(100, Math.max(0, Number(value.volume) || 0)),
      loop: value.loop === true,
      shuffle: value.shuffle === true
    };
  }

  getState(status = this.status) {
    const settings = this._settings();
    const result = {
      status: status || 'idle',
      track: trackSummary(this.currentTrack),
      enabled: settings.enabled,
      paused: this.bgm ? Boolean(this.bgm.paused) : true,
      volume: settings.volume
    };
    this.catalog.setPlayerState?.(result);
    for (const listener of this._stateListeners) {
      try { listener({ ...result, track: result.track ? { ...result.track } : null }); } catch { /* UI observers are isolated */ }
    }
    return result;
  }

  _rememberQueue(tracks = []) {
    const normalized = (Array.isArray(tracks) ? tracks : []).map(track => {
      try { return this.catalog.rememberTrack(track); } catch { return null; }
    }).filter(Boolean);
    if (normalized.length) this.queue = normalized.slice(0, 20);
    return normalized;
  }

  _playbackCandidates(selected) {
    const requestedId = selected?.id;
    const requestedName = trackNameKey(selected);
    const unique = [];
    const seen = new Set();
    for (const track of [selected, ...this.queue]) {
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      unique.push(track);
    }
    const sameSong = unique.filter(track => track.id !== requestedId
      && requestedName
      && trackNameKey(track) === requestedName);
    const otherSongs = unique.filter(track => track.id !== requestedId
      && (!requestedName || trackNameKey(track) !== requestedName));
    return [selected, ...sameSong, ...otherSongs];
  }

  async _probeStreamUrl(url) {
    if (!isSameOriginMusicStream(url) || typeof this.fetchImpl !== 'function') return true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.probeTimeoutMs)
      : null;
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'audio/*;q=0.9,*/*;q=0.1',
          range: STREAM_PROBE_RANGE
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller?.signal
      });
      if (!response?.ok) return false;
      return looksLikeAudio(await readProbePrefix(response));
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async open({ tracks = [], track = null, autoplay = false } = {}) {
    const queue = this._rememberQueue(tracks);
    let selected = null;
    try { selected = track ? this.catalog.rememberTrack(track) : null; } catch { selected = null; }
    if (!selected) return this.getState();
    if (!queue.some(item => item.id === selected.id)) this.queue.unshift(selected);
    this.preparedTrack = selected;
    if (autoplay) return this.playTrack(selected);
    if (!this.bgm) {
      this.currentTrack = selected;
      this.status = 'ready';
    }
    return { ...this.getState(), preparedTrack: trackSummary(selected) };
  }

  _adjacentTrack(direction) {
    if (!this.queue.length) return null;
    const currentId = this.currentTrack?.id || this.currentTrack?.mid || this.currentTrack?.url_id;
    const index = this.queue.findIndex(track => track.id === currentId);
    if (direction === 'previous') return this.queue[index > 0 ? index - 1 : this.queue.length - 1] || null;
    if (this._settings().shuffle && this.queue.length > 1) {
      const choices = this.queue.filter(track => track.id !== currentId);
      return choices[Math.floor(Math.random() * choices.length)] || null;
    }
    return this.queue[index >= 0 && index + 1 < this.queue.length ? index + 1 : 0] || null;
  }

  async playTrack(track) {
    const settings = this._settings();
    if (!settings.enabled) {
      this.status = 'disabled';
      return this.getState();
    }
    let selected;
    try { selected = this.catalog.rememberTrack(track); } catch { return this.getState('invalid-track'); }
    if (typeof this.AudioCtor !== 'function') return this.getState('unavailable');
    const loadToken = ++this._loadToken;
    this.preparedTrack = selected;
    const candidates = this._playbackCandidates(selected);
    let failedCount = 0;

    for (const candidate of candidates) {
      if (loadToken !== this._loadToken) return this.getState('superseded');
      this.currentTrack = candidate;
      this.status = 'resolving';
      let url;
      try {
        url = await this.catalog.resolveStreamUrl(candidate);
      } catch {
        failedCount += 1;
        continue;
      }
      if (loadToken !== this._loadToken) return this.getState('superseded');
      if (!await this._probeStreamUrl(url)) {
        failedCount += 1;
        continue;
      }
      if (loadToken !== this._loadToken) return this.getState('superseded');

      const audio = this._prepareTrackAudio(url);
      if (!audio) return this.getState('unavailable');
      audio.volume = settings.volume / 100;
      this.status = 'loading';
      try {
        await audio.play();
        if (this.bgm === audio) {
          this._gestureUnlocked = true;
          this.status = 'playing';
        }
      } catch (error) {
        if (this.bgm !== audio) return this.getState('superseded');
        this.status = playFailureStatus(error);
        if (this.status === 'blocked') {
          this._gestureUnlocked = false;
          const state = this.getState();
          return failedCount > 0
            ? {
                ...state,
                fallback: {
                  kind: trackNameKey(candidate) === trackNameKey(selected) ? 'version' : 'song',
                  failedCount,
                  exhausted: false
                }
              }
            : state;
        }
        failedCount += 1;
        continue;
      }

      const state = this.getState();
      return failedCount > 0
        ? {
            ...state,
            fallback: {
              kind: trackNameKey(candidate) === trackNameKey(selected) ? 'version' : 'song',
              failedCount,
              exhausted: false
            }
          }
        : state;
    }

    if (loadToken !== this._loadToken) return this.getState('superseded');
    this.bgm?.pause?.();
    this.bgm = null;
    this.currentTrack = selected;
    this.preparedTrack = selected;
    this.status = 'unplayable';
    return {
      ...this.getState(),
      fallback: {
        kind: 'search',
        failedCount,
        exhausted: true
      }
    };
  }

  async control(action) {
    if (action === 'next' || action === 'previous') {
      const adjacent = this._adjacentTrack(action);
      return adjacent ? this.playTrack(adjacent) : this.getState('empty-queue');
    }
    const audio = this.bgm;
    if (!audio) {
      const prepared = this.preparedTrack || this.currentTrack;
      return (action === 'play' || action === 'toggle') && prepared
        ? this.playTrack(prepared)
        : this.getState('no-track');
    }
    const shouldPlay = action === 'play' || (action === 'toggle' && audio.paused);
    if (!shouldPlay) {
      audio.pause();
      this.status = 'paused';
      return this.getState();
    }
    try {
      await audio.play();
      this._gestureUnlocked = true;
      this.status = 'playing';
    } catch (error) {
      this.status = playFailureStatus(error);
      if (this.status === 'blocked') this._gestureUnlocked = false;
    }
    return this.getState();
  }
}

export const musicPlayback = new MusicPlaybackController();

export default musicPlayback;
