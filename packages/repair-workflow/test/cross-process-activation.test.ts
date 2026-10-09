import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {commitManagedCurrent} from '../src/current-activation.ts';
import {activateManagedRevision} from '../src/history.ts';

const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
async function inTemp(fn:(root:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'usshm-cross-process-cas-'));
 try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}
}

test('independent concurrent activation may not replace the current while first publisher owns its filesystem lock',async()=>inTemp(async(root)=>{
 const path=join(root,'current.user.js');
 const original=Buffer.from('previous-approved-revision');
 const first=Buffer.from('new-approved-revision-A');
 const competitor=Buffer.from('new-approved-revision-B');
 await writeFile(path,original);
 let secondRejected=false;
 await commitManagedCurrent({activePath:path,bytes:first,expectedActiveHash:sha(original),
  beforePublish:async()=>{
   await assert.rejects(commitManagedCurrent({activePath:path,bytes:competitor,
     expectedActiveHash:sha(original)}),/lock|busy|in progress|another writer/i);
   secondRejected=true;
  },
 });
 assert.equal(secondRejected,true);
 assert.deepEqual(await readFile(path),first);
 assert.deepEqual(await readdir(root),['current.user.js'],'successful activation must release the filesystem lock');
}));

test('orphaned lock is never silently stolen or cleared during managed activation',async()=>inTemp(async(root)=>{
 const path=join(root,'current.user.js');
 const lockPath=path+'.write-lock';
 await mkdir(lockPath);
 await assert.rejects(commitManagedCurrent({activePath:path,bytes:Buffer.from('new bytes'),expectedActiveHash:null}),
  /lock|busy|in progress|another writer/i);
 await assert.rejects(readFile(path),{code:'ENOENT'});
 assert.deepEqual(await readdir(root),['current.user.js.write-lock'],
  'a potentially live lock must remain for explicit safe recovery');
}));

test('activation of an archived revision requires an exact expected predecessor, including no-current sentinel',async()=>inTemp(async(root)=>{
 const folder=join(root,'managed','script-one');
 await mkdir(folder,{recursive:true});
 const initial=Buffer.from('approved initial'),successor=Buffer.from('approved successor');
 const initialHash=sha(initial),successorHash=sha(successor);
 await writeFile(join(folder,'original-'+initialHash+'.user.js'),initial);
 await writeFile(join(folder,'revision-'+successorHash+'.user.js'),successor);
 const activated=await activateManagedRevision({managedRoot:root,scriptId:'script-one',
  hash:initialHash,approved:true,expectedCurrentHash:null});
 assert.deepEqual(await readFile(activated.activePath),initial);
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'script-one',
  hash:successorHash,approved:true,expectedCurrentHash:null}),/current|stale|changed|exists/i);
 await assert.rejects(activateManagedRevision({managedRoot:root,scriptId:'script-one',
  hash:successorHash,approved:true,expectedCurrentHash:'0'.repeat(64)}),/current|stale|changed|hash/i);
 assert.deepEqual(await readFile(activated.activePath),initial);
 const updated=await activateManagedRevision({managedRoot:root,scriptId:'script-one',
  hash:successorHash,approved:true,expectedCurrentHash:initialHash});
 assert.deepEqual(await readFile(updated.activePath),successor);
}));
