# 剩余项目正史多 AI 提示词

## 使用方法

总计十九个 AI 任务。第一批是十五个剧情写作任务 A-O，可并行执行；给每个 AI 发送“公共写作提示词”全文，再附上对应的专属任务块。不要只发送专属任务块。

全部写作者完成后，启动 P-R 三个连续性审校任务。三者的可写分片互不重叠，可以并行；给每个 AI 发送“公共审校提示词”全文和对应专属任务块。

P-R 全部完成后，最后单独执行 S 全量整合。基础设施已经完成，不再安排普通写作者或审校者修改公共格式。

## 公共写作提示词

```text
你正在 D:\Downloads\火影\naruto-rpg 中重构 Naruto RPG 的 project.timeline.v2 项目正史。你的目标不是逐条翻译或机械复刻原著，而是使用已有资料设计一条适合长期互动游玩的、日期合理、因果完整、允许玩家改变的项目剧情线。

开始前必须完整阅读：
1. docs/plans/project-game-canon-multi-era-v2.md
2. docs/plans/project-game-canon-part1-v2.md
3. canon-rebuild-output/scripts/project-timeline-v2/helpers.mjs
4. 你的专属任务块列出的旧剧情 JSON
5. 与你开局交接直接相关的上一份已完成 V2 分片；若其尚未完成，只采用任务块中的交接契约，不读取或修改其他 AI 的未完成文件。

事实优先级：当前项目世界书与已完成项目正史状态 > 为游玩性冻结的项目因果与日期 > 漫画可用素材 > 动画、小说和其他补充素材 > 旧自动事件的日期与拆分 > 模型预训练知识。旧 JSON 是覆盖资料，不是必须逐条保留的剧本。

你只能修改两个属于自己的文件：
- canon-rebuild-output/scripts/project-timeline-v2/<专属分片ID>.mjs
- canon-rebuild-output/data/canon/project-timeline/shards/<专属分片ID>.json（必须由单分片生成命令产生）

禁止修改 Manifest、Schema、contract.mjs、helpers.mjs、source-loader.mjs、生成器、校验器、运行时、预设、其他分片、package.json 和 public。工作区已有其他用户改动，不得清理、回滚或格式化无关文件。

源文件必须使用：
import { createTimelineHelpers, defineTimelineShard } from './helpers.mjs';
const { beat, bridge, day, scene, source } = createTimelineHelpers('<你的命名空间>');

默认导出必须使用 defineTimelineShard。文件名必须与生成的分片 ID 完全相同。arcCodes 只填写短代码，由 helper 自动生成 ARC ID。禁止手写其他时代的 DAY/SCN/EV/THR/ARC ID。

写作硬规则：
1. 只能在专属日期窗口内选取剧情日，窗口之间绝不能重复日期；不要求每天有剧情，禁止为了填满日历制造流水账。
2. definition 的 dateStart/dateEnd 必须等于本分片实际第一个和最后一个 DAY 日期，而不是机械等于窗口边缘。
3. 一个日期全项目只能有一个 DAY。同日不同地点、视角或冲突必须拆成该 DAY 内的独立 SCENE，每日一至八场。
4. 一个 SCENE 只承担一个地点与冲突线程；一个 EV 只推动一个原子因果。旧资料中连续对白和重复招式必须压缩，不得一条旧记录生成一个 EV。
5. 每个场景必须有具体 requirements、blockers、fallbacks、outcomes、state_changes、stop_condition、design_rationale 和来源。禁止通用占位语句。
6. interactive 只用于玩家有合理入口且必须做选择的场景，participants/setup/beats/outcomes/stop_condition 中必须明确“玩家”，并至少有一个 choice 节拍。纯 NPC 或幕后事件用 conditional/offscreen。
7. 原作结果只是基准。角色死亡、叛逃、晋升、败北、救援、秘密公开和组织决策都必须服从当前分支；前置改变时使用 altered/skipped/postponed，不得强制回归原作。
8. 每个行动必须承接人物位置、旅行时间、伤势、查克拉、精神力、体力、装备、权限、任务和关系。大战尤其不能让同一角色无移动过程出现在多个战场，也不能无限施术。
9. 角色只能知道亲历、被告知、公开可查或合理推断的信息。幕后真相放入 reference_facts 或受限离屏场景，不能自动进入普通角色知识。
10. 项目采用十二月、每月三十日的 KYYY-MM-DD 日历。旧资料的 allocated 日期不是权威；可以在专属窗口内重排，但要让旅行、治疗、训练、调查和政治响应拥有足够时间。
11. 分片首日 start_state 必须接住上一阶段；末日 end_state 与 transition 必须交接人物位置、伤势、资源、知识、职权、任务、关系、俘虏/遗体和未解决事件。
12. 当旧资料错误、重复、只有篇章介绍或与世界书冲突时，修正、合并或舍弃，并在 design_rationale/reference_facts 中说明真正需要保留的因果，不得把错误包装成项目事实。

完成后只运行：
npm run generate-project-timeline -- --shard <专属分片ID>
npm run validate-project-timeline -- --shard <专属分片ID>

不得运行无 --shard 的全量生成，不得运行 build-canon-runtime、sync-public、npm test 或 npm run build。

最终回复必须报告：修改的两个文件、实际日期首尾、DAY/SCENE/EV 数量、单分片校验结果、合并或舍弃的重要旧资料，以及需要下一分片承接的状态。不要只给建议，必须完成文件和验证。
```

