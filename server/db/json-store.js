// @ts-check
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/** 读取重试次数：容忍外部进程（如人工编辑、运维脚本）写到一半的瞬时状态 */
const READ_MAX_ATTEMPTS = 5;
/** 每次读取重试之间的等待毫秒数 */
const READ_RETRY_DELAY_MS = 50;

/**
 * @template T
 * @typedef {Object} MutationOutcome
 * @property {boolean} persist 是否需要把变更落盘（no-op 场景返回 false，避免无意义 I/O）
 * @property {T} [result] 透传给调用方的返回值
 */

/**
 * JsonStore —— 单个 JSON 文档的持久化封装。
 *
 * 设计约束：
 * - 所有 I/O 均为异步，绝不阻塞事件循环；
 * - 写入采用「临时文件 + 原子 rename」，磁盘上永远不存在半截 JSON；
 * - 所有「读-改-写」通过实例内的 Promise 链串行化，
 *   保证并发请求之间不会互相覆盖（等价于旧版同步 I/O 隐含的原子性）。
 */
export class JsonStore {
  /** @type {string} */
  #filePath;
  /** @type {Record<string, any>} */
  #defaultValue;
  /**
   * 串行化互斥锁：每个「读-改-写」事务都追加到该链尾部。
   * @type {Promise<unknown>}
   */
  #writeChain = Promise.resolve();

  /**
   * @param {string} filePath JSON 文档的绝对路径
   * @param {Record<string, any>} [defaultValue] 文件缺失/损坏时的兜底文档
   */
  constructor(filePath, defaultValue = {}) {
    this.#filePath = filePath;
    this.#defaultValue = defaultValue;
  }

  /** @returns {string} */
  get filePath() {
    return this.#filePath;
  }

  /**
   * 确保文件存在；不存在则以兜底文档初始化。
   * @returns {Promise<void>}
   */
  async ensureExists() {
    await this.#enqueue(async () => {
      try {
        await fs.access(this.#filePath);
      } catch {
        await this.#writeAtomic(this.#defaultValue);
      }
    });
  }

  /**
   * 读取整个文档。文件缺失返回兜底文档的深拷贝；
   * 文件为空或损坏时按旧版语义重试后降级为兜底文档（记录错误，不抛出）。
   * @returns {Promise<Record<string, any>>}
   */
  async read() {
    let lastErr;
    for (let attempt = 1; attempt <= READ_MAX_ATTEMPTS; attempt++) {
      try {
        const content = await fs.readFile(this.#filePath, 'utf8');
        if (!content.trim()) {
          // 可能有外部写入者只写了一半，等待后重试
          throw new Error('File is empty (possibly being written)');
        }
        return JSON.parse(content);
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
          return structuredClone(this.#defaultValue);
        }
        lastErr = err;
        await sleep(READ_RETRY_DELAY_MS);
      }
    }
    console.error(
      `[DB] Error reading JSON file ${this.#filePath} after ${READ_MAX_ATTEMPTS} retries:`,
      lastErr
    );
    return structuredClone(this.#defaultValue);
  }

  /**
   * 原子的「读-改-写」事务。mutate 收到最新文档并就地修改，
   * 返回 { persist, result }；persist 为 true 时文档被原子落盘。
   * mutate 抛出的异常会原样传给调用方，且不会污染后续事务。
   *
   * @template T
   * @param {(doc: Record<string, any>) => MutationOutcome<T> | Promise<MutationOutcome<T>>} mutate
   * @returns {Promise<T | undefined>}
   */
  async update(mutate) {
    return this.#enqueue(async () => {
      const doc = await this.read();
      const { persist, result } = await mutate(doc);
      if (persist) {
        await this.#writeAtomic(doc);
      }
      return result;
    });
  }

  /**
   * 把任务追加到互斥链尾部执行。失败会向调用方抛出，
   * 但链本身吞掉 rejection，保证后续任务不被上一个失败阻断。
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  #enqueue(task) {
    const run = this.#writeChain.then(task);
    this.#writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * 先写临时文件再 rename，使写入对读取方原子可见。
   * @param {Record<string, any>} doc
   * @returns {Promise<void>}
   */
  async #writeAtomic(doc) {
    const payload = JSON.stringify(doc, null, 2);
    const tmpPath = `${this.#filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, payload, 'utf8');
    try {
      await fs.rename(tmpPath, this.#filePath);
    } catch (renameErr) {
      // 个别 Windows 环境下目标文件被占用会导致 rename 失败，
      // 此时退回直接覆盖写，保证数据不丢（牺牲这一次的原子性）
      await fs.rm(tmpPath, { force: true });
      await fs.writeFile(this.#filePath, payload, 'utf8');
    }
  }
}
