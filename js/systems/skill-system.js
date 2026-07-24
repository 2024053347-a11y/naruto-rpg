import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';

const TYPE_NAMES = {
  jutsu: ['忍术'],
  taijutsu: ['体术'],
  genjutsu: ['幻术'],
  support: ['支援', '辅助'],
  talents: ['天赋'],
  kekkei_genkai: ['血继限界']
};

class SkillSystem {
  forgetSkill(type, name) {
    const skillName = String(name || '').trim();
    const categories = TYPE_NAMES[type] || [];
    if (!skillName || !categories.length) return false;

    const keys = [];
    for (const category of categories) {
      const baseKey = `技能·${category}·${skillName}`;
      for (const key of Object.keys(stateManager.state)) {
        if (key === baseKey || key.startsWith(`${baseKey}·`)) keys.push(key);
      }
    }
    if (!keys.length) return false;

    stateManager.update([...new Set(keys)].map(key => ({ key, op: 'delete' })));
    eventBus.emit('skill:forgotten', { type, name: skillName });
    return true;
  }
}

export const skillSystem = new SkillSystem();
export default skillSystem;
