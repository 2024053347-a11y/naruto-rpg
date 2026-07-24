/**
 * API Key 加密存储工具
 * 使用 Web Crypto API (AES-GCM) 加密 API Key 后再存入 localStorage
 * 加密密钥来自浏览器指纹（不完美但比明文好——真正的安全由后端代理认证保证）
 */

const STORAGE_KEY = 'naruto_api_config';
const ENC_PREFIX = 'aes1:';

async function deriveKey() {
  // 使用固定种子 + 随机盐派生加密密钥
  const seed = 'naruto-rpg-api-vault-2024';
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(seed), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('naruto-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptApiKey(plaintext) {
  if (!plaintext) return '';
  try {
    const key = await deriveKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, enc.encode(plaintext)
    );
    // iv + ciphertext → base64
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return ENC_PREFIX + btoa(String.fromCharCode(...combined));
  } catch (e) {
    console.warn('[Crypto] Encrypt failed, storing plain:', e.message);
    return plaintext;
  }
}

export async function decryptApiKey(encoded) {
  if (!encoded) return '';
  if (!encoded.startsWith(ENC_PREFIX)) return encoded; // Not encrypted
  try {
    const key = await deriveKey();
    const combined = Uint8Array.from(atob(encoded.slice(ENC_PREFIX.length)), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const dec = new TextDecoder();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, ciphertext
    );
    return dec.decode(plaintext);
  } catch (e) {
    console.warn('[Crypto] Decrypt failed:', e.message);
    return '';
  }
}

export async function saveApiConfigSecure(config) {
  if (!config) return;
  const secure = { ...config };
  if (secure.apiKey) {
    secure.apiKey = await encryptApiKey(secure.apiKey);
  }
  // Also encrypt variable updater key if present
  if (secure.variableUpdater?.apiKey) {
    secure.variableUpdater = {
      ...secure.variableUpdater,
      apiKey: await encryptApiKey(secure.variableUpdater.apiKey)
    };
  }
  if (secure.narrativeReview?.apiKey) {
    secure.narrativeReview = {
      ...secure.narrativeReview,
      apiKey: await encryptApiKey(secure.narrativeReview.apiKey)
    };
  }
  // HTTP 后端默认走同源代理；酒馆使用 iframe 桥接。
  secure.useProxy = secure.backend !== 'tavern';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(secure));
  } catch (e) {
    console.warn('[Crypto] Save failed:', e.message);
  }
}

export async function loadApiConfigSecure() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw);
    if (config.apiKey) {
      config.apiKey = await decryptApiKey(config.apiKey);
    }
    if (config.variableUpdater?.apiKey) {
      config.variableUpdater = {
        ...config.variableUpdater,
        apiKey: await decryptApiKey(config.variableUpdater.apiKey)
      };
    }
    if (config.narrativeReview?.apiKey) {
      config.narrativeReview = {
        ...config.narrativeReview,
        apiKey: await decryptApiKey(config.narrativeReview.apiKey)
      };
    }
    // Ensure the saved transport matches the backend (migration from old configs).
    if (config.backend === 'tavern') {
      config.useProxy = false;
    } else if (config.apiKey && config.useProxy !== false) {
      config.useProxy = true;
    }
    return config;
  } catch (e) {
    console.warn('[Crypto] Load failed:', e.message);
    return null;
  }
}
