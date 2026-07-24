import { defineTimelineShard, makeTimelineId, normalizeTimelineNamespace } from './contract.mjs';

export { defineTimelineShard };

export const source = (reference, contribution = '提供主要冲突、人物动机与基准结果') => ({
  kind: 'manga', reference, contribution
});

export const bridge = (contribution = '补足项目日期、旅行时间、恢复期与可交互转场') => ({
  kind: 'original', reference: 'Naruto RPG 项目正史连接段', contribution
});

export const beat = (summary, causal_role) => ({ summary, causal_role });

const defaultSourceReferences = Object.freeze({
  HIST: 'NARUTO 历史篇对应材料',
  P1: 'NARUTO 第一部对应篇章',
  P2: 'NARUTO 疾风传对应篇章',
  BOR: 'BORUTO 对应篇章'
});

export function createTimelineHelpers(namespaceValue, options = {}) {
  const namespace = normalizeTimelineNamespace(namespaceValue);
  const defaultSourceReference = options.defaultSourceReference || defaultSourceReferences[namespace];

  function namespacedScene(code, title, thread, location, participants, resolutionMode, setup, beats, outcomes, stateChanges, stopCondition, designRationale, sceneOptions = {}, ...extraArgs) {
    const sceneId = makeTimelineId('scene', namespace, code);
    if (extraArgs.length > 0) {
      throw new Error(`${sceneId}: scene accepts exactly one options object; received ${extraArgs.length + 1}`);
    }
    for (const key of ['requirements', 'blockers', 'fallbacks']) {
      if (!Array.isArray(sceneOptions[key]) || sceneOptions[key].length === 0) {
        throw new Error(`${sceneId}: explicit ${key} are required`);
      }
    }
    if (resolutionMode === 'interactive') {
      const interactiveText = JSON.stringify([participants, setup, beats, outcomes, stopCondition]);
      if (!interactiveText.includes('玩家')) {
        throw new Error(`${sceneId}: interactive scene requires an explicit player entry`);
      }
      if (!beats.some(item => item.causal_role === 'choice')) {
        throw new Error(`${sceneId}: interactive scene requires a choice beat`);
      }
    }
    return {
      id: sceneId,
      title,
      thread_id: makeTimelineId('thread', namespace, thread),
      location,
      participants,
      resolution_mode: resolutionMode,
      requirements: sceneOptions.requirements,
      blockers: sceneOptions.blockers,
      setup,
      beats: beats.map((item, index) => ({ id: makeTimelineId('beat', namespace, `${code}-${String(index + 1).padStart(2, '0')}`), order: (index + 1) * 10, ...item })),
      outcomes,
      state_changes: stateChanges,
      stop_condition: stopCondition,
      fallbacks: sceneOptions.fallbacks,
      source_material: sceneOptions.sources || [source(sceneOptions.sourceRef || defaultSourceReference), bridge()],
      design_rationale: designRationale,
      reference_facts: sceneOptions.referenceFacts || []
    };
  }

  function namespacedDay(code, date, title, arcId, dayGoal, startState, scenes, endState, transition, referenceFacts = []) {
    return {
      id: makeTimelineId('day', namespace, code),
      date,
      title,
      arc_id: makeTimelineId('arc', namespace, arcId),
      day_goal: dayGoal,
      start_state: startState,
      scenes,
      end_state: endState,
      transition,
      reference_facts: referenceFacts
    };
  }

  return Object.freeze({ namespace, source, bridge, beat, scene: namespacedScene, day: namespacedDay });
}

const p1 = createTimelineHelpers('P1');
export const scene = p1.scene;
export const day = p1.day;
