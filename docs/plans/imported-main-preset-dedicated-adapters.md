# 四类用户导入主预设专属适配需求与验收规范

状态：已实现并发布测试站与正式站
基线日期：2026-08-17
适用版本：狐神抚 V18、Izumi 0707、梦鲸思客 V4-0806、咩咩预设 5.7.1

## 1. 目标

玩家只需要导入自己的预设并启用，不需要编辑预设、复制项目模板或手动调整正则。项目根据预设已启用条目的结构签名选择一个专属适配器，保证：

1. 原生思维/推演容器完整且不会吞掉正文。
2. 原生正文、状态栏、摘要、选项和其他展示模块保持各自要求的顺序与层级。
3. 单模型模式仍完整生成项目变量、记忆与忍界日报。
4. 后台变量模型或 Agent 模式不会让两个模型重复生成同一批项目标签。
5. 用户预设携带的正则按原顺序、channel、placement 和 depth 生效。
6. 正则生成的 HTML/CSS 可以展示，任意预设脚本、外链、事件属性和网络请求不能执行。
7. 导入文件与持久化预设始终保持原样，专属适配只存在于运行时。

本需求明确废弃“把所有导入预设套进同一个私密标签栈和同一输出示例”的做法。四种语法分别解析、分别修复、分别呈现；共享代码只负责不可变导入、安全沙箱、项目机器标签解析和日志，不参与猜测各预设的格式。

## 2. 当前故障与根因

本次用户日志同时出现：

- `<simple_thinking> 与 <think> 发生交叉闭合`
- 两个思考开始标签未闭合
- `<dream_plot>` 开始和结束均被判定为 0 次

梦鲸的 `<think>` 是整份文档之前的主推演 transport，`<simple_thinking>` 是 `<dream_parallel_event>` 内的局部推演。二者不是可自由嵌套的同类节点。当前通用栈在 `<think>` 未及时闭合时把整个 `<dream_plot>` 都判进私密区，又无法判断落在 `<simple_thinking>` 内的延迟 `</think>` 应归到哪里，因此拒绝回合。

咩咩也存在同类建模错误：`<acg_think>`、`<combat_driver>`、`<story_driver>` 是有固定先后边界的独立阶段，不能被当成任意嵌套的 driver 栈。

日志中的 `app.js?v=2608171957` 还说明发生错误的页面仍运行旧构建，而不是测试站已发布的 `2608172028`。专属适配之外还必须增加 stale-client 检测，避免旧标签页被误认为已经加载新修复。

## 3. 不可违反的约束

### 3.1 预设不可变

- 不修改四份 JSON 文件。
- 不把四份 JSON、完整 prompt、完整正则 replacement 或其大段内容写入项目源码。
- 不以文件名或 SHA-256 作为唯一识别条件。
- 不把适配后的条目写回 `localStorage`、云存档或导出文件。
- 允许内置的只有短小的标签骨架、结构签名和项目机器尾部示例。
- 运行时适配前后必须对导入对象做深度不变性断言。

本次审计的只读基线指纹如下，仅用于证明文件未被修改，不用于运行时识别：

| 文件 | SHA-256 |
| --- | --- |
| `[主预设] V18 狐神抚 · 毓忻.json` | `addc68cdda03b305b973efcb157222ef3cf2295c3990bc5408db74aa3c9c4f0f` |
| `Izumi 0707.json` | `d84eb5ef43eb382d70031de5dd319871c99759027645696626ec504f26de6691` |
| `梦鲸思客V4-0806.json` | `813d58f8d0337232f730cd433cbb7bf66b73838bb4b1cca73fc2bc6f0f8e828f` |
| `咩咩预设 - ver 5.7.1.json` | `d0b7c77e5ab899a215307b14e1e2f83d18e38a42d64ad2363cb331c9409c00f0` |

### 3.2 正文与机器数据分离

项目机器标签包括：

`var`、`variable`、`combat`、`mission`、`relationship`、`event`、`state_update`、`memory`、`shinobi_daily`、`status_query`、`update_manifest`、`var_thinking`、`variable_thinking`。

- 它们必须从原生私密推演、正文和行动选项中分离。
- 它们可以位于梦鲸声明的 `<dream_after_format>` 内，但逻辑上仍属于项目机器尾部。
- 展示正则永远不能读取项目机器标签或把它们替换成可见 HTML。
- 变量解析、记忆、日报和提交审计必须读取规范化后的机器投影，不能读取正则替换结果。

### 3.3 私密内容边界

