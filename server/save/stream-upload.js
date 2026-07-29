// @ts-check
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import Busboy from 'busboy';
import streamJson from 'stream-json';

import { config } from '../config.js';

const { parser } = streamJson;
const STAGING_DIR = path.join(config.storage.dataDir, 'save-staging');
const STALE_UPLOAD_MS = 60 * 60 * 1000;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FORBIDDEN_MEDIA_PATTERN = /(?:data:image\/|blob:)/i;
const MAX_JSON_KEY_CHARS = 1024;

let stagingReady;
let activeUploads = 0;
const activeUsers = new Set();

export class SaveUploadError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'SaveUploadError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function prepareStagingDirectory() {
  await fsp.mkdir(STAGING_DIR, { recursive: true });
  const cutoff = Date.now() - STALE_UPLOAD_MS;
  const entries = await fsp.readdir(STAGING_DIR, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.upload')) return;
    const filePath = path.join(STAGING_DIR, entry.name);
    try {
      const stat = await fsp.stat(filePath);
      if (stat.mtimeMs < cutoff) await fsp.rm(filePath, { force: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[SAVE UPLOAD] Failed to clean stale upload:', error);
    }
  }));
}

async function ensureStagingDirectory() {
  if (!stagingReady) {
    stagingReady = prepareStagingDirectory().catch((error) => {
      stagingReady = undefined;
      throw error;
    });
  }
  await stagingReady;
}

export function acquireSaveUpload(userId) {
  if (activeUsers.has(userId)) {
    throw new SaveUploadError(
      'SAVE_UPLOAD_IN_PROGRESS',
      '该用户已有云存档正在上传，请稍后重试',
      429
    );
  }
  if (activeUploads >= config.saves.uploadGlobalConcurrency) {
    throw new SaveUploadError(
      'SAVE_UPLOAD_CAPACITY_REACHED',
      '云存档上传服务繁忙，请稍后重试',
      503
    );
  }

  activeUploads++;
  activeUsers.add(userId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUploads--;
    activeUsers.delete(userId);
  };
}

export async function removeUploadTemp(filePath) {
  if (!filePath) return;
  try {
    await fsp.rm(filePath, { force: true });
  } catch (error) {
    console.warn('[SAVE UPLOAD] Failed to remove temporary upload:', error);
  }
}

