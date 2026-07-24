import { eventBus } from './event-bus.js';
import { AgentRunner, AgentAbortError } from './agent-runner.js';
import { AGENT_TIMEOUTS } from './agent-manifests.js';
import { getAgentConfig } from '../data/agent-config.js';
import { assertNoProtectedFutureLeak } from './protected-future-guard.js';

export const CHARACTER_MEMORY_DELTA_SCHEMA = 'naruto.character-memory-delta/v1';
export const FUTURE_GUARDIAN_CONTROL_SCHEMA = 'naruto.future-guardian-control/v1';

const FUTURE_GUARDIAN_DECISIONS = new Set(['approve', 'filter', 'reject']);

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function localNumericId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function normalizeCandidateResult(result) {
  const source = Array.isArray(result?.candidates)
    ? result.candidates.filter(candidate => (
        candidate
        && typeof candidate === 'object'
        && String(candidate.direction || '').trim()
      ))
    : [];
  const recommendedIndex = source.findIndex(candidate => (
    String(candidate?.id) === String(result?.recommended)
  ));
  const candidates = source.map((candidate, index) => ({
    id: index + 1,
    direction: String(candidate.direction || '').trim(),
    reason: String(candidate.reason || '').trim(),
    risk: ['low', 'medium', 'high'].includes(candidate.risk) ? candidate.risk : 'medium'
  }));
  return {
    candidates,
    recommended: candidates.length ? Math.min(recommendedIndex >= 0 ? recommendedIndex + 1 : 1, candidates.length) : null
  };
}

function normalizeOutlineResult(result) {
  const source = Array.isArray(result?.beats)
    ? result.beats.filter(beat => beat && typeof beat === 'object')
    : [];
  return {
    ...cloneJson(result),
    beats: source.map((beat, index) => ({ ...cloneJson(beat), id: index + 1 }))
  };
}

/**
 * The only application boundary for future-guardian output. Unknown keys and
 * free text are deliberately discarded; only local integer IDs and enums can
 * survive. Invalid output returns null so callers can keep their safe input.
 */
export function parseFutureGuardianControl(value, { scope, validIds = [] } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (scope !== 'candidates' && scope !== 'outline') return null;
  if (value.scope != null && value.scope !== scope) return null;
  const decision = String(value.decision || '').trim().toLowerCase();
  if (!FUTURE_GUARDIAN_DECISIONS.has(decision)) return null;
  const valid = new Set(validIds.map(localNumericId).filter(Boolean));
  const sourceIds = scope === 'candidates' ? value.candidate_ids : value.beat_ids;
  const ids = [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .map(localNumericId)
    .filter(id => id && valid.has(id)))].sort((left, right) => left - right);
  return Object.freeze({
    schema: FUTURE_GUARDIAN_CONTROL_SCHEMA,
    scope,
    decision,
    candidate_ids: Object.freeze(scope === 'candidates' ? ids : []),
    beat_ids: Object.freeze(scope === 'outline' ? ids : [])
  });
}

function futureGuardianRejectError(stage) {
  const error = new Error(`未来护栏拒绝了${stage}，本回合降级为安全直写`);
  error.code = 'FUTURE_GUARDIAN_REJECTED';
  error.stage = stage;
  return error;
}

function cleanMemoryText(value, max = 600) {
  return String(value || '').trim().slice(0, max);
}

export function buildCharacterMemoryDelta(characterInputs = [], { turn = 0 } = {}) {
  const changes = {};
  for (const input of Array.isArray(characterInputs) ? characterInputs : []) {
    const npcName = cleanMemoryText(input?.npcName || input?.npc, 80);
    if (!npcName) continue;
    const action = cleanMemoryText(input.action);
    const dialogue = cleanMemoryText(input.dialogue);
    const innerThought = cleanMemoryText(input.innerThought);
    const moodShift = cleanMemoryText(input.moodShift, 160);
    const towardsPlayer = cleanMemoryText(input.towardsPlayer, 240);
    const change = changes[npcName] || {
      npcName,
      currentMood: null,
      knownFactsAppend: [],
      recentActionsAppend: [],
      privateIntentAppend: [],
      relationShift: null
    };
    if (moodShift) change.currentMood = moodShift;
    if (action) change.knownFactsAppend.push(action);
    if (action || dialogue) change.recentActionsAppend.push({
      turn: Math.max(0, Number(turn) || 0),
      action,
      dialogue
    });
    if (innerThought) change.privateIntentAppend.push({
      turn: Math.max(0, Number(turn) || 0),
      thought: innerThought
    });
    if (towardsPlayer) change.relationShift = towardsPlayer;
    changes[npcName] = change;
  }
  return {
    schema: CHARACTER_MEMORY_DELTA_SCHEMA,
    turn: Math.max(0, Number(turn) || 0),
    changes
  };
}

