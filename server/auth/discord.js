import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { upsertUser } from '../db/index.js';
import { requireAuth, AUTH_COOKIE_NAME } from '../middleware/auth.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
// 授权页是面向浏览器的入口，Discord 官方文档采用不带版本号的路径
const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const STATE_COOKIE_NAME = 'discord_oauth_state';
const STATE_COOKIE_TTL_MS = 10 * 60 * 1000; // CSRF state 有效期 10 分钟
const SESSION_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 会话 Cookie 7 天，与 JWT 默认时长对齐

/** 历史配置模板中的占位符：出现时视为「未配置群组校验」而非真实群组 ID */
const GUILD_ID_PLACEHOLDERS = ['your_discord_server_id_here', 'your-discord-server-id'];

/**
 * OAuth 流程中可预期的失败：携带登录页错误码，由回调统一转换为重定向。
 * 非本类错误一律按未知异常处理（server_error），避免细节泄露。
 */
class OAuthFlowError extends Error {
  /**
   * @param {string} redirectCode login.html?error= 的取值
   * @param {string} logMessage 服务端日志内容
   */
  constructor(redirectCode, logMessage) {
    super(logMessage);
    this.name = 'OAuthFlowError';
    this.redirectCode = redirectCode;
  }
}

/**
 * Discord API 请求：启用代理时将 discord.com 流量改写到 Cloudflare Worker。
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
function discordFetch(url, options = {}) {
  if (config.proxy?.enabled && config.proxy.url) {
    url = url.replace('https://discord.com', config.proxy.url);
  }
  return fetch(url, options);
}

/**
 * 认证相关 Cookie 的公共安全属性。
 * secure 需同时满足生产环境与 HTTPS 请求（trust proxy 已启用，req.secure 可信）。
 * @param {import('express').Request} req
 */
function baseCookieOptions(req) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production' && req.secure,
    sameSite: 'lax',
    path: '/'
  };
}

/**
 * 用授权码交换 access_token。
 * @param {string} code
 * @returns {Promise<string>} access_token
 */
async function exchangeCodeForToken(code) {
  const response = await discordFetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.discord.redirectUri
    }).toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new OAuthFlowError('auth_failed', `Failed to exchange code for token: ${errorBody}`);
  }
  const tokens = await response.json();
  return tokens.access_token;
}

/**
 * 获取 Discord 用户个人资料。
 * @param {string} accessToken
 * @returns {Promise<{id: string, username: string, discriminator?: string, avatar?: string, global_name?: string}>}
 */
async function fetchDiscordProfile(accessToken) {
  const response = await discordFetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new OAuthFlowError('fetch_profile_failed', 'Failed to fetch user profile');
  }
  return response.json();
}

/**
 * 获取用户所在的服务器（Guild）列表。
 * @param {string} accessToken
 * @returns {Promise<Array<{id: string}>>}
 */
async function fetchUserGuilds(accessToken) {
  const response = await discordFetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new OAuthFlowError('fetch_guilds_failed', 'Failed to fetch user guilds');
  }
  return response.json();
}

/**
 * 校验用户是否属于配置要求的服务器群组之一。
 * 配置为空或为模板占位符时跳过校验（本地/开源部署场景）。
 * @param {{id: string, username: string}} discordUser
 * @param {Array<{id: string}>} guilds
 */
function ensureGuildMembership(discordUser, guilds) {
  const rawGuildId = config.discord.requiredGuildId;
  if (!rawGuildId || GUILD_ID_PLACEHOLDERS.includes(rawGuildId)) return;

  // 逗号分隔多个群组 ID，满足其一即可
  const targetGuildIds = rawGuildId.split(',').map((id) => id.trim()).filter(Boolean);
  const isMember = guilds.some((guild) => targetGuildIds.includes(guild.id));
  if (!isMember) {
    throw new OAuthFlowError(
      'not_in_guild',
      `User ${discordUser.username} (${discordUser.id}) was rejected. Not a member of required guilds: ${rawGuildId}`
    );
  }
}

/**
 * 签发会话 JWT 并写入 HttpOnly Cookie。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{id: string, username: string}} discordUser
 */
function issueSessionCookie(req, res, discordUser) {
  const token = jwt.sign(
    { id: discordUser.id, username: discordUser.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  res.cookie(AUTH_COOKIE_NAME, token, { ...baseCookieOptions(req), maxAge: SESSION_COOKIE_TTL_MS });
}

const router = Router();

/**
 * GET /auth/discord - 发起 Discord 授权重定向
 */
router.get('/discord', (req, res) => {
  // 随机 state 存入 Cookie，回调时比对以防范 CSRF
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE_NAME, state, { ...baseCookieOptions(req), maxAge: STATE_COOKIE_TTL_MS });

  const authorizeUrl = `${DISCORD_AUTHORIZE_URL}?` + new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state
  }).toString();

  res.redirect(authorizeUrl);
});

/**
 * GET /auth/discord/callback - 处理 Discord 回调
 * 流程：state 校验 → 换取令牌 → 拉取档案/群组 → 群组准入 → 落库 → 签发会话
 */
router.get('/discord/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[DISCORD CALLBACK] OAuth error:', error, error_description);
    return res.redirect(`/login.html?error=access_denied&desc=${encodeURIComponent(error_description || '')}`);
  }

  // 1. 验证 state 防范 CSRF 攻击（state Cookie 一次性使用，无论成败先清除）
  const savedState = req.cookies[STATE_COOKIE_NAME];
  res.clearCookie(STATE_COOKIE_NAME);

  if (!state || state !== savedState) {
    console.error('[DISCORD CALLBACK] State mismatch error.');
    console.error(`  -> Query state: ${state}`);
    console.error(`  -> Cookie state: ${savedState}`);
    return res.redirect('/login.html?error=csrf_error');
  }

  if (!code) {
    return res.redirect('/login.html?error=missing_code');
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordProfile(accessToken);
    const guilds = await fetchUserGuilds(accessToken);
    ensureGuildMembership(discordUser, guilds);

    await upsertUser({
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      global_name: discordUser.global_name
    });

    issueSessionCookie(req, res, discordUser);
    console.log(`[DISCORD CALLBACK] User ${discordUser.username} logged in successfully.`);
    return res.redirect('/');
  } catch (err) {
    if (err instanceof OAuthFlowError) {
      console.error(`[DISCORD CALLBACK] ${err.message}`);
      return res.redirect(`/login.html?error=${err.redirectCode}`);
    }
    console.error('[DISCORD CALLBACK] Internal error during login callback:', err);
    return res.redirect('/login.html?error=server_error');
  }
});

/**
 * GET /auth/me - 获取当前登录用户信息
 */
router.get('/me', requireAuth, (req, res) => {
  const { id, username, discriminator, avatar, global_name } = req.user;
  res.json({ id, username, discriminator, avatar, global_name });
});

/**
 * POST /auth/logout - 注销登录
 */
router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  res.json({ success: true, message: '已成功注销登录' });
});

export default router;
