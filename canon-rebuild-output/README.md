# 火影原著时间线与忍术数据库（独立重构产物）

本目录依据 `docs/plans/canon-timeline-worldbook-rebuild-plan.md` 与
`docs/plans/canon-jutsu-database-rebuild-plan.md` 建立，不覆盖现有世界书。

## 权威顺序

1. 当前项目世界书（发生冲突时优先）
2. 《NARUTO》漫画
3. 官方公式书、设定书
4. 火影官网与公开资料站仅用于定位，不作为新增设定的唯一依据

冻结锚点：`K051-10-10` 九尾之乱；`K052` 默认幼年开局；`K059` 左右宇智波灭族；
`K064` 第一部开始；`K067-K068` 疾风传至第四次忍界大战。

完整的项目日期推定与理由见 `docs/project-date-baseline-v1.md`。这些日期已作为
`project_dates_v1` 冻结，可直接用于游戏调度；`allocated` 仅说明它不是漫画明示日期。

## 使用

```bash
npm run canon:validate
```

`data/canon/**/shards` 是权威源数据，`js/data/generated` 是可重复生成的运行时索引。
所有记录当前保持 `draft`，审核报告明确列出覆盖范围与未解决项，不能误称为已经人工逐页终审的全集。

忍术目录当前包含741条满足以下条件的记录：具名、首次登场位于《NARUTO》漫画第1至700章、
且未标记为《BORUTO》。原始3026个候选中的动画、小说、游戏、电影和后续漫画专属术均未导入。

时间线现包含两层：

- `data/canon/timeline/yearly`：K001—K086共86个年度文件，140个人物逐年年龄和生日状态。
- `data/canon/timeline/shards/plot`：28个《NARUTO》/《BORUTO》漫画篇章、4226个细分剧情节拍。

正式游戏运行时另使用 `data/canon/project-timeline` 下的 `project.timeline.v2`。其基础设施支持
`HIST/P1/P2/BOR` 四个时代命名空间，当前只完成 P1；旧的4226条自动节拍仍是后续重构资料，
不会因为存在于本目录就自动进入游戏运行时。写作与并行集成规则见
`docs/plans/project-game-canon-multi-era-v2.md`。

自动篇章摘要保留英文定位文本并标记“待中文精校”；它们用于保证剧情覆盖和章节可追踪性，
在逐章确认是否混入动画扩写之前保持 `draft`，不会进入正式运行时索引。
