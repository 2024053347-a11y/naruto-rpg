import { eventBus } from '../../event-bus.js';
import { musicService } from '../../music-service.js';

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function musicOpenNotice(player, autoplay) {
  if (!autoplay) return '已在后台准备这首曲目，尚未请求播放，也没有打开设置界面。';
  if (player?.status === 'unplayable' && player?.fallback?.exhausted) {
    return '当前搜索结果中的候选均无法播放，缩小的音乐悬浮窗已显示状态。请不要停在报错处：换一首歌或重新调用 search_music 搜索其他歌曲，并继续调用 open_music。';
  }
  if (player?.status === 'blocked') {
    return '歌曲已在后台准备并显示缩小的音乐悬浮窗，但浏览器阻止了自动播放；需要一次页面播放手势。';
  }
  if (player?.status === 'error') {
    return '后台播放器未能读取这项音乐资源；可能是上游版权或试听地址失效。没有打开设置界面，应继续尝试其他歌曲。';
  }
  if (player?.fallback?.kind === 'version') {
    return '指定版本不可播放，已在后台自动改播同一歌曲的其他版本并显示缩小的音乐悬浮窗，没有打开设置界面。';
  }
  if (player?.fallback?.kind === 'song') {
    return '这首歌的可用版本均无法播放，已在后台自动换播另一首歌并显示缩小的音乐悬浮窗，没有打开设置界面。';
  }
  return '已在后台请求播放并显示缩小的音乐悬浮窗，没有打开或切换设置界面。';
}

export class LingXiMusicAdapter {
  constructor({ catalog = musicService, bus = eventBus } = {}) {
    this.catalog = catalog;
    this.bus = bus;
  }

  async search({ query, limit = 10 } = {}) {
    const normalizedQuery = cleanText(query, 160);
    const tracks = await this.catalog.search(normalizedQuery, { limit });
    return {
      query: normalizedQuery,
      count: tracks.length,
      tracks,
      notice: '曲目信息来自腾讯音乐目录，仅作为搜索结果；free/paid 标签不保证地址当前可播。播放时会在后台依次尝试同曲其他版本和其他歌曲。'
    };
  }

  async inspect() {
    if (typeof this.bus?.request === 'function') {
      try {
        const state = await this.bus.request('app:music-state', {});
        if (state && typeof state === 'object') return state;
      } catch {
        // The shell may not have mounted a player yet. The cache summary below
        // remains useful and does not require opening a panel or resolving a URL.
      }
    }
    return {
      status: 'idle',
      query: this.catalog.lastQuery || '',
      recentTracks: this.catalog.getSearchResults?.() || [],
      notice: '播放器尚未挂载；未读取播放地址。'
    };
  }

  async _requestPlayer(event, payload) {
    if (typeof this.bus?.request !== 'function') throw new Error('页面播放器当前不可用');
    const player = await this.bus.request(event, payload);
    if (!player || typeof player !== 'object') throw new Error('页面播放器没有返回有效状态');
    return player;
  }

  async open({ trackId, autoplay = false } = {}) {
    const normalizedId = cleanText(trackId, 300);
    const track = this.catalog.getTrack(normalizedId);
    if (!track) throw new Error('曲目不在最近的搜索结果中，请先调用 search_music');
    const player = await this._requestPlayer('app:music-open', {
      query: this.catalog.lastQuery,
      tracks: this.catalog.getSearchResults(),
      track,
      autoplay: autoplay === true
    });
    return {
      opened: true,
      track,
      player,
      notice: musicOpenNotice(player, autoplay === true)
    };
  }

  async control({ action } = {}) {
    const normalizedAction = cleanText(action, 40);
    if (!['play', 'pause', 'toggle', 'next', 'previous'].includes(normalizedAction)) {
      throw new TypeError('不支持的音乐控制动作');
    }
    const player = await this._requestPlayer('app:music-control', { action: normalizedAction });
    return {
      action: normalizedAction,
      player,
      notice: player?.status === 'blocked'
        ? '浏览器要求一次用户播放手势才能开始播放；设置界面没有被打开。'
        : '音乐控制已在后台完成，没有打开或切换设置界面。'
    };
  }
}

export const lingXiMusicAdapter = new LingXiMusicAdapter();

export default lingXiMusicAdapter;
