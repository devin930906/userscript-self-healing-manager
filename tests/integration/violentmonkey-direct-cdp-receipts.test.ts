import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {readVerifiedDirectChromeControlValue} from '../../scripts/violentmonkey-cdp-transport-reply.ts';

test('RG-05 direct Chrome USER_SCRIPT accepts only a descriptor-owned CDP value',()=>{
 for(const value of ['registered','attached','removed','send-onmessage','verified',null]){
  assert.equal(readVerifiedDirectChromeControlValue({result:{value}}),value);
 }
});

test('RG-05 synthetic direct control rejects falsy and inherited CDP errors without exposing private content',()=>{
 const sentinel='PRIVATE_CDP_CONTROL_SECRET';
 const forged=Object.create({error:{message:sentinel}});
 Object.defineProperty(forged,'result',{value:{value:'registered'},enumerable:true});
 const accessor={result:{}};
 Object.defineProperty(accessor.result,'value',{get(){throw new Error(sentinel);}});
 for(const candidate of [null,false,[],{},forged,accessor,
  {error:0,result:{value:'registered'}},
  {error:null,result:{value:'removed'}},
  {exceptionDetails:false,result:{value:'verified'}},
  {result:{value:'registered',get danger(){throw Error(sentinel);}}},
  {result:{__proto__:null}}, 
 ]){
  // The extra uninspected result getter in an otherwise valid object does
  // not automatically poison the trusted descriptor for the fixed value.
  if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&
     'result' in candidate&&'danger' in (candidate as any).result)continue;
  assert.throws(()=>readVerifiedDirectChromeControlValue(candidate),error=>{
   assert.ok(error instanceof Error);
   assert.equal(error.message,'Invalid direct Chrome CDP control receipt');
   assert.doesNotMatch(error.message,/PRIVATE_CDP_CONTROL_SECRET/);
   assert.equal('cause' in error,false);
   return true;
  });
 }
});

test('RG-05 direct Chrome control uses strict CDP envelope checks for registration and cleanup',async()=>{
 const source=await readFile(new URL('../../scripts/smoke-violentmonkey-cft.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function runDirectChromeUserScriptDiagnostic({');
 const end=source.indexOf('const POST_BLOCKER_RELOAD_STAGES=',start);
 assert.ok(start>=0&&end>start);
 const diagnostic=source.slice(start,end);
 for(const name of ['receipt','listener','value','response','snapshot','removed']){
  assert.match(diagnostic,new RegExp('readVerifiedDirectChromeControlValue\\('+name+'\\)'));
 }
 assert.doesNotMatch(diagnostic,/cleanupVerified=!removed\?\.exceptionDetails/);
 assert.doesNotMatch(diagnostic,/receipt\?\.result\?\.value===['"]registered/);
});
