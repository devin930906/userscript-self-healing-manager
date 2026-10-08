# Userscript Self-Healing Manager — 总体设计规范

**文档 ID：USS-SPEC-001｜版本：0.1.0-draft｜日期：2026-10-08｜状态：待用户设计评审｜路径：Superpowers / Architectural**

## 0. 设计摘要与理解确认
目标不是一次性生成“新的 userscript”，而是为既有数十到数百个 `.user.js` 提供可审计的本地故障检测、证据保留、候选修复、自动验收、人工批准、版本回滚和持续健康监测。**核心成功标准是减少重复 Codex 请求、减少网站改版后的恢复时间，并且不因误修复而损害正常功能或用户账户。**

明确约束（来自项目发起人）：
- 桌面优先，Windows 10 为首发目标；允许用户手动选择安装版或多个便携版 Chrome 的真实执行文件。
- CDP **直接连接**用户所选 Chrome；默认启动参数 `--remote-debugging-port=9223`、`--remote-debugging-address=127.0.0.1`，**默认不自动添加** `--user-data-dir`。
- 支持多选、拖放、目录扫描、批量处理 `.user.js`。
- 静态 AST 与真实网页动态分析必须并存；动态构造的选择器不能谎称静态已确认。
- 日志区分浏览器异常、脚本显式抛错、selector 断言失败和业务断言失败；不具备埋点或功能断言时不可宣称业务运行正常。
- 多级本地修复优先；外部 AI 是可禁用的、用户自定义的补充手段；提供 Base URL/API Key/自动模型发现/手动模型 ID。
- 有版本、备份、回滚、健康检查和独立版本化的跨脚本兼容层。
- **Windows 正式版强制三形式发行：EXE 安装版、单文件 EXE 便携版、ZIP 完整解压即用版**；同版同功能且在 Release 中同时提供，不能只把 Portable.exe 压成 ZIP。便携版本持久资料默认在 EXE/解压文件夹对应的 `Data/`，明示更新和跨设备密钥迁移边界。详见 [Windows 三形式发行规范](../../distribution/windows-three-editions.md)。

设计假设（非用户已经确认的事实）：MVP 以 Windows x64 + 单机单用户为优先；推荐 Electron + TypeScript 单栈以减少 AST/CDP 集成的交叉语言成本；不在 MVP 自动登录网站、不绕过站点防护、不代替 Tampermonkey 写入扩展内部存储；不默认上传私有 DOM、Cookie 或脚本给任何 AI 服务。其他操作系统、浏览器品牌与共同兼容层的自动分发列为后续扩展。

## 1. 范围与边界
### 1.1 目标范围
1. 导入、索引、静态分析和依赖映射。
2. 浏览器进程启动/连接/会话生命周期管理；目标网站识别、DOM/DOMSnapshot/Runtime/Console/Page 信息采集。
3. 多策略判断故障是：定位失败、时序问题、Frame/Shadow DOM 问题、脚本注入或授权问题、网络或登录问题、真正的业务逻辑变化。
4. 本地修复的候选生成、评分、审计；仅安全修改已证实的源代码锚点。
5. 按自动化等级执行修复预览、验证、提交及回滚。
6. 按域名/站点适配器配置稳定语义控件、测试用例与共享 Locator，处理批量修复。
7. 可选 AI 提供方配置、分层上下文脱敏、成本限制和错误回退。
8. 监控、告警、证据库、报告输出和 Git 管理。

### 1.2 明确非目标
- 不承诺 100% 自动修复；不承诺能读取跨源 iframe 中未经授权的内容；不承诺能判断未定义测试的“所有功能”。
- 不绕过 CAPTCHA、WAF/反爬、安全验证码、站点访问限制或身份验证。
- 不默认访问任意网页、发送消息、提交付款、删除数据、操作账户设置。
- 不通过猜测修改 `GM_*` API 的权限声明或向浏览器扩展秘密注入脚本。
- 不修改或重启现有日常工作 Chrome 进程，除非用户明确批准。
- 不声称 AST 可完全还原运行时选择器，不声称 DOMSnapshot 等于永不遗漏的“完整网站”。
- 不将 GitHub 仓库、用户本机文件、AI Provider 数据与网页账户混为一体。

