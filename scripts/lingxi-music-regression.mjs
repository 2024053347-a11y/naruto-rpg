import assert from 'node:assert/strict';

import { LingXiMusicAdapter } from '../js/core/lingxi/adapters/music-adapter.js';
import { MusicService, normalizeMusicTrack } from '../js/core/music-service.js';
import { MusicPlaybackController } from '../js/core/music-playback.js';
import { openMusicWithFloatingPlayer } from '../js/ui/music-floating-player.js';

const requests = [];
const service = new MusicService({
  async fetchImpl(url) {
    requests.push(String(url));
    if (String(url).includes('/search/song')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 200,
            data: [
              {
                songmid: 'track-001',
                songname: '青鸟',
                singer: [{ name: '生物股长' }],
                album: { name: '火影忍者疾风传' },
                interval: 213
              },
              { name: '没有标识的坏数据' }
            ]
          };
        }
      };
    }
    throw new Error(`the browser must not resolve third-party stream URLs: ${url}`);
  }
});

const normalized = normalizeMusicTrack({
  url_id: 'safe-id',
  title: '测试曲目',
  artist: ['甲', { name: '乙' }],
  pay: '付费',
  quality: '音乐试听'
});
assert.deepEqual(normalized, {
  id: 'safe-id',
  mid: 'safe-id',
  name: '测试曲目',
  title: '测试曲目',
  artist: '甲 / 乙',
  album: '',
  duration: null,
  access: 'paid',
  requiresSubscription: true,
  quality: '音乐试听',
  provider: 'tencent'
});

const rankedService = new MusicService({
  async fetchImpl() {
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 200,
          data: [
            { mid: 'paid-original', song: '目标歌曲', singer: '原唱', pay: '付费' },
            { mid: 'free-version', song: '目标歌曲', singer: '可播放版本', pay: '免费' },
            { mid: 'unknown-version', song: '目标歌曲', singer: '未知权限' }
          ]
        };
      }
    };
  }
});
const rankedTracks = await rankedService.search('目标歌曲', { limit: 10 });
assert.deepEqual(rankedTracks.map(track => track.id), [
  'free-version',
  'unknown-version',
  'paid-original'
]);
assert.equal(rankedTracks[0].requiresSubscription, false);
assert.equal(rankedTracks.at(-1).requiresSubscription, true);

const tracks = await service.search('火影 青鸟', { limit: 5 });
assert.equal(tracks.length, 1);
assert.equal(tracks[0].id, 'track-001');
assert.equal(tracks[0].artist, '生物股长');
assert.match(requests[0], /word=%E7%81%AB%E5%BD%B1%20%E9%9D%92%E9%B8%9F$/);
assert.deepEqual(service.getSearchResults('火影 青鸟'), tracks);
assert.notEqual(service.getTrack('track-001'), service.getTrack('track-001'), 'callers receive copies');

const streamUrl = await service.resolveStreamUrl('track-001');
assert.equal(streamUrl, '/api/music/stream?mid=track-001');
assert.equal(requests.length, 1, 'search uses only the supported music catalog');
assert.match(requests[0], /api\.vkeys\.cn\/v2\/music\/tencent\/search\/song/);
await assert.rejects(() => service.resolveStreamUrl('invented-id'), /先搜索后再播放/);

class FakeAudio {
  constructor(url) {
    this.url = url;
    this.paused = true;
    this.volume = 1;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  _emit(type) {
    for (const listener of this.listeners.get(type) || []) listener();
  }

  async play() {
    this.paused = false;
    this._emit('play');
  }

  pause() {
    this.paused = true;
    this._emit('pause');
  }
}

class GestureLockedAudio extends FakeAudio {
  static gestureActive = false;

  constructor(url = '') {
    super(url);
    this.src = url;
    this.unlocked = false;
  }

  load() {}

