# 技术决策记录（ADR）、不可变约束、开放问题与官方参考

**USS-ADR-001｜v0.1.0-draft｜2026-10-08｜状态：提案，尚未获用户批准**

本文件记录为什么选择某条技术路径，以及被否决路线和将来改变条件；它不是已通过架构委员会或用户签署的决定。

## ADR-001：选择 Electron + TypeScript 单栈作为首发
**背景**：用户的核心工作负载包括 JS AST 解析、源码补丁、CDP WebSocket、批量队列和 Windows UI。选择同一语言减少服务接口跨语言拼接、打包 sidecar 与依赖同步。
- 方案 A（推荐）：Electron + React + TypeScript/Node，直接完成 AST/CDP 和 Windows UI。
- 方案 B：Tauri2 + TS + Rust/Node sidecar，安装体积可能更小但跨语言链复杂。
- 方案 C：.NET 原生 UI + Node JS 分析子进程，Windows UI 原生但技术栈/测试面扩大。
**约束**：即使 Electron 自带 Chromium，本程序的网页测试仍必须操作用户手动选中的**外部** Chrome，而非 Electron 浏览器窗口；需固定 Electron 安全设置和使用 lockfile。版本/Windows10 兼容需实现前复核。

## ADR-002：CDP 直连，而不是依赖 chrome-devtools-mcp
**决定**：应用直接实现本地 CDP transport/target/session/capability adapter。MCP 仅适合未来对外暴露“查询诊断/请求修复”接口，不增加为浏览器内部必需层。
**原因**：减少额外进程、协议封装、依赖和调用成本；原生 CDP 有 DOMSnapshot/Runtime/Target/Log 能力。
**代价**：产品需自行处理 PID/握手/协议兼容/断线与 UI 权限。

## ADR-003：默认不传 `--user-data-dir`，但不可承诺所有 Chrome 都能连
**用户约束（最高产品优先）**：默认只传 `--remote-debugging-port=9223`、`--remote-debugging-address=127.0.0.1`。
**外部事实**：Chrome 从 136 起改变正式版对默认 profile 的远程调试策略，默认数据目录不接受远程调试开关；建议 Chrome for Testing，用自定义数据目录隔离自动化。
**方案**：
1. 用户选一个真实 chrome.exe/portable launcher，应用按要求启动、握手验证。
2. 失败不静默新增参数，不试图突破 Chrome 安全限制。
3. 用户明确允许时可选择 Chrome for Testing 或隔离测试 profile 的“高级兼容模式”。隔离模式才显式增加指定 `--user-data-dir`（即这是**用户另行授权**而非默认行为）。
4. 产品应允许不接浏览器直接使用静态 AST 模式。
5. 即使是 portable 发行，也要实测真实 binary 与启动器的 profile 路径和命令行参数转发；文件名/目录结构不构成证明。
**风险**：如果坚持所有模式都禁用 `--user-data-dir` 且所选 Chrome 拒绝 CDP，动态功能无法保证可用。此时必须诚实报告 `blocked`。

## ADR-004：最小 patch + AST/Sourcemap，不对整份脚本自由重写
**选择**：保留原 bytes 及 metadata，仅修改有明确来源范围的 locator/包装器，代码 diff 强制审阅。动态构造或不确定作用域停止自动替换。
**原因**：避免 userscript 的 `@run-at`、`@grant`、注入时机、换行、编码和注释因整文件重写破坏。
**可替代**：AI 全文件重写，但默认为高风险，不作自动写入路径。

## ADR-005：修复可靠性优先于“修复成功率”
匹配一个 DOM 节点仅证明存在，不证明目标正确、事件工作或业务成功。报告 V0-V4，只有实际执行的合约测试可提升等级。无功能测试时不能宣称脚本已完全修复。

## ADR-006：备份先行与 managed-copy 默认
**决定**：默认不覆盖导入原文件，先生成托管副本。若原地写回经用户逐目录/逐操作批准，则先备份、hash compare-and-swap、原子替换和恢复。取消/失败不覆盖。
**原因**：批量修复的主要危险是“错误修复污染全部可用脚本”。

## ADR-007：共享兼容层显式依赖、版本锁定、渐进推广
**决定**：每个 site adapter 明确暴露语义 role 和版本；旧脚本通过人工/半自动迁移选择依赖；不假设隔离 worlds 可无条件共享 JS 对象。
**代价**：旧脚本首次迁移多一道工作，但长期能以一处修改修复多个脚本，且可追踪影响范围。

## ADR-008：AI Provider 必须 BYO、可禁用、本地优先
**选择**：支持 OpenAI-compatible Base URL + API Key + GET models + manual model ID；能力探测后再适配具体 API 形态。不强绑 OpenAI 或其他 vendor。
**原因**：符合用户成本控制/灵活选择模型的需求。
**限制**：不是任何 URL 都提供同样的请求协议、模型发现、结构化输出、tokens/cost 数据；必须提供 Adapter capability flags 和失败说明。

