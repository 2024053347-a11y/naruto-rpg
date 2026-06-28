# 系统架构与工程规范重构路线图 (Technical Refactoring Roadmap)

## 概述
本阶段重构旨在解决项目在快速迭代期累积的技术债。当前系统在工程规范、大模型解析机制、前端安全、存储性能以及状态管理架构上存在显著缺陷，这些问题严重限制了项目的可维护性、可扩展性以及部署至生产环境的可能性。

本文档将上述痛点划分为五个核心维度，并提供明确的重构方案。

---

## 1. 工程规范与开发工作流治理 (Engineering Practices)

### 现状痛点
- **零碎的补丁脚本**：根目录堆积了大量 `fix.js`、`fix_dollars.js`、`temp.js` 等一次性脚本，用于通过“正则表达式”去强行查找替换并修改源码。这完全绕过了正常的代码维护逻辑。
- **硬编码绝对路径**：代码中大量残留 `D:/Downloads/...` 这种个人开发机的绝对路径，毫无代码可移植性 (Portability) 可言。

### 优化方案
1. **清理冗余脚本**：立即归档并删除所有一次性的 Node 补丁脚本。
2. **引入现代构建工具链**：引入 Vite 或 Webpack，建立标准的模块化打包流程。
3. **环境变量机制**：引入 `dotenv`，彻底消除项目中的本地绝对路径。所有涉及本地文件系统的操作或 API Endpoints，必须通过环境变量（如 `.env.development`、`.env.production`）注入。
4. **规范化重构流**：禁止编写“正则批量修改源码脚本”来修 Bug。重构必须依赖 IDE（如 VSCode 的 AST 语法树重构功能）或依靠 Git 分支管理进行代码溯源和修改。

---

## 2. 大模型解析机制升级 (LLM Parsing Mechanism)

### 现状痛点
- **脆弱的正则提取**：在 `instructionParser.js` 中，高度依赖正则表达式（如 `/<variable>([\s\S]*?)<\/variable>/g`）来从大模型返回的复杂文本中强行“抠”出 XML 标签内的 JSON，然后再 `JSON.parse`。
- 一旦大模型输出包含 Markdown 语法干扰、未闭合的标签、或是因为 Token 限制被截断，整个系统直接崩溃。手写的 `_rescueTruncatedJSON` 更是治标不治本。

### 优化方案
1. **拥抱 Structured Outputs (结构化输出)**：抛弃“让模型输出混合文本再通过正则去解析”的落后方式。针对 OpenAI / Claude 等现代模型，应直接启用官方的 **JSON Mode** 或 **Structured Outputs (如 JSON Schema)** 功能。
2. **强制类型契约**：要求大模型仅返回严格的 JSON 对象结构（例如包含 `narrative` 字段用于正文，`variables` 字段用于数值变更）。
3. **AST 级流式容错解析**：引入类似 `partial-json` 或 `zod` 的成熟解析库，即使模型输出流被打断，也能安全解析和验证局部 JSON 结构。

---

## 3. 安全架构与合规化改造 (Security & Compliance)

### 现状痛点
- **API Key 裸奔**：`ai-client.js` 直接在前端浏览器发起 Fetch 请求调用大模型，并要求用户将 API Key 存在 `localStorage` 中。如果在公网生产环境部署，API 密钥分分钟被盗刷。
- **自制“玩具级” XSS 过滤**：`app-shell.js` 中试图手写正则过滤 `javascript:`、`expression` 等属性以防注入。这种自制的安全网极易被混淆攻击绕过。

### 优化方案
1. **BFF (Backend For Frontend) 代理层**：彻底废除前端直连大模型的代码。引入一层极轻量级的 Node.js / Go 后端服务作为 Gateway（例如 Serverless Function）。前端将用户输入发给后端，由后端携带严格保管在服务器环境变量中的 API Key 与大模型交互。
2. **专业 Sanitizer 净化**：废弃手写的 `_unescapeSafeHtml` 等简易逻辑。强制引入业界标准库 **`DOMPurify`**。所有需要渲染到页面的大模型生成文本，在转为 HTML 后必须无条件穿过 `DOMPurify` 的净化。

---

## 4. 存储与内存性能优化 (Storage & Performance)

### 现状痛点
- **快照膨胀 (State Snapshot Bloat)**：`timeline-system.js` 每个回合都要调 `stateManager.snapshot()` 把包含整个世界状态、海量 NPC 历史、物品栏的巨大状态树直接塞入 IndexedDB，这会随游戏时长造成极其严重的存储暴增和 UI 掉帧。
- **LocalStorage 滥用**：强行将用户自定义背景图的庞大 Base64 字符串塞入 `localStorage`，轻而易举就会突破浏览器 5MB 的硬性限制并抛出 `QuotaExceededError` 导致游戏崩溃。

### 优化方案
1. **事件溯源存储 (Event Sourcing / Delta Storage)**：不再每回合存储“全量快照”。回合记录应当只保存该回合发生的**增量操作 (Delta/Diff)** 或用户的 Input，仅在特定的里程碑回合（如每 20 回合或章节结束）执行一次全量快照。
2. **介质职责分离**：
   - **LocalStorage**：仅用于存储 `ui_prefs`（例如音量、字体大小、主题模式）等轻量级文本配置。
   - **IndexedDB**：重构背景图等大文件存储，将大型 Base64 字符串或 Blob 二进制流放入 IndexedDB。

---

## 5. 类型安全与组件架构重构 (Type Safety & Architecture)

### 现状痛点
- **徒手捏弱类型 Redux**：`state-manager.js` 手搓了一个庞大的状态树，充斥着 `set`, `add`, `push`。最大的灾难是靠**纯字符串路径**（如 `'player.rank'`）去寻址，拼写错误（如错拼成 `'player.ranck'`）在运行时毫无报错，追踪极度困难。
- **视图与样式严重耦合**：像 `panel.js`、`hud.js` 等文件里，数百行的原生 CSS 样式被强行塞进 JS 模板字符串里。代码极其臃肿，样式无法复用，浏览器解析性能低下。

### 优化方案
1. **全面引入 TypeScript (重中之重)**：
   - 将纯 JavaScript 项目迁移至 TypeScript。
   - 为状态树定义严格的接口（Interfaces / Types）。
   - 实现路径字符串的安全推导（如使用类似 `Path<T>` 的泛型魔法或直接更换架构），让 IDE 能在编译期就捕捉到错误的寻址。
2. **引入标准状态管理库**：废弃手搓的状态分发器，引入如 **Zustand** 或 **Redux Toolkit** 等成熟轻量的状态容器，提升状态更新的可靠性与 DevTools 的可调试性。
3. **组件化分离**：剥离所有 JS 中的内联 `<style>`。将样式抽取为独立的 `.css` 文件（可配合 CSS Modules）或引入 **Tailwind CSS** 等实用类框架，实现 UI 逻辑与视觉表现的彻底解耦。