- 出现了开始标签的私密段必须闭合；不得因未闭合而把正文、状态栏或机器标签隐藏。
- 私密段缺失不能成为状态提交的唯一阻断原因；项目不能伪造模型没有生成的思考内容。
- 私密内容不进入正文、聊天历史正文、时间线正文或正则展示输入。
- 如产品允许显示推演，只能进入现有独立折叠推演区；不得通过预设 HTML 注入正文区。
- 专属修复只能移动/补齐标签边界，不得改写私密段或正文中的自然语言。

## 4. 专属适配器选择

适配器在宏解析完成后，根据本轮实际启用条目的标签和 prefill 结构计算签名。文件名、作者名和哈希只用于诊断展示。

| adapter id | 必需结构签名 | 排他特征 |
| --- | --- | --- |
| `fox-v18` | `think_fox~`、`content`、`fox_selc`、`fox_tip` | assistant prefill 以未闭合 `<think_fox~>` 结束 |
| `izumi-0707` | `konatan_planning~`、`current_event`、`progress`、`tucao` | assistant prefill 以未闭合 `<konatan_planning~>` 结束，正文无总 wrapper |
| `dream-whale-v4` | 唯一根声明 `dream_plot`，直接子节点顺序为 `dream_body`、`dream_after_format` | 同时声明 `dream_scene`、`dream_parallel_event` 和 `simple_thinking` |
| `miemie-v5` | `acg_think`、`combat_driver`、`story_driver`、`story_scene`、`memory_log`、`wlog`、`status`、`affinity` | assistant prefill 是已经闭合的 `<think>think is over...</think>`，导入正则数为 0 |

选择规则：

1. 每轮只能命中一个 adapter。
2. 命中专属 adapter 后不得再叠加通用 wrapper 校验器。
3. 多个签名同时命中时拒绝自动选择并记录诊断，不按名称猜测。
4. 预设升级后，只要结构签名仍成立就沿用对应 adapter；新增标签作为未知原生展示块保留。
5. 未命中的其他导入预设可以继续走现有安全 fallback，但不属于本需求的“完整适配”承诺。

## 5. 狐神抚 V18 专属契约

### 5.1 原生输出语法

最终规范化 raw response：

```xml
<think_fox~>
[狐神抚原生私密推演]
</think_fox~>
<content>
[正文]
</content>
<fox_selc>
【默认】[行动一]
...
</fox_selc>
<fox_tip>[狐神抚留言]</fox_tip>
[项目业务标签，可为零个]
<state_update>{"changed":true|false}</state_update>
<memory>{...}</memory>
<shinobi_daily>{...}</shinobi_daily>
```

约束：

- assistant prefill 已经输出 `<think_fox~>`，模型 continuation 不应再重复开始标签。
- `<content>` 必须恰好包住正文，不得包住 `<fox_selc>`、`<fox_tip>` 或项目机器标签。
- `<fox_selc>` 是单一容器。当前启用条目要求 18 个选项，组顺序和数量继续由导入预设决定，项目不复制该文案。
- `<fox_tip>` 位于选项之后、项目机器尾部之前。

### 5.2 专属规范化

1. prefill 被模型重复回显时只保留一个 `<think_fox~>`。
2. 若 `</think_fox~>` 缺失但 `<content>` 已出现，在 `<content>` 之前补闭合。
3. 若正文文本存在但 `<content>` 丢失，以 `</think_fox~>` 后、`<fox_selc>`/`<fox_tip>`/首个机器标签之前的连续文本作为正文并补 wrapper。
4. 完整机器块若落入 `<think_fox~>`、`<content>` 或 `<fox_selc>`，按原顺序抽取并移动到 `<fox_tip>` 之后。
5. 缺少整个选项或留言时记录兼容警告，不因纯展示模块缺失回滚已经完整的正文与机器提交。
6. 交叉标签只能按上述固定边界修复，不运行通用“最近同名结束标签”算法。

### 5.3 正则完整适配清单

22 条启用正则必须按原顺序保留：