## A：卡卡西外传

```text
专属分片ID：HIST-KAKASHI-GAIDEN
命名空间：HIST
源文件：canon-rebuild-output/scripts/project-timeline-v2/HIST-KAKASHI-GAIDEN.mjs
独占日期窗口：K050-06-01 至 K050-06-05
旧资料：canon-rebuild-output/data/canon/timeline/shards/plot/TL-NAR-GAIDEN-AUTO.json（60条）
建议 arcCodes：KAKASHI-GAIDEN、KANABI-BRIDGE

任务：把卡卡西外传整理成可独立游玩的历史篇，而不是让 K064 之后的普通角色自动回忆全部真相。完整呈现任务编制、神无毗桥行动、带土与卡卡西关系变化、写轮眼移植、琳与水门的救援和任务后果。为玩家提供合理身份入口，但不得让玩家无代价知道未来带土身份。

首端契约：第三次忍界大战背景、少年水门班实际成员和权限明确；尚未发生的伤亡、移植和身份真相不得写入 start_state。
末端契约：分别记录带土公开状态与隐藏真实状态、卡卡西伤势和写轮眼来源、琳与水门的知情范围、任务结果和情感后果；HIST 内容不得直接变成 P1/P2 角色公共知识。
```

## B：修行期、风影夺还与天地桥

```text
专属分片ID：P2-RETURN-GAARA-TENCHI
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-RETURN-GAARA-TENCHI.mjs
独占日期窗口：K064-06-16 至 K067-02-30
旧资料：
- canon-rebuild-output/data/canon/timeline/shards/plot/TL-NAR-P2-GAARA-AUTO.json（101条）
- canon-rebuild-output/data/canon/timeline/shards/plot/TL-NAR-P2-TENCHI-AUTO.json（95条）
建议 arcCodes：TIMESKIP-TRAINING、RETURN、GAARA-RESCUE、TENCHI-BRIDGE、SASUKE-REUNION

任务：承接 P1 鸣人与自来也离村后的修行期，用少量关键训练、联络和世界变化日跨越三年；随后完成归村、我爱罗被掳与砂隐求援、追踪和救援、卡卡西/鸣人的消耗与恢复、天地桥情报链、大蛇丸据点行动及与佐助再会。不要把三年写成一段无状态蒙太奇，也不要每天填训练。

首端契约：读取 P1-SASUKE 最终状态。佐助是否叛逃、纲手是否任职、鸣人是否按期远行均必须可分支；只有基准线满足时才使用原作阵容。
末端契约：交接我爱罗存亡与风影权限、晓组织已公开情报、第七班/大和/佐井的实际编组、鸣人九尾失控风险、佐助的位置立场与双方亲历知识，以及所有伤势和任务结案状态。
```

## C：飞段角都、追踪鼬与自来也雨隐行动

```text
专属分片ID：P2-AKATSUKI-ITACHI-JIRAIYA
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-AKATSUKI-ITACHI-JIRAIYA.mjs
独占日期窗口：K067-03-01 至 K067-05-30
旧资料：
- TL-NAR-P2-AKATSUKI-AUTO.json（185条）
- TL-NAR-P2-ITACHI-AUTO.json（155条）
- TL-NAR-P2-JIRAIYA-AUTO.json（37条）
以上文件位于 canon-rebuild-output/data/canon/timeline/shards/plot/
建议 arcCodes：AKATSUKI-SUPPRESSION、ITACHI-PURSUIT、JIRAIYA-RAIN

任务：完成二尾/飞段角都威胁、阿斯玛小队后果、鹿丸复仇的团队与资源逻辑、鸣人风遁训练及代价；再并行推进佐助和木叶双方追踪鼬、自来也进入雨隐调查佩恩。不同追踪队和雨隐行动必须分场景、分知识，不允许隔空共享情报。

首端契约：严格承接 B 的队伍编制、晓情报、佐助位置和鸣人身体状态。
末端契约：明确飞段角都处理结果、阿斯玛及相关人员真实状态、鸣人新术医疗限制、木叶追踪队与佐助小队位置、鼬/佐助会面条件、自来也在雨隐的生死和最终情报是否成功送出。D 只能使用实际送达的情报。
```

