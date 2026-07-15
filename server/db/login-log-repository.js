// @ts-check
import { JsonStore } from './json-store.js';

const MAX_LOGIN_LOG_ENTRIES = 10000;
const TRIMMED_LOGIN_LOG_ENTRIES = 5000;

export class LoginLogRepository {
  #store;

  constructor(filePath) {
    this.#store = new JsonStore(filePath, []);
  }

  async init() {
    await this.#store.ensureExists();
  }

  async record(user) {
    await this.#store.update((entries) => {
      if (!Array.isArray(entries)) throw new TypeError('Login log must be an array');
      const log = entries;
      const now = new Date();
      log.push({
        id: user.id,
        username: user.username,
        date: now.toISOString().slice(0, 10),
        time: now.toISOString()
      });
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const recent = log.filter((entry) => entry?.date >= cutoff);
      const bounded = recent.length > MAX_LOGIN_LOG_ENTRIES
        ? recent.slice(-TRIMMED_LOGIN_LOG_ENTRIES)
        : recent;
      entries.splice(0, entries.length, ...bounded);
      return { persist: true };
    });
  }

  async list() {
    const entries = await this.#store.read();
    if (!Array.isArray(entries)) throw new TypeError('Login log must be an array');
    return entries;
  }
}
