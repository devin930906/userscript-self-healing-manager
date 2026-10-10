# Core Recovery Schema Audit — 2026-10-10

## Scope

This iteration hardens **offline integrity verification of existing recovery snapshots**.
It does not import, restore, install, run, overwrite, or automatically modify
userscripts, Tampermonkey data or live Chrome profiles.

## Failure reproduced before production fix

1. A core backup contains an ordinary unkeyed SHA-256 manifest.
2. An offline actor can alter the SQLite copy *and then rewrite the manifest
   hash and byte count*. SQLite `integrity_check=ok` and the schema version
   alone do not establish the expected application schema.
3. Added four registry regressions: an unexpected DELETE trigger, an added
   scripts column, an extra UNIQUE index and an altered version-marker table.
4. Added three journal regressions: an unexpected trigger, an extra column, and
   removal of the journal-items foreign key.

### Repairs

- `assertRegistryV1SnapshotSchema` is shared by registry backup publication
  and `verifyCoreRecoveryBundle`; checks the version marker, expected scripts
  columns, exact v1 UNIQUE-index inventory, version-marker layout, and absence
  of unexpected table triggers. Startup migration reuses this fail-closed gate.
- `assertJournalSchemaSafety` is now shared by journal startup, snapshot
  publication and core recovery verification. In addition to the trigger gate,
  it checks the v1 column names/types/NOT NULL/primary-key order and the
  `journal_items -> journal_runs` CASCADE foreign key.
- Any failed compatibility check **rejects verification**. Nothing is
  automatically repaired or installed.

## Reproducible evidence

- Registry RED: [Task 1 contracts run #38035913485](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38035913485).
- Registry index/marker RED: [Task 1 contracts run #38036369794](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38036369794).
- Journal RED: [Task 1 contracts run #38036074019](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38036074019).
- GREEN code: [registry/journal verifier 07b37ef66](https://github.com/devin930906/userscript-self-healing-manager/commit/07b37ef663188c5a140514868db3a7c6814ce335), [stricter registry constraints 25547dc3e](https://github.com/devin930906/userscript-self-healing-manager/commit/25547dc3eebdd229fd76acd746a4f7db9f7694b2).
- [Windows Development CI #38036412854](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38036412854):
  **704 tests, 703 passed, 1 skipped, 0 failed**; TypeScript typecheck,
  Electron build, actual Windows Electron/SQLite GUI startup, and real Chrome
  155 CDP synthetic smoke passed.
- [Node contracts #38036412862](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38036412862) passed.

## Important limits and release policy

Checksums are **not signatures**. This audit detects incompatible schema
content even when a manifest checksum was rewritten. It does not authenticate
the backup creator or protect against arbitrary concurrent filesystem mutation.

No real user Tampermonkey extension or `GM_*` functional tests were performed.
Synthetic fixture behavior and DOM V1 evidence cannot be promoted to V2/V3/V4.
The prescribed Windows 10 machine with the owner's portable Chrome
155.0.8059.40 remains untested, as do formal three-format release gates and
any applicable code-signing requirements.

The development branch remains **Alpha / Draft**. There is no intermediate
installer and no authorization to relabel this iteration Stable.
