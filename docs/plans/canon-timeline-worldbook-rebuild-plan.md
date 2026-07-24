# 火影原著精确日期世界书重构计划

> **状态：已废弃。** 本计划追求漫画/公式书唯一权威，与当前“游玩性优先的统一项目正史”方向冲突。不得再按本文生成生产时间线。当前实现与维护规范见 `docs/plans/project-game-canon-part1-v2.md`；本文仅保留作历史参考。

> 用途：本文件可直接发送给负责数据生成或模块实现的 AI。执行者必须以本文件为完整规格，不得自行改变日期体系、字段名称、来源范围或事件裁定语义。

## 一、项目目标

建立一套以《NARUTO》漫画和官方公式书为权威来源、精确到项目日历具体日期的原著事件数据库。

该数据库用于：

- 在游戏日期到达时，把对应原著事件发送给叙事 AI。
- 帮助 AI 判断人物年龄、存活状态、组织状态、公开情报与未来事件边界。
- 防止十几年后的剧情提前发生。
- 允许玩家改变原著；事件到期后由 AI 根据当前存档决定发生、改写、跳过或延期。
- 保留原著真正支持的日期范围和推算依据，不把项目分配日期伪装成原著明示日期。

本阶段的权威资料范围固定为：

1. 《NARUTO》漫画。
2. 官方公式书、设定书。
3. 漫画与公式书冲突时，漫画优先。
4. 不混入动画原创、小说、剧场版、游戏和《BORUTO》资料；未来需要时必须建立独立数据集。

## 二、已经确定的设计决策

- 使用木叶纪年。
- 每年十二个月，每月三十天。
- 日期格式固定为 `KYYY-MM-DD`，例如 `K064-01-03`。
- 事件必须精确到具体项目日期。
- 原著日期模糊时，仍分配唯一项目日期，但必须保存证据窗口、日期依据和可信度。
- 事件按“原子剧情节拍”拆分；每条只描述一个主要状态变化。
- 到期事件进入“待裁定队列”，每回合发送给 AI，直到被明确裁定。
- 原著事件只是基准线，不强制玩家世界收束回原著。
- 源数据使用严格 JSON 分片，不直接生成当前项目的 `{title, keys, content}` 世界书条目。
- 运行时通过索引和适配器，把少量相关事件转换为旧世界书文本。

## 三、必须先冻结的项目时间锚点

当前项目历史文件里同时存在木叶四十八年、五十二年等默认值。批量生成前必须统一为以下基准：

```text
K051-10-10：鸣人出生与九尾之乱
K052：默认幼年时代，可作为早期原创开局
K064：鸣人毕业，原著第一部开始
```

以后允许修正具体日期，但事件稳定 ID 不得改变。

禁止根据标题或日期生成 ID，因为日期调整会导致引用全部失效。

## 四、建议目录结构

```text
data/
  canon/
    schemas/
      timeline-event.schema.json
    registries/
      arcs.json
      entities.json
      locations.json
    timeline/
      manifest.json
      shards/
        TL-PROLOGUE-P01.json
        TL-PART1-TEAM7-P01.json
        TL-PART1-WAVES-P01.json
        TL-PART1-CHUNIN-P01.json
      reviews/
        TL-PART1-TEAM7-P01.review.json

js/
  data/
    generated/
      canon-timeline-index.js
```

`data/canon/timeline/shards` 是唯一权威源数据。

`js/data/generated/canon-timeline-index.js` 是构建程序生成的运行时产物，不允许人工维护。

## 五、分片文件格式

每个分片建议五十至一百条记录，未压缩文件不超过约二百五十 KB。

```json
{
  "$schema": "../../schemas/timeline-event.schema.json",
  "schema_version": "naruto.timeline.v1",
  "dataset": "naruto-manga-databook",
  "calendar": {
    "id": "konoha-360-v1",
    "months_per_year": 12,
    "days_per_month": 30
  },
  "shard": {
    "id": "TL-PART1-TEAM7-P01",
    "arc_id": "ARC-PART1-TEAM7",
    "part": 1,
    "id_start": 1,
    "id_end": 100,
    "date_start": "K064-01-01",
    "date_end": "K064-01-30",
    "source_coverage": [
      {
        "type": "manga",
        "work": "NARUTO",
        "chapter_start": 1,
        "chapter_end": 8
      }
    ]
  },
  "records": [],
  "unresolved": []
}
```

