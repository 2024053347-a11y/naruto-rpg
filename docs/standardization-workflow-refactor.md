# 项目代码优化与更新技术文档 — 打包/同步工作流标准化重构

> 范围：`scripts/` 下的四个工作流脚本（`bundle.mjs`、`build-regex.mjs`、`sync-to-card.cjs`、`watch-and-sync.mjs`）及其配置机制。
> 对应《系统架构与工程规范重构路线图》第 1 条「工程规范与开发工作流治理」。

---

## 1. 重构摘要 (Executive Summary)

本次重构将四个各自为政、互相复制粘贴、硬编码个人开发机路径的构建/同步脚本，收敛为「4 个薄入口 + 6 个单一职责共享模块」的标准化工具链：消除了约 130 行重复代码，用环境变量取代全部机器相关路径，并通过 11 项自动化行为比对验证了 **打包产物逐字节一致、角色卡写入结果逐字节一致** 的 100% 向后兼容。

## 2. 痛点与缺陷诊断 (Code Smell Analysis)

| # | 缺陷 | 位置（重构前） | 专业定性 |
|---|------|----------------|----------|
| 1 | CRC-32 算法 + PNG chunk 解析/重组逻辑存在两份手写拷贝，字节级重复 | `sync-to-card.cjs:19-26,28-38,79-85` 与 `watch-and-sync.mjs:191-261` | **DRY 违例 / 散弹式修改（Shotgun Surgery）**：修 PNG 逻辑必须同时改两处，漏一处即产生静默数据损坏风险 |
| 2 | SillyTavern regex 脚本的 13 字段结构在两处手写字面量 | `build-regex.mjs:41-55`、`sync-to-card.cjs:60-68` | **重复的隐式契约**：字段一旦漂移（如 `markdownOnly` 不一致），酒馆端静默渲染失败，无编译期防线 |
| 3 | 个人开发机路径硬编码：`D:/SillyTavern/SillyTavern`、`../../忍者手记/`、`D:\node.exe` | `watch-and-sync.mjs:35`、`sync-to-card.cjs:12,16` | **零可移植性（Portability）**：换机器/换人即不可用；路线图第 1 条明确点名的问题 |
| 4 | 两个同步脚本对同一外部资源的路径假设**互相矛盾**：`sync-to-card.cjs` 假设酒馆在仓库同级目录（`ROOT/../SillyTavern`），`watch-and-sync.mjs` 假设在 `D:` 盘绝对路径；手动导出目录一个是 `ROOT/../忍者手记`、另一个是 `ROOT/../../忍者手记` | 同上 | **配置漂移（Configuration Drift）**：同一事实存在两个矛盾来源，说明曾靠改代码适配环境 |
| 5 | dist 产物文件名（含中文）作为魔法字符串散布在 4 个文件中 | 各脚本头部 | **魔法值（Magic Strings）**：改一个产物名要同步改 4 处，漏改即静默断链 |
| 6 | 模块规范混用：3 个 ESM（`.mjs`）+ 1 个 CommonJS（`.cjs`） | `sync-to-card.cjs` | **技术栈不一致**：无法共享 ESM 工具模块，是重复代码（#1、#2）的直接成因 |
| 7 | `sync-to-card.cjs` 全程无异常处理：regex JSON 缺失、导出目录不存在、PNG 损坏均直接以未捕获异常崩溃；且**未找到 ccv3 块时静默成功**（原样重写 PNG 并打印 "PNG card updated"） | `sync-to-card.cjs` 全文 | **异常处理缺失 + 静默失败（Silent Failure）**：后者尤其危险——用户以为已同步，实际什么都没写入 |
| 8 | PNG 解析对 `readUInt32BE` 越界无防护，损坏/截断的 PNG 抛出裸 `RangeError`，无法定位问题 | 两处 PNG 解析循环 | **防御性编程缺失**：错误信息与故障根因脱节 |
| 9 | `watch-and-sync.mjs` 中 `isBuilding` 并发保护是死代码（构建为同步阻塞，事件回调不可能在构建期间执行），且一旦触发将**丢弃**构建期间的变更 | `watch-and-sync.mjs:266-278` | **误导性并发控制**：看似有保护，实际语义是丢事件 |
| 10 | `execSync("node \"...\"")` 经 shell 拼接路径执行 | `watch-and-sync.mjs:85-95` | **Shell 注入面 + PATH 依赖**：路径含特殊字符时行为不可控；依赖 PATH 上恰好有 `node` |
| 11 | watcher 无退出清理（`fs.watch` 句柄不关闭）、Ctrl+C 靠进程强杀 | `watch-and-sync.mjs` | **资源生命周期管理缺失** |

