import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getAllUsers, banUser, unbanUser } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '../db');

// 管理员密钥：必须通过 .env ADMIN_KEY 配置，未配置时管理面板整体禁用（无默认密码）
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const router = Router();

/** 常量时间比较：先做 sha256 归一化长度，避免 timingSafeEqual 因长度不同直接抛错/泄露长度信息 */
function safeKeyEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ error: '管理面板未启用：请在 .env 中配置 ADMIN_KEY' });
  }
  // 仅接受请求头传递密钥；query/cookie 会残留在访问日志与浏览器历史中
  const key = req.headers['x-admin-key'];
  if (!key || !safeKeyEqual(key, ADMIN_KEY)) {
    return res.status(403).json({ error: '管理员密钥无效' });
  }
  next();
}

router.use(requireAdmin);

// 读取/写入 JSON 数据库
function readJsonFile(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DB_DIR, filename), 'utf8'));
  } catch { return {}; }
}

function writeJsonFile(filename, data) {
  fs.writeFileSync(path.join(DB_DIR, filename), JSON.stringify(data, null, 2));
}

// GET /api/admin/stats - 概览统计
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // 读取所有数据
    const users = await getAllUsers();
    const saves = readJsonFile('saves_index.json') || {};
    const userList = Object.values(users);

    // 今日登录统计（读取 login_log.json）
    let loginLog = [];
    try { loginLog = readJsonFile('login_log.json') || []; } catch {}

    const todayLogins = new Set(loginLog.filter(l => l.date === today).map(l => l.id)).size;
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    const yesterdayLogins = new Set(loginLog.filter(l => l.date === yesterday).map(l => l.id)).size;

    const totalUsers = userList.length;
    const bannedUsers = userList.filter(u => u.banned).length;
    const totalSaves = Object.keys(saves).length;

    // 最近7天活跃（独立用户数）
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
      last7Days.push({ date: d, count: new Set(loginLog.filter(l => l.date === d).map(l => l.id)).size });
    }

    // 最近登录的用户
    const recentLogins = loginLog.slice(-20).reverse();

    res.json({
      totalUsers, bannedUsers, totalSaves,
      todayLogins, yesterdayLogins,
      last7Days, recentLogins
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users - 用户列表
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = (req.query.search || '').toLowerCase();

    let userList = Object.values(users);
    if (search) {
      userList = userList.filter(u =>
        (u.username || '').toLowerCase().includes(search) ||
        (u.id || '').toLowerCase().includes(search)
      );
    }

    const total = userList.length;
    const start = (page - 1) * limit;
    const items = userList.slice(start, start + limit).map(u => ({
      id: u.id,
      username: u.username,
      global_name: u.global_name,
      banned: !!u.banned,
      ban_reason: u.ban_reason || '',
      created_at: u.created_at,
      last_login: u.last_login
    }));

    res.json({ total, page, limit, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/ban - 封禁用户
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const user = await banUser(id, reason);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/unban - 解封用户
router.post('/users/:id/unban', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await unbanUser(id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