| 原正则 | channel/用途 | 专属验收 |
| --- | --- | --- |
| `！！思维链隐藏…` | prompt | 历史 prompt 隐藏狐神推演，不改持久化 raw |
| `隐藏思维链1` | display/depth | 旧层推演不进入正文 |
| `隐藏狐令`、`隐藏狐令1` | prompt/display user | 只处理 user 投影，不修改玩家原输入 |
| `隐藏正文草稿` | prompt | `<draft>` 不回灌模型 |
| `隐藏大纲块` | display | `<fox_hugou>` 不进入正文 |
| `隐藏狐映` | prompt | `<fox_front>` 不回灌模型 |
| `隐藏狐策1`、`隐藏狐策（掉格式请关）` | display/prompt | depth 规则准确，当前选项仍可见且可点击 |
| `隐藏行动选项留言` | display | 尊重原设置；不能误删项目日报 |
| `隐藏总结` | prompt | 只隐藏 `<fox>` 原生总结 |
| 两条分隔标题行 | no-op | 空 pattern 不执行、不报警 |
| `强制杀掉破折号`、`杀语气…`、`杀相邻句号和逗号` | prompt+display | 仅改运行时投影，不能改存档正文 |
| `OS分割` | display | 保留 `[OS]` 分界语义 |
| `【思维链美化 · 表裏】` | reasoning display | 只能装饰独立推演区，不能把推演带回正文 |
| `【行动选项美化 · 狐策】` | display | HTML/CSS 沙箱展示；原脚本不执行；host 按钮回填准确选项 |
| `【用户推进美化 · 狐令】` | user display | 只展示当前/历史玩家输入投影 |
| `【双语字幕美化】` | display | `<bi>A｜B</bi>` 正确替换且 CSS 隔离 |
| `隐藏奶龙` | prompt+display | 只作用于投影 |

正文 `<content>` 和狐策必须分块呈现，不能因为狐策 replacement 含 HTML 就把整条回复塞进一个不可编辑的大 iframe。

## 6. Izumi 0707 专属契约

### 6.1 原生输出语法

Izumi 没有正文总 wrapper。正文边界由思考闭合和第一个尾部模块共同确定：

```xml
<konatan_planning~>
[日语私密规划]
</konatan_planning~>
[纯文本正文，不增加 content/story_scene 等项目 wrapper]
<current_event>
[当前事件]
</current_event>
<progress>
[进度摘要]
</progress>
<tucao>[单段吐槽]</tucao>
[项目业务标签，可为零个]
<state_update>{"changed":true|false}</state_update>
<memory>{...}</memory>
<shinobi_daily>{...}</shinobi_daily>
```

约束：

- assistant prefill 已打开 `<konatan_planning~>`；continuation 不重复开始标签。
- 某些 OpenAI-compatible/provider 网关只返回 continuation 本体，因此调试原文可能从规划文字开始、仅带 `</konatan_planning~>`。运行时必须在校验前恢复已经存在的规划文字边界；不得把它当成正文，也不得改写规划内容。
- 正文紧跟 `</konatan_planning~>`，保持纯文本，不能强加 `<content>`。
- `<current_event>` 与 `<progress>` 相邻且顺序固定。
- `<tucao>` 位于摘要之后和项目机器尾部之前。

### 6.2 专属规范化

1. 重复 prefill 只保留一次，保留原固定日语开头。
2. continuation 只有一个 planning 结束标签、没有开始标签时，在首个规划文字之前恢复 `<konatan_planning~>`；只增加边界，不生成或改写思考文字。
3. 规划区是 opaque 私密区。里面用于分析的旧 `<current_event>`、`<progress>` 快照不参与正文后最终展示块计数，也不会进入存档正文。
4. `</konatan_planning~>` 缺失时，在 `<current_event>`、`<progress>`、`<tucao>` 或首个机器标签中最早出现者之前闭合。
5. 正文是思考结束后到首个 `<current_event>`/`<progress>`/`<tucao>`/机器标签前的连续区间，禁止用通用 XML 根推断。
6. planning 内出现的机器标签不作为提交；planning 外的完整机器块从正文摘要和吐槽中抽取，移动到 `<tucao>` 后；没有吐槽时移动到最后一个完整原生尾部块之后。
7. 事件/进度/吐槽缺失属于展示兼容警告，不能成为变量和日报已经有效时的唯一回滚原因。

### 6.3 正则完整适配清单

16 条启用正则必须按原顺序保留：

| 原正则 | channel/用途 | 专属验收 |
| --- | --- | --- |
| 两条 `0清理思维链内标签` | display/prompt | 分别作用于 planning/think 投影，不破坏原 raw XML |
| `0可爱美化选项栏（不发送）` | display | 仅在实际出现 `<options>` 时启用；脚本禁用，host 选项可点击 |
| `0【Gal】…弹幕…` | display | 保留静态 CSS 展示，禁用随机脚本和外部资源 |
| `1美化最近二层思维链…` | reasoning display | 只作用于独立推演区，depth 0-2 正确 |
| `2去多余内容` | prompt | 只改下一轮 prompt copy，不能清空本轮展示正文 |
| `4去html提示词` | source/prompt | `<htmlcontent>` 不回灌模型 |
| `4省吐槽token` | prompt/depth | depth 2 以后隐藏吐槽，当前 raw 保留 |
| `7【可选美化】可爱小气泡` | display | `<tucao>` 单独美化 |
| `7 小此闲聊美化` | display | 仅出现 `<konatan_chat>` 时生效 |
| `8摘要美化` | display | 兼容预设要求的 details 摘要变体 |
| `9只保留Progress` | prompt/depth | 11 层后 prompt 只投影 progress，不覆盖存档 |
| `10隐藏近期旧Progress` | prompt/depth | 4-10 层准确隐藏 |
| `11清理多余事件` | prompt/depth | 6 层后隐藏旧 current_event |
| `12美化事件` | display | 相邻 current_event+progress 作为一个展示块 |
| `13杀极其共犯由于并不存在的` | prompt | 不改已提交正文 |

