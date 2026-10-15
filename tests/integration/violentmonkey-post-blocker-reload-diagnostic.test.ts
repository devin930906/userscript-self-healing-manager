import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

/**
 * RG-05 root-cause diagnostic: only after the real cold-start blocker is
 * classified from exactly two missing GM receipts, reload the pinned official
 * extension and test one new loopback document. Recovery may narrow lifecycle
 * causality, but it must never upgrade the failed cold-start release gate.
 */
test('RG-05 post-blocker extension reload diagnostic cannot weaken the cold-start gate',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const blocked=source.indexOf('classifyOfficialViolentmonkeyRestartBlocker({');
 const reload=source.indexOf('runPostBlockerExtensionReloadDiagnostic({');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(blocked>=0,'missing real cold-start blocker classification');
 assert.ok(reload>blocked,'diagnostic extension reload must run only after blocker classification');
 assert.ok(gate>reload,'blocked release gate must still execute after the recovery diagnostic');
 assert.match(source,/chrome\.runtime\.reload\(\)/,
  'diagnostic must reload only the pinned extension, not restart or alter a user browser');
 assert.match(source,/post-blocker extension reload.*NOT.*release.*pass/is,
  'diagnostic output must explicitly forbid promotion to a release pass');
 assert.doesNotMatch(source,/if\s*\([^)]*recovered[^)]*\)\s*assertOfficialViolentmonkeyReleaseGate\(['"]fixture-restart-passed['"]\)/s,
  'extension reload recovery must never substitute for immediate cold-start GM evidence');
});
