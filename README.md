# 忍者手记 — 火影忍者 AI 文字跑团

一个以火影忍者世界观为背景的 **AI 单人文字跑团游戏**（PWA），由多智能体叙事管道驱动，支持角色养成、战斗、人际关系、世界状态等完整 RPG 系统。

## 特性

- **多智能体叙事管道** — GM 编排 Brainstormer → Outliner → Critic 审查 → Writer 写作，可选高质量 Agent 模式
- **完整 RPG 系统** — 查克拉、体力、精神、意志、速度、幸运六维属性，装备系统，忍术技能
- **战斗系统** — 回合制战斗，招式交换、查克拉消耗、暴击/闪避
- **人际关系** — 与 NPC 的好感度、信任、尊重动态变化
- **世界状态** — 天气、时间线、地点、势力关系随游戏推进演变
- **任务系统** — 按忍阶自动生成任务，支持主线/支线
- **记忆系统** — 全局剧情记忆 + NPC 独立视角记忆
- **角色创建** — 自定义姓名、忍村、查克拉属性、初始属性分配
- **知识库** — 内置火影忍者世界观条目，AI 参考生成一致性内容
- **PWA 支持** — 可安装到桌面，离线使用
- **移动端适配** — 响应式布局，手机/PC 均可畅玩

## 技术架构

```
js/
├── core/           # 核心引擎
│   ├── pipeline.js          # 消息管道（单次生成模式）
│   ├── agent-pipeline.js    # 多智能体叙事管道
│   ├── agent-runner.js      # Agent 调用执行器
│   ├── agent-manifests.js   # Agent 上下文注入配置
│   ├── agent-prompts.js     # Agent System Prompt
│   ├── ai-client.js         # AI API 客户端
│   ├── state-manager.js     # 状态管理 + IndexedDB
│   └── event-bus.js         # 事件总线
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
│   └── worldbook/           # 角色/地点/时间线图鉴
├── ui/             # UI 组件
│   ├── app-shell.js         # 应用外壳
│   ├── character-creator.js # 角色创建
│   ├── combat-arena.js      # 战斗界面
│   ├── hud.js               # 状态栏
│   ├── settings-panel.js    # 设置面板
│   ├── timeline-navigator.js # 时间线导航
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

根目录的 `js/`、`css/`、`img/` 和 `assets/` 是应用源码；`public/` 中的同名内容是服务端部署镜像，会在 `npm start`、`npm run dev` 和 `npm run build` 前由 `npm run sync-public` 自动生成。登录页、管理页和法律文档仍由 `public/` 单独维护。

## Agent 模式

可在设置中启用 Agent 高质量正文模式：

| 模式 | 流水线 | 额外调用 | 适用场景 |
|------|--------|---------|---------|
| 标准 | 大纲 → 合理性审查 + 角色审查 → 写作 → 风格审查 | +4 次 | 日常探索、对话 |
| 完整 | 头脑风暴 → 大纲 → 审查 ×2 → 角色代理 → 写作 → 细节审查 + 风格审查 → 润色 | +7~10 次 | 重大剧情、战斗 |

## 难度等级

| 等级 | 初始点数 | 经验倍率 | 敌人强度 |
|------|---------|---------|---------|
| 忍者学校 | 60 | 1.5× | 0.7× |
| 下忍 | 50 | 1.0× | 1.0× |
| 中忍 | 40 | 0.85× | 1.2× |
| 上忍 | 30 | 0.7× | 1.5× |
| 影 | 20 | 0.5× | 2.0× |

## 技术栈

- 纯前端 JavaScript (ES Modules)，无框架
- IndexedDB 持久化（时间线存档）
- Service Worker (PWA)
- Web Components (Custom Elements)

## License

MIT
