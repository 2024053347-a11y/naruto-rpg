# 火影原著全忍术数据库重构计划

> 用途：本文件可直接发送给负责数据生成或模块实现的 AI。执行者必须以本文件为完整规格，不得自行改变资料范围、字段名称、分类、数值档位或去重规则。

## 一、项目目标

建立一套覆盖《NARUTO》漫画与官方公式书中全部具名术、明确独立机制术及其变体的结构化数据库。

该数据库用于：

- 让叙事AI按名称、别名、属性、类型、使用者和年代精确检索忍术。
- 避免AI依赖自己的预训练数据库临时编造忍术效果、使用者和限制。
- 为玩家、NPC和开局角色草稿直接生成当前项目兼容的技能对象。
- 明确哪些术可学习、哪些是血继、秘传、契约或唯一能力。
- 统一招式等级、逐术独立资源消耗和威力数值；忍术、幻术、体术分别消耗查克拉、精神力、体力。
- 保存基础术与强化版、组合版、多人版之间的派生关系。

本阶段权威资料范围固定为：

1. 《NARUTO》漫画。
2. 官方公式书、设定书。
3. 漫画与公式书冲突时漫画优先。
4. 不混入动画原创、小说、剧场版、游戏和《BORUTO》资料。

## 二、已经确定的设计决策

- 使用严格 JSON 分片作为唯一权威源数据。
- 不把数千条忍术直接做成普通世界书条目。
- 基础术单独记录。
- 有独立名称或明显机制差异的强化版、组合版、多人版单独记录。
- 变体通过 `variant_of` 或 `derived_from` 连接。
- `rank/resource_type/cost/power` 直接放在招式记录顶层，方便项目直接取用。
- `cost/power` 是项目统一平衡值，不冒充公式书数值。
- 角色熟练度不属于忍术目录；写入角色存档时才设置 `mastery`。
- 只确认原著或公式书明确展示/记载的使用者，不能根据查克拉属性推断。
- 所有数据必须可以适配当前项目的 `name/rank/element/resource_type/cost/power/mastery/description` 技能格式。

## 三、建议目录结构

```text
data/
  canon/
    schemas/
      technique.schema.json
    registries/
      entities.json
      technique-names.json
      organizations.json
    techniques/
      manifest.json
      balance-profile.json
      shards/
        JT-BASIC-P01.json
        JT-FIRE-P01.json
        JT-WATER-P01.json
        JT-GENJUTSU-P01.json
        JT-TAIJUTSU-P01.json
        JT-MEDICAL-P01.json
        JT-SEALING-P01.json
      reviews/
        JT-FIRE-P01.review.json

js/
  data/
    generated/
      canon-technique-index.js
```

`data/canon/techniques/shards` 是唯一权威数据源。

`js/data/generated/canon-technique-index.js` 只能由构建脚本生成。

## 四、分片文件格式

```json
{
  "$schema": "../../schemas/technique.schema.json",
  "schema_version": "naruto.technique.v1",
  "dataset": "naruto-manga-databook",
  "balance_version": "project_balance_v2",
  "shard": {
    "id": "JT-FIRE-P01",
    "group": "fire-release",
    "part": 1,
    "id_start": 1,
    "id_end": 100,
    "source_coverage": [
      {
        "type": "manga",
        "work": "NARUTO",
        "chapter_start": 1,
        "chapter_end": 100
      },
      {
        "type": "databook",
        "work": "临之书"
      }
    ]
  },
  "records": [],
  "unresolved": []
}
```

每片建议五十至一百条，未压缩文件不超过约二百五十 KB。

推荐分组：

```text
basic
fire-release
wind-release
lightning-release
earth-release
water-release
yin-yang
genjutsu
taijutsu
medical
sealing-barrier
space-time
senjutsu
summoning
puppetry
weapon-techniques
dojutsu
kekkei-genkai
secret-techniques
```

`unresolved` 用于保存无法确认的名称、重复疑点、使用者或出处：

```json
{
  "temporary_key": "unknown-fire-technique-01",
  "issue": "漫画画面能确认是火遁，但没有出现正式术名",
  "source_ref": {
    "type": "manga",
    "work": "NARUTO",
    "chapter": 100,
    "pages": null
  }
}
```

没有正式名称且无法证明为独立机制时，不得强行创建正式忍术记录。

## 五、单个忍术的最终格式

