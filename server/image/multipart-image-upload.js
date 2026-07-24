// @ts-check
import fs from 'node:fs/promises';
import { TextDecoder } from 'node:util';

export class MultipartUploadError extends Error {
  /** @param {string} message @param {number} [status] @param {string} [code] */
  constructor(message, status = 400, code = 'INVALID_MULTIPART') {
    super(message);
    this.name = 'MultipartUploadError';
    this.status = status;
    this.code = code;
  }
}

function parseBoundary(contentType) {
  const pieces = String(contentType || '').split(';');
  if (pieces.shift()?.trim().toLowerCase() !== 'multipart/form-data') {
    throw new MultipartUploadError('上传必须使用 multipart/form-data', 415, 'MULTIPART_REQUIRED');
  }
  let boundary = '';
  for (const piece of pieces) {
    const separator = piece.indexOf('=');
    if (separator < 0 || piece.slice(0, separator).trim().toLowerCase() !== 'boundary') continue;
    boundary = piece.slice(separator + 1).trim();
    if (boundary.startsWith('"') && boundary.endsWith('"')) boundary = boundary.slice(1, -1);
    break;
  }
  if (!boundary || boundary.length > 70 || !/^[0-9A-Za-z'()+_,./:=?-]+$/.test(boundary)) {
    throw new MultipartUploadError('multipart boundary 无效');
  }
  return boundary;
}

function parseHeaders(rawHeaders) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const line of rawHeaders.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new MultipartUploadError('multipart 分段头无效');
    const name = line.slice(0, separator).trim().toLowerCase();
    if (headers[name] !== undefined) throw new MultipartUploadError('multipart 分段头重复');
    headers[name] = line.slice(separator + 1).trim();
  }

  const disposition = headers['content-disposition'] || '';
  if (!/^form-data(?:;|$)/i.test(disposition)) {
    throw new MultipartUploadError('multipart 分段缺少 Content-Disposition');
  }
  const nameMatch = disposition.match(/(?:^|;)\s*name="([^"\r\n]*)"/i);
  if (!nameMatch) throw new MultipartUploadError('multipart 分段缺少字段名');
  if (headers['content-transfer-encoding']
    && headers['content-transfer-encoding'].toLowerCase() !== 'binary') {
    throw new MultipartUploadError('不接受编码后的 multipart 图片内容');
  }
  return {
    name: nameMatch[1],
    contentType: String(headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  };
}

function decodeUtf8(chunks) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new MultipartUploadError('multipart 文本字段不是有效 UTF-8');
  }
}

/**
 * A deliberately small streaming multipart parser. It only accepts the four
 * fields used by this endpoint and writes image bytes directly into staging.
 * @param {import('express').Request} req
 * @param {{ originalPath: string, thumbnailPath: string }} staging
 * @param {{ maxOriginalBytes: number, maxThumbnailBytes: number, maxMetadataBytes: number }} limits
 */
