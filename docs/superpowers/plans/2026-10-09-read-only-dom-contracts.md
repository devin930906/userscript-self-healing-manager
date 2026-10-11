# Read-only named DOM contract slice · Superpowers TDD plan

**Date:** 2026-10-09. **Branch:** `feat/v01-continuation`. **Scope:** FR-025 / QA-027 baseline; no V2/V3/V4 pass.

## Goal
Build an actual desktop-accessible, non-destructive named DOM assertion executor for a user-selected, statically analyzed script locator. The test asserts only existence or uniqueness in the top document, requires two observations, preserves Chrome Frame/Loader identity and never executes source/userscript JavaScript.

## Spec / invariants
See `docs/architecture/healing-engine.md`, `docs/architecture/browser-cdp-and-runtime.md` and `docs/quality/test-and-acceptance.md`. No page mutation, click, credential collection, arbitrary runtime expression, DOM body leak or unmanaged original file write. The source code locator comes from the active authorized scan, never from raw renderer input. An observed V1 DOM assertion is *not* V2 interactive proof, V3 business functionality or V4 manager proof.

## Work sequence
1. **RED:** Add test-runner tests for stable exists/unique pass, missing/ambiguous fail, sample disagreement needs-review, CDP disconnect needs-review, same-URL loader change hard rejection, invalid target/consent, malformed observations. Verify tests fail because runner is missing.
2. **GREEN:** Implement `packages/test-runner/src/index.ts`, bounded to one locator, two read-only observations, one trusted wait callback, Chrome doc identity revalidation between requests, no synthetic pass of higher levels.
3. **RED:** Add Electron main/preload/UI wiring contract checks and a real disposable Chrome smoke assertion. Verify meaningful failure.
4. **GREEN:** Wire `usshm:run-dom-contract` to authenticated scan item + selectorIndex + selected target + allowed page scope; expose a narrow preload method, show exact outcome with V1-only disclaimer in GUI, add synthetic real Chrome read-only integration.
5. **Verify:** full Task 1 contracts, Windows Development CI all tests, typecheck, renderer/Electron build, true isolated Chrome + GUI smoke. Fix every test failure before recording results.
6. **Ledger:** document tests and remaining V2/3/4 release gates. No intermediate installer, main merge, Stable tag or release.
