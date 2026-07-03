import { Router } from 'express';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import * as db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

// 存档可达数百 MB，同步 gzip 会长时间阻塞事件循环，必须使用异步版本
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

const MAX_SLOT_NAME_LENGTH = 50;
const MAX_SAVE_SIZE_BYTES = config.saves.maxSizeMb * 1024 * 1024;

const router = Router();

// 所有存档路由均需要经过身份验证
router.use(requireAuth);

/**
 * 路径参数安全校验：只允许字母数字、下划线、连字符（覆盖 UUID），防路径穿越。
 * @param {unknown} id
 * @returns {boolean}
 */
function isValidSaveId(id) {
  return typeof id === 'string' && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * 序列化并压缩存档正文；超出体积上限时不做无谓压缩。
 * @param {object} saveData
 * @returns {Promise<{sizeBytes: number, compressed: Buffer | null}>} 超限时 compressed 为 null
 */
async function compressSavePayload(saveData) {
  const jsonString = JSON.stringify(saveData);
  const sizeBytes = Buffer.byteLength(jsonString, 'utf8');
  if (sizeBytes > MAX_SAVE_SIZE_BYTES) {
    return { sizeBytes, compressed: null };
  }
  return { sizeBytes, compressed: await gzipAsync(jsonString) };
}

/**
 * 读取存档并做归属校验的公共前置逻辑。
 * @param {string} id
 * @param {string} userId
 * @param {string} forbiddenMessage 非本人存档时的 403 文案（各路由历史文案不同，需保留）
 * @returns {Promise<{save?: object, errorStatus?: number, errorBody?: {error: string}}>}
 */
async function findOwnedSave(id, userId, forbiddenMessage) {
  const save = await db.getSaveById(id);
  if (!save) {
    return { errorStatus: 404, errorBody: { error: '未找到指定存档' } };
  }
  if (save.user_id !== userId) {
    return { errorStatus: 403, errorBody: { error: forbiddenMessage } };
  }
  return { save };
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
  if (!isValidSaveId(id)) return res.status(400).json({ error: '无效的存档 ID' });

  try {
    const { save, errorStatus, errorBody } = await findOwnedSave(id, req.user.id, '无权访问此存档');
    if (!save) return res.status(errorStatus).json(errorBody);

    // 存档正文以 gzip 压缩的二进制 BLOB 落盘，此处解压还原为 JSON
    const decompressed = await gunzipAsync(save.save_data);
    const saveData = JSON.parse(decompressed.toString('utf8'));

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

  if (!slot_name || !save_data) {
    return res.status(400).json({ error: '缺少存档名称或存档数据' });
  }

  try {
    // 1. 检查槽位数量限制
    const currentCount = await db.getUserSaveCount(userId);
    if (currentCount >= config.saves.maxSlots) {
      return res.status(400).json({ error: `云存档已满！每个用户最多允许创建 ${config.saves.maxSlots} 个存档。请先删除部分旧存档。` });
    }

    // 2. 检查体积并压缩
    const { sizeBytes, compressed } = await compressSavePayload(save_data);
    if (!compressed) {
      return res.status(400).json({ error: `存档过大！最大允许 ${config.saves.maxSizeMb}MB，当前为 ${(sizeBytes / 1024 / 1024).toFixed(2)}MB` });
    }

    // 3. 生成唯一 ID 并落库
    const saveId = randomUUID();
    await db.insertSave({
      id: saveId,
      user_id: userId,
      slot_name: slot_name.substring(0, MAX_SLOT_NAME_LENGTH),
      preview_data: preview_data || {},
      save_data: compressed,
      size_bytes: sizeBytes
    });

    console.log(`[API SAVES] User ${req.user.username} created new save: ${slot_name} (${saveId})`);
    res.status(201).json({
      id: saveId,
      slot_name,
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
  if (!isValidSaveId(id)) return res.status(400).json({ error: '无效的存档 ID' });
  const { slot_name, save_data, preview_data } = req.body;

  try {
    const { save, errorStatus, errorBody } = await findOwnedSave(id, req.user.id, '无权操作此存档');
    if (!save) return res.status(errorStatus).json(errorBody);

    const updates = {};
    if (slot_name !== undefined) {
      updates.slot_name = slot_name.substring(0, MAX_SLOT_NAME_LENGTH);
    }
    if (preview_data !== undefined) {
      updates.preview_data = preview_data;
    }
    if (save_data !== undefined) {
      const { sizeBytes, compressed } = await compressSavePayload(save_data);
      if (!compressed) {
        return res.status(400).json({ error: `存档过大！最大允许 ${config.saves.maxSizeMb}MB` });
      }
      updates.save_data = compressed;
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
  if (!isValidSaveId(id)) return res.status(400).json({ error: '无效的存档 ID' });

  try {
    const { save, errorStatus, errorBody } = await findOwnedSave(id, req.user.id, '无权删除此存档');
    if (!save) return res.status(errorStatus).json(errorBody);

    await db.deleteSave(id);
    console.log(`[API SAVES] User ${req.user.username} deleted save ${id}`);
    res.json({ message: '云存档已成功删除' });
  } catch (err) {
    console.error('[API SAVES] Delete save error:', err);
    res.status(500).json({ error: '删除云存档失败' });
  }
});

export default router;