## 3. 架构与模式升级 (Architecture & Pattern Updates)

重构后的分层结构（依赖方向自上而下，无环）：

```
scripts/
├── bundle.mjs           # 入口：单文件打包（导出 bundle()，可被测试/复用）
├── build-regex.mjs      # 入口：酒馆正则 JSON 生成（导出 buildRegexArtifacts()）
├── sync-to-card.mjs     # 入口：一次性同步（取代 sync-to-card.cjs，导出 syncToCard()）
├── watch-and-sync.mjs   # 入口：监听 + 增量构建 + 同步
└── lib/
    ├── paths.mjs        # 项目内路径的单一事实来源（ROOT / dist 产物名）
    ├── sync-config.mjs  # 外部路径配置：环境变量 → 历史默认路径回退
    ├── png-card.mjs     # PNG 角色卡元数据读写（CRC32 / chunk 解析 / ccv3 编解码）
    ├── tavern-regex.mjs # SillyTavern regex 脚本对象工厂
    ├── card-sync.mjs    # 领域逻辑：把 regex 脚本写入角色卡（策略参数化）
    └── logger.mjs       # 统一时间戳日志
```

应用的设计原则与模式：

- **单一职责（SRP）**：每个 `lib/` 模块只回答一个问题——"路径在哪"（paths/sync-config）、"PNG 怎么读写"（png-card）、"regex 脚本长什么样"（tavern-regex）、"怎么写进卡"（card-sync）。入口脚本退化为参数组装 + 编排。
- **策略模式（轻量形态）**：旧 `sync-to-card` 与 `watch-and-sync` 对角色卡的两种写入语义（整体覆盖 vs 按名 upsert）统一为 `writeRegexToCard(cardPath, script, { mode })` 的策略参数，而不是两套平行实现。刻意未做成类继承体系——两种策略共 20 行，类化属于过度设计（KISS）。
- **工厂函数**：`createRegexScript()` 收敛 13 字段契约，字段顺序刻意与历史产物一致，保证 dist JSON 可与旧版本逐字节 diff。
- **依赖注入（配置层面）**：`resolveSyncConfig(env = process.env)` 接受注入的环境对象，外部路径不再是编译期常量；测试时可传入伪造 env。
- **单一事实来源（SSoT）**：dist 产物文件名从 4 处散布收敛到 `paths.mjs` 一处。
- **入口/库分离**：所有入口脚本采用 `import.meta.url` 主模块检测（`fileURLToPath` 实现，Windows 盘符安全），被 `import` 时只导出函数不产生副作用，为后续补充单元测试铺路。
- **守护进程健壮性**：watcher 补齐 SIGINT 优雅退出（关闭全部 `fs.watch` 句柄）、构建期间变更改为"排队补一轮"而非丢弃。

刻意 **没有** 做的事（防过度设计）：

- 未引入 Vite/Webpack 替换手写打包器——单文件 HTML + 酒馆正则是本项目特有产物形态，现有拓扑排序方案工作正常且零依赖；路线图中的构建工具链升级应作为独立课题评估。
- 未把 `bundle.mjs` 的正则式 import 解析替换为 AST 解析——产物需逐字节兼容，且当前代码风格（每行一条静态 import）下正则足够；风险与迁移路径已写入第 6 节防坑指南。
- 未引入任何第三方依赖——打包链路保持零依赖，`一键打包.bat` 在未 `npm install` 的裸环境仍可运行。

## 4. 性能与复杂度对比 (Performance & Complexity Metrics)

本次重构以正确性与可维护性为主目标，算法复杂度维持不变（打包链路本身已是线性）：

