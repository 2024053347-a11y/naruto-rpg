import assert from 'node:assert/strict';

globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = {};
  }
};

globalThis.customElements = {
  registry: new Map(),
  define(name, value) {
    this.registry.set(name, value);
  },
  get(name) {
    return this.registry.get(name);
  }
};

const [{ stateManager }, { relationshipSystem }, { imageStudio }, { CANON_DATABASE }, { appShell }] = await Promise.all([
  import('../js/core/state-manager.js'),
  import('../js/systems/relationship-system.js'),
  import('../js/core/image-studio/index.js'),
  import('../js/data/canon-database.js'),
  import('../js/ui/app-shell.js'),
  import('../js/ui/panel.js')
]);

const InfoPanel = customElements.get('info-panel');
assert.ok(InfoPanel, 'info-panel should be registered');

const originalRelationships = stateManager.state._relationships;
const originalEnsureVisualProfile = relationshipSystem.ensureVisualProfile;
const originalImageRead = imageStudio.read;
const originalImageSubscribe = imageStudio.subscribe;

try {
  const panel = new InfoPanel();

  appShell._turnUpdates = [];
  appShell._captureUpdates = true;
  appShell._captureMissionUpdate({
    id: 'escort_test', rank: 'C', title: '护送测试委托', objective: '护送委托人抵达边境'
  }, 'added');
  assert.equal(appShell._turnUpdates.length, 1);
  const missionUpdateHtml = appShell._buildVarUpdatePanel(appShell._turnUpdates);
  assert.match(missionUpdateHtml, /护送测试委托/);
  assert.match(missionUpdateHtml, /已接取/);
  assert.doesNotMatch(missionUpdateHtml, /vu-edit-btn/);

  stateManager.state._relationships = {};
  const emptyHtml = panel._renderTab('relations', {});
  assert.match(emptyHtml, /class="sec bond-wrap"/);
  assert.match(emptyHtml, /暂无羁绊/);

  stateManager.state._relationships = {
    '春野樱': { affection: 45, trust: 20, respect: 10 },
    '宇智波佐助': { affection: -70, trust: -30, respect: 25 }
  };

  panel._bondFilter = null;
  const fullHtml = panel._renderTab('relations', {});
  assert.match(fullHtml, /春野樱/);
  assert.match(fullHtml, /宇智波佐助/);

  panel._bondFilter = 'warm';
  const filteredHtml = panel._renderTab('relations', {});
  assert.match(filteredHtml, /春野樱/);
  assert.doesNotMatch(filteredHtml, /宇智波佐助/);

  const combatState = {
    '玩家·战力等级': 'A级',
    '属性·查克拉': 350,
    '属性·生命力': 400,
    '属性·体力': 350,
    '属性·精神力': 300,
    '属性·速度': 120,
    '属性·幸运': 30,
    '技能·忍术·高阶忍术·熟练度': 90,
    '技能·体术·高阶体术·熟练度': 90,
    '技能·幻术·高阶幻术·熟练度': 90
  };
  const threat = panel._calcThreat(combatState);
  assert.match(threat.label, /^A级/, 'panel rating must use the same shared combat calculation');

  const canonical = CANON_DATABASE.resolveTechnique('火遁·炎弹');
  assert.ok(canonical, 'canon technique fixture should resolve');
  const skillState = {
    '技能·忍术·火遁·炎弹·名称': '火遁·炎弹',
    '技能·忍术·火遁·炎弹·等级': canonical.rank,
    '技能·忍术·火遁·炎弹·熟练度': 60,
    '技能·体术·自创短打·名称': '自创短打',
    '技能·体术·自创短打·等级': 'C',
    '技能·体术·自创短打·消耗': 12,
    '技能·体术·自创短打·消耗资源': 'stamina',
    '技能·体术·自创短打·威力': 38,
    '技能·体术·自创短打·熟练度': 55
  };

  panel._skillCompact = false;
  const expandedSkills = panel._renderTab('skills', skillState);
  assert.match(expandedSkills, new RegExp(`火遁·炎弹[\\s\\S]*?data-stat="power"[^>]*>[\\s\\S]*?威力[\\s\\S]*?${canonical.power}[\\s\\S]*?data-stat="cost"[^>]*>[\\s\\S]*?查克拉消耗[\\s\\S]*?${canonical.cost}`));
  assert.match(expandedSkills, /自创短打[\s\S]*?data-stat="power"[^>]*>[\s\S]*?威力[\s\S]*?38[\s\S]*?data-stat="cost"[^>]*>[\s\S]*?体力消耗[\s\S]*?12/);

  panel._skillCompact = true;
  const compactSkills = panel._renderTab('skills', skillState);
  assert.match(compactSkills, new RegExp(`火遁·炎弹[\\s\\S]*?data-stat="power"[^>]*>[\\s\\S]*?${canonical.power}[\\s\\S]*?data-stat="cost"[^>]*>[\\s\\S]*?${canonical.cost}`));
  assert.match(compactSkills, /自创短打[\s\S]*?data-stat="power"[^>]*>[\s\S]*?38[\s\S]*?data-stat="cost"[^>]*>[\s\S]*?12/);

  const bloodlineHtml = panel._renderTab('skills', {
    '技能·血继限界': '普通血脉',
    '技能·血继限界·冰遁·名称': '冰遁',
    '技能·血继限界·冰遁·等级': '初醒',
    '技能·血继限界·冰遁·熟练度': 42,
    '技能·血继限界·冰遁·描述': '融合水与风形成冰晶。'
  });
  assert.match(bloodlineHtml, /class="skill-title">冰遁<\/div>/);
  assert.doesNotMatch(bloodlineHtml, /class="skill-card bloodline normal"/);
  assert.doesNotMatch(bloodlineHtml, /血继限界尚未显现/);

  let modalPayload = null;
  class FakeModal {
    constructor() {
      this.shadowRoot = { querySelector: () => null };
      this.isConnected = true;
    }
    show(payload) { modalPayload = payload; }
    close() {}
  }
  customElements.registry.set('game-modal', FakeModal);
  globalThis.document = {
    getElementById: () => null,
    body: { appendChild() {} }
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  relationshipSystem.ensureVisualProfile = () => ({
    visual_subject_id: 'subject-panel-test',
    visual_profile: {}
  });
  imageStudio.read = async () => ({ binding: null });
  imageStudio.subscribe = () => () => {};
  stateManager.state._relationships = {
    '旗木卡卡西': {
      affection: 10,
      combat_stats: {
        rank: '上忍',
        jutsu: [{
          name: '雷切', rank: 'A', type: 'ninjutsu', element: '雷',
          resource_type: '查克拉', cost: 45, power: 105, mastery: 88
        }]
      }
    }
  };
  panel.showRelModal('旗木卡卡西');
  assert.ok(modalPayload?.content, 'NPC modal should render');
  assert.match(modalPayload.content, /忍术档案/);
  assert.match(modalPayload.content, /data-stat="power"[^>]*>[\s\S]*?威力[\s\S]*?105/);
  assert.match(modalPayload.content, /data-stat="cost"[^>]*>[\s\S]*?查克拉消耗[\s\S]*?45/);

  console.log('8 panel regression tests passed.');
} finally {
  appShell._captureUpdates = false;
  appShell._turnUpdates = [];
  stateManager.state._relationships = originalRelationships;
  relationshipSystem.ensureVisualProfile = originalEnsureVisualProfile;
  imageStudio.read = originalImageRead;
  imageStudio.subscribe = originalImageSubscribe;
}
