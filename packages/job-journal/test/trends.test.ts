import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeSiteTrends} from '../src/trends.ts';
import type {JournalRun} from '../src/index.ts';
const make=(id:string,origin:string,missing:number,total=25,status:JournalRun['status']='completed'):JournalRun=>({
 runId:id,pageOrigin:origin,status,totalItems:total,processedItems:status==='completed'?total:10,
 locatorMissing:missing,domPresent:total-missing,needsReview:0,errors:0,
 startedAt:'2026-10-09T08:00:00.000Z',updatedAt:'2026-10-09T08:00:20.000Z',
});
test('trend compares only successive completed runs of the same site and same batch size',()=>{
 const trends=summarizeSiteTrends([
  make('latest','https://example.org',6),
  make('other','https://other.org',2),
  make('previous','https://example.org',1),
 ]);
 assert.equal(trends.length,2);
 const example=trends.find(x=>x.pageOrigin==='https://example.org')!;
 assert.equal(example.kind,'more-missing');
 assert.equal(example.currentMissing,6);
 assert.equal(example.previousMissing,1);
 assert.equal(example.comparable,true);
 assert.equal(example.functionalVerified,false);
 assert.equal(example.evidenceLevel,'dom-only');
 assert.equal(trends.find(x=>x.pageOrigin==='https://other.org')?.kind,'insufficient-history');
});
test('interrupted, failed and cancelled runs never masquerade as a comparable baseline',()=>{
 const result=summarizeSiteTrends([
  make('new','https://example.org',2,25,'interrupted'),
  make('old','https://example.org',0,25,'completed'),
 ]);
 assert.equal(result[0]?.kind,'insufficient-history');
 assert.equal(result[0]?.comparable,false);
});
test('different script counts cannot be compared as selector drift',()=>{
 const result=summarizeSiteTrends([make('new','https://example.org',12,50),make('old','https://example.org',0,25)]);
 assert.equal(result[0]?.kind,'not-comparable');
 assert.equal(result[0]?.comparable,false);
});
test('two stable completed runs report unchanged, decreasing, and never report V3/manager validation',()=>{
 const stable=summarizeSiteTrends([make('n','https://example.org',0),make('p','https://example.org',0)]);
 const falling=summarizeSiteTrends([make('n','https://example.org',0),make('p','https://example.org',3)]);
 assert.equal(stable[0]?.kind,'unchanged');
 assert.equal(falling[0]?.kind,'fewer-missing');
 assert.equal(falling[0]?.managerVerified,false);
 assert.equal(falling[0]?.functionalVerified,false);
});
test('private URL params, file paths or invalid origins are not emitted as trend data',()=>{
 const trends=summarizeSiteTrends([make('a','https://example.org',2),make('b','https://example.org',0)]);
 assert.equal(JSON.stringify(trends).includes('C:\\'),false);
 assert.throws(()=>summarizeSiteTrends([make('a','https://example.org/?secret=yes',1)]),/origin|privacy|URL/i);
});
