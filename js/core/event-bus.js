class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) this._listeners.delete(event);
    }
  }

  emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          const result = callback(data);
          if (result && typeof result.then === 'function') {
            result.catch(e => console.error(`[EventBus] ${event} async:`, e));
          }
        } catch (e) { console.error(`[EventBus] ${event}:`, e); }
      }
    }
    const wildcards = this._listeners.get('*');
    if (wildcards) {
      for (const callback of wildcards) {
        try {
          const result = callback(event, data);
          if (result && typeof result.then === 'function') {
            result.catch(e => console.error(`[EventBus] * async:`, e));
          }
        } catch (e) { console.error(`[EventBus] *:`, e); }
      }
    }
  }

  async request(event, data) {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.size === 0) {
      throw new Error(`[EventBus] No request handler registered for ${event}`);
    }
    if (listeners.size !== 1) {
      throw new Error(`[EventBus] Request ${event} requires exactly one handler`);
    }
    const [handler] = listeners;
    return handler(data);
  }

  once(event, callback) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }

  clear() {
    this._listeners.clear();
  }

  // B-27: 返回绑定了 eventBus 的订阅袋，方便组件批量取消
  createDisposeBag() {
    const subs = [];
    return {
      on: (event, callback) => {
        const unsub = this.on(event, callback);
        subs.push(unsub);
      },
      once: (event, callback) => {
        const wrapper = (data) => {
          this.off(event, wrapper);
          callback(data);
        };
        subs.push(this.on(event, wrapper));
      },
      dispose: () => {
        for (const unsub of subs) unsub();
        subs.length = 0;
      }
    };
  }
}

export const eventBus = new EventBus();
export default eventBus;
