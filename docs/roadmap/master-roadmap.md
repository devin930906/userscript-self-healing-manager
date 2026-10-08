# 项目总体开发规划书、路线图、里程碑与交付计划

**USS-ROADMAP-001｜v0.1.0-draft｜2026-10-08｜Superpowers Architectural 项目规划｜不代表实施已启动**

## 1. 项目策略
不应该一开始用 AI 自动改写多个 scripts，再回头补测试。建议采用**安全可验证的纵向切片**：每次发布一个能独立使用、独立验收、可回滚的局部能力。每个阶段实施之前，需有经批准的子系统设计规范与 Superpowers 实施计划。每阶段用 TDD 与小颗粒 commit/PR；任务执行时不得以“后期补测试”跳过证据。

### 1.1 推荐技术基线（锁定实际版本前需查官方）
- 桌面：Electron + React + TypeScript + Vite。Renderer 保持 sandbox/contextIsolation，无 Node integration。
- 主进程：Node/TS 模块化服务，不在 renderer 执行 CDP/文件系统命令。
- AST：Babel parser/traverse + Recast（或等价精确编辑并保留格式的库）。
- CDP：Node WebSocket + Chrome DevTools Protocol capability discovery，直连所选 Chrome，不依赖 MCP。
- 存储：SQLite（migrations/WAL）+ 本地内容寻址版本库。
- 验证：Vitest、受控 CDP fake server、本地 fixture site、Windows native packaging smoke；Playwright 如引入只用于 app UI E2E/fixture 辅助，而不是代替核心 CDP 接入。
- 分发：Windows x64 **三种必需正式发行目标**：NSIS Setup.exe、单文件 Portable.exe、完整应用 ZIP 解压版；三包同时存在、单独验收、同 commit、同版本；避免依赖用户系统已安装 Node。见 [三形式发行规范](../distribution/windows-three-editions.md)。
- 源码管理：GitHub main（受保护）、feature branches、pull requests、Conventional Commits、CI 检查、tag/release notes。

### 1.2 建议目录树（规划，未创建产品源码）
```text
userscript-self-healing-manager/
├── README.md
├── LICENSE                              # 决策批准后添加
├── AGENTS.md                            # 为 Codex 固定仓库规则（开发启动时）
├── docs/
│   ├── superpowers/
│   │   ├── specs/
│   │   └── plans/                      # 架构规范批准后逐子系统创建
│   ├── requirements/
│   ├── architecture/
│   ├── security/
│   ├── design/
│   ├── quality/
│   ├── roadmap/
│   └── decisions/
├── apps/
│   └── desktop/
│       ├── src/main/                    # Electron main + IPC
│       ├── src/preload/                 # allowlisted typed bridge
│       ├── src/renderer/                # React UI, components, routes
│       └── tests/e2e/
├── packages/
│   ├── contracts/                       # types + validation schemas
│   ├── script-registry/                 # import / metadata / paths
│   ├── source-analyzer/                 # AST & selectors
│   ├── browser-cdp/                     # process + CDP + target
│   ├── runtime-probe/                   # DOMSnapshot + evidence
│   ├── diagnosis/                       # failure taxonomy
│   ├── healing-engine/                  # locator candidates + patches
│   ├── test-runner/                     # functional assertions
│   ├── compatibility/                   # site adapters/roles
│   ├── job-runner/                      # scheduler + job FSM
│   ├── revision-store/                  # atomic backup / rollback
│   ├── ai-providers/                    # BYO adapters
│   ├── persistence/                     # SQLite + migrations
│   ├── security/                        # credential + redaction
│   └── reporting/
├── fixtures/
│   ├── sites/                           # fabricated local websites
│   ├── userscripts/                     # harmless fake scripts
│   └── cdp-mocks/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── security/
│   └── recovery/
├── scripts/                              # internal build tools
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    └── pull_request_template.md
```
首期不需要为了目录树创建空 package。按实际到达阶段逐步创建；小模块可合并，但必须保持接口边界。

