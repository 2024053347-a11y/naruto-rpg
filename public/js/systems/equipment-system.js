import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';

const CAT_CN = { weapons: '武器', armor: '防具', tools: '道具', consumables: '消耗品' };
const CAT_EN = { '武器': 'weapons', '防具': 'armor', '道具': 'tools', '消耗品': 'consumables' };
const SLOT_KEYS = {
  weapon: '物品·已装备·武器',
  armor: '物品·已装备·防具',
  accessory1: '物品·已装备·饰品1',
  accessory2: '物品·已装备·饰品2'
};
const SLOT_TO_CAT = { weapon: 'weapons', armor: 'armor', accessory1: 'tools', accessory2: 'tools' };

const QUALITY_BONUS = {
  '破烂': { power: 0, defense: 0, attr: 0 },
  '普通': { power: 3, defense: 1, attr: 0 },
  '精良': { power: 8, defense: 3, attr: 1 },
  '优秀': { power: 15, defense: 6, attr: 2 },
  '史诗': { power: 25, defense: 10, attr: 4 },
  '传说': { power: 40, defense: 18, attr: 7 }
};

class EquipmentSystem {
  getEquipped(slot) {
    const equipped = {};
    for (const [s, key] of Object.entries(SLOT_KEYS)) {
      const name = stateManager.get(key);
      if (name) {
        const cat = SLOT_TO_CAT[s] || 'tools';
        equipped[s] = { name, category: cat };
      }
    }
    return slot ? (equipped[slot] || null) : equipped;
  }

  equip(slot, name, category) {
    const slotKey = SLOT_KEYS[slot];
    if (!slotKey) return false;

    const prev = stateManager.get(slotKey);
    if (prev) this.unequip(slot);

    const catCN = CAT_CN[category] || '道具';
    const qtyKey = `物品·${catCN}·${name}·数量`;
    let qty = stateManager.get(qtyKey);

    // Legacy support: if it was stored as an object
    const legacyObj = stateManager.get(`物品·${catCN}·${name}`);
    if (legacyObj && typeof legacyObj === 'object') {
       qty = legacyObj.quantity || 1;
    }

    let hasItem = !!qty;
    // For AI generated armor/weapons, they might only have '名称' or '描述' but no '数量'
    if (!hasItem) {
      for (const k of Object.keys(stateManager.state)) {
        if (k.startsWith(`物品·${catCN}·${name}·`)) {
          hasItem = true;
          break;
        }
      }
    }

    if (category !== 'consumables' && !hasItem) return false;

    const updates = [
      { key: slotKey, op: '=', value: name }
    ];

    if (category === 'consumables' && Number(qty) > 0) {
      updates.push({ key: qtyKey, op: '-', value: 1 });
    }

    stateManager.update(updates);
    this._applyEquipBonus(name, category, 'add');
    eventBus.emit('equipment:equipped', { slot, name, category });
    return true;
  }

  unequip(slot) {
    const slotKey = SLOT_KEYS[slot];
    if (!slotKey) return false;
    const name = stateManager.get(slotKey);
    if (!name) return false;

    const category = this._findItemCategory(name);
    if (category) this._applyEquipBonus(name, category, 'remove');

    stateManager.update([{ key: slotKey, op: '=', value: '' }]);
    eventBus.emit('equipment:unequipped', { slot, name });
    return true;
  }

  _findItemCategory(name) {
    for (const [cn, en] of Object.entries(CAT_EN)) {
      const baseKey = `物品·${cn}·${name}`;
      const qty = stateManager.get(`${baseKey}·数量`);
      const legacy = stateManager.get(baseKey);
      const hasFields = Object.keys(stateManager.state).some(key => key.startsWith(`${baseKey}·`));
      if (qty != null || (legacy && typeof legacy === 'object') || hasFields) return en;
    }
    return null;
  }

  _getItem(category, name) {
    const catCN = CAT_CN[category] || '道具';
    let qty = stateManager.get(`物品·${catCN}·${name}·数量`);
    let quality = stateManager.get(`物品·${catCN}·${name}·品质`) || '普通';

    const legacyObj = stateManager.get(`物品·${catCN}·${name}`);
    if (legacyObj && typeof legacyObj === 'object') {
       qty = legacyObj.quantity || qty || 1;
       quality = legacyObj.quality || quality;
    }

    if (qty == null) {
      // Check if it exists as an AI generated item without explicit quantity
      let hasItem = false;
      for (const k of Object.keys(stateManager.state)) {
        if (k.startsWith(`物品·${catCN}·${name}·`)) {
          hasItem = true;
          break;
        }
      }
      if (!hasItem) return null;
      qty = 1; // Assume 1 for equipment
    }

    return { quantity: Number(qty) || 1, quality };
  }