export function mergeCharacterMemoryDelta(baseMemories = {}, delta = null) {
  const merged = cloneJson(baseMemories && typeof baseMemories === 'object' ? baseMemories : {}) || {};
  if (!delta || delta.schema !== CHARACTER_MEMORY_DELTA_SCHEMA) return merged;
  for (const [npcName, change] of Object.entries(delta.changes || {})) {
    const existing = merged[npcName] && typeof merged[npcName] === 'object'
      ? cloneJson(merged[npcName])
      : {
          npcName,
          personality: '',
          currentMood: '平静',
          privateGoals: [],
          knownFacts: [],
          relationToPlayer: {},
          recentActions: [],
          privateIntentHistory: []
        };
    existing.npcName = existing.npcName || npcName;
    existing.knownFacts = Array.isArray(existing.knownFacts) ? existing.knownFacts : [];
    existing.recentActions = Array.isArray(existing.recentActions) ? existing.recentActions : [];
    existing.privateIntentHistory = Array.isArray(existing.privateIntentHistory) ? existing.privateIntentHistory : [];
    existing.relationToPlayer = existing.relationToPlayer && typeof existing.relationToPlayer === 'object'
      ? existing.relationToPlayer
      : {};
    if (change.currentMood) existing.currentMood = change.currentMood;
    existing.knownFacts.push(...(change.knownFactsAppend || []));
    existing.recentActions.push(...(change.recentActionsAppend || []));
    existing.privateIntentHistory.push(...(change.privateIntentAppend || []));
    if (change.relationShift) existing.relationToPlayer.lastShift = change.relationShift;
    existing.knownFacts = existing.knownFacts.slice(-15);
    existing.recentActions = existing.recentActions.slice(-8);
    existing.privateIntentHistory = existing.privateIntentHistory.slice(-8);
    merged[npcName] = existing;
  }
  return merged;
}

class AgentPipeline {
  constructor({ pipeline, memorySystem }) {
    this.pipeline = pipeline;
    this.memorySystem = memorySystem;
    this.runner = new AgentRunner({ pipeline });
    this._aborted = false;
    this._totalTimer = null;
    this._pendingCharacterMemoryDelta = null;
  }

  static isEnabled() {
    return getAgentConfig().enabled === true;
  }

  static getMode() {
    return getAgentConfig().mode || 'standard';
  }

  abort() {
    this._aborted = true;
    this.runner.abort();
    if (this._totalTimer) { clearTimeout(this._totalTimer); this._totalTimer = null; }
  }

  async execute(state, userInput, onProgress = () => {}, mainMessages = null) {
    this._aborted = false;
    this.runner.configure();

    const mode = AgentPipeline.getMode();
    const isCombat = !!state._combat?.is_active;
    const agentCfg = getAgentConfig();
    const isFullMode = mode === 'full' || (agentCfg.autoUpgrade && isCombat);

    const totalTimeout = AGENT_TIMEOUTS.pipeline_total || 240000;
    const totalPromise = new Promise((_, reject) => {
      this._totalTimer = setTimeout(() => reject(new Error('Agent pipeline total timeout')), totalTimeout);
    });

    try {
      const result = await Promise.race([
        this._run(state, userInput, onProgress, isFullMode, isCombat, mainMessages),
        totalPromise
      ]);
      return result;
    } catch (err) {
      if (err instanceof AgentAbortError) throw err;
      console.warn('[AgentPipeline] Pipeline failed, falling back:', err.message);
      eventBus.emit('agent:fallback', { reason: err.message });
      onProgress('fallback', `降级为标准生成: ${err.message}`);
      return null;
    } finally {
      if (this._totalTimer) { clearTimeout(this._totalTimer); this._totalTimer = null; }
    }
  }

