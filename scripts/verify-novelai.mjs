import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

const port = await (async () => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  s.close();
  await once(s, 'close');
  return p;
})();

const child = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    AUTH_BYPASS: 'true',
    TRUST_PROXY: ''
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stderr.setEncoding('utf8');
let stderr = '';
child.stderr.on('data', (c) => { stderr += c; });
child.stdout.resume();

let ready = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/login.html`); if (r.ok) { ready = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
if (!ready) { console.error('server not ready\n' + stderr); child.kill(); process.exit(1); }

const body = JSON.stringify({
  input: 'test prompt',
  model: 'nai-diffusion-3',
  action: 'generate',
  parameters: { params_version: 3, width: 512, height: 512, steps: 3, n_samples: 1 }
});

const res = await fetch(`http://127.0.0.1:${port}/api/ai-proxy`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/zip',
    'x-target-url': 'https://image.novelai.net/ai/generate-image',
    'x-user-api-key': 'fake-token',
    'x-api-key-header': 'Authorization',
    'x-proxy-purpose': 'image-generation'
  },
  body
});
const text = await res.text();
console.log('STATUS:', res.status);
console.log('CTYPE:', res.headers.get('content-type'));
console.log('BODY_HEAD:', text.slice(0, 300));
child.kill();