```json
{
  "id": "JT-FIRE-0001",
  "canonical_name": "火遁·豪火球之术",
  "aliases": [
    "豪火球之术",
    "豪火球"
  ],
  "continuity": "manga_canon",

  "state_type": "jutsu",
  "classes": [
    "ninjutsu",
    "fire-release",
    "offensive"
  ],

  "variant_of": null,
  "derived_from": [],
  "homonym_group": null,

  "rank": "C",
  "rank_basis": "official",
  "elements": [
    "fire"
  ],

  "cost": 18,
  "resource_type": "chakra",
  "cost_design": {
    "reference_rank": "下忍",
    "pressure": "standard",
    "reference_pool": 100,
    "expected_uses": [5, 8],
    "rationale": "作为下忍阶段的常规主力忍术，预期满资源可使用约5至8次。"
  },
  "power": 70,
  "power_mode": "damage",
  "value_basis": "project_balance_v2",

  "effect": {
    "summary": "将火属性查克拉转化为大型火球，从口中向前方范围喷出。",
    "functions": [
      "damage",
      "area_attack",
      "projectile"
    ],
    "targeting": "forward_area",
    "range": "mid",
    "duration": "instant"
  },

  "activation": {
    "hand_seals": null,
    "tools": [],
    "requirements": [
      "能够使用火属性查克拉。",
      "具备完成该术结印与吐息控制的能力。"
    ],
    "preparation": "聚集火属性查克拉后从口中释放。"
  },

  "limitations": [
    "狭窄空间内可能波及周围目标。",
    "规模和威力受查克拉量与控制力影响。"
  ],

  "counters": [
    "水遁防御",
    "离开正面攻击范围",
    "在成术前打断结印"
  ],

  "access": {
    "learnability": "teachable",
    "restriction": "clan_associated",
    "required_bloodlines": [],
    "required_techniques": [],
    "required_contracts": [],
    "associated_groups": [
      "ORG-UCHIHA"
    ]
  },

  "known_users": [
    {
      "character_id": "CH-NAR-SASUKE",
      "confirmed_from_event_id": "EV-PART1-BELLTEST-0030",
      "confidence": "high",
      "source_ref_index": 0
    }
  ],

  "availability": {
    "exists_before_first_confirmed_use": true,
    "earliest_confirmed_date": null,
    "first_confirmed_event_id": "EV-PART1-BELLTEST-0030"
  },

  "retrieval": {
    "keys": [
      "火遁",
      "豪火球",
      "宇智波"
    ],
    "tags": [
      "offense",
      "area",
      "fire"
    ]
  },

  "source_refs": [
    {
      "type": "manga",
      "work": "NARUTO",
      "chapter": 7,
      "pages": null,
      "supports": [
        "name",
        "effect",
        "known_users"
      ]
    },
    {
      "type": "databook",
      "work": "临之书",
      "entry": "火遁·豪火球之术",
      "page": null,
      "supports": [
        "rank",
        "classification"
      ]
    }
  ],

  "qa": {
    "status": "draft",
    "generated_batch": "JT-FIRE-P01",
    "reviewed_by": null
  }
}
```

## 六、字段枚举与硬规则

### 6.1 当前项目技能类型

`state_type` 只能是：

```text
jutsu
taijutsu
genjutsu
support
```

详细分类全部放入 `classes`，推荐枚举：

```text
ninjutsu
taijutsu
genjutsu
medical-ninjutsu
fuinjutsu
barrier-ninjutsu
space-time-ninjutsu
senjutsu
summoning
bukijutsu
puppetry
dojutsu-technique
kekkei-technique
secret-technique
offensive
defensive
support
fire-release
wind-release
lightning-release
earth-release
water-release
yin-release
yang-release
```

### 6.2 等级

`rank` 必须填写：

```text
E
D
C
B
A
S
特
```

`rank_basis`：

```text
official          漫画明确
databook          公式书明确
project_assigned  原资料未给等级，由项目平衡分配
```

公式书没有等级时仍需要项目运行等级，但必须标记 `project_assigned`。

### 6.3 项目统一数值

`cost` 是每条招式独立设定的非负整数，不由 `rank` 自动推导。即使等级相同，也要根据术的规模、持续时间、覆盖范围、控制难度与实际表现分别评估。

### 6.3.1 当前项目资源基准

生成 cost 时必须使用当前项目忍阶资源区间，不能只看招式等级：

