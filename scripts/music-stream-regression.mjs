import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  MUSIC_STREAM_HTTP_ALLOWLIST,
  detectMusicContentType,
  normalizeMusicMid,
  normalizeMusicProvider,
  normalizeMusicContentType,
  normalizeMusicRange,
  openMusicStream,
  parseAllowedMusicStreamUrl,
  prepareMusicStream,
  resolveMusicStreamUrl
} from '../server/api/music-stream.js';

const MID = '040aisk00bdqB';
const HTTP_STREAM = `http://ws.stream.qqmusic.qq.com/RS02${MID}.mp3?vkey=signed`;

assert.equal(normalizeMusicMid(MID), MID);
assert.equal(normalizeMusicMid('track-001'), 'track-001');
assert.equal(normalizeMusicMid('../metadata'), '');
assert.equal(normalizeMusicMid('a'.repeat(129)), '');
assert.equal(normalizeMusicProvider('tencent'), 'tencent');
assert.equal(normalizeMusicProvider('kuwo'), '', 'removed providers are rejected');
assert.equal(normalizeMusicProvider('invented'), '');
assert.equal(normalizeMusicRange('bytes=0-1023'), 'bytes=0-1023');
assert.equal(normalizeMusicRange('bytes=1024-'), 'bytes=1024-');
assert.equal(normalizeMusicRange('bytes=0-1,4-5'), '');
assert.equal(normalizeMusicContentType('audio/mpeg'), 'audio/mpeg');
assert.equal(normalizeMusicContentType('application/x-www-form-urlencoded'), 'audio/mpeg');
assert.equal(normalizeMusicContentType('text/octet'), 'audio/mpeg');
assert.equal(normalizeMusicContentType('text/html'), '');

assert.equal(detectMusicContentType(Buffer.from('fLaC\0\0\0\x22')), 'audio/flac');
assert.equal(detectMusicContentType(Buffer.from('OggS\0\x02\0\0')), 'audio/ogg');
assert.equal(detectMusicContentType(Buffer.from('ID3\x04\0\0\0\0')), 'audio/mpeg');
assert.equal(detectMusicContentType(Buffer.from('RIFF\0\0\0\0WAVE')), 'audio/wav');
assert.equal(detectMusicContentType(Buffer.from('\0\0\0\x18ftypM4A ')), 'audio/mp4');
assert.equal(detectMusicContentType(Buffer.from('{"error":"file not exist"}')), '');

const flacBody = Buffer.concat([
  Buffer.from('fLaC\0\0\0\x22'),
  Buffer.from('verified-audio-body')
]);
const flacUpstream = Readable.from([flacBody.subarray(0, 3), flacBody.subarray(3)]);
flacUpstream.statusCode = 206;
flacUpstream.headers = {
  'content-type': 'audio/x-ogg',
  'content-range': `bytes 0-${flacBody.length - 1}/${flacBody.length}`
};
const preparedFlac = await prepareMusicStream(flacUpstream, {
  mid: 'flac-fixture',
  method: 'GET',
  range: `bytes=0-${flacBody.length - 1}`
});
assert.equal(preparedFlac.contentType, 'audio/flac');
const replayedFlac = [];
for await (const chunk of preparedFlac.body) replayedFlac.push(chunk);
assert.deepEqual(Buffer.concat(replayedFlac), flacBody, 'sniffing must replay every upstream byte');

const laterFlacRange = Readable.from([Buffer.from('middle-of-flac')]);
laterFlacRange.statusCode = 206;
laterFlacRange.headers = {
  'content-type': 'audio/x-ogg',
  'content-range': 'bytes 1024-1037/4096'
};
const preparedLaterRange = await prepareMusicStream(laterFlacRange, {
  mid: 'flac-fixture',
  method: 'GET',
  range: 'bytes=1024-1037'
});
assert.equal(preparedLaterRange.contentType, 'audio/flac', 'later ranges reuse the verified track format');

const errorPayload = Readable.from([Buffer.from('{"errorcode":-46628,"errormsg":"file not exist"}')]);
errorPayload.statusCode = 200;
errorPayload.headers = { 'content-type': 'application/x-www-form-urlencoded' };
await assert.rejects(
  () => prepareMusicStream(errorPayload, { mid: 'broken-paid-track', method: 'GET' }),
  /非音频内容/
);

assert.equal(parseAllowedMusicStreamUrl(HTTP_STREAM).hostname, 'ws.stream.qqmusic.qq.com');
assert.equal(
  parseAllowedMusicStreamUrl('https://dl.stream.qqmusic.qq.com/song.mp3').hostname,
  'dl.stream.qqmusic.qq.com'
);
assert.throws(
  () => parseAllowedMusicStreamUrl('http://kw-bj.example.test/resource/test.mp3'),
  /音乐流地址/
);
for (const unsafe of [
  'https://stream.qqmusic.qq.com.evil.example/song.mp3',
  'https://127.0.0.1/song.mp3',
  'https://user:pass@ws.stream.qqmusic.qq.com/song.mp3',
  'file:///etc/passwd'
]) {
  assert.throws(() => parseAllowedMusicStreamUrl(unsafe), /音乐流地址/);
}

const resolverCalls = [];
const fetchImpl = async (url, options = {}) => {
  resolverCalls.push({ url: String(url), options });
  return {
    ok: true,
    status: 200,
    async json() {
      return { code: 200, data: { url: HTTP_STREAM } };
    }
  };
};

assert.equal(await resolveMusicStreamUrl(MID, { fetchImpl }), HTTP_STREAM);
assert.match(resolverCalls[0].url, /mid=040aisk00bdqB$/);
assert.equal(resolverCalls[0].options.redirect, 'error');
assert.equal(resolverCalls[0].options.credentials, undefined);

const validations = [];
const requests = [];
const validateTarget = async (url, options) => {
  validations.push({ url: String(url), options });
  return {
    url: new URL(url),
    addresses: [{ address: '203.0.113.10', family: 4 }]
  };
};
const requestImpl = async (url, options, addresses) => {
  requests.push({ url: String(url), options, addresses });
  return {
    statusCode: 206,
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': '1024',
      'content-range': 'bytes 0-1023/4096',
      'accept-ranges': 'bytes'
    },
    destroy() {}
  };
};

const upstream = await openMusicStream(MID, {
  range: 'bytes=0-1023',
  fetchImpl,
  validateTarget,
  requestImpl
});
assert.equal(upstream.statusCode, 206);
assert.deepEqual(validations[0].options.allowHttpTargets, MUSIC_STREAM_HTTP_ALLOWLIST);
assert.equal(requests[0].options.method, 'GET');
assert.equal(requests[0].options.headers.range, 'bytes=0-1023');
assert.equal(requests[0].options.headers.referer, 'https://y.qq.com/');

let privateTargetValidated = false;
await assert.rejects(
  () => openMusicStream(MID, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { code: 200, data: { url: 'http://127.0.0.1/private.mp3' } }; }
    }),
    validateTarget: async () => {
      privateTargetValidated = true;
      return {};
    },
    requestImpl
  }),
  /音乐流地址/
);
assert.equal(privateTargetValidated, false, 'host allowlist rejects before any outbound request');

const redirected = {
  statusCode: 302,
  headers: { location: 'https://evil.example/private.mp3' },
  destroyed: false,
  destroy() { this.destroyed = true; }
};
await assert.rejects(
  () => openMusicStream(MID, {
    fetchImpl,
    validateTarget,
    requestImpl: async () => redirected
  }),
  /音乐流地址/
);
assert.equal(redirected.destroyed, true, 'rejected redirects close the upstream response');

console.log('Music same-origin stream regression: passed');
