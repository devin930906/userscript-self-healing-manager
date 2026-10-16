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
