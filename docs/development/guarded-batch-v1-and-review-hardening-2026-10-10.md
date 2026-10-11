# Guarded Batch V1, Complete Review and Time-limited Approval — 2026-10-10

## Objective

Extend the approved 2–8 selector batch repair into a **fail-closed**
post-apply verification and whole-revision rollback workflow, without
executing userscripts, triggering real website actions, installing into
Tampermonkey or incorrectly promoting synthetic evidence to V2/V3/V4.

## New behavior

### 1. Whole-batch V1 retention guard

- `guardAppliedManagedBatchRevision` requires a separately approved
  revision, 2–8 strictly increasing original selector indexes under 50,
  distinct valid predecessor and applied SHA-256 values, and explicit
  verify/restore dependencies.
- **Every changed selector** must pass an independently named
  `BATCH:<scriptId>:IDX_<index>` V1 contract: unique target, two
  observations, one continuously pinned DOM node, no elevated V2/V3/V4,
  no claimed functional execution or manager injection.
- When any result is missing, contradictory, non-unique, interrupted, or
  inconsistent, the guard **restores the entire predecessor**. Failed
  compare-and-swap rollback returns `rollback-blocked` and an unknown
  active hash; it never pretends the rollback succeeded.
- Main derives selectors from the current authorized scan and reads
  them back from the already-activated immutable managed revision;
  neither selector lists nor rollback hashes originate from renderer IPC.
  Chrome target, userscript URL scope, page frame/loader identity and
  scan session are checked at trusted boundaries.
- Separate Chinese UI actions preserve the distinction between plain
  approved batch save and **approved save + V1 guarded verification**.
  Neither performs a mouse click, script execution, automatic
  Tampermonkey install or arbitrary website mutation.
- The same active revision is CAS-protected against unrelated external
  edits and cannot be overwritten by an out-of-date batch guard.

### 2. Complete, privacy-scoped review

- The initial consolidated preview included only the source's leading
  600 characters, potentially omitting every actual patch in a long
  userscript. That has been replaced by a complete per-change review
  list: **original selector index, AST method, line, column, old literal,
  and new literal** for all 2–8 proposed changes.
- Repeated identical selector text is disambiguated by its original AST
  location. Unrelated source text is not dumped to the renderer.
- The UI renders each change with its numbered source location, the full
  list plus the existing original/proposed hashes. Immutable archive
  replay still verifies the actual AST byte spans before write.

### 3. Stale approval prevention

- `ProposalApprovalGate` now expires reviews after **10 minutes** by
  default and enforces 1–30-minute bounded TTL configuration. Clock
  rollback invalidates, rather than extending, existing receipts.
- Time-expired approvals are discarded before the bounded 100-proposal
  capacity check. Approval remains tied to the original scan ID and
  is consumed after one apply.
- Trusted Main rechecks the approval age **again immediately before**
  the approved batch and guarded single-repair activation, following
  potentially slow browser and pinned source observations. Old UI
  previews require a new review.

### 4. Correct active-path display

- `revision-<hash>.user.js` is an immutable **archive**, not the active
  `current.user.js` managed file. All four managed apply IPCs now
  return an explicit `activePath` of the actual activated
  `Data/managed/<scriptId>/current.user.js` rather than misleadingly
  displaying the immutable archive as “current”.
- The renderer uses `activePath` only where it displays the active
  managed copy; file-history and archive fields keep their separate meaning.

## Automated evidence

- RED batch V1 guard test:
  [Node contract #38040983936](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38040983936).
- First guarded batch GREEN:
  [Windows Development CI #38041259778](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38041259778):
  757 total / 756 pass / 1 skip / 0 fail. Actual Windows-hosted external
  Chrome and isolated official CFT 155 both confirmed that two repaired
  selectors pass independently and an intentionally *partially* repaired
  batch is rolled back as a whole.
- Subsequent approval-review, expiration, reauthorization and active-path
  tests were added **before** their corresponding production changes.
- Latest full GREEN:
  [Windows Development CI #38041856238](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38041856238):
  **766 total / 765 pass / 1 skip / 0 fail**. Locked Node dependencies,
  TypeScript checks, Electron build, independent compiled production JS
  restriction scan, real Windows Electron GUI/SQLite, real Chrome CDP
  functional smoke and CFT 155 synthetic MV3 extension smoke completed.
- [Node contract #38041856173](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38041856173)
  passed for the same code SHA.
- No preview installers, intermediate binaries, release tags or merges.

## Still blocked for final Stable

- Real Tampermonkey / GM_* V4 manager execution and
  named production V3 functional tests (the real Chrome tests above are
  explicitly **synthetic, test-only**; the desktop itself never evaluates
  an arbitrary userscript).
- Safely user-authorized production V2 actions with a site-specific
  non-destructive contract; DOM-only V1 is not clickability.
- User's specified Windows 10 x64 and portable Chrome 155.0.8059.40
  executable (hosted runner Chrome for Testing 155.0.8059.39 is different).
- Independently validated three **final** release distributions and
  RG-01..09/QA-061..074, release signing/security review as applicable.

Release state remains `0.1.0-alpha.5` and
[PR #2](https://github.com/devin930906/userscript-self-healing-manager/pull/2)
remains **Draft**, with no prematurely claimed Stable release.
