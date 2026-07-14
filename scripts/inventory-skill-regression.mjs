import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { stateManager } from '../js/core/state-manager.js';
import { equipmentSystem } from '../js/systems/equipment-system.js';
import { skillSystem } from '../js/systems/skill-system.js';

let passed = 0;

function test(name, fn) {
  stateManager.reset();
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

test('discarding all equipment removes every stored field', () => {
  stateManager.update([
    { key: '物品·武器·测试刀·数量', op: '=', value: 3 },
    { key: '物品·武器·测试刀·品质', op: '=', value: '精良' },
    { key: '物品·武器·测试刀·描述', op: '=', value: '用于回归测试' }
  ]);
  assert.equal(equipmentSystem.removeItem('weapons', '测试刀', 999999), true);
  const keys = Object.keys(stateManager.state).filter(key => key.startsWith('物品·武器·测试刀'));
  assert.deepEqual(keys, []);
  assert.equal(stateManager.get().equipment.weapons['测试刀'], undefined);
});

test('discarding a legacy field-only item removes the visible remnant', () => {
  stateManager.update([
    { key: '物品·防具·旧护甲·品质', op: '=', value: '普通' },
    { key: '物品·防具·旧护甲·描述', op: '=', value: '没有数量字段' }
  ]);
  assert.equal(equipmentSystem.removeItem('armor', '旧护甲', 999999), true);
  const keys = Object.keys(stateManager.state).filter(key => key.startsWith('物品·防具·旧护甲'));
  assert.deepEqual(keys, []);
});

test('discarding equipped gear clears its slot and bonus', () => {
  stateManager.update([
    { key: '物品·武器·装备刀·数量', op: '=', value: 1 },
    { key: '物品·武器·装备刀·品质', op: '=', value: '精良' }
  ]);
  const initialSpeed = stateManager.get('属性·速度');
  assert.equal(equipmentSystem.equip('weapon', '装备刀', 'weapons'), true);
  assert.ok(stateManager.get('属性·速度') > initialSpeed);
  assert.equal(equipmentSystem.removeItem('weapons', '装备刀', 999999), true);
  assert.equal(stateManager.get('物品·已装备·武器'), '');
  assert.equal(stateManager.get('属性·速度'), initialSpeed);
});

test('forgetting a flat skill removes every field', () => {
  stateManager.update([
    { key: '技能·忍术·豪火球·等级', op: '=', value: 'C' },
    { key: '技能·忍术·豪火球·熟练度', op: '=', value: 60 },
    { key: '技能·忍术·豪火球·描述', op: '=', value: '喷出火球' }
  ]);
  assert.equal(skillSystem.forgetSkill('jutsu', '豪火球'), true);
  assert.deepEqual(Object.keys(stateManager.state).filter(key => key.startsWith('技能·忍术·豪火球')), []);
});

test('forgetting support and legacy object skills uses the correct category', () => {
  const snapshot = stateManager.getDefaultState();
  snapshot['技能·支援·医疗术·等级'] = 'B';
  snapshot['技能·支援·医疗术·熟练度'] = 40;
  snapshot['技能·体术·木叶旋风'] = { rank: 'C', mastery: 30 };
  stateManager.restore(snapshot);
  assert.equal(skillSystem.forgetSkill('support', '医疗术'), true);
  assert.equal(skillSystem.forgetSkill('taijutsu', '木叶旋风'), true);
  assert.deepEqual(Object.keys(stateManager.state).filter(key => key.includes('医疗术') || key.includes('木叶旋风')), []);
});

test('skill forget buttons bind outside the equipment-only block', () => {
  const source = readFileSync(new URL('../js/ui/panel.js', import.meta.url), 'utf8');
  assert.match(source, /}\s*this\.shadowRoot\.querySelectorAll\('\.skill-forget-btn'\)/);
  assert.match(source, /skillSystem\.forgetSkill\(type, name\)/);
  assert.doesNotMatch(source, /support:\s*'辅助'/);
});

console.log(`\n${passed} inventory/skill regression tests passed.`);
