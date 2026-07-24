import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();

const [
  { AgentPipeline, parseFutureGuardianControl },
  { AgentRunner, evidenceAudienceForAgent },
  { AGENT_MANIFESTS },
  { TurnEvidenceCompiler },
  { resolveAICallPolicy }
] = await Promise.all([
  import('../js/core/agent-pipeline.js'),
  import('../js/core/agent-runner.js'),
  import('../js/core/agent-manifests.js'),
  import('../js/core/turn-evidence.js'),
  import('../js/core/ai-call-policy.js')
]);

function stateAtK052() {
  return {
    _version: '5.0',
    _meta: { current_node_id: 'node_future_guardian', active_branch: 'branch_main' },
    _relationships: {},
    _missions: { active: {}, completed: {}, failed: {} },
    '系统·回合数': 7,
    '世界·时间': 'K052-01-01',
    '世界·年代': 'K052',
    '世界·地点': '木叶训练场',
    '世界·天气': '晴',
    '玩家·姓名': '护栏测试忍者',
    '玩家·存活': '是',
    '玩家·公开身份': '木叶忍者'
  };
}

const state = stateAtK052();
const compiler = new TurnEvidenceCompiler();
const packet = compiler.compile({ state, userInput: '留在训练场观察' });
const writerView = compiler.project(packet, { audience: 'writer' });
assert.ok(packet.protected_future, 'K052 fixture must have protected future evidence');

assert.equal(evidenceAudienceForAgent('brainstormer'), 'writer');
assert.equal(evidenceAudienceForAgent('outliner'), 'writer');
assert.equal(evidenceAudienceForAgent('future-guardian'), 'planner');

{
  const observed = [];
  const runner = new AgentRunner({
    pipeline: {
      getTurnEvidenceView(audience) {
        observed.push(audience);
        return compiler.project(packet, { audience });
      }
    }
  });
  runner._buildMessages('brainstormer', AGENT_MANIFESTS.brainstormer, {
    state, userInput: '', taskPrompt: '', extraContext: {}
  });
  runner._buildMessages('outliner', AGENT_MANIFESTS.outliner, {
    state, userInput: '', taskPrompt: '', extraContext: {}
  });
  runner._buildMessages('future-guardian', AGENT_MANIFESTS['future-guardian'], {
    state,
    userInput: '',
    taskPrompt: '',
    extraContext: { guardianOutline: { beats: [{ id: 1, scene: '安全场景' }] } }
  });
  assert.deepEqual(observed, ['writer', 'writer', 'planner']);
}

const futureParaphrase = '鸣人偷走禁术卷轴，随后藏进树林。';

{
  const control = parseFutureGuardianControl({
    scope: 'outline',
    decision: 'filter',
    candidate_ids: [99],
    beat_ids: [2, '1', true, 1.5, -1, 999],
    explanation: futureParaphrase,
    nested: { future: futureParaphrase }
  }, { scope: 'outline', validIds: [1, 2] });
  assert.deepEqual(control.beat_ids, [2], 'only numeric positive local IDs may survive');
  assert.deepEqual(control.candidate_ids, []);
  assert.equal(JSON.stringify(control).includes(futureParaphrase), false);
  assert.equal(Object.hasOwn(control, 'explanation'), false);
  assert.equal(parseFutureGuardianControl({ _raw: futureParaphrase }, {
    scope: 'outline', validIds: [1]
  }), null);
}

function hostPipeline() {
  return {
    _activeCallPolicy: {
      strictSingleCall: false,
      features: { agents: true, futurePlanner: false }
    },
    _lastTurnEvidencePacket: packet,
    _lastTurnEvidenceViews: { writer: writerView }
  };
}

{
  assert.equal(new AgentPipeline({ pipeline: hostPipeline(), memorySystem: null })._futureGuardianEnabled(), true);
  assert.equal(new AgentPipeline({
    pipeline: {
      ...hostPipeline(),
      _activeCallPolicy: { strictSingleCall: false, features: { agents: false } }
    },
    memorySystem: null
  })._futureGuardianEnabled(), false);
  assert.equal(new AgentPipeline({
    pipeline: {
      ...hostPipeline(),
      _activeCallPolicy: { strictSingleCall: true, features: { agents: true } }
    },
    memorySystem: null
  })._futureGuardianEnabled(), false);
  assert.equal(new AgentPipeline({
    pipeline: { ...hostPipeline(), _lastTurnEvidencePacket: { protected_future: null } },
    memorySystem: null
  })._futureGuardianEnabled(), false);
}

