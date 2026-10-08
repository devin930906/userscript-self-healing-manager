# Superpowers Native Continuation Ledger · 2026-10-08

> 工作分支：`feat/v01-continuation`；仓库：`devin930906/userscript-self-healing-manager`。本账本记录真实 RED→GREEN 回归、安全决策和未实现边界；不等于整个自愈系统已经完成。

## Rule / Ruling

1. **Ruling：发布门禁优先于速度** — 用户明确不需要阶段性预览安装包：`.github/workflows/windows-build.yml` 从 push 自动打包改为 `workflow_dispatch`；`.github/workflows/dev-ci.yml` 为 push/PR 运行 `npm ci → npm test → typecheck → build`，不上传二进制。
2. **Ruling：真实 OS 文件拖放授权只能来自可信事件** — 原 Renderer 可调用 `grantDroppedFiles(files)` 暴露越权授权能力；改为 preload 捕获 `event.isTrusted` 的 OS 文件 drop，再通过固定 IPC 路径递交，页面只能监听经过 Main 进程校验的授权结果。
3. **Ruling：脚本匹配限制 fail closed** — 无法解析 `@exclude`、`@exclude-match` 时返回 unknown，阻止错误进入跨站 DOM 修复分析。
4. **Ruling：localhost 并不等于任意端口** — 所有 CDP WebSocket 端点都必须与配置的调试 port、page id、route 一致，拒绝 localhost 其他端口重定向。
5. **Ruling：受管 current 文件不代表可覆盖** — 当前受管副本如果被外部修改而未归档，或者是 symlink，恢复操作必须拒绝覆盖以保留用户改动。
6. **Ruling：Chrome 136+ 默认 profile 不可用于远程调试时，须由用户显式启动独立 profile** — 新增“启动隔离调试 Chrome”，持久 Data/Chrome-CDP-Profile；不复制原账号、扩展、Cookie 和默认配置。
7. **Ruling：旧 selector 在源码里出现多次时，必须精确定位单个 AST 调用** — 原来的全局字符串匹配会拒绝同名定位器，现由静态 analyzer 的方法、起始行、起始列精确匹配一处，永不批量替换全部同名节点。

## TDD / CI 证据（各测试先失败，再最小实现）

