# Desktop IPC/OS/CDP Error Redaction — 2026-10-10

## User-facing privacy bug

The live Electron React renderer previously interpolated `String(error)` or
`String(e)` into user-visible `setError` / `setWatchError` messages across
**42** error paths. IPC errors may contain private local userscript filenames,
Windows user profile paths, Chrome page URLs with query tokens, CSS selectors,
SQLite database locations or stack traces. Such data must not be displayed
or copied from untrusted thrown values by default.

## Implemented safeguard

- Added `apps/desktop/src/renderer/safe-error.ts` exporting
  `summarizeSafeDesktopError(error:unknown)`.
- The helper returns a fixed, non-sensitive Chinese message for unknown
  exceptions; it **never calls `String(error)`** or includes arbitrary
  exception message content in the UI.
- An exact allowlist recognizes a few bounded, non-secret Chrome CDP
  transport conditions: page identity timeout, locator/snapshot timeout,
  and closed/disconnected socket. It optionally unwraps only the syntactically
  exact known `usshm:<method>` Electron IPC wrapper and then still requires
  an **exact error code**; appended strings, unrelated remote methods and
  spoofed partial matches do not pass.
- Replaced all 26 `String(error)` and 16 `String(e)` expressions in
  `apps/desktop/src/renderer/App.tsx`. This includes import,
  SiteAdapter, browser profile, scan, CDP, managed repair, history,
  rollback, backup and export failure paths.
- No IPC permission was added. No userscript, page JavaScript, Chrome
  profile or original script was executed or modified. Sensitive data
  remains local rather than shown as a verbose error string.

## TDD and CI

- RED [Node contracts #38044973023](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38044973023):
  newly added privacy tests failed before implementation because the
  dedicated safe-error module was missing.
- Regression tests verify sensitive paths, cookies/token-bearing URLs,
  selector fragments, custom thrown objects and primitives never
  appear in the returned text; exact known CDP timeouts remain helpful;
  spoofed concatenated text is rejected; source inspection disallows
  direct stringification of thrown exceptions in the production UI.
- GREEN [Windows Development CI #38045061351](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045061351):
  **794 tests / 793 passed / 1 skipped / 0 failed**, TypeScript,
  compiled production boundary, actual Windows Electron GUI and SQLite,
  actual Chrome CDP and Chrome for Testing 155.0.8059.39 isolated MV3
  extension fixture passed.
- GREEN [Node contracts #38045061398](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045061398):
  SUCCESS.
- Main code changes:
  [`b675d093`](https://github.com/devin930906/userscript-self-healing-manager/commit/b675d0935805c499539e720cf46c901f3eb9da75)
  (safe formatter) and
  [`2e6ff9de`](https://github.com/devin930906/userscript-self-healing-manager/commit/2e6ff9defb6de92d6b7525544e337cc7e049231d)
  (UI migration).

## Boundaries / Stable blockers

This is UI error redaction, not a claim that every diagnostic report
or log has been formally privacy audited. No production V2/V3 function
or genuine Tampermonkey/GM_* V4 execution was proven. The user's exact
Windows 10 + portable Chrome 155.0.8059.40, all three completed
formal release distributions, and RG-01..09 remain unverified. Keep
`0.1.0-alpha.5`, PR #2 Draft and no intermediate installers, main merge,
Stable tag or GitHub Release.
