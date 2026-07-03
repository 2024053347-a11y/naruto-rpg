# 项目代码优化与更新技术文档 — Node.js 服务端（server/）

> 范围：`server/` 全部 8 个模块（入口、配置、持久化层、认证中间件、Discord OAuth、云存档 API、音乐收藏 API、AI 代理）。
> 版本基线：`master` 分支 v2.0.0。
> 兼容性目标：对外 HTTP 契约 100% 向后兼容（两处经论证的语义修复除外，见 §6.2）。

---

## 1. 重构摘要 (Executive Summary)

本次重构将服务端持久化层从「同步阻塞 I/O + 忙等自旋」迁移为「全异步 + 按文件互斥 + 原子落盘」的架构，彻底消除了单个请求可冻结整个 Node.js 事件循环的致命缺陷，并修复了静默数据丢失、撕裂写入、失效的生产密钥校验等 4 处真实缺陷；同时通过仓储模式、认证内核提取与 OAuth 步骤分解消除了三处系统性代码重复，全部 21 个对外行为探针与旧实现逐字节一致。

## 2. 痛点与缺陷诊断 (Code Smell Analysis)

### 2.1 致命级：事件循环阻塞（Event-Loop Starvation）

旧 `server/db/index.js` 的读重试逻辑：

```js
// 遇到文件锁定或为空的情况，同步阻塞等待 50ms 后再试
const start = Date.now();
while (Date.now() - start < 50) {}
```

这是一个**忙等自旋锁（busy-wait spin lock）**：重试期间以 100% CPU 空转，且由于 Node.js 单线程模型，**整个进程在此期间无法处理任何其他请求**（最坏 5 × 50ms = 250ms 全局冻结/次读取）。叠加每个 API 请求都要 `readFileSync` 全量读盘 + `JSON.parse`，以及云存档路由对最高 200MB JSON 的 `zlib.gzipSync` 同步压缩，服务在真实负载下会出现雪崩式排队。

### 2.2 严重级：数据完整性缺陷

| 缺陷 | 位置（旧代码） | 后果 |
|---|---|---|
| 非原子写入（直接 `writeFileSync` 覆盖目标文件） | `writeJsonFile` | 进程崩溃/断电时产生空文件或半截 JSON（撕裂写）。读取侧专门写了「文件为空则重试」的防御，实质是在为自身写入缺陷打补丁 |
| 写入异常被吞掉（`catch` 后仅打日志） | `writeJsonFile` | **静默数据丢失**：磁盘满/权限错误时客户端仍收到「存档成功」 |
| 失效的密钥校验（dead check） | `config.js` | 校验的是 `'naruto-rpg-default-secret-key-12345'`，但实际默认值是 `'naruto-rpg-dev-only-not-for-production'` —— 生产环境使用默认 JWT 密钥时告警**永远不会触发** |
| 敏感信息泄露到日志 | `discord.js` state 校验失败分支 | `console.error('All cookies:', req.cookies)` 会把用户会话 JWT 完整打进日志 |

### 2.3 结构级：可维护性问题

- **重复代码（DRY 违规）**：三个认证中间件各自完整复制「提取令牌 → 验签 → 回查用户」流程；歌曲去重键 `f.url_id || f.mid || f.id` 出现 3 次；存档「测量体积 → 校验上限 → gzip」在 POST/PUT 重复；Cookie 安全属性在两处手写。
- **上帝函数（God Function）**：`/auth/discord/callback` 约 120 行内混杂 CSRF 校验、令牌交换、档案拉取、群组准入、落库、签发会话 6 种职责，每一步用「if 失败则 redirect」平铺，控制流难以追踪。
- **死代码**：`getDb()`（无任何调用方）、`BLOCKED_HOSTNAMES` 常量（定义后从未使用）、`staticLimiter`（定义后从未挂载——见 §6.4 疑问清单）。
- **魔法数字/字符串**：`50`（槽名截断）、`100`（收藏上限）、`7 * 24 * 60 * 60 * 1000`、`'naruto_token'` 散落各处。
- **撒谎的注释**：「保存/更新用户到 SQLite」——实际是 JSON 文件存储。
- **运维缺口**：无优雅停机（SIGTERM 直接掐断在途请求）、`app.listen` 无错误处理（端口占用时静默异常）、格式错误的 JSON body 返回 500 而非 400。
- **资源泄漏风险**：AI 代理 SSE 转发中客户端断开后，上游 fetch 连接不会被取消，长文本生成会持续占用上游连接并计费。

