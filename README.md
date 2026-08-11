# 忍者手记 — 火影忍者 AI 文字跑团

当前正式版本：**v3.5.0**

一个以火影忍者世界观为背景的 **AI 单人文字跑团游戏**（PWA）。v3.5 新增可操作项目的灵希 Agent 助手、检索后创作约束、分支剧情方向、可靠音乐播放与更严格的正文生成管道，并继续支持角色养成、战斗、人际关系、分支时间线、私人图片资产与云存档。

正式站：https://www.qiwu.asia/

## v3.5 概览

- **灵希 Agent 助手**：可检索正史、世界书和当前存档，协助开局、剧情方向、设置、装备、任务、战斗、时间线、云存档、图片与音乐操作
- **检索后创作**：生成剧情、开局或世界书前必须先读取对应项目资料；当前存档和已发生分支事实始终优先
- **可审计操作**：少量可逆设置可在后台执行；删除、覆盖、剧情推进、云存档与外部生图等高风险操作必须展示精确影响并点击确认
- **可靠音乐播放**：仅使用腾讯音乐目录，通过本站同源代理预检音频；不可播时自动尝试同歌版本或换歌，并显示默认缩小的可拖动悬浮播放器
- **正文定稿管道**：先生成场景节拍和详细写作大纲，再经过终审后一次生成正文，最后独立完成变量与连续性结算
- **完整项目正史**：K001-K086，覆盖 HIST、P1、P2、BOR 四个时代，包含 385 个剧情日、786 个场景和 2894 个原子事件
- **规范忍术数据库**：741 条忍术记录，统一名称、等级、属性、资源、消耗、威力、条件和来源
- **证据链 AI 管道**：严格单次调用或增强模式、结构化详纲终审、可见推演、连续性更新、提示词追踪和可提前改写的最近剧情日上下文
- **可靠状态提交**：连续性账本、原子回合提交、分支隔离、开局契约和旧存档迁移
- **私人图片工作室**：支持 OpenAI 兼容生图、A1111/Forge、ComfyUI、人物肖像、回合插图、版本图库和云同步

## 特性

- **多智能体叙事管道** — GM 编排头脑风暴、场景节拍、角色决定、结构化详纲与多重终审，终审通过后再由 Final Writer 一次定稿
- **灵希助手** — 独立、可新开的有界上下文对话；可搜索项目资料、解释状态并通过安全工具执行用户可用的项目操作
- **完整 RPG 系统** — 查克拉、体力、精神、意志、速度、幸运六维属性，装备系统，忍术技能
- **战斗系统** — 回合制战斗，查克拉/精神力/体力分离结算，正史忍术消耗、暴击/闪避与 NPC 忍阶平衡
- **人际关系** — 与 NPC 的好感度、信任、尊重动态变化
- **世界状态** — 天气、时间线、地点、势力关系随游戏推进演变
- **任务系统** — 按忍阶自动生成任务，支持主线/支线
- **记忆系统** — 连续性账本、全局剧情记忆、NPC 独立视角记忆、阶段摘要与深度整合
- **角色创建** — 自定义姓名、家族、忍村、血继、天赋、忍术、关系、时代日期与初始属性
- **知识库** — 内置项目正史、火影世界书和规范忍术数据库，按角色与时代进行证据投影
- **图片工作室** — 本地或云端生成回合插图与人物肖像，提供版本管理、恢复和私人图库
- **音乐播放器** — 搜索、后台打开、自动换源、播放控制与可拖动悬浮窗
- **PWA 支持** — 可安装到桌面，离线使用
- **移动端适配** — 响应式布局，手机/PC 均可畅玩

## 技术架构

```
js/
├── core/           # 核心引擎
│   ├── pipeline.js          # 证据链消息与变量提交管道
│   ├── agent-pipeline.js    # 多智能体叙事管道
│   ├── agent-runner.js      # Agent 调用执行器
│   ├── agent-manifests.js   # Agent 上下文注入配置
│   ├── agent-prompts.js     # Agent System Prompt
│   ├── ai-client.js         # AI API 客户端
│   ├── state-manager.js     # 状态管理 + IndexedDB
│   ├── turn-evidence.js     # 回合证据编译与受众投影
│   ├── continuity-ledger.js # 不可变连续性账本
│   ├── narrative-review.js  # 可选二阶段正文复检
│   ├── music-service.js      # 音乐目录与同源播放地址
│   ├── music-playback.js     # 音源预检、回退与播放状态
│   ├── lingxi/               # 灵希工具、审批与项目操作适配器
│   └── image-studio/        # 多后端图片生成与资产管理
├── systems/        # 游戏系统
│   ├── combat-system.js     # 战斗系统
│   ├── mission-system.js    # 任务系统
│   ├── relationship-system.js # 人际关系
│   ├── memory-system.js     # 记忆存储
│   ├── timeline-system.js   # 时间线
│   ├── world-state-system.js # 世界状态
│   ├── attribute-system.js  # 属性检定
│   └── equipment-system.js  # 装备系统
├── data/           # 游戏数据
│   ├── knowledge-base.js    # 火影世界观知识库
│   ├── game-data.js         # 属性/平衡/难度配置
│   ├── agent-config.js      # Agent 模式配置
│   ├── canon-database.js    # 规范忍术数据库运行时
│   ├── generated/           # 构建生成的正史运行时
│   └── worldbook/           # 角色/地点/时代知识库
├── ui/             # UI 组件
│   ├── app-shell.js         # 应用外壳
│   ├── character-creator.js # 角色创建
│   ├── combat-arena.js      # 战斗界面
│   ├── hud.js               # 状态栏
│   ├── settings-panel.js    # 设置面板
│   ├── timeline-navigator.js # 时间线导航
│   ├── lingxi-companion.js   # 灵希对话与操作确认界面
│   ├── music-floating-player.js # 音乐悬浮播放器
│   ├── map-modal.js         # 地图
│   └── ...
└── utils/          # 工具函数
```

