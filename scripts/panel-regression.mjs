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

const [{ stateManager }, { relationshipSystem }, { imageStudio }, { CANON_DATABASE }, { appShell }, { instructionParser }, { MessagePipeline }] = await Promise.all([
  import('../js/core/state-manager.js'),
  import('../js/systems/relationship-system.js'),
  import('../js/core/image-studio/index.js'),
  import('../js/data/canon-database.js'),
  import('../js/ui/app-shell.js'),
  import('../js/core/instruction-parser.js'),
  import('../js/core/pipeline.js'),
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
  assert.match(bloodlineHtml, /class="bloodline-rank">初醒<\/span>/);
  assert.match(bloodlineHtml, /血脉同调[\s\S]*?42%[\s\S]*?width:42%/);
  assert.match(bloodlineHtml, /class="bloodline-desc">融合水与风形成冰晶。<\/div>/);
  assert.match(bloodlineHtml, /--bl:#80d8ff/, 'ice release must use its own ice-blue theme');
  assert.match(bloodlineHtml, /class="bloodline-glyph">冰<\/span>/);
  assert.doesNotMatch(bloodlineHtml, /class="skill-card bloodline normal"/);
  assert.doesNotMatch(bloodlineHtml, /血继限界尚未显现/);

  const multiBloodlineHtml = panel._renderTab('skills', {
    '技能·血继限界·写轮眼·名称': '写轮眼',
    '技能·血继限界·写轮眼·熟练度': 60,
    '技能·血继限界·木遁·名称': '木遁',
    '技能·血继限界·自创雾隐秘脉·名称': '自创雾隐秘脉'
  });
  assert.match(multiBloodlineHtml, /--bl:#ff5252[\s\S]*?class="bloodline-glyph">瞳<\/span>[\s\S]*?class="skill-title">写轮眼<\/div>/, 'sharingan must render crimson dojutsu theme');
  assert.match(multiBloodlineHtml, /--bl:#81c784[\s\S]*?class="skill-title">木遁<\/div>/, 'wood release must render its own green theme');
  assert.match(multiBloodlineHtml, /--bl:#ef5350[\s\S]*?class="bloodline-glyph">自<\/span>[\s\S]*?class="skill-title">自创雾隐秘脉<\/div>/, 'unknown bloodlines must fall back to crimson with first-character glyph');

  const normalBloodlineHtml = panel._renderTab('skills', { '技能·血继限界': '普通血脉' });
  assert.match(normalBloodlineHtml, /class="skill-card bloodline normal"/);
  assert.match(normalBloodlineHtml, /class="skill-title">普通血脉<\/div>/);
  assert.doesNotMatch(normalBloodlineHtml, /bloodline-sync/);

  const flexibleDivinationHtml = appShell._renderMarkdown([
    '≈ 卦象判定 ≈',
    '潜入警戒区',
    '卦象: 第壹枚 -> 及第',
    '守卫的视线恰好被廊柱挡住。',
    '≈ 卦终 ≈',
    '【行动】继续贴墙观察'
  ].join('\r\n'));
  assert.match(flexibleDivinationHtml, /class="divination-seal-box[^" ]*/);
  assert.match(flexibleDivinationHtml, /class="action-option"/);
  assert.doesNotMatch(flexibleDivinationHtml, /≈\s*卦象判定\s*≈/);

  const bracketedDivinationHtml = appShell._renderMarkdown([
    '【卦象判定】',
    '说服守门忍者',
    '卦象结果：第贰枚 ＞ 代偿达成',
    '对方答应通报，但要求留下身份文书。',
    '【卦终】'
  ].join('\n'));
  assert.match(bracketedDivinationHtml, /class="divination-seal-box[^" ]* warning/);

  const unclosedDivinationHtml = appShell._renderMarkdown([
    '≈卦象判定≈',
    '追踪林间留下的足迹',
    '判定结果: 第叁枚 -> 引出新局势',
    '足迹通向两条不同的岔路。',
    '[行动] 检查左侧折断的树枝',
    '2. [行动 2] 沿右侧泥印继续追踪'
  ].join('\n'));
  assert.match(unclosedDivinationHtml, /class="divination-seal-box[^" ]* info/);
  assert.equal((unclosedDivinationHtml.match(/class="action-option"/g) || []).length, 2);
  assert.doesNotMatch(unclosedDivinationHtml, /≈卦象判定≈/);

  stateManager.state._relationships = {
    '春野樱': { affection: 10, trust: 2, respect: 1, history: [], inner_thoughts: [] }
  };
  const relationshipPipeline = new MessagePipeline({ relationshipSystem });
  relationshipPipeline._applyInstructions(instructionParser.parse(
    '<relationship>{"name":"春野樱","affection_delta":"5","trust_delta":1,"reason":"共同完成训练"}</relationship>'
  ), true);
  assert.equal(stateManager.state._relationships['春野樱'].affection, 15);
  assert.equal(stateManager.state._relationships['春野樱'].trust, 3);

  relationshipSystem.processInstruction({
    name: '春野樱', affection_delta: '2', trust_delta: 'NaN', respect_delta: 'Infinity'
  });
  assert.equal(stateManager.state._relationships['春野樱'].affection, 17);
  assert.equal(stateManager.state._relationships['春野樱'].trust, 3);
  assert.equal(stateManager.state._relationships['春野樱'].respect, 1);

  const localizedRelationship = instructionParser.parse(
    '<relationship>{"姓名":"  春野樱  ","respect_delta":"2","affection_change":"NaN","trust_change":"Infinity"}</relationship>'
  ).relationship;
  assert.deepEqual(localizedRelationship, { npc: '春野樱', respect_change: 2 });
  relationshipSystem.processInstruction(localizedRelationship);
  assert.equal(stateManager.state._relationships['春野樱'].affection, 17);
  assert.equal(stateManager.state._relationships['春野樱'].trust, 3);
  assert.equal(stateManager.state._relationships['春野樱'].respect, 3);
  assert.equal(Number.isFinite(stateManager.state._relationships['春野樱'].affection), true);

  relationshipSystem.processInstruction({
    姓名: '日向雏田', affection: '12', trust: 4, respect: 'NaN', combatant: false
  });
  assert.equal(stateManager.state._relationships['日向雏田'].affection, 12);
  assert.equal(stateManager.state._relationships['日向雏田'].trust, 4);
  assert.equal(stateManager.state._relationships['日向雏田'].respect, 0);
  relationshipSystem.processInstruction({
    npc: '日向雏田', affection: 99, affection_delta: '3'
  });
  assert.equal(
    stateManager.state._relationships['日向雏田'].affection,
    15,
    'increment must take precedence over an absolute score in the same instruction'
  );

  relationshipSystem.processInstruction({ name: '   ', affection_delta: 50 });
  assert.equal(Object.hasOwn(stateManager.state._relationships, ''), false);

  stateManager.state._relationships['春野樱'].history = [];
  stateManager.state._relationships['春野樱'].inner_thoughts = [];
  for (let turn = 1; turn <= 32; turn++) {
    stateManager.state['系统·回合数'] = turn;
    relationshipSystem.processInstruction({
      npc: '春野樱', history: `第${turn}回合互动`, inner_thoughts: '保持警惕。'
    });
  }
  const sakura = stateManager.state._relationships['春野樱'];
  assert.equal(sakura.history.length, 30);
  assert.equal(sakura.inner_thoughts.length, 5);
  assert.equal(sakura.history[0].summary, '第32回合互动');
  assert.equal(sakura.inner_thoughts[0].summary, '保持警惕。');
  assert.equal(sakura.inner_thoughts[0].turn, 32);
  assert.equal(sakura.inner_thoughts[1].turn, 31, 'identical thoughts on different turns must both be retained');
  assert.doesNotMatch(sakura.history[0].summary, /\[心声\]/);

  stateManager.state['系统·回合数'] = 33;
  relationshipSystem.processInstruction({
    npc: '春野樱', history: '[历史] 并肩巡逻 [心声] 她开始信任这支队伍。'
  });
  const legacyUpdatedSakura = stateManager.state._relationships['春野樱'];
  assert.equal(legacyUpdatedSakura.history[0].summary, '并肩巡逻');
  assert.equal(legacyUpdatedSakura.inner_thoughts[0].summary, '她开始信任这支队伍。');
  assert.doesNotMatch(legacyUpdatedSakura.history[0].summary, /\[心声\]/);

  const legacyLog = panel._renderInteractionLog(
    [{ turn: 2, time: 'K052-01-02', summary: '[历史] 旧互动 [心声] 旧心声' }],
    [{ turn: 3, time: 'K052-01-03', summary: '独立新心声' }]
  );
  assert.match(legacyLog, /旧互动/);
  assert.match(legacyLog, /旧心声/);
  assert.match(legacyLog, /独立新心声/);
  const partiallyNormalizedLegacyLog = panel._renderInteractionLog(
    [{ turn: 1, time: 'K052-01-01', summary: '更早的互动 [心声] 更早的心声' }]
  );
  assert.match(partiallyNormalizedLegacyLog, /更早的互动/);
  assert.match(partiallyNormalizedLegacyLog, /更早的心声/);

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

  console.log('10 panel regression tests passed.');
} finally {
  appShell._captureUpdates = false;
  appShell._turnUpdates = [];
  stateManager.state._relationships = originalRelationships;
  relationshipSystem.ensureVisualProfile = originalEnsureVisualProfile;
  imageStudio.read = originalImageRead;
  imageStudio.subscribe = originalImageSubscribe;
}