## D：兄弟决战与佩恩袭击

```text
专属分片ID：P2-BROTHERS-PAIN
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-BROTHERS-PAIN.mjs
独占日期窗口：K067-06-01 至 K067-08-30
旧资料：
- TL-NAR-P2-BROTHERS-AUTO.json（98条）
- TL-NAR-P2-PAIN-AUTO.json（132条）
建议 arcCodes：BROTHERS、UCHIHA-TRUTH、PAIN-ASSAULT、KONOHA-RECOVERY

任务：完成佐助与鼬的决战及真相获取链，确保真相只进入实际听闻者知识；随后给木叶足够时间接收自来也情报、破解佩恩机制、安排防御与鸣人修行，再推进佩恩袭击、村内多战场、鸣人归来和战后裁定。死亡与复活不能作为强制结果。

首端契约：鼬、佐助、自来也、木叶情报部门的状态只能来自 C 的末端记录。
末端契约：交接鼬/自来也/长门/弥彦相关真实状态，佐助获得了哪些证据及其阵营选择，木叶人员伤亡与设施损害，纲手和火影权限，鸣人状态、公众关系和九尾封印风险，以及五影会谈与晓后续行动的现实触发条件。
```

## E：五影会谈与大战倒计时

```text
专属分片ID：P2-KAGE-COUNTDOWN
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-KAGE-COUNTDOWN.mjs
独占日期窗口：K067-09-01 至 K067-12-30
旧资料：
- TL-NAR-P2-KAGE-AUTO.json（109条）
- TL-NAR-P2-COUNTDOWN-AUTO.json（240条）
建议 arcCodes：FIVE-KAGE-SUMMIT、WAR-DECLARATION、ALLIANCE-MOBILIZATION、JINCHURIKI-PROTECTION

任务：让五影会谈建立在各村真实领导、外交证据和战后损失上；处理佐助介入、团藏与带土行动、战争宣言、忍者联军形成、兵力调动、岛龟保护和参战决策。给外交、通信、集结和训练足够时间，禁止所有国家一天内完成联盟。

首端契约：读取 D 的木叶权力状态、佐助阵营、晓情报和实际伤亡；三代、纲手、团藏等权限不得按原作自动重置。
末端契约：明确各村领导与联军指挥链、佐助和带土位置、兜合作条件、秽土转生情报范围、鸣人与奇拉比的知情和行动状态、各战区兵力与补给、战争是否按基准发动。F 从实际动员结果开始。
```

## F：第四次忍界大战初期交战

```text
专属分片ID：P2-WAR-CONFRONT
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-WAR-CONFRONT.mjs
独占日期窗口：K068-01-01 至 K068-01-10
旧资料：TL-NAR-P2-CONFRONT-AUTO.json（192条）
建议 arcCodes：WAR-DEPLOYMENT、WAR-CONFRONT、REANIMATED-FORCES

任务：把旧资料压在一两天内的初期大战重排为十日以内的可玩战役。建立各战区行军、侦察、第一轮交锋、秽土转生者识别与封印、医疗和夜间轮换。不同战区不得合并成连续镜头，鸣人和奇拉比是否离开保护区必须来自真实决策。

首端契约：完全承接 E 的联盟、指挥、兵力、补给、鸣人/奇拉比和敌方部署。
末端契约：逐战区交接存活、伤势、封印、位置、补给、情报和指挥变化；明确斑被召回、鸣人进入主战场以及 G 开始时各主要战线是否成立的条件。
```

## G：大战高潮 A

```text
专属分片ID：P2-WAR-CLIMAX-A
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-WAR-CLIMAX-A.mjs
独占日期窗口：K068-01-11 至 K068-01-20
旧资料：TL-NAR-P2-CLIMAX-AUTO.json 第0001至0220条
建议 arcCodes：WAR-MADARA、JINCHURIKI-FRONT、FIVE-KAGE-BATTLE、ITACHI-PURSUIT

任务：从斑秽土现身开始，整理五影战场、鸣人/奇拉比对人柱力与带土、鼬追查施术者等并行线程。旧0220“鼬用乌鸦阻止佐助继续跟随”是本任务末端参考；不要提前写下一任务的兜决战。

首端契约：承接 F 的所有战区和资源，任何已被玩家改变的秽土对象或封印结果都必须改变基准阵容。
末端契约：明确五影战况、斑能力情报、人柱力与尾兽状态、鸣人与九尾合作程度、带土面具线索、鼬与佐助位置及追踪兜的条件。H 从鼬找到兜开始。
```