export async function receiveMultipartSave(req) {
  await ensureStagingDirectory();
  const tempPath = path.join(STAGING_DIR, `${process.pid}-${randomUUID()}.upload`);
  const maxCompressedBytes = config.saves.maxCompressedSizeMb * 1024 * 1024;
  const maxMetadataBytes = config.saves.maxPreviewSizeKb * 1024;
  let metadataText;
  let fileSeen = false;
  let compressedBytes = 0;
  let compressedSha256;
  let formError;
  const filePipelines = [];

  const setFormError = (error) => {
    if (!formError) formError = error;
  };

  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: {
        fields: 1,
        files: 1,
        // Busboy emits partsLimit when the configured count is reached.
        // fields/files and explicit names still enforce exactly two accepted parts.
        parts: 3,
        fieldSize: maxMetadataBytes,
        fileSize: maxCompressedBytes
      }
    });
  } catch (error) {
    throw new SaveUploadError('INVALID_MULTIPART', '无效的 multipart 请求', 400);
  }

  busboy.on('field', (name, value, info) => {
    if (name !== 'metadata' || metadataText !== undefined) {
      setFormError(new SaveUploadError('INVALID_MULTIPART_FIELDS', '只允许一个 metadata 字段', 400));
      return;
    }
    if (info.valueTruncated) {
      setFormError(new SaveUploadError('SAVE_METADATA_TOO_LARGE', '云存档元数据过大', 413));
      return;
    }
    metadataText = value;
  });

  busboy.on('file', (name, file) => {
    if (name !== 'save' || fileSeen) {
      setFormError(new SaveUploadError('INVALID_MULTIPART_FILES', '只允许一个 save 文件', 400));
      file.resume();
      return;
    }
    fileSeen = true;
    const compressedHash = createHash('sha256');
    file.on('limit', () => {
      setFormError(new SaveUploadError(
        'COMPRESSED_SAVE_TOO_LARGE',
        `压缩存档不得超过 ${config.saves.maxCompressedSizeMb} MiB`,
        413
      ));
    });
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        compressedBytes += chunk.length;
        compressedHash.update(chunk);
        if (compressedBytes > maxCompressedBytes) {
          callback(new SaveUploadError(
            'COMPRESSED_SAVE_TOO_LARGE',
            `压缩存档不得超过 ${config.saves.maxCompressedSizeMb} MiB`,
            413
          ));
          return;
        }
        callback(null, chunk);
      }
    });
    const filePipeline = pipeline(
      file,
      counter,
      fs.createWriteStream(tempPath, { flags: 'wx' })
    ).then(
      () => {
        compressedSha256 = compressedHash.digest('hex');
        return null;
      },
      (error) => {
        // A failed destination destroys Busboy's file stream. Busboy otherwise
        // waits forever for that part to be consumed, while this rejection can
        // also escape before the outer request pipeline is awaited.
        if (req.aborted || req.destroyed || busboy.destroyed) return error;
        const uploadError = error instanceof SaveUploadError
          ? error
          : new SaveUploadError(
            'SAVE_STAGING_WRITE_FAILED',
            '云存档暂存写入失败，请稍后重试',
            507
          );
        setFormError(uploadError);
        busboy.destroy(uploadError);
        return uploadError;
      }
    );
    filePipelines.push(filePipeline);
  });

  busboy.on('fieldsLimit', () => setFormError(
    new SaveUploadError('INVALID_MULTIPART_FIELDS', 'multipart 字段数量超出限制', 400)
  ));
  busboy.on('filesLimit', () => setFormError(
    new SaveUploadError('INVALID_MULTIPART_FILES', 'multipart 文件数量超出限制', 400)
  ));
  busboy.on('partsLimit', () => setFormError(
    new SaveUploadError('INVALID_MULTIPART_PARTS', 'multipart 内容数量超出限制', 400)
  ));

  try {
    await pipeline(req, busboy);
    const fileErrors = await Promise.all(filePipelines);
    const fileError = fileErrors.find(Boolean);
    if (fileError) throw fileError;
    if (formError) throw formError;
    if (metadataText === undefined || !fileSeen) {
      throw new SaveUploadError('MISSING_MULTIPART_PART', 'multipart 请求必须包含 metadata 和 save', 400);
    }
    if (compressedBytes === 0) {
      throw new SaveUploadError('EMPTY_SAVE_FILE', '压缩存档文件不能为空', 400);
    }

    let metadata;
    try {
      metadata = JSON.parse(metadataText);
    } catch {
      throw new SaveUploadError('INVALID_SAVE_METADATA', 'metadata 必须是有效的 JSON 对象', 400);
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new SaveUploadError('INVALID_SAVE_METADATA', 'metadata 必须是 JSON 对象', 400);
    }

    return { tempPath, metadata, compressedBytes, compressedSha256 };
  } catch (error) {
    await Promise.allSettled(filePipelines);
    await removeUploadTemp(tempPath);
    if (error instanceof SaveUploadError) throw error;
    if (req.destroyed || req.aborted) {
      throw new SaveUploadError('UPLOAD_ABORTED', '云存档上传已中断', 400);
    }
    throw new SaveUploadError('INVALID_MULTIPART', '无法读取 multipart 云存档', 400);
  }
}

