# 多时代项目正史 V2 写作与集成规范

## 当前状态

`project.timeline.v2` 的数据结构保持不变，但基础设施已支持四个时代命名空间：

- `HIST`：当前主线之前的历史或可独立游玩的回忆篇。
- `P1`：《NARUTO》第一部。
- `P2`：疾风传、第四次忍界大战及战后收束。
- `BOR`：博人时代。

当前正式内容仍只集成 P1。`supported_namespaces` 表示基础设施能力，`included_namespaces` 才表示运行时已经拥有的内容，禁止混淆。

## 写作者唯一接口

每名写作者只创建一个与分片 ID 同名的文件：

`canon-rebuild-output/scripts/project-timeline-v2/<SHARD-ID>.mjs`

文件名必须匹配 `HIST-*.mjs`、`P1-*.mjs`、`P2-*.mjs` 或 `BOR-*.mjs`。生成器会自动发现这些文件，不需要写作者修改 Manifest、生成器、校验器或其他分片。

```js
import { createTimelineHelpers, defineTimelineShard } from './helpers.mjs';

const { beat, bridge, day, scene, source } = createTimelineHelpers('P2');

const days = [
  day(
    'RETURN-001', 'K067-01-01', '修行归来', 'RETURN',
    '建立疾风传开局的人员、位置和任务状态。',
    ['填写日初状态。'],
    [
      scene(
        'RETURN-GATE-01', '归村登记', 'RETURN', '木叶正门',
        ['漩涡鸣人', '自来也', '木叶门卫', '玩家角色（若合理在场）'],
        'interactive',
        '填写开场态势。',
        [beat('玩家决定如何参与交接。', 'choice')],
        ['填写基准结果。'],
        ['填写可持久化的状态变化。'],
        '填写停止条件。',
        '填写本场景对游玩性的作用。',
        {
          requirements: ['填写具体前置。'],
          blockers: ['填写具体阻断。'],
          fallbacks: [{
            condition: '填写分支条件。',
            status: 'altered',
            direction: '填写替代推进方向。',
            preserves: '填写必须保留的核心因果。'
          }],
          sources: [source('NARUTO 对应章节'), bridge()]
        }
      )
    ],
    ['填写日终状态。'],
    '填写下一日或自由行动阶段的转场。'
  )
];

export default defineTimelineShard({
  namespace: 'P2',
  code: 'RETURN',
  arcCodes: ['RETURN'],
  dateStart: 'K067-01-01',
  dateEnd: 'K067-01-01',
  days
});
```

`createTimelineHelpers()` 统一生成 `DAY/SCN/EV/THR/ARC` ID。写作者不得手写其他时代的 ID，也不得把 P1 场景放入 P2 剧情日。

## 单分片工作流

写作者只运行自己的分片：

```powershell
npm run generate-project-timeline -- --shard P2-RETURN
npm run validate-project-timeline -- --shard P2-RETURN
```

单分片生成不会修改 Manifest。这样多个写作者可以各自维护独占文件；不得运行全量生成、运行时构建或 public 同步。

每个分片必须满足：

1. 日期严格递增，首尾日与 `dateStart/dateEnd` 一致。
2. 每个日期在全项目只能有一个 DAY；同日并行线程必须放进该 DAY 的不同 SCENE。
3. 每个 DAY 包含一至八个场景，不同地点或冲突线程不得强行合并。
4. `interactive` 必须明确玩家如何进入，并至少包含一个 `choice` 节拍。
5. requirements、blockers、fallbacks、状态变化和停止条件必须具体，禁止通用占位模板。
6. 未来真相、离屏行动和普通角色知识必须分离；`reference_facts` 不得当作当日新事件。
7. 分片末尾必须交接人物位置、伤势、资源、知识、职权、任务、关系和未解决事件。

## 最终集成工作流

只有最终整合者运行：

```powershell
npm run generate-project-timeline
npm run validate-project-timeline
npm run build-canon-runtime
npm run sync-public
npm test
```

全量生成会按文件名自动发现全部分片并重写 Manifest。全量校验会检查 Schema、命名空间一致性、重复日期、重复 ID、分片日期范围、陈旧 JSON、互动入口和通用模板残留。

## 共享文件所有权

普通剧情写作者不得修改以下共享文件：

- `contract.mjs`
- `helpers.mjs`
- `source-loader.mjs`
- `generate-project-timeline-v2.mjs`
- `validate-project-timeline-v2.mjs`
- `project-timeline.schema.json`
- `project-timeline/manifest.json`
- `scripts/build-canon-runtime.mjs`

需要改变格式或时代列表时，停止剧情编写并交给基础设施负责人统一处理。
