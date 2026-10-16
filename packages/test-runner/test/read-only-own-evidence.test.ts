import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runReadOnlyDomContract} from '../src/index.ts';

const target={
 type:'page',id:'named-v1-evidence',url:'https://fixture.example.test/stable',
 webSocketDebuggerUrl:'ws://127.0.0.1:9223/devtools/page/named-v1-evidence',
};
const locator={method:'querySelector',expression:'#safe',runtimeRequired:false};
const row=()=>({method:locator.method,expression:locator.expression,
 status:'found',matchCount:1,nodeFingerprint:'a'.repeat(64)});
const packet=()=>({targetId:target.id,url:target.url,
 validationLevel:'dom-only',checks:[row()]});
const missing=()=>({...packet(),checks:[{...row(),status:'missing',matchCount:0}]});
function run(packets:readonly unknown[],options:{expectation?:'exists'|'unique';summarize?:()=>Promise<any>}={}){
 let calls=0;
 const deps={
  confirm:async()=>({targetId:target.id,confirmedUrl:target.url,frameId:'root',loaderId:'same'}),
  wait:async()=>{},
  probe:async()=>packets[calls++] as any,
  ...(options.summarize?{summarize:options.summarize}:{}),
 };
 return {calls:()=>calls,result:runReadOnlyDomContract({
  approved:true,target,caseId:'RG01-NAMED-V1',locator,
  expectation:options.expectation??'exists',deps,
 })};
}

test('RG-01 named V1 never certifies DOM presence from inherited CDP adapter identity',async()=>{
 const forged=Object.create({
  targetId:target.id,url:target.url,validationLevel:'dom-only',checks:[row()],
 });
 const r=run([forged,packet()]);
 const v=await r.result;
 assert.equal(v.status,'needs-review');
 assert.equal(v.matchCount,null);
 assert.equal(r.calls(),1,'no second probe should be trusted after invalid first sample');
 assert.equal(v.V2,'blocked');
 assert.equal(v.V3,'not-configured');
 assert.equal(v.V4,'not-configured');
});

test('RG-01 named V1 never invokes accessor-backed adapter identities or exposes their contents',async()=>{
 let readCount=0;
 const forged=packet() as Record<string,unknown>;
 Object.defineProperty(forged,'targetId',{get(){readCount++;throw Error('PRIVATE_NAMED_V1_ADAPTER');}});
 const r=run([forged,packet()]);
 const v=await r.result;
 assert.equal(readCount,0,'a data-only CDP boundary cannot execute getters');
 assert.equal(v.status,'needs-review');
 assert.equal(r.calls(),1);
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_NAMED_V1_ADAPTER/);
});

test('RG-01 named V1 refuses inherited and accessor-backed locator results',async()=>{
 let accessorCount=0;
 const inherited=Object.create(row());
 const accessor={...row()} as Record<string,unknown>;
 Object.defineProperty(accessor,'status',{get(){accessorCount++;throw Error('PRIVATE_V1_SELECTOR');}});
 for(const forged of [inherited,accessor]){
  const r=run([{...packet(),checks:[forged]},packet()]);
  const v=await r.result;
  assert.equal(v.status,'needs-review');
  assert.equal(v.matchCount,null);
  assert.equal(r.calls(),1);
  assert.doesNotMatch(JSON.stringify(v),/PRIVATE_V1_SELECTOR/);
 }
 assert.equal(accessorCount,0);
});

test('RG-01 unique V1 rejects inherited opaque node fingerprints even with two one-node counts',async()=>{
 const forged=Object.create({nodeFingerprint:'a'.repeat(64)});
 Object.assign(forged,{method:locator.method,expression:locator.expression,
  status:'found',matchCount:1});
 const evidence={...packet(),checks:[forged]};
 const r=run([evidence,evidence],{expectation:'unique'});
 const v=await r.result;
 assert.equal(v.status,'needs-review','inherited identity is not an HMAC proof');
 assert.equal(v.matchCount,null);
 assert.equal(v.V2,'blocked');
});

test('RG-01 named V1 does not accept an inherited zero Shadow DOM context to declare missing',async()=>{
 const inherited=Object.create({
  targetId:target.id,url:target.url,authorShadowTreeNodes:0,
 });
 const r=run([missing(),missing()],{summarize:async()=>inherited});
 const v=await r.result;
 assert.equal(v.status,'needs-review');
 assert.equal(v.matchCount,null);
 assert.equal(v.V3,'not-configured');
});

test('RG-01 named V1 must not invoke a Shadow DOM context accessor',async()=>{
 let touched=0;
 const bad={targetId:target.id,url:target.url} as Record<string,unknown>;
 Object.defineProperty(bad,'authorShadowTreeNodes',{
  get(){touched++;throw Error('PRIVATE_NAMED_V1_SHADOW');},
 });
 const r=run([missing(),missing()],{summarize:async()=>bad});
 const v=await r.result;
 assert.equal(touched,0);
 assert.equal(v.status,'needs-review');
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_NAMED_V1_SHADOW/);
});
