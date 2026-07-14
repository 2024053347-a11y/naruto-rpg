import { Router } from 'express';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// 强制验证登录状态，防止未授权用户盗用代理
router.use(requireAuth);

/** 仅转发白名单内的请求头，避免把 Cookie / 内部头泄露给上游 */
const FORWARDABLE_REQUEST_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'user-agent'];
/** 仅回传白名单内的响应头 */
const FORWARDABLE_RESPONSE_HEADERS = ['content-type', 'cache-control'];

const blockedIPv4 = new BlockList();
const blockedIPv6 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blockedIPv4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
]) blockedIPv6.addSubnet(address, prefix, 'ipv6');

function isPrivateAddress(address) {
  const normalized = String(address || '').replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedIPv4.check(mapped[1], 'ipv4');
  const family = isIP(normalized);
  if (!family) return false;
  return family === 4
    ? blockedIPv4.check(normalized, 'ipv4')
    : blockedIPv6.check(normalized, 'ipv6');
}

/**
 * 校验目标 URL：必须是合法的 HTTPS 公网地址。
 * @param {string} targetUrl
 * @returns {Promise<{url?: URL, addresses?: Array<{address: string, family: number}>, errorStatus?: number, errorBody?: {error: string}}>}
 */
async function validateTargetUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { errorStatus: 400, errorBody: { error: '无效的目标 URL' } };
  }
  if (parsed.protocol !== 'https:') {
    return { errorStatus: 403, errorBody: { error: '仅允许 HTTPS 目标' } };
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (/^\d+$/.test(hostname) || hostname.toLowerCase() === 'localhost' || isPrivateAddress(hostname)) {
    console.warn(`[AI PROXY] Blocked internal target: ${targetUrl}`);
    return { errorStatus: 403, errorBody: { error: '禁止代理到内网地址' } };
  }
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      console.warn(`[AI PROXY] Blocked DNS target: ${targetUrl}`);
      return { errorStatus: 403, errorBody: { error: '目标域名解析到受限地址' } };
    }
    return { url: parsed, addresses };
  } catch {
    return { errorStatus: 400, errorBody: { error: '目标域名无法解析' } };
  }
}

function requestUpstream(url, { method, headers, body, signal }, addresses) {
  const pinned = addresses.map(item => ({ address: item.address, family: item.family }));
  const pinnedLookup = (_hostname, options, callback) => {
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    const candidates = opts.family ? pinned.filter(item => item.family === opts.family) : pinned;
    if (!candidates.length) {
      const error = new Error('No validated address matches the requested family');
      error.code = 'EAI_ADDRFAMILY';
      callback(error);
      return;
    }
    if (opts.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  };

  return new Promise((resolve, reject) => {
    const upstreamRequest = httpsRequest(url, { method, headers, signal, lookup: pinnedLookup }, resolve);
    upstreamRequest.on('error', reject);
    if (body) upstreamRequest.write(body);
    upstreamRequest.end();
  });
}

/**
 * /api/ai-proxy — AI 接口代理（开放模式 + 内网防护）
 *
 * 客户端设置以下请求头：
 *   x-target-url       — 目标 API 完整地址（如 https://api.openai.com/v1/chat/completions）
 *   x-user-api-key     — 用户的 API Key（免密上游可为空）
 *   x-api-key-header   — 注入 Key 的请求头名称（默认 Authorization，Claude 用 x-api-key）
 *
 * 所有流量经 HTTPS 传输，API Key 仅在服务端内存短暂驻留，不落盘不记录。
 */
router.all('/', async (req, res) => {
  const targetUrl = req.headers['x-target-url'];
  const apiKey = req.headers['x-user-api-key'];
  const apiKeyHeaderName = req.headers['x-api-key-header'] || 'Authorization';

  if (!targetUrl) {
    return res.status(400).json({ error: '缺少目标代理地址 x-target-url' });
  }
  const { url, addresses, errorStatus, errorBody } = await validateTargetUrl(targetUrl);
  if (errorStatus) {
    return res.status(errorStatus).json(errorBody);
  }

  // 白名单：仅允许标准的 API key 请求头名称
  const ALLOWED_KEY_HEADERS = ['authorization', 'x-api-key', 'api-key'];
  if (!ALLOWED_KEY_HEADERS.includes(apiKeyHeaderName.toLowerCase())) {
    return res.status(451).json({ error: '不允许的 x-api-key-header 值' });
  }

  // 客户端中途断开时立即中止上游请求，避免继续为已放弃的生成计费/占用连接
  const upstreamAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) upstreamAbort.abort();
  });

  try {
    const forwardHeaders = {};
    for (const key of FORWARDABLE_REQUEST_HEADERS) {
      if (req.headers[key]) forwardHeaders[key] = req.headers[key];
    }

    // 注入用户的 API Key（Authorization 走 Bearer 方案，其余按原样注入）
    if (apiKey) {
      if (apiKeyHeaderName.toLowerCase() === 'authorization') {
        forwardHeaders['Authorization'] = `Bearer ${apiKey}`;
      } else {
        forwardHeaders[apiKeyHeaderName] = apiKey;
      }
    }

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      body = JSON.stringify(req.body);
    }

    const upstreamResponse = await requestUpstream(url, {
      method: req.method,
      headers: forwardHeaders,
      body,
      signal: upstreamAbort.signal
    }, addresses);
    // 拒绝重定向 — AI API 不需要
    const upstreamStatus = upstreamResponse.statusCode || 502;
    if (upstreamStatus >= 300 && upstreamStatus < 400) {
      console.warn(`[AI PROXY] Blocked redirect to: ${upstreamResponse.headers.location || 'unknown'}`);
      upstreamResponse.destroy();
      return res.status(502).json({ error: `AI 代理拒绝重定向: ${upstreamStatus}` });
    }
    res.status(upstreamStatus);

    for (const key of FORWARDABLE_RESPONSE_HEADERS) {
      const value = upstreamResponse.headers[key];
      if (value) res.setHeader(key, value);
    }

    const contentType = upstreamResponse.headers['content-type'] || '';
    const wantsStream = contentType.includes('text/event-stream')
      || (req.headers['accept'] || '').includes('text/event-stream');

    if (wantsStream) {
      // 流式响应（SSE）：逐块透传，不在内存中聚合
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      try {
        for await (const chunk of upstreamResponse) {
          res.write(chunk);
        }
      } catch (err) {
        // 客户端主动断开触发的 abort 属正常路径，其余错误记录后照常结束响应
        if (err.name !== 'AbortError') {
          console.error('[AI PROXY] Stream error:', err.message);
        }
      }
      res.end();
    } else {
      const chunks = [];
      for await (const chunk of upstreamResponse) chunks.push(Buffer.from(chunk));
      res.send(Buffer.concat(chunks));
    }
  } catch (error) {
    if (error.name === 'AbortError') return; // 客户端已断开，无需响应
    console.error('[AI PROXY] Upstream failed:', error.message, error.cause || '');
    res.status(502).json({ error: `AI 代理请求上游失败: ${error.message} ${error.cause ? error.cause.message : ''}`.trim() });
  }
});

export { isPrivateAddress, validateTargetUrl };
export default router;
