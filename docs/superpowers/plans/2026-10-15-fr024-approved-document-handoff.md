# FR-024 native-approved document handoff and product integration

> Execute inline with Superpowers executing-plans and TDD. Continuous execution and pushes are already authorized by the user.

**Goal:** Prevent a same-URL replacement document from inheriting native focus consent, then integrate the existing FR-024 and RG-07 work with the latest FR-014/RG-06 product candidate.

**Root cause:** Main compares the document before/after its native prompt, but runApprovedControlFocus starts a separate identity baseline. A reload between the latter two checks is accepted as a new baseline. Scan/source revocation guards do not close this document-identity handoff.

**Architecture:** Require the Main-owned approvedDocument identity in the focus API, compare it with the first live confirmation before opening the action socket, and retain the existing pre/post-action document and synchronous source authorization guards. Do not expose document tokens to Renderer or reports.

**Constraints:** Follow AGENTS.md, preserve existing native confirmation and default cancellation, no user-script evaluation or real profile mutation. Real Chrome tests use only the owned disposable localhost fixture. This is bounded optimistic validation, not an atomic DOM transaction. RG-05 official GM and final Windows release gates remain mandatory and unchanged.

## Tasks

- [x] Add a same-URL changed-loader regression and Main handoff wiring regression; observe RED on original PR #272 eefd9d6.
- [x] Require approvedDocument, bind trusted Main afterPrompt to execution, verify unchanged approval and stale-approval denial; run complete suite/typecheck/build.
- [x] Extend the real Windows Chrome fixture with a fresh-loader stale-consent rejection, retaining visible/hidden/replay checks.
- [x] Merge original RG-07 and FR-024 histories into original FR-014/RG-06 task candidate without dropping either feature; resolve conflicts and validate all focused/full checks.
- [ ] Obtain fresh independent review, fix important findings using TDD, push original task PR branches with a head lease and check exact remote CI.

## Execution ledger

- Baselines refreshed: integration b39be86; PR #271 2ccd632; PR #269 0d87cc9; PR #270 8edcb4b; PR #272 eefd9d6; PR #273 7f3f856. Existing FR-014/RG-06 fixes are preserved, not repeated. Official GM cold restart remains blocked; all RG gates remain OPEN.
- Preflight: one new required TypeScript API input; consumers are trusted Main, focus unit tests and the owned Chrome smoke only. Existing Renderer/Preload interface does not change. Existing append-only continuation histories must all survive integration.

- Task 1 RED: 15 focused tests, 13 pass / 2 fail: actual Missing expected rejection for a changed loader and missing Main handoff. Test commit b859a67. GREEN 15/15; full suite 1595 total / 1593 pass / 2 environment skips / 0 fail; lint/typecheck/build/compiled production boundary PASS. Main now supplies afterPrompt as required approvedDocument. Existing hidden/visible/replay tests supply the same confirmed document. The Windows smoke includes a real fresh-loader stale-approval rejection before action socket creation; local syntax check PASS, actual Windows result must be checked remotely.

- Task 4 complete: local merge commits 360bd80 and 0bb6664 preserve original FR-014/RG-06, FR-024 and RG-07 ancestry. Renderer import conflict retains both scene types and safeDomReportPageOrigin; continuation conflict retains both histories. Complete combined suite initially 1652 total / 1650 passed / 2 environment skips / 0 fail; lint/typecheck/build/compiled production boundary PASS; fixed Chrome smoke syntax PASS.
- Independent integration review: reviewer ran 83 focused tests, all passed/no skips. No scene/recovery/privacy regression found, but identified an Important existing FR-024 initial-confirm deadline gap: timeoutMs:100 with 180ms first identity confirmation still sent DOM.focus. Review scope is this development integration, not full release security certification.
- Final fix-pass TDD RED: two regressions actually failed with Missing expected rejection: initial identity confirmation beyond timeout, and blocked event loop returning from final pre-action confirmation before timer callback delivery. Minimal production fix uses one monotonic absolute deadline before the first confirmation, checks before action socket creation and each command, and fences both sides of subsequent document confirmations. No retry or receipt upgrade. Focus tests GREEN 17/17. Full final suite and remote exact-head evidence recorded in continuation checkpoint after completion.
- Final local verification: 1654 total / 1652 pass / 2 environment skips / 0 fail; lint/typecheck/build/compiled production boundary and Chrome smoke syntax PASS; pre-existing SBOM 290 components/445 edges validated. No rulings or deferred minor findings; the sole Important review finding was fixed through actual RED→GREEN. Remote publication/CI remains pending.