  async _run(state, userInput, onProgress, isFullMode, isCombat, mainMessages) {
    const timings = {};
    const t0 = Date.now();

    // ── Stage 1: 状态快照 ──
    onProgress('state_snap', '生成状态快照...');
    timings.state_snap = Date.now() - t0;
    this._checkAbort();

    // ── Stage 2: 头脑风暴（完整模式 + 非战斗） ──
    let selectedDirection = null;
    if (isFullMode && !isCombat) {
      const t1 = Date.now();
      onProgress('brainstorm', '头脑风暴中...');
      try {
        selectedDirection = await this._brainstorm(state, userInput);
        timings.brainstorm = Date.now() - t1;
      } catch (err) {
        console.warn('[AgentPipeline] Brainstorm failed, skipping:', err.message);
        eventBus.emit('agent:stage-skip', { stage: 'brainstorm', reason: err.message });
        timings.brainstorm = Date.now() - t1;
      }
      this._checkAbort();
    }

    // ── Stage 3: 大纲生成 ──
    const t2 = Date.now();
    onProgress('outline', '构建叙事大纲...');
    const outline = await this._generateOutline(state, userInput, selectedDirection);
    timings.outline = Date.now() - t2;
    this._checkAbort();
    eventBus.emit('agent:outline', { outline });

    // ── Stage 4: 大纲审查（并行） ──
    const t3 = Date.now();
    onProgress('review_outline', '审查大纲合理性...');
    const outlineReviews = await this._reviewOutline(state, outline);
    const reviewedOutline = this._mergeOutlineReviews(outline, outlineReviews);
    timings.review_outline = Date.now() - t3;
    this._checkAbort();

    // ── Stage 5: 角色代理（大纲含NPC即触发，不再限于完整模式） ──
    let characterInputs = [];
    const involvedNPCs = this._extractInvolvedNPCs(outline, state);
    if (involvedNPCs.length > 0) {
      const t4 = Date.now();
      onProgress('character_agents', `角色代理运行中 (${involvedNPCs.length})...`);
      try {
        characterInputs = await this._runCharacterAgents(state, userInput, involvedNPCs, reviewedOutline);
        timings.character_agents = Date.now() - t4;
      } catch (err) {
        console.warn('[AgentPipeline] Character agents failed, skipping:', err.message);
        eventBus.emit('agent:stage-skip', { stage: 'character_agents', reason: err.message });
        timings.character_agents = Date.now() - t4;
      }
      this._checkAbort();
    }

    // ── Stage 6: 正文写作 ──
    const t5 = Date.now();
    onProgress('writing', '正文写作中...');
    const draft = await this._writeDraft(state, userInput, reviewedOutline, outlineReviews, characterInputs, mainMessages);
    timings.writing = Date.now() - t5;
    this._checkAbort();
    eventBus.emit('agent:draft', { draft: typeof draft === 'string' ? draft.slice(0, 200) : '' });

    // ── Stage 7: 细节 + 风格审查（并行） ──
    const t6 = Date.now();
    onProgress('review_draft', '审查正文质量...');
    let draftReviews;
    try {
      draftReviews = await this._reviewDraft(state, draft, isFullMode);
      timings.review_draft = Date.now() - t6;
    } catch (err) {
      console.warn('[AgentPipeline] Draft review failed, skipping:', err.message);
      draftReviews = new Map();
      timings.review_draft = Date.now() - t6;
    }
    this._checkAbort();

    // ── Stage 8: 最终润色（放宽阈值：score<8 或 suggestions>=2） ──
    let finalText = draft;
    if (this._hasSignificantSuggestions(draftReviews)) {
      const t7 = Date.now();
      onProgress('polish', '最终润色中...');
      try {
        finalText = await this._polishDraft(state, userInput, draft, draftReviews, mainMessages);
        timings.polish = Date.now() - t7;
      } catch (err) {
        console.warn('[AgentPipeline] Polish failed, using raw draft:', err.message);
        timings.polish = Date.now() - t7;
      }
    }
    this._checkAbort();

    // ── Stage 9: 归档 ──
    const t8 = Date.now();
    onProgress('archive', '归档记忆...');
    // 这里只建立待提交增量。主 Pipeline 必须等 NarrativeArtifact 最终 apply 后，
    // 在 TurnCommitGuard 内原子合并；失败、取消或 discard 时丢弃。
    if (characterInputs.length > 0) {
      this._pendingCharacterMemoryDelta = buildCharacterMemoryDelta(characterInputs, {
        turn: state['系统·回合数'] || 0
      });
    }
    timings.archive = Date.now() - t8;

    timings.total = Date.now() - t0;
    eventBus.emit('agent:pipeline-complete', { timings, mode: isFullMode ? 'full' : 'standard' });
    console.log('[AgentPipeline] Timings:', timings);

    onProgress('done', '生成完成');
    return finalText;
  }

