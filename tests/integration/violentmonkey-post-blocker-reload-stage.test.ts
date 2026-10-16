import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

test('RG-05 extension-reload diagnostic reports only a bounded failure stage',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 assert.match(source,/const POST_BLOCKER_RELOAD_STAGES=Object\.freeze\(\[/,
  'missing bounded reload diagnostic stage allowlist');
 for(const stage of [
  'reload-issued','options-ready','capability-ready','injector-ready',
  'script-retained','fixture-ready','gm-observed','recovered',
 ]){
  assert.match(source,new RegExp("'" + stage + "'"),'missing bounded stage '+stage);
 }
 assert.match(source,/reloadDiagnostic\.stage/,
  'final diagnostic must report the bounded stage rather than a generic null');
 assert.doesNotMatch(source,/post-blocker extension reload diagnostic:[^\n]*\+\s*(?:error|String\(error\)|error\.message)/,
  'diagnostic must never print raw CDP or extension errors');
});


test('RG-05 reload diagnostic snapshots pinned userScripts access when API disappears after extension reload',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const optionsReady=source.indexOf("stage='options-ready'");
 const accessProbe=source.indexOf('buildViolentmonkeyUserScriptsAccessStatusExpression()',optionsReady);
 const capabilityReady=source.indexOf("stage='capability-ready'",optionsReady);
 assert.ok(optionsReady>=0&&accessProbe>optionsReady&&accessProbe<capabilityReady,
  'read-only Chrome setting must be captured before unavailable userScripts returns from options-ready');
 assert.match(source,/reloadDiagnostic\.accessStatus/,
  'final diagnostic must expose only the bounded pinned access-status booleans');
 assert.doesNotMatch(source,/reloadDiagnostic\.accessStatus[^\n]*PRIVATE|developerPrivate\.getExtensionsInfo[^\n]*console\./,
  'diagnostic must not print extension metadata or arbitrary settings payloads');
});


test('RG-05 reload diagnostic classifies missing userScripts API separately from a rejected query',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const optionsReady=source.indexOf("stage='options-ready'");
 const capabilityProbe=source.indexOf('buildViolentmonkeyUserScriptsCapabilityStatusExpression()',optionsReady);
 const capabilityReady=source.indexOf("stage='capability-ready'",optionsReady);
 assert.ok(optionsReady>=0&&capabilityProbe>optionsReady&&capabilityProbe<capabilityReady,
  'bounded capability status must be captured before declaring userScripts ready');
 assert.match(source,/reloadDiagnostic\.capabilityStatus/,
  'final diagnostic must expose only the bounded userScripts capability booleans');
 assert.doesNotMatch(source,/reloadDiagnostic\.capabilityStatus[^\n]*(?:error|message|stack|PRIVATE)/i,
  'capability diagnostic must not print private browser errors or payloads');
});


test('RG-05 reload diagnostic records an allowlisted Chrome userScripts access reason',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const optionsReady=source.indexOf("stage='options-ready'");
 const reasonProbe=source.indexOf('buildViolentmonkeyUserScriptsAccessReasonExpression()',optionsReady);
 const capabilityProbe=source.indexOf('buildViolentmonkeyUserScriptsCapabilityStatusExpression()',optionsReady);
 assert.ok(optionsReady>=0&&reasonProbe>optionsReady&&reasonProbe<capabilityProbe,
  'allowlisted access reason must be sampled before the options-page capability result');
 assert.match(source,/reloadDiagnostic\.accessReason/,
  'final diagnostic must expose the fixed Chrome access-state reason');
 assert.doesNotMatch(source,/reloadDiagnostic\.accessReason[^\n]*(?:error\.message|stack|PRIVATE)/i,
  'access reason output must not contain private browser payloads');
});


test('RG-05 reload diagnostic accepts only the bounded current Chrome extension-state reasons',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 for(const reason of [
  'state-disabled-reloading','state-disabled-unsupported-developer',
  'state-disabled-unsupported-manifest','state-disabled-corrupt',
  'state-disabled-suspicious','state-disabled-update','state-disabled-store',
  'state-disabled-policy','state-disabled-custodian','state-disabled-parent',
  'state-disabled-other-extension','state-disabled-none','state-disabled-multiple',
  'state-terminated','state-blocklisted','state-other',
 ]){
  assert.match(source,new RegExp("'" + reason + "'"),'reload diagnostic must accept '+reason);
 }
 assert.doesNotMatch(source,/'state'[\s,\]]/,
  'generic state must not hide the concrete Chrome extension lifecycle state');
});
