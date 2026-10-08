# Phase 1 — 可运行桌面基座与离线脚本诊断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从只有文档的仓库实现一个可在 Windows 运行的 V0.1 本地桌面应用：导入/拖放/扫描 `.user.js` 文件、解析元数据与静态 DOM Selector、显示诊断与未知项、保存本地目录和导出报告；打包三个 Windows 预览发行形式。

**Architecture:** Electron Main 负责文件、SQLite、路径与生命周期；preload 只向 sandboxed renderer 暴露按 schema 校验的最小 IPC；React Renderer 实现脚本库/批量导入和 AST 结果。可独立测试的 registry、analyzer、persistence 模块通过 typed contracts 连接；本计划不启动 CDP、运行用户脚本或生成自动补丁。

**Tech Stack:** Node.js 24 LTS (开发工具链)、Electron 44.x（锁定适用 patch）、TypeScript、React、Vite/electron-vite、npm workspaces、Vitest、@babel/parser、@babel/traverse、SQLite（better-sqlite3 或经 Windows 打包实测兼容的受支持驱动）、electron-builder v26 stable targets nsis/portable/zip。

**Spec:**
- `docs/superpowers/specs/2026-10-08-userscript-self-healing-manager-design.md`
- `docs/requirements/product-requirements.md`
- `docs/architecture/data-contracts.md`
- `docs/architecture/healing-engine.md`
- `docs/security/ai-and-threat-model.md`
- `docs/design/ux-and-workflows.md`
- `docs/distribution/windows-three-editions.md`
- `docs/roadmap/master-roadmap.md`

**状态：待用户评审的实施计划。此文件为可执行步骤，不表示代码/测试已执行。**

## Global Constraints

1. 正式目标系统是 Windows 10/11 x64；开发者 Node.js 24 LTS；Electron 44.x；首次安装实际依赖版本使用精确锁文件 `package-lock.json`，不使用浮动运行时版本。编译依赖必须通过安全审计和 Win10 兼容验证。
2. 同一源码版本的最终 Stable 必须发布三个 Windows 产物：NSIS Setup.exe、单文件 Portable.exe、完整应用 ZIP 解压版（不是把 Portable.exe 压缩成 zip）。V0.1 内测可标 Preview，但本阶段要验证这三种构建目标。
3. Setup 的数据在 OS-backed 用户资料目录；两个便携版的 SQLite/日志/设置/备份在程序旁 `Data/`；便携单文件不得以临时解包目录为数据路径。跨 Windows 用户加密 API Key 不可自动迁移。
4. 不以 Electron 内建 Chromium 代替用户选择的外部 Chrome；本阶段不编写 CDP、Tampermonkey 自动注入、自动修复、AI API 调用等 Phase 3+ 功能。后续 CDP 默认调试参数固定为 `--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1`，默认不添加 `--user-data-dir`。
5. 解析用户文件仅静态解析，绝不 `eval`/`new Function`/`require` 用户源码；不从 `@require` 下载或执行外部依赖；不上传真实文件与 DOM 到任何外部服务。
6. UI Electron `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`；允许的操作仅通过固定 channel / typed preload bridge；主进程对每个请求校验 schema、路径、容量与操作来源。
7. 导入的源文件默认只读，不覆盖、不删除、不重命名源文件；解析失败与动态选择器要报告明确状态，绝不显示“功能修复已验证”。
8. 保留 UTF-8 BOM/CRLF 的原 bytes/hash，原生文件路径含中文、空格、重复名称均可用；递归目录默认不跟随 symlink，防止越界与循环。
9. 任何数据写入、数据库 migrations 或打包资源变更必须能回退；生产环境数据库初始化前检查 dataRoot 权限，不可写时返回可理解错误，不静默改路径。
10. 本阶段主要验证范围：FR-007~013、FR-039~041 中与静态分析有关部分，以及 FR-045~048 所要求的**发行结构先导测试**；自动修复与动态 V1~V4 的功能不在 V0.1 范围。

## Review Focus