## H：大战高潮 B

```text
专属分片ID：P2-WAR-CLIMAX-B
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-WAR-CLIMAX-B.mjs
独占日期窗口：K068-01-21 至 K068-02-05
旧资料：TL-NAR-P2-CLIMAX-AUTO.json 第0221至0450条
建议 arcCodes：KABUTO-DECISION、REANIMATION-RELEASE、OBITO-MASK

任务：从鼬定位兜开始，完成佐助介入、兜战与秽土解除条件、鼬最后交接；同时继续鸣人/卡卡西/凯对带土并推进面具破裂。旧0450“凯确认带土是昔日同学”是末端参考，H 不得替 I 完成卡卡西与带土的真相对质。

首端契约：只使用 G 实际交接的鼬、佐助、兜、战场和尾兽状态。
末端契约：明确秽土转生是否解除及例外、鼬与佐助的知识和选择、兜生死与能力、面具破裂后谁亲眼确认了带土、卡卡西精神/身体状态。I 从卡卡西的质问与后续战场后果开始。
```

## I：大战高潮 C

```text
专属分片ID：P2-WAR-CLIMAX-C
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-WAR-CLIMAX-C.mjs
独占日期窗口：K068-02-06 至 K068-02-15
旧资料：TL-NAR-P2-CLIMAX-AUTO.json 第0451至0671条
建议 arcCodes：OBITO-TRUTH、TEN-TAILS-REVIVAL、ALLIANCE-LAST-STAND、HOKAGE-RETURN

任务：从卡卡西质问带土开始，完成身份真相、十尾复活、联军总部与主战场的指挥交接、联军集结、重大伤亡、九尾查克拉分配，以及历代火影和佐助进入战场。回忆只用于解释带土本人动机，不能让现场所有人自动知道琳、斑和雾隐事件的完整真相。

把旧资料中的连续战斗拆成有移动、通信、医疗、轮换与资源结算的战役阶段。十尾、神树或火影抵达必须具有施术者、准备条件和传播范围。末段只推进带土成为十尾人柱力及联军首次确认其状态；完整的人柱力攻防交给 J。

首端契约：只使用 H 实际交接的面具破裂、卡卡西/带土、鸣人/奇拉比、秽土转生和各战区状态。带土身份只对亲眼确认或之后收到可信通报者成立。
末端契约：明确十尾形态、带土人柱力状态、联军指挥与通信、每名重大伤亡者、鸣人分配查克拉后的负担、卡卡西位置与精神状态、四位火影和佐助的抵达条件，以及斑、柱间和各尾兽的位置。J 从十尾人柱力攻防开始。
```

## J：十尾人柱力与无限月读

```text
专属分片ID：P2-WAR-JINCHURIKI
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-WAR-JINCHURIKI.mjs
独占日期窗口：K068-02-16 至 K068-02-25
旧资料：canon-rebuild-output/data/canon/timeline/shards/plot/TL-NAR-P2-JINCHURIKI-AUTO.json（297条）
建议 arcCodes：OBITO-JINCHURIKI、TAILED-BEAST-EXTRACTION、MADARA-ASCENDANT、EIGHT-GATES、INFINITE-TSUKUYOMI

任务：完成带土成为十尾人柱力后的联军攻防、其意志动摇与尾兽剥离、斑夺取主导权、鸣人与佐助濒死和获得新力量、凯的八门决战，以及无限月读发动。任何力量获得、复苏、眼睛转移和尾兽抽取都必须记录来源、条件、代价与知情范围。

日期窗口是容量，不要求把一场不能中断的决斗强行拖满十天。可以用医疗转运、敌我重组和战场转移形成阶段，但禁止在十尾持续威胁下插入无依据的长期休息。凯是否开死门、谁能救援、鸣佐是否得到六道力量，都必须允许前置改变后的替代路线。

首端契约：承接 I 的十尾、带土、斑、火影、尾兽、联军指挥、伤亡、查克拉与人物位置。不存在的伤亡不能用原作台词补回，未到场者不能直接参战。
末端契约：明确带土、斑、凯、鸣人、佐助和各尾兽的身体与能力状态；记录无限月读是否成功、影响范围、免疫或受保护者、神树与月亮状态。K 只能从实际免受术影响且仍可行动的人开始。
```

## K：辉夜、终结之谷与战争收束