## 2. 开发阶段/依赖/成果
| Phase | 名称 | 依赖 | 最低交付物 | 验收门槛 |
|---|---|---|---|---|
| 0 | 规格确认与工程治理 | 无 | 经审批 Spec、ADR、FR-ID、QA-ID、AGENTS.md/仓库规则 | 主方案/Chrome 政策/风险/写回默认策略获确认 |
| 1 | 桌面基座与本地数据 | 0 | 可启动 Windows 桌面壳、IPC、SQLite、日志、配置、基础 UI | smoke + 安全 IPC + migration |
| 2 | 导入与静态 AST 分析 | 1 | 多文件/拖放/目录读取、元数据/Selector inventory、动态未知 | FR-007~013、QA-010~018 |
| 3 | BrowserProfile 与 CDP | 1 | 自定义 Chrome 可执行路径、参数启动、9223 握手、target、错误码 | FR-001~006、QA-001~009 |
| 4 | DOM 动态探针与故障归因 | 2+3 | DOMSnapshot/状态/Frame/事件与运行时证据、诊断报告 | FR-014~020、QA-019~027 |
| 5 | 版本库与可靠修复写回 | 1+2 | 备份、精确 patch、hash 防冲突、原子替换/回滚 | FR-022/023/027/028、QA-028~030/037~039 |
| 6 | 多级本地自愈与验证 | 4+5 | L0~L3、多候选评分、V0~V2、审核/应用 | FR-020~025、QA-019~031 |
| 7 | 真实功能契约与脚本经理 | 6 | V3 用户定义测试、可选 V4 bridge、GM/manager 兼容矩阵 | FR-025/026、QA-031~033 |
| 8 | 批量处理与体验完整性 | 2+4+6 | Job 队列、进度/取消/暂停、隔离失败、统计报告 | FR-029/030/040/041、QA-034~036/053 |
| 9 | 兼容层与依赖图 | 7+8 | 版本化 SiteAdapter、角色、影响分析、多脚本回归 | FR-033/034、QA-040~041 |
| 10 | BYO-AI 与安全升级 | 6+7+8 | Provider/Models API/模型手动/脱敏/成本预算/结构化 patch | FR-035~038、QA-042~049/058 |
| 11 | 健康监控与站点变化历史 | 4+8+9 | 周期检测、错误趋势、按网站告警、selector drift 报告 | FR-017/031/032/042、QA-050~051 |
| 12 | 发布加固 | 0~11 | Windows NSIS Setup.exe + 单文件 Portable.exe + ZIP 完整解压版三包构建、路径区分、签名规划、迁移、CI、release、rollback 手册 | QA-052/054~057/059~074、RG-01~09、DIST-001~014 |

**注意依赖关系**：Phase 2 与 Phase 3 可以并行开发，但 Phase 4 依赖两者整合；Phase 5 可与 Phase 4 在接口冻结后并行；AI 最后加入，防止本地基础能力被模型调用“假完成”掩盖。

## 3. 首个可用 MVP 的最小范围
目标“V0.1 静态诊断预览”：Phase 0~2，浏览器不必存在，用户能导入脚本目录、查看 AST 的 DOM 调用、动态未知与错误，并导出本地报告。

目标“V0.2 CDP 动态定位”：Phase 3~4，用户可以选择 Chrome，验证是否真连到 9223，对真实授权页面采集 DOM、判定 selector 候选；**不写源文件**。

目标“V0.3 安全本地修复”：Phase 5~6，有 AST 最小 patch、V0~V2、安全差异预览、备份与回滚；不应把 V1/V2 叫业务修复完成。

目标“V0.4 批量 + 功能验证”：Phase 7~8，能进行安全业务契约测试及 manager 等级识别，批量跟踪、取消和结果汇报。

