import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const timestamp='2026-10-16T02:30:00.000Z';
const makeReport=():BatchDomResult=>({
 validationLevel:'dom-only',
 pageTargetId:'fixture-only',
 pageUrl:'https://fixture.example.invalid/private?key=NEVER_EXPORT',
 totalItems:1,
 items:[{
  index:0,scriptId:'fixture',path:'/fixture/demo.user.js',
  status:'dom-present',checked:1,found:1,missing:0,needsReview:0,
  verification:{
   V0:'passed',V1:'passed',V2:'blocked',V3:'not-configured',V4:'not-configured',
   highestVerified:'V1',functionalVerified:false,managerVerified:false,
  },
 }],
});

test('RG-07 DOM report requires one validated own data row for every declared entry',()=>{
 for(const format of ['json','markdown'] as const){
  const report=makeReport();
  report.items=new Array(1) as BatchDomResult['items'];
  assert.throws(()=>serializeDomBatchReport(report,format,timestamp),
   /invalid|row|record|item/i,'sparse arrays must not serialize to null rows or missing Markdown rows');
 }
});

test('RG-07 DOM report rejects accessor-backed array elements without invoking the getter',()=>{
 for(const format of ['json','markdown'] as const){
  const report=makeReport();
  let getterCalls=0;
  const items=new Array(1);
  Object.defineProperty(items,0,{configurable:true,enumerable:true,get(){
   getterCalls++;return makeReport().items[0];
  }});
  report.items=items as BatchDomResult['items'];
  assert.throws(()=>serializeDomBatchReport(report,format,timestamp),/invalid|row|record|item/i);
  assert.equal(getterCalls,0,'report export must not run an untrusted row accessor');
 }
});

test('RG-07 DOM report rejects required getters on batch, row and verification objects',()=>{
 for(const key of ['pageUrl','path','V1'] as const){
  for(const format of ['json','markdown'] as const){
   const report=makeReport();
   const target:object=key==='pageUrl'?report:
    key==='path'?report.items[0]!:report.items[0]!.verification;
   const original=(target as unknown as Record<string,unknown>)[key];
   let getterCalls=0;
   Object.defineProperty(target,key,{configurable:true,enumerable:true,get(){
    getterCalls++;return original;
   }});
   assert.throws(()=>serializeDomBatchReport(report,format,timestamp),/invalid|row|record|item/i,
    key+' accessor must not supply diagnostic evidence');
   assert.equal(getterCalls,0,key+' accessor must not execute');
  }
 }
});

test('RG-07 valid dense own-data arrays remain exportable with same V1 distinctions',()=>{
 const report=makeReport();
 const json=JSON.parse(serializeDomBatchReport(report,'json',timestamp));
 assert.equal(json.processedCount,1);
 assert.equal(json.items[0].name,'demo.user.js');
 assert.equal(json.items[0].verification.V1,'passed');
 assert.doesNotMatch(JSON.stringify(json),/NEVER_EXPORT|fixture-only/);
 const md=serializeDomBatchReport(report,'markdown',timestamp);
 assert.match(md,/demo\.user\.js.*dom-present.*passed.*passed.*blocked/);
});


test('RG-07 revoked batch and item arrays reject with bounded error, no raw Proxy exception',()=>{
 for(const kind of ['batch','items','row','verification'] as const){
  const report=makeReport();
  const revoke=(value:object)=>{const p=Proxy.revocable(value,{});p.revoke();return p.proxy;};
  if(kind==='batch'){
   assert.throws(()=>serializeDomBatchReport(revoke(report),'json',timestamp),
    /Invalid DOM diagnosis/);
   continue;
  }
  if(kind==='items')report.items=revoke(report.items);
  if(kind==='row')report.items=[revoke(report.items[0]!)];
  if(kind==='verification')report.items[0]!.verification=revoke(report.items[0]!.verification);
  assert.throws(()=>serializeDomBatchReport(report,'json',timestamp),
   /Invalid DOM diagnosis/);
 }
});

test('RG-07 report never executes Proxy get traps after own-data evidence is accepted',()=>{
 const report=makeReport();
 let getCalls=0;
 const marker='PRIVATE_REPORT_PROXY_GET_TRAP';
 const trap={get(){getCalls++;throw Error(marker);}};
 report.items[0]!.verification=new Proxy(report.items[0]!.verification,trap);
 report.items=[new Proxy(report.items[0]!,trap)];
 const items=new Proxy(report.items,{get(){getCalls++;throw Error(marker);}});
 report.items=items;
 const wrapped=new Proxy(report,trap);
 const actual=JSON.parse(serializeDomBatchReport(wrapped,'json',timestamp));
 assert.equal(actual.processedCount,1);
 assert.equal(actual.items[0].verification.V1,'passed');
 assert.equal(getCalls,0,'only own-data descriptors may provide public diagnostic evidence');
 assert.doesNotMatch(JSON.stringify(actual),/PRIVATE_REPORT_PROXY_GET_TRAP/);
});

test('RG-07 report descriptor trap failure is redacted without exporting private exception',()=>{
 const report=makeReport();
 const privateToken='PRIVATE_REPORT_DESCRIPTOR_EXCEPTION';
 report.items=[new Proxy(report.items[0]!,{
  getOwnPropertyDescriptor(){throw Error(privateToken);}
 })];
 assert.throws(()=>serializeDomBatchReport(report,'markdown',timestamp),error=>{
  assert.ok(error instanceof Error);
  assert.match(error.message,/Invalid DOM diagnosis/);
  assert.doesNotMatch(error.message,/PRIVATE_REPORT_DESCRIPTOR_EXCEPTION/);
  return true;
 });
});
