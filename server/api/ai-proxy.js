import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// 强制验证登录状态，防止未授权用户盗用代理
router.use(requireAuth);

/** 仅转发白名单内的请求头，避免把 Cookie / 内部头泄露给上游 */
const FORWARDABLE_REQUEST_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'user-agent'];
/** 仅回传白名单内的响应头 */
const FORWARDABLE_RESPONSE_HEADERS = ['content-type', 'cache-control'];

/**
 * SSRF 防护：判断主机名是否指向本机或 IPv4 内网地址段。
 * 注意：按主机名字面判断，不做 DNS 解析（域名解析到内网的 DNS Rebinding 不在此层防护范围）。
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHost(hostname) {
  if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(hostname)) return true;

  const octets = hostname.split('.').map(Number);
  if (octets.length === 4 && octets.every((n) => !Number.isNaN(n))) {
    if (octets[0] === 10) return true; // 10.0.0.0/8
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true; // 172.16.0.0/12
    if (octets[0] === 192 && octets[1] === 168) return true; // 192.168.0.0/16
    if (octets[0] === 169 && octets[1] === 254) return true; // 169.254.0.0/16 链路本地
  }
  return false;
}

/**
 * 校验目标 URL：必须是合法的 HTTPS 公网地址。
 * @param {string} targetUrl
 * @returns {{url?: URL, errorStatus?: number, errorBody?: {error: string}}}
 */
function validateTargetUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { errorStatus: 400, errorBody: { error: '无效的目标 URL' } };
  }
  if (parsed.protocol !== 'https:') {
    return { errorStatus: 403, errorBody: { error: '仅允许 HTTPS 目标' } };
  }
  if (isPrivateHost(parsed.hostname)) {
    console.warn(`[AI PROXY] Blocked internal target: ${targetUrl}`);
    return { errorStatus: 403, errorBody: { error: '禁止代理到内网地址' } };
  }
  return { url: parsed };
}

/**
 * /api/ai-proxy — AI 接口代理（开放模式 + 内网防护）
 *
 * 客户端设置以下请求头：
 *   x-target-url       — 目标 API 完整地址（如 https://api.openai.com/v1/chat/completions）
 *   x-user-api-key     — 用户的 API Key（内存中短暂存在，用完即焚）
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
  if (!apiKey) {
    return res.status(401).json({ error: '缺少 API 密钥 x-user-api-key' });
  }

  const { errorStatus, errorBody } = validateTargetUrl(targetUrl);
  if (errorStatus) {
    return res.status(errorStatus).json(errorBody);
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
    if (apiKeyHeaderName.toLowerCase() === 'authorization') {
      forwardHeaders['Authorization'] = `Bearer ${apiKey}`;
    } else {
      forwardHeaders[apiKeyHeaderName] = apiKey;
    }

    const fetchOptions = { method: req.method, headers: forwardHeaders, signal: upstreamAbort.signal };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const upstreamResponse = await fetch(targetUrl, fetchOptions);
    res.status(upstreamResponse.status);

    for (const key of FORWARDABLE_RESPONSE_HEADERS) {
      const value = upstreamResponse.headers.get(key);
      if (value) res.setHeader(key, value);
    }

    const contentType = upstreamResponse.headers.get('content-type') || '';
    const wantsStream = contentType.includes('text/event-stream')
      || (req.headers['accept'] || '').includes('text/event-stream');

    if (wantsStream && upstreamResponse.body) {
      // 流式响应（SSE）：逐块透传，不在内存中聚合
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      try {
        for await (const chunk of upstreamResponse.body) {
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
      const data = await upstreamResponse.arrayBuffer();
      res.send(Buffer.from(data));
    }
  } catch (error) {
    if (error.name === 'AbortError') return; // 客户端已断开，无需响应
    console.error('[AI PROXY] Upstream failed:', error.message, error.cause || '');
    res.status(502).json({ error: `AI 代理请求上游失败: ${error.message} ${error.cause ? error.cause.message : ''}`.trim() });
  }
});

export default router;
