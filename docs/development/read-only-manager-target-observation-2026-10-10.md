# Read-only Userscript Manager Extension Target Observation — 2026-10-10

## Why this matters for Phase 7 / V4

The desktop already exposed a *static* inventory of GM/GM_* references, but
had no independent on-demand observation of whether the selected,
CDP-verified Chrome session even had a visible background target associated
with a known userscript manager. Such evidence can help users diagnose
wrong-profile problems, but **cannot prove** that an extension is installed,
enabled, injected into a particular tab, or able to service any GM_* call.

## Source of identity

Only fixed Chrome extension IDs are recognized:

- Tampermonkey Stable `dhdgffkkebhmkfjojejmpbldmpobfkfo` and Beta
  `gcalenpjmijncebpfijmoaglllgpjagf`: official project listing,
  https://github.com/Tampermonkey/tampermonkey
- Violentmonkey `jinjaccalgkegednnccohejagnlnfdag`:
  https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag
- Chrome DevTools Protocol documented browser-scoped read-only
  `Target.getTargets` and `Browser.getVersion`:
  https://chromedevtools.github.io/devtools-protocol/tot/Target/

The IDs are not guessed based on site titles or DOM. Other extensions,
including the project's MV3 synthetic fixture extension, are not accepted
as a real manager observation.

## Implemented feature

1. `packages/cdp-client/src/manager-targets.ts` adds an isolated,
   read-only, bounded browser-level CDP request: first require exact live
   `Browser.getVersion` product identity matching the trusted status,
   then send **only `Target.getTargets`**. The browser WebSocket must be
   an authenticated loopback `/devtools/browser/<id>` endpoint on port 9223.
2. A fixed 5-second default timeout and bounded 512KB wire payload,
   512 target records, unique target identities and URL limits apply.
   Bad or duplicate metadata rejects the entire observation; an invalid
   browser identity cannot be interpreted as manager presence.
3. Only `service_worker` / `background_page` targets with an exact
   `chrome-extension://<official-id>/...` prefix count as *observed
   background targets*. A user webpage, lookalike URL, unexpected extension,
   title string, or synthetic MV3 fixture is not sufficient.
4. The result exports **only** fixed, non-sensitive manager labels,
   `level:'extension-target-observation-only'`,
   `inactiveTargetsMayExist:true`, `V4:'not-configured'` and
   `managerVerified:false`. It does not return full Chrome target URLs,
   browser history, titles or extension internals.
5. The Electron Main endpoint `usshm:manager-targets` requires a trusted
   sender and explicit `{approved:true}`, calls
   `getVerifiedChromeStatus({port:9223})` again, and resolves its own
   browser socket. The Preload allows only this named action, not raw
   arbitrary CDP commands. The desktop browser panel now has an explicit
   read-only button and clearly states that no observed target **does
   not mean the manager is not installed**.
6. Does not wake/attach to workers, open `chrome://extensions`, run
   page or userscript JavaScript, read user script sources, install Chrome
   extensions, inspect storage, or access private GM APIs.

## TDD and Windows evidence

- RED [Node contracts #38046453846](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38046453846):
  new source module and desktop wiring absent. The initial fake socket
  required a Node-24-compatible TypeScript fixture correction, recorded
  as [`38a50e86`](https://github.com/devin930906/userscript-self-healing-manager/commit/38a50e86c3ce0f657f68bad2eb63c0b586336bb3).
- First implementation exposed two mismatches in
  [Node #38046644036](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38046644036):
  browser identity mismatch messaging was over-generic and a negative
  test reused a duplicate `targetId`. Fixed the former with a bounded
  non-sensitive specific error and corrected the malformed test fixture;
  duplicate target IDs remain rejected.
- GREEN [Windows Development CI #38046716725](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38046716725):
  **810 tests / 809 passed / 1 skipped / 0 failed**. Strict TS,
  Electron compiled security boundary, real Windows GUI/SQLite,
  real Chrome CDP and Chrome for Testing 155.0.8059.39 synthetic MV3
  extension fixture passed.
- GREEN [Node contracts #38046716727](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38046716727):
  SUCCESS.
- Tests cover real IDs vs. synthetic extensions, strict consent,
  exact browser identity, malformed/oversized/duplicated target lists,
  spoofed URLs and complete production Main/Preload/UI authorization.
- No installation packages were generated in these development workflows.

## Explicit certification limits

A Manifest V3 worker may be suspended and absent from
`Target.getTargets`, even while the real manager is installed. Conversely,
observing a known extension target is only a narrow runtime fact, **not**
proof that Tampermonkey actually injected into a selected tab. V4 must be
verified with a separately authorized true-manager functional GM_* test,
including the user's actual Chrome environment.

V2 production-safe interactions, named V3 functional tests, real V4
integration, the exact Windows 10 portable Chrome 155.0.8059.40
executable, independent final Setup/Portable/ZIP packages and all
RG-01..09 remain release blockers. Keep `0.1.0-alpha.5`,
Draft PR #2, no main merge, no previews or Stable Release.
