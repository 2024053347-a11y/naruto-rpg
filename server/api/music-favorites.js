import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as db from '../db/index.js';

const router = Router();
router.use(requireAuth);

async function listFavorites(req, res) {
  try {
    const favs = await db.getUserFavorites(req.user.id);
    res.json({ count: favs.length, favorites: favs });
  } catch (err) {
    console.error('[API Music] GET favorites error:', err);
    res.status(500).json({ error: '获取收藏失败' });
  }
}

async function replaceFavorites(req, res) {
  try {
    const { favorites } = req.body;
    if (!Array.isArray(favorites)) {
      return res.status(400).json({ error: 'favorites 必须为数组' });
    }
    await db.saveUserFavorites(req.user.id, favorites);
    const favs = await db.getUserFavorites(req.user.id);
    res.json({ message: '收藏已同步', count: favs.length });
  } catch (err) {
    console.error('[API Music] PUT favorites error:', err);
    res.status(500).json({ error: '同步收藏失败' });
  }
}

async function addFavorite(req, res) {
  try {
    const { song } = req.body;
    if (!song || !(song.url_id || song.mid || song.id)) {
      return res.status(400).json({ error: '缺少歌曲信息' });
    }
    const favs = await db.addUserFavorite(req.user.id, song);
    res.json({ message: '已添加到收藏', count: favs.length });
  } catch (err) {
    console.error('[API Music] POST favorite error:', err);
    res.status(500).json({ error: '添加收藏失败' });
  }
}

async function removeFavorite(req, res) {
  try {
    const favs = await db.removeUserFavorite(req.user.id, req.params.songId);
    res.json({ message: '已从收藏移除', count: favs.length });
  } catch (err) {
    console.error('[API Music] DELETE favorite error:', err);
    res.status(500).json({ error: '移除收藏失败' });
  }
}

// `/favorites` 是已发布前端使用的路径；根路径保留给旧版客户端。
router.get(['/', '/favorites'], listFavorites);
router.put(['/', '/favorites'], replaceFavorites);
router.post(['/', '/favorites'], addFavorite);
router.delete(['/:songId', '/favorites/:songId'], removeFavorite);

export default router;
