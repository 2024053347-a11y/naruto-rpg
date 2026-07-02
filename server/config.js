import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 确保读取项目根目录的 .env 文件
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI,
    requiredGuildId: process.env.DISCORD_REQUIRED_GUILD_ID
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'naruto-rpg-dev-only-not-for-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  saves: {
    maxSlots: parseInt(process.env.MAX_SAVE_SLOTS || '1', 10),
    maxSizeMb: parseInt(process.env.MAX_SAVE_SIZE_MB || '200', 10)
  },
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true',
    url: process.env.PROXY_URL || ''
  }
};

// 验证关键配置是否存在
if (config.nodeEnv === 'production') {
  const missing = [];
  if (!config.discord.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!config.discord.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!config.discord.redirectUri) missing.push('DISCORD_REDIRECT_URI');
  if (!config.discord.requiredGuildId) missing.push('DISCORD_REQUIRED_GUILD_ID');
  if (config.jwt.secret === 'naruto-rpg-default-secret-key-12345') missing.push('JWT_SECRET (using default)');

  if (missing.length > 0) {
    console.warn(`[WARNING] Production mode configuration check failed! Missing keys: ${missing.join(', ')}`);
  }
}