```text
专属分片ID：P2-KAGUYA-FINAL
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-KAGUYA-FINAL.mjs
独占日期窗口：K068-02-26 至 K068-03-10
旧资料：canon-rebuild-output/data/canon/timeline/shards/plot/TL-NAR-P2-KAGUYA-AUTO.json（199条）
建议 arcCodes：KAGUYA-RETURN、DIMENSION-RESCUE、TEAM7-SEALING、WAR-RELEASE、FINAL-VALLEY、WAR-SETTLEMENT

任务：从黑绝背叛斑的条件成立处开始，完成辉夜复归、多空间分离与救援、第七班协作封印、无限月读解除、秽土火影告别，以及鸣人与佐助最后的政治与个人冲突。最后加入必要的现场搜救、伤员回收、俘虏控制和联军停战确认，但把长期司法、重建和任职交给 L。

空间切换必须记录谁被转移、谁能定位、跨空间能力的次数和代价。带土牺牲、卡卡西短暂能力、双臂重伤、佐助败北或和解都不是不可更改的过场；前置不同就按存档状态重算，同时保留“终止无限月读并决定战后秩序”的核心冲突。

首端契约：只承接 J 实际记录的无限月读、斑、黑绝、鸣佐、卡卡西、小樱、带土、尾兽与火影状态。若辉夜复归条件未成立，使用替代最终威胁，不得凭标题强行召唤。
末端契约：逐项交接无限月读解除结果、辉夜/黑绝/斑/带土与秽土者状态、尾兽去向、鸣佐伤势与立场、佐助法律身份、联军伤亡、各村领导权限、战俘和遗体，以及仍需调查的六道级威胁。L 从战后第一轮现实处置开始。
```

## L：战后重建与新时代交接

```text
专属分片ID：P2-POSTWAR-TRANSITION
命名空间：P2
源文件：canon-rebuild-output/scripts/project-timeline-v2/P2-POSTWAR-TRANSITION.mjs
独占日期窗口：K068-03-11 至 K082-07-30
旧资料与锚点：
- canon-rebuild-output/data/canon/timeline/shards/TL-YEARLY-ALMANAC-AUTO.json
- canon-rebuild-output/data/canon/timeline/yearly/K068.json 至 K082.json
- js/data/worldbook/timeline.js
- js/data/worldbook/timeline-detailed.js
- js/data/worldbook/boruto-era.js
- js/data/worldbook/characters.js 及与本任务直接相关的角色资料
建议 arcCodes：WAR-RECOVERY、POSTWAR-JUSTICE、KAKASHI-TENURE、SASUKE-JOURNEY、THE-LAST、FAMILY-FOUNDATIONS、NARUTO-SUCCESSION、NEW-GENERATION

任务：原创一条从战争结束到博人时代开局的可玩桥梁。覆盖伤员和难民安置、战犯与秽土问题、五国裁军及赔偿、卡卡西任职、佐助审理与赎罪旅程、尾兽与大筒木情报、The Last 的可用冲突、婚恋和家庭形成、科技与忍者制度变化、鸣人接任七代，以及新一代入学和毕业前状态。

十四年内只选择会改变长期状态的锚点日，不得生成逐日填充。婚姻、出生、任职和代际关系必须先满足人物存活、关系、法律与时间条件；年度资料中的日期是项目锚点，但与 K 的分支冲突时应改为条件事件，不能让不存在的父母生出基准线子女。

跨年必须用明确的上一锚点 end_state、下一锚点 start_state 和 transition 说明期间发生了什么、哪些状态没有变化。不能用一句“多年后”跳过佐助监管、火影交接、村落恢复或孩子成长，也不能把十四年每项日常生活都写成剧情。

首端契约：严格读取 K 的战争结算。死亡、领导、尾兽去向、佐助身份、鸣佐伤势和村落损失均不得自动恢复为原作结果。
末端契约：明确七代火影与五村领导、鸣人/雏田和佐助/小樱等家庭是否实际成立、新一代年龄和亲子知识、第七班候选编组、科技和任务制度、残余大筒木/壳情报，以及 K082-08-01 时玩家可进入的社会状态。M 不得用预训练知识补齐未成立的家庭。
```

## M：佐良娜与桃式

