export const PRODUCT_CAPABILITY_CATALOG_VERSION = 9;

export const PRODUCT_CAPABILITY_CATEGORIES = Object.freeze([
  'project',
  'settings',
  'variables',
  'gameplay',
  'opening',
  'worldbook',
  'story',
  'media',
  'image',
  'navigation',
  'safety'
]);

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    keywords: Object.freeze([...(entry.keywords || [])]),
    canRead: Object.freeze([...(entry.canRead || [])]),
    canDraft: Object.freeze([...(entry.canDraft || [])]),
    sourceModules: Object.freeze([...(entry.sourceModules || [])])
  });
}

const entries = [
  {
    id: 'project.overview',
    category: 'project',
    title: '项目用途与基本玩法',
    summary: '这是以火影忍者世界为背景的 AI 文字 RPG。用户创建角色后，通过输入行动推进回合，并结合状态、记忆、关系、任务、战斗与时间线维持连续剧情。',
    keywords: ['项目', '功能', '怎么玩', '使用', '新手', '文字 RPG', '回合', '主界面'],
    canRead: ['解释游戏主循环', '说明输入、正文、状态面板和时间线之间的关系'],
    canDraft: ['整理适合当前用户的上手步骤'],
    approval: 'none',
    sourceModules: ['js/app.js', 'js/core/pipeline.js', 'js/ui/app-shell.js']
  },
  {
    id: 'project.architecture',
    category: 'project',
    title: '项目结构与数据流',
    summary: '界面层接收输入，消息流水线组装上下文并调用模型，状态与领域系统处理变量、记忆、关系、任务和时间线，服务端提供登录、云存档及安全的模型请求代理。',
    keywords: ['结构', '架构', '源码', '模块', '数据流', '流水线', '前端', '服务端'],
    canRead: ['按功能解释主要模块', '定位设置、状态、开局、世界书和 Agent 运行时职责'],
    canDraft: ['给出问题排查路径或改动方案'],
    approval: 'none',
    sourceModules: ['js/core/pipeline.js', 'js/core/state-manager.js', 'js/core/agent-pipeline.js', 'server/index.js']
  },
  {
    id: 'project.saves-and-timeline',
    category: 'project',
    title: '存档、分支与时间线',
    summary: '项目支持本地状态、云存档和时间线节点。灵希可读取本地时间线与存储摘要、读取云端存档列表，并为上传新云存档、覆盖旧版、永久删除或恢复创建精确审批提案；恢复会覆盖本地时间线并丢失当前未保存的本地进度。',
    keywords: ['存档', '云存档', '时间线', '分支', '节点', '恢复', '回滚', '进度', '上传云存档', '覆盖云存档', '删除云存档', '恢复云存档', '查看云存档'],
    canRead: ['解释本地存档、当前分支、节点数量和归档体积摘要', '读取云存档列表的槽位名、大小、版本与更新时间'],
    canDraft: ['整理恢复或分支操作前的核对清单', '生成绑定真实云存档 ID 的上传、覆盖、删除或恢复提案'],
    approval: 'button-confirmation-before-cloud-or-timeline-write',
    sourceModules: ['js/core/state-manager.js', 'js/core/cloud-save.js', 'js/core/lingxi/adapters/cloud-save-action-adapter.js', 'js/systems/timeline-system.js']
  },
  {
    id: 'gameplay.timeline-actions',
    category: 'gameplay',
    title: '时间线跳转、逆转与分支操作',
    summary: '灵希可读取真实时间线后，为非破坏跳转、永久逆转、保留旧线或覆盖旧线的重推衍、切换分支、升格主线和删除 IF 分支创建精确提案。所有操作都需独立审批；重推衍会调用主模型，破坏性操作会明确列出删除范围。',
    keywords: ['逆转时间线', '跳转节点', '回退剧情', '重推衍', '重roll', '切换分支', '升格主线', '删除分支', 'IF线'],
    canRead: ['读取当前节点、活动分支、节点摘要和分支头'],
    canDraft: ['生成绑定真实节点或分支 ID 的时间线操作提案'],
    approval: 'button-confirmation-before-timeline-restore-or-write',
    sourceModules: ['js/systems/timeline-system.js', 'js/core/lingxi/adapters/timeline-action-adapter.js', 'js/app.js']
  },
  {
    id: 'project.live-state',
    category: 'project',
    title: '当前任务、关系、战斗与记忆状态',
    summary: '灵希可按分区读取当前存档的公开总览、任务、关系、战斗、时间线、本地存档和玩家记忆摘要，并限制数量与正文长度。NPC 心声、私密意图和内部 Agent 记忆不会进入工具结果。',
    keywords: ['当前状态', '任务列表', '当前任务', '人物关系', '当前关系', '查看当前关系', '好感度', '战斗状态', '时间线节点', '本地存档', '记忆摘要', '玩家记忆', '查看玩家记忆'],
    canRead: ['按条件筛选任务、关系和时间线节点', '检查当前战斗、分支、本地存档体积和玩家记忆摘要'],
    canDraft: ['根据公开实时状态整理诊断、连续性检查或下一步建议'],
    approval: 'none',
    sourceModules: ['js/core/lingxi/adapters/project-state-adapter.js', 'js/core/state-manager.js', 'js/systems/timeline-system.js']
  },
  {
    id: 'settings.ai-connection',
    category: 'settings',
    title: '模型连接设置',
    summary: '可配置兼容的模型服务、接口地址、模型名称、后端类型和流式输出。连接凭据只能判断是否已配置，不能读取、回显或放进提示词与工具结果。',
    keywords: ['设置', 'API', '模型', '接口', '地址', '后端', 'OpenAI', 'Claude', 'DeepSeek', '流式', '连接失败'],
    canRead: ['读取不含凭据的连接摘要', '解释各连接字段及常见错误'],
    canDraft: ['生成不含凭据值的连接设置差异'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/ui/api-config-form.js', 'js/ui/settings-config-gateway.js', 'js/core/ai-client.js']
  },
  {
    id: 'settings.interface',
    category: 'settings',
    title: '界面与阅读设置',
    summary: '可调整主题、字体、字号、行高、聊天宽度、正文颜色、背景、变量摘要、推理展示和音乐等界面偏好。',
    keywords: ['界面', '主题', '字体', '字号', '行高', '颜色', '背景', '音乐', '阅读', 'UI'],
    canRead: ['解释当前可见的界面偏好'],
    canDraft: ['根据阅读习惯生成设置补丁与前后差异'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/ui/settings-panel.js', 'js/ui/settings-config-gateway.js', 'js/core/state-manager.js']
  },
  {
    id: 'settings.agent-and-review',
    category: 'settings',
    title: 'Agent、变量更新与正文审查设置',
    summary: '可配置叙事 Agent、审查模型、变量更新模型、并发数与 AI 调用策略。它们影响调用次数、速度、费用和结果稳定性。',
    keywords: ['Agent', '代理', '审查', '变量更新器', '并发', '调用次数', '费用', '严格单调用'],
    canRead: ['解释各开关的作用与调用成本'],
    canDraft: ['按速度、质量或费用目标草拟组合设置'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/data/agent-config.js', 'js/ui/settings-panel.js', 'js/core/ai-call-policy.js']
  },
  {
    id: 'variables.inspect',
    category: 'variables',
    title: '查看变量与规则',
    summary: '可查看当前存档中的玩家属性、资源、进度、世界状态、技能、物品、关系和系统元数据，并结合变量类型、范围和允许操作解释含义。',
    keywords: ['变量', '数值', '属性', '查克拉', '生命力', '体力', '经验', '金钱', '技能', '物品', '关系'],
    canRead: ['读取授权范围内的变量摘要', '查询变量类型、默认值、上下限与说明'],
    canDraft: ['整理变量诊断报告'],
    approval: 'none',
    sourceModules: ['js/data/var-schema.js', 'js/core/state-manager.js']
  },
  {
    id: 'variables.repair',
    category: 'variables',
    title: '修复或调整存档变量',
    summary: '可诊断类型错误、越界数值、当前值高于上限、无效路径和关联变量不一致，并草拟经过白名单与范围校验的最小补丁。',
    keywords: ['修复', '变量', '查克拉', '修复变量', '改变量', '修改数值', '调整数值', '存档变量', '查克拉异常', '越界', '损坏', '不一致', '补丁'],
    canRead: ['比较当前值与变量规则', '说明异常原因和修复影响'],
    canDraft: ['生成精确的旧值、新值和校验结果'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/data/var-schema.js', 'js/core/variable-updater.js', 'js/core/state-manager.js']
  },
  {
    id: 'variables.skills-and-inventory',
    category: 'variables',
    title: '技能、忍具与物品变量',
    summary: '技能与物品使用带名称的动态变量路径。灵希可读取并解释两类数据；技能修复可走通用变量提案，装备槽、物品数量与库存实体只能走装备领域工具，避免绕过属性加成、消耗和自动卸下规则。',
    keywords: ['忍术', '体术', '幻术', '忍具', '武器', '防具', '背包', '数量', '熟练度', '技能变量'],
    canRead: ['解释技能和物品变量结构', '检查动态路径是否合法'],
    canDraft: ['生成新增或调整技能的变量补丁', '把装备、使用和丢弃请求路由到装备领域提案'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/data/var-schema.js', 'js/systems/skill-system.js']
  },
  {
    id: 'gameplay.equipment-actions',
    category: 'gameplay',
    title: '装备、物品使用与丢弃',
    summary: '灵希可核对当前背包与槽位，为装备、卸下、使用消耗品或丢弃指定数量物品创建提案。批准后由装备领域系统结算数量、槽位、恢复效果和属性加成，并附加时间线维护记录。',
    keywords: ['装备武器', '卸下装备', '使用道具', '使用消耗品', '吃兵粮丸', '丢弃物品', '背包操作', '装备槽'],
    canRead: ['核对真实物品、数量、分类、装备槽和当前资源'],
    canDraft: ['生成绑定具体物品、槽位和数量的领域操作提案'],
    approval: 'risk-tiered-equip-or-button-confirmation',
    sourceModules: ['js/systems/equipment-system.js', 'js/core/lingxi/adapters/gameplay-action-adapters.js']
  },
  {
    id: 'gameplay.mission-actions',
    category: 'gameplay',
    title: '任务完成、失败与放弃',
    summary: '灵希可对真实存在的进行中任务创建完成、失败或放弃提案。模型不能提交整份任务或自定义奖励；批准后由任务领域系统移动任务状态并结算既有奖励与统计。',
    keywords: ['完成任务', '任务结算', '任务失败', '放弃任务', '结束任务', '任务奖励'],
    canRead: ['读取当前进行中任务的公开 ID、目标、进度和既有奖励'],
    canDraft: ['生成绑定现有任务 ID 和目标状态的结算提案'],
    approval: 'button-confirmation-before-mission-settlement',
    sourceModules: ['js/systems/mission-system.js', 'js/core/lingxi/adapters/gameplay-action-adapters.js']
  },
  {
    id: 'gameplay.player-action',
    category: 'gameplay',
    title: '提交普通玩家行动并推进剧情',
    summary: '灵希可把用户明确指定的非战斗玩家行动整理为提案。批准前不会调用主模型；批准后复用主输入框的生成管线，推进剧情与状态并创建新的时间线回合。讨论、建议和草稿不会被擅自当成玩家决定。',
    keywords: ['玩家行动', '推进剧情', '继续游戏', '替我行动', '帮我提交', '进入下一回合', '普通回合', '主输入框'],
    canRead: ['核对当前剧情回合、分支及与行动有关的任务、关系和记忆'],
    canDraft: ['生成绑定完整行动文字和当前时间线节点的普通回合提案'],
    approval: 'button-confirmation-before-main-pipeline-call',
    sourceModules: ['js/core/lingxi/adapters/player-action-adapter.js', 'js/core/pipeline.js', 'js/app.js']
  },
  {
    id: 'gameplay.combat-actions',
    category: 'gameplay',
    title: '战斗玩家动作',
    summary: '灵希可为当前战斗准备体术、忍术、使用道具、防御或撤退五种固定玩家动作。批准后动作会进入与战斗按钮相同的主生成管线，调用模型并推进剧情、资源、战斗状态和时间线。',
    keywords: ['战斗动作', '体术攻击', '忍术攻击', '战斗使用道具', '战斗防御', '战斗撤退', '帮我打'],
    canRead: ['核对当前对手、战斗回合、战斗日志和玩家资源'],
    canDraft: ['生成绑定当前战斗状态和固定动作枚举的提案'],
    approval: 'button-confirmation-before-main-pipeline-call',
    sourceModules: ['js/systems/combat-action.js', 'js/core/lingxi/adapters/combat-action-adapter.js', 'js/app.js']
  },
  {
    id: 'opening.compose',
    category: 'opening',
    title: '编写完整开局',
    summary: '可根据用户期望草拟姓名、年龄、性别、出身、时代、所属村、家族、天赋、性格、目标、难度和开场情境，并规范化为开局草稿。',
    keywords: ['开局', '创建角色', '人设', '出身', '时代', '村子', '家族', '天赋', '难度', '开场'],
    canRead: ['解释开局字段、模板与约束'],
    canDraft: ['从自然语言生成完整开局草稿', '检查字段缺失和冲突'],
    approval: 'risk-tiered-draft-save-or-button-confirmation-to-start',
    sourceModules: ['js/systems/opening-draft.js', 'js/systems/opening-contract.js', 'js/ui/character-creator.js']
  },
  {
    id: 'opening.presets',
    category: 'opening',
    title: '开局人设方案',
    summary: '开局草稿可保存为可命名的人设方案，之后恢复或继续编辑。保存方案与用草稿正式初始化游戏是不同操作，初始化会建立新的运行状态。',
    keywords: ['开局预设', '人设方案', '保存人设', '套用人设', '初始化', '新游戏'],
    canRead: ['列出人设方案摘要', '比较方案与当前草稿'],
    canDraft: ['生成保存或初始化提案'],
    approval: 'risk-tiered-draft-save-or-button-confirmation-to-start',
    sourceModules: ['js/core/persona-profiles.js', 'js/systems/opening-draft.js']
  },
  {
    id: 'worldbook.search',
    category: 'worldbook',
    title: '检索世界书',
    summary: '世界书提供人物、地点、势力、术式、物品、历史与自定义设定等事实，可按关键词检索并用于回答设定问题或检查剧情一致性。',
    keywords: ['世界书', '设定', '人物资料', '地点', '势力', '术式', '历史', '检索'],
    canRead: ['搜索当前可见的世界书事实', '标明信息来源与冲突'],
    canDraft: ['整理缺失设定清单'],
    approval: 'none',
    sourceModules: ['js/data/knowledge-base.js', 'js/data/worldbook/runtime-resolver.js']
  },
  {
    id: 'story.canon-database',
    category: 'story',
    title: '检索项目正史与忍术数据库',
    summary: '灵希可按关键词或稳定 ID 检索当前有效的项目正史剧情日、独立场景、原子事件和忍术记录，并读取当前日期对应的剧情日与年度快照索引。结果采用本地覆盖后的有效视图，但当前存档、开局契约、已发生记忆和分支事实始终优先。',
    keywords: ['原作数据库', '正史数据库', '项目正史', '剧情日', '独立场景', '原子事件', '事件 ID', 'DAY', 'SCN', 'EV', '忍术数据库', '术式资料', '忍术消耗', '忍术威力'],
    canRead: ['结构化检索剧情日、场景、事件与忍术记录', '核对当前日期关系、稳定 ID、前置条件、阻断条件、资源消耗与使用限制'],
    canDraft: ['根据正史基线整理冲突清单或分支素材，但不把基线当作已经发生的剧情'],
    approval: 'none',
    sourceModules: ['js/data/canon-database.js', 'js/data/canon-database-overrides.js', 'js/core/lingxi/lingxi-tools.js']
  },
  {
    id: 'worldbook.draft-entry',
    category: 'worldbook',
    title: '生成世界书条目',
    summary: '可把用户想法整理为带名称、类别、触发关键词、正文、优先级和启用状态的世界书条目草案，并检查重复、冲突和格式。',
    keywords: ['生成世界书', '世界书条目', '新增设定', '触发词', '关键词', '优先级', '自定义条目'],
    canRead: ['检查现有条目和相似设定'],
    canDraft: ['生成结构化世界书条目', '提出合并或消歧建议'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/data/knowledge-base.js', 'js/data/worldbook/schema-v2.js', 'js/ui/worldbook-editor.js']
  },
  {
    id: 'worldbook.manage-entries',
    category: 'worldbook',
    title: '管理自定义世界书',
    summary: '灵希可读取内置与自定义条目的真实来源和启用状态，并为单条启用、停用、删除、批量启停或恢复默认创建精确审批提案。单条目标绑定内容指纹，条目被同时编辑后旧提案会失效。',
    keywords: ['世界书管理', '自定义世界书', '启用世界书', '停用世界书', '停用', '禁用条目', '删除世界书', '删除', '全部启用', '全部停用', '恢复默认世界书', '清空自定义条目'],
    canRead: ['列出内置、自定义、启用和停用条目', '取得可验证的自定义条目目标回执'],
    canDraft: ['生成单条启停或删除提案', '生成批量启停或恢复默认提案'],
    approval: 'risk-tiered-small-change-or-button-confirmation',
    sourceModules: ['js/data/knowledge-base.js', 'js/core/lingxi/adapters/project-write-adapters.js', 'js/ui/worldbook-editor.js']
  },
  {
    id: 'story.direction',
    category: 'story',
    title: '规划未来剧情方向',
    summary: '可把用户期待转化为目标、禁区、节奏、角色羁绊、伏笔和条件分支，让未来剧情逐步靠近期望，同时保留角色自主性与世界因果。',
    keywords: ['未来剧情', '剧情方向', '故事走向', '往期望发展', '羁绊', '伏笔', '节奏', '分支', '规划剧情'],
    canRead: ['总结当前分支、连续性与未解决线索'],
    canDraft: ['生成短期剧情方向与条件式分支建议'],
    approval: 'risk-tiered-small-plan-or-button-confirmation',
    sourceModules: ['js/core/agent-pipeline.js', 'js/core/continuity-ledger.js']
  },
  {
    id: 'story.continuity',
    category: 'story',
    title: '剧情连续性与设定冲突检查',
    summary: '可对照当前分支历史、人物关系、世界书、时间线和连续性记录，找出时间、地点、能力、动机或信息权限方面的矛盾。',
    keywords: ['连续性', '剧情矛盾', '设定冲突', '吃书', '时间线', '人物动机', '逻辑', '审查剧情'],
    canRead: ['检索授权的历史与连续性证据', '解释冲突及证据来源'],
    canDraft: ['提出不改动既有事实的修复方案'],
    approval: 'none',
    sourceModules: ['js/core/agent-context-broker.js', 'js/core/continuity-ledger.js', 'js/core/narrative-review.js']
  },
  {
    id: 'media.music',
    category: 'media',
    title: '音乐搜索、打开与播放控制',
    summary: '灵希可搜索腾讯音乐目录，在后台验证并准备精确曲目，自动显示缩小的音乐悬浮窗，并请求播放、暂停、切换上一首或下一首，不会打开设置界面。浏览器仍可能要求用户先在页面中点击一次才能播放。',
    keywords: ['音乐', '歌曲', '歌手', '搜索歌曲', '打开歌曲', '播放', '暂停', '上一首', '下一首', '播放器'],
    canRead: ['搜索曲目名称、歌手和稳定标识', '读取当前播放器状态但不读取播放地址'],
    canDraft: ['根据场景或用户偏好整理候选曲目'],
    approval: 'none-for-search-and-player-controls-browser-gesture-may-be-required',
    sourceModules: ['js/core/music-service.js', 'js/core/lingxi/adapters/music-adapter.js', 'js/ui/settings-panel.js']
  },
  {
    id: 'image.studio',
    category: 'image',
    title: '画面工坊与图片生成',
    summary: '灵希可读取不含密钥的绘图设置、图库和目标版本，打开画面工坊，并为回合插图或人物肖像创建图片生成提案。真正调用外部绘图后端会产生费用或资源写入，因此必须独立审批。',
    keywords: ['图片', '画图', '生图', '文生图', '插图', '肖像', '画面工坊', '图库', '图片 API', '生成图片'],
    canRead: ['读取后端启用状态、模型摘要和是否已配置凭据', '查看图库元数据、图片绑定和任务状态'],
    canDraft: ['生成正向与负向提示词', '创建绑定目标、后端和提示词的图片生成提案'],
    approval: 'button-confirmation-before-external-generation',
    sourceModules: ['js/core/image-studio/index.js', 'js/core/lingxi/adapters/image-studio-adapter.js', 'js/ui/image-studio.js']
  },
  {
    id: 'image.library-actions',
    category: 'image',
    title: '图片版本、绑定与任务管理',
    summary: '灵希可为已有图片选择版本、解绑目标、切换保护、删除未绑定资源、取消活动任务或重试失败任务创建提案。重试可能再次调用外部后端，删除会移除云端资源、本地元数据和图片 Blob。',
    keywords: ['选择图片版本', '切换图片', '解绑图片', '取消绑定', '保护图片', '取消保护', '删除图片', '重试生图', '取消图片任务'],
    canRead: ['核对图片资源、目标绑定、绑定版本和任务状态，不读取签名地址或凭据'],
    canDraft: ['生成绑定精确资源、目标、任务和预期版本的图库操作提案'],
    approval: 'risk-tiered-selection-or-button-confirmation-for-delete-or-retry',
    sourceModules: ['js/core/image-studio/index.js', 'js/core/lingxi/adapters/image-studio-adapter.js']
  },
  {
    id: 'navigation.assistant',
    category: 'navigation',
    title: '灵希界面导航',
    summary: '灵希可打开白名单内的设置分区、个人中心、时间线、地图、角色属性、技能、装备、任务、关系、创作工作台和画面工坊。音乐播放与控制在后台运行。导航本身不保存设置、不写入存档，也不能打开任意外部链接。',
    keywords: ['打开设置', '打开画面工坊', '打开个人中心', '打开音乐', '打开时间线', '打开地图', '打开任务', '打开关系', '打开角色属性', '打开技能', '打开装备', '打开生成管线', '打开提示词与知识', '打开原作数据库', '打开记忆运行时', '创作工作台', '导航', '跳转界面'],
    canRead: ['说明将打开的界面位置'],
    canDraft: ['根据任务选择合适的项目界面'],
    approval: 'none-for-whitelisted-reversible-ui-actions',
    sourceModules: ['js/core/lingxi/lingxi-tools.js', 'js/core/event-bus.js', 'js/app.js']
  },
  {
    id: 'safety.manual-approval',
    category: 'safety',
    title: '风险分级与操作边界',
    summary: '模型可读取、草拟并调用白名单内的可逆界面动作。不超过两处、无删除、无费用且明确可撤销的白名单变化会由宿主后台执行；删除、覆盖、云存档、剧情推进、开局初始化和外部图片生成等高风险操作必须先展示精确影响，再由用户在独立界面点击“确认修改”。聊天中的同意不构成授权，也不再要求输入确认短语。',
    keywords: ['批准', '确认', 'Yes', '同意', '权限', '安全', '写入', '执行', '网页操作'],
    canRead: ['解释操作影响和当前审批状态'],
    canDraft: ['生成待批准提案与差异预览'],
    approval: 'risk-tiered-automatic-small-change-or-button-confirmation',
    sourceModules: ['js/core/event-bus.js', 'js/ui/modal.js']
  }
];

export const PRODUCT_CAPABILITY_CATALOG = Object.freeze(entries.map(freezeEntry));

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function entrySearchText(entry) {
  return normalizeText([
    entry.id,
    entry.category,
    entry.title,
    entry.summary,
    ...entry.keywords,
    ...entry.canRead,
    ...entry.canDraft
  ].join(' '));
}

const SEARCH_INDEX = PRODUCT_CAPABILITY_CATALOG.map((entry, index) => Object.freeze({
  entry,
  index,
  text: entrySearchText(entry),
  title: normalizeText(entry.title),
  keywords: entry.keywords.map(normalizeText)
}));

function scoreEntry(indexed, normalizedQuery, queryParts) {
  if (!normalizedQuery) return 1;
  let score = 0;
  if (indexed.title === normalizedQuery) score += 120;
  else if (indexed.title.includes(normalizedQuery)) score += 70;
  if (indexed.text.includes(normalizedQuery)) score += 45;

  for (const keyword of indexed.keywords) {
    if (!keyword) continue;
    if (normalizedQuery === keyword) score += 80;
    else if (normalizedQuery.includes(keyword)) score += Math.min(42, 12 + keyword.length * 3);
  }
  for (const part of queryParts) {
    if (part.length < 2) continue;
    if (indexed.title.includes(part)) score += 18;
    else if (indexed.text.includes(part)) score += 6;
  }
  return score;
}

/**
 * Search the shipped product-help catalog without touching application state.
 * Results are frozen catalog entries ordered by relevance and stable source order.
 */
export function searchProductCapabilities(query = '', { category = '', limit = 8 } = {}) {
  const normalizedQuery = normalizeText(query);
  const normalizedCategory = normalizeText(category);
  const queryParts = normalizedQuery.split(' ').filter(Boolean);
  const safeLimit = Math.min(50, Math.max(1, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 8));

  return SEARCH_INDEX
    .filter(item => !normalizedCategory || normalizeText(item.entry.category) === normalizedCategory)
    .map(item => ({ ...item, score: scoreEntry(item, normalizedQuery, queryParts) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, safeLimit)
    .map(item => item.entry);
}

export function getProductCapability(id) {
  const normalizedId = String(id || '').trim();
  return PRODUCT_CAPABILITY_CATALOG.find(entry => entry.id === normalizedId) || null;
}
