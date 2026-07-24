function imageError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function withLocalProtocol(value) {
  const raw = String(value || '').trim();
  if (!raw || /^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw;
  if (/^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?)(?::|\/|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  return raw;
}

function isOpenAICompatibleProvider(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return !normalized || normalized === 'openai' || normalized === 'openai-compatible'
    || normalized === 'openai_compatible';
}

export function normalizeImageApiBaseUrl(value, providerType = 'openai-compatible') {
  const raw = withLocalProtocol(value);
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); }
  catch { return raw.replace(/\/+$/, ''); }

  parsed.hash = '';
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (isOpenAICompatibleProvider(providerType)) {
    for (const suffix of ['/images/generations', '/chat/completions', '/responses', '/models']) {
      if (pathname.toLowerCase().endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length).replace(/\/+$/, '');
        break;
      }
    }
    if (!pathname || pathname === '/') pathname = '/v1';
  }
  parsed.pathname = pathname || '/';
  return parsed.toString().replace(/\/$/, '');
}

export function classifyImageEndpoint(value) {
  let url;
  try { url = new URL(withLocalProtocol(value)); }
  catch { throw imageError('PROFILE_INVALID', '图像服务地址不是有效 URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw imageError('PROFILE_INVALID', '图像服务仅支持 HTTP 或 HTTPS');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host);
  const privateLan = /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    || host.endsWith('.local');
  return {
    url,
    origin: url.origin,
    loopback,
    privateLan,
    public: !loopback && !privateLan
  };
}

export function resolveImageTransport(apiUrl, { allowedPrivateOrigins = [] } = {}) {
  const endpoint = classifyImageEndpoint(apiUrl);
  if (endpoint.public && endpoint.url.protocol !== 'https:') {
    throw imageError('PROVIDER_POLICY', '公网图像服务必须使用 HTTPS');
  }
  if (endpoint.privateLan && !allowedPrivateOrigins.includes(endpoint.origin)) {
    throw imageError('PROVIDER_POLICY', `局域网图像服务尚未获准直连: ${endpoint.origin}`);
  }
  return { ...endpoint, route: endpoint.public ? 'public-proxy' : 'browser-direct' };
}

function joinUrl(base, path) {
  const target = new URL(base);
  const rawPath = String(path || '');
  const hashIndex = rawPath.indexOf('#');
  const withoutHash = hashIndex >= 0 ? rawPath.slice(0, hashIndex) : rawPath;
  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const pathSearch = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';
  target.pathname = `${target.pathname.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`;
  if (pathSearch) {
    if (!target.search) {
      target.search = pathSearch;
    } else {
      const merged = new URLSearchParams(target.search);
      const additions = new URLSearchParams(pathSearch);
      for (const key of new Set(additions.keys())) merged.delete(key);
      for (const [key, value] of additions) merged.append(key, value);
      target.search = merged.toString();
    }
  }
  target.hash = '';
  return target.href;
}

function credentialsForProviderUrl(provider, url) {
  if (!provider?.apiKey) return null;
  try {
    const providerUrl = new URL(normalizeImageApiBaseUrl(provider.apiUrl, provider.type));
    const targetUrl = new URL(url);
    if (providerUrl.origin !== targetUrl.origin) return null;
  } catch {
    return null;
  }
  return {
    apiKey: provider.apiKey,
    apiKeyHeader: provider.apiKeyHeader || 'Authorization'
  };
}

async function errorFromResponse(response, fallback) {
  const body = await response.text().catch(() => '');
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed.error?.message || parsed.error || parsed.message || body;
  } catch { /* text response */ }
  const error = imageError(
    response.status === 401 || response.status === 403 ? 'AUTH' : 'PROVIDER_ERROR',
    `${fallback} (${response.status})${message ? `: ${String(message).slice(0, 500)}` : ''}`
  );
  error.status = response.status;
  error.retryable = response.status === 429 || response.status >= 500;
  return error;
}

export class ImageTransport {
  constructor({ fetchImpl, allowedPrivateOrigins = [] } = {}) {
    const resolvedFetch = fetchImpl === undefined ? globalThis.fetch : fetchImpl;
    if (typeof resolvedFetch !== 'function') throw new Error('fetch is unavailable');
    this.fetchImpl = resolvedFetch === globalThis.fetch
      ? resolvedFetch.bind(globalThis)
      : resolvedFetch;
    this.allowedPrivateOrigins = allowedPrivateOrigins;
  }

  async request(provider, path, { method = 'GET', body, headers = {}, signal, accept = 'application/json' } = {}) {
    const baseUrl = normalizeImageApiBaseUrl(provider.apiUrl, provider.type);
    const transport = resolveImageTransport(baseUrl, {
      allowedPrivateOrigins: this.allowedPrivateOrigins
    });
    const targetUrl = joinUrl(baseUrl, path);
    const requestHeaders = { Accept: accept, ...headers };
    let url = targetUrl;
    if (transport.route === 'public-proxy') {
      url = '/api/ai-proxy';
      requestHeaders['x-target-url'] = targetUrl;
      requestHeaders['x-user-api-key'] = provider.apiKey || '';
      requestHeaders['x-api-key-header'] = provider.apiKeyHeader || 'Authorization';
      requestHeaders['x-proxy-purpose'] = String(path).replace(/[?#].*$/, '').replace(/\/+$/, '').endsWith('/models')
        ? 'models'
        : 'image-generation';
    } else if (provider.apiKey) {
      const keyHeader = provider.apiKeyHeader || 'Authorization';
      requestHeaders[keyHeader] = keyHeader.toLowerCase() === 'authorization'
        ? `Bearer ${provider.apiKey}` : provider.apiKey;
    }
    let requestBody = body;
    if (body !== undefined && body !== null && !(body instanceof Blob) && !(body instanceof FormData)
      && typeof body !== 'string' && !(body instanceof ArrayBuffer)) {
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
      requestBody = JSON.stringify(body);
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : requestBody,
        credentials: transport.route === 'public-proxy' ? 'same-origin' : 'omit',
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const hint = transport.route === 'browser-direct'
        ? '。请确认本地服务已启动，并允许当前网页来源的 CORS / Private Network Access'
        : '';
      throw imageError('CORS_OR_PRIVATE_NETWORK', `无法连接图像服务${hint}`, { cause: error?.message });
    }
    if (!response.ok) throw await errorFromResponse(response, '图像服务请求失败');
    return response;
  }

  async json(provider, path, options = {}) {
    const response = await this.request(provider, path, options);
    try { return await response.json(); }
    catch { throw imageError('PROVIDER_ERROR', '图像服务返回了无效 JSON'); }
  }

  async blob(provider, path, options = {}) {
    return (await this.request(provider, path, { ...options, accept: 'image/*' })).blob();
  }

  async downloadPublicUrl(url, { signal, provider } = {}) {
    const endpoint = classifyImageEndpoint(url);
    if (!endpoint.public || endpoint.url.protocol !== 'https:') {
      throw imageError('PROVIDER_POLICY', '供应商返回了不安全的临时图片地址');
    }
    const providerCredentials = credentialsForProviderUrl(provider, endpoint.url.href);
    const headers = {
      'x-target-url': endpoint.url.href,
      'x-proxy-purpose': 'image-download',
      Accept: 'image/*'
    };
    if (providerCredentials) {
      headers['x-user-api-key'] = providerCredentials.apiKey;
      headers['x-api-key-header'] = providerCredentials.apiKeyHeader;
    }
    const response = await this.fetchImpl('/api/ai-proxy', {
      method: 'GET',
      headers,
      credentials: 'same-origin',
      signal
    });
    if (!response.ok) throw await errorFromResponse(response, '下载供应商图片失败');
    return response.blob();
  }

  async downloadUrl(url, { signal, provider } = {}) {
    const transport = resolveImageTransport(url, {
      allowedPrivateOrigins: this.allowedPrivateOrigins
    });
    if (transport.route === 'public-proxy') {
      return this.downloadPublicUrl(transport.url.href, { signal, provider });
    }
    const providerCredentials = credentialsForProviderUrl(provider, transport.url.href);
    const headers = { Accept: 'image/*' };
    if (providerCredentials) {
      headers[providerCredentials.apiKeyHeader] = providerCredentials.apiKeyHeader.toLowerCase() === 'authorization'
        ? `Bearer ${providerCredentials.apiKey}` : providerCredentials.apiKey;
    }
    let response;
    try {
      response = await this.fetchImpl(transport.url.href, {
        method: 'GET', headers, credentials: 'omit', signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw imageError(
        'CORS_OR_PRIVATE_NETWORK',
        '无法下载本地绘图结果。请确认服务允许当前网页来源的 CORS / Private Network Access',
        { cause: error?.message }
      );
    }
    if (!response.ok) throw await errorFromResponse(response, '下载本地绘图结果失败');
    return response.blob();
  }
}

export { imageError };