## 3. 架构与模式升级 (Architecture & Pattern Updates)

### 3.1 持久化层分层：通用存储引擎 + 领域仓储（Repository Pattern）

```
server/db/
├── json-store.js   ← 新增：通用 JSON 文件存储引擎（机制）
└── index.js        ← 重写：用户/存档/收藏三个领域仓储（策略）
```

`json-store.js` 只负责**机制**（读缓存、原子写、互斥事务），`index.js` 只负责**领域语义**（upsert 保留 `created_at`、收藏上限淘汰等），符合单一职责原则；上层路由通过仓储函数访问数据，不再感知文件布局。

### 3.2 并发正确性：按文件互斥队列（Per-File Mutex）

`updateJsonFile(file, default, mutate)` 把所有「读-改-写」包进按文件路径串行化的 promise 链：

```js
const current = previous.then(task, task); // 前序失败也不阻塞队列
```

**为什么必须要**：旧同步实现靠「阻塞整个进程」获得了隐式原子性；异步化后两个并发请求会交错执行读-改-写并互相覆盖（丢失更新，Lost Update）。互斥队列以显式、局部（仅同文件互斥，不同文件仍并行）的方式恢复原子性。实测 10 个并发收藏写入 0 丢失。

### 3.3 崩溃一致性：临时文件 + rename 原子落盘

`writeFileAtomic` 先写同目录 `.<name>.<pid>.tmp` 再 `rename` 覆盖。同一文件系统内 rename 是原子操作，读取方**永远**不会观察到半截文件——从根源上消灭了旧代码「空文件重试」所防御的问题（该防御仍保留，防外部脚本非原子写入，见 §6.3）。二进制存档 `.bin` 同样走原子写。

### 3.4 读路径：Cache-Aside + mtime/size 失效

解析缓存以 `stat` 的 `mtimeMs + size` 为一致性凭据：命中时零磁盘 I/O、零 JSON.parse；外部进程直接改文件会自动失效。返回 `structuredClone` 深拷贝，杜绝调用方误改缓存造成的幽灵状态。

### 3.5 认证内核提取：判定与响应策略分离

三个中间件收敛到唯一的 `authenticateRequest(req)` 内核，返回判别式结果（`ok / missing_token / unknown_user / invalid_token`）；各中间件只保留**响应策略**（API 回 401 JSON、页面回 302 重定向、optional 静默放行）。新增鉴权场景时只需写一个新的策略映射。

### 3.6 OAuth 回调分解：步骤函数 + 类型化异常

回调重构为 5 个单一职责步骤（`exchangeCodeForToken` → `fetchDiscordProfile` → `fetchUserGuilds` → `ensureGuildMembership` → `issueSessionCookie`），可预期失败统一抛 `OAuthFlowError(redirectCode)`，由回调唯一的 catch 转换为登录页重定向；未知异常兜底为 `server_error`，不泄露内部细节。主流程从 120 行嵌套 if 变为 8 行线性代码。

### 3.7 其他

- `createRateLimiter(max, message)` 工厂函数消除三段重复的限流配置。
- `config` 经 `deepFreeze` 冻结为不可变对象，杜绝运行期被意外篡改。
- AI 代理引入 `AbortController`：客户端断开且响应未完成时立即中止上游请求。
- 常量收编：`AUTH_COOKIE_NAME` 由中间件导出、OAuth 模块复用，消除跨文件魔法字符串。

## 4. 性能与复杂度对比 (Performance & Complexity Metrics)

诚实声明：文件型存储的渐进复杂度（单文件全量序列化，O(N)）本次未改变——改变存储引擎超出「保持 100% 兼容」的边界。本次改善的是**常数因子、并发吞吐与正确性**：

