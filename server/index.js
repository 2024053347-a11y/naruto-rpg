import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { initDb } from './db/index.js';
import authRouter from './auth/discord.js';
import savesRouter from './api/saves.js';
import aiProxyRouter from './api/ai-proxy.js';
import musicFavoritesRouter from './api/music-favorites.js';
import { requireHtmlAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');

/** 速率限制统一窗口：1 分钟 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
/** JSON body 上限：超大存档直接以 JSON 上传（历史决策，见 v2.1_server_update_guide.md） */
const JSON_BODY_LIMIT = '200mb';
/** 优雅停机的强制退出兜底时间 */
const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

/**
 * @param {number} max 窗口内允许的最大请求数
 * @param {string} message 触发限流时返回的文案
 */
function createRateLimiter(max, message) {
  return rateLimit({ windowMs: RATE_LIMIT_WINDOW_MS, max, message: { error: message } });
}

const app = express();
app.set('trust proxy', 1); // 允许 Nginx 反向代理正确识别客户端 IP 和 HTTPS 协议

// 1. 安全与性能中间件配置
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: [
        "'self'",
        "data:",
        "https://cdn.discordapp.com",
        "https://i.postimg.cc",
        "https://api.vkeys.cn"
      ],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https:", "wss:"],
      mediaSrc: ["'self'", "https:", "http:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // Superconductor preview is embedded in an authenticated iframe during development.
      frameAncestors: ["'self'", "https://discord.com", "https://superconductor.com", "https://*.superconductor.com"]
    }
  },
  crossOriginEmbedderPolicy: false, // 允许加载跨域图片/音乐资源
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // CSP frame-ancestors controls embedding; X-Frame-Options cannot allow Superconductor.
  xFrameOptions: false
}));

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: JSON_BODY_LIMIT }));

// 2. 速率限制中间件 (防暴破/恶意请求)
const authLimiter = createRateLimiter(15, '请求过于频繁，请稍后再试');
const apiLimiter = createRateLimiter(120, '请求已触发限流，请稍后');
// 注意：原实现声明过 staticLimiter(600/min) 但从未挂载，静态资源实际不限流；
// 为保持行为 100% 一致此处未启用，如需限流请显式挂到 express.static 之前。

// 3. 路由挂载
app.use('/auth', authLimiter, authRouter);
app.use('/api/saves', apiLimiter, savesRouter);
app.use('/api/ai-proxy', apiLimiter, aiProxyRouter);
app.use('/api/music', apiLimiter, musicFavoritesRouter);

// 4. 网页认证入口拦截
// 玩家在请求根路径 / 或 index.html 时，必须通过身份验证，否则重定向到登录页面
app.get(['/', '/index.html'], requireHtmlAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 5. 静态文件托管
// index: false 禁止自动返回 index.html，全部由上面的路由守卫拦截处理
app.use(express.static(publicDir, { index: false }));

// 6. 未匹配的 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '资源未找到' });
});

// 7. 全局错误捕获中间件 — 区分客户端错误与服务端错误，且不泄露内部细节
app.use((err, req, res, next) => {
  // body-parser 抛出的可预期客户端错误：给出准确的 4xx 语义而非笼统 500
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `请求体过大，最大允许 ${JSON_BODY_LIMIT}` });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是有效的 JSON' });
  }

  console.error('[SERVER ERROR]', err.stack || err.message || err);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
});

// 8. 启动服务（先完成数据库初始化，再开始接受请求）
try {
  await initDb();
} catch (err) {
  console.error('[FATAL] Database initialization failed:', err);
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`===============================================`);
  console.log(`  忍者手记 RPG 服务器已启动`);
  console.log(`  运行环境: ${config.nodeEnv}`);
  console.log(`  监听端口: http://localhost:${config.port}`);
  console.log(`===============================================`);
});

server.on('error', (err) => {
  console.error('[FATAL] Server failed to start:', err);
  process.exit(1);
});

// 9. 优雅停机：停止接收新连接，处理完存量请求后退出；超时则强制退出
function shutdown(signal) {
  console.log(`[SERVER] Received ${signal}, shutting down gracefully...`);
  server.close(() => process.exit(0));
  setTimeout(() => {
    console.error('[SERVER] Forced exit after shutdown timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