`unresolved` 用于保存无法确认的实体、日期矛盾或缺失出处：

```json
{
  "temporary_key": "unknown-konoha-teacher-01",
  "issue": "漫画画面中出现但没有确认姓名",
  "source_ref": {
    "type": "manga",
    "work": "NARUTO",
    "chapter": 3,
    "pages": null
  }
}
```

执行 AI 不得为了清空 `unresolved` 自行发明名字、ID或设定。

## 六、单个事件的最终格式

```json
{
  "id": "EV-PART1-TEAM7-0001",
  "title": "第七班编成",
  "aliases": [
    "第七班成立",
    "鸣人佐助小樱分班"
  ],
  "continuity": "manga_canon",
  "arc_id": "ARC-PART1-TEAM7",
  "parent_event_id": null,

  "when": {
    "scheduled_start": "K064-01-03",
    "scheduled_end": "K064-01-03",
    "time_of_day": "morning",
    "day_order": 20,
    "basis": "allocated",
    "source_precision": "sequence_only",
    "canon_window": {
      "earliest": "K064-01-02",
      "latest": "K064-01-10"
    },
    "confidence": "medium",
    "anchor_event_ids": [
      "EV-PART1-GRADUATION-0010"
    ],
    "rationale": "原著只明确发生在毕业后、铃铛测试前；具体日期由项目在证据窗口内固定。"
  },

  "summary": "鸣人、佐助与小樱被编入第七班，旗木卡卡西被指定为指导上忍。",

  "facts": [
    "第七班的下忍成员为漩涡鸣人、宇智波佐助和春野樱。",
    "指导上忍为旗木卡卡西。",
    "此时三名下忍尚未通过卡卡西的生存演习。"
  ],

  "participants": [
    {
      "entity_id": "CH-NAR-NARUTO",
      "role": "team_member"
    },
    {
      "entity_id": "CH-NAR-SASUKE",
      "role": "team_member"
    },
    {
      "entity_id": "CH-NAR-SAKURA",
      "role": "team_member"
    },
    {
      "entity_id": "CH-NAR-KAKASHI",
      "role": "assigned_instructor"
    }
  ],

  "location_ids": [
    "LOC-KONOHA-ACADEMY"
  ],

  "depends_on": [
    "EV-PART1-GRADUATION-0010"
  ],

  "applicability": {
    "required": [
      "鸣人、佐助和小樱仍是木叶本届毕业生。",
      "三人没有因当前分支而死亡、叛逃或被分配到其他小队。"
    ],
    "blockers": [
      "玩家已经使分班制度发生重大改变。",
      "任一核心成员不再具备加入第七班的条件。"
    ],
    "ai_instruction": "到期时结合当前存档判断事件应当发生、改写、跳过还是延期，不得强制世界回到原著。"
  },

  "canonical_outcomes": [
    "第七班正式建立。",
    "卡卡西成为三人的指导上忍。",
    "下一原著节拍为生存演习。"
  ],

  "knowledge": {
    "public_at_time": [
      "第七班的成员名单和指导上忍安排。"
    ],
    "restricted_at_time": [
      "卡卡西会用生存演习淘汰缺乏团队意识的学生。"
    ],
    "hidden_truth": []
  },

  "retrieval": {
    "keys": [
      "第七班",
      "分班",
      "卡卡西",
      "鸣人",
      "佐助",
      "小樱"
    ],
    "tags": [
      "team-formation",
      "academy",
      "part-one"
    ],
    "spoiler_level": 1
  },

  "source_refs": [
    {
      "type": "manga",
      "work": "NARUTO",
      "chapter": 3,
      "pages": null,
      "supports": [
        "participants",
        "sequence",
        "canonical_outcomes"
      ],
      "note": "页码因版本不同可为空。"
    }
  ],

  "qa": {
    "status": "draft",
    "generated_batch": "TL-PART1-TEAM7-P01",
    "reviewed_by": null
  }
}
```

## 七、字段枚举与硬规则

### 7.1 日期依据

`when.basis`：

```text
explicit    原著明确给出完整、可映射的日期
calculated  根据生日、年龄、相对天数或锚点推算
allocated   原著只给顺序或范围，由项目分配具体日期
```

`when.source_precision`：

```text
exact_day
month_day
month_only
year_only
relative
sequence_only
```

`when.confidence`：

```text
high
medium
low
```

`when.time_of_day`：

