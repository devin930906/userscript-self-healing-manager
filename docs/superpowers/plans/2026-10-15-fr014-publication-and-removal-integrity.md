# FR-014 publication and removal integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject changed staging bytes and revoked or stale native removal consent before saving scenario configuration.

**Architecture:** Keep the existing bounded JSON registry, cooperating write lease, optimistic target identity check and exclusive first publication. Pin each new staging file on its open descriptor and verify its digest before publication. Bind removal to the exact Main-confirmed record and recheck trusted scan/source authorization at its commit boundary.

**Tech Stack:** Node 24, TypeScript, node:test, Electron Main.

**Spec:** `docs/security/ai-and-threat-model.md`, `docs/requirements/product-requirements.md`, `AGENTS.md`; existing FR-014 implementation in Draft PR #271.

## Global Constraints

- Never execute userscripts or access real Chrome profiles; all filesystem tests use disposable synthetic data.
- Preserve the existing target on rejected writes and never silently discard an unknown replacement staging file.
- Retain byte/count limits, scope validation, explicit native removal consent and no V2/V3/V4 certification.
- These checks are not cross-process atomic compare-and-swap or native Win32 FileIdInfo certification.
- Follow the user's continuous-execution instruction: implement and push without a plan approval pause. Do not merge while required Development CI remains blocked by RG-05.

## Review Focus

- Same-size staging corruption must not become committed scenario data.
- A byte-identical replacement file must not inherit staging ownership.
- A failed write must preserve the original registry and clean only its own temporary file.
- A record changed after native confirmation must not be deleted under old consent.
- A scan/source permission revoked during deletion I/O must abort without removing persisted scenarios.

### Task 1: Pin and verify staging publication

**Files:** `packages/candidate-engine/src/site-test-cases.ts`, `packages/candidate-engine/test/site-test-cases-concurrent-write.test.ts`.

**Interfaces:** Retain `createSiteTestCase`; internal staging uses open-descriptor BigIntStats and SHA-256 with existing `readPinnedRegularFile`.

- [x] Write behavior regressions injecting same-size edits and byte-identical pathname replacements at the existing `beforePublish` boundary; assert rejection and unchanged target bytes.
- [x] Run the focused test and observe expected missing rejection (RED).
- [x] Capture staging descriptor identity after writing; before publication require the same pinned file and exact expected digest. Cleanup must avoid unlinking an unrelated replacement.
- [x] Run focused tests, repository tests, typecheck and build (GREEN), then commit.

### Task 2: Bind removal to native consent through final I/O

**Files:** `packages/candidate-engine/src/site-test-cases.ts`, relevant candidate-engine tests, `apps/desktop/src/main/index.ts`, desktop removal wiring test.

**Interfaces:** `removeSiteTestCase` additionally consumes the exact `expected` record and internal `beforeFinalWrite` callback. Main supplies the displayed native-confirmed record and a trusted scan/source recheck; renderer cannot supply callbacks.

- [x] Add behavior tests for stale record rejection, absent expected-record rejection and precommit authorization revocation; include a successful unchanged-record removal.
- [x] Observe RED, then enforce the expected record and forward the final authorization callback through `persist`.
- [x] Wire Main and verify source/scan recheck after the native dialog and inside the final persistence gate.
- [x] Run focused tests, full tests, lint/typecheck, build and production boundary check, then commit.

### Finish

- [ ] Request independent code review and fix important findings with RED/GREEN tests.
- [ ] Push to original PR #271 task branch without force, after checking its remote head; reconcile append-only documentation without losing either history.
- [ ] Check exact GitHub CI, record real passes/failures and external Stable blockers in the continuation document. Never infer Stable from partial tests.

## Execution ledger

- Baseline: integration `b39be8619be486d48389ae306129e02f5acd17ae`; FR-014 task `7dab2aebc2fb978c07c04a82e0249dbbdf8239f4`. Exact integration Development FAIL, continuation/contracts SUCCESS. Latest RG-05 task `7f3f856a0fdaac46fb4ce2f6457b91bd3dc988ed` Windows verify SUCCESS, official GM restart FAIL; runtime ID present but onMessage/addListener absent after restart, fixed TypeError signature matches official wrapper. Do not repeat previous headful/data.info/download experiments.
- Pre-flight: Task 2 uses the same persistence gate as Task 1; preserve the final callback before the new staging integrity check. Deletion tests must not mistake synthetic cleanup for native consent.

- Task 1 complete: three new behavior tests observed RED (missing rejection); focused GREEN 11/11, full `npm test` {'tests': 1600, 'pass': 1598, 'fail': 0, 'skipped': 2}, strict typecheck/build and compiled production boundary PASS. Exact pinned descriptor identity + operation SHA-256 required before publication; foreign replacement staging file preserved.

- Task 2 complete: stale label/URL/state, absent consent record and early revocation regressions observed RED; focused GREEN 24/24. Independent Superpowers review found one important remaining authorization timing bug during final awaited reads. Two additional deterministic microtask regressions observed RED and passed after the shared final synchronous guard, with a real ScanSessionCoordinator + setImmediate regression also GREEN. Main supplies guards to both create and remove. Full suite 1610 tests / 1608 pass / 2 environment skips / 0 fail; lint (strict typecheck), build and compiled production boundary PASS.
- Review: independent reviewer fr014_review; exact-record and staging ownership checks accepted within documented optimistic guarantees. Important timing finding fixed in this pass. Test limitations retained: native dialog wiring is source-contract coverage; same-size tampering does not isolate the SHA check from native metadata checks; partial OS write failure not fault-injected. No claim of complete release security review.
- Local tooling observation: npm 11 SBOM uses checkout directory basename for root component name. Initial checkout named repo caused strict root-name rejection; rename the checkout to userscript-self-healing-manager and rerun unmodified generation/validator rather than weakening the validator. npm audit --audit-level=high exits 0 but reports 8 moderate development-tool transitive findings (sprintf-js chain); no unreviewed forced downgrade performed.
