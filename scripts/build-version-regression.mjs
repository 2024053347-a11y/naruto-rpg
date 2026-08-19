import assert from 'node:assert/strict';

import {
  inspectRuntimeBuild,
  readLoadedBuild,
  showStaleBuildNotice
} from '../js/utils/build-version.js';

const script = { src: 'https://www.qiwu.asia:8080/js/app.js?v=2608172301' };
const documentRef = {
  querySelector: selector => selector.includes('app.js') ? script : null
};

assert.equal(readLoadedBuild(documentRef), '2608172301');

let request = null;
const stale = await inspectRuntimeBuild({
  documentRef,
  locationRef: { href: 'https://www.qiwu.asia:8080/index.html' },
  fetchImpl: async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({ version: '3.5.0', build: '2608172302', environment: 'staging' })
    };
  }
});

assert.equal(stale.loadedBuild, '2608172301');
assert.equal(stale.latestBuild, '2608172302');
assert.equal(stale.stale, true);
assert.equal(request.options.cache, 'no-store');
assert.match(request.url, /version\.json\?_runtime_check=/);

let reloaded = false;
let appended = null;
const elements = new Map();
const fakeDocument = {
  getElementById: id => elements.get(id) || null,
  createElement: tag => {
    const listeners = {};
    const node = {
      tag,
      children: [],
      style: {},
      setAttribute() {},
      addEventListener(type, listener) { listeners[type] = listener; },
      append(...children) { this.children.push(...children); },
      _listeners: listeners
    };
    Object.defineProperty(node, 'id', {
      get() { return this._id || ''; },
      set(value) { this._id = value; elements.set(value, this); }
    });
    return node;
  },
  body: { appendChild(node) { appended = node; } }
};
const notice = showStaleBuildNotice(stale, {
  documentRef: fakeDocument,
  locationRef: { reload: () => { reloaded = true; } }
});
assert.equal(notice, appended);
assert.match(notice.children[0].textContent, /当前 2608172301，最新 2608172302/);
notice.children[1]._listeners.click();
assert.equal(reloaded, true);
assert.equal(showStaleBuildNotice(stale, { documentRef: fakeDocument }), notice, 'notice must be idempotent');

console.log('✓ runtime build version regression passed');
