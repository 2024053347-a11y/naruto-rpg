export const AGENT_MANIFESTS = {
  brainstormer: {
    stateFields: ['玩家·姓名', '玩家·忍阶', '玩家·所属村', '玩家·当前目标', '世界·地点', '世界·时间', '世界·年代', '世界·天气', '世界·已探索区域', '世界·活跃事件', '世界·月份', '_memory.recent_summary', '_combat'],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 2500,
    systemPromptKey: 'BRAINSTORMER'
  },
  outliner: {
    stateFields: ['玩家·姓名', '玩家·忍阶', '玩家·所属村', '玩家·查克拉属性', '玩家·战力等级', '玩家·当前目标', '玩家·存活', '属性·查克拉', '属性·当前查克拉', '属性·生命力', '属性·当前生命力', '属性·精神力', '属性·当前精神力', '属性·体力', '属性·当前体力', '属性·速度', '属性·幸运', '_missions', '世界·地点', '世界·时间', '世界·年代', '世界·天气', '世界·已探索区域', '世界·活跃事件', '世界·月份', '_combat', '_memory', '_relationships'],
    includeHistory: true,
    historyTurns: 3,
    includePreset: false,
    maxContextChars: 8000,
    systemPromptKey: 'OUTLINER'
  },
  'future-guardian': {
    stateFields: [],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 12000,
    systemPromptKey: 'FUTURE_GUARDIAN'
  },
  'critic-realism': {
    stateFields: ['世界·地点', '世界·时间', '世界·年代', '世界·天气', '世界·已探索区域', '世界·活跃事件', '世界·月份', '玩家·忍阶', '玩家·所属村', '玩家·查克拉属性', '属性·查克拉', '属性·当前查克拉', '属性·生命力', '属性·当前生命力', '属性·精神力', '属性·当前精神力', '属性·体力', '属性·当前体力', '属性·速度', '属性·幸运', '_relationships', '_missions', '_memory.recent_summary'],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 4000,
    systemPromptKey: 'CRITIC_REALISM'
  },
  'critic-character': {
    stateFields: ['玩家·姓名', '玩家·忍阶', '玩家·所属村', '玩家·个性', '玩家·当前目标', '玩家·存活', '_relationships', '_memory.npc_notes', '_combat', '_agent_memories'],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 4000,
    systemPromptKey: 'CRITIC_CHARACTER'
  },
  'critic-detail': {
    stateFields: ['世界·地点', '世界·天气', '_combat'],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 3500,
    systemPromptKey: 'CRITIC_DETAIL'
  },
  'critic-style': {
    stateFields: [],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 3000,
    systemPromptKey: 'CRITIC_STYLE'
  },
  writer: {
    stateFields: ['玩家·姓名', '玩家·年龄', '玩家·性别', '玩家·忍阶', '玩家·正式忍阶', '玩家·战力等级', '玩家·所属村', '玩家·查克拉属性', '玩家·出身', '玩家·难度', '玩家·个性', '玩家·公开身份', '玩家·当前目标', '玩家·声望标签', '玩家·标志', '玩家·存活', '玩家·死因', '属性·查克拉', '属性·当前查克拉', '属性·生命力', '属性·当前生命力', '属性·精神力', '属性·当前精神力', '属性·体力', '属性·当前体力', '属性·速度', '属性·幸运', '$prefix:技能·', '$prefix:物品·', '_missions', '_relationships', '世界·地点', '世界·时间', '世界·年代', '世界·月份', '世界·天气', '世界·已探索区域', '世界·活跃事件', '_combat', '_memory', '进度·经验', '进度·下一级经验', '进度·忍术熟练度', '进度·体术熟练度', '进度·幻术熟练度', '进度·防御熟练度', '进度·已完成任务', '进度·突破待处理', '进度·金钱', '进度·称号', '进度·成就'],
    includeHistory: true,
    historyTurns: 3,
    includePreset: false,  // 继承模式下由主Pipeline控制预设
    maxContextChars: 12000,
    systemPromptKey: 'WRITER'
  },
  'writer-polish': {
    stateFields: ['玩家·姓名', '世界·地点'],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 2000,
    systemPromptKey: 'WRITER_POLISH'
  },
  character: {
    stateFields: ['世界·地点', '世界·天气', '_combat'],
    includeHistory: false,
    historyTurns: 0,
    includePreset: false,
    maxContextChars: 2000,
    systemPromptKey: 'CHARACTER_AGENT'
  }
};

export const AGENT_TIMEOUTS = {
  brainstormer: 20000,
  outliner: 35000,
  'future-guardian': 25000,
  'critic-realism': 20000,
  'critic-character': 20000,
  'critic-detail': 20000,
  'critic-style': 20000,
  writer: 90000,
  'writer-polish': 90000,
  character: 25000,
  pipeline_total: 240000
};
