# 更新日志

## [v2.1.0] — 2026-07-02

### 新增
- **测试环境**：`https://www.qiwu.asia:8080/` 独立测试站，SSL 加密，与正式站共用后端
- **一键部署脚本** `deploy.sh`：`bash deploy.sh` 测试站，`bash deploy.sh production` 正式站
- 自动版本号（每次部署生成唯一 `?v=` 参数，CDN/浏览器缓存强制刷新）

### 修复
- **云存档上传失败**：文件路径部署 bug 修复
- **个人中心面板不更新**：`public/js/` 文件未正确提升到 Web 根目录
- **413 Request Entity Too Large**：Nginx `client_max_body_size` 提升到 200m
- **国产浏览器 SSL 兼容**：添加 TLSv1.1 + 更多加密套件
- **API 请求超时**：`/api/ai-proxy` 超时从 60s 提升到 300s，关闭 buffering

### 优化
- 云存档容量提升：单档最大 200MB
- Discord 登录代理优化（Cloudflare Worker）
- Service Worker v8 网络优先策略 + 自动检测更新
- 登录页缓存控制（no-store），修复新用户登录循环跳转

---

## [v1.2.0] — 2026-06-24

### 新增
- **CSS 组件模块化**：将大型 CSS 拆分为独立组件（combat-arena、hud、panel、settings-panel、timeline-navigator、worldbook-editor），每个模块使用 CSS-in-JS 管理样式
- **sync-to-card 脚本**：支持将时间线数据同步至外置存储卡
- 添加 `nomodule` 降级提示，对不支持 ES Module 的浏览器友好提示升级

### 修复
- 修复 favicon data URI 中的非法字符导致部分浏览器（vivo 等国产浏览器）页面解析失败
- 修复 DNS 轮询问题：删除阿里云 DNS 中指向假 IP (`10.10.10.10`) 的冗余 A 记录

### 优化
- **核心引擎**：ai-client、pipeline、state-manager、instruction-parser 逻辑优化
- **世界书数据**：角色、时间线、博人传时代、地点组织、系统设定等条目扩展
- **游戏系统**：关系系统、世界状态系统逻辑优化
- **UI 组件**：app-shell、角色创建、战斗竞技场、地图弹窗、设置面板等改进
- **构建脚本**：bundle.mjs、build-regex.mjs 优化

### 工程
- 添加 `.gitignore` 排除规则（临时文件、构建产物）
- 添加 `docs/technical_refactoring_roadmap.md` 技术重构路线图

---

## [v1.1.0] — 2026-06-21

### 新增
- 添加 README.md 项目文档

### 优化
- UI 组件重构（app-shell、settings-panel 等）
- 核心逻辑优化（pipeline、ai-client）
- 知识库数据扩展
- 添加 package.json 和开发脚本（watch-and-sync）
- 1Panel + Docker 部署就绪

---

## [v1.0.0] — 2026-06-03

### 首次提交
- 火影忍者世界观 AI 单人文字跑团 PWA 游戏
- 多智能体叙事管道（GM + 头脑风暴 + 大纲 + 审查 + 写作 + 角色代理）
- 完整 RPG 系统：属性、战斗、任务、人际关系、记忆、时间线
- 角色创建系统（忍村、查克拉属性、属性分配）
- 火影世界观知识库
- PWA 支持（Service Worker + Manifest）
- 移动端响应式适配
