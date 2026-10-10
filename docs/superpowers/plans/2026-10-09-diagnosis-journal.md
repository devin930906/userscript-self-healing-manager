# Persistent diagnosis journal · Superpowers TDD slice

**2026-10-09 | FR-029/040/041 (partial), QA-035/052 (partial)**

## Goal and Ruling
Persist bounded batch diagnostic progress across app restarts without tampering with existing `registry.sqlite` schema v1, without storing raw userscript sources, private local paths, DOM text, full target URLs, or external browser credentials.

**Ruling:** Use a separate `diagnosis-journal.sqlite` SQLite database under the already approved application dataRoot. This avoids modifying existing users' registry migrations before a separately tested versioned-backup strategy exists. Cost: two local SQLite files, no automatic reattach/resume to a live browser session after restart.

## Schema
- `journal_runs`: random run ID, hashed scan+target session key, trusted origin only, hashed document token, timestamps, status `running|completed|cancelled|interrupted|failed`, validated counts and totals.
- `journal_items`: row index, finite enum/status and counts, V0/V1 statuses. No script name, path, URL query, DOM, raw CDP token.
- Startup marks abandoned `running` sessions as `interrupted`. Never auto-resumes a stale CDP target.
- SQLite WAL, foreign keys and atomic transactions for each page; reject malformed/reordered/duplicated batches and unsupported future schema versions.

## Work
1. TDD RED: write real SQLite tests for transactionally recording contiguous pages, restart behavior, no sensitive strings, invalid order, old schema refusal, cancellation. Verify red.
2. GREEN: implement `packages/job-journal/src/index.ts`, conservative validation and bounded list/reopen APIs.
3. TDD RED: wire main-owned journal only after authoritative `BatchEvidenceStore.record`; trusted renderer cannot forge raw journal rows. Add read-only narrow history IPC/UI, cancellation. Verify red.
4. GREEN: attach to Electron application Data root and lifecycle; preserve prior `registry.sqlite`. Use existing typed preload only.
5. Full Windows CI: tests, typecheck, Electron/React build, real GUI+SQLite and Chrome CDP smoke. Ledger evidence.
6. No intermediate installers, merge or Stable release. True cross-restart task replay, per-site trend alerts and V2–V4 functionality are outside this slice.