function createJsonStructureValidator(maxDepth) {
  const stack = [];
  const rootFields = new Set();
  const requiredArrays = { nodes: false, branches: false };
  let rootStarted = false;
  let rootCompleted = false;
  let readingKey = false;
  let keyBuffer = '';
  let stringTail = '';

  const fail = (code, message) => {
    throw new SaveUploadError(code, message, 400);
  };
  const startValue = (type) => {
    if (!rootStarted) {
      if (type !== 'object') fail('INVALID_SAVE_STRUCTURE', '存档根节点必须是 JSON 对象');
      rootStarted = true;
      return undefined;
    }
    const parent = stack.at(-1);
    if (!parent) fail('INVALID_SAVE_JSON', '存档包含多个 JSON 根值');
    if (parent.type === 'array') {
      parent.items++;
      return undefined;
    }
    const field = parent.pendingKey;
    parent.pendingKey = undefined;
    if (stack.length === 1) {
      if (rootFields.has(field)) fail('DUPLICATE_ROOT_FIELD', `存档根字段重复: ${field}`);
      rootFields.add(field);
      return field;
    }
    return undefined;
  };
  const pushContainer = (type) => {
    const rootField = startValue(type);
    stack.push({ type, items: 0, pendingKey: undefined, rootField });
    if (stack.length > maxDepth) {
      fail('SAVE_JSON_TOO_DEEP', `存档 JSON 嵌套不得超过 ${maxDepth} 层`);
    }
  };

  return new Writable({
    objectMode: true,
    write(token, _encoding, callback) {
      try {
        switch (token.name) {
          case 'startObject':
            pushContainer('object');
            break;
          case 'endObject': {
            const frame = stack.pop();
            if (!frame || frame.type !== 'object') fail('INVALID_SAVE_JSON', '存档对象结构不完整');
            if (stack.length === 0) rootCompleted = true;
            break;
          }
          case 'startArray':
            pushContainer('array');
            break;
          case 'endArray': {
            const frame = stack.pop();
            if (!frame || frame.type !== 'array') fail('INVALID_SAVE_JSON', '存档数组结构不完整');
            if (frame.rootField === 'nodes' || frame.rootField === 'branches') {
              requiredArrays[frame.rootField] = frame.items > 0;
            }
            break;
          }
          case 'startKey':
            readingKey = true;
            keyBuffer = '';
            break;
          case 'keyChunk':
            keyBuffer += token.value;
            if (keyBuffer.length > MAX_JSON_KEY_CHARS) {
              fail('SAVE_JSON_KEY_TOO_LONG', '存档 JSON 字段名过长');
            }
            break;
          case 'endKey': {
            readingKey = false;
            if (UNSAFE_KEYS.has(keyBuffer)) {
              fail('UNSAFE_SAVE_KEY', `存档包含不安全字段: ${keyBuffer}`);
            }
            const frame = stack.at(-1);
            if (!frame || frame.type !== 'object') fail('INVALID_SAVE_JSON', 'JSON 字段不在对象中');
            frame.pendingKey = keyBuffer;
            keyBuffer = '';
            break;
          }
          case 'startString':
            if (!readingKey) {
              startValue('string');
              stringTail = '';
            }
            break;
          case 'stringChunk':
            if (readingKey) {
              // stream-json 1.x/3.x expose unpacked key text as stringChunk.
              keyBuffer += token.value;
              if (keyBuffer.length > MAX_JSON_KEY_CHARS) {
                fail('SAVE_JSON_KEY_TOO_LONG', '存档 JSON 字段名过长');
              }
            } else {
              const sample = stringTail + token.value;
              if (FORBIDDEN_MEDIA_PATTERN.test(sample)) {
                fail('EMBEDDED_MEDIA_FORBIDDEN', '云存档不得包含 Base64 图片或 blob URL');
              }
              stringTail = sample.slice(-32);
            }
            break;
          case 'endString':
            stringTail = '';
            break;
          case 'startNumber':
            startValue('number');
            break;
          case 'trueValue':
          case 'falseValue':
          case 'nullValue':
            startValue('primitive');
            break;
          default:
            break;
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      try {
        if (!rootStarted || !rootCompleted || stack.length !== 0) {
          fail('INVALID_SAVE_JSON', '存档 JSON 结构不完整');
        }
        if (!requiredArrays.nodes || !requiredArrays.branches) {
          fail('INVALID_SAVE_STRUCTURE', '存档必须包含非空的 nodes 和 branches 数组');
        }
        callback();
      } catch (error) {
        callback(error);
      }
    }
  });
}

export async function validateCompressedTimeline(tempPath) {
  const maxUncompressedBytes = config.saves.maxSizeMb * 1024 * 1024;
  const contentHash = createHash('sha256');
  let sizeBytes = 0;
  const byteLimiter = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxUncompressedBytes) {
        callback(new SaveUploadError(
          'SAVE_TOO_LARGE',
          `解压后的云存档不得超过 ${config.saves.maxSizeMb} MiB`,
          413
        ));
        return;
      }
      contentHash.update(chunk);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(
      fs.createReadStream(tempPath),
      zlib.createGunzip(),
      byteLimiter,
      parser({ packKeys: false, packStrings: false, packNumbers: false }),
      createJsonStructureValidator(config.saves.maxJsonDepth)
    );
  } catch (error) {
    if (error instanceof SaveUploadError) throw error;
    if (error?.code === 'Z_DATA_ERROR' || error?.code === 'Z_BUF_ERROR') {
      throw new SaveUploadError('INVALID_GZIP', 'save 文件不是有效的 gzip 数据', 400);
    }
    throw new SaveUploadError('INVALID_SAVE_JSON', 'gzip 中的存档不是有效 JSON', 400);
  }

  return {
    sizeBytes,
    contentSha256: contentHash.digest('hex')
  };
}
