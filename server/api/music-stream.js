import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { requestUpstream, validateTargetUrl } from './ai-proxy.js';

const TENCENT_MUSIC_RESOLVE_ENDPOINT = 'https://api.vkeys.cn/v2/music/tencent';
const MUSIC_STREAM_HOST_SUFFIX = '.stream.qqmusic.qq.com';
const MAX_REDIRECTS = 3;
const MAX_STREAM_BYTES = 128 * 1024 * 1024;
const OPEN_TIMEOUT_MS = 20_000;
const MUSIC_SNIFF_BYTES = 16;
const MUSIC_TYPE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_MUSIC_TYPE_CACHE_SIZE = 512;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FORWARDED_RESPONSE_HEADERS = [
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified'
];

export const MUSIC_STREAM_HTTP_ALLOWLIST = Object.freeze(['*.stream.qqmusic.qq.com']);
const musicTypeCache = new Map();

function fail(message, code = 'MUSIC_STREAM_INVALID') {
  throw Object.assign(new Error(message), { code });
}

export function normalizeMusicMid(value) {
  const result = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(result) ? result : '';
}

export function normalizeMusicProvider(value) {
  const result = String(value || '').trim().toLowerCase();
  return result === 'tencent' ? result : '';
}

export function normalizeMusicRange(value) {
  const result = String(value || '').trim();
  if (!result) return '';
  return result.length <= 100 && /^bytes=\d*-\d*$/.test(result) && result !== 'bytes=-'
    ? result
    : '';
}

export function normalizeMusicContentType(value) {
  const raw = String(value || '').trim().toLowerCase();
  const mediaType = raw.split(';', 1)[0];
  if (mediaType.startsWith('audio/')) return raw;
  if ([
    '',
    'application/octet-stream',
    'application/x-www-form-urlencoded',
    'binary/octet-stream',
    'text/octet'
  ].includes(mediaType)) return 'audio/mpeg';
  return '';
}

export function detectMusicContentType(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length >= 4) {
    const magic4 = bytes.toString('ascii', 0, 4);
    if (magic4 === 'fLaC') return 'audio/flac';
    if (magic4 === 'OggS') return 'audio/ogg';
    if (magic4 === 'RIFF' && bytes.length >= 12 && bytes.toString('ascii', 8, 12) === 'WAVE') {
      return 'audio/wav';
    }
    if (magic4 === 'FORM' && bytes.length >= 12 && /^AIF[FC]$/.test(bytes.toString('ascii', 8, 12))) {
      return 'audio/aiff';
    }
  }
  if (bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (bytes.length >= 4
      && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'audio/webm';
  }
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
      && (bytes[1] & 0x06) !== 0) {
    return 'audio/mpeg';
  }
  return '';
}

function cachedMusicContentType(mid, now = Date.now()) {
  const trackId = normalizeMusicMid(mid);
  const entry = trackId ? musicTypeCache.get(trackId) : null;
  if (!entry) return '';
  if (entry.expiresAt <= now) {
    musicTypeCache.delete(trackId);
    return '';
  }
  musicTypeCache.delete(trackId);
  musicTypeCache.set(trackId, entry);
  return entry.contentType;
}

function rememberMusicContentType(mid, contentType, now = Date.now()) {
  const trackId = normalizeMusicMid(mid);
  if (!trackId || !contentType) return;
  musicTypeCache.delete(trackId);
  musicTypeCache.set(trackId, {
    contentType,
    expiresAt: now + MUSIC_TYPE_CACHE_TTL_MS
  });
  while (musicTypeCache.size > MAX_MUSIC_TYPE_CACHE_SIZE) {
    musicTypeCache.delete(musicTypeCache.keys().next().value);
  }
}

function musicResponseStartsAtZero(status, range, contentRange) {
  if (status === 200) return true;
  return /^bytes=0-/i.test(String(range || ''))
    || /^bytes\s+0-/i.test(String(contentRange || ''));
}

async function readMusicPrefix(upstream) {
  const iteratorFactory = upstream?.[Symbol.asyncIterator];
  if (typeof iteratorFactory !== 'function') fail('音乐上游响应不可读取', 'MUSIC_STREAM_CONTENT_INVALID');
  const iterator = iteratorFactory.call(upstream);
  const chunks = [];
  let received = 0;
  while (received < MUSIC_SNIFF_BYTES) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value || []);
    if (!chunk.length) continue;
    chunks.push(chunk);
    received += chunk.length;
  }
  if (!chunks.length) {
    upstream.destroy?.();
    fail('音乐上游返回了空内容', 'MUSIC_STREAM_CONTENT_INVALID');
  }
  return { iterator, chunks, prefix: Buffer.concat(chunks, received) };
}

