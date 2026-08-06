import { eventBus } from './event-bus.js';
import { AgentRunner, AgentAbortError, resolveAgentSystemPrompt, mapWithConcurrency } from './agent-runner.js';
import { getAgentConfig } from '../data/agent-config.js';
import { stateManager } from './state-manager.js';
import { AgentContextBroker } from './agent-context-broker.js';
import { AgentToolRuntime, createNarrativeAgentTools } from './agent-tool-runtime.js';
import {
  assertCharacterDecision,
  assertSceneBrief,
  assertStoryArcPlan,
  auditTurnEnvelope,
  createTurnEnvelope,
  normalizeCharacterDecision,
  toWriterCharacterDecision
} from './agent-contracts.js';
import { createNarrativeArtifact } from './narrative-artifact.js';
import { CANON_DATABASE, normalizeCanonDate } from '../data/canon-database.js';

export const CHARACTER_MEMORY_DELTA_SCHEMA = 'naruto.character-memory-delta/v1';

// 阶段断点续跑缓存：键 = branch|回合|输入哈希；值 = { complete, data }。
// 回合失败时保留缓存，用户重试时复用上方已完成阶段，从失败阶段直接续跑。
const agentStageCache = new Map();

function hashAgentInput(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
    estimatedLength: Math.max(400, Number(result?.estimatedLength) || 1200),
    variableSummary: cleanMemoryText(result?.variableSummary, 800),
    beats: source.map((beat, index) => ({
      id: index + 1,
      scene: cleanMemoryText(beat.scene, 1200),
      tension: cleanMemoryText(beat.tension, 600),
      participants: [...new Set((Array.isArray(beat.participants) ? beat.participants : [])
        .map(value => cleanMemoryText(value, 80)).filter(Boolean))],
      openQuestion: cleanMemoryText(beat.openQuestion ?? beat.open_question, 600),
      mood: ['紧张', '轻松', '热血', '悲伤', '日常', '诡异'].includes(beat.mood)
        ? beat.mood
        : '日常',
      variables: [...new Set((Array.isArray(beat.variables) ? beat.variables : [])
        .filter(value => ['variable', 'combat', 'relationship', 'memory', 'mission', 'event'].includes(value)))]
    })).filter(beat => beat.scene)
  };
}

function cleanMemoryText(value, max = 600) {
  return String(value || '').trim().slice(0, max);
}

