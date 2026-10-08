# 数据模型、接口契约、状态机与持久化规范

**USS-DATA-001｜v0.1.0-draft｜2026-10-08｜设计评审**

## 1. 数据分层
- **SQLite DB**：标识、索引、工作流状态、元数据、关系、批次、检查记录、审计、配置、证据引用和版本关系。数据库本身不保存未经脱敏的密钥、完整 DOM 或超大 JS blob。
- **Content-addressed filesystem store**：脚本原件/版本、AST 索引缓存、DOMSnapshot 脱敏快照、diff、报告和可控日志，使用 `sha256` 内容寻址并引用 `EvidenceId`。
- **Windows 凭据保护**：AI API Key 使用 OS-backed 密钥能力存储（Electron safeStorage 可作为适配候选，但必须在 Windows 真机确认其回退行为并实施拒绝不安全回退）；不加入日志与导出配置。
- **项目工作区**：默认位于用户本地 AppData 的应用专用目录（具体路径由操作系统 API 决定）；用户可选管理目录并进行权限检查。不得使用安装包目录储存可变数据。

## 2. 主键与版本约定
`id` 使用稳定的随机 UUID，禁止仅根据文件名或网站名唯一识别。版本采用以下层次：
- `sourceHash`：源字节 SHA-256，变更前断言。
- `scriptId`：项目内逻辑脚本标识，源文件同名可以拥有不同 id。
- `revisionId`：每一次逻辑修订的不可变记录（可能未发布）。
- `siteAdapterVersion`：SemVer 范围 + pin。
- `schemaVersion`：数据库 migration 整数。
- `evidenceVersion`：快照清洗器版本，确保跨版本差异可解释。
- `jobAttempt`：重试次数，不应因重试而复用旧 attempt ID。

## 3. SQLite 逻辑表
| 表 | 关键字段 | 约束 |
|---|---|---|
| `projects` | id,name,root_path,write_policy,created_at | path 仅用于本机 |
| `scripts` | id,project_id,source_path,display_name,metadata_json,source_sha256,encoding,health_status | 与 revision 分开 |
| `script_dependencies` | script_id,kind,target_id_or_url,version_constraint | 支持 compat、require、site |
| `browser_profiles` | id,name,executable_path,binary_kind,port,launch_mode,last_seen_version | 不持久化临时调试 token |
| `browser_sessions` | id,profile_id,started_at,owned_pid,target_id,protocol_version,status,ended_at | 仅供审计，不是可长期复用 CDP 连接 |
| `sites` | id,name,domain_patterns | 域名列表需明确授权 |
| `site_states` | id,site_id,url_pattern,landmarks_json,viewport_json,locale | 页面状态决定测试适用性 |
| `script_site_mappings` | script_id,site_state_id,entry_url,auth_policy,approved_at | 防止猜测 URL |
| `selector_records` | id,script_id,source_sha256,source_range,expression,classification,scope_json,confidence | AST 缓存依源码 hash 失效 |
| `jobs` | id,type,created_at,started_at,finished_at,status,requested_by,config_snapshot_json | 保留批次配置快照 |
| `job_items` | id,job_id,script_id,site_state_id,status,attempt_count,error_code | per-file 隔离 |
| `findings` | id,job_item_id,category,severity,source_range,evidence_ids_json,diagnosis_status | 不能把 unknown 写成 passed |
| `locator_candidates` | id,finding_id,query,strategy,scope_json,score,components_json,risk_flags | 评分可追溯 |
| `patches` | id,finding_id,base_sha256,proposed_sha256,diff_object_id,risk_level,approval_state | proposed 不等于 applied |
| `test_cases` | id,site_state_id,script_id,contract_json,required_validation_level,danger_class | 主张的业务功能必须在契约内 |
| `test_runs` | id,job_item_id,patch_id,case_id,validation_level,status,evidence_ids_json,duration_ms | 区分未配置/受阻/跳过 |
| `revisions` | id,script_id,parent_revision_id,source_object_id,source_sha256,created_at,applied_at,origin,approval_id | 不可原地更改历史 |
| `backups` | id,script_id,revision_id,source_object_id,original_path,original_sha256,created_at,recovered_at | 回滚验 hash |
| `compat_packages` | id,site_id,semver,manifest_object_id,sha256,published_at,status | 每版本不可变 |
| `compat_dependencies` | compat_package_id,script_id,constraint,locked_version | 影响分析 |
| `providers` | id,type,base_url,model_id,credential_reference,enabled,limits_json | **不允许 plaintext API Key** |
| `ai_requests` | id,job_item_id,provider_id,model_id,redaction_summary,tokens_json,estimated_cost,status | 默认不保存全 prompt |
| `evidence` | id,kind,object_sha256,redacted,retention_until,source_context,created_at | 受 retention 控制 |
| `audit_events` | id,at,actor,action,entity_type,entity_id,previous_state,new_state,details_json | append-only |

