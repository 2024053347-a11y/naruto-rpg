import { formatOpeningContractPrompt } from './opening-contract.js';

const MODE_DIRECTIVES = {
  strict: '严格档案：不得为玩家新增或改写初始能力、天赋、血继、物品、装备、关系和未填写的人设。',
  fill: '补全空白：只可补充完全空白的类别；已有任意玩家条目的类别不得新增同类初始条目，绝不覆盖、改名、删除玩家条目。',
  expand: '自由扩写：可以添加相容的辅助细节，但绝不覆盖、改名、删除或削弱玩家条目。'
};

export function getOpeningCompletionDirective(contract) {
  const mode = contract?.completion_policy?.mode || 'fill';
  return MODE_DIRECTIVES[mode] || MODE_DIRECTIVES.fill;
}

export function buildOpeningPrompt({ state = {}, contract = null, updaterEnabled = false } = {}) {
  const nature = Array.isArray(state['玩家·查克拉属性'])
    ? state['玩家·查克拉属性'].join('、')
    : String(state['玩家·查克拉属性'] || '未设定');
  const timeline = state['世界·时间'] || state['世界·年代'] || '年代未定';
  const compactContract = formatOpeningContractPrompt(contract, { compact: true });
  const completionDirective = getOpeningCompletionDirective(contract);
  const hasPendingCustomTalent = (contract?.invariants || []).some(item => String(item).includes('待AI结构化的自定义天赋要求'));
  const initializationBoundary = hasPendingCustomTalent
    ? '- 玩家明确填写的六项属性、已有具体天赋/血继、能力、物品、装备槽和初始关系已经写入当前状态。\n- “自定义天赋组合”只是待处理要求；允许本回合生成具体天赋，生成后必须替换该占位项。'
    : '- 玩家明确填写的六项属性、天赋、血继、能力、物品、装备槽和初始关系已经写入当前状态。';
  const mainOutputRule = updaterEnabled
    ? `后台变量更新模型负责本回合全部结构化记忆、任务与人物档案。主模型不得输出任何结构标签；只写叙事，并在正文中清楚写明实际登场人物的姓名、身份与已展示能力，供后台模型落账。`
    : `当前未启用后台变量更新模型。主模型可为本回合真实发生的新变化输出变量标签，可为实际登场的新 NPC 输出 <relationship>，结尾输出 <memory> 与 <status_query />；不得借开局名义重建角色面板。`;

  return `[开局请求·本地档案已完成]
角色：${state['玩家·姓名'] || '未命名忍者'}
公开身份：${state['玩家·公开身份'] || '未公开'}
正式忍阶：${state['玩家·正式忍阶'] || state['玩家·忍阶'] || '未评定'}
实际战力：${state['玩家·战力等级'] || '未评定'}
所属：${state['玩家·所属村'] || '无所属'}
地点：${state['世界·地点'] || '未知地点'}
时代：${timeline}
查克拉性质：${nature}

【本地初始化边界】
${initializationBoundary}
- 不得再次初始化、重新估值、降级、改名、合并或删除这些条目。
- ${completionDirective}
- 上述限制针对首次开局补全；开场剧情中真正发生的即时变化仍可按事件记录。

【开场叙事】
- 严格遵守玩家开局契约和当前时代，不得默认成木叶忍校学生，也不得擅自改回木叶村。
- 玩家未指定家族、村落和地点时，必须按强绑定血继与当前时代推断相容出身；冰遁优先关联雾隐的水无月一族（雪之一族）及其迫害或隐居背景。玩家明确填写的来源始终优先，不得覆盖。
- 写一段完整、有镜头感的开场剧情，正文不少于 1200 汉字；从玩家所填地点、目标与开场钩子切入。
- 不在正文罗列属性数值、表单字段或配置项，要把设定转化为可感知的行动、环境和人物反应。
- 抛出至少一个明确可回应的局势、人物或线索，但不得替玩家决定行动、想法或选择。
- ${mainOutputRule}

${compactContract ? `【玩家开局契约】\n${compactContract}` : ''}`.trim();
}

export { MODE_DIRECTIVES as OPENING_MODE_DIRECTIVES };
