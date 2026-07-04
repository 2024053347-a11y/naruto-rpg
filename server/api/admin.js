import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '../db');

// 简易管理员密钥（可通过 .env ADMIN_KEY 配置，不配置时默认密码）
const ADMIN_KEY = process.env.ADMIN_KEY || 'naruto-admin-2024';

const router = Router();

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key || req.cookies?.admin_key;
  if (key !== ADMIN_KEY) {
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
    const users = readJsonFile('users.json') || {};
    const saves = readJsonFile('saves_index.json') || {};
    const userList = Object.values(users);

    // 今日登录统计（读取 login_log.json）
    let loginLog = [];
    try { loginLog = readJsonFile('login_log.json') || []; } catch {}

    const todayLogins = loginLog.filter(l => l.date === today).length;
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    const yesterdayLogins = loginLog.filter(l => l.date === yesterday).length;

    const totalUsers = userList.length;
    const bannedUsers = userList.filter(u => u.banned).length;
    const totalSaves = Object.keys(saves).length;

    // 最近7天活跃
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
      last7Days.push({ date: d, count: loginLog.filter(l => l.date === d).length });
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
    const users = readJsonFile('users.json') || {};
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
    const users = readJsonFile('users.json') || {};

    if (!users[id]) return res.status(404).json({ error: '用户不存在' });

    users[id].banned = true;
    users[id].ban_reason = reason || '违反社区规则';
    users[id].banned_at = new Date().toISOString();
    writeJsonFile('users.json', users);

    res.json({ success: true, user: users[id] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/users/:id/unban - 解封用户
router.post('/users/:id/unban', async (req, res) => {
  try {
    const { id } = req.params;
    const users = readJsonFile('users.json') || {};

    if (!users[id]) return res.status(404).json({ error: '用户不存在' });

    delete users[id].banned;
    delete users[id].ban_reason;
    delete users[id].banned_at;
    writeJsonFile('users.json', users);

    res.json({ success: true, user: users[id] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