| Task | RED 验证 | GREEN 主要提交 |
|---|---|---|
| 可信文件拖放 | [CI #37784042259](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37784042259)（两项新断言失败） | `b256b205` |
| 脚本排除规则 fail closed | [CI #37784405746](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37784405746)（两项新断言失败） | `b96054d2` |
| CDP 端口/目标约束 | [CI #37784782142](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37784782142)（四项新断言失败） | `76e3b3d6` |
| DOM 集合定位器覆盖 | [CI #37785304453](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37785304453)（新断言失败） | `f9b1a63e` |
| 受管恢复外部改动保护 | [CI #37785686789](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37785686789)（两项新断言失败） | `b497638e` |
| 便携 Chrome 155 隔离调试 | [CI #37786035522](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37786035522)（两项新断言失败） | `a48bff6e` |
| 同名 selector 精准 AST 修复 | [CI #37786476044](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37786476044)（两项新断言失败） | `b960a662` |

最近经过完整 CI 的源代码提交：`b960a662b9a37330daa609e942bff5f47c8b3196`。
[Windows Development CI #37786679354](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37786679354)：`npm ci`、**113/113 单元和整合测试**、严格 TypeScript、桌面编译均为 SUCCESS。此次 CI 故意**没有打包或发布安装器**。本 ledger 后续文档提交会产生新 CI，实际结果始终以当前 HEAD 对应运行核实为准。

## 目前能实测的范围

- 受控原文件导入、静态分析、受限本机 Chrome CDP 对照、选择器候选和人工批准的受管修订。
- 受控源文件哈希与备份、外部改动拒绝覆盖、SQLite 数据及 JSON/Markdown 报告。
- 三种发行形态的历史构建能力已有 Windows CI smoke 证据，**本阶段按用户要求不生成中途安装包**。

## 尚未完成/不能声称通过

- 多 iframe / ShadowRoot 复杂运行时上下文和用户脚本权限域正确性。
- Tampermonkey 真正注入执行与 GM_* / 页面交互结果的 V3/V4 功能验证；无需网页登陆凭据上传。
- 完整自动语义修复闭环、站点适配器与共享规则、BYO AI、健康巡检、正式数据迁移与灾难恢复。
- Windows 10 用户指定的便携 Chrome 155 实机端到端、代码签名与首次安装/长期升级/卸载验证。
- Release Gates RG-01…09 与独立安全审查尚未完整达到；PR 必须保持 Draft，不能合并 main 或以 Stable 名义对外发布。

**持续开发约束：** 未完成时如实更新任务清单，绝不把静态 Selector 找到视作脚本功能修复，也不允许中途构建工件冒充最终交付。

## Native 续接：受控前台定时巡检

- [RED CI #37787455190](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37787455190)：新增纯函数状态分类/GUI 巡检联动测试先失败。
- `packages/scan-service/src/health.ts` 将当前 DOM-only evidence 分类为 `dom-present / locator-missing / needs-review / no-evidence`，**从不返回“脚本功能通过”**。
- `apps/desktop/src/renderer/App.tsx` 新增用户明确开启/关闭的每分钟只读巡检：切换当前脚本与 CDP 页面即撤销监控，前台窗口关闭即终止；只调用已授权的 `usshm:probe-locators`，不执行 userscript，不后台修改代码。
- [GREEN Windows Development CI #37787696096](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37787696096)：**116/116 测试通过，0 失败**；Node24 TypeScript、Electron bundle 成功。对应实现提交 `0be2e4d099f9d35a30ee1dd5ef63420bbe55bcab`。
- 本功能仅是窗口内 read-only opt-in 巡检，**不代表长期后台守护、站点身份验证、V3/V4 动作回归或全自动修复**。


## Native 续接：目录预算、网页身份与快照资源限制（2026-10-08）

本轮保持 `feat/v01-continuation` Draft；未合并 main、未触发预览安装包工作流，也不宣称完成 V3/V4 真实功能验证。

1. **文件预算预检（先枚举再写库）**：在 `enumerateScripts` 引入可选 `maxEntries`，`importPaths` 对多文件/目录的展开统一计算 `maxFiles`；一旦超限立即抛出 `limit-exceeded`，在读取脚本内容、写入 SQLite 前终止。修复之前的真实失败测试：[RED CI #37792494467](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37792494467)；最终 GREEN 见下文。
2. **CDP 实时顶层页面身份门禁**：新增 `packages/cdp-client/src/page-identity.ts`，仅通过 `Page.getFrameTree` 取得实时主 Frame URL，检查其是否严格等于经过 `@match/@exclude` 检查的目标 URL；在桌面 DOM 读操作及候选建议调用的前后分别确认，页面导航发生时拒绝继续使用证据。此方法不执行 `Runtime.evaluate`。单元测试覆盖匹配、导航后拒绝、异常响应与本机端口隔离。
3. **DOMSnapshot 容量保护**：`captureDomSummary` 现在拒绝超过 5 MB 的协议消息、超过 64 个文档或累计 200,000 个 DOM 节点，避免无界统计及超大消息进入 UI。对应新增边界测试先失败：[RED CI #37793308724](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37793308724)。
4. **回归异常修复**：新 CDP 测试最初误用了 Node strip-types 不支持的 parameter property；已调整为普通字段声明。此为测试夹具兼容性修复，不涉及生产 API。
5. **最新已核实构建证据**：[Windows Development CI #37793342216](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37793342216) 对代码提交 `fc2c25bea8b66ad34996aeeaf8a1d41e98cfa93c` 执行成功：**36 个 TypeScript 测试文件、123/123 测试通过、0 失败、严格类型检查与 Electron build SUCCESS**。GitHub Actions 未产出中途安装包。

**重要局限：** DOM 前后两次 frame URL 检查能发现常见的导航时序变化，但不同 CDP socket 之间并非事务，也不能证明页面 DOM 在两个检查点之间完全未变化；这是安全降级检测，不是功能执行验证。仍缺真实 Win10 + 便携 Chrome 155 的 GUI/E2E、用户脚本 Tampermonkey 注入/GM_* 行为测试、iframe/Shadow DOM 完整语义支持、可选 AI 提供商、持久后台守护及独立发布审查。切勿把 123 项开发测试当成 Stable 发布资格。


## Native 续接：真实 Chrome CDP Windows 自动化验收

为避免只靠模拟 WebSocket 测试掩盖浏览器协议差异，本轮新增 `scripts/smoke-chrome.mjs`，并在 `.github/workflows/dev-ci.yml` 的 Node 24 单元测试、类型检查、Electron 构建之后执行。不上传中途安装包。

- GitHub `windows-latest` runner 以独立临时 `--user-data-dir` 和 `--headless=new` 启动真实 Google Chrome，通过 `127.0.0.1:9223` CDP 对本地 loopback HTTP 测试页进行通信；不读取用户 Chrome 配置/账号、不开启 Tampermonkey、不执行用户脚本。
- 先确认 `/json/list` 页面，再等 `Page.getFrameTree` 顶层 frame URL 准备好（页面列表 URL 提前可见属于正常异步时序）；不跳过网页身份安全门禁。
- 真实验证 `DOMSnapshot.captureSnapshot` 的 DOM 节点统计、`DOM.getDocument` 和 `DOM.querySelectorAll` 的存在/缺失响应，以及从隐私过滤的 DOM 快照生成候选后再次确认候选为当前网页唯一命中。
- 初次浏览器 E2E 揭示顶层 Frame URL 尚未准备好的窗口：[失败 CI #37794062545](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37794062545)。后续增强 smoke 的就绪等待与只记录结构信息的错误诊断。
- 最新实证：[Windows Development CI #37794793469](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37794793469)，代码提交 `fe29eeae046eb629dc4b9a2d405d51c381fc719c`：**124/124 自动测试通过、TypeScript 类型检查通过、Electron 构建通过、真实 Chrome CDP 身份/快照/存在和缺失定位器/候选匹配 smoke 通过**。
- 真实浏览器 smoke 依赖 GitHub Windows Server 2025 runner 的 Chrome，不是用户 Windows 10 和指定便携 Chrome 155 的实机/扩展验收。
- 清理范围严格限制为本轮测试新启动的 Chrome 进程树和临时独立 profile；不触碰系统默认 Chrome 配置。

**仍不满足 Stable 门禁：** Tampermonkey 脚本实际注入执行、GM_*、跨 iframe / Shadow DOM、行为/网络副作用验证、复杂修复语义、持久后台守护、AI Provider、Win10 x64 + 用户便携 Chrome 155、发行版三格式最终复测/签名及独立安全审查。PR 必须保留 Draft；严格不得将只读浏览器检查或候选唯一性表述为功能修复成功。