如果正文没有触发任何 HTML replacement，正文仍以普通 markdown 展示；事件卡或吐槽气泡各自进入独立安全块，不能让一个尾部 replacement 替换整条正文。

## 7. 梦鲸思客 V4 专属契约

### 7.1 两层 envelope

梦鲸必须拆成 transport 与 XML document 两层，不能把 `<think>` 当成 `<dream_plot>` 子节点：

```text
transport private:
<think>[主推演]</think>

preset document:
<dream_plot>
  <dream_body>
    <dream_scene>
      <date>[日期]</date>
      <time>[时间]</time>
      <location>[地点]</location>
    </dream_scene>
    [正文]
  </dream_body>
  <dream_after_format>
    <dream_parallel_event>
      <simple_thinking>[平行事件局部推演]</simple_thinking>
      [1-3 条平行事件]
    </dream_parallel_event>
    [其他预设原生后置模块]
    [项目业务标签，可为零个]
    <state_update>{"changed":true|false}</state_update>
    <memory>{...}</memory>
    <shinobi_daily>{...}</shinobi_daily>
  </dream_after_format>
</dream_plot>
```

约束：

- XML document 必须只有一个 `<dream_plot>`。
- `<dream_body>`、`<dream_after_format>` 各一组且顺序固定。
- `<dream_scene>` 位于 `<dream_body>` 开头。
- `<simple_thinking>` 只允许作为 `<dream_parallel_event>` 内的局部私密节点。
- 项目机器尾部位于所有 `<dream_parallel_event>` 等原生后置模块之后、`</dream_after_format>` 之前。
- 原生 `<think>` 可以来自模型文本或 provider reasoning transport；没有思考文字时不得伪造内容。若 continuation 已含完整主推演文字但只给出 `</think>`，允许只恢复缺失的开始边界。

### 7.2 针对本次交叉闭合的确定性修复

梦鲸启用的原生 `思考正则格式化` 允许模型返回“主推演文字 + `</think>` + `<dream_plot>`”。项目 envelope 校验早于显示正则，因此专属 adapter 必须先执行同等的安全边界恢复：把已有根前文字包入 `<think>`，不生成思考内容；随后将整个 transport 内容视为 opaque。主推演里用于自检的 `` `<dream_plot>` ``、`` `<dream_body>` ``、`` `<dream_after_format>` `` 等格式示例不得计入真正 XML document 的标签数量。

对于以下等价错误：

```xml
<think>主推演
<dream_plot>...
<dream_parallel_event>
<simple_thinking>局部推演
</think>
...</simple_thinking>
...</dream_plot>
```

专属 adapter 必须：

1. 在原始 token 流中查找 `<dream_plot>`，不得因为它当前位于未闭合 `<think>` 内就报告 0 次。
2. 将主 `<think>` 的逻辑结束边界固定在第一个 `<dream_plot>` 之前。
3. 插入该边界后，删除 XML document 内唯一一个延迟、无归属的 `</think>`；不删除其周围文本。
4. 重新配对 `<simple_thinking>...</simple_thinking>`，保留全部局部推演文本。
5. 若完整 `<simple_thinking>` 落在 `<dream_parallel_event>` 外，将整个块移动到对应 event 的开头，而不是移动其中自然语言。
6. 抽取所有完整项目机器块，按原顺序放到 `</dream_after_format>` 前且位于平行事件之后。
7. 修复后分别校验 transport 和 preset document；不得再用一个混合栈校验两层。

仅在存在唯一 `<dream_plot>` 边界或完整的 `dream_body -> dream_after_format` 子序列时执行上述修复。重复根、两个候选正文或机器 JSON 不完整仍属于真正歧义；不得静默提交错误状态。

### 7.3 正则完整适配清单

27 条启用正则必须按原顺序保留：