## 2. 候选架构对比与决策
| 路线 | 优点 | 代价 | 决策 |
|---|---|---|---|
| Electron + React + TypeScript + Node 主进程 | AST、CDP、UI、队列一套 JS/TS；打包和开发快；兼容库多 | 安装包和常驻内存较大；必须严格 IPC 隔离 | **推荐首发** |
| Tauri 2 + Rust + TS（可能需要 Node sidecar） | 更小安装包；原生能力较强 | AST/JS 执行环境要分离，跨语言打包测试更多 | 保留为后期瘦身候选 |
| .NET 桌面 + Node sidecar | Windows 原生 UI 与系统集成强 | 双运行时、接口和安装维护复杂 | 暂不采用 |

推荐栈（版本在启动编码前再次核验）：Electron、TypeScript、React、Vite、Node.js 主进程、AST（Babel parser/traverse、Recast 或等价保格式方案）、`ws`/CDP 客户端、SQLite（WAL + migrations）、Vitest、Playwright 仅用于本程序 UI 或隔离 E2E（非 CDP 业务依赖）、electron-builder 或等价签名打包。首期**不要加入 MCP 适配层**，因为应用可直接使用 CDP；MCP 只会在“外部智能代理访问本程序诊断结果”时另列可选接口。

## 3. 总体逻辑架构
```text
React Renderer（无 Node 权限）
  └── typed IPC / allowlisted commands
       └── Electron Main（协调器）
            ├── Project & Script Registry
            ├── Source Analyzer（AST + metadata + sourcemap）
            ├── Browser Process Manager（Chrome path + port + PID）
            │    └── CDP Transport / Target / Frame / Snapshot / Runtime
            ├── Runtime Instrumentation & Functional Test Runner
            ├── Evidence Store & Diagnosis Rules
            ├── Self-Healing Pipeline（L0-L5）
            │    ├── Candidate Locator + score
            │    ├── Patch Builder（AST范围精确替换）
            │    ├── Local Verification
            │    └── Optional AI Provider Adapter
            ├── Compatibility Registry（站点/角色/版本）
            ├── Job Scheduler & Health Watch
            ├── Audit & Versioning / Transactional Restore
            └── SQLite + filesystem snapshots/logs
```
所有核心服务通过 TypeScript interface + DI 交互；业务层不直接依赖 UI、MCP 或单一 CDP 库。UI 只能通过经过参数校验的 IPC 发起已定义动作，不能持有 API Key 或任意 filesystem 访问。

## 4. 核心端到端工作流
1. 导入一个/多个文件或目录（保留原路径、相对路径、sha256、元信息、编码/BOM、文件时间、冲突诊断）；默认扫描不写回。
2. AST 扫描生成 selector inventory（表达式、源码范围、所属函数/作用域、调用上下文、备用 selector、动态级别、`@match/@include/@exclude/@run-at/@grant`）。
3. 推断潜在目标站点，只作为候选；目标网址必须用户确认或来自显式保存的 site mapping。不能从 `@match` 直接猜测唯一可登录测试 URL。
4. 检查所选 Chrome 可执行文件/启动器、是否已有进程、端口占用与响应者身份；以参数数组启动，握手 `/json/version` 并校验 CDP 会话；失败则分类诊断。
5. 在用户授权的网站会话中选择 target、frame，采集结构化 DOM/DOMSnapshot、必要的稳定特征、Runtime 错误与时间序列；不默认保存敏感输入值、Cookie、完整网络响应。
6. 对 selector 做 0/1/多元素、可见性、交互性、角色、文字、父子关系、不同状态与重试窗口的断言；区别“暂时未出现”和“网站已改版”。
7. 对确定失效的锚点生成零个或多个候选。分层修复、风险评估、diff 预览、审批。业务改动大或证据不足时停止自动变更。
8. 在隔离验证流程中运行静态检查、DOM 断言、必要的行为测试；按脚本经理真实运行测试等级进一步验收。
9. 原始文件原子备份 → 临时文件写入 → 编译/检测/检查 → 原子替换（默认需人工确认）→ hash 校验 → 自动恢复能力；记录版本与审计事件。
10. 输出 per-script 与 batch 报告，记录 failure taxonomy、置信度、修复耗时、本地/AI 分流、成本、用户结果与可复验步骤。

