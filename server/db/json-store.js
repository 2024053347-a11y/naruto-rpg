import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * 通用 JSON 文件存储引擎（单进程模型）。
 *
 * 解决旧实现的三个核心缺陷：
 * 1. 同步 I/O + 忙等重试（`while (Date.now() - start < 50) {}`）会冻结整个事件循环；
 * 2. 直接 writeFileSync 覆盖目标文件，进程崩溃/并发读取时会产生空文件或半截 JSON；
 * 3. 并发请求的「读-改-写」互相覆盖，产生丢失更新（Lost Update）。
 *
 * 对应策略：全异步 I/O、临时文件 + rename 原子落盘、按文件路径串行化的互斥队列。
 */

/** 读取重试参数：文件可能被外部进程（如部署脚本）非原子地写入，短暂为空 */
const READ_RETRY_LIMIT = 5;
const READ_RETRY_DELAY_MS = 50;

/**
 * 解析结果缓存：filePath -> { mtimeMs, size, data }
 * 命中条件为 stat 的 mtime + size 均未变化，因此外部进程直接修改文件时缓存会自动失效。
 * @type {Map<string, {mtimeMs: number, size: number, data: unknown}>}
 */
const parseCache = new Map();

/**
 * 按 key 串行化异步任务的轻量互斥锁（promise 链队列）。
 * @type {Map<string, Promise<unknown>>}
 */
const lockQueues = new Map();

/**
 * 在指定 key 的互斥锁内执行任务；同一 key 上的任务严格按提交顺序执行。
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withLock(key, task) {
  const previous = lockQueues.get(key) ?? Promise.resolve();
  // 无论前序任务成败，后续任务都必须继续执行，否则一次失败会卡死整个队列
  const current = previous.then(task, task);
  lockQueues.set(key, current.catch(() => {}));
  return current;
}

/**
 * 读取并解析 JSON 文件（带缓存与空文件重试）。
 * 返回深拷贝，调用方可放心修改而不会污染缓存。
 *
 * @template T
 * @param {string} filePath
 * @param {T} defaultValue 文件不存在或多次重试仍失败时返回的兜底值
 * @returns {Promise<T>}
 */
export async function readJsonFile(filePath, defaultValue) {
  let lastError;
  for (let attempt = 0; attempt < READ_RETRY_LIMIT; attempt += 1) {
    try {
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch (err) {
        if (err.code === 'ENOENT') return structuredClone(defaultValue);
        throw err;
      }

      const cached = parseCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return structuredClone(cached.data);
      }

      const content = await fs.readFile(filePath, 'utf8');
      // 空文件视作「外部写入进行中」，抛错进入重试而不是当成合法数据
      if (!content.trim()) {
        throw new Error(`File is empty (possibly being written): ${filePath}`);
      }
      const data = JSON.parse(content);
      parseCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, data });
      return structuredClone(data);
    } catch (err) {
      lastError = err;
      await sleep(READ_RETRY_DELAY_MS);
    }
  }
  // 与旧实现保持一致：读取彻底失败时降级为兜底值，保证服务可用性优先
  console.error(`[DB] Error reading JSON file ${filePath} after ${READ_RETRY_LIMIT} retries:`, lastError);
  return structuredClone(defaultValue);
}

/**
 * 原子写入任意文件：先写同目录临时文件，再 rename 覆盖目标。
 * rename 在同一文件系统内是原子操作，读取方永远不会看到半截内容。
 *
 * @param {string} filePath
 * @param {string | Buffer} content
 * @returns {Promise<void>}
 */
export async function writeFileAtomic(filePath, content) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );
  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * 序列化并原子写入 JSON 文件，同时同步更新解析缓存。
 * 与旧实现不同：写入失败会向上抛出，而不是吞掉错误让调用方误以为保存成功。
 *
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
export async function writeJsonFile(filePath, data) {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
  const stat = await fs.stat(filePath);
  parseCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, data: structuredClone(data) });
}

/**
 * 对单个 JSON 文件执行互斥的「读-改-写」事务，消除并发丢失更新。
 * mutate 直接原地修改 data；其返回值会透传给调用方（例如返回更新后的列表）。
 *
 * @template T, R
 * @param {string} filePath
 * @param {T} defaultValue
 * @param {(data: T) => R | Promise<R>} mutate
 * @returns {Promise<R>}
 */
export function updateJsonFile(filePath, defaultValue, mutate) {
  return withLock(filePath, async () => {
    const data = await readJsonFile(filePath, defaultValue);
    const result = await mutate(data);
    await writeJsonFile(filePath, data);
    return result;
  });
}
