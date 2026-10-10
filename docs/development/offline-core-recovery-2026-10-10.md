# Offline Core Recovery Audit and Non-active Staging — 2026-10-10

## Scope and safety

This development slice closes two gaps in the Alpha recovery workflow:

1. Electron now offers an independent **read-only** audit of an existing core
   backup. The trusted native directory picker chooses the source; the
   renderer cannot pass raw filesystem paths.
2. An **explicitly confirmed**, separately native-picked operation can stage
   the verified registry SQLite, diagnosis journal SQLite and hashed managed
   revisions into a brand-new, non-active folder. This is **not** automatic
   restoration or installation, and does not change the running Data root.

Both paths preserve the original userscript files and Chrome / Tampermonkey
storage. The new stage intentionally excludes browser profiles, preferences,
SiteAdapter libraries, credentials and secrets. These backups are cross-store
non-atomic and do not represent complete Data disaster recovery.

## Test-first change record

- [Manifest RED, Node contracts #38036982872](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38036982872):
  before the fixes, unknown top-level or per-file fields could be appended to
  otherwise valid core and nested managed recovery manifests. Four new hostile
  metadata cases now reject false claims such as `scriptExecuted: true`.
- [Offline stage RED, Node contracts #38037208580](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38037208580):
  the safe standalone staging API did not previously exist.
- An initial GUI wiring test exposed an overly rigid *test-source formatting
  regex* on the multi-line IPC call. The test was corrected to tolerate
  whitespace; the production confirmation and path guards were not bypassed.
- [Windows Development CI #38037467960](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38037467960):
  **715 tests / 714 passed / 1 skipped / 0 failed**. TypeScript typecheck,
  Electron build, real Windows Electron GUI/SQLite smoke and real Chrome 155 CDP
  smoke all passed.
- [Node contracts #38037467760](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38037467760):
  PASS.

## Staging contract

- Input: pre-existing source bundle, running Data root and desired entirely new
  offline target. In production these come from trusted main and two native
  directory pickers, never from renderer-supplied paths.
- Requires explicit native warning/approval for copying sensitive local data.
- Rejects destinations inside the source bundle or active Data, including
  verified filesystem aliases; uses exclusive new-directory/file publication.
- Verifies the complete source snapshot and SQLite schemas **before** writing.
- Only copies the two named SQLite files and exactly the managed files
  enumerated by the strictly validated nested SHA-256 manifest.
- Validates every copied file size and checksum, rechecks both staged SQLite
  schemas and the source manifest, and writes
  `USSHM-RECOVERY-NOT-ACTIVE.json` **last**.
- Does not automatically remove incomplete output directories (forensics) or
  activate/restore into live Data, Chrome or Tampermonkey.

## Unverified / non-goals

This is **not** a claim that backup manifests are cryptographically signed;
SHA-256 by itself does not authenticate who generated a backup. It is not
safe live migration, cross-store point-in-time consistency, recovery of
external original script paths, or a full profile/credential disaster backup.

Neither the customer's Windows 10 x64 + portable Chrome 155.0.8059.40 nor
real Tampermonkey/GM_* V4 or named production V2/V3 behaviors were tested.
The full Setup/Portable/full ZIP stable release gate RG-01..09 remains open.

**Release status: Alpha, PR Draft. No intermediate installers, merge to main,
Stable tag or published release.**