## 5. 分层自愈引擎（处理顺序）
- **L0 — 健康与环境排查：** 没有连接/未登录/错误 target/DOM 未加载/脚本未注入/权限缺失时不碰代码。
- **L1 — 非破坏性重试：** 重新选择 frame、等待明确 DOM 状态、MutationObserver、事件和延迟加载时机（有时间上限）。
- **L2 — 共享 Locator 热修复：** 仅替换兼容层的语义定位定义；影响依赖脚本前进行完整回归。
- **L3 — 规则定位修复：** 基于稳定 `data-testid`、`aria-label`、role/name、表单关联、语义层级和历史 DOM diff 生成候选；使用 AST 定位精确替换最小源码范围。
- **L4 — 基于历史证据的局部重构：** 检查包装函数、事件绑定、frame/shadow/root 策略、等待策略；需要更高测试门槛与人工审批。
- **L5 — 可选 AI 辅助：** 仅提交严格裁剪/脱敏后的证据包，要求结构化 patch + rationale + 风险 + 测试建议；仍走本地安全校验和人工审批门槛。
- **Escalation：** 无候选、候选冲突、测试失败、行为测试缺失且有副作用、网站风控/登录阻断等情况停止并归档；禁止无限循环修复。

## 6. 候选选择器评分与自动应用门槛
建议权重（设计初值，必须根据基准数据调优）：唯一性 25；语义稳定性 25；历史稳定 15；交互性/可见性 10；结构邻近 10；多状态一致 10；复杂度惩罚/抗随机 class 5；总分 0–100。评分不是成功概率。
- 0–59：拒绝自动补丁，转诊断或 AI。
- 60–79：生成候选，人工确认，必须执行相关测试。
- 80–94：生成推荐补丁，人工确认；非破坏性行为测试通过才可应用。
- 95–100：仅在预定义无副作用安全白名单、双快照一致、功能测试存在并通过、无可疑跨作用域变更时，允许显式开启的自动应用。
- 即使达到 100 分，只要 `delete/payment/send/share/security` 等有副作用控件、来源置信度不足、范围扩大、`@grant` 扩权或测试无证据，一律升级人工审批。
- 这套阈值是设计策略，不是现成准确率承诺。

## 7. 共享兼容层
- 一个网站 `SiteAdapter` 用稳定 `siteId`、scope（域名/路径/状态）、`compatVersion` 定义一组语义角色（如 `chat.composer`、`chat.sendButton`）。
- 每个角色包含排序候选 locator、frame/shadow 查询边界、条件、健康断言、可选回退与定位历史。
- 脚本通过经过版本固定的显式 API 使用兼容层；**不默默重写旧脚本所有访问点**。旧脚本可先通过诊断和迁移建议逐步适配。
- 修改共享定义时计算受影响 `scriptId` 集合、运行全部下游契约测试；破坏性变化使用 major version，提供 pin / staged rollout / rollback。
- 兼容层加载来源和版本必须被信任并校验哈希；不要通过远程任意 URL 动态执行更新的 JS。

## 8. 诊断日志与可观测性
统一记录 `eventId`、`jobId`、`scriptId`、`sourceLocation`、`browserSessionId`、`targetId`、`timestamp`、`category`、`severity`、`evidenceIds`、`suggestion`、`testOutcome`。
诊断类型至少：`BROWSER_START_FAILURE`、`CDP_UNAVAILABLE`、`TARGET_MISMATCH`、`SCRIPT_INJECTION_UNVERIFIED`、`PARSE_ERROR`、`SELECTOR_ZERO_MATCH`、`SELECTOR_AMBIGUOUS`、`SELECTOR_DYNAMIC_UNKNOWN`、`TIMING_UNCERTAIN`、`RUNTIME_BROWSER_EXCEPTION`、`RUNTIME_SCRIPT_EXCEPTION`、`SELECTOR_ASSERTION_FAILED`、`FUNCTION_ASSERTION_FAILED`、`PERMISSION_OR_LOGIN`、`REPAIR_REJECTED`、`TEST_FAILED`、`ROLLBACK_EXECUTED`。
除非可靠的脚本级埋点/来源映射能归因，否则异常归属标记 `unknown`，不可把浏览器 console 错误武断指派给 userscript。

## 9. 验收分级
- **V0**：源码可读、metadata/AST 可解析、补丁合法。
- **V1**：在目标页面和目标 frame 下 selector 断言通过。
- **V2**：可见性、唯一性、事件绑定/安全交互检查通过。
- **V3**：用户定义的功能契约（例如按钮菜单注册、对话框出现、非破坏性状态变化）通过。
- **V4**：在实际安装的 Tampermonkey/Violentmonkey 环境中加载并验证 `GM_*` 权限与声明的功能行为；需要受控扩展/测试桥接，纯 CDP 注入不能代替。
状态区分 `passed`、`failed`、`skipped`、`blocked`、`not-configured`；自动化 UI 只能显示实际达到的等级。