function replayMusicStream(upstream, iterator, chunks) {
  return Readable.from((async function* replay() {
    try {
      for (const chunk of chunks) yield chunk;
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      if (!upstream.destroyed && !upstream.readableEnded) upstream.destroy?.();
    }
  })());
}

export async function prepareMusicStream(upstream, {
  mid,
  method = 'GET',
  range = '',
  now = Date.now()
} = {}) {
  const status = Number(upstream?.statusCode) || 502;
  const cachedType = cachedMusicContentType(mid, now);
  const declaredType = normalizeMusicContentType(upstream?.headers?.['content-type']);
  if (method === 'HEAD') {
    const contentType = cachedType || declaredType;
    if (!contentType) fail('音乐上游返回了非音频内容', 'MUSIC_STREAM_CONTENT_INVALID');
    return { contentType, body: null, detected: false };
  }

  const startsAtZero = musicResponseStartsAtZero(
    status,
    range,
    upstream?.headers?.['content-range']
  );
  if (!startsAtZero) {
    const contentType = cachedType || declaredType;
    if (!contentType) fail('音乐上游返回了非音频内容', 'MUSIC_STREAM_CONTENT_INVALID');
    return { contentType, body: upstream, detected: false };
  }

  const { iterator, chunks, prefix } = await readMusicPrefix(upstream);
  const detectedType = detectMusicContentType(prefix);
  if (!detectedType) {
    if (typeof iterator.return === 'function') {
      try { await iterator.return(); } catch { /* upstream is rejected below */ }
    }
    upstream.destroy?.();
    fail('音乐上游返回了非音频内容', 'MUSIC_STREAM_CONTENT_INVALID');
  }
  rememberMusicContentType(mid, detectedType, now);
  return {
    contentType: detectedType,
    body: replayMusicStream(upstream, iterator, chunks),
    detected: true
  };
}

export function parseAllowedMusicStreamUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail('音乐流地址无效');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowedHost = hostname === MUSIC_STREAM_HOST_SUFFIX.slice(1)
    || hostname.endsWith(MUSIC_STREAM_HOST_SUFFIX);
  const validProtocol = url.protocol === 'http:' || url.protocol === 'https:';
  const validPort = !url.port;
  if (!allowedHost || !validProtocol || !validPort || url.username || url.password || url.hash || url.href.length > 8192) {
    fail('音乐流地址不在允许的音乐域名内');
  }
  return url;
}

