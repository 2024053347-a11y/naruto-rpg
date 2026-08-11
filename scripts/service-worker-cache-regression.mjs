import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { chromium } from 'playwright';

const serviceWorkerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
let release = 'old';
let childNetworkRequests = 0;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(`<!doctype html>
      <meta charset="utf-8">
      <script type="module" src="/entry.js?v=${release}"></script>`);
    return;
  }

  if (url.pathname === '/entry.js') {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });
    response.end(`
      import { childRelease } from './child.js';
      window.__moduleResult = { entryRelease: ${JSON.stringify(release)}, childRelease };
      window.__workerReady = navigator.serviceWorker.register('/sw.js')
        .then(() => navigator.serviceWorker.ready);
    `);
    return;
  }

  if (url.pathname === '/child.js') {
    childNetworkRequests += 1;
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });
    response.end(`export const childRelease = ${JSON.stringify(release)};`);
    return;
  }

  if (url.pathname === '/sw.js') {
    response.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      'Service-Worker-Allowed': '/'
    });
    response.end(serviceWorkerSource);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${origin}/?v=old`);
  await page.waitForFunction(() => window.__moduleResult?.childRelease === 'old');
  await page.evaluate(async () => {
    const registration = await window.__workerReady;
    if (navigator.serviceWorker.controller) return;
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      registration.active?.postMessage({ type: 'SKIP_WAITING' });
    });
  });

  release = 'new';
  await page.goto(`${origin}/?v=new`);
  await page.waitForFunction(() => window.__moduleResult?.entryRelease === 'new');
  const result = await page.evaluate(() => window.__moduleResult);

  assert.equal(result.entryRelease, 'new', 'versioned entry module must update');
  assert.equal(
    result.childRelease,
    'new',
    'an updated entry module must not reuse a fresh-but-stale unversioned child module'
  );
  assert.equal(childNetworkRequests, 2, 'the service worker must revalidate the child module');
  console.log('PASS service worker bypasses stale HTTP cache for ESM child modules');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
