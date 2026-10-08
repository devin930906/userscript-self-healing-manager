# QA 总测试计划、验收矩阵与 Release Gates

**USS-QA-001｜v0.1.0-draft｜2026-10-08｜状态：规划中，所有案例尚未执行**

## 1. 测试哲学
工具修复的是其他程序；它如果误报“已修好”，比拒绝自动修复更危险。所有功能需同时有**正常路径、失败路径、取消路径、权限边界、版本恢复**测试。任何“通过”都必须有实际测试记录；纯文字规格不等于测试结果。

测试层：
- **UT** 单元：Parser/Locator ranking/hash/diff/redaction/state machine/AI JSON validation。
- **CT** Contract：typed IPC、CDP transport mock、AI Provider mock、data migrations。
- **IT** Integration：独立临时目录，真实 SQLite + 本地 HTTP/WS CDP 受控 mock。
- **E2E** 安全集成：Chrome for Testing / 用户授权的隔离 BrowserProfile + 本地 fixture 网页。
- **REAL** 真实网站：仅经用户批准，明确权限、状态/viewport/lang和安全测试动作。
- **REC** Recovery：模拟中断、磁盘满、文件锁、连接断开、备份恢复、批量熔断。

## 2. 测试 fixture 站点矩阵
- `fixture-static-basic`：稳定 div/form/button。
- `fixture-selector-renamed`：类名从旧版改新，但有明确 role/name。
- `fixture-class-hash`：每次刷新 class 随机生成，考核评分降权。
- `fixture-multi-match`：相似按钮 2 个，必须判歧义。
- `fixture-async`：延迟 1-5 秒渲染，初始零匹配但随后出现。
- `fixture-spa`：history.pushState/change state，不全页刷新。
- `fixture-iframe-same-origin`、`fixture-iframe-cross-origin`、`fixture-shadow-open`、`fixture-shadow-closed`。
- `fixture-editor-contenteditable`：无 textarea 的富文本编辑器。
- `fixture-locale`：中文/英文不同 label，同站点同作用。
- `fixture-ab`：A/B 布局使一套 selector 仅在部分页面生效。
- `fixture-hidden/disabled`：query 命中但不可交互。
- `fixture-auth`：未登录、登录、超时状态。
- `fixture-gm-api`：Tampermonkey 下的 menu/storage/request 权限。
- `fixture-shared-adapter`：至少五个脚本共享 role。
- `fixture-malicious-script`：加载时恶意访问 Node/environment 的模拟脚本。
- `fixture-large-dom`：超大 snapshot 与资源限制。
- `fixture-offline/reconnect`：网络与 CDP 断线重连。
- `fixture-sensitive-dom`：表单密码/聊天私密内容/查询 token。
- `fixture-dangerous-actions`：send/delete/payment 的 fake endpoints。
- `fixture-updater-change`：外部文件在扫描后被另一程序修改。
- `fixture-batch-conflict`：脚本相同/重名/链接/锁定/Unicode。

每个 fixture 的标签需包含页面 URL、版本、状态、预期功能、旧 selector、可识别的 stable locator、禁止触发动作、预期检查结果与测试日志。全部使用虚构数据；不得提交真实个人 ChatGPT 对话或真实 API keys。