{
  const agentPipeline = new AgentPipeline({ pipeline: hostPipeline(), memorySystem: null });
  const guardianInputs = [];
  agentPipeline.runner.run = async (type, params) => {
    if (type === 'brainstormer') {
      return {
        candidates: [
          { id: 91, direction: '玩家检查训练场留下的脚印。', reason: '承接当前观察。', risk: 'low' },
          { id: 42, direction: '玩家询问值守忍者近期异常。', reason: '保持当前日期。', risk: 'medium' }
        ],
        recommended: 91
      };
    }
    assert.equal(type, 'future-guardian');
    guardianInputs.push(params.extraContext.guardianCandidates);
    return {
      scope: 'candidates',
      decision: 'filter',
      candidate_ids: [2],
      beat_ids: [],
      explanation: futureParaphrase
    };
  };
  const selected = await agentPipeline._brainstorm(state, '留在训练场观察');
  assert.equal(selected.id, 2, 'guardian must address application-assigned candidate IDs');
  assert.match(selected.direction, /询问值守忍者/);
  assert.deepEqual(guardianInputs[0].map(candidate => candidate.id), [1, 2]);
  assert.equal(JSON.stringify(selected).includes(futureParaphrase), false);
}

{
  const agentPipeline = new AgentPipeline({ pipeline: hostPipeline(), memorySystem: null });
  let guardianOutline = null;
  agentPipeline.runner.run = async (type, params) => {
    if (type === 'outliner') {
      return {
        beats: [
          { id: 700, scene: '玩家沿训练场边缘检查脚印。', action: '只确认当前痕迹。', dialogue: [], mood: '日常' },
          { id: 900, scene: '值守忍者说明今日没有紧急任务。', action: '玩家获得当前公开信息。', dialogue: ['值守忍者: 今天很安静。'], mood: '日常' }
        ],
        estimatedLength: 900,
        variableSummary: '无强制变化'
      };
    }
    assert.equal(type, 'future-guardian');
    guardianOutline = params.extraContext.guardianOutline;
    return {
      scope: 'outline',
      decision: 'filter',
      candidate_ids: [],
      beat_ids: [1],
      explanation: futureParaphrase,
      proposed_rewrite: futureParaphrase
    };
  };

  const outline = await agentPipeline._generateOutline(state, '继续观察', null);
  assert.deepEqual(outline.beats.map(beat => beat.id), [1]);
  assert.deepEqual(guardianOutline.beats.map(beat => beat.id), [1, 2]);
  assert.equal(JSON.stringify(outline).includes(futureParaphrase), false);

  const writerConstraint = new AgentRunner()._buildWriterConstraint({ outline }, state);
  assert.match(writerConstraint, /玩家沿训练场边缘检查脚印/);
  assert.doesNotMatch(writerConstraint, /值守忍者说明今日没有紧急任务|未来护栏控制码/);
  assert.doesNotMatch(writerConstraint, new RegExp(futureParaphrase));

  const npcPrompt = agentPipeline._buildCharacterTaskPrompt('值守忍者', state, outline);
  assert.match(npcPrompt, /训练场边缘检查脚印/);
  assert.doesNotMatch(npcPrompt, new RegExp(futureParaphrase));
}

{
  const agentPipeline = new AgentPipeline({ pipeline: hostPipeline(), memorySystem: null });
  const safeOutline = {
    beats: [{ id: 55, scene: '玩家留在当前训练场。', action: '继续观察。', dialogue: [], mood: '日常' }]
  };
  agentPipeline.runner.run = async type => {
    if (type === 'outliner') return safeOutline;
    return { _raw: futureParaphrase };
  };
  await assert.rejects(
    agentPipeline._generateOutline(state, '继续观察', null),
    error => error?.code === 'FUTURE_GUARDIAN_REJECTED'
  );

  agentPipeline.runner.run = async type => {
    if (type === 'outliner') return safeOutline;
    throw new Error('guardian unavailable');
  };
  await assert.rejects(
    agentPipeline._generateOutline(state, '继续观察', null),
    error => error?.code === 'FUTURE_GUARDIAN_REJECTED'
  );
}

{
  const strict = resolveAICallPolicy({
    apiConfig: {
      aiCallPolicy: { strictSingleCall: true },
      futurePlanner: { enabled: true }
    },
    agentConfig: { enabled: true, mode: 'full' },
    memoryConfig: {},
    imageSettings: {}
  });
  assert.equal(strict.features.agents, false);
  assert.equal(strict.features.futurePlanner, false);
  assert.equal(strict.estimate.minimum, 1);
  assert.equal(strict.estimate.maximum, 1);
}

console.log('future-guardian-regression: OK');
