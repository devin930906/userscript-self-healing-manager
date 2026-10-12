import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeStaticReport} from '../src/index.ts';
import type {ScanBatchResult} from '../../scan-service/src/index.ts';

const canaries=[
 'PRIVATE_ACCOUNT_NAME',
 'DO_NOT_EXPORT_SECRET',
 'https://fixture.invalid/?token=PRIVATE_QUERY_TOKEN',
];
const report:ScanBatchResult={
 scanMode:'static-only',createdAt:'2026-10-12T04:00:00.000Z',
 requestedCount:2,enumeratedCount:2,processedCount:2,passedCount:1,errorCount:1,
 items:[
  {path:'C:\\Users\\PRIVATE_ACCOUNT_NAME\\scripts\\ordinary.user.js',status:'parsed',
   selectorCount:2,runtimeRequiredCount:0,diagnostics:[]},
  {path:'/home/PRIVATE_ACCOUNT_NAME/scripts/private-error.user.js',status:'parse-error',
   selectorCount:0,runtimeRequiredCount:0,
   diagnostics:[
    'Error reading https://fixture.invalid/?token=PRIVATE_QUERY_TOKEN',
    'EACCES path=/home/PRIVATE_ACCOUNT_NAME; password=DO_NOT_EXPORT_SECRET',
   ]},
 ],
};

test('RG-07 static JSON export does not disclose private path segments or raw adapter errors',()=>{
 const exported=serializeStaticReport(report,'json');
 for(const canary of canaries)assert.equal(exported.includes(canary),false,canary);
 const parsed=JSON.parse(exported);
 assert.equal(parsed.scanMode,'static-only');
 assert.equal(parsed.requestedCount,2);
 assert.equal(parsed.passedCount,1);
 assert.equal(parsed.errorCount,1);
 assert.equal(parsed.items[0].path,'ordinary.user.js');
 assert.equal(parsed.items[1].path,'private-error.user.js');
 assert.equal(parsed.items[1].diagnostics.length,2,'retain safe diagnostic count for triage');
 assert.equal(parsed.items[1].diagnostics.every((s:string)=>s==='STATIC_DIAGNOSTIC_REDACTED'),true);
 assert.equal(parsed.items[0].verification.V1,'blocked');
 assert.equal(parsed.items[1].verification.V3,'not-configured');
});

test('RG-07 static Markdown export redacts raw file errors without hiding statuses or counts',()=>{
 const exported=serializeStaticReport(report,'markdown');
 for(const canary of canaries)assert.equal(exported.includes(canary),false,canary);
 assert.match(exported,/ordinary\.user\.js/);
 assert.match(exported,/private-error\.user\.js/);
 assert.match(exported,/STATIC_DIAGNOSTIC_REDACTED/);
 assert.match(exported,/parse-error/);
 assert.match(exported,/V0/);
 assert.match(exported,/未运行网页功能测试/);
});