export async function resolveMusicStreamUrl(mid, {
  fetchImpl = globalThis.fetch,
  signal
} = {}) {
  const trackId = normalizeMusicMid(mid);
  if (!trackId) fail('曲目标识无效', 'MUSIC_MID_INVALID');
  if (typeof fetchImpl !== 'function') fail('服务器不支持音乐地址解析', 'MUSIC_RESOLVER_UNAVAILABLE');
  const response = await fetchImpl(`${TENCENT_MUSIC_RESOLVE_ENDPOINT}?mid=${encodeURIComponent(trackId)}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal
  });
  if (!response?.ok) {
    fail(`音乐地址解析失败：HTTP ${Number(response?.status) || 0}`, 'MUSIC_RESOLVE_FAILED');
  }
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
    fail('音乐地址解析响应过大', 'MUSIC_RESOLVE_FAILED');
  }
  const payload = await response.json().catch(() => null);
  if (!payload || payload.code !== 200) fail('音乐地址解析服务返回无效数据', 'MUSIC_RESOLVE_FAILED');
  return parseAllowedMusicStreamUrl(payload?.data?.url).href;
}

function musicRequestHeaders(range) {
  return {
    accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1',
    referer: 'https://y.qq.com/',
    'user-agent': 'Mozilla/5.0 (compatible; NarutoRPG-MusicProxy/1.0)',
    ...(range ? { range } : {})
  };
}

export async function openMusicStream(id, {
  method = 'GET',
  range = '',
  signal,
  fetchImpl = globalThis.fetch,
  validateTarget = validateTargetUrl,
  requestImpl = requestUpstream
} = {}) {
  const normalizedMethod = method === 'HEAD' ? 'HEAD' : 'GET';
  const normalizedRange = normalizeMusicRange(range);
  if (range && !normalizedRange) fail('音乐 Range 请求无效', 'MUSIC_RANGE_INVALID');
  const resolvedUrl = await resolveMusicStreamUrl(id, { fetchImpl, signal });
  let target = parseAllowedMusicStreamUrl(resolvedUrl);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const checked = await validateTarget(target.href, {
      signal,
      allowFakeIpDns: config.proxy.allowFakeIpDns,
      allowHttpTargets: MUSIC_STREAM_HTTP_ALLOWLIST
    });
    if (checked?.errorStatus || !checked?.url || !Array.isArray(checked.addresses)) {
      fail(checked?.errorBody?.error || '音乐流目标校验失败', 'MUSIC_STREAM_TARGET_REJECTED');
    }
    const validatedUrl = parseAllowedMusicStreamUrl(checked.url.href);
    const upstream = await requestImpl(validatedUrl, {
      method: normalizedMethod,
      headers: musicRequestHeaders(normalizedRange),
      signal
    }, checked.addresses);
    const status = Number(upstream?.statusCode) || 502;
    if (!REDIRECT_STATUSES.has(status)) return upstream;

    const location = upstream.headers?.location;
    upstream.destroy?.();
    if (!location || redirects === MAX_REDIRECTS) {
      fail('音乐流重定向无效或次数过多', 'MUSIC_STREAM_REDIRECT_REJECTED');
    }
    target = parseAllowedMusicStreamUrl(new URL(String(location), validatedUrl).href);
  }
  fail('音乐流重定向次数过多', 'MUSIC_STREAM_REDIRECT_REJECTED');
}

function byteLimitTransform(maxBytes) {
  let received = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        callback(Object.assign(new Error('音乐流超过大小限制'), { code: 'MUSIC_STREAM_TOO_LARGE' }));
        return;
      }
      callback(null, chunk);
    }
  });
}

function sendError(res, status, message) {
  if (res.headersSent || res.destroyed) return;
  res.status(status).json({ error: message });
}

export async function musicStreamHandler(req, res) {
  const provider = req.query?.provider === undefined
    ? 'tencent'
    : normalizeMusicProvider(req.query.provider);
  if (!provider) return sendError(res, 400, '音乐来源无效');
  const trackId = normalizeMusicMid(req.query?.mid ?? req.query?.id);
  if (!trackId) return sendError(res, 400, '曲目标识无效');
  const rawRange = String(req.headers?.range || '');
  const range = normalizeMusicRange(rawRange);
  if (rawRange && !range) return sendError(res, 416, '仅支持单段字节范围请求');

  const controller = new AbortController();
  let openTimedOut = false;
  const timeout = setTimeout(() => {
    openTimedOut = true;
    controller.abort(new Error('Music stream open timed out'));
  }, OPEN_TIMEOUT_MS);
  timeout.unref?.();
  const abortDisconnected = () => {
    if (!res.writableEnded && !controller.signal.aborted) controller.abort(new Error('Client disconnected'));
  };
  req.once('aborted', abortDisconnected);
  res.once('close', abortDisconnected);

  let upstream = null;
  try {
    upstream = await openMusicStream(trackId, {
      method: req.method,
      range,
      signal: controller.signal
    });
    clearTimeout(timeout);
    const status = Number(upstream.statusCode) || 502;
    if (status !== 200 && status !== 206) {
      upstream.destroy?.();
      return sendError(res, 502, `音乐上游返回 HTTP ${status}`);
    }
    const declaredLength = Number(upstream.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_STREAM_BYTES) {
      upstream.destroy?.();
      return sendError(res, 502, '音乐流超过大小限制');
    }
    const prepared = await prepareMusicStream(upstream, {
      mid: `${provider}:${trackId}`,
      method: req.method,
      range
    });
    const contentType = prepared.contentType;

    res.status(status);
    for (const header of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers?.[header];
      if (value !== undefined) res.setHeader(header, value);
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store, no-transform');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.method === 'HEAD') {
      upstream.destroy?.();
      res.end();
      return;
    }
    await pipeline(prepared.body, byteLimitTransform(MAX_STREAM_BYTES), res);
  } catch (error) {
    upstream?.destroy?.();
    if (controller.signal.aborted && !openTimedOut) return;
    if (openTimedOut) return sendError(res, 504, '音乐流连接超时');
    if (error?.code === 'MUSIC_MID_INVALID'
        || error?.code === 'MUSIC_PROVIDER_INVALID'
        || error?.code === 'MUSIC_RANGE_INVALID') {
      return sendError(res, 400, error.message);
    }
    if (!res.headersSent) return sendError(res, 502, error?.message || '音乐流代理失败');
    if (!res.destroyed) res.destroy(error);
  } finally {
    clearTimeout(timeout);
    req.off('aborted', abortDisconnected);
    res.off('close', abortDisconnected);
  }
}

export default musicStreamHandler;