| 维度 | 重构前 | 重构后 | 说明 |
|------|--------|--------|------|
| 依赖图构建 | O(M·L)（M 模块数，L 平均行数） | 不变 | BFS + 逐行正则匹配 |
| 拓扑排序 | O(V+E) | 不变 | DFS 后序 |
| PNG chunk 解析 | O(N)（N 文件字节数） | 不变 | 单遍扫描 |
| CRC-32 | O(N·8)（逐位法） | 不变 | 2.9 MB 卡片约 20ms，非热点，不值得引入查表法的复杂度 |
| **代码量** | 4 文件 977 行 | 4 入口 + 6 模块共 1379 行（增量几乎全部为 JSDoc 类型注释、文档性注释与显式错误处理） | 重复的 CRC32/PNG/regex 契约实现净减约 130 行；逻辑本体收敛为单份 |
| **子进程启动** | `execSync('node "…"')` 经 shell | `execFileSync(process.execPath, […])` 免 shell | 每次构建省一次 shell 解析，且消除注入面 |
| **watcher 内存** | `fs.watch` 句柄泄漏至进程退出 | 显式持有并在 SIGINT 关闭 | 长驻进程资源可控 |
| **失败恢复** | 构建期间变更被丢弃（需再改一次文件才触发） | 排队补建 | 消除"改了没生效"的人工重试成本 |

产物体积、内容完全不变（逐字节验证，见第 6 节）。

## 5. 依赖与语法更新 (Dependency & Syntax Migration)

| 旧写法 | 新写法 | 动机 |
|--------|--------|------|
| CommonJS（`require`/`__dirname`，`sync-to-card.cjs`） | 统一 ESM（`.mjs` + `import.meta.url`） | 与项目其余脚本一致，可共享 lib 模块 |
| `import fs from 'fs'` | `import fs from 'node:fs'` | `node:` 前缀是 Node 官方推荐，防第三方包名劫持，一眼可辨内置模块 |
| 硬编码 `D:/SillyTavern/...` | `process.loadEnvFile()`（Node ≥ 20.12 原生 .env 支持）+ `TAVERN_DIR` 等环境变量 | 消除机器耦合；不新增 dotenv 依赖（该 API 与 dotenv 语义一致：已有环境变量优先） |
| `execSync('node "path"')` | `execFileSync(process.execPath, [path])` | 免 shell、免 PATH 依赖、路径含中文/空格安全 |
| `buffer.slice()` | `buffer.subarray()` | `Buffer#slice` 已被 Node 标记为 legacy，`subarray` 语义相同且明确为视图 |
| `if (!card.data) card.data = {}` | `card.data ??= {}` | 逻辑空赋值运算符，意图更直白 |
| 手写 `ensureDir`（`existsSync` + `mkdirSync`） | `fs.mkdirSync(dir, { recursive: true })` | 原生幂等，消除 TOCTOU 窗口 |
| 无类型 | `// @ts-check` + JSDoc（`@param`/`@returns`/`@typedef`） | 编辑器内即获得类型检查与补全，零构建成本（对纯 JS 项目是 TS 迁移前的最优过渡态） |
| 裸异常/无异常 | 自定义 `PngCardError` + 入口层 `try/catch` + `process.exitCode` | 错误可分类、可定位；CI 可依赖退出码 |

新增环境变量（均可选，见 `.env.example`）：`TAVERN_DIR`、`TAVERN_USER`、`TAVERN_CARD_NAME`、`MANUAL_EXPORT_DIR`。

未变化：`npm run bundle`、`npm run build-regex`、`node scripts/watch-and-sync.mjs` 命令不变；`一键打包.bat` 无需改动。唯一入口变化：`node scripts/sync-to-card.cjs` → `node scripts/sync-to-card.mjs`。

## 6. 边界测试与防坑指南 (Edge Cases & Fallbacks)

### 6.1 本次重构的兼容性验证（全部自动化通过）

| 验证项 | 方法 | 结果 |
|--------|------|------|
| 单文件 HTML 产物 | 重构前后各跑一次 `bundle.mjs`，`cmp` 比对 | **逐字节一致**（含模板内两处历史遗留的行尾空格，刻意保留） |
| 两份酒馆正则 JSON | 归一化随机 UUID 后比对 | 逐字节一致 |
| 角色卡覆盖写入（旧 `sync-to-card.cjs` 语义） | 构造含 ccv3/chara tEXt 块的 PNG fixture，新旧脚本各写一次，比对解码后的卡片 JSON 与 chara 块 | 一致（modulo 每次运行必然新生成的脚本 UUID） |
| 角色卡 upsert 写入（`watch-and-sync` 语义，命中/未命中两分支） | 旧算法逐字提取为参照实现，与新 `writeRegexToCard` 输出比对 | **逐字节一致** |
| watcher 端到端 | 启动 → 首次构建 → 触碰 `js/app.js` → 二次构建 → SIGINT 退出 | 全链路正常 |
| 损坏输入 | 缺失卡片 / 截断 PNG | 抛出带明确信息的 `PngCardError`，不再是裸 `RangeError` |