## ADR-009：先静态后动态，严格分离“检测”和“执行”
任何 `.user.js` 在 AST 阶段均不执行；真实网站执行需用户明确授权。不同的页面/扩展执行 world 和 `GM_*` 权限不能由普通 `Runtime.evaluate` 完整模拟。V4 需要真实 Userscript manager/probe 或明确人工验证。

## ADR-010：公共仓库只允许虚构 fixtures
严禁把真实已登录网站 DOM、用户聊天记录、session、API key、私人脚本（除非用户明确决定开源该脚本）、个人配置与受控诊断内容提交到公开 GitHub。测试可构造类似 ChatGPT UI 的虚构本地站点，禁止冒充官方网站。

## ADR-011：定位评分以证据和风险 gate 为准
候选分值只是优先级启发式，不是统计成功率。高分候选仍可能选错按钮；写入策略必须综合安全动作分级、契约、diff scope、hash 和人工批准。

## ADR-012：Windows 10 首发与安全支持风险并行管理
首期支持 Windows 10/11 x64 作为目标，但截至 2026-10，Windows 10 标准支持已经结束；可查询 ESU 适用性与期限。必须测试具体 Electron/Chrome 运行环境并记录限制，不能把“程序可以打开”说成操作系统受到标准安全维护。

## ADR-013：优先明确可靠性，而非一次性高并发
动态网页任务默认每 BrowserSession 1 项，静态解析可限额并发；网络超时/429/Chromium 崩溃不无限重试。保留任务队列与取消检查点，降低批量互相影响。

## ADR-014：MVP 不强制无头模式
**原因**：Tampermonkey 扩展、实际登录和 GUI 页面时序可能与 headless 不完全一致。首期以用户可见的 Chrome 真环境为主，headless 仅作为独立安全 fixture 的测试后端候选；不能把 headless 结果伪称为用户实际运行结果。

## ADR-015：不默认安装或修改 Tampermonkey 内部存储
在没有官方受支持管理 API 的情况下，不直接修改扩展本机 LevelDB/profile 数据库，也不承诺自动导入脚本。真实 manager 测试通过用户授权的 companion/手动导入/后续合规扩展接口完成，并明确权限与限制。

## ADR-016：不确定项全部强制标记
动态 selector、不可访问的 frame、未知执行 world、没有功能测试、身份未知的 CDP 连接、未知模型响应格式、未实测 Chrome 155 launcher，一律保留 `unknown/blocked/runtime_required/needs_secondary_verification`；禁止借助推测将其升级为事实。

## 需用户评审决策（不阻塞阅读本规划）
1. **架构**：是否接受 Electron + TS 单栈，允许较大的 EXE/安装包来降低维护成本？
2. **浏览器**：严格“不使用 `--user-data-dir`”是否仅为默认约束，还是即使特定 Chrome 无法连接也永不允许用户显式启用隔离 profile？
3. **测试**：首发把 Tampermonkey 实际 GM/V4 验收列为硬性 MVP 要求，还是允许先交付清楚标注 V0-V2 的基础版本？
4. **写入**：是否接受 managed-copy 默认，并通过“已确认安全写回”操作才修改原文件？
5. **公开仓库授权**：选择何种开源许可证（例如 MIT/Apache-2.0/GPL）或暂时保留无 LICENSE 状态？
6. **AI**：首发仅支持 OpenAI-compatible 接口还是同时开发 Ollama/LM Studio 专用适配器？
7. **兼容层**：是否愿意逐步迁移原脚本使用共享 role，接受一次性兼容层升级的依赖测试成本？

这些问题已有默认**建议**，但都不是已经征得用户批准的事实。用户可直接对文档批注后更新，之后再开始 Superpowers 逐任务 implementation plan。

## 官方核验资料（2026-10-08 检索）
- Chrome 136 remote debugging switches: https://developer.chrome.com/blog/remote-debugging-port/
- CDP Homepage/version discovery: https://chromedevtools.github.io/devtools-protocol/
- CDP DOM getDocument: https://chromedevtools.github.io/devtools-protocol/tot/DOM/
- CDP DOMSnapshot captureSnapshot: https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/
- CDP Runtime: https://chromedevtools.github.io/devtools-protocol/tot/Runtime/
- Tampermonkey documentation and execution API: https://www.tampermonkey.net/documentation.php
- Chrome userScripts isolated worlds: https://developer.chrome.com/docs/extensions/reference/api/userScripts/
- Windows 10 lifecycle: https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/windows-10-support-has-ended-on-october-14-2025

所有库的**具体版本号/许可证兼容、便携 Chrome 155 启动器行为**仍需在 Phase 0 二次核查与本机验收。