  useItem(name) {
    if (!name || typeof name !== 'string' || !name.trim()) return false;
    let qty = stateManager.get(`物品·消耗品·${name}·数量`);
    let quality = stateManager.get(`物品·消耗品·${name}·品质`) || '普通';

    // Legacy support: if it was stored as an object
    const legacyObj = stateManager.get(`物品·消耗品·${name}`);
    if (legacyObj && typeof legacyObj === 'object') {
       qty = legacyObj.quantity || qty || 1;
       quality = legacyObj.quality || quality;
    }

    if (!qty || Number(qty) <= 0) return false;
    const item = { quantity: Number(qty), quality };

    const effect = this._consumableEffect(name, item);

    const updates = [];
    if (effect.chakra) updates.push({ key: '属性·当前查克拉', op: '+', value: effect.chakra });
    if (effect.vitality) updates.push({ key: '属性·当前生命力', op: '+', value: effect.vitality });
    if (effect.stamina) updates.push({ key: '属性·当前体力', op: '+', value: effect.stamina });
    if (effect.spirit) updates.push({ key: '属性·当前精神力', op: '+', value: effect.spirit });
    if (effect.heal) {
      updates.push({ key: '属性·当前生命力', op: '+', value: effect.heal });
      updates.push({ key: '属性·当前查克拉', op: '+', value: Math.floor(effect.heal * 0.5) });
    }

    this.removeItem('consumables', name, 1);
    if (updates.length) stateManager.update(updates);
    eventBus.emit('equipment:used', { name, effect });
    return true;
  }

  _applyEquipBonus(name, category, mode) {
    const item = this._getItem(category, name);
    if (!item) return;
    const quality = item.quality || '普通';
    const bonus = QUALITY_BONUS[quality] || QUALITY_BONUS['普通'];
    const sign = mode === 'add' ? 1 : -1;
    const updates = [];

    if (category === 'weapons') {
      updates.push({ key: '属性·速度', op: sign > 0 ? '+' : '-', value: Math.floor(bonus.power * 0.3) });
    }
    if (category === 'armor') {
      updates.push({ key: '属性·生命力', op: sign > 0 ? '+' : '-', value: bonus.defense });
      updates.push({ key: '属性·当前生命力', op: sign > 0 ? '+' : '-', value: bonus.defense });
    }
    if (bonus.attr > 0 && category === 'tools') {
      updates.push({ key: '属性·幸运', op: sign > 0 ? '+' : '-', value: bonus.attr });
    }

    if (updates.length) stateManager.update(updates);
  }

  _consumableEffect(name, item) {
    const q = item.quality || '普通';
    const tier = { '破烂': 0.5, '普通': 1, '精良': 1.5, '优秀': 2.5 }[q] || 1;
    const base = 20;

    if (/^兵粮丸/.test(name)) return { stamina: Math.round(base * tier * 1.5), chakra: Math.round(base * tier * 0.6) };
    if (/^军粮丸/.test(name)) return { chakra: Math.round(base * tier * 2), stamina: Math.round(base * tier * 0.3) };
    if (/止血|绷带|药膏|回复|治疗/.test(name)) return { heal: Math.round(25 * tier) };
    if (/解毒/.test(name)) return { stamina: Math.round(15 * tier) };
    if (/醒神|精神|专注/.test(name)) return { spirit: Math.round(20 * tier) };
    return { heal: Math.round(15 * tier) };
  }

  getEquipBonusSummary() {
    const bonuses = {};
    for (const [slot, slotKey] of Object.entries(SLOT_KEYS)) {
      const name = stateManager.get(slotKey);
      if (!name) continue;
      const cat = SLOT_TO_CAT[slot] || 'tools';
      const item = this._getItem(cat, name);
      if (!item) continue;
      const quality = item.quality || '普通';
      const bonus = QUALITY_BONUS[quality] || QUALITY_BONUS['普通'];
      if (cat === 'weapons') bonuses.attack = (bonuses.attack || 0) + bonus.power;
      if (cat === 'armor') bonuses.defense = (bonuses.defense || 0) + bonus.defense;
      if (cat === 'tools') bonuses.luck = (bonuses.luck || 0) + bonus.attr;
    }
    return bonuses;
  }

  _scanItems(category) {
    const catCN = CAT_CN[category];
    if (!catCN) return {};
    const prefix = `物品·${catCN}·`;
    const state = stateManager.get();
    const items = {};
    for (const key of Object.keys(state)) {
      if (!key.startsWith(prefix) || !key.endsWith('·数量')) continue;
      const name = key.slice(prefix.length, -3);
      const qty = Number(state[key]) || 0;
      if (qty <= 0) continue;
      const quality = state[`${prefix}${name}·品质`] || '普通';
      items[name] = { quantity: qty, quality };
    }
    return items;
  }

  getAllEquipment() {
    const result = {};
    for (const cat of ['weapons', 'armor', 'tools', 'consumables']) {
      result[cat] = this._scanItems(cat);
    }
    return result;
  }

  getTools() {
    return this._scanItems('tools');
  }

  getConsumables() {
    return this._scanItems('consumables');
  }

  getWeapons() {
    return this._scanItems('weapons');
  }

  getArmor() {
    return this._scanItems('armor');
  }