## 4. TypeScript 边界接口（设计合同）
```ts
type ID = string;
type ValidationLevel = "V0"|"V1"|"V2"|"V3"|"V4";
type CheckStatus = "passed"|"failed"|"blocked"|"skipped"|"not-configured";
type DiagnosisStatus = "healthy_observed"|"broken_confirmed"|"suspected"|"blocked"|"unverified";
type JobStatus = "queued"|"preparing"|"running"|"paused"|"cancelling"|"cancelled"|"blocked"|"failed"|"completed"|"partially_completed";
type PatchStatus = "proposed"|"testing"|"validated"|"needs_review"|"approved"|"applying"|"applied"|"rejected"|"rolled_back"|"failed";

interface ISourceAnalyzer {
  analyze(input: { scriptId: ID; sourceBytes: Uint8Array }): Promise<SourceAnalysis>;
}
interface IBrowserManager {
  launch(profileId: ID): Promise<BrowserSessionResult>;
  attach(profileId: ID, options: {explicitConsent: boolean}): Promise<BrowserSessionResult>;
  disconnect(sessionId: ID): Promise<void>;
}
interface IDomProbe {
  capture(input: { sessionId: ID; targetId: ID; stateId: ID; policyId: ID }): Promise<DomEvidence>;
  checkLocator(input: { sessionId: ID; targetId: ID; locator: CandidateLocator; stateId: ID }): Promise<LocatorCheck>;
}
interface IDiagnoser {
  diagnose(input: {source: SourceAnalysis; runtime: RuntimeEvidence | null; caseSet: TestCase[]}): Promise<Diagnosis[]>;
}
interface IHealingEngine {
  propose(input: {findingId: ID; sourceSha256: string; evidenceIds: ID[]}): Promise<PatchProposal[]>;
}
interface IValidationRunner {
  run(input: {patchId: ID; testCaseIds: ID[]; maxLevel: ValidationLevel}): Promise<TestRunSummary>;
}
interface IRevisionStore {
  prepareApply(input: { scriptId: ID; expectedSourceSha256: string; patchId: ID }): Promise<ApplyTransaction>;
  commitApply(transactionId: ID, approvalId: ID): Promise<Revision>;
  rollback(input: {scriptId: ID; revisionId: ID; expectedCurrentSha256: string}): Promise<RestoreReceipt>;
}
interface IAIProviderAdapter {
  discoverModels(config: ProviderConfig): Promise<ModelRecord[]>;
  proposePatch(input: RedactedContext, limits: RequestLimits): Promise<PatchProposal>;
}
```
相关 `SourceAnalysis`、`DomEvidence` 等需在首次代码阶段建立 JSON Schema / zod 运行时约束并生成共享类型，避免通过隐藏 dynamic 字段随意扩展；上述接口是**规格合同草案**，不是已发布 npm API。

## 5. Queue 与 jobs
- `jobs` 为一个批量请求；`job_items` 为脚本×测试站点状态的最小可恢复单元；独立 attempt 保留诊断历史。
- job item 流转：`queued → preparing → running → completed | failed | blocked | cancelled`；暂停操作发生在可恢复检查点，运行中网络动作不可保证瞬时中断。
- job 汇总只有全部 completed 才显示 `completed`；部分完成应该 `partially_completed`。
- 排队限制：相同 `scriptId` 的写入互斥，相同 BrowserSession 一个时间仅一个有副作用的动态任务；多脚本读取可以独立。
- 重试是新 attempt；必须判断动作是否幂等，未知副作用任务不自动重试。
- 每个 attempt 固定当时的 `sourceSha256`、`siteStateId`、`browserProfileId`、`adapterVersion`、`redactionPolicyVersion`。