| 正则组 | 包含的原正则 | 专属验收 |
| --- | --- | --- |
| 根与基础隐藏 | `隐藏多余格式内容`、`删除额外标签`、`特殊空行合并` | 只在展示/prompt 投影去掉根壳，不影响 canonical raw |
| 主思考 | `思考正则格式化`、`思考正则隐藏 - 备用方案`、启用的 `思考正则隐藏 - 二选一` | transport think 与 XML 分开；不得捕获 simple_thinking |
| 平行思考 | `对AI隐藏平行思考` | 只隐藏 simple_thinking 内容，保留 dream_parallel_event 可见部分 |
| 正文修订兼容 | `八股超杀V3删除分析`、`V3提取正文`、`删除段落换行`、`V2隐藏草稿`、两个过程美化 | original/analysis/revised/paragraph/comment 的先后执行保持原样 |
| 旧正文后思考 | `正文后思考 - 旧` | 仅处理完整 dream_after_thinking 块 |
| 历史压缩 | 两条 dream_summary、UpdateVariable、dream_discuss、dream_answer、dream_big_discuss 隐藏规则 | placement 与 depth 完整复现，持久化 raw 不变 |
| 状态栏美化 | `梦境状态栏` | 精确读取 date/time/location，作为 dream_body 的首个独立块展示 |
| 平行事件美化 | `梦境平行事件` | 先移除 simple_thinking，再把事件渲染为独立安全块；原脚本不执行 |
| 选项 | `选项框不发送`、`梦境选项框` | prompt 隐藏、当前展示可见；host 回填选项 |
| 其他展示 | `梦鲸摘要`、`思客说书`、`思客大调查` | 每种 wrapper 独立展示，脚本与事件属性均禁用 |

被用户禁用的两条正则继续保持禁用，adapter 不得擅自启用：`正文后思考` 和 `思考正则美化 - 二选一`。

### 7.4 分块呈现

- `<dream_scene>`：状态栏块。
- `<dream_body>` 中除 scene 外的内容：正文块。
- `<dream_parallel_event>`：平行事件块。
- `<dream_option>`：行动选项块。
- 其他已知 dream 展示标签：各自独立块。
- project machine 与两类私密推演：不进入这些展示块。

不得因任一 dream replacement 含 HTML 而把整份 `<dream_plot>` 作为一个 sandbox 文档渲染。

## 8. 咩咩 5.7.1 专属契约

### 8.1 原生输出语法

该预设没有导入正则脚本，必须使用项目专属结构 renderer。规范化顺序：

```xml
<think>
think is over...
</think>
<acg_think>[单个 NPC 属性判断]</acg_think>
<combat_driver>无或战斗推演</combat_driver>
<story_driver>[故事推演]</story_driver>
<story_scene>
  [玩家侧正文]
  <parallel_line_drive>[局部私密推演]</parallel_line_drive>
  <parallel_line>[平行线正文]</parallel_line>
</story_scene>
<memory_log>[原生记忆日志]</memory_log>
<wlog time="🕒时间:Y年M月D日/HH:MM">[世界记录]</wlog>
<status>[原生状态]</status>
<affinity>[原生关系变化]</affinity>
[项目业务标签，可为零个]
<state_update>{"changed":true|false}</state_update>
<memory>{...}</memory>
<shinobi_daily>{...}</shinobi_daily>
```

约束：

- 开头 `<think>think is over...</think>` 是已闭合 assistant prefill，用来阻断 provider 原生思考；它绝不能包裹后续任何阶段。
- `<acg_think>`、`<combat_driver>`、`<story_driver>` 是三个顺序固定的 sibling，不允许互相嵌套。
- 无战斗仍输出 `<combat_driver>无</combat_driver>`。
- `<story_scene>` 位于 `</story_driver>` 后、`<memory_log>` 前。
- `<parallel_line_drive>` 只在平行线存在时出现，属于私密区；`<parallel_line>` 可见。
- 项目 `<memory>` 与原生 `<memory_log>` 是不同合同，不能互相替代。
- 项目机器尾部必须在 `</affinity>` 后。

### 8.2 专属规范化

1. 已闭合 think prefill 只附加一次，不参与后续 wrapper 计数。
2. 若 acg/combat/story driver 的结束标签缺失，以紧随其后的已知 sibling 开始标签作为确定闭合边界。
3. 若延迟结束标签落到下一个 sibling 内，在前述边界补闭合后删除唯一的延迟孤立结束标签。
4. 若 `<story_scene>` 已开始但 `</story_scene>` 缺失，在 `<memory_log>` 之前闭合。
5. 机器块从所有原生阶段抽取并移动到 affinity 后。
6. 不生成预设没有提供的思考自然语言；完全缺失的非机器阶段记录 warning。正文与机器合同有效时，不因纯展示阶段缺失回滚整个回合。

### 8.3 无正则时的专属呈现

