import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';

const frame='fixed-fixture-frame';
const extension='jinjaccalgkegednnccohejagnlnfdag';
const parsed=(url:string,id=frame)=>({
 scriptId:'101',url,executionContextId:9,
 executionContextAuxData:{frameId:id},
});
test('RG-05 official injector scriptParsed only credits two pinned extension assets in the exact fixture main frame',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts').catch(()=>null);
 assert.equal(typeof mod?.createOfficialManagerScriptEvidence,'function','missing bounded official script-parsing probe');
 const e=mod!.createOfficialManagerScriptEvidence(frame,extension);
 const before={injectedWebParsed:false,injectedParsed:false};
 assert.deepEqual(e.snapshot(),before);
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://wrong-extension/injected.js'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js','other-frame'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js?private=1'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js#private'));
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 assert.deepEqual(e.snapshot(),{injectedWebParsed:false,injectedParsed:true});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected-web.js'));
 assert.deepEqual(e.snapshot(),{injectedWebParsed:true,injectedParsed:true});
 assert.doesNotMatch(JSON.stringify(e.snapshot()),/chrome-extension|private|frame|101|injected\\.js/);
});
test('RG-05 malformed debugger responses and unpinned frame identities never create false script execution evidence',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts').catch(()=>null);
 assert.equal(typeof mod?.createOfficialManagerScriptEvidence,'function');
 const factory=mod!.createOfficialManagerScriptEvidence;
 for(const frameId of ['', 'x'.repeat(257)])assert.throws(()=>factory(frameId,extension),/frame|identity/i);
 assert.throws(()=>factory(frame,'abcdefghijklmnopabcdefghijklmnop'),/extension|identity|pinned/i);
 const evidence=factory(frame,extension);
 for(const payload of [null,{},[],{scriptId:'',url:'chrome-extension://'+extension+'/injected.js',
  executionContextAuxData:{frameId:frame}},{
  scriptId:'103',url:'chrome-extension://'+extension+'/injected-web.js',
  executionContextAuxData:{frameId:'unexpected'}}, {
  scriptId:'101',url:'chrome-extension://'+extension+'/injected.js',
  executionContextAuxData:{frameId:frame},executionContextId:'9'
 }])evidence.observe('Debugger.scriptParsed',payload);
 evidence.observe('Runtime.executionContextCreated',parsed('chrome-extension://'+extension+'/injected.js'));
 assert.deepEqual(evidence.snapshot(),{injectedWebParsed:false,injectedParsed:false});
});
test('RG-05 debugger script observation is post-receipt only, bounded, and does not weaken cold-start GM gate',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const receipt=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const baseline=source.indexOf('RG-05 official injector parsed scripts control');
 const chromeExit=source.indexOf("browserCdp.send('Browser.close')");
 const missing=source.indexOf('startupInjectionBlocked=true');
 const post=source.indexOf('RG-05 official injector parsed scripts after missing GM receipts');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(receipt>=0&&baseline>receipt&&baseline<chromeExit);
 assert.ok(missing>chromeExit&&post>missing&&gate>post);
 assert.match(source,/await cdp.send\('Debugger.enable'\)/);
 assert.match(source,/await cdp.send\('Debugger.disable'\)/);
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.setScriptSource|Debugger.evaluateOnCallFrame/);
 assert.match(source,/assertOfficialViolentmonkeyReleaseGate\(blocked.status\)/);
});

test('RG-05 attributes live exceptions only to pinned official injector scripts without leaking script IDs',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const factory=(mod as Record<string,unknown>).createPinnedOfficialInjectorExceptionAttribution as
  ((frameId:string,extensionId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 assert.equal(typeof factory,'function','missing official pinned injector exception attribution');
 const evidence=factory(frame,extension);
 evidence.observe('Debugger.scriptParsed',{scriptId:'201',url:'chrome-extension://'+extension+'/injected.js',
  executionContextId:9,executionContextAuxData:{frameId:frame}});
 evidence.observe('Debugger.scriptParsed',{scriptId:'202',url:'chrome-extension://'+extension+'/injected-web.js',
  executionContextId:9,executionContextAuxData:{frameId:frame}});
 evidence.observe('Debugger.scriptParsed',{scriptId:'203',url:'chrome-extension://'+extension+'/injected.js',
  executionContextId:12,executionContextAuxData:{frameId:'other-frame'}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'201',executionContextId:9,
  text:'PRIVATE_SCRIPT_STACK',exception:{description:'PRIVATE_BROWSER_TOKEN'}}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'203',executionContextId:12,text:'PRIVATE_OTHER_FRAME'}});
 assert.deepEqual(evidence.snapshot(),{
  injectedWebExceptionObserved:false,injectedExceptionObserved:true,unattributedExceptionObserved:false,
 });
 assert.doesNotMatch(JSON.stringify(evidence.snapshot()),/PRIVATE|201|202|203|chrome-extension|frame/);
});