```text
专属分片ID：BOR-SARADA-MOMOSHIKI
命名空间：BOR
源文件：canon-rebuild-output/scripts/project-timeline-v2/BOR-SARADA-MOMOSHIKI.mjs
独占日期窗口：K082-08-01 至 K083-03-30
旧资料：
- canon-rebuild-output/data/canon/timeline/shards/plot/TL-BOR-SARADA-AUTO.json（116条）
- canon-rebuild-output/data/canon/timeline/shards/plot/TL-BOR-MOMOSHIKI-AUTO.json（276条）
辅助资料：js/data/worldbook/boruto-era.js、timeline.js、timeline-detailed.js，以及 K082/K083 年度文件
建议 arcCodes：SARADA-FAMILY、SHIN-INCIDENT、ACADEMY-TRANSITION、NEW-TEAM7、CHUNIN-EXAM、MOMOSHIKI-INVASION、KARMA-AWAKENING

任务：承接 L 已真实成立的家庭和制度，完成佐良娜的身世调查、宇智波信与克隆体事件、亲子关系后果；再用少量关键日建立毕业、编组和任务经验，推进中忍考试、科学忍具作弊、桃式袭击、异空间救援和楔的出现。

旧资料混有漫画、动画和衍生版本。只保留能形成一致项目线的事件，不得同时演出互斥版本。佐良娜不能因数据库标签凭空怀疑身世；博人与鸣人的矛盾必须来自实际陪伴、火影职责和沟通记录。桃式情报只进入亲历者、调查者和获正式通报者知识。

首端契约：读取 L 的家庭成员、亲子关系、火影、佐助位置、学院和科技制度。任何未出生、死亡、未婚或未任职分支都要替换对应剧情入口。
末端契约：明确信与克隆体处置、佐良娜的证据和家庭关系、新第七班成员与任务资历、中忍考试结果、科学忍具处分、桃式/金式状态、鸣佐消耗、博人的楔和知情范围，以及后续地下组织可利用的漏洞。
```

## N：貉、青、川木与一式

```text
专属分片ID：BOR-MUJINA-AO-KAWAKI
命名空间：BOR
源文件：canon-rebuild-output/scripts/project-timeline-v2/BOR-MUJINA-AO-KAWAKI.mjs
独占日期窗口：K083-04-01 至 K084-12-30
旧资料：
- TL-BOR-MUJINA-AUTO.json（4条）
- TL-BOR-AO-AUTO.json（113条）
- TL-BOR-KAWAKI-AUTO.json（193条）
以上文件位于 canon-rebuild-output/data/canon/timeline/shards/plot/
辅助资料：js/data/worldbook/boruto-era.js、timeline.js、timeline-detailed.js，以及 K083/K084 年度文件
建议 arcCodes：MUJINA-BANDITS、KARA-OUTERS、AO-MISSION、VESSEL-RECOVERY、KAWAKI-HOME、JIGEN-ASSAULT、ISSHIKI-CRISIS、CODE-PRELUDE

任务：由于貉强盗团旧资料只有篇章介绍，必须依据可靠项目资料重建天斗护卫、监狱/强盗团线和壳组织线索，不能把四条元数据写成四个事件。随后完成飞船事故、青与科学忍具、川木被发现和安置、壳组织追捕、家庭信任、慈弦/一式危机、果心居士与阿玛多行动，以及一式败亡后的现实代价。

川木不是发现后立即成为家人。每一步都要记录隔离、医疗、监视、楔共鸣、损害赔偿、信任与选择。科学忍具、空间术、楔和大筒木能力必须有使用者、能源或身体代价。鸣人失去九尾、佐助失去轮回眼和一式死亡仅在对应前置真实发生时写入。

首端契约：承接 M 的新第七班、楔、鸣佐、科技部门和桃式情报。壳组织不能知道未泄露的木叶内部信息，木叶也不能从数据库名称提前知道壳的完整结构。
末端契约：明确鸣人、佐助、博人、川木、阿玛多、果心居士、考德、一式和九尾状态；记录壳组织结构、十尾情报、楔进度、家庭信任、村内安保与实际知情者。O 从考德拥有现实动机、目标和行动能力的状态开始。
```

## O：考德、全能与蓝色漩涡

