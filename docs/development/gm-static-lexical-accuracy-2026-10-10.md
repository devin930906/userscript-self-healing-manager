# GM_* / GM.* Static Inventory Lexical Scope Accuracy — 2026-10-10

## Defect

The source analyzer previously classified every syntactically matching
`GM_getValue(...)` / `GM.getValue(...)` call as a possible privileged
userscript-manager API usage, even when `GM` or `GM_getValue` was a
different local symbol declared in the script. Such false positives
distorted the static `@grant` inventory shown in the desktop UI and
could mislead future V4 readiness assessment. Static evidence still
does not prove that Tampermonkey injected APIs.

## Change

- A two-pass, purely syntactic TypeScript AST inspection collects local
  lexical bindings before inventorying calls. It handles block- and
  function-scoped variables, `var` hoisting, function/class declarations,
  function parameters, named function expressions, destructuring,
  imports, `for` loop bindings and `catch` parameter bindings.
- Real unshadowed calls to `GM_*`, `GM.*`, literal `GM['method']`,
  and unknown computed methods retain their existing static-only
  handling. All rows keep `managerVerified:false`.
- A `catch(GM)` binding is confined to the catch clause; this was a
  regression found by the new tests after the first implementation
  mistakenly treated catch variables as hoisted `var` declarations.
  It is now corrected.
- The analyzer does not execute any script, install extensions, access
  user storage or open a browser. No production GM runtime attestation
  is claimed.

## Test-first evidence

- [RED Node contracts #38045323538](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045323538):
  **5 new tests failed** on the old implementation.
- [Intermediate Node #38045419051](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045419051):
  4/5 new scenarios passed; one caught the catch-binding scope leak,
  which was fixed by `7a0d57b6`.
- [GREEN Windows Development CI #38045481238](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045481238):
  **799 tests / 798 PASS / 1 SKIP / 0 FAIL**. Strict TypeScript,
  Electron compiled production boundary, real Windows Electron
  GUI/SQLite, actual Chrome CDP, Chrome for Testing 155.0.8059.39
  isolated MV3 extension and synthetic repair/rollback all passed.
- [GREEN Node contracts #38045481230](https://github.com/devin930906/userscript-self-healing-manager/actions/runs/38045481230):
  SUCCESS.
- Regression file:
  `packages/source-analyzer/test/manager-api-shadowing.test.ts`.
  Implementation:
  `packages/source-analyzer/src/index.ts`.

## Remaining constraints

This only increases the precision of *static* Tampermonkey API
inventory; it does not establish actual manager installation,
`GM_*` grant injection, runtime storage/network/menu behavior, V2
interaction success, or V3 script-function success. These still require
separate, approved, isolated genuine manager tests. The owner's
Windows 10 / exact portable Chrome 155.0.8059.40 and the final
three Windows editions / RG-01..09 are also not certified.

Version remains `0.1.0-alpha.5` and PR #2 remains Draft.
No preview installer, final Stable tag, Release or main merge.
