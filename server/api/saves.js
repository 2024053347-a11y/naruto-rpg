import { Router, json } from 'express';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import * as db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

// 存档可达数百 MB，同步 gzip 会长时间冻结事件循环，故使用异步版本
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const router = Router();

// 所有存档路由均需要经过身份验证
router.use(requireAuth);
// 大请求体只在认证通过后解析，且与业务层存档上限保持一致
router.use(json({ limit: `${config.saves.maxSizeMb + 1}mb` }));

// 路径参数安全校验：只允许 UUID 和字母数字+连字符格式
function validateSaveId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 64 && !id.includes('..');
}

/**
 * GET /api/saves - 获取当前用户的所有存档元数据列表
 */
router.get('/', async (req, res) => {
  try {
    const saves = await db.getUserSaves(req.user.id);
    res.json(saves);
  } catch (err) {
    console.error('[API SAVES] Get list error:', err);
    res.status(500).json({ error: '获取存档列表失败' });
  }
});

/**
 * GET /api/saves/:id - 下载指定存档的完整数据
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateSaveId(id)) return res.status(400).json({ error: '无效的存档 ID' });
  try {
    const save = await db.getSaveById(id);
    if (!save) {
      return res.status(404).json({ error: '未找到指定存档' });
    }
    // 权限校验：存档必须属于当前登录用户
    if (save.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权访问此存档' });
    }

    // 从 gzip 压缩的二进制 BLOB 数据解压
    const decompressed = (await gunzip(save.save_data)).toString('utf8');
    const saveData = JSON.parse(decompressed);

    res.json({
      id: save.id,
      slot_name: save.slot_name,
      preview_data: save.preview_data,
      save_data: saveData,
      created_at: save.created_at,
      updated_at: save.updated_at
    });
  } catch (err) {
    console.error('[API SAVES] Download save error:', err);
    res.status(500).json({ error: '读取并解压存档失败' });
  }
});

/**
 * POST /api/saves - 新增云端存档
 */
router.post('/', async (req, res) => {
  const { slot_name, save_data, preview_data } = req.body;
  const userId = req.user.id;

  if (typeof slot_name !== 'string' || !slot_name.trim()) {
    return res.status(400).json({ error: '存档名称必须为非空字符串' });
  }
  if (save_data == null || typeof save_data !== 'object') {
    return res.status(400).json({ error: '存档数据必须为 JSON 对象或数组' });
  }

  try {
    // 1. 检查槽位数量限制
    const currentCount = await db.getUserSaveCount(userId);
    if (currentCount >= config.saves.maxSlots) {
      return res.status(400).json({ error: `云存档已满！每个用户最多允许创建 ${config.saves.maxSlots} 个存档。请先删除部分旧存档。` });
    }

    // 2. 检查存档大小限制
    const jsonString = JSON.stringify(save_data);
    const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
    const maxSizeBytes = config.saves.maxSizeMb * 1024 * 1024;

    if (sizeBytes > maxSizeBytes) {
      return res.status(400).json({ error: `存档过大！最大允许 ${config.saves.maxSizeMb}MB，当前为 ${(sizeBytes / 1024 / 1024).toFixed(2)}MB` });
    }

    // 3. gzip 压缩存档内容
    const compressedData = await gzip(jsonString);

    // 4. 生成唯一 ID 并存入数据库
    const saveId = randomUUID();
    const normalizedSlotName = slot_name.trim().substring(0, 50);
    await db.insertSave({
      id: saveId,
      user_id: userId,
      slot_name: normalizedSlotName,
      preview_data: preview_data || {},
      save_data: compressedData,
      size_bytes: sizeBytes
    });

    console.log(`[API SAVES] User ${req.user.username} created new save: ${slot_name} (${saveId})`);
    res.status(201).json({
      id: saveId,
      slot_name: normalizedSlotName,
      message: '存档成功保存至云端'
    });
  } catch (err) {
    console.error('[API SAVES] Create save error:', err);
    res.status(500).json({ error: '保存存档到云端失败' });
  }
});

/**
 * PUT /api/saves/:id - 覆盖/更新指定存档
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateSaveId(id)) return res.status(400).json({ error: '无效的存档 ID' });
  const { slot_name, save_data, preview_data } = req.body;
  const userId = req.user.id;

  if (slot_name !== undefined && (typeof slot_name !== 'string' || !slot_name.trim())) {
    return res.status(400).json({ error: '存档名称必须为非空字符串' });
  }
  if (save_data !== undefined && (save_data == null || typeof save_data !== 'object')) {
    return res.status(400).json({ error: '存档数据必须为 JSON 对象或数组' });
  }

  try {
    // 权限校验只需元数据，避免为此读入整个存档正文
    const save = await db.getSaveMetaById(id);
    if (!save) {
      return res.status(404).json({ error: '未找到指定存档' });
    }
    // 权限验证
    if (save.user_id !== userId) {
      return res.status(403).json({ error: '无权操作此存档' });
    }

    const updates = {};

    if (slot_name !== undefined) {
      updates.slot_name = slot_name.trim().substring(0, 50);
    }
    if (preview_data !== undefined) {
      updates.preview_data = preview_data;
    }
    if (save_data !== undefined) {
      // 检查存档大小限制
      const jsonString = JSON.stringify(save_data);
      const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
      const maxSizeBytes = config.saves.maxSizeMb * 1024 * 1024;

      if (sizeBytes > maxSizeBytes) {
        return res.status(400).json({ error: `存档过大！最大允许 ${config.saves.maxSizeMb}MB` });
      }

      updates.save_data = await gzip(jsonString);
      updates.size_bytes = sizeBytes;
    }

    await db.updateSave(id, updates);
    console.log(`[API SAVES] User ${req.user.username} updated save ${id}`);
    res.json({ id, message: '云存档已成功覆盖更新' });
  } catch (err) {
    console.error('[API SAVES] Update save error:', err);
    res.status(500).json({ error: '更新云存档失败' });
  }
});

/**
 * DELETE /api/saves/:id - 删除存档
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (!validateSaveId(id)) return res.status(400).json({ error: '无效的存档 ID' });
  const userId = req.user.id;

  try {
    // 权限校验只需元数据，避免为此读入整个存档正文
    const save = await db.getSaveMetaById(id);
    if (!save) {
      return res.status(404).json({ error: '未找到指定存档' });
    }
    // 权限验证
    if (save.user_id !== userId) {
      return res.status(403).json({ error: '无权删除此存档' });
    }

    await db.deleteSave(id);
    console.log(`[API SAVES] User ${req.user.username} deleted save ${id}`);
    res.json({ message: '云存档已成功删除' });
  } catch (err) {
    console.error('[API SAVES] Delete save error:', err);
    res.status(500).json({ error: '删除云存档失败' });
  }
});

export default router;
