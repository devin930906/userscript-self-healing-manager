import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ScanSessionCoordinator} from '../src/scan-session.ts';

test('replacing the active scan invalidates every older batch request even when scripts have identical paths',async()=>{
 const store=new ScanSessionCoordinator<{items:{path:string;sourceSha256:string}[]}>();
 const earlier=await store.replace(async()=>({items:[{path:'same.user.js',sourceSha256:'old'}]}));
 assert.equal(store.require(earlier.scanId),earlier);
 const later=await store.replace(async()=>({items:[{path:'same.user.js',sourceSha256:'changed'}]}));
 assert.notEqual(earlier.scanId,later.scanId);
 assert.equal(store.require(later.scanId),later);
 assert.throws(()=>store.require(earlier.scanId),/stale|scan.*changed|identity/i);
 assert.throws(()=>store.assertCurrent(earlier),/stale|scan.*changed|identity/i);
});
test('an older slow scan cannot overwrite a newer completed scan',async()=>{
 const store=new ScanSessionCoordinator<{label:string}>();
 let finishOld:(value:{label:string})=>void=()=>{throw new Error('uninitialized deferred')};
 const oldResult=new Promise<{label:string}>(resolve=>{finishOld=resolve;});
 const old=store.replace(()=>oldResult);
 const current=await store.replace(async()=>({label:'newer'}));
 finishOld({label:'outdated'});
 await assert.rejects(old,/stale|newer scan|superseded/i);
 assert.equal(store.require(current.scanId),current);
 assert.equal(current.label,'newer');
});
test('failed new scan leaves the previously committed scan available',async()=>{
 const store=new ScanSessionCoordinator<{label:string}>();
 const current=await store.replace(async()=>({label:'verified'}));
 await assert.rejects(store.replace(async()=>{throw new Error('disk read error');}),/disk read error/);
 assert.equal(store.require(current.scanId),current);
 assert.throws(()=>store.require('bad-id'),/stale|identity/i);
});
test('missing scan IDs and scans not yet created never authorize DOM diagnosis',()=>{
 const store=new ScanSessionCoordinator<{label:string}>();
 assert.throws(()=>store.require(''),/scan|identity/i);
 assert.throws(()=>store.require('fake'),/scan|identity/i);
});
