import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { getUser } from '../db/index.js';

/**
 * 提取请求中的 JWT 令牌
 */
function extractToken(req) {
  // 1. 从 HttpOnly Cookie 中提取
  if (req.cookies && req.cookies.naruto_token) {
    return req.cookies.naruto_token;
  }
  // 2. 从 Authorization: Bearer 头中提取
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

/**
 * 强制身份验证中间件 (针对 API)
 */
export async function requireAuth(req, res, next) {
  // DEV MODE: only bypass when explicitly enabled via AUTH_BYPASS env var
  if (process.env.AUTH_BYPASS === 'true') {
    req.user = { id: 'dev_user', username: 'dev_tester', avatar: '' };
    return next();
  }
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: '未登录，请先进行身份验证' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // 验证用户在数据库中是否确实存在
    const user = getUser(decoded.id);
    if (!user) {
      return res.status(401).json({ error: '账户不存在或已被删除' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH] Token verification failed:', err.message);
    res.clearCookie('naruto_token', { path: '/' });
    return res.status(401).json({ error: '登录会话已过期，请重新登录' });
  }
}

/**
 * 强制身份验证中间件 (针对 HTML 页面访问)
 */
export async function requireHtmlAuth(req, res, next) {
  if (process.env.AUTH_BYPASS === 'true') {
    req.user = { id: 'dev_user', username: 'dev_tester', avatar: '' };
    return next();
  }
  const token = extractToken(req);

  // 禁用 HTML 页面和重定向的缓存，防止 CDN 缓存导致无限重定向
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (!token) {
    return res.redirect('/login.html');
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = getUser(decoded.id);
    if (!user) {
      res.clearCookie('naruto_token');
      return res.redirect('/login.html');
    }

    req.user = user;
    next();
  } catch (err) {
    res.clearCookie('naruto_token');
    return res.redirect('/login.html?error=session_expired');
  }
}

/**
 * 可选身份验证中间件 (不拦截请求，仅解析用户信息)
 */
export async function optionalAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = getUser(decoded.id);
    if (user) {
      req.user = user;
    }
  } catch (err) {
    // 忽略错误，继续传递请求
  }
  next();
}
