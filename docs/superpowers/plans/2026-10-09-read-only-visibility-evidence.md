# Read-only target visibility evidence · Superpowers TDD

**Date:** 2026-10-09. **Objective:** FR-025 partial / QA-027 and QA-055 safety boundaries.

## Constraints and evidence
Chrome DevTools Protocol `DOM.getDocument`, `DOM.querySelectorAll`, `CSS.enable`, `CSS.getComputedStyleForNode`, and `DOM.getBoxModel` are read-only diagnostics. The selected Chrome page, imported userscript, Frame/Loader ID and exact static document selector must be authenticated by Electron main. Do not use `Runtime.evaluate`, `Input.dispatch*`, `DOM.set*`, click, focus, scroll, event listeners, screenshot or network interception.

The result can report `potentially-visible|hidden|unknown|ambiguous|missing` plus evidence limits; it must never upgrade V2/V3/V4 to `passed`. A positive element-local style/box does not prove actual interaction or ancestor visibility and must be phrased as *potentially visible*.

## Tasks
1. RED: model a fake WebSocket CDP server. Test sequence, no script execution, no side-effect commands, 1 exact static CSS locator only, bounded response, hidden/zero box, ambiguous/missing and malformed response.
2. GREEN: implement dedicated `packages/cdp-client/src/read-only-visibility.ts`, with fixed response budget, command timeout, listener teardown and allowed-style projection only. No DOM text or arbitrary CSS values returned.
3. RED: add authenticated scan-scoped main/preload/UI wiring test and disposable real Chrome fixture exercising one normal visible and one CSS-hidden element.
4. GREEN: wire selected script locator into a read-only visibility inspection button in desktop; confirm page identity before and after, display caveat and no higher-level success claims.
5. Full Windows tests, TypeScript, Electron/GUI and real Chrome smoke; record ledger. Do not generate installer, merge main or publish Stable.
