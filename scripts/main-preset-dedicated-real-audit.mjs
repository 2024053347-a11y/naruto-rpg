import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { compileMainPresetImport } from '../js/data/main-preset-import.js';
import {
  buildImportedPresetModePrompt,
  inspectImportedPresetOutputProfile,
  repairImportedPresetOutputEnvelope,
  validateImportedPresetOutputEnvelope
} from '../js/core/main-preset-compatibility.js';
import { buildPresetPresentation } from '../js/core/preset-regex-runtime.js';

const expectedAdapters = ['fox-v18', 'izumi-0707', 'dream-whale-v4', 'miemie-v5'];
const paths = process.argv.slice(2);
const responseFixtures = [
  '狐神 continuation 推演</think_fox~><content>狐神正文<state_update>{"changed":false}</state_update></content><fox_selc>【默认】继续</fox_selc><fox_tip>留言</fox_tip>',
  '规划内快照：<current_event>旧事件</current_event><progress>旧进度</progress></konatan_planning~>Izumi正文<current_event>事件</current_event><state_update>{"changed":false}</state_update><progress>进度</progress><tucao>吐槽</tucao>',
  '一、检设定：根节点示例 `<dream_plot>`，正文示例 `<dream_body>`，后置示例 `<dream_after_format>`。</think><dream_plot><dream_body><dream_scene><date>木叶历60年</date><time>午后</time><location>训练场</location></dream_scene>梦鲸正文</dream_body><dream_after_format><dream_parallel_event><simple_thinking>局部推演</simple_thinking>平行事件</dream_parallel_event><state_update>{"changed":false}</state_update></dream_after_format></dream_plot>',
  '<think>think is over...</think><acg_think>判断<combat_driver>无</combat_driver></acg_think><story_driver>推演<story_scene>咩咩正文</story_driver></story_scene><memory_log>记忆</memory_log><wlog time="午后">世界</wlog><state_update>{"changed":false}</state_update><status>状态</status><affinity>关系</affinity>'
];

if (paths.length !== expectedAdapters.length) {
  console.error('用法: node scripts/main-preset-dedicated-real-audit.mjs <狐神抚.json> <Izumi.json> <梦鲸.json> <咩咩.json>');
  process.exitCode = 2;
} else {
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    const sourceBytes = await readFile(path);
    const beforeHash = createHash('sha256').update(sourceBytes).digest('hex');
    const sourceText = sourceBytes.toString('utf8');
    const source = JSON.parse(sourceText);
    const sourceSnapshot = JSON.stringify(source);
    const preset = compileMainPresetImport(source, { fileName: path.split(/[\\/]/).at(-1) });
    const compiledSnapshot = JSON.stringify(preset);
    const profile = inspectImportedPresetOutputProfile(preset);

    assert.equal(profile.adapterId, expectedAdapters[index], `${path} adapter mismatch`);
    assert.deepEqual(profile.adapterMatches, [expectedAdapters[index]], `${path} must select uniquely`);
    assert.equal(JSON.stringify(source), sourceSnapshot, `${path} source object mutated`);
    assert.equal(JSON.stringify(preset), compiledSnapshot, `${path} compiled preset mutated during inspection`);

    const prompt = buildImportedPresetModePrompt({ updaterEnabled: false, profile });
    assert.match(prompt, new RegExp(profile.adapterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const repaired = repairImportedPresetOutputEnvelope(responseFixtures[index], profile);
    const validation = validateImportedPresetOutputEnvelope(repaired, profile);
    assert.equal(validation.valid, true, `${path}: ${validation.errors.join('；')}`);
    const presentation = buildPresetPresentation(repaired, `${profile.adapterId} 正文`, preset.regexScripts, {
      adapterId: profile.adapterId
    });
    assert.ok(['structured', 'markdown', 'sandbox'].includes(presentation.kind));
    assert.equal(JSON.stringify(source), sourceSnapshot, `${path} source mutated after runtime adaptation`);
    assert.equal(JSON.stringify(preset), compiledSnapshot, `${path} preset mutated after prompt/repair/regex`);

    const afterBytes = await readFile(path);
    const afterHash = createHash('sha256').update(afterBytes).digest('hex');
    assert.equal(afterHash, beforeHash, `${path} file bytes changed during read-only audit`);
    console.log(JSON.stringify({
      adapterId: profile.adapterId,
      sha256: afterHash,
      enabledRegexCount: preset.regexScripts.filter(row => row.enabled !== false && row.disabled !== true).length
    }));
  }
  console.log('✓ four real imported presets passed the read-only dedicated-adapter audit');
}
