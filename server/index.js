import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initDb } from './db/index.js';
import authRouter from './auth/discord.js';
import savesRouter from './api/saves.js';
import aiProxyRouter from './api/ai-proxy.js';
import musicFavoritesRouter from './api/music-favorites.js';
import { requireHtmlAuth } from './middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. 初始化数据库（ESM 顶层 await：持久层就绪前不接收任何请求）
await initDb();

const app = express();
app.set('trust proxy', 1); // 允许 Nginx 反向代理正确识别客户端 IP 和 HTTPS 协议

// 2. 安全与性能中间件配置
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
// JSON body 限制降至 5MB（单存档上限 10MB 走二进制流，不走 JSON body）- 现提升至 200MB 以支持超大存档
app.use(express.json({ limit: '200mb' }));

// 3. 速率限制中间件 (防暴破/恶意请求)
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 15,
  message: { error: '请求过于频繁，请稍后再试' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 120,
  message: { error: '请求已触发限流，请稍后' }
});

const staticLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  message: { error: '静态资源请求过于频繁' }
});

// 4. 路由挂载
app.use('/auth', authLimiter, authRouter);
app.use('/api/saves', apiLimiter, savesRouter);
app.use('/api/ai-proxy', apiLimiter, aiProxyRouter);
app.use('/api/music', apiLimiter, musicFavoritesRouter);

// 5. 网页认证入口拦截
// 玩家在请求根路径 / 或 index.html 时，必须通过身份验证，否则重定向到登录页面
app.get('/', requireHtmlAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/index.html', requireHtmlAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 6. 静态文件托管
// index: false 禁止自动返回 index.html，全部由上面的路由守卫拦截处理
app.use(express.static(path.join(__dirname, '../public'), { index: false }));

// 7. 未匹配的 404 处理
app.use((req, res) => {
  res.status(404).json({ error: '资源未找到' });
});

// 8. 全局错误捕获中间件 — 不泄露内部细节给客户端
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack || err.message || err);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
});

// 9. 启动服务
app.listen(config.port, () => {
  console.log(`===============================================`);
  console.log(`  忍者手记 RPG 服务器已启动`);
  console.log(`  运行环境: ${config.nodeEnv}`);
  console.log(`  监听端口: http://localhost:${config.port}`);
  console.log(`===============================================`);
});
