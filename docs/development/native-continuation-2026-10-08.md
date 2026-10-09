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


## 2026-10-09：UserScript 元数据空行容错

- 根因：`parseUserscriptMetadata` 遇到 header 内的空行直接停止，因此遗漏了后面的 `@match/@grant`，使真实脚本被误判为缺失站点生效规则。
- [RED #37812006993](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37812006993)：新增空行容错与元数据结束标记回归；170 tests 中 1 项失败，明确复现。
- 修复：header 内空行继续解析；遇到 `// ==/UserScript==` 或真正的非注释可执行代码立即停止，仍不会读取正文中的伪造元数据。提交 `193d5116a231c542d190359ca1355af2d155f56e`。
- [GREEN #37812131995](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37812131995)：**170/170 tests PASS、0 failures**；TypeScript、Electron 构建与真实隔离 Chrome CDP 冒烟全部 PASS。
- 保持 PR #2 Draft；没有测试真实 Tampermonkey 或用户 Windows 10 便携 Chrome 155、没有生成中途安装包，不能据此声称 Stable 完成。


## 2026-10-09：桌面端累积修复与并发过期保护、元数据伪装防御

本轮在已批准 Native 开发计划下继续执行测试先行。目标不是给 DOM 候选误贴“功能正常”标签，而是修复软件内部可能令用户已有修复成果丢失的错误。

1. **修复 GUI 连续修订假冲突。** `packages/repair-workflow` 在累积补丁时 `baseHash` 代表**当前受管副本**的 SHA-256，原桌面主进程却将其与用户原始扫描文件的 `sourceSha256` 直接比较，从而错误拒绝第二次修复。现在 `ProposalReceipt.originalHash` 单独标记原始源文件的哈希；主进程继续验证扫描原件未变化，但不再错误拒绝合法修订链。首次修订的 `baseHash` 与原件一致，后续修订指向上一受管活动文件的哈希。
2. **拒绝并发旧预览覆盖。** 同一脚本两个预览都从尚未激活的原件生成时，批准第一个之后再批准第二个旧预览，以前可能把刚批准的结果覆盖。现在 `apply` 会在写入任何修订文件之前核对当前受管副本/归档是否已被创建；已改变则要求重新生成预览。原件 SHA-256 和原始文件始终不变。并发同时提交测试在当前文件系统行为中本来就能因已有哈希校验而拒绝冲突，仅作为补充覆盖，**不能冒充一个 RED 的新缺陷**。
3. **防止伪造 UserScript 元数据头。** 以前会从任意源码行寻找 `// ==UserScript==`，即使它位于先前 JavaScript 代码之后，也会错误信任后面的 `@match`。现在只识别文件开头最多 128 行的空白/单行注释前缀内的 header，遇到可执行代码立即停止，继续保留元数据块内部合法空行容错。该保守实现可能不支持不规范的前置块注释，宁可显示生效范围未知，也不从 JS 正文伪造站点授权。
4. **RED/GREEN 审核证据**：GUI 哈希双身份 [RED #37812909243](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37812909243) → [GREEN #37813032419](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37813032419)；旧预览丢失更新 [RED #37813222624](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37813222624) → [GREEN #37813361587](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37813361587)；伪造元数据 [RED #37813656537](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37813656537) → [GREEN #37813778886](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37813778886)。
5. **最近完整自动验证**：[Windows Development CI #37814024099](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37814024099) 在代码提交 `4f7861cf898663e2fa94506dd850cdaf3a9ca16d` 上 **176/176 自动测试通过、0 失败、TypeScript PASS、Electron 构建 PASS、真实隔离 Chrome CDP 冒烟 PASS**。Chrome 自动冒烟仍包含 51 脚本跨批、候选诊断、连续修订、导出和回滚。
6. **Release Gate 限制不变**：未验证真实 Tampermonkey/GM_* 以及 iframe/shadow-root、V3/V4/功能恢复；未在用户指定的 Win10 + 便携 Chrome 155 上端到端测试；本轮没有生成中途预览安装包，不合并 main，不发布 Stable，PR #2 保持 Draft。


## 2026-10-09：隔离 Chrome 合成 UserScript 业务行为闭环

**Ruling: 真正用户脚本没有充分沙箱/权限策略，不能为了测试而在实际网站或用户浏览器执行未知脚本。** 选择测试自带纯合成脚本、127.0.0.1 端口随机化 fixture 和一次性 Chrome profile。这能验证真实 Chrome 的 DOM 业务效果，不能代替 Tampermonkey/GM_* / 真实用户脚本 E2E。

- 新增 `scripts/local-fixture-behavior.ts`，**仅为 CI 测试工具**，Electron Main/Preload/Renderer 不引入它。仅允许事先约定的 `http://127.0.0.1:<port>/fixture`、已选择的 CDP target 及带 `@name Local CDP Smoke` 的合成源码；长度、CDP 报文大小、超时受限，调用 `Runtime.evaluate` 前后执行独立 `Page.getFrameTree` 身份校验。运行前清理 fixture 控件状态，避免之前通过的副作用干扰失败检测。
- 新增 `tests/integration/local-fixture-behavior.test.ts`：合法本地目标返回真实布尔行为证据；旧 selector 不生效时不得报告通过；拒绝异站网页/不匹配 URL/任意非合成代码；页面跳转或 Runtime exception 必须拒绝。
- 扩展 `scripts/smoke-chrome.mjs` 内置虚构脚本：只有按钮、面板**两个定位器都成功**才设置 `data-usshm-functional=pass`。在真实隔离 Chrome 中依次断言**修复前 false → 修复第一个定位器后 false → 两处累积受管修复后 true → 回滚原版后 false**。测试全过程不会运行任何用户提供的脚本、不启动 Tampermonkey、不写用户已登录的浏览器 profile，受管原件不被覆盖。
- **RED**：[CI #37816033941](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37816033941) 记录测试前验证 API 缺失；[CI #37816498671](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37816498671) 记录 Windows Chrome smoke 缺少行为回归；[CI #37816874540](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37816874540) 记录单点修复假成功的遗漏断言。实现中发现了 Node 24 strip-types 测试替身不能采用 TypeScript 参数属性，以及创建假的 websocket 早于 await 会错过 open 事件，均已按真实测试约束修正。
- **GREEN**：[Windows Development CI #37816968552](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37816968552)，提交 `93e8e0dcd4a8505df998eeffd8eda33344e5174d`，**181 / 181 tests PASS、0 FAIL；TypeScript PASS；Electron build PASS；真实 Chrome synthetic behavior end-to-end PASS**。前一次同类行为闭环验证为 [#37816653743](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37816653743)。
- **开放发布门禁**：尚无真实 Tampermonkey 插件注入和 GM_* 行为、真实业务脚本的用户许可执行方案、Win10 + 便携 Chrome 155 E2E、iframe/shadow DOM 覆盖及 Stable 安全审查。CDP 生产 API 仍只读、测试运行器验证不是用户环境验证。保持 PR #2 Draft；不合并、不发布、不产生预览安装包。


## 2026-10-09：接近 Stable 的保守诊断与真实桌面窗口验收

本轮仍按已经批准的 Superpowers Native/TDD 计划继续，直接在 `feat/v01-continuation` 提交代码，不触发安装包工作流。

### 正式版正确性：脚本生效范围与多 Frame

- 修复 `packages/scan-service/src/batch-dom.ts`：原先 `@match/@include/@exclude` 无法判定（`unknown`）被错误归类为 `out-of-scope`，对无法判断的脚本现在只能标记 `needs-review`；已确认不匹配仍为 `out-of-scope`。避免把“证据不足”错误说成“脚本不在该网页运行”。
- 扩展 `confirmPageIdentity` 的 `Page.getFrameTree` 只读检查：以最多 64 个子 Frame 为安全边界，仅返回 `subframeCount` 而不返回可能包含用户凭证/查询参数的 Frame URL。框架树不完整或过大立即拒绝。
- 仅检查顶层 document 时，如果页面存在 iframe，原本的顶层“缺失”和顶层“范围外”都不能证明用户脚本在嵌套页面无效，默认降级为 `needs-review`。**这只是诚实区分未知，不是实现了 iframe 内实际修复**。
- Tampermonkey 官方 `@noframes` 明确规定脚本只在顶层页面运行，因此这类脚本仍允许给出顶层 `locator-missing/out-of-scope` 结论；参考 [官方文档](https://www.tampermonkey.net/documentation.php?locale=en&q=noframes)。
- RED：范围未知误报 [#37818774492](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37818774492)；帧边界及错误分类 [#37819096443](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37819096443)；`@noframes` 语义 [#37819562414](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37819562414)；缺少真实 Chrome nested Frame E2E [#37819793300](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37819793300)。
- Windows Chrome 冒烟现在由虚构脚本在测试 localhost 页面创建实际 `srcdoc` iframe，再分别确认多 Frame 普通脚本为 `needs-review`、标注 `@noframes` 的顶层脚本为 `locator-missing`。不读取 iframe 源码、不泄露子页 URL、不调用真实用户脚本。

### 发行门禁：编译后实际 Electron GUI 启动

- 过去 Development CI 只编译 Electron/React，不能证明图形应用实际打开。现在新增 `scripts/smoke-electron-dev.mjs`，**在 GitHub Windows runner 上真正执行已编译 Electron**：使用一次性 `PORTABLE_EXECUTABLE_DIR` 数据目录，检查 `Data/registry.sqlite` 已初始化，并通过单独 loopback DevTools 9224 确认 `file://.../dist/index.html` 的真实 renderer 页面。测试后仅清理本次启动的 Electron 进程树与临时目录。
- **没有构建或上传任何 Setup/Portable/ZIP 预览安装包。** 测试的 executable 是 lockfile 所指定 npm Electron 开发依赖，非提供给用户安装的产物。
- 初次 RED：[缺少桌面启动门禁 #37820249704](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37820249704)。第一次真实运行发现 `npm ci` 没有准备 Electron runtime EXE；新增显式 `node node_modules/electron/install.js`。第二次真实运行证明 Windows Known Folder 路径不可靠地遵循 `APPDATA` 覆写，改用项目正式 `PORTABLE_EXECUTABLE_DIR` 机制的测试专用数据目录。这些都是来自 Windows CI 的真实失败，而非静态推测。
- GREEN：[Windows Development CI #37821000622](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37821000622) 对应 `bac86142782c7a28ab01884b220d9fa78b1a263c`：**188/188 自动测试 PASS、0 FAIL；严格 TypeScript PASS；Electron/React 构建 PASS；编译后 Windows Electron 真实窗口和持久 Data/registry.sqlite PASS；真实 Chrome CDP 跨批诊断、iframe、合成脚本功能前后对比、修复/导出/回滚 PASS**。

### 还未满足的 Stable 验收

- CI 没有安装和执行真正的 Tampermonkey 浏览器扩展，未验证 GM_* API、Tampermonkey V3/V4 注入、权限与隔离行为；合成代码行为测试无法替代这些。
- iframe 与 Shadow DOM 中实际定位/修复仍不支持；本轮只是阻断 iframe 场景的假阳性故障结论。
- CI 的 Windows runner 不是指定 Windows 10 + 便携 Chrome 155，尚无该组合的 E2E 证据；三种最终发行包在本轮没有重新打包、签名或验证。
- PR #2 继续 Draft，不合并 main，不发布 Stable。只有完成真正 Release Gates 才能改变此状态。


## 2026-10-09：跨扫描异步隔离与预览授权生命周期

### 问题与完成边界

之前的 `batch-diagnose` 以及逐脚本 `probe/suggest/propose/export/rollback` IPC 均依赖 `lastScan.items[itemIndex]`。当重新扫描产生一份同样下标、路径甚至相同名称的不同源码后，旧 DOM 请求可能读到新脚本的诊断依据；异步跨页查询无法仅凭 `targetId`、页码和脚本路径防止跨扫描混淆。特别是 UI 批量诊断时，程序必须能够判断旧证据属于哪一次扫描。

### 实现

- 增加 `ScanSessionCoordinator<T>`：每次成功扫描生成随机 `scanId`，更晚启动的扫描优先，慢扫描的旧完成结果不得覆盖新扫描。扫描出错时保留上一份已成功提交的扫描快照。各类 IPC 通过 `scanSessions.require(q.scanId)` 取得原始快照，在异步 CDP 诊断、静态候选或修复准备结束时调用 `assertCurrent`；不依赖任何用户可伪造的文件名作为访问凭据。
- React UI 和受限 preload 对所有按 `itemIndex` 访问扫描脚本的操作均传递同一个 `scanId`，包括逐脚本定位器/候选、批量诊断、补丁预览、受管历史、保存对话框导出、历史回滚。切换扫描后，旧 UI 操作自动被主进程拒绝而不会访问新扫描中的同下标脚本。每一批分页诊断仍对 `scriptId/path` 做独立逐行身份核对。
- 完整受管修复的批准还需额外的 `ProposalApprovalGate`：仅允许原扫描产生的提案通过一次批准，禁止历史预览被另一个扫描授权或被重复使用，最多保存 100 个待批准凭据。
- 重新扫描成功后同时清理 `ProposalApprovalGate` 与 `createRepairWorkflow().invalidatePending()` 中的未发布字节提案，避免长时间重复扫描占满 100 项内存限制而无法继续生成预览。只有原件的受管备份和已批准修订保留。未自动写入或覆盖用户原始 `.user.js`。
- 健康巡检的异步回调使用捕获的扫描 epoch，避免 React 闭包内的可能为 null 的 `result`，并在扫描变化时重新绑定、停止旧巡检。

### Superpowers TDD 验收

- RED：[扫描版本接口缺失 #37831641684](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37831641684)、[IPC wiring 缺失 #37831793645](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37831793645)、[逐脚本 IPC 版本门禁缺失 #37832505213](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37832505213)、[新预览授权 gate 缺失 #37833552129](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37833552129)、[旧预览清理缺失 #37834164070](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37834164070)。历史源码接口更新后曾短暂导致旧 wiring 测试按 `lastScan` 误判失败；已把这些测试升级为验证 `scanSnapshot`，并修复了异步 React 严格空值校验。
- GREEN：[Windows Development CI #37834296649](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37834296649) 对应源码 HEAD `22872bb31ddb7b27cc60857b1617e79fc40f5a94`：**207/207 自动测试通过，严格 TypeScript、Electron/React 构建、真实 Windows Electron GUI + 隔离 SQLite 数据目录、真实 Chrome CDP、合成脚本修复前→部分修复→完整修复→回滚全部 PASS**。
- 当前仍没有通过真实 Tampermonkey/GM_*、目标 Windows 10 + 便携 Chrome 155、Shadow DOM/iframe 内定位器真正修复及三个最终可发行产物的完整门禁。**Ruling：只按经过真实证据验证的能力报告当前状态，维持 Draft，不以新增单测数量替代 Stable 功能合格证明**。本次没有触发安装包生成、外部发布、合并 main 或用户环境人工检查。


## 2026-10-09：异步 UI 竞争保护、批量扫描挂起隔离、单实例数据库保护

本次使用 Superpowers systematic-debugging + test-driven-development 继续执行原先已批准的 Native 开发任务，不要求用户人工验证，也不产生临时安装包。

### React UI：对三个相互独立的异步操作做严格过期保护

- 新增 `apps/desktop/src/renderer/latest-request-gate.ts`，使用递增序号隔离已取消或已切换页面的请求；`begin / invalidate / isCurrent / commit` 拒绝旧操作写回，不声称物理取消进行中的 CDP IPC。
- `App.tsx` 的 `batchDiagnose`、单文件 `probePage`、`suggestBulkRepairs` 分别使用独立请求代号；页面或扫描变化时，主动废止旧回调并释放对应加载状态。**重要：旧请求的 `finally` 不再无条件调用 `setBusy(false)`，以免将新版任务的 busy 指示错误清除。**
- 新增 8 项测试，包括代号失效、旧响应/错误不回写、旧 finally 不覆盖新状态、UI wiring。RED：[CI #37886002800](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37886002800) 记录 4 项 UI contract 未满足；GREEN：[CI #37886207712](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37886207712) 完整 215/215 项通过，Electron GUI 与真实 Chrome 同步 PASS。

### 扫描与受管修复的并发边界

- `ScanSessionCoordinator` 过去只在新扫描完成时切换 active scan；若重新扫描仍在读取磁盘，旧 scanId 仍可以合法调度 CDP 诊断。本轮在开始新扫描时**立即暂停所有旧 scanId 的授权**，若最新扫描失败则恢复上一份已提交扫描。旧的、已失效的并发扫描结果不能覆盖新扫描。RED：[CI #37886380904](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37886380904) 的相关用例。
- CI 同时实际捕捉到此前偶发的**同脚本两个并发批准同时成功**（同一个 RED #37886380904 中原有 `simultaneous approvals` 用例观察到 2 而非 1）；其根因是两次 `apply()` 均能在第一次创建 managed current 之前通过磁盘不存在检查。现在 `createRepairWorkflow` 用按 `scriptId` 的同步 Set 锁，**首次 await 前加锁，激活完成或出错后在 finally 释放**；互不相干的脚本不会相互锁死。原始用户文件仍从不被覆盖。
- 桌面软件以 `app.requestSingleInstanceLock()` 拒绝并行开启另一主进程，降低多个 GUI 同时操作同一个 SQLite 与受管修订目录的风险。Windows Dev CI 现在自动启动第二个真实 Electron 程序，验证第二实例自动退出且第一实例未退出、数据库与 React 视图仍正常。没有生成预览安装包。
- RED：[单实例保护缺失 #37886777693](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37886777693)。GREEN：[Windows Development CI #37886956282](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37886956282) 对应 `333dab80a23a59f3a5a0412a3e96deb6f7eb03f2`：**219/219 tests PASS、0 FAIL，TypeScript PASS，React/Electron 构建 PASS、Windows 真正 Electron GUI、SQLite、重复启动保护 PASS，真实 Chrome CDP 行为回归 PASS**。

### Release Gate 仍开放

- 自动合成 fixture 不等同真实 Tampermonkey/GM_* 执行。未验证用户实际脚本、Window 10 + 用户便携 Chrome 155 组合，仍未具备 iframe/Shadow DOM 内自愈与最终三种安装/便携发行产物的 Stable 签收。
- 保留开发分支 PR #2 的 Draft 状态，不合并、自动发布或向用户提供中途预览安装包。每一步只以执行证据描述结果，不能因为测试数量增加而错误宣布最终 Stable。

## 2026-10-09 · 并发受管恢复与同 URL 导航完整身份

### 受管修订：补丁批准和历史恢复共用脚本锁

- 问题：旧版本仅对 `createRepairWorkflow.apply()` 持有按 `scriptId` 的同步写锁，而 Electron 的 `usshm:rollback-managed` 直接调用独立的 `activateManagedRevision()`。在同一脚本补丁批准尚未完成归档、激活时，恢复操作可能交错写入 `current.user.js`。
- 修改：`createRepairWorkflow.restore()` 在首个异步文件操作前获取与 `apply()` 相同的脚本锁，并在 `finally` 释放；桌面恢复 IPC 统一调用 `repairs.restore()`。保留受管文件的原有 SHA-256、符号链接、外部修改拒绝以及明确批准机制，不修改用户源脚本。
- TDD：新增冲突恢复回归，先观察 Windows CI RED。随后修复桌面 wiring 测试中的旧路径断言。最终 [Windows CI #37888127532](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37888127532) 通过测试、TypeScript、Electron、真实 Chrome/Electron 冒烟验证。

### Chrome 页面：网址不变时也必须检查主文档生命周期

- 问题：原 `Page.getFrameTree` 比较 `target.id` 和顶层 URL，同网址重新加载会让旧快照被误认为属于新文档；批量分页只比较 URL/目标 ID，缺少跨页文档生命周期校验。
- 修改：`confirmPageIdentity()` 读取、限定并验证顶层 `frame.id` 和 `frame.loaderId`；缺少可信 loader 身份则 fail closed。`assertStablePageDocument()` 拒绝同网址重载与导航造成的文档变化。桌面单脚本 DOM 探针、单候选、批量候选均前后确认文档；批量脚本诊断逐次确认。
- 批量：对本次诊断顶层 Frame ID + Loader ID 生成 SHA-256 文档指纹，不在 GUI/报告暴露原始 CDP token；`collectPagedDomDiagnosis()` 跨 25 项批次检查指纹一致，变更后拒绝继续合并后续证据。测试覆盖空批次同 URL 变更、51 项跨页重载、缺少 Loader ID。
- RED→GREEN：新增的跨页指纹失败先行测试发现验证器遗漏解构 `pageDocumentToken`，修正后 [Windows CI #37888548480](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37888548480) 完成 224/224 测试及真实浏览器冒烟。
- 强化：添加缺少 Loader ID 时拒绝、真实 Chrome Loader ID 必须存在等回归；修正 Node.js strip-only TypeScript 测试 fixture 写法。最终源代码提交 `b1d3187909bd85f2fbc157f9d7845a6d303452cd` 对应 [Windows Development CI #37888753132](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37888753132)：**225 tests / 225 pass / 0 fail；TypeScript、Electron 构建、真实 GUI/SQLite、Chrome CDP 与合成用户脚本行为 smoke 均成功**。Linux 合同验证 [#37888757368](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37888757368) 同样成功。

### 未满足的 Stable release gates

- **未进行真实 Tampermonkey/GM_*、V3/V4 执行验证**；合成 fixture 的行为通过，不代表扩展注入、权限 API 或真实用户脚本成功。
- **未完成跨 iframe/ShadowRoot 的实际修复、AI Provider、安全语义修复、常驻健康守护，以及正式生产三格式 Windows 发行验收**。
- **未完成用户 Windows 10 x64 + 指定便携 Chrome 155 的组合验收，也未完成 RG-01…RG-09 全部独立安全/迁移/发行门禁**。
- **状态依旧：PR #2 Draft，未合并 `main`，没有创建中途安装包，没有发布 Stable，所有开发结果只按真实证据标记。**

## 2026-10-09 · Shadow DOM 只读上下文和故障误报抑制

- **QA-022 对应部分推进，仍非完成**：在 CDP DOMSnapshot 的 `documents[0].nodes.shadowRootType` 的有界 rare-string 索引中识别作者的 `open/closed` Shadow Tree，忽略 `user-agent` 根。只读取总量，严查无效索引、未知 root type、过大响应/节点数，不将 DOM 文本、表单内容或 Shadow DOM 本文暴露给 UI。CDP 规范字段来自 [Chrome DevTools Protocol DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/)。
- **批量诊断**：为每组 25 个脚本增加一次受控只读 DOM 概览，并再次验证真实 Frame + Loader ID；在顶层 `document` 零命中且页面作者 Shadow Tree 存在（或该证据无效/不可读）时，结果从 `locator-missing` 降级为 `needs-review`，`missing` 归零，`needsReview` 增加。若 iframe 与 Shadow DOM 都不确定，两者都在原因中注明；`@noframes` 只免除 iframe 不确定性，不误当作对 ShadowRoot 的豁免。
- **单脚本 UI 与 60 秒巡检**：显示 author Shadow Tree 节点数；单脚本旧定位器零命中时明确标为 `需复核（Shadow DOM）`；巡检汇总也降级为 `needs-review`，不把 ShadowRoot 误判为脚本业务失败。
- **真实 Chrome / Windows runner**：自建 localhost fixture 通过 `attachShadow({mode:'open'})` 生成目标，验证正常 `document.querySelector` 零命中而批量结果为 `needs-review`；后续同 fixture 加入 closed ShadowRoot 并要求 CDP 摘要识别 open/closed 的作者 Shadow Tree。无任何真实 Tampermonkey 插件安装、未知脚本执行、网站破坏性操作或用户账号访问。
- **TDD**：新增 snapshot、batch-dom、renderer 和监控回归。先推送失败用例（例如 Node 24 Task 1 contracts [RED #37890259354](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37890259354)），再实现。Windows [GREEN #37890573674](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37890573674) 已实证 **232/232 自动测试 PASS、TypeScript、Electron build、真实 Chrome CDP + 原有合成行为冒烟 PASS**。closed-root 和监控汇总新增回归需以本条文档之后的最终提交 CI 为准。

### 此切片尚未提供的能力

- **不进入开放或封闭的 ShadowRoot 执行选择器修复，不操作跨源 iframe，不验证事件/GM_*/真实扩展功能**。`needs-review` 是保守不确定性说明而非成功修复。
- 仍保持 `feat/v01-continuation` 开发分支 PR #2 为 Draft，不生成阶段性 Setup / Portable / ZIP 预览，不合并 main，不发布 Stable。Phase 7~12 与 RG-01…09 继续开放。

## 2026-10-09 · V0–V4 验证等级防误报与 Chrome 启动稳定性

- 新增 `packages/scan-service/src/verification-levels.ts`，给 `parsed/parse-error/unreadable/skipped` 和 read-only CDP DOM 证据生成保守的 V0–V4 状态矩阵。V1 的 `passed` 仅在 V0 parsed、检查量>0、全部定位器实际 DOM 匹配、计数一致且没有未确认节点时允许；top-document 缺失仅可标记 V1 failed，**不得自动推导为 V3 功能失败**。V2 永远 blocked，V3/V4 在没有可靠真实验证流程时始终 not-configured。
- JSON 静态报告 `schemaVersion` 从 1 递增到 2，逐脚本导出 `verification` 对象；Markdown 增加 V0–V4 五列。历史格式 v1 仍能由用户自行保留（本版本没有内建 v1->v2 导入程序）；若已有外部脚本消费该 JSON 需按 v2 结构二次适配。原始 `.user.js` 文件和用户扩展储存未被修改。
- 批量 CDP 诊断的每行新增证据等级字段，桌面表格直接展示 V0/V1/V2/V3/V4；GUI 不展示没有发生过的 manager、GM_* 和业务功能通过状态。
- 已添加状态矩阵、静态导出和批量 DOM 凭证的自动回归，作为 FR-024 的初始闭环。**尚未**提供安全 V2 交互/可见性实验、命名 V3 功能契约或真实 V4 Tampermonkey manager bridge，因此 FR-024 全面验收仍未通过。
- `scripts/smoke-chrome.mjs` 对 GitHub Windows runner 的随机冷启动耗时延长 CDP 握手预算，并在失败时报告子进程异常、页面数量、握手失败原因，不降低任何真实 Frame/Loader 验证门槛。一次 Windows CI [#37891196969](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37891196969) 证明 **241/241 单测、TypeScript、Electron 构建与 GUI smoke 通过**，但隔离 Chrome 首次未暴露目标（启动超时），故该运行整体标为 FAILURE；不能伪装为 Chrome 验证已通过。修复后的最终状态须以下一份 green run 为准。
- 仍然不触发 `windows-build.yml` 三包中途安装器，不自动合并 PR，不创建 Stable Release。

## 2026-10-09 · 证据等级与可暂停的批量 DOM 任务

### P0 验证等级投影（FR-024 部分）

- 新增 `packages/scan-service/src/verification-levels.ts`：不让 V0 静态解析或 V1 只读 DOM 匹配自动晋升 V2/V3/V4，保留 `passed/failed/skipped/blocked/not-configured` 语义。V1 pass 需要 V0 parsed、完整的有界匹配计数；V1 missing 只能说明 DOM 依赖缺失，不能当作业务功能 V3 失败。
- `packages/reporting/src/index.ts` JSON schemaVersion 2 与 Markdown 增加逐脚本 V0–V4 元数据；`packages/scan-service/src/batch-dom.ts` 及 React 表格展示只读诊断等级。真正可交互测试、业务级命名用例和实际 Tampermonkey manager V4 仍未实现。

### P0 批量暂停、恢复和取消（FR-029 部分）

- `packages/scan-service/src/pause-gate.ts` 使用一次性批次私有的 `BatchPauseGate`，不忙等；`collectPagedDomDiagnosis` 在新 CDP request 前等待恢复或取消，已经进行中的 25 脚本读请求不假装可以被立即中断。
- React 增加「暂停后续检查／继续检查」按钮，取消时唤醒所有等待项。target/scan 更换时撤销旧 gate 和旧结果，旧 `finally` 不得清掉新批次 Busy。
- TDD RED #37891646689（缺少 gate 模块）、#37891739200（暂停后仍请求下一页）、#37891885709（缺少 UI）、#37892011577（快速 resume→pause 竞争确认为失败；同时发现旧 UI wiring 正则）。同步修复 `waitUntilReady` 重醒后必须重新确认 `paused` 和旧测试中过时的 `finally` 约束。

### 真实 Windows 验证

- [Development CI #37892250053](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37892250053) 对代码和 README 提交 `985f84e73ee1f360a4324c3bae72dfe9c36e938b`：**247/247 tests PASS、0 fail、TypeScript PASS、Electron build PASS、真实 Windows GUI+SQLite smoke PASS、真实 Chrome CDP+合成行为 smoke PASS**。
- [Task 1 contracts #37892250268](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37892250268) 同 SHA PASS。
- 无中途 Windows 安装/便携构建产物、无真正 Tampermonkey/GM_* V4、未合并 main、无 Stable release。FR-029 的完整任务持久化／失败项重试／跨重启恢复和 Phase7–12 RG-01…09 继续未满足。

## 2026-10-09 · 批量 DOM 报告隐私导出

- Ruling: 先交付可验证的脱敏报告格式和当前扫描身份绑定，再评估 SQLite 跨重启审计持久化；避免在尚无安全迁移/回滚测试的前提下变更已存在的 schema v1 数据库。
- `packages/reporting/src/dom-report.ts` 新增只读 DOM 诊断 JSON schemaVersion 1 与 Markdown 报告：保留状态/计数/V0-V4/脚本 basename + 网站 origin；不输出页面查询参数、fragment、原始 DOM、脚本源文件、完整绝对路径、CDP `pageDocumentToken`、错误 reason。拒绝非法 URL、伪造 V3/V4 passed、V2 passed、行序/计数不一致以及超过 1000 行。
- Electron 新增 `usshm:export-dom-report`、预加载白名单和 UI 按钮，仅接受当前 `scanId` 下的连续行，逐项匹配 `scriptId` 与扫描源 `path` 后从可信主进程弹出 OS SaveDialog；写盘前再次确认扫描未被切换。没有 renderer 自定义任意目的路径。
- CI 前失败测试验证了功能尚不存在；提交 `84e79f4f466e057574c98e4ad400f63240352b63` 对应 [Windows Development CI #37894115064](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37894115064)：**256 tests / 256 pass / 0 fail、TypeScript、Electron build、GUI SQLite + 真实 Chrome CDP 冒烟成功**；[Node contracts CI #37894122129](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37894122129) 成功。
- 限制：DOM 报告为当前会话数据快照，不是完整的任务持久化、GM manager 验证、功能测试或自动修复证书。Stable Release Gate 保持开放，不合并 main、不生成中途预览安装包。

## 2026-10-09 · 批量报告可信主进程边界

- 进一步安全审查发现：初版 DOM 报告导出虽然会脱敏并验证脚本行路径，IPC 仍接受 renderer 传入的 `verification` 状态。renderer 若受污染，就可能伪造 V1 `passed` 并输出未经真实诊断的报告。此问题触发修复，不视为 Stable 合格。
- 新增 `packages/scan-service/src/batch-evidence-store.ts`：只有 Electron main 内由 `diagnoseScriptsOnPage` 实际返回的 CDP 结果才能记入；绑定当前 scanId、targetId、URL、SHA-256 Frame/Loader 指纹、严格每页 25 脚本的顺序和已检查行数。不同 URL、同 URL 页面重载、跨扫描或分页错序都会拒绝并使既有证据失效。新的静态扫描立即清除旧证据。
- 改造 `usshm:export-dom-report`：renderer/preload 只提交当前 scanId、targetId 和 JSON/Markdown 格式，不能提供 `report`、`path` 或 V0–V4 状态。主进程只导出自己缓存的、与当前脚本 identity 一一匹配的可信记录；显示保存对话框后再次验证扫描仍然有效。
- 新增自动测试验证分页累积、同 URL reload 后旧证据失效、跨 scanId/targetId 拒绝和不允许 renderer 提交自称 V1 通过的数据。
- [Windows CI #37894568687](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37894568687) 对提交 `290a92068b49537597458d5ccabe965d8e65da56` 验证 **261/261 tests PASS、TypeScript、Electron Build、真实 Windows GUI+SQLite 启动、Chrome CDP+合成业务 smoke PASS**。
- 本轮没有运行正式 Windows 三包构建；尚无 V2/V3/V4 真环境用户脚本经理验证，也未合并 main 或标记 Stable。

## 2026-10-09 · DOM 报告并发安全与旧扫描失效

- 新增导出证据单调 revision：每次记录新的真实 CDP 批次与显式 invalidation 都递增。打开系统保存对话框前后两次校验同一 `scanId`、`targetId` 与 revision；若其间产生新诊断或取消过期，拒绝写出旧的 report bytes。
- 对主进程批量诊断加入 fail-closed 证据失效：任何 CDP 身份问题、脚本 batch 诊断异常或扫描状态过期都不能保留本次任务的旧报告。
- 排错发现极端竞争：旧扫描的异步失败会在新扫描已经产生有效证据后触发 `catch`。因此不能无条件 `clear()`，改为 `invalidateIfCurrent({scanId,targetId})`，仅清除失败操作自己仍拥有的批次。新增旧 scan、不同 target、不连续页、同 URL reload、重入保存对话框和版本递增测试。
- [Windows Development CI #37895015454](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37895015454) 对源码提交 `c67d322b93731252dba84b1d0f7cfcb3f6f52141`：**264/264 tests PASS、TypeScript PASS、Electron build PASS、真实 Windows GUI/SQLite smoke PASS、真实 Chrome CDP 合成行为测试 PASS**。Task 1 contracts #37895020261 亦已通过。
- 此模块仅存当前运行的最近一次已授权扫描证据，尚无跨重启完整任务审计/站点历史。FR-029、FR-040/041 和 Phase7–12 仍未全部完成；严格保持 PR #2 为 Draft，不制作预览安装包、不提前 Stable 发布。

## 2026-10-09 · Electron IPC CDP 重试真实错误包装

- 代码审阅发现 `collectPagedDomDiagnosis` 的可重试白名单此前只匹配原生 `CDP page identity timeout` 等错误，但 Electron `ipcRenderer.invoke` 实际会包裹为 `Error invoking remote method 'usshm:batch-diagnose': Error: CDP page identity timeout`，造成用户界面已显示「临时通信重试一次」但真实 IPC 无法触发。
- TDD：添加严格的 Electron 包装错误回归以及反例（任意其他 IPC 方法、同 URL navigation 身份变化、尾随未知错误文本一律不可重试）。[RED Node contract #37895463968](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37895463968) 确认原实现确实无法重试。
- 修复 `packages/scan-service/src/paginated-dom.ts`：只剥离固定 `usshm:batch-diagnose` 的标准 Electron Error envelope，再匹配完整、精确的短暂只读 CDP 错误白名单；不拓宽身份/权限/页面内容错误的可重试范围，且总重试预算仍为 1。
- [GREEN Windows CI #37895542276](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37895542276) 对提交 `51174cd290b552a65e2b46bca6947d2844c34294`：**266 tests / 266 pass / 0 fail，TypeScript、Electron build、真实 GUI/SQLite 和真实 Chrome CDP 合成行为 smoke 通过**。Node contract [#37895546571](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37895546571) 也成功。
- 仍没有真实 Tampermonkey/GM API 交互证明、V3 用户定义功能契约和 V4 manager 验证；本开发切片不代表 Final Stable，禁止自动合并或发行。

## 2026-10-09 · 异步定位器复查与命名 DOM 合约

### 异步定位器只读二次采样

- 对 `diagnoseScriptsOnPage()` 添加注入式 `waitBeforeMissingRecheck`，只对首次顶层文档静态定位器零命中进行一次等待与第二次 CDP DOM 查询。每个动作前后必须核对已确认的 Frame/Loader；同 URL reload 或导航直接抛出并拒绝沿用旧证据。
- Electron main 的真实批量入口启用 750ms 定时等待；第一次丢失、第二次出现将被修正为 `dom-present`，连续两次丢失保持 `locator-missing`（**仍只是 DOM/V1 状态**）。等待、第二次读取失败或结果形状不可信变成 `needs-review`，不能当作脚本功能缺陷。
- **TDD RED** [#37896138518](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37896138518) 记录缺少二次采样时的 4 项失败，另 [#37896290407](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37896290407) 记录 main handler 尚未启用的失败；**GREEN** [Windows CI #37896356525](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37896356525) **271/271 tests，TypeScript/Electron、真实 Windows GUI/SQLite 与隔离 Chrome CDP 冒烟成功**。

### 命名、明确授权的双样本 DOM 合约

- 新增 Superpowers [实施切片计划](../superpowers/plans/2026-10-09-read-only-dom-contracts.md)、`packages/test-runner/src/index.ts`，仅允许基于已导入、已静态解析、属于当前授权浏览页面的 document-scoped literal locator，对 `exists`（至少一个）或 `unique`（恰好一个）做两次 read-only CDP 采样。
- 相同 Frame/Loader、相同 match count 且满足断言才标记该 **V1 命名 DOM 断言** `passed`；两次一致的空结果/多重匹配可标 DOM-only `failed`；数量跳变、CDP 读取失败、结果不可信则 `needs-review`，同 URL 页面重载直接拒绝。所有返回结果固定 `V2=blocked`、`V3/V4=not-configured`、`functionalVerified=false`、`managerVerified=false`。
- 新 Electron `usshm:run-dom-contract` 只接受当前扫描 script/selector 索引、显式 target、exists/unique 和运行批准，不接收 renderer 自构造选择器或 JavaScript。Preload 添加有限 typed bridge，GUI 增加 `双次 DOM 合约核验（V1，只读）` 及合约结果展示；真实 Chrome 合成 fixture 验证 `#heal-button` 唯一匹配两次通过，但不执行真实用户脚本。
- **TDD RED** [#37896718268](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37896718268) 确认执行模块缺失；[#37897048977](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37897048977) 确认桌面入口缺失；**GREEN** [Windows CI #37897269119](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37897269119)：**280/280 tests，TypeScript + Electron Build + real Windows GUI/SQLite + real Chrome CDP smoke PASS**。未运行或标称 V2 安全交互、V3 业务合约或 V4 Tampermonkey/GM_*。

### Remaining Stable gaps

- FR-025 仍缺安全的 visibility/interactable/assertion-change/cleanup、站点上下文、授权非破坏性事件测试以及 V3 真正业务契约；管理器 V4 和 Windows10+指定 Chrome155 portable 仍需独立真实验证。没有制作中途 Windows 三包、合并 main 或发布 Stable。

## 2026-10-09 · 本地 SQLite 诊断历史

- **Ruling：单独建库而不触碰既有脚本资料库**。旧 `registry.sqlite` schema v1 不做结构更改；新增 `diagnosis-journal.sqlite` 在已授权的应用 Data root 存有限诊断历史，兼容 Installed/Portable 数据根路径逻辑。代价是独立数据库与暂未实现跨重启继续执行。
- **持久安全证据**：`packages/job-journal/src/index.ts` 通过 Node SQLite WAL、FK、BEGIN IMMEDIATE/COMMIT/Rollback，要求每页最多25项连续 index/offset/验证等级约束，按 SHA-256 的 scan+target session key 和重新哈希的 Frame/Loader 文档 token 进行批次身份核对；仅保存页面 origin、行序、状态与计数、V0/V1，禁止原始脚本名、源码、完整磁盘路径、DOM、页面 query/hash、CDP raw token 落盘。限制最大 1000/任务和保留最近 200 runs。
- **重启安全**：应用重启时旧 `running` 标为 `interrupted`，不自动重连旧 Chrome 标签。拒绝未来 schema 版本（不危险降级）。每个脚本历史行可只读复核，但仍然只是 V0/V1，不是 Tampermonkey 真实运行证明。
- **Electron**：启动时独立开启 job journal，`before-quit` 关闭；每批由可信 main CDP 诊断并经 `BatchEvidenceStore` 校验后才落盘；失败时只对当前 run 标记 failed。新增最小化 `usshm:diagnosis-history`、`usshm:diagnosis-cancel`，preload 只能列出已脱敏的历史汇总、取消当前受控任务。React 显示本地最近诊断历史、断开/失败/取消/完成和项数。
- **TDD RED** [#37897725218](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37897725218) 缺少 job journal 源码；[#37898008930](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37898008930) 缺少 Electron/UI 接线；更新旧回归中与可信证据失效捕获代码的过期正则，但保留原始语义断言。
- **GREEN** [Windows CI #37898342762](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37898342762)，提交 `b34ad49338af1fe2ade8445cfc0c15b419f74373`：**288/288 tests / 0 failures，TypeScript/Electron build、真实 Windows GUI+SQLite/duplicate-instance、真实隔离 Chrome CDP 冒烟 PASS**；Node contract [#37898342771](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37898342771) 成功。
- **仍不符合 Stable**：历史查看不等于持久 job queue/断点安全重跑，缺少版本化 SiteAdapter、真正 V2/V3/V4 实际功能合约、长期后台监控和完整 Windows 三种最终发行/迁移门禁。PR #2 继续 Draft，无中途安装预览。

## 2026-10-09 · Stable 续接：只读 CSS、站点趋势与嵌套上下文假阴性

- 从已签收的独立 SQLite journal 继续，确认新静态扫描调用 `journal.interruptRunning()`，未完成历史从 `running` 变 `interrupted`，旧行不删。对当前开发 SHA `14e6a26a6ea0dfa8eaac85ddf796ff219532d099` 的 [Windows CI #37899477746](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37899477746) 已确认 **297/297 test PASS**、构建、真实 Windows GUI/SQLite 与隔离 Chrome CDP 冒烟通过。

### CSS/盒模型只读可见性：已有 CDP 实现的真实桌面接口

- **TDD RED：** [Task 1 #37899914175](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37899914175) 确认缺少 `usshm:read-only-visibility` 主进程授权 IPC 与 GUI/preload 接口；旧 identity 静态接线测试随新路由插入产生误判，改为精确截取原 `probe-locators` handler，保留“每个操作前后两次页面身份确认”的核心断言。
- **实现：** main 只接受已扫描 script/selector 索引、当前用户批准的 target、支持的顶层静态定位器，并对 URL 作用域和 Frame/Loader 进行前后核验；通过安全 CDP DOM/CSS 方法采集盒模型及有限 computedStyle。preload 固定 allowlist，GUI 展示 `potentially-visible/hidden/missing/ambiguous/unknown`、匹配量和 pointer-events，不会升级 V2。真实 localhost Chrome 测试 `#heal-button` 的 CSS/box 可见性。
- **GREEN：** [Windows CI #37900245565](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37900245565) **299/299 tests / 0 failed**、TypeScript/Electron、真 GUI/SQLite 与隔离 Chrome CDP smoke 成功。`potentially-visible` 只是只读布局迹象，祖先不可见/遮挡/用户脚本状态和事件效果皆未验证。

### 站点诊断趋势：只比较真正可比的历史批次

- **TDD RED：** [Task 1 #37900545748](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37900545748) 缺少站点趋势分析模块。
- 新增 `packages/job-journal/src/trends.ts`：按 origin 保留最近两次记录。仅当二者 `completed` 且导入数量一致、进度完整时比较 top-document DOM 缺失计数，输出增加/减少/无变化；中断、取消、失败、数量不同或历史不足都只给 `not-comparable/insufficient-history`。不输出 URL 查询、完整路径、用户脚本内容，也不能声称网站实际更新。
- React 本地历史界面加入「最近站点诊断趋势」表格及可比性说明；不运行新 DOM 请求、不访问外部网站。
- **GREEN：** [Windows CI #37900730105](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37900730105) **305/305 tests PASS**、TypeScript/Electron、真 Windows GUI/SQLite 和隔离 Chrome CDP smoke 成功。

### 命名只读 DOM 合约的 iframe/ShadowRoot 假阴性修复

- **TDD RED：** [Task 1 #37900977124](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37900977124) 用双采样零匹配证明原合约会忽略作者 Shadow DOM、iframe 与不可读上下文，误标 DOM-only `failed`；[Task 1 #37901093816](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37901093816) 验证 Electron 主进程尚未调用 `captureDomSummary`。
- 修正 `runReadOnlyDomContract`：即使两个顶层样本都零匹配，也只有实际确认**没有嵌套 iframe 且作者 Shadow DOM 节点为零**时才能返回 V1-only `failed`；有子框架、ShadowRoot 或上下文证据未知则改 `needs-review`，拒绝将局部未命中当作整个用户脚本故障。snapshot 前后 Frame/Loader 始终必须稳定。为 Chrome localhost fixture 增加 ShadowRoot-only 真实集成断言。
- **GREEN：** [Windows CI #37901208436](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37901208436) **310/310 tests / 0 failed**，TypeScript、Electron build、Windows GUI/SQLite 和真实隔离 Chrome CDP 集成成功。

### Release Gate remains open

- 这些新增检查**最多是 V1/只读 CSS 布局证据**。未实现真实 `GM_*` / Tampermonkey V4 证明、独立 V3 业务断言、完整 V2 安全交互测试、站点语义兼容与自动修复、Win10 便携 Chrome155 组合真机、正式三个包及全部 RG-01…09。
- 继续保留 PR #2 Draft、源码开发分支 `feat/v01-continuation`，不在中途构建或上传 Setup/Portable/ZIP 预览包，不合并 main，也不创建 Stable Release。

## 2026-10-09 · CDP 不可信 selector 结果与 CSS 嵌套上下文修复（316 项）

### Slice A — CDP DOM.querySelectorAll 证据强校验

- **RED：** [Node contracts #37904276929](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904276929) 在新加的三组测试中确实记录 **313 tests / 3 failures**：旧实现允许重复/非法 nodeId、超过 1.2 MiB 的单条响应和超过 10,000 个 selector 节点被当作可信证据。
- **GREEN：** `packages/cdp-client/src/locator-probe.ts` 限制单条响应最多 1,000,000 字符；只接受唯一、合法的正安全整数 nodeId，每个选择器最多 10,000 项；拒绝重复 `DOM.getDocument` 根回复、防止重复调度。保留错误 CSS 可标记 blocked，不执行任何网页 JavaScript。
- 添加重复根回复回归后，[Windows CI #37904463501](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904463501) SUCCESS；Node contracts [#37904463506](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904463506) SUCCESS。

### Slice B — 只读 CSS 可见性失配时的真实嵌套 DOM 守门

- **RED：** [Node contracts #37904619936](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904619936) 在 `qualifyTopDocumentVisibility` 尚未实现、桌面主进程尚未采集 DOMSnapshot 上下文时，新增针对 iframe/ShadowRoot 的测试无法通过。
- **GREEN：** `qualifyTopDocumentVisibility` 只允许在零子 Frame 且明确检出零作者 ShadowRoot 的上下文中保留 `missing`；iframe/ShadowRoot/快照不可用时降级为 `unknown`，matchCount 为 null。其他 DOM 可见性检查不被误改，`V2=blocked`、`V3/V4=not-configured` 不变。
- Electron `usshm:read-only-visibility` 在 DOM 只读结果为 missing 时额外采集有界 `DOMSnapshot`，随后检查当前 Frame/Loader 文档身份与 scanId。失败的上下文采样不会使顶层未命中被认定为确定缺失。
- Windows Chrome 真实 `#shadow-only` 合成 ShadowRoot fixture：顶层只读 CSS 查询返回 missing，识别作者 ShadowRoot 后，面向 UI 的资格化结果变成 unknown。没有在 Shadow DOM 中擅自运行用户脚本。
- **最终源码/测试 GREEN：** [Windows Development CI #37904827283](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904827283) **316/316 tests PASS、0 failures、TypeScript PASS、Electron bundle PASS、Windows GUI+SQLite smoke PASS、真实 Chrome CDP + ShadowRoot smoke PASS**；[Node contracts #37904827267](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37904827267) SUCCESS。

### Release decision

两个切片减少了错误 DOM 证据和误报，不构成真实 Tampermonkey 注入/GM_* 兼容性、V3 业务功能合约、V4 插件运行、用户 Windows10 + 便携 Chrome 155 实机或 RG-01…09 已完成的证明。**仍为 Draft，不合并 main、不标 Stable、不生成中途预览安装包。**

## 2026-10-09 · Chrome 远程调试发现入口的流式有界读取（317 项）

- **RED:** [Node contracts #37905313665](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37905313665) 实测旧 `getChromeStatus()` 对 `/json/version`、`/json/list` 的大 JSON 响应及超过 256 个标签页缺乏限制，新测试无法通过。
- **GREEN:** `packages/cdp-client/src/index.ts` 把原先直接 `response.json()` 改为 `ReadableStream` 增量解码，`/json/version` 最大 64,000 bytes，`/json/list` 最大 1,000,000 bytes；如果超出预算立即取消读取，合法 JSON 才会解析。单次最多接受 256 个 debugger targets；Browser、page ID、URL 字符上限，继续沿用 localhost 及 WebSocket port/path identity 白名单。
- **验证:** [Windows Development CI #37905377547](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37905377547) 对源码提交 `ba966bcab072097d35e4221ba883ddb67e884904` **317/317 tests PASS，TypeScript PASS，Electron build PASS，真实 Windows GUI/SQLite 与 Chrome CDP smoke PASS**；[Node contracts #37905377522](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37905377522) PASS。
- **剩余:** 本项仅封闭本地 debugger HTTP JSON 无界读，不提供扩展/GM API 行为证据，用户 Windows10 + Chrome155 portable、V3/V4 与最终发版 RG-01…09 继续未满足。继续 Draft、未合并、无中途预览安装包。

## 2026-10-09 · Chrome 启动真 CDP 握手与端口占用防错认（324 项）

- **问题：** 过去 `launchSelectedChrome()` 仅等待 Node 的 ChildProcess `spawn`，Chrome 136+ 如果忽略默认 Profile 的调试参数，依然可能让 Electron 报“已启动”，实际无 CDP 可用；如果 localhost 9223 已被其他服务占用，还可能错误认领旧连接。
- **TDD RED：** [Task 1 contracts #37906278078](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37906278078) 与开发 CI 记录缺乏端口预检、启动后的 CDP 就绪证据；新增 Browser WebSocket 真实协议认证之前，[#37907033294](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37907033294) 亦验证不存在真实 `Browser.getVersion` 校验。
- **实现：** `packages/cdp-client/src/index.ts` 新增 `assertChromeDebuggerPortFree()`，仅检测绑定 `127.0.0.1` 的选定端口，并在任何 spawn 之前拒绝端口已被占用的情形。`waitForChromeDebugger()` 在最多 15 秒内轮询有限 HTTP CDP 发现接口，对 Browser WebSocket 再独立执行 `Browser.getVersion`；只接受真实 CDP Chrome/Chromium/HeadlessChrome 产品与 HTTP 浏览器标识完全一致的只读回复。Chrome 进程提前退出、HTTP/WebSocket 错误和拒绝握手均不返回成功，不向正式 GUI 提供任意 JS 执行入口。
- **前端：** 成功反馈从“只请求启动，待用户再检查握手”改成“CDP 握手已验证，可以刷新网页列表”；出错则仍停在 `catch`，不声称成功。
- **真实自动化：** 在 Windows Hosted Runner 的真实外部 Chrome（隔离 Profile + localhost fixture）中执行新增 `Browser.getVersion` 验证和端口已占用拒绝测试；不下载 Tampermonkey，不执行实际用户脚本，不制作 Setup/Portable/ZIP 中途安装包。
- **GREEN：** 先 [Windows CI #37906398786](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37906398786) **320/320**，再 [#37906703581](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37906703581) **321/321**。新增 WebSocket 反例及修复 Node strip-only 测试兼容后，最终 [Windows CI #37907262155](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37907262155) **324/324 tests PASS、TypeScript/Electron build PASS、真实 GUI/SQLite 启动与 Chrome CDP smoke PASS**，[Node contracts #37907262101](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37907262101) SUCCESS。
- **明确边界：** CDP 协议握手不证明所启动可执行文件就是用户特定 Chrome155，也不证明 Tampermonkey `GM_*`、V3/V4 行为或安全自动语义修复。Windows10+指定便携 Chrome、发行签名及 RG-01…09 仍开放，PR 继续 Draft，不合并主分支、不发布 Stable。

## 2026-10-09 · SiteAdapter 版本化角色核心与依赖影响分析（332 项）

- **背景：** PRD FR-033/034 要求 SiteAdapter role/locator fallback/frame/shadow/状态规则和升级前的依赖影响分析。此前仓库只有基础 DOM 候选排名与显式用户脚本 scope，没有版本化站点兼容契约，因此不能预先限制共享角色变化的潜在影响。
- **TDD RED:** 在 GitHub Windows/Node contracts [#37908035768](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908035768) 新增 6 类回归，证明 SiteAdapter 文件/功能缺失；对接当前候选引擎之前，另 [#37908611305](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908611305) 证明缺少角色约束建议的入口。
- **Core：** `packages/candidate-engine/src/site-adapter.ts` 严格校验版本号、siteId、指定来源 URL pattern、最多 16 个页面状态、50 个语义角色、受控 top/iframe 和 open ShadowRoot 上下文、最多 10 个只读固定 CSS 策略、唯一性及 exists 断言、有限 regression cases。拒绝额外字段、无效版本、跨站全域匹配、重复策略与原型污染键。
- **Scope：** 用现有 fail-closed `checkUserscriptPageScope` 判断页面 URL。只有匹配指定站点、已知页面状态且声明角色位于 top document、shadow=none 才可返回定义级候选；iframe、ShadowRoot、未知页面状态一律 `blocked-context`，不擅自跨上下文查询。
- **Repair integration：** `packages/candidate-engine/src/workflow.ts` 新增 `suggestAdapterScopedRepairs`。先解析和确认 SiteAdapter 的 role scope，再启动现有动态 DOM candidate check；只返回角色策略白名单内且在真实 DOM 中唯一命中的建议。候选始终 `approved=false`，无直接写原文件，无 V3/V4 功能验收声称。
- **影响分析：** `assessSiteAdapterUpgrade` 严格要求同 siteId、递增 semver；比较角色及其关联状态定义，列出被影响的固定版本依赖脚本和交叉回归用例，删除现有依赖角色时 `blocked-removal`，`autoActivateAllowed=false` 始终生效。只做审查计划，不执行兼容层代码动态加载/升级。
- **修复严谨性：** 首轮测试显示 camelCase 的语义 role ID 被误拒绝，已修正；后续 330 项测试成功但 TypeScript 严格检查指出隐式 any，已修复。最终 [Windows Development CI #37908657021](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908657021)：**332/332 tests、0 fail、TypeScript、Electron 构建、Windows GUI/SQLite 和真实 Chrome CDP smoke 全通过**；[Node contracts #37908657118](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37908657118) SUCCESS。
- **Stable 仍有门禁：** 本切片仅 SiteAdapter 的独立、可复用、只读定义级核心，尚未完成 GUI 文件管理、真实站点多框架检测、共享兼容脚本注入、GM_* V4、V3 业务契约、用户 Windows10+便携 Chrome155、RG-01…09。PR #2 保留 Draft；不合并 main、不发布 Stable、不生成中途安装包。

## 2026-10-09 · SiteAdapter GUI：本地 JSON 审查式导入与不可覆盖存储（342 项）

- **产品缺口：** 上一批仅完成 `parseSiteAdapter / resolveSiteAdapterRole / assessSiteAdapterUpgrade / suggestAdapterScopedRepairs`，没有持久 SiteAdapter 文件导入，也没有可供用户查看本地规则的 Electron GUI。现在新增最小的真实管理路径，但没有宣称完整 FR-033/034 及功能修复验收。
- **RED:** [Node contracts #37909418536](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37909418536) 新增 store 测试时缺少 `site-adapter-library.ts`，验证了尚未实现；[Node contracts #37909620308](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37909620308) 证明 Electron IPC/preload/UI 入口缺失；[Node contracts #37910164611](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37910164611) 证明取消旧预览后临时槽位不释放。
- **本地持久库：** `packages/candidate-engine/src/site-adapter-library.ts`。导入源只能来自 main 自己启动的操作系统 JSON 文件选择器。普通文件最大 65,536 bytes，验证 UTF-8、严格 Schema、源哈希和文件身份；先生成不可猜测的 previewId，未经 `approved:true` 一律不写入。本地 `Data/site-adapters/{siteId}.json` 使用独占新建 `wx` 并写盘同步，保证已保存站点文件不会被静默覆盖；导入结果不包含原始外部源路径。复核时禁止 symlink/目录、畸形/过长内容和文件名/siteId 失配。
- **安全升级边界：** 依赖脚本发现尚未完整接入，现阶段拒绝对已有 siteId 升级/覆盖，也不自动加载规则或触发浏览器行为。应用退出后会保留经批准的新定义；单次未批准预览只存在内存，取消时能正确回收并禁止复用。
- **主进程/预加载：** `usshm:site-adapters`、`usshm:site-adapter-import-preview`、`usshm:site-adapter-import-approve`、`usshm:site-adapter-import-discard` 均检查 IPC sender。renderer 没有来源文件路径参数及未校验规则的任意写盘能力。
- **GUI：** 新增「版本化站点兼容规则（SiteAdapter）」区域，显示本地已安装定义，使用两阶段预览/确认/取消。清楚标示“仅定义”“未经过真实脚本运行或功能验证”和 V3/V4 未配置。不会直接修改原始用户脚本、Tampermonkey 存储或 Chrome Profile。
- **最终 GREEN:** [Windows Development CI #37910328861](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37910328861) **342 tests/342 pass/0 fail，TypeScript/Electron、Windows GUI/SQLite、真实 Chrome CDP synthetic smoke 全通过**；[Node contracts #37910328893](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37910328893) SUCCESS。
- **发行未满足：** SiteAdapter 的 GUI 版本/依赖回滚、实际站点契约/脚本经理 V4、`GM_*` 真机、Windows10+便携 Chrome155、正式三形式发行和 RG-01…09 仍未完成。保持 PR #2 Draft，不中途打包或宣称 Stable。

## 2026-10-09 · 已安装 SiteAdapter 的只读 V1 语义角色核验（349 项）

- **问题：** SiteAdapter 的规则定义已可保存在 `Data/site-adapters`，但无法使用桌面工具将用户声明的角色、页面状态和真实 DOM 证据对应起来。此前只有通用脚本 selector 的 V1 合约，不检查用户导入的 site/role fallback 定义。
- **TDD RED：** [Node contracts #37911119660](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911119660) 验证缺少 `runSiteAdapterRoleDomCheck`；[#37911333463](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911333463) 验证存储库尚不能仅凭站点 ID 安全检索已保存角色/状态。新增 Electron IPC 合约测试覆盖 main/preload/renderer，真实 Chrome 合成网页验证 read-only V1 路径。
- **角色检查：** `packages/test-runner/src/site-adapter-role.ts` 仅对 `resolveSiteAdapterRole` 允许的目标发起 CDP，强制手动确认、主文档 frame+loader 身份并在两次 DOM 采样间确认页面未导航。CSS fallback 使用 `DOM.querySelectorAll` 的只读证据；匹配必须稳定，且不允许多条 fallback 同时命中就宣告无歧义。没有命中时若 iframe、ShadowRoot 或上下文证据未知，则 `needs-review`，并不宣告脚本坏掉。
- **持久规则：** `site-adapter-library.ts` 额外提供固定目录内的 `getForInspection({siteId})`，严格校验站点标识、重读 Schema 和文件名身份。列表只展示受控 roleIds/stateIds，renderer 不可传任意 CSS、原始规则对象或文件路径。
- **Electron：** `usshm:site-adapter-role-check` 必须具备 `approved:true`、准确 targetId、siteId、roleId 和用户声明 stateId。由主进程加载可信已存定义和当前 CDP target，再执行固定的 read-only `confirmPageIdentity`、`probePageLocators`、`captureDomSummary`。未开放 Runtime.evaluate、点击或对油猴脚本的任意调用。
- **GUI：** SiteAdapter 工作区新增站点、角色、状态选择器和「检查 SiteAdapter 角色 DOM（只读）」；页面状态明确是用户声明，不能视作真实网页登录/运行状态。切换目标或规则时失效旧异步结果。V1 仅证明此刻受限 DOM 选择器的匹配数量，不证明真实业务功能。
- **真实 Chrome 验证：** `scripts/smoke-chrome.mjs` 添加真实 Windows Runner 上的本机隔离 Chrome fixture 测试：顶层 role 唯一匹配可得 `matched-v1`，只位于 ShadowRoot 内的定位器必须 `needs-review`；始终 `V3/V4=not-configured`。
- **GREEN：** [Windows Development CI #37911811189](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911811189) **349 tests, 349 PASS, 0 FAIL**，TypeScript、Electron 构建、Windows GUI/SQLite smoke、真实 Chrome CDP smoke 全成功；[Node Contracts #37911811075](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37911811075) 成功。
- **未完成 Stable 门禁：** 用户声明的页面状态并非真实观测/认证、缺少 iframe/Shadow 扩展支持、V2 交互/非破坏性断言、V3 业务层、真正 Tampermonkey/GM_* V4、Win10 便携 Chrome155 真机和 RG-01...09 正式三发行包验收。保持 PR #2 Draft，不合并 main，不发布 Stable，不生成中途包。

## 2026-10-09 · SiteAdapter 规则完整性、文件替换竞态与审查版本锁定（352 项）

- **发现风险：** UI 列出已保存 SiteAdapter 角色之后，磁盘中的 `Data/site-adapters/{siteId}.json` 可能被其他进程替换或修改。此前主进程仅凭 `siteId` 读取当时的最新文件并执行真实 CDP V1 检查，可能使用用户在 UI 中未查看过的新规则。
- **TDD RED:** [Node Contracts #37912627498](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37912627498) 的新用例要求站点检查必须携带 UI 已展示的哈希，磁盘文件即使仍是合法 Schema、相同 siteId 但策略不同也必须拒绝，并拒绝缺失、错误长度和不匹配的摘要。
- **修复：** `createSiteAdapterLibrary().getForInspection({siteId,expectedSha256})` 强制检查小写 64 位 SHA-256 和文件实际内容哈希；`usshm:site-adapter-role-check` 在 main 验证该参数，preload 声明显式接收，renderer 从 `selectedAdapter.sha256` 发送。变更后不自动刷新、自动批准或悄然切换新规则；用户必须回到规则列表重新检查。
- **安全读取：** `regularBounded` 不再 lstat 后又通过路径做无界 readFile。改为打开**同一个文件描述符**，POSIX 等支持的平台启用 O_NOFOLLOW；读前后比对路径/FD 类型、inode、device、size 和 mtime，限制大小不超过 65,536 bytes。Windows 上仍依赖文件身份与权限校验，**不宣称彻底消除所有目录替换竞态**。
- **GREEN 证据：** 最新源码 [Windows Development CI #37912842330](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37912842330) **352 tests / 352 pass / 0 fail**，严格 TypeScript、Electron 构建、Windows GUI/SQLite、真实隔离 Chrome CDP smoke 均 PASS；[Node contracts #37912842249](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37912842249) SUCCESS。
- **Stable 不变：** SiteAdapter 规则版本保护仅用于 V1 DOM 核验，用户页面状态仍属声明；Tampermonkey/GM_*、V2/V3/V4 真机、iframe/Shadow 多上下文、AI Provider、Windows10+便携 Chrome155 和正式三发行包 RG 门禁尚未完成。PR #2 仍为 Draft、不合并 main、不生成中途安装包。

## 2026-10-09 · CDP 后台节点身份双采样 + 进程内 HMAC 保护（357 项）

- **现存误判：** 旧 `runSiteAdapterRoleDomCheck` 对两个独立 CDP 查询仅比对 selector 的匹配数量。动态网页可用新 DOM 节点替换旧按钮，但查询结果始终是 1，从而错误认定稳定 V1 角色定位。
- **TDD RED:** [Node Contracts #37913723198](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37913723198) 引入缺失的 opt-in DOM.backend node 身份回归与 SiteAdapter 计数相同、后台身份不同的用例，证明原逻辑无法区分节点替换。另一次首轮 RED 发现测试数据使用纯数字的十六进制字符串来模拟大写，大小写转换没有作用；测试改用字母后重新验证。
- **只读身份扩展：** `packages/cdp-client/src/locator-probe.ts` 新增 `includeNodeFingerprints`（默认 false，其他扫描保持旧行为）。仅对唯一命中的节点发送有界 `DOM.describeNode`；拒绝无效 backendNodeId/nodeType 或出错的响应，不运行 `Runtime.evaluate` 或 JavaScript，不触发 DOM 更改。只把内部 `backendNodeId` 通过进程级随机密钥 HMAC-SHA256 转成指纹，不在 IPC 中传原始 ID，不记录页面正文。进程重启后指纹密钥变化，避免将此字段当作持久节点身份。
- **V1 双采样约束：** `packages/test-runner/src/site-adapter-role.ts` 两次采样不仅要有相同的数量，还必须有同一个后台节点身份指纹；数量为 1 却缺乏有效指纹返回 `needs-review`，相同数量但替换节点也 `needs-review`。CDP 的主 frame/loader 身份及 reload 拦截仍然生效。没有提升 V2/V3/V4 的证据等级。
- **真实桌面与 Chrome 路径：** `apps/desktop/src/main/index.ts` 的 SiteAdapter role check 显式 opt-in；`scripts/smoke-chrome.mjs` 的受控真实 Chrome fixture 使用相同代码路径。其他定位探测仍默认不采集指纹。
- **GREEN:** [Windows Development CI #37914295063](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37914295063) **357 tests / 357 pass / 0 fail**，严格 TypeScript、Electron 构建、Windows GUI/SQLite smoke、真实 Chrome CDP smoke 全部成功；[Node contracts #37914295046](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37914295046) SUCCESS。
- **Stable 未完成：** 动态网页 V1 定位证据更严格，但 iframe/Shadow DOM 正式多上下文角色检测、V2 交互、V3 业务验证、真实 Tampermonkey/GM_* V4、指定 Win10+便携 Chrome155 和正式三发行包验收仍未完成。保持 PR Draft，不合并 main，不发布 Stable，不生成中途包。

## 2026-10-09 · 作用域/验证用例升级防漏报与多节点 V1 安全校验（362 项）

- **问题 1：SiteAdapter 影响分析漏报。** 原 `assessSiteAdapterUpgrade` 的 `changedRoles` 只考虑角色定义与其状态。仅修改 `urlPatterns` 或 `validationCases`，即使依赖旧版的脚本会受到影响，旧结果也可能标成 `unchanged` 且 `affectedScriptIds` 为空，回归列表漏掉旧脚本专有用例。
- **TDD RED：** [Node Contracts #37915124918](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915124918) 验证单独扩展作用域、移除仍在使用的 URL scope、单独增删验证用例和仅变更数组排序这四组情况。
- **修复 1：** `packages/candidate-engine/src/site-adapter.ts` 现在按照集合比较作用域和验证用例，报告明确的 `changedScope`、`addedScopePatterns`、`removedScopePatterns`、`changedValidationCases`、`addedValidationCases`、`removedValidationCases`。任何作用域或验证契约变化都影响所有依赖旧版的脚本，而不是只影响直接依赖 changed role 的脚本。删除带依赖的作用域为 `blocked-scope`，删除旧验证用例为 `blocked-validation`；回归集合合并新旧验证用例与受影响脚本测试，避免删除历史覆盖。绝不自动激活新版。
- **问题 2：V1 多元素误判。** 唯一节点才有受信任的 `DOM.describeNode` backend ID 指纹。此前当角色 cardinality 允许 2～10 个元素时，双采样即使只比较数量也可能返回 `matched-v1`，但无法证明两次观测的是同一组节点。
- **TDD RED：** [Node Contracts #37915446163](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915446163) 新增重复出现 2/3 个匹配元素时不应认证 V1 的断言。
- **修复 2：** `packages/test-runner/src/site-adapter-role.ts` 对缺少逐节点指纹的多元素匹配始终返回 `needs-review`。同样适用于用户定义了 cardinality 2～3 且两个时间点数量稳定的场景。为了验证主流程，`scripts/smoke-chrome.mjs` 的真实 Windows Chrome 隔离页面加入两个 `.batch-role` 按钮和同名 SiteAdapter 角色，要求最终 `needs-review` 且 `V3='not-configured'`。
- **最终源码 GREEN：** [Windows Development CI #37915553011](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915553011) **362 tests / 362 pass / 0 fail**；TypeScript、Electron 构建、Windows GUI/SQLite、真正 Chrome CDP synthetic smoke 成功。[Node Contracts #37915553042](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37915553042) SUCCESS。
- **未解决的 Stable 门禁：** 实际应用仍不允许覆盖站点适配器旧版，因为缺少经授权的完整持久脚本依赖登记和版本回滚；尚未实现多节点全量身份/iframe/Shadow 上下文功能、真实 Tampermonkey/GM_* V4、V3 业务断言、指定 Win10 便携 Chrome155 实机以及三形式正式发行 RG 门禁。PR #2 保持 Draft，不合并、不制作中途安装包。

## 2026-10-09 · 多节点身份集合 V1 验证完成（368 项）

- **实际能力缺口：** 前一轮已实现单个节点的两次指纹比较，遇到 cardinality 为 2–10 的 SiteAdapter 角色只能 `needs-review`。这保证了不误判，但真实列表类网页中的稳定多节点角色完全无法通过 V1。
- **测试先行：** [Node Contracts RED #37916402106](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37916402106) 新增 6 项 CDP/角色单元测试，覆盖双节点不泄露 backend ID 的完整集合、身份重复/缺失、11 个节点拒绝采集、乱序但相同身份通过、稳定计数下节点替换阻断、非法/不完整指纹拒绝。实现后初版 368 项测试全通过但 TS 的 `exactOptionalPropertyTypes` 检查失败，已修正并重新验证；不将中间测试绿误报为整个 CI 通过。
- **CDP 受限查询：** `packages/cdp-client/src/locator-probe.ts` 的 `includeNodeFingerprints` 仍为显式 opt-in，默认原有探测只做 `DOM.getDocument` 与 `DOM.querySelectorAll`。对每个 matched node 发出只读 `DOM.describeNode`，单条 CSS 最多采 10 个节点，整次 probe 最多 100 个身份请求；超额、CDP 拒绝、非 element、无效 backendId、重复身份全部 `unverified`。只输出经过 HMAC-SHA256 的 64 字符十六进制指纹数组且按字典顺序排序，绝不输出 backendId、原始 DOM 文本或执行页面 JavaScript。
- **角色 V1 语义：** `packages/test-runner/src/site-adapter-role.ts` 继续保持用户授权、URL scope、声明状态标记、主文档 Frame/Loader 导航检查与两次 DOM 采样；对 `count=1` 必须有合法单指纹，对 `count=2..10` 必须拥有无重复、合法且长度等于 count 的完整指纹集合。两个观测的**数量和集合**均相同才允许 `matched-v1`。0 个目标的判定继续审查 iframe/author ShadowRoot；没有新增 V2/V3/V4 功能证明。
- **真 Chrome 证据：** `scripts/smoke-chrome.mjs` 在 Windows runner 的专用隔离 Chrome profile/本机测试网页创建两个 `.batch-role` 按钮，真实 CDP 查询取得两节点身份并使受控 SiteAdapter 得到 `matched-v1`；这不是用户安装的 Tampermonkey、也不是 Windows10+便携 Chrome155 的专用环境。
- **最终源码 GREEN：** [Windows Development CI #37916711853](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37916711853) **368/368 tests pass, 0 fail，TypeScript、Electron、Windows GUI/SQLite、真实 Chrome CDP smoke SUCCESS**；[Node Contracts #37916711997](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37916711997) SUCCESS。
- **Stable 未完成：** 仍须实现 iframe/Shadow DOM 角色、V2/V3 真实功能验收、Tampermonkey/GM_* V4、实际网页复杂自愈验证、Windows 10 + 便携 Chrome 155 实机及三发行形式 RG-01…09。PR #2 保持 Draft、不合并 main、不提前打包或发布 Stable。

## 2026-10-09 · 受限顶层 open ShadowRoot SiteAdapter V1 角色核验（377 项）

- **此前缺口：** `SiteAdapter` schema 已允许声明 `contexts: [{stateId, frame:'top', shadow:'open'}]`，但 `resolveSiteAdapterRole` 始终阻断该上下文，真实用户无法验证 Shadow DOM 中的语义角色。对于普通顶层 document 的 selector，必须继续保持独立作用域，不能将 shadow 结果混入 document 候选。
- **TDD RED：** [Node Contracts #37917592595](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37917592595) 对 open-root 解析、read-only CDP 仅查询 open root、无根/多根/closed/非法及超预算树、V1 双采样角色，以及未配置 shadow-probe 阻断等覆盖的缺口作出失败证明。追加候选引擎测试确保 shadow-only 的 selector 不会被现存 top-document capture 错误确认。
- **Schema 与角色：** `packages/candidate-engine/src/site-adapter.ts` 为 `AdapterRoleResolution` 增加 `rootScope: 'document'|'open-shadow'|null`，只允许已声明状态下一个明确的 top-root 类型；混合顶层 document 与 open-shadow 同时作为候选时 fail closed，iframe 仍不支持。不更改原 JSON schema 版本。
- **CDP 保守限额：** `packages/cdp-client/src/locator-probe.ts` 增加显式 `rootScope:'open-shadow'`（默认仍为普通 document）。只读请求 `DOM.getDocument` 使用 `depth:-1,pierce:true`，按最多 1500 个 CDP 节点的预算遍历主文档 children 与 shadowRoots，不进入 iframe contentDocument；仅当**恰好一个** open ShadowRoot 可识别时才向其 nodeId 发出 `DOM.querySelectorAll`。closed/user-agent root 不作为查询对象；结构异常/节点数超限/多个 open 根均 `unverified`，绝不隐式回退到 document。完整 CDP 响应仍受先前 1MB、超时和指纹查询预算保护，绝不把 DOM 文本带入 UI。
- **两次 V1 证据：** `packages/test-runner/src/site-adapter-role.ts` 为 explicit open-root 定义独立的 `probeOpenShadow` 依赖，缺失时 `blocked-context`；启用后遵守同一已确认主 frame/loader 的两次采样、身份哈希集合验证和不稳定变更阻断；无匹配不证明 Shadow DOM 功能失效而返回 `needs-review`。V2 仍 blocked、V3/V4 仍 not-configured。
- **隔离候选：** `packages/candidate-engine/src/workflow.ts` 的旧候选只来自 top-document snapshot，因此不再允许 ShadowRoot role 使用其返回的建议；相关回归明确断言不会调用通用候选 CDP。
- **真实桌面与 Chrome：** Electron main 对 `usshm:site-adapter-role-check` 增加固定的受控 `probeOpenShadow`，不让 renderer 指定任意 CDP 命令。Windows Runner 的 `scripts/smoke-chrome.mjs` 中 `#shadow-only` 位于真实 open-root；明确 `frame:'top',shadow:'open'` 的 role 得到 `matched-v1`，但相同 selector 以普通 document scope 观测仍为 `needs-review`。
- **GREEN 证据：** [Windows Development CI #37918226220](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37918226220) **377 tests / 377 pass / 0 fail**，严格 TypeScript、Electron 构建、Windows GUI/SQLite smoke 和实际 Chrome CDP smoke SUCCESS；[Node Contracts #37918226211](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37918226211) SUCCESS。
- **仍未完成 Stable：** 多个 open ShadowRoots 的角色 disambiguation、iframe/OOPIF、closed Shadow DOM、复杂真实网站修复、V2/V3 验收、真正 Tampermonkey/GM_* V4、Windows 10 + 用户便携 Chrome155 和正式三发行格式 RG-01..09 尚未完整完成。PR #2 保持 Draft，不合并 main、不制作中途安装包、不提前宣布 Stable。

## 2026-10-09 · SiteAdapter 已审查角色限定的实际用户脚本修复候选桌面接入（378 项）

- **缺口与意义：** `packages/candidate-engine/src/workflow.ts` 早已有 `suggestAdapterScopedRepairs`，但真实桌面此前只能查询静态 SiteAdapter V1 DOM 角色是否匹配，没有任何 UI/API 可以将已导入脚本源码中失效的 selector 与持久站点兼容规则连接，更无法由角色策略缩小真实 Chrome DOM 的修复候选范围。本轮把这条功能链正式接到现有受控修复工作台，减少手动抄写 CSS 的环节。
- **TDD RED：** 在 `apps/desktop/tests/site-adapter-wiring.test.ts` 先新增安全合约，要求新 IPC 具备 `assertSender`、显式 consent、不可变扫描代次、`getForInspection({siteId,expectedSha256})`、已授权脚本、`checkUserscriptPageScope`、`confirmPageIdentity`、`assertStablePageDocument`、`scanSessions.assertCurrent`、严格限定 candidate engine、preload 显式 bridge 与桌面可操作按钮。 [Node Contracts #37919247987](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37919247987) 原实现缺少此路径，按预期 RED。
- **主进程验证：** `apps/desktop/src/main/index.ts` 新增 `usshm:site-adapter-suggest-repair`，全部输入只允许索引、ID、角色名、用户声明页面状态及版本 SHA。主进程重新解析已授权扫描脚本和 source selector；只接收静态 `receiver=document` 定位器，应用现有 `@match/@include` 安全范围规则；重读 SHA 锁定的 SiteAdapter；从本机实际已连接 Chrome 取得目标，并在操作前后验证 frameId/loaderId 未导航，同时最后验证 scanId 仍当前。通过已有 `suggestAdapterScopedRepairs` 执行旧 selector 缺失确认、安全 DOM 候选获取、再次真实探测并按所选角色策略白名单排序筛选。没有读取 renderer 原始 CSS、执行 JS、补丁写盘或自动认可。
- **桌面预览：** preload 强类型桥 `suggestSiteAdapterRepair`；renderer SiteAdapter 面板新增“按 SiteAdapter 角色筛选修复候选”按钮，使用所选脚本 `focused`、源码定位器 `repairIndex`、选定目标和 UI 所见 SHA。状态切换会取消旧显示令牌和候选。将用户点击的候选只复制到现有 `repairNew` 输入框，后续独立的生成预览、审核及保存受管副本仍沿用原有显式操作。所有 UI 说明严格保持 DOM 证据级别。
- **真实 Chrome 集成：** `scripts/smoke-chrome.mjs` 在隔离 Windows Chrome fixture 中，使用真实 `probePageLocators` + `captureCandidateNodes` 对 `#old-heal-button` 进行缺失后重新定位，确保 `fixture.healButton` 只返回该角色已声明且唯一命中的 `#heal-button` 候选，`approved=false`、`functionalVerified=false`。同一目标中 open ShadowRoot 的角色明确不允许把 top-document 候选误归给 Shadow DOM。
- **GREEN：** [Windows Development CI #37919454107](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37919454107) **378/378 tests PASS, 0 failures**, TypeScript、Electron 构建、Windows GUI/SQLite 和真实隔离 Chrome CDP smoke 全部 SUCCESS；[Node Contracts #37919454109](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37919454109) SUCCESS。
- **未解决的 Stable 门禁：** 完整持续用户脚本依赖登记、iframe/OOPIF 多上下文、V2/V3 真实业务行为验收、用户 Windows10+便携 Chrome155+实际 Tampermonkey GM_* V4、复杂网站自愈闭环，以及三正式 Windows 发行形式 RG-01..09 尚未覆盖。此更改不宣称任何 V2/V3/V4 或功能级自动修复成功，保持 PR Draft，不合并 main，不发布 Stable，也不制作中途安装包。

## 2026-10-09 · Same-origin single iframe SiteAdapter V1 evidence (388 tests)

- **背景：** JSON schema 早已支持 `contexts:[{frame:'iframe',shadow:'none',stateId}]`，但 `resolveSiteAdapterRole` 仍全部拒绝，Electron 主进程也没有 iframe 专用只读探测，无法对嵌套同源页面的定位器形成 V1 证据。
- **范围裁定：** 当前只允许**当前顶层目标恰好包含一个同源子 frame**、其 `loaderId` 有效、CDP 将该唯一的子 `contentDocument` 暴露在父 page target 的 `DOM.getDocument(depth:-1,pierce:true)` 中；这不等价于任意 iframe、多个 iframe、OOPIF、`about:srcdoc`、`about:blank` 或跨域网站支持。多上下文/混用 frame 与 shadow 默认拒绝，未来需要独立明确的 frame selector 和经理层策略。
- **TDD RED：** [Node Contracts #37920640685](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37920640685) 新增页面单 iframe frame/loader 身份约束、私有 child URL 不回传、导航中子 loader 变化阻断、多个/跨域/无 loader 子 frame 拒绝、只向 frameId 对应的 `contentDocument` 查询、缺失/歧义/错误 frameId 不退回顶层 DOM、专用 iframe 角色 V1 双采样及独立候选上下文测试。原始代码按预期缺失接口而 RED。
- **CDP 页面身份：** `packages/cdp-client/src/page-identity.ts` 只将一个与 top URL 同 origin 的子 frame `frameId` 和 `loaderId` 作为内部 `soleSameOriginSubframe` 上报；不在 UI/报告中包含子 frame URL。 `assertStablePageDocument` 现在同时核验子 frame 数量和这个唯一子 frame 的身份，防止 iframe 在主文档 URL/loader 不变时独立导航造成的错误 V1 证据。
- **有界 DOM 查找：** `packages/cdp-client/src/locator-probe.ts` 新增 `rootScope:'iframe-document',expectedFrameId`，缺少可信 frameId 就失败。通过严格上限 1500 节点的树遍历，只在顶层常规 `children` 内选择唯一 `nodeName:'IFRAME'`、`frameId` 完全匹配、`contentDocument.nodeId` 合法的根。不会运行 `Runtime.evaluate`、点击、用户脚本，且跨 iframe/ShadowRoot 候选不混淆。后续指纹查询仍遵守单 locator 10 个、总批次 100 个及 1MB CDP 回复预算。
- **语义角色及桌面：** `packages/candidate-engine/src/site-adapter.ts` 增加 `rootScope:'iframe-document'`；同一个已声明状态下 document/iframe 混合仍 `blocked-context`，iframe+open ShadowRoot 仍不支持。 `packages/test-runner/src/site-adapter-role.ts` 强制主进程提供 `probeIframe` 且基线有唯一同源子 frame，然后才使用该 ID 进行两次身份采样，子 loader 换代会直接阻断；零匹配仍为 `needs-review`，不能排除 iframe 内 Shadow DOM。Electron main 添加只读受限 `probeIframe`；已有 scope-limited 候选引擎不会将 top-document 候选用于 iframe role。
- **真实 Windows Chrome 集成：** `scripts/smoke-chrome.mjs` 的本机 fixture 新增同源 `/child` 页面及 `#iframe-only` 按钮。真实 CDP `Page.getFrameTree` 验证唯一子 frame 的 loader，iframe DOM 查询和双采样返回 `matched-v1`，`functionalVerified` 与 `managerVerified` 仍为 false，V3/V4 仍未配置。同时再次确认存在 iframe 时批量的顶层零匹配及 top-level out-of-scope 不可静默报告为整站绝对缺失。
- **调试留痕：** 首轮新测试前旧码 RED；实现后 [Node Contracts #37920993416](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37920993416) 的两条旧 “所有 iframe 必然不支持” 测试按旧语义失败，已改为明确 scope+候选隔离。随后 [Windows #37921181805](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37921181805) 388 测试通过但真实 Chrome 发现嵌套浏览上下文使原 batch 的 `locator-missing/out-of-scope` 需保守变更为 `needs-review`；测试已按实际安全语义修正，没有弱化生产逻辑。
- **源码 GREEN：** [Windows Development CI #37921447467](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37921447467) **388/388 PASS，0 FAIL**；TypeScript、Electron 构建、Windows GUI/SQLite 与真实 Chrome CDP smoke 全部 SUCCESS。[Node Contracts #37921447479](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37921447479) SUCCESS。
- **Stable 尚不可发布：** 多 iframe、OOPIF/跨域、授权真实网站 V2/V3 业务验收、真正 Tampermonkey/GM_* V4、Windows10+用户便携 Chrome155 实机与正式三发行包 RG01–09 均未完成。PR #2 保持 Draft，未合并 main，没有中途安装包，没有 Stable tag。

## 2026-10-09 · CSS 可见性与直接元素禁用属性分离（393 项）

- **此前缺口：** 可见性只依赖 DOM/CSS box、display、visibility、opacity、pointer-events，用户在界面看到 `potentially-visible` 时无法区分实际 `disabled`、`aria-disabled` 或 `readonly` 状态。DOM 可见并非交互成功；本轮仍只增加**候选控件状态证据**，没有自动点击或任何业务断言。
- **TDD RED：** [Node Contracts #37922233230](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922233230) 新增五项单元/合约测试，包括真实语义禁用属性、aria-disabled true/false、readonly、DOM.getAttributes 无效/过量/拒绝、多个或零匹配不读取未知元素。先在旧实现按预期 RED。
- **CDP：** `packages/cdp-client/src/read-only-visibility.ts` 在唯一匹配节点后加只读 `DOM.getAttributes`，然后继续原有 CSS style + box 检测。属性数组必须为偶数对，最多 256 项，拒绝重复名称或异常字段，限制单个属性值长度；内部只派生枚举 blocker，不返回原始 DOM 属性值。CDP 请求拒绝会让 blocker = `unknown`，不误报为“当前控件可用”。既有 CSS display/opacity/pointer-events 仍独立输出。**不处理父元素 disabled fieldset、遮罩覆盖、深层祖先样式、实际输入及事件动作**，所以 `none-detected` 也不能推导 V2 PASS。
- **桌面：** `apps/desktop/src/renderer/App.tsx` 在现有 CSS visibility 检查展示控件限制：`disabled`、`aria-disabled=true`、`readonly`、未发现直接限制或未知，明确 V2 不可视为通过。main 的权限、用户脚本范围、CDP frame/loader、scanSnapshot 当前性校验保持不变。
- **真实 Chrome：** `scripts/smoke-chrome.mjs` 的 Windows runner synthetic fixture 中包含 native disabled button、aria-disabled 按钮、readonly input 及正常按钮。实际 CDP 分别产生 `disabled-attribute`、`aria-disabled`、`readonly-attribute`、`none-detected`，四种结果一律仍 `V2:'blocked'`、`interactionVerified:false`、`V3/V4:'not-configured'`。
- **错误与修复：** 初版 GREEN 尝试的 Node Contracts [#37922457749](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922457749) 暴露属性状态变量作用域错误，导致 read-only-visibility 的相关测试失败；已更正变量位置，不对失败记录做掩盖。
- **最终源码 GREEN：** [Windows Development CI #37922572400](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922572400) **393 tests / 393 pass / 0 fail**；严格 TypeScript、Electron、Windows GUI/SQLite、真实 Chrome CDP 冒烟全部 SUCCESS；[Node Contracts #37922572430](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37922572430) SUCCESS。
- **Stable 遗留：** 真正授权且不产生持久动作的 V2 安全交互判据、V3 业务 contract、V4 Tampermonkey/GM_*、复杂多帧/Shadow、指定 Win10+便携 Chrome155、三发行包 RG 门禁均未完成。依然保持 PR Draft，无合并、无中途安装包、无 Stable 发行。

## 2026-10-09 · 通用 V1 唯一节点连续性及三形态 Stable 发行基础（404 项）

- **V1 误判与新测试：** 泛型 `runReadOnlyDomContract` 此前在 `expectation:'unique'` 时，即便两次匹配的 1 个 DOM 节点是不同 `backendNodeId`，也可能报告 `passed`。新增替换节点、缺失/格式错误/大写指纹、合法相同指纹、`exists` 数量判定不受影响四项契约测试。[Node Contracts RED #37923341768](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37923341768) 的替换/无指纹测试确实首先失败。
- **V1 实现：** `packages/test-runner/src/index.ts` 的 `unique` 断言逐次读取只有唯一节点才可形成的合法 HMAC-SHA256 指纹，确认两次是同一个 backend node 后才允许 `passed`。缺失、非法、节点变更统一 `needs-review`。普通 `exists` 契约仍仅代表两次存在性，结果不宣称稳定身份。Electron `usshm:run-dom-contract` 及 `scripts/smoke-chrome.mjs` 的通用 unique 契约 now explicitly opt into `includeNodeFingerprints:true`；页面 Frame/Loader 确认、授权范围和 V2/V3/V4 不提升的规则均保留。
- **三形态发行缺口：** `build/electron-builder.yml` 原始 `win.target` 仅 nsis、portable，`package.json` 的 `dist:win` CLI 也只有这两种，实际不满足用户规定的 Setup EXE + Portable EXE + 完整 ZIP 三形态。新增 x64 `zip` target、只适用于 ZIP 的 Windows 默认 `artifactName`（NSIS 和 Portable 的目标专用命名仍保留），正式打包 CLI 统一声明三个 target。依据 electron-builder v26 [Windows targets](https://www.electron.build/v26/docs/win/) 和 [target documentation](https://www.electron.build/v26/docs/targets/)；明确不是执行打包。
- **正式发行库存门禁：** `scripts/windows-release-gate.mjs` 导出纯函数 `validateWindowsReleaseLayout` 和 `expectedWindowsArtifacts`；拒绝缺少 Setup/Portable/ZIP、重复格式、不同 release version、用 Portable.exe 替代 unpacked ZIP、ZIP 缺少主 EXE/resources/app.asar/locales/.dll/.pak、任何目录穿越/绝对路径/私有 Data/油猴脚本/API key 相关文件。未来仅在**真实 Windows release runner** 的三包已存在时，调用该脚本通过 `tar.exe -tf` 检查 ZIP inventory，再校验三包基本文件头、最小体积并对三个完整文件流计算 SHA256，采用独占写入 `SHA256SUMS.txt`。它不执行安装/解压/升级/回滚，不验证签名或 ZIP 全部 payload 完整性，也不能代替 RG-09 中真实三包 E2E。这些缺口仍属于阻断项。
- **TDD RED：** [三形态配置 #37923833051](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37923833051) 和 [发行目录与隐私 #37924199271](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37924199271)。测试只读取配置与调用纯函数，不创建任何打包分发物或修改用户本地程序。
- **源码 GREEN：** [Windows Development CI #37924341040](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37924341040) **404 tests / 404 pass / 0 fail**；严格 TypeScript、Electron 构建、Windows GUI/SQLite 与真实 Chrome CDP smoke 成功。[Node Contracts #37924340999](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37924340999) SUCCESS。
- **仍未 Stable：** V2 安全交互、真实 V3 业务断言、Tampermonkey/GM_* V4、复杂真实网站修复、指定 Windows10 + 便携 Chrome155、三种真实程序包及升级卸载/签名/哈希/可携迁移门禁未完成。本轮维持 `0.1.0-alpha.5` 开发版、Draft PR #2，不合并 main、不生成中途安装包、不发布 Stable。

## 2026-10-09 · 固定文件句柄保护修复/回滚关键读取（409 项）

- **实际风险与防护层：** 原来的 `lstat(path)` 检查与稍后 `readFile(path)` 会对同一路径进行两次独立文件系统解析；即便脚本原件绝不覆盖，受攻击或其它程序并发改写时也可能读到后来的别名文件。此次新增 `packages/runtime-paths/src/pinned-file.ts` 的 `readPinnedRegularFile`，从调用方传入先前审核的 Stats snapshot（可选）；校验安全大小及文件类型后用专用只读 fd 打开，检查打开后 fstat 与起始快照对应，读完后再次校验 fd 与路径。如果平台可用则通过 `O_NOFOLLOW` 阻止符号链接，兼容不支持此 flag 的 Windows 时用前后 lstat/fstat 复核防止普通链接重定向被承认。
- **已完成接入：** `packages/repair-workflow/src/index.ts` 的 source 原件读取、已受管 current 读取及 apply 时原件再确认；`packages/repair-workflow/src/history.ts` 的历史归档 SHA-256 校验和 rollback 前 current 读取；`packages/patch-engine/src/index.ts` 的 patch apply 旧版 source 读取和 immutable file collision 校验。原来的修改前 source hash、不可变存档、隔离 managed current 和用户明确同意机制仍保持。
- **新增测试：** `packages/repair-workflow/test/pinned-read.test.ts` 共 5 个测试，覆盖普通 UTF-8 BOM 原字节保留、symlink 文件被拒且外部文件不变、相同大小路径更换但旧 snapshot 不可用、硬链接替换、文件/目录类型和大小预算边界。禁止通过无身份校验的路径直接读取超过 512 KiB 的文件。测试在真实 Node 文件系统临时目录执行，非模拟返回值。
- **Windows 兼容事实：** 新安全检查最初严格要求 `Stats.ino` 为可信正安全整数；[Windows #37925590522](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37925590522) 显示 Windows Node 文件标识并不稳定适合此判定，造成原有工作流误拒绝。第二次 [Windows #37925785207](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37925785207) 显示它也可能不是可安全表示的整数。现依平台采用普通 Unix dev/inode 严格核对；Windows 对此类文件标识只当成有限数值辅助，主要使用固定 fd、birthtime/mtime/ctime/size/mode 及路径前后核对。**这不是针对具有管理员权限/能操控时间戳的恶意并发进程的完整 Win32 文件 ID/事务锁**；RG-06 仍不能因此标记正式完成。
- **RED/GREEN：** [Node Contracts RED #37925179695](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37925179695) 在未实现读取器时失败；后续 Windows 失败如上均修复并复跑。[Windows Development CI #37926018537](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926018537) **409 tests / 409 pass / 0 fail**，严格 TypeScript、Electron 构建、Windows GUI/SQLite、真实 Chrome CDP smoke SUCCESS；[Node Contracts #37926018531](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926018531) SUCCESS。
- **剩余 Stable 阻断项：** 真实 Tampermonkey / GM_* V4、V2/V3 业务功能、全面故障注入与原生 Windows 文件 ID 审计、用户指定 Windows 10 + 便携 Chrome155 实际安装环境，以及 Setup/Portable/ZIP 三种正式包的真实构建、分别启动与升级/回滚均未完成。保持 PR #2 Draft，不合并、不做中途安装包、不发布 Stable。

## 2026-10-09 · 导出受管用户脚本与固定文件句柄读取统一（410 项）

- **剩余读取窗口：** 上一次固定句柄安全工作覆盖提案、补丁提交、历史版本、当前管理文件与回滚，但 `packages/repair-workflow/src/export.ts` 仍先 `lstat(current.user.js)` 后 `readFile(current.user.js)`。虽然导出前比对了历史归档 SHA-256，外部并发替换仍可能造成路径读取与已审核对象不一致，且形成多条不一致的安全校验路径。
- **TDD RED：** `packages/repair-workflow/test/export.test.ts` 增加导出必须通过共享固定句柄读取而不得直接使用 `await readFile(currentPath)` 的静态接线合同。原版本在 [Node Contracts #37926579380](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926579380) 按预期失败。
- **实际修复：** `exportManagedCurrent` 仍使用 `listManagedRevisions` 的内容哈希验证与 OS Save Dialog 来源，读取已扫描 current 时改为 `readPinnedRegularFile(currentPath,{maxBytes:512*1024,expected:info})`。同时继续保持目的地不得在用户 managed root 内、不能通过 symlink/junction 绕过目录校验、目标独占 `wx` 创建并禁止静默覆盖的原始安全机制。没有主动输出安装包、没有直接覆盖油猴扩展或原始用户脚本。
- **源码 GREEN：** [Windows Development CI #37926649977](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926649977) **410 tests / 410 pass / 0 fail**；TypeScript 严格检查、Electron 构建、Windows GUI/SQLite、真实 Chrome CDP smoke SUCCESS。[Node Contracts #37926649973](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37926649973) SUCCESS。
- **发行判断：** 此次仅属文件读取/导出安全加固。完整 V2/V3/V4、Tampermonkey/GM_*、用户 Win10 + 便携 Chrome155、三个最终发布包的实机启动/升级/回滚与 RG01–09 仍未验收。保留开发分支和 Draft PR，不提前宣布 Stable。

## 2026-10-09 · 受管导出目录边界及脚本语法前置检查（414 项）

- **问题 A：路径前缀混淆。** `packages/repair-workflow/src/export.ts` 原来的 lexical/realpath 根目录校验都使用 `!relativePath.startsWith('..')`，错误地把相对路径 `..not-parent/new.user.js` 认作越过父目录而放行。它实际位于 `managedRoot/..not-parent`。先追加两项真实文件系统测试：拒绝 Data 内双点开头的子目录，同时接受真正 Data 外的双点开头 sibling。[Node Contracts RED #37927482273](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37927482273) 显示 412 项中确有 1 项因这个漏洞失败。
- **修复 A：** `withinRoot(base,candidate)` 使用 `node:path.relative()`，只允许完整的父目录分量 `..` 或前缀 `.. + sep` 表示离开根，路径绝对值跨驱动器仍单独处理。该 helper 被用于输入路径及 `realpath` 后的父目录双重检测，不降低先前的 `wx` 不覆盖、受管存档 SHA 验证及受控导出机制。[Windows Development CI #37927639333](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37927639333) **412/412 PASS**、[Node Contracts #37927639327](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37927639327) SUCCESS。
- **问题 B：解析容错可误导修复。** TypeScript `createSourceFile` 即使遇到现有 JavaScript 语法错误也可能恢复 AST 并定位字面量 CSS；旧 `proposeLiteralPatch` 不查看 parser diagnostics，会给出可以批准的 selector-only preview。先追加两个测试：损坏 JS 必须阻断；合法 userscript metadata 与函数仍须保留。[Node Contracts RED #37928000566](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37928000566) 有 1 项预期失败。
- **修复 B：** `packages/patch-engine/src/index.ts` 在 AST 创建后校验 parse diagnostics；有语法错误就拒绝创建补丁，返回明确原因，继续零执行 JS、零原件写入。合法原始脚本仍依赖旧的唯一 AST 位置、hash 与 managed revision 多阶段批准机制。此判定不是业务/GM_* 验证，不将 DOM 定位成功提升为 V2/V3/V4。
- **最终源码 GREEN：** [Windows Development CI #37928143122](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37928143122) **414/414 tests pass, 0 fail**，TypeScript 严格检查、Electron 构建、Windows GUI/SQLite 与真实隔离 Chrome CDP smoke 均 SUCCESS；[Node Contracts #37928143293](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37928143293) SUCCESS。
- **Stable 仍被阻断：** 多网站 V2/V3 实际交互/业务验收、真实 Tampermonkey/GM_* V4、复杂网页故障/修复/回滚、Windows10+用户指定便携 Chrome155、三种正式 Windows 发行包实机安装/启动/更新及 RG01–RG09 全部证据仍未齐。PR #2 继续 Draft、不合并 main、不生成任何中途安装包或 Stable tag。

## 2026-10-09 · 批准补丁写入的完整重建核验 + Windows ZIP 路径阻断（418 项）

- **写盘前漏洞：** `packages/patch-engine/src/index.ts` 的 `applyManagedPatch` 过去只保证读到的 base bytes 与 draft.baseHash 相同，以及 draft.proposedSource 和 draft.proposedHash 自洽。两者不能证明草稿只改动了经过用户预览的单个 AST 定位器。伪造调用方可自行计算新的 proposedHash，向 `proposedSource` 增加任意 JS 逻辑或修改脚本元数据并写入受管 revision。这个补丁层位于明确批准之后，因此必须独立 fail closed。
- **TDD RED：** `packages/patch-engine/test/patch.test.ts` 新增 3 项回归：① 伪造草稿额外插入 JavaScript、修改 userscript `@name`、混入页面重定向而重新计算 SHA 都必须拒绝；② 只改变 `sourceRange` 的位置（仍持有效代码与 SHA）也拒绝；③ UTF-8 BOM + 两个同 selector 调用中选择第二处，仍能正常创建精确单点补丁并保持原文件原字节。旧码 [Node Contracts #37929051558](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929051558) 417 tests / 415 pass / 2 fail（预期故障确实复现）。
- **最终写盘加固：** `proposeLiteralPatch` 增加仅供写盘验证使用的 `expectedSourceRange`，并在 AST 访问时核对字符串字面量的确切 start/end；`applyManagedPatch` 从已固定的原始文件 bytes 重算最小修改结果，逐项核对 baseHash、proposedHash、完整 proposedSource、sourceRange，且输出不超过 512 KiB。任何额外代码、伪造 hash 或错误位置在 `ensureWritableDataRoot` 之前被拒绝，保护已有的原件不覆盖、历史不可变存档和独立批准机制。
- **ZIP 路径约束的可利用缺口：** `scripts/windows-release-gate.mjs` 原先阻挡了父目录穿越，却没有拒绝 NTFS alternate data stream（例如 `resources/app.asar:evil`）、`CON/NUL/AUX/LPT1/COM9` 设备名、末尾 `.` / 空格这类 Win32 会重新解释的路径。原来打算匹配 `PREFIX` 的部分正则误用了字面上的 `${PREFIX}`，无法正确识别以实际产品名前缀开头的安装 EXE 伪装。
- **ZIP TDD RED/GREEN：** `apps/desktop/tests/windows-release-gate.test.ts` 新增 1 项覆盖十余个 Windows 非法 ZIP 条目。旧码 [Node Contracts #37929538487](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929538487) 418 项中新增测试失败；修改后 ZIP 库存解析按 Windows 平台语义拒绝路径，再保留正式成品完整 Electron 目录检查。**仍不验证真实 Zip payload、签名、运行或完整发行 RG。**
- **最终源码 GREEN：** [Windows Development CI #37929682472](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929682472) 418 tests / 418 pass / 0 fail，严格 TypeScript、Electron 构建、Windows GUI/SQLite、真实 Chrome CDP 集成 smoke SUCCESS；[Node Contracts #37929682452](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37929682452) SUCCESS。
- **Stable 发版仍阻断：** Windows10 + 用户便携 Chrome155 实机、Tampermonkey/GM_* V4、V2/V3 业务动作验收、复杂网站完整自愈、三种最终安装/解压版的真实成品构建及逐版启动升级/回滚、完整 RG-01—09 证据均未齐。PR 保持 Draft、版本仍处于 alpha，不合并 main、不生成预览安装包、不宣布 Stable。

## 2026-10-09 · 受管存档类型运行时白名单与路径逃逸回归（419 项）

- **实际漏洞：** `packages/patch-engine/src/index.ts` 的 `applyManagedPatch` 构造 `${baseRevisionKind}-${expectedHash}.user.js` 备份文件名；此字段只有 TypeScript 类型约束 `'original'|'revision'`，没有运行时白名单。外部受损 JS 调用或不可信内部输入可以强制绕过编译类型，传入 `../../../escaped`、反斜线穿越等，逃离预期受管存档文件夹。路径一经交给写盘函数，简单哈希校验不足以保护目的地路径。
- **先行测试 RED：** 在 `packages/patch-engine/test/patch.test.ts` 增加真实临时目录和源文件测试，枚举 `../../../escaped`、反斜线写法、空字符串、非法大小写等，不允许创建受管 revision、目录外归档，也不得改变原始脚本。旧实现 [Node Contracts #37930260901](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37930260901) 419 tests / 418 pass / 1 fail，如实复现。
- **修复：** 在 `applyManagedPatch` 授权检查与 scriptId 检查之后立即校验 `baseRevisionKind==='original'||baseRevisionKind==='revision'`，任何其他运行时值必须抛出错误，不能进入由 `join(managedRoot,'managed',scriptId,...)` 构造的不可变备份路径。该防护和上一轮的完整重新生成补丁内容验证是两条独立 fail-closed 防线。
- **源码 GREEN：** [Windows Development CI #37930376389](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37930376389) **419 tests / 419 pass / 0 fail**，TypeScript 严格检查、Electron 构建、Windows GUI/SQLite 和真实隔离 Chrome CDP smoke SUCCESS；[Node Contracts #37930376278](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37930376278) SUCCESS。
- **最终 Stable 未完成：** 本轮未进行真实 Tampermonkey/GM_* V4、真实交互 V2/业务 V3、复杂网页全自动自愈、用户 Windows10 + 便携 Chrome155、Setup EXE/Portable EXE/完整 ZIP 真实打包运行/更新/回滚或完整 RG 证据。版本继续 alpha、PR #2 Draft，不合并 main、不制作中途安装包、不提前发布 Stable。


## 2026-10-09 · 已固定文件句柄的分块读取上限及 Chrome 偏好读入防竞态（421 项）

- **失效模型 A（受管用户脚本）：** `readPinnedRegularFile` 在 lstat/fstat 验证文件大小之后使用 `FileHandle.readFile()`。若外部进程在验证后、读取中将文件增长为非常大，`readFile()` 会先分配/读取整份内容，再执行 `bytes.length>maxBytes` 检查，造成批准的最多 512 KiB 数据预算在 I/O 分配阶段失效。此安全边界在归档、修订、导出、回滚等共享读取路径上重复使用。
- **TDD RED A：** 新建 `packages/runtime-paths/test/pinned-read-budget.test.ts`，强制禁止未限额的句柄 whole-file read，验证合法恰好 64 KiB 可原样读取、超额文件拒绝。旧码 [Node Contracts #37931441770](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37931441770) **420 tests / 419 pass / 1 fail（预期 RED）**。
- **修复 A：** 使用固定不超过 64 KiB 的 `FileHandle.read` 分块，始终只读取 `maxBytes+1` 字节以内；一旦超限立即拒绝，不再执行无限制的 whole-file read。保留现有 fd 前后 fstat、路径 lstat、Unix `O_NOFOLLOW`、Windows 限制说明、文件 SHA-256 消费者验证和原件不覆盖策略。最终 [Windows Development CI #37931615979](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37931615979) **420/420 PASS**。
- **失效模型 B（已保存的便携 Chrome 路径）：** `loadPreferredChromePath` 对 `preferred-chrome.json` 先 `lstat` 确认 4 KiB/非符号链接，再直接 `readFile(config,'utf8')`；该路径重新解析、且读取无限制，可能在文件被交换或突然增长时读取意外内容、内存超限或破坏可选配置载入。
- **TDD RED B：** `packages/cdp-client/test/preferred-chrome.test.ts` 添加调用方必须使用 pinned reader 的保护回归，验证普通路径记忆与 4097 字节损坏配置变为无选择。旧版 [Node Contracts #37931911157](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37931911157) **421 tests / 420 pass / 1 fail（预期 RED）**。
- **修复 B：** 偏好配置由 `readPinnedRegularFile(config,{maxBytes:4096})` 固定句柄读入；在读取/解析异常时 fail-closed 返回 `null`，不因可选 Chrome 选择损坏而阻止启动，更不会自动运行配置中的程序。
- **最终 GREEN：** [Windows Development CI #37932022968](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37932022968) **421 tests / 421 pass / 0 fail**；严格 TypeScript、Electron 构建、Windows GUI/SQLite、真实 Chrome CDP smoke 全部 SUCCESS；[Node Contracts #37932022876](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37932022876) SUCCESS。没有运行未知用户脚本、触发破坏性网页动作或生成预览安装包。
- **发版判断：** 这两项属于受管文件和可选配置的安全读取加固，不等同于真实油猴管理器内 `GM_*` 运行、V2 安全交互、V3 业务契约、用户 Windows 10 + 指定便携 Chrome 155 或最终 Setup/Portable/ZIP 三包逐一验证。维持 Alpha、PR #2 Draft，不合并 main、不打 Stable tag、不制作任何中途安装包。


## 2026-10-09 · CDP DOM 数量语义、Frame/Loader 身份及多页指纹闭环（433 项）

- **安全问题一（错误 V1 判定）：** `summarizeLiveLocatorCheck` 曾把任何 `found` 且 `matchCount>0` 都计入“已找到”，无法识别 `querySelector()` 的非法多节点匹配或损坏的计数字段。不是所有 `found>1` 都异常：`querySelectorAll`、`getElementsByName` 与 `getElementsByClassName` 的集合返回合法。现区分单元素/集合查询，只接受安全整数与 CDP 受限数量 1..10000；非法计数降为 `needs-review`，不发 V1 PASS。保留 DOM-only 非业务执行等级。
- **TDD 一：** 新增 `packages/scan-service/test/batch-evidence-integrity.test.ts` 共 5 项，包含非法单选/超量/负值/小数/非数字、重试证据和合法集合查询。旧版 [RED #37932829060](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37932829060) 425 tests / 423 pass / 2 fail；正确兼容集合 API 后 [GREEN #37933146573](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37933146573) 426/426 PASS。
- **安全问题二（缺失文档身份）：** `diagnoseScriptsOnPage` 的 DI `confirm` 若返回相同 URL，却没有 Frame ID / Loader ID、异常子 Frame 数量或矛盾的单个子 Frame 声明，旧版会接受并归类 `locator-missing` / `dom-present`；这无法排除同网址重载与无法确认的 iframe。现在所有批次（包括全 skipped/out-of-scope）在任何 selector 读取前、每次 confirm 后都严格验证主 Frame/Loader token、64 子 Frame 预算和唯一 child token 结构，拒绝伪造/不完整身份。
- **TDD 二：** 新增 `packages/scan-service/test/batch-document-identity.test.ts` 共 4 项，覆盖缺 ID、空 ID、过长 ID、非法子 Frame 数、互相矛盾的子 Frame 与合法文档指纹。旧版 [RED #37933537121](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37933537121) 430 tests / 427 pass / 3 fail。修复原有 batch 测试夹具以提供实际 CDP 会返回的合法身份；[GREEN #37933700385](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37933700385) 430/430 PASS。
- **安全问题三（多页 token 可省略）：** `collectPagedDomDiagnosis` 对第一页缺少 `pageDocumentToken` 时仍接受；若后续页也无 token，只验证相同 URL，可能把同 URL 重载的不同文档拼接为 50+ 脚本的可信报告。现每页必须有严格小写 SHA-256 格式的 Frame/Loader 指纹，任何缺失在 onProgress 前失败；跨页严格要求 token 完全相同。兼容已有导出字段语义，但不允许未经身份认证的批次提升证据。
- **TDD 三：** 新增 `packages/scan-service/test/paginated-document-token.test.ts` 共 3 项，并更新旧 pagination 正常测试夹具携带固定指纹。旧版 [RED #37933921396](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37933921396) 433 tests / 432 pass / 1 fail；[GREEN #37934037487](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37934037487) **433/433 PASS**，TypeScript、Electron 构建、真实 Windows GUI/SQLite 与 Chrome CDP smoke 均 PASS。
- **本轮范围与不足：** 仅针对 CDP DOM 证据和诊断传播的安全门禁，仍然没有执行未知用户脚本、没有发送/删除/付款网页动作、没有写回源文件、没有中途安装包。V2 非破坏性交互、V3 命名业务验收、真实 Tampermonkey GM_* V4、用户 Win10+便携 Chrome155 实机和三格式正式 Release Gate 未完成。**保留 Draft PR，不合并 main，不发布 Stable。**


## 2026-10-09 · 备份故障恢复、受限导入和 SQLite 降级防护（446 项）

- **范围：** 上一轮 `e802db21` 之后继续处理 QA-037~039（备份/恢复）、QA-060（文件来源边界）、QA-073（数据库降级保护）。原件始终只读；无未知 userscript 执行、无中途安装包。
- **备份归档 I/O 故障：** 原 `packages/patch-engine/src/index.ts` 使用 `writeFile({flag:'wx'})` 把已通过预览的原件和修订写入内容寻址路径，写入失败可能留下半成品占据正确 SHA 路径。抽取 `persistImmutableSnapshot`，限制 512 KiB，每次最多 64 KiB，通过文件句柄写入与 `FileHandle.sync()`，成功后再次用身份固定的受限读验证内容哈希；正常 I/O 错误、非法短写和回读哈希不符时删除本操作新建的残缺归档。已存在的同哈希文件核实后幂等成功，冲突/符号链接绝不覆盖。流程原件保持原样，受管 current 激活必须等待两份归档完成。
- **备份的 TDD 证据：** 新增 `packages/patch-engine/test/immutable-archive.test.ts` 六项用例，包括 ENOSPC 注入、零写进度、既有冲突、符号链接及回读被恶意篡改等。旧代码无法满足新增接口：[RED #37934985041](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37934985041)；回读哈希失败留下孤儿文件：[RED #37935917097](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37935917097)。注意这是**可恢复 I/O 错误**的故障清理，不能证明突然断电、跨进程对路径的敌意替换或所有文件系统上完整事务；后续仍须真实断电/打包恢复测试。
- **导入时 TOCTOU 保护：** 原 `packages/script-registry/src/index.ts` 使用 `lstat` 确认文件大小后 `readFile(path)`，读取阶段仍可能被符号链接交换或无界增长。现使用 `readPinnedRegularFile(path,{maxBytes:512*1024,expected:info})`，拒绝非普通文件/链接和大小超额，单个失败归类不可读，不进行越权读取。新增三项回归测试 `packages/script-registry/test/import-pinned-read.test.ts`；[RED #37935447743](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37935447743)。
- **SQLite 反降级：** 原 `migrateDatabase` 在 `CREATE TABLE IF NOT EXISTS scripts`、插入 schema_version **并 COMMIT 后**才检查最新版本，旧程序会先更动新版本 Data 再报错误。现在使用 `BEGIN IMMEDIATE` 串行事务，任何 DDL 前先确认现有版本记录恰好一条且为 v1，不明版本/较新版本/空记录/混合记录均拒绝并 ROLLBACK。新建 DB 的 v1 初始化和 v1 重开保留。新增四项测试 `packages/persistence/test/schema-downgrade.test.ts`；[RED #37935655066](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37935655066) 共 445 项，442 过 / 3 预期失败。SQLite Node 驱动结果是 null-prototype 对象，测试规范化为版本数字而非假设普通对象；修正后测试通过。
- **最终绿灯（当前代码、不含此账本提交）：** [Windows Development CI #37936043621](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37936043621) **446/446 tests PASS**，TypeScript、Electron 构建、GUI/SQLite 启动及真实 Chrome CDP smoke 全部 SUCCESS；[Contracts #37936043495](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37936043495) SUCCESS。没有生成中间 EXE/ZIP。
- **最终 Stable 缺口不变：** V2 真实非破坏性交互、V3 命名业务功能契约、V4 真 Tampermonkey/GM_* 运行、连续自动修复与验证、Win10 + 指定便携 Chrome155 的真实兼容测试、三种正式打包及发行门禁 RG-01~09 仍需完成。继续保留版本 alpha、Draft PR；没有充分证据不得声称 Stable。


## 2026-10-09 · 不可变归档原子发布与受管 current 双采样保护（453 项）

- **背景与 RED：** 之前不可变归档已支持有界写入、fsync、哈希回读，但在 `writeFile/open('wx')` 阶段提前占用最终内容寻址文件名；进程意外终止或另一个写入同时检查，会看到尚未完成的 hash-named 文件，从而卡住恢复并产生假冲突。新增两项确定性并发测试 `packages/patch-engine/test/immutable-archive.test.ts`：写入第一个 64 KiB 时正式路径必须仍不存在；两个独立写入同一内容不能把进行中的中间状态判为冲突。旧版 [RED #37936884884](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37936884884) **448 tests / 446 pass / 2 fail**。
- **归档原子发布：** `persistImmutableSnapshot` 改为在目标同一目录创建随机 `.staging-<uuid>.tmp`，完成有界分块写入、`FileHandle.sync()` 和 pinned SHA-256 验证以后，才使用 `link(staging,archive)` 对正式名称执行有排他保护的单步发布；`EEXIST` 时仅验证胜出的现有归档，绝不覆盖；最终删除本次临时 staging。失败或写入中断不会在最终文件名下留下残缺数据；断电后可能遗留被历史文件名过滤器忽略的临时文件。**明确的兼容限制：** managed Data 必须位于支持同目录硬链接的文件系统（Windows NTFS 通常支持；外置 FAT/exFAT 等要实测，不能默认支持），否则明确拒绝写入，不以不安全的重命名或复制 fallback 绕过安全边界。文件 fsync 不代表磁盘控制器断电可恢复，目录元数据持久性仍待真实故障注入验证。
- **current 激活原有隐患：** `activateManagedRevision` 先验证旧 `current.user.js` 归档身份，再以 `writeFile(temp)` / `rename(temp,current)` 覆盖；临时写入缺少 fsync/回读，外部文件可能在这两个阶段被编辑而没有在 rename 前再次核实。
- **current 双重验证：** 新增 `packages/repair-workflow/src/current-activation.ts` 的 `commitManagedCurrent`。已有 current 首先必须匹配归档 hash；新目标必须不存在；待激活内容写入独立 stage、同步到磁盘和 pinned SHA-256 校验成功，重检旧 current 未被外部变更，然后执行原子 rename 激活，并再次回读检查。可恢复写入错误/外部变化时原活动副本不被覆盖，私有 stage 尝试清理；源 `.user.js` 不动。新增五项故障注入回归测试 `packages/repair-workflow/test/current-activation.test.ts`，覆盖部分写可见性、同时编辑、突然出现、ENOSPC 和 symlink。初始 [RED #37937441199](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37937441199)；代码接入历史恢复后最终 GREEN。
- **最终开发自动验收（文档提交前的代码）：** [Windows Development CI #37937593340](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37937593340) **453/453 tests PASS**，严格 TypeScript、Electron 构建、Windows GUI/SQLite、真实 Chrome CDP smoke 全 SUCCESS；[Contracts #37937593272](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37937593272) SUCCESS。仍是开发分支 Alpha，不生成任何中途安装包。
- **残余风险与发行门禁：** Node 内置 `rename` 不是跨进程 compare-and-swap；重检 old-current 与 rename 之间仍有极短竞争窗口；持久化目录项与实际突然断电、异常 Windows 文件系统、杀毒软件文件占用必须在目标机受控验证。V2 真正非破坏性交互、V3 业务合约、V4 Tampermonkey/GM_*、完整自动自愈、Win10 + 指定便携 Chrome155 和 Setup/Portable/ZIP 三正式成品的独立 QA 仍未满足。PR #2 保持 Draft，main 不合并，不打 Stable tag。


## 2026-10-09 · 仅本地隔离 fixture 的真实 Chrome Input 验证（459 项）

- **执行判定：** V2/V3/V4 生产验证仍未实现，不可因为只读 DOM 匹配或合成浏览器执行而标记功能恢复。在禁止对真实网页主动点击的条件下，先建立一条**非破坏性、测试专用**的真实 Chrome Input + UI 事件验证链，作为未来 V2 引擎的隔离基础。该代码不作为 Electron IPC 发布，也不接受任何用户提交的脚本或任意 CSS。
- **TDD：** 新增 `tests/integration/local-fixture-interaction.test.ts`，初始 [RED #37938184644](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37938184644)；实现后模拟 socket 夹具因创建时间早于异步身份确认导致 `open` 事件丢失，测试超时而非真实 CDP 逻辑错误，已改为确认后创建 fake socket。续加两项负例验证“Input 已发出但业务标记没变时不准算 PASS”和“生产 Electron main/preload/renderer 不得引用 fixture Input 模块”。
- **测试专用实现：** `scripts/local-fixture-interaction.ts` 只接受显式 `approved:true`、`http://127.0.0.1:<非空端口>/fixture`、无 query/hash/用户信息且与 Chrome Target URL 完全相同的本地合成页面；在发送 Input 前确认顶层 Frame/Loader，固定 `#fixture-safe-click`、检查按钮属性与非零盒模型；只通过 `DOM.getDocument`、`DOM.querySelector`、`DOM.getAttributes`、`DOM.getBoxModel` 和两个有界 `Input.dispatchMouseEvent` 命令操作，之后读取固定 `data-usshm-v2-fixture=yes` 标记，最后再次比对文档身份。**没有 Runtime.evaluate、Page 导航、网络/CDP 外发、任意 selector、真实账号按钮或用户脚本执行**。结果 `validationLevel:'synthetic-fixture-interaction'`、`productionEligible:false`，不输出生产 V2/V3/V4 通过等级。
- **真实 Windows Chrome 验证：** `scripts/smoke-chrome.mjs` 的 disposable loopback fixture 添加安全按钮和本地标记监听器，CI 真实启动 Chrome（独立临时 profile），实际发送 CDP 输入事件并核查 marker。若只调用 Input 却未产生事件结果，测试不能通过。
- **最终自动化证据（文档提交前的代码）：** [Windows Development CI #37938870611](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37938870611) **459/459 tests PASS**，TypeScript、Electron 构建、GUI/SQLite smoke、真实 Chrome CDP（含 fixture Input）均 SUCCESS；[Node Contracts #37938877841](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37938877841) SUCCESS；[Windows CI #37938638189](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37938638189) 457/457 PASS。
- **安全和交付边界：** 本期没有在任意第三方网页点击/输入/发送，也未使用 Tampermonkey 插件或 GM_*；这个合成 V2 harness 不代表用户脚本 V2 已实现。外部网页需要单独风险分类、测试账号与明确白名单安全契约；V3 命名业务功能、V4 真正 userscript manager、Win10+Chrome155 指定便携实机、完整自动自愈与 Setup/Portable/ZIP RG-09 仍为阻断。没有制作中途安装包，不合并 main、不发 Stable。


## 2026-10-09 · 修复预览有界读取、首次激活防抢占、候选 Frame/Loader 绑定及 GM 静态清单（470 项）

- **执行范围：** 继续 `feat/v01-continuation` / Draft PR #2，所有修改基于真实 GitHub HEAD 的 TDD RED/GREEN 自动化，不要求用户人工验收、不构建预览 EXE/ZIP。新增安全防线和 V4 真实插件之前的 AST/权限基础能力，保留原始脚本只读。
- **修复预览读取竞态：** Electron Main `usshm:propose-repair` 原先在已扫描路径上直接执行 `readFile(item.path)`，在文件被替换/增大时可能发生无界分配与符号链接穿越。新增 `apps/desktop/tests/repair-proposal-pinned-read.test.ts`，旧版 [RED #37939880207](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37939880207) **460 tests / 459 pass / 1 fail**。现 Main 执行 `lstat` 普通文件与 symlink 检查、`readPinnedRegularFile(item.path,{maxBytes:512*1024,expected:sourceInfo})`，读取阶段硬预算、open descriptor 身份及返回前路径复验；不放宽后续 SHA256 匹配与审批。
- **首次活动 revision 并发保护：** `commitManagedCurrent` 在 `expectedActiveHash===null` 时先检查不存在、写完 staging，然后用普通 `rename(stage,current)`，存在最后一次检查之后其他进程创建 current 仍被覆盖的风险。新增精准 `beforePublish` 内部注入测试，模拟检查后第三方抢先建立 current。旧版 [RED #37940145614](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37940145614) **461 tests / 460 pass / 1 fail**；首次激活改为同目录 `link(stage,current)` 的**无覆盖原子发布**，如 `EEXIST` 拒绝并清理本次私有 staging，第三方已创建内容保留。existing current 的重检→rename 仍非 OS compare-and-swap，必须在 RG-06 中保留跨进程残余窗口。阶段 [GREEN Windows CI #37940273094](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37940273094) **461/461**。
- **候选修复跨同 URL 导航：** `suggestCandidateRepairs` 仅比较 target ID+URL；即使 Chrome 在旧定位探针、快照、候选复核之间换了相同 URL 的 Frame/Loader，也可能生成伪“DOM candidate verified”建议。新增 `packages/candidate-engine/test/candidate-document-identity.test.ts` 的 Loader 切换、缺失身份、稳定身份案例，旧版 [RED #37940469177](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37940469177) **464 tests / 461 pass / 3 fail**。引擎现于探针前、探针后、快照后、候选确认后逐阶段验证 `confirm` 的 live Frame/Loader，并以 `assertStablePageDocument` 比对。生产 Main 所有单项、批量、SiteAdapter 候选入口及真实 Windows Chrome smoke 均传入 `confirmPageIdentity`。
- **候选裸调用必须 fail-closed：** 原先 `CandidateDeps.confirm` 是可选项，库直接调用且未传 Frame/Loader 仍生成 verified 候选。新增负例 [RED #37940852706](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37940852706) **465 tests / 464 pass / 1 fail**。现类型必填 `confirm`，运行时缺失立即阻断；已有合法 mock / bulk 夹具均补上身份确认，阻断角色不触发实际 CDP；[GREEN Windows CI #37941174943](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37941174943) **465/465**。
- **GM/Tampermonkey 静态权限清单：** 新增 AST-only `managerApiCalls`，记录 `GM_getValue(...)`、`GM.setValue(...)`、`GM['deleteValue'](...)` 和 `GM[dynamic]` 的名称、行列、`@grant` 声明覆盖或未知，忽略字符串/注释和其它对象的同名方法。对于 `@grant none` 下调用受权限影响的 GM API，静态显示可能缺少声明，不推断实际扩展注入；每条强制 `evidenceLevel:'static-only',managerVerified:false`。新增四项测试 `packages/source-analyzer/test/manager-api-inventory.test.ts`，[RED #37941620693](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37941620693) **469 tests / 465 pass / 4 fail**。AST 无法可靠处理局部变量 shadowing、外部 `@require` 或动态 GM 分发时，记录仅为**可能引用**，不是权限诊断定论。
- **GM 清单 UI：** 在脚本详情展示 “GM 权限静态清单”，仅列出 API 名/行号/声明状态，一次最多 30 条，余下折叠，完全不显示调用实参（可能包含私密储存 key），明确 **V4 未验证**。新增 `apps/desktop/tests/manager-api-inventory-ui.test.ts`，[RED #37941858605](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37941858605) **470 tests / 469 pass / 1 fail**。
- **最新 GREEN 开发验证（本条账本提交前）：** [Windows Development CI #37942009742](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37942009742) **470 / 470 PASS**、严格 TypeScript、Electron 构建、Windows GUI/SQLite 冒烟和真实 Chrome CDP 合成测试均 SUCCESS；[Node Contracts #37942009657](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37942009657) SUCCESS。所有生产 CDP 身份和文件/权限边界仍不执行未知用户脚本。
- **未解决 Stable Gates：** 尚未提供真实 V2 用户安全交互、V3 命名业务契约、V4 真 Tampermonkey GM_* 注入/权限证据、目标 Windows 10 和指定 portable Chrome155 的真实兼容验证、正式 Setup/Portable/完整 ZIP 各自安装/升级与回滚/供应链证据及 RG-01~RG-09 闭环。**本提交不是 Stable，保留 Alpha、Draft PR，绝不合并 main 或打 Stable tag。**


## 2026-10-09 · 主进程 CDP 批量取消租约与计算属性 AST 覆盖（481 项）

- **背景 / P0：** 在 `feat/v01-continuation` 上继续执行 Superpowers 测试先行。桌面 UI 既有 `BatchPauseGate` 和 `cancelDiagnosis`，但“取消剩余检查”旧按钮仅设置 Renderer 本地布尔值，直到 in-flight page 的 `ipcRenderer.invoke('usshm:batch-diagnose')` 返回，才把取消传给 Main。Main 在 await CDP 返回后仍可无条件 `batchEvidence.record`、`journal.recordPage`；切换/重试任务可能写入已经被用户取消的过时文档证据。另一个风险是两次 same-offset 请求并发提交或旧超时请求延迟成功。
- **TDD RED：** 新增 `packages/scan-service/test/diagnosis-request-gate.test.ts` 六项、`apps/desktop/tests/diagnosis-cancellation-wiring.test.ts` 两项。最初 [RED #37942990710](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37942990710) **471 tests / 470 pass / 1 fail**（Main 授权租约实现缺失）；补上 Main 入口的接线测试 [RED #37943265468](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37943265468)；同页重试需新的独立租约 [RED #37943533144](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37943533144) **478 tests / 475 pass / 3 fail**（Main/Renderer 接线、旧租约重生）。
- **执行引擎：** `packages/scan-service/src/diagnosis-request-gate.ts` 在 Electron Main 按 `scanId+targetId` 管理不可共享的单页租约。 `begin` 强制 offset=0 开始、25 分页顺序、同一目标单请求在途； `assertCurrent(ticket)` 在每个有 await 的 CDP 阶段结束之后、落盘前执行； `complete` 验证完整页与 total；`cancel` 同步撤销 in-flight page；`invalidateAll` 在新扫描开始时撤销之前所有批次。旧租约的晚到失败 `failIfCurrent` 返回 false，不能把重启后的新报告/SQLite 日志错误清空。
- **传输重试裁决 Ruling：** 保留原有 `collectPagedDomDiagnosis` 最多 1 次的严格 read-only CDP 传输短故障重试。只有 `isTransientCdpReadError` 精确白名单命中才 `releaseForRetry`，原有已提交的页和 journal 不能被清除；重新请求相同 offset 必须得到全新租约编号，旧请求即使迟到也不能拥有提交权限。身份变化、权限错误、证据结构错误、浏览器导航都不能触发传输重试。错误如果永久性才阻断该 run、清除失效信任证据，不能污染新 run。
- **UI / IPC 实际接通：** “取消剩余检查”按钮现在在设置本地 `batchCancel` 后**立即**异步发送 `window.ussm.cancelDiagnosis({scanId:result.scanId,targetId})`；主进程 `usshm:diagnosis-cancel` 先撤销租约，再将 journal 标注 cancelled。一个正在运行的读取可继续自然返回，但其结果在 Main 被拒绝，不会持久化，也不会获 V1 声明。无需连接真实网站、无需用户验证、不添加浏览器写命令。原有 `dom-report-ui.test.ts` 与旧的“所有错误一律清空”静态断言升级，确保与正确的部分进度保留/过期回调隔离相符。
- **综合回归：** [GREEN Windows Development CI #37944104196](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37944104196) **478/478 PASS**，TypeScript、Electron build、Windows GUI/SQLite、真实 Chrome CDP smoke 成功。另新增 `tests/integration/diagnosis-cancellation-transaction.test.ts` 两项端到端*本地模型*集成测试，模拟第 1 页 25 条已持久化、第 2 页仍待 Chrome、取消→晚到结果拒绝，并检查 SQLite cancelled 且前 25 条保留、旧失败无法删除新批次。 [GREEN #37944410578](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37944410578)。
- **FR-012 计算方法调用覆盖：** 之前 AST 仅抽取 `ts.PropertyAccessExpression` 形式 `document.querySelector('...')`；使用 `document['querySelector']('...')`、`document[dynamicMethod]('...')`、`panel['matches']('...')` 时静态清单缺失，可能漏报 DOM 依赖。新增 `packages/source-analyzer/test/selectors.test.ts` 断言这类调用显示已知方法名或 `<computed>`、接收者、参数及 `runtimeRequired:true`（绝不静态标 V1 通过），任意其它对象上不明方法不随便认作选择器。[RED #37944589392](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37944589392)，修复后 **[GREEN Windows Development CI #37944737714](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37944737714) 481/481 PASS**，TypeScript、Electron build、Windows GUI/SQLite、真实 Chrome CDP smoke 全成功。
- **边界：** 这是更准确的 CDP 证据和 AST 覆盖，不代表任何未知用户脚本已通过 V2 真交互、V3 业务功能、V4 真实 Tampermonkey/GM_*。没有自执行 JS、没有用户站点 click/submit/delete/pay、没有原件改写，也没有制作中途安装包。
- **Stable 仍阻断：** V2/V3/V4 生产闭环、用户 Win10 x64 + 指定 portable Chrome155 实机、三形式 Setup EXE / Portable EXE / 完整 ZIP 的正式独立 QA（RG-01~09）未完成。保留 `0.1.0-alpha.5`、PR #2 Draft，未经证据不合并 main、不发布 Stable。


## 2026-10-09 · 唯一 DOM 候选自动预览、受管补丁及单独审批恢复链（491 项）

- **任务 / 目标：** 继续 `feat/v01-continuation` 开发而非只做回归；让符合严格检查的单一 CDP 候选可以直接生成**尚未写入的修复预览**，不再要求用户把生成的选择器复制进另一个输入框。该步骤不是“自动修复已完成”；用户受管版本的最终写入仍需要现有独立 `applyRepair(approved:true)`，不得改动原始 `.user.js` 或 Tampermonkey 已安装内容。
- **TDD RED → GREEN：** 新增 `packages/repair-workflow/test/verified-preview.test.ts` 五项：唯一候选只生成预览、零或多个候选 `needs-review`、同 URL frame/loader 重载拦截、源码 hash 改变拒绝、伪候选和伪造 draft/proposal 必须失败且撤销。最初缺少编排模块，[RED Node Contracts #37945804406](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37945804406)；完成核心编排 [GREEN #37945953768](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37945953768)。
- **实现：** `packages/repair-workflow/src/verified-preview.ts`：固定 `approved:true`、有效 HTTP(S) target、字面量 document locator 和 source hash；每阶段检查 `confirmPageIdentity` 的 frame/loader、 `verifySource` 和 proposal/hash/候选身份，禁止返回任何“业务功能 V3 或 GM V4 已验证”假阳性。对候选 `validationLevel:'dom-candidate-verified'`、`source:'DOMSnapshot'`、`matchCount===1`、`approved:false` 强校验；恰好一个候选才继续，不能主观选择排序第一名。结果始终 `verificationLevel:'dom-only'`、`productionVerified:false`、`V2:'blocked'`、`V3/V4:'not-configured'`。
- **预览撤销隔离：** 新增 `createRepairWorkflow.discard(proposalId)`，只撤销一个因页面加载变化而过期的暂存补丁，不清除其它已审批预览、也不删除任何已归档文件。新增 `packages/repair-workflow/test/workflow.test.ts` 回归；[RED #37946046844](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37946046844)；独立 apply 必须有批准方可修改受管修订。
- **Electron + UI 全链路：** 增加经 Main 白名单 `usshm:prepare-verified-preview` 的窄 IPC；Renderer 只传 scanId、itemIndex、selectorIndex、targetId 和同意标志，不接受 renderer 选择的 CSS、score、source path 或候选名单。Main 从当前授权扫描记录加载 AST，核实用户站点 `@match/@include`、真实 Chrome CDP page、旧 selector 确实 0 匹配，读取 512KiB capped pinned source 并检查 SHA-256，调用 `suggestCandidateRepairs` 和受管 `repairs.propose`；只有通过完整证据复核后才 `pendingApprovals.register`。新 UI 按钮 “自动准备唯一候选的受管修复预览” 仅在现有 page probe 标记 `missing` 时可点。获取唯一候选则自动填写预览，仍需用户**单独审核保存**；否则 `needs-review` 不写入原始文件或 managed Data。新增 `apps/desktop/tests/verified-preview-ui.test.ts` 两项；[UI 接线 RED #37946341562](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37946341562)。
- **类型与集成门禁：** Windows/Node strict TypeScript 捕获 async callback 的 `scriptId:string|undefined` 类型缩窄，[RED #37946421134](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37946421134) 489 tests PASS 但 typecheck FAIL；在 Main 已严格校验 `item.scriptId` 后显式标明后续闭包引用的非空条件，修正通过。新增 `tests/integration/verified-preview-managed-workflow.test.ts` 两项真实临时文件集成验证：合成已确认候选→无受管 current 的修复预览→禁止未批准 apply→批准后管理目录独立修订→精确 SHA 恢复原始字节且原件不动；Chrome 同 URL reload 在提案创建后发生会撤销审批，不能 apply 或写入 current。
- **最终 GREEN（账本提交前）：** [Windows Development CI #37946907746](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37946907746) **491/491 tests PASS**、TypeScript/构建、真实 Electron GUI+SQLite、真实 Chrome CDP smoke 全 SUCCESS；[Node Contracts #37946907670](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37946907670) SUCCESS。没有构建用户所说不需要的中间预览安装包。
- **Ruling / 安全边界：** 继续保留预览与写入二阶段，虽然用户要求免人工验证：现有 CDP DOM 匹配无法证明新 locator 的语义等价性，也无法证明任何 Tampermonkey 已执行、V2 interaction、V3 业务功能或 V4 GM_* 权限实际可用；**自动写入/部署到原件或扩展会产生不可验证风险，不能为了进度绕过安全审批**。未来满足明确无破坏性的 V3/V4 业务合约与 rollback 自动保护后，才可对明确定义的低风险托管场景单独评审自动应用。
- **剩余 Stable 阻断：** 生产 V2/V3/V4、真实 userscript manager、Win10+指定 portable Chrome155、可回退连续自愈/QA-031~041、RG-01~09 全面验收和 Setup/Portable/完整 ZIP 三正式发行均未通过。保持版本 `0.1.0-alpha.5`、PR #2 Draft，`main` 未合并、不发 Stable tag。


## 2026-10-09 · V1 DOM 不可能基数阻断与已应用受管修订真实 Chrome 复核（503 项）

- **执行目的：** 继续 `feat/v01-continuation` Native Superpowers 开发；上一轮已实现“唯一 CDP 候选→修复预览→独立审批写入”，但修订被保存不等于修订中的真实 DOM 选择器已在 Chrome 成立。本轮增加了基于不可变 revision 与实时 Chrome 的独立、授权、只读 V1 修复后验收入口，不执行任何真实用户脚本或网页写入行为。
- **P0 V1 证据真实性：** `packages/test-runner/src/index.ts` 旧 `readCount()` 在 `querySelector` / `getElementById` 的 `matchCount>1` 甚至 `ambiguous+1` 情况下可能认证“V1 exists”。新 `packages/test-runner/test/read-only-evidence-cardinality.test.ts` 四项先 RED，[#37948012424](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37948012424) **495 tests / 493 pass / 2 fail**；添加 single-element API 的 count=1 不变量，并拒绝矛盾 `ambiguous+1`。既有「exists 多节点匹配」测试原错误使用 `querySelector` 假多节点，改为真实 `querySelectorAll` 合法集合，结果 [GREEN #37948266841](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37948266841) **495/495**。不得以修改程序使旧不可能 fixture 继续通过。
- **真实受管修订读取：** 新增 `packages/repair-workflow/src/managed-locator.ts` 的 `readVerifiedManagedLocator`。只接受安全绝对 DataRoot、`scriptId`、64 hex revision SHA-256、0~49 selectorIndex；先验证经过不变性哈希检查的 `revision-<hash>.user.js` 存在，再用 pinned handle 有界读取 `current.user.js` 并确认哈希与指定已批准 revision 一致。AST 只能返回顶层 document、支持字面量方法且静态无动态风险的真实修订选择器。缺失归档、被回滚、外部改写、symlink、错误索引或动态选择器 fail closed。新增 `packages/repair-workflow/test/managed-locator.test.ts` 五项功能/负例；初期构造测试因少写了 fixture 括号出现 SyntaxError（非产品问题），已按日志更正。
- **Production Electron V1 回归按钮：** `usshm:verify-managed-dom` Main IPC 接受已授权 scan/item/index/revision SHA、当前选中的真实 Chrome page 和显式 `approved:true`；先核验扫描源文件的 pinned SHA-256 与网页 `@match` 匹配，再由上述 helper 确认 active managed revision 和实际 AST，调用现有两次采样 `runReadOnlyDomContract`（允许 opaque node fingerprint 与 frame/loader）。CDP 完毕后再次重读 managed revision 和扫描会话 epoch，避免把结果贴到已回滚/外部改写的文件。Preload 只开放指定 IPC，Renderer “只读复核受管修订 V1” 按钮绑定被保存的 `itemIndex + selectorIndex + revisionHash`。界面注明 `V2/V3/V4 未验证`，不谎称 Tampermonkey 已注入，也绝不点击网站。对应 `apps/desktop/tests/managed-dom-verification-ui.test.ts` 两项 TDD（[RED #37948932742](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37948932742)）。
- **Windows 真 Chrome 端到端：** `scripts/smoke-chrome.mjs` 在既有隔离 127.0.0.1 测试网页中，实际执行合成用户脚本的「旧 DOM missing → 受管补丁保存」后重新读取 active revision #0，要求确为 `#heal-button`，在真 Chrome CDP 环境两次检查同一 backend node fingerprint，结果必须 `V1 passed`，并显示 `V3 not-configured` 与 `managerVerified:false`。对应 `tests/integration/managed-dom-chrome-wiring.test.ts` 先 RED [#37949392699](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37949392699)，初次 Windows CI 中线路测试正则对分行格式过严，已修正；真正 Chrome 冒烟采用实际运行期断言，没有借静态检查虚构成功。
- **最终自动验证（此账本提交前）：** [Windows Development CI #37949652165](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37949652165) **503 / 503 PASS**，严格 TypeScript 检查、Electron 构建、GUI/SQLite 真实启动、Chrome CDP 全套 fixture smoke（包含修订后 V1）全 SUCCESS；[Node Contracts #37949661009](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37949661009) SUCCESS。
- **Ruling / 安全与发行边界：** 当前只能从唯一且经过归档的受管脚本修订检验 V1 DOM 静态选择器在当前 Chrome 页面中两次出现/唯一；**仍不是** Tampermonkey 插入、用户脚本执行、V2 无破坏性交互、V3 用户指定业务合约或 V4 GM_*。不以“保存修订成功 / V1 passed”冒充“自动自愈成功”。用户要求无需人工验收，但无法在缺失真实用户插件与 Windows10/portable Chrome155 的设备情况下伪造验收；三正式 Setup/Portable/ZIP 的最终 Windows QA 与 RG-01~09 未满足。当前版本保留 `0.1.0-alpha.5`、Draft PR，未合并 main、未打 Stable tag，也没有制作中途预览安装包。


## 2026-10-09 · 受管自动保护：保存→真实 Chrome V1 双采样→条件式精确回滚（513 项）

- **任务目的 / Ruling：** 开发真正由程序承担的最小无破坏性自愈防线，不再把「保存受管脚本」与「只读 Chrome 检查」分成只能人工衔接的两个步骤。受限于 V3/V4 真实 userscript/GM_* 运行证据尚未建立，只允许用户**一次明确审批的受管脚本修订**进入自动 V1 防线；V1 是 DOM 合约而非真实业务成功。若 V1 未通过或无法取得可靠证据，自动恢复软件自己管理的已归档上一修订；绝不触碰用户原始 `.user.js` 或 Tampermonkey 已安装脚本。
- **核心 TDD / RED：** `packages/repair-workflow/test/guarded-v1.test.ts` 五项先测试：严格 V1 两次采样可以保留；`failed/needs-review`、Chrome 中断、一次采样、V3/GM 假宣称都必须触发回滚；回滚异常必须返回 `rollback-blocked`；无明确授权/伪哈希/危险 scriptId 不能进入 IO。[Node RED #37950770418](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37950770418) **504 tests, 503 PASS, 1 FAIL**，缺 `guarded-v1` 模块。随后实现 `packages/repair-workflow/src/guarded-v1.ts` 严格 fail-closed，返回仅 `retained-v1`／`rolled-back-v1`／`rollback-blocked`，V2 blocked、V3/V4 not-configured、functional/managerVerified 均为 false。[Node GREEN #37950908594](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37950908594) PASS。
- **回滚目标不可由 Renderer 伪造：** `createRepairWorkflow.inspectPending(proposalId)` 从 Main 管理的未应用 `LiteralPatchDraft` 返回只读 `scriptId`、`previousHash=baseHash`、`proposedHash`、`newSelector`；草稿已应用或作废后返回 null，不能根据客户端提交的 before/after SHA 判定。新增 Main draft provenance TDD，[RED #37950996588](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37950996588) **509 tests, 508 PASS, 1 FAIL**。
- **IPC/UI 二阶段自动防线：** 在原有单独的 `apply-repair` 按钮之外，添加 `usshm:apply-repair-guarded` 和 UI 「保存并自动 V1 复核，失败恢复上一修订」。仅接受用户已审批的 proposalId/scanId/已选脚本/selectorIndex/Chrome target；Main 检查 `pendingApprovals.require`、source pinned 512KiB SHA256、授权路径、Userscript `@match` 范围、当前 Chrome Frame/Loader；执行批准的 `repairs.apply` 后，检查实际 managed AST 的 selector **必须等于 Main draft 的 replacement**，调用 V1 两次 CDP DOM 采样并复核活动 revision 及网页身份；状态不明不当成功。写入操作不开放给 Renderer 任意源代码/CDP 点击/任意目标文件。旧 UI 预览/单独保存依然可用。[接线 RED #37951435252](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37951435252) **511 tests, 510 PASS, 1 FAIL**。
- **并发覆盖阻断 / P0：** 若 Chrome 验证期间别的已批准 managed revision 成为活动文件，旧操作的自动回滚绝不能覆盖新的合法修订。新增 `packages/repair-workflow/test/workflow.test.ts` 精准负例，旧 `restore` 会覆盖后来的新版本，[RED #37951646570](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37951646570) **512 tests, 511 PASS, 1 FAIL**。现在 `flow.restore({expectedCurrentHash:applied.hash})` 传到 `activateManagedRevision`：原子操作事务启动前核验活动 current 是**本次失败修订的预期 SHA**，然后由既有 `commitManagedCurrent` 在激活前再次有界验证；外部修改、不同合法修订、symlink 或无法写入必须阻断回滚，**不声称成功/不自动删除用户数据**。同一进程仍保持 per-script apply/restore 锁；Node 多进程跨进程 CAS 仍受原有 RG-06 约束。
- **真 Windows Chrome 负例：** `scripts/smoke-chrome.mjs` 在 disposable `127.0.0.1` synthetic userscript 流程中额外批准一份故意错误的 `#usshm-absent-guarded` 受管修订，真实 Chrome V1 合约无法确认该元素；`guardAppliedManagedRevision` 自动恢复先前保存的正确 `#heal-button` 修订，并断言 `current.user.js` 与不可变 predecessor 的字节完全一致。随后继续旧有双 selector 连续修复、合成 V3 结果、回滚、导出整套 smoke。新 `tests/integration/guarded-rollback-chrome-wiring.test.ts` 确保真实 Chrome 脚本未误删该负例；**不会在真实用户站点点击、执行未知脚本或部署至浏览器扩展**。
- **测试和类型修复：** 首个含端到端接线的全局回归达到 513 tests 通过，但 TypeScript `exactOptionalPropertyTypes` 发现 optional rollback 参数不能直接传 `undefined`，[RED #37951955793](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37951955793)；修复为仅有值时才传入。**最终 GREEN（此账本提交前）**：[Windows Development CI #37952077979](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37952077979) **513/513 PASS，0 FAIL**，TypeScript strict、Electron 构建、真实 Windows GUI/SQLite、真实 Chrome CDP（含自动回滚与后续修复）全 PASS；[Node Contracts #37952084397](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37952084397) PASS。
- **Stable 仍阻断：** V1 成立不等于脚本自动恢复了 V3/V4 业务逻辑。正式生产 V2 用户明确安全交互、真正 Tampermonkey/GM_* V4 运行、Windows10 x64 + 用户指定 portable Chrome155 真机、三正式 Setup/Portable/完整 ZIP 各自启动/升级/回滚/签名/迁移验收（RG-01~09）未通过。不合并 main、不打 Stable 标签、不制作中途预览包。当前仍为 `0.1.0-alpha.5`。

## 2026-10-09 · 跨进程受管修订写入排他锁、审批前驱版本 CAS（516 项）

- **目标与漏洞：** 原 `commitManagedCurrent` 对已经存在的 `current.user.js` 使用最后一次 hash 校验后再 `rename`，两个独立桌面进程可在检查后各自提交，后提交者覆盖另一个合法受管修订。原 `createRepairWorkflow.apply` 写好 archive 后调用 `activateManagedRevision` 时还会重新采用“最新的 current”作为预期版本，导致不同进程审批的旧预览可能夺走较新结果。
- **测试先行 RED：** 增加 `packages/repair-workflow/test/cross-process-activation.test.ts` 三项确定性失败测试：第一个 writer 在发布前主动触发第二个竞争 writer；外部留存的占用锁不得自行抢占；历史修订激活必须支持 `expectedCurrentHash:null`（要求 current **不存在**）与完整 SHA-256 前驱值。提交 `f3642d9`；[Node contract RED #37953354395](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37953354395) 与 [Development CI RED #37953354474](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37953354474) 均如预期在新回归测试失败。
- **最小安全实现：** `packages/repair-workflow/src/current-activation.ts` 在所有验证及暂存之前通过 `mkdir(activePath+'.write-lock')` 获取由同卷文件系统管理的独占写锁；同名锁存在即拒绝，**不**自行推断过期、不删除未知进程锁。进入事务后校验 preimage SHA、分块 `fsync`、回读 staging、只在持锁期间发布 current、二次 pinned 读取目标，finally 归还其独占锁。崩溃残锁需要停掉所有应用实例、检查受管 current 和 archive 后进行离线恢复，不能运行中自动抢锁。
- **审批前驱 CAS：** `activateManagedRevision` 明确区分 `undefined`（传统手动恢复没有指定预期前驱）、`null`（必须尚无 active current）、64 位十六进制 SHA（必须精确匹配现有活动内容）。`createRepairWorkflow.apply` 使用 Main 自身保存的预览 `draft.baseHash` 或 `null` 绑定激活，不由 Renderer 选择一个较新的 current 再覆盖。工作流同进程 per-script `Set` 互斥仍保留，跨进程互斥由文件系统锁承担。
- **最终自动化 GREEN：** [Windows Development CI #37953531244](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37953531244) 对代码 HEAD `50a2fdc431636133c4c83299ab66d34e082d7216` 执行 **516/516 tests PASS、0 FAIL**、严格 TypeScript、Electron build、真实 Windows GUI + SQLite、真实 Chrome CDP smoke 全 SUCCESS。[Node Contracts #37953531162](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37953531162) SUCCESS。
- **安全范围：** 此锁仅用于同文件系统、遵守相同协议的受管写入进程，不能防御有意删除锁/替换受管目录的恶意本机进程，也不是 Windows 原生内核级 CAS、跨磁盘分布式锁或断电恢复事务。发生硬中断可能遗留 `.write-lock` 并 fail-closed。没有修改用户原件或 Tampermonkey 扩展，没有中途预览安装包。
- **Stable Release Gate：** RG-06 的合作进程覆盖风险显著降低，但 Windows 10 x64 + 用户指定 portable Chrome 155、真实 Tampermonkey / GM_* V4、真实 V2/V3 业务契约、崩溃恢复/离线锁清理策略和三种正式发行物 RG-09 尚无完整验收。继续 `0.1.0-alpha.5` / PR #2 Draft，不合并主分支、不打 Stable tag。

## 2026-10-09 · 受管自愈自动保留必须是真实 V1 唯一目标（517 项）

- **风险：** `guardAppliedManagedRevision` 旧逻辑只要求 `status:'passed'`、两次取证和 `matchCount>=1`，没有校验 `expectation:'unique'`。即使 CDP 契约只是多个 DOM 元素存在（`exists`），自动保护层也可能把结果标成 `retained-v1`，弱化修复后安全判断。
- **TDD RED：** 扩充 `packages/repair-workflow/test/guarded-v1.test.ts`，验证 `exists` / 多匹配 / 未指定契约不得保留错误补丁；现有有效样本改成 `expectation:'unique'`。测试提交 `89b0448` 后 [Node Contracts RED #37954130544](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37954130544) **517 tests / 516 pass / 1 expected fail**，失败原因为弱契约被错误判为 retained。
- **最小实现：** `packages/repair-workflow/src/guarded-v1.ts` 的自动保留条件增加 `evidence.expectation==='unique'` 与 `evidence.matchCount===1`，并保留 Frame/Loader、源码/受管字节 SHA 与 V2/V3/V4 不可冒充的旧约束。Desktop Main 的 `usshm:apply-repair-guarded` 不再为 `querySelectorAll/getElementsByName/getElementsByClassName` 自动降低为 `exists`，统一执行 read-only `unique` 两次后验收；集合 selector 匹配多个元素时安全回滚，而不是宣称自愈成功。增加 Electron 接线回归限制以后误改。
- **GREEN：** [Windows Development CI #37954282767](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37954282767) 对 `9f4106c608da63f10c27723a81c44f1544d7bce5` **517/517 PASS、0 FAIL**，strict TS、Electron build、Windows GUI/SQLite、真实 Chrome CDP smoke 全成功；同 SHA [Node Contracts #37954282760](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37954282760) PASS。
- **边界：** 仅加强已批准受管修订的 DOM 唯一性守护；无浏览器脚本经理注入、GM_* V4、网站业务 V3 或授权真实 V2 交互。仍为 Alpha / Draft，不合并 main，不发布 Stable，不生成中间预览安装包。

## 2026-10-09 · SiteAdapter V1 拒绝自相矛盾的 DOM 集合状态（518 项）

- **根因：** `runSiteAdapterRoleDomCheck` 的 `counts()` 只要 `matchCount>0` 就接受 `found` 或 `ambiguous`。但全部 SiteAdapter role 策略采用 CDP `DOM.querySelectorAll`，其读取器在任何正数匹配时均声明 `found`；`ambiguous` 同时携带 1 个或多个完整节点指纹属于不可能的状态。之前这种矛盾仍可被升级到 `matched-v1`。
- **TDD RED：** 新增 `packages/test-runner/test/site-adapter-role.test.ts` 回归，用 `count=1` / `count=2` 且提供完整 nodeFingerprints 的矛盾 `ambiguous` 证据，要求 `needs-review/evidenceLevel:none`。测试先提交 `183fab0`，[Node Contracts RED #37954976398](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37954976398) 明确 **518 tests / 517 pass / 1 expected fail**。
- **实现与边界：** `packages/test-runner/src/site-adapter-role.ts` 的集合证据消费仅在 `matchCount>0` 且 `status==='found'` 时继续验证 fingerprint、样本稳定性、Frame/Loader、页面状态；不再把自相矛盾的 `ambiguous` 状态认证为 V1。这只影响 SiteAdapter 只读角色 DOM 诊断，不运行脚本，不触碰真实用户站点，不宣称 V2/V3/V4。
- **GREEN：** [Windows Development CI #37955065066](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37955065066) 针对代码 SHA `5d226b6528e0ebac708f4ba3dbd30a24ae586601` 显示 **518/518 tests PASS、0 FAIL**；TypeScript、Electron build、Windows GUI+SQLite、真实 Chrome CDP 冒烟均通过。[Node Contracts #37955064876](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37955064876) PASS。
- **Stable 阻断未改变：** 真实 Tampermonkey/GM_* V4、V2/V3 用户业务契约、Win10+用户 portable Chrome155 实机、RG-01...09 与正式 NSIS/Portable/ZIP 三个发行包尚无完整验收。继续 `0.1.0-alpha.5` 与 PR #2 Draft；不发布 Stable、不合并 main、不制作中途预览安装包。

## 2026-10-09 · 受管归档完整性诊断、真实双进程写锁测试（528 项）

- **用户需求：** 不需中途安装包或人工验证，继续向最终 Stable 的灾难恢复/多实例安全门槛推进。上轮已在 `current.user.js.write-lock` 对合规 writer 串行化，但发生程序异常退出、遗留锁、归档损坏/活动文件外部修改时，GUI 尚不能直接判断是否可以安全继续。
- **RED 首先复现：** 添加 `packages/repair-workflow/test/managed-health.test.ts` 7 个真实临时文件测试，覆盖无历史、有效归档与匹配 current、缺失 current、外部修改、不可变 hash 损坏、已占用 writer lock、symlink 不得跟随及危险 scriptId 拦截；[Node Contracts #37956019233](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37956019233) 按预期失败于缺失实现模块。另添加 `apps/desktop/tests/managed-health-ui.test.ts` 2 个安全 IPC/renderer 接线 RED：必须由 Main 从已授权 scan/item 和 Data root 决定路径，不可从 renderer 提交任意文件路径或执行锁清理。
- **新能力实现：** `packages/repair-workflow/src/managed-health.ts` 加入有界、只读、无用户代码执行的 `inspectManagedIntegrity`，返回固定枚举 `healthy/empty/missing-current/unarchived-current/damaged-archive/write-locked/unsafe`，归档数及**只有匹配经验证归档**才返回的 current SHA-256。检查 Data 层级 symlink/目录类型、锁目录占用、归档哈希与 pinned file identity。遇见可能活跃或残留锁一律 fail-closed；绝不自动抢锁、删除、覆盖文件，亦不泄露未知修改脚本的 hash。
- **桌面贯通：** Electron Main 白名单 `usshm:managed-health` 绑定当前扫描 `scanId/itemIndex`、授权源文件与内部 dataRoot；preload 只开放该只读方法。Renderer 历史工作台增加“检查受管资料完整性”、中文状态说明、锁占用及仅 V0 文件字节一致性边界。不同脚本/新扫描重置旧诊断状态，避免展示过期资料。
- **TS RED→GREEN：** 首次整体接线 `d2f659a` 的 Node 测试 **527/527 PASS**，严格 TS 因新 JSX 缺一个条件表达式闭合符而失败，[Node CI #37956303981](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37956303981)；立即修复后 [Windows CI #37956394644](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37956394644) **527/527 tests PASS**，严格 TypeScript、Electron build、真实 Windows GUI/SQLite、Chrome CDP smoke 全 PASS。
- **真实跨 OS 进程测试：** 另增 `tests/integration/managed-lock-process.test.ts`，父进程在受管修订持锁、发布前暂停时启动**另一个 Node 进程**竞争同一路径与旧 SHA；子进程必须收到被占用拒绝，父进程成功发布并清理锁/暂存，不再仅依赖同进程两个 async 调用模拟并发。最终 [Windows Development CI #37956693652](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37956693652) **528/528 PASS / 0 FAIL**、TypeScript、Electron GUI/SQLite、真实 Chrome CDP smoke 全 SUCCESS；[Node Contracts #37956693835](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37956693835) PASS。
- **仍未满足 Stable：** 诊断是有限时点的文件字节与目录健康，不能证明 Tampermonkey 注入、GM_*、真实业务 V3/V4、浏览器交互 V2、断电回滚事务，也不可能代替用户所指定的 Win10 x64 + Chrome 155 portable 实机与三形式正式发行 QA/RG-01...09。维持 `0.1.0-alpha.5`、PR #2 Draft、无 Stable tag、无中途安装包。

## 2026-10-09 · Windows 完整 ZIP 单一产出通道修复（529 项）

- **真实发行阻断：** 旧版 `package.json` 的 `dist:win` 以 `electron-builder --win nsis portable zip` 同时要求 Builder 直接输出 ZIP；`build/electron-builder.yml` 也设置 `target:zip`。但现有 GitHub `windows-build.yml` 与 `scripts/package-windows.ps1` 还会从 `release/win-unpacked` 对**同一版本和文件名**再执行 `CreateFromDirectory`，造成重复 ZIP 产出、覆盖或冲突。开发期 Windows CI 没有打包，所以此前的 528 test PASS 不代表发行流程无误。
- **TDD RED：** 先改 `apps/desktop/tests/three-target-release-contract.test.ts`，要求只有 NSIS Setup/Portable 是 electron-builder 的独立目标；完整 ZIP 必须且只可在 Builder 完成后从 `win-unpacked` 加上 `.usshm-portable` 标志一次创建。还要求本地打包 PowerShell **不能自动删除**已有同名 ZIP，而必须拒绝覆盖。提交 `9897155`， [Node Contracts RED #37957203988](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37957203988) 记录 **529 tests / 526 pass / 3 expected fail**，明确复现重复 ZIP 目标与危险覆盖行为。
- **修复：** `package.json` 的 `dist:win` 只请求 `--win nsis portable --x64 --publish never`；`build/electron-builder.yml` 移除 Builder 的 `target:zip`；最终完整 ZIP 仍由 `windows-build.yml` 手动构建工作流或本地 `package-windows.ps1` 的 `CreateFromDirectory(win-unpacked,zip)` 生成，保留完整 Electron DLL/resources/locales，而不是把 Portable EXE 简单压缩。若同名 ZIP 已存在，PowerShell 明确失败，保留既有发行包，避免破坏历史文件。
- **GREEN：** [Windows Development CI #37957312393](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37957312393) 对 `cf6f3301f8ce7645ae98c2c53323c09c482858ff` **529/529 tests PASS / 0 FAIL**，严格 TypeScript、Electron build、真实 Windows GUI/SQLite、真实 Chrome CDP smoke 全 SUCCESS；[Node Contracts #37957312230](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37957312230) PASS。
- **发行边界：** 这次只通过**静态配置测试与开发 CI** 确认单一 ZIP 产出合同；遵从用户“无中途预览安装包”，未运行手动 `windows-build.yml`、未生产安装包，也没有完成三种格式各自完整的实际 Windows 10/11 安装、启动、升级、卸载/数据保留、签名与 hash 验收。RG-09 和 Stable 仍为 BLOCKED。保持 Draft，不合并，不发 Release。

## 2026-10-10（马来西亚时间）· V1/CDP 证据非提升、用户脚本原子导出与发行构建门禁（538 项）

- **原分支：** 承接 `feat/v01-continuation` / PR #2；本轮不触发 `windows-build.yml`、不打中途包、不发 Stable tag。
- **V1 假阳性 RED：** 通用 `runReadOnlyDomContract` 与先前修复的 SiteAdapter 一样，仍允许集合 locator 的 `ambiguous` 响应通过 `exists` 契约。然而实际 CDP probe 以 `DOM.querySelectorAll` 采样所有支持的集合定位器，有节点时返回 `found`。新测试同时要求多节点 `found` 仍保留正常 `exists` 功能。测试先提交 `a76feec`，[Node Contract RED #37958174175](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37958174175)：**531 cases / 529 pass / 2 expected fail**。实现 `6ff498d` 严格只接受符合实际传输规则的 `found`，仍不把 V1 等同 V2/V3/V4。
- **只读可见性 RED：** `inspectReadOnlyElementVisibility` 曾对重复 CDP `nodeIds` 误报 `ambiguous`，并可能将超过 10,000 个节点的响应以 `matchCount:null` 继续当作多匹配。追加覆盖重复 ID 与 10,001 节点的测试，先在 [Node Contract RED #37958369586](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37958369586) 得到 **532 cases / 531 pass / 1 expected fail**；`29ad1b9` 改为超额或重复节点证据 `unknown`、不读取任意元素属性、不触发网页操作。
- **用户脚本导出原子性 RED：** 既有 `exportManagedCurrent` 用 `writeFile(destination,{flag:'wx'})` 直接写最终 .user.js，无法防止磁盘满/崩溃留下半个文件。先添加分块写入期间目标不得存在、第二块 ENOSPC 必须清理私有暂存、竞争者在发布前创建同名最终文件不得被覆盖的回归，[Node Contract RED #37958586050](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37958586050) 因缺少新 `publishExclusiveExport` 而失败；`b154b8b` 实现同目标目录 stage → 64 KiB 分块写入 → `fsync` → pinned read-back SHA-256 → `link(stage,destination)` 不替换发布 → 再次读取验证 → finally 清理 staging。不支持安全 hard link 的文件系统明确阻断，而非退回不安全 rename/copy。由于崩溃可能遗留隐藏暂存，绝不能因为隐藏文件就擅自删除用户原稿。
- **导出跨进程一致性 RED：** 仅原子导出仍可能在读活动修订后被另一实例切换 `current.user.js`，输出悄悄过期。追加活跃锁应阻断导出、导出 staging 暂停时实际 `commitManagedCurrent` 竞争必须失败的回归，[Node Contract RED #37958908387](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37958908387)：**537 cases / 535 pass / 2 expected fail**。实现 `3f75919` 在确认归档层级后，以 `current.user.js.write-lock` 与受管 commit 使用相同文件系统排他协议，将从 pinned 读取活动 revision 到最终导出/清理包在持锁区间内，finally 仅释放自己成功取得的锁。不会清除其他进程已有或崩溃残留的 lock。该机制为**合作进程互斥**，不防御恶意进程/非协调外部手动编辑，也不是断电后可自动回滚的全事务。
- **Windows 可重现打包 RED：** `build-windows.cmd` 原来执行 `npm install`（可变动依赖锁）且跳过 `npm run typecheck` 后直接制作三个发行格式；新约束要求 `npm ci` + 运行完整测试 + 严格 TypeScript + build + dist + ZIP + hash 全部 fail-fast。[Node Contract RED #37959178107](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37959178107) **538 cases / 536 pass / 2 expected fail**；修复提交 `5cc4e90`，不运行该构建脚本，符合用户“不生成中途安装包”。
- **最终 GREEN：** [Windows Development CI #37959261383](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37959261383) 对 `5cc4e90e55bdb21075ba8fe2dcb200b3f7e93a63` **538/538 PASS、0 FAIL**，TypeScript、Electron 打包前 build、真实 Windows GUI/SQLite 初始化、真实 Chrome CDP smoke 全 PASS。[Node Contracts #37959261387](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37959261387) SUCCESS。开发 CI **没有**生成正式发行包；未将 CI fixture 的 DOM V1 误称为功能 V3/V4。
- **当前不能发布 Stable：** 真实 Tampermonkey/GM_*、已授权的网站安全 V2/V3 功能契约、Windows 10 x64 用户便携 Chrome155、三正式格式和升级/卸载/迁移回归以及 RG-01~09 都未完成完整验证；继续 Alpha / Draft。软件原始脚本未被覆盖，用户账号真实网站没有被执行自动破坏性动作。

## 2026-10-10 · 本地测试脚本执行白名单、Frame/Loader 身份与报告原子导出（548 项）

- **开发目标：** 继续推进最终 Stable 的 P0 安全隔离与损坏恢复质量，无人参与逐步验收，**不构建中途安装包**。复用 `feat/v01-continuation`、PR #2，保留 Alpha/Draft。
- **隔离行为测试执行入口阻断任意用户 JS**：`scripts/local-fixture-behavior.ts` 原先仅检查 `// ==UserScript==\n// @name Local CDP Smoke\n` 前缀，随后将 `source` 拼入 `Runtime.evaluate`。即使这是 TEST-ONLY 且 CDP 必须绑定 127.0.0.1 `/fixture`，伪装头部仍能把任意 JS 塞入执行器。新增测试尝试在合法头部后注入任意语句、`fetch`、`eval`、更换 selector/匹配域、添加 `@require`，所有情况都必须在打开 CDP WebSocket **之前**拒绝。TDD RED：[Node Contracts #37960338129](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37960338129)（539 tests，538 pass，1 expected fail）；GREEN `1097a36c`：改为**完整源码字节级固定白名单**，仅内置单按钮 fixture 与双 selector（旧/新各二值）共五种经过预定义的合成脚本，动态或额外注入一律拒绝。真实受管文件只作为修复后的白名单变体输入，**绝不可执行用户真实 JS**。
- **同 URL 导航/重载功能证据**：合成行为测试原仅复核 `targetId` 与 URL；同地址重新导航或 document loader 更换后仍可能误报。添加真实 `frameId/loaderId` 前置必备和前后稳定的契约：同 URL loader 被替换、缺少主 frame/loader 时 fail-closed，在建立 CDP 执行连接前检查有效证据。合成测试允许脚本在同一主文档内创建 iframe，因此只固定**主框架 document/loader**，而非禁止子 frame 数量变化。RED：[Node Contracts #37960551828](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37960551828)（541 tests，539 pass，2 expected fail）；实现 `0cfa9ec`，并同步更新既有 mock 为真实双 token，`78cf50f`。
- **JSON/Markdown 全部安全导出**：此前 Electron 主进程的静态/DOM 报告仍调用 `writeFile(...,{flag:'w'})`，可截断已存在的任意报告，写入故障会留下半个最终文件。新增 `packages/reporting/src/exclusive-report.ts`，要求 *.json/*.md、绝对路径、最多 8MiB，使用同目录随机独占 staging、64KiB 分块写、`fsync`、有界打开句柄 SHA-256 回读、原子 hard-link no-replace 发布、再验证最终字节和 finally 清理 staging；不支持硬链接则明确失败，不自动降级覆盖或复制。测试包含目标未发布之前不可见、模拟 ENOSPC 仅 staging 受损、现有/竞争目标不能覆盖、路径和扩展名/字节预算拒绝。主进程 `usshm:export-dom-report`、`usshm:export` 两条导出通道均使用新原子发布，不接受 renderer 提交原生路径；静态报告额外固定 `lastScan` 引用，在系统保存对话框关闭后再次检查旧扫描是否失效。RED：[Node Contracts #37960900623](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37960900623)（544 tests，541 pass，3 expected fail）；实现 `3251aaba` + `7ba15c30`；[Windows Development CI #37961133403](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37961133403) **547/547 pass**，TypeScript、Electron、Windows GUI/SQLite、Chrome CDP smoke 成功。
- **Electron 主 IPC 页面身份强化**：`assertSender` 已限制 sender 是主 webContents 和 mainFrame，但原代码 URL 检查 `startsWith('file://')` 或 `startsWith('http://localhost:5173/')`，过于宽松。TDD RED：[Node Contracts #37961419217](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37961419217)，新增用例要求页面严格匹配 `pathToFileURL(join(__dirname,'index.html')).href` 且同时核对 `event.sender.getURL()` 和 `event.senderFrame.url`，不容许其他本地文件或任意 dev server。修复 `dc3a79a` 将白名单缩为唯一加载的 Electron 前端文档，其他主框架同协议页面仍不可调用受信 IPC；跨 frame 禁令保留。
- **本轮最终自动化结果：** [Windows CI #37961511923](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37961511923) 在 `dc3a79a17c212a2ecbd73a26bbc1a0e4c8925929` **548/548 tests PASS、0 FAIL**，严格 TS、Electron build、真实 Windows GUI/SQLite 启动及真实 Chrome CDP smoke 全通过。[Node Contracts #37961511905](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37961511905) SUCCESS。仅是 Windows hosted runner 的开发 CI，**非**用户指定的 Windows10/Chrome155 portable 实机、真实 Tampermonkey/GM_* V4 或三种正式发行版独立 QA；不得标 Stable。没有生成中途预览包、合并 main、打标签或发布 GitHub Release。

## 2026-10-10 · 外部改写抢占防护、异常暂存诊断与真实 Chrome 155 CI（558 项）

- **受管 current 最后写入窗口：** 发现旧版先校验 current 哈希，再执行内部 pre-publish 竞态钩子。外部编辑或符号链接更换会在最后的 rename 中被悄悄覆盖。新增 2 条事务竞态测试，先在 [Node RED #37962459418](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37962459418) 得到 550 项、548 pass / 2 fail，再修改为钩子后复查 expected current， [Windows GREEN #37962560319](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37962560319) 550/550 PASS。合作 writer 的排他 lock 保持生效；不声称恶意外部进程写入的 OS 级 compare-and-swap 保证。
- **崩溃残留文件只读诊断：** 可检测 .current.user.js.staging-UUID.tmp 及 .revision-HASH.user.js.staging-UUID.tmp 等未发布文件，报告 staging-leftover 而非错误地只报 healthy/empty，中文 GUI 提供离线核查指导，绝不自动删锁或暂存。 [Node RED #37962737972](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37962737972) 553/551 pass/2 fail；诊断还优先报告 writer lock、损坏归档和未归档的外部当前文件，新增 [RED #37963261587](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37963261587) 555/554 pass/1 fail，最终修复优先级。编写正则时发生一次 JavaScript replace 特殊序列引起的语法错误，CI 记录了失败并在同轮修正。
- **受管 V1 验证防误报：** readVerifiedManagedLocator 在当前修订的 write-lock 存在时拒绝认证，读取前后检查，不删除别的进程的锁。测试先在 [Node RED #37963524101](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37963524101) 556/555 pass/1 fail，再修复。[Windows GREEN #37963648052](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37963648052) 556/556 PASS。这是只读时点保护，无法提供恶意跨进程文件变化的全局事务保证。
- **Chrome 155 专项兼容测试：** 新增单独的 Windows Development CI chrome155 作业。从 Google 官方 Chrome for Testing 获取完整 Win64 155.0.8059.39 浏览器，隔离安装，用 CDP Browser.getVersion 实际认证浏览器主版本为 155，并运行现有真实 Chrome 合成 fixture：51 脚本分批、候选生成、合成 V2 交互、两阶段修复、V1、合成功能测试、回滚、导出。未运行 electron-builder，无本程序预览安装包，也未接入用户网站或脚本。先由 [Node RED #37963882601](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37963882601) 558/556 pass/2 fail 证明缺少版本专测。
- **Chrome 155 沙箱 RED→GREEN：** 第一次 [Windows RED #37964039109](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37964039109) 成功下载 Chrome 155 和开放 CDP，却因 Windows 沙箱不能访问 Runner 临时目录中的可执行文件而无法读取 fixture；这次失败没有被虚报为兼容通过。改为从标准 Program Files 目录运行，继承 Windows RX 权限，不使用关闭 Chrome 沙箱的危险参数。最终 [Windows CI #37964735296](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37964735296) 专项 chrome155 作业 PASS，日志明确记录 real Chrome CDP fixture、51-script batches、synthetic behavior fail/repair-pass/rollback-fail/export 全通过；同时默认 verify 作业成功。[Windows CI #37964743711](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37964743711) SUCCESS，[Node Contracts #37964743721](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37964743721) 558/558 PASS、0 FAIL。
- **Stable 尚未满足：** 官方 Chrome for Testing 155.0.8059.39 与用户指定的便携 Chrome 155.0.8059.40 x64 包不是同一发行物；GitHub hosted Windows Runner 也不是用户的 Windows 10。CI 禁止第三方扩展，因此不代表真实 Tampermonkey、GM_* V4；用户真实安全 V2/业务 V3、三种正式 Windows 发行安装/升级/数据恢复及 RG-01 至 RG-09 仍未验收。保留 Alpha、PR #2 Draft，不合并、不发布 Stable，也未做中途安装包。

## 2026-10-10 · FR-002 多个持久化隔离浏览器配置（566 项）

- **开发范围：** 在既有单 Chrome OS 文件选择器、只读 CDP 诊断基础上完成 P0 FR-002：多个独立 BrowserProfile 可持久化、中文命名/改名、选默认、删除配置前原生确认、指定配置独立启动；不读取、复制、覆盖或删除原有 Chrome Profile。
- **严格的配置模型：** 新增 packages/cdp-client/src/browser-profiles.ts，保存在应用 Data/browser-profiles.json；每份记录具有不可伪造路径结构的 UUID、唯一 UTF-8 名称、由原生文件选择器确定的绝对 Chrome EXE 路径。最多 16 份；启动时重新 lstat 可执行文件，拒绝不存在、符号链接和非 .exe。实际 profile 目录由 Main 计算为 Data/Chrome-Profiles/<profile-id>，绝不接受 renderer 提交任何 executablePath、profileDir 或 dataRoot。
- **稳定及隐私：** 配置通过同卷临时文件写入、原子 rename 持久化，读取采用最多 32KiB 的 pinned file descriptor；配置畸形、过长、symlink 时阻止覆盖和自动启动，列表降级空值但保存原件供人工恢复。删除只删注册记录，不删 Chrome 可执行文件、扩展、浏览器书签或任何 profile 资料，且主进程另显示原生确认对话框。首个配置自动默认；删除默认后其余第一个设为新默认。UI 可选择、设默认、重命名和显式启动该配置，绝不自动登录网站。
- **跨实例写入排他：** 新增浏览器配置 write-lock 独占目录，包住完整 read-modify-write；已有锁立即拒绝，绝不猜测锁超时/抢占、删除另一个 writer 的锁。不把源码或配置表中的裸路径当作用户对脚本执行授权。
- **TDD RED：** [Node Contracts #37965940891](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37965940891) 先因缺少 browser-profiles.ts 失败（559 cases, 558 pass）；实现保存/验证后核心通过。新增 Electron main/preload/renderer 贯通测试，确认无法从 renderer 提交可执行路径。最后针对潜在多实例丢失记录追加锁测试，[Node Contracts #37966568136](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37966568136) 566 cases / 565 pass / 1 expected fail；修复为全修改租约而不是仅暂存发布时抢锁。
- **最终 GREEN：** [Windows Development CI #37966712584](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37966712584) 在 db588c37 上 SUCCESS，包含普通 Windows Electron GUI/SQLite smoke 与独立官方 Windows Chrome 155.0.8059.39 CDP 作业；[Node Contracts #37966712709](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37966712709) 全部测试和严格 TypeScript SUCCESS，预期 566/566 PASS。开发 CI 不执行安装包打包。
- **边界和未完成工作：** 仅完成可命名的独立浏览器配置与安全启动，尚未完成真实 Tampermonkey/GM_* V4、用户实际 Win10+便携 Chrome155.0.8059.40、生产 V2/V3、三正式发行包与全部 RG-01..09。FR-002 的自动化证明不是 Stable 全部需求完成。版本仍为 0.1.0-alpha.5，PR #2 Draft，未经发行验收不合并 main、不打 Stable tag、不发布正式包。

## 2026-10-10 · FR-002 独立真实 Chrome 双配置启动闭环（567 项）

- **补充端到端证据：** 原有 BrowserProfile 自动测试主要验证本地配置与 Electron IPC；新加真实 Windows Chrome E2E，拒绝把仅通过配置保存称作启动成功。针对同一真实 Chrome 可执行文件，将两个独立命名配置存至 Main-owned Data/browser-profiles.json，切换默认项后，从 UUID 分别推导 Data/Chrome-Profiles/<UUID>，按顺序独立启动真实 Chrome，每个进程使用不同端口 9231/9232、独立 user-data-dir 和隔离临时 profile，并分别完成 CDP Browser.getVersion 握手。进程结束只 taskkill 本轮创建的子进程树，不影响用户常用浏览器。
- **TDD RED：** 新增 tests/integration/browser-profiles-chrome-smoke.test.ts，要求真实 Chrome 脚本包含多配置持久化、解析、默认切换和两条独立 CDP handshake；[Node Contracts RED #37967206479](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37967206479) 失败，随后脚本实际实现双实例验证。此项不执行真实用户 JavaScript，不加载扩展，页面仅 about:blank，仍未满足 Tampermonkey/GM_* V4。
- **GREEN：** [Windows Development CI #37967373637](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37967373637) 的 Chrome 155 专项作业在真实 Windows Runner 上 SUCCESS，日志原文含 `PASS real Chrome FR-002: two persisted, independent UUID profile directories and live CDP handshakes.` 及已有 51-script 批量、两阶段补丁、合成功能、回滚与导出的 `PASS real Chrome CDP`；[Node Contracts #37967379479](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37967379479) 567/567 tests PASS，0 failure。Chrome 155 专测仍为 Google Chrome for Testing 155.0.8059.39，不是用户提供的 155.0.8059.40 便携包装。
- **Stable 仍阻断：** 真实 Tampermonkey/GM 功能、生产环境 V2/V3、指定 Windows 10 与用户便携 Chrome 155.0.8059.40、三正式发行包、完整 RG-01..09 需要继续自动化实证；代码验证与 Chrome 后台 E2E 不代表发行完成。保留 0.1.0-alpha.5、PR Draft，不构建中途安装包。

## 2026-10-10 · BrowserProfile 注册资料异常识别与 GUI 防误报（570 项）

- **P0 误导性健康显示：** FR-002 多配置首版在读取损坏或被链接的 Data/browser-profiles.json 时为安全起见列表返回 []，但桌面 UI 无法区分真实空配置与文件损坏/崩溃后写锁占用，可能误导用户认为原资料丢失。新增只读 inspectBrowserProfileRegistry，区分 empty、ready、write-locked、invalid，且输出仅状态与合法记录数量，不暴露原始配置内容。主进程持有 dataRoot，通过特定 IPC/Preload 提供健康结果，UI 明确中文风险提示及保留原始文件的处置边界，绝不自动删除可能仍被另一个进程持有的锁。
- **TDD RED:** [Node Contracts #37967838632](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37967838632) 缺少 inspectBrowserProfileRegistry；[UI Contract RED #37968031129](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37968031129) 缺少中文风险提示；分别提交后依序实现。
- **GREEN：** [Node Contracts #37968124468](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37968124468) 570/570 PASS、0 FAIL，严格 TypeScript 通过。完整 Windows Electron + Windows Chrome CDP + 官方 Chrome 155 双配置启动保持于无预览安装包的开发 CI 中执行。
- **发行性质不变：** 这不是自动恢复损坏注册文件的功能，也不代替真实 GM API V4、生产 V2/V3、用户 Win10/portable Chrome155.0.8059.40、三份正式包和 RG-01..09。软件版本仍 Alpha，PR #2 Draft；保持未构建中途安装包和不进行人工验收。

## 2026-10-10 · Chrome 启动失败进程树回收与真实 CDP 失效验收（576 项）

- **发现的 P0 启动泄漏：** 原 `launchSelectedChrome` 在启动子进程后等待远程调试 CDP 握手；握手失败或超时就直接抛错，Windows 新 Chrome 进程树可能继续驻留，锁定隔离用户资料目录，令 UI 显示失败但浏览器仍在运行。对用户实际 Chrome 进程不得执行任何全局清理。
- **TDD RED：** 新增 `packages/cdp-client/test/failed-launch-cleanup.test.ts` 五个注入场景：已 spawn 但 CDP 不出现应只回收该 child；握手成功不能误杀；运行中进程错误后要清理；清理失败必须同时报告握手错误与清理错误；spawn 之前失败不清理其他 Chrome。先在 [Node RED #37968934975](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37968934975) 获得 **571 cases / 570 pass / 1 expected fail**，因缺少安全封装模块而失败。
- **修复实现：** `packages/cdp-client/src/index.ts` 引入 `startVerifiedChromeChild` 启动/握手/回滚生命周期，并将 Electron 实际 `launchSelectedChrome` 接入该统一流程；保留永久 child error listener 防止延迟 Error 造成主程序崩溃。成功握手且子进程仍存活才返回 ready；验证失败只清理自己这次 spawn 的 child，不去寻找/终止其他 Chrome。Windows 使用 `taskkill /PID <新子进程> /T /F` 并设 12 秒上限清理该子进程树；非 Windows 使用 SIGTERM。若清理仍失败，返回 AggregateError 记录**启动失败+清理失败**，禁止伪报成功；无法保证宿主进程被其他进程接管的恶意 PID 重用场景。
- **真实 Windows Chrome 故障注入 RED→GREEN：** 新增 `tests/integration/chrome-smoke-wiring.test.ts` 对真正可执行的失败清理案例提出明确要求，先在 [Node RED #37969242156](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37969242156) 获得 **576 cases / 575 pass / 1 expected fail**。随后在 `scripts/smoke-chrome.mjs` 新开真实 Chrome 进程，绑定专用测试 CDP 端口 9237，在完成 Browser.getVersion 握手之后强制模拟 CDP 就绪失败。用与产品相同的 `terminateFailedChromeLaunch` 清理，重验端口可绑定，并确认原先测试 Chrome 9223 依然在线，绝不杀无关进程。
- **最终 GREEN：** [Windows Development CI #37969395723](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37969395723) 在 `856b9d1f97ca6fd1f95ab3b7dda1934cc5f72f8e` **SUCCESS**（Windows Electron GUI/SQLite、真实 Chrome CDP、Chrome for Testing 155.0.8059.39 专测），专项日志逐字输出 `PASS real Chrome CDP failed-start cleanup: new process tree and port released; existing fixture Chrome remains connected.`；其他 `PASS real Chrome FR-002`、51-script 批量与合成修复/回滚/导出保持通过。[Node Contracts #37969395629](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/37969395629) **576/576 PASS、0 FAIL** 且严格 TS 成功。
- **Stable 仍阻断：** 进程失败回收只在当前 GitHub hosted Windows + Chrome for Testing 155.0.8059.39 上自动化验证，不等于用户 Windows 10 + 私有 portable Chrome 155.0.8059.40，也不包含真实 Tampermonkey/GM_*、生产 V2/V3 业务、完整三发行包/迁移/升级与 RG-01 至 RG-09。继续保持 Alpha/Draft，未生成预览安装包、未合并主分支、未打 Stable tag。