## 6. Patch 状态机
```text
proposed → testing → validated → needs_review → approved → applying → applied
     └─────────────→ failed
                         ↑
approved → rejected
applied → rolled_back
```
- 如果只有 V1 通过，不能设置 `validated`（除非该 patch 事先明确定义最低验收级别 V1，UI 仍必须显示“仅 V1”）。
- 用户拒绝则不可自动重复建议相同补丁；除非获得新证据。
- 应用前验证 `expectedSourceSha256`，不相等则 `stale_conflict`；不应覆盖用户并行编辑。

## 7. 文件写事务与灾难恢复
- 采用 `write_policy=managed-copy` 默认：外部脚本原件只读，补丁产物写入项目管理区（可单独导出）。
- 外部目录写回必须经明确 `write_policy=authorized-in-place` 开启，可按次重审。
- `prepareApply`：验证路径、权限、磁盘空间、原 hash；将原 bytes 复制到不可变 backup；新文件写临时路径并 fsync；重算 hash；记录 transaction pending。
- `commitApply`：再检查原 hash，原子 rename（同文件系统）；必要时目录同步/数据库阶段性写入；失败则恢复原 bytes、记录失败证据。
- Windows 上可能因为文件锁/杀毒扫描/跨盘移动导致 rename 失败：不得删除唯一原件；保留临时文件和备份，提供诊断。
- 启动时查找 pending transaction，按实际磁盘 hash 自动归类 `committed`/ `not_committed`/`inconsistent`；inconsistent 不应自动猜版本。
- 备份删除采取引用计数+保留策略，至少保留所有未被用户显式清理的 rollback 基线。

## 8. 搜索、查询与导出 API
- `scripts.list(filter)`、`jobs.get(id)`、`jobs.cancel(id)`、`findings.get(id)`、`patches.review(id,decision)`、`revisions.restore(id)`、`reports.export(jobId,format)` 等通过 typed IPC。
- UI 永远不能直接执行 arbitrary SQL、任意文件路径读写或任意 CDP JavaScript。
- 导出 JSON 含 `schemaVersion`、UTC ISO 时间（UI 可显示 MYT）、已完成/未完成统计、`sourceSha256`、`evidenceSummaries` 与脱敏标志；报告不包含 API Key。

## 9. 状态及用户措辞对应
| 程序内部状态 | 用户界面中文 |
|---|---|
| healthy_observed / V1 passed | 已检测：所选元素存在（不代表脚本功能正常） |
| functional V3 passed | 已验证：指定功能测试通过 |
| V4 passed | 已验证：脚本经理真实环境测试通过 |
| blocked | 无法完成：缺少必要条件 |
| unverified | 未验证 |
| patch proposed | 有修复建议，尚未应用 |
| patch applied | 已写入修复版本（查看验收等级） |
| rolled_back | 已回滚并核对版本哈希 |
| identity_uncertain | 连接对象身份不确定，禁止自动操作 |

## 10. 迁移与数据生命周期
- SQLite migration 只向前执行并在升级前备份数据库；影响 schema 的升级测试包括旧版数据迁移、回滚数据兼容、异常断电、重复迁移幂等。
- DOM 证据可单独设置 1/7/30/90 天清理；默认建议 7 天，隐私敏感的截图与原始 HTML 默认不持久化。
- Source revisions 默认保留至用户主动配置/清理；清理前提示是否失去某些 rollback 能力。
- 批量日志可以按 job 导出、脱敏；API secrets 不参与 settings export。

## 11. 数据测试
必须模拟：相同文件名不同内容、文件改动导致 stale hash、Windows 文件锁、重复导入、断电中断、数据库损坏、失效证据对象、并行写竞争、旧 schema migration、错误时区显示、Unicode 文件路径、配置导出不泄钥、回滚恢复后的 SHA-256 相等。
