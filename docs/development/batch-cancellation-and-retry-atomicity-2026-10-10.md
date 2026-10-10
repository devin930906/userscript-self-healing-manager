# Batch Cancellation Truth and Atomic Retry Dispatch — 2026-10-10

## User impact and verified defects

Two in-memory batch lifecycle races could undermine the trustworthiness of
automatically reported status:

1. `collectPagedDomDiagnosis` uses a cooperative `BatchPauseGate` alongside
   a separate cancellation callback. When `waitUntilReady()` refused the
   next read because the gate was canceled but `isCancelled()` was still
   false, it returned **partial** results with `cancelled:false`.
   A gate canceled from the progress callback on the last page could
   likewise return a false `cancelled:false`. The desktop UI consumes
   this field to decide whether it says “canceled” or “diagnosis finished”.
2. `retryFailed()` requeued failures one by one through `update()`, which
   synchronously calls a progress callback **while the queue was not active**.
   That callback could start a competing `run()` against the partially
   rearmed queue, leading to out-of-order dispatch and failure of the
   intended retry invocation. The queue has authorization- and
   source-hash-gated callbacks, so avoiding this reentrancy matters.

## Changes

- `packages/scan-service/src/paginated-dom.ts` now treats the cooperative
  gate's `isCancelled` state as an independent cancellation source.
  A negative `waitUntilReady()` records an explicit interruption, and
  the final `cancelled` field is true if the gate refused work, the
  gate is canceled, or the independent callback says canceled.
  It stops before any subsequent CDP page request. Existing completed
  read-only evidence remains visible as *partial*, not a full success.
- `packages/scan-service/src/repair-task-queue.ts` now rearms all eligible
  failures without invoking intermediate progress observers. Then `run()`
  acquires its `active` lease before emitting the first rearmed snapshot.
  A callback attempting a second `run()` receives the existing
  concurrent-run rejection and cannot seize half of the retry batch.
  Previously completed, denied, or revoked tasks are not reauthorized.
  Per-task `beforeDispatch` source-integrity checks are unchanged.

## TDD and regression evidence

- Test-first commit [`3995a8c9`](https://github.com/devin930906/userscript-self-healing-manager/commit/3995a8c9c9b8868fbc6ce11952c36e3dd019bde0)
  added four safety regressions. [RED Node contracts #38045904129](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045904129):
  **three failing scenarios** on the old code (cancelled gate with stale
  callback, cancelled final-page callback, reentrant retry). One existing
  authorization revocation scenario was already protected, and passed.
- Implementation commits [`dec666b3`](https://github.com/devin930906/userscript-self-healing-manager/commit/dec666b3b22434e37dd07ed8178cb1da21f4ec54)
  and [`766fd834`](https://github.com/devin930906/userscript-self-healing-manager/commit/766fd8340d9f3006c60b34a09ff5305ea7f4ef61).
- [GREEN Windows Development CI #38045988557](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045988557):
  **803 tests / 802 PASS / 1 SKIP / 0 FAIL**. Strict TypeScript,
  Electron security boundary, actual Windows Electron GUI/SQLite,
  real Chrome CDP (51-script batches, synthetic repair/rollback),
  Chrome for Testing 155.0.8059.39 with an isolated synthetic MV3
  extension fixture all passed. No installers.
- [GREEN Node contracts #38045988551](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045988551):
  SUCCESS.

## Scope and Stable blockers

These changes make the queued/paused/canceled status more reliable, but
the queue remains an **in-memory foundation**, not a cross-process
durable autonomous repair service. A cancellation cannot roll back
a write already in progress. All real file writes still need explicit
authorization and independent pinned hash verification.

Real production V2 interactions, named V3 functional contracts, genuine
Tampermonkey/GM_* V4 runtime validation, the owner's exact Windows 10
portable Chrome 155.0.8059.40, three independently verified final
distribution variants, and RG-01..09 remain unfinished. Keep version
`0.1.0-alpha.5`, draft PR #2, and no intermediate installers/Stable
tag/release/main merge.