```text
dawn
morning
noon
afternoon
evening
night
late_night
unknown
```

### 7.2 日期分配规则

- `scheduled_start` 和 `scheduled_end` 是项目运行日期，不等于原著明示日期。
- 单日事件的开始和结束日期相同。
- `allocated` 必须填写 `canon_window`、`anchor_event_ids` 和 `rationale`。
- 项目日期必须处在 `canon_window` 内。
- 无法确定窗口时允许 `earliest/latest` 为 `null`，但必须解释原因并加入审核队列。
- 同一天事件按 `day_order` 排序，使用十、二十、三十等间隔值，便于插入。
- 不能用动画播出日、漫画连载日或现实发布日期作为剧情日期。
- “首次在漫画出现”不能自动解释成“世界中首次发生”。

### 7.3 原子事件规则

- 每条只允许一个主要状态变化。
- “中忍考试”不能作为一条记录；报名、笔试、死亡森林开始、大蛇丸袭击、预选赛等应分别记录。
- 同一天连续发生的事件拆条，并用 `depends_on` 和 `day_order` 连接。
- 跨日任务可以有一个父事件，但真正到期注入的是原子子事件。
- 幕后真相不能混在 `public_at_time`。

### 7.4 ID规则

```text
事件：EV-{ARC_CODE}-{四位序号}
篇章：ARC-{ERA_OR_PART}-{NAME}
人物：CH-NAR-{NAME}
地点：LOC-{REGION}-{NAME}
组织：ORG-{NAME}
```

- ID由 `manifest.json` 预分配。
- AI只能使用本批获得的ID范围。
- ID永久稳定，不因改名、改日期而改变。
- 删除记录进入 `tombstones`，ID不得再次使用。
- 找不到实体ID时写入 `unresolved`，禁止自行制造未登记ID。

## 八、到期事件队列与AI裁定协议

静态数据库只保存原著基准，不保存当前玩家分支结果。

存档中应单独保存：

```json
{
  "event_id": "EV-PART1-TEAM7-0001",
  "status": "pending",
  "first_due_at": "K064-01-03",
  "decided_at": null,
  "reschedule_to": null,
  "reason": "",
  "result_summary": "",
  "branch_id": "branch_main"
}
```

状态只允许：

```text
pending
occurred
altered
skipped
postponed
```

运行规则：

1. 日期到达 `scheduled_start` 后进入 `pending`。
2. `depends_on` 未完成时暂不发送。
3. 待裁定事件每回合发送，直到 AI 返回最终裁定。
4. `postponed` 必须给出新的合法日期，届时重新进入待裁定队列。
5. `occurred/altered/skipped` 为当前分支最终状态，不再重复注入。
6. 切换时间线分支时，事件裁定状态随存档快照恢复。

建议要求叙事AI输出：

```xml
<event>{
  "id": "EV-PART1-TEAM7-0001",
  "status": "altered",
  "reason": "玩家此前改变了毕业生编组结构。",
  "reschedule_to": null,
  "result_summary": "卡卡西仍成为指导上忍，但小队成员已改变。"
}</event>
```

## 九、运行时模块接口

```js
timelineDB.getDueEvents({
  date: "K064-01-03",
  unresolvedOnly: true
});

timelineDB.query({
  date: "K064-01-03",
  query: "第七班",
  entityIds: ["CH-NAR-NARUTO"],
  limit: 8
});

timelineDB.resolveDueEvent({
  eventId: "EV-PART1-TEAM7-0001",
  status: "altered",
  reason: "...",
  resultSummary: "..."
});

timelineDB.toWorldbookEntries(results);
```

适配器只把检索到的少量事件转换成：

```json
{
  "title": "到期事件：第七班编成",
  "keys": ["第七班", "卡卡西", "分班"],
  "category": "timeline",
  "content": "项目日期、事件依据、当前前置条件、原著基准结果与知识可见性。"
}
```

禁止一次把整个事件数据库展开到 `WORLD_BOOK_ENTRIES`。

现有知识库缓存键还必须加入：

- 标准化查询文本。
- 完整项目日期。
- 当前分支ID。
- 相关人物和活跃事件。

否则同地点的不同问题或第二天剧情可能复用旧检索结果。

## 十、数据生成流程

禁止让一个AI一步完成“考证、精确日期分配、生成最终数据”。必须分三轮。

### 第一轮：证据抽取

只生成：

