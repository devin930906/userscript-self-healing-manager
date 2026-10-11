# Phase 1 · Task 4 — SQLite Persistence, Migration and Recovery

## Responsibility / 职责

本分支负责 **SQLite 数据持久化与安全恢复**，在 `feat/v01-continuation` 已有的实现基础上进行小范围加固，而不是重建数据库。

- SQLite Registry 的 Schema、版本检查及安全迁移（尤其旧版本、新版本、损坏或中断时拒绝误写）
- 数据库事务、重复启动/重复 migration、锁与写入失败场景
- SQLite 完整性检查，以及 Registry 的一致性备份与验证
- 数据持久化的可复现回归测试：重启后数据仍存在、同名不同路径脚本不会被合并、失败时不会静默清空数据
- 清楚区分 **Registry SQLite** 与独立 Diagnosis Journal、managed revisions 的非原子备份时间点；不要宣称跨库单一原子快照

## Exclusive file ownership / 独占修改范围

- `packages/persistence/**`
- `tests/integration/task4-persistence-*.test.ts`（如需要新增集成测试）
- `docs/tasks/phase1-task4-persistence.md`（本说明）

**不直接修改** `packages/contracts/**`（Task 1）、`apps/desktop/**`（Task 2）、`packages/runtime-paths/**`（Task 3）、`packages/source-analyzer/**` 和 `fixtures/userscripts/**`（Task 5），也不触碰共享根配置、CI 工作流、`main`、`feat/v01-continuation` 的分支引用。

如果完成 Task 4 的需求必须更改上述共享代码或跨模块 API：先记录待集成接口与对应测试，交由唯一集成者在核心分支集中协调，**不在 Task 4 上越界修改**。独立文件所有权降低冲突风险，但不承诺不存在逻辑/API 集成冲突。

## Acceptance / 完成标准

1. 新增或修改生产代码前先补充准确可失败的单元/集成测试。
2. 迁移必须保留原数据，面对未知或损坏 Schema 必须拒绝危险写入；失败不会宣称恢复成功。
3. 测试覆盖首次启动、重启保留、重复迁移、写失败、锁、数据库破损、异常 Schema、句柄释放、备份验证和恢复错误路径。
4. 以 Node 24 运行完整 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`；附上准确 HEAD 对应的 Windows CI 结果。
5. 使用 PR 将成果整合到 `feat/v01-continuation`；未经审查不直接合并到 `main`，不触发 Stable 打包或发行。

## Relationship / 5 个并行任务的边界

- Task 1: workspace contracts & TypeScript baseline
- Task 2: Electron secure shell, preload and IPC
- Task 3: installed/portable DataRoot & filesystem path policy
- **Task 4: SQLite persistence & safe migrations**
- Task 5: userscript AST metadata and selector inventory

Branch baseline: `feat/v01-continuation` at `88facaf332b8ee2e46efaee473f762a21be12472`.