  async play() {
    if (GestureLockedAudio.gestureActive) this.unlocked = true;
    if (!this.unlocked) {
      this.paused = true;
      throw Object.assign(new Error('Playback requires a user gesture'), { name: 'NotAllowedError' });
    }
    return super.play();
  }
}

function duringUserGesture(callback) {
  GestureLockedAudio.gestureActive = true;
  try {
    return callback();
  } finally {
    GestureLockedAudio.gestureActive = false;
  }
}

const backgroundPlayer = new MusicPlaybackController({
  catalog: service,
  AudioCtor: FakeAudio,
  fetchImpl: async () => probeResponse(true),
  settingsReader: () => ({ enabled: true, volume: 45, loop: false, shuffle: false })
});
const backgroundOpened = await backgroundPlayer.open({ tracks, track: tracks[0], autoplay: true });
assert.equal(backgroundOpened.status, 'playing');
assert.equal(backgroundPlayer.bgm.url, '/api/music/stream?mid=track-001');
assert.equal((await backgroundPlayer.control('pause')).status, 'paused');
assert.equal((await backgroundPlayer.control('play')).status, 'playing');

const gesturePlayer = new MusicPlaybackController({
  catalog: service,
  AudioCtor: GestureLockedAudio,
  fetchImpl: async () => probeResponse(true),
  settingsReader: () => ({ enabled: true, volume: 45, loop: false, shuffle: false })
});
await duringUserGesture(() => gesturePlayer.unlockFromUserGesture());
const primedAudio = gesturePlayer.audioElement;
const gestureOpened = await gesturePlayer.open({ tracks, track: tracks[0], autoplay: true });
assert.equal(gestureOpened.status, 'playing', 'a trusted earlier gesture unlocks later background playback');
assert.equal(gesturePlayer.bgm, primedAudio, 'background playback reuses the unlocked media element');

const blockedPlayer = new MusicPlaybackController({
  catalog: service,
  AudioCtor: GestureLockedAudio,
  fetchImpl: async () => probeResponse(true),
  settingsReader: () => ({ enabled: true, volume: 45, loop: false, shuffle: false })
});
const blocked = await blockedPlayer.open({ tracks, track: tracks[0], autoplay: true });
assert.equal(blocked.status, 'blocked');
const blockedAudio = blockedPlayer.bgm;
await duringUserGesture(() => blockedPlayer.unlockFromUserGesture());
assert.equal(blockedPlayer.getState().status, 'playing', 'the next trusted page gesture resumes a blocked track');
assert.equal(blockedPlayer.bgm, blockedAudio, 'blocked recovery does not create another media element');

const floatingCalls = [];
const floatingOpened = await openMusicWithFloatingPlayer(
  { tracks, track: tracks[0], autoplay: true },
  {
    playback: {
      async open(input) {
        assert.equal(input.track.id, 'track-001');
        return { status: 'playing', paused: false, track: input.track };
      }
    },
    reveal(state, options) {
      floatingCalls.push({ state, options });
      return { visible: true, minimized: options.minimized === true };
    }
  }
);
assert.deepEqual(floatingOpened.floatingWindow, { visible: true, minimized: true });
assert.equal(floatingCalls.length, 1);
assert.equal(floatingCalls[0].state.track.id, 'track-001');

function probeResponse(ok) {
  return {
    ok,
    status: ok ? 206 : 502,
    headers: { get(name) { return name.toLowerCase() === 'content-type' && ok ? 'audio/mpeg' : null; } },
    async arrayBuffer() { return new Uint8Array([0xff, 0xfb, 0x90, 0xc4]).buffer; }
  };
}

const fallbackCatalog = new MusicService();
const requestedVersion = fallbackCatalog.rememberTrack({
  mid: 'free-tencent',
  song: 'シルエット',
  singer: 'KANA-BOON',
  pay: '免费'
});
const alternateVersion = fallbackCatalog.rememberTrack({
  mid: 'alternate-tencent',
  song: 'シルエット',
  singer: 'KANA-BOON（其他版本）'
});
const differentSong = fallbackCatalog.rememberTrack({
  mid: 'different-tencent',
  song: 'ブルーバード',
  singer: 'いきものがかり'
});

const versionProbeCalls = [];
const versionFallbackPlayer = new MusicPlaybackController({
  catalog: fallbackCatalog,
  AudioCtor: FakeAudio,
  settingsReader: () => ({ enabled: true, volume: 45, loop: false, shuffle: false }),
  async fetchImpl(url, options) {
    versionProbeCalls.push({ url: String(url), options });
    return probeResponse(String(url).includes('mid=alternate-tencent'));
  }
});
const versionFallback = await versionFallbackPlayer.open({
  tracks: [requestedVersion, alternateVersion, differentSong],
  track: requestedVersion,
  autoplay: true
});
assert.equal(versionFallback.status, 'playing');
assert.equal(versionFallback.track.id, 'alternate-tencent');
assert.equal(versionFallback.fallback.kind, 'version');
assert.equal(versionFallback.fallback.failedCount, 1);
assert.deepEqual(versionProbeCalls.map(call => call.url), [
  '/api/music/stream?mid=free-tencent',
  '/api/music/stream?mid=alternate-tencent'
]);
assert.equal(versionProbeCalls[0].options.headers.range, 'bytes=0-1023');
assert.equal(versionProbeCalls[0].options.credentials, 'same-origin');

const songProbeCalls = [];
const songFallbackPlayer = new MusicPlaybackController({
  catalog: fallbackCatalog,
  AudioCtor: FakeAudio,
  settingsReader: () => ({ enabled: true, volume: 45, loop: false, shuffle: false }),
  async fetchImpl(url) {
    songProbeCalls.push(String(url));
    return probeResponse(String(url).includes('mid=different-tencent'));
  }
});
const songFallback = await songFallbackPlayer.open({
  tracks: [requestedVersion, alternateVersion, differentSong],
  track: requestedVersion,
  autoplay: true
});
assert.equal(songFallback.status, 'playing');
assert.equal(songFallback.track.id, 'different-tencent');
assert.equal(songFallback.fallback.kind, 'song');
assert.equal(songFallback.fallback.failedCount, 2);
assert.deepEqual(songProbeCalls, [
  '/api/music/stream?mid=free-tencent',
  '/api/music/stream?mid=alternate-tencent',
  '/api/music/stream?mid=different-tencent'
]);

const exhaustedPlayer = new MusicPlaybackController({
  catalog: fallbackCatalog,
  AudioCtor: FakeAudio,
  settingsReader: () => ({ enabled: true, volume: 45, loop: false, shuffle: false }),
  async fetchImpl() { return probeResponse(false); }
});
const exhausted = await exhaustedPlayer.open({
  tracks: [requestedVersion, alternateVersion, differentSong],
  track: requestedVersion,
  autoplay: true
});
assert.equal(exhausted.status, 'unplayable');
assert.equal(exhausted.fallback.exhausted, true);
assert.equal(exhausted.fallback.failedCount, 3);
assert.equal(exhaustedPlayer.bgm, null);

const panelCalls = [];
const panel = {
  async openMusic(input) {
    panelCalls.push({ kind: 'open', input });
    return { status: input.autoplay ? 'loading' : 'ready', track: input.track };
  },
  async controlMusic(action) {
    panelCalls.push({ kind: 'control', action });
    return { status: action === 'pause' ? 'paused' : 'playing' };
  }
};
const routes = [];
const adapter = new LingXiMusicAdapter({
  catalog: service,
  bus: {
    async request(event, route) {
      routes.push({ event, route });
      if (event === 'app:music-open') return panel.openMusic(route);
      if (event === 'app:music-control') return panel.controlMusic(route.action);
      throw new Error(`unexpected music event: ${event}`);
    }
  }
});

const searchResult = await adapter.search({ query: '火影 青鸟', limit: 1 });
assert.equal(searchResult.tracks[0].id, 'track-001');
assert.equal(JSON.stringify(searchResult).includes('media.example'), false, 'stream URLs never enter tool results');

const opened = await adapter.open({ trackId: 'track-001', autoplay: true });
assert.equal(opened.opened, true);
assert.equal(opened.player.status, 'loading');
assert.deepEqual(routes[0], {
  event: 'app:music-open',
  route: {
    query: '火影 青鸟',
    tracks,
    track: tracks[0],
    autoplay: true
  }
});
assert.equal(panelCalls[0].input.track.id, 'track-001');

const controlled = await adapter.control({ action: 'pause' });
assert.equal(controlled.player.status, 'paused');
assert.deepEqual(routes[1], {
  event: 'app:music-control',
  route: { action: 'pause' }
});
assert.equal(routes.some(route => route.event === 'app:open-settings'), false, 'music actions stay in the background');

const exhaustedAdapter = new LingXiMusicAdapter({
  catalog: service,
  bus: {
    async request() {
      return { status: 'unplayable', fallback: { exhausted: true, failedCount: 3 } };
    }
  }
});
const exhaustedOpen = await exhaustedAdapter.open({ trackId: 'track-001', autoplay: true });
assert.match(exhaustedOpen.notice, /换一首|重新搜索/);
await assert.rejects(() => adapter.open({ trackId: 'made-up', autoplay: true }), /先调用 search_music/);
await assert.rejects(() => adapter.control({ action: 'delete' }), /不支持/);

console.log('Ling Xi music regression: passed');
