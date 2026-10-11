# Final-tag-only Windows Packaging Preflight — 2026-10-10

## Objective

Keep the currently approved no-intermediate-installers policy enforceable by
CI itself. Previously, the manually dispatched
`.github/workflows/windows-build.yml` would build and upload three *preview*
artifacts even when triggered on a mutable Alpha branch. The development CI
already avoided packaging, but this separate manual workflow lacked a strict
early preflight.

## Implemented protections

1. The Windows three-edition workflow is now **final tag only**. Immediately
   after checkout, **before `npm ci`, compilation, packaging or upload**, it
   runs `node scripts/final-build-authorization.mjs`.
2. The script reads its actual checked-out `package.json`; the caller cannot
   override the version using a workflow input. It allows only the exact
   `workflow_dispatch` event and a ref equal to
   `refs/tags/v<packageVersion>` with a non-prerelease, canonical
   `x.y.z` version. Branches, an Alpha/RC version, invalid/mismatched
   tags and other events are rejected before any installer exists.
3. The workflow continues to build Setup.exe, standalone Portable.exe and a
   **complete unpacked ZIP**, then independently performs GUI/SQLite launch
   checks and computes SHA-256 digests.
4. **Before uploading files**, the workflow must run the existing
   `scripts/windows-release-gate.mjs` against the actual three outputs.
   This validates versioned names, complete ZIP contents, safe ZIP
   central-directory metadata and local headers, PE x64 format, SHA-256
   checksums and existing checksum manifest consistency.
5. Uploads are explicitly named *final RG audit required*. This is an internal
   artifact review step, **not** a signed/final GitHub Release or Stable
   certification. No publishing action was enabled or performed.

## TDD and verification

- RED [Node #38044242027](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38044242027):
  new final-build policy tests detected the missing authorization module.
- RED [Node #38044379332](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38044379332):
  workflow tests required inventory/ZIP/sha256 verification before artifact upload.
- The policy now includes a **real child-process CLI test** using the repository's
  actual `0.1.0-alpha.5` package, proving that development refs, forged
  stable refs and prerelease tags exit unsuccessfully and print no
  authorization success.
- GREEN [Windows Development CI #38044459642](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38044459642):
  **791 tests / 790 passed / 1 skipped / 0 failed**, strict TypeScript,
  compiled production security boundary, real Windows Electron GUI/SQLite,
  real Chrome CDP and Chrome for Testing 155.0.8059.39 with isolated MV3
  fixture all passed.
- GREEN [Node contracts #38044459689](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38044459689):
  SUCCESS.

## Limitations / release-blocking conditions

**No final Windows installers were built in this iteration.** The manual
tag-only release workflow was not dispatched; its actual three-file inventory
and first-run package smoke are therefore **not yet demonstrated** by this
change. Green developer CI means the *authorization logic and wiring* passed,
not that the final distribution artifacts passed RG-09.

A matching tag is necessary but is **not sufficient** for Stable. The
production V2/V3 and genuine Tampermonkey/GM_* V4 contracts, user's exact
Windows 10/portable Chrome 155.0.8059.40, Win10/Win11 final three-edition
installation/upgrade/rollback evidence and all RG-01..09 must be independently
satisfied. No tag, installer, main merge or GitHub Release was created.
The current version remains `0.1.0-alpha.5` and PR #2 remains Draft.