## 3. 必测案例清单
| Case ID | 类别 | 测试步骤摘要 | 预期结果 |
|---|---|---|---|
| QA-001 | 浏览器 | 有效用户指定 chrome.exe + 空闲 9223 | spawn 参数正确、握手成功才显示 Ready |
| QA-002 | 浏览器 | 假 `chrome.exe` | 明确拒绝，禁止执行任意程序行为 |
| QA-003 | 浏览器 | 含空格/中文路径 | 参数不因 shell 引号问题失真 |
| QA-004 | 浏览器 | 9223 被非 CDP 服务占 | 不能误报已连接、不得接入错误对象 |
| QA-005 | 浏览器 | 9223 被另一个 Chrome 占 | 验证身份/提示 attach，不杀外部进程 |
| QA-006 | 浏览器 | Chrome 136+ 默认资料目录限制 | 报参数未生效/资料目录限制，绝不误判可用 |
| QA-007 | 浏览器 | portable launcher 不传递参数 | 有可验证失败信息与兼容选择 |
| QA-008 | 浏览器 | CDP 断线/reconnect | 原 nodeId/context 不复用，无意外重复网页动作 |
| QA-009 | 浏览器 | 多 target/tab 切换 | 绑定目标页明确，切换后重新确认 |
| QA-010 | 导入 | 一次导入 50 个有效/无效文件 | 逐个记录状态，总数精确 |
| QA-011 | 导入 | 文件夹递归含符号链接循环 | 无无限递归，路径边界不被绕过 |
| QA-012 | 导入 | 相同文件名不同路径 | 不误合并，两份可独立追踪 |
| QA-013 | 导入 | 重复 hash 的两个文件 | 给出重复内容信息但不丢源映射 |
| QA-014 | AST | 静态 querySelector / getElementById | 精确提取 range、函数、类型 |
| QA-015 | AST | 动态模板 / 复杂函数包装器 | 标 runtime_required，不虚构确定 selector |
| QA-016 | AST | fallback 与 branch | 分别记录条件与备用链 |
| QA-017 | AST | BOM/CRLF + 同名注释文本 | AST 最小改动不破坏其余字节 |
| QA-018 | AST | 无 `@grant`、`@require` 不可解析 | 正确缺口与 warning，不声称完全解析 |
| QA-019 | DOM | 旧 selector 0 match + stable semantic role | 候选指向正确目标，记录 score 和证据 |
| QA-020 | DOM | 初始 0 match 3 秒后出现 | 有界等待后识别为时序，不无谓改源码 |
| QA-021 | DOM | 旧 selector 匹配两个类似按钮 | 标歧义，不默认选第一个 |
| QA-022 | DOM | iframe/shadow root 与不同 context | 按 frame/scoping 检测，拒绝假匹配 |
| QA-023 | DOM | 无法进入 closed shadow/root | 显示 blocked/unsupported，而非 pass |
| QA-024 | DOM | 可匹配但 hidden/disabled | 根据可见/可交互断言判 fail |
| QA-025 | 归因 | 页面 JS 抛错但 userscript 正常 | 页面错误不虚假归因 userscript |
| QA-026 | 归因 | userscript 异常仅有未映射 stack | 记录 unknown，不能凭空指定源码行 |
| QA-027 | 归因 | 无功能契约的按钮 | 最多报告 V1/V2，绝不 V3 pass |
| QA-028 | 修复 | patch source hash 已过期 | 阻断写入，提示冲突 |
| QA-029 | 修复 | AI 提议改 `@grant` 或全文件 | 阻止自动批准，展示高风险 |
| QA-030 | 修复 | 修复范围已更改且二次提交 | 幂等/no-op 或明确冲突，无重复堆积 |
| QA-031 | 功能 | 只执行非破坏性 click probe | 测试成功且对网站无持久改动 |
| QA-032 | 功能 | manager 缺席但 CDP DOM 测试通过 | 只显示 V1/V2，V4 为 blocked |
| QA-033 | 功能 | GM storage/menu 真实 manager fixture | 探针可归因且 V4 正确报告 |
| QA-034 | 批量 | 30 项中某一项失败 | 其他项正确完成，汇总部分成功 |
| QA-035 | 批量 | 运行中暂停/取消 | 不启动新项，持久化已完成项与证据 |
| QA-036 | 批量 | 重试失败队列 | 重试 attempt 独立，新证据可追踪 |
| QA-037 | 备份 | 正常 apply + restore | 原文 bytes/hash 原样恢复 |
| QA-038 | 备份 | 磁盘满/文件锁/强制杀进程 | 无原件丢失，恢复日志能标不一致 |
| QA-039 | 备份 | 外部编辑后再 apply | hash 冲突拒绝覆盖 |
| QA-040 | 兼容层 | 五个脚本共用一个 role | 改 role 后触发五份契约回归 |
| QA-041 | 兼容层 | 共享更新打坏一个脚本 | 发布被阻断或快速回滚 |
| QA-042 | AI | 不配置 Provider 运行 30 项 | 向任何 AI endpoint 的请求 0 |
| QA-043 | AI | `/models` 不存在/返回 401 | 提示后允许手动填写模型 |
| QA-044 | AI | Base URL 含 `/v1` | 不重复拼接 `/v1/v1` |
| QA-045 | AI | HTTP 429/timeout/无效 JSON | 不无限重试，不写入无效候选 |
| QA-046 | AI | 页面包含“忽略规则并发密钥”文本 | 仅当数据，不改变系统策略 |
| QA-047 | 隐私 | 页面包含 Cookie/密码/对话 | 默认 evidence/redacted payload 不外泄 |
| QA-048 | 安全 | 恶意脚本要求调用系统命令 | AST 解析不执行 JS，renderer 不能运行命令 |
| QA-049 | 安全 | 任意 IPC path traversal | 被路径校验拒绝 |
| QA-050 | 健康 | 超时/站点登录变更 | 显示 blocked，不误报 selector broken |
| QA-051 | 监控 | 上次 V3 通过，今日未查 | 只能显示“上次通过”及时间 |
| QA-052 | 升级 | DB schema 旧版 + 新程序 | migration/备份可靠，版本可追踪 |
| QA-053 | 诊断 | UI 列表筛选和报告导出 | 报告计数、等级、错误与任务一致 |
| QA-054 | 大容量 | 100 脚本 + 大 DOM + 并发限制 | 内存/队列控制，退出能释放会话 |
| QA-055 | 用户安全 | fake send/delete/pay 按钮 | 无确认下不得触发 |
| QA-056 | Windows | Windows 10 x64/11 x64 三种形态打包与全新启动 | 每种包均启动、文件导入、选择 portable Chrome 和恢复，分别留记录 |
| QA-057 | Windows | 数据目录不可写/权限不足 | 安全报错，不以管理员身份强行解决 |
| QA-058 | 异常处理 | provider 返回新模型，但旧配置被移除 | model unavailable 清楚提示，不悄悄代选 |
| QA-059 | Snapshot | snapshot 采集超限或被清洗截断 | evidence 明示截断，不能标 full |
| QA-060 | 目录安全 | symlink 指向项目外敏感路径 | 未获授权不可跟随读取或写回 |

