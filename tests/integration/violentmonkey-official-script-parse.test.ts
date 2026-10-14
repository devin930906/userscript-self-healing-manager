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
