# Stable Continuation — V0.1 (NOT STABLE)

**记录日期**：2026-10-14（Asia/Kuala_Lumpur）  
**唯一开发分支**：`feat/v01-continuation`  
**本轮经完整 CI 验证的源代码 HEAD**：`dd67056f3c37e0b6b1720e39a0c1b8b7a875335a`  
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

## 第二批：Windows 精确 SQLite 文件身份阻断（同轮续接，2026-10-14）

- **新 RED（准确文档 HEAD：`4f6d48ce3ad09a9eb4cd5fbe2c539eb65cfeedcb`）**：Development CI [#38512087921](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512087921) 在 Windows `tests/integration/release-sqlite-runtime.test.ts:35` 失败。删除最终发行形态的一个 SQLite 文件之后，预期的“Missing or empty”错误被更早的“databases must be independent files”取代，表明 `scripts/verify-release-sqlite.mjs` 的数字型 `dev:ino` 文件身份可能发生 Windows 文件索引舍入别名。该 HEAD 的 Continuation [#38512088115](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512088115) 与 Windows 发行合同 [#38512087879](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512087879) 成功；因此不能说该旧 HEAD 全绿。
- **根因修复**：[Commit `0b933465`](https://github.com/devin930906/userscript-self-healing-manager/commit/0b93346571529a55e0bf0de5bf50a64d203e979b)；版式目录与六个真实 SQLite 数据库改用 `lstatSync(...,{bigint:true})` 的精确 `dev/ino` 身份。原有符号链接拒绝、缺失或空库拒绝、硬链接共享身份拒绝、`integrity_check` / `foreign_key_check` 均保留，不修改数据库。
- **合同 RED → 修复**：初次代码提交的 Ubuntu 发行合同 [#38512446549](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512446549) 显示另一个旧断言只允许 `lstatSync(path,{throwIfNoEntry:false})`；[Commit `0a5f9fb`](https://github.com/devin930906/userscript-self-healing-manager/commit/0a5f9fb24b85e6d258b93ca5f117c880199e4073) 更新该断言，**新增检查明确要求 BigInt 路径和 BigInt 空文件比较**，其余发行安全合同保留。
- **GREEN（准确代码 SHA：`0a5f9fb24b85e6d258b93ca5f117c880199e4073`）**：
  - Development CI [#38512533517](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512533517)：SUCCESS（含 Windows 全量测试、TypeScript、Real Chrome CDP；无安装包）。
  - Continuation integration [#38512533507](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512533507)：SUCCESS（Windows / Ubuntu）。
  - Windows release contracts [#38512533533](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38512533533)：SUCCESS（Windows / Ubuntu 合同检查；正式安装包 job intentionally skipped）。
- **P0/RG 影响**：此批解决本轮特定的 CI 及 numeric-inode 误认风险；并未证明 Windows 10/11 全发行版数据库恢复、真正 Windows native file-ID 路径抗所有竞态、正式三包或独立审查。RG-01～09 **全部维持 OPEN**，FR-024/025/026、FR-045～048 产品验收仍未提升。
- **最终续接文件自身文档提交**：通过 [分支历史](https://github.com/devin930906/userscript-self-healing-manager/commits/feat/v01-continuation) 与该文档提交后的准确 CI 核对；避免把上面代码 SHA 的结果误写成新的文档 HEAD 的运行证据。

## 本轮新增：FR-025 安全边界及 FR-021 同节点备用定位器（2026-10-14）

- 开始时分支 HEAD `d0ced9da1ba8983dc07107e41ebc040afe0ef1c1` 的三项 CI SUCCESS、无开放 PR；继承原有 SQLite 修复，不重复。
- FR-025 RED `f2865dba1b99b764ff27dd9dfac1b62c383b7a29`：[Continuation #38513421147](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513421147) 中未拒绝恶意 CDP 目标。GREEN `2baa6c2b8f34e1e6dc1ca4ab061de3ce4c770d83`：只读 SiteAdapter 在委托任何 CDP 依赖前核实本机端点与 HTTP(S) 页面凭证边界。[Development CI #38513541593](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513541593)、[Continuation #38513541567](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513541567)、[Windows contracts #38513541560](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513541560) 均 SUCCESS。
- FR-021 RED `b58a3863b8a581d32971c59649dc791011b87888`：[Continuation #38513792742](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513792742) 中同一 DOM 节点两个 fallback 误判为 ambiguous。GREEN `98cd663e251ec744cf5f3953740c7dee37698854`：只有所有命中备用定位器均稳定绑定单一相同节点指纹且 cardinality 允许 1 时，才返回 V1 `matched-v1`；不一致、动态多节点与数据缺失仍 `needs-review`。准确 SHA 的 [Development CI #38513902977](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513902977)、[Continuation #38513902795](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513902795)、[Windows contracts #38513902918](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38513902918) 均 SUCCESS。
- 本轮无 PR 合并（已获授权在指定开发分支直接提交）；无真实用户脚本执行/写入、无中途安装包、未变更 `main` 或 Stable tag。P0 与 RG 进度：两个实际源码缺口的局部修复得到自动化证据，**无 P0 FR 获完整验收**；RG-01~09 未解除。
- 下一项最高优先级仍是 **FR-025 / FR-024 真正 V2 安全交互及具名 V3 功能验证**（当前仅只读 V1 和 synthetic/test-only click，尚无产品级认证）。必须先建立权限、动作安全分类、实际交互归因及失败/清理/回滚合约，再接生产 GUI；不要复用隔离 fixture 来声称实际用户网站通过。其次为 RG-05 真正 manager V4 及 RG-06/08 独立 Windows 恢复和发行验收。
- 此续接文件的更新 commit 会使分支 HEAD 前移；**下一轮先检查该文档最终 HEAD 的三项 CI**，不要用上述代码 SHA 的结果冒充文档 SHA 证据。


## 2026-10-14 FR-025 有界真实 Chrome 只读等待（本次续接）

- 起始可信分支 HEAD：`fc0b47618c2be09d1c97f58802f8926c8ac7be1a`；[Development CI #38514210719](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38514210719)、[Continuation #38514210707](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38514210707)、[Windows contract #38514210757](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38514210757) 均 SUCCESS。无开放 PR；未重做原有 SiteAdapter 或 SQLite 修复。
- **模块 RED**：[测试提交 `eeea009b`](https://github.com/devin930906/userscript-self-healing-manager/commit/eeea009b4a8355f95b07502081dbee76409454f2)，[Development CI #38514764916](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38514764916) FAIL，四个 FR-025 用例实际因缺少 `runReadOnlyVisibilityWait` 失败；含有界等待、先缺失后出现、隐藏/缺失耗尽、节点替换、伪造 CSS 证据、未批准/坏 CDP 目标。
- **真实模块实现**：[Commit `3027901c`](https://github.com/devin930906/userscript-self-healing-manager/commit/3027901ce65a771ef106b7882dee562e9894d02d)：最多四次由用户触发的只读样本，须有连续两次相同的私密节点指纹、顶层 frame/loader 未变及 CSS/盒模型 `potentially-visible` 元数据。失败、漂移、模糊结果需要复核；不执行页面 JS、用户脚本或 Input 命令，不驻留后台。
- **Desktop 桥 RED**：[测试提交 `de31a7db`](https://github.com/devin930906/userscript-self-healing-manager/commit/de31a7db6b7eb7fd400a0b5c0421f787b11808a8)，[Continuation #38514969379](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38514969379) 的 Windows/Ubuntu 测试均 FAIL，明确报告缺少原生 IPC 入口及 preload/UI 操作。**GREEN**：[Commit `080ba878`](https://github.com/devin930906/userscript-self-healing-manager/commit/080ba8788723ff02c1ad1a5c2072fbe3cc1906d0) 接入受信任 Main 的 scan/session、静态顶层 selector、脚本授权目录、网页匹配范围、外部 Chrome 目标、精确 page identity、受限 preload 及 React 操作按钮；[Development CI #38515217248](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38515217248)、[Continuation #38515217315](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38515217315) 与 [Windows contract #38515217424](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38515217424) 均 SUCCESS。
- **实际 Chrome 正/负集成**：[Commit `dd67056f`](https://github.com/devin930906/userscript-self-healing-manager/commit/dd67056f3c37e0b6b1720e39a0c1b8b7a875335a) 在 `scripts/smoke-chrome.mjs` 的独立真实 Windows Chrome（受控 loopback 合成页面）执行本模块，正例连续两次 `potentially-visible-v1`，负例四次缺失 `needs-review`；运行日志直接包含 `PASS real Chrome FR-025`。准确 SHA：[Development CI #38515579431](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38515579431)、[Continuation #38515579434](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38515579434)、[Windows release contracts #38515579433](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38515579433) 均 SUCCESS。正式安装包 job 未执行。
- **审查修正**：实际底层返回 `potentially-visible` 而非已排除遮挡和祖先阻断的真可见；类型、文案统一为 `potentially-visible-v1`／「CSS 可能可见」，不升级 V2/V3/V4、`functionalVerified:false`、`managerVerified:false`。
- **FR/RG**：FR-025 新增可在桌面产品调用的有界等待＋受控真实 Chrome V1 集成证据，但整个 FR-025 仍 **PARTIAL [CODE GAP] [ENV BLOCKED]**，尚无真实网页/manager 具名业务动作、交互因果和无损清理验收。FR-024 V2 仍 `blocked`，V3/V4 `not-configured`；RG-01～09 全部 OPEN。未修改真实用户脚本、`main`、正式 tag 或 GitHub Release。
- **下一项最高优先级**：产品级 V2 真正非破坏性动作的权限及动作安全分类（不能从 CSS/button 自动推断无害），V3 具名业务前后状态归因和清理机制；随后 RG-05 官方 Tampermonkey/Violentmonkey 真 manager 产品桥与 RG-06/08 Windows 真实恢复。若缺少安全授权或真实 Windows 环境，应标 `ENV BLOCKED`、`REVIEW BLOCKED` 并推进其他可验证的 P0；**不要反复增加合成边界微测试替代产品工作**。
- 续接文件自身提交将使 HEAD 前移。下一轮先核对该最后文档 HEAD 的三项 CI，不得把以上代码 SHA 的 CI 冒充最终文档 SHA 的验证结果。

## 下一轮直接处理

1. **先核对本文件所在文档提交的实际 HEAD 和三项 CI**，不要沿用旧运行 ID 为新 HEAD 冒充验收；若 CI 有真实失败，优先排查。
2. 若 CI 全绿，优先解决 FR-025 / FR-024 的真实 V2 安全非破坏性交互及具名 V3 产品功能契约缺口：基于现有 `packages/test-runner/src/read-only-interaction-readiness.ts` 和 `packages/scan-service/src/verification-levels.ts` 区分只读准备度与真实交互；TDD、明确用户授权、固定隔离 loopback 页面、禁止对真实站点执行任意 click、不可把 DOM match 提升为功能 PASS。与 QA-031、QA-027 和 RG-01/03 对齐。
3. RG-05：官方 Violentmonkey 隔离 GM 夹具存在受限的合成证据；真实 Tampermonkey、应用 V4 产品桥接、实际用户环境仍缺证据，保持 BLOCKED。避免重复已完成的 synthetic 测试。
4. RG-04/06：查看 [Issue #139](https://github.com/devin930906/userscript-self-healing-manager/issues/139) 的 Windows pinned-file 身份争议和已有 BigIntStats 修复；先复核最新代码与可重现证据，不重复造修复。
5. 完整 Windows 10/11 生命周期、三包最终同源构建、独立安全及供应链审查仍须在有授权和相应环境时执行；不得提前发布 Stable。

**续接原则**：先读当前分支最新 HEAD / CI 和本文件，再只读当前问题所需源码及 Issue #51；持续优先处理真正的 P0 阻断，保持 FR/RG 证据范围精确，不使用百分比虚报进度。