### 6.2 重点照顾的异常情况

- **regex JSON 未生成**就运行同步：明确报错并提示先执行 `npm run bundle && npm run build-regex`（旧版为裸 ENOENT 堆栈）。
- **手动导出目录不存在**：告警并跳过该步（旧 `sync-to-card.cjs` 直接崩溃、旧 `watch-and-sync` 静默跳过——统一为"显式告警 + 跳过"）。
- **卡片无 ccv3 元数据**：显式报错（旧 `sync-to-card.cjs` 会静默"成功"）。
- **PNG 截断/块长度越界**：解析前做边界校验，报"文件可能被截断"。
- **构建进行中文件再次变更**：排队补建一轮，不丢事件。
- **图片缺失/未知类型**（打包时）：保持旧行为——告警并保留原路径引用，不中断打包（属防御性设计，刻意保留）。
- **循环依赖**（打包时）：保持旧行为——告警并断环继续，因 IIFE 合并对声明顺序的容忍度与 ES 模块不同，中断反而误伤。

### 6.3 存疑的历史行为（已保留，请原作者确认）

1. **`watch-and-sync` 会把角色卡 JSON 的“裸 JSON 原文”写入 `chara` tEXt 块**（`ccv3` 块正常写 base64）。V2 角色卡规范中 `chara` 也应为 base64；裸 JSON 可能导致只认 `chara` 的旧版酒馆读卡失败。疑似历史 bug，但不排除是为某个特定工具链准备的格式。已通过 `writeRegexToCard` 的 `updateCharaChunk` 开关**原样保留**，确认无下游依赖后建议移除。
2. **两个同步入口的写入语义不同**：`sync-to-card.mjs` 整体覆盖 `regex_scripts`（会清掉卡上其他正则脚本），`watch-and-sync.mjs` 按名 upsert（保留其他脚本）。已在代码注释标明；若整体覆盖并非有意为之，建议统一为 upsert。
3. **`findRegex: '起物'` 与 `'(起物)'` 两个变体、`placement: [2]` 与 `[1,2]` 的差异**为酒馆端消费约定，重构未触碰；调整前需与酒馆侧的正则/placement 语义核对。
4. **外部图床 URL**（postimg.cc 三张背景图）仍硬编码于 `bundle.mjs` 的 `EXTERNAL_ASSET_URLS`：图床失效会导致单文件版背景丢失，建议后续镜像到自有 CDN。

### 6.4 后续维护防坑

- **改 dist 产物文件名只能改 `scripts/lib/paths.mjs`**，切勿在别处再写字面量。
- **`bundle.mjs` 的 import 解析是正则实现**，只认"每行一条静态 import/export"。若源码引入动态 `import()`、多行解构 import、`export * from`，打包会静默漏模块——届时应迁移到 `es-module-lexer`/AST 方案，并用 dist 逐字节 diff 验证迁移。
- **`generateHTML` 模板中的行尾空格是产物字节兼容的一部分**（第 28、41 行附近），编辑器的"保存时去尾空格"会破坏与历史产物的可比性；如无逐字节比对需求可忽略。
- **`createRegexScript` 的字段顺序不可重排**：JSON.stringify 按插入序输出，重排会导致 dist diff 噪音。
- **打包链路（bundle/build-regex）必须保持零第三方依赖**：`一键打包.bat` 面向未执行 `npm install` 的最终用户环境。
- **同步脚本需 Node ≥ 20.12**（`process.loadEnvFile`）；不配 `.env` 也能跑（回退历史默认路径探测）。
- 修改 PNG 写入逻辑后，务必用 `docs` 中描述的 fixture 方法做新旧字节比对——角色卡是用户资产，写坏无法自动恢复。