```text
专属分片ID：BOR-CODE-OMNIPOTENCE-RETURN-MATSURI
命名空间：BOR
源文件：canon-rebuild-output/scripts/project-timeline-v2/BOR-CODE-OMNIPOTENCE-RETURN-MATSURI.mjs
独占日期窗口：K085-01-01 至 K086-12-30
旧资料：
- TL-BOR-CODE-AUTO.json（39条）
- TL-BOR-OMNIPOTENCE-AUTO.json（4条）
- TL-BOR-RETURN-AUTO.json（10条）
- TL-BOR-MATSURI-AUTO.json（3条）
以上文件位于 canon-rebuild-output/data/canon/timeline/shards/plot/
辅助资料：js/data/worldbook/boruto-era.js、timeline.js、timeline-detailed.js，以及 K085/K086 年度文件
建议 arcCodes：CODE-ASSAULT、EIDA-ARRIVAL、KARMA-CRISIS、OMNIPOTENCE、BORUTO-EXILE、TIMESKIP-TRAINING、BLUE-VORTEX-RETURN、DIVINE-TREES、MATSURI-RYU

任务：旧资料严重稀疏且含错译、篇章简介和错序，不得按记录数生成事件。依据本地可靠资料重建考德袭击、艾达和迪蒙、川木与博人的楔危机、鸣人与雏田被封印、全能导致的身份与记忆改写、博人离村、跳时训练、回归木叶、爪垢与神树人，以及祭/龙相关行动。

全能必须是有触发条件、作用范围和例外清单的状态变化。逐人记录原记忆、改写后认知、物证冲突、免疫或怀疑来源；不能用一句“所有人都忘了”覆盖佐良娜、堇、佐助等人的实际状态。若艾达、川木或楔的前置被改变，则使用 altered/skipped 路线，不能强制身份互换。

跳时阶段只写训练、追捕、政权变化和关系断裂等关键锚点，同时交接旅行路线、导师、能力来源与代价。蓝色漩涡部分只写本地资料能够支持的内容；不确定或超出资料覆盖的后续保持为未解决威胁，不得用模型记忆编造结局。

首端契约：严格承接 N 的考德能力与目标、楔进度、鸣佐战力、川木家庭关系、阿玛多和壳情报。已死亡、失能、未加入木叶或不具相应知识者不能按原作位置出现。
末端契约：明确鸣人/雏田封印状态、博人与川木身份和位置、火影代理与木叶指挥、每个关键人物的记忆状态、佐助与佐良娜状况、考德和神树人目标、十尾变化及玩家可继续介入的未解决线程。不要为尚未完结的故事伪造终局。
```

## 公共审校提示词

给 P、Q、R 各发送本节全文，再附上对应的专属审校任务块。

```text
你正在 D:\Downloads\火影\naruto-rpg 审校已经完成的 project.timeline.v2 项目正史分片。目标是修正跨分片连续性、玩法因果、日期、知识边界和资源状态，不是统一文风，也不是把项目线改回漫画固定结局。

开始前必须完整阅读：
1. docs/plans/project-game-canon-multi-era-v2.md
2. docs/plans/project-game-canon-part1-v2.md
3. docs/plans/project-game-canon-remaining-agent-prompts.md
4. canon-rebuild-output/scripts/project-timeline-v2/helpers.mjs
5. 你的专属范围内所有源 `.mjs`、生成 JSON、相邻交接分片和相关旧资料

先建立一张交接表，逐分片核对：日期首尾、人物位置、伤势、查克拉/精神力/体力、装备、身份权限、任务、关系、公开知识、私密知识、俘虏/遗体、未解决威胁。重点找出无移动跨场、无治疗满状态、无来源新能力、死者复活、领导权限回滚、角色全知、分支被强制拉回原作和旧资料错序。

你只能修改专属任务块允许的分片源 `.mjs`，并用单分片生成命令更新对应 JSON。不得修改相邻只读分片、Manifest、Schema、contract.mjs、helpers.mjs、source-loader.mjs、生成器、校验器、运行时、预设、package.json 或 public；不得清理和回滚工作区其他改动。

修复应优先调整后一个分片的 start_state、requirements、blockers、fallbacks、state_changes 和知识范围。只有错误确实产生于前一个分片末端时才修改前一个分片。不得为了通过校验删除具体状态、弱化约束或制造通用模板。

每个实际改动的分片都必须分别运行：
npm run generate-project-timeline -- --shard <分片ID>
npm run validate-project-timeline -- --shard <分片ID>

不得运行全量生成、build-canon-runtime、sync-public、npm test 或 npm run build。最终回复必须列出发现和修复的连续性问题、修改文件、每个分片的 DAY/SCENE/EV 数量与校验结果，以及仍需最终整合者处理的跨范围问题。
```

## P：第一部至大战前连续性审校

```text
只读交接源：P1-SASUKE
允许修改的分片：
- P2-RETURN-GAARA-TENCHI
- P2-AKATSUKI-ITACHI-JIRAIYA
- P2-BROTHERS-PAIN
- P2-KAGE-COUNTDOWN

审校范围：从 K064-06-15 第一部末端到 K067-12-30 联军动员完成。逐段核对 P1→B→C→D→E 的交接，特别检查鸣人修行和归村、佐助去留、大蛇丸与晓情报、纲手/团藏/火影权限、我爱罗与砂隐关系、伤亡和复活、队伍编制、旅行/治疗时间、五影会谈资格及战争动员来源。

禁止修改 P1-SASUKE；发现其问题只记录给 S。不得审校或修改 A、F-O。最终报告按四个可修改分片分别列出结论，并明确 E 交给 F 的联军、指挥、补给、敌我位置和人柱力状态是否闭合。
```