function currentStoryDate(state) {
  const raw = cleanMemoryText(state?.['世界·时间'] || state?.['世界·年代'], 120);
  const normalized = normalizeCanonDate(raw);
  if (normalized) return normalized;
  return raw.match(/^.*?日/)?.[0] || raw;
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
  constructor({ pipeline, memorySystem, contextBroker = null }) {
    this.pipeline = pipeline;
    this.memorySystem = memorySystem;
    this.runner = new AgentRunner({ pipeline });
    this._aborted = false;
    this._abortReason = null;
    this._pendingCharacterMemoryDelta = null;
    this._pendingStoryPlan = null;
    this._lastAgentAudit = null;
    this._lastSceneBrief = null;
    this._characterDecisions = [];
    this._agentSelfUpdater = false;
    this._activeToolRuntimes = new Set();
    this._turnController = null;
    this.contextBroker = contextBroker || pipeline?._agentContextBroker || new AgentContextBroker();
    this.contextBroker.configure({
      pipeline,
      memorySystem,
      timelineSystem: pipeline?.timelineSystem
    });
    if (pipeline) pipeline._agentContextBroker = this.contextBroker;
  }

  static isEnabled() {
    return getAgentConfig().enabled === true;
  }

  static getMode() {
    return getAgentConfig().mode || 'standard';
  }

  abort(reason = new AgentAbortError()) {
    this._aborted = true;
    this._abortReason = reason instanceof Error ? reason : new AgentAbortError();
    this._turnController?.abort(this._abortReason);
    this.runner.abort(this._abortReason);
    for (const runtime of this._activeToolRuntimes) runtime.abort(this._abortReason);
    this._activeToolRuntimes.clear();
  }

  _stageCacheKey(state, userInput) {
    return `${state?._meta?.active_branch || 'branch_main'}|${state?.['系统·回合数'] || 0}|${hashAgentInput(userInput)}`;
  }

  // 开始阶段缓存：获取(或新建)本回合的缓存条目，并同步 _stageCacheKeyRef。
  _beginStageCache(state, userInput) {
    const key = this._stageCacheKey(state, userInput);
    this._stageCacheKeyRef = key;
    let entry = agentStageCache.get(key);
    if (!entry) {
      entry = { complete: new Set(), data: {} };
      agentStageCache.set(key, entry);
    }
    return { key, entry };
  }

  _storeStage(entry, stage, data) {
    entry.complete.add(stage);
    Object.assign(entry.data, data);
    agentStageCache.set(this._stageCacheKeyRef, entry);
  }

  _clearStageCache() {
    if (this._stageCacheKeyRef) agentStageCache.delete(this._stageCacheKeyRef);
  }

  async execute(state, userInput, onProgress = () => {}, mainMessages = null) {
    this._aborted = false;
    this._abortReason = null;
    this._turnController = new AbortController();
    this._pendingCharacterMemoryDelta = null;
    this._pendingStoryPlan = null;
    this._lastAgentAudit = null;
    this._lastSceneBrief = null;
    this._characterDecisions = [];
    this._currentStage = null;
    this._stageCacheKeyRef = this._stageCacheKey(state, userInput);
    this.runner.configure();

    const mode = AgentPipeline.getMode();
    const isCombat = !!state._combat?.is_active;
    const agentCfg = getAgentConfig();
    const isFullMode = mode === 'full' || (agentCfg.autoUpgrade && isCombat);

    try {
      const result = await this._run(state, userInput, onProgress, isFullMode, isCombat, mainMessages);
      // 完整成功才清缓存；失败保留，供重试从失败阶段续跑。
      this._clearStageCache();
      return result;
    } catch (err) {
      if (!this._aborted) this.abort(err);
      if (!err.stage) err.stage = this._currentStage || null;
      this.discardPendingCharacterMemoryDelta();
      this.discardPendingStoryPlan();
      console.error('[AgentPipeline] Pipeline failed; turn aborted:', err.message);
      eventBus.emit('agent:failed', { reason: err.message, code: err.code || '', stage: err.stage });
      onProgress('error', `Agent 回合已中止: ${err.message}`);
      throw err;
    }
  }

  async _run(state, userInput, onProgress, isFullMode, isCombat, mainMessages) {
    const timings = {};
    const t0 = Date.now();

    // 阶段断点续跑：恢复本回合已完成的阶段输出，从失败阶段直接续跑(复用上方正确环节)。
    const cached = this._beginStageCache(state, userInput).entry;
    let storyPlan = state?._agent_story_plan || null;
    let selectedDirection = null;
    let outline = null;
    let outlineReviews = null;
    let reviewedOutline = null;
    let characterInputs = [];
    let draft = null;
    if (cached.complete.has('story_plan')) storyPlan = cached.data.storyPlan;
    if (cached.complete.has('brainstorm')) selectedDirection = cached.data.selectedDirection;
    if (cached.complete.has('outline')) outline = cached.data.outline;
    if (cached.complete.has('outline_review')) {
      outline = cached.data.outline;
      outlineReviews = cached.data.outlineReviews || null;
      reviewedOutline = cached.data.reviewedOutline;
    }
    if (cached.complete.has('character_agents')) characterInputs = cached.data.characterInputs;
    if (cached.complete.has('writing')) draft = cached.data.draft;

    // ── Stage 1: 强制历史检索 + 无行动场景简报 ──
    onProgress('context_search', '检索人物、对话与世界历史...');
    const contextStartedAt = Date.now();
    const preflight = await this.contextBroker.preflight({
      state,
      query: userInput,
      audience: 'planner',
      limit: 12
    });
    timings.context_search = Date.now() - contextStartedAt;
    eventBus.emit('agent:context-ready', {
      sources: preflight.sources,
      cache: preflight.cache,
      durationMs: preflight.durationMs
    });
    const sceneBrief = this._buildSceneBrief(state, userInput, preflight);
    this._lastSceneBrief = sceneBrief;
    eventBus.emit('agent:scene-brief', sceneBrief);
    timings.state_snap = Date.now() - t0;
    this._checkAbort();

    // ── Stage 2: 三日条件故事线（日期/分支/重大分歧时刷新） ──
    this._currentStage = 'story_plan';
    const currentStoryPlan = state?._agent_story_plan || null;
    if (cached.complete.has('story_plan')) {
      storyPlan = cached.data.storyPlan;
      this._pendingStoryPlan = storyPlan;
      eventBus.emit('agent:story-plan', { plan: storyPlan, refreshed: true });
    } else if (this._shouldRefreshStoryPlan(state, userInput, currentStoryPlan)) {
      const planStartedAt = Date.now();
      onProgress('story_plan', '规划未来三日条件故事线...');
      storyPlan = await this._generateStoryPlan(state, userInput, sceneBrief, preflight);
      this._pendingStoryPlan = storyPlan;
      this._storeStage(cached, 'story_plan', { storyPlan });
      timings.story_plan = Date.now() - planStartedAt;
      eventBus.emit('agent:story-plan', { plan: storyPlan, refreshed: true });
    } else {
      eventBus.emit('agent:story-plan', { plan: storyPlan, refreshed: false });
    }
    this._checkAbort();

    // ── Stage 3: 头脑风暴（完整模式 + 非战斗） ──
    this._currentStage = 'brainstorm';
    if (isFullMode && !isCombat) {
      const t1 = Date.now();
      if (!cached.complete.has('brainstorm')) {
        onProgress('brainstorm', '头脑风暴中...');
        try {
          selectedDirection = await this._brainstorm(state, userInput);
          this._storeStage(cached, 'brainstorm', { selectedDirection });
          timings.brainstorm = Date.now() - t1;
        } catch (err) {
          console.warn('[AgentPipeline] Brainstorm failed, skipping:', err.message);
          eventBus.emit('agent:stage-skip', { stage: 'brainstorm', reason: err.message });
          timings.brainstorm = Date.now() - t1;
        }
      }
      this._checkAbort();
    }

    // ── Stage 4: 只描述场景、不替角色行动的节拍 ──
    this._currentStage = 'outline';
    const t2 = Date.now();
    if (!cached.complete.has('outline')) {
      onProgress('outline', '构建叙事大纲...');
      outline = await this._generateOutline(state, userInput, selectedDirection, {
        sceneBrief,
        storyPlan,
        preflight
      });
      this._storeStage(cached, 'outline', { outline });
    }
    timings.outline = Date.now() - t2;
    this._checkAbort();
    eventBus.emit('agent:outline', { outline });

    // ── Stage 5: 场景节拍审查（并行）+ 大纲修复环 ──
    this._currentStage = 'outline_review';
    const t3 = Date.now();
    if (!cached.complete.has('outline_review')) {
      onProgress('review_outline', '审查大纲合理性...');
      outlineReviews = await this._reviewOutline(state, outline);
      // 大纲(便宜)审查发现问题时，重新生成一次大纲，确保正文从合格大纲一次性写出。
      if (this._outlineNeedsFix(outlineReviews)) {
        onProgress('review_outline', '按审查意见修正大纲...');
        try {
          const feedback = this._collectOutlineFeedback(outlineReviews);
          const fixedOutline = await this._generateOutline(state, userInput, null, {
            sceneBrief,
            storyPlan,
            preflight,
            feedback
          });
          if (fixedOutline?.beats?.length) {
            outline = fixedOutline;
            outlineReviews = await this._reviewOutline(state, outline);
          }
        } catch (error) {
          console.warn('[AgentPipeline] Outline fix failed, using reviewed outline:', error?.message);
        }
      }
      reviewedOutline = this._mergeOutlineReviews(outline, outlineReviews);
      this._storeStage(cached, 'outline_review', { outline, outlineReviews, reviewedOutline });
    }
    timings.review_outline = Date.now() - t3;
    this._checkAbort();

    // ── Stage 6: 所有在场命名 NPC 独立决策 ──
    this._currentStage = 'character_agents';
    const involvedNPCs = this._extractInvolvedNPCs(sceneBrief, outline, state, userInput);
    if (involvedNPCs.length > 0 && !cached.complete.has('character_agents')) {
      const t4 = Date.now();
      onProgress('character_agents', `角色代理运行中 (${involvedNPCs.length})...`);
      try {
        characterInputs = await this._runCharacterAgents(
          state,
          userInput,
          involvedNPCs,
          sceneBrief,
          reviewedOutline,
          storyPlan
        );
        this._storeStage(cached, 'character_agents', { characterInputs });
        timings.character_agents = Date.now() - t4;
      } catch (err) {
        console.error('[AgentPipeline] Character agent batch failed; turn aborted:', err.message);
        eventBus.emit('agent:stage-failed', { stage: 'character_agents', reason: err.message });
        timings.character_agents = Date.now() - t4;
        throw err;
      }
      this._checkAbort();
    }

    // ── Stage 7: 正文写作（只使用角色代理的可观察决定） ──
    this._currentStage = 'writing';
    const t5 = Date.now();
    if (!cached.complete.has('writing')) {
      onProgress('writing', '正文写作中...');
      draft = await this._writeDraft(
        state,
        userInput,
        sceneBrief,
        storyPlan,
        reviewedOutline,
        outlineReviews,
        characterInputs,
        mainMessages
      );
      this._storeStage(cached, 'writing', { draft });
    }
    timings.writing = Date.now() - t5;
    this._checkAbort();
    eventBus.emit('agent:draft', { draft: typeof draft === 'string' ? draft.slice(0, 200) : '' });

    // ── Stage 8: 细节 + 风格审查（并行） ──
    this._currentStage = 'review_draft';
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

    // ── Stage 9: 最终润色（放宽阈值：score<8 或 suggestions>=2） ──
    this._currentStage = 'polish';
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

    // ── Stage 10: 润色后复审 + 完整性审计 ──
    this._currentStage = 'final_audit';
    const auditStartedAt = Date.now();
    onProgress('final_audit', '审查正文、角色来源与系统更新契约...');
    let finalReviews = await this._reviewFinalOutput(state, finalText);
    // 可搜索的剧情合理性审查（时间/记忆一致性），结果并入终审。
    const searchReview = await this._reviewWithSearch(state, userInput, finalText);
    if (searchReview) finalReviews.set('critic-search', searchReview);

    // 先审计当前正文：审查没问题(审计通过)直接跳过修复，省去多余调用。
    // 仅当审计不通过(存在错误级问题)时才做一轮修复重写并复审；
    // 修复/复审任何一步失败都降级回原稿与原评审，绝不卡死回合。
    let agentAudit = this._auditFinalOutput({
      state,
      finalText,
      sceneBrief,
      storyPlan,
      involvedNPCs,
      reviews: finalReviews
    });
    if (!agentAudit.valid) {
      const finalIssues = this._collectFinalIssues(finalReviews);
      if (finalIssues.length) {
        try {
          const repaired = await this._repairFinalText(state, userInput, finalText, finalIssues, mainMessages);
          if (repaired && repaired !== finalText) {
            onProgress('final_audit', '按审查意见修复正文并复审...');
            finalText = repaired;
            const repairedReviews = await this._reviewFinalOutput(state, finalText);
            const repairedSearch = await this._reviewWithSearch(state, userInput, finalText);
            if (repairedSearch) repairedReviews.set('critic-search', repairedSearch);
            finalReviews = repairedReviews;
            agentAudit = this._auditFinalOutput({
              state,
              finalText,
              sceneBrief,
              storyPlan,
              involvedNPCs,
              reviews: finalReviews
            });
          }
        } catch (error) {
          console.warn('[AgentPipeline] Final repair skipped after failure:', error?.message);
        }
      }
    }
    this._lastAgentAudit = agentAudit;
    timings.final_audit = Date.now() - auditStartedAt;
    eventBus.emit('agent:audit', {
      schema: this._lastAgentAudit.schema,
      valid: this._lastAgentAudit.valid,
      errors: [...this._lastAgentAudit.errors],
      warnings: [...this._lastAgentAudit.warnings],
      checks: this._lastAgentAudit.checks,
      auditedAt: this._lastAgentAudit.auditedAt
    });
    if (!this._lastAgentAudit.valid) {
      const error = new Error(`Agent 最终审计失败: ${this._lastAgentAudit.errors.join('；')}`);
      error.code = 'AGENT_FINAL_AUDIT_FAILED';
      throw error;
    }
    this._checkAbort();

    // ── Stage 11: 连续性更新代理(记忆/变量/历史)，替代主流水线二次变量系统 ──
    // 审计通过后才运行；产出的 <var>/<relationship>/<memory> 标签追加到正文末尾，
    // 由主流水线 createNarrativeArtifact + _applyInstructions 统一应用。
    this._currentStage = 'continuity_updater';
    this._agentSelfUpdater = false;
    finalText = await this._appendContinuityUpdates(state, userInput, finalText, involvedNPCs, sceneBrief);

    // ── Stage 12: 只建立待提交记忆增量 ──
    this._currentStage = 'archive';
    const t8 = Date.now();
    onProgress('archive', '归档记忆...');
    // 这里只建立待提交增量。主 Pipeline 必须等 NarrativeArtifact 最终 apply 后，
    // 在 TurnCommitGuard 内原子合并；失败、取消或 discard 时丢弃。
    if (this._characterDecisions.length > 0) {
      this._pendingCharacterMemoryDelta = buildCharacterMemoryDelta(this._characterDecisions.map(decision => ({
        npcName: decision.npc,
        ...decision.observable,
        innerThought: decision.private.thought
      })), {
        turn: state['系统·回合数'] || 0
      });
    }
    timings.archive = Date.now() - t8;

    timings.total = Date.now() - t0;
    eventBus.emit('agent:pipeline-complete', { timings, mode: isFullMode ? 'full' : 'standard' });
    console.log('[AgentPipeline] Timings:', timings);

    // 校验最终正文有可见内容；为空(模型被截断/只输出了推理)时做一次强制正文降级重写。
    if (!String(createNarrativeArtifact(finalText).displayText || '').trim()) {
      console.warn('[AgentPipeline] Final text has no visible body; forcing a body retry...');
      try {
        const fallback = await this._writeVisibleBodyFallback(state, userInput, finalText, mainMessages);
        if (fallback && String(createNarrativeArtifact(fallback).displayText || '').trim()) {
          finalText = fallback;
        }
      } catch (error) {
        console.warn('[AgentPipeline] Forced body retry failed:', error?.message);
      }
    }
    if (!String(createNarrativeArtifact(finalText).displayText || '').trim()) {
      const error = new Error('Agent 正文为空(模型可能被截断或只输出了推理)，本回合已中止，请重试');
      error.code = 'AGENT_EMPTY_BODY';
      throw error;
    }

    onProgress('done', '生成完成');
    return finalText;
  }

  // 最终正文无可见内容时的降级重写：强制输出完整正文，不要求先输出推理。
  async _writeVisibleBodyFallback(state, userInput, draft, mainMessages) {
    const result = await this.runner.run('writer', {
      state,
      userInput,
      taskPrompt: '立即输出完整可读的剧情正文。正文至少 300 字，直接写场景、动作与对话；必须先完成正文主体，再考虑是否输出任何标签。',
      extraContext: {
        draft,
        _inheritFromMainPipeline: true,
        _mainMessages: mainMessages,
        reviews: []
      },
      options: { temperature: 0.85, max_tokens: 8192 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'writer', chunk })
    });
    return typeof result === 'string' ? result : (result?._raw || null);
  }

  _createToolRuntime() {
    const runtime = new AgentToolRuntime({ contextBroker: this.contextBroker });
    const baseConfig = stateManager.getAPIConfig?.() || {};
    const agentConfig = getAgentConfig();
    runtime.configure({
      ...baseConfig,
      model: agentConfig.agentModel || baseConfig.model || ''
    });
    this._activeToolRuntimes.add(runtime);
    return runtime;
  }

  _releaseToolRuntime(runtime) {
    this._activeToolRuntimes.delete(runtime);
  }

  _buildSceneBrief(state, userInput, preflight) {
    const playerName = cleanMemoryText(state?.['玩家·姓名'], 80) || '玩家';
    const location = cleanMemoryText(state?.['世界·地点'], 240) || '未知地点';
    const participants = new Set([playerName]);
    const addParticipant = value => {
      const name = cleanMemoryText(value, 80);
      if (!name || /^(?:玩家|主角|路人|路人A|中忍|下忍|上忍|守卫|敌人|众人)$/.test(name)) return;
      participants.add(name);
    };
    addParticipant(state?._combat?.enemy_name);

    const packetPlot = this.pipeline?._lastTurnEvidencePacket?.current_plot || null;
    const matchedSceneIds = new Set(packetPlot?.matched_scene_ids || []);
    const plotSources = packetPlot ? [{
      scenes: (packetPlot.scenes || []).filter(scene => (
        matchedSceneIds.size ? matchedSceneIds.has(scene.id) : (packetPlot.scenes || []).length === 1
      ))
    }] : [];
    // 剧情场景的参与者只在该场景地点与玩家当前位置匹配时才视为在场，
    // 避免把整片区域的常驻角色(如木叶的鸣人/水木/伊鲁卡)误当成本回合在场。
    const locationOverlaps = (sceneLocation) => {
      const a = String(sceneLocation || '');
      const b = String(location || '');
      return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
    };
    for (const plot of plotSources) {
      for (const scene of plot.scenes || []) {
        if (!locationOverlaps(scene.location)) continue;
        for (const name of scene.participants || []) addParticipant(name);
      }
    }

    const recentDialogue = (preflight?.domains?.dialogue?.items || [])
      .slice(0, 6).map(item => item.summary).join('\n');
    // 角色代理只授予“确实被点名”的角色：玩家输入或近期对话明确提到。
    // 不再依据“关系档案里 location 与玩家同一地点”判定在场——那会把整片区域的
    // 常驻 NPC 每回合都拉进角色代理，即使他们并不在当前场景。
    for (const [name] of Object.entries(state?._relationships || {})) {
      if (String(userInput || '').includes(name) || recentDialogue.includes(name)) addParticipant(name);
    }

    const facts = (preflight?.domains?.world?.items || [])
      .slice(0, 8)
      .map(item => cleanMemoryText(item.summary, 700))
      .filter(Boolean);
    if (!facts.length) facts.push(`当前地点：${location}`);
    const evidenceRefs = (preflight?.sources || []).map(source => (
      `${source.kind || 'source'}:${source.id || 'unknown'}`
    ));
    return assertSceneBrief({
      id: `scene:${state?._meta?.active_branch || 'branch_main'}:${state?.['系统·回合数'] || 0}`,
      location,
      time: state?.['世界·时间'] || state?.['世界·年代'] || '',
      participants: [...participants],
      playerIntent: userInput,
      facts,
      constraints: [
        '玩家输入只代表意图，不预设成功或失败',
        'NPC 的行动、台词和态度只能由对应角色代理决定',
        '只使用授权历史和当前分支证据'
      ],
      tensions: (preflight?.domains?.world?.items || [])
        .filter(item => item.id?.includes('current-plot'))
        .slice(0, 4)
        .map(item => cleanMemoryText(item.summary, 500)),
      evidenceRefs
    });
  }

  _shouldRefreshStoryPlan(state, userInput, plan) {
    if (!plan) return true;
    try { assertStoryArcPlan(plan); } catch { return true; }
    const branchId = state?._meta?.active_branch || 'branch_main';
    const currentDate = currentStoryDate(state);
    if (plan.branchId !== branchId) return true;
    if (currentDate && plan.startDate && plan.startDate !== currentDate) return true;
    if (!Array.isArray(plan.days) || plan.days.length !== 3) return true;
    if (state?._agent_story_plan_invalidated === true) return true;
    if (/(?:改走|改变计划|拒绝|放弃|背叛|逃离|杀死|另一路线|切换分支)/.test(String(userInput || ''))) {
      return true;
    }
    return (plan.refreshTriggers || []).some(trigger => (
      trigger && String(userInput || '').includes(trigger)
    ));
  }

  _fallbackStoryPlan(state, sceneBrief, reason = '') {
    const date = currentStoryDate(state) || '当前日期';
    const pressure = sceneBrief.tensions[0] || `若局势继续发展，${sceneBrief.location}的现有矛盾可能升级`;
    return assertStoryArcPlan({
      branchId: state?._meta?.active_branch || 'branch_main',
      basedOnNodeId: state?._meta?.current_node_id || '',
      startDate: date,
      premise: `围绕${sceneBrief.location}当前局势保持开放推进${reason ? `（规划代理降级：${reason}）` : ''}`,
      days: [0, 1, 2].map(dayOffset => ({
        dayOffset,
        date: dayOffset === 0 ? date : `当前日期后第${dayOffset}日`,
        pressures: [dayOffset === 0 ? pressure : '若前一日矛盾未解决，相关势力会调整应对方式'],
        opportunities: ['若玩家主动调查或交涉，可获得新的分支信息'],
        triggers: ['玩家选择继续接触当前人物、地点或事件时'],
        invalidationConditions: ['玩家离开当前故事线、关键前提改变或切换时间线分支时']
      })),
      refreshTriggers: ['日期变化', '重大分歧', '切换分支']
    }, {
      branchId: state?._meta?.active_branch || 'branch_main',
      nodeId: state?._meta?.current_node_id || '',
      startDate: date,
      turn: state?.['系统·回合数'] || 0
    });
  }

  async _generateStoryPlan(state, userInput, sceneBrief, preflight) {
    const runtime = this._createToolRuntime();
    const tools = createNarrativeAgentTools({
      contextBroker: this.contextBroker,
      state,
      userInput,
      audience: 'planner',
      getStoryPlan: () => state?._agent_story_plan || null
    });
    let rawPlan = null;
    try {
      eventBus.emit('agent:subagent-start', { subagent: 'story-planner' });
      const result = await runtime.runAgent({
        definition: {
          id: 'story-planner',
          instructions: resolveAgentSystemPrompt('STORY_PLANNER')
        },
        messages: [{
          role: 'user',
          content: `根据无行动场景简报与已检索历史，设计从当前日期开始的三日条件故事线。\n${JSON.stringify(sceneBrief)}`
        }],
        tools,
        outputSchema: { type: 'object' },
        budget: { maxSteps: 7, maxOutputTokens: 2400, temperature: 0.45 },
        state,
        userInput,
        audience: 'planner'
      });
      rawPlan = result.output;
      eventBus.emit('agent:subagent-end', { subagent: 'story-planner', success: true });
    } catch (error) {
      eventBus.emit('agent:subagent-end', {
        subagent: 'story-planner', success: false, error: error.message
      });
      console.warn('[AgentPipeline] Tool story planner failed; using compatibility agent:', error.message);
      try {
        rawPlan = await this.runner.run('story-planner', {
          state,
          userInput,
          taskPrompt: '输出从当前日期开始的三日条件故事线；不得强迫玩家或 NPC 行动。',
          extraContext: {
            sceneBrief,
            contextPacket: {
              sources: preflight?.sources || [],
              cache: preflight?.cache || null,
              items: preflight?.items?.slice?.(0, 20) || []
            },
            _pipeline: this.pipeline
          },
          options: { temperature: 0.45, max_tokens: 2400 }
        });
      } catch (fallbackError) {
        console.warn('[AgentPipeline] Story planner unavailable:', fallbackError.message);
        return this._fallbackStoryPlan(state, sceneBrief, fallbackError.message);
      }
    } finally {
      this._releaseToolRuntime(runtime);
    }
    try {
      return assertStoryArcPlan({
        ...rawPlan,
        branchId: state?._meta?.active_branch || 'branch_main',
        basedOnNodeId: state?._meta?.current_node_id || '',
        startDate: currentStoryDate(state),
        createdAt: Date.now()
      }, {
        branchId: state?._meta?.active_branch || 'branch_main',
        nodeId: state?._meta?.current_node_id || '',
        startDate: currentStoryDate(state),
        turn: state?.['系统·回合数'] || 0
      });
    } catch (error) {
      console.warn('[AgentPipeline] Story plan contract rejected:', error.message);
      return this._fallbackStoryPlan(state, sceneBrief, error.message);
    }
  }

  _assertActionFreeOutline(outline) {
    const forbidden = ['action', 'actions', 'dialogue', 'decision', 'decisions', 'outcome', 'result'];
    const violations = [];
    for (const [index, beat] of (outline?.beats || []).entries()) {
      for (const key of forbidden) {
        const value = beat?.[key];
        if (value != null && (!Array.isArray(value) || value.length) && String(value).trim() !== '') {
          violations.push(`beats[${index}].${key}`);
        }
      }
    }
    if (violations.length) {
      const error = new Error(`Outliner 越权预写角色行动/台词: ${violations.join(', ')}`);
      error.code = 'OUTLINE_ACTOR_AUTONOMY_VIOLATION';
      throw error;
    }
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

    const rec = result.recommended || 1;
    const selected = result.candidates.find(c => c.id === rec) || result.candidates[0];
    eventBus.emit('agent:brainstorm', { candidates: result.candidates, selected });
    return selected;
  }

  async _generateOutline(state, userInput, direction, {
    sceneBrief = null,
    storyPlan = null,
    preflight = null,
    feedback = []
  } = {}) {
    const hint = direction
      ? `\n\n[选定的剧情走向] ${direction.direction}\n理由: ${direction.reason}`
      : '';
    const feedbackText = Array.isArray(feedback) && feedback.length
      ? `\n\n【大纲审查意见，请据此修正大纲，不要重复这些问题】\n${feedback.slice(0, 8).join('\n')}`
      : '';

    const rawResult = await this.runner.run('outliner', {
      state,
      userInput,
      taskPrompt: `请根据当前状态生成无行动场景节拍。禁止替玩家或任何 NPC 决定行动、台词和结果。${hint}${feedbackText}`,
      extraContext: {
        sceneBrief,
        storyPlan,
        contextPacket: preflight ? {
          sources: preflight.sources,
          cache: preflight.cache
        } : null,
        _pipeline: this.pipeline
      },
      options: { temperature: 0.7, max_tokens: 2048 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'outliner', chunk })
    });

    this._assertPlannerOutputSafe(rawResult, 'outliner');
    this._assertActionFreeOutline(rawResult);
    const result = normalizeOutlineResult(rawResult);

    if (!result?.beats?.length) throw new Error('Outliner 未能生成有效大纲');
    return result;
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

  // 大纲审查是否需重生成：存在错误级问题，或累计 2 条以上问题。
  _outlineNeedsFix(reviews) {
    let errorCount = 0;
    let issueCount = 0;
    for (const [, result] of reviews) {
      if (!result?.success) continue;
      const data = result.data;
      if (!data || typeof data !== 'object') continue;
      for (const item of [
        ...(Array.isArray(data.issues) ? data.issues : []),
        ...(Array.isArray(data.suggestions) ? data.suggestions : [])
      ]) {
        if (!item || typeof item !== 'object') continue;
        issueCount++;
        if (item.severity === 'error') errorCount++;
      }
    }
    return errorCount >= 1 || issueCount >= 2;
  }

  // 汇总大纲审查意见，供重生成大纲时反馈给 outliner。
  _collectOutlineFeedback(reviews) {
    const lines = [];
    for (const [, result] of reviews) {
      if (!result?.success) continue;
      const data = result.data;
      if (!data || typeof data !== 'object') continue;
      for (const item of [
        ...(Array.isArray(data.issues) ? data.issues : []),
        ...(Array.isArray(data.suggestions) ? data.suggestions : [])
      ]) {
        if (!item || typeof item !== 'object') continue;
        lines.push(`${item.description || item.rule || '大纲问题'}${item.suggestion ? ` → 建议：${item.suggestion}` : ''}`);
      }
    }
    return lines;
  }

  _mergeOutlineReviews(outline, reviews) {
    const merged = JSON.parse(JSON.stringify(outline));
    merged._hardConstraints = [];

    for (const [, result] of reviews) {
      if (!result.success || !result.data?.issues) continue;
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

  async _writeDraft(
    state,
    userInput,
    sceneBrief,
    storyPlan,
    outline,
    reviews,
    characterInputs,
    mainMessages
  ) {
    const reviewSummary = [];
    for (const [type, result] of reviews) {
      if (!result.success || !result.data) continue;
      reviewSummary.push({ agent: type, ...result.data });
    }
    if (outline._hardConstraints?.length) {
      reviewSummary.push({ agent: 'hard-constraints', constraints: outline._hardConstraints });
    }

    const writerExtraContext = {
      sceneBrief,
      storyPlan,
      outline,
      reviews: reviewSummary,
      characterInputs: characterInputs.length > 0 ? characterInputs : undefined,
      _pipeline: this.pipeline,
      _inheritFromMainPipeline: true,
      _mainMessages: mainMessages
    };
    const delegatedNpcNames = this._characterDecisions.map(decision => decision.npc);
    const npcAuthorityConstraint = [
      '【角色代理授权边界·不可覆盖】',
      '不得新增任何命名 NPC 或其他角色；不得为 NPC 新增、替换或扩写角色代理未授权的行动和台词。',
      delegatedNpcNames.length
        ? `本回合唯一可演出的命名 NPC：${delegatedNpcNames.join('、')}；且只能呈现已提供的 CharacterDecision 可观察内容。`
        : '本回合没有任何已授权的命名 NPC，正文不得让命名 NPC 登场、行动或说话。'
    ].join('\n');
    const runtime = this._createToolRuntime();
    const tools = createNarrativeAgentTools({
      contextBroker: this.contextBroker,
      state,
      userInput,
      audience: 'writer',
      getStoryPlan: () => storyPlan,
      delegates: {
        delegate_character: async ({ npc }) => {
          const decision = this._characterDecisions.find(item => item.npc === npc);
          if (!decision) {
            return { found: false, available: this._characterDecisions.map(item => item.npc) };
          }
          return { found: true, decision: toWriterCharacterDecision(decision) };
        },
        delegate_story_planner: async () => cloneJson(storyPlan),
        delegate_reviewer: async ({ task }) => ({
          scheduled: true,
          stage: 'final_audit',
          request: cleanMemoryText(task, 500)
        })
      }
    });
    try {
      const constraint = this.runner._buildWriterConstraint(writerExtraContext, state);
      const inheritedMessages = Array.isArray(mainMessages) ? mainMessages : [];
      const result = await runtime.runAgent({
        definition: { id: 'writer', instructions: resolveAgentSystemPrompt('WRITER') },
        messages: [
          // 稳定前缀在前：继承的系统消息 + 对话历史(非 system)。
          // 易变约束(场景/大纲/审查/角色决策)放历史之后，避免打断缓存前缀。
          ...inheritedMessages.filter(message => message.role === 'system'),
          ...inheritedMessages.filter(message => message.role !== 'system'),
          { role: 'system', content: constraint },
          { role: 'system', content: npcAuthorityConstraint },
          {
            role: 'user',
            content: `基于场景事实与角色代理决定写出本回合完整正文。必须保留主系统要求的全部结构标签。\n${npcAuthorityConstraint}`
          }
        ],
        tools,
        budget: { maxSteps: 10, maxOutputTokens: 8192, temperature: 0.82 },
        state,
        userInput,
        audience: 'writer'
      });
      if (result.text?.trim()) {
        eventBus.emit('agent:stream', { agent: 'writer', chunk: result.text });
        return result.text;
      }
      throw new Error('Tool writer returned empty text');
    } catch (error) {
      if (this._aborted) throw error;
      console.warn('[AgentPipeline] Tool writer failed; using compatibility writer:', error.message);
      eventBus.emit('agent:writer-fallback', { reason: error.message });
    } finally {
      this._releaseToolRuntime(runtime);
    }

    const result = await this.runner.run('writer', {
      state,
      userInput,
      taskPrompt: `请基于审核后的大纲和审查建议，写出高质量叙事正文。\n${npcAuthorityConstraint}`,
      extraContext: writerExtraContext,
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

    const delegatedNpcNames = this._characterDecisions.map(decision => decision.npc);
    const npcAuthorityConstraint = delegatedNpcNames.length
      ? `严禁新增任何 NPC，也不得新增或改变 NPC 的行动与台词。只可保留初稿中由 CharacterDecision 授权的命名 NPC：${delegatedNpcNames.join('、')}。`
      : '严禁新增任何 NPC，也不得让命名 NPC 登场、行动或说话。';

    const result = await this.runner.run('writer-polish', {
      state,
      userInput,
      taskPrompt: `请根据审查建议润色正文。保持结构和变量标签不变，只改进文字质量。${npcAuthorityConstraint}`,
      extraContext: { draft, suggestions, _inheritFromMainPipeline: true, _mainMessages: mainMessages },
      options: { temperature: 0.75, max_tokens: 8192 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'writer-polish', chunk })
    });

    const text = typeof result === 'string' ? result : (result?._raw || null);
    return text && text.length > draft.length * 0.5 ? text : draft;
  }

  // 汇总终审(含可搜索审查)里带可执行建议的问题，用于修复重写。
  _collectFinalIssues(reviews) {
    const issues = [];
    for (const [type, result] of reviews) {
      if (!result?.success) continue;
      const data = result.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      for (const item of [
        ...(Array.isArray(data.issues) ? data.issues : []),
        ...(Array.isArray(data.suggestions) ? data.suggestions : [])
      ]) {
        if (!item || typeof item !== 'object') continue;
        issues.push({
          severity: item.severity === 'error' ? 'error' : 'warning',
          dimension: String(item.dimension || item.rule || item.type || '').slice(0, 80),
          description: String(item.description || item.summary || '').slice(0, 300),
          suggestion: String(item.suggestion || '').slice(0, 300),
          from: String(type || '')
        });
      }
    }
    return issues;
  }

  // 终审发现错误级问题后的修复重写：用 writer-polish 按审查建议重写正文，
  // 再交由 Stage 10 复审；修复无效时返回原稿。
  async _repairFinalText(state, userInput, draft, issues, mainMessages) {
    const delegatedNpcNames = this._characterDecisions.map(decision => decision.npc);
    const npcAuthorityConstraint = delegatedNpcNames.length
      ? `严禁新增任何 NPC，也不得新增或改变 NPC 的行动与台词。只可保留正文中已由 CharacterDecision 授权的命名 NPC：${delegatedNpcNames.join('、')}。`
      : '严禁新增任何 NPC，也不得让命名 NPC 登场、行动或说话。';
    const issueText = issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `- [${issue.from || issue.dimension || '终审'}] ${issue.description}${issue.suggestion ? ` → 建议：${issue.suggestion}` : ''}`)
      .join('\n');
    if (!issueText) return draft;
    try {
      const result = await this.runner.run('writer-polish', {
        state,
        userInput,
        taskPrompt: `终审发现以下必须修复的问题。请按建议重写正文，彻底解决这些问题；只改动有问题的部分，保持整体叙事、结构标签与既定事实不变。${npcAuthorityConstraint}\n\n【必须修复的问题】\n${issueText}`,
        extraContext: { draft, suggestions: issues, _inheritFromMainPipeline: true, _mainMessages: mainMessages },
        options: { temperature: 0.75, max_tokens: 8192 },
        onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'writer-polish', chunk })
      });
      const text = typeof result === 'string' ? result : (result?._raw || null);
      // 修复稿必须仍有可见正文；若被重写成了纯推理/标签(显示正文为空)，保留原稿。
      if (!text || text.length < draft.length * 0.5) return draft;
      if (!String(createNarrativeArtifact(text).displayText || '').trim()) return draft;
      return text;
    } catch (error) {
      console.warn('[AgentPipeline] Repair rewrite failed, keeping original:', error?.message);
      return draft;
    }
  }

  async _reviewFinalOutput(state, finalText) {
    return this.runner.runParallel([
      {
        type: 'critic-character',
        key: 'final-preset-and-character',
        params: {
          state,
          taskPrompt: '最终审查：正文是否符合玩家预设与开局契约，且所有命名 NPC 行为均可由提供的角色决定支持。严重问题按 error 报告。',
          extraContext: {
            draft: finalText,
            characterInputs: this._characterDecisions.map(toWriterCharacterDecision),
            _pipeline: this.pipeline
          },
          options: { temperature: 0.15, max_tokens: 1200 }
        }
      },
      {
        type: 'critic-realism',
        key: 'final-world-and-state',
        params: {
          state,
          taskPrompt: '最终审查：检查正文可见结果是否违背当前分支事实、人物认知、资源守恒或实力边界。严重问题按 error 报告。',
          extraContext: { draft: finalText, _pipeline: this.pipeline },
          options: { temperature: 0.15, max_tokens: 1200 }
        }
      },
      {
        type: 'critic-style',
        key: 'final-output-shape',
        params: {
          state,
          taskPrompt: '最终审查：确认存在可见正文、自然交互停点和系统要求的尾部结构，不要改写正文。',
          extraContext: { draft: finalText, _pipeline: this.pipeline },
          options: { temperature: 0.15, max_tokens: 1000 }
        }
      }
    ]);
  }

  // 可搜索的剧情合理性审查：用检索工具核对最终正文的时间/记忆一致性。
  // 失败降级为 warning，不中断回合。
  async _reviewWithSearch(state, userInput, finalText) {
    const runtime = this._createToolRuntime();
    const tools = createNarrativeAgentTools({
      contextBroker: this.contextBroker,
      state,
      userInput,
      audience: 'reviewer'
    });
    try {
      const result = await runtime.runAgent({
        definition: {
          id: 'critic-search',
          instructions: resolveAgentSystemPrompt('CRITIC_SEARCH')
        },
        messages: [{
          role: 'user',
          content: `审查以下最终正文的剧情合理性，重点核对时间与记忆一致性。必要时使用检索工具核实，不要仅凭正文或预训练知识臆断。\n\n${String(finalText || '').slice(0, 12000)}`
        }],
        tools,
        outputSchema: { type: 'object' },
        budget: { maxSteps: 4, maxOutputTokens: 1400, temperature: 0.15 },
        state,
        userInput,
        audience: 'reviewer'
      });
      const output = result?.output;
      return output && typeof output === 'object'
        ? { success: true, data: output }
        : { success: false, error: 'critic-search 未返回结构化结果' };
    } catch (error) {
      if (this._aborted) throw error;
      console.warn('[AgentPipeline] Search review failed, downgraded to warning:', error.message);
      return { success: false, error: error.message };
    } finally {
      this._releaseToolRuntime(runtime);
    }
  }

  // 运行连续性更新代理并把产出的结构标签追加到正文末尾；失败/无标签时原样返回。
  async _appendContinuityUpdates(state, userInput, finalText, involvedNPCs, sceneBrief) {
    try {
      const updaterTags = await this._runContinuityUpdater(state, userInput, finalText, involvedNPCs, sceneBrief);
      if (updaterTags && /<(?:var|variable|relationship|memory|shinobi_daily)\b/i.test(updaterTags)) {
        this._agentSelfUpdater = true;
        return `${finalText}\n\n${updaterTags}`;
      }
    } catch (error) {
      console.warn('[AgentPipeline] Continuity updater failed, falling back to pipeline updater:', error?.message);
    }
    return finalText;
  }

  // 连续性更新代理：根据最终正文 + 角色记忆增量 + 当前关系，产出 <var>/<relationship>/<memory> 标签，
  // 替代主流水线的二次变量系统。失败由调用方降级。
  async _runContinuityUpdater(state, userInput, finalText, involvedNPCs, sceneBrief) {
    const characterInputs = (involvedNPCs || []).map(npcName => {
      const relationship = state?._relationships?.[npcName] || {};
      const history = Array.isArray(relationship.history) ? relationship.history : [];
      return {
        npcName,
        currentAffection: relationship.affection,
        currentTrust: relationship.trust,
        currentRespect: relationship.respect,
        innerThoughts: Array.isArray(relationship.inner_thoughts)
          ? relationship.inner_thoughts.join('；')
          : (relationship.inner_thoughts || ''),
        history: history.slice(0, 5).map(entry => entry?.summary || entry)
      };
    });
    const result = await this.runner.run('continuity-updater', {
      state,
      userInput,
      taskPrompt: `根据最终正文与角色记忆增量，输出本回合的 <var>、<relationship>(含 inner_thoughts 心理与 history 历史) 与唯一一个 <memory> 标签。在场已认识 NPC：${(involvedNPCs || []).join('、') || '(无)'}`,
      extraContext: {
        sceneBrief,
        draft: finalText,
        characterInputs,
        _pipeline: this.pipeline
      },
      options: { temperature: 0.4, max_tokens: 4096 },
      onChunk: (chunk) => eventBus.emit('agent:stream', { agent: 'continuity-updater', chunk })
    });
    return typeof result === 'string' ? result : (result?._raw || result?.text || '');
  }

  // 是否已由连续性更新代理产出结构标签（供主流水线跳过二次变量系统）。
  didAgentProduceUpdaterTags() {
    return this._agentSelfUpdater === true;
  }

  _buildKnownNpcIdentityIndex(state, sceneBrief, involvedNPCs = []) {
    const playerName = cleanMemoryText(state?.['玩家·姓名'], 80);
    const candidates = new Map();
    const add = (value, canonical = value) => {
      const name = cleanMemoryText(value, 80);
      const canonicalName = cleanMemoryText(canonical, 80);
      const length = [...name].length;
      if (!name || !canonicalName || length < 2 || length > 40) return;
      if (/^(?:玩家|主角|路人|路人A|中忍|下忍|上忍|守卫|敌人|众人|村民)$/.test(name)) return;
      candidates.set(name, canonicalName);
    };

    for (const name of involvedNPCs || []) add(name);
    for (const name of sceneBrief?.participants || []) add(name);
    for (const [name, relationship] of Object.entries(state?._relationships || {})) {
      add(name);
      for (const alias of relationship?.aliases || []) add(alias, name);
    }
    for (const name of Object.keys(state?._agent_memories || {})) add(name);

    const npcNotes = state?._memory?.npc_notes;
    if (npcNotes && typeof npcNotes === 'object' && !Array.isArray(npcNotes)) {
      for (const name of Object.keys(npcNotes)) add(name);
    } else {
      for (const line of String(npcNotes || '').split(/\r?\n/)) {
        const match = line.match(/^([^:：]{2,40})\s*[:：]/);
        if (match) add(match[1]);
      }
    }

    add(state?._combat?.enemy_name);
    add(state?._combat?.enemyName);
    for (const enemy of state?._combat?.enemies || []) add(enemy?.name || enemy?.npcName || enemy);

    const evidencePacket = this.pipeline?._lastTurnEvidencePacket;
    const currentPlot = evidencePacket?.current_plot;
    for (const scene of currentPlot?.scenes || []) {
      for (const name of scene?.participants || []) add(name);
    }
    for (const mention of evidencePacket?.character_mentions || []) {
      const names = Array.isArray(mention?.names) ? mention.names : [];
      const canonicalName = cleanMemoryText(mention?.canonical_name || names[0], 80);
      add(canonicalName);
      for (const name of names) add(name, canonicalName);
    }
    for (const entry of evidencePacket?.worldbook_entries || []) {
      const names = Array.isArray(entry?.character_profile?.names)
        ? entry.character_profile.names
        : [];
      const canonicalName = cleanMemoryText(names[0], 80);
      add(canonicalName);
      for (const name of names) add(name, canonicalName);
    }

    try {
      const snapshot = CANON_DATABASE.getYearSnapshotContext({ state })?.snapshot;
      for (const character of snapshot?.characters || []) add(character?.name);
    } catch (error) {
      console.warn('[AgentPipeline] Canon NPC audit inventory unavailable:', error.message);
    }

    const playerNames = new Set(playerName ? [playerName] : []);
    const playerCanonical = playerName ? (candidates.get(playerName) || playerName) : '';
    if (playerCanonical) {
      for (const [surfaceName, canonicalName] of candidates) {
        if (surfaceName === playerName
          || canonicalName === playerName
          || canonicalName === playerCanonical) {
          playerNames.add(surfaceName);
          playerNames.add(canonicalName);
        }
      }
      for (const name of playerNames) candidates.delete(name);
    }

    return { candidates, playerNames };
  }

  _extractKnownNpcMentions(
    state,
    finalText,
    sceneBrief,
    involvedNPCs = [],
    identityIndex = null
  ) {
    const index = identityIndex || this._buildKnownNpcIdentityIndex(
      state,
      sceneBrief,
      involvedNPCs
    );
    const visibleText = createNarrativeArtifact(finalText).displayText;
    const mentioned = new Set();
    for (const [surfaceName, canonicalName] of [...index.candidates.entries()]
      .sort((a, b) => [...b[0]].length - [...a[0]].length)) {
      if (visibleText.includes(surfaceName)) mentioned.add(canonicalName);
    }
    return [...mentioned];
  }

  _auditFinalOutput({ state, finalText, sceneBrief, storyPlan, involvedNPCs, reviews }) {
    const evidenceRefs = [
      ...sceneBrief.evidenceRefs,
      ...this._characterDecisions.map(decision => decision.id)
    ];
    const artifact = createNarrativeArtifact(finalText, { evidenceRefs });
    const tags = artifact.instructions || [];
    // Agent 模式：变量/记忆/日报一律由后续二次变量更新在 commit 边界内产出，
    // 因此审计始终按 deferred-until-commit 处理，writer 无需自附标签。
    const updaterEnabled = true;
    const businessTags = new Set(['var', 'variable', 'combat', 'mission', 'relationship', 'event']);
    const staged = updaterEnabled
      ? {
          variableUpdates: { owner: 'variable-updater', status: 'deferred-until-commit' },
          memory: { owner: 'variable-updater', status: 'deferred-until-commit' },
          shinobiDaily: { owner: 'variable-updater', status: 'deferred-until-commit' }
        }
      : {
          variableUpdates: tags.some(block => businessTags.has(block.tag))
            || tags.some(block => block.tag === 'state_update')
            ? { owner: 'main', status: 'present' }
            : null,
          memory: tags.some(block => block.tag === 'memory')
            ? { owner: 'main', status: 'present' }
            : null,
          shinobiDaily: tags.some(block => block.tag === 'shinobi_daily')
            ? { owner: 'main', status: 'present' }
            : null
        };
    const envelope = createTurnEnvelope({
      turnId: `turn:${state?._meta?.active_branch || 'branch_main'}:${state?.['系统·回合数'] || 0}`,
      branchId: state?._meta?.active_branch || 'branch_main',
      nodeId: state?._meta?.current_node_id || '',
      sceneBrief,
      narrativeArtifact: artifact,
      characterDecisions: this._characterDecisions,
      characterDecisionRefs: this._characterDecisions.map(decision => decision.id),
      staged,
      storyPlan,
      trace: []
    });
    const modelFindings = [];
    let presetCompliant = true;
    let finalPresetReviewerSeen = false;
    for (const [reviewer, result] of reviews || []) {
      const mandatoryPresetReviewer = reviewer === 'final-preset-and-character';
      if (mandatoryPresetReviewer) finalPresetReviewerSeen = true;
      if (!result.success) {
        const severity = mandatoryPresetReviewer ? 'error' : 'warning';
        if (severity === 'error') presetCompliant = false;
        modelFindings.push({ reviewer, severity, description: result.error || 'reviewer unavailable' });
        continue;
      }
      if (mandatoryPresetReviewer) {
        const data = result.data;
        const parseFailed = /(?:JSON\s*)?解析失败|parse\s+failed/i.test(String(data?.summary || ''));
        let invalidReason = '';
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          invalidReason = 'reviewer returned no structured data';
        } else if (parseFailed) {
          invalidReason = data.summary;
        } else if (data.approved !== true) {
          invalidReason = data.approved === false
            ? 'reviewer explicitly rejected the final output'
            : 'reviewer omitted approved:true';
        }
        if (invalidReason) {
          presetCompliant = false;
          modelFindings.push({ reviewer, severity: 'error', description: invalidReason });
        }
      }
      const findings = [
        ...(result.data?.issues || []),
        ...(result.data?.suggestions || [])
      ];
      for (const finding of findings) {
        const severity = finding.severity === 'error' ? 'error' : 'warning';
        if ((reviewer === 'final-preset-and-character' || reviewer === 'critic-contract')
          && severity === 'error') presetCompliant = false;
        modelFindings.push({ reviewer, severity, ...cloneJson(finding) });
      }
    }
    if (!finalPresetReviewerSeen) {
      presetCompliant = false;
      modelFindings.push({
        reviewer: 'final-preset-and-character',
        severity: 'error',
        description: 'required reviewer unavailable'
      });
    }
    const identityIndex = this._buildKnownNpcIdentityIndex(state, sceneBrief, involvedNPCs);
    const mentionedNPCs = this._extractKnownNpcMentions(
      state,
      finalText,
      sceneBrief,
      involvedNPCs,
      identityIndex
    );
    const canonicalIdentity = value => {
      const name = cleanMemoryText(value, 80);
      return identityIndex.candidates.get(name) || name;
    };
    const decisionsByIdentity = new Map(this._characterDecisions.map(decision => (
      [canonicalIdentity(decision.npc), decision]
    )));
    const requiredNpcs = [...new Set([...(involvedNPCs || []), ...mentionedNPCs])]
      .filter(name => !identityIndex.playerNames.has(name))
      .map(name => decisionsByIdentity.get(canonicalIdentity(name))?.npc || name);
    const base = auditTurnEnvelope(envelope, {
      requiredNpcs: [...new Set(requiredNpcs)],
      requireVariables: true,
      requireMemory: true,
      requireDaily: true,
      requireStoryPlan: true,
      presetCompliant
    });
    const errors = [...base.errors];
    for (const finding of modelFindings) {
      if (finding.severity === 'error') {
        errors.push(`${finding.reviewer}: ${finding.description || finding.suggestion || finding.rule || '最终审查发现严重问题'}`);
      }
    }
    for (const decision of this._characterDecisions) {
      const privateThought = cleanMemoryText(decision.private?.thought, 800);
      if (privateThought.length >= 8 && String(finalText).includes(privateThought)) {
        errors.push(`正文泄露 ${decision.npc} 的角色代理私有想法`);
      }
    }
    return Object.freeze({
      ...base,
      valid: errors.length === 0,
      errors: Object.freeze([...new Set(errors)]),
      warnings: Object.freeze([
        ...base.warnings,
        ...modelFindings.filter(item => item.severity !== 'error')
          .map(item => `${item.reviewer}: ${item.description || item.suggestion || item.type || 'review warning'}`)
      ]),
      modelFindings: Object.freeze(modelFindings),
      mentionedNPCs: Object.freeze(mentionedNPCs),
      envelope,
      evidenceRefs: Object.freeze(evidenceRefs)
    });
  }

  // ── 角色代理 ──

  _extractInvolvedNPCs(sceneBrief, outline, state, userInput) {
    // 角色代理是昂贵的子代理，只授予“可靠在场/已知”的角色：
    // 关系档案已认识、当前战斗敌人、或玩家输入明确点名的 NPC。
    // 场景简报里凭空出现的陌生 NPC（例如 canon 毕业场景 SCN-P1-START-GRAD-01 的
    // 漩涡鸣人/水木/海野伊鲁卡/本届毕业生）不再授予角色代理。
    const known = new Set(Object.keys(state?._relationships || {}));
    const enemy = cleanMemoryText(state?._combat?.enemy_name, 80);
    const inputText = String(userInput || '');
    const npcSet = new Set();
    if (enemy) npcSet.add(enemy);
    for (const name of sceneBrief?.participants || []) {
      const trimmed = String(name || '').trim();
      if (known.has(trimmed) || inputText.includes(trimmed)) npcSet.add(trimmed);
    }
    for (const name of Object.keys(state?._relationships || {})) npcSet.add(String(name || '').trim());
    const playerName = state['玩家·姓名'];
    if (playerName) npcSet.delete(playerName);
    npcSet.delete('玩家');
    return [...npcSet].filter(name => (
      name.length >= 2
      && name.length <= 40
      && !/^(?:主角|路人|路人A|中忍|下忍|上忍|守卫|敌人|众人|村民|本届毕业生)$/.test(name)
    ));
  }

  async _runCharacterAgents(state, userInput, npcNames, sceneBrief, outline, storyPlan) {
    // 所有 NPC 子代理共享同一个并发闸门，避免同时爆发大量上游请求触发限流。
    // stopOnError：任一子代理失败（实际只会因取消/中止抛出）后立即停止排队任务；
    // signal：回合取消时同步中断所有仍排队等待启动的角色子代理。
    const decisions = await mapWithConcurrency(
      npcNames,
      npcName => this._runOneCharacterAgent({
        state,
        userInput,
        npcName,
        sceneBrief,
        outline,
        storyPlan
      }),
      {
        maxConcurrency: this.runner.maxConcurrency,
        stopOnError: true,
        signal: this._turnController?.signal
      }
    );
    this._characterDecisions = decisions;
    return decisions.map(decision => ({
      npcName: decision.npc,
      npc: decision.npc,
      decisionId: decision.id,
      provenance: decision.provenance,
      fallbackReason: decision.fallbackReason,
      ...cloneJson(decision.observable)
    }));
  }

  async _runOneCharacterAgent({ state, userInput, npcName, sceneBrief, outline, storyPlan }) {
    const runtime = this._createToolRuntime();
    const taskPrompt = this._buildCharacterTaskPrompt(
      npcName, state, userInput, sceneBrief, outline, storyPlan
    );
    const tools = createNarrativeAgentTools({
      contextBroker: this.contextBroker,
      state,
      userInput,
      audience: 'npc',
      npcName,
      getStoryPlan: () => null
    });
    let nativeError = null;
    eventBus.emit('agent:subagent-start', { subagent: 'character', npc: npcName });
    try {
      const result = await runtime.runAgent({
        definition: {
          id: `character:${npcName}`,
          instructions: resolveAgentSystemPrompt('CHARACTER_AGENT')
        },
        messages: [{ role: 'user', content: taskPrompt }],
        tools,
        outputSchema: { type: 'object' },
        budget: { maxSteps: 6, maxOutputTokens: 1200, temperature: 0.75 },
        state,
        userInput,
        audience: 'npc',
        npcName
      });
      const decision = assertCharacterDecision({
        ...result.output,
        npc: npcName,
        sceneId: sceneBrief.id,
        evidenceRefs: [
          ...(result.output?.evidenceRefs || []),
          ...(result.preflight?.sources || []).map(source => `${source.kind}:${source.id}`)
        ]
      });
      eventBus.emit('agent:character', {
        npc: npcName,
        response: toWriterCharacterDecision(decision)
      });
      eventBus.emit('agent:subagent-end', {
        subagent: 'character', npc: npcName, success: true, decisionId: decision.id
      });
      return decision;
    } catch (error) {
      nativeError = error;
      if (this._aborted) throw error;
      console.warn(`[AgentPipeline] Tool character agent ${npcName} failed:`, error.message);
    } finally {
      this._releaseToolRuntime(runtime);
    }

    try {
      const result = await this.runner.run('character', {
        state,
        userInput,
        taskPrompt,
        extraContext: { npcName, sceneBrief, storyPlan, _pipeline: this.pipeline },
        options: { temperature: 0.75, max_tokens: 1200 },
        // Character JSON can contain private thought. It is parsed internally and
        // never streamed onto the shared event bus.
      });
      const decision = assertCharacterDecision({
        ...result,
        npc: npcName,
        sceneId: sceneBrief.id,
        evidenceRefs: sceneBrief.evidenceRefs
      });
      eventBus.emit('agent:character', {
        npc: npcName,
        response: toWriterCharacterDecision(decision)
      });
      eventBus.emit('agent:subagent-end', {
        subagent: 'character', npc: npcName, success: true,
        decisionId: decision.id, compatibilityFallback: true
      });
      return decision;
    } catch (compatibilityError) {
      const fallbackReason = [nativeError?.message, compatibilityError?.message]
        .filter(Boolean).join(' | ').slice(0, 500);
      const decision = assertCharacterDecision(normalizeCharacterDecision({
        npc: npcName,
        sceneId: sceneBrief.id,
        action: `${npcName}没有贸然行动，保持当前可观察姿态并等待局势进一步明朗。`,
        dialogue: '',
        innerThought: '',
        provenance: 'director-fallback',
        fallbackReason,
        evidenceRefs: sceneBrief.evidenceRefs
      }, {
        npc: npcName,
        sceneId: sceneBrief.id,
        turn: state?.['系统·回合数'] || 0
      }));
      console.warn(`[AgentPipeline] Director fallback recorded for ${npcName}: ${fallbackReason}`);
      eventBus.emit('agent:character-fallback', {
        npc: npcName,
        decisionId: decision.id,
        reason: fallbackReason
      });
      eventBus.emit('agent:subagent-end', {
        subagent: 'character', npc: npcName, success: false,
        fallback: 'director', decisionId: decision.id
      });
      return decision;
    }
  }

  _buildCharacterTaskPrompt(npcName, state, userInput, sceneBrief, outline, storyPlan) {
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
    prompt += `\n无行动场景简报（导演没有替你决定行为）:\n${JSON.stringify(sceneBrief)}\n`;
    prompt += `\n场景节拍只描述事实、压力和待回答问题:\n${JSON.stringify(outline)}\n`;
    if (storyPlan?.days?.[0]) {
      prompt += `\n今日条件压力与机会（不是强制剧情）:\n${JSON.stringify(storyPlan.days[0])}\n`;
    }
    prompt += `\n玩家输入只是意图：${String(state['玩家·姓名'] || '玩家')}提出了“${cleanMemoryText(userInput, 500)}”。`;
    prompt += `\n现在仅由你本人决定「${npcName}」的可观察行为和台词，并把私有想法放入 innerThought。`;
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

  peekPendingStoryPlan() {
    return cloneJson(this._pendingStoryPlan);
  }

  consumePendingStoryPlan() {
    const plan = this.peekPendingStoryPlan();
    this._pendingStoryPlan = null;
    return plan;
  }

  discardPendingStoryPlan() {
    this._pendingStoryPlan = null;
  }

  getLastAgentAudit() {
    return this._lastAgentAudit;
  }

  getLastEvidenceRefs() {
    return [...(this._lastAgentAudit?.evidenceRefs || [])];
  }

  // ── Utility ──

  _assertPlannerOutputSafe(value, stage) {
    const packet = this.pipeline?._lastTurnEvidencePacket;
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
    if (hit) throw new Error(`${stage} 输出泄露受限制的私密内容: ${hit}`);
  }

  _checkAbort() {
    if (this._aborted) throw (this._abortReason || new AgentAbortError());
  }
}

export { AgentPipeline };
