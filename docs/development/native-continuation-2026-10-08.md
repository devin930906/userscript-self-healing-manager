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


## Native 续接：批量诊断、安全作用域与可交付受管导出

本次仍只对 `feat/v01-continuation` 开发分支进行提交；没有中途预览安装包、没有合并 `main`、没有修改真实 Tampermonkey 存储或用户原始脚本。

### 已完成源码范围

1. **批量诊断调度（只读）**：新增 `packages/scan-service/src/batch-dom.ts`，对每份脚本逐项执行 `@match/@include/@exclude` 校验；区分范围外、静态定位器缺失、匹配、无证据、需复核与局部失败。每份上限 50 定位器、每次 IPC 上限 25 份。前后检查实时主 Frame 身份，导航发生时中止，而不是复用旧 DOM。
2. **GUI 自动批次 / 取消**：渲染端对全部已扫描脚本使用 25 份分页循环、显示已完成数量、支持取消尚未发出的批次；IPC 校验整齐对齐的 offset 和页面明确授权。按钮是用户主动启动的只读操作，绝不运行未知脚本或自动覆盖原件。
3. **安全规则匹配加固**：`packages/candidate-engine/src/page-scope.ts` 的通配符检查采用不编译任意正则的受限线性匹配；`@match` 超长规则与非法 host 通配写法/端口返回 `unknown`，不能让无效的排除规则静默失效。
4. **原始字节保护**：补丁引擎遇无效 UTF-8 直接拒绝修改，不把不合法字节替换为 U+FFFD 后重新写入；新增不含变量插值的模板字符串定位器精确替换能力。
5. **受管 current 安全导出**：`packages/repair-workflow/src/export.ts` 用归档哈希验证活动修订，拒绝篡改、缺失和不安全输出；Electron Main 使用原生 Save 对话框选择目标路径；不覆盖任何已存在的 `.user.js`，不修改源文件。导出后需要在 Tampermonkey 中独立导入。
6. **Windows 特有符号链接边界**：首轮 `wx` 独占写入测试在 Windows 发现悬空 symlink 目标可被意外创建。加上 `lstat` 预检和 `wx` 二次防护，测试同时断言符号链接目标不被创建。该组合减少普通竞态风险，但不是原子、完全无 TOCTOU 的 OS 内核级保护。

### 实际测试证据

