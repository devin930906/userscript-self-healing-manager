import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import * as restart from '../../scripts/violentmonkey-restart-attestation.ts';

/**
 * RG-05: the official-manager CFT job is an acceptance test, not a
 * best-effort diagnostic. A fresh process which fails to inject (even if
 * a single fixture reload later works) must not exit as a green gate.
 */
test('RG-05 official-manager gate accepts only immediate verified post-restart GM injection',()=>{
 const gate=(restart as Record<string,unknown>).assertOfficialViolentmonkeyReleaseGate;
 assert.equal(typeof gate,'function','missing release gate enforcement');
 const enforce=gate as (status:string)=>void;
 assert.doesNotThrow(()=>enforce('fixture-restart-passed'));
 for(const status of ['fixture-restart-blocked','fixture-restart-warmup-passed']){
  assert.throws(()=>enforce(status),/RG-05.*(cold.start|injection|blocked)/i,
   status+' cannot be reported as a successful official manager acceptance');
 }
 assert.throws(()=>enforce('unverified'),/RG-05.*(invalid|unknown|incomplete)/i);
});

test('RG-05 CFT harness enforces both restart outcomes and never prints universal PASS after a blocker',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(blocked\.status\)/);
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(restarted\.status\)/);
 assert.doesNotMatch(source,/\n\s*console\.log\('PASS isolated official Violentmonkey 2\.49\.0:/,
  'pre-restart GM success must not be unconditionally promoted after restart failure');
});
