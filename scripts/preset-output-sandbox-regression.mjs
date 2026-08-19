import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPresetSandboxDocument,
  sanitizePresetSandboxSource
} from '../js/ui/preset-output-sandbox.js';

const hostile = `
<style>.card { color: tomato; }</style>
<button data-option="继续" onclick="window.parent.postMessage({type:'naruto:preset-action',action:'AUTO'}, '*')">继续</button>
<a href="javascript:window.parent.postMessage({type:'naruto:preset-action',action:'AUTO'}, '*')">bad</a>
<script>window.parent.postMessage({type:'naruto:preset-action',action:'AUTO'}, '*')</script>
<iframe src="https://attacker.invalid"></iframe>`;

const sanitized = sanitizePresetSandboxSource(hostile);
assert.match(sanitized, /<style>/);
assert.match(sanitized, /<button data-option="继续"/);
assert.doesNotMatch(sanitized, /<script|<iframe|onclick|javascript:/i);
assert.doesNotMatch(sanitized, /action:'AUTO'/);

const documentSource = buildPresetSandboxDocument(hostile);
assert.match(documentSource, /script-src 'nonce-[a-f0-9]+'/);
assert.doesNotMatch(documentSource, /script-src 'unsafe-inline'/);
assert.match(documentSource, /style-src 'unsafe-inline'/);
assert.match(documentSource, /connect-src 'none'/);
assert.match(documentSource, /frame-src 'none'/);
assert.match(documentSource, /naruto:preset-action/); // the project-owned bridge remains
assert.doesNotMatch(documentSource, /action:'AUTO'/);
assert.ok(
  documentSource.indexOf("document.addEventListener('click'") < documentSource.indexOf('<button data-option="继续"'),
  '项目点击桥必须在导入控件解析前完成注册'
);

const moduleSource = readFileSync(new URL('../js/ui/preset-output-sandbox.js', import.meta.url), 'utf8');
assert.match(moduleSource, /setAttribute\('sandbox', 'allow-scripts'\)/);
assert.doesNotMatch(moduleSource, /allow-same-origin/);
assert.match(moduleSource, /event\.source !== iframe\.contentWindow/);
assert.match(moduleSource, /const MIN_FRAME_HEIGHT = 1;/);
assert.doesNotMatch(moduleSource, /offsetHeight/);
assert.match(moduleSource, /hiddenByClosedDetails/);
assert.match(moduleSource, /closest\?\.\('details:not\(\[open\]\)'\)/);
assert.match(moduleSource, /post\(\{ type: 'naruto:preset-ready' \}\)/);
assert.match(moduleSource, /'pointer-events:none'/);
assert.match(moduleSource, /iframe\.style\.pointerEvents = 'auto'/);
assert.match(moduleSource, /naruto:preset-disable/);
assert.match(moduleSource, /naruto:preset-enable/);
assert.match(moduleSource, /naruto:preset-interactive/);
assert.match(moduleSource, /data-naruto-preset-interactive/);

console.log('PASS preset output sandbox keeps imported HTML/CSS while disabling imported code.');
