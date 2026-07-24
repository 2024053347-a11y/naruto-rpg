// @ts-check
import fs from 'node:fs/promises';

const MIME_TO_EXTENSION = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
});

export class ImageValidationError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {string} [code]
   */
  constructor(message, status = 422, code = 'INVALID_IMAGE') {
    super(message);
    this.name = 'ImageValidationError';
    this.status = status;
    this.code = code;
  }
}

/** @param {Buffer} bytes @param {number} offset */
function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/**
 * Read exactly `length` bytes without loading the complete (up to 20 MiB) image.
 * @param {fs.FileHandle} handle
 * @param {number} position
 * @param {number} length
 */
async function readAt(handle, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new ImageValidationError('图片文件已截断或损坏');
  }
  return buffer;
}

/** @param {fs.FileHandle} handle @param {number} size */
async function inspectPng(handle, size) {
  if (size < 24) throw new ImageValidationError('PNG 图片文件已截断');
  const header = await readAt(handle, 0, 24);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!header.subarray(0, 8).equals(signature)
    || header.readUInt32BE(8) !== 13
    || header.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ImageValidationError('PNG 文件头或 IHDR 无效');
  }
  return { mimeType: 'image/png', width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);
const JPEG_HEADER_SCAN_LIMIT = 1024 * 1024;

/** @param {fs.FileHandle} handle @param {number} size */
async function inspectJpeg(handle, size) {
  if (size < 4) throw new ImageValidationError('JPEG 图片文件已截断');
  const scanLength = Math.min(size, JPEG_HEADER_SCAN_LIMIT);
  const header = await readAt(handle, 0, scanLength);
  let position = 2;
  let segmentCount = 0;

  while (position < header.length && segmentCount++ < 10000) {
    while (position < header.length && header[position] !== 0xff) position++;
    if (position >= header.length) break;
    while (position < header.length && header[position] === 0xff) position++;
    if (position >= header.length) break;
    const marker = header[position++];

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (position + 2 > size) break;

    if (position + 2 > header.length) break;
    const segmentLength = header.readUInt16BE(position);
    if (segmentLength < 2 || position + segmentLength > size) {
      throw new ImageValidationError('JPEG 段长度无效');
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new ImageValidationError('JPEG 尺寸段无效');
      if (position + 7 > header.length) break;
      return {
        mimeType: 'image/jpeg',
        height: header.readUInt16BE(position + 3),
        width: header.readUInt16BE(position + 5)
      };
    }
    if (position + segmentLength > header.length) break;
    position += segmentLength;
  }

  if (size > JPEG_HEADER_SCAN_LIMIT) {
    throw new ImageValidationError('JPEG 尺寸信息超出允许的头部扫描范围', 422, 'JPEG_HEADER_TOO_LARGE');
  }
  throw new ImageValidationError('无法从 JPEG 中读取有效尺寸');
}

/** @param {fs.FileHandle} handle @param {number} size */
async function inspectWebp(handle, size) {
  if (size < 30) throw new ImageValidationError('WebP 图片文件已截断');
  const header = await readAt(handle, 0, Math.min(size, 30));
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WEBP') {
    throw new ImageValidationError('WebP 文件头无效');
  }

  const chunkType = header.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    return {
      mimeType: 'image/webp',
      width: readUInt24LE(header, 24) + 1,
      height: readUInt24LE(header, 27) + 1
    };
  }
  if (chunkType === 'VP8L') {
    if (header[20] !== 0x2f) throw new ImageValidationError('WebP VP8L 签名无效');
    return {
      mimeType: 'image/webp',
      width: 1 + header[21] + ((header[22] & 0x3f) << 8),
      height: 1 + (header[22] >> 6) + (header[23] << 2) + ((header[24] & 0x0f) << 10)
    };
  }
  if (chunkType === 'VP8 ') {
    if (header[23] !== 0x9d || header[24] !== 0x01 || header[25] !== 0x2a) {
      throw new ImageValidationError('WebP VP8 帧头无效');
    }
    return {
      mimeType: 'image/webp',
      width: header.readUInt16LE(26) & 0x3fff,
      height: header.readUInt16LE(28) & 0x3fff
    };
  }
  throw new ImageValidationError('不支持的 WebP 位流格式');
}

/**
 * Validate MIME, magic bytes and dimensions while keeping the upload on disk.
 * @param {string} filePath
 * @param {string} declaredMime
 * @param {{ maxBytes: number, maxPixels: number, maxSide: number }} limits
 */
export async function inspectImageFile(filePath, declaredMime, limits) {
  const normalizedMime = String(declaredMime || '').split(';', 1)[0].trim().toLowerCase();
  if (!MIME_TO_EXTENSION[normalizedMime]) {
    throw new ImageValidationError('仅支持 PNG、JPEG 和 WebP 图片', 415, 'UNSUPPORTED_IMAGE_TYPE');
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) {
      throw new ImageValidationError('图片文件为空');
    }
    if (stat.size > limits.maxBytes) {
      throw new ImageValidationError('图片文件超过允许大小', 413, 'IMAGE_TOO_LARGE');
    }

    const magic = await readAt(handle, 0, Math.min(stat.size, 12));
    let actual;
    if (magic.length >= 8 && magic.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )) {
      actual = await inspectPng(handle, stat.size);
    } else if (magic.length >= 2 && magic[0] === 0xff && magic[1] === 0xd8) {
      actual = await inspectJpeg(handle, stat.size);
    } else if (magic.length >= 12
      && magic.toString('ascii', 0, 4) === 'RIFF'
      && magic.toString('ascii', 8, 12) === 'WEBP') {
      actual = await inspectWebp(handle, stat.size);
    } else {
      throw new ImageValidationError('文件内容不是受支持的图片', 415, 'UNSUPPORTED_IMAGE_TYPE');
    }

    if (actual.mimeType !== normalizedMime) {
      throw new ImageValidationError('声明的 MIME 类型与图片内容不一致', 415, 'MIME_MISMATCH');
    }
    if (!Number.isSafeInteger(actual.width) || !Number.isSafeInteger(actual.height)
      || actual.width <= 0 || actual.height <= 0) {
      throw new ImageValidationError('图片尺寸无效');
    }
    if (actual.width > limits.maxSide || actual.height > limits.maxSide
      || actual.width * actual.height > limits.maxPixels) {
      throw new ImageValidationError('图片尺寸超过允许范围', 422, 'IMAGE_DIMENSIONS_EXCEEDED');
    }

    return {
      ...actual,
      extension: MIME_TO_EXTENSION[actual.mimeType],
      sizeBytes: stat.size
    };
  } finally {
    await handle.close();
  }
}