## Q：大战与战后连续性审校

```text
只读交接源：P2-KAGE-COUNTDOWN
允许修改的分片：
- P2-WAR-CONFRONT
- P2-WAR-CLIMAX-A
- P2-WAR-CLIMAX-B
- P2-WAR-CLIMAX-C
- P2-WAR-JINCHURIKI
- P2-KAGUYA-FINAL
- P2-POSTWAR-TRANSITION

审校范围：从 K067-12-30 动员末端到 K082-07-30 新时代交接。逐战区建立人物位置和时间表，核对通信、行军、查克拉/体力/精神力、医疗、封印、尾兽、秽土转生、眼睛和六道能力来源，确保同一角色不会无移动出现在不同战场，连续大战不会无说明恢复。

同时核对 K→L 的战争司法、领导交接、佐助处置、尾兽去向、婚恋家庭、出生年龄、科技发展和七代继任。十四年桥梁必须有关键锚点和状态转场，但不得扩写成逐日流水账。

禁止修改只读的 E，也不得修改 A-D、M-O。最终报告必须给出 F→G→H→I→J→K→L 的交接矩阵，并明确 L 交给 M 的家庭、制度、年龄、战力和大筒木情报是否闭合。
```

## R：博人时代连续性审校

```text
只读交接源：P2-POSTWAR-TRANSITION
允许修改的分片：
- BOR-SARADA-MOMOSHIKI
- BOR-MUJINA-AO-KAWAKI
- BOR-CODE-OMNIPOTENCE-RETURN-MATSURI

审校范围：从 K082-07-30 战后时代末端到 O 的最后实际剧情日。核对 L→M→N→O 的年龄、家庭、队伍、火影权限、科学忍具、楔、大筒木能力、壳组织情报、旅行和训练时间。重点清除旧 JSON 中的篇章简介、错译、错序和动画/漫画互斥版本。

为全能建立逐角色记忆审计表，至少覆盖博人、川木、鸣人、雏田、佐助、佐良娜、堇、艾达、迪蒙、鹿丸、向日葵和新第七班。记忆、物证、亲历与推断必须分开；不能把模型知道的真相写成角色知识。

禁止修改只读的 L，也不得修改 A-K。最终报告必须明确 O 末端哪些事件是已发生状态、哪些是角色误认、哪些是幕后事实、哪些仍是开放线程，并标出因本地资料不足而没有采用的旧记录。
```

## S：最终整合与全量验收

将以下提示词单独发送给最后一个 AI。只有 A-O 全部完成且 P-R 审校结束后才能启动。

```text
你是 D:\Downloads\火影\naruto-rpg 的 project.timeline.v2 最终整合者。所有内容写作和分段审校已经完成。你的职责是把 A-O 与现有 P1 内容集成为一个可构建、可运行的项目正史，并修复全量检查暴露的真实问题。

开始前完整阅读三份计划文档、全部 project-timeline-v2 源 `.mjs`、当前 Manifest、P-R 的审校结论，以及生成器、校验器和运行时构建脚本。先检查所有源分片是否存在、文件名与默认导出 ID 是否一致、每个生成 JSON 是否能由源重建。

你可以修改 A-O 的源 `.mjs` 和它们的生成 JSON，也可以接受全量命令正常更新 Manifest、运行时数据和 public 镜像。不得删除或回滚用户的无关改动；不得通过放宽 Schema、删校验、改 ID 规则或移除具体状态来掩盖内容错误。共享基础设施只有在证明其自身存在缺陷时才能修改，并要在报告中单列理由。

按顺序运行：
npm run generate-project-timeline
npm run validate-project-timeline
npm run build-canon-runtime
npm run sync-public
npm test
npm run build

任何一步失败都要定位并修复后从受影响的最早步骤重跑。重点处理重复日期或 ID、错误命名空间、分片首尾不符、陈旧 JSON/Manifest、跨分片状态断裂、运行时计数错误、预设提示词未读取新命名空间，以及源目录与 public 不同步。不要只报告失败。

全量通过后再运行 git diff --check，并抽查：HIST 不会泄露为公共知识；P1→P2→BOR 主线交接闭合；战斗资源连续；长期跳时有锚点；全能记忆按角色隔离；未完结剧情保持开放；运行时 manifest 的 included_namespaces、覆盖日期和计数与实际内容一致。

最终回复必须报告：最终覆盖日期、命名空间、分片/DAY/SCENE/EV 数量；六条命令的结果；修复过的集成问题；Manifest、运行时和 public 同步情况；尚存的资料不确定性。只有所有必需命令通过且没有待处理集成错误时才可宣布完成。
```