以下五类易漏输入由对应 Task 的指定测试覆盖：
1. **Windows Unicode、长路径、同名脚本**：Task 6 的 `importPaths_doesNotCollapseDistinctUnicodePaths`；用户应得到完整逐文件结果。
2. **源文件 BOM、CRLF、动态模板选择器**：Task 5 的 `analyzeSource_reportsDynamicTemplateWithoutEvaluating` 与 `analyzeSource_preservesByteHash`。
3. **符号链接、受保护路径、目录扫描循环**：Task 6 的 `enumerateScripts_doesNotFollowSymlinks`；不读写授权范围外文件。
4. **安装/便携数据路径混淆**：Task 3 的 `resolveDataRoot_usesExternalPortableDirectory` 与 Task 11 的 Windows smoke。
5. **IPC 越权/非可信网页内容进入 UI**：Task 2 的 `registerHandlers_rejectsInvalidSenderAndArgs` 与 Task 9 的渲染测试。

---

## File Map（先锁定责任边界）

```text
package.json / package-lock.json             # 单一 npm workspaces，dev/test/build 命令
tsconfig.base.json                           # TS 严格模式和模块约束
vitest.config.ts                             # 可重复的 node/jsdom 单元测试
apps/desktop/src/main/index.ts               # Electron 生命周期，不含业务规则
apps/desktop/src/main/window.ts              # CSP、安全 BrowserWindow 与 preload
apps/desktop/src/main/ipc.ts                 # 仅注册 allowlisted ipc handlers
apps/desktop/src/main/bootstrap.ts           # dataRoot、DB、模块初始化
apps/desktop/src/preload/index.ts            # 有限 typed renderer API
apps/desktop/src/renderer/App.tsx            # 桌面页面入口
apps/desktop/src/renderer/features/library/  # 导入、目录扫描、静态结果 UI
apps/desktop/src/renderer/features/status/   # 通知/错误与成功状态
packages/contracts/src/index.ts             # 共享类型、schema、状态 enum
packages/runtime-paths/src/index.ts         # installed/portable-exe/portable-zip 根路径策略
packages/persistence/src/index.ts           # SQLite migration/repository
packages/script-registry/src/index.ts       # 导入、过滤、路径、metadata
packages/source-analyzer/src/index.ts       # JS AST/selector inventory
packages/scan-service/src/index.ts          # 批量静态扫描 use-case
packages/reporting/src/index.ts             # JSON/Markdown 静态报告
fixtures/userscripts/                       # 虚构 userscript fixture
tests/integration/                          # 真实临时目录/SQLite 整合
tests/security/                             # 负例与路径/IPC 测试
build/electron-builder.yml                  # 三形式 Windows 包配置
scripts/verify-dist.mjs                     # 三包内容/版本/hash 结构验证
.github/workflows/ci.yml                    # lint/typecheck/tests
.github/workflows/windows-build.yml         # Win runner 打包及 smoke
```

**Interfaces 规则**：任何 renderer 组件不得引用 `node:fs`、`better-sqlite3`、`electron` 主进程对象。统一 `ScanRequest/ScanResult` 和 `ImportResult` JSON schemas；browser/CDP、AI adapter 后续在 `packages` 下添加，不挤进 UI 文件。

## Task 1: 初始化 npm Workspace / TypeScript / 测试基线