  // ── Stage Implementations ──

  async _brainstorm(state, userInput) {
    const rawResult = await this.runner.run('brainstormer', {
      state,
      userInput,
      taskPrompt: '请根据当前状态和玩家输入，提出 3-5 条剧情走向候选。',
      options: { temperature: 0.9, max_tokens: 1024 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'brainstormer', chunk })
    });

    this._assertPlannerOutputSafe(rawResult, 'brainstormer');
    const result = normalizeCandidateResult(rawResult);

    if (!result?.candidates?.length) return null;

    const guardianControl = await this._requestFutureGuardianControl(state, userInput, {
      scope: 'candidates',
      candidates: result.candidates
    });
    if (this._futureGuardianEnabled() && !guardianControl) return null;
    let candidates = result.candidates;
    if (guardianControl?.decision === 'reject') return null;
    if (guardianControl?.decision === 'filter') {
      const allowed = new Set(guardianControl.candidate_ids);
      candidates = candidates.filter(candidate => allowed.has(candidate.id));
      if (!candidates.length) return null;
    }

    const rec = result.recommended || 1;
    const selected = candidates.find(c => c.id === rec) || candidates[0];
    eventBus.emit('agent:brainstorm', { candidates, selected, guardianControl });
    return selected;
  }

  async _generateOutline(state, userInput, direction) {
    const hint = direction
      ? `\n\n[选定的剧情走向] ${direction.direction}\n理由: ${direction.reason}`
      : '';

    const rawResult = await this.runner.run('outliner', {
      state,
      userInput,
      taskPrompt: `请根据当前状态为本回合生成叙事大纲。${hint}`,
      extraContext: { _pipeline: this.pipeline },
      options: { temperature: 0.7, max_tokens: 2048 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'outliner', chunk })
    });

    this._assertPlannerOutputSafe(rawResult, 'outliner');
    const result = normalizeOutlineResult(rawResult);

    if (!result?.beats?.length) throw new Error('Outliner 未能生成有效大纲');
    const guardianControl = await this._requestFutureGuardianControl(state, userInput, {
      scope: 'outline',
      outline: result
    });
    if (this._futureGuardianEnabled() && !guardianControl) {
      throw futureGuardianRejectError('未通过因果护栏的大纲');
    }
    if (guardianControl?.decision === 'reject') throw futureGuardianRejectError('安全大纲');
    if (guardianControl?.decision === 'filter') {
      const allowed = new Set(guardianControl.beat_ids);
      result.beats = result.beats.filter(beat => allowed.has(beat.id));
      if (!result.beats.length) throw futureGuardianRejectError('安全大纲');
    }
    return result;
  }

  _futureGuardianEnabled() {
    const policy = this.pipeline?._activeCallPolicy;
    return Boolean(
      policy
      && policy.strictSingleCall !== true
      && policy.features?.agents === true
      && this.pipeline?._lastTurnEvidencePacket?.protected_future
    );
  }

  async _requestFutureGuardianControl(state, userInput, {
    scope, candidates = [], outline = null
  } = {}) {
    if (!this._futureGuardianEnabled()) return null;
    const validIds = scope === 'candidates'
      ? candidates.map(candidate => candidate.id)
      : (outline?.beats || []).map(beat => beat.id);
    if (!validIds.length) return null;
    try {
      const rawControl = await this.runner.run('future-guardian', {
        state,
        userInput,
        taskPrompt: scope === 'candidates'
          ? '审查候选与受保护未来是否冲突。只返回 scope=candidates 的无语义控制码。'
          : '审查大纲与受保护未来是否冲突。只返回 scope=outline 的无语义控制码。',
        extraContext: scope === 'candidates'
          ? { guardianCandidates: cloneJson(candidates) }
          : { guardianOutline: cloneJson(outline) },
        options: { temperature: 0, max_tokens: 256 },
        onChunk: chunk => eventBus.emit('agent:stream', { agent: 'future-guardian', chunk })
      });
      const control = parseFutureGuardianControl(rawControl, { scope, validIds });
      if (!control) {
        console.warn(`[AgentPipeline] Future guardian returned invalid ${scope} control; discarding unverified handoff`);
        eventBus.emit('agent:stage-skip', { stage: `future-guardian:${scope}`, reason: 'invalid-control' });
        return null;
      }
      eventBus.emit('agent:future-guardian', { control });
      return control;
    } catch (error) {
      if (error instanceof AgentAbortError || this._aborted) throw error;
      console.warn(`[AgentPipeline] Future guardian unavailable for ${scope}; discarding unverified handoff:`, error.message);
      eventBus.emit('agent:stage-skip', { stage: `future-guardian:${scope}`, reason: error.message });
      return null;
    }
  }

  async _reviewOutline(state, outline) {
    const results = await this.runner.runParallel([
      {
        type: 'critic-realism',
        key: 'critic-realism',
        params: {
          state,
          taskPrompt: '请审查以下叙事大纲的世界观合理性。',
          extraContext: { outline },
          options: { temperature: 0.3, max_tokens: 1024 },
          onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'critic-realism', chunk })
        }
      },
      {
        type: 'critic-character',
        key: 'critic-character',
        params: {
          state,
          taskPrompt: '请审查以下叙事大纲中角色行为的一致性。',
          extraContext: { outline },
          options: { temperature: 0.3, max_tokens: 1024 },
          onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'critic-character', chunk })
        }
      }
    ]);
    return results;
  }

  _mergeOutlineReviews(outline, reviews) {
    const merged = JSON.parse(JSON.stringify(outline));
    merged._hardConstraints = [];

    for (const [, result] of reviews) {
      if (!result.success || !result.data?.issues) continue;
      try {
        this._assertProtectedFutureOutputSafe(result.data, 'outline-critic');
      } catch (error) {
        console.warn('[AgentPipeline] Dropped future-contaminated outline review:', error.message);
        continue;
      }
      for (const issue of result.data.issues) {
        if (issue.severity === 'error' && issue.beatId) {
          const beat = merged.beats.find(b => b.id === issue.beatId);
          if (beat) {
            beat._reviews = beat._reviews || [];
            beat._reviews.push(issue);
            merged._hardConstraints.push(
              `[Beat ${issue.beatId}] ${issue.rule}: ${issue.suggestion || issue.description}`
            );
          }
        }
      }
    }
    return merged;
  }

  async _writeDraft(state, userInput, outline, reviews, characterInputs, mainMessages) {
    const reviewSummary = [];
    for (const [type, result] of reviews) {
      if (!result.success || !result.data) continue;
      try {
        this._assertProtectedFutureOutputSafe(result.data, `writer-review:${type}`);
      } catch (error) {
        console.warn('[AgentPipeline] Dropped future-contaminated writer review:', error.message);
        continue;
      }
      reviewSummary.push({ agent: type, ...result.data });
    }
    if (outline._hardConstraints?.length) {
      reviewSummary.push({ agent: 'hard-constraints', constraints: outline._hardConstraints });
    }

    const result = await this.runner.run('writer', {
      state,
      userInput,
      taskPrompt: '请基于审核后的大纲和审查建议，写出高质量叙事正文。',
      extraContext: {
        outline,
        reviews: reviewSummary,
        characterInputs: characterInputs.length > 0 ? characterInputs : undefined,
        _pipeline: this.pipeline,
        _inheritFromMainPipeline: true,
        _mainMessages: mainMessages
      },
      options: { temperature: 0.85, max_tokens: 8192 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'writer', chunk })
    });

    if (typeof result === 'string') return result;
    if (result?._raw) return result._raw;
    if (result?.text) return result.text;
    throw new Error('Writer 未能生成有效正文');
  }

  async _reviewDraft(state, draft, isFullMode) {
    const agents = [
      {
        type: 'critic-character',
        key: 'critic-contract',
        params: {
          state,
          taskPrompt: '请审查正文是否违反玩家开局契约、擅自改写玩家人设，或让NPC无故知道玩家秘密。所有冲突都按 error 报告，并给出可直接执行的改写建议。',
          extraContext: { draft },
          options: { temperature: 0.2, max_tokens: 1024 },
          onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'critic-contract', chunk })
        }
      },
      {
        type: 'critic-style',
        key: 'critic-style',
        params: {
          state,
          taskPrompt: '请审查以下正文的风格和节奏。',
          extraContext: { draft },
          options: { temperature: 0.3, max_tokens: 1024 },
          onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'critic-style', chunk })
        }
      }
    ];
    if (isFullMode) {
      agents.push({
        type: 'critic-detail',
        key: 'critic-detail',
        params: {
          state,
          taskPrompt: '请审查以下正文的感官描写和战斗细节质量。',
          extraContext: { draft },
          options: { temperature: 0.3, max_tokens: 1024 },
          onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'critic-detail', chunk })
        }
      });
    }
    return await this.runner.runParallel(agents);
  }

  _hasSignificantSuggestions(reviews) {
    for (const [, result] of reviews) {
      if (!result.success) continue;
      const score = result.data?.score;
      if (typeof score === 'number' && score < 8) return true;
      if (result.data?.suggestions?.length >= 2) return true;
      if (result.data?.issues?.length >= 1) return true;
    }
    return false;
  }

  async _polishDraft(state, userInput, draft, draftReviews, mainMessages) {
    const suggestions = [];
    for (const [type, result] of draftReviews) {
      if (result.success && result.data) {
        try {
          this._assertProtectedFutureOutputSafe(result.data, `draft-critic:${type}`);
        } catch (error) {
          console.warn('[AgentPipeline] Dropped future-contaminated draft review:', error.message);
          continue;
        }
      }
      if (result.success && result.data?.suggestions) {
        suggestions.push(...result.data.suggestions.map(s => ({ ...s, from: type })));
      }
      if (result.success && result.data?.issues) {
        suggestions.push(...result.data.issues.map(issue => ({
          location: issue.location || (issue.beatId ? `Beat ${issue.beatId}` : '正文相关段落'),
          type: 'opening_contract',
          description: issue.description || issue.rule || '违反玩家开局契约',
          suggestion: issue.suggestion || '按玩家开局契约重写冲突内容',
          from: type
        })));
      }
    }
    if (!suggestions.length) return draft;

    const result = await this.runner.run('writer-polish', {
      state,
      userInput,
      taskPrompt: '请根据审查建议润色正文。保持结构和变量标签不变，只改进文字质量。',
      extraContext: { draft, suggestions, _inheritFromMainPipeline: true, _mainMessages: mainMessages },
      options: { temperature: 0.75, max_tokens: 8192 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'writer-polish', chunk })
    });

    const text = typeof result === 'string' ? result : (result?._raw || null);
    return text && text.length > draft.length * 0.5 ? text : draft;
  }

  // ── 角色代理 ──

  _extractInvolvedNPCs(outline, state) {
    const npcSet = new Set();
    for (const beat of outline.beats || []) {
      for (const line of beat.dialogue || []) {
        const match = String(line).match(/^(.+?)[:：]/);
        if (match) {
          const name = match[1].trim();
          if (name.length >= 2 && name.length <= 10) npcSet.add(name);
        }
      }
    }
    const playerName = state['玩家·姓名'];
    if (playerName) npcSet.delete(playerName);
    return [...npcSet].slice(0, 3);
  }

  async _runCharacterAgents(state, userInput, npcNames, outline) {
    const agents = npcNames.map((npcName, idx) => ({
      type: 'character',
      key: `char-${idx}-${npcName}`,
      params: {
        state,
        userInput,
        taskPrompt: this._buildCharacterTaskPrompt(npcName, state, outline),
        extraContext: { npcName },
        options: { temperature: 0.8, max_tokens: 1024 },
        onChunk: (chunk) => eventBus.emit('agent:stream', { agent: `char-${npcName}`, chunk })
      }
    }));

    const results = await this.runner.runParallel(agents);
    const inputs = [];
    const failed = [];
    for (const [key, result] of results) {
      const npcName = key.replace(/^char-\d+-/, '');
      if (!result.success) {
        failed.push(npcName);
        continue;
      }
      try {
        this._assertProtectedFutureOutputSafe(result.data, `character:${npcName}`);
      } catch (error) {
        console.warn(`[AgentPipeline] Dropped future-contaminated character output for ${npcName}:`, error.message);
        failed.push(npcName);
        continue;
      }
      inputs.push({ npcName, npc: npcName, ...result.data });
      eventBus.emit('agent:character', { npc: npcName, response: result.data });
    }
    if (failed.length > 0) {
      console.warn(`[AgentPipeline] Character agents failed for: ${failed.join(', ')}`);
      eventBus.emit('agent:character-partial-failure', { failed });
    }
    return inputs;
  }

  _buildCharacterTaskPrompt(npcName, state, outline) {
    const rel = state._relationships?.[npcName];
    const rawNpcNotes = state._memory?.npc_notes;
    const npcNotes = typeof rawNpcNotes === 'string'
      ? rawNpcNotes.split('\n')
          .filter(line => line.startsWith(`${npcName}: `))
          .slice(-3)
          .map(line => line.slice(npcName.length + 2))
          .join(' | ')
      : (rawNpcNotes?.[npcName] || '');
    const charMemory = state._agent_memories?.[npcName];

    let prompt = `你现在是「${npcName}」。\n`;
    if (rel) {
      prompt += `与玩家(${state['玩家·姓名'] || '玩家'})的关系: 好感${rel.affection || 0} 信任${rel.trust || 0} 尊重${rel.respect || 0}`;
      if (rel.role) prompt += ` 角色:${rel.role}`;
      prompt += '\n';
    }
    if (npcNotes) prompt += `GM备注: ${npcNotes}\n`;
    if (charMemory) {
      prompt += `你的私有记忆:\n`;
      if (charMemory.personality) prompt += `- 性格: ${charMemory.personality}\n`;
      if (charMemory.currentMood) prompt += `- 当前情绪: ${charMemory.currentMood}\n`;
      if (charMemory.privateGoals?.length) prompt += `- 目标: ${charMemory.privateGoals.join(', ')}\n`;
      if (charMemory.knownFacts?.length) prompt += `- 近期记忆: ${charMemory.knownFacts.slice(-5).join('; ')}\n`;
      if (charMemory.privateIntentHistory?.length) {
        prompt += `- 仅你本人知道的近期意图: ${charMemory.privateIntentHistory.slice(-3).map(item => item.thought).filter(Boolean).join('; ')}\n`;
      }
    }
    const scenes = (outline.beats || []).map(b => b.scene).filter(Boolean);
    const sceneSummary = [
      `位置: ${state['世界·地点'] || '木叶隐村'} | 天气: ${state['世界·天气'] || '晴'}`,
      `时间: ${state['世界·时间'] || ''}`,
      scenes.length ? `剧情: ${scenes.join(' | ')}` : ''
    ].filter(Boolean).join('\n');
    prompt += `\n场景:\n${sceneSummary}\n`;
    if (scenes.length) prompt += `\n本回合大纲:\n${scenes.join('\n')}\n`;
    prompt += `\n请以「${npcName}」的第一人称视角，输出你在这个场景中的行为、对话和内心想法。`;
    return prompt;
  }

  peekPendingCharacterMemoryDelta() {
    return cloneJson(this._pendingCharacterMemoryDelta);
  }

  consumePendingCharacterMemoryDelta() {
    const delta = this.peekPendingCharacterMemoryDelta();
    this._pendingCharacterMemoryDelta = null;
    return delta;
  }

  discardPendingCharacterMemoryDelta() {
    this._pendingCharacterMemoryDelta = null;
  }

  // ── Utility ──

  _assertProtectedFutureOutputSafe(value, stage) {
    return assertNoProtectedFutureLeak(
      value,
      this.pipeline?._lastTurnEvidencePacket?.protected_future,
      {
        stage,
        allowedEvidence: this.pipeline?._lastTurnEvidenceViews?.writer || null
      }
    );
  }

  _assertPlannerOutputSafe(value, stage) {
    const packet = this.pipeline?._lastTurnEvidencePacket;
    this._assertProtectedFutureOutputSafe(value, stage);
    const restrictedWorldbook = (packet?.worldbook_entries || []).filter(entry => (
      entry?.knowledge?.visibility === 'secret' || entry?.knowledge?.visibility === 'backstage'
    ));
    if (!restrictedWorldbook.length || value == null) return;
    const serialized = JSON.stringify(value);
    const markers = new Set();
    for (const entry of restrictedWorldbook) {
      if (entry.id) markers.add(entry.id);
      if (String(entry.title || '').trim().length >= 4) markers.add(String(entry.title).trim());
      for (const fragment of String(entry.content || '').split(/[\n。！？；]+/)) {
        if (fragment.trim().length >= 10) markers.add(fragment.trim());
      }
    }
    const hit = [...markers].find(marker => serialized.includes(marker));
    if (hit) throw new Error(`${stage} 输出泄露受保护的未来或私密内容: ${hit}`);
  }

  _checkAbort() {
    if (this._aborted) throw new AgentAbortError();
  }
}

export { AgentPipeline };
