# V0.1 开发工作记录（待 Windows 实机验收）

**对象**：Superpowers Native；原始实施计划位于 `docs/superpowers/plans/2026-10-08-phase-1-offline-desktop-implementation.md`。本开发分支不代表全部 12 项计划均已完成验收。

## 实际实现
- 单机 Electron + React Windows 桌面 UI 源码、preload 白名单、安全导航与 IPC 验证；main-frame 校验、CDP URL 在 renderer 不暴露 WebSocket 调试端点。
- Windows 安装/单文件便携/完整 ZIP 三模式路径策略、SQLite schema v1。
- 文件导入、文件夹递归、AST 静态 DOM selector/语法分析、Unicode、逐份失败隔离、运行时未知标识。
- JSON/Markdown 离线报告、无源码运行的命令行分析、原件 hash 一致性回归。
- 用户明确选择 Chrome EXE 后，启动 localhost:9223 CDP 并做 /json/version + /json/list 握手；页面身份、真实 DOM 与脚本经理功能尚不能验收。
- 实验性 literal-only 补丁引擎：单个静态调用、人工新旧 selector、显式批准、hash 保护、保留原件、管理区 immutable 备份/修订。未向用户界面开放、尚未实现自动探测匹配。
- Windows 三目标打包配置与 GitHub Actions 草案；Windows 环境编译、三包独立启动和数据迁移**尚无实测**。

## TDD 与证据边界
- 子模块在各任务编写实现前先建立失败测试，再以最小代码实现。多次子系统 tests 和 `npm test` 已在本地 Linux Node22 运行。
- `node:sqlite` 在本地 Node22 输出实验性警告。不能用它替代 Electron44 的 Windows 实际 SQLite 验证。
- 本地不能访问 npm registry，因此 `npm install` / `npm ci`、正式 Electron GUI / esbuild build、全量 TypeScript 类型检查、真实 Windows EXE/ZIP 启动均仍需外部环境；有脚本不等于已生成可用安装包。
- 原 Task1 在 GitHub Node24 的 CI 通过，但不等于本分支其他新代码经过 CI。
- **重要未满足**：本预览保留原 Task1 的 `package-lock.json`，由于增加依赖，需要重新执行 `npm install` 生成并提交锁文件，随后以 `npm ci` 验证。未完成之前不能标为 Stable 或公开提供已验证 EXE。

## Self review（Native，无独立 reviewer）
- 修复：IPC 只允许 mainFrame，拒绝非受信任 frame；RED→GREEN 测试覆盖。
- 修复：CDP status 只向 renderer 暴露浏览器品牌/协议与目标 id/url，不泄露 browserSocket/page debuggerSocket；RED→GREEN 测试覆盖。
- 拒绝将“静态解析通过”映射到任何 V1..V4 业务验证状态。
- 阶段风险：用户当前 Chrome 与打开的 localhost:9223 可能不是相同进程；界面明确该握手**无法证明浏览器身份**，真实 CDP 动态写操作因身份不确定必须禁止。
- 阶段风险：拖放从 Electron preload `webUtils.getPathForFile()` 获取真实文件路径，但完整授权/导航/隔离仍需 Windows E2E 与威胁模型独立审查。
- 阶段风险：断点后续 Node/npm/Electron 自动更新可能改变 Windows10 可用性；版本应冻结后做三种包验证。

## 计划后续缺口
- 连接真实 DOMSnapshot、iframe/shadow root 支持、环境隔离下的 Userscript/Tampermonkey V4 探针。
- 自动生成的 selector repair candidate 多候选评分、批准与功能测试、一键回滚、共享兼容层、BYO AI、健康检查。
- 完整 IPC 安全负例、ZIP 打包与安装/更新 smoke、可信构建供应链校验。

以上不设定已验证通过的发布时间或完成百分比。

## Alpha.4 新证据补充（2026-10-08）
- 已用 TDD 新增 DOMSnapshot 文档数、节点数的只读取证；CDP DOM.querySelectorAll 测当前主 document 静态定位器，返回 found/missing/ambiguous/blocked/unverified。GUI 允许选择目标网页、脚本、提交一次性页面探针；不会读取返回网页敏感文本，不执行真实脚本。
- 已用 TDD 新增 GUI 的人工预览、明确批准、受管副本保存 workflow，防 stale source hash 冲突，原源文件不被覆盖。
- Windows CI 全部通过的 Alpha.3 运行：[Windows #37771109973](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37771109973)，并有源码测试、TypeScript、三版打包、ZIP EXE 启动创建 registry.sqlite 的真实成功证据。
- Alpha.4 的 Windows 启动冒烟已从 continue-on-error 改为硬性要求。CI 必须重新验证对应 commit，不能沿用 Alpha.3 结果。
- 尚未完成跨 iframe/shadow root、自动 selector 候选生成和评分、自动修复、业务功能 V3/V4、真实 Windows 10 用户机上的便携 Chrome、AI Provider、共享兼容层、健康巡检与 GUI 一键恢复。
