# Part I 统一项目正史 V2

## 状态

已实施。生产运行时使用 `project.timeline.v2`，旧 `naruto.timeline.v1` 平铺剧情只作为资料参考。V2 基础设施现支持 `HIST/P1/P2/BOR`，但本文件描述的正式内容范围仍只有 P1；后续写作规范见 `project-game-canon-multi-era-v2.md`。

## 设计目标

优先级固定为：

1. 游玩质量与玩家选择。
2. 完整、可追踪的因果。
3. 人物、伤势、资源、组织与政治状态连续性。
4. 漫画和动画可用素材。
5. 为旅行、训练、恢复、调查与转场补写的项目原创连接段。

当前数据集只覆盖《NARUTO》第一部，从 `K064-01-01` 毕业日到 `K064-06-15` 鸣人随自来也远行。项目日历每年十二个月、每月三十天，不存在 `05-31`。

## 数据层级

- `DAY-P1-*`：完整剧情日，包含日初状态、全部独立场景、日终基准和下一步转场。
- `SCN-P1-*`：单一地点和冲突线程，包含参与者、前置、阻断、结算模式、回退方向与停止条件。
- `EV-P1-*`：场景内有序原子节拍，只描述一个因果推进。
- `reference_facts`：背景、回顾或版本说明，永远不能当作当前事件执行。

每个剧情日最多八个独立场景。不同地点、视角或冲突线程必须拆场景；超过八个时移动到相邻合理日期，不得截断或强行拼接。

## 运行规则

当前日期有剧情时，运行时一次发送当天全部场景，不再按关键词选择窗口，也不做全局字符串截断。完整日载荷不表示一回合必须演完一天；叙事只能推进当前视角自然接续的场景，并在 `stop_condition` 停止。

当前日期没有剧情时，运行时发送完整的最近未来剧情日，明确当前日期、目标日期和相距天数，并用 `FUTURE_ONLY_START/END` 包裹。未来块只用于 AI 内部规划，不能进入沉浸式正文、角色知识、变量、记忆或事件状态。

场景按照 `resolution_mode` 处理：

- `interactive`：需要当前视角参与或明确玩家选择。
- `offscreen`：前置仍成立时可在离屏世界推进，但玩家影响前置后必须改变。
- `conditional`：仅在 requirements 成立且 blockers 未触发时使用基准。

玩家改变基准时，优先采用记录中的 `fallbacks`，再由 AI 补充分支细节。静态 `fallbacks[].status` 只表示建议处置，不提前固定延期日；运行时真正写入事件状态时，合法状态为 `occurred/altered/skipped/postponed`，其中 `postponed` 必须同时提供晚于当前日期的 `reschedule_to`。

应用层会拒绝不存在的项目正史 ID、未来日期 ID、非法状态和非法延期日期。

## 权威与知识边界

运行时事实优先级：当前状态、开局契约和已发生记忆 > 项目世界书 > 项目正史时间线 > 忍术资料 > 模型预训练知识。

项目正史日期服务游戏因果，不代表漫画明示绝对日期。离屏场景和未来日可以被叙事模型读取，但普通角色只能知道其亲历、被告知、公开可查或合理推断的部分。

忍术数据库保持独立，不随 V2 时间线重置。`JT-*` 记录描述术本身，不证明角色已经掌握。

## 文件与命令

- Schema：`canon-rebuild-output/data/canon/schemas/project-timeline.schema.json`
- Manifest：`canon-rebuild-output/data/canon/project-timeline/manifest.json`
- JSON 分片：`canon-rebuild-output/data/canon/project-timeline/shards/`
- 统一生成入口：`canon-rebuild-output/scripts/generate-project-timeline-v2.mjs`
- 共享构造器：`canon-rebuild-output/scripts/project-timeline-v2/helpers.mjs`
- 可维护分片源：`canon-rebuild-output/scripts/project-timeline-v2/P1-*.mjs`
- 校验器：`canon-rebuild-output/scripts/validate-project-timeline-v2.mjs`
- 运行时构建：`scripts/build-canon-runtime.mjs`

修改内置数据后的标准流程：

```powershell
npm run generate-project-timeline
npm run validate-project-timeline
npm run build-canon-runtime
npm run sync-public
npm test
```

并行精校时，每个写入者只能修改一个分片源，并使用 `--shard <ID>` 只重建自己的 JSON；最终整合仍必须执行上述全量流程。校验器会拒绝与分片源不一致的陈旧 JSON。

运行时剧情编辑器使用独立的 `naruto_project_timeline_overrides_v2` 本地覆盖存储。忍术覆盖仍使用 V1 存储，二者互不迁移。