test('RG-05 runtime exception source attribution is read-only, fail-closed and never used as a GM pass receipt',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const factory=(mod as Record<string,unknown>).createPinnedOfficialInjectorExceptionAttribution as
  ((frameId:string,extensionId:string)=>{observe:(method:string,params:unknown)=>void;snapshot:()=>unknown});
 assert.equal(typeof factory,'function');
 const evidence=factory(frame,extension);
 evidence.observe('Debugger.scriptParsed',{scriptId:'111',url:'chrome-extension://'+extension+'/injected-web.js?token=PRIVATE',
  executionContextId:9,executionContextAuxData:{frameId:frame}});
 evidence.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'111',executionContextId:9,text:'PRIVATE'}});
 assert.deepEqual(evidence.snapshot(),{
  injectedWebExceptionObserved:false,injectedExceptionObserved:false,unattributedExceptionObserved:true,
 });
 const harness=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 assert.match(harness,/createPinnedOfficialInjectorExceptionAttribution/);
 assert.match(harness,/Runtime\.exceptionThrown/);
 assert.match(harness,/Debugger\.scriptParsed/);
 assert.match(harness,/await pageCdp\.send\('Debugger.enable'\)/,
  'subscribe to official scriptParsed before the already-authorized fixture reload');
 const failed=harness.indexOf('startupInjectionBlocked=true');
 const diagnostic=harness.indexOf('RG-05 official injector exception attribution after missing GM receipts');
 const denied=harness.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(failed>=0&&diagnostic>failed&&diagnostic<denied,
  'source classification cannot issue a GM success result or run before two failed receipts');
 assert.doesNotMatch(harness,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame/);
});

test('RG-05 only reports allowlisted exception class for pinned official injected.js without exposing private error strings',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
  ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedExceptionClass:()=>string};
 assert.equal(typeof e.injectedExceptionClass,'function','missing safe injected.js exception class projection');
 assert.equal(e.injectedExceptionClass(),'not-observed');
 e.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:frame,isDefault:false}}});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,text:'PRIVATE_ERROR_TEXT',exception:{
   className:'TypeError',description:'PRIVATE_STACK_WITH_SECRET',value:'PRIVATE_GM_VALUE',
  },
 }});
 assert.equal(e.injectedExceptionClass(),'TypeError');
 assert.doesNotMatch(JSON.stringify(e.snapshot())+e.injectedExceptionClass(),/PRIVATE|101|frame|chrome-extension/);
});

test('RG-05 cannot disclose arbitrary exception class names or claim a category on wrong official sources',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const make=()=>{
  const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
   ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedExceptionClass:()=>string};
  e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
  return e;
 };
 for(const [category,expected] of [
  ['ReferenceError','ReferenceError'],['SyntaxError','SyntaxError'],['RangeError','RangeError'],
  ['Error','Error'],['DOMException','unknown'],
  ['PRIVATE_USER_ACCOUNT_TOKEN','unknown'],[null,'unknown'],
 ] as const){
  const e=make();
  e.observe('Runtime.exceptionThrown',{exceptionDetails:{
   executionContextId:9,scriptId:'101',exception:{className:category,description:'PRIVATE_ERROR'},
  }});
  assert.equal(e.injectedExceptionClass(),expected);
  assert.doesNotMatch(e.injectedExceptionClass(),/PRIVATE|TOKEN|URL|frame/);
 }
 const e=make();
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,scriptId:'not-official',
  exception:{className:'TypeError'}}});
 assert.equal(e.injectedExceptionClass(),'not-observed');
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,scriptId:'101',
  exception:{className:'TypeError'}}});
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{executionContextId:9,scriptId:'101',
  exception:{className:'ReferenceError'}}});
 assert.equal(e.injectedExceptionClass(),'mixed','conflicting official errors cannot yield a single false root cause');
});

