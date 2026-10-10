# Atomic Managed Batch Selector Repair — 2026-10-10

## Scope

The existing repair flow could discover multiple missing DOM locators but
applied one AST selector change per managed revision. This change adds a
bounded, independently approved **2–8 selector** batch repair, committed
as **one verified immutable managed revision** with one CAS activation.

The original userscript and Tampermonkey storage are never modified.

## Implementation

### Pure AST preview

`packages/patch-engine/src/index.ts` exports
`proposeLiteralPatchBatch`. Requires 2–8 static literal call locations and
replacement strings. It parses the original source once, finds exactly one
matching call per scanned line/column and method, rejects duplicates or
overlapping spans, and performs right-to-left replacements. This prevents
changes to the wrong occurrence when the same selector appears multiple times
or when an earlier replacement shifts later source offsets.

It preserves BOM and original line breaks, rejects malformed UTF-8, syntax
errors, oversized source/output and unbounded replacement input. No source
write or code execution occurs during drafting.

### Immutable write / replay

`applyManagedPatchBatch` opens the approved source with pinned file
identity, checks its SHA-256, independently rebuilds the entire AST batch
from the **exact previously reviewed literal spans**, and rejects even
self-consistent forged draft hashes or changed proposed bytes. Only then
does it create immutable predecessor and revision archives. Archiving alone
does **not** activate the new revision.

### Workflow, approval and UI

`packages/repair-workflow/src/batch.ts` provides
`createBatchRepairWorkflow` with bounded pending previews, per-script
synchronous locking, original/managed current SHA checks, AST ordinal
mapping for an already managed revision, preview revocation and a final
`activateManagedRevision` compare-and-swap against the expected predecessor.
A concurrent or externally changed predecessor must not be overwritten.

Electron Main binds requests to a trusted renderer frame, current authorized
scan, static AST selector indexes and original pinned source hash. Renderer
cannot provide a filesystem path, script ID, base hash, rollback hash or
raw source bytes. A batch is first proposed from 2–8 uniquely
DOM-verified candidates in the current bulk diagnosis; the user receives
one consolidated preview and must separately approve saving one new managed
copy. The new revision is **not** installed into Tampermonkey, and neither
automatic click dispatch nor GM API code execution is enabled.

The existing managed revision history/restore features remain available.

## TDD and CI evidence

- Batch pure AST preview RED: [Node contracts #38039934734](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38039934734)
  (missing batch editor); GREEN:
  [Node contracts #38039980901](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38039980901).
- Archive-only multi-patch writer RED:
  [Node contracts #38040022401](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38040022401).
  GREEN [Windows CI #38040050418](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38040050418):
  745 tests / 744 passed / 1 skipped / 0 failed.
- Batch workflow activation RED:
  [Node contracts #38040227804](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38040227804).
- Native approved GUI IPC RED:
  [Node contracts #38040367851](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38040367851).
- End-to-end GREEN:
  [Windows Development CI #38040544166](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38040544166):
  **751 tests, 750 passed, 1 skipped, 0 failed**, typecheck,
  Electron build, production bundle isolation gate, real Electron GUI and
  SQLite, real external Chrome CDP smoke, and official CFT 155 compatibility
  smoke all passed.
- Both actual Windows Chrome jobs log:
  `PASS real Chrome approved atomic 2-selector batch repair: failure → single managed revision success → rollback failure.`
  This synthetic functional scenario proves one approved batch can repair
  two distinct DOM-dependent conditions without an intermediate partial
  active revision, then roll both back.

## Limitations / Stable blockers

- DOM candidate uniqueness does not prove semantic equivalence, real
  userscript behavior, ability to click safely or GM_* APIs. Batch approval is
  still a user's deliberate in-app action.
- Shared in-process locking does not replace the immutable disk lock and CAS;
  those are the safeguards against a second process. Failed outputs may
  leave immutable forensic archives but do not claim successful activation.
- No real Tampermonkey manager V4, authenticated production V3 or destructive
  webpage V2 interaction test has been performed.
- User Windows 10 x64 with the particular portable Chrome 155.0.8059.40,
  official final Setup/Portable/full ZIP independent tests, QA-061..074 and
  release gates RG-01..09 remain outstanding.

**Status:** `0.1.0-alpha.5`, PR Draft; no intermediate installers,
no automatic merge, no premature Stable tag or release.
