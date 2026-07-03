/**
 * png-card.mjs — SillyTavern 角色卡 PNG 的 tEXt 元数据编解码器
 *
 * 角色卡数据（ccv3/chara）以 base64 JSON 形式存放在 PNG 的 tEXt chunk 中。
 * 此前 sync-to-card 与 watch-and-sync 各自手抄了一份 chunk 解析 + CRC32
 * 实现（约 120 行重复代码）；现收敛为唯一实现，并补齐边界校验：
 * 非 PNG 文件、被截断的 chunk 都会抛出明确异常，而不是静默读出脏数据。
 */
import zlib from 'node:zlib';

/** PNG 文件签名（8 字节魔数） */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 每个 chunk 的定长开销：4B length + 4B type + 4B CRC */
const CHUNK_OVERHEAD = 12;

/**
 * @typedef {object} PngChunk
 * @property {string} type  4 字符 chunk 类型（如 'tEXt'、'IDAT'）
 * @property {Buffer} data  chunk 负载
 * @property {Buffer} crc   原始 4 字节 CRC（数据未变时原样保留）
 */

/**
 * 将 PNG buffer 解析为 chunk 列表。
 * @param {Buffer} buffer
 * @returns {PngChunk[]}
 * @throws {Error} 非 PNG 签名或 chunk 越界（文件损坏/被截断）时抛出
 */
export function parseChunks(buffer) {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是有效的 PNG 文件（签名不匹配）');
  }

  const chunks = [];
  let pos = PNG_SIGNATURE.length;

  while (pos < buffer.length) {
    if (pos + 8 > buffer.length) {
      throw new Error(`PNG chunk 头越界（offset=${pos}），文件可能已损坏`);
    }
    const length = buffer.readUInt32BE(pos);
    const end = pos + CHUNK_OVERHEAD + length;
    if (end > buffer.length) {
      throw new Error(`PNG chunk 数据越界（offset=${pos}, length=${length}），文件可能被截断`);
    }
    chunks.push({
      type: buffer.subarray(pos + 4, pos + 8).toString('ascii'),
      data: buffer.subarray(pos + 8, pos + 8 + length),
      crc: buffer.subarray(pos + 8 + length, end),
    });
    pos = end;
  }

  return chunks;
}

/**
 * 将 chunk 列表序列化回完整的 PNG buffer。
 * @param {PngChunk[]} chunks
 * @returns {Buffer}
 */
export function serializeChunks(chunks) {
  const parts = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(chunk.data.length);
    parts.push(lengthBuf, Buffer.from(chunk.type, 'ascii'), chunk.data, chunk.crc);
  }
  return Buffer.concat(parts);
}

/**
 * 读取 PNG 中所有 tEXt chunk，返回 key → 原始值 Buffer 的映射。
 * 值不做编码假设（ccv3 为 base64 ASCII，chara 可能是原始 JSON），由调用方解码。
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
export function readTextChunks(buffer) {
  const texts = new Map();
  for (const chunk of parseChunks(buffer)) {
    if (chunk.type !== 'tEXt') continue;
    const separator = chunk.data.indexOf(0);
    if (separator === -1) continue; // 无 key/value 分隔符的畸形 chunk，跳过
    const key = chunk.data.subarray(0, separator).toString('latin1');
    texts.set(key, chunk.data.subarray(separator + 1));
  }
  return texts;
}

/**
 * 替换 PNG 中指定 key 的 tEXt chunk 值并重算 CRC，其余 chunk 原样保留。
 * @param {Buffer} buffer 原始 PNG
 * @param {Map<string, Buffer>|Record<string, Buffer>} replacements key → 新值
 * @returns {{ png: Buffer, replacedKeys: string[] }} 新 PNG 与实际命中的 key 列表
 */
export function replaceTextChunks(buffer, replacements) {
  const entries = replacements instanceof Map ? replacements : new Map(Object.entries(replacements));
  const chunks = parseChunks(buffer);
  const replacedKeys = [];

  for (const chunk of chunks) {
    if (chunk.type !== 'tEXt') continue;
    const separator = chunk.data.indexOf(0);
    if (separator === -1) continue;
    const key = chunk.data.subarray(0, separator).toString('latin1');
    const newValue = entries.get(key);
    if (newValue == null) continue;

    chunk.data = Buffer.concat([Buffer.from(`${key}\0`, 'latin1'), newValue]);
    // 数据变更后 CRC 必须基于 type+data 重算，否则酒馆会拒绝加载该卡
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(chunk.type, 'ascii'), chunk.data])));
    chunk.crc = crcBuf;
    replacedKeys.push(key);
  }

  return { png: serializeChunks(chunks), replacedKeys };
}

/**
 * 解码 ccv3 字段为角色卡对象。
 * 主流格式是 base64(JSON)，但历史上也存在直接内嵌 JSON 的卡，
 * 因此保留“先按 base64 解、失败再按明文 JSON 解”的双路兜底。
 * @param {Buffer} valueBuffer tEXt chunk 中 ccv3 的原始值
 * @returns {object}
 * @throws {Error} 两种方式均无法解析时抛出
 */
export function decodeCardPayload(valueBuffer) {
  const raw = valueBuffer.toString('latin1');
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`无法解码 ccv3 角色卡数据: ${err.message}`);
    }
  }
}

/**
 * 将角色卡对象编码回 ccv3 需要的 base64 形式。
 * 2 空格缩进是既有产物格式，保持不变以便 diff 溯源。
 * @param {object} card
 * @returns {{ json: string, base64: Buffer }} 明文 JSON 与 base64 编码后的 Buffer
 */
export function encodeCardPayload(card) {
  const json = JSON.stringify(card, null, 2);
  return { json, base64: Buffer.from(Buffer.from(json, 'utf-8').toString('base64'), 'ascii') };
}
