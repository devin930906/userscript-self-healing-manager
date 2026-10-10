# Engineering instructions
- Follow `docs/superpowers/plans/2026-10-08-phase-1-offline-desktop-implementation.md` in original GitHub repo.
- TDD: write a failing test, observe RED, implement minimum code, observe GREEN and whole suite, then commit.
- Never execute, eval, or import user-provided userscript code; treat all page DOM and metadata as hostile data.
- Avoid external AI/network access in static analysis. CDP only loopback and only after explicit action.
- Never silently alter or delete original scripts, profiles, credentials, browsers, or backups.
- Phase 1 Preview != final self-healing manager. Unverified features must be labeled as such.
- Three Windows targets must be built and independently verified before claiming any Stable distribution.