## 10. 文件、权限、事务
- 所有导入的文件以只读方式分析。默认写入 `managed workspace` 而非覆盖源目录。
- 写回原目录需要逐项目明确授权；先复制原文件与 sha256；写临时文件并 fsync/原子 rename（跨设备不可保证）后验证 hash；异常执行完整恢复。
- 批量执行使用逐文件独立事务；不得因一个失败回滚其他已验证文件，除非选择“批量全部或回滚”的模式。
- 有符号链接、目录穿越、重复路径、编码非法、锁定文件、权限拒绝、异常长脚本等必须显式处理。
- 日志默认不保存完整密钥、cookie、Authorization 头、隐私文本；可设置保留期和清理策略。

## 11. 依赖、安全与产品守则
- 任意 `.user.js` 都视为不受信任的可执行程序；AST 解析不执行，动态测试只在用户明确批准的网站/浏览器环境运行。
- Electron renderer 必须启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`；IPC 使用命令白名单、schema 校验，限制文件系统边界。
- CDP 仅绑定本机 loopback，检测响应身份和端口劫持；禁止开放至公网、禁止记录 WebSocket 调试令牌。
- AI Provider 默认关闭；首次外发前必须展示发送摘要，明确 baseUrl、域名、字节数和脱敏范围。
- Chrome 136+ 官方浏览器对默认 profile 的调试限制视为阻断条件；不得暗中绕过。手动选择受控 profile 或 Chrome for Testing 属于可讨论兼容方案，并不是默认行为。
- Windows 10 已结束标准支持，首期需记录兼容性测试矩阵和升级安全建议（包括 ESU 可能性）。

## 12. 重要风险登记
| 风险 ID | 风险 | 响应策略 |
|---|---|---|
| R-01 | 便携 Chrome 实际无法打开 CDP | 启动器/真实 binary 检测、握手验证、备选 Chrome for Testing、不得误报 |
| R-02 | CDP 连接到了错误的浏览器 | PID/launch token/端口归属校验，拒绝非预期 target |
| R-03 | 误把网站异步加载判断为 DOM 改版 | 有界等待+历史+多状态证据 |
| R-04 | 找到另一个相似按钮却修改错误功能 | 语义功能契约、高风险审批、禁止盲改 |
| R-05 | `GM_*`/隔离上下文与测试不一致 | V4 真正扩展环境验证；降级状态显示 |
| R-06 | 批量修改导致大量脚本同时失败 | per-script 原子备份、分批发布、熔断、回滚 |
| R-07 | AI 泄露登录页面或密钥 | 本地默认、脱敏预览、密钥凭据存储、域名白名单 |
| R-08 | 共享兼容层单点故障 | 版本锁定、依赖影响分析、渐进回滚 |
| R-09 | DOM 改版同时改变业务语义 | 只报告无法验证，不自动提交业务动作 |
| R-10 | 公共 GitHub 仓库泄露私有样本 | 禁止把真实用户脚本、私有 DOM、证据日志、API key 提交 Git |

## 13. 成功指标与完成定义（设计目标，待基线建立）
- 至少 20 个可重复模拟 DOM 变更 fixture，覆盖 iframe、shadow DOM、SPA、随机 class、动态 selector、异步出现及安全页面。
- 自动补丁误应用（错误元素或错误业务功能）在高风险验收集必须为 **0**；若出现一例，立即停用自动写回路径。
- 每次修改必有 checksum、源码 diff、可定位证据和可恢复备份；恢复后 hash 等于原 hash。
- AI 未启用时，不发生向第三方 AI 的请求；普通诊断全流程本地运行。
- 支持的导入/队列/重试/报告功能均有负例测试（连接断开、非法脚本、端口被占用、受保护目录）。
- 基准记录本地识别率、误报率、候选 top-1 准确率、修复验证率、人工批准率、平均诊断时间、AI 请求数量/费用。**不事先承诺未经测量的速度或百分比。**
- Windows 正式 Stable 发布必须通过 RG-09 / QA-061~074 / DIST-001~014，包含三个可独立使用且可验证 hash 的发行产物。

## 14. 设计评审关卡与下一步
本文件是正式**书面架构草案**，不代表已经通过用户设计评审。用户检查后明确批准，才创建 Superpowers 格式的逐任务实施计划 `docs/superpowers/plans/YYYY-MM-DD-*.md`（每个子系统独立，TDD、文件路径、接口、失败测试、通过测试和独立 commit），再选择原生执行或子代理执行；此前不开始产品功能实现。

阶段路线、界面、数据契约、验收、安全与浏览器兼容详见 README 索引对应专章。
