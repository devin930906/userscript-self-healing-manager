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