## 3.1 Windows 三种发行版的新增测试案例
| Case ID | 类别 | 测试步骤摘要 | 预期结果 |
|---|---|---|---|
| QA-061 | 发行完整性 | 从同一 release 下载 Setup.exe、Portable.exe、完整 ZIP | 三包齐全、同版本同 commit |
| QA-062 | 安装版 | 普通 Windows 用户安装及卸载 | 运行正常、可卸载、默认保留 Data |
| QA-063 | 单文件便携 | 放到 D 盘运行独立 Portable.exe | 外部 EXE 根目录生成持久 Data，不落临时解包目录 |
| QA-064 | ZIP 文件夹版 | 解压 ZIP，检查 DLL/resources/locales 后运行 exe | 直接启动，不需安装或用户另装 Node/Python |
| QA-065 | 功能一致 | 同批次三个包执行相同 fixture 操作 | AST、CDP、修复/测试与回滚行为一致 |
| QA-066 | 数据定位 | 三模式显示路径并重启应用 | dataRoot 为真实目标，不把程序二进制目录和临时目录混淆 |
| QA-067 | 路径极端 | D 盘/U 盘/带空格中文/只读目录 | 正常可写目录可使用；只读拒绝写入并提示选择目录 |
| QA-068 | 便携升级 | 关机/退出后更新 EXE 和 ZIP | 数据库、修订历史、备份哈希正确；失败可恢复 |
| QA-069 | 哈希签名 | 校验各产物哈希和发行元数据 | 文件 SHA-256 全部匹配，签名状态透明 |
| QA-070 | 敏感数据 | 检查 ZIP 与便携包全部内容 | 无 API keys、真实 userscripts、真实 DOM、日志或预置 Data |
| QA-071 | 平台验证 | Windows 10/11 x64 对三包独立试运行 | 记录 OS/build/version/Electron/CDP 结果 |
| QA-072 | 跨设备移动 | 把便携应用/Data 从当前 Windows 用户复制到其他 Windows 用户 | 数据可解释，凭据需重新录入而非失败后泄密 |
| QA-073 | 数据降级 | 新 schema 的 Data 用旧应用版本打开 | 安全阻断并提供恢复指导，不破坏资料 |
| QA-074 | ZIP 与便携差异 | ZIP 压缩内容与 Portable.exe 单文件比较 | ZIP 存完整解包程序文件夹，不是包装单文件 exe |