export async function parseImageAssetMultipart(req, staging, limits) {
  const boundaryValue = parseBoundary(req.headers['content-type']);
  const firstBoundary = Buffer.from(`--${boundaryValue}`);
  const bodyBoundary = Buffer.from(`\r\n--${boundaryValue}`);
  const maxTotalBytes = limits.maxOriginalBytes + limits.maxThumbnailBytes
    + limits.maxMetadataBytes + 256 * 1024;
  const declaredLength = Number.parseInt(String(req.headers['content-length'] || ''), 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxTotalBytes) {
    throw new MultipartUploadError('上传请求超过允许大小', 413, 'UPLOAD_TOO_LARGE');
  }

  /** @type {'start'|'headers'|'body'|'after-boundary'|'end'} */
  let state = 'start';
  let pending = Buffer.alloc(0);
  let totalBytes = 0;
  let current = null;
  /** @type {fs.FileHandle | null} */
  let currentHandle = null;
  /** @type {Map<string, { contentType: string, size: number, chunks?: Buffer[] }>} */
  const completed = new Map();

  async function beginPart(rawHeaders) {
    const parsed = parseHeaders(rawHeaders);
    if (!['original', 'thumbnail', 'metadata', 'auto_evict'].includes(parsed.name)) {
      throw new MultipartUploadError(`不支持的 multipart 字段：${parsed.name}`);
    }
    if (completed.has(parsed.name)) throw new MultipartUploadError(`multipart 字段重复：${parsed.name}`);

    const isFile = parsed.name === 'original' || parsed.name === 'thumbnail';
    if (isFile && !['image/png', 'image/jpeg', 'image/webp'].includes(parsed.contentType)) {
      throw new MultipartUploadError('图片分段 Content-Type 无效', 415, 'UNSUPPORTED_IMAGE_TYPE');
    }
    if (!isFile && parsed.contentType
      && !['application/json', 'text/plain'].includes(parsed.contentType)) {
      throw new MultipartUploadError('文本分段 Content-Type 无效', 415, 'UNSUPPORTED_FIELD_TYPE');
    }

    current = {
      name: parsed.name,
      contentType: parsed.contentType,
      size: 0,
      chunks: isFile ? undefined : []
    };
    if (isFile) {
      currentHandle = await fs.open(parsed.name === 'original' ? staging.originalPath : staging.thumbnailPath, 'wx');
    }
  }

  async function writePart(bytes) {
    if (!current || bytes.length === 0) return;
    current.size += bytes.length;
    const limit = current.name === 'original'
      ? limits.maxOriginalBytes
      : current.name === 'thumbnail'
        ? limits.maxThumbnailBytes
        : current.name === 'metadata'
          ? limits.maxMetadataBytes
          : 16;
    if (current.size > limit) {
      throw new MultipartUploadError(`${current.name} 字段超过允许大小`, 413, 'UPLOAD_PART_TOO_LARGE');
    }
    if (currentHandle) await currentHandle.write(bytes);
    else current.chunks.push(bytes);
  }

  async function finishPart() {
    if (!current) throw new MultipartUploadError('multipart 分段状态无效');
    if (currentHandle) {
      await currentHandle.close();
      currentHandle = null;
    }
    completed.set(current.name, current);
    current = null;
  }

  async function consume() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (state === 'start') {
        if (pending.length < firstBoundary.length + 2) return;
        if (!pending.subarray(0, firstBoundary.length).equals(firstBoundary)
          || pending.subarray(firstBoundary.length, firstBoundary.length + 2).toString() !== '\r\n') {
          throw new MultipartUploadError('multipart 起始 boundary 无效');
        }
        pending = pending.subarray(firstBoundary.length + 2);
        state = 'headers';
        progressed = true;
      } else if (state === 'headers') {
        const headerEnd = pending.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          if (pending.length > 8192) throw new MultipartUploadError('multipart 分段头过大', 413);
          return;
        }
        await beginPart(pending.subarray(0, headerEnd).toString('latin1'));
        pending = pending.subarray(headerEnd + 4);
        state = 'body';
        progressed = true;
      } else if (state === 'body') {
        const boundaryAt = pending.indexOf(bodyBoundary);
        if (boundaryAt < 0) {
          const flushLength = pending.length - (bodyBoundary.length - 1);
          if (flushLength > 0) {
            await writePart(pending.subarray(0, flushLength));
            pending = pending.subarray(flushLength);
          }
          return;
        }
        await writePart(pending.subarray(0, boundaryAt));
        await finishPart();
        pending = pending.subarray(boundaryAt + bodyBoundary.length);
        state = 'after-boundary';
        progressed = true;
      } else if (state === 'after-boundary') {
        if (pending.length < 2) return;
        const suffix = pending.subarray(0, 2).toString();
        if (suffix === '\r\n') {
          pending = pending.subarray(2);
          state = 'headers';
        } else if (suffix === '--') {
          pending = pending.subarray(2);
          state = 'end';
        } else {
          throw new MultipartUploadError('multipart boundary 后缀无效');
        }
        progressed = true;
      } else if (state === 'end' && pending.length > 2) {
        throw new MultipartUploadError('multipart 结束 boundary 后存在额外内容');
      }
    }
  }

  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > maxTotalBytes) {
        throw new MultipartUploadError('上传请求超过允许大小', 413, 'UPLOAD_TOO_LARGE');
      }
      pending = pending.length ? Buffer.concat([pending, bytes]) : bytes;
      await consume();
    }
    await consume();
    if (state !== 'end' || (pending.length && pending.toString() !== '\r\n')) {
      throw new MultipartUploadError('multipart 请求未完整结束');
    }
    if (!completed.has('original') || !completed.has('thumbnail') || !completed.has('metadata')) {
      throw new MultipartUploadError('上传必须包含 original、thumbnail 和 metadata');
    }
    if (completed.get('original').size === 0 || completed.get('thumbnail').size === 0) {
      throw new MultipartUploadError('上传图片不能为空');
    }

    const metadataText = decodeUtf8(completed.get('metadata').chunks);
    const autoEvictPart = completed.get('auto_evict');
    return {
      originalMime: completed.get('original').contentType,
      thumbnailMime: completed.get('thumbnail').contentType,
      metadataText,
      autoEvictText: autoEvictPart ? decodeUtf8(autoEvictPart.chunks).trim() : ''
    };
  } catch (error) {
    if (currentHandle) await currentHandle.close().catch(() => {});
    throw error;
  }
}
