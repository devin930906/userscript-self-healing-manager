# Synthetic Functional Contract and Compiled Production Boundary — 2026-10-10

## Scope

Two independent release-readiness improvements were completed in the Native
development branch. Neither launches a preview installer or grants permission
to execute unknown userscripts.

### 1. Named synthetic repair → rollback functional contract

- New **test-only** module: `scripts/synthetic-functional-lifecycle.ts`.
- Named case: `SYNTHETIC-TWO-SELECTOR-REPAIR-ROLLBACK`.
- Four ordered observations are required on one disposable localhost fixture:
  baseline **fails** → one repaired locator **still fails** → both repaired
  locators **pass** → original restored **fails again**.
- All four source variants are exact fixed synthetic allowlist bytes; no
  arbitrary user-supplied JavaScript, non-loopback URL or unsanctioned CDP
  target is accepted. The real evaluator in
  `scripts/local-fixture-behavior.ts` independently enforces the same source
  allowlist and verified Chrome frame/loader identity.
- Missing approval, malformed evidence, runtime errors, foreign URL and false
  positive controls cannot be promoted to a pass. Exception text is never
  reproduced in contract receipts.
- Tests and real Chrome 155 E2E prove the sequence. Even a PASS returns
  `productionEligible: false`, `V3: not-configured`,
  `V4: not-configured`, `managerVerified: false` and
  `functionalVerified: false`.
- This does **NOT** install/run the script inside Tampermonkey, exercise GM_*
  APIs or attest actual user websites.

### 2. Built Electron safety boundary

- `scripts/production-boundary.mjs` checks esbuild's **actual production
  import graph** for forbidden test-only modules, including nested tests.
- `scripts/build.mjs` now refuses to leave `dist/` after a failed safety
  build; verifies compiled `main.cjs`, `preload.cjs`, and `renderer.js`
  against known test-only CDP script execution or mouse input dispatch APIs.
- `.github/workflows/dev-ci.yml` independently scans the built JavaScript
  *after* compilation and before GUI/Chrome smoke. No extra installers,
  archive artifacts, Chrome profiles or permission broadening are introduced.
- Scanner is an **additional deterministic guard**, not a complete proof
  against obfuscated/dynamically assembled behavior. Security review and
  release threat model are still required.

## Test-first evidence

| Gate | RED evidence | GREEN evidence |
| --- | --- | --- |
| Four-stage synthetic contract | [Node #38037953877](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38037953877), missing contract module | [Windows CI #38038072774](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38038072774), **721 tests / 720 PASS / 1 SKIP / 0 FAIL**, real Chrome for Testing 155 passed named four-stage control |
| Compiled production import/output safety | [Node #38038312591](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38038312591), nested test path bypass detected | [Windows CI #38038490596](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38038490596), **726 tests / 725 PASS / 1 SKIP / 0 FAIL**, test, TypeScript, Electron build, independent compiled security scan, Windows GUI + SQLite and real Chrome 155 fixture PASS |

## Remaining final Stable release blockers

- Production-safe, explicit user-authorized V2 interaction contracts, beyond
  the disposable synthetic fixture; named real functional V3 verification.
- Verified, isolated genuine Tampermonkey installation and GM_* V4 contract.
- User's specified Windows 10 x64 + portable Chrome 155.0.8059.40 executable
  (official Chrome for Testing 155.0.8059.39 on hosted Windows CI is not
  equivalent). Never infer compatibility from a different Windows version.
- Three **formal final** Windows distributions built from the same tagged
  commit and independently checked: NSIS Setup.exe, standalone Portable.exe,
  full unpacked ZIP; QA-061..074 and release gates RG-01..09.
- Independent release and security review, sensitive-data and dependency
  checks, rollback/upgrade evidence and any signing requirements.

**Status:** `0.1.0-alpha.5`, PR Draft. No automatic merge to main,
no intermediate preview installers, no Stable tag/Release.