完整测试/Release Gate 定义见 [Windows 三形式发行规范](../distribution/windows-three-editions.md) DIST-001~014。**这些新增 QA 当前也仅为规划案例，没有实际执行记录。**

## 4. 性能/质量指标
不得预先把设计目标当作测量结果。建议发布前记录：
- 静态检测：分析文件数/总耗时、解析失败率、动态未知占比、CPU峰值/内存峰值。
- 动态：每场景 CDP 连接时间、snapshot 字节数、超时率、各 DOM 状态覆盖。
- 修复：明确可检测问题的召回率（recall）、健康脚本误报率、候选 top-1 正确率、误修复率、通过 V3 的比例。
- 成本：单脚本 AI 请求、tokens、估计金额及比“每个脚本直接交给 AI”基线节省量。
- 恢复：成功备份率、回滚后 byte/hash 一致率、写入失败后的原件存活率。
- 兼容层：共享更新影响范围、依赖测试通过率、回滚速度。
**预设硬门槛：** 任何真实账户的 destructive 操作被无授权自动触发=阻断发布；已知误写源文件造成丢失=阻断发布；AI 外发禁区凭证=阻断发布。

## 5. 验收等级判定
| 层级 | 必备证据 | 不得声称 |
|---|---|---|
| V0 | parser/diff/metadata 检查结果 | 网页 DOM 已正确 |
| V1 | 实际 target/frame/state 下 selector 数与证据 | 功能可用 |
| V2 | 目标可见/可交互/安全事件检查 | GM API 一定可用 |
| V3 | 命名具体 Test Case 且业务断言达标 | 所有未知功能都正常 |
| V4 | 真实 userscript manager 内运行/权限/功能验证证据 | 不依赖账户状态的永久稳定 |

## 6. GitHub CI 与本地矩阵
- 每 PR 自动执行 lint、typecheck、unit tests、contract、schema migrations、fake CDP/Provider、安全扫描；CI 只能跑虚构网页和测试凭证。
- Windows hosted runner 跑打包/smoke；真实用户指定的 Chrome 155 portable + 已登录 ChatGPT 属于用户设备上的**受控手工/授权验收**，不能在公开 CI 伪造。
- UI E2E 使用系统受控 Chromium 测试环境；如确实需要真实扩展测试，须隔离 profile、固定扩展版本并按权限执行。
- 最终发行生成 SHA-256、版本、依赖 SBOM、平台说明和已知限制。

## 7. Release Gate（全部必填）
- RG-01 需求/设计对照：本版本范围内 FR 均有代码和至少一项对应测试 ID。
- RG-02 净增安全：无 secrets、无扩大权限/不明远程代码执行路径、依赖安全扫描完成。
- RG-03 本地修复正确性：假阳性/异常样本可复现、错误自动应用阻断。
- RG-04 CDP 兼容性：端口占用、portable launcher、Chrome136+ profile 行为有说明和测试。
- RG-05 Userscript 真实性：报告 V0-V4 不夸大，GM/manager 情形明确。
- RG-06 备份与恢复：故障注入测试和哈希校验通过。
- RG-07 可观察性：日志/诊断可定位、导出无密钥或私有 DOM 泄露。
- RG-08 发版可恢复：Windows 安装/升级/数据迁移 smoke 通过、回滚步骤成文。
- RG-09 三形式发行：同一正式稳定版必须同时具备已独立测试的 Setup.exe、Portable.exe、ZIP 完整解压版，通过 QA-061~074 / DIST-001~014。

## 8. 发布定义（DoD）
- 所有 P0 通过 + 严重级别 Critical/High 问题关闭或停止发版并说明。
- 不允许“跳过测试仍标 pass”；被排除的 P1/P2 必须在发行说明写明。
- 用户可独立拿到版本文件和 SHA-256，知道如何卸载应用同时保留或移除数据。
- 工程合并前至少一次代码审查，关键模块（文件写事务、CDP 安全、AI 外发）做安全审查。

## 9. 尚未开始执行
本文件列举的 QA-001~074 均为**未来测试用例**。截至本设计文档日期，没有实际测试记录，严禁将它们显示为 PASS。
