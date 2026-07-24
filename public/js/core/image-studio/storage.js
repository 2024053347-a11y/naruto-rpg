export const IMAGE_DB_NAME = 'naruto_rpg_images';
export const IMAGE_DB_VERSION = 1;
export const IMAGE_DB_STORES = Object.freeze(['jobs', 'blobs', 'asset_cache', 'outbox']);

function clone(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function sortJobs(jobs) {
  return jobs.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0)
    || String(a.createdAt).localeCompare(String(b.createdAt))
    || String(a.id).localeCompare(String(b.id)));
}

export class MemoryImageStore {
  constructor() {
    this.kind = 'memory';
    this.stores = new Map(IMAGE_DB_STORES.map(name => [name, new Map()]));
    this.serial = Promise.resolve();
  }

  async ready() { return this; }

  _store(name) {
    const store = this.stores.get(name);
    if (!store) throw new TypeError(`Unknown image store: ${name}`);
    return store;
  }

  async get(storeName, id) { return clone(this._store(storeName).get(id)); }

  async put(storeName, value) {
    if (!value?.id) throw new TypeError(`${storeName} record requires id`);
    this._store(storeName).set(value.id, clone(value));
    return clone(value);
  }

  async delete(storeName, id) { return this._store(storeName).delete(id); }

  async getAll(storeName) { return [...this._store(storeName).values()].map(clone); }

  async compareAndSwap(storeName, id, expectedRevision, update) {
    return this._exclusive(async () => {
      const store = this._store(storeName);
      const current = clone(store.get(id));
      const revision = Number(current?.revision) || 0;
      if (expectedRevision !== undefined && revision !== expectedRevision) {
        return { ok: false, current };
      }
      const next = typeof update === 'function' ? await update(current) : update;
      if (next === undefined) return { ok: false, current };
      if (next === null) store.delete(id);
      else store.set(id, clone({ ...next, id, revision: revision + 1 }));
      return { ok: true, current: clone(store.get(id)) };
    });
  }

  async updateIfRevision(storeName, id, expectedRevision, update) {
    return this._exclusive(async () => {
      const store = this._store(storeName);
      const current = clone(store.get(id));
      const revision = Number(current?.revision) || 0;
      if (revision !== Number(expectedRevision || 0)) return { ok: false, current };
      const next = typeof update === 'function' ? await update(current) : update;
      if (next === undefined) return { ok: false, current };
      if (next === null) store.delete(id);
      else store.set(id, clone({ ...next, id, revision: Number(next.revision ?? revision) || 0 }));
      return { ok: true, current: clone(store.get(id)) };
    });
  }

  async claimNextJob(executorId, now = Date.now()) {
    return this._exclusive(async () => {
      const store = this._store('jobs');
      const eligible = sortJobs([...store.values()].filter(job => job.state === 'queued'
        && (!job.notBefore || new Date(job.notBefore).getTime() <= now)));
      const job = eligible[0];
      if (!job) return null;
      const claimed = {
        ...job,
        state: 'planning',
        executorId,
        startedAt: job.startedAt || new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        revision: (Number(job.revision) || 0) + 1
      };
      store.set(job.id, clone(claimed));
      return clone(claimed);
    });
  }

  _exclusive(work) {
    const result = this.serial.then(work, work);
    this.serial = result.catch(() => {});
    return result;
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

export class IndexedDbImageStore {
  constructor({ indexedDB = globalThis.indexedDB, name = IMAGE_DB_NAME } = {}) {
    if (!indexedDB) throw new Error('IndexedDB is unavailable');
    this.kind = 'indexeddb';
    this.indexedDB = indexedDB;
    this.name = name;
    this.openPromise = null;
  }

  async ready() {
    await this._db();
    return this;
  }

  _db() {
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.name, IMAGE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of IMAGE_DB_STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        const jobs = request.transaction.objectStore('jobs');
        if (!jobs.indexNames.contains('state')) jobs.createIndex('state', 'state', { unique: false });
        if (!jobs.indexNames.contains('idempotencyKey')) jobs.createIndex('idempotencyKey', 'idempotencyKey', { unique: false });
        if (!jobs.indexNames.contains('targetKey')) jobs.createIndex('targetKey', 'targetKey', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open image database'));
      request.onblocked = () => reject(new Error('Image database upgrade is blocked by another tab'));
    });
    return this.openPromise;
  }

  async get(storeName, id) {
    const db = await this._db();
    const tx = db.transaction(storeName, 'readonly');
    return requestResult(tx.objectStore(storeName).get(id));
  }

  async getAll(storeName) {
    const db = await this._db();
    const tx = db.transaction(storeName, 'readonly');
    return requestResult(tx.objectStore(storeName).getAll());
  }

  async put(storeName, value) {
    if (!value?.id) throw new TypeError(`${storeName} record requires id`);
    const db = await this._db();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    await transactionDone(tx);
    return value;
  }

  async delete(storeName, id) {
    const db = await this._db();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    await transactionDone(tx);
    return true;
  }

  async compareAndSwap(storeName, id, expectedRevision, update) {
    const db = await this._db();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const current = await requestResult(store.get(id));
    const revision = Number(current?.revision) || 0;
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      tx.abort();
      try { await transactionDone(tx); } catch { /* deliberate abort */ }
      return { ok: false, current };
    }
    const next = typeof update === 'function' ? await update(current) : update;
    if (next === undefined) {
      tx.abort();
      try { await transactionDone(tx); } catch { /* deliberate abort */ }
      return { ok: false, current };
    }
    if (next === null) store.delete(id);
    else store.put({ ...next, id, revision: revision + 1 });
    await transactionDone(tx);
    return { ok: true, current: next === null ? undefined : { ...next, id, revision: revision + 1 } };
  }

  async updateIfRevision(storeName, id, expectedRevision, update) {
    const db = await this._db();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const current = await requestResult(store.get(id));
    const revision = Number(current?.revision) || 0;
    if (revision !== Number(expectedRevision || 0)) {
      tx.abort();
      try { await transactionDone(tx); } catch { /* deliberate abort */ }
      return { ok: false, current };
    }
    const next = typeof update === 'function' ? await update(current) : update;
    if (next === undefined) {
      tx.abort();
      try { await transactionDone(tx); } catch { /* deliberate abort */ }
      return { ok: false, current };
    }
    if (next === null) store.delete(id);
    else store.put({ ...next, id, revision: Number(next.revision ?? revision) || 0 });
    await transactionDone(tx);
    return {
      ok: true,
      current: next === null ? undefined : { ...next, id, revision: Number(next.revision ?? revision) || 0 }
    };
  }

  async claimNextJob(executorId, now = Date.now()) {
    const db = await this._db();
    const tx = db.transaction('jobs', 'readwrite');
    const store = tx.objectStore('jobs');
    const all = await requestResult(store.getAll());
    const job = sortJobs(all.filter(item => item.state === 'queued'
      && (!item.notBefore || new Date(item.notBefore).getTime() <= now)))[0];
    if (!job) {
      await transactionDone(tx);
      return null;
    }
    const claimed = {
      ...job,
      state: 'planning',
      executorId,
      startedAt: job.startedAt || new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      revision: (Number(job.revision) || 0) + 1
    };
    store.put(claimed);
    await transactionDone(tx);
    return claimed;
  }
}

export function createImageStore({ indexedDB = globalThis.indexedDB, memory = false, name } = {}) {
  return !memory && indexedDB
    ? new IndexedDbImageStore({ indexedDB, name })
    : new MemoryImageStore();
}