| 参考忍阶 | 查克拉区间/中位值 | 精神力区间/中位值 | 体力区间/中位值 |
|---|---:|---:|---:|
| 忍校学生 | 20–80 / 50 | 15–70 / 43 | 60–160 / 110 |
| 下忍 | 40–160 / 100 | 35–140 / 88 | 100–240 / 170 |
| 中忍 | 80–300 / 190 | 70–260 / 165 | 150–340 / 245 |
| 特别上忍 | 120–420 / 270 | 100–360 / 230 | 180–430 / 305 |
| 上忍 | 180–650 / 415 | 150–550 / 350 | 230–580 / 405 |
| 精英上忍 | 320–1000 / 660 | 260–850 / 555 | 350–800 / 575 |
| 影级 | 600–2500 / 1550 | 500–2200 / 1350 | 550–1250 / 900 |

`resource_type=chakra/spirit/stamina` 时分别使用查克拉、精神力、体力列，三者禁止共用同一参考池。

### 6.3.2 消耗压力档案

档案是生成与机械审查用的宽区间，不是固定 cost 表：

| pressure | 占参考资源中位值 | 目标满资源使用次数 | 用途 |
|---|---:|---:|---|
| `light` | 5%–10% | 10–20次 | 基础、低耗、频繁使用 |
| `standard` | 12.5%–20% | 5–8次 | 常规主力招式 |
| `heavy` | 25%–40% | 2–4次 | 高消耗强力招式 |
| `extreme` | 50%–100% | 1–2次 | 决胜术、禁术、透支型招式 |

每条记录必须填写 `cost_design.reference_rank/pressure/reference_pool/expected_uses/rationale`。例如下忍常规幻术使用精神力中位值88，建议区间约11–18；下忍常规体术使用体力中位值170，建议区间约21–34。数据库仍可填写区间外 cost，但必须在 rationale 中说明原著机制、持续消耗、特殊体质或其他明确原因。

`power` 只能从以下数值选择：

```json
[0, 10, 35, 70, 120, 200, 300]
```

等级只能作为编辑时的粗略参考，不能形成档位表或机械公式。批量生成时必须逐条给出消耗依据，并允许低等级高消耗、高等级低消耗等有原著机制支持的情况。

特殊规则：

- 只有不触发战斗行动的被动、纯信息条目允许 `cost=0`；主动招式不得自行设为0。
- 持续型术的数值代表单次启动或一个标准战斗阶段，不无限累计。
- 复合、禁术、持续术和大规模术必须按自身机制独立设定 cost；生命、寿命、身体损伤等非资源代价另写入 `limitations/side_effects`。
- `value_basis` 固定为 `project_balance_v2`。
- `cost/power` 都是项目平衡值，不是漫画或公式书原始数字。

`resource_type` 只能是 `chakra/spirit/stamina`：`jutsu` 默认 `chakra`，`genjutsu` 固定 `spirit`，`taijutsu` 固定 `stamina`；`support` 必须按真实子类显式选择，不得根据显示名称猜测。

`power_mode` 只能是：

```text
none
damage
defense
healing
control
mobility
utility
summon
seal
```

### 6.4 元素

`elements` 可包含：

```text
none
fire
wind
lightning
earth
water
yin
yang
yin-yang
```

血继复合属性可以同时列出多个基础属性，并在 `classes` 加入对应血继分类。

### 6.5 激活信息

- `hand_seals = null` 表示资料未知。
- `hand_seals = []` 表示资料明确说明无需结印。
- 不知道手印时绝不能填空数组。
- `tools` 只写明确需要的忍具、傀儡、卷轴或媒介。
- `requirements` 需要写出查克拉属性、血继、契约、前置术、身体条件等。

### 6.6 获取限制

`access.learnability`：

```text
teachable
imitable
inherited
contract_only
unique
unknown
```

`access.restriction`：

```text
none
clan_associated
clan_secret
bloodline_required
dojutsu_required
contract_required
body_modification_required
forbidden
unique_owner
unknown
```

数据库中存在某术，不代表任何NPC都可以直接使用。

AI授予角色忍术前必须检查：

1. 当前角色是否已经拥有该术。
2. 是否满足血继、瞳术、契约、身体改造或秘传限制。
3. 当前年代是否已经确认该术存在。
4. 是否存在合理学习来源和剧情过程。
5. 是否仅仅因为角色拥有对应属性而被错误推断会该术。

## 七、变体、派生与去重规则