目标“V0.5 多脚本共享自愈”：Phase 9，支持一次修复共享 role、多脚本回归和版本锁定。

目标“V0.6 AI 可选增强”：Phase 10，接入用户自定义模型、成本预算与隐私提示。

目标“V1.0 稳定发行”：Phase 11~12，健康监控、回归矩阵与 Release Gate 全部通过。具体版本命名可随评审调整；不意味着保证日历发布日期。

## 4. Phase 0 设计与决策 Checklist
- [ ] 核实用户所用便携 Chrome 155 的启动器和 CDP 行为（路径、资料目录、端口、已运行进程）。
- [ ] 同意 Windows 10/11 x64 首发、Electron 单技术栈与体积代价；对 Windows 10 安全支持风险有明确说明。
- [ ] 明确默认只读、写回受控文件副本；如需原目录批量自动覆盖，应单独确认权限。
- [ ] 决定 manager 为 Tampermonkey 首发，Violentmonkey 为兼容测试目标还是立即同时支持。
- [ ] 选定 GitHub 仓库许可证或明确暂不授予许可；公开仓库不能用于存放个人源码/快照。
- [ ] 明确计划中“静态解析”和“真实业务验证”的区分，审批 V0-V4 语义。
- [ ] 审查隐私数据外发政策和高风险按钮禁止自动测试边界。
- [ ] 审查目标验收案例、风险级别及首期允许自动应用的最高等级。
- [ ] 将审核意见反映回规格，生成经批准的 per-subsystem Superpowers plans。

## 5. 每阶段的任务切割规则
每个 Phase 开一组独立 GitHub Issues，每个 Issue 具有可验收输出而非“搭建整个引擎”大任务。每一个改动遵循:
1. 锁定目标 `FR-ID`/QA case 和接口。
2. 新增能失败的测试，复现实质场景。
3. 执行并确认因缺少功能而失败（非因为测试本身失效）。
4. 编写最小实现，执行通过测试。
5. 检查安全边界、风险及错误路径。
6. 运行受影响模块回归、typecheck/lint。
7. 小步提交，PR 附 evidence、实际命令与结果。
8. 审核通过再合并，并更新需求矩阵状态。

严格符合 Superpowers 的“测试 → 失败 → 最小实现 → 通过 → commit”；不接受仅有“完成”的口头描述。

## 6. Superpowers 正式实施计划格式（审批后生成）
按照规范文件 `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`，每个计划必须包含：
- Goal、Architecture、Tech Stack、关联已批准 Spec、Global Constraints、Review Focus（最容易遗漏的五类输入）。
- 精确的 Create/Modify/Test 文件路径、接口 consumes/produces、函数签名及 Type。
- Task 1..N，每个任务有明确失败测试、执行命令、预期 FAIL、实现步骤、预期 PASS、提交步骤。
- 跨模块依赖接口先固定、再实施。测试优先于实现；阶段完成前跑全量 Release Gate。
- 未批准 Spec 之前**不启动实际实施**，避免空仓库直接生成互相矛盾的大量代码。

## 7. 建议 GitHub 工作方式
### 7.1 Issue 与 branch
命名建议：
- `spec(FR-003): CDP launch and handshake`
- `feat(FR-011): AST selector inventory`
- `test(QA-039): reject stale source hash`
- `security(FR-037): enforce AI redaction boundaries`
- `docs(ADR-001): approve desktop architecture`

分支建议：`feat/browser-cdp`、`feat/source-analyzer`、`fix/revision-atomic-apply`、`docs/spec-updates`。
`main` 仅接已审核通过的 PR；推荐要求 PR test pass、no secrets、code review、release workflow。

### 7.2 PR 样板（未来创建）
```markdown
## Requirement IDs
## Scope of change / Non-goals
## Design interfaces and compatibility
## Tests first (red) / after (green)
## Real outputs and screenshots/logs (redacted)
## Security, privacy and possible side effects
## Backup, migration, rollback
## Known limitations / Follow-ups
```

