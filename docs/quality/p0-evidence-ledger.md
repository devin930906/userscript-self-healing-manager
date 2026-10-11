# Stable P0 实现锚点与验收证据矩阵

**核对日期：2026-10-11（马来西亚时间）｜版本：0.1.0-alpha.5｜全局状态：NOT STABLE**

本表对应 [FR 产品要求](../requirements/product-requirements.md)、[QA 测试矩阵](test-and-acceptance.md) 和 [RG-01~09 阻断追踪 Issue #51](https://github.com/devin930906/userscript-self-healing-manager/issues/51)。**实现锚点仅表明源文件存在且属于关联模块，不证明完整功能已实现，更不表示通过真实环境验收。** `PARTIAL` 表示部分代码/受控 CI 证据存在但未完整认证；`BLOCKED` 表示正式发行门禁缺实际关键证据。全量 CI 成功不等于任一行可自动标记 Stable 完成。

| FR ID | 实现锚点 | 证据状态 | 仍待验证或缺失 |
|---|---|---|---|
| FR-001 | `packages/cdp-client/src/preferred-chrome.ts` | PARTIAL | Chrome 路径选择与目标机器 GUI/权限矩阵尚未完整验收 |
| FR-002 | `packages/cdp-client/src/browser-profiles.ts` | PARTIAL | 多 profile 生命周期及 Windows 用户数据分离尚待目标机器验收 |
| FR-003 | `packages/cdp-client/src/index.ts` | PARTIAL | CDP 启动在全部 Chrome 版本和端口情形尚未全覆盖 |
| FR-004 | `packages/cdp-client/src/endpoint.ts` | PARTIAL | 进程归属、异常握手和完整 Chrome 兼容矩阵仍需核查 |
| FR-005 | `packages/cdp-client/src/preferred-chrome.ts` | PARTIAL | 端口占用与进程回收的全部实际环境路径未认证 |
| FR-007 | `packages/script-registry/src/index.ts` | PARTIAL | QA-010 受控 50 文件导入通过；真实用户目录权限仍需验收 |
| FR-008 | `apps/desktop/src/preload/trusted-drop-sequence.ts` | PARTIAL | 拖放系统交互及全部拒绝/取消路径未独立认证 |
| FR-009 | `packages/script-registry/src/index.ts` | PARTIAL | 文件夹扫描基本实现；隐藏路径及跨平台大量文件仍需验收 |
| FR-010 | `packages/source-analyzer/src/index.ts` | PARTIAL | 静态元数据与诊断测试存在；真实样本兼容范围未认证 |
| FR-011 | `packages/source-analyzer/src/index.ts` | PARTIAL | AST 静态提取覆盖部分构造；真实复杂脚本覆盖率未认证 |
| FR-012 | `packages/source-analyzer/src/index.ts` | PARTIAL | 动态表达式受控标记；实际执行前仍必须隔离复核 |
| FR-013 | `packages/source-analyzer/src/index.ts` | PARTIAL | PR #45/#46 修复回退链及预算；复杂跨作用域语义未全部认证 |
| FR-014 | `packages/candidate-engine/src/page-scope.ts` | PARTIAL | 静态 URL 规则与授权场景映射已有实现，登录状态场景仍不完整 |
| FR-015 | `packages/cdp-client/src/snapshot.ts` | PARTIAL | 只读 DOM/CDP 路径有测试，全部 frame/shadow/runtime 情形未认证 |
| FR-016 | `packages/cdp-client/src/read-only-visibility.ts` | PARTIAL | DOM 只读证据/稳定性有限支持；真实交互断言尚未完整 |
| FR-018 | `packages/scan-service/src/fault-classification.ts` | PARTIAL | PR #52/#53 已接入安全归因；网页异常采集和可核验脚本堆栈未完成 |
| FR-019 | `packages/source-analyzer/src/index.ts` | PARTIAL | 行列/函数等静态来源已提取，完整现场证据链 UI 尚待认证 |
| FR-020 | `packages/scan-service/src/batch-dom.ts` | PARTIAL | 重检/iframe/shadow 降级存在；实际复杂页面环境修复范围未认证 |
| FR-021 | `packages/candidate-engine/src/index.ts` | PARTIAL | 候选排序实现与合成测试存在；真实脚本准确率/误报率未认证 |
| FR-022 | `packages/patch-engine/src/index.ts` | PARTIAL | 受约束补丁与原字节保护有测试，真实迁移与覆盖范围未认证 |
| FR-023 | `packages/repair-workflow/src/proposal-approval.ts` | PARTIAL | 同意/修订检查存在；完整用户审核和独立发布安全审查未完成 |
| FR-024 | `packages/scan-service/src/verification-levels.ts` | PARTIAL | V0/V1 限定验证；V2 blocked、V3/V4 not-configured，禁止当作整套完成 |
| FR-025 | `packages/test-runner/src/index.ts` | PARTIAL | 安全只读测试契约部分存在；完整 V2/V3 功能行为测试未认证 |
| FR-027 | `packages/patch-engine/src/immutable-archive.ts` | PARTIAL | 备份与事务测试存在；实际跨故障场景的不可逆覆盖尚待验证 |
| FR-028 | `packages/repair-workflow/src/history.ts` | PARTIAL | 历史/回滚能力已有部分实现；真实损坏/升级/中断矩阵未全验收 |
| FR-029 | `packages/scan-service/src/repair-task-queue.ts` | PARTIAL | 队列暂停取消单测存在；跨进程持久化和生产级恢复仍需验收 |
| FR-030 | `packages/repair-workflow/src/guarded-batch-v1.ts` | PARTIAL | QA-034 受控 30 项诊断隔离通过；真实并发写入冲突仍需最终认证 |
| FR-039 | `packages/persistence/src/index.ts` | PARTIAL | SQLite/schema 测试存在；实际版本升级与迁移完整矩阵未认证 |
| FR-040 | `packages/reporting/src/index.ts` | PARTIAL | JSON/Markdown 报告基础实现；完整审查/回滚可追溯输出待验收 |
| FR-041 | `packages/contracts/src/audit-trace.ts` | PARTIAL | 审计链契约存在；端到端 job→candidate→test→approval→revision 仍需核查 |
| FR-045 | `scripts/package-windows.ps1` | BLOCKED | 正式三发行包尚未从最终 Stable Tag 构建并独立启动验证 |
| FR-046 | `packages/runtime-paths/src/index.ts` | BLOCKED | 正式安装、便携 EXE、ZIP Data 目录隔离缺少三包实机证据 |
| FR-047 | `packages/repair-workflow/src/core-recovery.ts` | BLOCKED | 三包升级迁移、损坏恢复及 Windows 10/11 独立验收尚未完成 |
| FR-048 | `scripts/windows-release-gate.mjs` | BLOCKED | 正式三包同源、SHA、供应链审核及发布包完整验收未完成 |

## 条件阻断（原表 P1，但依赖 GM API 时升级为 MVP 阻断）

- **FR-026：BLOCKED**。Userscript Manager 扩展 target 只读观察参见 `packages/cdp-client/src/manager-targets.ts`；它不能替代 Tampermonkey／Violentmonkey 的真实注入、GM Storage、GM Menu 或 V4 验证。若用户最常见脚本依赖 GM API，FR-026 必须作为 MVP 阻断项处理。

## 可追溯的已有自动化证据（范围有限）

- [PR #48](https://github.com/devin930906/userscript-self-healing-manager/pull/48) / QA-010：真实 Windows runner 上的 50 份**合成**临时文件和 SQLite 导入验收通过。
- [PR #50](https://github.com/devin930906/userscript-self-healing-manager/pull/50) / QA-034：30 份合成 AST 脚本，经受控 CDP 适配器进行 25+5 分页，其中一项异常隔离；不是真实网页/manager 的验收。
- [PR #52](https://github.com/devin930906/userscript-self-healing-manager/pull/52) / FR-018：安全故障代码与未知归因，不能证明网页或脚本错误来源。
- [PR #53](https://github.com/devin930906/userscript-self-healing-manager/pull/53) / FR-018：分页 IPC 拒绝伪造异常来源，不是 V3/V4 认证。
- Windows CI 当前运行 Chrome for Testing 155 的 CDP/MV3 **合成扩展**测试，**不等于**实际 Tampermonkey/Violentmonkey V4 验证。

## 更新准则

1. 每条改为 `VERIFIED` 前必须记录对应具体 FR/QA、测试环境（Windows 版本/Chrome/manager）、完整测试范围、准确 Git commit、GitHub CI Run 或真实验收记录，并核对失败和跳过项；不能凭模块存在或测试数量推断通过。
2. `BLOCKED` 项必须在最终发行完成并独立验收后才能解除；QA-061~074 / RG-08~09 不能由发行合同测试替代。
3. 正式 Stable 的最低条件为 **所有 P0 和被提升的条件阻断项完整通过、独立安全审查及 RG-01~09 全部具备证据**，之后才允许最终 Tag/Release 三发行包。
