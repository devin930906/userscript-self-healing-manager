# Stable Continuation — V0.1 (NOT STABLE)

**记录日期**：2026-10-14（Asia/Kuala_Lumpur）  
**唯一开发分支**：`feat/v01-continuation`  
**本轮经完整 CI 验证的源代码 HEAD**：`738fc69210ba92b797eebbe40e4b6de951f1f646`  
**分支当前 HEAD**：以 [实时分支 HEAD](https://github.com/devin930906/userscript-self-healing-manager/commits/feat/v01-continuation) 为准；本文件本身的文档提交也会改变 HEAD，不能在同一提交中自引用最终 SHA。  
**产品版本**：`0.1.0-alpha.5`；不是最终 Stable。

## 本轮实际修改与证据

- 基线：`88c74a8153d60fea0c0d3819f407dafd3d63b4bc`。原有 `apps/desktop/tests/trusted-drop.test.ts` 错误地断言 Windows 发行工作流不得有开发分支 `push` 触发；实际 `.github/workflows/windows-build.yml` 已允许 `push` 和 PR 运行**无安装包**的发行合同任务，独立安装包任务仍仅在手动派发且校验最终 tag 后执行。
- **RED（旧 HEAD）**：Development CI [#38506923159](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38506923159) 与 Continuation integration [#38506923241](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38506923241) 都在 `trusted-drop.test.ts:19` 的同一旧断言失败，日志显示 `ERR_ASSERTION`。
- **修复提交**：[738fc692](https://github.com/devin930906/userscript-self-healing-manager/commit/738fc69210ba92b797eebbe40e4b6de951f1f646)；只更新发行触发安全契约测试，要求 `push`/PR 的 `release-contracts` 任务不得打包或上传、必须执行 TypeScript 检查及合同测试；`windows` 安装包任务必须 `workflow_dispatch`，且最终授权在 `npm ci`、`dist:win` 之前执行。原有受信任拖放测试保留。
- **GREEN（准确代码 SHA：`738fc692...`）**：
  - Development CI [#38511837619](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38511837619)：SUCCESS。
  - Continuation integration [#38511837665](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38511837665)：SUCCESS。
  - Windows release contracts [#38511837613](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38511837613)：SUCCESS。正式安装包 job **skipped**，未生成安装包。
- GitHub 连接器完成源码写入和 CI 验证；当前聊天环境本地不能 clone GitHub，因此不另行声称本机 npm 测试或真实用户 Windows 10/11 验收。
- 原始 `docs/development/v01-worklog.md` 保留，未覆盖历史。

## 实际 Stable 门槛状态

| 项目 | 本轮变化 | 当前状态 |
|---|---|---|
| P0-A 当前失败 CI | 旧发行触发契约已修，精确提交的三个 CI 成功 | 本项阻断解除；不等于其余 P0 已完成 |
| P0-B 产品 V2/V3/V4 | 无新产品运行时代码或正式验收 | OPEN / PARTIAL / ENV BLOCKED |
| P0-C 可靠性和安全审查 | 无独立审查验收 | OPEN |
| P0-D Windows 三包正式验收及发布 | 无最终 tag、安装包或独立实机记录 | ENV BLOCKED / REVIEW BLOCKED |
| RG-01 | 未提升 | OPEN |
| RG-02 | 未提升 | OPEN / REVIEW BLOCKED |
| RG-03 | 未提升 | OPEN |
| RG-04 | 未提升 | OPEN / ENV BLOCKED |
| RG-05 | 未提升 | OPEN / ENV BLOCKED |
| RG-06 | 未提升 | OPEN / ENV BLOCKED |
| RG-07 | 未提升 | OPEN / REVIEW BLOCKED |
| RG-08 | 未提升 | ENV BLOCKED |
| RG-09 | 未提升 | ENV BLOCKED |

**权威依据**：[Stable gate Issue #51](https://github.com/devin930906/userscript-self-healing-manager/issues/51) 和 [P0 证据台账](../quality/p0-evidence-ledger.md)。不得把本轮 CI 绿灯改写成任何 RG 完成或 V4 产品验收。

## 下一轮直接处理

1. **先核对本文件所在文档提交的实际 HEAD 和三项 CI**，不要沿用旧运行 ID 为新 HEAD 冒充验收；若 CI 有真实失败，优先排查。
2. 若 CI 全绿，优先解决 FR-025 / FR-024 的真实 V2 安全非破坏性交互及具名 V3 产品功能契约缺口：基于现有 `packages/test-runner/src/read-only-interaction-readiness.ts` 和 `packages/scan-service/src/verification-levels.ts` 区分只读准备度与真实交互；TDD、明确用户授权、固定隔离 loopback 页面、禁止对真实站点执行任意 click、不可把 DOM match 提升为功能 PASS。与 QA-031、QA-027 和 RG-01/03 对齐。
3. RG-05：官方 Violentmonkey 隔离 GM 夹具存在受限的合成证据；真实 Tampermonkey、应用 V4 产品桥接、实际用户环境仍缺证据，保持 BLOCKED。避免重复已完成的 synthetic 测试。
4. RG-04/06：查看 [Issue #139](https://github.com/devin930906/userscript-self-healing-manager/issues/139) 的 Windows pinned-file 身份争议和已有 BigIntStats 修复；先复核最新代码与可重现证据，不重复造修复。
5. 完整 Windows 10/11 生命周期、三包最终同源构建、独立安全及供应链审查仍须在有授权和相应环境时执行；不得提前发布 Stable。

**续接原则**：先读当前分支最新 HEAD / CI 和本文件，再只读当前问题所需源码及 Issue #51；持续优先处理真正的 P0 阻断，保持 FR/RG 证据范围精确，不使用百分比虚报进度。
