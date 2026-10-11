import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {parseVerificationChain, verificationLevels, verificationStatuses} from '../src/verification-chain.ts';

const blocked = {V0:'passed',V1:'blocked',V2:'blocked',V3:'not-configured',V4:'not-configured'};

describe('FR-024 verification level chain',()=>{
 it('freezes exported verification levels and statuses at runtime',()=>{
  assert.equal(Object.isFrozen(verificationLevels),true,'verificationLevels must be frozen');
  assert.equal(Object.isFrozen(verificationStatuses),true,'verificationStatuses must be frozen');
 });

 it('rejects symbol and non-enumerable own extras while keeping valid plain and null-prototype records',()=>{
  for(const extra of ['symbol','hidden'] as const){
   const candidate:{[key:string]:unknown}={...blocked};
   if(extra==='symbol')Object.defineProperty(candidate,Symbol('extra'),{value:'forged'});
   else Object.defineProperty(candidate,'hiddenExtra',{value:'forged',enumerable:false});
   assert.throws(()=>parseVerificationChain(candidate),TypeError,extra);
  }
  const nullPrototype=Object.assign(Object.create(null),blocked);
  assert.deepEqual({...parseVerificationChain(nullPrototype)},blocked);
  assert.deepEqual(parseVerificationChain({...blocked}),blocked);
 });
 it('rejects an own accessor without invoking an untrusted evidence getter',()=>{
  const candidate:{[key:string]:unknown}={...blocked};
  let invoked=0;
  Object.defineProperty(candidate,'V2',{enumerable:true,configurable:true,get(){invoked++;throw new Error('getter executed');}});
  assert.throws(()=>parseVerificationChain(candidate),TypeError);
  assert.equal(invoked,0,'input getter must never execute');
 });
 it('accepts an observed V0 with later levels explicitly not passed',()=>{
  assert.deepEqual(parseVerificationChain(blocked),blocked);
 });
 it('accepts contiguous proof through V4',()=>{
  const complete={V0:'passed',V1:'passed',V2:'passed',V3:'passed',V4:'passed'};
  assert.deepEqual(parseVerificationChain(complete),complete);
 });
 it('rejects any level passed when its predecessor is not passed',()=>{
  for(const upper of ['V1','V2','V3','V4'] as const){
   const value:{[key:string]:string}={...blocked};
   for(const level of ['V0','V1','V2','V3','V4'])value[level]='blocked';
   value[upper]='passed';
   assert.throws(()=>parseVerificationChain(value),TypeError,`${upper} should not skip proof`);
  }
 });
 it('rejects passed after failed, skipped or unconfigured prerequisites',()=>{
  for(const status of ['failed','skipped','blocked','not-configured']){
   assert.throws(()=>parseVerificationChain({...blocked,V0:status,V1:'passed'}),TypeError);
  }
 });
 it('rejects malformed, ambiguous and prototype-inherited level records',()=>{
  for(const invalid of [null,[],{}, {...blocked,V5:'passed'}, {...blocked,V2:'healthy'},
   Object.assign(Object.create({V0:'passed'}),{V1:'blocked',V2:'blocked',V3:'blocked',V4:'blocked'})]){
   assert.throws(()=>parseVerificationChain(invalid),TypeError);
  }
 });
 it('returns a detached frozen snapshot',()=>{
  const value={...blocked};const parsed=parseVerificationChain(value);
  value.V0='failed';assert.equal(parsed.V0,'passed');assert.equal(Object.isFrozen(parsed),true);
 });
});