咩咩导入文件的正则数量为 0，不能声称“执行原正则”完成适配。必须提供结构 renderer：

| 原生块 | 呈现 |
| --- | --- |
| think/acg_think/combat_driver/story_driver/parallel_line_drive | 独立推演区或隐藏，不进入正文 |
| story_scene 中的玩家侧内容 | 主正文 |
| parallel_line | “平行事件”折叠卡 |
| memory_log | “记忆记录”折叠卡 |
| wlog | “世界记录”折叠卡，保留 time 属性的安全文本值 |
| status | “状态”卡 |
| affinity | “关系变化”卡 |
| htmlcontent | 安全 sandbox；脚本、外链和事件属性移除 |
| 项目机器标签 | 完全隐藏，由项目解析器处理 |

## 9. 专属提示条目要求

每个 adapter 注入一个短小、运行时生成的“交付骨架”，不能继续注入同一段通用格式提示。

- 骨架只包含本节定义的标签、顺序、层级和项目尾部占位符。
- 不复制预设文风、角色设定、思考步骤、状态栏字段说明或正则 replacement。
- Fox/Izumi 的专属 system 条目必须位于最终开放式 assistant prefill 之前，prefill 仍是 messages 最后一条。
- 梦鲸不伪造 assistant prefill；条目说明 transport think 与 XML document 的分层。
- 咩咩保留原本已闭合 assistant prefill，专属条目说明 continuation 从 `<acg_think>` 开始。
- 严格单模型模式的骨架包含项目机器尾部。
- 后台变量/Agent 模式的骨架明确禁止 writer 输出项目机器尾部；后续 updater 只向对应 adapter 声明的落点投递或独立提交。

## 10. 正则执行与安全呈现总要求

### 10.1 不变的执行语义

- 保持导入顺序和故意重复项。
- 完整支持 `placement`、`markdownOnly`、`promptOnly`、source channel、`minDepth`、`maxDepth`、`runOnEdit`、`substituteRegex`、`trimStrings` 和 Tavern capture groups。
- prompt 正则只作用于发给模型的临时副本。
- display 正则只作用于当前回合瞬时展示副本。
- raw response、聊天历史、时间线和导入预设均不得被正则写回。

### 10.2 分块而不是整条 iframe

处理顺序：

1. 专属 adapter 规范化 raw envelope。
2. 解析并移交项目机器数据。
3. 按专属语法切出 reasoning、正文、状态、摘要、平行事件和选项块。
4. 每个块仅执行与其 trigger 相符的原生正则，块内仍保持原正则顺序。
5. 含 HTML/CSS 的结果单独进入 sandbox；普通正文保持 markdown，可编辑、可复制。
6. 没有命中美化正则时使用该 adapter 的结构 fallback。

### 10.3 安全能力替代

- 删除导入 replacement 中的 `<script>`、inline event handler、`javascript:` URL、iframe、object、embed、form action、外链字体和网络资源。
- CSS 动画、details/summary 和纯 HTML 布局可以保留。
- 狐策、Izumi options、梦鲸 options 的点击行为由 host bridge 从原始结构块提取 action 后提供。
- shift-click 追加与普通 click 覆盖行为保持项目现有定义。
- replacement 中的随机脚本、主题切换、复制脚本或远程请求不执行；必要交互由项目显式实现，不能放宽 CSP。

## 11. 保存、切换、重掷与版本要求

1. 四种预设均可导入、切换、保存、刷新后恢复。
2. adapter id 是运行时派生值，不写进用户导入 JSON。
3. 切换预设后立即清空上一预设的 profile、prefill、正则 trace 和 presentation cache。
4. 重掷必须重新读取当前 preset revision，并使用当前 adapter；不能复用上一回合或上一预设 profile。
5. 预设切换期间正在运行的回合继续使用回合开始时冻结的 preset snapshot，不能中途混合两套语法。
6. 页面加载的 JS build 与 `/version.json` 不一致时显示“测试站已有新版本”，阻止把旧构建报错误认为新构建结果，并提供一次明确刷新动作。
7. 常规错误摘要必须包含 `build`、`adapter id`、`preset revision` 和去除私密文本后的结构诊断。仅当导入预设结构校验失败时，另建浏览器本机内存诊断，逐字保留本回合模型原文供测试者检查；不得持久化或上传。

## 12. 错误分级

| 等级 | 示例 | 行为 |
| --- | --- | --- |
| 可确定修复 | 开放 prefill 重复、私密结束标签延迟、机器块落错层、唯一根被未闭合 think 隐藏 | 本地修复后继续；记录 trace，不打断玩家 |
| 兼容 warning | 选项、吐槽、状态美化块完全缺失，但正文和项目机器合同完整 | 正常提交并使用安全 fallback |
| 硬错误 | 重复且无法判定的两个正文根、机器 JSON 截断、两个候选 machine tail、正文为空 | 不提交状态；展示可读错误和保留安全草稿 |

