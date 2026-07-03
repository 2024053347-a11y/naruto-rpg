import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 确保读取项目根目录的 .env 文件
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

/** 开发兜底密钥：生产环境使用它意味着 JWT 可被任何人伪造，配置校验会点名告警 */
const DEV_FALLBACK_JWT_SECRET = 'naruto-rpg-dev-only-not-for-production';

/**
 * 环境变量安全取整：空值、非数字（NaN）一律回退到默认值。
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

/** 应用全局配置（deepFreeze 防止运行期被意外篡改） */
export const config = deepFreeze({
  port: toPositiveInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
    requiredGuildId: process.env.DISCORD_REQUIRED_GUILD_ID
  },
  jwt: {
    secret: process.env.JWT_SECRET || DEV_FALLBACK_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  saves: {
    maxSlots: toPositiveInt(process.env.MAX_SAVE_SLOTS, 1),
    maxSizeMb: toPositiveInt(process.env.MAX_SAVE_SIZE_MB, 200)
  },
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true',
    url: process.env.PROXY_URL || ''
  }
});

/**
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

// 生产环境配置完整性检查（保持旧行为：告警但不中断启动，避免影响既有部署流程）
if (config.nodeEnv === 'production') {
  const missing = [];
  if (!config.discord.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.discord.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!config.discord.redirectUri) missing.push('DISCORD_REDIRECT_URI');
  if (!config.discord.requiredGuildId) missing.push('DISCORD_REQUIRED_GUILD_ID');
  if (config.jwt.secret === DEV_FALLBACK_JWT_SECRET) missing.push('JWT_SECRET (using default)');

  if (missing.length > 0) {
    console.warn(`[WARNING] Production mode configuration check failed! Missing keys: ${missing.join(', ')}`);
  }
}
