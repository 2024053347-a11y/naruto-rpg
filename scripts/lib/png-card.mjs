// @ts-check
/**
 * PNG 角色卡（SillyTavern character card）元数据读写工具。
 *
 * 此前 CRC32 与 PNG chunk 解析/重组逻辑在 sync-to-card.cjs 与 watch-and-sync.mjs
 * 中各有一份手写拷贝（DRY 违例），现统一收敛于此。
 *
 * 设计约束：
 *  - 只操作 tEXt 块（角色卡元数据所在），绝不触碰 IDAT 等图像数据。
 *  - 替换 tEXt 值时只更新已存在的键，不新增块 —— 与历史行为一致，
 *    避免生成 SillyTavern 未预期的额外块。
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 每个 chunk 的固定开销：4 字节长度 + 4 字节类型 + 4 字节 CRC */
const CHUNK_OVERHEAD = 12;

/** @typedef {{ type: string, data: Buffer }} PngChunk */

/** 自定义错误类型，便于调用方区分“卡片文件损坏”与普通 IO 错误 */
export class PngCardError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PngCardError';
  }
}

/**
 * 标准 CRC-32（多项式 0xEDB88320），PNG 块校验和算法。
 * @param {Buffer} buf
 * @returns {number} 无符号 32 位校验和
 */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 将 PNG buffer 解析为块列表（丢弃原 CRC，序列化时统一重算）。
 * @param {Buffer} png
 * @returns {PngChunk[]}
 * @throws {PngCardError} 签名不合法或块长度越界（文件损坏/截断）
 */
export function parseChunks(png) {
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngCardError('不是合法的 PNG 文件（签名不匹配）');
  }
  /** @type {PngChunk[]} */
  const chunks = [];
  let pos = PNG_SIGNATURE.length;
  while (pos < png.length) {
    if (pos + CHUNK_OVERHEAD > png.length) {
      throw new PngCardError(`PNG 块结构越界（offset ${pos}），文件可能被截断`);
    }
    const length = png.readUInt32BE(pos);
    if (pos + CHUNK_OVERHEAD + length > png.length) {
      throw new PngCardError(`PNG 块数据越界（offset ${pos}, length ${length}），文件可能被截断`);
    }
    chunks.push({
      type: png.subarray(pos + 4, pos + 8).toString('ascii'),
      data: png.subarray(pos + 8, pos + 8 + length),
    });
    pos += CHUNK_OVERHEAD + length;
  }
  return chunks;
}

/**
 * 将块列表序列化回完整 PNG buffer，逐块重算 CRC。
 * @param {PngChunk[]} chunks
 * @returns {Buffer}
 */
export function serializeChunks(chunks) {
  const parts = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(chunk.data.length);
    const crcInput = Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput));
    parts.push(lengthBuf, Buffer.from(chunk.type, 'ascii'), chunk.data, crcBuf);
  }
  return Buffer.concat(parts);
}

/**
 * 读取所有 tEXt 键值对。值以 latin1 字符串返回 —— PNG tEXt 规范如此，
 * 且历史脚本正是以 latin1 读出后再做 base64 解码。
 * @param {Buffer} png
 * @returns {Record<string, string>}
 */
export function readTextChunks(png) {
  /** @type {Record<string, string>} */
  const texts = {};
  for (const chunk of parseChunks(png)) {
    if (chunk.type !== 'tEXt') continue;
    const nullIdx = chunk.data.indexOf(0);
    if (nullIdx < 0) continue; // 无键名分隔符的畸形块，跳过
    const key = chunk.data.subarray(0, nullIdx).toString('latin1');
    texts[key] = chunk.data.subarray(nullIdx + 1).toString('latin1');
  }
  return texts;
}

/**
 * 返回替换了指定 tEXt 键值的新 PNG buffer。
 * 只替换已存在的键（与旧 rebuildPNG 行为一致）；新值按 UTF-8 写入。
 * @param {Buffer} png
 * @param {Record<string, string>} updates 键 → 新值
 * @returns {Buffer}
 */
export function replaceTextChunks(png, updates) {
  const chunks = parseChunks(png).map((chunk) => {
    if (chunk.type !== 'tEXt') return chunk;
    const nullIdx = chunk.data.indexOf(0);
    if (nullIdx < 0) return chunk;
    const key = chunk.data.subarray(0, nullIdx).toString('latin1');
    if (updates[key] == null) return chunk;
    return {
      type: 'tEXt',
      data: Buffer.concat([
        Buffer.from(`${key}\0`, 'latin1'),
        Buffer.from(updates[key], 'utf-8'),
      ]),
    };
  });
  return serializeChunks(chunks);
}

/**
 * 解码 ccv3 tEXt 载荷为角色卡对象。
 * 兼容两种历史写法：优先按 base64 → UTF-8 → JSON 解析；
 * 失败则回退为直接 JSON 解析原文（旧卡片存在裸 JSON 的情况，防御性保留）。
 * @param {string} raw tEXt 中读出的 latin1 字符串
 * @returns {any} 角色卡对象
 * @throws {PngCardError} 两种方式都解不开
 */
export function decodeCardPayload(raw) {
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new PngCardError(`无法解码 ccv3 数据: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * 将角色卡对象编码为 ccv3 载荷（JSON 2 空格缩进 → base64），
 * 同时返回原文 JSON 供需要写 chara 块的调用方复用。
 * @param {any} card
 * @returns {{ base64: string, rawJson: string }}
 */
export function encodeCardPayload(card) {
  const rawJson = JSON.stringify(card, null, 2);
  return { base64: Buffer.from(rawJson, 'utf-8').toString('base64'), rawJson };
}
