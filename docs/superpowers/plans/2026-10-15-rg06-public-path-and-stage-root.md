# RG-06 public recovery paths and newly claimed stage root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve existing lexical recovery path guards at public entrypoints and bind newly created offline stages to their originally claimed directory.

**Architecture:** Pass original caller paths to the existing recovery boundary guards before normalized paths are used for filesystem operations. Reuse the independent audit's directory identity check for newly created stages, before final inventory inspection and marker publication.

**Tech Stack:** Node 24, TypeScript, node:test, real temporary SQLite databases and filesystem fixtures.

**Spec:** `AGENTS.md`, `docs/security/ai-and-threat-model.md`, `docs/requirements/product-requirements.md` (NFR-003/011, FR-047), existing recovery-directory and recovery-destination boundary contracts.

## Global Constraints

- Only synthetic temporary files in tests; never activate staged recovery or modify real Data, scripts or Chrome profiles.
- Preserve ordinary names beginning with two dots; reject actual parent-traversal components, including those hiding a symlink/junction.
- Reject unsafe inputs before claiming output paths or reading recovery payloads.
- Incomplete output remains for inspection; no automatic cleanup or restore.
- Native-stat rechecks are bounded optimistic guards, not cross-process transactions or Win32 FileIdInfo certification.
- User explicitly authorizes continuous execution and pushes; no plan-confirmation pause. Required manager CI remains a separate release gate.

## Review Focus

- Core and managed export source/destination paths containing parent traversal.
- Standalone core and managed audit paths whose linked ancestor could be erased by resolve().
- Offline stage source, active-Data and destination inputs, plus both independent-audit paths.
- Newly created stage replaced by a byte-identical directory before completion.
- Positive unchanged stage, empty managed inventory, ordinary dot-prefixed names and preserved active/source bytes.

### Task 1: Preserve raw path boundaries

**Files:** `packages/repair-workflow/src/core-recovery.ts`, `managed-export.ts`, `core-recovery-stage.ts`; new `tests/integration/core-recovery-public-path-boundary.test.ts`.
**Interfaces:** Retain all six public recovery APIs and existing central guards; change which original paths reach those guards.

- [x] Write real filesystem tests for every public source/destination/audit field and a linked-ancestor parent traversal; require rejection and no output claim.
- [x] Observe expected missing rejection RED on existing normalized-before-guard code.
- [x] Route original paths through existing guards; retain normal resolved paths only for validated operations.
- [x] Run focused tests, complete suite, lint/typecheck and build; commit verified change.

### Task 2: Bind stage creation directory identity

**Files:** `packages/repair-workflow/src/core-recovery-stage.ts`, `tests/integration/core-recovery-stage-last-fence.test.ts`.
**Interfaces:** Preserve stage receipt and test hook; share the existing directory identity semantics between creation and independent audit.

- [ ] Fault-inject a replacement directory containing byte-identical staged files at `beforeFinalMarker`; require explicit directory-identity rejection and absent completion markers in both roots.
- [ ] Observe RED; pin the claimed directory before copying and recheck before final file audit and completion marker.
- [ ] Verify all unchanged-stage/independent-audit scenarios and full suite; commit.

### Finish

- [ ] Independent Superpowers review; fix important findings through RED/GREEN tests.
- [ ] Publish to original Draft PR #269 with non-force branch-head comparison and preserve latest remote work.
- [ ] Check exact remote Windows/Ubuntu and Development jobs; record specific successes and remaining genuine GM/Windows release blockers without promoting Stable.

## Execution ledger

- Start: integration `b39be86`, latest RG-06 Draft PR #269 `633c33a0e9f954796ed22d83578207c4b280f71e`; prior SQLite reopen fix `9fa0012` already present and not repeated. Exact task continuation/contracts SUCCESS, overall Development FAIL due official manager cold restart.
- Prior FR-014 `7f67061` is already published/validated and is not reimplemented. Official upstream latest release remains v2.49.0 (queried GitHub release API); no newer official fixed release can simply replace the pinned version.
- Pre-flight: both tasks touch the stage module, but Task 1 only changes raw preflight arguments and Task 2 shares an existing directory identity fence. Keep interfaces and release boundaries unchanged.

- Task 1 complete: 12 public-entrypoint regressions observed RED (missing rejection), including a genuine symlink/junction parent-resolution differential. Focused GREEN 26/26; complete suite {'tests': 1599, 'pass': 1597, 'fail': 0, 'skipped': 2}; strict lint/typecheck and build/compiled production boundary PASS. Existing central guards remain unchanged; original caller paths now reach them.
