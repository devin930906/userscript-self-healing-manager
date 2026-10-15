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
- [ ] Merge original RG-07 and FR-024 histories into original FR-014/RG-06 task candidate without dropping either feature; resolve conflicts and validate all focused/full checks.
- [ ] Obtain fresh independent review, fix important findings using TDD, push original task PR branches with a head lease and check exact remote CI.

## Execution ledger

- Baselines refreshed: integration b39be86; PR #271 2ccd632; PR #269 0d87cc9; PR #270 8edcb4b; PR #272 eefd9d6; PR #273 7f3f856. Existing FR-014/RG-06 fixes are preserved, not repeated. Official GM cold restart remains blocked; all RG gates remain OPEN.
- Preflight: one new required TypeScript API input; consumers are trusted Main, focus unit tests and the owned Chrome smoke only. Existing Renderer/Preload interface does not change. Existing append-only continuation histories must all survive integration.

- Task 1 RED: 15 focused tests, 13 pass / 2 fail: actual Missing expected rejection for a changed loader and missing Main handoff. Test commit b859a67. GREEN 15/15; full suite 1595 total / 1593 pass / 2 environment skips / 0 fail; lint/typecheck/build/compiled production boundary PASS. Main now supplies afterPrompt as required approvedDocument. Existing hidden/visible/replay tests supply the same confirmed document. The Windows smoke includes a real fresh-loader stale-approval rejection before action socket creation; local syntax check PASS, actual Windows result must be checked remotely.
