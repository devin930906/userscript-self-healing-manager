# Guarded V1 active managed revision post-check — 2026-10-10

## Defect and scope

An authorized single or batch managed repair could pass two read-only Chrome
DOM observations and immediately return `retained-v1`, despite a separate
local process modifying `Data/managed/<scriptId>/current.user.js` during
those awaited CDP calls. The prior browser checks re-read the selector from
an immutable archive, but after finishing they did not require a final
integrity check on the *actually activated* managed current file.

This iteration does not run userscripts or click websites. Its purpose is to
prevent false retention results; it does not certify V2, V3, V4 or real
Tampermonkey/GM_* behavior.

## Implemented fail-closed contract

1. Both `guardAppliedManagedRevision` and
   `guardAppliedManagedBatchRevision` now require a separate, trusted
   `confirmActiveHash(): Promise<string|null>` dependency.
2. Only after all independently approved two-sample unique-node V1 DOM
   contracts pass does the guard run this *post-verify* callback.
3. Electron Main first revalidates the authorized scan and the Chrome
   top-document frame/loader, then calls
   `inspectManagedIntegrity({managedRoot:dataRoot,scriptId})` directly.
   It never accepts a path, current hash, or replacement proof from renderer
   IPC. Main confirms the scan and Chrome page identity again before returning.
4. The integrity reader verifies the managed directory hierarchy, absence
   of an active writer lock and orphan stage, immutable archive hashes, and
   the active current file's pinned SHA-256. Only `status:'healthy'` produces
   a candidate current hash. Retention requires that this hash is exactly
   the already approved applied revision SHA-256.
5. If the check is missing, throws, is inconclusive or disagrees, the guard
   attempts a whole-revision predecessor rollback. Its existing compare-and-
   swap restore requires the active file to still match the applied hash.
   Changed third-party edits are therefore not silently overwritten. A
   blocked CAS rollback returns `rollback-blocked` and `activeHash:null`;
   the program does **not** claim a successful retention or rollback.
6. A failed DOM proof never calls the positive-path active-hash confirmation;
   it instead follows the existing guarded restoration path.

## Test-first and integration evidence

- [RED Node 24 contracts #38043151962](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043151962):
  **7 newly introduced failures** before the code change. Regression
  coverage includes both guard variants, missing/unavailable verification,
  changed revisions, and trusted Electron Main API wiring.
- Initial implementation passed Node tests, but the full real-browser
  smoke revealed a required interface update in three synthetic Chrome
  scenarios. [Failed Windows CI #38043292122](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043292122)
  identified `Invalid approved managed V1 safety guard`; this was fixed
  without weakening the contract. The Chrome smoke now uses the same genuine
  filesystem integrity reader as Main, not a mocked value.
- Real temporary-folder filesystem tests cover unchanged retained
  revisions; a concurrent external edit after the single V1 proof; a
  concurrent edit after the second selector of a fully passing batch; and
  an orphan cooperative write lease.
- [GREEN Windows Development CI #38043416373](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043416373):
  **782 tests / 781 passed / 1 skipped / 0 failed**, strict TypeScript,
  compiled Electron security boundary, actual Windows Electron/SQLite/React,
  real Chrome CDP, synthetic repair/rollback, Chrome for Testing
  155.0.8059.39 isolated CDP and MV3 extension fixture all succeeded.
- [GREEN Node contracts #38043416324](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043416324):
  SUCCESS.
- Associated implementation and smoke fixture commits:
  [`ddce8821`](https://github.com/devin930906/userscript-self-healing-manager/commit/ddce88217afe27b4152fba43d832ffad412db307),
  [`7506855a`](https://github.com/devin930906/userscript-self-healing-manager/commit/7506855a10c6f0ba5a32ea3d518c36d52f14ad4d),
  [`bbe74076`](https://github.com/devin930906/userscript-self-healing-manager/commit/bbe74076841f494c0a551d4f79e6438b474bd055).

## Boundaries and Stable gate

A final read narrows the time-of-check gap but is not an atomic hostile-process
transaction. A sufficiently privileged external writer may still change the
file immediately after confirmation; the cooperative writer lease is not a
kernel-enforced lock against every external process. The tool must never
promise immunity against such races or silently overwrite external edits.

All active script changes remain in independently versioned *managed copies*;
the original .user.js, Chrome profiles and Tampermonkey storage are untouched.

Production interaction V2, named real-functional V3, real Tampermonkey and
GM_* V4, the user's exact Windows 10/portable Chrome 155.0.8059.40
environment, independent final three-edition Windows distributions and all
RG-01..09 remain unfinished. The version stays `0.1.0-alpha.5`, PR #2
remains Draft, and no intermediate installers or Stable release were made.
