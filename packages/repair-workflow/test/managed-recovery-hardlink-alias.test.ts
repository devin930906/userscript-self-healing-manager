import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {exportManagedRecovery,verifyManagedRecovery} from '../src/managed-export.ts';

const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function fixture(run:(x:{root:string;data:string;archive:string;bytes:Buffer;hash:string})=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-recovery-hardlink-'));
 try{
  const data=join(root,'Data'),managed=join(data,'managed','script-one');
  await mkdir(managed,{recursive:true});
  const bytes=Buffer.from('SYNTHETIC_RECOVERY_ARCHIVE_BYTES');
  const hash=sha(bytes),archive=join(managed,'original-'+hash+'.user.js');
  await writeFile(archive,bytes);
  await run({root,data,archive,bytes,hash});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('RG-06 managed recovery export cannot certify a source archive with external hardlink aliases',async()=>fixture(async({root,data,archive,bytes})=>{
 const alias=join(root,'synthetic-external-link.user.js');
 const destination=join(root,'Recovery');
 await link(archive,alias);
 assert.equal((await lstat(archive)).nlink,2);
 await assert.rejects(exportManagedRecovery({managedRoot:data,destination}),
  /hard.?link|alias|unsafe|immutable/i,
  'the recovery exporter must refuse externally mutable archives before completing a manifest');
 await assert.rejects(readFile(join(destination,'manifest.json')),{code:'ENOENT'});
 assert.deepEqual(await readFile(alias),bytes);
 assert.deepEqual(await readFile(archive),bytes);
}));

test('RG-06 managed recovery verification rejects hardlink-aliased manifest and snapshot entries',async()=>fixture(async({root,data,bytes,hash})=>{
 const destination=join(root,'Recovery');
 await exportManagedRecovery({managedRoot:data,destination});
 const expected={files:1,bytes:bytes.length};
 assert.deepEqual(await verifyManagedRecovery({snapshotDirectory:destination}),expected);
 const manifest=join(destination,'manifest.json');
 const manifestAlias=join(root,'synthetic-manifest-alias.json');
 await link(manifest,manifestAlias);
 assert.equal((await lstat(manifest)).nlink,2);
 await assert.rejects(verifyManagedRecovery({snapshotDirectory:destination}),
  /hard.?link|alias|unsafe|immutable/i);
 await unlink(manifestAlias);
 const snapshot=join(destination,'managed','script-one','original-'+hash+'.user.js');
 const snapshotAlias=join(root,'synthetic-snapshot-alias.user.js');
 await link(snapshot,snapshotAlias);
 assert.equal((await lstat(snapshot)).nlink,2);
 await assert.rejects(verifyManagedRecovery({snapshotDirectory:destination}),
  /hard.?link|alias|unsafe|immutable/i);
 assert.deepEqual(await readFile(snapshotAlias),bytes,'a rejected recovery audit never mutates snapshot bytes');
 await unlink(snapshotAlias);
 assert.deepEqual(await verifyManagedRecovery({snapshotDirectory:destination}),expected);
}));