- `canonical_name` 使用项目统一简体中文名。
- 日文名、港台译名、字幕译名和简称写入 `aliases`。
- 只有译名不同但机制相同的记录必须合并。
- 有独立正式名称或明显机制差异的术单独建条目。
- 强化版、多人版、组合版使用 `variant_of`。
- 一个术由多个术融合形成时使用 `derived_from`。
- 同名不同机制使用相同 `homonym_group`，不能自动合并。
- 去重指纹为 `continuity + normalized_name + variant_of`，只用于报警，不自动删除。
- ID永久稳定，不能因改名而改变。

ID建议：

```text
JT-BASIC-0001
JT-FIRE-0001
JT-WATER-0001
JT-GEN-0001
JT-TAI-0001
JT-MED-0001
JT-SEAL-0001
JT-SPACE-0001
JT-DOJUTSU-0001
```

ID由 `manifest.json` 分配，删除后不得复用。

## 八、使用者和年代规则

- `known_users` 只能记录漫画或公式书明确展示/记载的使用者。
- 角色拥有火属性，不能据此推断其会所有火遁。
- 家族拥有某秘术，不能据此推断每个族人都已掌握。
- `first_confirmed_event_id` 是作品中首次确认使用，不等于忍术发明日。
- `exists_before_first_confirmed_use` 用来说明该术是否明显早已存在。
- 无法判断存在时间时，日期字段保持 `null` 并进入审核。
- 某角色在未来使用过该术，不代表更早年代已经掌握。
- 角色掌握时间应由事件数据库和当前存档共同判断。

## 九、适配当前项目技能格式

忍术目录记录转换后必须得到：

```json
{
  "type": "jutsu",
  "name": "火遁·豪火球之术",
  "rank": "C",
  "element": "火",
  "resource_type": "查克拉",
  "cost": 18,
  "cost_design": {
    "reference_rank": "下忍",
    "pressure": "standard",
    "reference_pool": 100,
    "expected_uses": [5, 8],
    "rationale": "下忍阶段常规主力忍术。"
  },
  "power": 70,
  "mastery": 0,
  "description": "将火属性查克拉转化为大型火球，从口中向前方范围喷出。限制：狭窄空间可能波及周围目标。"
}
```

适配规则：

- `state_type` → `type`。
- `canonical_name` → `name`。
- `elements` 转换成项目中文属性；多属性使用统一连接格式。
- `resource_type` 转换为 `查克拉/精神力/体力`；玩家与NPC共用同一字段和结算器。
- `cost_design` 用于数据库审查，不写入角色战斗变量；运行时只读取最终 `cost`，绝不自动改写。
- `effect.summary` 与 `limitations` 合并成 `description`。
- 新习得技能默认 `mastery=0`。
- 已有角色技能使用角色存档中的熟练度，不能被目录覆盖。
- 不把 `source_refs/known_users/access/retrieval` 写入角色存档。

当前平铺状态仍使用：

```text
技能·忍术·火遁·豪火球之术·名称
技能·忍术·火遁·豪火球之术·等级
技能·忍术·火遁·豪火球之术·属性
技能·忍术·火遁·豪火球之术·消耗
技能·忍术·火遁·豪火球之术·威力
技能·忍术·火遁·豪火球之术·熟练度
技能·忍术·火遁·豪火球之术·描述
```

## 十、运行时模块接口

```js
techniqueDB.getById("JT-FIRE-0001");

techniqueDB.resolve("豪火球");

techniqueDB.search({
  query: "火遁 范围攻击",
  stateType: "jutsu",
  classes: ["fire-release"],
  elements: ["fire"],
  actorId: "CH-NAR-SASUKE",
  date: "K064-01-03",
  limit: 10
});

techniqueDB.canLearn({
  techniqueId: "JT-FIRE-0001",
  actorState: currentActorState,
  date: "K064-01-03"
});

techniqueDB.toStateSkill("JT-FIRE-0001", {
  mastery: 0
});
```

构建阶段生成：

- `byId`。
- `byCanonicalName`。
- `byAlias`。
- `byClass`。
- `byElement`。
- `byKnownUser`。
- `byAvailabilityDate`。
- 变体和派生关系索引。

禁止每回合扫描全部忍术正文。

## 十一、数据生成流程

禁止让一个AI同时完成考证、去重、平衡数值和最终文件。

### 第一轮：证据抽取

只提取：

- 正式名称。
- 别名和不同译名。
- 类型、属性、效果与限制。
- 明确使用者。
- 学习限制、血继和契约要求。
- 原著或公式书等级。
- 出处。
- 不确定项。

这一轮不得自由填写未知手印、未知使用者或项目战斗数值。

### 第二轮：规范化与平衡

