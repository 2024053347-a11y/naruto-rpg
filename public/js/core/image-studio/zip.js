import { imageError } from './transport.js';

const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const DEFAULT_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 64;
const MAX_END_SEARCH = 0xffff + 22;

function zipError(message, details = null) {
  return imageError('PROVIDER_ERROR', `NovelAI ${message}`, details);
}

function positiveLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ensureRange(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw zipError('返回的 ZIP 压缩包结构无效或已损坏');
  }
}

async function bytesOf(value, maxArchiveBytes) {
  let size;
  let buffer;
  if (value instanceof Blob) {
    size = value.size;
    if (size > maxArchiveBytes) throw zipError(`返回的 ZIP 压缩包过大，超过 ${maxArchiveBytes} 字节限制`);
    buffer = await value.arrayBuffer();
  } else if (value instanceof ArrayBuffer) {
    size = value.byteLength;
    buffer = value;
  } else if (ArrayBuffer.isView(value)) {
    size = value.byteLength;
    buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  } else {
    throw zipError('没有返回有效的 ZIP 压缩包');
  }
  if (!size || size > maxArchiveBytes) {
    throw zipError(size ? `返回的 ZIP 压缩包过大，超过 ${maxArchiveBytes} 字节限制` : '返回了空 ZIP 压缩包');
  }
  return new Uint8Array(buffer);
}

function findEndRecord(bytes) {
  if (bytes.length < 22) throw zipError('返回的 ZIP 压缩包无效');
  const view = viewOf(bytes);
  const first = Math.max(0, bytes.length - MAX_END_SEARCH);
  for (let offset = bytes.length - 22; offset >= first; offset--) {
    if (view.getUint32(offset, true) !== ZIP_END) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw zipError('返回的 ZIP 压缩包无效或缺少目录');
}

function decodeName(bytes) {
  const name = new TextDecoder('utf-8').decode(bytes);
  if (!name || name.includes('\0') || name.includes('\ufffd')) {
    throw zipError('ZIP 压缩包包含无效文件名');
  }
  return name;
}

function isSafeArchivePath(name) {
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return false;
  const path = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  if (!path) return false;
  const segments = path.split('/');
  return !segments.some(segment => segment === '.' || segment === '..' || segment === '');
}

function sameBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function parseEntries(bytes, { maxEntries, maxTotalBytes }) {
  const view = viewOf(bytes);
  const endOffset = findEndRecord(bytes);
  const disk = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (disk || directoryDisk || diskEntries !== entryCount) {
    throw zipError('不支持分卷 ZIP 压缩包');
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw zipError('不支持 ZIP64 压缩包');
  }
  if (!entryCount || entryCount > maxEntries) {
    throw zipError(`ZIP 压缩包文件数量无效或超过 ${maxEntries} 个限制`);
  }
  ensureRange(bytes, directoryOffset, directorySize);
  if (directoryOffset + directorySize > endOffset) throw zipError('ZIP 压缩包目录越界');

  const entries = [];
  let cursor = directoryOffset;
  let declaredTotal = 0;
  for (let index = 0; index < entryCount; index++) {
    ensureRange(bytes, cursor, 46);
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE) throw zipError('ZIP 压缩包目录已损坏');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff) || diskStart === 0xffff) {
      throw zipError('不支持 ZIP64 文件条目');
    }
    if (diskStart) throw zipError('不支持分卷 ZIP 文件条目');
    const recordLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(bytes, cursor, recordLength);
    if (cursor + recordLength > directoryOffset + directorySize) throw zipError('ZIP 压缩包目录条目越界');
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
    const name = decodeName(nameBytes);
    if (!isSafeArchivePath(name)) throw zipError(`ZIP 压缩包包含不安全路径: ${name}`);
    declaredTotal += uncompressedSize;
    if (!Number.isSafeInteger(declaredTotal) || declaredTotal > maxTotalBytes) {
      throw zipError(`ZIP 解压总大小超过 ${maxTotalBytes} 字节限制`);
    }
    entries.push({
      name, nameBytes, flags, method, checksum, compressedSize, uncompressedSize,
      localOffset, directoryOffset
    });
    cursor += recordLength;
  }
  if (cursor !== directoryOffset + directorySize) throw zipError('ZIP 压缩包目录大小不一致');
  return entries;
}