test('RG-05 safe exception class is logged only for confirmed failed cold-start receipts',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const control=source.indexOf('RG-05 official injected.js error class control');
 const earlier=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const restart=source.indexOf("browserCdp.send('Browser.close')");
 assert.ok(earlier>=0&&control>earlier&&control<restart);
 const failed=source.indexOf('startupInjectionBlocked=true');
 const actual=source.indexOf('RG-05 official injected.js error class after missing GM receipts');
 const gate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(failed>=0&&actual>failed&&gate>actual);
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame|\.exception\.description/);
});

test('RG-05 recognizes only the official injected.js missing data.info TypeError signature',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
  ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSignature:()=>string};
 assert.equal(typeof e.injectedFailureSignature,'function','missing pinned injected.js failure signature classifier');
 assert.equal(e.injectedFailureSignature(),'not-observed');
 e.observe('Runtime.executionContextCreated',{context:{id:9,auxData:{frameId:frame,isDefault:false}}});
 e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{
  scriptId:'101',executionContextId:9,exception:{
   className:'TypeError',
   description:"TypeError: Cannot read properties of undefined (reading 'info')\\n  at init (PRIVATE_ACCOUNT_URL)",
  },
 }});
 assert.equal(e.injectedFailureSignature(),'missing-injection-data-info');
 assert.equal(e.injectedExceptionClass(),'TypeError');
 assert.doesNotMatch(e.injectedFailureSignature()+JSON.stringify(e.snapshot()),/PRIVATE|URL|chrome-extension|101|frame/);
});

test('RG-05 rejects other, malformed and private TypeError descriptions without leaking them',async()=>{
 const mod=await import('../../scripts/violentmonkey-script-parse-evidence.ts');
 const factory=()=>{
  const e=mod.createPinnedOfficialInjectorExceptionAttribution(frame,extension) as
   ReturnType<typeof mod.createPinnedOfficialInjectorExceptionAttribution> & {injectedFailureSignature:()=>string};
  e.observe('Debugger.scriptParsed',parsed('chrome-extension://'+extension+'/injected.js'));
  return e;
 };
 for(const [description,expected] of [
  ["TypeError: Cannot read properties of undefined (reading 'password')",'other-type-error'],
  ["TypeError: Cannot read properties of null (reading 'info')",'missing-injection-data-info'],
  ['TypeError: PRIVATE_CUSTOM_MESSAGE','other-type-error'],
  [null,'other-type-error'],
 ] as const){
  const e=factory();
  e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'101',executionContextId:9,
   exception:{className:'TypeError',description}}});
  assert.equal(e.injectedFailureSignature(),expected);
  assert.doesNotMatch(e.injectedFailureSignature(),/PRIVATE|password|TOKEN|URL/);
 }
 const e=factory();
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'bogus',executionContextId:9,
  exception:{className:'TypeError',description:"TypeError: Cannot read properties of undefined (reading 'info')"}}});
 assert.equal(e.injectedFailureSignature(),'not-observed');
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'101',executionContextId:9,
  exception:{className:'TypeError',description:"TypeError: Cannot read properties of undefined (reading 'info')"}}});
 e.observe('Runtime.exceptionThrown',{exceptionDetails:{scriptId:'101',executionContextId:9,
  exception:{className:'TypeError',description:'TypeError: PRIVATE_OTHER_FAILURE'}}});
 assert.equal(e.injectedFailureSignature(),'mixed');
});

test('RG-05 reports missing-data signature only after two real failed restart documents',async()=>{
 const source=await readFile('scripts/smoke-violentmonkey-cft.mjs','utf8');
 const healthy=source.indexOf('RG-05 official injected.js failure signature control');
 const control=source.indexOf('const secondReceipt=assertViolentmonkeyV4FixtureObservation');
 const stopped=source.indexOf("browserCdp.send('Browser.close')");
 assert.ok(healthy>control&&healthy<stopped);
 const failed=source.indexOf('startupInjectionBlocked=true');
 const diagnostic=source.indexOf('RG-05 official injected.js failure signature after missing GM receipts');
 const strictGate=source.indexOf('assertOfficialViolentmonkeyReleaseGate(blocked.status)');
 assert.ok(diagnostic>failed&&diagnostic<strictGate,'cannot use a signature as a GM receipt');
 assert.doesNotMatch(source,/Debugger.getScriptSource|Debugger.evaluateOnCallFrame/);
});
