import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  IMPORTED_PRESET_DEBUG_GLOBAL_KEY,
  clearImportedPresetDebugLog,
  readImportedPresetDebugLog,
  recordImportedPresetDebugFailure
} from '../js/core/imported-preset-debug-log.js';

const writes = [];
const fakeStorage = {
  setItem(key, value) { writes.push([String(key), String(value)]); },
  getItem() { return null; },
  removeItem(key) { writes.push(['remove', String(key)]); }
};
const host = { localStorage: fakeStorage };
host.window = host;
const consoleLines = [];
const fakeConsole = Object.fromEntries(
  ['warn', 'groupCollapsed', 'log', 'error', 'info', 'groupEnd']
    .map(method => [method, (...args) => consoleLines.push([method, ...args])])
);

const rawResponse = [
  '<think>模型私密推演',
  '<simple_thinking>局部推演</think>',
  '<state_update>{"changed":false}</state_update>',
  '<memory>{"summary":"原始记忆"}</memory>',
  '<shinobi_daily>{"headline":"原始日报"}</shinobi_daily>'
].join('\n');
const projectedResponse = `<dream_plot>\n${rawResponse}`;
const validationResponse = `${projectedResponse}\n</simple_thinking>`;
const error = new Error('dream_plot 根节点缺失且思考标签交叉闭合');
error.code = 'IMPORTED_PRESET_OUTPUT_INCOMPLETE';
error.details = { errors: ['<simple_thinking> 与 <think> 发生交叉闭合'] };

const first = recordImportedPresetDebugFailure({
  build: '260818-test',
  latestBuild: '260818-test',
  adapterId: 'dream-whale-v4',
  presetRevision: 'revision-a',
  stage: 'initial-envelope',
  error,
  rawResponse,
  projectedResponse,
  validationResponse
}, { globalRef: host, consoleRef: fakeConsole });

assert.equal(first.rawResponse, rawResponse, '模型原文不得被清理、修复或截断');
assert.equal(first.projectedResponse, projectedResponse);
assert.equal(first.validationResponse, validationResponse);
assert.deepEqual(first.structureErrors, ['<simple_thinking> 与 <think> 发生交叉闭合']);
assert.equal(readImportedPresetDebugLog({ globalRef: host }), first);
assert.equal(host[IMPORTED_PRESET_DEBUG_GLOBAL_KEY], first);
assert.equal(Object.prototype.propertyIsEnumerable.call(host, IMPORTED_PRESET_DEBUG_GLOBAL_KEY), false,
  '诊断对象不得参与普通全局枚举或序列化');
assert.equal(writes.length, 0, '诊断日志不得写入 localStorage');
assert.ok(consoleLines.some(line => String(line[1] || '').includes(rawResponse)),
  '控制台必须输出未经改写的完整模型原文');
assert.ok(consoleLines.some(line => String(line[1] || '').includes('copy(window.__NARUTO_PRESET_DEBUG__.rawResponse)')),
  '控制台必须给出一键复制命令');

const secondRaw = '<think_fox~>SECOND_FAILURE</think_fox~>';
const second = recordImportedPresetDebugFailure({
  adapterId: 'fox-v18',
  stage: 'post-machine-processing',
  error,
  rawResponse: secondRaw,
  projectedResponse: secondRaw,
  validationResponse: secondRaw
}, { globalRef: host, consoleRef: fakeConsole });
assert.equal(readImportedPresetDebugLog({ globalRef: host }), second,
  '下一次失败必须覆盖全局对象中的旧日志');
assert.equal(second.rawResponse, secondRaw);
assert.equal(writes.length, 0);

assert.equal(clearImportedPresetDebugLog({ globalRef: host }), true);
assert.equal(readImportedPresetDebugLog({ globalRef: host }), null,
  '新回合开始时必须移除上一次瞬时日志');

const pipelineSource = await fs.readFile(new URL('../js/core/pipeline.js', import.meta.url), 'utf8');
assert.match(pipelineSource, /clearImportedPresetDebugLog\(\)/,
  '管线必须在每个新回合开始时清除旧日志');
assert.match(pipelineSource, /recordImportedPresetDebugFailure\(\{/,
  '管线必须在导入预设结构失败时记录原始响应');
assert.match(pipelineSource, /rawResponse:\s*modelRawResponse/,
  '管线日志必须使用模型返回值，而不是 cleanupResponse 的结果');
assert.doesNotMatch(pipelineSource, /localStorage\.setItem\([^\n]*NARUTO_PRESET_DEBUG/,
  '管线不得持久化导入预设诊断');

const appShellSource = await fs.readFile(new URL('../js/ui/app-shell.js', import.meta.url), 'utf8');
assert.match(appShellSource, /复制完整 AI 回复/);
assert.match(appShellSource, /\[ImportedPresetDebug\]/);

console.log('✓ imported preset debug log regression passed');
