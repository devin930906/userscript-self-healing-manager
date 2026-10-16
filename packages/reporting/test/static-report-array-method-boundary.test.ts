import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const secret='PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK';
const fixture:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-16T00:00:00.000Z',
 requestedCount:1,enumeratedCount:1,processedCount:1,passedCount:1,errorCount:0,
 items:[{path:'/private/ok.user.js',status:'parsed',
  selectorCount:0,runtimeRequiredCount:0,diagnostics:['fixed diagnostic']}],
};

test('RG-07 static report refuses accessor-shadowed item array methods before calling them',()=>{
 for(const method of ['every','filter','map']){
  const items=[fixture.items[0]!];
  let calls=0;
  Object.defineProperty(items,method,{configurable:true,get(){
   calls++;
   throw new Error(secret);
  }});
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport({...fixture,items},format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report item');
    assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
    return true;
   });
  }
  assert.equal(calls,0,'array.'+method+' must never be invoked on untrusted input');
 }
});

test('RG-07 static report refuses accessor-shadowed diagnostic map before rendering',()=>{
 let calls=0;
 const diagnostics=['fixed diagnostic'];
 Object.defineProperty(diagnostics,'map',{configurable:true,get(){
  calls++;
  throw new Error(secret);
 }});
 const input:ScanBatchResult={...fixture,items:[{...fixture.items[0]!,diagnostics}]};
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(input,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
   return true;
  });
 }
 assert.equal(calls,0);
});

test('RG-07 ordinary item and diagnostic array methods remain compatible',()=>{
 const json=JSON.parse(serializeStaticReport(fixture,'json'));
 assert.equal(json.items[0].path,'ok.user.js');
 assert.deepEqual(json.items[0].diagnostics,['STATIC_DIAGNOSTIC_REDACTED']);
 assert.match(serializeStaticReport(fixture,'markdown'),/ok\.user\.js/);
});

test('RG-07 static report rejects inherited item-array method accessors without evaluating attacker code',()=>{
 for(const method of ['every','filter','map']){
  const items=[fixture.items[0]!];
  let invoked=0;
  const inherited=Object.create(Array.prototype);
  Object.defineProperty(inherited,method,{configurable:true,get(){
   invoked++;
   throw new Error(secret);
  }});
  Object.setPrototypeOf(items,inherited);
  assert.equal(Object.hasOwn(items,method),false,'regression must involve only inherited override');
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeStaticReport({...fixture,items},format),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.message,'Invalid static report item');
    assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
    return true;
   });
  }
  assert.equal(invoked,0,'must never invoke inherited '+method+' getter');
 }
});

test('RG-07 static report refuses inherited diagnostic map getter without export-time side effects',()=>{
 const diagnostics=['fixed diagnostic'];
 let invoked=0;
 const inherited=Object.create(Array.prototype);
 Object.defineProperty(inherited,'map',{configurable:true,get(){
  invoked++;
  throw new Error(secret);
 }});
 Object.setPrototypeOf(diagnostics,inherited);
 assert.equal(Object.hasOwn(diagnostics,'map'),false);
 const forged:ScanBatchResult={...fixture,items:[{...fixture.items[0]!,diagnostics}]};
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(forged,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
   return true;
  });
 }
 assert.equal(invoked,0,'inherited diagnostics.map getter cannot run');
});


test('RG-07 static report redacts throwing root descriptor traps',()=>{
 let attempted=0;
 const hostile=new Proxy(fixture,{
  getOwnPropertyDescriptor(target,key){
   if(key==='items'){attempted++;throw new Error(secret);}
   return Reflect.getOwnPropertyDescriptor(target,key);
  },
 });
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(hostile,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report input');
   assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
   return true;
  });
 }
 assert.equal(attempted,2);
});

test('RG-07 static report redacts throwing row descriptor traps',()=>{
 let attempted=0;
 const row=new Proxy(fixture.items[0]!,{
  getOwnPropertyDescriptor(target,key){
   if(key==='path'){attempted++;throw new Error(secret);}
   return Reflect.getOwnPropertyDescriptor(target,key);
  },
 });
 const hostile:ScanBatchResult={...fixture,items:[row]};
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(hostile,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report item');
   assert.doesNotMatch(error.message,/PRIVATE_ARRAY_METHOD_GETTER_MUST_NOT_LEAK/);
   return true;
  });
 }
 assert.equal(attempted,2);
});


test('RG-07 report projection never invokes post-validation Proxy value getters',()=>{
 let rootReads=0;
 const root=new Proxy(fixture,{
  get(target,key,receiver){
   if(key==='items'){rootReads++;throw new Error(secret);}
   return Reflect.get(target,key,receiver);
  },
 });
 for(const format of ['json','markdown'] as const){
  assert.throws(()=>serializeStaticReport(root,format),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid static report input');
   return true;
  });
 }
 assert.equal(rootReads,0,'root values must come from validated data descriptors');

 let rowReads=0;
 const row=new Proxy(fixture.items[0]!,{
  get(target,key,receiver){
   if(key==='status'){rowReads++;throw new Error(secret);}
   return Reflect.get(target,key,receiver);
  },
 });
 for(const format of ['json','markdown'] as const){
  const jsonOrMarkdown=serializeStaticReport({...fixture,items:[row]},format);
  assert.ok(jsonOrMarkdown.includes('ok.user.js'));
 }
 assert.equal(rowReads,0,'validated rows must not be read again through their untrusted proxies');
});
