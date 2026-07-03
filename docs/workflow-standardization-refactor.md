# 项目代码优化与更新技术文档 — 构建/同步工具链标准化重构

> 范围：`scripts/` 构建与酒馆同步工具链（bundle / build-regex / sync-to-card / watch-and-sync）
> 对应路线图：《技术重构路线图》第 1 节「工程规范与开发工作流治理」
> 日期：2026-07-03

---

## 1. 重构摘要 (Executive Summary)

本次重构将四个各自为政、互相复制粘贴的构建/同步脚本，收敛为「共享库 + 薄入口脚本」的分层架构：消除了约 120 行重复的 PNG/CRC32 实现与两处硬编码的个人开发机绝对路径，统一为环境变量注入，并补齐了异常处理与边界校验。**核心产物 `dist/naruto-rpg-bundle.html` 经 SHA-256 逐字节比对，与重构前完全一致（`be701f13…`），正则 JSON 产物除随机 UUID 外逐字节一致，实现 100% 向后兼容。**

## 2. 痛点与缺陷诊断 (Code Smell Analysis)

| # | 缺陷 | 位置（重构前） | 专业定性 |
|---|------|----------------|----------|
| 1 | `crc32()`、PNG chunk 解析/重建逻辑在两个脚本中各手抄一份 | `sync-to-card.cjs`、`watch-and-sync.mjs` | **DRY 违背**（Copy-Paste Programming），字段/算法一旦修改极易漏改其一 |
| 2 | `tavernDir: 'D:/SillyTavern/SillyTavern'`、`../../SillyTavern/...`、`../../忍者手记` | 同上 | **硬编码绝对路径**，零可移植性（Portability），换机即崩 |
| 3 | 同一“手动导入目录”在两个脚本中推导结果不同（项目父目录 vs 祖父目录） | `sync-to-card.cjs` L12 vs `watch-and-sync.mjs` L128 | **隐性配置漂移**（Configuration Drift），行为取决于跑哪个脚本 |
| 4 | 酒馆正则 JSON 的 13 个字段结构在两处硬编码 | `build-regex.mjs`、`sync-to-card.cjs` | **魔法结构/魔法数字**（`placement: [2]` 等无语义说明），缺乏单一事实来源 |
| 5 | `"type": "module"` 的 ESM 项目里混入 CommonJS（`.cjs` + `require`） | `sync-to-card.cjs` | **模块体系割裂**，无法复用 ESM 共享库 |
| 6 | PNG 解析无签名校验、无越界检查；`ccv3` 解码失败直接 `process.exit(1)` 散落在业务逻辑中 | 两处 PNG 实现 | **缺乏防御性校验**：截断/非 PNG 文件会静默读出脏数据或抛出难以定位的底层异常 |
| 7 | `execSync('node "${path}"')` 字符串拼接调用子进程 | `watch-and-sync.mjs` L85 | 路径含引号/空格时被 shell 二次解释，属**命令注入类脆弱写法** |
| 8 | 构建期间的文件变更被 `if (isBuilding) return` 直接丢弃 | `watch-and-sync.mjs` L272 | **丢失更新竞态**（Lost Update）：最后一次保存可能永远不被打包 |
| 9 | `scheduleBuild` 中 `setTimeout(async () => …)` 内跑同步阻塞构建 | 同上 | 名不副实的 async，掩盖真实执行模型 |
| 10 | 图床 URL、内联资源清单散落在函数体内 | `bundle.mjs` `buildAssetMap()` | **配置与逻辑耦合**，调整资源策略需读懂函数实现 |

## 3. 架构与模式升级 (Architecture & Pattern Updates)

重构后的分层结构：

```
scripts/
├── lib/                        ← 新增：共享库（单一职责模块）
│   ├── project-paths.mjs       ← 路径配置的单一事实来源 + dotenv 环境变量注入
│   ├── png-card.mjs            ← PNG tEXt 元数据编解码器（唯一 CRC32/chunk 实现）
│   ├── tavern-regex.mjs        ← 酒馆正则脚本 JSON 的工厂函数
│   └── logger.mjs              ← 统一日志器（错误走 stderr）
├── bundle.mjs                  ← 打包器（复用路径配置，输出逐字节不变）
├── build-regex.mjs             ← 薄入口：读 bundle → 工厂造 JSON → 落盘
├── sync-to-card.mjs            ← 薄入口（原 .cjs 迁移 ESM）：整体重建卡上正则
└── watch-and-sync.mjs          ← 薄入口：监听 → 子进程构建 → 增量更新卡
```

