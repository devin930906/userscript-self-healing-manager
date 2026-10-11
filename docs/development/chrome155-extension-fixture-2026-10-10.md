# Chrome for Testing 155 Extension Bootstrap — 2026-10-10

## Goal and precise evidence boundary

Validate that the **official Chrome for Testing 155** build used by the
Windows CI runner can actually load an isolated local Manifest V3 extension.
This is a prerequisite for eventual real manager testing but is not
Tampermonkey installation, userscript lifecycle validation or GM_* V4 proof.

Chrome's extension-team announcement says the command-line
`--load-extension` switch stopped working in **Chrome-branded** builds
starting in Chrome 137, while **Chrome for Testing** and Chromium retained
the feature:
https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY

This distinction matters: the project's normal Chrome connection/launch
must never silently try loading extensions this way into a user's Chrome.

Tampermonkey lists its official Chrome extension ID and current MV3
distribution paths here:
https://www.tampermonkey.net/faq.php?locale=en&q=Q406

## Implementation

- Added **test-only** `scripts/smoke-extension-cft.mjs`, run only under the
  existing official `Chrome for Testing 155.0.8059.39` Windows job.
- Requires `USSHM_SMOKE_EXPECT_CHROME_MAJOR=155` and the already prepared
  `CHROME_PATH` under the CI's pinned Chrome for Testing directory.
- Creates an ephemeral Chrome profile, local HTTP server and ephemeral
  unpacked MV3 test extension; no user data, real Chrome profile, credentials,
  downloaded extension archive or actual userscript is used.
- Launches with isolated `--load-extension` and
  `--disable-extensions-except` flags; verifies true Chrome CDP browser
  WebSocket identity, top-level frame/loader identity and one DOM marker
  inserted by the synthetic extension content script.
- Runs only on `http://127.0.0.1:<ephemeral>/fixture`. The test extension
  has no GM API bridge, storage or remote host permissions. All browser
  children, temporary extension and profile files are cleaned up.
- No UI/IPC path to this test-only capability exists in Electron production;
  the compiled production boundary gate also forbids this fixture's
  execution helpers.
- The normal Windows development job does not use
  `--load-extension`, avoiding the unsupported Chrome-branded 137+ behavior.

## Test-first evidence

- Expected RED:
  [Node contracts #38038785728](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38038785728)
  — extension-only CI fixture and wiring absent.
- GREEN:
  [Windows Development CI #38038860724](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38038860724)
  — **729 tests / 728 PASS / 1 SKIP / 0 FAIL**, TypeScript checks,
  Electron build, compiled production safety scan, real GUI/SQLite smoke,
  synthetic behavioral Chrome test, and the new real CFT MV3 extension
  injection step all passed.
- CFT job log contains:
  `PASS real CFT 155 isolated MV3 extension content-script injection into localhost fixture; NOT Tampermonkey / GM_* V4.`
- The parallel Node contracts job for the same HEAD also passed.

## Unverified Stable blockers

Still required: genuine pinned Tampermonkey MV3 package and manager-internal
test installation, script storage/menu/request GM_* behavior, site-permission
variations and verified V4 attestation; separate safe user-authorized V2 and
named real V3 contracts; Windows 10 x64 and the user's specific portable
Chrome 155.0.8059.40; three final Windows release packages and full
RG-01..09/QA-061..074 evidence.

**Current status:** Alpha / Draft. No intermediate installers, no automatic
merge to main, no premature Stable tag or GitHub Release.