**Files:**
- Create: `package.json`, `package-lock.json`, `.npmrc`, `.gitignore`, `.editorconfig`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/contracts/package.json`, `packages/contracts/src/index.ts`, `packages/contracts/test/contracts.test.ts`
- Create: `apps/desktop/package.json`

**Interfaces:**
- Produces: `ScriptId=string`, `ScriptHealth='unverified'|'parsed'|'parse-error'|'runtime-required'`; `Result<T,E> = {ok:true,value:T}|{ok:false,error:E}`.

- [ ] **Step 1: 写失败测试** — `packages/contracts/test/contracts.test.ts` 测试 `ScriptHealth` 与 `Result` 的运行时 schema 边界，拒绝未知 status。
- [ ] **Step 2: 执行 RED** — `npm test -- --run packages/contracts/test/contracts.test.ts`；预期失败：缺少 workspace/schema/test command。
- [ ] **Step 3: 最小实现** — 初始化 npm workspaces（`apps/*`, `packages/*`）、React/Electron 构建工具、TypeScript `strict:true`、Vitest、`contracts` 的 runtime schema，依赖版本锁入 package-lock，不使用 npm install 的动态 latest 语义于未来 CI。
- [ ] **Step 4: 执行 GREEN** — `npm ci && npm test -- --run packages/contracts/test/contracts.test.ts && npm run typecheck`；预期退出码 0，测试断言通过。
- [ ] **Step 5: 提交** — `git add package.json package-lock.json .npmrc .gitignore .editorconfig tsconfig.base.json vitest.config.ts packages/contracts apps/desktop/package.json && git commit -m "chore: bootstrap typed desktop workspace"`。

## Task 2: 安全 Electron 桌面窗口与最小 IPC

**Files:**
- Create: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/window.ts`, `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/main.tsx`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/index.html`
- Test: `apps/desktop/tests/window.test.ts`, `apps/desktop/tests/ipc.test.ts`

**Interfaces:**
- Consumes: `Result<T,E>` (Task 1).
- Produces: `createSecureWindow(): BrowserWindow`; `registerIpcHandlers(deps: IpcDeps): void`; `window.ussm.getAppInfo(): Promise<AppInfo>`. `IpcDeps` only typed safe application services.

- [ ] **Step 1: 写失败测试** — `createSecureWindow` 必须配置 `nodeIntegration:false, contextIsolation:true, sandbox:true`、限制页面导航和 window.open；`registerIpcHandlers_rejectsInvalidSenderAndArgs` 对非预期 sender/无效 payload 拒绝处理。
- [ ] **Step 2: 执行 RED** — `npx vitest run apps/desktop/tests/window.test.ts apps/desktop/tests/ipc.test.ts`；预期未定义窗口工厂与 IPC 模块。
- [ ] **Step 3: 最小实现** — 不加载外部网站作为 renderer；renderer 仅调用 preload 的固定 `getAppInfo`；CSP 限制默认本地资源；外部导航不得以 node 权限打开。
- [ ] **Step 4: 执行 GREEN** — `npx vitest run apps/desktop/tests && npm run typecheck`；预期测试及类型检查通过，开发启动可显示应用名/版本。
- [ ] **Step 5: 提交** — `git add apps/desktop && git commit -m "feat(desktop): add secure Electron shell and IPC"`。

## Task 3: 三种发行形态的数据根目录与安全初始化

**Files:**
- Create: `packages/runtime-paths/package.json`, `packages/runtime-paths/src/index.ts`, `packages/runtime-paths/test/runtime-paths.test.ts`
- Modify: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/bootstrap.ts`
- Test: `tests/security/portable-data-root.test.ts`

**Interfaces:**
- Consumes: `Result` (Task 1).
- Produces: `resolveDataRoot(input: {distributionMode:'installed'|'portable-exe'|'portable-zip'; exeDirectory:string; osUserDataDirectory:string; portableExternalDirectory?:string}): string`; `ensureWritableDataRoot(dataRoot:string): Promise<void>`.
- `bootstrapApplication(paths: BootstrapPaths): Promise<BootstrapResult>` sets `app.setPath('userData',...)` before any session/db creation and prepares logs/cache storage.

- [ ] **Step 1: 写失败测试** — `resolveDataRoot_usesExternalPortableDirectory`：installed 使用用户资料目录；portable-exe 用外部 `PORTABLE_EXECUTABLE_DIR`，portable-zip 用真实解压 EXE 文件目录，后接 `Data`；没有有效外部目录不得落入临时解包目录。安全负例包括只读、符号链接逃逸与包含空格的 Windows 路径。
- [ ] **Step 2: 执行 RED** — `npx vitest run packages/runtime-paths/test tests/security/portable-data-root.test.ts`；预期未实现。
- [ ] **Step 3: 最小实现** — 开发时通过固定 distributionMode 注入 runtime adapter；只在 Electron Main 决定 dataRoot，初始化前验证可写/创建最少目录，失败给用户明确错误且不回退 AppData；Windows DPAPI/OS 密钥迁移不在本任务存储任何 key。
- [ ] **Step 4: 执行 GREEN** — 上述测试+typecheck 通过，并确认失败不会在错误目录创建数据文件。
- [ ] **Step 5: 提交** — `git add packages/runtime-paths apps/desktop/src/main tests/security/portable-data-root.test.ts && git commit -m "feat(paths): isolate installed and portable data roots"`。

## Task 4: SQLite schema / migration / script registry 持久化

**Files:**
- Create: `packages/persistence/package.json`, `packages/persistence/src/index.ts`, `packages/persistence/src/migrations/001-initial.sql`, `packages/persistence/src/sqlite-repository.ts`
- Test: `packages/persistence/test/persistence.test.ts`
- Modify: `apps/desktop/src/main/bootstrap.ts`

**Interfaces:**
- Consumes: `resolveDataRoot` (Task 3), `Result` (Task 1).
- Produces: `openDatabase(path: string): DatabaseHandle`; `migrateDatabase(db: DatabaseHandle): void`; `ScriptRepository.upsert(script: ScriptRecord): Promise<void>`; `ScriptRepository.list(): Promise<ScriptRecord[]>`.
- `ScriptRecord` 必须含 `id,path,displayName,sha256,healthStatus,metadataJson,createdAt,updatedAt`；按 id 区分同名脚本。

- [ ] **Step 1: 写失败测试** — `migrateDatabase_initializesSchemaOnce`；重复 migration 不重复/清空；`ScriptRepository` 重开数据库数据仍存在、同名不同路径不合并；数据库旧 schema/锁定目录明确报错。
- [ ] **Step 2: 执行 RED** — `npx vitest run packages/persistence/test/persistence.test.ts`；预期缺失表/接口。
- [ ] **Step 3: 最小实现** — SQLite migrations 使用事务、应用数据与运行状态分离、磁盘文件存 DB 以外的内容寻址存储由后续阶段负责；采用 Windows Electron 原生模块已验证重建流程（如 better-sqlite3），避免仅在 CLI 可加载而打包后不可用。
- [ ] **Step 4: 执行 GREEN** — 完整持久化测试、typecheck 和 Windows 本机/native module smoke 成功。
- [ ] **Step 5: 提交** — `git add packages/persistence apps/desktop/src/main/bootstrap.ts && git commit -m "feat(storage): add versioned SQLite script registry"`。

## Task 5: UserScript metadata 与 AST Selector Inventory

**Files:**
- Create: `packages/source-analyzer/package.json`, `packages/source-analyzer/src/index.ts`, `packages/source-analyzer/src/metadata.ts`, `packages/source-analyzer/src/selector-inventory.ts`
- Create: `packages/source-analyzer/test/metadata.test.ts`, `packages/source-analyzer/test/selectors.test.ts`
- Create: `fixtures/userscripts/static.user.js`, `fixtures/userscripts/dynamic.user.js`, `fixtures/userscripts/invalid.user.js`

**Interfaces:**
- Produces: `parseUserscriptMetadata(source:string): MetadataParseResult`; `analyzeSource(input: {scriptId:string; sourceBytes:Uint8Array}): SourceAnalysis`.
- `SourceAnalysis` 至少含 `sourceSha256,metadata,selectorRecords,parseDiagnostics,encoding,lineEnding`；selector 包含 `expression,sourceRange,functionName,scope,alternateSelectors,dynamicKind:'literal'|'template-dynamic'|'concat-dynamic'|'wrapper-unknown',runtimeRequired`。

- [ ] **Step 1: 写失败测试** — 元数据 `@name/@match/@grant/@run-at` 多行与缺失、静态 `querySelector`/ `getElementById`、`closest`、fallback `||`；`analyzeSource_reportsDynamicTemplateWithoutEvaluating` 要 `runtimeRequired=true`，不得执行模板内表达式；`analyzeSource_preservesByteHash` 对 UTF-8 BOM/CRLF 保持一致 SHA-256 原字节。
- [ ] **Step 2: 执行 RED** — `npx vitest run packages/source-analyzer/test`；预期 metadata/AST API 尚未实现。
- [ ] **Step 3: 最小实现** — 使用 `@babel/parser` + `@babel/traverse` 静态 parse AST，保留 SourceRange 与作用域，不执行用户源代码。动态拼接无法静态确认则 `runtimeRequired`；Parser 错误返回 diagnostics 而非崩溃。
- [ ] **Step 4: 执行 GREEN** — 运行完整 analyzer 测试；使用 fixture 手动核对提取源行、记录总数、动态未知数量。
- [ ] **Step 5: 提交** — `git add packages/source-analyzer fixtures/userscripts && git commit -m "feat(ast): extract userscript DOM selectors safely"`。

## Task 6: 文件/目录导入、拖放路径检查与批量枚举

**Files:**
- Create: `packages/script-registry/package.json`, `packages/script-registry/src/index.ts`, `packages/script-registry/src/enumerate-scripts.ts`, `packages/script-registry/src/import-scripts.ts`
- Test: `packages/script-registry/test/import.test.ts`, `tests/security/scan-paths.test.ts`

**Interfaces:**
- Consumes: `analyzeSource`, `ScriptRepository`.
- Produces: `enumerateScripts(input: {paths:string[]; recursive:boolean; followSymlinks:false}): Promise<EnumeratedScript[]>`; `importPaths(input:{paths:string[]; recursive:boolean}): Promise<ImportResult[]>`。
- `ImportResult` 包含 `path,status:'imported'|'duplicate-path'|'invalid-extension'|'unreadable'|'parse-error',scriptId?,message?`。

- [ ] **Step 1: 写失败测试** — `importPaths_doesNotCollapseDistinctUnicodePaths` 对不同目录同名脚本生成不同 scriptIds，重复 exact path 报 duplicate-path；`enumerateScripts_doesNotFollowSymlinks` 不越界/循环；超过上限、不可读、错误后缀及无效编码逐文件独立报错。
- [ ] **Step 2: 执行 RED** — `npx vitest run packages/script-registry/test tests/security/scan-paths.test.ts`；预期失败。
- [ ] **Step 3: 最小实现** — 跨平台 `path/fs.promises` 枚举，默认递归开关由 UI 控制，symlink 不追随，路径归一化须保留 Windows 盘符和大小写语义；导入后绝不改动原 `.user.js` 文件。
- [ ] **Step 4: 执行 GREEN** — 测试和 typecheck 通过；输出脚本数+每文件详细结果、不悄悄丢失文件。
- [ ] **Step 5: 提交** — `git add packages/script-registry tests/security/scan-paths.test.ts && git commit -m "feat(import): support bulk userscript files and folders"`。

## Task 7: 批量静态 Scan Service 与作业状态

**Files:**
- Create: `packages/scan-service/package.json`, `packages/scan-service/src/index.ts`, `packages/scan-service/src/scan-batch.ts`
- Test: `packages/scan-service/test/scan-batch.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `importPaths`, `analyzeSource`, `ScriptRepository`.
- Produces: `runStaticScan(request: {paths:string[]; recursive:boolean; maxFiles:number}, deps: ScanDeps): Promise<ScanBatchResult>`；每个 `ScanItemResult` 包含 `status:'parsed'|'parse-error'|'unreadable'|'skipped'`, `selectorCount`, `runtimeRequiredCount`, `diagnostics`；`ScanBatchResult` 有 `requestedCount,enumeratedCount,processedCount,passedCount,errorCount`。
- `maxFiles` 初值 1000，超过需输出明确 `limit-exceeded` 而非静默截断。

- [ ] **Step 1: 写失败测试** — 3 文件（有效/动态/语法错误）的批次必须逐项独立结果；失败项不阻止其他项；总数与 item 状态严格一致，重复路径不重复执行；`maxFiles` 越界标阻断。
- [ ] **Step 2: 执行 RED** — `npx vitest run packages/scan-service/test`；预期未定义 runStaticScan。
- [ ] **Step 3: 最小实现** — 先以有界并发/串行实现可确定性顺序和真实 per-file 错误分类，不引入 AI/CDP 逻辑；始终保留排序与统计不变量。
- [ ] **Step 4: 执行 GREEN** — 运行测试与类型检查；扫描成功 ≠ 脚本运行成功，状态字段不可显示 V1~V4。
- [ ] **Step 5: 提交** — `git add packages/scan-service packages/contracts/src/index.ts && git commit -m "feat(scan): orchestrate deterministic offline analysis jobs"`。

## Task 8: IPC 导入/扫描 API 与操作系统文件选择

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/bootstrap.ts`
- Test: `apps/desktop/tests/scan-ipc.test.ts`, `tests/security/ipc-access.test.ts`

**Interfaces:**
- Consumes: `runStaticScan`, `ScriptRepository.list`, `AppInfo`.
- Produces: `window.ussm.pickFiles():Promise<string[]>`、`pickDirectory():Promise<string|null>`、`scan(request:ScanRequest):Promise<ScanBatchResult>`、`listScripts():Promise<ScriptRecord[]>`、`getAppInfo():Promise<AppInfo>`。
- `ScanRequest` 必须 runtime schema 校验，且文件路径必须位于经 user file-picker 授权/本程序显式管理的根下，renderer 不能提交任意 `C:\\...` 读取。

- [ ] **Step 1: 写失败测试** — 无效 sender/越权路径/超大 paths 数组/非 .user.js/恶意 HTML 内容不得被 IPC handler 执行；选择框取消返回空结果不报成功；合法授权文件可扫描。
- [ ] **Step 2: 执行 RED** — `npx vitest run apps/desktop/tests/scan-ipc.test.ts tests/security/ipc-access.test.ts`；预期缺少固定 handler。
- [ ] **Step 3: 最小实现** — 只注册四个白名单方法，路径授权由 Main 进程持有，preload 不暴露 `ipcRenderer` 原对象、`fs` 或 `eval`；不得接受来自 DOM 文本的直接命令。
- [ ] **Step 4: 执行 GREEN** — 测试通过，手工从 file dialog 选择一份虚构脚本，检验无越权。
- [ ] **Step 5: 提交** — `git add apps/desktop/src/main apps/desktop/src/preload apps/desktop/tests tests/security/ipc-access.test.ts && git commit -m "feat(ipc): expose safe import and scan commands"`。

## Task 9: React 脚本库、拖放与结果说明

**Files:**
- Create: `apps/desktop/src/renderer/features/library/LibraryPage.tsx`, `ScriptTable.tsx`, `ImportPanel.tsx`, `ScanDetails.tsx`
- Create: `apps/desktop/src/renderer/features/status/StatusBanner.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/tests/library-ui.test.tsx`

**Interfaces:**
- Consumes: `window.ussm.pickFiles/pickDirectory/scan/listScripts`.
- Produces: 具备“添加文件”“选择文件夹”“拖入文件”“开始静态扫描”“展开静态解析详情”的界面；同时显示 `sourceName,sitePatterns,selectorCount,runtimeRequiredCount,parseStatus`。
- 文件拖放：必须经过安全的 OS-backed file path 解析/授权机制；现代 Electron 版本不保证旧 `file.path`，仅从受控 `webUtils.getPathForFile(file)` 类路径获取并由 Main 校验。未经主进程授权的拖放路径不得自动扫描。

- [ ] **Step 1: 写失败测试** — 导入 3 个 fixture 时列表保留 3 行（包含无效项），动态 Selector 显示“需要运行时确认”，零 DOM 测试时不得显示“修复成功”；恶意元数据 HTML 作为文本显示，非脚本执行。
- [ ] **Step 2: 执行 RED** — `npx vitest run apps/desktop/tests/library-ui.test.tsx`；预期缺少组件/不符合断言。
- [ ] **Step 3: 最小实现** — React 负责交互与状态，不存储绝对文件的越权授权 token；提供加载/取消/空目录/无效文件/SQLite 不可用提示，保留列表过滤和查看结果入口。
- [ ] **Step 4: 执行 GREEN** — UI 单元测试、typecheck、人工交互检查通过（深色主题优先、简体中文文案）。
- [ ] **Step 5: 提交** — `git add apps/desktop/src/renderer apps/desktop/tests/library-ui.test.tsx && git commit -m "feat(ui): add local userscript diagnostics library"`。

## Task 10: 静态 JSON/Markdown 报告导出

**Files:**
- Create: `packages/reporting/package.json`, `packages/reporting/src/index.ts`, `packages/reporting/test/export.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/features/library/LibraryPage.tsx`
- Test: `apps/desktop/tests/export-ipc.test.ts`

**Interfaces:**
- Consumes: `ScanBatchResult`。
- Produces: `serializeStaticReport(result:ScanBatchResult, format:'json'|'markdown'):string`; `window.ussm.exportReport(jobId:string,format:'json'|'markdown'):Promise<ExportReceipt>`（main 使用系统 save dialog，受控保存到用户选定位置）。
- JSON 必须含 `schemaVersion,createdAt,scanMode:'static-only',scriptItems,errors`，无 API Key、Cookie 或未脱敏 DOM 数据。

- [ ] **Step 1: 写失败测试** — 失败/未扫描项目在报告中保持原状态；有 UTF-8/中文脚本名仍可打开；注入性 Markdown 文本转义；不存在 jobId 明确返回 not-found。
- [ ] **Step 2: 执行 RED** — `npx vitest run packages/reporting/test apps/desktop/tests/export-ipc.test.ts`；预期缺少 export 接口。
- [ ] **Step 3: 最小实现** — 导出纯结构化分析数据，不包含源文件原文；系统 save dialog 路径+覆盖提示、写失败保留状态；renderer 不传任意写入路径。
- [ ] **Step 4: 执行 GREEN** — 导出 JSON 可解析、Markdown 标记明确“静态未运行”，secret scan 0 个示例凭证泄露。
- [ ] **Step 5: 提交** — `git add packages/reporting apps/desktop && git commit -m "feat(report): export traceable static diagnostics"`。

## Task 11: 三种 Windows 预览发行包与独立冒烟测试

**Files:**
- Create: `build/electron-builder.yml`, `scripts/verify-dist.mjs`, `.github/workflows/windows-build.yml`
- Modify: `package.json`, `apps/desktop/package.json`, `apps/desktop/src/main/bootstrap.ts`
- Test: `tests/integration/distribution-contract.test.ts`

**Interfaces:**
- Consumes: `resolveDataRoot`, secure Electron shell，编译前端，SQLite 原生模块。
- Produces: 同一版本三个产物：`Userscript-Self-Healing-Manager-Setup-<version>-win-x64.exe`、`Userscript-Self-Healing-Manager-Portable-<version>-win-x64.exe`、`Userscript-Self-Healing-Manager-<version>-win-x64.zip`，以及 SHA-256 清单。
- ZIP 内容必须是 unpacked 完整 App 目录（包含 resources/locales/runtime DLL），不是单文件 Portable EXE 的 ZIP 包装。自建 Windows packaged smoke 必须严格核验。

- [ ] **Step 1: 写失败测试** — `distribution-contract.test.ts` 验证 build config 同时含 NSIS/portable/zip x64，三产物命名互不冲突；`verify-dist.mjs` 在缺包/ZIP 包含单个 Portable.exe/不同版本/哈希错时退出非 0。
- [ ] **Step 2: 执行 RED** — `npx vitest run tests/integration/distribution-contract.test.ts`；预期 build config 缺失。
- [ ] **Step 3: 最小实现** — electron-builder **v26 stable** Windows targets，区分 installed/portable-exe/portable-zip 内置 distributionMode；便携版 real `Data/` 路径必须在 Windows 打包后实际启动验证；如 v26 zip target 包出非 unpacked 应用，构建后加显式解压目录 ZIP 的受控脚本并保留可检测目标；不悄悄以 Portable.exe.zip 冒充完整 ZIP。
- [ ] **Step 4: 执行 GREEN** — 运行单测+在 Windows x64 runner `npm ci && npm run build && npm run dist:win && npm run verify:dist`；解压 ZIP 运行主 EXE；Portable EXE 从普通 D/临时可写目录启动；Setup 安装/卸载烟测记录、SQLite 初始化成功。缺少真实 Win10 测试时只能标 Windows runner smoke，不能声称 Win10 实机已 PASS。
- [ ] **Step 5: 提交** — `git add build scripts .github/workflows/windows-build.yml package.json package-lock.json apps/desktop tests/integration/distribution-contract.test.ts && git commit -m "build(windows): add three distribution targets and checks"`。

## Task 12: CI、安全扫描与首个可复核 V0.1 Preview

**Files:**
- Create: `.github/workflows/ci.yml`, `AGENTS.md`, `docs/releases/v0.1-preview-checklist.md`
- Modify: `README.md`, `package.json`
- Test: `tests/integration/offline-static-workflow.test.ts`, `tests/security/no-network-on-static.test.ts`

**Interfaces:**
- Consumes: Tasks 1-11；无新增公开运行时 API。
- Produces: 本地/CI 的单一门禁 `npm ci && npm run lint && npm run typecheck && npm test && npm run build`；用户可在 Setup/Portable/ZIP 任选一个打开并静态分析假脚本。

- [ ] **Step 1: 写失败测试** — 完整扫描（2 有效 + 1 语法错误 + 1 动态 selector）可生成统计一致的 JSON/Markdown，原始文件 SHA-256 前后相同；`no-network-on-static` 断言不发生 AI/CDP 出站请求；安装/便携文件夹 Data 策略遵循 Task 3。
- [ ] **Step 2: 执行 RED** — `npx vitest run tests/integration/offline-static-workflow.test.ts tests/security/no-network-on-static.test.ts`；预期首次失败（缺少真实集成协调或网络隔离）。
- [ ] **Step 3: 最小实现** — 补齐集成衔接、CI 命令、误报/异常/数据恢复负例、`AGENTS.md` 约束（先读规范/计划、TDD、禁止泄密、commit 频率、Stage Gate），README 区分设计规划与 V0.1 可执行范围、明确“CDP/自愈尚未完成”。
- [ ] **Step 4: 执行 GREEN** — CI 各项实测通过、Windows 三包 preview 附 sha256、Release Notes 和失败/跳过说明；若任一任务失败，不得发布为完整 Stable。
- [ ] **Step 5: 提交** — `git add .github/workflows/ci.yml AGENTS.md docs/releases README.md package.json package-lock.json tests/integration tests/security && git commit -m "ci: gate safe offline v0.1 preview"`。

## Test Coverage / Traceability

| 需求 | Task | 证据 |
|---|---|---|
| 安全 Electron/本地架构 | 1,2,3,8 | 安全窗口、IPC/path tests |
| FR-007/008/009 文件/拖放/目录 | 6,8,9 | import/scan-paths/library-ui tests |
| FR-010 元数据 | 5 | metadata tests |
| FR-011/012/013 AST 和动态未知 | 5 | selector-inventory tests |
| FR-039 本地资料 | 3,4 | runtime-paths + SQLite migrations tests |
| FR-040/041 报告和跟踪 | 7,10,12 | batch report + integration tests |
| FR-045~048 三形式发行 | 3,11,12 | distribution + Windows smoke |
| AI 默认关闭/隐私/安全 | 2,8,10,12 | strict IPC + network prohibition |

**本阶段刻意未覆盖**：FR-001~006 CDP 浏览器路径和启动（Phase 3）；FR-014~020 DOM 动态诊断（Phase 4）；FR-021~028 修复与回滚（Phase 5~6）；FR-025/026 V3/V4（Phase 7）；完整多任务队列（Phase 8）；共享兼容层（Phase 9）；BYO AI（Phase 10）；健康调度（Phase 11）。这些需要**独立下一阶段设计/计划**，不能在 V0.1 宣称“全功能完成”。

## 后续交付与回滚

- 本阶段只读用户脚本；异常、断电、SQLite 原生模块启动失败不应该更改原件。
- app 自身更新须有版本/DB schema 检查，V0.1 只做 preview 数据迁移前置保护，不开放静默自动更新。
- 分支合并前至少 review 安全 IPC、dataRoot、parser 不执行、ZIP 真解压目录四类高风险点。
- 必须先在真实 Windows runner 验证三包，然后才可以在 GitHub Release 挂 Preview 标签；普通用户 Stable 发行必须满足 RG-01~09、DIST-001~014。

## Execution Handoff

本计划待用户评审批准：批准后选择 `Subagent-driven` 或 `Native` 执行。执行时必须使用对应的 Superpowers 子技能，并按任务逐项完成 RED → GREEN → COMMIT，不以计划文档冒充实现结果。