应用的设计原则与模式：

- **工厂模式（Factory）**：`createRegexScript()` 成为酒馆正则 13 字段结构的唯一构造点，字段顺序（即产物 JSON 键序）以注释显式声明为格式契约。
- **单一职责（SRP）**：PNG 编解码从两个业务脚本中抽离为纯函数库 `png-card.mjs`（`parseChunks / serializeChunks / readTextChunks / replaceTextChunks / decodeCardPayload / encodeCardPayload`），入口脚本只剩业务编排。
- **依赖注入（配置层面）**：所有项目外路径（酒馆目录、角色卡名、手动导入目录）经 `.env` / 进程环境变量注入，`dotenv` 不覆盖已有环境变量，天然兼容 CI 注入优先。
- **KISS**：入口脚本保持顺序化、可从上往下读的流程；未引入 Vite/Webpack 等重型工具（打包目标是"无构建产物依赖的单文件 HTML"，自研 66 模块拓扑排序打包器仍是该场景最简方案）。
- **竞态修复**：watch 模式改为「防抖 + 构建期间变更重新排队（`rebuildQueued`）」，保证任何一次保存都不会被静默丢弃。

## 4. 性能与复杂度对比 (Performance & Complexity Metrics)

本次重构以正确性与可维护性为主，算法复杂度维持在合理量级、无回归：

| 维度 | 重构前 | 重构后 | 说明 |
|------|--------|--------|------|
| 依赖图构建/拓扑排序 | O(V+E) | O(V+E) | 保持不变（66 个模块，毫秒级） |
| PNG chunk 解析 | O(n)，`Buffer.slice`（旧 API，含废弃告警语义） | O(n)，`Buffer.subarray` 零拷贝视图 | 语义等价，`subarray` 是官方推荐替代 |
| CRC32 | 纯 JS 逐位循环，O(8n) 位运算 | `node:zlib.crc32`（原生实现） | 对 2MB+ 卡数据从 JS 循环降为原生调用，纯计算部分约快一个数量级（该路径非瓶颈，属顺带收益） |
| watch 丢失更新 | 构建窗口内变更可能永久丢失 | 排队重建，最终一致 | 正确性修复 |
| 打包产物体积 | 2.10 MB | 2.10 MB（逐字节一致） | 无回归 |

## 5. 依赖与语法更新 (Dependency & Syntax Migration)

**零新增第三方依赖**（`dotenv` 复用后端既有依赖）。语法/API 迁移清单：

| 旧写法 | 新写法 | 动机 |
|--------|--------|------|
| `require()` / `.cjs` | ESM `import` / `.mjs` | 与 `"type": "module"` 项目统一，可复用共享库 |
| `import fs from 'fs'` | `import fs from 'node:fs'` 前缀 | Node 官方推荐，防止被同名 npm 包劫持 |
| 手写 `crc32()` ×2 | `node:zlib.crc32`（Node ≥ 20.15） | 删除重复实现，原生性能 |
| `Buffer.slice()` | `Buffer.subarray()` | `slice` 在 Buffer 上已属遗留 API |
| `execSync('node "…"')` 字符串拼接 | `execFileSync(process.execPath, [script])` | 参数数组不经 shell 解释，路径安全 |
| `if (!x) x = {}` | `x ??= {}` 逻辑空赋值 | 现代语法糖，意图更明确 |
| `fs.readFileSync`（一次性脚本） | `node:fs/promises` + `async/await`（build-regex / sync-to-card） | 统一异常流；bundle.mjs 有意保留同步 I/O（单遍 CPU 密集型构建，异步无收益，KISS） |
| 裸 `console.log` 封装 ×N | `lib/logger.mjs`（错误走 stderr） | CI/管道可正确分流日志级别 |
| 类型缺失 | 全量 JSDoc 类型标注（`@param/@returns/@typedef`） | 在不引入 TS 构建链的前提下获得 IDE 类型检查（路线图第 5 节的全面 TS 化另行推进） |

