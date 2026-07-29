// AI 调用策略的单一判定入口。
// 严格单调用只约束「一次游戏回合自动触发的 API」；设置页中的显式手动操作不在此范围。

export const AI_CALL_POLICY_DEFAULTS = Object.freeze({
  strictSingleCall: true
});

const FEATURE_LABELS = Object.freeze({
  variableUpdater: '二次变量模型',
  narrativeReview: '正文复检模型',
  agents: 'Agent 协作',
  aiCompression: 'AI 记忆压缩',
  deepConsolidation: '记忆深度整理',
  npcSummary: 'NPC AI 总结',
  imagePromptPlanner: '独立图像提示词规划',
  automaticImage: '自动回合插图'
});

function enabled(value) {
  return value === true;
}

function requestedFeatures({ apiConfig, agentConfig, memoryConfig, imageSettings }) {
  const imageEnabled = enabled(imageSettings?.enabled);
  const automaticImage = imageEnabled
    && (imageSettings?.turnMode === 'auto' || imageSettings?.turnMode === 'automatic');
  return {
    variableUpdater: enabled(apiConfig?.variableUpdater?.enabled),
    narrativeReview: enabled(apiConfig?.narrativeReview?.enabled),
    agents: enabled(agentConfig?.enabled),
    aiCompression: enabled(memoryConfig?.aiCompressionEnabled),
    deepConsolidation: enabled(memoryConfig?.deepEnabled),
    npcSummary: enabled(memoryConfig?.npcSummaryEnabled),
    imagePromptPlanner: imageEnabled && imageSettings?.promptMode === 'separate-model',
    automaticImage
  };
}

function estimateCalls(features, agentConfig = {}) {
  if (features.agents) {
    const full = agentConfig.mode === 'full';
    const extra = Number(features.variableUpdater) + Number(features.narrativeReview);
    return {
      minimum: (full ? 7 : 4) + extra,
      maximum: null,
      conditional: [
        'Agent 数量随登场角色和审查结果变化',
        '请求失败时可能透明重试',
        ...(features.aiCompression ? ['AI 记忆压缩'] : []),
        ...(features.deepConsolidation ? ['记忆深度整理'] : []),
        ...(features.npcSummary ? ['NPC AI 总结'] : []),
        ...(features.imagePromptPlanner ? ['独立图像提示词规划'] : []),
        ...(features.automaticImage ? ['自动回合插图'] : [])
      ]
    };
  }

  const foreground = 1
    + Number(features.variableUpdater)
    + Number(features.narrativeReview)
    + Number(features.imagePromptPlanner)
    + Number(features.automaticImage);
  const conditional = [
    '请求失败时可能透明重试',
    ...(features.aiCompression ? ['AI 记忆压缩'] : []),
    ...(features.deepConsolidation ? ['记忆深度整理'] : []),
    ...(features.npcSummary ? ['NPC AI 总结'] : [])
  ];
  return { minimum: foreground, maximum: foreground, conditional };
}

export function formatAICallEstimate(policy) {
  if (policy?.strictSingleCall) return '严格单调用：每回合固定 1 次 API';
  const estimate = policy?.estimate || { minimum: 1, maximum: 1, conditional: [] };
  const count = estimate.maximum === null
    ? `每回合至少 ${estimate.minimum} 次 API`
    : `每回合预计 ${estimate.minimum} 次 API`;
  return estimate.conditional?.length
    ? `${count}；另有条件调用：${estimate.conditional.join('、')}`
    : count;
}

/**
 * 兼容旧配置：若没有保存过调用策略，只有当所有可选 AI 功能均关闭时才自动进入严格模式。
 * 若用户显式勾选严格模式，它优先于仍保留在设置中的可选功能开关；这些开关不会被删除，只会暂停。
 */
export function resolveAICallPolicy({
  apiConfig = {},
  agentConfig = {},
  memoryConfig = {},
  imageSettings = {}
} = {}) {
  const requested = requestedFeatures({ apiConfig, agentConfig, memoryConfig, imageSettings });
  const requestedNames = Object.entries(requested).filter(([, value]) => value).map(([name]) => name);
  const savedStrict = apiConfig?.aiCallPolicy?.strictSingleCall;
  const inferred = typeof savedStrict !== 'boolean';
  const strictSingleCall = savedStrict === true
    || (inferred && requestedNames.length === 0);
  const features = strictSingleCall
    ? Object.fromEntries(Object.keys(requested).map(name => [name, false]))
    : { ...requested };
  const blockedFeatures = strictSingleCall
    ? requestedNames.map(name => ({ name, label: FEATURE_LABELS[name] || name }))
    : [];
  const estimate = strictSingleCall
    ? { minimum: 1, maximum: 1, conditional: [] }
    : estimateCalls(features, agentConfig);

  const policy = {
    mode: strictSingleCall ? 'single' : (requestedNames.length ? 'enhanced' : 'direct'),
    strictSingleCall,
    inferred,
    requestedFeatures: requested,
    features,
    blockedFeatures,
    estimate,
    // 严格模式下传给流式适配器：禁止透明重试和无流响应的二次请求。
    mainGenerationOptions: strictSingleCall
      ? { maxRetries: 0, strictSingleRequest: true }
      : {},
    allowBackgroundMemoryAI: !strictSingleCall,
    allowAuxiliaryAI: !strictSingleCall
  };
  policy.estimateText = formatAICallEstimate(policy);
  return policy;
}