### 7.3 GitHub Actions
- PR pipeline：checkout → install lockfile → format/lint → typecheck → unit/contract → fixture integration → secret scan → build（按阶段）。
- Windows build pipeline：固定同一 Git tag/commit，分别构建并验收 **NSIS Setup.exe、独立 Portable.exe、ZIP unpacked 应用包**；验证三者 dataRoot、便携迁移/升级、独立首启和资源完整性。
- Release pipeline：tag → 构建三包 → 提取 ZIP 验证 exe/resources → 各自产物 smoke → 检查 SHA-256/SBOM/隐私 → RG-09 门禁 → 手动批准 → 同一个 GitHub Release 上传三包及 SHA256SUMS。
- 对连接 GitHub 的任何自动发布设置最小权限；CI 不应该持有真实 ChatGPT Cookie 或真实用户脚本。

## 8. 发布与迁移策略
1. Alpha 内测：只读诊断，用户亲自检查，避免直接修改日常脚本。
2. Beta：补丁预览、托管目录写入、有限 V0-V3，逐批小量真实场景验收。
3. RC：批量工具、健康监控、compat 依赖图和 AI 成本预算接近完整，跑 74 个 QA 案例（含 14 项三发行模式测试）。
4. Stable：Release Gate 9 项全部完成（含三形式强制包），备份恢复可靠，公开发行使用说明明确 Chrome 限制、三包 dataRoot/升级说明及 Windows10 风险。

每个正式稳定版本必须有三个可下载的 Windows x64 文件：`Setup-<version>-win-x64.exe`、`Portable-<version>-win-x64.exe`、`<version>-win-x64.zip`，以及 SHA256SUMS、`MIGRATION.md`（如有 DB schema 变化）、Release Notes、Known Issues 和每种形态对应的升级/回滚说明。ZIP 必须是完整 unpacked 程序而不是 Portable.exe 的压缩包装。首次发布之前不得自称稳定版。

## 9. 风险优先级和处理顺序
**先验证最可能让整个项目失败的前提**：
1. 用户指定的便携 Chrome 155 在不传入 `--user-data-dir` 时到底能否 CDP 握手。
2. 真正的 Tampermonkey `GM_*` 行为是否能通过选定策略达到 V4。
3. AST 最小 patch 是否能保留原始 userscript 的格式、metadata 和动态依赖。
4. 多脚本共用一个兼容层时，实际装载方式与 world 隔离是否可靠。
5. 用户站点“目标功能”是否可被定义为安全、非破坏性的功能契约。

任何一项失败都要写明受影响 Phase、产品能力限制和替代设计；不得通过额外 AI 调用隐藏系统性限制。

## 10. 资源/成本与可测量收益
不存在可靠的“开发 X 天/省 Y% token”结论，因为脚本数量、风格、站点和硬件仍未测量。建议先建基线：
- 真实 scripts 数量、目标站点数、每脚本 selector 数、动态未知比例。
- 单次人工修复平均耗时、Codex tokens/额度消耗（用户愿意提供才采集）。
- 自动本地识别比例、每次误报、候选通过率、人工审批次数。
- AI 请求数、上下文大小、重试、缓存命中率和费用。
- 再使用实验组（本地优先）对照基线（全部人工修复），报告真实节省而非主观数字。

## 11. 交付包定义
“规划阶段完整交付”= 总体设计 + PRD + CDP 实施边界 + 自愈算法与兼容层 + Schema/状态机 + AI/安全 + UX + 60 QA + 路线图 + ADR；“进入编码准备就绪”= 用户审查批准这些决定并补全 Phase 0 的实际运行环境信息，再分子系统落地 Superpowers 逐步 TDD 实施计划；“软件已完成”= 只有实际代码/测试/release 满足 RG 才成立。
