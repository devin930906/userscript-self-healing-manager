# Pinned Read-only Interaction Readiness — 2026-10-10

## Purpose

Implement a **user-authorized** two-sample, non-invasive correlation of
top-document selector identity, CSS control metadata, and direct click listener
metadata in real external Chrome. It is deliberately **not a production V2
interaction pass**. No script is executed, no mouse input is dispatched, no
focus, scrolling, navigation, or DOM mutation is performed.

## Main behavior and constraints

New module `packages/test-runner/src/read-only-interaction-readiness.ts`:

1. Requires an explicit `approved:true` invocation, a named case ID, a
   syntactically supported **static document** locator, and a trusted local
   Chrome debugger page WebSocket. The Electron Main handler derives the
   script and locator from the **current, authorized** scan session, verifies
   `@match/@exclude` scope, and never accepts raw selectors or filesystem
   paths from the renderer.
2. Confirms top frame and loader identity before and after each observation,
   and refuses navigation or replacement of the Chrome document.
3. For each of two samples, probes exactly one DOM locator with an opaque
   SHA-256-format HMAC backend-node fingerprint, then reads bounded CSS
   `display/visibility/opacity/pointer-events` + direct
   `disabled/readonly/aria-disabled` metadata, then reads **only direct**
   click-listener counts from the debugger. The Chrome read-only implementation
   releases temporary listener object handles.
4. Reports `potentially-ready` only when both samples have exactly one
   matching node **with an identical fingerprint**, potentially visible box,
   no directly observed blockers, pointer events not blocked, and consistent
   direct `click` listener count. The result is **not proof of clickability**
   and is never V2/V3/V4 success.
5. Reports `blocked` on directly observed blockers (hidden, disabled,
   read-only, `aria-disabled`, `pointer-events:none`).
6. Reports `needs-review` on absent, ambiguous, contradictory, unsupported,
   mismatched, missing, transient or non-direct listener evidence. Delegated
   listeners, Shadow DOM, iframes, CSS ancestor state, overlays and extension
   isolated worlds may not be observed. An unobserved direct listener is **not
   a userscript functional failure**.
7. Sanitizes internal page/socket exceptions and returns no node IDs, handler
   source, scripts or private DOM text. The renderer revokes stale results
   when the scan, script, selector or Chrome page selection changes.

Every receipt retains `V2:'blocked'`, `V3:'not-configured'`,
`V4:'not-configured'`, `interactionVerified:false`,
`functionalVerified:false` and `managerVerified:false`. The readiness
label is only a queue prioritization aid.

## TDD / Windows evidence

- RED tests introduced before the implementation:
  [Node contracts #38039427458](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38039427458)
  (missing two-sample readiness module).
- Follow-up RED GUI gate:
  [Node contracts #38039502765](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38039502765)
  (no trusted Main/Preload/UI wiring).
- CI revealed an esbuild syntax discrepancy around a multiline async arrow
  return type. Fixed without relaxing any behavior or checks.
- Full GREEN: [Windows Development CI #38039663710](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38039663710)
  **737 tests / 736 pass / 1 skip / 0 fail**, TypeScript, Electron bundle,
  independent compiled execution-safety gate, real Windows GUI+SQLite,
  real external Chrome and real isolated Chrome for Testing 155 MV3 extension
  fixture all passed.
- Live Chrome fixture reports:
  `PASS real Chrome read-only interaction readiness: two pinned samples plus disabled blocker; no V2 certification.`
- [Node contracts #38039663638](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38039663638)
  passed at the same code HEAD.

## Remaining release blockers

The observation cannot certify actual page interaction or named functional
behavior, and cannot prove Tampermonkey injection or GM_* availability.
Production-approved V2 behavior tests, V3 real named functional contracts and
isolated true Tampermonkey V4 are still missing. The user's Windows 10 x64
with their particular portable Chrome 155.0.8059.40, all three independently
validated **final** Windows release packages and RG-01..09 are not complete.

The PR therefore remains **Draft**, version remains
`0.1.0-alpha.5`, with no preview installers or premature Stable release.
