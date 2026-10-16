import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('RG-05 default USER_SCRIPT baseline is sampled only after both real pre-restart GM receipts',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const firstGm=source.indexOf('const firstReceipt=assertViolentmonkeyV4FixtureObservation({');
 const secondGm=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation({');
 const bothConfirmed=source.indexOf('assert.deepEqual(secondReceipt.apis,firstReceipt.apis);');
 const baseline=source.indexOf('const baselineDefaultWorld=await runDirectChromeUserScriptDiagnostic({');
 const restart=source.indexOf('const previousChromePid=chrome.pid;');
 const blocked=source.indexOf('const blocked=classifyOfficialViolentmonkeyRestartBlocker({');
 const lateDefault=source.indexOf('const defaultUserScript=await runDirectChromeUserScriptDiagnostic({');
 assert.ok(firstGm>=0&&secondGm>firstGm&&bothConfirmed>secondGm);
 assert.ok(baseline>bothConfirmed&&restart>baseline&&blocked>restart);
 assert.ok(lateDefault>blocked,'the existing post-blocker default control must be retained');
 const excerpt=source.slice(baseline,restart);
 assert.match(excerpt,/world:'default'/);
 assert.match(excerpt,/RG-05 default USER_SCRIPT before Chrome process restart/);
 assert.doesNotMatch(excerpt,/enableViolentmonkeyUserScriptsAccess|configureWorld|resetWorldConfiguration|GetInjected\(/);
});

test('RG-05 baseline default-world fixture does not substitute synthetic messages for a genuine GM receipt',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const sample=source.indexOf('const baselineDefaultWorld=await runDirectChromeUserScriptDiagnostic({');
 const processRestart=source.indexOf('const previousChromePid=chrome.pid;');
 const officialGate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(sample>=0&&sample<processRestart&&officialGate>processRestart);
 assert.match(source.slice(sample,processRestart),/diagnostic only, not a GM receipt or V4 proof/);
 assert.doesNotMatch(source.slice(sample,processRestart),/assertViolentmonkeyV4FixtureObservation\(\{[^}]*baselineDefaultWorld/);
});