## 快速开始

1. 安装 Node.js 18+，克隆仓库并安装依赖。
2. 将 `.env.example` 复制为 `.env`。本地开发可保留 `AUTH_BYPASS=true`；生产环境应关闭旁路并配置 Discord OAuth 与随机 `JWT_SECRET`。
3. 启动 Node 服务，打开 `http://localhost:3000`。
4. 首次进入配置 AI API（支持 OpenAI 兼容接口），创建角色后开始冒险。

```bash
npm install
npm start
```

项目包含统一的回归测试与构建命令：

```bash
npm test
npm run build
```

`npm test` 会验证项目时间线、忍术数据库、AI 调用策略、证据链上下文、连续性、变量更新、开局、战斗、灵希工具与审批、音乐代理、图片资产、服务端安全、部署脚本和 `public/` 同步状态。灵希界面回归可单独运行 `npm run test:lingxi-ui`。

根目录的 `js/`、`css/`、`img/` 和 `assets/` 是应用源码；`public/` 中的同名内容是服务端部署镜像，会在 `npm start`、`npm run dev` 和 `npm run build` 前由 `npm run sync-public` 自动生成。登录页、管理页和法律文档仍由 `public/` 单独维护。

## Agent 模式

可在设置中启用 Agent 高质量正文模式：

| 模式 | 流水线 | 适用场景 |
|------|--------|---------|
| 标准 | 场景节拍 → 审查 → 详细写作大纲 → 终审 → 正文定稿 → 连续性结算 | 日常探索、对话 |
| 完整 | 头脑风暴 → 场景节拍 → 多重审查 → 角色决定 → 详细写作大纲 → 可检索终审 → 正文定稿 → 连续性结算 | 重大剧情、战斗 |

不需要辅助调用时可选择严格单次调用模式。变量更新器、记忆压缩、正文复检和自动绘图均可独立开启，调用策略会在每回合开始时冻结，避免生成阶段与提交阶段职责漂移。

## 灵希助手

灵希拥有独立于主剧情的对话上下文，可新开对话并限制发送给模型的历史长度。桌面端宠物与对话框均可拖动，位置会保存；生成过程中不能重置会话，避免丢失正在执行的操作。

涉及剧情、开局或世界书时，灵希必须先检索相应正史、世界书和用户点名的存档分区。只读查询、页面导航和少量低风险可逆设置可以直接完成；剧情推进、删除、覆盖、云存档、开局初始化和外部图片生成等操作会先展示绑定当前状态的精确影响，并只接受确认界面的真实点击。API 密钥、NPC 私密状态和内部 Agent 记忆不会进入灵希上下文。

## 正式部署

### Windows

发布入口为 `部署正式站.bat`，底层使用 `deploy.ps1`。服务器地址和 SSH 密钥只写入被忽略的 `deploy.local.psd1`，可从 `deploy.local.example.psd1` 创建。

```powershell
# 离线检查正式部署包，不连接服务器
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode production -DryRun

# 正式部署，必须显式确认
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Mode production -ConfirmProduction
```

### Linux/Mac

```bash
# 完整部署 (构建 + 上传 + 重启)
bash deploy-v3.sh

# 仅构建，不连接服务器
bash deploy-v3.sh --dry-run

# 跳过构建，仅上传
bash deploy-v3.sh --skip-build
```

### 版本信息生成

```bash
# 输出到 stdout
node scripts/generate-version.mjs

# 写入文件
node scripts/generate-version.mjs --out public/version.json
```

### 部署流程

```
1. 构建项目        → npm run build
2. 生成版本信息    → node scripts/generate-version.mjs --out public/version.json
3. 上传静态资源    → 排除 .env / *.db / save/ / logs/
4. 远端操作:
   - 备份旧版本
   - 上传新版本
   - 清理缓存
   - 重启服务
   - 健康检查
```

部署器会构建并同步 `public/`，生成 `version.json`，排除 `.env`、云存档和运行数据库，校验部署包内容与 SHA-256，重试上传，更新静态站和后端，重启服务并验证线上缓存版本与当前发布版本。正式站发布前应先运行 `npm test`。

## 难度等级

| 等级 | 初始点数 | 经验倍率 | 敌人强度 |
|------|---------|---------|---------|
| 忍者学校 | 60 | 1.5× | 0.7× |
| 下忍 | 50 | 1.0× | 1.0× |
| 中忍 | 40 | 0.85× | 1.2× |
| 上忍 | 30 | 0.7× | 1.5× |
| 影 | 20 | 0.5× | 2.0× |

## 技术栈

- JavaScript ES Modules + Node.js/Express，无前端框架
- IndexedDB 持久化（时间线存档）
- Service Worker (PWA)
- Web Components (Custom Elements)
- JSON 文件持久化服务端、Discord OAuth、云存档与私人图片资产

## 支持项目

忍者手记由个人独立开发并持续维护。你可以通过 [爱发电支持忍者手记](https://www.ifdian.net/a/2608_1?utm_source=copylink&utm_medium=link)，赞助完全自愿，不影响任何游戏功能。

即使不进行赞助，也欢迎体验游戏、[提出建议或反馈问题](https://github.com/2024053347-a11y/naruto-rpg/issues)，共同帮助项目持续成长。

## License

MIT