- [失败 Windows CI #37799802488](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37799802488)：137 项执行中 136 通过、1 失败，明确重现 Windows 导出 symlink 安全问题。其后完成修复和更严格的回归。
- [成功 Windows Development CI #37800076289](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37800076289)：对应代码提交 `315a7015dadc48dea3d1c957397f6d43a2b452ad`，**137/137 自动测试通过、0 失败；Node24 TypeScript typecheck PASS；Electron build PASS；真实 Chrome CDP smoke PASS**。
- 实际 Chrome smoke 在临时资料目录中验证：顶层网页身份、批量 DOM 检查、候选唯一匹配、受管补丁、独立 `.user.js` 导出和修订恢复；没有运行真实油猴脚本，亦未上传私人 DOM 或登录资料。
- 没有将真正 Tampermonkey/GM_* 运行结果冒充为通过。所有测试均自动执行，不要求开发中途人工验收。

### 未通过的最终发行门禁

真实 Tampermonkey V3/V4 行为/GM_* 回归、iframe/ShadowRoot 作用域、自动语义修复的可信证明、后台持久守护、可选 AI provider、安全签名供应链、真实 Windows 10 + 指定便携 Chrome 155 GUI/E2E、三种 Windows 正式发行形式的本次源码重测与 RG-01…09 全部关闭仍未完成。保持 PR Draft，禁止宣称 Stable 完成或可直接安装正式版。


## 后续 Native 续接：发布前关键安全与连续分页回归

此部分继续沿用已批准的 Native 实施计划和 Superpowers RED → GREEN → COMMIT 流程。目标是在不运行任何用户脚本、不覆盖原件、不访问真实用户登录目录的前提下，补全可核验的维护能力。

### 1. 受管导出防止链接绕过

- 新增 `packages/repair-workflow/test/export.test.ts`：将看似位于 Data 外部的保存文件夹设为指向 `Data/managed/<scriptId>` 的 symlink/junction，要求导出拒绝且原档案不新增文件。
- [RED: Windows CI #37802020210](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37802020210) 重现失败；随后在 `packages/repair-workflow/src/export.ts` 中使用真实目录路径 `realpath` 及相对路径边界校验。
- [GREEN: Windows Development CI #37802154000](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37802154000) 验证补丁，原 `wx` 与 `lstat` 双重拒绝机制保留。此验证不意味着消除 OS 层任意外部进程制造的所有 TOCTOU 竞态。

### 2. 批量诊断的页面身份与完整性

- 新增 `packages/scan-service/src/paginated-dom.ts`：一批 25 份，串行收集全部扫描脚本，校验 `targetId`、页面 URL、`startIndex`、`remainingItems`、每项索引连续且数量完整。目标跳转、数据缺失或批次身份混淆会阻断拼接；界面发生失败后清除不完整证据。
- 新增取消后续批次的确定性行为测试。取消不会谎称已经中止在途 CDP 调用，也不会把未完成脚本当成成功。
- 新增所有脚本都范围外或无静态定位器时的真实主 Frame 前后校验；即使没有 DOM 探针，也不能信任旧的 `/json/list` 页面列表。
- [RED #37802362927](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37802362927) 验证分页收集器测试缺失会失败；[RED #37803053010](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37803053010) 验证 all-skipped 页面身份断言。
- Windows Chrome smoke 使用仅在 localhost 的伪造网页，在真实 Chrome 中通过三个批次检查 **51 份脚本**，包括可定位和范围外脚本，严禁运行真实油猴代码。

### 3. 扩展受控修复方法

- 修正 `getElementsByName`、`getElementsByClassName` 原本被 AST 识别却不能由字节补丁引擎精确替换的问题。追加针对源码位置的补丁测试、原文件 SHA-256 不变检查。
- 为 `getElementById`、`getElementsByName`、`getElementsByClassName` 添加原始参数提示；避免将 `#selector` 或 `[name="..."]` 误传为原始 ID/name。
- 候选引擎和 workflow 增加 name/class 两种受限快照候选，要求再次用实时 Chrome CDP 唯一定位匹配，输出依然只能是供用户复核的候选，不保证原脚本业务语义。
- [RED #37803614110](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37803614110) 证明原名称/类名替换缺失；[RED #37804198489](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37804198489) 证明原候选引擎不支持集合方法。

### 4. 最新自动验证

- [Windows Development CI #37804376837](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37804376837)：对应实现提交 `d4afc7307dc49412fea69a7efb4a289cd625e897`，**149 / 149 tests PASS、0 failures；TypeScript PASS；Electron build PASS；真实 Chrome CDP smoke PASS**。
- Chrome 输出：`PASS real Chrome CDP: page identity, 51-script batches, CSS/name/class candidates, managed patch, export and restore.`
- 测试机为 GitHub Hosted Windows Runner 的浏览器，不是用户 Windows 10 与指定便携版 Chrome 155。亦未安装/运行 Tampermonkey 扩展，因此不得声称 GM API 或真正脚本行为已通过。
- 所有改动留在 `feat/v01-continuation`，PR #2 保持 Draft；本轮未制作中途预览安装包，未合并 main，未发布 Stable。

 
## Superpowers Native 续接：连续修复、便携 Chrome 持久化与批量候选

**本轮目标：** 在先前只读 DOM 检测与单次受管补丁基础上，解决多定位器脚本第二次修复会丢失第一处修复、浏览器路径重启后丢失、异常 Chrome EXE 可能触发未捕获启动错误，以及一次只能逐个获取修复候选的问题。

### 已实现（真实代码，不是仅有设计）

1. **可累积的受管修订**：修复工作流在有历史时先验证原始脚本 SHA-256 与 `original-*.user.js` 档案，然后检查活动 `current.user.js` 必须属于不可变归档；下一次补丁以活动受管副本为基础，而非覆盖第一处修复。第二次补丁的 backup 被正确归类为上一修订（revision），最初 original 档案始终保持原件。原始源码被外部修改、活动副本被外部修改、当前副本丢失或两次操作之间哈希失配时拒绝继续。
2. **自定义便携 Chrome 路径记忆**：`packages/cdp-client/src/preferred-chrome.ts` 在 Data/ 中保留用户通过系统对话框明确选择的 `.exe` 路径；重启后仅回填 GUI，**不自动执行 EXE**。针对移动文件、损坏 JSON、非法或符号链接 EXE 与偏好配置替换设置了安全降级。
3. **Chrome 启动错误处理**：等待真实子进程 `spawn` 事件或捕获 `error`，拒绝不能执行的便携浏览器文件，防止主进程因未捕获 spawn error 崩溃或错误报告已启动；这不是 CDP 握手完成保证。
4. **无效编码拦截**：`packages/source-analyzer` 改为严格 UTF-8 解码，将不可解码脚本报告为 `encoding:invalid` / `parse-error`，不提取可疑的静态 DOM 选择器，也不吞掉损坏的字节。
5. **一键生成多个修复候选（只读）**：`packages/candidate-engine/src/bulk.ts`、主进程、Preload 和 React UI 加入新的用户授权工作流。从当前真实 Chrome 页面最多提取前 50 份源码定位器的缺失静态项，每次最多处理 8 项，采用受限 DOM 属性候选＋再次唯一性确认、跨条目重复候选过滤，**不注入/运行脚本、不修改源文件、不自动应用补丁**。候选可逐个导入原有人工预览→受管修订工作台。
6. **缺失候选分页与 UI 防过期**：第一批为前 8 个缺失项；后续可继续下一组，不会重复首批，也不超过每个 IPC 8 项上限。跨批验证页面 URL、目标、可检查总数，切换当前网页/脚本后丢弃旧异步结果。
7. **真实 Chrome 扩展回归**：GitHub Windows 自动启动隔离 Chrome，验证选定 EXE 持久化回读、51 份脚本三批只读诊断、四种 DOM 方法的批量候选，以及两次连续受管修订→安全导出→原始版本恢复。原始虚构脚本始终不被覆盖。

### 严格 RED → GREEN 证据

- 连续受管修订回归：[失败测试 #37805258941](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37805258941) → 修复后的 152/152 测试。
- Chrome 设置保存与启动：[路径持久化 RED #37805954228](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37805954228)、[损坏偏好启动 RED #37806398377](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37806398377)、[异步 Chrome spawn RED #37806694720](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37806694720)。
- 编码：[UTF-8 RED #37806890856](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37806890856)。
- 批量候选：[引擎 RED #37807178740](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37807178740)、[桌面 IPC RED #37807359458](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37807359458)、[8 项分页 RED #37808063905](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37808063905)、[桌面继续下一组 RED #37808196123](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37808196123)、[异步旧数据 RED #37808629712](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37808629712)。
- [**最终 Windows Development CI #37808749380 — SUCCESS**](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37808749380)：对应代码提交 `5aa651a992b9ef1f0a4a99820db126d2bcf3f76c`，**164/164 自动测试通过、0 失败；严格 TypeScript 类型检查 PASS；Electron 构建 PASS；真实 Chrome CDP 集成烟测 PASS**。
- 实际日志：`PASS real Chrome CDP: preferred executable reload, page identity, 51-script batches, bulk CSS/name/class candidates, cumulative repairs, export and restore.`
- 未产生中途安装包，没有合并 `main`，PR #2 继续保持 Draft。

### 仍未达到 Stable

CI 运行器不是用户真实 Windows 10 + 指定便携 Chrome 155；实际 Tampermonkey 扩展没有在本轮测试中加载或执行，GM_* / V3/V4 行为、跨 iframe/ShadowRoot、真实脚本副作用、自动化语义修复准确性、持久后台守护、AI provider、独立安全审查、发行版签名与全部 Release Gate 仍需进一步实现和验证。DOM 匹配唯一性不能冒充脚本功能已恢复。**不可将本轮功能或测试数量表述为最终 Stable 完成。**


## 2026-10-09：@include/@exclude URL 大小写语义

- **Root cause**：`packages/candidate-engine/src/page-scope.ts` 的 `includePattern` 将 `pattern` 与 `url.href` 整体转为小写比较；但 URL 的 scheme / host 才不区分大小写，pathname / search 需要保留大小写。原行为错误允许大写路径模式匹配不同的小写页面，并可能误拦截 `@exclude` 条目。
- **RED**：[CI #37811535540](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37811535540) 先增加 `@include` 和 `@exclude` 回归测试，168 项中有 2 项如预期失败。
- **GREEN**：`includePattern` 只对 scheme / host 进行大小写规范化，保留 path/query 原文进行有界 glob 匹配；没有用正则动态执行脚本 metadata。提交 `c154fafbebaa239ad8bb6b57edffb4dfd4cff778`。
- **Windows 自动验证**：[Development CI #37811659144](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37811659144) **168/168 测试 PASS，TypeScript PASS，Electron build PASS，真实 Chrome CDP smoke PASS**。Chrome 冒烟包含已有的 preferred executable reload、51 脚本分页与批量候选、累积修复、导出与回滚。
- 未使用实际 Tampermonkey/GM_* 或指定 Win10 便携 Chrome 155；本次没有生成中途安装包、发布 Stable 或合并 main。此限制继续约束发布门禁。
