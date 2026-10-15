import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serializeDomBatchReport} from '../src/dom-report.ts';
import type {BatchDomResult} from '../../scan-service/src/batch-dom.ts';

const fixture:BatchDomResult={
 validationLevel:'dom-only',pageTargetId:'synthetic-target',
 pageUrl:'https://example.invalid/fixture',totalItems:0,items:[],
};

test('RG-07 rejects non-calendar report dates that Date.parse silently normalizes',()=>{
 for(const date of ['2026-02-30T12:30:00.000Z','2025-02-29T12:30:00.000Z','2026-04-31T12:30:00.000Z']){
  for(const format of ['json','markdown'] as const){
   assert.throws(()=>serializeDomBatchReport(fixture,format,date),/Invalid diagnosis report timestamp/);
  }
 }
});

test('RG-07 retains valid leap day and ISO timezone timestamps',()=>{
 for(const stamp of ['2024-02-29T12:30:00.000Z','2026-10-15T12:30:00+08:00']){
  const result=JSON.parse(serializeDomBatchReport(fixture,'json',stamp));
  assert.equal(result.createdAt,stamp);
 }
});

test('RG-07 rejects timestamps with invalid suffixes or incomplete timezone',()=>{
 for(const stamp of [
  '2026-10-15T12:30:00.000Z ignored',
  '2026-10-15T12:30:00',
  '2026-10-15T12:30:00+08',
  '2026-10-15T12:30:00.1234567890Z',
 ]){
  for(const format of ['json','markdown'] as const)
   assert.throws(()=>serializeDomBatchReport(fixture,format,stamp),/Invalid diagnosis report timestamp/);
 }
});

test('RG-07 rejects rollover midnight that Date.parse normalizes to the following date',()=>{
 for(const stamp of ['2026-10-15T24:00:00.000Z','2026-10-15T24:00:00+08:00']){
  assert.ok(Number.isFinite(Date.parse(stamp)), 'regression fixture must reach Date.parse');
  for(const format of ['json','markdown'] as const)
   assert.throws(()=>serializeDomBatchReport(fixture,format,stamp),/Invalid diagnosis report timestamp/);
 }
});
