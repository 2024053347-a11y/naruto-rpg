import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { upsertUser } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

// Discord API 代理：将 discord.com 请求转发到 Cloudflare Worker
const discordFetch = async (url, options = {}) => {
  if (config.proxy?.enabled && config.proxy.url) {
    url = url.replace('https://discord.com', config.proxy.url);
  }
  return fetch(url, options);
};

const router = Router();

/**
 * GET /auth/discord - 发起 Discord 授权重定向
 */
router.get('/discord', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  
  // 将 state 存入 Cookie 以进行 CSRF 验证（有效时间 10 分钟）
  res.cookie('discord_oauth_state', state, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000
  });

  const authorizeUrl = `https://discord.com/api/oauth2/authorize?` + new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: config.discord.redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state: state
  }).toString();

  res.redirect(authorizeUrl);
});

/**
 * GET /auth/discord/callback - 处理 Discord 回调
 */
router.get('/discord/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('[DISCORD CALLBACK] OAuth error:', error, error_description);
    return res.redirect(`/login.html?error=access_denied&desc=${encodeURIComponent(error_description || '')}`);
  }

  // 1. 验证 state 防范 CSRF 攻击
  const savedState = req.cookies.discord_oauth_state;
  res.clearCookie('discord_oauth_state');

  if (!state || state !== savedState) {
    console.error('[DISCORD CALLBACK] State mismatch error.');
    console.error(`  -> Query state: ${state}`);
    console.error(`  -> Cookie state: ${savedState}`);
    console.error(`  -> All cookies:`, req.cookies);
    return res.redirect('/login.html?error=csrf_error');
  }

  if (!code) {
    return res.redirect('/login.html?error=missing_code');
  }

  try {
    // 2. 用 code 换取 access_token
    const tokenResponse = await discordFetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: config.discord.redirectUri
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error('[DISCORD CALLBACK] Failed to exchange code for token:', errBody);
      return res.redirect('/login.html?error=auth_failed');
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;

    // 3. 获取 Discord 用户个人资料
    const userResponse = await discordFetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      console.error('[DISCORD CALLBACK] Failed to fetch user profile');
      return res.redirect('/login.html?error=fetch_profile_failed');
    }

    const discordUser = await userResponse.json();

    // 4. 获取 Discord 用户的服务器（Guilds）列表
    const guildsResponse = await discordFetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!guildsResponse.ok) {
      console.error('[DISCORD CALLBACK] Failed to fetch user guilds');
      return res.redirect('/login.html?error=fetch_guilds_failed');
    }

    const guilds = await guildsResponse.json();

    // 5. 校验用户是否属于指定的服务器群组之一 (逗号分隔，满足其一即可；未配置或为占位符时跳过校验)
    const rawGuildId = config.discord.requiredGuildId;
    const isBypass = !rawGuildId || rawGuildId === 'your_discord_server_id_here' || rawGuildId === 'your-discord-server-id';
    
    let isMember = isBypass;
    if (!isBypass) {
      const targetGuildIds = rawGuildId.split(',').map(id => id.trim()).filter(Boolean);
      isMember = guilds.some(guild => targetGuildIds.includes(guild.id));
    }

    if (!isMember) {
      console.log(`[DISCORD CALLBACK] User ${discordUser.username} (${discordUser.id}) was rejected. Not a member of required guilds: ${rawGuildId}`);
      return res.redirect('/login.html?error=not_in_guild');
    }

    // 6. 验证成功，保存/更新用户到 SQLite
    upsertUser({
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      global_name: discordUser.global_name
    });

    // 7. 签发 JWT
    const token = jwt.sign(
      { id: discordUser.id, username: discordUser.username },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // 8. 将 JWT 写入 HttpOnly Cookie
    res.cookie('naruto_token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 天
    });

    console.log(`[DISCORD CALLBACK] User ${discordUser.username} logged in successfully.`);
    return res.redirect('/');
  } catch (err) {
    console.error('[DISCORD CALLBACK] Internal error during login callback:', err);
    return res.redirect('/login.html?error=server_error');
  }
});

/**
 * GET /auth/me - 获取当前登录用户信息
 */
router.get('/me', requireAuth, (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    avatar: user.avatar,
    global_name: user.global_name
  });
});

/**
 * POST /auth/logout - 注销登录
 */
router.post('/logout', (req, res) => {
  res.clearCookie('naruto_token', { path: '/' });
  res.json({ success: true, message: '已成功注销登录' });
});

export default router;