async function inflateRaw(bytes, expectedSize, maxImageBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw zipError('需要支持 DecompressionStream 的现代浏览器才能解压图片');
  }
  let stream;
  try {
    stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  } catch (error) {
    throw zipError('当前浏览器不支持 ZIP Deflate 解压', { cause: error?.message });
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxImageBytes || total > expectedSize) {
        await reader.cancel().catch(() => {});
        throw zipError(`ZIP 图片解压后过大，超过 ${maxImageBytes} 字节限制`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.code) throw error;
    throw zipError('ZIP 图片解压失败，压缩包可能已损坏', { cause: error?.message });
  }
  if (total !== expectedSize) throw zipError('ZIP 图片解压大小不一致，压缩包可能已损坏');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value++) {
      let crc = value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      crcTable[value] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function imageType(name, bytes) {
  const extension = name.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1] || '';
  if (extension === 'png' && bytes.length >= 8
    && sameBytes(bytes.subarray(0, 8), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if ((extension === 'jpg' || extension === 'jpeg') && bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (extension === 'webp' && bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  throw zipError(`ZIP 条目 ${name} 不是有效图片`);
}

async function extractEntry(bytes, entry, maxImageBytes) {
  if (entry.flags & 0x0001) throw zipError('不支持加密 ZIP 图片');
  if (entry.uncompressedSize > maxImageBytes) {
    throw zipError(`ZIP 图片过大，超过 ${maxImageBytes} 字节限制`);
  }
  const view = viewOf(bytes);
  ensureRange(bytes, entry.localOffset, 30);
  if (view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_FILE) throw zipError('ZIP 图片本地条目已损坏');
  const localFlags = view.getUint16(entry.localOffset + 6, true);
  const localMethod = view.getUint16(entry.localOffset + 8, true);
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  ensureRange(bytes, entry.localOffset, 30 + nameLength + extraLength);
  ensureRange(bytes, dataOffset, entry.compressedSize);
  if (dataOffset + entry.compressedSize > entry.directoryOffset) throw zipError('ZIP 图片数据越界');
  if ((localFlags & 0x0001) || localMethod !== entry.method) throw zipError('ZIP 图片条目头不一致');
  const localName = bytes.slice(entry.localOffset + 30, entry.localOffset + 30 + nameLength);
  if (!sameBytes(localName, entry.nameBytes)) throw zipError('ZIP 图片文件名不一致');

  const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
  let output;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) throw zipError('ZIP Stored 图片大小不一致');
    output = compressed;
  } else if (entry.method === 8) {
    output = await inflateRaw(compressed, entry.uncompressedSize, maxImageBytes);
  } else {
    throw zipError(`不支持 ZIP 压缩方法 ${entry.method}`);
  }
  if (crc32(output) !== entry.checksum) throw zipError('ZIP 图片校验失败，压缩包可能已损坏');
  return new Blob([output], { type: imageType(entry.name, output) });
}

export async function extractFirstImageFromZip(archive, options = {}) {
  const maxArchiveBytes = positiveLimit(options.maxArchiveBytes, DEFAULT_MAX_ARCHIVE_BYTES);
  const maxImageBytes = positiveLimit(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES);
  const maxTotalBytes = positiveLimit(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
  const maxEntries = positiveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const bytes = await bytesOf(archive, maxArchiveBytes);
  const entries = parseEntries(bytes, { maxEntries, maxTotalBytes });
  const image = entries.find(entry => /\.(?:png|jpe?g|webp)$/i.test(entry.name));
  if (!image) throw zipError('返回的 ZIP 压缩包中没有可用图片');
  return extractEntry(bytes, image, maxImageBytes);
}