- 合并同术不同译名。
- 拆分真正变体。
- 填写 `variant_of/derived_from`。
- 原资料无等级时填写项目等级并标记 `project_assigned`。
- 结合参考忍阶、对应资源池和 pressure 逐术填写 `cost`；`power` 按允许档位填写。
- 填写 `value_basis=project_balance_v2`。

### 第三轮：独立审核

审核AI只返回补丁：

```json
{
  "batch_id": "JT-FIRE-P01",
  "replacements": [],
  "deletions": [],
  "unresolved": [],
  "review_notes": []
}
```

审核AI不得重写整个文件。

## 十二、可直接发送给数据生成AI的提示词

```text
你是结构化火影忍术资料抽取器，不是设定补完作者。你不得使用自己的预训练记忆补充我没有提供的资料。

任务：
根据我提供的漫画/公式书资料，生成naruto.technique.v1严格JSON分片。

权威来源：
1. 《NARUTO》漫画。
2. 官方公式书。
3. 漫画与公式书冲突时漫画优先。
4. 禁止混入动画原创、小说、剧场版、游戏和《BORUTO》资料。

硬规则：
1. 只输出合法JSON，不输出Markdown、解释或代码围栏。
2. 只能使用本批ID范围：{ID_RANGE}。
3. 只收录有正式名称或明确独立机制的术。
4. 规范简体中文名写canonical_name；其他译名、日文名和简称写aliases。
5. state_type只能是jutsu/taijutsu/genjutsu/support；细分类写classes。
6. 独立机制变体单独建条目，并使用variant_of或derived_from。
7. rank必须填写；原著或公式书未明确时使用rank_basis=project_assigned。
8. resource_type只能是chakra/spirit/stamina；cost必须是逐术独立评估的非负整数，禁止按等级套用固定表；cost_design五个字段必须齐全。
9. power只能从[0,10,35,70,120,200,300]中选择。
10. cost/power始终是项目平衡值，value_basis固定为project_balance_v2。
11. 未知手印必须写null；只有明确无印才能写空数组。
12. known_users必须有明确来源，不能根据属性或家族自行推断。
13. 初次出场不等于术的发明时间。
14. 每条必须有source_refs，并说明出处支持的字段。
15. 不得用模型数据库补充未提供的使用者、限制、手印、等级或出处。
16. 找不到可靠信息时写入unresolved，不能编造。
17. 不复制漫画或公式书长段原文，只写简短原创摘要。
18. 输出前检查ID、规范名、aliases、variant_of、known_users和source_refs是否冲突或重复。

分片外壳与单术格式：
{粘贴本计划第四、五节的JSON格式}

分片信息：
{SHARD_META}

已有名称和别名：
{NAME_REGISTRY}

实体、事件和忍术注册表：
{ENTITY_REGISTRY}

本批唯一事实来源：
{SOURCE_MATERIAL}

严格按提供的JSON分片外壳返回。
```

## 十三、机械校验与验收条件

每批必须通过：

1. JSON Schema字段、类型、枚举和未知字段校验。
2. ID必须位于当前分片预分配范围。
3. ID和 `canonical_name` 唯一。
4. 所有别名冲突均被报告。
5. `variant_of/derived_from/required_techniques` 引用存在。
6. `known_users` 人物和事件引用存在。
7. 每条至少有一个有效出处。
8. `rank_basis` 与资料来源一致。
9. `resource_type` 与 `state_type/classes` 一致；`cost` 有逐术依据且同等级允许不同。机械计算的参考池、建议区间和预期次数必须与 cost_design 一致；区间外记录必须有非空 rationale。`power` 只使用允许的离散数值。
10. `value_basis` 固定正确。
11. 未知手印没有错误写成空数组。
12. 没有因查克拉属性推断额外使用者。
13. 没有把首次登场当成发明日期。
14. 同名变体没有错误合并，单纯译名没有重复建档。
15. 适配结果只包含当前项目允许的技能字段。
16. 相同输入重复构建产生完全相同的索引和哈希。
17. 别名、分类、属性、使用者和年代检索测试通过。

## 十四、最终交付物

- `technique.schema.json`。
- 忍术名称、人物和组织注册表。
- `balance-profile.json`。
- 忍术 `manifest.json`。
- 按分类分片的严格 JSON 数据。
- 每个分片的审核补丁或审核报告。
- 全库重复、别名和引用校验结果。
- 生成的忍术索引。
- 当前技能格式适配器接口说明。

未通过审核的数据必须保留 `qa.status = "draft"`，不得进入正式运行时索引。
