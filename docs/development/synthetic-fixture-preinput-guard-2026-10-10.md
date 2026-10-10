# Synthetic CDP Fixture Pre-Input Navigation Guard — 2026-10-10

## Narrow problem

The test-only Chrome fixture interaction harness resolved a local button, read
its attributes and box geometry, then immediately dispatched mouse press/release
through CDP. A page could reload or navigate *after the first document identity
check but before dispatching Input*. Confirming its identity only after the
mouse action would detect navigation too late to prevent unintended input.

This module is confined to `scripts/local-fixture-interaction.ts`. The
Electron Main, Preload and Renderer bundles **must never import or expose** this
synthetic click capability. This iteration is not a production V2 interaction
engine and does not authorize input on live user sites.

## Change

1. Before the first `Input.dispatchMouseEvent`, run the existing trusted
   `confirmPageIdentity` CDP frame-tree check again and compare
   target ID, exact URL, main frame ID, loader ID, subframe count and supported
   child context against the baseline with `assertStablePageDocument`.
2. Refuse the input if the document identity changed, page confirmation
   fails, or the operation already timed out. A changed **same-URL loader**
   is explicitly not accepted as the original fixture page.
3. The message handler now tracks the last processed CDP response ID.
   Duplicated box-model results cannot cause a second synthetic press/release,
   including while the pre-input asynchronous identity check is outstanding.
4. The original after-input frame identity and synthetic marker assertions
   remain in place. No arbitrary userscript execution, external domain,
   Tampermonkey installation or production-app CDP Input API was added.

## TDD and Windows evidence

- [RED Node CI #38043841696](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043841696):
  **3 new tests failed before implementation**, proving missing pre-input
  identity check and allowing changed frame/loader/URL after reading geometry.
- [Implementation commit `00f46b1`](https://github.com/devin930906/userscript-self-healing-manager/commit/00f46b1da523866a5cf708de7aa1943f7f115476):
  pinned identity before dispatch and duplicate CDP reply rejection.
- [Duplicate response regression `b82ee298`](https://github.com/devin930906/userscript-self-healing-manager/commit/b82ee29866fe966d69fc8c03aafeb45d50eb34fb):
  the fixture emits a repeated response and asserts exactly one press/release.
- [GREEN Windows Development CI #38043971932](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043971932):
  **786 tests / 785 PASS / 1 SKIP / 0 FAIL**. Strict TypeScript,
  Windows Electron GUI/SQLite, compiled app execution-boundary check,
  real Chrome CDP and official Chrome for Testing 155.0.8059.39 with its
  isolated synthetic MV3 extension fixture all passed.
- [GREEN Node contracts #38043971935](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38043971935):
  SUCCESS.

## Limits and release status

There is still a theoretical navigation race after the last frame check and
before CDP Input; checking once is not an OS/browser atomic guard. The test
harness only runs against a disposable loopback fixture and must never be
presented as a proof of safe interaction with an arbitrary live website.

Production-safe V2, true named functional V3, genuine Tampermonkey/GM_* V4,
the owner's Windows 10 x64 and exact portable Chrome 155.0.8059.40, all
three independently tested final Windows distributions, and every
RG-01..09 gate remain unfinished. PR #2 stays Draft and the version stays
`0.1.0-alpha.5`. No intermediate installer, main merge, tag or Stable release.