  getRyo() {
    return Number(stateManager.get('进度·金钱')) || 0;
  }

  addRyo(amount) {
    stateManager.update([
      { key: '进度·金钱', op: '+', value: amount }
    ]);
    return this.getRyo();
  }

  spendRyo(amount) {
    const current = this.getRyo();
    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn('[EquipmentSystem] spendRyo called with invalid amount:', amount);
      return false;
    }
    if (current < amount) {
      console.warn('[EquipmentSystem] spendRyo insufficient funds:', { current, amount });
      return false;
    }
    stateManager.update([
      { key: '进度·金钱', op: '-', value: amount }
    ]);
    return true;
  }

  addItem(category, name, quantity = 1, quality = '普通') {
    const catCN = CAT_CN[category] || '道具';
    const qtyKey = `物品·${catCN}·${name}·数量`;
    const qualityKey = `物品·${catCN}·${name}·品质`;
    const legacyKey = `物品·${catCN}·${name}`;

    let existing = stateManager.get(qtyKey);
    let legacyObj = stateManager.get(legacyKey);

    const updates = [];

    if (existing != null) {
      updates.push({ key: qtyKey, op: '+', value: quantity });
    } else {
      let startQty = quantity;
      if (legacyObj && typeof legacyObj === 'object') {
        startQty += (legacyObj.quantity || 0);
        quality = legacyObj.quality || quality;
      }
      updates.push({ key: qtyKey, op: '=', value: startQty });
      updates.push({ key: qualityKey, op: '=', value: quality });
    }

    if (legacyObj && typeof legacyObj === 'object') {
      updates.push({ key: legacyKey, op: 'delete' });
    }

    stateManager.update(updates);
  }

  removeItem(category, name, quantity = 1) {
    const catCN = CAT_CN[category] || '道具';
    const qtyKey = `物品·${catCN}·${name}·数量`;
    const legacyKey = `物品·${catCN}·${name}`;

    const existing = stateManager.get(qtyKey);
    const legacyObj = stateManager.get(legacyKey);
    const storedKeys = Object.keys(stateManager.state)
      .filter(key => key === legacyKey || key.startsWith(`${legacyKey}·`));
    const hasLegacyObject = legacyObj && typeof legacyObj === 'object';

    if (existing == null && !hasLegacyObject && !storedKeys.length) return false;

    // 早期存档可能只有品质/描述，没有数量；UI 会将这类装备视为单件物品。
    const currentQty = existing != null
      ? Number(existing)
      : (hasLegacyObject ? Number(legacyObj.quantity ?? 1) : 1);
    const newQty = Math.max(0, currentQty - quantity);

    if (newQty <= 0) {
      for (const [slot, slotCategory] of Object.entries(SLOT_TO_CAT)) {
        if (slotCategory === category && stateManager.get(SLOT_KEYS[slot]) === name) {
          this.unequip(slot);
        }
      }
    }

    const updates = [];

    if (newQty <= 0) {
      // 数量、品质、描述和旧对象必须作为一个实体一起删除，避免残骸被 UI 当作 1 件物品。
      for (const key of storedKeys) updates.push({ key, op: 'delete' });
    } else {
      updates.push({ key: qtyKey, op: '=', value: newQty });
    }

    if (newQty > 0 && hasLegacyObject) {
      // If we still have quantity but a legacy object exists, migrate its properties out then delete it
      if (legacyObj.quality && stateManager.get(`物品·${catCN}·${name}·品质`) == null) {
        updates.push({ key: `物品·${catCN}·${name}·品质`, op: '=', value: legacyObj.quality });
      }
      if (legacyObj.description && stateManager.get(`物品·${catCN}·${name}·描述`) == null) {
        updates.push({ key: `物品·${catCN}·${name}·描述`, op: '=', value: legacyObj.description });
      }
      updates.push({ key: legacyKey, op: 'delete' });
    }

    stateManager.update(updates);
    return true;
  }

  useConsumable(name) {
    return this.useItem(name);
  }

  getToolList() {
    const tools = this.getTools();
    return this._itemList(tools);
  }

  getConsumableList() {
    const consumables = this.getConsumables();
    return this._itemList(consumables);
  }

  getEquipmentSummary() {
    const tools = this.getToolList();
    const consumables = this.getConsumableList();
    const weapons = this.getWeapons();
    const armor = this.getArmor();
    const equipped = this.getEquipped();

    return {
      tools,
      consumables,
      weapons: Object.keys(weapons),
      armor: Object.keys(armor),
      equipped,
      bonuses: this.getEquipBonusSummary(),
      ryo: this.getRyo()
    };
  }

  _itemList(items) {
    return Object.entries(items || {})
      .filter(([, info]) => info && typeof info === 'object' && info.quantity != null)
      .map(([name, info]) => ({
        name,
        quantity: Number(info?.quantity) || 0,
        quality: info?.quality || '普通'
      }))
      .filter(item => item.quantity > 0);
  }
}

export const equipmentSystem = new EquipmentSystem();
export default equipmentSystem;