**npm scripts 补全**：新增 `npm run sync-card`、`npm run watch`，四个工具链入口全部可通过 npm 调用。
**`.env.example` 补全**：`TAVERN_DIR`、`TAVERN_CARD_NAME`、`MANUAL_EXPORT_DIR`、`SYNC_TO_PNG` 四个新变量均有注释说明。

## 6. 边界测试与防坑指南 (Edge Cases & Fallbacks)

### 已验证的边界情况（本次实测）

| 场景 | 行为 |
|------|------|
| `dist/naruto-rpg-bundle.html` 不存在时运行 build-regex | 明确报错「请先运行 npm run bundle」，exit 1 |
| 角色卡 PNG 不存在 | 明确报错并提示可用 `TAVERN_DIR` 配置，exit 1（watch 模式仅告警不中断监听） |
| 非 PNG 文件冒充角色卡 | 「不是有效的 PNG 文件（签名不匹配）」，exit 1 |
| 被截断/损坏的 PNG | 「chunk 数据越界，文件可能被截断」，exit 1 —— 旧代码此处会静默读出脏数据 |
| ccv3 为 base64(JSON) 或明文 JSON | 双路解码兜底保留（历史卡兼容） |
| 卡上存在其他正则脚本 | watch 模式原地更新「忍者手记」脚本、**保留其他脚本**；sync-card 模式**整体重建只留一条**（两者语义不同是历史既有设计，已在脚本头注释中显式声明） |
| 构建期间连续保存文件 | 变更排队，构建结束后自动再跑一轮，不丢失 |
| 输出产物一致性 | bundle HTML SHA-256 与重构前逐字节一致；regex JSON 除随机 `id` (UUID) 外逐字节一致 |

### 保留的“怪异逻辑”与疑问（未盲目删除，待原作者确认）

1. **`chara` chunk 写明文 JSON**：watch 模式历史行为是 `ccv3` 写 base64、`chara` 写**明文 JSON**。按 Character Card V2 规范 `chara` 通常也应为 base64。已原样保留（一致性优先于“看起来正确”），但疑似 bug —— 若酒馆读取 `chara` 失败，此处是第一嫌疑。
2. **两种卡同步语义并存**：`sync-card`（整体重建、清空其他正则）vs `watch`（增量更新、保留其他正则）。推测前者用于“发版重置”、后者用于开发迭代，已在两个脚本头部注释中互相引用说明；若可统一请明确取舍。
3. **`bundle.mjs` 中 CSS import 内联分支**：当前 `js/` 下没有任何 `import styles from './x.css'` 用法，该分支是死代码；但属于对未来组件化写法的防御性支持，予以保留并加注说明。
4. **产物 HTML 模板中含两处行尾空格**：为保证逐字节兼容而刻意保留（`generateHTML` 模板内），后续若确认下游不做 hash 校验可清理。
5. **正则触发词 `起物` / `(起物)` 与 `placement` 值**：`placement: [1]`=用户输入、`[2]`=AI 输出，为酒馆的枚举契约，不可改动。

### 后续维护防坑事项

- **不要调整 `createRegexScript` 的字段顺序** —— 键序即产物 JSON 的文件格式，下游可能按文本 diff 追踪。
- **产物文件名（含中文）是外部契约**：`regex-正文-火影忍者-起物单文件版.json` 等文件名被酒馆导入流程与角色卡引用，改名即断。
- **`node:zlib.crc32` 要求 Node ≥ 20.15 / ≥ 22.2**；本项目开发环境为 Node 24。若需支持更老 Node，需在 `png-card.mjs` 内补 JS 回退实现。
- **新增项目外路径时一律走 `project-paths.mjs` + 环境变量**，禁止在入口脚本中写死路径（本次重构的核心红线）。
- **遗留技术债（超出本票范围，建议另开票）**：`deploy.sh` 中硬编码服务器 IP（`root@8.162.24.147`）与域名；`一键打包.bat` 中硬编码的 Windows Node 路径探测；路线图第 2–5 节（LLM 结构化输出、DOMPurify、快照增量存储、TypeScript 化）。
