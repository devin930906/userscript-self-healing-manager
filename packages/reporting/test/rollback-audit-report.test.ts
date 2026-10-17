import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openRollbackAuditJournal} from '../../audit-journal/src/rollback-events.ts';
import {writeExclusiveReport} from '../src/exclusive-report.ts';
import {serializeRollbackAuditReport} from '../src/rollback-audit-report.ts';

const ID=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const A='a'.repeat(64),B='b'.repeat(64);
const NOW='2026-10-17T05:00:00.000Z';
test('FR-040 exports real durable rollback receipts in JSON + readable Markdown, not inferred test passes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'usshm-rollback-report-'));
 try{
  const journal=openRollbackAuditJournal(join(root,'events.sqlite'));
  const draft={scriptId:'test_script',previousHash:A,targetHash:B,
   sourceAuditRevisionId:ID(11),targetAuditRevisionId:null,at:NOW};
  journal.begin({...draft,id:ID(1)});
  journal.finish({id:ID(1),targetHash:B,outcome:'committed',at:NOW});
  journal.begin({...draft,id:ID(2),sourceAuditRevisionId:null});
  const entries=journal.listByScript('test_script');
  const json=serializeRollbackAuditReport(entries,'json',NOW);
  const report=JSON.parse(json);
  assert.equal(report.reportType,'managed-rollback-audit');
  assert.equal(report.schemaVersion,1);
  assert.equal(report.recordCount,2);
  assert.equal(report.events[0].outcome,null);
  assert.equal(report.events[1].outcome,'committed');
  assert.equal(report.events[1].sourceAuditRevisionId,ID(11));
  assert.equal(report.events[1].targetAuditRevisionId,null);
  assert.ok(!('scriptId' in report.events[0]));
  assert.doesNotMatch(json,/test_script|events\.sqlite|current\.user\.js|V4.*passed/);
  const markdown=serializeRollbackAuditReport(entries,'markdown',NOW);
  assert.match(markdown,/未完成|尚未完成/);
  assert.match(markdown,/已验证完成/);
  assert.match(markdown,/job|审计|关联/);
  assert.doesNotMatch(markdown,/test_script|events\.sqlite|current\.user\.js/);
  const destination=join(root,'rollback-report.json');
  await writeExclusiveReport({destinationPath:destination,content:json});
  assert.equal(await readFile(destination,'utf8'),json);
  await assert.rejects(
   writeExclusiveReport({destinationPath:destination,content:'overwrite'}),
   /already exists|refus|overwrite/i);
  assert.equal(await readFile(destination,'utf8'),json);
  journal.close();
 }finally{await rm(root,{recursive:true,force:true});}
});

test('FR-040 uncertain operations remain uncertain in both report formats; no false Stable/V1/V4',()=>{
 const entry={id:ID(3),scriptId:'only_local',previousHash:null,targetHash:A,
  sourceAuditRevisionId:null,targetAuditRevisionId:null,createdAt:NOW,
  outcome:'uncertain' as const,finishedAt:NOW};
 for(const fmt of ['json','markdown'] as const){
  const out=serializeRollbackAuditReport([entry],fmt,NOW);
  assert.match(out,/uncertain|结果不确定/);
  assert.doesNotMatch(out,/only_local|file:\/|C:\\\\|managerVerified.*true|V4.*passed/);
 }
});

test('FR-040 rejects forged/oversize/accessor audit evidence and invalid timestamps without reading private getter text',()=>{
 const entry={id:ID(3),scriptId:'safe',previousHash:A,targetHash:B,
  sourceAuditRevisionId:null,targetAuditRevisionId:null,createdAt:NOW,
  outcome:'committed' as const,finishedAt:NOW};
 const bad=[
  {...entry,outcome:null,finishedAt:NOW},
  {...entry,outcome:'committed',finishedAt:null},
  {...entry,id:'fake'},
  {...entry,targetHash:'SECRET'},
  {...entry,createdAt:'2026-02-30T00:00:00.000Z'},
 ];
 for(const row of bad)assert.throws(()=>serializeRollbackAuditReport([row] as any,'json',NOW),/invalid|audit|timestamp|event/i);
 assert.throws(()=>serializeRollbackAuditReport([entry],'json','bad'),/invalid|timestamp/i);
 assert.throws(()=>serializeRollbackAuditReport(Array(1),'json',NOW),/invalid|audit|event/i);
 assert.throws(()=>serializeRollbackAuditReport(Array.from({length:51},()=>entry),'json',NOW),/invalid|limit|count/i);
 const accessor={...entry};
 Object.defineProperty(accessor,'targetHash',{enumerable:true,get(){throw Error('PRIVATE-CREDENTIAL');}});
 assert.throws(()=>serializeRollbackAuditReport([accessor] as any,'json',NOW),e=>
  e instanceof Error&&!String(e.message).includes('PRIVATE-CREDENTIAL'));
});

test('FR-040 rejects Proxy-backed audit receipts before native reflection',()=>{
 const entry={id:ID(9),scriptId:'private_local_script',previousHash:A,targetHash:B,
  sourceAuditRevisionId:null,targetAuditRevisionId:null,createdAt:NOW,
  outcome:'committed' as const,finishedAt:NOW};
 const guarded=<T extends object>(target:T)=>{
  let trapCalls=0;
  const proxy=new Proxy(target,{
   getPrototypeOf(value){trapCalls++;return Reflect.getPrototypeOf(value);},
   getOwnPropertyDescriptor(value,key){trapCalls++;return Reflect.getOwnPropertyDescriptor(value,key);},
   ownKeys(value){trapCalls++;return Reflect.ownKeys(value);},
   get(value,key,receiver){trapCalls++;return Reflect.get(value,key,receiver);},
  });
  return {proxy,calls:()=>trapCalls};
 };
 const container=guarded([entry]);
 assert.throws(()=>serializeRollbackAuditReport(container.proxy,'json',NOW),/Invalid rollback audit report/i);
 assert.equal(container.calls(),0,'container Proxy traps must never run');
 const row=guarded(entry);
 assert.throws(()=>serializeRollbackAuditReport([row.proxy],'markdown',NOW),/Invalid rollback audit report/i);
 assert.equal(row.calls(),0,'row Proxy traps must never run');
 const revokedArray=Proxy.revocable([entry],{});
 revokedArray.revoke();
 assert.throws(()=>serializeRollbackAuditReport(revokedArray.proxy,'json',NOW),/Invalid rollback audit report/i);
 const revokedRow=Proxy.revocable(entry,{});
 revokedRow.revoke();
 assert.throws(()=>serializeRollbackAuditReport([revokedRow.proxy],'json',NOW),/Invalid rollback audit report/i);
});
