import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getUser } from '../db/index.js';

/** 会话 JWT 所在的 HttpOnly Cookie 名称（签发方 auth/discord.js 复用此常量） */
export const AUTH_COOKIE_NAME = 'naruto_token';

/** 开发旁路模式下注入的模拟用户 */
const DEV_BYPASS_USER = Object.freeze({ id: 'dev_user', username: 'dev_tester', avatar: '' });

/**
 * 每次请求时读取环境变量而非启动时快照，保持旧实现「测试中可动态开关」的语义。
 * @returns {boolean}
 */
function isAuthBypassEnabled() {
  return process.env.AUTH_BYPASS === 'true';
}

/**
 * 从请求中提取 JWT：优先 HttpOnly Cookie，其次 Authorization: Bearer 头。
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function extractToken(req) {
  if (req.cookies?.[AUTH_COOKIE_NAME]) {
    return req.cookies[AUTH_COOKIE_NAME];
  }
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  return null;
}

/**
 * 三个中间件共享的认证内核：提取令牌 → 校验签名 → 确认用户仍存在。
 * 只做判定不做响应，响应策略（401 JSON / 重定向）由各中间件自行决定。
 *
 * @param {import('express').Request} req
 * @returns {Promise<
 *   {status: 'ok', user: object} |
 *   {status: 'missing_token' | 'unknown_user' | 'invalid_token', error?: Error}
 * >}
 */
async function authenticateRequest(req) {
  const token = extractToken(req);
  if (!token) return { status: 'missing_token' };

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    // JWT 有效还不够：用户可能已被删除，必须回查数据库
    const user = await getUser(decoded.id);
    if (!user) return { status: 'unknown_user' };
    return { status: 'ok', user };
  } catch (err) {
    return { status: 'invalid_token', error: err };
  }
}

/**
 * 强制身份验证中间件（针对 API，失败返回 401 JSON）。
 * @type {import('express').RequestHandler}
 */
export async function requireAuth(req, res, next) {
  if (isAuthBypassEnabled()) {
    req.user = DEV_BYPASS_USER;
    return next();
  }

  const result = await authenticateRequest(req);
  switch (result.status) {
    case 'ok':
      req.user = result.user;
      return next();
    case 'missing_token':
      return res.status(401).json({ error: '未登录，请先进行身份验证' });
    case 'unknown_user':
      return res.status(401).json({ error: '账户不存在或已被删除' });
    default: // invalid_token
      console.error('[AUTH] Token verification failed:', result.error?.message);
      res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      return res.status(401).json({ error: '登录会话已过期，请重新登录' });
  }
}

/**
 * 强制身份验证中间件（针对 HTML 页面访问，失败重定向到登录页）。
 * @type {import('express').RequestHandler}
 */
export async function requireHtmlAuth(req, res, next) {
  if (isAuthBypassEnabled()) {
    req.user = DEV_BYPASS_USER;
    return next();
  }

  // 禁用 HTML 页面和重定向的缓存，防止 CDN 缓存导致无限重定向
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const result = await authenticateRequest(req);
  switch (result.status) {
    case 'ok':
      req.user = result.user;
      return next();
    case 'missing_token':
      return res.redirect('/login.html');
    case 'unknown_user':
      res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      return res.redirect('/login.html');
    default: // invalid_token
      res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      return res.redirect('/login.html?error=session_expired');
  }
}

/**
 * 可选身份验证中间件：解析成功则挂载 req.user，任何失败都放行。
 * 注意：与旧实现一致，此中间件不受 AUTH_BYPASS 影响。
 * @type {import('express').RequestHandler}
 */
export async function optionalAuth(req, res, next) {
  const result = await authenticateRequest(req);
  if (result.status === 'ok') {
    req.user = result.user;
  }
  next();
}