私密 wrapper 的格式错误本身不能再直接产生整回合硬错误；只有它导致正文或机器数据无法确定边界时才升级为硬错误。

## 13. 必须新增的回归矩阵

### 13.1 四份真实文件只读审计

- 编译四份实际 JSON，命中唯一正确 adapter。
- 导入前后文件 SHA-256 不变。
- 编译、inspect、生成 prompt、规范化 response、执行正则后，原 JSON 与保存字符串逐字节不变。
- 不把四份下载文件作为生产运行依赖；CI 使用最小结构 fixture，开发机可选运行真实文件审计。

### 13.2 每个 adapter 的输出测试

每种预设都覆盖：

- 正常完整输出。
- prefill 被完整回显、只回显开始标签和完全不回显。
- 每一个私密结束标签延迟到下一个固定阶段后的情况。
- 机器标签位于私密段、正文、选项、根外的情况。
- strict single-call 下业务标签、唯一 state_update、唯一 memory、唯一 shinobi_daily 完整提交。
- updater/Agent 下 writer 不生成机器标签，后续模型只提交一次。
- 二次规范化幂等。
- streaming partial 不触发最终 envelope 错误；结束后再规范化和校验。

### 13.3 本次梦鲸错误的精确回归

fixture 必须产生与用户日志相同的原始诊断：

- simple_thinking/think 交叉闭合。
- 两个开始标签未闭合。
- dream_plot 因被 think 吞入而表面计数为 0。

专属修复后的断言：

- transport think 完整位于 dream_plot 前。
- simple_thinking 完整位于 dream_parallel_event 内。
- dream_plot 开始/结束各一次。
- dream_body、dream_after_format 各一次且顺序正确。
- state_update、memory、shinobi_daily 位于 dream_after_format 最后。
- 私密文本、正文和机器 JSON 字节内容均未改变。
- pipeline 两个提交前校验点都通过。

另加入本次真实 continuation fixture：根前分析包含多个 dream 格式示例、没有 `<think>` 开始标签但以 `</think>` 结束。修复后根前分析完整隐藏、真实 dream 根与子节点各只计一次，并确认二次变量模型实际调用一次。Izumi fixture 同时覆盖 planning 内旧事件/进度快照与正文后最终事件/进度块并存的情况。

### 13.4 正则测试

- 对 Fox 22、Izumi 16、Dream 27 条启用正则逐条记录 applied/skipped 原因。
- 所有 depth 边界覆盖 `min-1`、`min`、`max`、`max+1`。
- prompt/display/source 三个 channel 分离。
- 大型 HTML replacement 在 sandbox 中展示且没有脚本、外链或 inline event。
- 狐策、Izumi options、梦鲸 options 点击回填正确文本。
- 任一 HTML 尾部块不能吞掉正文编辑栏。
- 咩咩零正则结构 renderer 覆盖所有列出的原生块。

### 13.5 部署与缓存测试

- `js/` 与 `public/js/` 同步。
- 测试站 index、login、version.json 使用同一 build query。
- 新部署后旧标签页能检测 build 变化。
- 测试记录必须打印实际加载的 `app.js?v=...`；低于目标 build 的日志不计为新版本验证。
- 测试站 `/auth/me`、正式站 `/auth/me` 和共享后端 ready 状态继续通过。

## 14. 完成定义

只有同时满足以下条件才可再次发布测试站：

1. 四个专属 adapter 均实现，命中后不再调用通用 envelope validator。
2. 本次交叉闭合 fixture 在不改自然语言内容的情况下通过。
3. 单模型变量、记忆、日报以及 NPC 改名等项目业务合同不回归。
4. 三份带正则的预设逐条 trace 通过；咩咩结构 renderer 通过。
5. 真实四文件哈希不变、保存字符串不变。
6. 完整 `npm test`、public sync、部署回归和浏览器 UI 回归通过。
7. 测试站加载的新 build 与 `/version.json` 一致，用户不再运行旧 `2608171957` 资产验证新修复。

## 15. 实现与验证记录

实现日期：2026-08-19
测试站：`https://www.qiwu.asia:8080/`
测试站 build：`2608191330`
正式站：`https://www.qiwu.asia/`
正式站 build：`2608191341`

### 15.1 已落地模块