| 维度 | 旧实现 | 新实现 |
|---|---|---|
| 读重试等待 | 同步自旋，100% CPU，**冻结全进程**（最坏 250ms） | `await sleep(50)`，事件循环期间照常服务其他请求 |
| 每次数据读取 | 必然全量磁盘读 + `JSON.parse`，O(文件大小) 盘 I/O | 缓存命中时仅 1 次 `stat`（微秒级）+ 内存克隆，**零盘 I/O、零 parse** |
| 存档压缩/解压（最大 200MB JSON） | `gzipSync` 在主线程执行，10MB 存档期间全站无响应 | `promisify(zlib.gzip)` 走 libuv 线程池，主线程保持响应 |
| 并发写同一文件 | 依赖同步阻塞获得隐式原子性（以全局冻结为代价） | 按文件互斥，不同文件并行；实测 10 并发写 0 丢失 |
| 崩溃时数据文件 | 可能为空/半截（需人工修复） | rename 原子性保证永远是完整旧版或完整新版 |
| SSE 代理客户端断开 | 上游连接继续传输直至生成完毕（浪费上游配额） | 立即 abort 上游连接 |
| `getUserSaveCount` | 与 `getUserSaves` 重复一份 filter 逻辑 | 复用 `getUserSaves`（复杂度同为 O(n)，消除重复） |

空间方面：缓存以「每个 JSON 数据文件一份解析副本」换读性能，三个元数据文件（用户、索引、收藏）均为 KB～MB 级，代价可控；存档正文 `.bin` 不进缓存。

## 5. 依赖与语法更新 (Dependency & Syntax Migration)

**零新增第三方依赖**——全部改造使用 Node.js ≥ 18 内置能力（项目实际运行于 Node 24）：

| 旧写法 | 新写法 |
|---|---|
| `import fs from 'fs'` + `readFileSync/writeFileSync/existsSync` | `import fs from 'node:fs/promises'` + `await fs.readFile/stat/rename`（`node:` 前缀显式标记内置模块，防依赖混淆攻击） |
| 忙等 `while (Date.now() - start < 50) {}` | `import { setTimeout as sleep } from 'node:timers/promises'` |
| `zlib.gzipSync / gunzipSync` | `promisify(zlib.gzip / gunzip)`（线程池异步） |
| `existsSync` 后再读（TOCTOU 竞态窗口） | 直接操作 + 捕获 `err.code === 'ENOENT'` |
| 手写 JSON 深拷贝需求（旧代码干脆共享引用） | `structuredClone()` |
| `authHeader && authHeader.startsWith(...)`、`x \|\| y` 兜底 | 可选链 `?.`、空值合并 `??`（`0`/`''` 不再被误判为空） |
| `reader.getReader()` + 手写 `while(true)` 读循环 | `for await (const chunk of upstreamResponse.body)`（Web Stream 异步迭代） |
| 无 | `AbortController` / `signal` 取消上游 fetch |
| 回调式启动，`initDb()` 同步假设 | ESM 顶层 `await initDb()`，失败即 `process.exit(1)` 快速失败 |
| `parseInt(x \|\| '1', 10)`（`NaN` 直接进配置） | `Number.parseInt` + `Number.isNaN` 守卫，非法值回退默认 |
| 两段重复的 `app.get('/')` / `app.get('/index.html')` | Express 数组路径 `app.get(['/', '/index.html'], ...)` |
| 可变的全局 `config` 对象 | `deepFreeze(config)` 不可变配置 |

类型提示采用 **JSDoc**（`@param` / `@returns` / `@typedef SaveMeta` / 判别式联合返回值），在不引入 TypeScript 构建链的前提下获得 IDE 类型检查与补全——对本项目「无构建直跑」的部署方式（`node server/index.js`）是刻意的 KISS 取舍。

## 6. 边界测试与防坑指南 (Edge Cases & Fallbacks)

### 6.1 已验证的边界（21 项行为探针 + 专项测试，新旧响应逐字节对比）

