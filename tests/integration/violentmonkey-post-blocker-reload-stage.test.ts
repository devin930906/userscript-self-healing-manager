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