- `js/core/main-preset-compatibility.js`：按结构签名派生 `fox-v18`、`izumi-0707`、`dream-whale-v4`、`miemie-v5`，分别生成交付骨架、规范化输出、校验结构和投递项目机器尾部；专属命中后不再进入通用 wrapper 栈。
- `js/core/preset-regex-runtime.js`：按 adapter 拆分正文、状态、摘要、平行事件和选项；HTML replacement 只沙箱化命中的块，并为每条正则记录 applied/skipped 原因。
- `js/core/pipeline.js`、`js/core/agent-runner.js`、`js/core/agent-pipeline.js`：主模型、Agent writer 和连续性 updater 共用同一 adapter profile、专属最终提示和机器尾部落点。
- `js/ui/app-shell.js`：消费专属分块 presentation，普通正文继续使用 markdown，选项点击仍由 host bridge 回填。
- `js/utils/build-version.js`：比较当前 `app.js?v=` 与 `version.json.build`；旧标签页显示不可忽略的刷新提示。常规结构错误摘要只记录 build、adapter id、preset revision 和结构错误。
- `js/core/imported-preset-debug-log.js`：只在导入预设结构校验失败时，把模型完整原文、加入 assistant prefill 后的文本和实际校验文本写入当前页面内存并输出 `[ImportedPresetDebug]` 控制台分组；不写聊天、时间线、localStorage、云存档、预设 JSON 或服务端日志。

### 15.2 精确故障回归

已加入与本次日志等价的 Dream fixture：主 `<think>` 未在 `<dream_plot>` 前闭合，延迟 `</think>` 落在 `<simple_thinking>` 内，同时机器标签落在平行事件中。专属修复断言如下：

- 主 `<think>` 在 `<dream_plot>` 之前闭合，XML 内唯一延迟 `</think>` 被移除。
- `<simple_thinking>` 原文和结束标签完整保留，并位于 `<dream_parallel_event>` 内。
- `<dream_plot>`、`<dream_body>`、`<dream_after_format>` 均唯一且顺序正确。
- `state_update`、`memory`、`shinobi_daily` 移至 `dream_after_format` 最末尾。
- 主推演、局部推演、正文和机器 JSON 的自然语言/数据内容不被改写；二次规范化保持幂等。

另加入两份玩家真实 continuation 形态：Dream 返回“根前推演文字 + `</think>` + `<dream_plot>`”，Izumi 返回“规划文字 + `</konatan_planning~>` + 正文”。专属 adapter 只恢复各自缺失的开始边界，并将私密区内容作为 opaque 文本处理；因此 Dream 推演里的格式示例、Izumi 规划里的旧 `<current_event>/<progress>` 快照都不再参与最终正文结构计数。两个端到端用例均确认二次变量模型实际调用一次，且最终变量、记忆与忍界日报正常提交。

### 15.3 真实文件只读审计

`scripts/main-preset-dedicated-real-audit.mjs` 对四份用户文件执行编译、adapter inspect、专属 prompt、输出规范化、校验和正则 presentation。结果分别唯一命中四个 adapter，启用正则数量为 `22 / 16 / 27 / 0`；审计前后文件 SHA-256 与第 3.1 节基线完全一致，源对象和编译对象的 JSON 快照未变化。

### 15.4 测试与发布结果

- `npm run build:deploy`：通过，`js/` 与 `public/js/` 已同步。
- `npm test`：完整通过，包含 NPC 改名、变量/记忆/日报、Agent、预设切换、正则安全、Service Worker、服务器与部署回归。
- Playwright Chromium 导入预设 UI 回归：8/8 通过，覆盖 markdown 分块、HTML sandbox、选项回填、历史消息不重建 raw sandbox，以及失败原文日志、复制按钮和剪贴板降级提示。
- 部署器远端验证：静态包检查、运行数据排除、Nginx 配置、共享后端 ready、测试站登录重定向、`X-Staging: true` 和 build 查询参数均通过。
- 测试站发布结果：`DEPLOY_OK=https://www.qiwu.asia:8080/`，`BUILD_VERSION=2608191330`。
- 正式站发布结果：`DEPLOY_OK=https://www.qiwu.asia/`，`BUILD_VERSION=2608191341`。

### 15.5 本机完整回复诊断

导入预设结构校验失败后，错误卡显示“复制完整 AI 回复”。测试者也可以打开 F12 控制台搜索 `[ImportedPresetDebug]`，或执行：

```js
copy(window.__NARUTO_PRESET_DEBUG__.rawResponse)
```

`window.__NARUTO_PRESET_DEBUG__` 只保留当前页面最近一次失败，下一回合开始即移除，下一次失败会覆盖。成功回合不创建记录；记录不进入聊天历史、时间线、localStorage、IndexedDB、云存档、用户预设或任何网络请求。