- 原著事实。
- 事件先后关系。
- 日期证据窗口。
- 人物、地点和组织。
- 公开/机密/幕后知识。
- 漫画章节或公式书出处。
- 无法确认项。

不得在这一轮自由分配日期。

### 第二轮：项目日期分配

- 读取第一轮证据。
- 使用已经冻结的前后锚点。
- 在 `canon_window` 内分配具体项目日期。
- 填写 `basis/confidence/rationale`。
- 检查依赖事件日期不能晚于当前事件。

### 第三轮：独立审核

审核AI只返回补丁，不得重写整个分片：

```json
{
  "batch_id": "TL-PART1-TEAM7-P01",
  "replacements": [],
  "deletions": [],
  "unresolved": [],
  "review_notes": []
}
```

`replacements` 必须包含完整替换记录。

## 十一、可直接发送给数据生成AI的提示词

```text
你是结构化资料抽取器，不是剧情创作者。你不得使用自己的预训练记忆补全我没有提供的火影资料。

任务：
根据我提供的漫画/公式书资料、锚点事件和实体注册表，生成 naruto.timeline.v1 JSON 分片。

权威来源：
1. 《NARUTO》漫画。
2. 官方公式书。
3. 漫画与公式书冲突时漫画优先。
4. 禁止混入动画原创、小说、剧场版、游戏或《BORUTO》资料。

硬规则：
1. 只输出合法JSON，不输出Markdown、解释或代码围栏。
2. 只能使用分配给本批的ID范围：{ID_RANGE}。
3. 每条记录只描述一个主要状态变化；同一天多个变化必须拆成多个事件。
4. 使用12个月、每月30天的木叶纪年，日期格式为KYYY-MM-DD。
5. scheduled_start必须精确到日。
6. 原资料未明确具体日期时，不得声称原著明确；使用basis=calculated或allocated。
7. allocated必须填写canon_window、confidence、anchor_event_ids和rationale。
8. 项目日期必须落在canon_window内。
9. 每条必须包含source_refs，并写明出处支持哪些字段。
10. 只能使用提供的entity_id、arc_id和event_id；不能确认的引用写入unresolved，禁止自造ID。
11. 必须区分public_at_time、restricted_at_time和hidden_truth。
12. 事件只是未发生玩家分歧时的原著基准，到期后由叙事AI根据存档裁定，不能写成强制剧情。
13. 不复制漫画或公式书长段原文，只写简短原创摘要。
14. 资料没有提供的事实使用null或写入unresolved，禁止凭模型数据库补齐。
15. 不得把漫画登场时间自动当成世界内首次发生时间。
16. 输出前检查ID唯一、日期合法、依赖存在、来源完整、同日day_order不重复。

分片外壳与事件格式：
{粘贴本计划第五、六节的JSON格式}

分片信息：
{SHARD_META}

已知前后锚点：
{ANCHOR_EVENTS}

允许使用的实体注册表：
{ENTITY_REGISTRY}

本批唯一事实来源：
{SOURCE_MATERIAL}

严格按提供的JSON外壳返回。
```

## 十二、机械校验与验收条件

每批必须通过：

1. JSON Schema字段、类型、枚举和未知字段校验。
2. 日期正则及十二乘三十日历合法性校验。
3. ID位于当前分片预分配范围内。
4. ID、标题和同日 `day_order` 唯一。
5. `arc_id/entity_id/location_id/depends_on` 引用全部存在。
6. `allocated` 日期位于 `canon_window` 内且有依据。
7. 依赖事件日期不晚于当前事件。
8. 每条至少有一个有效 `source_ref`。
9. 未来幕后真相没有放进公众知识。
10. 没有动画播出日、现实发布日期污染剧情日期。
11. 没有把项目日期描述成原著明示日期。
12. 相同输入重复构建产生相同索引和哈希。
13. 能检索当天事件、逾期待裁定事件和紧邻未来边界。
14. 玩家改变前置条件后，事件可以被改写、跳过或延期。

## 十三、最终交付物

- `timeline-event.schema.json`。
- 篇章、实体、地点注册表。
- 时间线 `manifest.json`。
- 按篇章拆分的严格 JSON 数据。
- 每个分片的审核补丁或审核报告。
- 全库校验结果。
- 生成的日期、实体、篇章和关键词索引。
- 旧世界书格式适配器的接口说明。

未通过审核的数据必须保留 `qa.status = "draft"`，不得进入正式运行时索引。