- 存档 CRUD 全链路：创建 → gzip 落盘 → 下载解压还原（含中文与嵌套结构）→ 覆盖更新 → 删除；
- 槽位上限（第 6 个存档返回历史原文 400 文案）、体积上限（`存档过大！…当前为 11.44MB` 文案含精确体积）、槽名 50 字符截断（响应回显原名、落库为截断名——与旧实现一致）；
- 存档 ID 白名单校验（路径穿越注入返回 400）、越权访问（404/403 与三种历史文案一一对应）;
- 认证矩阵：无令牌 401 / 伪造令牌 401 + 清 Cookie / 有效 JWT 但用户不存在 401 / 页面访问 302 至 `/login.html(?error=session_expired)` / 重定向携带完整 no-cache 头（防 CDN 无限重定向的历史防御，原样保留）；
- OAuth 入口：state Cookie（HttpOnly + SameSite=Lax + 10 分钟）与授权 URL 参数与旧版完全一致；
- AI 代理：缺头 400/401、HTTP 目标 403、内网目标 403、畸形 URL 400、真实上游（Anthropic API）状态码与响应体透传；
- 并发：10 个并发收藏写入全部持久化（旧异步化方案会丢失更新）；
- 运维：SIGTERM 优雅退出、404 兜底、AUTH_BYPASS 开发旁路。

### 6.2 两处刻意的行为差异（语义修复，需周知前端）

| 场景 | 旧 | 新 | 理由 |
|---|---|---|---|
| 请求体不是合法 JSON | 500 `服务器内部错误` | **400** `请求体不是有效的 JSON` | 客户端错误不应伪装成服务端故障 |
| 请求体超过 200MB | 500 | **413** `请求体过大` | 同上，且 413 是该场景的标准语义 |

另有一处**故障路径**差异：磁盘写入失败（磁盘满/权限）旧版静默返回成功，新版抛错返回 500——这是数据安全修复，正常路径无感知。

### 6.3 保留的「怪异」防御性代码（请勿删除）

- **读空文件重试（5 次 × 50ms）**：本服务自身已原子写入，但部署脚本等外部进程仍可能非原子地覆盖数据文件，保留作为最后防线。
- **`AUTH_BYPASS` 每请求读取 `process.env`** 而非启动时快照：保留旧语义（进程内可动态开关，测试友好）。
- **`optionalAuth` 不受 `AUTH_BYPASS` 影响**：旧实现如此（疑似有意区分「解析用户」与「强制放行」），原样保留。当前无调用方，但作为导出 API 留存。
- **Guild ID 占位符旁路**：`your_discord_server_id_here` 等模板占位符视为「未配置校验」，服务开源本地部署依赖此行为。
- **200MB JSON body 上限**：历史决策（超大存档直接走 JSON 上传，见 `v2.1_server_update_guide.md`），未收紧。

### 6.4 疑问清单（请原作者确认）

1. **`staticLimiter`（600 次/分钟）定义后从未挂载**，静态资源实际不限流。本次为保持行为一致未启用，仅在 `server/index.js` 留注释说明。是否应挂到 `express.static` 之前？
2. `.env.example` 中 `MAX_SAVE_SLOTS=5`，而代码默认值为 `1`——两者不一致是否有意？（未改动）
3. AI 代理的 SSRF 防护是**主机名字面量判断**，不做 DNS 解析：解析到内网 IP 的公网域名（DNS Rebinding）不在防护范围。维持旧行为，如需加固建议在 fetch 层用自定义 lookup 校验解析结果。

### 6.5 后续维护防坑事项

- **单进程假设**：互斥锁与解析缓存都是**进程内**的。严禁直接跑 PM2 cluster / 多实例共享同一 `server/db/` 目录——那需要跨进程文件锁或迁移到真数据库（SQLite/Postgres）。
- **`updateJsonFile` 的 mutate 必须原地修改**传入对象（写盘写的是该对象本身），返回值仅用于透传给调用方，不要在 mutate 里替换整个根对象引用。
- **PUT/DELETE 存档仍会读取整个 `.bin`**：这是为保留「索引存在但正文缺失 → 404」的历史语义。若未来存档体积普遍偏大，可增加 `getSaveMetaById`（仅查索引）优化，但需先决策上述语义是否可变。
- **`server/db/saves/` 与 `.tmp` 已加入 `.gitignore`**：运行期二进制存档与原子写临时文件不应入库。
- 新增 JSON 数据文件时，请一律通过 `json-store.js` 的 `readJsonFile / updateJsonFile` 访问，不要绕过互斥层直接 `fs.writeFile`。

---

*重构与验证：Claude（2026-07-03）。验证方法：新旧服务器各启动一次，以相同的 21 项 curl 探针脚本对比响应（状态码 + 响应体逐字节 diff），另附并发写入、gzip 往返、优雅停机专项测试。*
